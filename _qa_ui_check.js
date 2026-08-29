/**
 * UI 版面檢查：四個頁面載入 + console 錯誤收集
 * 用法：node _qa_ui_check.js
 */
const puppeteer = require('puppeteer');
const fs = require('fs');

const PAGES = [
  { url: 'http://localhost:4000/index.html', marker: null },
  { url: 'http://localhost:4000/staff.html', marker: null },
  { url: 'http://localhost:4000/doctor.html', marker: null },
  { url: 'http://localhost:4000/admin.html', marker: null },
];

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const out = [];
  let failed = 0;

  for (const p of PAGES) {
    const errors = [];
    const onConsole = (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text().slice(0, 200)); };
    const onError = (err) => errors.push('pageerror: ' + String(err).slice(0, 200));
    const onReqFail = (req) => {
      const u = req.url();
      if (!u.startsWith('http://localhost:4000')) return; // 外部資源（CDN）失敗不計
      if (req.resourceType() === 'image' || req.resourceType() === 'font') return;
      errors.push('requestfailed: ' + u.slice(0, 150) + ' ' + (req.failure() && req.failure().errorText));
    };
    page.on('console', onConsole);
    page.on('pageerror', onError);
    page.on('requestfailed', onReqFail);
    try {
      const resp = await page.goto(p.url, { waitUntil: 'networkidle2', timeout: 45000 });
      const status = resp ? resp.status() : 0;
      // 等 Vue 渲染
      await new Promise(r => setTimeout(r, 2500));
      const rootHtmlLen = await page.evaluate(() => document.body ? document.body.innerHTML.length : 0);
      const okPage = status === 200 && rootHtmlLen > 500;
      // 過濾無關噪音
      const realErrors = errors.filter(e =>
        !e.includes('favicon') &&
        !e.includes('net::ERR_ABORTED') &&
        !e.includes('the server responded with a status of 429')
      );
      out.push({ page: p.url, status, htmlLen: rootHtmlLen, errors: realErrors });
      if (!okPage || realErrors.length) failed++;
      console.log((okPage && !realErrors.length ? '✓' : '✗') + ' ' + p.url + ` [${status}] body=${rootHtmlLen}` + (realErrors.length ? ' 錯誤:' + JSON.stringify(realErrors) : ''));
    } catch (e) {
      out.push({ page: p.url, fatal: e.message });
      failed++;
      console.log('✗ ' + p.url + ' 異常: ' + e.message);
    }
    page.removeAllListeners('console');
    page.removeAllListeners('pageerror');
    page.removeAllListeners('requestfailed');
  }

  await browser.close();
  fs.writeFileSync('_qa_ui_results.json', JSON.stringify({ at: new Date().toISOString(), failed, out }, null, 2));
  process.exit(failed ? 1 : 0);
})();
