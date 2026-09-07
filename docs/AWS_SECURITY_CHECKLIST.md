# 寶天醫館 — AWS 安全檢查清單

> 上線前必須逐項確認，全部打 ✅ 先可以上線
> 最後更新：2026-09-04

---

## 🔴 嚴重（阻礙上線）

### 環境配置
- [ ] `.env` 文件中 **沒有** `CAPTCHA_TEST_BYPASS=test999`（測試後門）
- [ ] `SESSION_SECRET` 已設定為隨機字串（唔係空）
- [ ] `ADMIN_PASSWORD` 設定為強密碼（至少 12 位，包含大小寫+數字+符號）
- [ ] `NODE_ENV=production`
- [ ] 所有測試帳戶密碼已更改（staff01, cheuk951211, 8udc 等）

### 伺服器安全
- [ ] SSH 禁止 root 登入（`PermitRootLogin no`）
- [ ] SSH 禁用密碼登入（`PasswordAuthentication no`）
- [ ] SSH 只允許特定用戶登入（`AllowUsers ubuntu`）
- [ ] 防火牆只開放 22, 80, 443 端口
- [ ] AWS Security Group SSH 只允許你嘅 IP（唔係 0.0.0.0/0）

### 數據安全
- [ ] `.env` 文件權限設為 600（只有 owner 可讀寫）
- [ ] `database.db` 文件權限設為 644
- [ ] `.env` 文件唔喺 Git 版本控制中
- [ ] `.env.bak-video` 文件已刪除或加入 .gitignore

---

## 🟡 重要（強烈建議）

### 備份
- [ ] S3 備份桶已建立
- [ ] 自動備份腳本已設定（每日凌晨 4 點）
- [ ] 備份腳本已測試（手動執行一次確認成功）
- [ ] 本地備份保留 7 日以上
- [ ] S3 備份保留 30 日以上

### 監控
- [ ] CloudWatch 告警已建立（CPU > 80%）
- [ ] 健康檢查腳本已設定（每 5 分鐘）
- [ ] 日誌文件正常寫入 logs/ 目錄
- [ ] 磁碟使用率監控已設定

### 網絡
- [ ] 域名 DNS 已指向 EC2 公開 IP
- [ ] Cloudflare Proxy 已啟用
- [ ] SSL/TLS 證書自動續期正常
- [ ] HTTP 自動跳轉 HTTPS

---

## 🟢 建議（優化）

### 性能
- [ ] Docker 鏡像已優化（多階段構建）
- [ ] Gzip 壓縮已啟用
- [ ] 靜態文件快取已設定
- [ ] 數據庫索引已優化

### 可用性
- [ ] 服務自動重啟已設定（restart: unless-stopped）
- [ ] 健康檢查失敗自動重啟已設定
- [ ] 磁碟空間告警已設定
- [ ] 內存使用告警已設定

### 手機 App 安全
- [ ] PWA manifest.json 已設定
- [ ] Service Worker 已正確配置
- [ ] App 圖標已生成（192x192 + 512x512）
- [ ] App Store 審核已通過（如果上架）
- [ ] Google Play 審核已通過（如果上架）
- [ ] 推送通知已設定（如果用原生 App）

---

## 📋 檢查方法

### 如何檢查 .env 配置

```bash
# SSH 連接伺服器後
cd ~/booking-aurora

# 檢查是否有測試後門
grep CAPTCHA_TEST_BYPASS .env
# 如果有輸出，立即刪除該行

# 檢查 SESSION_SECRET
grep SESSION_SECRET .env
# 確認唔係空值

# 檢查 NODE_ENV
grep NODE_ENV .env
# 確認是 production
```

### 如何檢查 SSH 設定

```bash
# 檢查 SSH 配置
sudo grep -E "^(PermitRootLogin|PasswordAuthentication|AllowUsers)" /etc/ssh/sshd_config

# 期望輸出：
# PermitRootLogin no
# PasswordAuthentication no
# AllowUsers ubuntu
```

### 如何檢查防火牆

```bash
# 查看 UFW 狀態
sudo ufw status

# 期望輸出：
# Status: active
# To                         Action      From
# --                         ------      ----
# 22/tcp                     ALLOW       Anywhere
# 80/tcp                     ALLOW       Anywhere
# 443/tcp                    ALLOW       Anywhere
```

### 如何檢查文件權限

```bash
# 檢查 .env 權限
ls -la .env
# 期望：-rw------- 1 ubuntu ubuntu ... .env

# 檢查 data/ 權限
ls -la data/
# 期望：drwxr-xr-x 2 ubuntu ubuntu ... data
```

---

## 🚨 緊急情況處理

### 如果發現安全漏洞

1. **立即停止服務**：`docker compose down`
2. **更改所有密碼**：
   - SSH 密鑰
   - .env 中嘅 SESSION_SECRET
   - ADMIN_PASSWORD
   - 所有用戶密碼
3. **檢查日誌**：`docker compose logs app | grep -i "error\|warn"`
4. **聯繫支持**：如果有異常登入記錄

### 如果資料庫損壞

1. **停止服務**：`docker compose down`
2. **從 S3 恢復最新備份**：
   ```bash
   aws s3 cp s3://你嘅bucket/backups/latest.db ./data/database.db
   ```
3. **重啟服務**：`docker compose up -d`
4. **驗證數據完整性**

---

## ✅ 最終檢查

上線前最後確認：

- [ ] 所有 🔴 嚴重項目已通過
- [ ] 所有 🟡 重要項目已通過
- [ ] 至少 50% 🟢 建議項目已通過
- [ ] 已執行一次完整嘅端到端測試
- [ ] 已備份當前數據庫
- [ ] 已通知團隊上線時間
- [ ] 已準備好回滾方案

**全部打 ✅ 先可以上線！**
