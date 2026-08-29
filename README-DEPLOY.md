# 部署指南（寶天醫館預約系統）

## 架構
瀏覽器 → Caddy (TLS, 443) → app 容器 (Node, :4000) → SQLite 檔 (volume)

> **現階段決定：SQLite 先上。** 單一診所、低併發（每日幾十單），SQLite 完全夠用，唔使 PG refactor 推遲上線。PG 留返開第 2 間分店 / 高寫入量時再做（見文末遷移計劃）。`.dockerignore` 已確保 `.env` / `database.db` 唔會焗入 image。

## Prerequisites
- VPS（1 vCPU / 1GB 起，建議 2GB）或 AWS Lightsail
- Docker + Docker Compose
- 網域（A 記錄指向 VPS IP）
- Cloudflare 帳戶（Proxy + DNS-01 證書，可唔開 80 port）

## 步驟（VPS 一開就貼）

```bash
# 1. 攞 code（已經喺 VPS 嘅話跳過）
git clone <repo> aurora && cd aurora

# 2. 生產 .env（範本已經喺 .env.example）
cp .env.example .env

# 3. 填必要值（SESSION_SECRET 必須；ADMIN_PASSWORD 建議設強密碼）
#    SESSION_SECRET 生成一條：
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
#    EMAIL_* / TWILIO_* / STRIPE_* 暫時開唔到就留空（功能自動停用，唔會報錯）
#    ⚠️ 生產 .env 千祈唔好留 CAPTCHA_TEST_BYPASS（test999 後門）一行

# 4. 首次部署前：確保 host 冇 data/ 目錄（有就刪，app 會新建 DB 並用 ADMIN_PASSWORD 建 admin）
rm -rf data

# 5. 起容器（build + 後台跑）
docker compose up -d --build

# 6. 睇初始 admin 密碼（若 .env 冇 ADMIN_PASSWORD，會隨機生成印出）
docker compose logs app | grep -i "admin"

# 7. 開瀏覽器登入，即刻改密碼
#    https://你的網域/admin.html
```

> 未買網域 / 未設 Cloudflare 都可以先 staging：將 `.env` 加 `SITE_DOMAIN=localhost`，
> 直接 `http://<VPS_IP>/` 試（Caddy 對 localhost 自動行 HTTP，唔使證書）。

## 之後（買咗網域 + Cloudflare）
1. `.env` 設 `SITE_DOMAIN=booking.yourdomain.com`，Caddyfile `email` 改做你嘅 admin email
2. Cloudflare 開 Proxy，DNS A → VPS IP；「總是 HTTPS」+ WAF 基本規則
3. `docker compose up -d` 生效（Caddy 自動拎 Let's Encrypt 證書）

## 安全清單
- [ ] SESSION_SECRET 已設（生產冇設會直接拒絕啟動）
- [ ] CAPTCHA_TEST_BYPASS 已刪（否則 test999 變後門）
- [ ] ADMIN_PASSWORD / 初始 admin 密碼已改
- [ ] .env / database.db 唔喺 git
- [ ] Cloudflare 開「總是 HTTPS」+ WAF
- [ ] 定期備份 database.db（volume）

## 轉 PostgreSQL（開第 2 間分店 / 高寫入量時）
現時 code 用 SQLite（`config/db.js` + routes 用 `?` placeholder）。轉 PG 需要：
1. 引進 `pg` driver，按 `DATABASE_URL` 決定用 SQLite 定 PG
2. 全部 SQL `?` → `$1, $2 ...`
3. 改 DDL（SERIAL / `RETURNING id` / 時間函數 / `ON CONFLICT`）
4. .env 設 `DATABASE_URL`，docker-compose 加 postgres 服務並移除 ./data volume
呢步係一次獨立 refactor，請見專門任務（需喺有 Postgres 實例下測試）。
