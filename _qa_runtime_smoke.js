/**
 * 運行時冒煙測試：喺同一個 process 內起 server（固定 SESSION_SECRET），
 * 為每個角色建立「獨立 browser context」（避免 localStorage 跨角色污染），
 * 注入對應嘅會話 key，切去新功能 view，捕捉 console / pageerror，並做關鍵 DOM 斷言。
 *
 * 會話 restore 嘅 key：
 *   - admin.html   -> adminToken(JSON{id,username,name,role,token}) + adminUser
 *   - doctor.html  -> doctorUser(JSON{role:'doctor',id}) + jwtToken
 *   - staff.html   -> staffUser(JSON{role:'staff',id}) + jwtToken
 *   - index.html   -> userToken(JSON{id,dbId,name,phone,...,profile_completed}) + jwtToken
 *
 * 時段管理 UX：先切去「時段管理」view →（admin/staff）揀醫師 → 撳日曆中嘅一日 →
 *   下方拖掃網格（table.border-collapse）先會渲染。
 *
 * 用法：node _qa_runtime_smoke.js
 */
const puppeteer = require('puppeteer');
const crypto = require('crypto');
const sqlite3 = require('sqlite3');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SECRET = 'testsecret';
const CAPTCHA = 'test999';
const BASE_PORT = parseInt(process.env.QA_PORT || '4399', 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function signToken(payload) {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const b = Buffer.from(JSON.stringify({ ...payload, jti: crypto.randomBytes(16).toString('hex'), iat: Date.now(), exp: Date.now() + 86400000 })).toString('base64url');
  const s = crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url');
  return `${h}.${b}.${s}`;
}

function getUsers() {
  return new Promise((resolve) => {
    const db = new sqlite3.Database(process.env.DB_PATH || path.join(__dirname, 'database.db'));
    db.all(
      "SELECT id, username, name, role, phone, email, profile_completed FROM users WHERE role IN ('admin','doctor','staff','customer') ORDER BY role, id",
      (e, rows) => { db.close(); resolve(rows || []); }
    );
  });
}

// 醫師帳號必須有對應嘅 doctors 行，醫師自己嘅時段管理（doctorInfo）先會載到。
// 測試前冪等確保測試醫師有 doctors 行，否則 doctorInfo=null → 網格永不渲染。
function ensureTestDoctorRow() {
  return new Promise((resolve) => {
    const db = new sqlite3.Database(process.env.DB_PATH || path.join(__dirname, 'database.db'));
    db.get("SELECT id, name FROM users WHERE role='doctor' ORDER BY id LIMIT 1", (e, u) => {
      if (!u) { db.close(); return resolve(null); }
      db.get("SELECT id FROM doctors WHERE user_id=?", [u.id], (e2, row) => {
        if (row) { db.close(); return resolve(row.id); }
        db.run(
          "INSERT INTO doctors (name, specialty, user_id, is_active) VALUES (?,?,?,1)",
          [u.name || '測試醫師', '中醫全科', u.id],
          function (err) { db.close(); resolve(err ? null : this.lastID); }
        );
      });
    });
  });
}

// 揀 button / a（最有可能帶 @click）；fallback 揀 textContent 最短（最內層）嘅 div
async function clickByText(page, kw) {
  return page.evaluate((kw) => {
    const interactive = [...document.querySelectorAll('button, a')].filter(
      (e) => e.textContent && e.textContent.includes(kw) && e.offsetParent !== null
    );
    if (interactive.length) { interactive[0].click(); return true; }
    const divs = [...document.querySelectorAll('div')].filter(
      (e) => e.textContent && e.textContent.includes(kw) && e.offsetParent !== null
    );
    if (divs.length) {
      divs.sort((a, b) => a.textContent.length - b.textContent.length);
      divs[0].click();
      return true;
    }
    return false;
  }, kw);
}

function collectErrors(page) {
  const errs = [];
  const onConsole = (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 220)); };
  const onError = (e) => errs.push('pageerror: ' + String(e).slice(0, 220));
  page.on('console', onConsole);
  page.on('pageerror', onError);
  return () => { page.off('console', onConsole); page.off('pageerror', onError); return errs; };
}

