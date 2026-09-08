/**
 * persona_test.js — 12 personas × 真實旅程測試
 *
 * 12 個 persona（1 admin + 1 staff + 10 customers），每人 ~15-20 步真實操作。
 * 沙盒：scenario.db，PORT=4100。
 */
const { spawn } = require('child_process');
const path = require('path');

const PORT = 4100;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.join(__dirname, 'scenario.db');
const SESSION_SECRET = 'x'.repeat(64);
const CAPTCHA = 'test999';
const PWD = 'Scenario@2026';

let serverProc = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  return new Promise((resolve, reject) => {
    serverProc = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
      env: { ...process.env, PORT: String(PORT), DB_PATH, SESSION_SECRET,
        CAPTCHA_TEST_BYPASS: CAPTCHA, ALLOW_UNSAFE_START: '1', NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe'], cwd: __dirname,
    });
    serverProc.on('error', reject);
    (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 30000) {
        try { const r = await fetch(BASE + '/api/server-time'); if (r.status === 200) return resolve(); } catch (_) {}
        await sleep(400);
      }
      reject(new Error('server not ready'));
    })();
  });
}
function killServer() { try { serverProc && serverProc.kill('SIGTERM'); } catch (_) {} }

async function login(u, p) {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p, captchaAnswer: CAPTCHA }),
  });
  const j = await r.json().catch(() => ({}));
  return j.token || null;
}
async function call(token, method, p, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const r = await fetch(BASE + p, init);
  let data = null; try { data = await r.json(); } catch (_) {}
  return { status: r.status, data };
}

// 結果容器
const findings = []; // { persona, step, action, status, observation, severity }
function F(persona, step, action, status, obs, sev = 'info') {
  findings.push({ persona, step, action, status, observation: obs, severity: sev });
  const sym = status === 200 ? '✓' : status >= 400 ? '✗' : '·';
  console.log(`  ${sym} [${persona}] ${step}. ${action} → ${status}${obs ? '  (' + obs + ')' : ''}`);
}

// Persona 數據
const ACCOUNTS = {
  admin:        { u: 'sc_admin2', p: PWD },
  staff:        { u: 'sc_staff1', p: PWD },
  doc1:         { u: 'sc_doc1',   p: PWD },
  doc2:         { u: 'sc_doc2',   p: PWD },
  cust_general: { u: 'sc_cust02', p: PWD }, // general
  cust_premium: { u: 'sc_cust04', p: PWD }, // premium (i%4==0? 04 is mod 4=0 → family actually)
  cust_family:  { u: 'sc_cust01', p: PWD }, // family head
  cust_kid:     { u: 'testkid1',  p: PWD }, // 家庭子女 (18+)
  cust_lapsed:  { u: 'sc_cust03', p: PWD },
  cust_incomp:  { u: 'sc_incomplete', p: PWD }, // profile_completed=0
};

