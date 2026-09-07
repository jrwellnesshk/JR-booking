# AWS 上線檢查清單（寶天醫館預約系統）

> 最後更新：2026-09-07 ｜ 適用版本：commit 後見 `git log -1`
> 呢份係**上線前 gate**：任一 P0 未打勾，唔好派生產流量。

---

## 0. 架構前提（先確認，會影響下面所有步驟）

| 項目 | 現況 | 影響 |
|---|---|---|
| 資料庫 | **SQLite 單檔**（`DB_PATH=/app/data/database.db`） | **只能跑 1 個 instance**，唔可以 Auto Scaling 多副本，唔可以 ECS Fargate 多 task 同時寫 |
| Session | 自製 JWT（HMAC + `SESSION_SECRET`）+ SQLite 黑名單 | 多 instance 時 `SESSION_SECRET` 必須一致，否則隨機登出 |
| 檔案上傳 | 寫入容器內 `uploads/` | 容器重建會冇咗 → 必須 EFS 或改 S3 |
| 靜態資源 | Express 直出 | 建議前面放 CloudFront / ALB |

⚠️ **結論**：現階段部署形態 = **單一 EC2（或 ECS 單 task）+ EBS/EFS volume**。
想上多副本，必須先做「SQLite → RDS PostgreSQL」遷移（見第 8 節）。

---

## 1. 🔒 P0 機密與後門（未過唔好上線）

- [ ] `CAPTCHA_TEST_BYPASS` **已從生產環境變數刪除**
      - 程式碼已加固：`services/captcha.js` 喺 `NODE_ENV=production` 下硬性停用 bypass
      - `config/preflight.js` 會喺 production 見到呢個變數就直接 `exit(1)`
      - 驗證：`curl -X POST $HOST/api/auth/login -d '{"username":"x","password":"y","captchaAnswer":"test999"}'` → 應該 **401 驗證碼錯誤**，唔係「密碼錯誤」
- [ ] `SESSION_SECRET` 已設定且 **≥ 32 字元**（建議 48 bytes random）
      ```bash
      node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
      ```
      - 放 **AWS Secrets Manager**，唔好放 `.env` 落 image
- [ ] `ADMIN_PASSWORD` 唔係已知預設值（`AuroraDock3r!Test` / `admin123` 等已被 preflight 列入黑名單）
      - 建議：首次建庫後用 `scripts/reset-admin-password.js` 改強密碼，之後從環境變數移除
- [ ] `ALLOWED_ORIGINS` 已設成真實域名（CORS 白名單）
      ```bash
      ALLOWED_ORIGINS=https://booking.yourdomain.com
      ```
- [ ] `SITE_DOMAIN` 已設成真實域名（Stripe / WhatsApp 回呼靠佢）

### Secrets Manager 建議做法（EC2 / ECS 都啱）
```bash
aws secretsmanager create-secret \
  --name aurora/production/env \
  --secret-string file://.env.production
```
ECS task definition 用 `secrets:` 區塊注入；EC2 就喺 user-data 用 `aws secretsmanager get-secret-value` 寫入 `/etc/aurora.env`。

---

## 2. 🔒 P0 依賴漏洞

- [ ] `npm audit --omit=dev` → **0 vulnerabilities**（已修：見下方記錄）
- [ ] CI 加 `npm audit --audit-level=high` 做 gate

**本輪已修（2026-09-07）**
| 套件 | 由 | 升至 | 處理咗咩 |
|---|---|---|---|
| `sqlite3` | 5.1.7 | **6.0.1** | critical `tar`（任意檔案覆寫 / path traversal）、`cacache`、`node-gyp`、`make-fetch-happen` |
| `nodemailer` | 7.0.11 | **10.0.0** | SMTP command injection、CRLF header injection、SSRF + 任意檔案讀取、OAuth2 TLS 驗證不當 |
| `xlsx` | 0.18.5 | **0.20.3**（SheetJS 官方 CDN） | Prototype Pollution + ReDoS。npm registry 版已停更，官方修正只喺 `cdn.sheetjs.com` |
| `express-rate-limit`、`axios`、`form-data`、`brace-expansion`、`minimatch`、`ip-address`、`path-to-regexp` | — | 安全版 | 由 `npm audit fix` 處理 |

