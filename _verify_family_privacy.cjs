/**
 * 驗證客人會員中心的家庭子帳戶功能：
 *   Req1：會員中心頂部顯眼登出掣
 *   Req2：子帳戶喺會員中心可見 + 授權設定入口 + 連結帳戶入口
 *   Req3：授權設定頁（18+ 三類細分開關；可切換）
 *   Req4：未滿18歲強制開放（戶主見全部；子帳戶見鎖定提示）；18+ 授權控制
 *
 * 紀律（express-multiportal-audit）：
 *   - 唔掂 live :4000 dev server
 *   - 隔離 port + 複製 DB 做快照
 *   - block POST /api/auth/logout（避免 nav 點到登出掣 revoke token → 假 401）
 *   - API login + localStorage 注入（jwtToken + userToken）
 */
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const bcrypt = require('bcrypt');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const ROOT = __dirname;
const LIVE = path.join(ROOT, 'database.db');
const TEST = path.join(ROOT, 'database_fampriv_test.db');
const PORT = 4742;
const TEST_PW = 'TestPass123!';

function copyDb() {
  for (const f of [LIVE, LIVE + '-wal', LIVE + '-shm']) {
    const tf = f.replace('database.db', 'database_fampriv_test.db');
    if (fs.existsSync(f)) fs.copyFileSync(f, tf);
  }
}
const dbRun = (db, sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
const dbGet = (db, sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));

async function ensureCols(db) {
  const cols = await new Promise((res, rej) => db.all("PRAGMA table_info(users)", (e, r) => e ? rej(e) : res(r || [])));
  const names = cols.map(c => c.name);
  for (const n of ['hide_medical_from_head', 'hide_booking_from_head', 'hide_profile_from_head', 'hide_from_head']) {
    if (!names.includes(n)) await dbRun(db, `ALTER TABLE users ADD COLUMN ${n} INTEGER DEFAULT 0`);
  }
}

async function seed(db) {
  const hash = bcrypt.hashSync(TEST_PW, 10);
  const ins = `INSERT INTO users (username,password,name,name_en,phone,email,role,profile_completed,must_change_password,membership_tier)
               VALUES (?,?,?,?,?,?,?,?,?,?)`;
  // 戶主
  const head = await dbRun(db, ins, ['fhead', hash, '戶主阿明', 'Head', '91000001', 'fhead@test.com', 'customer', 1, 0, 'family']);
  const headId = head.lastID;
  await dbRun(db, 'UPDATE users SET family_head_id=? WHERE id=?', [headId, headId]);
  // 子帳戶 A：未成年（2015）→ 強制開放
  const a = await dbRun(db, ins, ['fchildA', hash, '細仔小明', 'KidA', '91000002', 'fchildA@test.com', 'customer', 1, 0, 'family']);
  await dbRun(db, `UPDATE users SET family_head_id=?, birth_date='2015-06-01',
               hide_medical_from_head=0, hide_booking_from_head=0, hide_profile_from_head=0, hide_from_head=0 WHERE id=?`,
    [headId, a.lastID]);
  // 子帳戶 B：成年（1990）→ 三類全關閉（戶主不可見）
  const b = await dbRun(db, ins, ['fchildB', hash, '家姐美美', 'KidB', '91000003', 'fchildB@test.com', 'customer', 1, 0, 'family']);
  await dbRun(db, `UPDATE users SET family_head_id=?, birth_date='1990-01-01',
               hide_medical_from_head=1, hide_booking_from_head=1, hide_profile_from_head=1, hide_from_head=1 WHERE id=?`,
    [headId, b.lastID]);
  // 子帳戶 C：成年（1985）→ 三類全開放（戶主可見，但無資料）
  const c = await dbRun(db, ins, ['fchildC', hash, '家兄大強', 'KidC', '91000004', 'fchildC@test.com', 'customer', 1, 0, 'family']);
  await dbRun(db, `UPDATE users SET family_head_id=?, birth_date='1985-01-01',
               hide_medical_from_head=0, hide_booking_from_head=0, hide_profile_from_head=0, hide_from_head=0 WHERE id=?`,
    [headId, c.lastID]);
  // family_links
  for (const cid of [a.lastID, b.lastID, c.lastID]) {
    await dbRun(db, 'INSERT INTO family_links (parent_user_id,child_user_id,relation) VALUES (?,?,?)', [headId, cid, 'parent']);
  }
  // 為細仔小明（A）種一單預約 + 一張病歷，俾戶主睇真數據
  const bk = await dbRun(db, `INSERT INTO bookings (user_id,service_id,doctor_name,appointment_date,appointment_time,status)
               VALUES (?,?,?,?,?,?)`, [a.lastID, 'S1', '張醫師', '2026-09-20', '10:00', 'confirmed']);
  await dbRun(db, `INSERT INTO medical_records (booking_id,user_id,doctor_user_id,record_date,diagnosis,treatment_plan,notes)
               VALUES (?,?,?,?,?,?,?)`, [bk.lastID, a.lastID, headId, '2026-09-20', '感冒發燒', '多飲水休息', '種子測試']);
  return { headId, aId: a.lastID, bId: b.lastID, cId: c.lastID };
}