// admin 時段 view 係用「醫師列」入面嘅醫師名 button（slotDoctorId=doc.id）嚟揀醫師，
// 唔係用 select（select 係揀咗之後先出）。呢度按醫師名撳對應 button。
async function clickDoctorNameButton(page, names) {
  return page.evaluate((names) => {
    const btns = [...document.querySelectorAll('button')].filter(
      (b) => b.offsetParent !== null && names.some((n) => b.textContent.trim() === n)
    );
    if (btns.length) { btns[0].click(); return btns[0].textContent.trim(); }
    return false;
  }, names);
}

async function authPage(browser, user) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const jwt = signToken({ userId: user.id, role: user.role, username: user.username });
  let setup = {};
  if (user.role === 'admin') {
    setup = {
      adminToken: JSON.stringify({ id: user.id, username: user.username, name: user.name, role: user.role, token: jwt }),
      adminUser: JSON.stringify({ id: user.id, username: user.username, name: user.name, role: user.role }),
    };
  } else if (user.role === 'doctor') {
    setup = {
      jwtToken: jwt,
      doctorUser: JSON.stringify({ id: user.id, username: user.username, name: user.name, role: 'doctor', phone: user.phone }),
    };
  } else if (user.role === 'staff') {
    setup = {
      jwtToken: jwt,
      staffUser: JSON.stringify({ id: user.id, username: user.username, name: user.name, role: 'staff', phone: user.phone }),
    };
  } else {
    setup = {
      jwtToken: jwt,
      userToken: JSON.stringify({
        id: user.username, dbId: user.id, name: user.name, phone: user.phone,
        email: user.email || '', memberLevel: '一般會員',
        profile_completed: user.profile_completed || 0, days_remaining: null,
      }),
    };
  }
  await page.evaluateOnNewDocument((s) => {
    Object.keys(s).forEach((k) => localStorage.setItem(k, s[k]));
  }, setup);
  return { context, page, jwt };
}

// 時段管理：揀醫師（admin/staff view 需要先揀醫師 grid 先出；選項係 async 載入）
// admin 下拉 placeholder = 「選擇方框（醫師）」；staff 下拉 placeholder = 「請選擇醫師」
const DOC_SELECT_HINTS = ['請選擇醫師', '選擇方框'];
async function pickDoctorForSlots(page) {
  for (let i = 0; i < 16; i++) {
    const ok = await page.evaluate((hints) => {
      const s = [...document.querySelectorAll('select')].find((x) =>
        [...x.options].some((o) => hints.some((h) => o.textContent.includes(h))));
      return !!(s && s.options.length > 1);
    }, DOC_SELECT_HINTS);
    if (ok) break;
    await sleep(500);
  }
  return page.evaluate((hints) => {
    const s = [...document.querySelectorAll('select')].find((x) =>
      [...x.options].some((o) => hints.some((h) => o.textContent.includes(h))));
    if (s && s.options.length > 1) { s.value = s.options[1].value; s.dispatchEvent(new Event('change', { bubbles: true })); return s.options[1].textContent.trim(); }
    return false;
  }, DOC_SELECT_HINTS);
}

// 撳日曆中嘅一日（class 含 aspect-square 嘅日格 button），令下方拖掃網格渲染
async function clickCalendarDay(page) {
  return page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter(
      (b) => b.className.includes('aspect-square') && b.offsetParent !== null
    );
    if (!btns.length) return false;
    const t = btns.find((b) => b.textContent.trim() === '15') || btns[0];
    t.click();
    return t.textContent.trim();
  });
}

function countGridCells(page) {
  return page.evaluate(() => {
    const t = document.querySelector('table.border-collapse');
    return t ? t.querySelectorAll('td').length : 0;
  });
}

async function waitServer(base) {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(base + '/index.html'); if (r.ok) return true; } catch (e) {}
    await sleep(500);
  }
  throw new Error('server did not become ready: ' + base);
}

