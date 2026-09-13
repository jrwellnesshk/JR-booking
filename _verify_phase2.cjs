/* _verify_phase2.cjs — 健康檔案 Phase 2（醫師／員工／管理員確認）驗證
 * 範圍：
 *   A. 後端：PUT /user/:id（三角色編輯並確認）、POST /user/:id/verify（只確認）、
 *      客人改動作廢確認標記、權限矩陣（客人 403 / 未登入 401 / 非 customer 404 / 非數字 400）、
 *      未填寫就 verify → 404、欄位截斷、stderr 零 TypeError
 *   B. 瀏覽器深度 smoke：三個醫護門戶真實操作（撳 tab → 輸入搜尋 → 撳查看 → 出現可編輯 textarea + 確認掣）
 *      + 客人端 index.html 確認徽章渲染
 * 隔離：VACUUM INTO 快照 + 獨立埠 4763，絕不觸摸 live DB / live dev server
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sqlite3 = require('sqlite3');
const bcrypt = require('bcrypt');

const ROOT = __dirname;
const PORT = 4763;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(ROOT, '_verify_p2.db');
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
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, CAPTCHA_TEST_BYPASS: 'test999', ALLOW_UNSAFE_START: '1', NODE_ENV: 'development', SESSION_SECRET: 'verify_p2_secret_0123456789' },
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
  h['X-Forwarded-For'] = `10.91.${Math.floor(reqCount / 250) % 200}.${(reqCount++ % 250) + 1}`;
  let b;
  if (body !== undefined) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  try {
    const r = await fetch(BASE + p, { method, headers: h, body: b });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch (e) {}
    return { status: r.status, text, json };
  } catch (e) { return { status: 0, text: 'FETCH_ERR ' + e.message, json: null }; }
}

(async () => {
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
      const vals = { username: u, password: hash, name: 'P2驗證' + u, role: 'customer', phone: '6' + String(Math.floor(1000000 + Math.random() * 8999999)).slice(0, 7), email: u + '@p2.test', member_no: 'P2' + String(Math.floor(1000 + Math.random() * 8999)), membership_tier: 'general', is_active: 1, must_change_password: 0, profile_completed: 1 };
      const useCols = colNames.filter(c => vals[c] !== undefined);
      const ir = await dbRun(db, `INSERT INTO users (${useCols.join(',')}) VALUES (${useCols.map(() => '?').join(',')})`, useCols.map(c => vals[c]));
      r = { id: ir.lastID };
    }
    uid[u] = r.id;
  }
  await new Promise(r => db.close(r));

  startServer();
  let up = false;
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + '/health'); if (r.ok) { up = true; break; } } catch (e) {} await new Promise(r => setTimeout(r, 350)); }
  if (!up) { console.error('!! server 起唔來:', srvLog.slice(-400)); process.exit(1); }

  const tok = {};
  for (const [u, portal] of [['admin', 'admin'], ['teststaff', 'staff'], ['testdoctor', 'doctor'], ['testcustomer', 'customer'], ['vlink1', 'customer']]) {
    const lr = await req('POST', '/api/auth/login', { body: { username: u, password: PW, captchaAnswer: 'test999', portal } });
    if (lr.status === 200 && lr.json && lr.json.token) tok[u] = lr.json.token;
    else console.log(`  !! ${u} 登入失敗 ${lr.status} ${lr.text.slice(0, 100)}`);
  }
  T('伺服器啟動（Phase 2 migration + 新端點）', true, `port ${PORT}`);

  // 確認 migration 已經加咗 Phase 2 欄位
  {
    const db2 = new sqlite3.Database(DB);
    const c = await dbAll(db2, 'PRAGMA table_info(customer_health_profiles)');
    const names = c.map(x => x.name);
    await new Promise(r => db2.close(r));
    T('migration 新增 verified_by / verified_at / updated_by', names.includes('verified_by') && names.includes('verified_at') && names.includes('updated_by'), names.join(','));
  }

  const CUST = uid.testcustomer;
  const profileOf = async (token) => (await req('GET', '/api/health-profile/user/' + CUST, { token })).json.profile;

  // ---- B1 客人自填 → 未確認 ----
  {
    const p = await req('PUT', '/api/health-profile/me', { token: tok.testcustomer, body: { chronic_conditions: '高血壓', long_term_medications: 'Amlodipine 5mg', medical_history: '無' } });
    const g = await req('GET', '/api/health-profile/me', { token: tok.testcustomer });
    T('客人自填後 verified_at = null（未確認）', p.status === 200 && g.json.profile.verified_at === null, `verified_at=${g.json.profile.verified_at}`);
  }

  // ---- B2 醫師編輯 → 標記 doctor ----
  {
    const r = await req('PUT', '/api/health-profile/user/' + CUST, { token: tok.testdoctor, body: { chronic_conditions: '高血壓（醫師補充）', long_term_medications: 'Amlodipine 5mg', medical_history: '無' } });
    const pf = await profileOf(tok.teststaff);
    T('醫師 PUT /user/:id → 200 + verified', r.status === 200 && r.json.verified === true, `-> ${r.status} verified=${r.json && r.json.verified}`);
    T('確認標記帶醫師身分（role=doctor + 姓名）', pf.verified_by_role === 'doctor' && !!pf.verified_at && !!pf.verified_by_name, `role=${pf.verified_by_role} by=${pf.verified_by_name} at=${pf.verified_at}`);
    T('醫師修改內容已寫入', pf.chronic_conditions === '高血壓（醫師補充）', pf.chronic_conditions);
  }

  // ---- B3 客人改內容 → 確認作廢 ----
  {
    const r = await req('PUT', '/api/health-profile/me', { token: tok.testcustomer, body: { chronic_conditions: '高血壓、糖尿病', long_term_medications: 'Amlodipine 5mg', medical_history: '無' } });
    const g = await req('GET', '/api/health-profile/me', { token: tok.testcustomer });
    T('客人改內容 → 確認標記自動作廢', r.json.verification_kept === false && g.json.profile.verified_at === null, `kept=${r.json.verification_kept} verified_at=${g.json.profile.verified_at}`);

    // 客人「內容不變」再儲存 → 標記唔會被誤清（先用員工確認，再測）
    await req('PUT', '/api/health-profile/user/' + CUST, { token: tok.teststaff, body: { chronic_conditions: '高血壓、糖尿病', long_term_medications: 'Amlodipine 5mg', medical_history: '無' } });
    const same = await req('PUT', '/api/health-profile/me', { token: tok.testcustomer, body: { chronic_conditions: '高血壓、糖尿病', long_term_medications: 'Amlodipine 5mg', medical_history: '無' } });
    const g2 = await req('GET', '/api/health-profile/me', { token: tok.testcustomer });
    T('客人原內容再儲存 → 確認標記保留', same.json.verification_kept === true && !!g2.json.profile.verified_at, `kept=${same.json.verification_kept} verified_at=${g2.json.profile.verified_at}`);
  }

  // ---- B4 員工 / 管理員 ----
  {
    const rs = await req('PUT', '/api/health-profile/user/' + CUST, { token: tok.teststaff, body: { chronic_conditions: '高血壓（員工補充）', long_term_medications: '', medical_history: '' } });
    let pf = await profileOf(tok.admin);
    T('員工可編輯並確認（role=staff）', rs.status === 200 && pf.verified_by_role === 'staff', `-> ${rs.status} role=${pf.verified_by_role}`);

    const rv = await req('POST', '/api/health-profile/user/' + CUST + '/verify', { token: tok.admin });
    pf = await profileOf(tok.teststaff);
    T('管理員 POST /verify 只確認內容（role=admin）', rv.status === 200 && pf.verified_by_role === 'admin', `-> ${rv.status} role=${pf.verified_by_role}`);
    T('verify 唔改內容', pf.chronic_conditions === '高血壓（員工補充）', pf.chronic_conditions);
  }

  // ---- B5 權限矩陣（負面）----
  {
    const c1 = await req('PUT', '/api/health-profile/user/' + uid.vlink1, { token: tok.testcustomer, body: { chronic_conditions: 'x' } });
    T('客人 PUT /user/:id → 403', c1.status === 403, `-> ${c1.status}`);
    const c2 = await req('POST', '/api/health-profile/user/' + CUST + '/verify', { token: tok.testcustomer });
    T('客人 POST /verify → 403', c2.status === 403, `-> ${c2.status}`);
    const n1 = await req('PUT', '/api/health-profile/user/' + CUST, { body: { chronic_conditions: 'x' } });
    T('未登入 PUT /user/:id → 401', n1.status === 401, `-> ${n1.status}`);
    const n2 = await req('POST', '/api/health-profile/user/' + CUST + '/verify');
    T('未登入 POST /verify → 401', n2.status === 401, `-> ${n2.status}`);
    const n3 = await req('PUT', '/api/health-profile/user/' + uid.teststaff, { token: tok.admin, body: { chronic_conditions: 'x' } });
    T('非 customer ID → 404', n3.status === 404, `-> ${n3.status}`);
    const n4 = await req('PUT', '/api/health-profile/user/abc', { token: tok.admin, body: { chronic_conditions: 'x' } });
    T('非數字 ID → 400', n4.status === 400, `-> ${n4.status}`);
    const n5 = await req('POST', '/api/health-profile/user/' + uid.vlink1 + '/verify', { token: tok.testdoctor });
    T('未填寫檔案就 verify → 404（唔會憑空產生）', n5.status === 404, `-> ${n5.status} ${n5.text.slice(0, 40)}`);
  }

  // ---- B6 邊界 ----
  {
    const long = 'Y'.repeat(9000);
    await req('PUT', '/api/health-profile/user/' + CUST, { token: tok.admin, body: { chronic_conditions: long, long_term_medications: '', medical_history: '' } });
    const pf = await profileOf(tok.admin);
    T('醫護端超長輸入截斷至 5000', pf.chronic_conditions.length === 5000, `len=${pf.chronic_conditions.length}`);
    const e1 = await req('PUT', '/api/health-profile/user/' + CUST, { token: tok.admin, body: {} });
    T('空 body → 200（三欄清空，唔 500）', e1.status === 200, `-> ${e1.status}`);
  }

  T('伺服器 stderr 零 TypeError', !/TypeError/.test(srvErr), srvErr.slice(0, 120) || '(empty)');

  // ---- B7 瀏覽器深度 smoke ----
  let browser = null;
  try {
    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

    async function deepSmoke(file, lsKey, tokName, role, custName) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push('PAGEERR ' + e.message));
      page.on('console', m => { if (m.type() === 'error' && !/favicon|net::ERR/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
      await page.evaluateOnNewDocument((src) => {
        const of = window.fetch;
        window.fetch = function (u, o) {
          const s = typeof u === 'string' ? u : (u && u.url) || '';
          if (s.includes('/api/auth/logout')) return new Response('{"blocked":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
          return of.apply(this, arguments);
        };
        eval(src);
      }, `localStorage.setItem('jwtToken','${tok[tokName]}');localStorage.setItem('lang','zh-TW');localStorage.setItem('${lsKey}',JSON.stringify({id:${uid[tokName]},username:'${tokName}',name:'${tokName}',role:'${role}'}));`);
      await page.goto(BASE + '/' + file, { waitUntil: 'networkidle2', timeout: 45000 }).catch(e => errors.push('GOTO ' + e.message));
      await new Promise(r => setTimeout(r, 2800));

      // 1) 撳「客人檔案」tab
      const tabClicked = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('aside button, .m-bnav button')].find(b => b.textContent.includes('客人檔案') || b.textContent.trim() === '檔案');
        if (!btn) return false;
        btn.click();
        return true;
      });
      T(`${file}：撳入「客人檔案」tab`, tabClicked === true, `-> ${tabClicked}`);
      await new Promise(r => setTimeout(r, 700));

      // 2) 輸入客人名並搜尋
      await page.evaluate((name) => {
        const input = document.querySelector('input[placeholder*="搜尋客人"]');
        if (!input) return;
        input.value = name;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const btns = [...document.querySelectorAll('button')];
        const sb = btns.find(b => b.textContent.includes('搜尋') && !b.textContent.includes('客人（'));
        if (sb) sb.click();
      }, custName);
      await new Promise(r => setTimeout(r, 1600));

      // 3) 撳「查看」
      const viewed = await page.evaluate((name) => {
        const rows = [...document.querySelectorAll('tbody tr')];
        const row = rows.find(r => r.textContent.includes(name)) || rows[0];
        if (!row) return 'no-row';
        const btn = [...row.querySelectorAll('button')].find(b => b.textContent.includes('查看'));
        if (!btn) return 'no-view-btn';
        btn.click();
        return true;
      }, custName);
      T(`${file}：搜尋結果撳「查看」`, viewed === true, `-> ${viewed}`);
      await new Promise(r => setTimeout(r, 1800));

      // 4) 詳情面板：三個 textarea + 兩個掣 + 確認徽章
      const checks = await page.evaluate(() => ({
        textareas: document.querySelectorAll('textarea').length,
        saveBtn: [...document.querySelectorAll('button')].some(b => b.textContent.includes('儲存並確認')),
        verifyBtn: [...document.querySelectorAll('button')].some(b => b.textContent.includes('確認內容無誤')),
        badge: document.body.innerHTML.includes('已確認') || document.body.innerHTML.includes('未確認'),
      }));
      T(`${file}：詳情有三個可編輯欄位`, checks.textareas >= 3, `textareas=${checks.textareas}`);
      T(`${file}：有「儲存並確認」+「確認內容無誤」掣`, checks.saveBtn && checks.verifyBtn, `save=${checks.saveBtn} verify=${checks.verifyBtn}`);
      T(`${file}：顯示確認狀態徽章`, checks.badge === true, `-> ${checks.badge}`);

      // 5) 真實撳「確認內容無誤」→ 徽章變已確認
      const afterVerify = await page.evaluate(async () => {
        const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('確認內容無誤'));
        if (!btn) return 'no-btn';
        btn.click();
        await new Promise(r => setTimeout(r, 1800));
        return document.body.innerHTML.includes('已確認');
      });
      T(`${file}：撳「確認內容無誤」→ 顯示已確認`, afterVerify === true, `-> ${afterVerify}`);

      T(`${file}：零頁面錯誤`, errors.length === 0, errors.slice(0, 2).join(' | ') || '(clean)');
      await page.close();
    }

    const custName = (await (await fetch(BASE + '/api/health-profile/user/' + CUST, { headers: { Authorization: 'Bearer ' + tok.teststaff } })).json()).user.name;
    for (const [file, lsKey, tokName, role] of [
      ['staff.html', 'staffUser', 'teststaff', 'staff'],
      ['doctor.html', 'doctorUser', 'testdoctor', 'doctor'],
      ['admin.html', 'adminUser', 'admin', 'admin'],
    ]) {
      await deepSmoke(file, lsKey, tokName, role, custName);
    }

    // 客人端：確認徽章
    {
      const page = await browser.newPage();
      const errors = [];
      const bad = [];
      page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().replace(BASE, '')); });
      page.on('pageerror', e => errors.push('PAGEERR ' + e.message));
      await page.evaluateOnNewDocument((src) => { eval(src); },
        // 客人登入狀態係 userToken（id=username, dbId）+ jwtToken
        // 客人端會因為 localStorage 殘留 adminUser/adminToken 而自動跳 admin.html（js/app.js 既有邏輯），
        // 所以開頁前要先清走其他門戶嘅 key，模擬「乾淨瀏覽器」。
        `['adminToken','adminUser','staffToken','staffUser','doctorToken','doctorUser','hrToken','hrUser'].forEach(k=>localStorage.removeItem(k));` +
        `localStorage.setItem('jwtToken','${tok.testcustomer}');localStorage.setItem('lang','zh-TW');localStorage.setItem('userToken',JSON.stringify({id:'testcustomer',dbId:${CUST},name:'測試客',phone:'61234567',email:'hp@test',memberLevel:'一般會員',profile_completed:1}));`);
      await page.goto(BASE + '/index.html', { waitUntil: 'networkidle2', timeout: 45000 }).catch(e => errors.push('GOTO ' + e.message));
      await new Promise(r => setTimeout(r, 3500));
      // 健康檔案 section 位於「我的設定／個人資料」view，要先撳入去（輪詢：等 Vue mount 完 + 掣出現）
      let navOk = false;
      for (let i = 0; i < 10 && !navOk; i++) {
        navOk = await page.evaluate(() => {
          if (document.body.innerHTML.includes('我的健康檔案')) return true;
          const btn = [...document.querySelectorAll('button, a')]
            .find(e => e.textContent.replace(/\s+/g, '').includes('設定') && e.querySelector('.fa-user-cog'));
          if (btn) { btn.click(); return false; }
          return false;
        });
        if (!navOk) await new Promise(r => setTimeout(r, 900));
      }
      T('index.html：撳入「我的設定」view', navOk === true, `-> ${navOk}`);
      {
        const dump = await page.evaluate(() => ({
          jwt: (localStorage.getItem('jwtToken') || '').slice(0, 24),
          user: localStorage.getItem('userToken'),
          cog: [...document.querySelectorAll('button, a')].filter(e => e.querySelector('.fa-user-cog')).length,
          setBtns: [...document.querySelectorAll('button, a')].filter(e => e.textContent.includes('設定')).map(e => e.tagName + ':' + e.textContent.trim().slice(0, 20)),
          bodyLen: document.body.innerHTML.length,
          head: document.body.innerHTML.slice(0, 600),
        }));
        dump.badResponses = bad;
        dump.errors = errors;
        dump.tokenUsed = (tok.testcustomer || '').slice(0, 24);
        dump.custId = CUST;
        fs.writeFileSync(path.join(ROOT, '_idx_dump.json'), JSON.stringify(dump, null, 2));
      }
      await new Promise(r => setTimeout(r, 1200));
      const badge = await page.evaluate(() => ({
        hasSection: document.body.innerHTML.includes('我的健康檔案'),
        verified: document.body.innerHTML.includes('已確認'),
        unverified: document.body.innerHTML.includes('尚未經診所職員確認'),
      }));
      T('index.html：我的健康檔案 section 渲染', badge.hasSection === true, `-> ${badge.hasSection}`);
      T('index.html：顯示確認狀態（已確認 或 尚未確認）', badge.verified || badge.unverified, `verified=${badge.verified} unverified=${badge.unverified}`);
      T('index.html：零頁面錯誤', errors.length === 0, errors.slice(0, 2).join(' | ') || '(clean)');
      await page.close();
    }
  } catch (e) {
    T('瀏覽器 smoke 環境', false, e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  stopServer();
  fs.writeFileSync(path.join(ROOT, '_verify_phase2_results.json'), JSON.stringify(results, null, 2));
  console.log(`\n===== 總結：${results.summary.pass} PASS / ${results.summary.fail} FAIL =====`);
  process.exit(results.summary.fail ? 1 : 0);
})();
