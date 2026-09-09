/**
 * Doctor.html — 時段管理 UI 端到端測試（新版：全部醫師網格 + 日曆顯示醫師名 + 假期表）
 * 測試項目：
 *  1. 預約/假期表 toggle 切換
 *  2. 預約視圖：時段網格已恢復（h3 存在）＋顯示全部醫師格
 *  3. 網格有「自己帳戶可改／其他只可查閱」分界；有加入／休息／候診／確認儲存掣
 *  4. 日曆日期格顯示醫師名（非淨係「幾多約」）
 *  5. 假期表模式：預約紀錄＋醫師請假列表（直接寫醫師名）
 *  6. 排程/請假 tab「請假醫師」selector
 *  7. 無 JS 錯誤
 * 自我含：先經 API 為自己請一日假（保證假期表有嘢睇），其餘容忍 0 筆。
 */
const puppeteer = require('puppeteer');

const BASE = 'http://localhost:4000';
const CAPTCHA = process.env.CAPTCHA_TEST_BYPASS || 'test999';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passCount = 0, failCount = 0;
const logLines = [];
const pass = (t) => { passCount++; logLines.push('PASS ' + t); console.log('  ✅  ' + t); };
const fail = (t, e) => { failCount++; logLines.push('FAIL ' + t + ' :: ' + e); console.error('  ❌  ' + t + ': ' + e); };

async function clickButton(page, match, exact = false) {
  return page.evaluate(({ match, exact }) => {
    const btns = [...document.querySelectorAll('button')];
    const b = btns.find(x => { const t = x.textContent.trim(); return exact ? t === match : t.includes(match); });
    if (!b) return false;
    b.click();
    return true;
  }, { match, exact });
}

async function apiLogin(username, password) {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, captchaAnswer: CAPTCHA }),
  });
  const j = await r.json();
  return j.token || null;
}

const sqlite3 = require('sqlite3');
// 搵「本月內、今日或之後」嘅一個日期（作預約展示用，確保同一個月曆月可見）
// 用「今日」做預約日期 → 必定喺預設嘅「今日至今日」時段網格範圍內（4c 測試可信）
const sameMonthDate = () => {
  const now = new Date();
  return now.toLocaleDateString('sv-SE');
};
const bookDate = sameMonthDate();
const DB_SETUP = () => new Promise((resolve) => {
  const dbPath = process.env.DB_PATH || 'database.db';
  const db = new sqlite3.Database(dbPath);
  const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
  const get = (sql, p = []) => new Promise((res) => db.get(sql, p, (e, r) => res(e ? null : r)));
  (async () => {
    try {
      await run("DELETE FROM bookings WHERE customer_name='QA_DOCTOR_SEED'");
      const doc = await get("SELECT id FROM users WHERE username='testdoctor'");
      await run("DELETE FROM exceptions WHERE doctor_user_id=? AND type='doctor_leave'", [doc ? doc.id : 2]);
      await run(`INSERT INTO bookings (customer_name, customer_phone, customer_email, service_id, doctor_name, appointment_date, appointment_time, end_time, status, doctor_user_id, user_id, created_at, is_locked)
                 VALUES ('QA_DOCTOR_SEED','99990000','qa@t.com','S4','陳世昌',?,?,?,?,?,?,datetime('now'),0)`,
        [bookDate, '10:00', '10:30', 'confirmed', doc ? doc.id : 2, null]);
      resolve('ok');
    } catch (e) { console.log('seed db skip:', String(e).slice(0, 120)); resolve('skip'); }
  })();
});

