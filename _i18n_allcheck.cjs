// _i18n_allcheck.cjs — 逐個 portal 載入，報告 PAGEERROR（忽略 404 console）
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const ROOT = __dirname;
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
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  for (const f of ['admin.html', 'staff.html', 'doctor.html', 'hr.html', 'index.html']) {
    const p = await b.newPage();
    const pageErrors = [];
    p.on('pageerror', e => pageErrors.push(e.message));
    await p.goto(`http://localhost:${port}/${f}`, { waitUntil: 'networkidle0', timeout: 30000 }).catch(e => pageErrors.push('GOTO ' + e.message));
    await new Promise(r => setTimeout(r, 700));
    // 額外：檢查有冇 Vue mount（#app 有無子節點 or v-cloak 移除）
    const mounted = await p.evaluate(() => {
      const a = document.getElementById('app');
      if (!a) return 'no #app';
      return a.children.length > 0 || a.innerHTML.includes('t(') ? 'rendered-or-template' : 'empty';
    }).catch(() => 'err');
    console.log(`${f.padEnd(12)} pageErrors=${pageErrors.length} mounted=${mounted}` + (pageErrors.length ? '  >> ' + pageErrors.slice(0,2).join(' | ') : ''));
    await p.close();
  }
  await b.close();
  server.close();
})();
