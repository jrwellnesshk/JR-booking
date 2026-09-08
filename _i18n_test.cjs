const puppeteer = require('puppeteer');

(async () => {
  const errors = [];
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', r => errors.push('REQFAIL: ' + r.url() + ' ' + (r.failure() && r.failure().errorText)));

  try {
    await page.goto('http://localhost:4100/', { waitUntil: 'networkidle2', timeout: 30000 });
  } catch (e) { errors.push('GOTO: ' + e.message); }

  await new Promise(r => setTimeout(r, 1500));

  const diag = await page.evaluate(() => {
    const app = document.getElementById('app');
    const top = document.querySelector('.aq-topbar');
    const loginLink = [...document.querySelectorAll('.aq-links a')].find(x => /會員登入|Member Login/.test(x.textContent));
    return {
      hasVueGlobal: typeof window.Vue !== 'undefined',
      appHasVue: !!(app && app.__vue_app__),
      topbarExists: !!top,
      appInnerHead: app ? app.innerHTML.slice(0, 160) : '(no #app)',
      loginLinkText: loginLink ? loginLink.textContent.trim() : '(none)',
      toggleCount: document.querySelectorAll('.aq-lang-toggle').length,
      toggleText: (document.querySelector('.aq-lang-toggle') || {}).textContent || '(none)'
    };
  });

  console.log('DIAG:', JSON.stringify(diag, null, 2));
  console.log('ERRORS so far:', errors.length ? errors.join('\n') : 'none');

  // try switching language via DOM click
  let switchResult = 'skipped';
  if (diag.toggleCount > 0) {
    try {
      await page.$eval('.aq-lang-toggle', el => el.click());
      await new Promise(r => setTimeout(r, 600));
      switchResult = await page.evaluate(() => {
        const a = [...document.querySelectorAll('.aq-links a')].find(x => /Member Login|會員登入/.test(x.textContent));
        return { htmlLang: document.documentElement.lang, loginText: a ? a.textContent.trim() : '(none)', toggle: (document.querySelector('.aq-lang-toggle')||{}).textContent };
      });
    } catch (e) { switchResult = 'CLICK ERR: ' + e.message; }
  }
  console.log('SWITCH:', JSON.stringify(switchResult));

  await page.screenshot({ path: 'i18n_test_shot.png' });
  console.log('FINAL ERRORS:', errors.length ? errors.join('\n') : 'none');

  await browser.close();
})().catch(e => { console.error('TEST CRASH:', e.stack); process.exit(2); });
