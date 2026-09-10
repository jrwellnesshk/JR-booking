#!/usr/bin/env bash
# =============================================================================
#  backup-to-s3.sh — SQLite 一致性備份 → gzip → 上傳 S3
#  執行位置：EC2 實例（用 IAM Role，唔用 Access Key）
#  用法：./backup-to-s3.sh          （cron 每日 03:30 跑）
#
#  前置：
#    - EC2 已掛 aurora-backup-role（只准 s3:PutObject 去指定 bucket）
#    - sudo apt install -y awscli
#    - sudo mkdir -p /var/backups/aurora && sudo chown ubuntu:ubuntu /var/backups/aurora
#
#  環境變數（可覆寫）：
#    S3_BUCKET      S3 bucket 名（必填）
#    S3_PREFIX      S3 路徑前綴（預設 aurora）
#    APP_DIR        專案目錄（預設 /home/ubuntu/aurora）
#    LOCAL_DIR      本地暫存（預設 /var/backups/aurora）
#    KEEP_DAYS      本地保留日數（預設 7）
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/aurora}"
LOCAL_DIR="${LOCAL_DIR:-/var/backups/aurora}"
S3_BUCKET="${S3_BUCKET:-}"
S3_PREFIX="${S3_PREFIX:-aurora}"
KEEP_DAYS="${KEEP_DAYS:-7}"
STAMP="$(date +%F_%H%M)"
AWS_BIN="$(command -v aws || echo /usr/bin/aws)"

log()  { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
fail() { printf '[%s] ❌ %s\n' "$(date '+%F %T')" "$*" >&2; exit 1; }

[[ -n "${S3_BUCKET}" ]] || fail "未設 S3_BUCKET（例：export S3_BUCKET=aurora-backups-yourname）"
[[ -x "${AWS_BIN}" ]]   || fail "搵唔到 aws CLI：sudo apt install -y awscli"
[[ -f "${APP_DIR}/data/database.db" ]] || fail "搵唔到 ${APP_DIR}/data/database.db"

mkdir -p "${LOCAL_DIR}"
DB="${APP_DIR}/data/database.db"
TMP_DB="${LOCAL_DIR}/aurora-db-${STAMP}.db"
OUT="${TMP_DB}.gz"

log "開始備份：${DB}"

# ── 1) 一致性備份 ────────────────────────────────────────────────────────────
# ⚠️ 一定要用 sqlite3 .backup 而唔係 cp：系統寫緊嘅時候 cp 會出損壞嘅備份。
#    .backup 用 SQLite 自己嘅 online backup API，唔使停機都拎到一致快照。
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "${DB}" ".backup '${TMP_DB}'"
elif docker compose --version >/dev/null 2>&1 && [[ -f "${APP_DIR}/docker-compose.yml" ]]; then
  # 伺服器冇 sqlite3 時，用 Caddy image 入面嗰個（alpine 有 sqlite3）
  docker run --rm -v "${APP_DIR}/data:/data" -v "${LOCAL_DIR}:/out" alpine:3.20 \
    sh -c "apk add --no-cache sqlite >/dev/null 2>&1 && sqlite3 /data/database.db \".backup '/out/$(basename "${TMP_DB}")'\""
else
  fail "冇 sqlite3 又冇 docker，做唔到一致性備份（唔會退改用 cp，寧願失敗）"
fi

[[ -s "${TMP_DB}" ]] || fail "備份檔係空的：${TMP_DB}"
log "一致性備份完成：$(du -h "${TMP_DB}" | cut -f1)"

# ── 2) 壓縮 ─────────────────────────────────────────────────────────────────
gzip -f "${TMP_DB}"
[[ -s "${OUT}" ]] || fail "壓縮失敗：${OUT}"
log "已壓縮：${OUT}（$(du -h "${OUT}" | cut -f1)）"

# ── 3) 上傳 S3（用 IAM Role 臨時憑證）────────────────────────────────────────
"${AWS_BIN}" s3 cp "${OUT}" "s3://${S3_BUCKET}/${S3_PREFIX}/$(basename "${OUT}")" \
  --storage-class STANDARD_IA
log "已上傳：s3://${S3_BUCKET}/${S3_PREFIX}/$(basename "${OUT}")"

# ── 4) 核對（唔好淨係信上傳冇報錯）──────────────────────────────────────────
REMOTE_SIZE="$("${AWS_BIN}" s3api head-object \
  --bucket "${S3_BUCKET}" \
  --key "${S3_PREFIX}/$(basename "${OUT}")" \
  --query ContentLength --output text 2>/dev/null || echo 0)"
LOCAL_SIZE="$(stat -c %s "${OUT}")"
if [[ "${REMOTE_SIZE}" != "${LOCAL_SIZE}" ]]; then
  fail "size 唔夾：本地 ${LOCAL_SIZE} vs S3 ${REMOTE_SIZE}"
fi
log "核對 OK：${LOCAL_SIZE} bytes"

# ── 5) 清理本地舊檔（只清自己寫嘅 pattern）──────────────────────────────────
find "${LOCAL_DIR}" -maxdepth 1 -name 'aurora-db-*.db.gz' -type f -mtime "+${KEEP_DAYS}" -delete
log "已清理 ${KEEP_DAYS} 日前嘅本地備份"

log "✅ 備份完成"