⚠️ `xlsx` 而家由 CDN tarball 安裝（`package.json` 會見到 `https://cdn.sheetjs.com/...`）。
呢個係 SheetJS **官方**分發渠道，但如果你嘅 CI 唔通外網，要自己 mirror 落內部 registry。

---

## 3. 🏥 健康檢查（ALB / ECS target group 必填）

已加端點（**唔受 rate limit 影響**，排喺 `globalLimiter` 之前）：

| 端點 | 用途 | 成功 | 失敗 |
|---|---|---|---|
| `GET /health` （`/healthz` 同義） | **liveness**：process 仲喺度 | `200 {"ok":true,"status":"alive"}` | — |
| `GET /health/ready` | **readiness**：DB 起好未 | `200 {"ok":true,"status":"ready"}` | `503 {"ok":false,"status":"starting"}` |

ALB Target Group 建議設定：
```
Health check path:        /health
Healthy threshold:        2
Unhealthy threshold:      3
Interval:                 30s
Timeout:                  5s
Success codes:            200
```
⚠️ **唔好用 `/health/ready` 做 ALB health check** —— 否則 DB 慢少少 ALB 就會摘走唯一嗰個 instance，直接全站 503。

---

## 4. 🐳 Container

- [ ] `docker build -t aurora-clinic .` 成功
- [ ] 用非 root user 跑（`USER node`）— 已設
- [ ] `dumb-init` 做 PID 1（優雅關機）— 已設
- [ ] `HEALTHCHECK` 已設 — 已設
- [ ] build-only 套件（`tar` / `node-gyp` / `cacache`）已從 runtime layer 刪除 — 已設

```bash
# 本地驗證
docker build -t aurora-clinic:latest .
docker run --rm -p 4000:4000 \
  -e SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")" \
  -e NODE_ENV=production \
  -v aurora-data:/app/data \
  aurora-clinic:latest

curl localhost:4000/health          # => {"ok":true,"status":"alive"}
curl localhost:4000/health/ready    # => {"ok":true,"status":"ready"}
```

### 推去 ECR
```bash
AWS_REGION=ap-east-1
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
aws ecr create-repository --repository-name aurora-clinic --region $AWS_REGION
aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com
docker tag aurora-clinic:latest $ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/aurora-clinic:latest
docker push $ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/aurora-clinic:latest
```

---

## 5. 🌐 網絡 / TLS

- [ ] ALB listener 443（ACM 憑證）+ 80 → 443 redirect
- [ ] Security Group：ALB 只開 443；EC2/ECS 只俾 ALB SG 入 4000
- [ ] `app.set('trust proxy', 1)` 已設（讀 `X-Forwarded-For`）— 已設，rate limit 先唔會誤判
- [ ] Session cookie 建議加 `Secure`（經 ALB 終止 TLS 後由 `X-Forwarded-Proto` 判斷）
- [ ] WAF：建議掛 AWS WAF（SQLi / rate-based rule）

---

## 6. 💾 資料持久化與備份

- [ ] `./data` volume 已掛（EBS 或 EFS），**唔好**用容器內層
- [ ] `./uploads` 已持久化（EFS）或改 S3
- [ ] 每日自動備份：
      ```bash
      # crontab（EC2）
      0 3 * * * cd /app && node scripts/backup-db.js >> /var/log/aurora-backup.log 2>&1
      ```
- [ ] 備份同步去 S3（建議開 lifecycle → Glacier）
      ```bash
      aws s3 sync /app/backups s3://aurora-backups/$(date +%F)/
      ```
- [ ] **已實測還原一次**（冇測過還原嘅備份 = 冇備份）

---

## 7. 📊 可觀測性

