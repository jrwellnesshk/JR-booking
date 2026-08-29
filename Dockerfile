# 寶天醫館預約系統 - 生產映像
FROM node:20-bookworm-slim

# 系統依賴：puppeteer 跑 headless Chrome 需要呢啲 lib；sqlite3 / bcrypt 有 prebuild
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    unzip \
    fonts-liberation fonts-noto-cjk \
    libnss3 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
EXPOSE 4000

# puppeteer 喺 npm ci 時會落載 Chrome 到 ~/.cache/puppeteer
CMD ["node", "server.js"]
