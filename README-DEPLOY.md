# 部署指南（寶天醫館預約系統）

## 架構
瀏覽器 → Caddy (TLS, 443) → app 容器 (Node, :4000) → SQLite 檔 (volume)

## Prerequisites
- VPS（1 vCPU / 1GB 起，建議 2GB）或 AWS Lightsail
- Docker + Docker Compose
- 網域（A 記錄指向 VPS IP）
- Cloudflare 帳戶（Proxy + DNS-01 證書，可唔開 80 port）

## 步驟
1. 複製 repo 到 VPS
2. `cp .env.example .env`，填：SESSION_SECRET（必須，強亂碼）、EMAIL_*、TWILIO_*、STRIPE_*（可選）
3. 生產環境**刪除** .env 入面 `CAPTCHA_TEST_BYPASS` 一行
4. `docker compose up -d --build`
5. `docker compose logs app` 拎初始 admin 密碼（若 .env 冇 ADMIN_PASSWORD，會隨機生成印出）
6. 用 admin 登入 https://網域/admin.html，即刻改密碼
7. Cloudflare 開 Proxy，DNS 設 A → VPS IP；「總是 HTTPS」+ WAF 基本規則

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
4. .env 設 `DATABASE_URL`，docker-compose 加 postgres 服務並移除 database.db volume
呢步係一次獨立 refactor，請見專門任務（需喺有 Postgres 實例下測試）。
