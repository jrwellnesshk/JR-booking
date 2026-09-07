# 寶天醫館預約系統 - 生產映像（多階段建置）
#
# 設計重點：
#  1. 兩階段：builder 裝齊 build toolchain（python/make/g++ 畀 sqlite3 native build），
#     runtime 只帶執行需要嘅嘢 —— 最後一層連 tar / node-gyp 呢啲 build-only 套件都清走，
#     徹底移除 npm audit 報嘅 critical tar 漏洞（嗰啲只會喺 install 時用到）。
#  2. 非 root 執行（node user），減低容器逃逸嘅傷害。
#  3. HEALTHCHECK 對住 /health，配合 ALB / ECS 做健康探測。
#  4. PUPPETEER_SKIP_DOWNLOAD=1：puppeteer 只係本地 QA 截圖用，生產唔需要落 Chrome（慳 ~300MB）。

# ============================ Stage 1: builder ============================
FROM node:20-bookworm-slim AS builder

# build toolchain：sqlite3 冇 prebuilt binary 時要 node-gyp 編譯
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates python3 make g++ unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先 copy manifest，利用 Docker layer cache（source 改咗都唔使重裝 dependency）
COPY package*.json ./

# 有 lockfile 就用 ci（可重現）；冇就退返 install
RUN if [ -f package-lock.json ]; then npm ci --ignore-scripts; else npm install --ignore-scripts; fi

# 淨裝 runtime 需要嘅 native binding（--ignore-scripts 之後手動 build sqlite3）
RUN npm rebuild sqlite3

# ============================ Stage 2: runtime ============================
FROM node:20-bookworm-slim AS runtime

# runtime 只需要 SQLite 嘅系統 lib；唔好裝 build toolchain，攻擊面細好多
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates dumb-init sqlite3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 由 builder 攞已編譯好嘅 node_modules
COPY --from=builder --chown=node:node /app/node_modules ./node_modules

# 應用程式碼
COPY --chown=node:node package*.json ./
COPY --chown=node:node server.js ./
COPY --chown=node:node admin.html doctor.html staff.html hr.html index.html privacy.html ./
COPY --chown=node:node config ./config
COPY --chown=node:node routes ./routes
COPY --chown=node:node services ./services
COPY --chown=node:node middlewares ./middlewares
COPY --chown=node:node js ./js
COPY --chown=node:node css ./css
COPY --chown=node:node design ./design
COPY --chown=node:node picture ./picture

# 🔒 清走 build-only 套件：tar / node-gyp / cacache 只會喺 npm install 時用到，
#    喺 runtime 留低佢哋只會白蝕攻擊面（npm audit critical: tar <=7.5.20）。
#    應用程式從來冇 require 過佢哋，直接刪最乾淨。
RUN rm -rf node_modules/tar \
           node_modules/node-gyp \
           node_modules/cacache \
           node_modules/make-fetch-happen \
           node_modules/.bin/node-gyp \
  && mkdir -p logs data uploads \
  && chown -R node:node logs data uploads

ENV NODE_ENV=production \
    PORT=4000 \
    PUPPETEER_SKIP_DOWNLOAD=1

EXPOSE 4000

# 用非 root user 跑
USER node

# dumb-init 做 PID 1，正確轉發 SIGTERM（ECS/ALB 滾動部署要靠佢優雅關機）
ENTRYPOINT ["dumb-init", "--"]

# 健康檢查：對住 liveness 端點（唔掂 DB，唔會因為 DB 慢而誤殺 container）
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||4000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
