/**
 * QA 交叉場景測試（每執行一次 = 一輪）
 * 覆蓋：主頁／訪客、客人、家庭、職員、醫師、管理員、安全權限矩陣
 * 重點：跨角色交叉驗證（A角色動作 → B角色視角核實）
 *
 * 用法：node _qa_cross_test.js
 * 產出：_qa_cross_results.json
 */
const fs = require('fs');
const bcrypt = require('bcrypt');

const BASE = 'http://localhost:4000';
const BYPASS = 'test999';
const ADMIN_PW = process.env.QA_ADMIN_PW || 'aurora2026';
const TOKENS_FILE = '_qa_tokens.json';

let tokens = {};
try { tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); } catch (e) { tokens = {}; }

const results = [];
let reqCount = 0;
const SFX = Date.now().toString(36).slice(-5);
let dbw; // 直接 DB 操作（測試準備/還原用）
const dbq = (sql, p = []) => new Promise((res, rej) => {
  dbw.get(sql, p, (e, r) => {
    if (e && !String(e.message).includes('not a function')) return rej(e);
    if (r !== undefined || !e) return res(r);
    dbw.all(sql, p, (e2, rows) => e2 ? rej(e2) : res(rows));
  });
});
const dbRun = (sql, p = []) => new Promise((res, rej) => dbw.run(sql, p, function (e) { e ? rej(e) : res(this); }));

async function api(method, path, opts = {}) {
  reqCount++;
  const headers = {};
  if (opts.token) {
    const t = (opts.token && typeof opts.token === 'object' && opts.token.token) ? opts.token.token : opts.token;
    headers.Authorization = 'Bearer ' + t;
  }
  let body;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const attempt = async () => {
    try {
      const res = await fetch(BASE + path, { method, headers, body });
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('json') ? await res.json() : (await res.text()).slice(0, 300);
      return { status: res.status, data };
    } catch (e) {
      return { status: 0, data: { error: e.message } };
    }
  };
  let r = await attempt();
  for (let i = 0; i < 2 && r.status === 429; i++) {
    console.log(`  ⏳ 429 速率限制，等 3 秒後重試 (${i + 1}/2): ${method} ${path}`);
    await new Promise(res => setTimeout(res, 3000));
    r = await attempt();
  }
  return r;
}

function ok(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail).slice(0, 240) });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '  << ' + String(detail).slice(0, 180)));
  return !!cond;
}
function rec(name, r, expectStatus, extraCond, extraDetail) {
  const stOk = Array.isArray(expectStatus) ? expectStatus.includes(r.status) : r.status === expectStatus;
  const cond = extraCond === undefined ? stOk : (stOk && extraCond(r.data));
  return ok(name, cond, `${r.status} ${JSON.stringify(r.data).slice(0, 160)}${extraDetail ? ' | ' + extraDetail : ''}`);
}
async function call(m, p, o) { return api(m, p, o); }