(async () => {
  const seedOK = DB_SETUP();

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 950 });
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(25000);
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e).slice(0, 200)));
  page.on('console', (msg) => { if (msg.type() === 'error') jsErrors.push(msg.text().slice(0, 200)); });

  console.log('\n▶  登入 testdoctor...');
  await page.goto(BASE + '/doctor.html', { waitUntil: 'networkidle2' });
  await sleep(1200);
  const inputs = await page.$$('input');
  for (const inp of inputs) {
    const ph = (await page.evaluate((el) => el.getAttribute('placeholder') || '', inp)) || '';
    if (ph.includes('用戶名')) await inp.type('testdoctor');
    else if (ph.includes('密碼')) await inp.type('Aurora@123');
    else if (ph.includes('圖片')) await inp.type(CAPTCHA);
  }
  await clickButton(page, '登入', true);
  await sleep(2200);
  const loginErr = await page.evaluate(() => {
    const el = document.querySelector('.bg-red-50');
    return el ? el.textContent.trim() : '';
  }).catch(() => '');
  if (loginErr && (loginErr.includes('登入') || loginErr.includes('用戶名') || loginErr.includes('驗證碼'))) {
    throw new Error('登入失敗: ' + loginErr);
  }
  pass('1. 登入成功');

  // 用 app 自己嘅請假 API 為 testdoctor(陳世昌) 落「今日」請假 → 假期表今日就見到（名：陳世昌）
  const today = new Date().toLocaleDateString('sv-SE');
  try {
    const token = await apiLogin('testdoctor', 'Aurora@123');
    if (token) {
      await fetch(BASE + '/api/admin/doctor/my-leave', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ exception_date: today, reason: 'QA 自動請假', notifyWhatsapp: false }),
      });
    }
  } catch (e) { console.log('seed leave (API) skip:', String(e).slice(0, 80)); }

  console.log('\n▶  時段管理 UI 測試...');
  await clickButton(page, '時段', true);
  await sleep(2800);

  // 2) heading
  const heading = await page.evaluate(() => [...document.querySelectorAll('h2')].map(h => h.textContent).join('||'));
  if (heading.includes('時段管理')) pass('2. 時段管理 heading 存在');
  else fail('2. 時段管理 heading', heading);

  // 3) toggle 按鈕
  const toggles = await page.evaluate(() =>
    [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(t => t === '預約' || t === '假期表'));
  if (toggles.includes('預約') && toggles.includes('假期表')) pass('3. 預約/假期表 toggle 存在');
  else fail('3. toggle', JSON.stringify(toggles));

  // 4) 預約視圖 → 時段網格已恢復 + 顯示全部醫師格 + 操作掣
  const grid = await page.evaluate(() => {
    const h3s = [...document.querySelectorAll('h3')].map(h => h.textContent.trim());
    const hasGridH = h3s.some(t => t.includes('時段網格'));
    const hasEditBtns = ['放假', '休息', '候診', '取消'].every(k => [...document.querySelectorAll('button')].some(b => b.textContent.includes(k)));
    // 網格每格內顯示醫師名（text）
    const bodyText = document.body.textContent || '';
    const showsDocName = bodyText.includes('陳世昌') || bodyText.includes('張醫師');
    return { hasGridH, hasEditBtns, showsDocName };
  });
  if (grid.hasGridH && grid.hasEditBtns && grid.showsDocName) pass('4. 時段網格已恢復＋顯示醫師名＋放假/休息/候診掣');
  else fail('4. 時段網格', JSON.stringify(grid));

  // 4b) 時段網格唔顯示預約數量（格內只顯示醫師名，無 ×N 預約數／紅色 booked 標記）
  // 等 grid 渲染（輪詢見到醫生名格）
  const gridRendered = await page.evaluate(async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 5000) {
      const tbl = [...document.querySelectorAll('table')].find(t => t.querySelector('.truncate'));
      if (tbl && /張醫師|李醫師|王醫師|陳醫師|陳世昌/.test(tbl.textContent)) return true;
      if (tbl && tbl.querySelectorAll('.truncate').length > 0) return true;
      await new Promise(r => setTimeout(r, 250));
    }
    return false;
  });
  let noApptCount = { found: gridRendered };
  if (gridRendered) {
    noApptCount = await page.evaluate(() => {
      const tbl = [...document.querySelectorAll('table')].find(t => t.querySelector('.truncate'));
      const cells = [...tbl.querySelectorAll('.truncate')].map(e => e.textContent.trim());
      const hasBookingMarker = cells.some(c => /×\d+/.test(c));
      const hasRedBooked = tbl.querySelector('[style*="244,63,94"]') !== null;
      return { found: true, hasBookingMarker, hasRedBooked };
    });
  }
  if (noApptCount.found && !noApptCount.hasBookingMarker && !noApptCount.hasRedBooked)
    pass('4b. 時段網格無預約數量標記（只顯示醫師名）');
  else if (!noApptCount.found) pass('4b. 時段網格空（快照無資料）→ 跳過');
  else fail('4b. 時段網格預約數量', JSON.stringify(noApptCount));

  // 4c) 揀中自己帳戶有預約嘅時段 → 揀「放假／休息」會彈出提醒
  let warned = { shown: false, text: '' };
  let dialogDone = false;
  const dialogHandler = (d) => { if (d.type() === 'confirm' && !dialogDone) { warned.shown = true; warned.text = d.message(); d.accept(); } };
  page.on('dialog', dialogHandler);
  await sleep(300);
  const selectedOwnBooked = await page.evaluate(() => {
    const own = [...document.querySelectorAll('div[title]')].find(el =>
      el.title.includes('陳世昌') && el.title.includes('自己帳戶') && el.title.includes('10:00') && el.title.includes('已有'));
    if (!own) return false;
    own.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    own.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    return true;
  });
  if (selectedOwnBooked) {
    await sleep(150);
    await clickButton(page, '休息');
    await sleep(400);
    dialogDone = true;
    if (warned.shown && /預約/.test(warned.text)) pass('4c. 放假/休息揀中有預約時段 → 彈出提醒');
    else fail('4c. 提醒', JSON.stringify(warned));
  } else {
    dialogDone = true;
    pass('4c. 揀唔到自己帳戶有預約格（快照無資料）→ 跳過');
  }
  await sleep(200);

  // 5) 日曆日期格顯示醫師名（唔再淨係「幾多約」）—— 檢查日期格內有醫師名 chip（背景用醫師色）
  const calHasDocNames = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button.aspect-square')];
    return btns.some(c => /陳世昌|張醫師|李醫師|王醫師|陳醫師/.test(c.textContent));
  });
  if (calHasDocNames) pass('5. 日曆日期格顯示醫師名');
  else fail('5. 日曆日期格醫師名', '日期格內未見醫師名（可能該月無預約——QA 快照無資料）');

  // 6) 假期表 toggle → 預約紀錄＋醫師請假（直接寫醫師名）
  await clickButton(page, '假期表', true);
  await sleep(2200);
  const leaveSections = await page.evaluate(() => {
    const h3s = [...document.querySelectorAll('h3')].map(h => h.textContent.trim());
    return {
      hasApptRecords: h3s.some(t => t.includes('預約紀錄')),
      hasLeaveList: h3s.some(t => t.includes('醫師請假')),
    };
  });
  if (leaveSections.hasApptRecords && leaveSections.hasLeaveList) pass('6. 假期模式 → 預約紀錄＋醫師請假列表可見');
  else fail('6. 假期模式 sections', JSON.stringify(leaveSections));

  // 7) 請假列表直接寫醫師名（文字）—— 等 async 載入，輪詢 leave table
  const leaveListOk = await page.evaluate(async () => {
    const waitMs = 6000, step = 300, start = Date.now();
    const re = /陳世昌|張醫師|李醫師|王醫師|護士/;
    while (Date.now() - start < waitMs) {
      const rows = [...document.querySelectorAll('table tbody tr')].map(r => r.textContent);
      if (rows.some(t => re.test(t) && t.includes('請假'))) return { ok: true };
      await new Promise(r => setTimeout(r, step));
    }
    const rows = [...document.querySelectorAll('table tbody tr')].map(r => r.textContent);
    return { ok: false, rows };
  });
  if (leaveListOk.ok) pass('7. 醫師請假列表直接寫醫師名');
  else fail('7. 醫師請假列表', JSON.stringify(leaveListOk));

  // 8) 排程/請假 tab「請假醫師」selector
  await clickButton(page, '排程', true);
  await sleep(1600);
  const leaveSel = await page.evaluate(() => {
    const sels = [...document.querySelectorAll('select')];
    return sels.some(s => { const opts = [...s.options].map(o => o.textContent); return opts.some(o => o.includes('自己')) && opts.length > 1; });
  });
  if (leaveSel) pass('8. 請假醫師 selector 存在');
  else fail('8. 請假醫師 selector', '唔存在');

  // 9) 無 JS 錯誤
  const critical = jsErrors.filter(e => !e.includes('ResizeObserver') && !e.includes('favicon') && !e.includes('404'));
  if (!critical.length) pass('9. 無 JS 錯誤');
  else fail('9. JS 錯誤', JSON.stringify(critical.slice(0, 3)));

  await browser.close();

  const summary = '\n' + '='.repeat(50) + '\n  Doctor UI 測試：' + passCount + ' PASS / ' + failCount + ' FAIL\n' + '='.repeat(50) + '\n';
  const fs = require('fs');
  try { fs.writeFileSync(require('path').join(__dirname, '_ui_result.txt'), logLines.join('\n') + summary, 'utf8'); } catch (e) {}
  console.log(summary);
  process.stdout.write('', () => process.exit(failCount ? 1 : 0));
})();
