# 寶天醫館 — AWS 部署腳本（PowerShell）
# 用於在本地電腦執行，自動化部分部署步驟
# 版本：v1.0 | 更新日期：2026-09-04

# ============================================================
# 使用方法：
# 1. 右鍵點擊此文件 → "使用 PowerShell 執行"
# 2. 或者在 PowerShell 中執行：.\deploy-aws.ps1
# ============================================================

# 設定
$EC2_IP = "你嘅EC2公開IP"  # ← 改成你嘅 IP
$PEM_FILE = "potin-key.pem"  # ← 改成你嘅 .pem 文件名
$DOMAIN = "你嘅域名.com"  # ← 改成你嘅域名
$PROJECT_DIR = "booking-aurora"

# 顏色函數
function Write-Step {
    param([string]$Step)
    Write-Host "`n=== $Step ===" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Msg)
    Write-Host "✓ $Msg" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Msg)
    Write-Host "⚠ $Msg" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Msg)
    Write-Host "✗ $Msg" -ForegroundColor Red
}

# ============================================================
# 第一部分：檢查先決條件
# ============================================================
Write-Step "第一部分：檢查先決條件"

# 檢查 SSH 是否可用
try {
    $sshVersion = ssh -V 2>&1
    Write-Success "SSH 已安裝：$sshVersion"
} catch {
    Write-Error "SSH 未安裝。請安裝 OpenSSH 或使用 PuTTY。"
    exit 1
}

# 檢查 .pem 文件是否存在
if (-not (Test-Path $PEM_FILE)) {
    Write-Error "找不到 $PEM_FILE 文件。請確認文件路徑。"
    exit 1
}
Write-Success "找到 .pem 金鑰文件"

# 檢查連接
Write-Host "測試與 EC2 嘅連接..."
$pingResult = Test-Connection -ComputerName $EC2_IP -Count 1 -Quiet
if ($pingResult) {
    Write-Success "EC2 伺服器可以連接"
} else {
    Write-Warning "無法 ping 通 EC2，但 SSH 可能仍然可以連接"
}

# ============================================================
# 第二部分：連接伺服器
# ============================================================
Write-Step "第二部分：連接伺服器"

Write-Host "正在連接 $EC2_IP..."
Write-Host "命令：ssh -i $PEM_FILE ubuntu@$EC2_IP"
Write-Host ""

# 提示用戶手動連接
Write-Host "請在打開嘅 SSH 連接中執行以下命令：" -ForegroundColor Yellow
Write-Host ""

$commands = @"
# ===== 首次部署 =====

# 1. 更新系統
sudo apt update && sudo apt upgrade -y

# 2. 安裝 Docker
sudo apt install -y ca-certificates curl gnupg lsb-release
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=`$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu `$(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker `$USER
newgrp docker

# 3. 驗證 Docker
docker run hello-world

# 4. 安裝 Git
sudo apt install -y git

# 5. 拉取代碼
git clone https://github.com/你的用戶名/$PROJECT_DIR.git
cd $PROJECT_DIR

# 6. 建立 .env
cp .env.example .env
SESSION_SECRET=`$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=`$SESSION_SECRET|" .env
sed -i "s|^SITE_DOMAIN=.*|SITE_DOMAIN=$DOMAIN|" .env
sed -i "s|^# CAPTCHA_TEST_BYPASS.*|# CAPTCHA_TEST_BYPASS 已刪除|" .env
nano .env  # 手動檢查同編輯

# 7. 建立目錄
mkdir -p data logs backups
chmod 700 .env
chmod 755 data logs backups

# 8. 編輯 Caddyfile
nano Caddyfile
# 改成：
# {
#     email admin@$DOMAIN
# }
# $DOMAIN {
#     encode gzip
#     header {
#         Strict-Transport-Security "max-age=31536000; includeSubDomains"
#         X-Content-Type-Options "nosniff"
#         Referrer-Policy "no-referrer"
#         -Server
#     }
#     request_body { max_size 20MB }
#     reverse_proxy app:4000
# }

# 9. 構建同啟動
docker compose up -d --build

# 10. 查看日誌
docker compose logs app | tail -50

# 11. 查看 admin 密碼
docker compose logs app | grep -i "admin"

# ===== PWA 部署 =====

# 12. 拉取最新代碼（包含 PWA）
git pull origin main

# 13. 重啟服務
docker compose up -d --build

# ===== 日常維護 =====

# 查看狀態
docker compose ps

# 查看日誌
docker compose logs -f app

# 重啟
docker compose restart

# 更新
git pull origin main
docker compose up -d --build
"@

Write-Host $commands -ForegroundColor White

# ============================================================
# 第三部分：提供快速操作
# ============================================================
Write-Step "第三部分：快速操作"

Write-Host "以下係常用嘅快速操作：" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. 連接伺服器：" -ForegroundColor Cyan
Write-Host "   ssh -i $PEM_FILE ubuntu@$EC2_IP"
Write-Host ""
Write-Host "2. 查看服務狀態：" -ForegroundColor Cyan
Write-Host "   ssh -i $PEM_FILE ubuntu@$EC2_IP 'cd ~/$PROJECT_DIR && docker compose ps'"
Write-Host ""
Write-Host "3. 查看日誌：" -ForegroundColor Cyan
Write-Host "   ssh -i $PEM_FILE ubuntu@$EC2_IP 'cd ~/$PROJECT_DIR && docker compose logs app | tail -50'"
Write-Host ""
Write-Host "4. 重啟服務：" -ForegroundColor Cyan
Write-Host "   ssh -i $PEM_FILE ubuntu@$EC2_IP 'cd ~/$PROJECT_DIR && docker compose restart'"
Write-Host ""
Write-Host "5. 更新部署：" -ForegroundColor Cyan
Write-Host "   ssh -i $PEM_FILE ubuntu@$EC2_IP 'cd ~/$PROJECT_DIR && git pull origin main && docker compose up -d --build'"
Write-Host ""

# ============================================================
# 第四部分：生成 SESSION_SECRET
# ============================================================
Write-Step "第四部分：生成 SESSION_SECRET"

$bytes = New-Object Byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$secret = [Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=')
Write-Success "生成嘅 SESSION_SECRET："
Write-Host $secret -ForegroundColor Green
Write-Host ""
Write-Host "請將呢個 secret 複製到 .env 文件中嘅 SESSION_SECRET 欄位" -ForegroundColor Yellow

# ============================================================
# 第五部分：完成
# ============================================================
Write-Step "完成！"
Write-Host ""
Write-Host "部署腳本已執行完畢。" -ForegroundColor Green
Write-Host ""
Write-Host "下一步：" -ForegroundColor Yellow
Write-Host "1. 按照上面嘅命令連接伺服器"
Write-Host "2. 在伺服器上執行部署命令"
Write-Host "3. 完成後訪問 https://$DOMAIN"
Write-Host ""
Write-Host "如果遇到問題，請截圖並描述錯誤。" -ForegroundColor Cyan
