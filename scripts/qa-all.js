/**
 * 全功能測試統一入口（npm run qa）
 *
 * 點解要有呢個 runner：
 *  1. 測試需要 CAPTCHA_TEST_BYPASS 先登入到，但呢個係 P0 級生產後門，
 *     所以 .env 已經唔再帶佢 —— 呢度喺 in-process spawn 時先注入，生產完全唔受影響。
 *  2. server 同測試必須喺同一個 process tree / shell 內，否則分開嘅 shell 會喺
 *     唔同 network namespace，出 ECONNREFUSED。
 *  3. _qa_cross_test.js / _qa_ui_check.js 硬編 localhost:4000，所以統一喺 4000 起。
 *
 * 用法：npm run qa          （全部套件）
 *      npm run qa -- --only=cross
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3');
const bcrypt = require('bcrypt');

const ROOT = path.join(__dirname, '..');
const PORT = 4000;
const BASE = `http://localhost:${PORT}`;
const SECRET = process.env.SESSION_SECRET || 'qa-test-secret-do-not-use-in-prod';

const only = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];

// QA 數據庫放 temp 目錄（repo 喺 OneDrive，SQLite 檔會被雲端同步截斷）。
// 基準 master 由 data/database.db 快照製備：黃醫師／admin=aurora2026／開放註冊。每次跑先還原 live。
const QA_DIR = path.join(os.tmpdir(), 'opencode', 'qadb');
const QA_MASTER = path.join(QA_DIR, 'qa-master.db');
const QA_LIVE = path.join(QA_DIR, 'qa-live.db');

async function prepareQaDb() {
  if (process.env.DB_PATH) return;   // 有人指明 DB 就唔郁
  const base = path.join(ROOT, 'data', 'database.db');
  if (!fs.existsSync(base)) {
    console.error(`❌ 缺少基礎快照 ${base}，無法製備 QA 庫`);
    process.exit(1);
  }
  fs.mkdirSync(QA_DIR, { recursive: true });
  if (!fs.existsSync(QA_MASTER)) {
    fs.copyFileSync(base, QA_MASTER);
    const db = new sqlite3.Database(QA_MASTER);
    const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, (e) => e ? rej(e) : res()));
    await run('PRAGMA journal_mode=DELETE');
    await run("UPDATE doctors SET name='黃醫師' WHERE name='張醫師'");
    await run("UPDATE users SET password=?, must_change_password=0 WHERE username='admin'", [bcrypt.hashSync('aurora2026', 12)]);
    await run("UPDATE clinic_settings SET setting_value='true' WHERE setting_key='allow_public_registration'");
    await run("UPDATE clinic_settings SET setting_value='true' WHERE setting_key='email_notification_enabled'");
    await run("UPDATE clinic_settings SET setting_value='true' WHERE setting_key='whatsapp_notification_enabled'");
    await run('DELETE FROM login_attempts');
    await new Promise((res, rej) => db.close((e) => e ? rej(e) : res()));  // 等 flush 完先複製
    await sleep(200);
  }
  fs.copyFileSync(QA_MASTER, QA_LIVE);
  process.env.DB_PATH = QA_LIVE;
  console.log('✅ QA 庫已製備/還原 ->', QA_LIVE);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const waitServer = async (timeoutMs = 40000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const req = http.get(`${BASE}/health`, (res) => { res.resume(); resolve(res.statusCode === 200); });
      req.on('error', () => resolve(false));
      req.setTimeout(1500, () => { req.destroy(); resolve(false); });
    });
    if (ok) return true;
    await sleep(400);
  }
  return false;
};

const runSuite = (file) => new Promise((resolve) => {
  console.log(`\n${'='.repeat(64)}\n▶  ${file}\n${'='.repeat(64)}`);
  const p = spawn(process.execPath, [path.join(ROOT, file)], {
    cwd: ROOT,
    env: { ...process.env, CAPTCHA_TEST_BYPASS: 'test999', SESSION_SECRET: SECRET, PORT: String(PORT) },
    stdio: 'inherit',
  });
  p.on('exit', (code) => resolve({ file, code: code === null ? -1 : code }));
});

(async () => {
  await prepareQaDb();
  console.log('▶  啟動測試 server (NODE_ENV=development, port ' + PORT + ')...');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'development',
      CAPTCHA_TEST_BYPASS: 'test999',
      SESSION_SECRET: SECRET,
      DB_PATH: process.env.DB_PATH,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stderr.on('data', (d) => {
    const s = String(d);
    if (/error|Error|ERROR/.test(s)) process.stderr.write('[server] ' + s);
  });

  const up = await waitServer();
  if (!up) {
    console.error('❌ server 起唔到（40s timeout）');
    srv.kill('SIGKILL');
    process.exit(1);
  }
  console.log('✅ server ready\n');

  const suites = [];
  if (!only || only === 'cross') suites.push('_qa_cross_test.js');
  if (!only || only === 'ui') suites.push('_qa_ui_check.js');
  if (!only || only === 'smoke') suites.push('_qa_runtime_smoke.js');

  const results = [];
  for (const s of suites) results.push(await runSuite(s));

  srv.kill('SIGKILL');
  await sleep(300);

  console.log(`\n${'='.repeat(64)}\n  測試總結\n${'='.repeat(64)}`);
  results.forEach((r) => console.log(`  ${r.code === 0 ? '✅ PASS' : '❌ FAIL(' + r.code + ')'}  ${r.file}`));
  const failed = results.filter((r) => r.code !== 0);
  console.log(`${'='.repeat(64)}`);
  console.log(`  ${results.length - failed.length}/${results.length} 套件通過`);
  console.log(`${'='.repeat(64)}\n`);
  process.exit(failed.length ? 1 : 0);
})();
