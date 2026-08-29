# 寶天醫館預約系統 — 上線檢查清單（Go-Live Checklist）

> 最後更新：2026-08-24
> 狀態：✅ = 已完成　⚠️ = 上線前必須處理　💡 = 建議

---

## A. 系統現況（已驗證 ✅）

| 項目 | 狀態 |
|---|---|
| 五個角色（訪客／會員／家庭／員工／醫師／管理員）全部功能實測 | ✅ 100+ 項通過 |
| 後端 55 個端點零 5xx | ✅ |
| Vue dev build 掃描零警告、零殘留炸彈 | ✅ |
| 手機（iPhone Safari + WeChat UA）訪客預約全流程 | ✅ 零溢出 |
| 電郵重設密碼端到端（真 Gmail SMTP） | ✅ |
| 密碼強度政策（所有改密碼入口） | ✅ 16/16 |
| 安全標頭（helmet） | ✅ |
| 日誌每日輪轉（logs/，保留 14 日） | ✅ |
| 資料庫每日自動備份（03:30，保留 30 日） | ✅ 已登記排程 |
| 私隱政策頁（PDPO）+ footer 連結 | ✅ |
| SMS 殘留代碼全面清除 | ✅ |
| pm2 設定檔（ecosystem.config.js） | ✅ 已備妥 |

---

## B. 上線前必須處理（⚠️ 阻頭版）

### 1. 移除測試後門
- [ ] `.env` 刪除 `CAPTCHA_TEST_BYPASS=test999`（**而家仲在**，等於關閉驗證碼防護）

### 2. 更換所有密碼
- [ ] admin（**而家係 12345678，違反自家密碼政策**，必須換強密碼）
- [ ] staff01（Staff2026）、cheuk951211（Doctor2026）、8udc（Member2026）— 測試期間被重設
- [ ] 檢查仲有冇其他帳戶用弱密碼

### 3. WhatsApp 正式通道
- [ ] 由 Twilio Sandbox 轉正式號碼（而家所有 WhatsApp 通知發送失敗）
- [ ] 向 Meta 申請訊息範本（預約確認／提醒／子帳戶密碼／停診通知）
- [ ] `.env` 更新 `TWILIO_WHATSAPP_NUMBER`
- [ ] 實測一單預約確認訊息真機收到

### 4. Stripe 付費會員
- [ ] `.env` 設定 `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`
- [ ] 實測一次真實 checkout → webhook 開通 → 會員級別生效
- [ ] （或決定上線初期暫不開放付費升級）

### 5. 正式部署環境
- [ ] 網域 + HTTPS（nginx 反向代理 + Let's Encrypt）
- [ ] `.env`：`ALLOWED_ORIGINS=https://你的網域`、`SITE_URL=https://你的網域`
- [ ] 用 pm2 常駐：`pm2 start ecosystem.config.js && pm2 save && pm2 startup`
- [ ] 確認 `NODE_ENV=production`（cookie secure 已依賴此項）

---

## C. 上線前強烈建議（💡）

### 6. 手機真機測試
- [ ] 用真 iPhone（Safari + WhatsApp 內置瀏覽器）行一次訪客預約同會員登入
- [ ] 模擬測試已全過（零溢出），但真機字體/鍵盤行為值得目視確認

### 7. 資料備份驗證
- [ ] 確認排程任務 `PotinClinic-DBBackup` 有實際運行（工作排程器 → 上次執行時間）
- [ ] **建議將 `backups/` 同步到另一部機／雲端**（而家只在本機，OneDrive 資料夾內算有異地副本）

### 8. 通知渠道升級（可選）
- [ ] 360dialog WhatsApp Business API（比 Twilio 平，見下方舊指南段落）

### 9. 監控
- [ ] 每日睇一眼 `logs/app-YYYY-MM-DD.log` 有無 ERROR/FATAL
- [ ] 上線首星期留意登入鎖定誤傷（login limiter：每 IP 每小時 5 次，**連成功登入都計算**——診所共用 IP 可能誤傷，必要時調高 `server.js` L401-402 嘅 `max`）

---

## D. 已知限制（上線後跟進）

| 項目 | 說明 |
|---|---|
| 會員不能自助取消預約 | 按現行設計需致電職員；如要開放自助取消需另做 |
| 審計日誌只睇密碼重設 | 登入嘗試等未有 UI，可後補 |
| 醫師排程只有請假 | 冇排更表概念（每日時段由診所設定統一管理） |
| 診所地址係 placeholder | 「香港中環（詳細地址後補）」— 記得喺官網內容管理更新 |
| 電話號碼有兩組 | 2555-1136（主）／2577 0001（舊），建議統一 |

---

## E. 常用維運命令

```powershell
# 啟動／重啟
powershell -ExecutionPolicy Bypass -File start-server.ps1

# pm2 方式（建議）
pm2 start ecosystem.config.js
pm2 logs potin-clinic
pm2 restart potin-clinic

# 手動備份
node scripts/backup-db.js

# 查看今日日誌
Get-Content logs\app-$(Get-Date -Format 'yyyy-MM-dd').log -Tail 50 -Wait
```

---

## F. 附錄：360dialog WhatsApp 註冊（舊指南精華）

1. 去 https://www.360dialog.com 註冊 → Connect WhatsApp
2. 經 Meta Business Manager 建立 WABA
3. 揀「個別號碼」→ SMS/來電驗證
4. 提交 Business 審核（幾小時至幾日）
5. Hub → Settings → API → Copy API Token
6. `.env`：
   ```env
   DIALOG360_API_KEY=你的TOKEN
   DIALOG360_USE_SANDBOX=false
   WHATSAPP_PROVIDER=360dialog
   ```
   > ⚠️ 現時代碼只支援 `twilio`／`android` 兩個 provider，360dialog 需要喺 `server.js`、`routes/auth.js`、`services/notification-scheduler.js` 嘅 WhatsApp provider 選擇處加一個分支 —— 準備好話我知，幫你接。
7. 模板審批：Hub → Message Templates → 類別揀 **Utility**（平過 Marketing）

---

## G. 上線日流程建議

1. 備份一次資料庫（`node scripts/backup-db.js`）
2. 改齊 B 部分所有密碼 + 移除 CAPTCHA bypass
3. `pm2 start ecosystem.config.js`
4. 真機測一單完整流程：訪客預約 → 職員開戶 → 會員預約 → WhatsApp 收到確認
5. 確認排程備份當晚有跑
6. 觀察首日日誌
