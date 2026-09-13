/* _verify_healthprofile.cjs — 新功能「客人健康檔案」驗證
 * 範圍：
 *   A. 後端 API：客人自填 GET/PUT /me、醫護搜尋 /search、詳情 /user/:id、權限矩陣、輸入邊界
 *   B. 瀏覽器 smoke：四個門戶新 UI（index 我的健康檔案 section + staff/doctor/admin 客人檔案 tab）
 *      — in-DOM 模板打錯字會成頁白屏，必須真實渲染驗證
 * 隔離：VACUUM INTO 快照 + 獨立埠 4762，絕不觸摸 live DB / live dev server
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sqlite3 = require('sqlite3');
const bcrypt = require('bcrypt');

const ROOT = __dirname;
const PORT = 4762;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(ROOT, '_verify_hp.db');
const PW = 'Verify@2026';
const results = { tests: [], summary: { pass: 0, fail: 0 } };

function T(name, pass, detail) {
  results.tests.push({ name, pass, detail: String(detail).slice(0, 220) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${String(detail).slice(0, 160)}`);
  if (pass) results.summary.pass++; else results.summary.fail++;
}

const dbAll = (db, sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r || [])));
const dbGet = (db, sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));
const dbRun = (db, sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));

function snapshot() {
  return new Promise((resolve) => {
    const sdb = new sqlite3.Database(path.join(ROOT, 'database.db'), (e) => {
      if (e) return resolve(false);
      sdb.exec(`VACUUM INTO '${DB.replace(/\\/g, '/')}'`, (err) => { sdb.close(); resolve(!err); });
    });
  });
}

let srv = null, srvLog = '', srvErr = '';
function startServer() {
  srvLog = ''; srvErr = '';
  srv = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, CAPTCHA_TEST_BYPASS: 'test999', ALLOW_UNSAFE_START: '1', NODE_ENV: 'development', SESSION_SECRET: 'verify_hp_secret_0123456789' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', d => srvLog += d);
  srv.stderr.on('data', d => srvErr += d);
}
function stopServer() { if (srv) { try { srv.kill('SIGKILL'); } catch (e) {} srv = null; } }
process.on('exit', stopServer);

let reqCount = 0;
async function req(method, p, { token, body } = {}) {
  const h = {};
  if (token) h['Authorization'] = 'Bearer ' + token;
  h['X-Forwarded-For'] = `10.78.${Math.floor(reqCount / 250) % 200}.${(reqCount++ % 250) + 1}`;
  let b;
  if (body !== undefined) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  try {
    const r = await fetch(BASE + p, { method, headers: h, body: b });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch (e) {}
    return { status: r.status, text, json };
  } catch (e) { return { status: 0, text: 'FETCH_ERR ' + e.message, json: null }; }
}

async function loginRaw(username, portal) {
  return req('POST', '/api/auth/login', { body: { username, password: PW, captchaAnswer: 'test999', portal } });
}

(async () => {
  // ---------- 隔離設置 ----------
  for (const ext of ['', '-wal', '-shm']) { const f = DB + ext; if (fs.existsSync(f)) fs.unlinkSync(f); }
  let ok = false;
  for (let i = 0; i < 5 && !ok; i++) ok = await snapshot();
  if (!ok) { console.error('!! snapshot 失敗'); process.exit(1); }

  const db = new sqlite3.Database(DB);
  const hash = bcrypt.hashSync(PW, 10);
  const KNOWN = ['admin', 'teststaff', 'testdoctor', 'testcustomer', 'vlink1'];
  const uid = {};
  const cols = await dbAll(db, 'PRAGMA table_info(users)');
  const colNames = cols.map(c => c.name);
  for (const u of KNOWN) {
    await dbRun(db, 'UPDATE users SET password=?, must_change_password=0, profile_completed=1, is_active=1 WHERE username=?', [hash, u]);
    let r = await dbGet(db, 'SELECT id FROM users WHERE username=?', [u]);
    if (!r) {
      // live DB 冇呢個測試帳戶 → 按表結構插入
      const vals = { username: u, password: hash, name: '驗證' + u, role: 'customer', phone: '6' + String(Math.floor(1000000 + Math.random() * 8999999)).slice(0, 7), email: u + '@verify.test', member_no: 'HP' + String(Math.floor(1000 + Math.random() * 8999)), membership_tier: 'general', is_active: 1, must_change_password: 0, profile_completed: 1 };
      const useCols = colNames.filter(c => vals[c] !== undefined);
      const ir = await dbRun(db, `INSERT INTO users (${useCols.join(',')}) VALUES (${useCols.map(() => '?').join(',')})`, useCols.map(c => vals[c]));
      r = { id: ir.lastID };
    }
    uid[u] = r.id;
  }
  // 病歷摘要測試資料：testcustomer 一條病歷（含相片 2 張）
  await dbRun(db, "INSERT INTO medical_records (booking_id, user_id, doctor_user_id, record_date, diagnosis, treatment_plan, notes) VALUES (NULL, ?, ?, '2026-08-15', '心脾兩虛失眠', '針灸每週一次，共四週', '避免夜咖啡')", [uid.testcustomer, uid.testdoctor]);
  const mrId = (await dbGet(db, 'SELECT MAX(id) AS id FROM medical_records')).id;
  for (let i = 0; i < 2; i++) await dbRun(db, 'INSERT INTO medical_record_photos (medical_record_id, photo_file_path) VALUES (?, ?)', [mrId, `/uploads/medical_records/hp-test-${i}.jpg`]);
  await new Promise(r => db.close(r));

  startServer();
  let up = false;
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + '/health'); if (r.ok) { up = true; break; } } catch (e) {} await new Promise(r => setTimeout(r, 350)); }
  if (!up) { console.error('!! server 起唔來:', srvLog.slice(-400)); process.exit(1); }
  T('伺服器啟動（新路由 + 新表 migration）', true, `port ${PORT}`);

  const tok = {};
  for (const [u, portal] of [['admin', 'admin'], ['teststaff', 'staff'], ['testdoctor', 'doctor'], ['testcustomer', 'customer'], ['vlink1', 'customer']]) {
    const lr = await loginRaw(u, portal);
    if (lr.status === 200 && lr.json && lr.json.token) tok[u] = lr.json.token;
    else console.log(`  !! ${u} 登入失敗 ${lr.status} ${lr.text.slice(0, 100)}`);
  }

  // ---------- A. 後端 API ----------
  // A1 未登入
  {
    const r = await req('GET', '/api/health-profile/me');
    T('未登入 GET /me → 401', r.status === 401, `-> ${r.status}`);
    const s = await req('GET', '/api/health-profile/search?q=測試');
    T('未登入 GET /search → 401', s.status === 401, `-> ${s.status}`);
  }

  // A2 客人：空殼 → 填寫 → 讀回
  {
    const g0 = await req('GET', '/api/health-profile/me', { token: tok.testcustomer });
    T('客人 GET /me（未填）→ 200 空殼', g0.status === 200 && g0.json && g0.json.profile && g0.json.profile.chronic_conditions === '', `-> ${g0.status}`);

    const p1 = await req('PUT', '/api/health-profile/me', { token: tok.testcustomer, body: { chronic_conditions: '高血壓（10年）', long_term_medications: 'Metformin 500mg 每日兩次', medical_history: '2023 膽囊切除' } });
    T('客人 PUT /me（首次填寫）→ 200', p1.status === 200 && p1.json && p1.json.success, `-> ${p1.status} ${p1.text.slice(0, 60)}`);

    const g1 = await req('GET', '/api/health-profile/me', { token: tok.testcustomer });
    T('客人 GET /me 讀回三欄', g1.status === 200 && g1.json.profile.chronic_conditions === '高血壓（10年）' && g1.json.profile.long_term_medications.includes('Metformin') && g1.json.profile.medical_history.includes('膽囊'), JSON.stringify(g1.json.profile).slice(0, 100));

    const p2 = await req('PUT', '/api/health-profile/me', { token: tok.testcustomer, body: { chronic_conditions: '高血壓、糖尿病', long_term_medications: '', medical_history: '' } });
    const g2 = await req('GET', '/api/health-profile/me', { token: tok.testcustomer });
    T('客人 PUT /me（更新覆寫）', p2.status === 200 && g2.json.profile.chronic_conditions === '高血壓、糖尿病' && g2.json.profile.long_term_medications === '', g2.json.profile.chronic_conditions);

    // A3 超長輸入截斷
    const long = 'X'.repeat(8000);
    await req('PUT', '/api/health-profile/me', { token: tok.testcustomer, body: { chronic_conditions: long, long_term_medications: '', medical_history: '' } });
    const g3 = await req('GET', '/api/health-profile/me', { token: tok.testcustomer });
    T('超長輸入截斷至 5000', g3.json.profile.chronic_conditions.length === 5000, `len=${g3.json.profile.chronic_conditions.length}`);
    // 還原
    await req('PUT', '/api/health-profile/me', { token: tok.testcustomer, body: { chronic_conditions: '高血壓（10年）', long_term_medications: 'Metformin 500mg 每日兩次', medical_history: '2023 膽囊切除' } });
  }

  // A4 醫護搜尋（姓名 / 電話 / 會員編號 / ID / 萬用字元）
  {
    const custName = (await (await fetch(BASE + '/api/health-profile/user/' + uid.testcustomer, { headers: { Authorization: 'Bearer ' + tok.teststaff } })).json()).user.name;
    const s1 = await req('GET', '/api/health-profile/search?q=' + encodeURIComponent(custName.slice(0, 2)), { token: tok.teststaff });
    const hit1 = (s1.json.results || []).find(r => r.id === uid.testcustomer);
    T('員工搜尋（姓名前綴）命中 + has_profile=1', s1.status === 200 && hit1 && Number(hit1.has_profile) === 1, `results=${(s1.json.results || []).length} has_profile=${hit1 && hit1.has_profile}`);

    const s2 = await req('GET', '/api/health-profile/search?q=%25%25', { token: tok.testdoctor });
    T('醫師搜尋（% 萬用字元轉義）唔會 500', s2.status === 200, `-> ${s2.status} results=${s2.json && s2.json.results ? s2.json.results.length : 'n/a'}`);

    const s3 = await req('GET', '/api/health-profile/search?q=' + uid.testcustomer, { token: tok.admin });
    const hit3 = (s3.json.results || []).find(r => r.id === uid.testcustomer);
    T('管理員搜尋（user ID）命中', s3.status === 200 && !!hit3, `results=${(s3.json.results || []).length}`);

    const s4 = await req('GET', '/api/health-profile/search?q=', { token: tok.teststaff });
    T('空 q → 200 空結果', s4.status === 200 && (s4.json.results || []).length === 0, `-> ${s4.status}`);
  }

  // A5 醫護詳情（含病歷摘要 + 醫師名 + 相片數）
  {
    const d1 = await req('GET', '/api/health-profile/user/' + uid.testcustomer, { token: tok.teststaff });
    const rec = d1.json && d1.json.records && d1.json.records[0];
    T('員工詳情：基本資料 + 三欄 + 病歷摘要', d1.status === 200 && d1.json.user && d1.json.profile.chronic_conditions.includes('高血壓') && rec && rec.diagnosis === '心脾兩虛失眠', `user=${!!d1.json.user} records=${d1.json.records.length}`);
    T('病歷摘要帶醫師名 + 相片數', rec && rec.doctor_name && Number(rec.photo_count) === 2, `doctor=${rec && rec.doctor_name} photos=${rec && rec.photo_count}`);

    const d2 = await req('GET', '/api/health-profile/user/' + uid.testcustomer, { token: tok.testdoctor });
    T('醫師可查看', d2.status === 200, `-> ${d2.status}`);
    const d3 = await req('GET', '/api/health-profile/user/' + uid.testcustomer, { token: tok.admin });
    T('管理員可查看', d3.status === 200, `-> ${d3.status}`);
  }

  // A6 權限矩陣（負面）
  {
    const c1 = await req('GET', '/api/health-profile/search?q=測試', { token: tok.testcustomer });
    T('客人 GET /search → 403', c1.status === 403, `-> ${c1.status}`);
    const c2 = await req('GET', '/api/health-profile/user/' + uid.vlink1, { token: tok.testcustomer });
    T('客人 GET /user/:id → 403（睇唔到其他人）', c2.status === 403, `-> ${c2.status}`);
    const c3 = await req('GET', '/api/health-profile/user/' + uid.teststaff, { token: tok.teststaff });
    T('非 customer ID → 404', c3.status === 404, `-> ${c3.status}`);
    const c4 = await req('GET', '/api/health-profile/user/abc', { token: tok.teststaff });
    T('非數字 ID → 400', c4.status === 400, `-> ${c4.status}`);
    // 客人 A 唔可以改客人 B（token 只代表自己，PUT /me 天然隔離——驗證 PUT 只影響自己）
    const v = await req('PUT', '/api/health-profile/me', { token: tok.vlink1, body: { chronic_conditions: 'vlink1測試', long_term_medications: '', medical_history: '' } });
    const g = await req('GET', '/api/health-profile/me', { token: tok.testcustomer });
    T('PUT /me 只影響自己（vlink1 寫入唔影響 testcustomer）', v.status === 200 && g.json.profile.chronic_conditions.includes('高血壓'), `vlink1=${v.status} testcustomer=${g.json.profile.chronic_conditions.slice(0, 10)}`);
  }

  // A7 伺服器零 TypeError
  T('伺服器 stderr 零 TypeError', !/TypeError/.test(srvErr), srvErr.slice(0, 100) || '(empty)');

  // ---------- B. 瀏覽器 smoke（in-DOM 模板真實渲染）----------
  let browser = null;
  try {
    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

    async function smokePortal(file, lsSetupJs, checks, label) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push('PAGEERR ' + e.message));
      page.on('console', m => { if (m.type() === 'error' && !/favicon|net::ERR/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
      await page.evaluateOnNewDocument((src) => {
        // 封鎖 logout API（nav smoke 教訓：唔可以俾 smoke 點到登出 revoke token）
        const of = window.fetch;
        window.fetch = function (u, o) {
          const s = typeof u === 'string' ? u : (u && u.url) || '';
          if (s.includes('/api/auth/logout')) return new Response('{"blocked":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
          return of.apply(this, arguments);
        };
        eval(src);
      }, lsSetupJs);
      await page.goto(BASE + '/' + file, { waitUntil: 'networkidle2', timeout: 45000 }).catch(e => errors.push('GOTO ' + e.message));
      await new Promise(r => setTimeout(r, 2800));
      for (const [desc, fn] of checks) {
        const v = await page.evaluate(fn).catch(e => 'EVAL_ERR ' + e.message);
        T(`${label}：${desc}`, v === true, `-> ${typeof v === 'boolean' ? v : String(v).slice(0, 120)}`);
      }
      T(`${label}：零頁面錯誤`, errors.length === 0, errors.slice(0, 2).join(' | ') || '(clean)');
      await page.close();
    }

    // 客人：index.html 我嘅健康檔案 section（個人資料面板內，需要撳去 profile view）
    await smokePortal('index.html',
      `localStorage.setItem('jwtToken','${tok.testcustomer}');localStorage.setItem('lang','zh-TW');localStorage.setItem('currentMember',JSON.stringify({dbId:${uid.testcustomer},id:${uid.testcustomer},name:'測試客'}));`,
      [
        ['我的健康檔案 UI 存在', () => document.body.innerHTML.includes('我的健康檔案') || !!document.querySelector('.fa-heart-pulse')],
      ],
      'index.html（客人）');

    // 三個醫護門戶：客人檔案 tab 存在 + 撳入去渲染搜尋 UI
    const portalConf = [
      ['staff.html', 'staffUser', 'teststaff', 'staff'],
      ['doctor.html', 'doctorUser', 'testdoctor', 'doctor'],
      ['admin.html', 'adminUser', 'admin', 'admin'],
    ];
    for (const [file, lsKey, tokName, role] of portalConf) {
      const ls = `localStorage.setItem('jwtToken','${tok[tokName]}');localStorage.setItem('lang','zh-TW');localStorage.setItem('${lsKey}',JSON.stringify({id:${uid[tokName]},username:'${tokName}',name:'${tokName}',role:'${role}'}));`;
      await smokePortal(file, ls, [
        ['「客人檔案」導覽掣存在', () => [...document.querySelectorAll('aside button, .m-bnav button')].some(b => b.textContent.includes('客人檔案') || (b.textContent.trim() === '檔案'))],
        ['撳入客人檔案 tab → 搜尋 UI 渲染', () => {
          const btn = [...document.querySelectorAll('aside button, .m-bnav button')].find(b => b.textContent.includes('客人檔案') || b.textContent.trim() === '檔案');
          if (!btn) return false;
          btn.click();
          return new Promise(resolve => setTimeout(() => {
            const input = document.querySelector('input[placeholder*="搜尋客人"]');
            const hasHeader = document.body.innerHTML.includes('健康檔案') && document.body.innerHTML.includes('會員編號');
            resolve(!!input && hasHeader);
          }, 800));
        }],
      ], file);
    }
  } catch (e) {
    T('瀏覽器 smoke 環境', false, e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  stopServer();
  fs.writeFileSync(path.join(ROOT, '_verify_hp_results.json'), JSON.stringify(results, null, 2));
  console.log(`\n===== 總結：${results.summary.pass} PASS / ${results.summary.fail} FAIL =====`);
  process.exit(results.summary.fail ? 1 : 0);
})();
