#!/bin/bash
# 一键部署记账本 V055 手机版（PWA）到 Gitee Pages（免费，国内访问快）
# 用法: GITEE_TOKEN=你的私人令牌 ./deploy_gitee.sh
# 注意：Gitee 免费版「开启 Pages」不开放 API，需登录网页手动点一次（见末尾说明）。
set -e

TOKEN="${GITEE_TOKEN:-$1}"
if [ -z "$TOKEN" ]; then
  echo "用法: GITEE_TOKEN=你的私人令牌 ./deploy_gitee.sh"
  exit 1
fi

REPO="ledger-v055"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$SCRIPT_DIR/deploy_cloud"

echo "== 1. 获取 Gitee 用户名 =="
USER=$(curl -s "https://gitee.com/api/v5/user?access_token=$TOKEN" | grep -o '"login":"[^"]*"' | head -1 | sed 's/"login":"//;s/"//')
if [ -z "$USER" ]; then
  echo "❌ 无法获取用户名，token 可能无效或无 network 访问"
  exit 1
fi
echo "用户名: $USER"

echo "== 2. 创建仓库 (若已存在则忽略报错) =="
# 注意：Gitee 创建仓库必须把 access_token 放进请求体，放 query 会 400
curl -s -X POST "https://gitee.com/api/v5/user/repos" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$REPO\",\"access_token\":\"$TOKEN\",\"private\":false,\"description\":\"个人记账本 V055 手机版 PWA\",\"auto_init\":false}" >/dev/null
echo "仓库步骤完成 (已存在则跳过)"

echo "== 3. 设为公开 (Gitee Pages 免费版要求公开仓库) =="
# 注意：PATCH 必须带 name 字段，否则报 'name is missing'
curl -s -X PATCH "https://gitee.com/api/v5/repos/$USER/$REPO?access_token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$REPO\",\"private\":false}" >/dev/null
echo "可见性已设为公开"

echo "== 4. 构建部署目录并推送 =="
rm -rf "$DEPLOY_DIR"; mkdir -p "$DEPLOY_DIR"
cp "$SCRIPT_DIR/记账本_fitWMV055.html" "$DEPLOY_DIR/index.html"
cp "$SCRIPT_DIR/sw.js" "$DEPLOY_DIR/sw.js"
cp "$SCRIPT_DIR/manifest.webmanifest" "$DEPLOY_DIR/manifest.webmanifest"
cp "$SCRIPT_DIR/icon-192.png" "$DEPLOY_DIR/icon-192.png"
cp "$SCRIPT_DIR/icon-512.png" "$DEPLOY_DIR/icon-512.png"
cp "$SCRIPT_DIR/icon-maskable-512.png" "$DEPLOY_DIR/icon-maskable-512.png"
cd "$DEPLOY_DIR"
rm -rf .git
git init -q
git config user.name "HBACC"
git config user.email "904956292@qq.com"
git add -A
git commit -q -m "部署记账本 V055 $(date +%Y%m%d%H%M)"
git remote remove origin 2>/dev/null || true
git remote add origin "https://$USER:$TOKEN@gitee.com/$USER/$REPO.git"
git branch -M master
GIT_TERMINAL_PROMPT=0 git -c credential.helper= push -u origin master -f
echo "推送完成"

echo ""
echo "✅ 代码已上线: https://gitee.com/$USER/$REPO"
echo ""
echo "== 5. 手动开启 Gitee Pages（API 不支持，必须网页操作）=="
echo "   ① 浏览器打开 https://gitee.com/$USER/$REPO"
echo "   ② 上方「服务」→「Gitee Pages」"
echo "   ③ 若提示「未实名」，先去 设置→账号→实名认证（绑定手机）"
echo "   ④ 部署分支选 master，部署目录选 /(根)，勾选「强制 HTTPS」→ 点「启动」"
echo "   ⑤ 等待 1~2 分钟，访问: https://$USER.gitee.io/$REPO/"
echo ""
echo "   💡 以后更新只需重跑本脚本，再到 Pages 页面点「更新」即可"
