#!/usr/bin/env bash
# =============================================================================
#  ec2-bootstrap.sh — 初始化全新 EC2（Ubuntu 24.04 LTS）以運行 booking-aurora
#  執行位置：EC2 實例（以 ubuntu 用戶登入後 sudo 執行）
#  用法：sudo ./ec2-bootstrap.sh
#
#  做啲乜：
#    1. 更新系統套件
#    2. 安裝 Docker Engine + Compose plugin（官方 repo）
#    3. 將 ubuntu 加入 docker group
#    4. 設時區 Asia/Hong_Kong
#    5. 開 2GB swap（t3.micro 1GB RAM 必做，否則 docker build 會 OOM）
#    6. ufw 防火牆：只開 22 / 80 / 443
#    7. unattended-upgrades 自動安全更新（自動重啟 = false）
#    8. fail2ban 防 SSH 暴力破解
#    9. 建立 /home/ubuntu/aurora 同 /var/backups/aurora
#
#  ⚠️ 安全設計：冇任何 rm -rf；ufw 先開 22 先好 enable，避免鎖死自己。
# =============================================================================
set -euo pipefail

TARGET_USER="${SUDO_USER:-ubuntu}"
APP_DIR="/home/${TARGET_USER}/aurora"
BACKUP_DIR="/var/backups/aurora"
SWAP_SIZE_MB="${SWAP_SIZE_MB:-2048}"

log()  { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m⚠\033[0m %s\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "請用 sudo 執行：sudo $0" >&2
  exit 1
fi

log "1/9 更新系統套件"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
ok "系統已更新"

log "2/9 安裝 Docker Engine + Compose plugin（官方 repo）"
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
ok "Docker 已安裝"

log "3/9 將 ${TARGET_USER} 加入 docker group"
usermod -aG docker "${TARGET_USER}"
warn "docker group 要登出再登入先生效（本腳本唔會幫你登出）"

log "4/9 設時區 Asia/Hong_Kong"
timedatectl set-timezone Asia/Hong_Kong
ok "$(timedatectl | grep 'Time zone')"

log "5/9 開 ${SWAP_SIZE_MB}MB swap"
if swapon --show | grep -q '/swapfile'; then
  ok "swap 已存在，跳過"
else
  fallocate -l "${SWAP_SIZE_MB}M" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count="${SWAP_SIZE_MB}"
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # 降低 swappiness，避免平時濫用 swap
  sysctl -w vm.swappiness=10 >/dev/null
  grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
  ok "swap 已建立：$(swapon --show | tail -1)"
fi

log "6/9 ufw 防火牆（22 / 80 / 443）"
apt-get install -y ufw
# 先開 SSH 先好 enable —— 順序唔可以倒轉，否則會鎖死自己
ufw allow 22/tcp   comment 'SSH'
ufw allow 80/tcp   comment 'HTTP (Caddy ACME challenge)'
ufw allow 443/tcp  comment 'HTTPS'
ufw --force enable
ok "$(ufw status | head -8)"

log "7/9 unattended-upgrades 自動安全更新（自動重啟 = false）"
apt-get install -y unattended-upgrades
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
# 明確關閉自動重啟：避免喺營業時間自己重啟
if grep -q 'Unattended-Upgrade::Automatic-Reboot' /etc/apt/apt.conf.d/50unattended-upgrades; then
  sed -i 's/^Unattended-Upgrade::Automatic-Reboot .*/Unattended-Upgrade::Automatic-Reboot "false";/' \
    /etc/apt/apt.conf.d/50unattended-upgrades
else
  echo 'Unattended-Upgrade::Automatic-Reboot "false";' >> /etc/apt/apt.conf.d/50unattended-upgrades
fi
ok "自動安全更新已啟，自動重啟已關"

log "8/9 fail2ban（SSH 暴力破解防護）"
apt-get install -y fail2ban
cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
port    = ssh
filter  = sshd
logpath = /var/log/auth.log
maxretry = 5
bantime  = 3600
findtime = 600
EOF
systemctl enable --now fail2ban
ok "fail2ban 狀態：$(systemctl is-active fail2ban)"

log "9/9 建立應用程式目錄"
mkdir -p "${APP_DIR}" "${BACKUP_DIR}"
chown -R "${TARGET_USER}:${TARGET_USER}" "${APP_DIR}" "${BACKUP_DIR}"
ok "${APP_DIR} 同 ${BACKUP_DIR} 已建立"

cat <<EOF

=============================================================================
 ✅ 初始化完成

 下一步（**一定要做**）：
   1. 登出再登入，等 docker group 生效：
        exit
        ssh aurora
   2. 驗證：
        docker --version
        docker compose version
        docker run --rm hello-world
        free -h          # 見到 Swap 有 ${SWAP_SIZE_MB}M
        sudo ufw status  # 22/80/443 ALLOW
   3. 跟住做 SSH 硬化（PermitRootLogin no / PasswordAuthentication no）：
        sudo tee /etc/ssh/sshd_config.d/50-aurora.conf >/dev/null <<'CONF'
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
CONF
        sudo sshd -t && sudo systemctl reload ssh
      ⚠️ 開個新 Terminal 視窗試連一次，確認入到先好關咗原本嗰個。

 ⚠️ Docker daemon 而家對住 127.0.0.1 聽緊；app container 只 expose 4000，
    對外只有 Caddy 嘅 80/443，唔好改。
=============================================================================
EOF
