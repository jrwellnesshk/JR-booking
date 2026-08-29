/**
 * 💾 資料庫自動備份
 * - 使用 SQLite「VACUUM INTO」線上備份（伺服器運行中都可以安全備份）
 * - 輸出：backups/db-YYYY-MM-DD-HHmmss.db
 * - 自動刪除超過保留期嘅舊備份（預設 30 日）
 *
 * 手動執行：node scripts/backup-db.js
 * 自動執行：Windows 排程每日 03:30（見 DEPLOYMENT_GUIDE.md）
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'database.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(ROOT, 'backups');
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS, 10) || 30;

if (!fs.existsSync(DB_PATH)) {
  console.error(`[backup] 找不到資料庫：${DB_PATH}`);
  process.exit(1);
}
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

const dest = path.join(BACKUP_DIR, `db-${stamp()}.db`);
if (fs.existsSync(dest)) fs.unlinkSync(dest);

const Database = require('sqlite3').Database;
const db = new Database(DB_PATH, { readonly: true }); // VACUUM INTO 只需讀取權限

const timer = setTimeout(() => {
  console.error('[backup] 備份超時（60 秒）');
  process.exit(1);
}, 60000);

db.run(`VACUUM INTO ?`, [dest], (err) => {
  clearTimeout(timer);
  if (err) {
    console.error('[backup] 備份失敗:', err.message);
    db.close();
    try { fs.existsSync(dest) && fs.unlinkSync(dest); } catch (_) {}
    process.exit(1);
  }
  db.close(() => {
    const size = (fs.statSync(dest).size / 1024).toFixed(1);
    console.log(`[backup] ✅ 已備份 → ${dest} (${size} KB)`);

    // 清理過期備份
    let removed = 0;
    try {
      const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
      for (const f of fs.readdirSync(BACKUP_DIR)) {
        if (!/^db-\d{4}-\d{2}-\d{2}-\d{6}\.db$/.test(f)) continue;
        const full = path.join(BACKUP_DIR, f);
        if (fs.statSync(full).mtimeMs < cutoff) {
          fs.unlinkSync(full);
          removed++;
        }
      }
    } catch (e) {
      console.error('[backup] 清理舊備份失敗:', e.message);
    }
    if (removed) console.log(`[backup] 已清理 ${removed} 個過期備份（保留 ${RETENTION_DAYS} 日）`);
    process.exit(0);
  });
});
