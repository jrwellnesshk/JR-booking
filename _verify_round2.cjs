/* _verify_round2.cjs — 第二輪修復（P0 相片外洩 / cookie secure / clear 空body / family_head_id / 音頻取消）回歸驗證
 * 修復清單：
 *   ① server.js：/uploads/medical_records 認證 handler 移到靜態閘門前（P0 相片外洩）
 *   ② routes/auth.js：clinic_session cookie secure 按實際協議
 *   ③ routes/bookings.js：DELETE /clear 空 body → 400（唔再 500）
 *   ④ routes/memberships.js：account-links 後戶主 family_head_id=自己（isHead 修正）
 *   ⑤ 音頻取消：上傳只收相片、音頻欄一律 null、音頻下載端點移除
 * 隔離：VACUUM INTO 快照 + 獨立埠 4760，絕不觸摸 live DB / live dev server
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sqlite3 = require('sqlite3');
const bcrypt = require('bcrypt');

const ROOT = __dirname;
const PORT = 4760;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(ROOT, '_verify2.db');
const PW = 'Verify@2026';
const results = { tests: [], summary: { pass: 0, fail: 0 } };

function T(name, pass, detail) {
  results.tests.push({ name, pass, detail: String(detail).slice(0, 220) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${String(detail).slice(0, 160)}`);
  if (pass) results.summary.pass++; else results.summary.fail++;
}

const dbAll = (db, sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r || [])));
const dbGet = (db, sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));
const dbRun = (db, sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));

function snapshot() {
  return new Promise((resolve) => {
    const sdb = new sqlite3.Database(path.join(ROOT, 'database.db'), (e) => {
      if (e) return resolve(false);
      sdb.exec(`VACUUM INTO '${DB.replace(/\\/g, '/')}'`, (err) => { sdb.close(); resolve(!err); });
    });
  });
}

let srv = null, srvLog = '', srvErr = '';
function startServer() {
  srvLog = ''; srvErr = '';
  srv = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, CAPTCHA_TEST_BYPASS: 'test999', ALLOW_UNSAFE_START: '1', NODE_ENV: 'development', SESSION_SECRET: 'verify_round2_secret_0123456789' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', d => srvLog += d);
  srv.stderr.on('data', d => srvErr += d);
}
function stopServer() { if (srv) { try { srv.kill('SIGKILL'); } catch (e) {} srv = null; } }
process.on('exit', stopServer);

let reqCount = 0;
async function req(method, p, { token, cookie, body, raw } = {}) {
  const h = {};
  if (token) h['Authorization'] = 'Bearer ' + token;
  if (cookie) h['Cookie'] = cookie;
  h['X-Forwarded-For'] = `10.77.${Math.floor(reqCount / 250) % 200}.${(reqCount++ % 250) + 1}`; // 輪換避免全域限流
  let b;
  if (body !== undefined && !(body instanceof FormData)) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  else if (body instanceof FormData) b = body;
  else if (raw !== undefined) { h['Content-Type'] = 'application/json'; b = raw; }
  try {
    const r = await fetch(BASE + p, { method, headers: h, body: b });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch (e) {}
    const setCookie = (typeof r.headers.getSetCookie === 'function') ? r.headers.getSetCookie() : [];
    return { status: r.status, text, json, setCookie };
  } catch (e) { return { status: 0, text: 'FETCH_ERR ' + e.message, json: null, setCookie: [] }; }
}

async function loginRaw(username, portal) {
  return req('POST', '/api/auth/login', { body: { username, password: PW, captchaAnswer: 'test999', portal } });
}

(async () => {
  // ---------- 隔離設置 ----------
  for (const ext of ['', '-wal', '-shm']) { const f = DB + ext; if (fs.existsSync(f)) fs.unlinkSync(f); }
  let ok = false;
  for (let i = 0; i < 5 && !ok; i++) ok = await snapshot();
  if (!ok) { console.error('!! snapshot 失敗'); process.exit(1); }

  const db = new sqlite3.Database(DB);
  const hash = bcrypt.hashSync(PW, 10);
  const KNOWN = ['admin', 'teststaff', 'testdoctor', 'testcustomer', 'testfamily', 'testkid1'];
  const uid = {};
  for (const u of KNOWN) {
    await dbRun(db, 'UPDATE users SET password=?, must_change_password=0, profile_completed=1, is_active=1 WHERE username=?', [hash, u]);
    const r = await dbGet(db, 'SELECT id FROM users WHERE username=?', [u]);
    uid[u] = r && r.id;
  }

  // seed 連結測試帳戶（如冇就按表結構插入）
  const cols = await dbAll(db, 'PRAGMA table_info(users)');
  const colNames = cols.map(c => c.name);
  for (const [name, no] of [['vlink1', 'VLNK01'], ['vlink2', 'VLNK02']]) {
    const ex = await dbGet(db, 'SELECT id FROM users WHERE username=?', [name]);
    if (ex) { uid[name] = ex.id; continue; }
    const vals = { username: name, password: hash, name: '驗證' + name, role: 'customer', phone: '9' + String(Math.floor(1000000 + Math.random() * 8999999)).slice(0, 7), email: name + '@verify.test', member_no: no, membership_tier: 'general', is_active: 1, must_change_password: 0, profile_completed: 1 };
    const useCols = colNames.filter(c => vals[c] !== undefined);
    try {
      const r = await dbRun(db, `INSERT INTO users (${useCols.join(',')}) VALUES (${useCols.map(() => '?').join(',')})`, useCols.map(c => vals[c]));
      uid[name] = r.lastID;
    } catch (e) { console.error('!! seed ' + name + ' 失敗:', e.message); }
  }
  await new Promise(r => db.close(r));

  startServer();
  let up = false;
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + '/health'); if (r.ok) { up = true; break; } } catch (e) {} await new Promise(r => setTimeout(r, 350)); }
  if (!up) { console.error('!! server 起唔來:', srvLog.slice(-400)); process.exit(1); }

  const tok = {};
  const cookieOf = {};
  for (const [u, portal] of [['admin', 'admin'], ['teststaff', 'staff'], ['testcustomer', 'customer'], ['vlink1', 'customer'], ['vlink2', 'customer']]) {
    const lr = await loginRaw(u, portal);
    if (lr.status === 200 && lr.json && lr.json.token) {
      tok[u] = lr.json.token;
      const sc = (lr.setCookie || []).join(' | ');
      cookieOf[u] = (sc.match(/clinic_session=[^;]+/) || [''])[0] || null;
    } else console.log(`  !! ${u} 登入失敗 ${lr.status} ${lr.text.slice(0, 100)}`);
  }

  // ---------- ② cookie secure 修復 ----------
  {
    const lr = await loginRaw('testcustomer', 'customer');
    const raw = (lr.setCookie || []).join(' | ');
    const hasSecure = /clinic_session=[^;]*;\s*Secure/i.test(raw);
    T('② clinic_session cookie：http 下唔帶 Secure（可被瀏覽器接受）', lr.status === 200 && !hasSecure, raw.slice(0, 140));
  }

  // ---------- ①+⑤ 病歷檔案 ----------
  let recId = null, photoPath = null;
  {
    // 造預約
    const doks = await req('GET', '/api/doctors');
    const doc = ((doks.json && (doks.json.doctors || doks.json)) || [])[0];
    let bid = null;
    for (let i = 1; i <= 14 && !bid; i++) {
      const ds = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10);
      const r = await req('POST', '/api/bookings', { token: tok.testcustomer, body: { serviceId: 'S2', doctorId: doc && doc.id, appointmentDate: ds, appointmentTime: '11:00', customerName: '回歸驗證', customerPhone: '91330001' } });
      if (r.json && (r.json.bookingId || r.json.id || (r.json.booking && r.json.booking.id))) bid = r.json.bookingId || r.json.id || r.json.booking.id;
    }
    T('前置：建立預約', !!bid, 'booking=' + bid);

    // ⑤a 上傳帶音頻 → 應被拒
    {
      const fd = new FormData();
      fd.append('booking_id', String(bid));
      fd.append('user_id', String(uid.testcustomer));
      fd.append('diagnosis', '驗證診斷');
      fd.append('treatment_plan', '驗證方案');
      fd.append('audio', new Blob([Buffer.from('ID3FAKEAUDIO')], { type: 'audio/mpeg' }), 'x.mp3');
      const r = await req('POST', '/api/medical-records/doctor/records', { token: tok.teststaff, body: fd });
      T('⑤ 音頻上傳被拒（multer 只收相片）', r.status >= 400, r.status + ' ' + r.text.slice(0, 100));
    }
    // ⑤b 純相片上傳 → 200 且 audio_file_path=null
    {
      const fd = new FormData();
      fd.append('booking_id', String(bid));
      fd.append('user_id', String(uid.testcustomer));
      fd.append('diagnosis', '驗證診斷');
      fd.append('treatment_plan', '驗證方案');
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
      fd.append('photos', new Blob([png], { type: 'image/png' }), 'v.png');
      const r = await req('POST', '/api/medical-records/doctor/records', { token: tok.teststaff, body: fd });
      const db2 = new sqlite3.Database(DB);
      const rec = await dbGet(db2, 'SELECT id, audio_file_path FROM medical_records WHERE booking_id=? ORDER BY id DESC LIMIT 1', [bid]);
      const ph = await dbAll(db2, 'SELECT photo_file_path FROM medical_record_photos WHERE medical_record_id=?', [rec ? rec.id : -1]);
      await new Promise(rr => db2.close(rr));
      T('⑤ 純相片上傳成功 + audio_file_path=null', r.status === 200 && rec && rec.audio_file_path === null && ph.length === 1, `status=${r.status} audio=${rec && rec.audio_file_path} photos=${ph.length}`);
      if (rec) recId = rec.id;
      if (ph[0]) photoPath = ph[0].photo_file_path;
    }

    if (photoPath) {
      // ①a 無認證 → 401
      const a = await req('GET', photoPath);
      T('① 病歷相片無認證 → 401（P0 已修）', a.status === 401, `GET ${photoPath} -> ${a.status}`);
      // ①b 擁有者 JWT → 200
      const b = await req('GET', photoPath, { token: tok.testcustomer });
      T('① 病歷相片擁有者 JWT → 200', b.status === 200, `-> ${b.status} len=${b.text.length}`);
      // ①c 擁有者 clinic_session cookie（<img> 元素式）→ 200
      const c = await req('GET', photoPath, { cookie: cookieOf.testcustomer });
      T('① 病歷相片 cookie（元素式請求）→ 200', c.status === 200, `-> ${c.status}`);
      // ①d 其他客戶 → 403
      const d = await req('GET', photoPath, { token: tok.vlink2 });
      T('① 他人的病歷相片 → 403', d.status === 403, `-> ${d.status}`);
      // ①e 員工 → 200
      const e = await req('GET', photoPath, { token: tok.teststaff });
      T('① 員工存取病歷相片 → 200', e.status === 200, `-> ${e.status}`);
    } else T('① 病歷相片測試（無相片可測）', false, 'photoPath missing');

    // 非醫療 uploads 照舊（搵一個現存非 medical_records 檔案）
    {
      let staticFile = null;
      const walk = (dir, depth) => {
        if (staticFile || depth > 2) return;
        let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        for (const ent of ents) {
          const p = path.join(dir, ent.name);
          if (ent.isDirectory()) { if (ent.name !== 'medical_records' && ent.name !== 'node_modules') walk(p, depth + 1); }
          else if (/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(ent.name)) { staticFile = p; return; }
        }
      };
      walk(path.join(ROOT, 'uploads'), 0);
      if (staticFile) {
        const rel = '/uploads/' + path.relative(path.join(ROOT, 'uploads'), staticFile).replace(/\\/g, '/');
        const r = await req('GET', rel);
        T('① 非醫療 uploads 檔案照舊公開（頭像等）', r.status === 200, `GET ${rel} -> ${r.status}`);
      } else T('① 非醫療 uploads 檔案（無樣本可測）', true, 'uploads 內無現存非醫療圖片，跳過');
    }
  }

  // ---------- ⑤ 音頻端點已移除 ----------
  if (recId) {
    const a = await req('GET', `/api/medical-records/customer/records/${recId}/audio`, { token: tok.testcustomer });
    T('⑤ 客人音頻下載端點已移除（404）', a.status === 404, `-> ${a.status}`);
    const b = await req('GET', `/api/medical-records/admin/records/${recId}/audio`, { token: tok.teststaff });
    T('⑤ 員工音頻下載端點已移除（404）', b.status === 404, `-> ${b.status}`);
  }

  // ---------- ③ DELETE /clear 空 body ----------
  {
    const a = await req('DELETE', '/api/bookings/clear', { token: tok.admin });
    T('③ clear 無 body → 400（唔再 500）', a.status === 400, `-> ${a.status} ${a.text.slice(0, 80)}`);
    const b = await req('DELETE', '/api/bookings/clear', { token: tok.admin, raw: JSON.stringify({}) });
    T('③ clear 空 JSON → 400', b.status === 400, `-> ${b.status} ${b.text.slice(0, 80)}`);
  }

  // ---------- ④ family_head_id 修復 ----------
  {
    const r = await req('POST', '/api/membership/account-links', { token: tok.vlink1, body: { target_username: 'vlink2', relation: '配偶' } });
    const db3 = new sqlite3.Database(DB);
    const o = await dbGet(db3, 'SELECT id, family_head_id, membership_tier FROM users WHERE username=?', ['vlink1']);
    const t = await dbGet(db3, 'SELECT id, family_head_id, membership_tier FROM users WHERE username=?', ['vlink2']);
    await new Promise(rr => db3.close(rr));
    const ok1 = r.status === 200;
    const ok2 = o && Number(o.family_head_id) === Number(o.id) && o.membership_tier === 'family';
    const ok3 = t && Number(t.family_head_id) === Number(o.id) && t.membership_tier === 'family';
    T('④ 連結後戶主 family_head_id=自己 + 雙方升 family', ok1 && ok2 && ok3, `link=${r.status} owner(head=${o && o.family_head_id}/${o && o.id},tier=${o && o.membership_tier}) target(head=${t && t.family_head_id},tier=${t && t.membership_tier})`);
    // family-payment isHead
    const fp = await req('GET', '/api/membership/family-payment', { token: tok.vlink1 });
    const j = fp.json || {};
    T('④ 戶主 family-payment isHead=true（唔再引導接手供款）', fp.status === 200 && j.isHead === true, `-> ${fp.status} isHead=${j.isHead} canTakeOver=${j.canTakeOver}`);
    // 家庭戶主代成員預約（原有流程）
    const doks = await req('GET', '/api/doctors');
    const doc = ((doks.json && (doks.json.doctors || doks.json)) || [])[0];
    let booked = null, lastBody = '';
    for (let i = 1; i <= 14 && !booked; i++) {
      const ds = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10);
      const rr = await req('POST', '/api/membership/family/bookings', { token: tok.vlink1, body: { for_user_id: uid.vlink2, serviceId: 'S2', doctor_name: doc && doc.name, appointment_date: ds, appointment_time: '15:00', customer_phone: '91330002' } });
      lastBody = rr.status + ' ' + rr.text.slice(0, 100);
      if (rr.status === 200) booked = true;
    }
    T('原有流程：戶主代家庭成員預約（family tier 可約非初體驗）', !!booked, lastBody);
  }

  // ---------- 原有流程無破壞 ----------
  {
    const a = await req('GET', '/api/doctors');
    T('原有流程：/api/doctors', a.status === 200, `-> ${a.status}`);
    const b = await req('GET', '/api/medical-records/customer/history', { token: tok.testcustomer });
    T('原有流程：客人病歷 history', b.status === 200, `-> ${b.status} recs=${b.json && b.json.data ? b.json.data.length : '?'}`);
    const c = await req('GET', '/api/membership', { token: tok.testcustomer });
    T('原有流程：會員狀態（GET /api/membership）', c.status === 200, `-> ${c.status} tier=${c.json && c.json.tier}`);
    const d = await req('GET', '/api/medical-records/admin/all', { token: tok.teststaff });
    T('原有流程：員工病歷列表（含 photos）', d.status === 200, `-> ${d.status} total=${d.json && d.json.total}`);
    const e = await req('GET', '/api/bookings', { token: tok.admin });
    T('原有流程：管理員預約列表', e.status === 200, `-> ${e.status}`);
  }

  // ---------- stderr TypeError 掃描 ----------
  const typeErrors = (srvErr.match(/TypeError[^\n]*/g) || []).filter(l => !/headers|fetch/i.test(l));
  T('無伺服器 TypeError（clear 500 已修）', typeErrors.length === 0, typeErrors.slice(0, 3).join(' || ') || 'stderr 乾淨');

  stopServer();
  for (const ext of ['', '-wal', '-shm']) { const f = DB + ext; try { fs.unlinkSync(f); } catch (e) {} }
  fs.writeFileSync(path.join(ROOT, '_verify_results.json'), JSON.stringify(results, null, 2));
  console.log(`\n===== VERIFY SUMMARY: ${results.summary.pass} PASS / ${results.summary.fail} FAIL =====`);
  process.exit(results.summary.fail ? 2 : 0);
})().catch(e => { console.error('FATAL', e); stopServer(); process.exit(1); });
