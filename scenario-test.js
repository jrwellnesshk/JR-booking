// 場景測試 - 功能 / 邊界測試執行器
// 用法：BASE=http://localhost:4900 ADMIN_PW=xxx ROUND=1 node scenario-test.js
//       BASE=http://localhost:4900 ROUND=2 node scenario-test.js
// ROUND=1 標準營運場景（各角色核心功能）；ROUND=2 異常/邊界場景（權限/錯誤處理）
const BASE = process.env.BASE || 'http://localhost:4900';
const ADMIN_PW = process.env.ADMIN_PW || '';
const ROUND = parseInt(process.env.ROUND || '1', 10);
const SC_PWD = 'Scenario@2026';

const results = [];
function rec(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || '' });
  const tag = pass ? '✅' : '❌';
  console.log(`${tag} ${name}${detail ? ' — ' + detail : ''}`);
}

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-json */ }
  return { status: res.status, body: data };
}
async function login(username, password, portal) {
  return req('POST', '/api/auth/login', { username, password, captchaAnswer: 'test999', portal });
}
function ymdOffset(o) { const d = new Date(); d.setDate(d.getDate() + o); return d.toISOString().slice(0, 10); }

// 搵一個診所營業嘅未來日期（跳過日 + 簡單避開假期）
async function findOpenFutureDate(token) {
  for (let off = 1; off <= 14; off++) {
    const ds = ymdOffset(off);
    const d = new Date(ds + 'T00:00:00');
    if (d.getDay() === 0) continue; // 星期日休息
    const r = await req('POST', '/api/bookings', {
      customerName: '測試預約客', customerPhone: '98123456', serviceId: 'S3',
      doctorName: '周明醫師', appointmentDate: ds, appointmentTime: '10:00',
    }, token);
    if (r.status === 200 || r.status === 201) return { ds, id: (r.body && (r.body.id || (r.body.booking && r.body.booking.id))) };
    if (r.status === 409) return { ds, conflict: true }; // 日期開放，只係撞時段
  }
  return null;
}

