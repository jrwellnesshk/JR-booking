/**
 * 📋 日誌輪轉服務
 * - console.log/info/warn/error 同步寫入 logs/app-YYYY-MM-DD.log（保留 stdout 原有行為）
 * - 每日一個檔案，自動刪除超過保留期嘅舊檔（預設 14 日）
 * - 捕捉 uncaughtException / unhandledRejection，避免 crash 訊息消失
 * 用法：喺 server.js 最頂（dotenv 之後）require 即可
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS, 10) || 14;

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const dateStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const timeStr = () => {
  const d = new Date();
  return `${dateStr(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

let currentDate = dateStr();
let stream = null;

const openStream = () => {
  currentDate = dateStr();
  const file = path.join(LOG_DIR, `app-${currentDate}.log`);
  stream = fs.createWriteStream(file, { flags: 'a' });
  stream.on('error', () => { stream = null; });
};

const getStream = () => {
  const today = dateStr();
  if (!stream || today !== currentDate) {
    if (stream) stream.end();
    openStream();
    pruneOldLogs();
  }
  return stream;
};

// 刪除超過保留期嘅日誌
const pruneOldLogs = () => {
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(LOG_DIR)) {
      if (!/^app-\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
      const full = path.join(LOG_DIR, f);
      const st = fs.statSync(full);
      if (st.mtimeMs < cutoff) fs.unlinkSync(full);
    }
  } catch (e) { /* 靜默：清理失敗不影響服務 */ }
};

const write = (level, args) => {
  try {
    const s = getStream();
    if (!s) return;
    const line = args.map(a => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'object') { try { return JSON.stringify(a); } catch (_) { return String(a); } }
      return String(a);
    }).join(' ');
    s.write(`[${timeStr()}] [${level}] ${line}\n`);
  } catch (e) { /* 靜默 */ }
};

// 包裝 console（保留原本 stdout/stderr 行為）
const orig = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

console.log = (...a) => { write('LOG', a); orig.log(...a); };
console.info = (...a) => { write('INFO', a); orig.info(...a); };
console.warn = (...a) => { write('WARN', a); orig.warn(...a); };
console.error = (...a) => { write('ERROR', a); orig.error(...a); };

// 捕捉未處理異常（記錄後照原樣輸出；唔吞 exception）
process.on('uncaughtException', (e) => {
  write('FATAL', ['Uncaught Exception:', e]);
  orig.error('❌ Uncaught Exception:', e);
});
process.on('unhandledRejection', (reason) => {
  write('FATAL', ['Unhandled Rejection:', reason]);
  orig.error('❌ Unhandled Rejection:', reason);
});

// 啟動時清理一次
pruneOldLogs();

module.exports = { logDir: LOG_DIR, retentionDays: RETENTION_DAYS };
