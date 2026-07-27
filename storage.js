/*!
 * storage.js — 记账本本地缓存层（IndexedDB 轻量封装）
 * UMD 模块：浏览器中挂载为全局 LedgerStore；Node 中可 require（用于自动化测试）。
 *
 * 设计目标（对应需求）：
 *  1. 提供数据 CRUD 基本操作（put / get / getAll / getAllKeys / delete / clear / bulkPut / meta）
 *  2. 所有接口均为异步（Promise，可直接 await）
 *  3. 完善的错误处理：异常捕获 + 事务回滚（事务内任一请求失败即 abort 整笔事务）
 *  4. 存储容量管理：navigator.storage.estimate 配额检测 + 溢出告警回调
 *
 * 数据模型：单一 object store（keyPath='key'），每条记录存为 { key, value, ts }。
 * 本记账本只持久化一份「原始数据」快照（key = 'original'），
 * 且只有「保存原始数据」按钮会触发写入（写入入口唯一）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LedgerStore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ===== 常量 =====
  // V055 使用独立库名，避免与 V025/V050（同为 ledger-cache）在同一浏览器源下共享数据库，
  // 防止版本号不同导致一方被浏览器以 VersionError 拒绝（"本地缓存不可用"的诱因）。
  var DEFAULT_DB = 'ledger-cache-v055';
  var DEFAULT_STORE = 'kv';
  // DB_VERSION：IndexedDB 数据库版本（onupgradeneeded 触发升级）。
  //  V050 新增独立 personList 人员配置表 → 升到 2（仅新建表，绝不删旧数据）。
  var DB_VERSION = 2;
  // SCHEMA_VERSION：持久化「原始数据」的记录结构版本（写入 payload.schemaVersion）。
  //  保持 1 不变：人员维度为「可选追加字段」，存量旧数据读取后仍可兼容，避免误报 schema 不匹配。
  var SCHEMA_VERSION = 1;
  var DEFAULT_PERSON_STORE = 'personList'; // 记账成员配置表（keyPath='id'）
  var KEY_ORIGINAL = 'original';     // 持久化的「原始数据」快照键
  var KEY_META = 'meta';             // 元数据（schemaVersion / 最近保存时间等）
  var USAGE_WARN_RATIO = 0.9;        // 用量超过配额的 90% 触发溢出告警

  // ===== 错误构造 =====
  function LedgerStoreError(message, code, cause) {
    var e = new Error(message);
    e.name = 'LedgerStoreError';
    e.code = code || 'UNKNOWN';
    if (cause !== undefined) e.cause = cause;
    return e;
  }

  // 把底层 IDB 错误归一化为 LedgerStoreError
  function normalize(err, fallbackCode) {
    if (err && err.name === 'LedgerStoreError') return err;
    var code = fallbackCode || 'UNKNOWN';
    var msg = (err && err.message) || String(err);
    if (err && (err.name === 'QuotaExceededError' ||
                (err.message && /quota/i.test(err.message)))) {
      code = 'QUOTA_EXCEEDED';
      msg = '存储空间不足，写入失败（QuotaExceededError）';
    } else if (err && (err.name === 'NotFoundError' || err.name === 'VersionError')) {
      code = 'DB_ERROR';
    }
    return LedgerStoreError(msg, code, err);
  }

  // 把单个 IDB 请求包装成 Promise
  function reqPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('request failed')); };
    });
  }

  // 在事务内同步派发若干请求，全部完成后 resolve。
  // 回滚策略：IndexedDB 在「任一请求失败」时会自动 abort 整笔事务（all-or-nothing），
  // 故无需手动 abort；worker 内部需「同步」派发所有请求，返回 Promise（如 Promise.all）。
  function runTx(db, storeName, mode, worker) {
    return new Promise(function (resolve, reject) {
      var tx, store;
      try {
        tx = db.transaction(storeName, mode);
        store = tx.objectStore(storeName);
      } catch (e) {
        reject(normalize(e, 'TX_ERROR'));
        return;
      }
      var settled = false;
      var result;
      var done = function (err, val) {
        if (settled) return;
        settled = true;
        if (err) reject(normalize(err, 'TX_ERROR'));
        else resolve(val);
      };
      // 捕获 worker 抛出的异常 / 返回的拒绝 Promise（如批量写入前校验失败）
      Promise.resolve()
        .then(function () { return worker(store, tx); })
        .then(function (r) { result = r; })
        .catch(function (e) { done(e); });
      tx.oncomplete = function () { if (!settled) done(null, result); };
      tx.onerror = function () { if (!settled) done(tx.error || new Error('transaction error')); };
      tx.onabort = function () { if (!settled) done(tx.error || new Error('transaction aborted')); };
    });
  }

  // ===== 主类 =====
  function LedgerStore(options) {
    options = options || {};
    this.dbName = options.dbName || DEFAULT_DB;
    this.storeName = options.storeName || DEFAULT_STORE;
    this.personStoreName = options.personStoreName || DEFAULT_PERSON_STORE;
    this.version = options.version || DB_VERSION;
    this.onQuotaWarning = typeof options.onQuotaWarning === 'function' ? options.onQuotaWarning : null;
    this.db = null;
    this._openPromise = null;
  }

  // 打开（或升级）数据库；幂等，重复调用返回同一 Promise
  LedgerStore.prototype.open = function () {
    var self = this;
    if (this._openPromise) return this._openPromise;
    this._openPromise = new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined' || !indexedDB) {
        reject(LedgerStoreError('当前环境不支持 IndexedDB（可能是 file:// 隐私模式或旧浏览器）', 'NO_IDB'));
        return;
      }
      var req;
      try {
        req = indexedDB.open(self.dbName, self.version);
      } catch (e) {
        reject(LedgerStoreError('打开数据库失败', 'OPEN_FAILED', e));
        return;
      }
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains(self.storeName)) {
          db.createObjectStore(self.storeName, { keyPath: 'key' });
        }
        // V050：新增人员配置表（绝不删除原有 kv 表 / 原始数据）
        if (!db.objectStoreNames.contains(self.personStoreName)) {
          db.createObjectStore(self.personStoreName, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () {
        self.db = req.result;
        // 连接被其他标签页关闭时，重置以便重连
        self.db.onversionchange = function () { try { self.db.close(); } catch (_) {} self._openPromise = null; };
        resolve(self.db);
      };
      req.onerror = function () { reject(LedgerStoreError('打开数据库失败', 'OPEN_FAILED', req.error)); };
      req.onblocked = function () { /* 等待其他连接关闭，暂不报错 */ };
    });
    return this._openPromise;
  };

  // 写入单条（存在则覆盖）。这是持久化的唯一入口，由「保存原始数据」调用。
  LedgerStore.prototype.put = function (key, value) {
    var self = this;
    if (key === null || key === undefined || key === '') {
      return Promise.reject(LedgerStoreError('key 不能为空', 'INVALID_KEY'));
    }
    return this.open().then(function (db) {
      return runTx(db, self.storeName, 'readwrite', function (store) {
        return reqPromise(store.put({ key: key, value: value, ts: Date.now() }));
      });
    }).then(function () {
      return self._checkQuota().then(function () { return true; });
    }).catch(function (e) { throw normalize(e, 'PUT_FAILED'); });
  };

  // 读取单条；不存在返回 undefined
  LedgerStore.prototype.get = function (key) {
    var self = this;
    return this.open().then(function (db) {
      return runTx(db, self.storeName, 'readonly', function (store) {
        return reqPromise(store.get(key)).then(function (row) {
          return row ? row.value : undefined;
        });
      });
    }).catch(function (e) { throw normalize(e, 'GET_FAILED'); });
  };

  // 读取全部 value（按 key 升序）
  LedgerStore.prototype.getAll = function () {
    var self = this;
    return this.open().then(function (db) {
      return runTx(db, self.storeName, 'readonly', function (store) {
        return reqPromise(store.getAll()).then(function (rows) {
          return (rows || []).map(function (r) { return r.value; });
        });
      });
    }).catch(function (e) { throw normalize(e, 'GETALL_FAILED'); });
  };

  // 读取全部 key
  LedgerStore.prototype.getAllKeys = function () {
    var self = this;
    return this.open().then(function (db) {
      return runTx(db, self.storeName, 'readonly', function (store) {
        return reqPromise(store.getAllKeys());
      });
    }).catch(function (e) { throw normalize(e, 'GETKEYS_FAILED'); });
  };

  // 删除单条
  LedgerStore.prototype.delete = function (key) {
    var self = this;
    return this.open().then(function (db) {
      return runTx(db, self.storeName, 'readwrite', function (store) {
        return reqPromise(store.delete(key));
      });
    }).then(function () { return true; }).catch(function (e) { throw normalize(e, 'DELETE_FAILED'); });
  };

  // 清空整个 store（事务内完成）
  LedgerStore.prototype.clear = function () {
    var self = this;
    return this.open().then(function (db) {
      return runTx(db, self.storeName, 'readwrite', function (store) {
        return reqPromise(store.clear());
      });
    }).then(function () { return true; }).catch(function (e) { throw normalize(e, 'CLEAR_FAILED'); });
  };

  // 批量写入（原子：任一失败则整批回滚）。items: [{key,value}] 或 [[key,value]]
  // 先整体校验 key，校验失败在派发任何 IDB 请求之前抛出，确保不会留下部分写入。
  LedgerStore.prototype.bulkPut = function (items) {
    var self = this;
    if (!Array.isArray(items)) return Promise.reject(LedgerStoreError('bulkPut 参数必须为数组', 'INVALID_ARG'));
    for (var i = 0; i < items.length; i++) {
      var ck = Array.isArray(items[i]) ? items[i][0] : items[i].key;
      if (ck === null || ck === undefined || ck === '') {
        return Promise.reject(LedgerStoreError('bulkPut 中存在空 key', 'INVALID_KEY'));
      }
    }
    return this.open().then(function (db) {
      return runTx(db, self.storeName, 'readwrite', function (store) {
        var ps = items.map(function (it) {
          var k = Array.isArray(it) ? it[0] : it.key;
          var v = Array.isArray(it) ? it[1] : it.value;
          return reqPromise(store.put({ key: k, value: v, ts: Date.now() }));
        });
        return Promise.all(ps).then(function () { return items.length; });
      });
    }).then(function (n) {
      return self._checkQuota().then(function () { return n; });
    }).catch(function (e) { throw normalize(e, 'BULK_FAILED'); });
  };

  // ===== 元数据（schemaVersion / 最近保存时间）=====
  LedgerStore.prototype.setMeta = function (obj) {
    return this.get(KEY_META).then(function (cur) {
      var m = (cur && typeof cur === 'object') ? cur : {};
      for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) m[k] = obj[k];
      return this.put(KEY_META, m);
    }.bind(this));
  };
  LedgerStore.prototype.getMeta = function () {
    return this.get(KEY_META).then(function (m) {
      return (m && typeof m === 'object') ? m : {};
    });
  };

  // ===== 容量管理 =====
  // 返回 { usage, quota, ratio } 或 null（环境不支持）
  LedgerStore.prototype.getUsage = function () {
    var nav = (typeof navigator !== 'undefined') ? navigator : null;
    if (!nav || !nav.storage || typeof nav.storage.estimate !== 'function') {
      return Promise.resolve(null);
    }
    return nav.storage.estimate().then(function (est) {
      var usage = est.usage || 0;
      var quota = est.quota || 0;
      return { usage: usage, quota: quota, ratio: quota ? usage / quota : 0 };
    }).catch(function () { return null; });
  };

  // 写入后检测配额，超过阈值触发告警回调
  LedgerStore.prototype._checkQuota = function () {
    var self = this;
    return this.getUsage().then(function (u) {
      if (u && u.quota && u.ratio >= USAGE_WARN_RATIO && typeof self.onQuotaWarning === 'function') {
        try { self.onQuotaWarning(u.ratio, u.usage, u.quota); } catch (_) {}
      }
      return u;
    });
  };

  // 是否存在已保存的「原始数据」
  LedgerStore.prototype.hasOriginal = function () {
    return this.get(KEY_ORIGINAL).then(function (v) { return v !== undefined && v !== null; });
  };

  // 保存「原始数据」快照（唯一持久化写入入口）
  // payload: { schemaVersion, savedAt, records, incomeTransfers }
  LedgerStore.prototype.saveOriginal = function (payload) {
    if (!payload || typeof payload !== 'object') return Promise.reject(LedgerStoreError('saveOriginal 参数无效', 'INVALID_ARG'));
    payload.schemaVersion = SCHEMA_VERSION;
    payload.savedAt = Date.now();
    var self = this;
    return this.put(KEY_ORIGINAL, payload).then(function () {
      return self.setMeta({ schemaVersion: SCHEMA_VERSION, lastSavedAt: payload.savedAt, count: (payload.records || []).length });
    }).then(function () { return true; });
  };

  // 读取「原始数据」快照；返回 payload 或 null
  LedgerStore.prototype.loadOriginal = function () {
    return this.get(KEY_ORIGINAL).then(function (v) {
      if (!v) return null;
      if (v.schemaVersion && v.schemaVersion !== SCHEMA_VERSION) {
        // schema 不匹配：保留数据但给出提示（由调用方决定是否迁移）
        v._schemaMismatch = true;
      }
      return v;
    });
  };

  LedgerStore.prototype.clearOriginal = function () {
    return this.delete(KEY_ORIGINAL);
  };

  LedgerStore.prototype.close = function () {
    if (this.db) { try { this.db.close(); } catch (_) {} this.db = null; }
    this._openPromise = null;
    return Promise.resolve(true);
  };

  // ===== 人员配置表（personList）=====
  // 单条人员结构：{ id, name, color, createTime }
  // 读取全部人员（按 createTime 升序）
  LedgerStore.prototype.getPersons = function () {
    var self = this;
    return this.open().then(function (db) {
      return runTx(db, self.personStoreName, 'readonly', function (store) {
        return reqPromise(store.getAll()).then(function (rows) {
          (rows || []).sort(function (a, b) { return (a.createTime || 0) - (b.createTime || 0); });
          return rows || [];
        });
      });
    }).catch(function (e) { throw normalize(e, 'GETPERSONS_FAILED'); });
  };

  // 写入 / 更新单条人员
  LedgerStore.prototype.putPerson = function (person) {
    var self = this;
    if (!person || !person.id) return Promise.reject(LedgerStoreError('人员 id 不能为空', 'INVALID_KEY'));
    return this.open().then(function (db) {
      return runTx(db, self.personStoreName, 'readwrite', function (store) {
        return reqPromise(store.put(Object.assign({ createTime: Date.now() }, person)));
      });
    }).then(function () { return true; }).catch(function (e) { throw normalize(e, 'PUTPERSON_FAILED'); });
  };

  // 删除单条人员
  LedgerStore.prototype.deletePerson = function (id) {
    var self = this;
    return this.open().then(function (db) {
      return runTx(db, self.personStoreName, 'readwrite', function (store) {
        return reqPromise(store.delete(id));
      });
    }).then(function () { return true; }).catch(function (e) { throw normalize(e, 'DELPERSON_FAILED'); });
  };

  // 批量写入人员（原子）
  LedgerStore.prototype.savePersons = function (arr) {
    var self = this;
    if (!Array.isArray(arr)) return Promise.reject(LedgerStoreError('savePersons 参数必须为数组', 'INVALID_ARG'));
    var items = arr.map(function (p) { return [p.id, p]; });
    return this.open().then(function (db) {
      return runTx(db, self.personStoreName, 'readwrite', function (store) {
        var ps = items.map(function (it) {
          return reqPromise(store.put(Object.assign({ createTime: Date.now() }, it[1])));
        });
        return Promise.all(ps).then(function () { return items.length; });
      });
    }).then(function (n) { return n; }).catch(function (e) { throw normalize(e, 'SAVEPERSONS_FAILED'); });
  };

  // 清空人员表（谨慎使用）
  LedgerStore.prototype.clearPersons = function () {
    var self = this;
    return this.open().then(function (db) {
      return runTx(db, self.personStoreName, 'readwrite', function (store) {
        return reqPromise(store.clear());
      });
    }).then(function () { return true; }).catch(function (e) { throw normalize(e, 'CLEARPERSONS_FAILED'); });
  };

  // 暴露常量与错误类型，便于调用方判断
  LedgerStore.KEY_ORIGINAL = KEY_ORIGINAL;
  LedgerStore.KEY_META = KEY_META;
  LedgerStore.SCHEMA_VERSION = SCHEMA_VERSION;
  LedgerStore.Error = LedgerStoreError;

  return LedgerStore;
});