- [ ] CloudWatch Logs：ECS 用 `awslogs` driver；EC2 用 CloudWatch agent 收 `/app/logs/*.log`
- [ ] 告警（至少呢幾條）：
      - ALB `UnHealthyHostCount > 0`（1 分鐘內）
      - ALB `TargetResponseTime` p95 > 2s
      - ALB `HTTPCode_Target_5XX_Count > 5`（5 分鐘）
      - EC2 `CPUUtilization > 80%` 持續 10 分鐘
      - EBS / EFS 剩餘空間 < 20%
- [ ] `/health` 由外部（Route53 health check 或 CloudWatch Synthetics）每 60s 探一次

---

## 8. 🚀 發布與回滾（唔好一把梭）

### 漸進式發布
1. **先 deploy 去 staging**（同一份 image、唔同 target group），跑 `npm run qa` 對住 staging
2. 生產用 **ECS rolling update**（`minimumHealthyPercent=100, maximumPercent=200`），
   或 EC2 用 blue/green
3. 發布後觀察 15 分鐘：5XX、response time、health check
4. 先放量 10% → 50% → 100%（用 ALB weighted target group）

### 回滾（**未準備好就唔好上線**）
```bash
# ECS：即刻返上一版 task definition
aws ecs update-service --cluster aurora \
  --service aurora-clinic \
  --task-definition aurora-clinic:<PREVIOUS_REVISION>

# EC2：留住上一個 image tag，直接換返
docker run ... aurora-clinic:<PREV_TAG>
```

⚠️ **DB 回滾係難題**：migration 只會加欄、唔刪欄（現有做法），所以舊版 code 通常都跑得到。
但**每次上線前必須 snapshot `/app/data/database.db`**，先係真正嘅回滾保險。

---

## 9. 🧪 上線前最後驗證（對住正式域名跑一次）

```bash
HOST=https://booking.yourdomain.com

# 1. liveness
curl -s $HOST/health            # {"ok":true,"status":"alive"}
curl -s $HOST/health/ready      # {"ok":true,"status":"ready"}

# 2. CAPTCHA 後門確實閂咗（重要！）
curl -s -X POST $HOST/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"wrong","captchaAnswer":"test999"}'
#   預期：401 + 「驗證碼」相關錯誤 —— 若見到「密碼錯誤」即代表 bypass 仲開住，即刻落機

# 3. CORS 拒絕陌生來源
curl -s -H 'Origin: https://evil.example.com' -I $HOST/api/health

# 4. 敏感檔唔可以下載（應該 404）
for p in /.env /database.db /server.js /package.json /routes/admin.js; do
  printf "%-24s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' $HOST$p)"
done
#   全部應該 404
```

---

## 10. 📋 上線後 24 小時內要做

- [ ] 改 admin 密碼（`scripts/reset-admin-password.js`），並從環境變數移除 `ADMIN_PASSWORD`
- [ ] 確認 WhatsApp / Email 通知真的發到（Twilio / Gmail 設定）
- [ ] 確認 Stripe webhook 簽名驗證通過（`STRIPE_WEBHOOK_SECRET`）
- [ ] 睇一次 CloudWatch Logs 有冇異常 stack trace
- [ ] 做一次真實預約全流程（客人落單 → 醫師完成 → 出病歷）

---

## 已知限制（上線前要知）

| 限制 | 影響 | 幾時要處理 |
|---|---|---|
| SQLite 單寫入者 | 唔可以水平擴展；高併發寫入會 `SQLITE_BUSY` | 日均預約 > 500 或要做 HA 時 |
| 檔案上傳喺容器內 | 重建容器會冇 | 上線前就要改 EFS/S3 |
| 登出黑名單喺 SQLite | 多 instance 時要共用同一個 DB | 同上 |
| CSP 關閉（helmet `contentSecurityPolicy: false`） | XSS 防護弱一層；因頁面用 Vue CDN + 大量 inline script，開 CSP 會整垮前端 | 前端 bundler 化之後先開得 |
| 臺灣/香港個資 | 病歷屬敏感個資，要確認備份加密 + 存取稽核 | 上線前（合規） |