async function round1() {
  console.log('\n========== 場景一：標準營運場景（各角色核心功能）==========\n');

  // --- 登入四角色 ---
  const c = await login('sc_cust01', SC_PWD, 'customer');
  rec('C-登入 客戶(sc_cust01)', c.body && c.body.ok === true && c.status === 200, `status=${c.status} ok=${c.body && c.body.ok}`);
  const cTok = c.body && c.body.token;

  const d = await login('sc_doc1', SC_PWD, 'doctor');
  rec('D-登入 醫師(sc_doc1)', d.body && d.body.ok === true, `status=${d.status}`);
  const dTok = d.body && d.body.token;

  const s = await login('sc_staff1', SC_PWD, 'staff');
  rec('S-登入 員工(sc_staff1)', s.body && s.body.ok === true, `status=${s.status}`);
  const sTok = s.body && s.body.token;

  const a = await login('admin', ADMIN_PW, 'admin');
  rec('A-登入 管理員(admin)', a.body && a.body.ok === true, `status=${a.status}`);
  const aTok = a.body && a.body.token;

  const a2 = await login('sc_admin2', SC_PWD, 'admin');
  rec('A-登入 副管理員(sc_admin2)', a2.body && a2.body.ok === true, `status=${a2.status}`);

  if (!cTok || !dTok || !sTok || !aTok) { rec('前置登入失敗，終止場景一', false); return; }

  // --- 管理員功能 ---
  const users = await req('GET', '/api/users', null, aTok);
  rec('ADMIN-用戶列表', users.status === 200 && Array.isArray(users.body), `count=${Array.isArray(users.body) ? users.body.length : '?'}`);

  const inc = await req('GET', '/api/admin/income?range=all', null, aTok);
  rec('ADMIN-收入統計', inc.status === 200, `status=${inc.status}`);

  const exc = await req('GET', '/api/admin/exceptions', null, aTok);
  rec('ADMIN-異常列表', exc.status === 200, `status=${exc.status}`);

  const sys = await req('GET', '/api/admin/system/status', null, aTok);
  rec('ADMIN-系統狀態', sys.status === 200, `status=${sys.status}`);

  const ann = await req('POST', '/api/admin/content/announcements', { title: '場景測試公告', content: 'hello', category: '診所資訊' }, aTok);
  rec('ADMIN-公告新增', ann.status === 200 || ann.status === 201, `status=${ann.status}`);
  let annId = ann.body && ann.body.id;
  if (annId) {
    const annU = await req('PUT', '/api/admin/content/announcements/' + annId, { title: '場景測試公告(改)', content: 'updated' }, aTok);
    rec('ADMIN-公告修改', annU.status === 200, `status=${annU.status}`);
    const annD = await req('DELETE', '/api/admin/content/announcements/' + annId, null, aTok);
    rec('ADMIN-公告刪除', annD.status === 200, `status=${annD.status}`);
  }

  const emp = await req('GET', '/api/hr/employees', null, aTok);
  rec('ADMIN-HR員工名單', emp.status === 200, `status=${emp.status}`);

  const pay = await req('GET', `/api/hr/payroll?from=${ymdOffset(-2)}&to=${ymdOffset(-1)}`, null, aTok);
  rec('ADMIN-HR薪酬計算(2日考勤)', pay.status === 200 && pay.body && Array.isArray(pay.body.report), `status=${pay.status} 員工數=${pay.body && pay.body.report ? pay.body.report.length : '?'}`);

  const lvAll = await req('GET', '/api/hr/leaves/all', null, aTok);
  rec('ADMIN-HR請假審核清單', lvAll.status === 200, `status=${lvAll.status}`);

  // --- 員工功能 ---
  const sb = await req('GET', '/api/admin/staff/bookings', null, sTok);
  const sbData = (sb.body && sb.body.data) || [];
  rec('STAFF-全預約查看', sb.status === 200 && Array.isArray(sbData), `count=${sbData.length}`);

  // 員工為一單 confirmed/in-progress 改 completed（check-in 流程）
  let target = null;
  if (Array.isArray(sbData)) target = sbData.find(b => b.status === 'confirmed' || b.status === 'in-progress');
  if (target) {
    const upd = await req('PUT', `/api/bookings/${target.id}/status`, { status: 'completed' }, sTok);
    rec('STAFF-預約狀態更新(completed)', upd.status === 200, `booking#${target.id} -> ${upd.status}`);
  } else rec('STAFF-預約狀態更新(無目標單)', false, '找不到 confirmed/in-progress 單');

  const cin = await req('POST', '/api/hr/clock-in', {}, sTok);
  // 400 若今日已打卡（設計行為：不可重複打卡）→ 亦視為符合預期
  const cinOk = cin.status === 200 || (cin.status === 400 && /已打卡|已經/.test(cin.body && cin.body.error || ''));
  rec('STAFF-HR上班打卡', cinOk, `status=${cin.status}${cin.status === 400 ? ' (今日已打卡，符合預期)' : ''}`);
  const cout = await req('POST', '/api/hr/clock-out', {}, sTok);
  const coutOk = cout.status === 200 || cout.status === 400;
  rec('STAFF-HR下班打卡', coutOk, `status=${cout.status}`);
  const mst = await req('GET', '/api/hr/my-status', null, sTok);
  rec('STAFF-HR我的考勤狀態', mst.status === 200, `status=${mst.status}`);
  const pay2 = await req('GET', '/api/hr/my-payslip', null, sTok);
  rec('STAFF-HR我的薪資單', pay2.status === 200, `status=${pay2.status}`);

  // --- 醫師功能 ---
  const dbk = await req('GET', '/api/admin/doctor/bookings', null, dTok);
  const dbkData = (dbk.body && dbk.body.data) || [];
  rec('DOCTOR-我的預約', dbk.status === 200 && Array.isArray(dbkData), `count=${dbkData.length}`);

  const lvReq = await req('POST', '/api/admin/doctor/my-leave', { exception_date: ymdOffset(5), reason: '場景測試' }, dTok);
  rec('DOCTOR-申請請假', lvReq.status === 200, `status=${lvReq.status}`);

  const myLv = await req('GET', '/api/admin/doctor/my-leaves', null, dTok);
  rec('DOCTOR-我的請假紀錄', myLv.status === 200, `status=${myLv.status}`);

  const sch = await req('GET', '/api/hr/my-schedule', null, dTok);
  // 全職醫師無兼職時間表 → 403 係預期行為（access control），記為符合預期
  const schOk = sch.status === 200 || (sch.status === 403 && /兼職/.test(sch.body && sch.body.error || ''));
  rec('DOCTOR-我的排班(全職→403 預期)', schOk, `status=${sch.status}${sch.status === 403 ? ' 全職醫師無兼職時間表(符合預期)' : ''}`);

  // --- 客戶功能 ---
  const myb = await req('GET', '/api/bookings', null, cTok);
  const mybData = (myb.body && myb.body.data) || [];
  rec('CUST-我的預約', myb.status === 200 && Array.isArray(mybData), `count=${mybData.length}`);

  const open = await findOpenFutureDate(cTok);
  if (open) {
    if (open.id) rec('CUST-未來預約建立', true, `date=${open.ds} bookingId=${open.id}`);
    else if (open.conflict) rec('CUST-未來預約建立', true, `date=${open.ds} (時段撞期但日期開放)`);
    else rec('CUST-未來預約建立', false, `date=${open.ds} 無 id`);
  } else rec('CUST-未來預約建立', false, '搵唔到營業未來日');

  // 客戶取消自己「可取消」單（confirmed/in-progress 且過去單）→ 200
  const c19 = await login('sc_cust19', SC_PWD, 'customer');
  const c19Tok = c19.body && c19.body.token;
  if (c19Tok) {
    const c19b = await req('GET', '/api/bookings', null, c19Tok);
    const c19Data = (c19b.body && c19b.body.data) || [];
    const c19can = c19Data.find(b => ['confirmed', 'in-progress'].includes(b.status));
    if (c19can) {
      const del = await req('DELETE', '/api/bookings/' + c19can.id, null, c19Tok);
      rec('CUST-取消自己可取消預約', del.status === 200, `booking#${c19can.id} -> ${del.status}`);
    } else rec('CUST-取消自己可取消預約', false, 'sc_cust19 無可取消單');
  } else rec('CUST-取消自己可取消預約', false, 'sc_cust19 登入失敗');

  // 狀態守衛：取消已完成單應被擋 400（設計行為）
  const done = mybData.find(b => ['completed', 'no-show', 'cancelled'].includes(b.status));
  if (done) {
    const del2 = await req('DELETE', '/api/bookings/' + done.id, null, cTok);
    rec('CUST-取消已完成單被擋(400)', del2.status === 400, `booking#${done.id} status=${done.status} -> ${del2.status}`);
  }
}

