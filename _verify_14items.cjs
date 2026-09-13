/* 14 項功能驗收測試：VACUUM INTO 快照 + 獨立埠 4766，唔掂 live DB */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const SNAP = path.join(ROOT, '_snap14.db');
const PORT = 4766;
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0; const failures = [];
function T(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ❌ ${name} ${extra || ''}`); }
}

async function main() {
  // 1. 快照
  try { fs.unlinkSync(SNAP); } catch {}
  execSync(`"C:/Users/Damian Fung/.workbuddy/binaries/node/versions/22.22.2-3/node.exe" -e "const s=require('sqlite3');const d=new s.Database('database.db');d.run(\\"VACUUM INTO '_snap14.db'\\",()=>{console.log('snap ok');d.close();})"`, { cwd: ROOT, stdio: 'pipe' });

  const sqlite3 = require('sqlite3');
  const bcrypt = require('bcrypt');
  const PW = 'Test14@Pass9';
  {
    const db = new sqlite3.Database(SNAP);
    const hash = bcrypt.hashSync(PW, 10);
    await new Promise((res) => db.run("UPDATE users SET password=?, must_change_password=0, profile_completed=1, is_active=1 WHERE username IN ('admin','teststaff','testdoctor','testcustomer')", [hash], () => { db.close(); res(); }));
  }

  const { spawn } = require('child_process');
  const env = { ...process.env, PORT: String(PORT), DB_PATH: SNAP, SESSION_SECRET: 'test14secret', CAPTCHA_TEST_BYPASS: 'test999', NODE_ENV: 'development', ALLOW_UNSAFE_START: '1' };
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 20000);
    server.stdout.on('data', (d) => { if (String(d).includes(PORT)) { clearTimeout(t); resolve(true); } });
  });
  console.log(`\n=== server on :${PORT} ===\n`);

  // ---------- 登入 helper ----------
  async function login(username, password, portal) {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, captchaAnswer: 'test999', portal })
    });
    const d = await r.json().catch(() => ({}));
    return d.token || null;
  }
  const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });

  const adminTok = await login('admin', PW, 'admin');
  T('管理員登入', !!adminTok);
  const staffTok = await login('teststaff', PW, 'staff');
  T('員工登入', !!staffTok);
  const docTok = await login('testdoctor', PW, 'doctor');
  T('醫師登入', !!docTok);
  const custTok = await login('testcustomer', PW, 'customer');
  T('客人登入', !!custTok);

  // ---------- 功能 3：服務權限 ----------
  console.log('\n--- 功能3：服務權限 ---');
  // 服務列表
  const svcs = await (await fetch(`${BASE}/api/services`)).json();
  const trial = svcs.find(s => (s.name || '').includes('初體驗'));
  const other = svcs.find(s => !(s.name || '').includes('初體驗'));
  T('服務列表有初體驗及其他服務', !!trial && !!other);
  // 訪客（guestMode）約非初體驗 → 403
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('sv-SE');
  let r = await fetch(`${BASE}/api/bookings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guestMode: true, serviceId: other.id, doctorName: '張醫師', appointmentDate: tomorrow, appointmentTime: '11:00', customerName: '訪客', customerPhone: '900000001', customerEmail: 'g@t' }) });
  T('訪客約非初體驗 → 403', r.status === 403, 'got ' + r.status);
  // 客人約初體驗 → 403 trial_guest_only
  r = await fetch(`${BASE}/api/bookings`, { method: 'POST', headers: auth(custTok), body: JSON.stringify({ serviceId: trial.id, doctorName: '張醫師', appointmentDate: tomorrow, appointmentTime: '11:00', customerName: '測試客', customerPhone: '612000001' }) });
  const d3 = await r.json().catch(() => ({}));
  T('會員約初體驗 → 403 trial_guest_only', r.status === 403 && d3.code === 'trial_guest_only', JSON.stringify(d3).slice(0, 80));
  // 員工代落單（walk-in）初體驗 → 允許（不受限）
  r = await fetch(`${BASE}/api/bookings`, { method: 'POST', headers: auth(staffTok), body: JSON.stringify({ serviceId: trial.id, doctorName: '張醫師', appointmentDate: tomorrow, appointmentTime: '11:30', customerName: 'walkin客', customerPhone: '900000002' }) });
  T('員工代約初體驗 → 允許', r.status === 200 || r.status === 201, 'got ' + r.status);
  // 客人約其他服務 → 允許
  r = await fetch(`${BASE}/api/bookings`, { method: 'POST', headers: auth(custTok), body: JSON.stringify({ serviceId: other.id, doctorName: '張醫師', appointmentDate: tomorrow, appointmentTime: '14:30', customerName: '測試客', customerPhone: '612000001' }) });
  T('一般會員約其他服務 → 允許', r.status === 200 || r.status === 201, 'got ' + r.status);

  // ---------- 功能 5：開放時間 ----------
  console.log('\n--- 功能5：開放時間 ---');
  const sat = '2026-09-19', sun = '2026-09-20', fri = '2026-09-18';
  let ts = await (await fetch(`${BASE}/api/timeslots?date=${sat}`)).json();
  const satSlots = (ts.timeSlots || []).map(x => x.time || x);
  T('星期六時段 10:00-13:00', satSlots.length > 0 && satSlots[0] === '10:00' && satSlots[satSlots.length - 1] < '13:00', JSON.stringify(satSlots.slice(0, 3)) + ' ... ' + satSlots.slice(-1));
  ts = await (await fetch(`${BASE}/api/timeslots?date=${sun}`)).json();
  T('星期日仍有 slot 列表（closed 判斷由 checkClinicOpen 執行）', Array.isArray(ts.timeSlots));
  // 星期日預約 → 400 closed
  r = await fetch(`${BASE}/api/bookings`, { method: 'POST', headers: auth(custTok), body: JSON.stringify({ serviceId: other.id, doctorName: '張醫師', appointmentDate: sun, appointmentTime: '11:00', customerName: '測試客', customerPhone: '612000001' }) });
  const d5 = await r.json().catch(() => ({}));
  T('星期日預約 → 拒絕 closed', r.status === 400 && d5.code === 'closed', JSON.stringify(d5).slice(0, 80));
  // 星期五 19:30 → business_hours
  r = await fetch(`${BASE}/api/bookings`, { method: 'POST', headers: auth(custTok), body: JSON.stringify({ serviceId: other.id, doctorName: '張醫師', appointmentDate: fri, appointmentTime: '19:30', customerName: '測試客', customerPhone: '612000001' }) });
  const d5b = await r.json().catch(() => ({}));
  T('星期五 19:30 → 拒絕 business_hours', r.status === 400 && d5b.code === 'business_hours', JSON.stringify(d5b).slice(0, 80));

  // ---------- 功能 6：星星 ----------
  console.log('\n--- 功能6：新客星星 ---');
  const blRaw0 = await (await fetch(`${BASE}/api/bookings`, { headers: auth(adminTok) })).json();
  const list0 = Array.isArray(blRaw0) ? blRaw0 : (blRaw0.bookings || blRaw0.data || []);
  const custBooking = list0.find(b => b.customer_phone === '612000001' && b.status !== 'visited');
  T('會員首筆預約 is_new=1（星星顯示）', !!custBooking && custBooking.is_new === 1, JSON.stringify(custBooking && custBooking.is_new));
  await new Promise((res) => { const d = new sqlite3.Database(SNAP); d.run("UPDATE bookings SET status='visited' WHERE customer_phone='612000001'", () => { d.close(); res(); }); });
  const blRaw = await (await fetch(`${BASE}/api/bookings`, { headers: auth(adminTok) })).json();
  const blList = Array.isArray(blRaw) ? blRaw : (blRaw.bookings || blRaw.data || []);
  const walkinRow = blList.find(b => b.customer_phone === '612000001' && b.status === 'visited');
  T('完成首次預約後 is_new=0（星星消失）', !!walkinRow && walkinRow.is_new === 0, JSON.stringify(walkinRow && walkinRow.is_new));

  // ---------- 功能 1-2：客人資料 ----------
  console.log('\n--- 功能1-2：客人資料 ---');
  r = await fetch(`${BASE}/api/health-profile/search?q=test`, { headers: auth(staffTok) });
  T('員工搜尋健康檔案 → 200', r.status === 200, 'got ' + r.status);
  r = await fetch(`${BASE}/api/health-profile/search?q=test`, { headers: auth(custTok) });
  T('客人搜尋健康檔案 → 403', r.status === 403, 'got ' + r.status);
  r = await fetch(`${BASE}/api/health-profile/me`, { method: 'PUT', headers: auth(custTok), body: JSON.stringify({ chronic_conditions: '高血壓（測試）', long_term_medications: '降壓藥（測試）', medical_history: '2025 年感冒求診（測試）' }) });
  T('客人自填健康檔案 → 200', r.status === 200, 'got ' + r.status);
  r = await fetch(`${BASE}/api/health-profile/me`, { headers: auth(custTok) });
  const hp = await r.json().catch(() => ({}));
  T('客人讀回健康檔案內容一致', (hp.profile || {}).chronic_conditions === '高血壓（測試）');

  // ---------- 功能 10：討論區 ----------
  console.log('\n--- 功能10：討論區 ---');
  r = await fetch(`${BASE}/api/content/forum/posts`, { method: 'POST', headers: auth(staffTok), body: JSON.stringify({ title: '員工測試帖', content: '秋季養生貼士（測試）', category: '中醫交流' }) });
  const f1 = await r.json().catch(() => ({}));
  T('員工發帖 → 200', r.status === 200 && f1.ok, JSON.stringify(f1).slice(0, 60));
  r = await fetch(`${BASE}/api/content/forum/posts`, { method: 'POST', headers: auth(docTok), body: JSON.stringify({ title: '醫師測試帖', content: '冬令進補問答（測試）', category: '中醫交流' }) });
  T('醫師發帖 → 200', r.status === 200);
  const fl = await (await fetch(`${BASE}/api/content/forum/posts`)).json();
  const flArr = Array.isArray(fl) ? fl : (fl.posts || []);
  const post = flArr.find(p => p.title === '員工測試帖');
  T('帖子出現於列表', !!post, '共 ' + flArr.length + ' 帖');
  if (post) {
    r = await fetch(`${BASE}/api/content/forum/posts/${post.id}/replies`, { method: 'POST', headers: auth(adminTok), body: JSON.stringify({ content: '管理員回覆：已閱（測試）' }) });
    T('管理員回覆 → 200', r.status === 200);
    const pd = await (await fetch(`${BASE}/api/content/forum/posts/${post.id}`)).json();
    T('回覆出現於帖子', (pd.replies || []).length === 1);
  }

  // ---------- 功能 13：員工家庭樹 ----------
  console.log('\n--- 功能13：員工家庭帳戶 ---');
  r = await fetch(`${BASE}/api/membership/admin/tree`, { headers: auth(staffTok) });
  T('員工讀家庭樹 API → 200', r.status === 200, 'got ' + r.status);
  const tree = await r.json().catch(() => ({}));
  T('家庭樹有資料', Array.isArray(tree.tree));

  // ---------- 功能 14：床位名稱 / 公開設定 ----------
  console.log('\n--- 功能14：資料同步 ---');
  const labels = await (await fetch(`${BASE}/api/beds/labels`)).json();
  T('手法床 5 個名稱', (labels.tuina || []).length === 5, JSON.stringify(labels.tuina));
  T('VIP 房 5 個名稱', (labels.vip || []).length === 5, JSON.stringify(labels.vip));
  const pub = await (await fetch(`${BASE}/api/public-clinic-settings`)).json();
  T('公開設定含星期六時段', pub.saturday_start === '10:00' && pub.saturday_end === '13:00', JSON.stringify(pub).slice(0, 120));

  // ---------- 前端 smoke：三門戶新 UI ----------
  console.log('\n--- 前端 smoke（新 UI 記號）---');
  for (const [f, marks] of [['staff.html', ['中醫討論區', '家庭帳戶結構', '今日應診', '配藥中', '功能9：左欄底部功能選項']], ['doctor.html', ['中醫討論區', '功能9：左欄底部功能選項']], ['admin.html', ['中醫討論區', '星期六時段', '功能9：左欄底部功能選項']], ['index.html', ['家庭帳戶關係圖', '星期一至五 10:00 - 19:00']], ]) {
    const t = await (await fetch(`${BASE}/${f}`)).text();
    for (const m of marks) T(`${f} 含「${m}」`, t.includes(m));
    T(`${f} 冇殘留浮動語言掣`, !t.includes('fixed bottom-3 right-3'));
  }
  {
    const t = await (await fetch(`${BASE}/index.html`)).text();
    T('index.html 冇客戶心聲 section', !t.includes('客戶心聲') && !t.includes('id="reviews"'));
  }

  server.kill('SIGTERM');
  console.log(`\n========== 總計：${pass} PASS / ${fail} FAIL ==========`);
  if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(2); });
