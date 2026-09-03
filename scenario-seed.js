// 場景測試 - 數據種子（直接寫入 sandbox DB，不經 API）
// 建立：2 管理員 / 4 醫師 / 5 員工 / 40 客戶（每日 20，共 2 日）/ 40 預約（歷史，含多種狀態）/ HR 考勤
// 所有場景帳號密碼統一：Scenario@2026（admin1 沿用生產庫原有密碼）
const sqlite3 = require('sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');

const DB = process.env.SCENARIO_DB || path.join(__dirname, 'scenario.db');
const PWD = 'Scenario@2026';
const hash = bcrypt.hashSync(PWD, 10);

const db = new sqlite3.Database(DB);
const run = (s, p = []) => new Promise((res, rej) => db.run(s, p, function (e) { return e ? rej(e) : res(this.lastID); }));
const get = (s, p = []) => new Promise((res, rej) => db.get(s, p, (e, r) => e ? rej(e) : res(r)));
const all = (s, p = []) => new Promise((res, rej) => db.all(s, p, (e, r) => e ? rej(e) : res(r)));

function ymd(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
const DAY1 = ymd(-2); // 前日（兩日前）
const DAY2 = ymd(-1); // 昨日

const DOCTORS = [
  { u: 'sc_doc1', name: '周明醫師', sp: '推拿專家' },
  { u: 'sc_doc2', name: '吳芳醫師', sp: '針灸專家' },
  { u: 'sc_doc3', name: '鄭偉醫師', sp: '綜合治療' },
  { u: 'sc_doc4', name: '林秀醫師', sp: '骨傷科' },
];
const STAFF = ['sc_staff1', 'sc_staff2', 'sc_staff3', 'sc_staff4', 'sc_staff5'];
const ADMIN2 = 'sc_admin2';
const SERVICES = ['S1', 'S2', 'S3', 'S4'];
const SERVICE_NAMES = { S1: '推拿治療（45 分鐘）', S2: '針灸治療（30 分鐘）', S3: '推拿 + 針灸（60 分鐘）', S4: '新症諮詢（30 分鐘）' };
const STATUS_POOL = ['completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'cancelled', 'cancelled', 'cancelled', 'no-show', 'no-show', 'confirmed', 'confirmed', 'in-progress'];

async function main() {
  // 冚晒舊場景數據先清走（idempotent）
  await run("DELETE FROM bookings WHERE notes='SCENARIO_SEED'");
  await run("DELETE FROM attendance WHERE note='SCENARIO_SEED'");
  await run("DELETE FROM doctors WHERE name LIKE 'sc_%'");
  await run("DELETE FROM users WHERE username LIKE 'sc_%'");

  // 1) 醫師（user + doctors 表 link）
  const docIds = {};
  for (const d of DOCTORS) {
    const id = await run(
      "INSERT INTO users (username,password,name,phone,email,role,profile_completed,must_change_password,membership_tier) VALUES (?,?,?,?,?,?,1,0,'general')",
      [d.u, hash, d.name, '9100 ' + d.u.slice(-2) + '01', d.u + '@clinic.com', 'doctor']);
    await run("INSERT INTO doctors (name,specialty,is_active,user_id) VALUES (?,?,1,?)", [d.name, d.sp, id]);
    docIds[d.u] = id;
  }

  // 2) 員工
  const staffIds = {};
  for (const s of STAFF) {
    const id = await run(
      "INSERT INTO users (username,password,name,phone,email,role,profile_completed,must_change_password,membership_tier) VALUES (?,?,?,?,?,?,1,0,'general')",
      [s, hash, '職員_' + s.slice(-1), '9200 ' + s.slice(-1) + '01', s + '@clinic.com', 'staff']);
    staffIds[s] = id;
  }

  // 3) 第二管理員（admin1 = 生產庫原有 admin，密碼 AuroraDock3r!Test）
  await run(
    "INSERT INTO users (username,password,name,phone,email,role,profile_completed,must_change_password,membership_tier) VALUES (?,?,?,?,?,?,1,0,'general')",
    [ADMIN2, hash, '副管理員', '9300 0002', ADMIN2 + '@clinic.com', 'admin']);

  // 4) 40 客戶（sc_cust01..40），sc_cust01 做家庭戶主（可預約非初體驗服務）
  const custIds = [];
  for (let i = 1; i <= 40; i++) {
    const uname = 'sc_cust' + String(i).padStart(2, '0');
    const tier = i === 1 ? 'family' : (i % 4 === 0 ? 'family' : 'general');
    const id = await run(
      "INSERT INTO users (username,password,name,phone,email,role,profile_completed,must_change_password,membership_tier) VALUES (?,?,?,?,?,?,1,0,?)",
      [uname, hash, '客戶_' + String(i).padStart(2, '0'), '98' + String(100000 + i), uname + '@patient.com', 'customer', tier]);
    if (tier === 'family') await run("UPDATE users SET family_head_id=? WHERE id=?", [id, id]);
    custIds.push({ id, uname, tier });
  }

  // 4b) 未完成資料客戶（供邊界測試：profile_completed=0 預約應被擋）
  await run(
    "INSERT INTO users (username,password,name,phone,email,role,profile_completed,must_change_password,membership_tier) VALUES (?,?,?,?,?,?,0,0,'general')",
    ['sc_incomplete', hash, '未完成資料客', '9800 9999', 'sc_incomplete@patient.com', 'customer']);

  // 5) 40 預約：每日 20，歷史兩日，多種狀態 / 醫師 / 服務；約半數有 user_id，半數 walk-in
  const times = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00'];
  let bk = 0;
  for (const day of [DAY1, DAY2]) {
    for (let i = 0; i < 20; i++) {
      const doc = DOCTORS[bk % 4];
      const svc = SERVICES[bk % 4];
      const status = STATUS_POOL[i % STATUS_POOL.length];
      const time = times[i % times.length];
      const useReg = i % 2 === 0; // 半註冊半 walk-in
      const cust = custIds[bk];
      const userId = useReg ? cust.id : null;
      const cname = useReg ? '客戶_' + String(bk + 1).padStart(2, '0') : '現場客_' + String(bk + 1).padStart(2, '0');
      const cphone = useReg ? '98' + String(100000 + bk + 1) : '97' + String(200000 + bk + 1);
      await run(
        `INSERT INTO bookings (user_id,customer_name,customer_phone,service_id,doctor_name,doctor_user_id,appointment_date,appointment_time,status,notes)
         VALUES (?,?,?,?,?,?,?,?,?,'SCENARIO_SEED')`,
        [userId, cname, cphone, svc, doc.name, docIds[doc.u], day, time, status]);
      bk++;
    }
  }

  // 6) HR 考勤：員工 + 醫師 兩日都打卡（供 payroll 計算）
  const workers = [
    ...STAFF.map(s => ({ u: staffIds[s], name: '職員_' + s.slice(-1), role: 'staff' })),
    ...DOCTORS.map(d => ({ u: docIds[d.u], name: d.name, role: 'doctor' })),
  ];
  for (const day of [DAY1, DAY2]) {
    for (const w of workers) {
      await run(
        `INSERT INTO attendance (user_id,name,role,attendance_date,clock_in,clock_out,work_minutes,is_late,is_early_leave,is_absent,attendance_type,note,source)
         VALUES (?,?,?,?,'09:00','18:00',540,0,0,0,'full','SCENARIO_SEED','seed')`,
        [w.u, w.name, w.role, day]);
    }
  }

  // 報告
  const counts = await all(`SELECT appointment_date, status, COUNT(*) c FROM bookings WHERE notes='SCENARIO_SEED' GROUP BY appointment_date, status ORDER BY appointment_date, status`);
  console.log('=== 場景種子完成 ===');
  console.log('DB:', DB);
  console.log('帳號密碼（場景）:', PWD, '| admin1 密碼（生產）: env ADMIN_PASSWORD');
  console.log('管理員:', 'admin (原有) +', ADMIN2);
  console.log('醫師:', DOCTORS.map(d => d.u).join(', '));
  console.log('員工:', STAFF.join(', '));
  console.log('客戶: sc_cust01..40（共 40）');
  console.log('預約歷史：');
  for (const r of counts) console.log(`  ${r.appointment_date}  ${r.status.padEnd(12)} x${r.c}`);
  const att = await get("SELECT COUNT(*) c FROM attendance WHERE note='SCENARIO_SEED'");
  console.log('考勤記錄:', att.c, '(', workers.length, '人 x 2 日 )');
}

main().catch(e => { console.error('SEED ERROR:', e.message); process.exit(1); }).finally(() => db.close());
