// _i18n_enrender.cjs — 喺 EN 模式下載入各 portal，核對登入標籤變英文 + 截圖查重疊/移位
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const ROOT = __dirname;
const OUT = '/tmp/i18n_shots';
fs.mkdirSync(OUT, { recursive: true });
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/admin.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('Content-Type', types[path.extname(fp)] || 'text/plain');
  res.end(fs.readFileSync(fp));
});
(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const b = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  for (const f of ['admin.html', 'staff.html', 'doctor.html', 'hr.html', 'index.html']) {
    const p = await b.newPage();
    await p.setViewport({ width: 1280, height: 900 });
    // 預設 EN：模擬「英文版登入」
    await p.evaluateOnNewDocument(() => { try { localStorage.setItem('lang', 'en'); } catch (e) {} });
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(`http://localhost:${port}/${f}`, { waitUntil: 'networkidle0', timeout: 30000 }).catch(e => errs.push('GOTO ' + e.message));
    await new Promise(r => setTimeout(r, 800));
    // 找浮動 toggle 是否喺
    const toggle = await p.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => /中文|EN/.test(b.textContent));
      return btns.length;
    }).catch(() => 0);
    // 抽 body 文字（前 400 字）睇有冇英文 login label
    const txt = await p.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => '');
    const hasPassword = /Password/i.test(txt);
    const hasCaptcha = /Captcha|Verification Code/i.test(txt);
    const hasLogin = /Log in|Sign in/i.test(txt);
    await p.screenshot({ path: path.join(OUT, f.replace('.html', '') + '_en.png'), fullPage: false }).catch(() => {});
    // 手機尺寸再截一張查重疊
    if (['admin.html', 'staff.html', 'doctor.html'].includes(f)) {
      await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
      await new Promise(r => setTimeout(r, 500));
      await p.screenshot({ path: path.join(OUT, f.replace('.html', '') + '_en_mobile.png'), fullPage: false }).catch(() => {});
    }
    console.log(`${f.padEnd(12)} toggle=${toggle} EN[Password=${hasPassword} Captcha=${hasCaptcha} Login=${hasLogin}] pageErr=${errs.length}`);
    await p.close();
  }
  await b.close();
  server.close();
  console.log('screenshots @', OUT);
})();
