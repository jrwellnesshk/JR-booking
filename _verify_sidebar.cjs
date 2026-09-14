/* Validate staff.html sidebar restructure (5 requirements) on an isolated port + copied DB.
   Does NOT touch the live :4000 dev server. */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const bcrypt = require('bcrypt');
const puppeteer = require('puppeteer');

const ROOT = __dirname;
const DB = path.join(ROOT, '_verify_sidebar.db');
const PORT = 4731;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'Test1234!';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let child = null;

(async () => {
  // 1) fresh copy of DB + seed teststaff
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch (e) {} }
  fs.copyFileSync(path.join(ROOT, 'database.db'), DB);
  const db = new sqlite3.Database(DB);
  const hash = bcrypt.hashSync(PW, 10);
  await new Promise((res, rej) => db.run('UPDATE users SET password=?, is_active=1, must_change_password=0 WHERE username=?', [hash, 'teststaff'], (e) => (e ? rej(e) : res())));
  await new Promise((r) => db.close(r));

  // 2) start isolated server
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, NODE_ENV: 'development', CAPTCHA_TEST_BYPASS: 'test999', SESSION_SECRET: 'x'.repeat(40), JWT_SECRET: 'y'.repeat(40), ALLOW_UNSAFE_START: '1', ADMIN_PASSWORD: 'admin123', STRIPE_SECRET_KEY: '' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 240; i++) { try { const r = await fetch(BASE + '/health'); if (r.ok) break; } catch (e) {} await sleep(250); }

  // 3) login as staff
  const lr = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'teststaff', password: PW, captchaAnswer: 'test999', portal: 'staff' }) });
  const lj = await lr.json();
  if (!lj.token) { console.log('LOGIN FAIL', lr.status, JSON.stringify(lj)); throw new Error('login failed'); }

  // 4) puppeteer
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) pageErrors.push(r.status() + ' ' + r.url().replace(BASE, '')); });

  // block logout fetch so navigating never accidentally logs out the harness
  await page.evaluateOnNewDocument((tok, usr) => {
    localStorage.setItem('jwtToken', tok);
    localStorage.setItem('staffUser', JSON.stringify(usr));
    const orig = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      if (typeof url === 'string' && url.includes('/api/auth/logout')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, blocked: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return orig(url, opts);
    };
  }, lj.token, lj.user);

  await page.goto(BASE + '/staff.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  // wait for Vue mount (logout button rendered in aside)
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('登出')), { timeout: 30000 });

  const results = {};
  const ev = (fn, ...a) => page.evaluate(fn, ...a);

  // helper: click a button by text within a scope
  const clickBtn = async (text, scope = 'aside') => {
    const ok = await ev((t, s) => {
      const scopeEl = s ? document.querySelector(s) : document;
      const btn = [...(scopeEl || document).querySelectorAll('button')].find((b) => (b.textContent || '').replace(/\s+/g, ' ').includes(t));
      if (btn) { btn.click(); return true; }
      return false;
    }, text, scope);
    if (!ok) throw new Error('button not found: ' + text + ' in ' + scope);
    await sleep(700);
  };
  const visibleByText = (text, scope = 'main') => ev((t, s) => {
    const scopeEl = s ? document.querySelector(s) : document;
    const el = [...(scopeEl || document).querySelectorAll('button')].find((b) => (b.textContent || '').replace(/\s+/g, ' ').includes(t));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { display: getComputedStyle(el).display, offsetParent: el.offsetParent !== null, top: r.top, bottom: r.bottom, height: r.height };
  }, text, scope);
  const countInMain = (substr) => ev((t) => { const m = document.querySelector('main'); return (m ? m.innerText : document.body.innerText).split(t).length - 1; }, substr);
  const mainHas = (substr) => ev((t) => { const m = document.querySelector('main'); return (m ? m.innerText : document.body.innerText).includes(t); }, substr);
  const logoutInViewport = () => ev(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('登出'));
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    const vh = window.innerHeight;
    return { top: r.top, bottom: r.bottom, inView: r.top >= 0 && r.bottom <= vh, vh };
  });

  // ---- REQ 2: sidebar collapse + 4 categories ----
  // default expanded (listExpanded:true) -> 4 sub buttons visible
  const subNames = ['今日應診', '配藥中', '已完成', '已離診'];
  const before = {};
  for (const n of subNames) before[n] = await visibleByText(n, 'aside nav');
  await clickBtn('預約列表', 'aside nav'); // collapse
  const collapsed = {};
  for (const n of subNames) collapsed[n] = await visibleByText(n, 'aside nav');
  await clickBtn('預約列表', 'aside nav'); // expand
  const expanded = {};
  for (const n of subNames) expanded[n] = await visibleByText(n, 'aside nav');
  results.req2_collapse = {
    initiallyVisible: subNames.every((n) => before[n] && before[n].offsetParent),
    hiddenWhenCollapsed: subNames.every((n) => collapsed[n] === null || collapsed[n].offsetParent === false),
    visibleWhenExpanded: subNames.every((n) => expanded[n] && expanded[n].offsetParent),
  };

  // ---- REQ 1 & 4: stat cards only on list ----
  // we are on list tab (expand click set mainTab='list'); count "今日預約" occurrences in <main>
  const listCount = await countInMain('今日預約');
  await clickBtn('中醫討論區', 'aside'); // forum
  const forumCount = await countInMain('今日預約');
  results.req1_statOnlyOnList = { onList: listCount, onForum: forumCount, pass: listCount >= 2 && forumCount === 0 };

  // ---- REQ 5: bottom buttons persistent after navigating tabs (+ REQ 4 thorough: no stat cards on ANY tab) ----
  const tabsToVisit = ['即場落單', '客戶帳戶管理', '家庭帳戶', '日曆', '病歷', '考勤', '時段管理', '自助'];
  const bottomChecks = [];
  // currently on forum; check logout in viewport + stat count
  bottomChecks.push({ from: 'forum', statCount: await countInMain('今日預約'), ...(await logoutInViewport()) });
  for (const tab of tabsToVisit) {
    await clickBtn(tab, 'aside');
    const v = await logoutInViewport();
    bottomChecks.push({ from: tab, statCount: await countInMain('今日預約'), ...v });
  }
  results.req5_bottomPersistent = {
    allInView: bottomChecks.every((c) => c && c.inView === true),
    checks: bottomChecks,
  };
  results.req4_allTabsNoStat = {
    allZero: bottomChecks.every((c) => c.statCount === 0),
    checks: bottomChecks.map((c) => ({ from: c.from, statCount: c.statCount })),
  };

  // ---- REQ 3: Walk-in & Accounts as independent tabs ----
  await clickBtn('即場落單', 'aside');
  const walkinShown = await mainHas('即場落單（Walk-in）');
  await clickBtn('客戶帳戶管理', 'aside');
  const accountsShown = await mainHas('客戶帳戶管理');
  results.req3_independentTabs = { walkinPanel: walkinShown, accountsPanel: accountsShown, pass: walkinShown && accountsShown };

  // ---- REQ 3 (family): no 18歲以下 restriction, has 建立家庭成員 + 連結成年成員 ----
  await clickBtn('家庭帳戶', 'aside');
  await clickBtn('連結家庭成員', 'main'); // expand the create/link panel (familyPanelOpen)
  const fam = await ev(() => {
    const m = document.querySelector('main');
    const t = m ? m.innerText : document.body.innerText;
    return { hasCreateMember: t.includes('建立家庭成員'), hasLinkAdult: t.includes('成年成員需已有帳戶先連結得到'), has18Restriction: t.includes('必須 18 歲以下') };
  });
  results.req3_familyNo18 = { ...fam, pass: fam.hasCreateMember && fam.hasLinkAdult && !fam.has18Restriction };

  // ---- also verify 客人檔案 / other pages don't show stat boxes (REQ 4) ----
  // already covered by forum check; additionally confirm 客戶帳戶管理 tab has no stat cards
  const accountsStat = await countInMain('今日預約');
  results.req4_noStatOnOtherTabs = { forumCount, accountsCount: accountsStat, pass: forumCount === 0 && accountsStat === 0 };

  const overall = results.req1_statOnlyOnList.pass && results.req2_collapse.initiallyVisible && results.req2_collapse.hiddenWhenCollapsed && results.req2_collapse.visibleWhenExpanded && results.req3_independentTabs.pass && results.req3_familyNo18.pass && results.req4_noStatOnOtherTabs.pass && results.req4_allTabsNoStat.allZero && results.req5_bottomPersistent.allInView && pageErrors.length === 0;

  console.log(JSON.stringify({ results, pageErrors, overall }, null, 2));
  await browser.close();
  try { child.kill(); } catch (e) {}
  process.exit(overall ? 0 : 1);
})().catch((e) => { console.error('ERR', e); try { child && child.kill(); } catch (_) {} process.exit(1); });
