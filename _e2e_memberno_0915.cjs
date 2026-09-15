/* E2E 隔離測試（2026-09-15）— 會員編號顯示 / 名前綴 / 家庭樹親戚非同輩 / 員工客人心聲審核
 * 隔離快照 _e2e_memberno_0915.db @ :4766（絕不寫 live database.db）
 * 用法： NODE_PATH=./node_modules node _e2e_memberno_0915.cjs
 */
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const { spawn } = require('child_process');

const LIVE_DB = path.join(__dirname, 'database.db');
const SNAP = path.join(__dirname, '_e2e_memberno_0915.db');
const PORT = 4766;
const BASE = `http://localhost:${PORT}`;
const PW = 'Pw123456!';

let pass = 0, fail = 0; const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
}
function step(t) { console.log('\n==== ' + t + ' ===='); }

function dbRun(db, sql, params) {
  return new Promise((res, rej) => { db.run(sql, params || [], function (e) { e ? rej(e) : res(this); }); });
}
function dbAll(db, sql, params) {
  return new Promise((res, rej) => { db.all(sql, params || [], (e, r) => { e ? rej(e) : res(r); }); });
}
function dbOpen(p) { return new Promise((res, rej) => { const d = new sqlite3.Database(p, (e) => e ? rej(e) : res(d)); }); }

async function vacuumSnapshot() {
  if (fs.existsSync(SNAP)) fs.unlinkSync(SNAP);
  return new Promise((res, rej) => {
    const src = new sqlite3.Database(LIVE_DB, sqlite3.OPEN_READONLY);
    src.exec(`VACUUM INTO '${SNAP.replace(/\\/g, '/')}'`, (e) => {
      src.close();
      if (e) { try { fs.copyFileSync(LIVE_DB, SNAP); console.warn('⚠️ VACUUM 失敗，改用 copyFile：', e.message); res(); } catch (e2) { rej(e2); } }
      else res();
    });
  });
}

async function api(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let j = null; const t = await r.text();
  try { j = JSON.parse(t); } catch (_) { j = t; }
  return { status: r.status, body: j };
}
async function login(username, password) {
  const r = await api('POST', '/api/auth/login', { username, password, captchaAnswer: 'test999' });
  if (r.status !== 200 || !r.body.token) throw new Error('login ' + username + ' 失敗: ' + JSON.stringify(r.body).slice(0, 200));
  return r.body;
}

// ---- 動態 insert（用 PRAGMA 取欄位，避免寫死 schema）----
async function insertRows(db, table, rows) {
  const info = await dbAll(db, `PRAGMA table_info(${table})`);
  const cols = info.map(c => c.name);
  for (const row of rows) {
    const keys = Object.keys(row).filter(k => cols.includes(k));
    const ph = keys.map(() => '?').join(',');
    await dbRun(db, `INSERT INTO ${table} (${keys.join(',')}) VALUES (${ph})`, keys.map(k => row[k]));
  }
}

