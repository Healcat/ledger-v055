// 将 V055 合并为单文件：把外部 storage.js 内联进 HTML，输出 记账本_fitWMV055.html（完全自包含）
// 命名约定（用户指定）：自包含单文件 = 记账本_fitWMV055.html；依赖 storage.js 的版本 = index.html
const fs = require('fs');
const path = require('path');
const dir = __dirname;   // 跨平台：脚本所在目录（CI=仓库根，本地 Windows 同目录），不再写死绝对路径
const htmlPath = dir + '/index.html';            // 依赖版（含 <script src="storage.js">）
const storagePath = dir + '/storage.js';
const outPath = dir + '/记账本_fitWMV055.html';  // 输出：自包含单文件

let html = fs.readFileSync(htmlPath, 'utf8');
const storage = fs.readFileSync(storagePath, 'utf8');

// 读取本地 SheetJS（优先 V055 根目录，其次 tests/node_modules），内联进单文件以实现离线解析 xlsx
const xlsxCandidates = [dir + '/xlsx.core.min.js', dir + '/tests/node_modules/xlsx/dist/xlsx.core.min.js'];
let xlsxPath = null;
for (var i = 0; i < xlsxCandidates.length; i++) { if (fs.existsSync(xlsxCandidates[i])) { xlsxPath = xlsxCandidates[i]; break; } }
if (!xlsxPath) { console.error('未找到 xlsx.core.min.js，无法离线内联 xlsx'); process.exit(1); }
const xlsxSrc = fs.readFileSync(xlsxPath, 'utf8');
if (xlsxSrc.includes('</script')) { console.error('xlsx 内含 </script>，内联会截断，已中止'); process.exit(1); }

const tag = '<script src="storage.js"></script>';
if (!html.includes(tag)) { console.error('未找到 <script src="storage.js"> 标签，可能已合并或路径变化'); process.exit(1); }
if (storage.includes('</script')) { console.error('storage.js 内含 </script>，内联会截断，已中止'); process.exit(1); }
if (storage.includes('<!DOCTYPE')) { console.error('storage.js 疑似 HTML，已中止'); process.exit(1); }

const xlsxInline =
  '<script>/* ===== SheetJS(xlsx) 内联：离线解析 .xlsx，无需联网/CDN（国内 jsdelivr 常被墙） ===== */\n'
  + xlsxSrc + '\n</script>\n';
const storageInline =
  '<script>/* ===== storage.js 内联（本地缓存层 IndexedDB 轻量封装；原独立文件已合并为单文件，无需外部依赖） ===== */\n'
  + storage + '\n</script>';

// 用函数式替换：内联的 xlsx/storage 源码里含 $& / $$ 等序列，字符串式 replace 会误当作特殊替换符，
// 导致把被替换的 <script src="storage.js"> 标签重新插回输出。函数返回值不做 $ 转义，彻底规避。
html = html.replace(tag, function () { return xlsxInline + storageInline; });

// 防御：不应再出现任何外部 storage.js 引用
if (html.includes('src="storage.js"')) { console.error('替换后仍存在外部 storage.js 引用，异常！'); process.exit(1); }

fs.writeFileSync(outPath, html, 'utf8');
console.log('OK 已生成单文件:', outPath);
console.log('  总字节数:', Buffer.byteLength(html),
  '| 内联 storage.js:', Buffer.byteLength(storage),
  '| 内联 xlsx:', Buffer.byteLength(xlsxSrc));
console.log('  仍含外部 storage.js 引用:', html.includes('src="storage.js"'));
console.log('  内联 LedgerStore 定义存在:', html.includes('function LedgerStore(options)'));
console.log('  内联 XLSX 定义存在:', html.includes('var XLSX={}'));
console.log('  含独立库名 ledger-cache-v055:', html.includes('ledger-cache-v055'));
console.log('  含 V055 版本号:', html.includes("VERSION = 'V055'"));
