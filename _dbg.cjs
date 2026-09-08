const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => logs.push('CONSOLE['+m.type()+'] ' + m.text()));
  page.on('pageerror', e => logs.push('PAGEERROR ' + (e.stack || e.message)));
  page.on('requestfailed', r => logs.push('REQFAIL ' + r.url() + ' ' + (r.failure()&&r.failure().errorText)));
  page.on('response', r => { if (r.status() >= 400) logs.push('HTTP'+r.status()+' ' + r.url()); });

  const resp = await page.goto('http://localhost:4100/', { waitUntil: 'networkidle2', timeout: 30000 }).catch(e=>({url:'ERR '+e.message}));
  await new Promise(r=>setTimeout(r,1500));
  const info = await page.evaluate(() => {
    const app = document.getElementById('app');
    return {
      docLen: document.documentElement.outerHTML.length,
      appExists: !!app,
      appHTMLlen: app ? app.innerHTML.length : -1,
      appHead: app ? app.innerHTML.slice(0,120) : '(no app)',
      scripts: [...document.scripts].map(s => s.src || '(inline)')
    };
  });
  console.log('RESP:', JSON.stringify(resp));
  console.log('INFO:', JSON.stringify(info, null, 2));
  console.log('LOGS:\n' + logs.join('\n'));
  await browser.close();
})().catch(e=>{console.error('CRASH',e.stack);process.exit(2);});