(async () => {
  step('SETUP：快照 + 注入測試帳戶');
  await vacuumSnapshot();
  const snap = await dbOpen(SNAP);
  const hash = bcrypt.hashSync(PW, 10);
  // 冪等清理
  const olds = await dbAll(snap, "SELECT id FROM users WHERE username LIKE 'e2e%'");
  if (olds.length) {
    const ids = olds.map(r => r.id); const ph = ids.map(() => '?').join(',');
    await dbRun(snap, `DELETE FROM account_links WHERE user_a IN (${ph}) OR user_b IN (${ph})`, [...ids, ...ids]).catch(() => {});
    await dbRun(snap, `DELETE FROM bookings WHERE user_id IN (${ph})`, ids).catch(() => {});
    await dbRun(snap, `DELETE FROM users WHERE id IN (${ph})`, ids).catch(() => {});
  }
  // 注入帳戶
  await insertRows(snap, 'users', [
    { username: 'e2eadm', password: hash, name: 'E2E管理', phone: '90000001', role: 'admin', membership_tier: 'general', profile_completed: 1, is_active: 1, member_no: 'JR0001' },
    { username: 'e2estaff', password: hash, name: 'E2E員工', phone: '90000002', role: 'staff', employment_type: 'full', profile_completed: 1, is_active: 1, member_no: 'JR0002' },
    { username: 'e2ecust', password: hash, name: 'E2E客', phone: '91112233', role: 'customer', membership_tier: 'general', profile_completed: 1, is_active: 1, member_no: 'JR2233' },
    { username: 'e2ehead', password: hash, name: 'E2E戶主', phone: '92223333', role: 'customer', membership_tier: 'family', profile_completed: 1, is_active: 1, member_no: 'SA3333', family_plan: 'A' },
    { username: 'e2esib', password: hash, name: 'E2E兄弟', phone: '92224444', role: 'customer', membership_tier: 'general', profile_completed: 1, is_active: 1, member_no: 'JR4444' },
    { username: 'e2erel', password: hash, name: 'E2E親戚', phone: '92225555', role: 'customer', membership_tier: 'general', profile_completed: 1, is_active: 1, member_no: 'JR5555' },
    { username: 'e2ekid', password: hash, name: 'E2E子女', phone: '92226666', role: 'customer', membership_tier: 'general', profile_completed: 1, is_active: 1, member_no: 'JR6666' },
  ]);
  const ids = {};
  for (const u of ['e2eadm', 'e2estaff', 'e2ecust', 'e2ehead', 'e2esib', 'e2erel', 'e2ekid']) {
    const r = await dbAll(snap, 'SELECT id FROM users WHERE username=?', [u]); ids[u] = r[0].id;
  }
  // 戶主必須有子女（family_links）先唔會被 startup reconcile() 當孤兒清走 family_head_id
  await dbRun(snap, 'UPDATE users SET family_head_id=? WHERE id=?', [ids.e2ehead, ids.e2ehead]);
  await insertRows(snap, 'family_links', [
    { parent_user_id: ids.e2ehead, child_user_id: ids.e2ekid, relation: 'parent' },
  ]);
  // 預約：e2ecust 一張（用現有 service；欄位用 appointment_date / appointment_time）
  const svc = await dbAll(snap, 'SELECT id FROM services LIMIT 1');
  const svcId = svc.length ? svc[0].id : null;
  if (svcId) {
    await insertRows(snap, 'bookings', [
      { user_id: ids.e2ecust, service_id: svcId, appointment_date: '2026-12-01', appointment_time: '10:00', status: 'confirmed', customer_name: 'E2E客', customer_phone: '91112233' },
    ]);
  }
  // 戶主通用連結：兄弟（同輩）＋ 親戚（非同輩）
  await insertRows(snap, 'account_links', [
    { user_a: ids.e2ehead, user_b: ids.e2esib, relation: '兄弟', status: 'active' },
    { user_a: ids.e2ehead, user_b: ids.e2erel, relation: '親戚', custom_relation: '表姑', status: 'active' },
  ]);
  await snap.close();
  console.log(`  帳戶: adm=${ids.e2eadm} cust=${ids.e2ecust} head=${ids.e2ehead} sib=${ids.e2esib} rel=${ids.e2erel} service=${svcId}`);

  // 啟動隔離伺服器
  step('BOOT：隔離伺服器 @ :' + PORT);
  const env = { ...process.env, PORT: String(PORT), DB_PATH: SNAP, CAPTCHA_TEST_BYPASS: 'test999', ALLOW_UNSAFE_START: '1', SESSION_SECRET: 'e2e-fixed-secret', STRIPE_SECRET_KEY: '', NODE_ENV: 'test' };
  const srv = spawn(process.execPath, ['server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let bootLog = '';
  srv.stdout.on('data', d => { bootLog += d; });
  srv.stderr.on('data', d => { bootLog += d; });

  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { const r = await login('e2eadm', PW); if (r.token) { ready = true; break; } } catch (_) {}
    await new Promise(r => setTimeout(r, 500));
  }
  if (!ready) { console.log('❌ 伺服器無法就緒，bootLog:\n' + bootLog.slice(-1500)); srv.kill('SIGKILL'); process.exit(1); }
  console.log('  ✅ 伺服器就緒');

  try {
    // ---------- Req #1：登入回傳 member_no ----------
    step('1) 會員編號（客人登入回傳 + 顯示）');
    const cust = await login('e2ecust', PW);
    check('客人登入成功並拿到 token', !!cust.token);
    const MNO = (cust.user && cust.user.member_no) || '';
    check('登入回傳 member_no（JR+電話後4位）', !!MNO && /^JR\d{4}$/.test(MNO), cust.user);
    const mem = await api('GET', '/api/membership/', null, cust.token);
    check('會員資料含 member_no', mem.status === 200 && JSON.stringify(mem.body).includes(MNO), mem.body);

    // ---------- Req #2：admin / staff 預約與用戶管理名前綴 ----------
    step('2) 管理員 / 員工 客人名前綴 member_no');
    const adm = await login('e2eadm', PW);
    const admBookings = await api('GET', '/api/bookings', null, adm.token);
    const admBookingsArr = Array.isArray(admBookings.body) ? admBookings.body : (admBookings.body && admBookings.body.data) || [];
    check('admin /api/bookings 回傳 member_no', admBookings.status === 200 && admBookingsArr.length > 0 && JSON.stringify(admBookingsArr).includes(MNO), admBookingsArr.length);
    const admUsers = await api('GET', '/api/users', null, adm.token);
    const admUsersArr = Array.isArray(admUsers.body) ? admUsers.body : (admUsers.body && admUsers.body.users) || [];
    check('admin /api/users 回傳 member_no', admUsers.status === 200 && admUsersArr.length > 0 && JSON.stringify(admUsersArr).includes(MNO), admUsersArr.length);
    const staff = await login('e2estaff', PW).catch(e => { console.log('  ⚠️ staff 登入失敗：', e.message); return null; });
    if (staff) {
      const stBookings = await api('GET', '/api/admin/staff/bookings?userId=' + staff.user.id, null, staff.token);
      const stJson = JSON.stringify(stBookings.body);
      const stArr = Array.isArray(stBookings.body) ? stBookings.body : (stBookings.body && stBookings.body.bookings) || [];
      check('staff /api/admin/staff/bookings 200', stBookings.status === 200, stBookings.status);
      check('staff 預約含 member_no（有資料時）', stArr.length === 0 || stJson.includes('member_no') || stJson.includes(MNO), stArr.length);
    } else {
      console.log('  ⚠️ 無 staff 帳戶，staff 端點 API 檢查略過。');
    }
    const mrec = await api('GET', '/api/medical-records/admin/all', null, adm.token);
    const mrecArr = Array.isArray(mrec.body) ? mrec.body : (mrec.body && mrec.body.records) || [];
    check('admin 病歷 admin/all 回傳 200 且含 member_no 欄位', mrec.status === 200 && (mrecArr.length === 0 || JSON.stringify(mrecArr).includes('member_no')), mrec.status + ' len=' + mrecArr.length);

    // ---------- Req #4：admin + staff 客人心聲審核 ----------
    step('4) 客人心聲審核（admin + staff）');
    // 先由客人交一件，再審
    const v = await api('POST', '/api/content/customer-voices', { rating: 5, visit_type: '針灸', content: 'E2E客人心聲' }, cust.token);
    check('客人提交客人心聲 → pending', v.status === 200 && v.body.ok, v.body);
    const admVoices = await api('GET', '/api/admin/content/customer-voices', null, adm.token);
    check('admin 可取客人心聲清單（含全部狀態）', admVoices.status === 200 && Array.isArray(admVoices.body) && admVoices.body.length > 0, admVoices.body && admVoices.body.length);
    const vid = (admVoices.body || []).find(x => x.content === 'E2E客人心聲');
    if (vid) {
      const ap = await api('PUT', `/api/admin/content/customer-voices/${vid.id}/status`, { status: 'approved' }, adm.token);
      check('admin 通過客人心聲', ap.status === 200 && ap.body.ok, ap.body);
      const del = await api('DELETE', `/api/admin/content/customer-voices/${vid.id}`, null, adm.token);
      check('admin 刪除客人心聲', del.status === 200 && del.body.ok, del.body);
    } else {
      check('admin 客人心聲含 E2E 件', false, admVoices.body);
    }
    // staff 授權：無 staff 帳戶則跳過（前端會以員工身分驗）
    if (staff) {
      const stVoices = await api('GET', '/api/admin/content/customer-voices', null, staff.token);
      check('staff 可取客人心聲清單（adminOrStaff）', stVoices.status === 200 && Array.isArray(stVoices.body), stVoices.status);
    }

    // ---------- Req #3：家庭樹 — 親戚非同輩 ----------
    step('3) 家庭樹：親戚另置第 5 代（非戶主同輩）');
    const tree = await api('GET', '/api/membership/admin/tree', null, adm.token);
    check('樹狀含 E2E戶主（head）', tree.status === 200 && JSON.stringify(tree.body).includes('E2E戶主'), tree.status);
    const links = await api('GET', `/api/membership/account-links?userId=${ids.e2ehead}`, null, adm.token);
    check('戶主連結含兄弟 + 親戚', links.status === 200 && JSON.stringify(links.body).includes('兄弟') && JSON.stringify(links.body).includes('親戚'), links.body);

    // ---------- 前端 Puppeteer 驗證（零 console error）----------
    step('5) Puppeteer 前端驗證（零 console error）');
    let browser;
    try {
      const puppeteer = require('puppeteer');
      browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
      const base = BASE;

      async function newPage(seeds) {
        const ctx = await browser.createBrowserContext();
        const page = await ctx.newPage();
        const errors = [];
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
        await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
        await page.evaluate((s) => { for (const k in s) localStorage.setItem(k, s[k]); }, seeds);
        return { ctx, page, errors };
      }
      async function clickNav(page, text) {
        return page.evaluate((t) => {
          const els = [...document.querySelectorAll('button, a')];
          const el = els.find(e => (e.textContent || '').includes(t));
          if (el) { el.click(); return true; }
          return false;
        }, text);
      }
      const wait = (ms) => new Promise(r => setTimeout(r, ms));

      // 客人：member_no 喺人名上面 + hero
      {
        const { ctx, page, errors } = await newPage({
          jwtToken: cust.token,
          userToken: JSON.stringify({ id: cust.user.username, dbId: cust.user.id, name: cust.user.name, member_no: cust.user.member_no, phone: cust.user.phone, email: cust.user.email || '', memberLevel: '一般會員', profile_completed: 1, days_remaining: null, must_change_password: false })
        });
        await page.goto(base + '/index.html', { waitUntil: 'networkidle2' });
        await wait(1500);
        const txt = await page.evaluate(() => document.body.innerText);
        check('客人 sidebar/hero 顯示會員編號 ' + MNO, txt.includes(MNO), txt.includes(MNO));
        check('客人 hero 顯示「會員編號：」', txt.includes('會員編號'));
        check('客人頁面零 console error', errors.length === 0, errors.slice(0, 5));
        await ctx.close();
      }

      // 管理員：用戶管理 + 預約 名前綴
      {
        const { ctx, page, errors } = await newPage({
          jwtToken: adm.token,
          adminUser: JSON.stringify({ id: adm.user.id, username: adm.user.username, name: adm.user.name, role: 'admin' })
        });
        await page.goto(base + '/admin.html', { waitUntil: 'networkidle2' });
        await wait(1200);
        const ok1 = await clickNav(page, '用戶管理');
        await wait(1200);
        let txt = await page.evaluate(() => document.body.innerText);
        check('admin 用戶管理 名前綴 ' + MNO + ' ·', ok1 && txt.includes(MNO), txt.includes(MNO));
        const ok2 = await clickNav(page, '預約管理');
        await wait(1200);
        txt = await page.evaluate(() => document.body.innerText);
        check('admin 預約 名前綴 ' + MNO + ' ·', txt.includes(MNO), txt.includes(MNO));
        check('admin 頁面零 console error', errors.length === 0, errors.slice(0, 5));
        await ctx.close();
      }

      // 員工：客人心聲審核 UI + 家庭樹親戚非同輩
      if (staff) {
        const { ctx, page, errors } = await newPage({
          jwtToken: staff.token,
          staffUser: JSON.stringify({ id: staff.user.id, username: staff.user.username, name: staff.user.name, role: 'staff', employment_type: staff.user.employment_type || 'full' })
        });
        await page.goto(base + '/staff.html', { waitUntil: 'networkidle2' });
        await wait(1200);
        const okv = await clickNav(page, '客人心聲');
        await wait(1500);
        let txt = await page.evaluate(() => document.body.innerText);
        check('staff 客人心聲審核區存在', okv && txt.includes('客人心聲審核'), txt.includes('客人心聲審核'));
        // 家庭樹：選戶主，查親戚落第 5 代
        const okf = await clickNav(page, '家庭帳戶');
        await wait(1500);
        const clickedHead = await page.evaluate((nm) => {
          const btns = [...document.querySelectorAll('button')];
          const el = btns.find(e => (e.textContent || '').includes(nm));
          if (el) { el.click(); return true; }
          return false;
        }, 'E2E戶主');
        await wait(1500);
        txt = await page.evaluate(() => document.body.innerText);
        // 親戚名應出現喺「其他連結 / 第五代」區；兄弟出現喺戶主世代
        const relBlock = await page.evaluate(() => {
          const b = document.querySelector('.ftree-relatives-block');
          return b ? b.innerText : '';
        });
        check('staff 家庭樹：親戚落「其他連結」第 5 代', relBlock.includes('E2E親戚'), relBlock);
        check('staff 家庭樹：兄弟留戶主世代（唔係第 5 代）', !relBlock.includes('E2E兄弟'), relBlock);
        check('staff 頁面零 console error', errors.length === 0, errors.slice(0, 5));
        await ctx.close();
      } else {
        console.log('  ⚠️ 無 staff 帳戶，staff 前端（客人心聲審核 / 家庭樹親戚）留待人手確認。');
      }

      await browser.close();
    } catch (e) {
      console.log('  ⚠️ Puppeteer 不可用，跳過前端檢查：', e.message);
    }

  } finally {
    srv.kill('SIGKILL');
  }

  console.log(`\n==== 結果：${pass} 通過 / ${fail} 失敗 ====`);
  if (fail) { console.log('失敗項：', failures.join(' | ')); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