async function main() {
  console.log('▶ 啟動 server (PORT=' + PORT + ', DB=scenario.db)...');
  await startServer();
  console.log('✓ server ready');

  // 登入所有 persona
  const tok = {};
  for (const [k, a] of Object.entries(ACCOUNTS)) {
    tok[k] = await login(a.u, a.p);
    if (!tok[k]) console.log('  ✗ 登入失敗 ' + k);
  }
  console.log('✓ 登入 ' + Object.values(tok).filter(Boolean).length + '/11 persona');

  // ════════════════ ADMIN: 陳大文 (管理員) ════════════════
  console.log('\n═══ 角色 A1: 管理員 陳大文 ═══');
  const a = tok.admin;
  // 1. 開工：看 dashboard
  let r = await call(a, 'GET', '/api/bookings');
  F('A1','1','看今日預約列表', r.status, '應載入全部預約');
  // 2. 看收入
  r = await call(a, 'GET', '/api/admin/income');
  F('A1','2','看本月收入', r.status);
  // 3. 看醫師排程
  r = await call(a, 'GET', '/api/bookings/doctor-time-slots/range?start=2026-09-08&end=2026-09-15');
  F('A1','3','看醫師時段網格', r.status);
  // 4. 看請假隊列
  r = await call(a, 'GET', '/api/admin/doctor/leaves-range?start=2026-09-01&end=2026-09-30');
  F('A1','4','看請假審批隊列', r.status, r.data?.data?.length + ' 筆');
  // 5. 看反饋
  r = await call(a, 'GET', '/api/feedback/admin/unread-count');
  F('A1','5','看反饋未讀數', r.status);
  // 6. 看 HR 員工
  r = await call(a, 'GET', '/api/hr/employees');
  F('A1','6','看員工名冊', r.status);
  // 7. 看 HR payroll
  r = await call(a, 'GET', '/api/hr/payroll');
  F('A1','7','看本月薪資表', r.status);
  // 8. 處理一筆預約：改狀態
  const bks = (await call(a, 'GET', '/api/bookings')).data?.data || (await call(a, 'GET', '/api/bookings')).data || [];
  const bk = (Array.isArray(bks) ? bks : []).find(x => x && x.id && x.status !== 'cancelled');
  if (bk) {
    r = await call(a, 'PUT', `/api/bookings/${bk.id}/status`, { status: 'completed' });
    F('A1','8','將一筆預約改為完成', r.status);
  }
  // 9. 看全店病歷
  r = await call(a, 'GET', '/api/medical-records/admin/all');
  F('A1','9','看全店病歷', r.status, 'admin/staff 可看');
  // 10. 看家庭樹
  r = await call(a, 'GET', '/api/membership/admin/tree');
  F('A1','10','看家庭樹結構', r.status);
  // 11. CMS 評價審核
  r = await call(a, 'GET', '/api/admin/content/reviews');
  F('A1','11','看評價審核', r.status);
  // 12. 看可疑重設活動
  r = await call(a, 'GET', '/api/admin/suspicious-reset-activity');
  F('A1','12','看可疑密碼重設活動', r.status);
  // 13. 看系統狀態
  r = await call(a, 'GET', '/api/admin/system/status');
  F('A1','13','看系統狀態', r.status);
  // 14. 自我打卡
  r = await call(a, 'POST', '/api/hr/clock-in', { attendance_type: 'full' });
  F('A1','14','上班打卡', r.status, r.status === 200 ? '成功' : r.status === 400 ? '可能已打卡' : '');
  // 15. 申請自己請假
  r = await call(a, 'POST', '/api/admin/doctor/my-leave', { exception_date: '2026-10-20', reason: 'A1 私事', notifyWhatsapp: false });
  F('A1','15','自己申請請假', r.status, r.status === 200 ? 'pending 等批' : r.status === 409 ? '已有' : '');
  // 16. 嘗試批准自己的假（自批 — 應擋）
  // 17. 看通知設定
  r = await call(a, 'GET', '/api/notifications/settings');
  F('A1','16','看通知設定', r.status);
  // 18. 看優惠券
  r = await call(a, 'GET', '/api/coupons');
  F('A1','17','看優惠券管理', r.status);
  // 19. 看時段單日
  r = await call(a, 'GET', '/api/bookings/doctor-time-slots/2026-09-10');
  F('A1','18','看單日時段', r.status);
  // 20. 看假日
  r = await call(a, 'GET', '/api/holidays/2026');
  F('A1','19','看 2026 假日', r.status);

  // ════════════════ STAFF: 林小玲 (員工) ════════════════
  console.log('\n═══ 角色 S1: 員工 林小玲 ═══');
  const s = tok.staff;
  // 1. 開工前打卡
  r = await call(s, 'POST', '/api/hr/clock-in', { attendance_type: 'full' });
  F('S1','1','上班打卡', r.status, r.status === 200 ? '成功' : r.status === 400 ? '已打卡' : '');
  // 2. 看今日預約
  r = await call(s, 'GET', '/api/bookings');
  F('S1','2','看今日預約', r.status);
  // 3. 員工視角預約
  r = await call(s, 'GET', '/api/admin/staff/bookings');
  F('S1','3','員工視角預約', r.status);
  // 4. 員工可看家庭可選小孩
  r = await call(s, 'GET', '/api/membership/family/available-children');
  F('S1','4','看家庭可選小孩', r.status, 'staff 可代開家庭帳戶');
  // 5. 員工嘗試看 admin 收入（拒）
  r = await call(s, 'GET', '/api/admin/income');
  F('S1','5','員工看 admin 收入', r.status, r.status === 403 ? '正確擋下' : '⚠ 應該 403');
  // 6. 員工嘗試看 HR 全店
  r = await call(s, 'GET', '/api/hr/employees');
  F('S1','6','員工看 HR 全店', r.status, r.status === 403 ? '正確擋下' : '⚠ 應該 403');
  // 7. 員工嘗試看薪資表
  r = await call(s, 'GET', '/api/hr/payroll');
  F('S1','7','員工看薪資表', r.status, r.status === 403 ? '正確擋下' : '⚠ 應該 403');
  // 8. 員工寫病歷（只可看，不可寫）
  r = await call(s, 'POST', '/api/medical-records/doctor/records', { booking_id: 99999 });
  F('S1','8','員工嘗試寫病歷', r.status, r.status === 403 ? '正確擋下' : '⚠ 員工不可寫病歷');
  // 9. 員工看全店病歷（可看）
  r = await call(s, 'GET', '/api/medical-records/admin/all');
  F('S1','9','員工看全店病歷', r.status);
  // 10. 員工看請假隊列
  r = await call(s, 'GET', '/api/admin/doctor/leaves-range?start=2026-09-01&end=2026-09-30');
  F('S1','10','員工看請假隊列', r.status);
  // 11. 員工嘗試批准請假
  r = await call(s, 'POST', '/api/admin/doctor/my-leaves/99999/approve', {});
  F('S1','11','員工批准請假', r.status, r.status === 403 ? '正確擋下' : '⚠ 應該 403');
  // 12. 員工自我 HR 資料
  r = await call(s, 'GET', '/api/hr/my-profile');
  F('S1','12','員工自我 HR 資料', r.status);
  // 13. 員工自我薪資單（自己的）
  r = await call(s, 'GET', '/api/hr/my-payslip');
  F('S1','13','員工自我薪資單', r.status);
  // 14. 員工自我文件
  r = await call(s, 'GET', '/api/hr/my-documents');
  F('S1','14','員工自我文件', r.status);
  // 15. 員工看時段網格
  r = await call(s, 'GET', '/api/bookings/doctor-time-slots/range?start=2026-09-08&end=2026-09-15');
  F('S1','15','員工看時段網格', r.status);
  // 16. 員工看帳戶連結
  r = await call(s, 'GET', '/api/membership/account-links');
  F('S1','16','員工看帳戶連結', r.status);
  // 17. 員工寫 staff-note 到客人
  r = await call(s, 'GET', '/api/admin/users');
  const us = r.data?.data || r.data || [];
  const cu = (Array.isArray(us) ? us : []).find(x => x && x.role === 'customer');
  if (cu) {
    r = await call(s, 'PUT', `/api/users/${cu.id}/staff-note`, { note: '員工備註 — 林小玲' });
    F('S1','17','員工寫 staff-note', r.status);
  }
  // 18. 員工嘗試看 CMS
  r = await call(s, 'GET', '/api/admin/content/reviews');
  F('S1','18','員工看 CMS 評價審核', r.status, r.status === 403 ? '正確擋下' : '');
  // 19. 員工看服務列表（公開）
  r = await call(s, 'GET', '/api/services');
  F('S1','19','員工看服務列表', r.status);
  // 20. 員工看優惠券（admin only → 403）
  r = await call(s, 'GET', '/api/coupons');
  F('S1','20','員工看優惠券', r.status, r.status === 403 ? '正確擋下' : '⚠ 應該 403');

  // ════════════════ CUSTOMERS (10 personas) ════════════════
  // C1: 王先生 — 首訪訪客，預約初體驗（免登入）
  console.log('\n═══ 角色 C1: 王先生（首訪訪客）═══');
  // 1. 看服務列表
  r = await call(null, 'GET', '/api/services');
  F('C1','1','瀏覽服務列表', r.status);
  // 2. 看分流
  r = await call(null, 'GET', '/api/triage/questions');
  F('C1','2','瀏覽醫療分流', r.status);
  // 3. 看醫師
  r = await call(null, 'GET', '/api/settings/doctors');
  F('C1','3','瀏覽醫師介紹', r.status);
  // 4. 查初體驗時段
  r = await call(null, 'GET', '/api/bookings/timeslots/available?date=2026-12-01&service=S1');
  F('C1','4','查初體驗時段', r.status, r.status === 200 ? '顯示可約' : '');
  // 5. 訪客預約初體驗
  r = await call(null, 'POST', '/api/bookings', {
    service_id: 'S1', doctor_id: 1, date: '2026-12-01', time: '10:00',
    customer_name: '王先生', customer_phone: '9123 4567',
    customer_email: 'wang@test.com', notes: 'C1 首訪預約',
  });
  F('C1','5','訪客預約初體驗', r.status, r.status === 200 ? '成功' : r.status === 400 ? '參數錯' : '');
  // 6. 訪客嘗試預約 S3 推拿+針灸（非初體驗）→ 應 403/400
  r = await call(null, 'POST', '/api/bookings', {
    service_id: 'S3', doctor_id: 1, date: '2026-12-01', time: '10:00',
    customer_name: '王先生', customer_phone: '9123 4567',
  });
  F('C1','6','訪客預約 S3 推拿+針灸', r.status, r.status === 403 ? '正確擋下（需登入）' : r.status === 200 ? '⚠ 訪客可約非初體驗！' : '');
  // 7. 訪客嘗試登入（無帳號）
  r = await call(null, 'POST', '/api/auth/login', { username: 'wang@test.com', password: 'wrong', captchaAnswer: CAPTCHA });
  F('C1','7','訪客嘗試登入（無帳號）', r.status);
  // 8. 找會員 ID
  r = await call(null, 'POST', '/api/auth/find-user-id', { name: '王先生', email: 'wang@test.com', captchaAnswer: CAPTCHA });
  F('C1','8','訪客找回會員 ID', r.status);
  // 9. 公開看 FAQ
  r = await call(null, 'GET', '/api/faqs');
  F('C1','9','看常見問題', r.status);
  // 10. 公開看公告
  r = await call(null, 'GET', '/api/content/announcements');
  F('C1','10','看最新公告', r.status);
  // 11. AI 推薦
  r = await call(null, 'GET', '/api/ai/get-recommendation?symptoms=失眠');
  F('C1','11','AI 症狀推薦', r.status);

  // C2: 李太 — 一般會員，嘗試約 S3
  console.log('\n═══ 角色 C2: 李太（一般會員）═══');
  const c2 = tok.cust_general;
  r = await call(c2, 'GET', '/api/membership');
  F('C2','1','看自己會員資料', r.status, '應顯示 general tier');
  // 2. 嘗試約 S3
  r = await call(c2, 'POST', '/api/bookings', {
    service_id: 'S3', doctor_id: 1, date: '2026-12-01', time: '11:00',
    customer_name: '李太', customer_phone: '9234 5678',
  });
  F('C2','2','一般會員約 S3', r.status, r.status === 403 ? '分級門控生效' : r.status === 200 ? '⚠ 未擋' : '');
  // 3. 約 S1 初體驗（可約）
  r = await call(c2, 'POST', '/api/bookings', {
    service_id: 'S1', doctor_id: 1, date: '2026-12-01', time: '11:00',
    customer_name: '李太', customer_phone: '9234 5678',
  });
  F('C2','3','一般會員約 S1', r.status);
  // 4. 看自己預約
  r = await call(c2, 'GET', '/api/bookings');
  F('C2','4','看自己預約', r.status);
  // 5. 看優惠券
  r = await call(c2, 'GET', '/api/coupons/my');
  F('C2','5','看自己優惠券', r.status);
  // 6. 看反饋
  r = await call(c2, 'GET', '/api/feedback/my-feedback/' + (JSON.stringify(r.data).match(/"user_id":\d+/)?.[0].split(':')[1] || '2'));
  F('C2','6','看自己反饋', r.status);
  // 7. 提交反饋
  r = await call(c2, 'POST', '/api/feedback', { subject: 'C2 測試', message: '服務很好' });
  F('C2','7','提交反饋', r.status);
  // 8. 改密碼（需舊密碼）
  r = await call(c2, 'PUT', '/api/users/2/password', { oldPassword: PWD, newPassword: 'NewP@ss123' });
  F('C2','8','改自己密碼', r.status, r.status === 200 ? '成功' : '');
  // 恢復
  await call(c2, 'PUT', '/api/users/2/password', { oldPassword: 'NewP@ss123', newPassword: PWD });
  // 9. 看自己病歷
  r = await call(c2, 'GET', '/api/medical-records/customer/records');
  F('C2','9','看自己病歷', r.status);
  // 10. 看家庭
  r = await call(c2, 'GET', '/api/membership/family');
  F('C2','10','看家庭資料', r.status);
  // 11. 看帳戶連結
  r = await call(c2, 'GET', '/api/membership/account-links');
  F('C2','11','看帳戶連結', r.status);
  // 12. 嘗試看 admin 端點
  r = await call(c2, 'GET', '/api/admin/users');
  F('C2','12','客人看 admin→拒', r.status, r.status === 403 ? '正確' : '⚠');
  // 13. 嘗試看全店病歷
  r = await call(c2, 'GET', '/api/medical-records/admin/all');
  F('C2','13','客人看全店病歷→拒', r.status, r.status === 403 ? '正確' : '⚠');
  // 14. 嘗試改他人 profile
  r = await call(c2, 'PUT', '/api/users/3/profile', { name: 'hack' });
  F('C2','14','客人改他人 profile→拒', r.status, r.status === 400 || r.status === 403 ? '正確' : '⚠ IDOR!');
  // 15. 嘗試看系統狀態
  r = await call(c2, 'GET', '/api/admin/system/status');
  F('C2','15','客人看系統狀態→拒', r.status, r.status === 403 ? '正確' : '⚠');

  // C3: 張小姐 — 高級會員
  console.log('\n═══ 角色 C3: 張小姐（高級會員）═══');
  // 找一個 premium 或 family 帳號。scenario-seed：i%4==0 是 family。i=4 mod 4=0 → family。實際沒設 premium，都係 general 或 family。改用 cust_family（C5）做 family。
  // 為 C3 模擬，暫用 cust_family。
  const c3 = tok.cust_family;
  r = await call(c3, 'GET', '/api/membership');
  F('C3','1','看會員 tier', r.status, 'family tier');
  r = await call(c3, 'POST', '/api/bookings', { service_id: 'S3', doctor_id: 1, date: '2026-12-02', time: '10:00', customer_name: '張小姐', customer_phone: '9345 6789' });
  F('C3','2','family 約 S3 推拿+針灸', r.status, r.status === 200 ? '可約' : '');
  r = await call(c3, 'POST', '/api/bookings', { service_id: 'S2', doctor_id: 2, date: '2026-12-02', time: '11:00', customer_name: '張小姐', customer_phone: '9345 6789' });
  F('C3','3','family 約 S2 針灸', r.status);
  r = await call(c3, 'GET', '/api/bookings');
  F('C3','4','看自己預約', r.status);
  r = await call(c3, 'GET', '/api/membership/family');
  F('C3','5','看家庭成員', r.status);
  r = await call(c3, 'GET', '/api/membership/family/available-children');
  F('C3','6','看可加家庭成員', r.status, '此端點 staff/admin only');
  r = await call(c3, 'POST', '/api/membership/account-links', { target_username: 'sc_cust03' });
  F('C3','7','加帳戶連結（自己連別人）', r.status, r.status === 200 ? '可加' : r.status === 400 ? '規則擋' : '');
  r = await call(c3, 'GET', '/api/membership/account-links');
  F('C3','8','看帳戶連結', r.status);
  r = await call(c3, 'GET', '/api/coupons/my');
  F('C3','9','看優惠券', r.status);
  r = await call(c3, 'GET', '/api/services');
  F('C3','10','看服務列表', r.status);
  r = await call(c3, 'PUT', '/api/users/3/password', { oldPassword: PWD, newPassword: 'New1!' });
  F('C3','11','改自己密碼', r.status);
  await call(c3, 'PUT', '/api/users/3/password', { oldPassword: 'New1!', newPassword: PWD });
  r = await call(c3, 'GET', '/api/medical-records/customer/records');
  F('C3','12','看自己病歷', r.status);

  // C4: 黃先生 — 家庭戶主，管 2 個子女
  console.log('\n═══ 角色 C4: 黃先生（家庭戶主，已有 2 子）═══');
  const c4 = tok.cust_family; // sc_cust01 設過 family_head_id
  r = await call(c4, 'GET', '/api/membership/family');
  F('C4','1','看家庭成員（戶主）', r.status);
  // 為子女代約
  r = await call(c4, 'POST', '/api/bookings', { service_id: 'S1', doctor_id: 3, date: '2026-12-03', time: '14:00', customer_name: '黃家小孩', customer_phone: '9456 7890', for_family_member: 'testkid1' });
  F('C4','2','戶主代子女約初體驗', r.status, r.status === 200 ? '可代約' : '');
  r = await call(c4, 'GET', '/api/membership/family');
  F('C4','3','再確認家庭', r.status);
  // 看家庭發票
  r = await call(c4, 'GET', '/api/membership/family-invoice');
  F('C4','4','看家庭發票', r.status);
  // 設隱私
  r = await call(c4, 'PUT', '/api/membership/privacy', { private: true });
  F('C4','5','設自己隱私', r.status, r.status === 200 || r.status === 400 ? '' : '');
  // 取消預約
  const myBks = (await call(c4, 'GET', '/api/bookings')).data?.data || [];
  const future = (Array.isArray(myBks) ? myBks : []).find(x => x && x.id && x.appointment_date >= '2026-12-01');
  if (future) {
    r = await call(c4, 'DELETE', `/api/bookings/${future.id}`);
    F('C4','6','取消一筆預約', r.status);
  }
  r = await call(c4, 'GET', '/api/coupons/my');
  F('C4','7','看優惠券', r.status);

  // C5: 小芳 — 18+ 子女，隱私開
  console.log('\n═══ 角色 C5: 小芳（18+ 子女，隱私開）═══');
  const c5 = tok.cust_kid;
  r = await call(c5, 'GET', '/api/membership');
  F('C5','1','18+ 子女看自己會員', r.status);
  r = await call(c5, 'GET', '/api/membership/family');
  F('C5','2','看家庭（自己視角）', r.status);
  // 戶主能看子女嗎？
  r = await call(c4, 'GET', `/api/membership/family/testkid1/bookings`);
  F('C5','3','戶主看子女預約', r.status, '視乎隱私設定');
  r = await call(c5, 'PUT', '/api/membership/privacy', { private: true });
  F('C5','4','子女開啟隱私', r.status);
  r = await call(c4, 'GET', `/api/membership/family/testkid1/bookings`);
  F('C5','5','戶主再查（隱私開）', r.status, '應只見成功狀態');
  r = await call(c5, 'GET', '/api/bookings');
  F('C5','6','18+ 子女看自己預約', r.status);
  r = await call(c5, 'POST', '/api/bookings', { service_id: 'S1', doctor_id: 1, date: '2026-12-04', time: '15:00', customer_name: '小芳', customer_phone: '9567 8901' });
  F('C5','7','18+ 子女自己約', r.status);

  // C6: 陳伯 — 長者，UX 易撞板
  console.log('\n═══ 角色 C6: 陳伯（長者，會員）═══');
  const c6 = tok.cust_general;
  r = await call(c6, 'GET', '/api/services');
  F('C6','1','長者看服務（UI 期望大字）', r.status, '（純 API，UI 大字未測）');
  // 改了 3 次密碼（忘記）
  for (let i = 0; i < 3; i++) {
    r = await call(null, 'POST', '/api/auth/send-reset-code', { email: 'sc_cust02@patient.com', captchaAnswer: CAPTCHA });
    F('C6', 2 + '.' + i, '長者重發驗證碼第 ' + (i+1) + ' 次', r.status, '（可能限流）');
  }
  r = await call(c6, 'GET', '/api/faqs');
  F('C6','3','長者看 FAQ', r.status);
  r = await call(c6, 'GET', '/api/holidays/check/2026-09-14');
  F('C6','4','長者查特定日是否假日', r.status, '中秋補假');
  r = await call(c6, 'GET', '/api/triage/questions');
  F('C6','5','長者用分流', r.status);
  r = await call(c6, 'POST', '/api/feedback', { subject: 'C6 提問', message: '網站字體細' });
  F('C6','6','長者提交反饋', r.status);

  // C7: 阿強 — 可疑用戶（安全測試）
  console.log('\n═══ 角色 C7: 阿強（可疑用戶，安全測試）═══');
  // 1. 暴力登入
  let blocked = false;
  for (let i = 0; i < 8; i++) {
    r = await call(null, 'POST', '/api/auth/login', { username: 'sc_admin2', password: 'wrong' + i, captchaAnswer: CAPTCHA });
    if (r.status === 429) { blocked = true; break; }
  }
  F('C7','1','暴力登入（觸發限流）', blocked ? 429 : 200, blocked ? '已觸發 429' : '⚠ 未觸發限流');
  // 2. 偽造 token
  r = await call('fake.invalid.token', 'GET', '/api/bookings');
  F('C7','2','偽造 token', r.status, r.status === 401 ? '正確擋下' : '');
  // 3. SQL 注入
  r = await call(null, 'GET', `/api/auth/login?username=admin' OR '1'='1&password=x`);
  F('C7','3','SQL 注入 login URL', r.status, r.status === 400 || r.status === 401 ? '安全' : '');
  // 4. XSS in 反饋
  r = await call(tok.cust_general, 'POST', '/api/feedback', { subject: '<script>alert("xss")</script>', message: 'XSS test' });
  F('C7','4','XSS 提交反饋', r.status, r.status === 200 ? '後端應過濾' : '');
  // 5. IDOR: 看他人病歷
  r = await call(tok.cust_general, 'GET', '/api/medical-records/customer/records');
  F('C7','5','IDOR 嘗試（正常 token 看自己）', r.status, '應只見自己');
  // 6. 改他人密碼
  r = await call(tok.cust_general, 'PUT', '/api/users/3/password', { oldPassword: 'X', newPassword: 'Hack1!' });
  F('C7','6','IDOR 改他人密碼', r.status, r.status === 400 || r.status === 403 ? '正確擋下' : '⚠ IDOR!');
  // 7. 改他人通知
  r = await call(tok.cust_general, 'PUT', '/api/users/3/notifications', { whatsapp: false });
  F('C7','7','IDOR 改他人通知', r.status);
  // 8. 暴力 captcha bypass（已 bypass）
  // 9. 大量預約塞爆
  let allOk = 0;
  for (let i = 0; i < 5; i++) {
    r = await call(null, 'POST', '/api/bookings', { service_id: 'S1', doctor_id: 1, date: '2026-12-15', time: (10+i)+':00', customer_name: 'spam' + i, customer_phone: '9' + i });
    if (r.status === 200) allOk++;
  }
  F('C7','8','訪客 5 次同醫同日預約', allOk > 1 ? 200 : 0, '⚠ 若全 200 缺容量檢查' );
  // 10. 試看 admin 端點
  r = await call(tok.cust_general, 'GET', '/api/admin/suspicious-reset-activity');
  F('C7','9','客人看可疑活動日誌', r.status, r.status === 403 ? '正確' : '⚠');

  // C8: Ms. Liu — 過期 premium
  console.log('\n═══ 角色 C8: Ms. Liu（會員狀態過期）═══');
  // 用 cust_lapsed（普通 customer，模擬曾經 premium 但 expired 的情境）
  const c8 = tok.cust_lapsed;
  r = await call(c8, 'GET', '/api/membership');
  F('C8','1','看會員狀態', r.status, 'tier 應顯示 general（已過期）');
  // 嘗試用舊 premium 服務
  r = await call(c8, 'POST', '/api/bookings', { service_id: 'S2', doctor_id: 1, date: '2026-12-05', time: '10:00', customer_name: 'Ms Liu', customer_phone: '9678 9012' });
  F('C8','2','過期會員約 S2', r.status, r.status === 403 ? '正確擋下' : r.status === 200 ? '⚠ 過期會員可約' : '');
  r = await call(c8, 'POST', '/api/bookings', { service_id: 'S1', doctor_id: 1, date: '2026-12-05', time: '10:00', customer_name: 'Ms Liu', customer_phone: '9678 9012' });
  F('C8','3','過期會員約 S1', r.status, r.status === 200 ? '可約初體驗' : '');

  // C9: Peter — 外籍用戶（英文/中文）
  console.log('\n═══ 角色 C9: Peter（外籍，英文/中文混）═══');
  // 沒英文帳號，用既有帳號
  const c9 = tok.cust_general;
  r = await call(c9, 'GET', '/api/content/announcements');
  F('C9','1','看公告（中文）', r.status, '（純 API，英文版未測）');
  r = await call(c9, 'GET', '/api/services');
  F('C9','2','看服務（中文）', r.status);
  // 嘗試用英文姓名預約
  r = await call(null, 'POST', '/api/bookings', { service_id: 'S1', doctor_id: 1, date: '2026-12-06', time: '10:00', customer_name: 'Peter Smith', customer_phone: '6012-3456789' });
  F('C9','3','英文姓名+海外電話預約', r.status, r.status === 200 ? '成功' : r.status === 400 ? '電話格式校驗擋' : '');
  r = await call(c9, 'GET', '/api/ai/categories');
  F('C9','4','AI 類別', r.status);

  // C10: Ms. Chan — 電話預約（由職員代約）
  console.log('\n═══ 角色 C10: Ms. Chan（電話預約，職員代開）═══');
  // 模擬職員代 Ms. Chan 預約
  r = await call(tok.staff, 'POST', '/api/bookings', { service_id: 'S1', doctor_id: 1, date: '2026-12-07', time: '10:00', customer_name: 'Ms Chan', customer_phone: '9898 9898', notes: '電話預約' });
  F('C10','1','職員代電話預約', r.status, r.status === 200 ? '成功' : r.status === 400 ? '無 adminPassword 校驗' : '');
  r = await call(tok.staff, 'GET', '/api/admin/users');
  F('C10','2','職員查客人資料', r.status);
  // 嘗試看 Ms. Chan 病歷（無 — 未建帳）
  // 建立 Ms. Chan 帳號
  r = await call(tok.admin, 'POST', '/api/admin/users', { role: 'customer', name: 'Ms Chan', phone: '9898 9898', email: 'mschan@test.com', membership_tier: 'general', adminPassword: PWD });
  F('C10','3','管理員代開 Ms. Chan 帳戶', r.status, r.status === 200 ? '已開' : r.status === 400 ? 'adminPassword 錯' : '');
  r = await call(tok.staff, 'GET', '/api/bookings');
  F('C10','4','職員再查預約', r.status);

  // 落盤
  require('fs').writeFileSync(path.join(__dirname, '_persona_result.json'), JSON.stringify(findings, null, 2));
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  12 角色旅程完成，共 ' + findings.length + ' 步');
  console.log('══════════════════════════════════════════════════════');
  const byPersona = {};
  findings.forEach(f => { byPersona[f.persona] = (byPersona[f.persona] || 0) + 1; });
  Object.entries(byPersona).forEach(([p, n]) => console.log('  ' + p.padEnd(6) + ' ' + n + ' 步'));
  console.log('══════════════════════════════════════════════════════');

  killServer();
  await sleep(500);
  process.exit(0);
}

main().catch((e) => { console.error('FATAL:', e); killServer(); process.exit(2); });
