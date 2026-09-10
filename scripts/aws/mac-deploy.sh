#!/usr/bin/env bash
# =============================================================================
#  mac-deploy.sh — 由 Mac 一鍵部署 booking-aurora 去 EC2
#  執行位置：Mac（喺專案根目錄跑）
#
#  用法：
#    ./scripts/aws/mac-deploy.sh                # 乾跑（rsync -n，唔會改任何嘢）
#    ./scripts/aws/mac-deploy.sh --go           # 真正部署
#    ./scripts/aws/mac-deploy.sh --go --env     # 連 .env.production 一齊傳
#    ./scripts/aws/mac-deploy.sh --go --build   # 強制 docker build（改咗 Dockerfile / package.json）
#
#  環境變數 / 參數：
#    AURORA_HOST   遠端主機（預設讀 ~/.ssh/config 嘅 Host aurora，否則用 AURORA_IP）
#    AURORA_IP     Elastic IP（AURORA_HOST 冇設時用）
#    AURORA_USER   遠端用戶（預設 ubuntu）
#    AURORA_KEY    SSH 私鑰（預設 ~/.ssh/aurora-aws.pem）
#    AURORA_DIR    遠端目錄（預設 /home/ubuntu/aurora）
#
#  ⚠️ 安全設計：
#    - 預設係 dry-run，一定要加 --go 先會郁
#    - rsync --delete 會先列出會被剷嘅檔，要你打 yes 確認
#    - 永遠唔傳 .env（除非 --env）、database.db、node_modules
# =============================================================================
set -euo pipefail

MODE="dry"
DO_ENV=0
DO_BUILD=0

for arg in "$@"; do
  case "$arg" in
    --go)     MODE="go" ;;
    --env)    DO_ENV=1 ;;
    --build)  DO_BUILD=1 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "未知參數：$arg（用 --help 睇用法）" >&2; exit 1 ;;
  esac
done

AURORA_HOST="${AURORA_HOST:-aurora}"
AURORA_USER="${AURORA_USER:-ubuntu}"
AURORA_KEY="${AURORA_KEY:-$HOME/.ssh/aurora-aws.pem}"
AURORA_DIR="${AURORA_DIR:-/home/ubuntu/aurora}"
AURORA_IP="${AURORA_IP:-}"

# 冇 ~/.ssh/config 嘅話，用 IP + key
TARGET="${AURORA_HOST}"
SSH_CMD=(ssh)
if [[ -n "${AURORA_IP}" || ! -f "$HOME/.ssh/config" ]] || ! grep -q "Host ${AURORA_HOST}" "$HOME/.ssh/config" 2>/dev/null; then
  [[ -n "${AURORA_IP}" ]] || { echo "❌ 未設 AURORA_IP，又搵唔到 ~/.ssh/config 嘅 Host ${AURORA_HOST}" >&2; exit 1; }
  [[ -f "${AURORA_KEY}" ]] || { echo "❌ 搵唔到 SSH key：${AURORA_KEY}" >&2; exit 1; }
  TARGET="${AURORA_USER}@${AURORA_IP}"
  SSH_CMD=(ssh -i "${AURORA_KEY}")
fi

RSYNC_RSH="${SSH_CMD[*]}"

RSYNC_OPTS=(
  -avz --delete
  --exclude 'node_modules'
  --exclude '.git'
  --exclude '.env'
  --exclude 'database.db' --exclude 'database.db-shm' --exclude 'database.db-wal'
  --exclude 'scenario.db' --exclude 'scenario.db-shm' --exclude 'scenario.db-wal'
  --exclude 'logs'
  --exclude 'promo-videos' --exclude 'presentation' --exclude 'design'
  --exclude '_*.html' --exclude '_*.cjs' --exclude '_*.js' --exclude '_*.txt' --exclude '_*.png'
)

echo "════════════════════════════════════════════"
echo " 目標：${TARGET}:${AURORA_DIR}"
echo " 模式：${MODE}（dry = 淨係列出會改啲乜，唔會郁）"
echo " 傳 .env：$( [[ $DO_ENV -eq 1 ]] && echo 會 || echo 唔會 )"
echo " docker build：$( [[ $DO_BUILD -eq 1 ]] && echo 會 || echo 唔會（用 --build 開） )"
echo "════════════════════════════════════════════"