async function waitServer(url, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return true; } catch (e) {}
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

// 以指定帳戶登入並注入 localStorage，reload 返會員中心
async function loginAs(page, username) {
  const login = await page.evaluate(async (u, pw) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: pw, captchaAnswer: 'test999' }),
    });
    return await r.json();
  }, username, TEST_PW);
  if (!login || !login.token) throw new Error(`login 失敗(${username}): ` + JSON.stringify(login));
  await page.evaluate((t, u) => {
    localStorage.setItem('jwtToken', t);
    localStorage.setItem('userToken', JSON.stringify({
      id: u.username, dbId: u.id, name: u.name, phone: u.phone, email: u.email || '',
      memberLevel: '家庭會員', profile_completed: 1, days_remaining: null, must_change_password: false,
    }));
  }, login.token, login.user);
  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  // 入會員中心
  const clicked = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => (x.textContent || '').includes('會員中心'));
    if (b) { b.click(); return true; }
    return false;
  });
  await new Promise(r => setTimeout(r, 1800)); // 等 loadMyMembership + family
  return clicked;
}

(async () => {
  copyDb();

  const env = {
    ...process.env,
    PORT: String(PORT),
    DB_PATH: TEST,
    NODE_ENV: 'development',
    CAPTCHA_TEST_BYPASS: 'test999',
    ALLOW_UNSAFE_START: '1',
    SESSION_SECRET: 'testsecret-fampriv-verify',
  };
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });

  let exitCode = 0;
  const cleanup = () => { try { server.kill('SIGKILL'); } catch (e) {} };
  process.on('exit', cleanup);

  const report = { head: {}, subAdult: {}, subMinor: {}, pageErrors: [] };
  try {
    const ready = await waitServer(`http://localhost:${PORT}/index.html`);
    if (!ready) throw new Error('server 未就緒');

    // 等 migrations 加欄位，再種子測試資料
    await new Promise(r => setTimeout(r, 2000));
    const db = new sqlite3.Database(TEST);
    await ensureCols(db);
    await seed(db);
    await new Promise(r => db.close(r));
    await new Promise(r => setTimeout(r, 500));

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const errors = [];
    const famResponses = [];
    page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('response', r => { if (r.url().includes('/api/membership/family/')) famResponses.push(r.status() + ' ' + r.url()); });
    // block logout
    await page.evaluateOnNewDocument(() => {
      const of = window.fetch ? window.fetch.bind(window) : null;
      window.fetch = (...a) => {
        if (String(a[0] || '').includes('/api/auth/logout'))
          return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        return of ? of(...a) : fetch(...a);
      };
    });

    // ===================== 戶主 =====================
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle2', timeout: 30000 });
    const headClicked = await loginAs(page, 'fhead');
    report.head.enteredMemberCenter = headClicked;

    // Req1：頂部登出掣可見（無需滾動，位於頁面近頂部）
    report.head.topLogoutVisible = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')).filter(b => (b.textContent || '').trim() === '登出');
      return btns.some(b => {
        const s = getComputedStyle(b); if (s.display === 'none') return false;
        const r = b.getBoundingClientRect();
        return b.offsetParent !== null && r.top < 250;
      });
    });
    report.head.memberCenterEntered = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h2')).some(h => (h.textContent || '').includes('會員中心')));

    // 戶主睇子女：逐個 click 查看資料
    const childButtons = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).filter(b => (b.textContent || '').includes('查看資料')).length);
    report.head.viewDataButtons = childButtons;

    // DEBUG：直接打 API 睇 children 權限 + 第一個子女 profile 原始回應
    report.head.debug = await page.evaluate(async () => {
      const tk = localStorage.getItem('jwtToken');
      const h = await fetch('/api/membership/family', { headers: { Authorization: 'Bearer ' + tk } });
      const hd = await h.json().catch(() => ({}));
      let profStatus = null, profBody = null, bkStatus = null, bkBody = null, medStatus = null, medBody = null;
      if (hd.children && hd.children[0]) {
        const cid = hd.children[0].id;
        const p = await fetch('/api/membership/family/' + cid + '/profile', { headers: { Authorization: 'Bearer ' + tk } });
        profStatus = p.status; profBody = await p.json().catch(() => ({}));
        const bk = await fetch('/api/membership/family/' + cid + '/bookings', { headers: { Authorization: 'Bearer ' + tk } });
        bkStatus = bk.status; bkBody = await bk.json().catch(() => ({}));
        const md = await fetch('/api/membership/family/' + cid + '/medical', { headers: { Authorization: 'Bearer ' + tk } });
        medStatus = md.status; medBody = await md.json().catch(() => ({}));
      }
      return {
        familyStatus: h.status,
        children: (hd.children || []).map(c => ({ name: c.name, age: c.age, isAdult: c.isAdult, forcedOpen: c.forcedOpen, canViewProfile: c.canViewProfile, canViewBooking: c.canViewBooking, canViewMedical: c.canViewMedical })),
        profStatus, profBody, bkStatus, bkBody, medStatus, medBody,
      };
    });

    async function expandChild(idx) {
      const ok = await page.evaluate((i) => {
        const btns = Array.from(document.querySelectorAll('button')).filter(b => (b.textContent || '').includes('查看資料'));
        if (btns[i]) { btns[i].click(); return true; }
        return false;
      }, idx);
      await new Promise(r => setTimeout(r, 1800));
      return ok;
    }
    // A: 未成年 → 全部強制開放（見數據，無鎖）
    const aClicked = await expandChild(0);
    report.head.childA = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      return {
        showsProfile: txt.includes('91000002'),
        showsBooking: txt.includes('2026-09-20') && txt.includes('10:00'),
        showsMedical: txt.includes('感冒發燒'),
        lockProfile: txt.includes('成員未開放個人資料'),
        lockBooking: txt.includes('成員未開放預約記錄'),
        lockMedical: txt.includes('成員未開放病歷'),
      };
    });
    report.head.childA.expanded = aClicked;
    // B: 成年全關 → 三類鎖
    await expandChild(1);
    report.head.childB = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      return {
        lockProfile: txt.includes('成員未開放個人資料'),
        lockBooking: txt.includes('成員未開放預約記錄'),
        lockMedical: txt.includes('成員未開放病歷'),
      };
    });
    // C: 成年全開 → 無鎖，顯示「暫無」
    await expandChild(2);
    report.head.childC = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      return {
        noLock: !txt.includes('成員未開放'),
        showsEmpty: txt.includes('暫無預約記錄') && txt.includes('暫無病歷記錄'),
      };
    });

    // ===================== 子帳戶（成年 B）=====================
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle2', timeout: 30000 });
    const subB = await loginAs(page, 'fchildB');
    report.subAdult.entered = subB;
    report.subAdult.privacyDebug = await page.evaluate(async () => {
      const tk = localStorage.getItem('jwtToken');
      const r = await fetch('/api/membership/privacy', { headers: { Authorization: 'Bearer ' + tk } });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    });
    report.subAdult.showsSubAccountBlock = await page.evaluate(() => (document.body.innerText || '').includes('嘅家庭子帳戶'));
    report.subAdult.hasAuthEntry = await page.evaluate(() => (document.body.innerText || '').includes('授權設定'));
    report.subAdult.hasLinkEntry = await page.evaluate(() => (document.body.innerText || '').includes('連結帳戶（家庭帳戶功能）'));
    // 按 授權設定 → 跳去 privacy-section
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find(x => (x.textContent || '').includes('授權設定'));
      if (b) b.click();
    });
    await new Promise(r => setTimeout(r, 800));
    report.subAdult.authSection = await page.evaluate(() => {
      const el = document.getElementById('privacy-section');
      if (!el) return { exists: false };
      const txt = el.innerText || '';
      return {
        exists: true,
        hasMedicalToggle: txt.includes('唔俾主帳戶睇病歷'),
        hasBookingToggle: txt.includes('唔俾主帳戶睇預約記錄'),
        hasProfileToggle: txt.includes('唔俾主帳戶睇個人資料'),
        notLocked: !txt.includes('強制開放'),
      };
    });

    // ===================== 子帳戶（未成年 A）=====================
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle2', timeout: 30000 });
    const subA = await loginAs(page, 'fchildA');
    report.subMinor.entered = subA;
    report.subMinor.showsSubAccountBlock = await page.evaluate(() => (document.body.innerText || '').includes('嘅家庭子帳戶'));
    report.subMinor.lockedNotice = await page.evaluate(() => {
      const el = document.getElementById('privacy-section');
      const txt = el ? (el.innerText || '') : '';
      return txt.includes('強制開放') && !txt.includes('唔俾主帳戶睇病歷');
    });

    report.pageErrors = errors;
    report.famResponses = famResponses;
    await browser.close();

    console.log('FAMPRIV_REPORT ' + JSON.stringify(report, null, 2));

    const checks = [
      report.head.memberCenterEntered,
      report.head.topLogoutVisible,
      report.head.viewDataButtons === 3,
      report.head.childA.showsProfile && report.head.childA.showsBooking && report.head.childA.showsMedical && !report.head.childA.lockProfile && !report.head.childA.lockBooking && !report.head.childA.lockMedical,
      report.head.childB.lockProfile && report.head.childB.lockBooking && report.head.childB.lockMedical,
      report.head.childC.noLock && report.head.childC.showsEmpty,
      report.subAdult.entered && report.subAdult.showsSubAccountBlock,
      report.subAdult.hasAuthEntry,
      report.subAdult.hasLinkEntry,
      report.subAdult.authSection.exists && report.subAdult.authSection.hasMedicalToggle && report.subAdult.authSection.hasBookingToggle && report.subAdult.authSection.hasProfileToggle && report.subAdult.authSection.notLocked,
      report.subMinor.entered && report.subMinor.showsSubAccountBlock,
      report.subMinor.lockedNotice,
      errors.length === 0,
    ];
    const passed = checks.every(Boolean);
    console.log('\n檢查結果: ' + checks.map((c, i) => `${i + 1}:${c ? '✅' : '❌'}`).join(' '));
    if (passed) console.log('\n✅ PASS：家庭子帳戶功能（登出可見 / 授權設定 / 18歲規則）全部通過，0 頁面錯誤');
    else { console.log('\n❌ FAIL：有檢查未過'); exitCode = 1; }
  } catch (e) {
    console.error('VALIDATION ERROR:', e.message);
    exitCode = 2;
  } finally {
    cleanup();
    for (const f of [TEST, TEST + '-wal', TEST + '-shm']) { try { fs.unlinkSync(f); } catch (e) {} }
  }
  process.exit(exitCode);
})();