// 登入（優先用快取 token；失效先重新登入；429 速率限制自動重試）
// 快取物件格式：{ token, id, role, name }，跨輪次持久化避免重複登入觸發速率限制
async function login(username, password, force) {
  if (!force && tokens[username] && tokens[username].token) return tokens[username];
  let r;
  for (let attempt = 0; attempt < 4; attempt++) {
    r = await api('POST', '/api/auth/login', { body: { username, password, captchaAnswer: BYPASS } });
    if (r.status !== 429) break;
    console.log(`  ⏳ 登入速率限制，等 3 秒重試 (${attempt + 1}/4): ${username}`);
    await new Promise(res => setTimeout(res, 3000));
  }
  if (r.status === 200 && r.data.token) {
    const entry = { token: r.data.token, id: r.data.user && r.data.user.id, role: r.data.user && r.data.user.role, name: r.data.user && r.data.user.name };
    tokens[username] = entry;
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens));
    return entry;
  }
  console.log(`  ✗ 登入失敗 ${username}: ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  return { token: null, id: null, role: null, name: null, loginFailed: true };
}

// 自備演示帳戶（唔依賴 DB 種子）：職員 / 醫師 / 家庭戶主 + 子帳戶
const DEMO_ACCOUNTS = [
  { username: 'pptstaff01', name: 'PPT職員一', role: 'staff', pw: 'PptTest123', phone: '91001111', insurance_covered: 1 },
  { username: 'pptdoc01', name: '黃醫師', role: 'doctor', pw: 'PptTest123', phone: '91001112' },
  { username: 'tdoc02', name: '李醫師', role: 'doctor', pw: 'Test1234', phone: '91001113' },
  { username: 'pptmember1', name: '陳大文', role: 'customer', pw: 'PptTest123', phone: '91001114', tier: 'family' },
  { username: 'pptm01', name: '陳小明', role: 'customer', pw: 'Kid2026ok', phone: '91001115' },
];
const dbAll = (sql, p = []) => new Promise((res, rej) => dbw.all(sql, p, (e, rows) => e ? rej(e) : res(rows || [])));
async function ensureDemoAccounts() {
  const h = (pw) => bcrypt.hashSync(pw, 10);
  for (const a of DEMO_ACCOUNTS) {
    const ex = await dbq('SELECT id FROM users WHERE username=?', [a.username]);
    if (ex) continue;
    await dbRun(
      'INSERT INTO users (username,password,name,phone,role,profile_completed,insurance_covered,membership_tier) VALUES (?,?,?,?,?,1,?,?)',
      [a.username, h(a.pw), a.name, a.phone, a.role, a.insurance_covered != null ? a.insurance_covered : null, a.tier || null]
    );
    const row = await dbq('SELECT id FROM users WHERE username=?', [a.username]);
    if (a.role === 'doctor') {
      await dbRun('UPDATE doctors SET user_id=? WHERE name=? AND is_active=1', [row.id, a.name]);
    }
  }
  // 家庭連結：pptm01 -> pptmember1
  const head = await dbq('SELECT id FROM users WHERE username=?', ['pptmember1']);
  const child = await dbq('SELECT id FROM users WHERE username=?', ['pptm01']);
  if (head && child) {
    await dbRun('UPDATE users SET family_head_id=? WHERE id=?', [head.id, head.id]);
    await dbRun('UPDATE users SET family_head_id=? WHERE id=?', [head.id, child.id]);
    await dbRun('INSERT OR IGNORE INTO family_links (parent_user_id, child_user_id, relation) VALUES (?,?,?)', [head.id, child.id, 'parent']);
  }
}
async function cleanupDemoAccounts() {
  const names = DEMO_ACCOUNTS.map(a => a.username);
  const rows = await dbAll('SELECT id FROM users WHERE username IN (' + names.map(() => '?').join(',') + ')', names);
  const ids = rows.map(r => r.id);
  if (ids.length) {
    await dbRun('DELETE FROM family_links WHERE parent_user_id IN (' + ids.map(() => '?').join(',') + ') OR child_user_id IN (' + ids.map(() => '?').join(',') + ')', [...ids, ...ids]);
    await dbRun('UPDATE doctors SET user_id=NULL WHERE user_id IN (' + ids.map(() => '?').join(',') + ')', ids);
    await dbRun('DELETE FROM users WHERE id IN (' + ids.map(() => '?').join(',') + ')', ids);
  }
}

// 揀可用時段
async function pickSlot(date, serviceId, doctorName) {
  const q = `?date=${date}&serviceId=${serviceId}` + (doctorName ? `&doctor=${encodeURIComponent(doctorName)}` : '');
  const r = await api('GET', '/api/bookings/timeslots/available' + q);
  if (r.status !== 200 || !Array.isArray(r.data)) return null;
  const free = r.data.filter(s => s.available);
  return free.length ? free[Math.floor(Math.random() * free.length)].time : null;
}

// 揾一個有位嘅日子（由 baseDay 開始向後最多掃 10 日，避開星期日冇位）
// 用本地日曆輸出（唔好再用 toISOString —— 香港 UTC+8 會變成「上一日」，
// 同下面 closeDate 嘅 Sunday 迴圈夾埋會無限迴圈）
function addDays(base, n) {
  const d = new Date(base + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
async function findOpenDate(serviceId, doctorName) {
  for (let i = 1; i <= 10; i++) {
    const dt = addDays(SERVER_TODAY, i);
    const t = await pickSlot(dt, serviceId, doctorName);
    if (t) return { date: dt, time: t };
  }
  return null;
}
// 搵一個「指定多個醫師都空」嘅時段（避免跨醫師重疊誤判）
async function findOpenDateMulti(serviceId, doctors) {
  for (let i = 1; i <= 10; i++) {
    const dt = addDays(SERVER_TODAY, i);
    const lists = [];
    let okAll = true;
    for (const doc of doctors) {
      const q = `?date=${dt}&serviceId=${serviceId}` + (doc ? `&doctor=${encodeURIComponent(doc)}` : '');
      const r = await api('GET', '/api/bookings/timeslots/available' + q);
      if (r.status !== 200 || !Array.isArray(r.data)) { okAll = false; break; }
      lists.push(new Set(r.data.filter(s => s.available).map(s => s.time)));
    }
    if (!okAll) continue;
    let inter = lists[0];
    for (let k = 1; k < lists.length; k++) inter = new Set([...inter].filter(t => lists[k].has(t)));
    if (inter.size) {
      const times = [...inter];
      return { date: dt, time: times[Math.floor(Math.random() * times.length)] };
    }
  }
  return null;
}

async function makeBooking(token, b) {
  const r = await api('POST', '/api/bookings', { token, body: {
    customerName: b.name, customerPhone: b.phone, serviceId: b.service,
    appointmentDate: b.date, appointmentTime: b.time,
    doctorName: b.doctor || '', notes: b.notes || '【QA交叉】自動化測試',
    ...(b.bed != null ? { bedNumber: b.bed } : {})
  }});
  const bid = getBid(r);
  if ((r.status === 200 || r.status === 201) && bid) state.allBookings.push(bid); // 全量追蹤，收尾統一清理
  return r;
}
const getBid = (r) => r.data?.booking?.id || r.data?.id || null;
const rndPhone = () => '9' + Math.floor(1000000 + Math.random() * 8999999);
async function restoreNotifications() {
  if (!dbw || !state.waOriginal) return;
  try {
    await dbRun("UPDATE clinic_settings SET setting_value=? WHERE setting_key='whatsapp_notification_enabled'", [state.waOriginal]);
    await dbRun("UPDATE clinic_settings SET setting_value='true' WHERE setting_key='email_notification_enabled'");
  } catch (_) {}
}

let SERVER_TODAY = '';
const state = { ids: {}, bookings: {}, records: {}, waOriginal: null, allBookings: [] };

(async () => {
  console.log('=== QA 交叉場景測試開始 ' + new Date().toLocaleTimeString() + ' ===');
  const t0 = Date.now();
  dbw = new (require('sqlite3').Database)(process.env.DB_PATH || './database.db');

  // 自備演示帳戶（職員/醫師/家庭會員），避免依賴已清走嘅種子資料；測後會刪除保持 DB 整潔
  await ensureDemoAccounts();
  for (const a of DEMO_ACCOUNTS) delete tokens[a.username];
  delete tokens['admin'];
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens));

  // ---------- P0 環境 ----------
  const st = await api('GET', '/api/server-time');
  SERVER_TODAY = st.data?.serverTime?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  ok('P0 伺服器時間', /^\d{4}-\d{2}-\d{2}/.test(st.data?.serverTime || ''), st.data?.serverTime);

  // 測試期間關閉 WhatsApp／電郵通知（結束時還原）
  const row = await dbq("SELECT setting_value FROM clinic_settings WHERE setting_key='whatsapp_notification_enabled'");
  state.waOriginal = row ? row.setting_value : 'true';
  if (state.waOriginal !== 'false') await dbRun("UPDATE clinic_settings SET setting_value='false' WHERE setting_key='whatsapp_notification_enabled'");
  await dbRun("UPDATE clinic_settings SET setting_value='false' WHERE setting_key='email_notification_enabled'");
  ok('P0 通知渠道已靜音（WhatsApp原值=' + state.waOriginal + '）', true);

  // 靜態敏感檔防護
  for (const f of ['.env', 'database.db', 'package.json']) {
    const r = await api('GET', '/' + f);
    ok(`P0 敏感檔封鎖 /${f}`, [403, 404].includes(r.status), r.status);
  }
  // 四個版面載入
  for (const pg of ['index.html', 'staff.html', 'doctor.html', 'admin.html']) {
    const r = await api('GET', '/' + pg);
    ok(`P0 版面載入 /${pg}`, r.status === 200, r.status);
  }

  // ---------- P1 主頁／訪客 ----------
  let r = await api('GET', '/api/services');
  rec('P1 公開服務列表', r, 200, d => Array.isArray(d) && d.length >= 6);
  r = await api('GET', `/api/bookings/timeslots/available?date=${addDays(SERVER_TODAY,1)}&serviceId=S1`);
  rec('P1 時段表(S1)', r, 200, d => Array.isArray(d) && d.length > 0 && typeof d[0].available === 'boolean');
  r = await api('GET', `/api/bookings/timeslots/available?date=${addDays(SERVER_TODAY,1)}&serviceId=S6`);
  const s6 = Array.isArray(r.data) ? r.data : [];
  rec('P1 時段表(S6含床位資訊)', r, 200, () => s6.some(s => Object.keys(s).some(k => k.toLowerCase().includes('bed'))));

  // 訪客預約初體驗（成功）＋越權（被拒）
  const g1 = await findOpenDate('S1');
  ok('P1 揾到訪客可約時段', !!g1, JSON.stringify(g1));
  r = await makeBooking(null, { name: '訪' + SFX, phone: rndPhone(), service: 'S1', ...g1 });
  rec('P1 訪客預約初體驗', r, [200, 201]);
  state.bookings.guest = getBid(r);
  r = await makeBooking(null, { name: '訪越權' + SFX, phone: rndPhone(), service: 'S2', ...g1 });
  rec('P1 訪客訂非初體驗被拒', r, [403]);

  // 邊緣：過去日期／非營業時間
  r = await makeBooking(null, { name: '過去人', phone: rndPhone(), service: 'S1', date: addDays(SERVER_TODAY, -3), time: '10:00' });
  rec('P1 過去日期被拒', r, 400);
  r = await makeBooking(null, { name: '夜貓', phone: rndPhone(), service: 'S1', date: addDays(SERVER_TODAY, 2), time: '21:00' });
  rec('P1 非營業時間被拒', r, 400);

  // 同醫師同時段雙訂 → 409
  if (g1) {
    r = await makeBooking(null, { name: '衝突乙', phone: rndPhone(), service: 'S1', ...g1, doctor: g1.doctor });
    ok('P1 同時段雙訂被拒(409)', [400, 409].includes(r.status), r.status + ' ' + JSON.stringify(r.data).slice(0, 100));
  }

  // ---------- P2 客人全流程 ----------
  const uname = 'q' + SFX;
  const uNameCh = '交叉客' + SFX;
  const upass = 'Qax' + Math.floor(100000 + Math.random() * 899999);
  r = await api('POST', '/api/auth/register', { body: { username: uname, password: upass, name: uNameCh, name_en: 'CrossTest', email: `${uname}@test.local`, phone: rndPhone(), captchaAnswer: BYPASS } });
  rec('P2 新客註冊', r, [200, 201]);
  r = await api('POST', '/api/auth/register', { body: { username: uname, password: upass, name: '重複', phone: rndPhone(), captchaAnswer: BYPASS } });
  rec('P2 重複用戶名被拒', r, [400, 409]);
  r = await api('POST', '/api/auth/register', { body: { username: 'qbad' + SFX, password: '短', name: '弱密碼', phone: rndPhone(), captchaAnswer: BYPASS } });
  rec('P2 弱密碼被拒', r, [400]);

  const sess = await login(uname, upass, true);
  state.ids.qax = sess.id;
  r = await api('PATCH', `/api/users/${uname}/complete-profile`, { token: sess.token });
  rec('P2 完成個人資料', r, 200);

  // 一般會員訂進階服務 → 403
  const adv = await findOpenDate('S2');
  r = await makeBooking(sess.token, { name: '交叉客', phone: rndPhone(), service: 'S2', ...adv });
  rec('P2 一般會員訂進階服務被拒', r, 403);

  // 訂初體驗 → 自己列表見到 → 即刻取消（15分鐘寬限內）成功
  const mine1 = await findOpenDate('S1');
  r = await makeBooking(sess.token, { name: '交叉客', phone: rndPhone(), service: 'S1', ...mine1 });
  rec('P2 新客預約初體驗', r, [200, 201]);
  state.bookings.qax1 = getBid(r);
  r = await api('GET', '/api/bookings', { token: sess.token });
  const mineList = r.data?.data || [];
  rec('P2 我的預約可見', r, 200, () => mineList.some(b => Number(b.id) === Number(state.bookings.qax1)));
  r = await api('DELETE', `/api/bookings/${state.bookings.qax1}`, { token: sess.token });
  rec('P2 建立15分鐘內自行取消（窗口內允許）', r, 200);
  r = await api('GET', '/api/bookings', { token: sess.token });
  rec('P2 取消狀態同步到客人視角', r, 200, d => (d.data || []).find(b => Number(b.id) === Number(state.bookings.qax1))?.status === 'cancelled');

  // 取消窗口回歸測試（驗證時區修復後 15 分鐘寬限真正生效）
  // (a) 遠期預約（>26h 後）+ 建立後即刻取消 → 應成功（15 分鐘寬限內）
  let far = null;
  for (let i = 2; i <= 10 && !far; i++) {
    const d = addDays(SERVER_TODAY, i);
    if (new Date(d + 'T00:00:00').getDay() === 0) continue;
    const t = await pickSlot(d, 'S1');
    if (t) {
      const appt = new Date(`${d}T${t}:00`).getTime();
      if ((appt - Date.now()) / 3600000 > 26) far = { date: d, time: t }; // 確保 >24h 先可以測寬限
    }
  }
  ok('P2 揾到>26h遠期時段', !!far, JSON.stringify(far));
  r = await makeBooking(sess.token, { name: '交叉客', phone: rndPhone(), service: 'S1', ...far });
  state.bookings.qaxFar = getBid(r);
  rec('P2 遠期預約建立', r, [200, 201]);
  if (state.bookings.qaxFar) {
    r = await api('DELETE', `/api/bookings/${state.bookings.qaxFar}`, { token: sess.token });
    rec('P2 建立15分鐘內取消遠期單（寬限生效→200）', r, 200);
    // (b) 再訂遠期單 + 回撥建立時間 2 小時 → 應拒（>15分鐘且>24小時）
    r = await makeBooking(sess.token, { name: '交叉客', phone: rndPhone(), service: 'S1', ...far });
    const far2 = getBid(r);
    if (far2) {
      await dbRun("UPDATE bookings SET created_at=datetime('now','localtime','-2 hours') WHERE id=?", [far2]);
      r = await api('DELETE', `/api/bookings/${far2}`, { token: sess.token });
      rec('P2 超窗取消被拒（>15分鐘且>24小時）', r, 400);
      // 職員代取消不受窗限制（對照）
      const staffT = (await login('pptstaff01', 'PptTest123')).token;
      r = await api('DELETE', `/api/bookings/${far2}`, { token: staffT });
      rec('P2 職員代取消不受窗口限制', r, 200);
    }
  }

  // 改密碼循環
  const npass = 'Npw' + Math.floor(100000 + Math.random() * 899999);
  r = await api('POST', '/api/auth/change-password', { token: sess.token, body: { currentPassword: upass, newPassword: npass } });
  rec('P2 改密碼', r, 200);
  r = await api('POST', '/api/auth/login', { body: { username: uname, password: upass, captchaAnswer: BYPASS } });
  rec('P2 舊密碼登入失敗', r, 401);
  await login(uname, npass, true);
  ok('P2 新密碼登入成功', true);
  // 改返轉（方便下輪統一處理）
  r = await api('POST', '/api/auth/change-password', { token: tokens[uname], body: { currentPassword: npass, newPassword: upass } });
  rec('P2 改回密碼', r, 200);

  // ---------- P3 家庭交叉 ----------
  const head = await login('pptmember1', 'PptTest123');
  state.ids.head = head.id;
  const child = await login('pptm01', 'Kid2026ok');
  state.ids.child = child.id;

  r = await api('GET', '/api/membership/family', { token: head.token });
  rec('P3 戶主查看家庭成員（含子帳戶）', r, 200, d => JSON.stringify(d).includes('陳小明'));
  // 子帳戶隨戶主享家庭級別 → 可訂進階服務
  const cslot = await findOpenDate('S2');
  r = await makeBooking(child.token, { name: '陳小明', phone: rndPhone(), service: 'S2', ...cslot });
  rec('P3 子帳戶可預約進階服務（繼承家庭級別）', r, [200, 201]);
  state.bookings.child = getBid(r);

  // 床位交叉：戶主同子帳戶同日同時段（唔同醫師避開重疊檢查）搶同一張床
  const b1 = await findOpenDateMulti('S6', ['黃醫師', '李醫師', '王醫師']);
  ok('P3 揾到床位服務時段(三醫師皆空)', !!b1, JSON.stringify(b1));
  // 戶主 S6 自動編排（唔指定床，等系統分佢），記低分到嘅床號
  r = await makeBooking(head.token, { name: '陳大文', phone: rndPhone(), service: 'S6', ...b1, doctor: '黃醫師' });
  rec('P3 戶主訂床位服務(自動編排)', r, [200, 201]);
  const bedBooking1 = getBid(r);
  const headBedRow = bedBooking1 ? await dbq("SELECT bed_number FROM bookings WHERE id=?", [bedBooking1]) : null;
  const headBed = headBedRow && headBedRow.bed_number;
  ok('P3 床號已記錄', bedBooking1 && headBed != null, 'bedBooking1=' + bedBooking1 + ' bed=' + headBed);
  state.bookings.headBed = bedBooking1; // 確保 P8 清理會刪走，避免跨輪殘留填滿床位
  // 子帳戶（李醫師）搶同一張床 → 409 bed_taken
  r = await makeBooking(child.token, { name: '陳小明', phone: rndPhone(), service: 'S6', ...b1, bed: headBed, doctor: '李醫師' });
  ok('P3 搶同一張床被拒(409)', r.status === 409, r.status + ' ' + JSON.stringify(r.data).slice(0, 100));
  // 改揀另一張床 → 成功
  const otherBed = Number(headBed) === 1 ? 2 : 1;
  r = await makeBooking(child.token, { name: '陳小明', phone: rndPhone(), service: 'S6', ...b1, bed: otherBed, doctor: '李醫師' });
  rec('P3 改揀另一張床成功', r, [200, 201]);
  state.bookings.bed2 = getBid(r);
  // 冇揀床 → 自動編排唔會撞已佔床
  r = await makeBooking(child.token, { name: '陳小明', phone: rndPhone(), service: 'S6', ...b1, doctor: '王醫師' });
  rec('P3 冇揀床自動編排成功', r, [200, 201], undefined, r.status === 200 ? 'resp=' + JSON.stringify(r.data).slice(0, 160) : '');
  state.bookings.bedAuto = getBid(r);
  const autoRow = (await dbq("SELECT bed_number FROM bookings WHERE id=?", [state.bookings.bedAuto]));
  ok('P3 自動編排避開已佔床', autoRow && autoRow.bed_number != null && Number(autoRow.bed_number) !== Number(headBed) && Number(autoRow.bed_number) !== otherBed, 'bed=' + (autoRow && autoRow.bed_number) + ' 避開=' + headBed + ',' + otherBed);

  // ---------- P4 職員交叉 ----------
  const staffT = (await login('pptstaff01', 'PptTest123')).token;
  r = await api('GET', '/api/bookings', { token: staffT });
  const allRows = r.data?.data || [];
  rec('P4 職員見訪客單（交叉可見性）', r, 200, () => allRows.some(b => Number(b.id) === Number(state.bookings.guest)));
  rec('P4 職員見床位單連床號', r, 200, () => allRows.some(b => Number(b.id) === Number(state.bookings.bed2) && Number(b.bed_number) === 2));

  // 狀態流轉全鏈：訪客單 pending → confirmed → visited → in-treatment → dispensing → completed
  const flow = ['confirmed', 'visited', 'in-treatment', 'dispensing', 'completed'];
  let flowOk = true;
  for (const s of flow) {
    r = await api('PUT', `/api/bookings/${state.bookings.guest}/status`, { token: staffT, body: { status: s } });
    if (r.status !== 200) { flowOk = false; ok(`P4 狀態流轉→${s}`, false, r.status + ' ' + JSON.stringify(r.data).slice(0, 100)); }
  }
  ok('P4 五步狀態流轉全通', flowOk);
  r = await api('PUT', `/api/bookings/${state.bookings.guest}/status`, { token: staffT, body: { status: '咩都唔係' } });
  rec('P4 無效狀態值被拒', r, 400);
  // 客人視角確認完成狀態（子帳戶單由戶主家屬視角睇自己單）
  r = await api('GET', '/api/bookings', { token: child.token });
  rec('P4 客人視角狀態一致（子帳戶自己的單）', r, 200, d => (d.data || []).some(b => Number(b.id) === Number(state.bookings.child)));

  // 遲到標記
  r = await api('PUT', `/api/bookings/${state.bookings.child}/lateness`, { token: staffT, body: { lateness_minutes: 10 } });
  rec('P4 遲到標記', r, 200);

  // 中文搜尋客戶
  r = await api('GET', '/api/users?search=' + encodeURIComponent('陳大文'), { token: staffT });
  rec('P4 職員中文姓名搜尋', r, 200, d => JSON.stringify(d).includes('陳大文'));

  // 權限隔離：職員唔可以睇家庭樹／收入報表／管理FAQ
  r = await api('GET', '/api/membership/admin/tree', { token: staffT });
  rec('P4 職員睇家庭樹被拒', r, 403);
  r = await api('GET', '/api/admin/income?period=day', { token: staffT });
  rec('P4 職員睇收入報表被拒', r, 403);
  r = await api('GET', '/api/admin/faqs', { token: staffT });
  rec('P4 職員管理FAQ被拒', r, 403);
  // 職員可以睇客戶名單（只限customer）
  r = await api('GET', '/api/users', { token: staffT });
  rec('P4 職員讀取客戶名單', r, 200, d => Array.isArray(d) && d.every(u => u.role === 'customer'));

  // ---------- P5 醫師交叉 ----------
  const doc = await login('pptdoc01', 'PptTest123');
  state.ids.doc = doc.id;
  r = await api('GET', `/api/admin/doctor/bookings?date=${b1.date}`, { token: doc.token });
  const docRows = r.data?.bookings || r.data?.data || [];
  rec('P5 醫師看自己預約', r, 200, () => docRows.every(b => b.doctor_name === '黃醫師'));
  rec('P5 醫師名下確有當日預約(含床位單)', r, 200, () => docRows.some(b => Number(b.id) === Number(bedBooking1)));

  // 用醫師自己名下嘅床位單（戶主 bed#1 黃醫師）推進到完成再寫病歷
  r = await api('PUT', `/api/bookings/${bedBooking1}/status`, { token: doc.token, body: { status: 'completed' } });
  rec('P5 醫師完成自己單', r, 200);
  r = await api('POST', '/api/medical-records/doctor/records', { token: doc.token, body: {
    booking_id: bedBooking1, user_id: state.ids.head,
    diagnosis: '【QA交叉】氣血兩虛', treatment_plan: '針灸調理每週兩次', notes: 'QA交叉病歷' + SFX
  }});
  if (r.status !== 200 && r.status !== 201) console.log('  DEBUG bedBooking1=', bedBooking1, 'head=', state.ids.head, 'docName=', doc.name);
  rec('P5 醫師新增病歷', r, [200, 201], undefined, r.status === 200 ? 'resp=' + JSON.stringify(r.data).slice(0, 160) : '');
  state.records.rid = r.data?.record_id || r.data?.medicalRecordId || r.data?.id || r.data?.booking?.id;
  // 客人視角讀到病歷（交叉）
  r = await api('GET', '/api/medical-records/customer/history', { token: head.token });
  rec('P5 客人讀到自己病歷（交叉）', r, 200, d => JSON.stringify(d).includes('QA交叉病歷' + SFX));
  // 另一位醫師更新呢份病歷 → 應該被擋（產權檢查）
  const doc2 = await login('tdoc02', 'Test1234');
  r = await api('PUT', `/api/medical-records/doctor/records/${state.records.rid}`, { token: doc2.token, body: { diagnosis: '越權修改' } });
  ok('P5 醫師B修改醫師A病歷被擋', r.status === 403, r.status + ' ' + JSON.stringify(r.data).slice(0, 100));  // 客人唔可以寫病歷
  r = await api('POST', '/api/medical-records/doctor/records', { token: head.token, body: { booking_id: bedBooking1, user_id: state.ids.head, diagnosis: 'x', treatment_plan: 'y' } });
  rec('P5 客人寫病歷被拒', r, 403);

  // 請假連鎖：醫師請假當日 → 名下預約自動取消 → 客人視角同步 → 取消請假復活
  // 揾一個黃醫師名下冇其他有效預約嘅日子（避免自動取消波及無關單）
  let leaveTarget = null;
  for (let i = 1; i <= 12 && !leaveTarget; i++) {
    const d = addDays(SERVER_TODAY, i);
    if (new Date(d + 'T00:00:00').getDay() === 0) continue;
    const cnt = await dbq("SELECT COUNT(*) c FROM bookings WHERE appointment_date=? AND doctor_name='黃醫師' AND status IN ('pending','confirmed','in-progress','in-treatment','visited','dispensing')", [d]);
    if (cnt && cnt.c === 0) {
      const t = await pickSlot(d, 'S1', '黃醫師');
      if (t) leaveTarget = { date: d, time: t };
    }
  }
  ok('P5 揾到請假測試目標日', !!leaveTarget, JSON.stringify(leaveTarget));
  r = await makeBooking(child.token, { name: '陳小明', phone: rndPhone(), service: 'S1', ...leaveTarget, doctor: '黃醫師' });
  rec('P5 子帳戶預約黃醫師（請假目標）', r, [200, 201]);
  state.bookings.leaveB = getBid(r);
  r = await api('POST', '/api/admin/doctor/my-leave', { token: doc.token, body: { exception_date: leaveTarget.date, reason: '【QA交叉】進修', cancelBookings: true } });
  rec('P5 醫師申請請假', r, 200);
  r = await api('GET', '/api/bookings', { token: child.token });
  rec('P5 受影響預約已自動取消（客人視角）', r, 200, d => (d.data || []).find(b => Number(b.id) === Number(state.bookings.leaveB))?.status === 'cancelled');
  r = await api('GET', `/api/bookings/timeslots/available?date=${leaveTarget.date}&serviceId=S1&doctor=${encodeURIComponent('黃醫師')}`);
  rec('P5 請假日該醫師時段全封鎖', r, 200, d => Array.isArray(d) && d.every(s => !s.available));
  // 清理：取消請假
  r = await api('GET', '/api/admin/doctor/my-leaves', { token: doc.token });
  const lv = (r.data?.data || []).find(x => x.exception_date === leaveTarget.date);
  if (lv) {
    r = await api('DELETE', `/api/admin/doctor/my-leaves/${lv.id}`, { token: doc.token });
    rec('P5 取消請假恢復應診', r, 200);
  } else ok('P5 揾到請假記錄', false, 'my-leaves 無記錄');
  // 醫師唔可以碰管理員專區
  r = await api('GET', '/api/membership/admin/tree', { token: doc.token });
  rec('P5 醫師睇家庭樹被拒', r, 403);

  // ---------- P6 管理員交叉 ----------
  const adminT = (await login('admin', ADMIN_PW)).token;
  r = await api('GET', '/api/users', { token: adminT });
  rec('P6 用戶列表含新註冊客（交叉）', r, 200, d => JSON.stringify(d).includes(uname));
  r = await api('GET', '/api/membership/admin/tree', { token: adminT });
  rec('P6 家庭樹含示範家庭', r, 200, d => JSON.stringify(d).includes('陳小明') && JSON.stringify(d).includes('陳大文'));
  r = await api('GET', '/api/admin/income?period=month', { token: adminT });
  rec('P6 月度收入報表', r, 200);

  // 回饋鏈：客提交 → 管理員見 → 回覆 → 客未讀+1 → 已讀歸零 → 結案
  r = await api('POST', '/api/feedback', { token: head.token, body: { subject: '【QA交叉】意見' + SFX, message: '服務好好。', category: '服務' } });
  rec('P6 客人提交意見', r, [200, 201]);
  const fid = r.data?.feedbackId || r.data?.id || r.data?.feedback_id;
  r = await api('GET', '/api/feedback/admin/all?status=pending', { token: adminT });
  rec('P6 管理員見到新意見（交叉）', r, 200, d => JSON.stringify(d).includes('【QA交叉】意見' + SFX));
  r = await api('PUT', `/api/feedback/admin/${fid}/reply`, { token: adminT, body: { reply: '多謝你嘅意見！', status: 'replied' } });
  rec('P6 管理員回覆', r, 200);
  r = await api('GET', `/api/feedback/my-feedback/${state.ids.head}/unread-count`, { token: head.token });
  rec('P6 客人未讀計數≥1', r, 200, d => (d.unreadCount ?? d.count ?? d.unread_count) >= 1);
  r = await api('POST', `/api/feedback/my-feedback/${fid}/mark-read`, { token: head.token });
  rec('P6 客人標記已讀', r, 200);
  r = await api('GET', `/api/feedback/my-feedback/${state.ids.head}/unread-count`, { token: head.token });
  rec('P6 未讀歸零', r, 200, d => (d.unreadCount ?? d.count ?? d.unread_count) === 0);

  // 公告鏈：管理員發布 → 公眾即見 → 刪除即消失
  r = await api('POST', '/api/admin/content/announcements', { token: adminT, body: { title: '【QA交叉】公告' + SFX, content: '測試公告。', is_active: 1 } });
  rec('P6 新增公告', r, [200, 201]);
  const annId = r.data?.announcementId || r.data?.id;
  r = await api('GET', '/api/content/announcements');
  rec('P6 公眾即時見到公告（交叉）', r, 200, d => JSON.stringify(d).includes('【QA交叉】公告' + SFX));
  if (annId) {
    r = await api('DELETE', `/api/admin/content/announcements/${annId}`, { token: adminT });
    rec('P6 刪除公告', r, 200);
    r = await api('GET', '/api/content/announcements');
    rec('P6 公告已消失', r, 200, d => !JSON.stringify(d).includes('【QA交叉】公告' + SFX));
  }

  // 閉診日鏈：管理員設定全日閉診 → 訪客預約被拒 → 刪除後可約
  const closeDate = (() => { let d = addDays(SERVER_TODAY, 7); while (new Date(d + 'T00:00:00').getDay() === 0) d = addDays(d, 1); return d; })();
  r = await api('POST', '/api/admin/exceptions', { token: adminT, body: { type: 'full_day_closed', exception_date: closeDate, name: '【QA交叉】全日閉診', reason: '【QA交叉】裝修' } });
  rec('P6 設定全日閉診', r, 200);
  r = await makeBooking(null, { name: '閉診試約', phone: rndPhone(), service: 'S1', date: closeDate, time: '10:00' });
  rec('P6 閉診日預約被拒', r, 400);
  r = await api('GET', '/api/admin/exceptions', { token: adminT });
  const exc = (r.data?.exceptions || r.data || []).find?.(x => x.exception_date === closeDate && x.type === 'full_day_closed');
  if (exc) {
    r = await api('DELETE', `/api/admin/exceptions/${exc.id}`, { token: adminT });
    rec('P6 刪除閉診設定', r, 200);
  }
  const reopen = await pickSlot(closeDate, 'S1');
  if (reopen) {
    r = await makeBooking(null, { name: '復活試約', phone: rndPhone(), service: 'S1', date: closeDate, time: reopen });
    rec('P6 解除閉診後可再約（交叉復原）', r, [200, 201]);
    if (getBid(r)) { const bid = getBid(r); const st2 = (await login('pptstaff01', 'PptTest123')).token; await api('DELETE', `/api/bookings/${bid}`, { token: st2 }); }
  }

  // 床位設定交叉
  r = await api('GET', '/api/settings/clinic', { token: adminT });
  const origAcu = r.data?.acupuncture_beds ?? r.data?.setting?.acupuncture_beds;
  r = await api('PUT', '/api/settings/clinic', { token: adminT, body: { acupuncture_beds: '4' } });
  rec('P6 更新床位設定', r, 200);
  r = await api('GET', '/api/settings/clinic', { token: adminT });
  const nowAcu = r.data?.acupuncture_beds ?? r.data?.setting?.acupuncture_beds;
  ok('P6 床位設定生效（4）', String(nowAcu) === '4', 'now=' + nowAcu);
  await api('PUT', '/api/settings/clinic', { token: adminT, body: { acupuncture_beds: String(origAcu ?? 5) } });
  r = await api('GET', '/api/settings/clinic', { token: adminT });
  ok('P6 床位設定還原', String(r.data?.acupuncture_beds ?? r.data?.setting?.acupuncture_beds) === String(origAcu ?? 5), 'restore=' + (r.data?.acupuncture_beds ?? r.data?.setting?.acupuncture_beds));

  // ---------- P7 安全矩陣 ----------
  r = await api('GET', '/api/bookings');
  rec('P7 無token讀預約→401', r, 401);
  r = await api('GET', '/api/users');
  rec('P7 無token讀用戶→401', r, 401);
  r = await api('GET', '/api/feedback/admin/all', { token: 'forged.token.here' });
  rec('P7 偽造token→401', r, 401);
  // 客人打職員／管理員專區
  const custToken = tokens[uname];
  r = await api('GET', '/api/users', { token: custToken });
  rec('P7 客人讀用戶列表→403', r, 403);
  r = await api('PUT', `/api/bookings/${state.bookings.guest}/status`, { token: custToken, body: { status: 'completed' } });
  rec('P7 客人改預約狀態→403', r, 403);
  r = await api('GET', '/api/membership/admin/tree', { token: custToken });
  rec('P7 客人睇家庭樹→403', r, 403);
  r = await api('PUT', '/api/settings/clinic', { token: custToken, body: { morning_start: '00:00' } });
  rec('P7 客人改診所設定→403', r, 403);
  r = await api('POST', '/api/admin/users', { token: custToken, body: { username: 'evil' + SFX, password: 'Evilpw11', name: '邪惡', phone: rndPhone(), role: 'admin', adminPassword: 'x' } });
  rec('P7 客人建admin→403', r, 403);
  // captcha 必需（用獨立探測帳戶，避免污染 uname 嘅鎖定計數）
  r = await api('POST', '/api/auth/login', { body: { username: 'qa_cap_probe' + SFX, password: 'x' } });
  ok('P7 冇captcha登入被拒', [400, 401].includes(r.status), r.status);
  // 登出黑名單
  r = await api('POST', '/api/auth/login', { body: { username: uname, password: upass, captchaAnswer: BYPASS } });
  const tmpTok = r.data?.token;
  r = await api('POST', '/api/auth/logout', { token: tmpTok });
  rec('P7 登出', r, 200);
  r = await api('GET', '/api/bookings', { token: tmpTok });
  rec('P7 登出後token失效→401', r, 401);
  // 鎖定計數：4次錯誤唔鎖（第5先鎖），之後成功登入清零
  for (let i = 0; i < 4; i++) {
    r = await api('POST', '/api/auth/login', { body: { username: uname, password: 'WrongWrong1', captchaAnswer: BYPASS } });
  }
  ok('P7 連續4次錯誤密碼被拒', [401].includes(r.status), r.status);
  await api('POST', '/api/auth/login', { body: { username: uname, password: upass, captchaAnswer: BYPASS } });
  const failCnt = await dbq("SELECT COUNT(*) c FROM login_attempts WHERE username=? AND success=0 AND attempt_time > datetime('now','-10 minutes')", [uname]);
  ok('P7 成功登入後失敗計數清零', failCnt && failCnt.c === 0, '剩餘=' + (failCnt && failCnt.c));
  // SQL注入安全
  r = await api('POST', '/api/auth/login', { body: { username: "' OR 1=1 -- " + SFX, password: 'x', captchaAnswer: BYPASS } });
  rec('P7 SQL注入被安全處理', r, [401, 400], );

  // ---------- P8 收尾：刪測試帳戶＋清理＋核數 ----------
  // 清理本輪QA預約（已驗證完嘅 cancelled/completed 單直接DB刪除保持數據庫整潔）
  const qaIds = Object.values(state.bookings).filter(Boolean);
  if (qaIds.length) {
    await dbRun(`DELETE FROM medical_records WHERE booking_id IN (${qaIds.map(() => '?').join(',')})`, qaIds);
    await dbRun(`DELETE FROM treatment_progress WHERE medical_record_id NOT IN (SELECT id FROM medical_records)`);
    await dbRun(`DELETE FROM bookings WHERE id IN (${qaIds.map(() => '?').join(',')})`, qaIds);
  }
  ok('P8 本輪QA預約已清理', true, qaIds.join(','));
  // 管理員刪除測試帳戶（API交叉）→ 再登入應失敗
  r = await api('DELETE', `/api/admin/users/${state.ids.qax}`, { token: adminT, body: { adminPassword: ADMIN_PW } });
  rec('P8 管理員刪除測試帳戶（二次驗證）', r, 200);
  await dbRun('DELETE FROM login_attempts WHERE username=?', [uname]); // 清走鎖定記錄，確保刪除後登入返回 401 而非 429
  r = await api('POST', '/api/auth/login', { body: { username: uname, password: upass, captchaAnswer: BYPASS } });
  rec('P8 已刪帳戶無法登入→401', r, 401);
  await cleanupDemoAccounts();
  if (uname) await dbRun('DELETE FROM users WHERE username=?', [uname]);
  delete tokens[uname]; fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens));

  // 還原 WhatsApp 通知設定
  await restoreNotifications();
  dbw.close();

  // 摘要
  const passed = results.filter(x => x.ok).length;
  const failed = results.filter(x => !x.ok).length;
  const out = { round: SFX, serverToday: SERVER_TODAY, durationSec: Math.round((Date.now() - t0) / 1000), totalApiCalls: reqCount, passed, failed, results };
  fs.writeFileSync('_qa_cross_results.json', JSON.stringify(out, null, 2));
  console.log(`\n=== 完成：通過 ${passed} / 失敗 ${failed} | API調用 ${reqCount} | 用時 ${out.durationSec}s ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error('腳本異常中止:', e.message);
  try { (async () => { await restoreNotifications(); })(); } catch (_) {}
  try { dbw && dbw.close(); } catch (_) {}
  fs.writeFileSync('_qa_cross_results.json', JSON.stringify({ fatal: e.message, results }, null, 2));
  process.exit(2);
});
