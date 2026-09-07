# 寶天醫館 — AWS 部署影片腳本

> 用於錄製 YouTube 或教學影片
> 建議工具：OBS Studio（免費）或 Screen Recorder
> 建議長度：15-20 分鐘

---

## 影片結構

### 第 1 部分：開場（1-2 分鐘）

**畫面：** 你嘅桌面 + 語音旁白

**旁白：**
```
大家好！今日我會教大家點樣將寶天醫館預約系統部署到 AWS 雲端。

呢個系統係一個中醫診所智能預約系統，支援：
- 5 個角色：訪客、會員、家庭、員工、醫師、管理員
- 完整功能：預約、付款、醫療記錄、HR管理
- 手機 App：PWA + 原生 App（iOS/Android）

今日嘅教學會包括：
1. 建立 AWS 帳戶
2. 設定 EC2 伺服器
3. 安裝 Docker
4. 部署預約系統
5. 配置域名同 HTTPS
6. 設定 PWA 手機網頁版

整個過程大約需要 2 小時，新手都可以跟住做。

我哋開始啦！
```

---

### 第 2 部分：建立 AWS 帳戶（3-5 分鐘）

**畫面：** 瀏覽器打開 AWS 官網

**旁白：**
```
首先，我哋要建立 AWS 帳戶。

1. 打開瀏覽器，去 aws.amazon.com
2. 點擊右上角 "Create an AWS Account"
3. 填寫你嘅電郵同密碼
4. 選擇 "Personal"（個人帳戶）
5. 填寫你嘅資料
6. 輸入信用卡資料（免費層級唔會扣錢）
7. 完成手機驗證

重要提示：
- 新用戶有 12 個月免費層級
- 包括 EC2 t3.micro 伺服器
- 強烈建議設定預算告警
```

**操作：** 示範註冊過程

---

### 第 3 部分：建立 EC2 伺服器（5-7 分鐘）

**畫面：** AWS Console

**旁白：**
```
而家我哋要建立 EC2 伺服器。

1. AWS Console → 搜尋 "EC2"
2. 點擊 "Launch instances"
3. 填寫：
   - Name：potin-web-server
   - AMI：Ubuntu Server 22.04 LTS
   - Instance type：t3.micro
   - Key pair：建立新嘅 potin-key
   - Network：揀我哋剛建嘅 VPC
   - Storage：20GB

重要提示：
- .pem 金鑰文件要妥善保管
- 唔好上傳到 GitHub
- 記低公開 IP 地址
```

**操作：** 示範建立 EC2 實例

---

### 第 4 部分：連接伺服器（2-3 分鐘）

**畫面：** PowerShell

**旁白：**
```
而家我哋要連接伺服器。

Windows 用戶：
1. 打開 PowerShell
2. 去到 .pem 文件目錄
3. 執行：ssh -i potin-key.pem ubuntu@你嘅IP

Mac/Linux 用戶：
1. 打開 Terminal
2. chmod 400 potin-key.pem
3. ssh -i potin-key.pem ubuntu@你嘅IP

如果見到 "The authenticity of host can't be established"，
輸入 yes 就得。
```

**操作：** 示範 SSH 連接

---

### 第 5 部分：安裝 Docker（3-5 分鐘）

**畫面：** SSH 終端

**旁白：**
```
連接伺服器後，我哋要安裝 Docker。

依次執行以下命令：
1. 更新系統
2. 安裝 Docker
3. 將用戶加入 docker 群組
4. 驗證安裝

我哋會用 Docker Compose 部署應用，
因為佢可以同時管理 Node.js 應用同 Caddy 反向代理。
```

**操作：** 示範安裝 Docker

---

### 第 6 部分：部署預約系統（5-7 分鐘）

**畫面：** SSH 終端

**旁白：**
```
而家我哋要部署預約系統。

1. 安裝 Git
2. 拉取代碼
3. 建立 .env 配置文件
4. 生成 SESSION_SECRET
5. 編輯 Caddyfile
6. 構建同啟動 Docker 容器
7. 查看日誌確認成功

重要提示：
- SESSION_SECRET 必須設定
- 千祈唔好留 CAPTCHA_TEST_BYPASS
- 確認 .env 權限設為 600
```

**操作：** 示範部署過程

---

### 第 7 部分：配置域名同 HTTPS（3-5 分鐘）

**畫面：** Cloudflare 控制台

**旁白：**
```
而家我哋要配置域名同 HTTPS。

1. 購買域名（推薦 Cloudflare）
2. 設定 DNS 記錄
3. 啟用 SSL/TLS
4. 更新伺服器配置
5. 驗證 HTTPS 正常

我哋會用 Cloudflare 做 DNS 同 CDN，
佢提供免費嘅 DDoS 防護同 CDN 加速。
```

**操作：** 示範 Cloudflare 設定

---

### 第 8 部分：PWA 手機網頁版（3-5 分鐘）

**畫面：** 代碼編輯器 + 手機截圖

