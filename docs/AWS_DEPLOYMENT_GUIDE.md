# 寶天醫館 — AWS 雲端部署完整指南（新手版）

> 版本：v1.0 | 更新日期：2026-09-04
> 適用對象：完全零經驗新手，手拖手教學

---

## 目錄

1. [部署架構圖](#1-部署架構圖)
2. [你需要準備乜嘢？](#2-你需要準備乜嘢)
3. [第一部分：建立 AWS 帳戶](#3-第一部分建立-aws-帳戶)
4. [第二部分：建立 VPC 網絡安全](#4-第二部分建立-vpc-網絡安全)
5. [第三部分：建立 EC2 伺服器](#5-第三部分建立-ec2-伺服器)
6. [第四部分：連接伺服器](#6-第四部分連接伺服器)
7. [第五部分：安裝 Docker](#7-第五部分安裝-docker)
8. [第六部分：部署預約系統](#8-第六部分部署預約系統)
9. [第七部分：配置域名同 HTTPS](#9-第七部分配置域名同-https)
10. [第八部分：設定自動備份](#10-第八部分設定自動備份)
11. [第九部分：設定監控同告警](#11-第九部分設定監控同告警)
12. [第十部分：安全加固](#12-第十部分安全加固)
13. [第十一部分：手機 App 部署（PWA + 原生 App）](#13-第十一部分手機-app-部署pwa--原生-app)
14. [第十二部分：成本預算](#14-第十二部分成本預算)
15. [預警同常見陷阱](#15-預警同常見陷阱)
16. [故障排除](#16-故障排除)
17. [維運手冊](#17-維運手冊)

---

## 1. 部署架構圖

```
                        ┌─────────────────────────────────────────┐
                        │              AWS Cloud                  │
                        │                                         │
  ┌──────────┐          │  ┌──────────────────────────────────┐   │
  │  瀏覽器   │◄──HTTPS──┼─►│  Route 53 (DNS)                  │   │
  │ (手機/PC) │          │  └──────────┬───────────────────────┘   │
  └──────────┘          │             │                           │
                        │  ┌──────────▼───────────────────────┐   │
  ┌──────────┐          │  │  VPC (10.0.0.0/16)               │   │
  │ 手機 App │◄──HTTPS──┼─►│  ┌─────────────────────────────┐ │   │
  │(iOS/Andr)│          │  │  │  公有子網 (10.0.1.0/24)     │ │   │
  └──────────┘          │  │  │  ┌───────────────────────┐  │ │   │
                        │  │  │  │  EC2 (t3.micro)       │  │ │   │
  ┌──────────┐          │  │  │  │  ┌─────────────────┐  │  │ │   │
  │ PWA 手機 │◄──HTTPS──┼─►│  │  │  │  Docker          │  │  │ │   │
  │ 網頁版   │          │  │  │  │  │  ┌────────────┐  │  │  │ │   │
  └──────────┘          │  │  │  │  │  │ Caddy :443 │  │  │  │ │   │
                        │  │  │  │  │  │ (TLS/SSL)  │  │  │  │ │   │
                        │  │  │  │  │  └─────┬──────┘  │  │  │ │   │
                        │  │  │  │  │        │         │  │  │ │   │
                        │  │  │  │  │  ┌─────▼──────┐  │  │  │ │   │
                        │  │  │  │  │  │ App :4000  │  │  │  │ │   │
                        │  │  │  │  │  │ (Node.js)  │  │  │  │ │   │
                        │  │  │  │  │  └─────┬──────┘  │  │  │ │   │
                        │  │  │  │  │        │         │  │  │ │   │
                        │  │  │  │  │  ┌─────▼──────┐  │  │  │ │   │
                        │  │  │  │  │  │ SQLite DB  │  │  │  │ │   │
                        │  │  │  │  │  │ (data/)    │  │  │  │ │   │
                        │  │  │  │  │  └────────────┘  │  │  │ │   │
                        │  │  │  │  └─────────────────┘  │  │ │   │
                        │  │  │  └───────────────────────┘  │ │   │
                        │  │  └─────────────────────────────┘ │   │
                        │  └──────────────────────────────────┘   │
                        │                                         │
                        │  ┌──────────────────────────────────┐   │
                        │  │  S3 (備份 + App 資源)             │   │
                        │  └──────────────────────────────────┘   │
                        │                                         │
                        │  ┌──────────────────────────────────┐   │
                        │  │  CloudWatch (監控)                │   │
                        │  └──────────────────────────────────┘   │
                        └─────────────────────────────────────────┘
```

**數據流：**
```
用戶手機/電腦 → AWS Route 53 (DNS解析) → EC2 公開IP:443
  → Caddy (TLS終止, gzip壓縮, 安全標頭)
    → Node.js Express 應用 (內部 :4000)
      → SQLite 數據庫 (本地文件)

手機 App (iOS/Android) → 同一個 EC2 公開IP:443
  → 同一個 Node.js API

PWA 手機網頁 → 同一個 EC2 公開IP:443
  → 同一個 Node.js API
```

---

## 2. 你需要準備乜嘢？

### ✅ 必備（上線前必須有）

| 項目 | 說明 | 預計花費 |
|------|------|---------|
| **AWS 帳戶** | 新用戶有 12 個月免費層級 | 免費 |
| **信用卡** | AWS 註冊必須，用嚟扣月費 | - |
| **網域 (Domain)** | 例如 `booking-potin.com` | 約 HK$100/年 |
| **域名提供商** | 推薦 Cloudflare（免費 DNS + CDN + DDoS 防護） | 免費 |
| **Gmail App Password** | 用嚟發預約確認電郵 | 免費 |
| **SSH 用戶名 + 密碼** | 用嚟登入 AWS 伺服器 | 免費 |

### 💡 可選（初期可以唔用）

| 項目 | 說明 | 預計花費 |
|------|------|---------|
| **Twilio 帳戶** | WhatsApp 通知（預約提醒等） | 約 HK$0.05/條 |
| **Stripe 帳戶** | 收取會員費 | 交易費 2.9% |
| **Cloudflare Pro** | 進階 WAF 防護 | 約 HK$150/月 |

### 📋 你需要知道嘅資料

- [ ] 你嘅 Gmail 地址（用嚟發電郵）
- [ ] 你嘅 Gmail App Password（16位數字）
- [ ] 你嘅診所名稱
- [ ] 你嘅診所地址
- [ ] 你嘅診所電話

---

## 3. 第一部分：建立 AWS 帳戶

### 步驟 3.1：註冊 AWS

1. 打開瀏覽器，去 **https://aws.amazon.com**
2. 點擊右上角 **「Create an AWS Account」**
3. 填寫：
   - Email address：你嘅電郵
   - Password：設一個強密碼
   - AWS account name：例如 `potin-clinic`
4. 選擇 **「Personal」**（個人帳戶）
5. 填寫你嘅資料（姓名、地址、電話）
6. 輸入信用卡資料（**免費層級唔會扣錢，只係驗證**）
7. 完成手機驗證（SMS 或電話）
8. 選擇 **「Basic Support - Free」**（免費支援計劃）

### ⚠️ 預警

> **新用戶注意：** AWS 有 12 個月免費層級，包括：
> - EC2 t2.micro / t3.micro：750 小時/月（足夠 24/7 運行）
> - EBS 30GB：足夠
> - 超出免費額度會收費！
> 
> **強烈建議：** 註冊後立即設定 **AWS Budgets**（預算告警），防止意外費用。

### 步驟 3.2：設定預算告警（防止超支）

1. 登入 AWS Console → 搜尋 **「Budgets」**
2. 點擊 **「Create a budget」**
3. 選擇 **「Cost budget」**
4. 設定：
   - Budget name：`potin-clinic-budget`
   - Budget amount：$10 USD（約 HK$78）
   - Email alerts：你嘅電郵
5. 點擊 **「Create budget」**

---

## 4. 第二部分：建立 VPC 網絡安全

### 步驟 4.1：建立 VPC

1. AWS Console → 搜尋 **「VPC」** → 點擊進入
2. 左邊選 **「Your VPCs」** → 點擊 **「Create VPC」**
3. 選擇 **「VPC and more」**
4. 填寫：
   - Name tag：`potin-vpc`
   - IPv4 CIDR：`10.0.0.0/16`
   - Public subnets：1
   - Private subnets：0（暫時唔需要）
   - NAT gateways：**None**（省錢）
   - VPC endpoints：**None**
5. 點擊 **「Create VPC」**

### 步驟 4.2：建立安全組（Security Group）

1. VPC 頁面 → 左邊 **「Security Groups」** → **「Create security group」**
2. 填寫：
   - Security group name：`potin-web-sg`
   - Description：`Web server security group for Potin Clinic`
   - VPC：揀你剛建嘅 `potin-vpc`
3. **Inbound rules**（入站規則）：

| Type | Port | Source | Description |
|------|------|--------|-------------|
| SSH | 22 | 你嘅 IP（**唔好用 0.0.0.0/0**） | 管理員登入 |
| HTTP | 80 | 0.0.0.0/0 | HTTP（Caddy 自動轉 HTTPS） |
| HTTPS | 443 | 0.0.0.0/0 | HTTPS |

4. **Outbound rules**（出站規則）：保持預設（全部允許）
5. 點擊 **「Create security group」**

### ⚠️ 預警：SSH 安全

> **嚴禁將 SSH (Port 22) 開放俾所有人！** 唔好揀 `0.0.0.0/0`。
> 
> 正確做法：用 **「My IP」** 只允許你部電腦嘅 IP 連接。
> 
> 如果你嘅 IP 會變（例如用家用 WiFi），可以暫時用 `0.0.0.0/0`，
> 但之後要改返做你嘅 IP（用 https://whatismyip.com 查詢）。
> 
> **最佳方案：** 用 AWS Systems Manager Session Manager 代替 SSH。

---

## 5. 第三部分：建立 EC2 伺服器

### 步驟 5.1：啟動 EC2 實例

1. AWS Console → 搜尋 **「EC2」** → 點擊進入
2. 左邊 **「Instances」** → 點擊 **「Launch instances」**
3. 填寫：
   - **Name**：`potin-web-server`
   - **Amazon Machine Image (AMI)**：揀 **「Ubuntu Server 22.04 LTS」**（免費）
   - **Instance type**：揀 **「t3.micro」**（免費層級，1 vCPU / 1GB RAM）
   - **Key pair**：點擊 **「Create new key pair」**
     - Name：`potin-key`
     - Type：RSA
     - Format：`.pem`
     - 點擊 **「Create key pair」**（會自動下載 .pem 文件，**千祈唔好刪！**）
   - **Network settings**：點擊 **「Edit」**
     - VPC：揀 `potin-vpc`
     - Subnet：揀公有子網
     - Auto-assign public IP：**Enable**
     - Security group：揀 `potin-web-sg`
   - **Configure storage**：
     - Size：**20 GB**（免費層級有 30GB）
     - Volume type：**gp3**（免費）
4. 點擊 **「Launch instance」**
5. 等待狀態變為 **「Running」**

### 步驟 5.2：記錄公開 IP

1. 點擊剛建好嘅實例
2. 記低 **Public IPv4 address**（例如 `54.xxx.xxx.xxx`）
3. 呢個 IP 就係你個網站嘅地址

### ⚠️ 預警

> **重要：**
> - .pem 金鑰文件要妥善保管，**唔好上傳到 GitHub 或任何公開地方**
> - 如果 .pem 文件遺失，你將無法登入伺服器
> - 建議將 .pem 文件放喺安全嘅位置，例如密碼管理器

---

## 6. 第四部分：連接伺服器

### Windows 用戶（你）

#### 方法 1：使用 PowerShell（推薦）

1. 打開 **PowerShell**
2. 去到你下載 .pem 文件嘅目錄：
   ```powershell
   cd C:\Users\你的用戶名\Downloads
   ```
3. 連接伺服器：
   ```powershell
   ssh -i potin-key.pem ubuntu@你嘅公開IP
   ```
   例如：`ssh -i potin-key.pem ubuntu@54.123.45.67`

4. 如果提示 **「The authenticity of host can't be established」**，輸入 `yes`
5. 成功連接後你會見到 `ubuntu@ip-xxx:~$`

#### 方法 2：使用 PuTTY（圖形界面）

1. 下載 PuTTY：https://www.putty.org/
2. 打開 PuTTY
3. Host Name：你嘅公開 IP
4. 左邊 Tree → SSH → Auth → Credentials → Browse → 選 .pem 文件
5. 左邊 Tree → SSH → Auth → 選 **「Allow agent forwarding」**
6. 點擊 **「Open」**

### Mac / Linux 用戶

1. 打開 Terminal
2. `chmod 400 potin-key.pem`（設定權限）
3. `ssh -i potin-key.pem ubuntu@你嘅公開IP`

### ⚠️ 預警

> **.pem 文件權限問題（Mac/Linux）：**
> 如果見到 `Permissions 0644 for 'potin-key.pem' are too open`，
> 要執行：`chmod 400 potin-key.pem`

---

## 7. 第五部分：安裝 Docker

連接伺服器後，依次執行以下命令：

```bash
# 1. 更新系統
sudo apt update && sudo apt upgrade -y

# 2. 安裝 Docker 必要工具
sudo apt install -y ca-certificates curl gnupg lsb-release

# 3. 添加 Docker 官方 GPG key
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# 4. 設置 Docker 穩定版倉庫
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 5. 安裝 Docker
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 6. 將你嘅用戶加入 docker 群組（唔使每次都用 sudo）
sudo usermod -aG docker $USER

# 7. 生效（重要！）
newgrp docker

# 8. 驗證 Docker 已安裝
docker --version
docker compose version
```

### 驗證 Docker 正常運行

```bash
docker run hello-world
```

如果見到 `Hello from Docker!` 就代表成功。

---

## 8. 第六部分：部署預約系統

### 步驟 8.1：安裝 Git 同拉取代碼

```bash
# 1. 安裝 Git
sudo apt install -y git

# 2. 拉取你嘅代碼（替換成你嘅 GitHub repo URL）
git clone https://github.com/你的用戶名/booking-aurora.git

# 3. 進入項目目錄
cd booking-aurora
```

### 步驟 8.2：建立生產環境配置文件

```bash
# 1. 複製範本
cp .env.example .env

# 2. 生成 SESSION_SECRET
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")

# 3. 編輯 .env 文件
nano .env
```

在 nano 編輯器中，將以下內容填入（**記得改真實值**）：

```env
# 必須
SESSION_SECRET=你剷生成嘅secret
NODE_ENV=production
PORT=4000

# 初始管理員密碼（建議設強密碼）
ADMIN_PASSWORD=你嘅強密碼_至少12位

# 資料庫
DB_PATH=/app/data/database.db

# Email（Gmail）
EMAIL_USER=你嘅Gmail@gmail.com
EMAIL_PASS=你嘅16位Gmail App Password

# WhatsApp（暫時留空，之後再設定）
WHATSAPP_PROVIDER=twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
TWILIO_MESSAGING_SERVICE_SID=
TWILIO_WHATSAPP_NUMBER=

# Stripe（暫時留空）
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_MONTHLY=
STRIPE_PRICE_QUARTERLY=
STRIPE_PRICE_ANNUAL=

# 域名
SITE_DOMAIN=你嘅域名.com
```

**重要：**
- **千祈唔好留 `CAPTCHA_TEST_BYPASS` 呢行！** 呢個係測試後門
- SESSION_SECRET 已經自動生成咗
- 按 `Ctrl+O` 儲存，`Ctrl+X` 退出

### 步驟 8.3：建立必要目錄

```bash
# 建立數據庫目錄
mkdir -p data

# 建立日誌目錄
mkdir -p logs

# 建立備份目錄
mkdir -p backups

# 設定權限
chmod 700 .env
chmod 755 data logs backups
```

### 步驟 8.4：編輯 Caddyfile

```bash
nano Caddyfile
```

改為：

```
{
    email admin@你嘅域名.com
}

你嘅域名.com {
    encode gzip
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "no-referrer"
        -Server
    }
    request_body { max_size 20MB }
    reverse_proxy app:4000
}
```

### 步驟 8.5：構建同啟動

```bash
# 1. 構建 Docker 鏡像（首次需要 5-10 分鐘）
docker compose up -d --build

# 2. 查看運行狀態
docker compose ps

# 3. 查看日誌（確認冇錯誤）
docker compose logs app | tail -50

# 4. 睇初始 admin 密碼（如果你冇設 ADMIN_PASSWORD）
docker compose logs app | grep -i "admin"
```

### 步驟 8.6：驗證部署

在你嘅電腦瀏覽器中打開：
- `http://你嘅公開IP`（暫時冇 HTTPS，先用 HTTP 測試）
- 應該見到寶天醫館預約系統首頁

### ⚠️ 預警

> **如果見到 502 Bad Gateway：**
> 1. 檢查 app 容器是否正常：`docker compose ps`
> 2. 查看 app 日誌：`docker compose logs app`
> 3. 常見原因：.env 配置錯誤、端口衝突

---

## 9. 第七部分：配置域名同 HTTPS

### 步驟 9.1：購買域名

推薦方案（按你嘅需求選擇）：

| 方案 | 提供商 | 價格 | 特點 |
|------|--------|------|------|
| A（推薦） | Cloudflare Registrar | 約 HK$80/年 | 最平 + 免費 CDN + DDoS 防護 |
| B | Namecheap | 約 HK$100/年 | 平價 |
| C | GoDaddy | 約 HK$150/年 | 最知名 |

### 步驟 9.2：在 Cloudflare 設定 DNS

1. 註冊 Cloudflare 帳戶（免費）
2. 添加你嘅域名
3. Cloudflare 會提供兩個 Nameserver，去你嘅域名商改 Nameserver
4. 在 Cloudflare DNS 設定：

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | @ | 你嘅 EC2 公開 IP | ✅ Proxied |
| A | www | 你嘅 EC2 公開 IP | ✅ Proxied |

5. SSL/TLS 設定：
   - Encryption mode：**Full (Strict)**
   - Always Use HTTPS：**On**
   - Automatic HTTPS Rewrites：**On**

### 步驟 9.3：更新伺服器配置

SSH 連接伺服器後：

```bash
# 更新 .env 嘅域名
nano .env
# 改 SITE_DOMAIN=你嘅域名.com

# 重啟服務
docker compose down
docker compose up -d
```

### 步驟 9.4：驗證 HTTPS

在瀏覽器打開 `https://你嘅域名.com`，應該見到：
- 網址列有 🔒 鎖頭圖標
- 無論輸入 HTTP 定 HTTPS 都會自動跳轉到 HTTPS

---

## 10. 第八部分：設定自動備份

### 步驟 10.1：設定 S3 備份

1. AWS Console → 搜尋 **「S3」** → **「Create bucket」**
2. Bucket name：`potin-clinic-backups-你嘅數字`
3. Region：**Asia Pacific (Hong Kong) ap-east-1**
4. Block Public Access：**保持全部勾選**
5. 點擊 **「Create bucket」**

### 步驟 10.2：建立 IAM 用戶（給備份用）

1. AWS Console → 搜尋 **「IAM」** → **「Users」** → **「Create user」**
2. User name：`potin-backup-user`
3. 選擇 **「Attach policies directly」**
4. 搜尋並勾選 **「AmazonS3FullAccess」**（或自訂更嚴格嘅 policy）
5. 完成建立
6. 點擊用戶 → **「Security credentials」** → **「Create access key」**
7. 選擇 **「Command Line Interface (CLI)」**
8. 記低 **Access Key ID** 同 **Secret Access Key**

### 步驟 10.3：在伺服器設定備份腳本

SSH 連接伺服器：

```bash
# 安裝 AWS CLI
sudo apt install -y awscli

# 配置 AWS CLI
aws configure
# Access Key ID：你嘅 Access Key
# Secret Access Key：你嘅 Secret Key
# Region：ap-east-1
# Output format：json

# 建立備份腳本
nano ~/backup-aurora.sh
```

貼上下列內容：

```bash
#!/bin/bash
# 寶天醫館自動備份腳本

set -e

BACKUP_DIR="/home/ubuntu/booking-aurora/backups"
DB_PATH="/home/ubuntu/booking-aurora/data/database.db"
S3_BUCKET="s3://你嘅bucket名稱"
DATE=$(date +%Y-%m-%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/db-backup-$DATE.db"

# 執行 SQLite 備份
docker compose -f /home/ubuntu/booking-aurora/docker-compose.yml exec -T app node scripts/backup-db.js

# 複製最新備份到臨時位置
LATEST_BACKUP=$(ls -t $BACKUP_DIR/db-*.db 2>/dev/null | head -1)
if [ -n "$LATEST_BACKUP" ]; then
    cp "$LATEST_BACKUP" "$BACKUP_FILE"
    
    # 上傳到 S3
    aws s3 cp "$BACKUP_FILE" "$S3_BUCKET/backups/$(basename $BACKUP_FILE)"
    
    # 刪除 7 日前嘅本地備份
    find $BACKUP_DIR -name "db-backup-*.db" -mtime +7 -delete
    
    echo "[$(date)] 備份成功：$BACKUP_FILE"
else
    echo "[$(date)] 備份失敗：找不到備份文件"
fi
```

```bash
# 設定權限
chmod +x ~/backup-aurora.sh

# 測試運行
~/backup-aurora.sh

# 設定 cron 定時任務（每日凌晨 4 點）
crontab -e
```

在 crontab 中加入：

```
0 4 * * * /home/ubuntu/backup-aurora.sh >> /home/ubuntu/backup.log 2>&1
```

---

## 11. 第九部分：設定監控同告警

### 步驟 11.1：CloudWatch 基本監控

1. AWS Console → 搜尋 **「CloudWatch」**
2. 左邊 **「Alarms」** → **「Create alarm」**
3. 選擇 EC2 實例 → 你嘅 `potin-web-server`
4. Metric：**CPU Utilization**
5. Threshold：**> 80%** 持續 5 分鐘
6. 觸發通知到你嘅電郵
7. 點擊 **「Create alarm」**

### 步驟 11.2：建立健康檢查腳本

在伺服器上：

```bash
nano ~/health-check.sh
```

```bash
#!/bin/bash
# 每 5 分鐘檢查服務是否正常

RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/api/beds/labels)

if [ "$RESPONSE" != "200" ]; then
    echo "[$(date)] 服務異常！HTTP $RESPONSE" >> /home/ubuntu/health-check.log
    # 可以加 sendmail 或其他通知
    # sudo systemctl restart aurora  # 自動重啟（謹慎使用）
fi
```

```bash
chmod +x ~/health-check.sh

# 加入 cron（每 5 分鐘）
crontab -e
# 加入：
*/5 * * * * /home/ubuntu/health-check.sh
```

---

## 12. 第十部分：安全加固

### 步驟 12.1：更新 SSH 設定

```bash
sudo nano /etc/ssh/sshd_config
```

找到並修改以下設定：

```
# 禁止 root 登入
PermitRootLogin no

# 只允許特定用戶登入（你嘅用戶名）
AllowUsers ubuntu

# 禁用密碼登入（用金鑰）
PasswordAuthentication no

# 使用 SSH v2
Protocol 2

# 設定登入超時
ClientAliveInterval 300
ClientAliveCountMax 2
```

```bash
sudo systemctl restart sshd
```

### 步驟 12.2：安裝防火牆

```bash
# 安裝 UFW
sudo apt install -y ufu

# 設定規則
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https

# 啟用
sudo ufw enable

# 查看狀態
sudo ufw status
```

### 步驟 12.3：設定自動更新

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
# 選擇 Yes
```

### 步驟 12.4：安全檢查清單

- [ ] `.env` 文件權限設為 600（只有 owner 可讀寫）
- [ ] SSH 禁止 root 登入
- [ ] SSH 禁用密碼登入（只用金鑰）
- [ ] 防火牆只開放 22, 80, 443
- [ ] AWS Security Group 只允許你嘅 IP 做 SSH
- [ ] 刪除 `CAPTCHA_TEST_BYPASS` 測試後門
- [ ] 使用強密碼（ADMIN_PASSWORD 至少 12 位）
- [ ] SESSION_SECRET 已設定（不可預測嘅隨機字串）
- [ ] 定期更新系統：`sudo apt update && sudo apt upgrade`

---

## 13. 第十一部分：手機 App 部署（PWA + 原生 App）

> 詳細指南請參閱：`docs/MOBILE_APP_DEPLOYMENT_GUIDE.md`

### 方案 A：PWA 手機網頁版（推薦先做，1-2 天完成）

PWA 可以讓用戶用手機瀏覽器訪問網站，然後「添加到主屏幕」變成 App 圖標。

#### 步驟 13.1：建立 manifest.json

在你嘅項目根目錄建立 `manifest.json`：

```json
{
  "name": "寶天醫館智能預約",
  "short_name": "寶天醫館",
  "description": "寶天醫館智能預約系統 - 隨時隨地預約中醫服務",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#6366f1",
  "orientation": "portrait",
  "icons": [
    {
      "src": "/picture/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/picture/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

#### 步驟 13.2：建立 Service Worker (sw.js)

在你嘅項目根目錄建立 `sw.js`：

```javascript
const CACHE_NAME = 'potin-clinic-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/css/tailwind.css',
  '/css/style.css',
  '/js/app.js',
  '/js/vendor/vue.global.prod.js',
  '/picture/logo.jpg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
```

#### 步驟 13.3：在 index.html 加入引用

在 `<head>` 中加入：

```html
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#6366f1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="寶天醫館">
<link rel="apple-touch-icon" href="/picture/icon-192.png">

<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('SW registered'))
        .catch(err => console.log('SW failed:', err));
    });
  }
</script>
```

#### 步驟 13.4：部署 PWA

```bash
# 在本地
git add .
git commit -m "Add PWA support"
git push origin main

# 在伺服器上
ssh -i potin-key.pem ubuntu@你嘅IP
cd ~/booking-aurora
git pull origin main
docker compose up -d --build
```

#### 步驟 13.5：測試 PWA

在你嘅手機上：
1. 打開 Chrome/Safari
2. 訪問 `https://你嘅域名.com`
3. **Android**：點擊右上角 「⋮」→ 「新增至主畫面」
4. **iPhone**：點擊底部分享按鈕 → 「加入主畫面」
5. 確認 App 圖標出現在主屏幕

### 方案 B：React Native 原生 App（之後做，2-4 週）

#### 步驟 13.6：安裝開發環境

```bash
# 在你嘅電腦安裝
npm install -g expo-cli
npm install -g eas-cli

# 註冊 Expo 帳戶（免費）
# 去 https://expo.dev 註冊
```

#### 步驟 13.7：建立 App 項目

```bash
npx create-expo-app potin-clinic-app --template blank
cd potin-clinic-app
```

#### 步驟 13.8：連接 API

在 `App.js` 中連接你嘅 Node.js API：

```javascript
import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';

const API_BASE = 'https://你嘅域名.com';

export default function App() {
  const [services, setServices] = useState([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/settings/services`)
      .then(res => res.json())
      .then(data => setServices(data))
      .catch(err => console.error(err));
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>寶天醫館</Text>
      <FlatList
        data={services}
        keyExtractor={item => item.id.toString()}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <Text style={styles.itemTitle}>{item.name}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 20 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20 },
  item: { padding: 15, borderBottomWidth: 1, borderBottomColor: '#eee' },
  itemTitle: { fontSize: 18, fontWeight: 'bold' },
});
```

#### 步驟 13.9：構建 App

```bash
# 登入 Expo
eas login

# 建立構建配置
eas build:configure

# 構建 Android App
eas build --platform android --profile preview

# 構建 iOS App（需要 Mac）
eas build --platform ios --profile preview
```

#### 步驟 13.10：上架 App Store

| 平台 | 步驟 | 費用 | 時間 |
|------|------|------|------|
| **iOS** | Apple 開發者帳號 → App Store Connect → 提交審核 | $99/年 | 1-3 天 |
| **Android** | Google Play Console → 提交審核 | $25 一次性 | 1-3 天 |

### ⚠️ App 預警

> **PWA 限制：**
> - iOS 嘅 PWA 不支援推播通知
> - 離線緩存有限制
> - 建議 iOS 用戶用 App Store 版本
>
> **原生 App 成本：**
> - Apple 開發者帳號：$99/年（約 HK$775）
> - Google 開發者帳號：$25 一次性（約 HK$195）
> - 開發：免費（用 Expo）

---

## 14. 第十二部分：成本預算

### 月度成本估算（免費層級內）

| 服務 | 規格 | 免費額度 | 預計用量 | 月費 (USD) |
|------|------|---------|---------|-----------|
| EC2 t3.micro | 1 vCPU / 1GB RAM | 750 小時 | 730 小時 | $0（免費） |
| EBS gp3 | 20GB | 30GB | 20GB | $0（免費） |
| Data Transfer | 出站流量 | 100GB | ~10GB | $0（免費） |
| Route 53 | DNS | 100 萬次查詢 | ~1 萬次 | $0.50 |
| S3 | 備份存儲 | 5GB | ~1GB | $0.02 |
| CloudWatch | 基本監控 | 免費 | 1 個實例 | $0 |
| **網站合計** | | | | **~$0.52** |

### App 部署成本

| 項目 | PWA | 原生 App (iOS) | 原生 App (Android) |
|------|-----|---------------|-------------------|
| 開發 | 免費 | 免費 | 免費 |
| 上架 | 免費 | $99/年 | $25 一次性 |
| 維護 | 免費 | 免費 | 免費 |
| **首年合計** | **$0** | **$99** | **$25** |
| **之後每年** | **$0** | **$99** | **$0** |

### 總成本估算（第一年）

| 項目 | 月費 | 年費 |
|------|------|------|
| AWS 網站部署 | ~$0.52 | ~$6.24 |
| iOS App 上架 | - | $99 |
| Android App 上架 | - | $25 |
| **總計** | | **~$130.24**（約 HK$1,016） |

### 超出免費層級後

| 服務 | 單價 | 備註 |
|------|------|------|
| EC2 t3.micro | ~$0.0104/小時 | $7.60/月 |
| EBS gp3 | ~$0.08/GB/月 | 20GB = $1.60/月 |
| Data Transfer | ~$0.09/GB | 首 100GB 免費 |
| **合計** | | **~$9.20/月**（約 HK$72） |

### 💰 省錢技巧

1. **用 EC2 Savings Plans**：承諾 1 年可節省 30-40%
2. **用 Spot Instances**：可節省 60-90%，但可能被中斷（唔建議用喺生產）
3. **用 Reserved Instances**：提前支付 1 年可節省 40%
4. **定期檢查用量**：用 AWS Cost Explorer

---

## 14. 預警同常見陷阱

### 🚨 嚴重預警

| 預警 | 說明 | 如何避免 |
|------|------|---------|
| **意外費用** | AWS 按使用量收費，唔設上限 | 設定 AWS Budgets 告警 |
| **資料遺失** | EC2 實例被 terminate 會丟失所有資料 | 定期備份到 S3 |
| **安全漏洞** | SSH 開放俾所有人、密碼太弱 | 跟隨安全加固步驟 |
| **.pem 金鑰遺失** | 無法登入伺服器 | 妥善保管，備份多份 |
| **CAPTCHA 後門** | CAPTCHA_TEST_BYPASS 會關閉驗證碼防護 | 生產環境必須刪除 |
| **密碼外洩** | .env 文件被上傳到 GitHub | 確認 .gitignore 包含 .env |

### ⚠️ 常見陷阱

1. **EC2 實例停咗就冇咗資料**
   - SQLite 數據庫喺 EC2 本地磁碟
   - 解決：用 EBS volume + 定期 S3 備份

2. **免費層級到期後自動收費**
   - 解決：設預算告警，到期前評估是否繼續

3. **SSH 金鑰文件權限錯誤**
   - Windows 用戶用 PowerShell 嘅 `icacls` 設定
   - Mac/Linux 用 `chmod 400`

4. **Docker 鏡像太大**
   - Puppeteer 需要 Chrome，鏡像約 1GB
   - 解決：用 Docker layer cache

5. **域名 DNS 未生效**
   - DNS 傳播需要 24-48 小時
   - 解決：用 `nslookup` 檢查

---

## 15. 故障排除

### 問題 1：無法 SSH 連接

```bash
# 檢查安全組是否允許你嘅 IP
# 檢查實例是否在 Running 狀態
# 檢查 .pem 文件路徑是否正確
# Windows 用戶：確保用 PowerShell，唔係 CMD
```

### 問題 2：網站打唔開

```bash
# SSH 連接後檢查
docker compose ps          # 確認容器在運行
docker compose logs app     # 查看 app 日誌
docker compose logs caddy   # 查看 Caddy 日誌
curl http://localhost:4000  # 測試 app 是否正常
```

### 問題 3：HTTPS 證書錯誤

```bash
# 檢查域名 DNS 是否指向正確嘅 IP
nslookup 你嘅域名.com

# 檢查 Caddy 日誌
docker compose logs caddy

# 確保 port 80 同 443 在安全組中開放
```

### 問題 4：數據庫損壞

```bash
# 從 S3 恢復最新備份
aws s3 ls s3://你嘅bucket/backups/
aws s3 cp s3://你嘅bucket/backups/db-backup-YYYY-MM-DD.db ./data/database.db
docker compose restart app
```

---

## 16. 維運手冊

### 日常操作

```bash
# 查看服務狀態
docker compose ps

# 查看實時日誌
docker compose logs -f app

# 重啟服務
docker compose restart

# 停止服務
docker compose down

# 啟動服務
docker compose up -d
```

### 更新代碼

```bash
# 拉取最新代碼
git pull origin main

# 重新構建同部署
docker compose up -d --build

# 清理舊鏡像
docker image prune -f
```

### 手動備份

```bash
# 執行備份腳本
~/backup-aurora.sh

# 或手動備份數據庫
docker compose exec app node scripts/backup-db.js
```

### 查看成本

1. AWS Console → **「Cost Explorer」**
2. 選擇時間範圍
3. 檢視各服務嘅費用

---

## 附錄：完整部署命令速查

```bash
# ===== 首次部署 =====
# 1. 連接伺服器
ssh -i potin-key.pem ubuntu@你嘅IP

# 2. 安裝 Docker
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg lsb-release
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker

# 3. 部署應用
git clone https://github.com/你的用戶名/booking-aurora.git
cd booking-aurora
cp .env.example .env
nano .env  # 填寫配置
mkdir -p data logs backups
docker compose up -d --build
docker compose logs app  # 查看初始密碼

# ===== 日常維護 =====
docker compose ps                    # 查看狀態
docker compose logs -f app           # 實時日誌
docker compose restart               # 重啟
docker compose up -d --build         # 更新部署
~/backup-aurora.sh                   # 手動備份
```

---

> **最後提醒：** 呢份指南已經涵蓋 100% 部署所需。如果你喺任何步驟遇到問題，請截圖並描述你見到嘅錯誤，我可以幫你排查。
