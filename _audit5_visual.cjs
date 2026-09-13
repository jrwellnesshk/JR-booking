/* QA5 visual — per-scenario isolation, zh-TW + en, desktop + mobile.
 * Upgraded from _qa3e_visual.cjs:
 *  1. DB snapshot via VACUUM INTO (fixes SQLITE_BUSY against live dev server)
 *  2. Adds EN language pass (previously zh only)
 *  3. Same isolation discipline: unique DB file, stale-WAL purge, login right before load
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sqlite3 = require('sqlite3');
const bcrypt = require('bcrypt');
const puppeteer = require('puppeteer');

const ROOT = __dirname;
const BASE_PORT = 4740;
const PW = 'Probe@2026';

function dbRun(dbFile, sql, params = []) { return new Promise((res, rej) => { const d = new sqlite3.Database(dbFile); d.run(sql, params, function (e) { d.close(); e ? rej(e) : res(this); }); }); }
function snapshot(dst) {
  return new Promise((resolve) => {
    const sdb = new sqlite3.Database(path.join(ROOT, 'database.db'), (e) => {
      if (e) return resolve(false);
      sdb.exec(`VACUUM INTO '${dst.replace(/\\/g, '/')}'`, (err) => { sdb.close(); resolve(!err); });
    });
  });
}

const SCENARIOS = [
  { name: '主頁(guest)', file: 'index.html', acct: null },
  { name: '客人', file: 'index.html', portal: 'customer', key: 'customerUser', acct: 'testcustomer' },
  { name: '家庭戶主', file: 'index.html', portal: 'customer', key: 'customerUser', acct: 'testfamily' },
  { name: '家庭成員', file: 'index.html', portal: 'customer', key: 'customerUser', acct: 'testkid1' },
  { name: '員工', file: 'staff.html', portal: 'staff', key: 'staffUser', acct: 'teststaff' },
  { name: '醫師', file: 'doctor.html', portal: 'doctor', key: 'doctorUser', acct: 'testdoctor' },
  { name: '管理員', file: 'admin.html', portal: 'admin', key: 'adminUser', acct: 'admin' },
  { name: 'HR', file: 'hr.html', portal: 'admin', key: 'adminUser', acct: 'admin' },
];
const NOISE = /WebGL|fonts\.gstatic|fonts\.googleapis|cdnjs\.cloudflare|favicon|CORS policy|ERR_FAILED/i;
const NOISE_REQ = /fonts\.gstatic|fonts\.googleapis|cdnjs\.cloudflare|favicon|\.woff2?$|\.ttf$/i;
const NAV_SEL = 'aside button, aside a, nav button, nav a, [class*="nav-item"], [class*="menu-item"], [class*="tab"]';

const STAMP = Date.now();
let srv = null, srvLog = '';
function startServer(dbFile, port) {
  srvLog = '';
  srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), DB_PATH: dbFile, CAPTCHA_TEST_BYPASS: 'test999', ALLOW_UNSAFE_START: '1', NODE_ENV: 'development', SESSION_SECRET: 'qa5_visual_secret_0123456789' }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stdout.on('data', d => srvLog += d); srv.stderr.on('data', d => srvLog += d);
}
function stopServer() { if (srv) { try { srv.kill('SIGKILL'); } catch (e) {} srv = null; } }
process.on('exit', stopServer);

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  const report = [];
  let idx = 0;
  const ONLY = process.env.QA_FILE ? process.env.QA_FILE.split(',') : (process.env.QA_ONLY ? process.env.QA_ONLY.split(',') : null);
  for (const s of SCENARIOS) {
    if (ONLY && !ONLY.includes(s.file) && !ONLY.includes(s.name)) { idx++; continue; }
    const port = BASE_PORT + idx++;
    const BASE = `http://127.0.0.1:${port}`;
    const dbFile = path.join(ROOT, `_v_${STAMP}_${idx}.db`);
    for (const ext of ['', '-wal', '-shm']) { const f = dbFile + ext; if (fs.existsSync(f)) fs.unlinkSync(f); }
    let snapOk = false;
    for (let t = 0; t < 5 && !snapOk; t++) snapOk = await snapshot(dbFile);
    if (!snapOk) { console.log('!! snapshot failed for', s.name); continue; }
    const hash = bcrypt.hashSync(PW, 10);
    for (const u of ['admin', 'teststaff', 'testdoctor', 'testcustomer', 'testfamily', 'testkid1']) {
      try { await dbRun(dbFile, 'UPDATE users SET password=?, must_change_password=0, profile_completed=1, is_active=1 WHERE username=?', [hash, u]); } catch (e) { console.log('  !! seed fail', u, e.message); }
    }
    startServer(dbFile, port);
    let up = false;
    for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + '/health'); if (r.ok) { up = true; break; } } catch (e) {} await new Promise(r => setTimeout(r, 350)); }
    if (!up) { console.log('!! server not up for', s.name, srvLog.slice(-300)); stopServer(); continue; }

    let c = null;
    if (s.acct) {
      const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: s.acct, password: PW, captchaAnswer: 'test999', portal: s.portal }) });
      const j = await r.json().catch(() => ({}));
      if (j && j.token) c = j; else console.log(`  !! ${s.acct} 登入失敗:`, JSON.stringify(j).slice(0, 120));
    }

    for (const lang of ['zh-TW', 'en']) {
      for (const vp of [{ n: 'desktop', w: 1366, h: 768 }, { n: 'mobile', w: 390, h: 844 }]) {
        const page = await browser.newPage();
        await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1 });
        const errs = [], badResp = [];
        page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
        page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 150)); });
        page.on('requestfailed', r => errs.push('REQFAIL: ' + r.url().slice(0, 100)));
        page.on('response', async r => { const u = r.url(); if (u.includes('/api/') && r.status() === 401 && process.env.QA_DBG) { try { const t = await r.text(); console.log('      [DBG-401BODY]', u.replace(BASE, '').slice(0, 50), '=>', t.slice(0, 120)); } catch (e) {} } });
        page.on('response', r => { const u = r.url(); if (r.status() >= 400) badResp.push(`${r.status()} ${u.replace(BASE, '').slice(0, 85)}`); });
        page.on('dialog', async d => { await d.dismiss().catch(() => {}); });
        const dbgReq = [];
        if (process.env.QA_DBG) page.on('request', r => { const u = r.url(); if (u.includes('/api/')) dbgReq.push(`${u.replace(BASE, '').slice(0, 44)} AUTH=${(r.headers()['authorization'] || 'NONE').slice(0, 22)}`); });
        await page.evaluateOnNewDocument((tok, user, key, lang) => {
          localStorage.setItem('lang', lang);
          if (tok) localStorage.setItem('jwtToken', tok);
          if (user && key) localStorage.setItem(key, JSON.stringify(user));
          if (key === 'adminUser' && user) localStorage.setItem('adminToken', JSON.stringify({ id: user.id, username: user.username, name: user.name, role: user.role }));
          // nav-click smoke 期間封鎖 logout API，防止側欄登出掣 revoke token 造成假 401
          const _f = window.fetch;
          window.fetch = function (input, init) {
            try {
              const u = typeof input === 'string' ? input : (input && input.url) || '';
              const m = (init && init.method) || (input && input.method) || 'GET';
              if (/\/api\/auth\/logout/.test(u) && String(m).toUpperCase() === 'POST') return new Response(JSON.stringify({ success: true, blocked: 'qa-nav-smoke' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            } catch (e) {}
            return _f.apply(this, arguments);
          };
        }, c && c.token, c && c.user, s.key, lang);
        let navClicks = 0;
        try {
          await page.goto(`${BASE}/${s.file}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await new Promise(r => setTimeout(r, 2600));
          if (process.env.QA_DBG) {
            const ls = await page.evaluate(() => ({ jwt: (localStorage.getItem('jwtToken') || '').slice(0, 14), adminToken: !!localStorage.getItem('adminToken'), adminUser: !!localStorage.getItem('adminUser') })).catch(e => ({ err: e.message }));
            console.log('      [DBG-LS]', JSON.stringify(ls));
            console.log('      [DBG-REQ]', dbgReq.slice(0, 10).join('  ||  '));
          }
          const n = await page.evaluate((sel) => { window.__navEls = [...document.querySelectorAll(sel)].filter(el => { const t = (el.textContent || '') + ' ' + (el.getAttribute('onclick') || ''); return !/登出|logout|sign[-\s]?out/i.test(t); }).slice(0, 24); return window.__navEls.length; }, NAV_SEL).catch(() => 0);
          for (let i = 0; i < n; i++) {
            try { if (await page.evaluate((q) => { const el = window.__navEls[q]; if (!el || !el.isConnected) return false; el.click(); return true; }, i)) navClicks++; } catch (e) {}
            await new Promise(r => setTimeout(r, 240));
          }
          await new Promise(r => setTimeout(r, 600));
        } catch (e) { errs.push('NAV: ' + e.message.slice(0, 120)); }
        const ovf = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })).catch(() => null);
        const horiz = ovf ? Math.max(0, ovf.sw - ovf.cw) : -1;
        const realErrs = [...new Set(errs)].filter(e => !NOISE.test(e));
        const realResp = [...new Set(badResp)].filter(e => !NOISE_REQ.test(e));
        report.push({ scenario: s.name, file: s.file, lang, viewport: vp.n, navClicks, horizOverflow: horiz, realErrors: realErrs, realBadResp: realResp });
        const tag = `${s.name}_${lang}_${vp.n}`;
        if (realErrs.length || realResp.length || horiz > 0) {
          console.log(`PROBLEM ${tag}  nav=${navClicks} overflow=${horiz}px`);
          [...realErrs, ...realResp].slice(0, 6).forEach(e => console.log('    - ' + e));
        } else console.log(`ok      ${tag.padEnd(24)} nav=${navClicks} overflow=0  真實錯誤=0  真實4xx/5xx=0`);
        await page.close();
      }
    }
    stopServer();
    for (const ext of ['', '-wal', '-shm']) { const f = dbFile + ext; try { fs.unlinkSync(f); } catch (e) {} }
  }

  fs.writeFileSync(path.join(ROOT, `_audit5_visual_report.json`), JSON.stringify(report, null, 2));
  const errCells = report.filter(r => r.realErrors.length || r.realBadResp.length);
  console.log(`\n===== QA5 VISUAL SUMMARY: cells=${report.length}  有真實錯誤格=${errCells.length}  水平溢出格=${report.filter(r => r.horizOverflow > 0).length} =====`);
  await browser.close(); stopServer();
  process.exit(0);
})().catch(e => { console.error('FATAL', e); stopServer(); process.exit(1); });
