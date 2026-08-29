# 寶天醫館預約系統（booking-aurora）

中環高端中醫診所嘅網上預約系統。Node.js + Express + SQLite + Vue 3。

## 入口

| 頁面 | 網址 | 對象 |
|---|---|---|
| 主網站 / 會員 | `/index.html` | 訪客、會員 |
| 員工版面 | `/staff.html` | 櫃檯職員（role=staff） |
| 醫師版面 | `/doctor.html` | 醫師（role=doctor） |
| 管理員後台 | `/admin.html` | 管理員（role=admin） |

## 快速開始

```bash
npm install        # 安裝依賴
npm start          # 啟動伺服器（http://localhost:4000）
```

- Node 版本：建議 v20 或以上
- 連接埠：`process.env.PORT || 4000`
- 資料庫：SQLite，自動建立於 `./database.db`（備份即複製此檔）

## 環境變數（.env）

| 變數 | 用途 |
|---|---|
| `PORT` | 連接埠（預設 4000） |
| `SESSION_SECRET` | JWT 簽名密鑰（**必設**，否則重啟後全部登入失效） |
| `NODE_ENV` | `production` 時 session cookie 加 secure（需 HTTPS） |
| `WHATSAPP_PROVIDER` | `twilio` / `360dialog` / `android` |
| `TWILIO_*` | Twilio WhatsApp 憑證 |
| `EMAIL_USER` / `EMAIL_PASS` | Gmail SMTP（預約電郵通知、密碼重設驗證碼） |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | 收費會員升級；兩者齊備先會啟用 webhook 自動開通 |
| `ALLOWED_ORIGINS` | CORS 白名單（正式網域） |

⚠️ 生產環境嚴禁設定 `CAPTCHA_TEST_BYPASS`。

## 通知渠道

- **WhatsApp**（主）：預約確認／更改／取消、提醒、子帳戶帳號密碼、停診通知
- **Gmail 電郵**（輔助）：可於管理員後台「啟用電子郵件通知」開關
- SMS 已全面取消

## 會員制度

- 免費一般會員 → Stripe Checkout 付費升級「高級」($8,800) / 「家庭」($16,800)
- 家庭會員可申請家庭帳戶；18 歲以下子帳戶由職員喺 staff.html 代開，
  登入資料自動經 WhatsApp 發送畀家長，並可隨時重設暫時密碼

## 安全要點

- bcrypt 密碼雜湊、自製 HS256 JWT（登出黑名單）
- 登入／註冊有圖形驗證碼 + 速率限制；鎖定機制按 帳戶+IP 計算
- 敏感目錄／.env／資料庫已由靜態白名單封鎖，唔會經網址下載

## 測試

手動流程建議：訪客初體驗預約 → 職員開戶 → 客戶升級家庭 →
職員加未成年子帳戶 → 客戶預約 → 職員完成服務。