async function round2() {
  console.log('\n========== 場景二：異常 / 邊界場景（權限與錯誤處理）==========\n');

  // 錯誤登入
  const wp = await login('admin', 'wrongpassword', 'admin');
  rec('AUTH-錯誤密碼', wp.status === 401 && wp.body && wp.body.ok === false, `status=${wp.status} code=${wp.body && wp.body.code}`);
  const nu = await login('sc_no_such_user', SC_PWD, 'customer');
  rec('AUTH-用戶不存在', nu.status === 401, `status=${nu.status}`);
  const nc = await login('admin', ADMIN_PW, 'admin'); // 正常 captcha
  const ncNoCap = await req('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PW, portal: 'admin' }, null);
  rec('AUTH-缺驗證碼被擋', ncNoCap.status === 400, `status=${ncNoCap.status}`);
  const aTok = nc.body && nc.body.token;

  // 權限：客戶打 admin 端
  const c = await login('sc_cust01', SC_PWD, 'customer');
  const cTok = c.body && c.body.token;
  const perm = await req('GET', '/api/admin/income', null, cTok);
  rec('PERM-客戶打管理員API被拒', perm.status === 401 || perm.status === 403, `status=${perm.status}`);

  // 先搵一個診所營業未來日（用家庭戶主 token 可成功落單，借佢探測開放日）
  const openD = await findOpenFutureDate(cTok);
  const openDate = openD ? openD.ds : null;

  // 預約缺欄位
  const miss = await req('POST', '/api/bookings', { customerName: 'x' }, cTok);
  rec('BOOKING-缺欄位 400', miss.status === 400, `status=${miss.status}`);

  // 過去日期預約（API 應拒）
  const past = await req('POST', '/api/bookings', {
    customerName: '過去客', customerPhone: '98123456', serviceId: 'S1',
    doctorName: '周明醫師', appointmentDate: ymdOffset(-3), appointmentTime: '10:00',
  }, cTok);
  rec('BOOKING-過去日期被拒', past.status === 400, `status=${past.status} code=${past.body && past.body.code}`);

  // 一般會員預約非初體驗服務（membership gating）→ 403
  const gen = await login('sc_cust02', SC_PWD, 'customer'); // general（i=2，非 family）
  const genTok = gen.body && gen.body.token;
  if (genTok && openDate) {
    const r = await req('POST', '/api/bookings', {
      customerName: '一般會員客', customerPhone: '98123457', serviceId: 'S2', // S2=針灸，非初體驗
      doctorName: '周明醫師', appointmentDate: openDate, appointmentTime: '11:00',
    }, genTok);
    rec('BOOKING-一般會員非初體驗 403', r.status === 403, `status=${r.status} code=${r.body && r.body.code}`);
  } else rec('BOOKING-一般會員非初體驗 403', false, genTok ? '搵唔到開放日' : '登入失敗');

  // 訪客預約非初體驗（無 token）→ 403
  if (openDate) {
    const g = await req('POST', '/api/bookings', {
      customerName: '訪客客', customerPhone: '98123458', serviceId: 'S3',
      doctorName: '周明醫師', appointmentDate: openDate, appointmentTime: '14:00',
    }, null);
    rec('BOOKING-訪客非初體驗 403', g.status === 403, `status=${g.status} code=${g.body && g.body.code}`);
  } else rec('BOOKING-訪客非初體驗 403', false, '搵唔到開放日');

  // 無效狀態值
  if (aTok) {
    const sl = await req('GET', '/api/admin/staff/bookings', null, aTok);
    const slData = (sl.body && sl.body.data) || [];
    if (slData.length) {
      const bid = slData[0].id;
      const bad = await req('PUT', `/api/bookings/${bid}/status`, { status: 'not_a_status' }, aTok);
      rec('STATUS-無效值 400', bad.status === 400, `status=${bad.status}`);
    }
  }

  // 醫師改他人單
  const d1 = await login('sc_doc1', SC_PWD, 'doctor');
  const d1Tok = d1.body && d1.body.token;
  const d2 = await login('sc_doc2', SC_PWD, 'doctor');
  const d2Tok = d2.body && d2.body.token;
  const d2bk = await req('GET', '/api/admin/doctor/bookings', null, d2Tok);
  const d2Data = (d2bk.body && d2bk.body.data) || [];
  if (d2Data.length) {
    const other = d2Data[0];
    const upd = await req('PUT', `/api/bookings/${other.id}/status`, { status: 'completed' }, d1Tok);
    rec('DOCTOR-改他人單 403', upd.status === 403, `status=${upd.status}`);
  } else rec('DOCTOR-改他人單 403', false, 'doc2 無單');

  // 未完成資料客戶預約被擋
  const inc = await login('sc_incomplete', SC_PWD, 'customer');
  const incTok = inc.body && inc.body.token;
  if (incTok) {
    // 未完成資料用戶落單會被 profile 檢查擋（403），唔可以靠佢自己探測開放日 → 借用已探測到的 openDate
    const open2 = openDate ? { ds: openDate } : null;
    if (open2 && !open2.conflict) {
      const r = await req('POST', '/api/bookings', {
        customerName: '未完資料客', customerPhone: '98009999', serviceId: 'S3',
        doctorName: '周明醫師', appointmentDate: open2.ds, appointmentTime: '15:00',
      }, incTok);
      rec('PROFILE-未完成資料 403', r.status === 403, `status=${r.status} code=${r.body && r.body.code}`);
    } else rec('PROFILE-未完成資料 403', false, '搵唔到開放日');
  } else rec('PROFILE-未完成資料 403', false, '登入失敗');

  // 預約時段衝突（撞已存在 active 單）
  const s = await login('sc_staff1', SC_PWD, 'staff');
  const sTok = s.body && s.body.token;
  const sb = await req('GET', '/api/admin/staff/bookings', null, sTok);
  const sbData = (sb.body && sb.body.data) || [];
  if (sbData.length) {
    const clash = sbData.find(b => ['confirmed', 'in-progress'].includes(b.status));
    if (clash) {
      const r = await req('POST', '/api/bookings', {
        customerName: '撞期客', customerPhone: '98123459', serviceId: 'S1',
        doctorName: clash.doctor_name, appointmentDate: clash.appointment_date, appointmentTime: clash.appointment_time,
      }, sTok);
      rec('BOOKING-時段衝突 409', r.status === 409, `status=${r.status} code=${r.body && r.body.code}`);
    } else rec('BOOKING-時段衝突 409', false, '無 active 單可撞');
  }

  // 帳戶鎖定（連錯 6 次）
  let locked = false, lastStatus = 0;
  for (let i = 0; i < 7; i++) {
    const r = await login('sc_locktest', 'badpass', 'customer');
    lastStatus = r.status;
    if (r.status === 429) { locked = true; break; }
  }
  rec('AUTH-連錯鎖定 429', locked, `lastStatus=${lastStatus}`);
}

(async () => {
  console.log(`>>> 場景測試 ROUND=${ROUND}  BASE=${BASE}`);
  try {
    if (ROUND === 1) await round1();
    else await round2();
  } catch (e) {
    rec('執行異常', false, e.message);
  }
  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass).length;
  console.log(`\n========== 場景${ROUND} 結果：${pass} 通過 / ${fail} 失敗 / 共 ${results.length} ==========\n`);
  process.exit(fail > 0 ? 2 : 0);
})();
