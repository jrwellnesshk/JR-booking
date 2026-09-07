/**
 * 重設 admin 密碼（上線前必做 / 忘記密碼時急救）
 *
 * 背景：config/db.js 只會喺 users 表冇 admin 時，先用 .env 嘅 ADMIN_PASSWORD 種入去。
 * 所以一旦建過庫，改 .env 嘅 ADMIN_PASSWORD 係**唔會**生效嘅 —— 一定要用呢個 script 改。
 *
 * 用法：
 *   node scripts/reset-admin-password.js '新密碼'
 *   node scripts/reset-admin-password.js --generate        # 隨機生成並印出
 *   node scripts/reset-admin-password.js '新密碼' --user=admin2
 *
 * 安全：
 *   - 淨接受 bcrypt hash 寫入，絕不存明文
 *   - 密碼強度檢查（至少 12 位，含大小寫 + 數字）
 *   - 會自動備份舊 hash 到 backups/ 方便 rollback
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sqlite3 = require('sqlite3');

const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'database.db');

// 同 config/db.js 保持一致
let bcrypt;
try {
  bcrypt = require('bcrypt');
} catch (e) {
  bcrypt = require('bcryptjs');
}

const args = process.argv.slice(2);
const userArg = (args.find((a) => a.startsWith('--user=')) || '').split('=')[1] || 'admin';
const wantGenerate = args.includes('--generate');
const passwordArg = args.find((a) => !a.startsWith('--'));

const validateStrength = (pw) => {
  if (pw.length < 12) return '密碼至少 12 位';
  if (!/[a-z]/.test(pw)) return '密碼要含小寫英文字母';
  if (!/[A-Z]/.test(pw)) return '密碼要含大寫英文字母';
  if (!/[0-9]/.test(pw)) return '密碼要含數字';
  // 呢啲一睇就係懶密碼，直接擋
  const weak = ['admin123', 'password', '123456789012', 'AuroraDock3r!Test', 'changeme12345'];
  if (weak.includes(pw)) return '呢個係已知嘅預設 / 測試密碼，唔可以用';
  return null;
};

const main = async () => {
  let newPassword = passwordArg;

  if (wantGenerate || !newPassword) {
    newPassword = crypto.randomBytes(12).toString('base64url').replace(/[^A-Za-z0-9]/g, '') + 'A1x';
    console.log('ℹ️  未指定密碼，已隨機生成。');
  }

  const weakReason = validateStrength(newPassword);
  if (weakReason) {
    console.error(`❌ ${weakReason}`);
    console.error('   若坚持要用，請自己改 scripts/reset-admin-password.js 嘅 validateStrength（唔建議）。');
    process.exit(1);
  }

  if (!fs.existsSync(DB_PATH)) {
    console.error(`❌ 搵唔到資料庫：${DB_PATH}`);
    process.exit(1);
  }

  const db = new sqlite3.Database(DB_PATH);

  const getUser = () => new Promise((resolve, reject) => {
    db.get('SELECT id, username, password FROM users WHERE username=?', [userArg], (e, r) => e ? reject(e) : resolve(r));
  });

  const setPassword = (id, hash) => new Promise((resolve, reject) => {
    db.run('UPDATE users SET password=?, must_change_password=0 WHERE id=?', [hash, id], function (e) {
      e ? reject(e) : resolve(this.changes);
    });
  });

  try {
    const user = await getUser();
    if (!user) {
      console.error(`❌ 搵唔到用戶「${userArg}」`);
      db.close();
      process.exit(1);
    }

    // 備份舊 hash，方便 rollback
    const backupDir = path.join(ROOT, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `admin-hash-${userArg}-${stamp}.txt`);
    fs.writeFileSync(backupFile, `${userArg} 舊 hash（${stamp}）：\n${user.password}\n`, 'utf8');

    const hash = await bcrypt.hash(newPassword, 12);
    const changes = await setPassword(user.id, hash);

    if (changes !== 1) {
      console.error('❌ 更新失敗（影響行數 ' + changes + '）');
      db.close();
      process.exit(1);
    }

    console.log('✅ 密碼已重設');
    console.log(`   用戶：${userArg} (id=${user.id})`);
    console.log(`   舊 hash 已備份到：${path.relative(ROOT, backupFile)}`);
    console.log('');
    if (wantGenerate || !passwordArg) {
      console.log(`   新密碼：${newPassword}`);
      console.log('   ⚠️  只印呢一次，請立即存入密碼管理器。');
    } else {
      console.log('   新密碼：（你提供嗰個）');
    }
    console.log('');
    console.log('📌 記得：建過庫之後 .env 嘅 ADMIN_PASSWORD 已經唔會再生效，');
    console.log('   日後改密碼要再跑呢個 script。');
    db.close();
  } catch (e) {
    console.error('❌ 失敗：', e.message);
    db.close();
    process.exit(1);
  }
};

main();
