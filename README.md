# 记账本 V055（手机版）

微信 / 支付宝账单归集记账本。纯前端、本地存储、完全离线、**开源免费**（MIT）。

数据全部存在你自己的设备（浏览器 IndexedDB 或 APP 本地），**不上传任何服务器**。

## 功能

- 导入微信支付 / 支付宝导出的 CSV（或 xlsx）账单 → 自动识别、归并、分类
- 手动记账（选成员 + 填条目）
- 月度 / 年度统计切换、分类占比、支出排行、结余卡片
- 一键导出 CSV
- 响应式布局，手机 / 桌面都可用

## 两种使用方式

### 1. 网页版（PWA）

直接用浏览器打开：**https://healcat.github.io/ledger-v055/**

- **手机**：用 Safari（iOS）/ Chrome（安卓）打开 → 点「分享」→「添加到主屏幕」，即可像 App 一样全屏、离线使用
- **桌面**：Chrome / Edge / Firefox 直接打开即可
- 首屏联网加载后，Service Worker 缓存资源，之后断网也能打开

### 2. 安卓 APP（APK）

从 GitHub Releases 下载最新 APK 安装：
**https://github.com/Healcat/ledger-v055/releases/tag/latest-build**

- 下载 `app-release-unsigned.apk`（或仓库配置了签名密钥后的 `app-release.apk`）
- 安卓允许「未知来源」安装即可使用
- 数据存在 APP 本地（WebView IndexedDB），与网页版相互独立

## 本地构建

### 网页（自包含单文件）

```bash
node merge_v055.js     # 生成 记账本_fitWMV055.html（已内联所有 JS/CSS）
```

生成的单文件可直接双击用浏览器打开，或部署到任意静态托管 / GitHub Pages。

### 安卓 APP

```bash
npm install
npx cap add android          # 生成原生工程（仅需一次）
npx cap sync android         # 同步网页资源进安卓工程
cd android && ./gradlew assembleRelease
```

产物在 `android/app/build/outputs/apk/release/`。

> **自动构建**：本仓库的 GitHub Actions 会在每次 push 时自动构建 APK，并发布到 `latest-build` Release，无需本地安装 Android SDK。
>
> 如需**签名发布版**（去掉「未知来源」警告、可上架商店），在仓库 `Settings → Secrets` 配置：
> - `ANDROID_SIGNING_KEY`：keystore 的 base64（`base64 -w0 ledger.keystore`）
> - `KEY_ALIAS`、`KEY_STORE_PASSWORD`、`KEY_PASSWORD`
>
> 生成 keystore：
> ```bash
> keytool -genkey -v -keystore ledger.keystore -alias ledger \
>   -keyalg RSA -keysize 2048 -validity 10000
> ```

## 目录结构

```
index.html             网页源（PWA 入口，引用 storage.js / xlsx.core.min.js）
storage.js             IndexedDB 持久化层
xlsx.core.min.js       xlsx 解析
merge_v055.js          合并成自包含单文件 记账本_fitWMV055.html
manifest.webmanifest   PWA 清单
sw.js                  Service Worker（离线缓存）
icon-*.png             图标（含自适应图标）
capacitor.config.json  Capacitor 配置（appId = io.github.healcat.ledger）
.github/workflows/     GitHub Actions 自动构建安卓 APK
```

## 开源协议

[MIT](LICENSE) —— 可自由使用、修改、分发。