# ── 0) 本地檢查 ─────────────────────────────────────────────────────────────
command -v rsync >/dev/null || { echo "❌ 搵唔到 rsync" >&2; exit 1; }
for f in Dockerfile docker-compose.yml server.js package.json; do
  [[ -f "$f" ]] || { echo "❌ 唔係專案根目錄（搵唔到 $f）" >&2; exit 1; }
done

if [[ $DO_ENV -eq 1 && $MODE == "go" ]]; then
  [[ -f .env.production ]] || { echo "❌ 搵唔到 .env.production" >&2; exit 1; }
  if grep -q 'CAPTCHA_TEST_BYPASS' .env.production; then
    echo "❌ .env.production 仲有 CAPTCHA_TEST_BYPASS（後門），唔准上生產" >&2
    exit 1
  fi
fi

# ── 1) 傳 .env（可選）───────────────────────────────────────────────────────
if [[ $DO_ENV -eq 1 ]]; then
  echo ""
  echo "▶ 傳 .env.production → ${TARGET}:${AURORA_DIR}/.env"
  if [[ $MODE == "go" ]]; then
    rsync -avz -e "$RSYNC_RSH" .env.production "${TARGET}:${AURORA_DIR}/.env"
    "${SSH_CMD[@]}" "${TARGET}" "chmod 600 ${AURORA_DIR}/.env && stat -c '%a %n' ${AURORA_DIR}/.env"
  else
    echo "  [dry-run] 會傳 .env.production 並 chmod 600"
  fi
fi

# ── 2) rsync 程式碼 ─────────────────────────────────────────────────────────
echo ""
echo "▶ 同步程式碼"
if [[ $MODE == "go" ]]; then
  echo "  ⚠️ --delete 會剷走伺服器上多出嘅檔案。以下係預覽："
  rsync "${RSYNC_OPTS[@]}" --dry-run -e "$RSYNC_RSH" ./ "${TARGET}:${AURORA_DIR}/" \
    | grep -E '^deleting' | head -20 || echo "  （冇檔案會被剷）"
  echo ""
  read -r -p "  確認繼續？(yes/no) " ans
  [[ "$ans" == "yes" ]] || { echo "已取消"; exit 0; }

  rsync "${RSYNC_OPTS[@]}" -e "$RSYNC_RSH" ./ "${TARGET}:${AURORA_DIR}/"
else
  rsync "${RSYNC_OPTS[@]}" --dry-run -e "$RSYNC_RSH" ./ "${TARGET}:${AURORA_DIR}/"
  echo ""
  echo "  ↑ 上面係 dry-run 結果。確認冇問題就加 --go 再跑一次。"
fi

# ── 3) 遠端重啟 + 健康檢查 ──────────────────────────────────────────────────
if [[ $MODE == "go" ]]; then
  echo ""
  echo "▶ 遠端重啟容器"
  if [[ $DO_BUILD -eq 1 ]]; then
    "${SSH_CMD[@]}" "${TARGET}" "cd ${AURORA_DIR} && docker compose up -d --build"
  else
    "${SSH_CMD[@]}" "${TARGET}" "cd ${AURORA_DIR} && docker compose up -d"
  fi

  echo ""
  echo "▶ 等 20 秒再做健康檢查"
  sleep 20
  "${SSH_CMD[@]}" "${TARGET}" "cd ${AURORA_DIR} && docker compose ps && \
    echo '--- health ---' && \
    curl -s -o /dev/null -w 'health=%{http_code}\n' http://127.0.0.1/health && \
    curl -s -o /dev/null -w 'ready=%{http_code}\n'  http://127.0.0.1/health/ready"

  echo ""
  echo "✅ 部署完成。記低本次版本："
  git rev-parse --short HEAD 2>/dev/null || echo "  （唔係 git repo，請自己記低版本）"
fi
