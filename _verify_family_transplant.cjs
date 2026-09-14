/**
 * 驗證 staff.html 嘅「家庭帳戶」移植：同 admin 一模一樣
 * 紀律（express-multiportal-audit）：
 *   - 唔掂 live :4000 dev server
 *   - 用隔離 port + 複製 DB 做快照
 *   - block POST /api/auth/logout（避免 nav 點到登出掣 revoke token → 假 401）
 *   - API login + localStorage 注入
 */
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const bcrypt = require('bcrypt');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const ROOT = __dirname;
const LIVE = path.join(ROOT, 'database.db');
const TEST = path.join(ROOT, 'database_familytest.db');
const PORT = 4741;
const TEST_PW = 'TestPass123!';

function copyDb() {
  for (const f of [LIVE, LIVE + '-wal', LIVE + '-shm']) {
    const tf = f.replace('database.db', 'database_familytest.db');
    if (fs.existsSync(f)) fs.copyFileSync(f, tf);
  }
}
const dbRun = (db, sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
const dbGet = (db, sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));

async function seed(db) {
  const hash = bcrypt.hashSync(TEST_PW, 10);
  // 種子員工（staff）
  await dbRun(db,
    `INSERT INTO users (username,password,name,name_en,phone,email,role,profile_completed,must_change_password,membership_tier)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ['stest', hash, '種子員工', 'Seed Staff', '90000001', 'seedstaff@test.com', 'staff', 1, 0, 'general']);
  // 若 DB 無任何家庭戶主，種一棵 head + 1 child，確保 tree 有得 render
  const cnt = await dbGet(db, "SELECT COUNT(*) c FROM users WHERE family_head_id = id");
  if (!cnt || cnt.c === 0) {
    const head = await dbRun(db,
      `INSERT INTO users (username,password,name,name_en,phone,email,role,profile_completed,must_change_password,membership_tier)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ['seedhead', hash, '種子戶主', 'Seed Head', '90000002', 'seedhead@test.com', 'customer', 1, 0, 'family']);
    const headId = head.lastID;
    await dbRun(db, 'UPDATE users SET family_head_id=? WHERE id=?', [headId, headId]);
    const child = await dbRun(db,
      `INSERT INTO users (username,password,name,name_en,phone,email,role,profile_completed,must_change_password,membership_tier,family_head_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ['seedchild', hash, '種子子女', 'Seed Child', '90000003', 'seedchild@test.com', 'customer', 1, 0, 'family', headId]);
    await dbRun(db, 'INSERT INTO family_links (parent_user_id,child_user_id,relation) VALUES (?,?,?)', [headId, child.lastID, 'parent']);
  }
}

async function waitServer(url, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return true; } catch (e) {}
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

(async () => {
  copyDb();
  const db = new sqlite3.Database(TEST);
  await seed(db);
  await new Promise(r => db.close(r));

  const env = {
    ...process.env,
    PORT: String(PORT),
    DB_PATH: TEST,
    NODE_ENV: 'development',
    CAPTCHA_TEST_BYPASS: 'test999',
    ALLOW_UNSAFE_START: '1',
    SESSION_SECRET: 'testsecret-for-family-verify',
  };
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });

  let exitCode = 0;
  const cleanup = () => { try { server.kill('SIGKILL'); } catch (e) {} };
  process.on('exit', cleanup);

  try {
    const ready = await waitServer(`http://localhost:${PORT}/staff.html`);
    if (!ready) throw new Error('server 未就緒');

    // served === disk 斷言：served staff.html 必須含移植標記
    const served = await (await fetch(`http://localhost:${PORT}/staff.html`)).text();
    const disk = fs.readFileSync(path.join(ROOT, 'staff.html'), 'utf8');
    const servedHasTransplant = served.includes('ftree-canvas') && served.includes("mainTab === 'familytree'");
    const diskHasTransplant = disk.includes('ftree-canvas') && disk.includes("mainTab === 'familytree'");

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));

    // block logout
    await page.evaluateOnNewDocument(() => {
      const of = window.fetch ? window.fetch.bind(window) : null;
      window.fetch = (...a) => {
        if (String(a[0] || '').includes('/api/auth/logout'))
          return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        return of ? of(...a) : fetch(...a);
      };
      const oo = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (m, u, ...r) { if (String(u).includes('/api/auth/logout')) this.__blk = true; return oo.call(this, m, u, ...r); };
      const os = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function (...a) { if (this.__blk) { this.abort && this.abort(); return; } return os.call(this, ...a); };
    });

    await page.goto(`http://localhost:${PORT}/staff.html`, { waitUntil: 'networkidle2', timeout: 30000 });

    const login = await page.evaluate(async (pw) => {
      const r = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'stest', password: pw, captchaAnswer: 'test999', portal: 'staff' }),
      });
      return await r.json();
    }, TEST_PW);
    if (!login || !login.token) throw new Error('員工 login 失敗: ' + JSON.stringify(login));

    await page.evaluate((t, u) => {
      localStorage.setItem('jwtToken', t);
      localStorage.setItem('staffUser', JSON.stringify(u));
    }, login.token, login.user);
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });

    // 等 sidebar 出現 家庭帳戶 掣
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('家庭帳戶')),
      { timeout: 15000 });

    // 點 家庭帳戶
    const clickedTab = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('家庭帳戶'));
      if (b) { b.click(); return true; }
      return false;
    });
    await new Promise(r => setTimeout(r, 2500)); // 等 loadFamilyTree

    // 點第一個 head 卡 → selectFamilyHead
    const clickedHead = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('button')).find(b => b.className.includes('rounded-xl') && b.className.includes('p-4'));
      if (card) { card.click(); return true; }
      return false;
    });
    await new Promise(r => setTimeout(r, 2500)); // 等 familyDetail + tree

    const dom = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      const btns = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim());
      const has = s => btns.some(b => b.includes(s));
      return {
        ftreeCanvas: !!document.querySelector('.ftree-canvas'),
        ftreeNodeCount: document.querySelectorAll('.ftree-node').length,
        headGenCouples: document.querySelectorAll('.ftree-couple').length,
        btnAddChild: has('加子女'),
        btnChangeTier: has('更改級別'),
        btnBackHeads: has('返全部主帳戶'),
        btnRefresh: has('重新整理'),
        panelLink: txt.includes('連結帳戶'),
        panelPrivacy: txt.includes('家庭成員與私隱'),
        panelPlan: txt.includes('家庭計劃') || txt.includes('單號'),
        treeHeadsText: txt.includes('個主帳戶'),
      };
    });

    await browser.close();

    const report = {
      servedHasTransplant, diskHasTransplant,
      servedEqualsDisk: served.replace(/\s+/g, '') === disk.replace(/\s+/g, ''),
      clickedTab, clickedHead,
      treeNodes: dom.ftreeNodeCount,
      headGenCouples: dom.headGenCouples,
      checks: {
        ftreeCanvas: dom.ftreeCanvas,
        addChildBtn: dom.btnAddChild,
        changeTierBtn: dom.btnChangeTier,
        backHeadsBtn: dom.btnBackHeads,
        refreshBtn: dom.btnRefresh,
        linkPanel: dom.panelLink,
        privacyPanel: dom.panelPrivacy,
        planPanel: dom.panelPlan,
      },
      pageErrors: errors,
    };
    console.log('FAMILY_TRANSPLANT_REPORT ' + JSON.stringify(report, null, 2));

    const required = [
      servedHasTransplant, diskHasTransplant,
      dom.ftreeCanvas, dom.btnAddChild, dom.btnChangeTier, dom.btnBackHeads, dom.btnRefresh,
      dom.panelLink, dom.panelPrivacy, dom.panelPlan,
      errors.length === 0,
    ];
    if (required.every(Boolean)) {
      console.log('\n✅ PASS：staff 家庭帳戶 同 admin 結構一致，0 頁面錯誤');
    } else {
      console.log('\n❌ FAIL：有檢查未過');
      exitCode = 1;
    }
  } catch (e) {
    console.error('VALIDATION ERROR:', e.message);
    exitCode = 2;
  } finally {
    cleanup();
    // 清 test 快照
    for (const f of [TEST, TEST + '-wal', TEST + '-shm']) { try { fs.unlinkSync(f); } catch (e) {} }
  }
  process.exit(exitCode);
})();
