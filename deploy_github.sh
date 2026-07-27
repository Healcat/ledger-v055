#!/usr/bin/env bash
# 一键部署记账本 V055 手机版（PWA）到 GitHub Pages（免费）
# 特点：token 自动从本机 git 凭据库读取（无需手动粘贴），GitHub Pages 支持 API 自动开启

REPO="ledger-v055"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 从 V055 文件夹就地构建部署暂存区：单文件版重命名为 index.html（GitHub Pages 只认 index.html），
# 并带上 sw.js / manifest / 图标（PWA 安装必需）
STAGE="$SCRIPT_DIR/.deploy_stage"
rm -rf "$STAGE"; mkdir -p "$STAGE"
cp "$SCRIPT_DIR/记账本_fitWMV055.html" "$STAGE/index.html"
cp "$SCRIPT_DIR/sw.js" "$STAGE/sw.js"
cp "$SCRIPT_DIR/manifest.webmanifest" "$STAGE/manifest.webmanifest"
cp "$SCRIPT_DIR/xlsx.core.min.js" "$STAGE/xlsx.core.min.js"
cp "$SCRIPT_DIR/icon-192.png" "$STAGE/icon-192.png"
cp "$SCRIPT_DIR/icon-512.png" "$STAGE/icon-512.png"
cp "$SCRIPT_DIR/icon-maskable-512.png" "$STAGE/icon-maskable-512.png"
DEPLOY_DIR="$STAGE"

# 1) 从本机凭据库取 GitHub PAT（不打印明文），去除可能的 CR
CRED=$(printf 'protocol=https\nhost=github.com\n' | git credential fill)
TOKEN=$(printf '%s' "$CRED" | tr -d '\r' | sed -n 's/^password=//p')
LOGIN=$(curl -s -H "Authorization: token $TOKEN" https://api.github.com/user | grep -o '"login"[ ]*:[ ]*"[^"]*"' | sed 's/.*:[ ]*"//;s/"//')
echo "GitHub 账号: $LOGIN"

# 2) 建公开仓库（已存在则忽略 422）
echo "=== 创建仓库 $LOGIN/$REPO ==="
curl -s -o /dev/null -w "create HTTP:%{http_code}\n" -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -X POST https://api.github.com/user/repos -d '{"name":"ledger-v055","private":false,"auto_init":false,"description":"Ledger V055 mobile PWA (installable)"}' || true

# 3) 推送单文件版
cd "$DEPLOY_DIR"
rm -rf .git
git init -q
git config user.name "Healcat"
git config user.email "904956292@qq.com"
git add -A
git commit -q -m "deploy ledger V055 $(date +%Y%m%d%H%M)"
git branch -M master
echo "=== 推送到 GitHub ==="
git remote add origin "https://x-access-token:$TOKEN@github.com/$LOGIN/$REPO.git"
git push -u origin master -f 2>&1 | tail -5

# 4) 开启 GitHub Pages（API 直接开，无需手动）
echo "=== 开启 GitHub Pages ==="
curl -s -w "\nenable HTTP:%{http_code}\n" -X POST \
  -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  "https://api.github.com/repos/$LOGIN/$REPO/pages" \
  -d '{"source":{"branch":"master","path":"/"}}' | head -c 400 || true

echo ""
echo "=== 最终访问地址 ==="
echo "https://$LOGIN.github.io/$REPO/"