**旁白：**
```
而家我哋要設定 PWA 手機網頁版。

PWA 可以讓用戶用手機瀏覽器訪問網站，
然後「添加到主屏幕」變成 App 圖標。

需要嘅文件：
1. manifest.json - App 配置
2. sw.js - Service Worker
3. App 圖標

步驟：
1. 建立 manifest.json
2. 建立 sw.js
3. 在 index.html 加入引用
4. 部署到伺服器
5. 在手機上測試

PWA 嘅優點：
- 即時上線，唔使 App Store 審核
- 免費
- 自動更新
```

**操作：** 示範 PWA 設定

---

### 第 9 部分：測試同驗證（2-3 分鐘）

**畫面：** 手機 + 電腦瀏覽器

**旁白：**
```
而家我哋要測試同驗證。

在電腦上：
1. 打開 https://你嘅域名.com
2. 確認見到寶天醫館首頁
3. 測試登入功能

在手機上：
1. 打開 Chrome/Safari
2. 訪問 https://你嘅域名.com
3. 添加到主屏幕
4. 確認 App 圖標出現
5. 測試預約功能
```

**操作：** 示範測試過程

---

### 第 10 部分：總結同下一步（1-2 分鐘）

**畫面：** 你嘅桌面

**旁白：**
```
今日嘅教學到此為止。

總結一下我哋做咗乜：
1. ✓ 建立 AWS 帳戶
2. ✓ 建立 EC2 伺服器
3. ✓ 安裝 Docker
4. ✓ 部署預約系統
5. ✓ 配置域名同 HTTPS
6. ✓ 設定 PWA 手機網頁版

下一步：
1. 設定 WhatsApp 通知
2. 設定 Stripe 付款
3. 開發原生 App（iOS/Android）
4. 上架 App Store

如果你有任何問題，歡迎留言或私信我。

多謝收看！記得 Like 同 Subscribe！
```

---

## 影片製作建議

### 錄製工具

| 工具 | 費用 | 特點 |
|------|------|------|
| **OBS Studio**（推薦） | 免費 | 開源、功能強大 |
| **Screen Recorder** | 免費 | 簡單易用 |
| **Camtasia** | $249 | 專業級 |

### 錄製設定

- **分辨率：** 1920x1080 (1080p)
- **幀率：** 30fps
- **音頻：** 48kHz, 128kbps
- **格式：** MP4 (H.264)

### 剪輯工具

| 工具 | 費用 | 特點 |
|------|------|------|
| **DaVinci Resolve**（推薦） | 免費 | 專業級 |
| **Shotcut** | 免費 | 簡單易用 |
| **Adobe Premiere** | $20.99/月 | 專業級 |

### 字幕

- 建議加上中文字幕
- 可以用 YouTube 自動字幕
- 或用剪映（免費）手動加字幕

### 上傳平台

| 平台 | 優點 |
|------|------|
| **YouTube**（推薦） | 最大、SEO 好 |
| **Bilibili** | 中文用戶多 |
| ** Vimeo** | 專業級 |

---

## 影片描述範例

```
寶天醫館智能預約系統 — AWS 雲端部署完整教程（新手版）

本教程手拖手教你點樣將預約系統部署到 AWS 雲端，
包括：
✅ 建立 AWS 帳戶
✅ 設定 EC2 伺服器
✅ 安裝 Docker
✅ 部署預約系統
✅ 配置域名同 HTTPS
✅ 設定 PWA 手機網頁版

整個過程大約 2 小時，新手都可以跟住做。

時間軸：
0:00 - 開場
1:00 - 建立 AWS 帳戶
4:00 - 建立 EC2 伺服器
9:00 - 連接伺服器
11:00 - 安裝 Docker
14:00 - 部署預約系統
19:00 - 配置域名同 HTTPS
22:00 - PWA 手機網頁版
25:00 - 測試同驗證
27:00 - 總結

相關資源：
- 項目 GitHub：https://github.com/你的用戶名/booking-aurora
- AWS 免費層級：https://aws.amazon.com/free/
- Cloudflare：https://www.cloudflare.com/

#AWS #Docker #Node.js #Vue #預約系統 #中醫 #教程
```

---

## 影片宣傳

### 社交媒體宣傳

```
新片上線！🎬

寶天醫館智能預約系統 — AWS 雲端部署完整教程

✅ 新手友好，手拖手教學
✅ 2 小時完成部署
✅ 免費層級，月費低至 HK$4
✅ 支援 PWA 手機網頁版

立即觀看：[YouTube 連結]

#AWS #Docker #Node.js #預約系統 #教程
```

### 論壇宣傳

```
分享一個預約系統部署教程

最近幫一個中醫診所做咗一個智能預約系統，
用 Node.js + Express + Vue 3 開發，
部署到 AWS 雲端。

整個過程錄咗個教程，新手都可以跟住做：
[YouTube 連結]

技術棧：
- 後端：Node.js + Express
- 前端：Vue 3
- 數據庫：SQLite
- 部署：Docker + AWS EC2
- 手機：PWA + React Native

歡迎交流！
```