(async () => {
  const users = await getUsers();
  await ensureTestDoctorRow();
  const byRole = (r) => users.find((u) => u.role === r);
  const admin = byRole('admin'), doctor = byRole('doctor'), staff = byRole('staff');
  const cust = byRole('customer');
  const kid = users.find((u) => u.username === 'testkid1');
  console.log('Users:', {
    admin: admin && admin.username, doctor: doctor && doctor.username,
    staff: staff && staff.username, cust: cust && cust.username, kid: kid && kid.username,
  });

  let PORT = BASE_PORT, srv = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    PORT = BASE_PORT + attempt;
    const env = { ...process.env, PORT: String(PORT), SESSION_SECRET: SECRET, CAPTCHA_TEST_BYPASS: CAPTCHA, NODE_ENV: 'development' };
    srv = spawn('node', ['server.js'], { env, cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
    let errored = false;
    const onErr = (d) => { if (/EADDRINUSE/.test(d.toString())) errored = true; };
    srv.stderr.on('data', onErr);
    try { await waitServer(`http://localhost:${PORT}`); srv.stderr.off('data', onErr); break; }
    catch (e) { srv.kill('SIGTERM'); if (!errored) throw e; srv = null; }
  }
  if (!srv) throw new Error('無法起 server（port 衝突？）');
  const BASE = `http://localhost:${PORT}`;
  console.log('server ready on', PORT);
  const docNames = await (await fetch(`${BASE}/api/doctors`)).json().then((d) => d.map((x) => x.name));
  console.log('doctor names:', docNames);

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const out = [];

  // 0) API：GET /family/available-children（admin）
  try {
    const atok = signToken({ userId: admin.id, role: 'admin', username: admin.username });
    const r = await fetch(`${BASE}/api/membership/family/available-children?excludeHeadId=${admin.id}`, {
      headers: { Authorization: `Bearer ${atok}` },
    });
    const d = await r.json();
    out.push({ test: 'available-children', status: r.status, ok: d.ok, count: (d.children || []).length });
    console.log('available-children =>', r.status, 'count=', (d.children || []).length);
  } catch (e) { out.push({ test: 'available-children', error: e.message }); }

  // 1) Admin：家庭帳戶樹狀視圖 + 時段 grid
  if (admin) {
    const { context, page } = await authPage(browser, admin);
    const getErrs = await collectErrors(page);
    await page.goto(`${BASE}/admin.html`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    await clickByText(page, '家庭帳戶');
    await sleep(2500);
    const clickedHead = await clickByText(page, '位成員');
    await sleep(3500);
    const treeState = await page.evaluate(() => {
      const head = document.querySelector('[data-role="head"] .ftree-name');
      const title = [...document.querySelectorAll('.ftree-title')].find((t) => t.textContent.includes('Family Tree'));
      return {
        treeVisible: !!head && !!title,
        headName: head ? head.textContent.trim() : null,
        childCount: document.querySelectorAll('[data-role="child"]').length,
      };
    });
    out.push({ role: 'admin', view: 'family-connect', clickedHead, ...treeState, errors: getErrs() });
    console.log('admin family-connect:', JSON.stringify(out[out.length - 1]));

    await clickByText(page, '時段管理');
    await sleep(2500);
    const pickedA = await clickDoctorNameButton(page, docNames);
    await sleep(2500);
    const dayA = await clickCalendarDay(page);
    await sleep(4000);
    const cellsA = await countGridCells(page);
    out.push({ role: 'admin', view: 'timeslots', pickedDoctor: pickedA, clickedDay: dayA, tdCount: cellsA, errors: getErrs() });
    console.log('admin timeslots tdCount=', cellsA, 'day=', dayA, 'doc=', pickedA);
    await context.close();
  }

  // 2) Doctor：時段 grid
  if (doctor) {
    const { context, page } = await authPage(browser, doctor);
    const getErrs = await collectErrors(page);
    await page.goto(`${BASE}/doctor.html`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    await clickByText(page, '時段管理');
    await sleep(3000);
    const dayD = await clickCalendarDay(page);
    await sleep(4000);
    const cellsD = await countGridCells(page);
    out.push({ role: 'doctor', view: 'timeslots', clickedDay: dayD, tdCount: cellsD, errors: getErrs() });
    console.log('doctor timeslots tdCount=', cellsD, 'day=', dayD);
    await context.close();
  }

  // 3) Staff：揀醫師 -> 時段 grid
  if (staff) {
    const { context, page } = await authPage(browser, staff);
    const getErrs = await collectErrors(page);
    await page.goto(`${BASE}/staff.html`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    await clickByText(page, '時段管理');
    await sleep(2500);
    const pickedS = await pickDoctorForSlots(page);
    await sleep(2500);
    const dayS = await clickCalendarDay(page);
    await sleep(4000);
    const cellsS = await countGridCells(page);
    out.push({ role: 'staff', view: 'timeslots', pickedDoctor: pickedS, clickedDay: dayS, tdCount: cellsS, errors: getErrs() });
    console.log('staff timeslots tdCount=', cellsS, 'day=', dayS, 'doc=', pickedS);
    await context.close();
  }

  // 4) Customer：優惠券 + 會員編號卡
  if (cust) {
    const { context, page } = await authPage(browser, cust);
    const getErrs = await collectErrors(page);
    await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    await clickByText(page, '優惠券');
    await sleep(1800);
    const memberNo = await page.evaluate(() => {
      const card = [...document.querySelectorAll('div')].find((d) => d.textContent.includes('會員編號 = 你的手機號碼'));
      return card ? card.textContent.replace(/\s+/g, ' ').slice(0, 160) : null;
    });
    const redeemInput = await page.evaluate(() => !!document.querySelector('input[placeholder*="優惠券密碼"]'));
    const remaining = await page.evaluate(() => {
      const els = [...document.querySelectorAll('div')].find((d) => d.textContent.includes('剩餘免費診症'));
      return els ? els.textContent.replace(/\s+/g, ' ').slice(0, 80) : null;
    });
    out.push({ role: 'customer', view: 'coupons', memberNo, redeemInput, remaining, errors: getErrs() });
    console.log('customer coupons:', JSON.stringify(out[out.length - 1]));
    await context.close();
  }

  // 5) Customer(child)：我的設定 -> 私隱開關（需求 #4 子帳戶側）
  if (kid) {
    const { context, page } = await authPage(browser, kid);
    const getErrs = await collectErrors(page);
    await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    await clickByText(page, '設定');
    await sleep(2500);
    const privacyVisible = await page.evaluate(() =>
      !!([...document.querySelectorAll('div')].find((d) =>
        d.textContent.includes('唔俾主帳戶') && d.textContent.includes('睇我資料'))));
    out.push({ role: 'customer-child', view: 'mySettings', privacyToggleVisible: privacyVisible, errors: getErrs() });
    console.log('customer-child mySettings:', JSON.stringify(out[out.length - 1]));
    await context.close();
  }

  await browser.close();
  if (srv) srv.kill('SIGTERM');
  fs.writeFileSync(path.join(__dirname, '_qa_runtime_smoke.json'), JSON.stringify(out, null, 2));

  console.log('\n=== SUMMARY ===');
  // 分類錯誤：JS 例外最嚴重；4xx 資源錯誤（多數係角色權限，屬預存現象，唔應該令功能斷言失效）
  const allErrs = out.flatMap((o) => o.errors || []);
  const jsErrors = allErrs.filter((e) => e.startsWith('pageerror'));
  const resourceErrs = allErrs.filter((e) => e.includes('Failed to load resource'));
  const otherErrs = allErrs.filter((e) => !e.startsWith('pageerror') && !e.includes('Failed to load resource'));

  const checks = [
    ['available-children ok', out.some((o) => o.test === 'available-children' && o.ok)],
    ['admin family tree', out.some((o) => o.role === 'admin' && o.view === 'family-connect' && o.treeVisible && o.childCount > 0)],
    ['admin timeslots grid', out.some((o) => o.role === 'admin' && o.view === 'timeslots' && o.tdCount > 0)],
    ['doctor timeslots grid', out.some((o) => o.role === 'doctor' && o.view === 'timeslots' && o.tdCount > 0)],
    ['staff timeslots grid', out.some((o) => o.role === 'staff' && o.view === 'timeslots' && o.tdCount > 0)],
    ['customer coupons memberNo', out.some((o) => o.role === 'customer' && o.view === 'coupons' && o.memberNo)],
    ['customer coupons redeemInput', out.some((o) => o.role === 'customer' && o.view === 'coupons' && o.redeemInput)],
    ['child privacy toggle', out.some((o) => o.role === 'customer-child' && o.privacyToggleVisible)],
  ];
  checks.forEach(([n, ok]) => console.log((ok ? 'PASS ' : 'FAIL ') + n));
  console.log(`\n錯誤分類：JS例外=${jsErrors.length} 資源4xx=${resourceErrs.length} 其他=${otherErrs.length}`);
  if (jsErrors.length) console.log('JS例外:', jsErrors.slice(0, 5));
  if (otherErrs.length) console.log('其他錯誤:', otherErrs.slice(0, 5));
  if (resourceErrs.length) console.log('資源4xx(警告，多為角色權限預存現象):', [...new Set(resourceErrs)].slice(0, 6));

  const hardFail = jsErrors.length > 0 || otherErrs.length > 0;
  const checksPass = checks.every(([, ok]) => ok);
  const allPass = checksPass && !hardFail;
  console.log('功能斷言全部通過:', checksPass ? 'YES' : 'NO');
  process.exit(allPass ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
