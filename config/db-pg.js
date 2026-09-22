// =====================================================================
// config/db-pg.js — Amazon RDS PostgreSQL 適配層
// ---------------------------------------------------------------------
// 設計目標：令現有 route / service 代碼（全程用 sqlite3 風格 API：
// db.run / db.get / db.all / db.prepare / db.serialize / this.lastID）
// 唔使改，直接連 RDS PostgreSQL。
//
// 切換方式（config/db.js 頂部 guard）：當 process.env.DATABASE_URL
// 係 postgres:// 開頭，config/db.js 會整個被呢個模組取代。
// 若無 DATABASE_URL，app 繼續用 SQLite（本地開發唔受影響）。
//
// 連接設定讀取自 env（優先 DATABASE_URL，否則 PG* / DB_* 分項）：
//   DATABASE_URL=postgres://user:pass@<rds-endpoint>:5432/aurora
//   或 PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE
//   PGSSL=false 可關 SSL（預設 rejectUnauthorized:false，配合 RDS）
// =====================================================================

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

// ---------- 密碼加解密（與 db.js 一致） ----------
function hashPassword(password) {
  const saltRounds = 10;
  return bcrypt.hashSync(password, saltRounds);
}
function verifyPassword(password, hashedPassword) {
  if (hashedPassword && (hashedPassword.startsWith('$2a$') || hashedPassword.startsWith('$2b$') || hashedPassword.startsWith('$2y$'))) {
    return bcrypt.compareSync(password, hashedPassword);
  }
  const sha256Hash = crypto.createHash('sha256').update(password).digest('hex');
  return sha256Hash === hashedPassword;
}

// ---------- 連接池 ----------
function buildPool() {
  const ssl = (process.env.PGSSL === 'false') ? false : { rejectUnauthorized: false };
  const common = { ssl, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 };
  if (process.env.DATABASE_URL) {
    return new Pool(Object.assign({ connectionString: process.env.DATABASE_URL }, common));
  }
  return new Pool(Object.assign({
    host: process.env.PGHOST || process.env.DB_HOST || 'localhost',
    port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10)
      : (process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432),
    user: process.env.PGUSER || process.env.DB_USER,
    password: process.env.PGPASSWORD || process.env.DB_PASSWORD,
    database: process.env.PGDATABASE || process.env.DB_NAME,
  }, common));
}

// ---------- SQL 轉譯：? → $n、INSERT OR IGNORE → ON CONFLICT DO NOTHING ----------
function translate(sql) {
  let s = String(sql);
  let isIgnore = false;
  if (/INSERT OR IGNORE/i.test(s)) {
    isIgnore = true;
    s = s.replace(/INSERT OR IGNORE/i, 'INSERT');
  }
  // SQLite 唔理大小寫嘅 COLLATE NOCASE → PG 直接去掉（username 一般小寫儲存）
  s = s.replace(/COLLATE\s+NOCASE/gi, '');
  let i = 0;
  s = s.replace(/\?/g, () => '$' + (++i));
  if (isIgnore) {
    s = s.replace(/\bVALUES\b/i, 'ON CONFLICT DO NOTHING VALUES');
  }
  return s;
}

function pragmaTableInfo(sql) {
  const m = String(sql).match(/PRAGMA\s+table_info\(\s*([\w]+)\s*\)/i);
  return m ? m[1] : null;
}

// ---------- sqlite3 風格適配器（含 startup 查詢排隊） ----------
function makeAdapter(pool) {
  let ready = false;
  const queue = [];
  let bootError = null;

  function enqueue(fn) {
    if (ready) fn();
    else queue.push(fn);
  }
  function flush() {
    ready = true;
    queue.splice(0, queue.length).forEach((fn) => fn());
  }
  function fail(err) {
    bootError = err; ready = true;
    queue.splice(0, queue.length).forEach((fn) => fn(err));
  }

  function exec(sql, params) {
    return new Promise((resolve, reject) => {
      const tbl = pragmaTableInfo(sql);
      let q, p;
      if (tbl) {
        // PRAGMA table_info(x) → information_schema（app 讀 .name / .notnull）
        q = `SELECT column_name AS name, data_type AS type,
                    CASE WHEN is_nullable='NO' THEN 1 ELSE 0 END AS notnull,
                    column_default AS dflt_value
             FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`;
        p = [tbl];
      } else if (/^\s*PRAGMA\b/i.test(String(sql))) {
        // journal_mode / busy_timeout 等 → no-op
        return resolve({ rows: [] });
      } else {
        q = translate(sql);
        p = params || [];
        // INSERT ... VALUES → 補 RETURNING id 攞 lastID
        if (/^\s*INSERT\b/i.test(q) && /\bVALUES\b/i.test(q) && !/RETURNING/i.test(q)) {
          q += ' RETURNING id';
        }
      }
      pool.query(q, p, (err, res) => {
        if (err) return reject(err);
        const rows = res && res.rows ? res.rows : [];
        let lastID = 0;
        if (rows[0] && rows[0].id !== undefined && rows[0].id !== null) lastID = rows[0].id;
        resolve({ rows, lastID });
      });
    });
  }

  const db = {};
  const wrap = (method) => function (sql, p, c) {
    let params = p, cb = c;
    if (typeof p === 'function') { cb = p; params = []; }
    enqueue((err) => {
      if (err) { if (cb) cb(err); return; }
      exec(sql, params).then(({ rows, lastID }) => {
        if (method === 'get') { if (cb) cb(null, rows[0] || undefined); }
        else if (method === 'all' || method === 'each') { if (cb) cb(null, rows); }
        else { if (cb) cb.call({ lastID: lastID || 0 }, null); } // run / prepare.run → this.lastID
      }).catch((e) => { if (cb) cb(e); });
    });
    return db;
  };

  db.run = wrap('run');
  db.get = wrap('get');
  db.all = wrap('all');
  db.each = function (sql, p, rowCb, doneCb) {
    let params = p, rcb = rowCb, dcb = doneCb;
    if (typeof p === 'function') { dcb = rowCb; rcb = p; params = []; }
    enqueue((err) => {
      if (err) { if (dcb) dcb(err); return; }
      exec(sql, params).then(({ rows }) => {
        rows.forEach((r) => { if (rcb) rcb(null, r); });
        if (dcb) dcb(null);
      }).catch((e) => { if (dcb) dcb(e); });
    });
    return db;
  };
  db.prepare = function (sql) {
    const stmt = {
      lastID: 0,
      run: function (p, c) {
        let params = p, cb = c;
        if (typeof p === 'function') { cb = p; params = []; }
        enqueue((err) => {
          if (err) { if (cb) cb(err); return; }
          exec(sql, params).then(({ lastID }) => {
            stmt.lastID = lastID || 0;
            if (cb) cb.call(stmt, null);
          }).catch((e) => { if (cb) cb(e); });
        });
        return stmt;
      },
      finalize: function (c) { if (c) c(); return stmt; },
    };
    return stmt;
  };
  db.serialize = function (cb) { if (cb) cb(); return db; };
  db._flush = flush;
  db._fail = fail;
  return db;
}

// ---------- PG-aware migrations（idempotent ADD COLUMN IF NOT EXISTS） ----------
function runPgMigrations(pool) {
  const alters = [
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active INTEGER DEFAULT 1',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS leave_balance TEXT',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS hire_date TEXT',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS hourly_rate REAL',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS basic_salary REAL',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_account TEXT',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT',
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS employment_type TEXT DEFAULT 'full'",
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS member_no TEXT',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS hide_from_head INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS family_plan TEXT',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS hide_medical_from_head INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS hide_booking_from_head INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS hide_profile_from_head INTEGER DEFAULT 0',
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS membership_tier TEXT DEFAULT 'general'",
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT',
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'none'",
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS insurance_covered INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS family_head_id INTEGER',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_weather INTEGER DEFAULT 1',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_confirm INTEGER DEFAULT 1',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_health INTEGER DEFAULT 1',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS member_invoice_no TEXT',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_method TEXT',
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_note TEXT DEFAULT ''",
    'ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_locked INTEGER DEFAULT 0',
    'ALTER TABLE bookings ADD COLUMN IF NOT EXISTS end_time TEXT',
    'ALTER TABLE bookings ADD COLUMN IF NOT EXISTS lateness_minutes INTEGER DEFAULT 0',
    'ALTER TABLE bookings ADD COLUMN IF NOT EXISTS bed_type TEXT',
    'ALTER TABLE bookings ADD COLUMN IF NOT EXISTS bed_number INTEGER',
    'ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_age INTEGER',
    'ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_name_en TEXT',
    'ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_free INTEGER DEFAULT 0',
    'ALTER TABLE services ADD COLUMN IF NOT EXISTS requires_bed INTEGER DEFAULT 0',
    'ALTER TABLE services ADD COLUMN IF NOT EXISTS short_name TEXT',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS note TEXT',
    'ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS audio_file_path TEXT',
    'ALTER TABLE customer_health_profiles ADD COLUMN IF NOT EXISTS verified_by INTEGER',
    'ALTER TABLE customer_health_profiles ADD COLUMN IF NOT EXISTS verified_at TEXT',
    'ALTER TABLE customer_health_profiles ADD COLUMN IF NOT EXISTS updated_by INTEGER',
    'ALTER TABLE hr_user_schedules ADD COLUMN IF NOT EXISTS is_weekly INTEGER DEFAULT 0',
    "ALTER TABLE hr_user_schedules ADD COLUMN IF NOT EXISTS hours TEXT",
  ];
  return alters.reduce((chain, sql) =>
    chain.then(() => pool.query(sql).then(() => {}).catch((e) => {
      if (!/already exists|duplicate/i.test(e.message || '')) console.error('PG migration err:', e.message);
    })), Promise.resolve());
}

// ---------- seeds（移植自 db.js，用 adapter API，兩邊通用） ----------
function cnt(row) { return row ? Number(row.count) : 0; }

function seedDatabase(db) {
  db.get("SELECT COUNT(*) as count FROM clinic_settings", (e, row) => {
    if (!e && cnt(row) === 0) {
      const settings = [['tuina_beds', '5'], ['acupuncture_beds', '5'], ['vip_rooms', '5'], ['total_doctors', '3'], ['closed_days', '0']];
      settings.forEach(([k, v]) => db.run("INSERT OR IGNORE INTO clinic_settings (setting_key, setting_value) VALUES (?, ?)", [k, v]));
      db.run("INSERT OR IGNORE INTO clinic_settings (setting_key, setting_value) VALUES (?, ?)", ['holidays_enabled', '1']);
      db.run("INSERT OR IGNORE INTO clinic_settings (setting_key, setting_value) VALUES (?, ?)", ['working_holidays', '']);
      db.run("INSERT OR IGNORE INTO clinic_settings (setting_key, setting_value) VALUES (?, ?)", ['sms_notification_enabled', 'true']);
      db.run("INSERT OR IGNORE INTO clinic_settings (setting_key, setting_value) VALUES (?, ?)", ['whatsapp_notification_enabled', 'true']);
    }
  });
  db.get("SELECT COUNT(*) as count FROM doctors", (e, row) => {
    if (!e && cnt(row) === 0) {
      [['張醫師', '推拿專家'], ['李醫師', '針灸專家'], ['王醫師', '綜合治療'], ['陳醫師', '骨傷科']]
        .forEach(([n, s]) => db.run("INSERT INTO doctors (name, specialty, is_active) VALUES (?, ?, 1)", [n, s]));
    }
  });
  db.get("SELECT COUNT(*) as count FROM users WHERE role='admin'", (e, row) => {
    if (!e && cnt(row) === 0) {
      const pw = process.env.ADMIN_PASSWORD
        ? process.env.ADMIN_PASSWORD
        : crypto.randomBytes(12).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
      const adminPassword = hashPassword(pw);
      db.run("INSERT INTO users (username, password, name, name_en, phone, email, role, profile_completed, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)",
        ['admin', adminPassword, '管理員', 'Admin', '0900-000-000', 'admin@jrwellnesshk.com', 'admin', 1],
        (err) => {
          if (!err) console.log(process.env.ADMIN_PASSWORD
            ? '✅ 已建立管理員帳戶（密碼取自 ADMIN_PASSWORD）'
            : '✅ 已建立管理員帳戶（臨時密碼=' + pw + '，請盡快修改）');
        });
    }
  });
  db.get("SELECT COUNT(*) as count FROM services", (e, row) => {
    if (!e && cnt(row) === 0) {
      [['S1', '推拿治療（45 分鐘）', 45, 300], ['S2', '針灸治療（30 分鐘）', 30, 250], ['S3', '推拿 + 針灸（60 分鐘）', 60, 500], ['S4', '新症諮詢（30 分鐘）', 30, 150]]
        .forEach(([id, name, dur, price]) => db.run("INSERT INTO services (id, name, duration, price) VALUES (?,?,?,?)", [id, name, dur, price]));
    }
  });
  db.get("SELECT COUNT(*) as count FROM symptom_categories", (e, row) => {
    if (!e && cnt(row) === 0) {
      const stmt = db.prepare("INSERT INTO symptom_categories (id, name_zh_hant, name_en, description_zh_hant, description_en, icon) VALUES (?, ?, ?, ?, ?, ?)");
      [['cold_flu', '感冒/流感', 'Cold/Flu', '發燒、咳嗽、喉嚨痛等', 'Fever, cough, sore throat, etc.', 'fa-temperature-high'],
       ['digestive', '腸胃問題', 'Digestive Issues', '肚痛、腹瀉、嘔吐等', 'Stomach pain, diarrhea, vomiting, etc.', 'fa-stomach'],
       ['pain', '痛症', 'Pain', '頭痛、腰痛、肌肉痠痛等', 'Headache, back pain, muscle aches, etc.', 'fa-hand-dots'],
       ['respiratory', '呼吸系統', 'Respiratory', '咳嗽、氣喘、呼吸困難等', 'Cough, asthma, breathing difficulty, etc.', 'fa-lungs'],
       ['allergy', '過敏', 'Allergy', '皮膚紅疹、鼻敏感等', 'Skin rash, allergies, etc.', 'fa-allergies']]
        .forEach((r) => stmt.run(r[0], r[1], r[2], r[3], r[4], r[5]));
      stmt.finalize();
    }
  });
  initializeAIQuestions(db);
  initializeAIRecommendations(db);
  initializeTriageQuestions(db);
  initializeFaqs(db);
}

function initializeAIQuestions(db) {
  db.get("SELECT COUNT(*) as count FROM ai_questions", (err, row) => {
    if (err || cnt(row) > 0) return;
    const questions = [];
    const options = [];
    questions.push({ id: "cf_q1", category: "cold_flu", order: 1, type: "single", critical: 0, zh_hant: "您現在的體溫如何？", en: "What is your current body temperature?" });
    options.push({ id: "cf_q1_a", qid: "cf_q1", score: 0, next: "cf_q2", zh_hant: "正常 (<37.5°C)", en: "Normal (<37.5°C)" });
    options.push({ id: "cf_q1_b", qid: "cf_q1", score: 3, next: "cf_q2", zh_hant: "輕微發燒 (37.5-38°C)", en: "Slight fever (37.5-38°C)" });
    options.push({ id: "cf_q1_c", qid: "cf_q1", score: 6, next: "cf_q2", zh_hant: "高燒 (38-39°C)", en: "High fever (38-39°C)" });
    options.push({ id: "cf_q1_d", qid: "cf_q1", score: 10, next: "cf_q3", zh_hant: "持續高燒 (>39°C)", en: "Persistent high fever (>39°C)" });
    questions.push({ id: "cf_q2", category: "cold_flu", order: 2, type: "single", critical: 0, zh_hant: "這些症狀持續多久了？", en: "How long have you had these symptoms?" });
    options.push({ id: "cf_q2_a", qid: "cf_q2", score: 1, next: "cf_q3", zh_hant: "今天才開始", en: "Started today" });
    options.push({ id: "cf_q2_b", qid: "cf_q2", score: 3, next: "cf_q3", zh_hant: "1-2天", en: "1-2 days" });
    options.push({ id: "cf_q2_c", qid: "cf_q2", score: 5, next: "cf_q3", zh_hant: "3-5天", en: "3-5 days" });
    options.push({ id: "cf_q2_d", qid: "cf_q2", score: 8, next: "cf_q4", zh_hant: "超過5天", en: "More than 5 days" });
    questions.push({ id: "cf_q3", category: "cold_flu", order: 3, type: "multiple", critical: 0, zh_hant: "您有以下哪些症狀？（可多選）", en: "Which of these symptoms do you have? (Multiple choice)" });
    options.push({ id: "cf_q3_a", qid: "cf_q3", score: 2, next: "cf_q4", zh_hant: "咳嗽", en: "Cough" });
    options.push({ id: "cf_q3_b", qid: "cf_q3", score: 2, next: "cf_q4", zh_hant: "喉嚨痛", en: "Sore throat" });
    options.push({ id: "cf_q3_c", qid: "cf_q3", score: 1, next: "cf_q4", zh_hant: "流鼻水", en: "Runny nose" });
    options.push({ id: "cf_q3_d", qid: "cf_q3", score: 2, next: "cf_q4", zh_hant: "頭痛", en: "Headache" });
    options.push({ id: "cf_q3_e", qid: "cf_q3", score: 3, next: "cf_q4", zh_hant: "全身肌肉痠痛", en: "Body aches" });
    questions.push({ id: "cf_q4", category: "cold_flu", order: 4, type: "multiple", critical: 1, zh_hant: "您是否有以下情況？（可多選）", en: "Do you have any of the following? (Multiple choice)" });
    options.push({ id: "cf_q4_a", qid: "cf_q4", score: 10, next: null, zh_hant: "呼吸困難", en: "Difficulty breathing" });
    options.push({ id: "cf_q4_b", qid: "cf_q4", score: 10, next: null, zh_hant: "胸痛", en: "Chest pain" });
    options.push({ id: "cf_q4_c", qid: "cf_q4", score: 6, next: null, zh_hant: "持續嘔吐", en: "Persistent vomiting" });
    options.push({ id: "cf_q4_d", qid: "cf_q4", score: 0, next: null, zh_hant: "以上都沒有", en: "None of the above" });
    questions.push({ id: "dg_q1", category: "digestive", order: 1, type: "single", critical: 0, zh_hant: "請問主要是哪種不適？", en: "What is your main discomfort?" });
    options.push({ id: "dg_q1_a", qid: "dg_q1", score: 3, next: "dg_q2", zh_hant: "胃部不適/胃痛", en: "Stomach discomfort/pain" });
    options.push({ id: "dg_q1_b", qid: "dg_q1", score: 4, next: "dg_q2", zh_hant: "腹部疼痛", en: "Abdominal pain" });
    options.push({ id: "dg_q1_c", qid: "dg_q1", score: 3, next: "dg_q3", zh_hant: "腹瀉", en: "Diarrhea" });
    options.push({ id: "dg_q1_d", qid: "dg_q1", score: 5, next: "dg_q3", zh_hant: "嘔吐", en: "Vomiting" });
    questions.push({ id: "dg_q2", category: "digestive", order: 2, type: "single", critical: 0, zh_hant: "疼痛程度如何？", en: "How severe is the pain?" });
    options.push({ id: "dg_q2_a", qid: "dg_q2", score: 1, next: "dg_q4", zh_hant: "輕微，不影響日常", en: "Mild, doesn't affect daily life" });
    options.push({ id: "dg_q2_b", qid: "dg_q2", score: 3, next: "dg_q4", zh_hant: "中等，有點不舒服", en: "Moderate, somewhat uncomfortable" });
    options.push({ id: "dg_q2_c", qid: "dg_q2", score: 6, next: "dg_q4", zh_hant: "嚴重，影響活動", en: "Severe, affects activities" });
    options.push({ id: "dg_q2_d", qid: "dg_q2", score: 10, next: null, zh_hant: "劇痛，無法忍受", en: "Extreme pain, unbearable" });
    questions.push({ id: "dg_q3", category: "digestive", order: 3, type: "single", critical: 0, zh_hant: "症狀頻率如何？", en: "How frequent are the symptoms?" });
    options.push({ id: "dg_q3_a", qid: "dg_q3", score: 2, next: "dg_q4", zh_hant: "偶爾（1-2次/天）", en: "Occasional (1-2 times/day)" });
    options.push({ id: "dg_q3_b", qid: "dg_q3", score: 4, next: "dg_q4", zh_hant: "頻繁（3-5次/天）", en: "Frequent (3-5 times/day)" });
    options.push({ id: "dg_q3_c", qid: "dg_q3", score: 8, next: "dg_q4", zh_hant: "非常頻繁（>6次/天）", en: "Very frequent (>6 times/day)" });
    questions.push({ id: "dg_q4", category: "digestive", order: 4, type: "multiple", critical: 1, zh_hant: "是否有以下情況？（可多選）", en: "Do you have any of the following? (Multiple choice)" });
    options.push({ id: "dg_q4_a", qid: "dg_q4", score: 5, next: null, zh_hant: "發燒", en: "Fever" });
    options.push({ id: "dg_q4_b", qid: "dg_q4", score: 10, next: null, zh_hant: "血便或黑便", en: "Blood or black stool" });
    options.push({ id: "dg_q4_c", qid: "dg_q4", score: 8, next: null, zh_hant: "持續嘔吐超過6小時", en: "Vomiting for >6 hours" });
    options.push({ id: "dg_q4_d", qid: "dg_q4", score: 0, next: null, zh_hant: "以上都沒有", en: "None of the above" });
    questions.push({ id: "pain_q1", category: "pain", order: 1, type: "single", critical: 0, zh_hant: "請問疼痛的主要部位在哪裡？", en: "Where is the main location of pain?" });
    options.push({ id: "pain_q1_a", qid: "pain_q1", score: 2, next: "pain_q2", zh_hant: "頭部", en: "Head" });
    options.push({ id: "pain_q1_b", qid: "pain_q1", score: 3, next: "pain_q2", zh_hant: "頸部/肩膀", en: "Neck/Shoulder" });
    options.push({ id: "pain_q1_c", qid: "pain_q1", score: 3, next: "pain_q2", zh_hant: "腰背部", en: "Lower back" });
    options.push({ id: "pain_q1_d", qid: "pain_q1", score: 2, next: "pain_q2", zh_hant: "四肢關節", en: "Limbs/Joints" });
    questions.push({ id: "pain_q2", category: "pain", order: 2, type: "single", critical: 0, zh_hant: "疼痛程度如何？", en: "How severe is the pain?" });
    options.push({ id: "pain_q2_a", qid: "pain_q2", score: 1, next: "pain_q3", zh_hant: "輕微，不影響日常", en: "Mild, doesn't affect daily life" });
    options.push({ id: "pain_q2_b", qid: "pain_q2", score: 3, next: "pain_q3", zh_hant: "中等，有點不舒服", en: "Moderate, somewhat uncomfortable" });
    options.push({ id: "pain_q2_c", qid: "pain_q2", score: 6, next: "pain_q3", zh_hant: "嚴重，影響活動", en: "Severe, affects activities" });
    options.push({ id: "pain_q2_d", qid: "pain_q2", score: 10, next: null, zh_hant: "劇痛，無法忍受", en: "Extreme pain, unbearable" });
    questions.push({ id: "pain_q3", category: "pain", order: 3, type: "single", critical: 0, zh_hant: "疼痛持續多久了？", en: "How long have you had the pain?" });
    options.push({ id: "pain_q3_a", qid: "pain_q3", score: 1, next: "pain_q4", zh_hant: "今天才開始", en: "Started today" });
    options.push({ id: "pain_q3_b", qid: "pain_q3", score: 2, next: "pain_q4", zh_hant: "1-3天", en: "1-3 days" });
    options.push({ id: "pain_q3_c", qid: "pain_q3", score: 4, next: "pain_q4", zh_hant: "1-2週", en: "1-2 weeks" });
    options.push({ id: "pain_q3_d", qid: "pain_q3", score: 6, next: "pain_q4", zh_hant: "超過2週", en: "More than 2 weeks" });
    questions.push({ id: "pain_q4", category: "pain", order: 4, type: "multiple", critical: 1, zh_hant: "是否有以下情況？（可多選）", en: "Do you have any of the following? (Multiple choice)" });
    options.push({ id: "pain_q4_a", qid: "pain_q4", score: 8, next: null, zh_hant: "手腳麻痺或無力", en: "Numbness or weakness in limbs" });
    options.push({ id: "pain_q4_b", qid: "pain_q4", score: 10, next: null, zh_hant: "劇烈頭痛伴隨嘔吐", en: "Severe headache with vomiting" });
    options.push({ id: "pain_q4_c", qid: "pain_q4", score: 5, next: null, zh_hant: "疼痛逐漸加劇", en: "Pain gradually worsening" });
    options.push({ id: "pain_q4_d", qid: "pain_q4", score: 0, next: null, zh_hant: "以上都沒有", en: "None of the above" });
    questions.push({ id: "resp_q1", category: "respiratory", order: 1, type: "multiple", critical: 0, zh_hant: "您有哪些呼吸相關症狀？（可多選）", en: "What respiratory symptoms do you have? (Multiple choice)" });
    options.push({ id: "resp_q1_a", qid: "resp_q1", score: 2, next: "resp_q2", zh_hant: "咳嗽", en: "Cough" });
    options.push({ id: "resp_q1_b", qid: "resp_q1", score: 3, next: "resp_q2", zh_hant: "氣喘/呼吸急促", en: "Wheezing/Shortness of breath" });
    options.push({ id: "resp_q1_c", qid: "resp_q1", score: 4, next: "resp_q2", zh_hant: "胸悶", en: "Chest tightness" });
    options.push({ id: "resp_q1_d", qid: "resp_q1", score: 2, next: "resp_q2", zh_hant: "有痰", en: "Phlegm" });
    questions.push({ id: "resp_q2", category: "respiratory", order: 2, type: "single", critical: 0, zh_hant: "症狀持續多久了？", en: "How long have you had these symptoms?" });
    options.push({ id: "resp_q2_a", qid: "resp_q2", score: 1, next: "resp_q3", zh_hant: "今天才開始", en: "Started today" });
    options.push({ id: "resp_q2_b", qid: "resp_q2", score: 2, next: "resp_q3", zh_hant: "2-3天", en: "2-3 days" });
    options.push({ id: "resp_q2_c", qid: "resp_q2", score: 4, next: "resp_q3", zh_hant: "4-7天", en: "4-7 days" });
    options.push({ id: "resp_q2_d", qid: "resp_q2", score: 6, next: "resp_q3", zh_hant: "超過1週", en: "More than 1 week" });
    questions.push({ id: "resp_q3", category: "respiratory", order: 3, type: "single", critical: 0, zh_hant: "呼吸困難程度如何？", en: "How difficult is it to breathe?" });
    options.push({ id: "resp_q3_a", qid: "resp_q3", score: 1, next: "resp_q4", zh_hant: "沒有困難，正常呼吸", en: "No difficulty, breathing normally" });
    options.push({ id: "resp_q3_b", qid: "resp_q3", score: 3, next: "resp_q4", zh_hant: "活動時有點喘", en: "Slight breathlessness during activity" });
    options.push({ id: "resp_q3_c", qid: "resp_q3", score: 6, next: "resp_q4", zh_hant: "稍微活動就很喘", en: "Very breathless with slight activity" });
    options.push({ id: "resp_q3_d", qid: "resp_q3", score: 10, next: null, zh_hant: "休息時也感到呼吸困難", en: "Difficulty breathing even at rest" });
    questions.push({ id: "resp_q4", category: "respiratory", order: 4, type: "multiple", critical: 1, zh_hant: "是否有以下情況？（可多選）", en: "Do you have any of the following? (Multiple choice)" });
    options.push({ id: "resp_q4_a", qid: "resp_q4", score: 10, next: null, zh_hant: "嘴唇或指甲發紫", en: "Blue lips or nails" });
    options.push({ id: "resp_q4_b", qid: "resp_q4", score: 8, next: null, zh_hant: "胸痛", en: "Chest pain" });
    options.push({ id: "resp_q4_c", qid: "resp_q4", score: 5, next: null, zh_hant: "發燒", en: "Fever" });
    options.push({ id: "resp_q4_d", qid: "resp_q4", score: 0, next: null, zh_hant: "以上都沒有", en: "None of the above" });
    questions.push({ id: "allergy_q1", category: "allergy", order: 1, type: "multiple", critical: 0, zh_hant: "您有哪些過敏症狀？（可多選）", en: "What allergy symptoms do you have? (Multiple choice)" });
    options.push({ id: "allergy_q1_a", qid: "allergy_q1", score: 2, next: "allergy_q2", zh_hant: "皮膚紅疹/痕癢", en: "Skin rash/itching" });
    options.push({ id: "allergy_q1_b", qid: "allergy_q1", score: 2, next: "allergy_q2", zh_hant: "鼻塞/流鼻水", en: "Stuffy/Runny nose" });
    options.push({ id: "allergy_q1_c", qid: "allergy_q1", score: 2, next: "allergy_q2", zh_hant: "眼睛痕癢/流眼水", en: "Itchy/Watery eyes" });
    options.push({ id: "allergy_q1_d", qid: "allergy_q1", score: 3, next: "allergy_q2", zh_hant: "打噴嚏", en: "Sneezing" });
    questions.push({ id: "allergy_q2", category: "allergy", order: 2, type: "single", critical: 0, zh_hant: "症狀持續多久了？", en: "How long have you had these symptoms?" });
    options.push({ id: "allergy_q2_a", qid: "allergy_q2", score: 1, next: "allergy_q3", zh_hant: "剛開始", en: "Just started" });
    options.push({ id: "allergy_q2_b", qid: "allergy_q2", score: 2, next: "allergy_q3", zh_hant: "幾天", en: "A few days" });
    options.push({ id: "allergy_q2_c", qid: "allergy_q2", score: 3, next: "allergy_q3", zh_hant: "1-2週", en: "1-2 weeks" });
    options.push({ id: "allergy_q2_d", qid: "allergy_q2", score: 4, next: "allergy_q3", zh_hant: "長期反覆發作", en: "Chronic/Recurring" });
    questions.push({ id: "allergy_q3", category: "allergy", order: 3, type: "single", critical: 0, zh_hant: "您知道過敏源是什麼嗎？", en: "Do you know what you're allergic to?" });
    options.push({ id: "allergy_q3_a", qid: "allergy_q3", score: 1, next: "allergy_q4", zh_hant: "知道，已避開過敏源", en: "Yes, avoiding the allergen" });
    options.push({ id: "allergy_q3_b", qid: "allergy_q3", score: 2, next: "allergy_q4", zh_hant: "知道，但難以避免", en: "Yes, but hard to avoid" });
    options.push({ id: "allergy_q3_c", qid: "allergy_q3", score: 3, next: "allergy_q4", zh_hant: "不確定", en: "Not sure" });
    options.push({ id: "allergy_q3_d", qid: "allergy_q3", score: 3, next: "allergy_q4", zh_hant: "不知道", en: "Don't know" });
    questions.push({ id: "allergy_q4", category: "allergy", order: 4, type: "multiple", critical: 1, zh_hant: "是否有以下嚴重情況？（可多選）", en: "Do you have any severe symptoms? (Multiple choice)" });
    options.push({ id: "allergy_q4_a", qid: "allergy_q4", score: 10, next: null, zh_hant: "呼吸困難/氣喘", en: "Difficulty breathing/Wheezing" });
    options.push({ id: "allergy_q4_b", qid: "allergy_q4", score: 10, next: null, zh_hant: "面部/喉嚨腫脹", en: "Face/Throat swelling" });
    options.push({ id: "allergy_q4_c", qid: "allergy_q4", score: 5, next: null, zh_hant: "大範圍紅疹/水泡", en: "Widespread rash/Blisters" });
    options.push({ id: "allergy_q4_d", qid: "allergy_q4", score: 0, next: null, zh_hant: "以上都沒有", en: "None of the above" });
    const qStmt = db.prepare("INSERT INTO ai_questions (id, category_id, question_zh_hant, question_en, question_order, question_type, is_critical) VALUES (?, ?, ?, ?, ?, ?, ?)");
    questions.forEach((q) => qStmt.run(q.id, q.category, q.zh_hant, q.en, q.order, q.type, q.critical));
    qStmt.finalize();
    const oStmt = db.prepare("INSERT INTO ai_answer_options (id, question_id, option_zh_hant, option_en, severity_score, next_question_id) VALUES (?, ?, ?, ?, ?, ?)");
    options.forEach((o) => oStmt.run(o.id, o.qid, o.zh_hant, o.en, o.score, o.next));
    oStmt.finalize();
    console.log("✅ 已建立 AI 問診問題和答案選項");
  });
}

function initializeAIRecommendations(db) {
  db.get("SELECT COUNT(*) as count FROM ai_recommendations", (err, row) => {
    if (err || cnt(row) > 0) return;
    const recs = [
      { id: "cf_r1", cat: "cold_flu", min: 0, max: 5, urgency: "normal", booking: 0, zh_hant: "根據您的症狀，目前情況尚可。建議多休息、多喝水。\n\n⚠️ 請留意身體狀況，如有轉差（如發燒、疼痛加劇、持續不適等），必須立即就醫。", en: "Based on your symptoms, your condition seems manageable. Please rest and stay hydrated.\n\n⚠️ Please monitor your condition. Seek immediate medical attention if symptoms worsen." },
      { id: "cf_r2", cat: "cold_flu", min: 6, max: 15, urgency: "urgent", booking: 1, zh_hant: "根據您的症狀，建議盡快就診檢查。您可能需要專業診斷和治療。\n\n⚠️ 建議您預約真實醫師進行診斷。", en: "Based on your symptoms, we recommend seeing a doctor soon for proper diagnosis and treatment.\n\n⚠️ Please book an appointment with a real doctor." },
      { id: "cf_r3", cat: "cold_flu", min: 16, max: 100, urgency: "emergency", booking: 1, zh_hant: "⚠️ 您的症狀較為嚴重，建議立即就醫！\n\n可能需要緊急處理，請盡快預約或前往急診。", en: "⚠️ Your symptoms are severe. Please seek medical attention immediately!\n\nYou may need urgent care. Please book an appointment or go to the ER." },
      { id: "dg_r1", cat: "digestive", min: 0, max: 6, urgency: "normal", booking: 0, zh_hant: "根據您的症狀，目前情況尚可。建議清淡飲食、多喝水。\n\n⚠️ 請留意身體狀況，如有轉差（如發燒、疼痛加劇、持續不適等），必須立即就醫。", en: "Your condition seems manageable. Eat light foods and stay hydrated.\n\n⚠️ Monitor your condition and seek help if it worsens." },
      { id: "dg_r2", cat: "digestive", min: 7, max: 15, urgency: "urgent", booking: 1, zh_hant: "根據您的症狀，建議就診檢查。腸胃問題可能需要專業治療。\n\n⚠️ 建議您預約醫師進行診斷。", en: "We recommend seeing a doctor. Digestive issues may need professional treatment.\n\n⚠️ Please book an appointment." },
      { id: "dg_r3", cat: "digestive", min: 16, max: 100, urgency: "emergency", booking: 1, zh_hant: "⚠️ 您的症狀需要盡快就醫！\n\n可能有嚴重腸胃問題，請立即預約或前往急診。", en: "⚠️ Please seek medical attention immediately!\n\nYou may have a serious digestive issue. Book an appointment or go to the ER." },
      { id: "pain_r1", cat: "pain", min: 0, max: 5, urgency: "normal", booking: 0, zh_hant: "根據您的症狀，目前情況尚可。建議多休息，可使用熱敷或冷敷緩解。\n\n⚠️ 請留意身體狀況，如疼痛持續或加劇，請就醫檢查。", en: "Your condition seems manageable. Rest and apply hot/cold compress.\n\n⚠️ Seek help if pain persists or worsens." },
      { id: "pain_r2", cat: "pain", min: 6, max: 15, urgency: "urgent", booking: 1, zh_hant: "根據您的症狀，建議就診檢查。疼痛問題可能需要專業治療。\n\n⚠️ 建議您預約中醫或物理治療師進行評估。", en: "We recommend seeing a doctor. Pain issues may need professional treatment.\n\n⚠️ Please book an appointment for assessment." },
      { id: "pain_r3", cat: "pain", min: 16, max: 100, urgency: "emergency", booking: 1, zh_hant: "⚠️ 您的症狀較為嚴重，建議立即就醫！\n\n劇烈疼痛或伴隨其他症狀可能需要緊急處理。", en: "⚠️ Your symptoms are severe. Please seek medical attention immediately!\n\nSevere pain may require urgent care." },
      { id: "resp_r1", cat: "respiratory", min: 0, max: 5, urgency: "normal", booking: 0, zh_hant: "根據您的症狀，目前情況尚可。建議多休息、保持空氣流通。\n\n⚠️ 請留意呼吸狀況，如有惡化請立即就醫。", en: "Your condition seems manageable. Rest and maintain good air circulation.\n\n⚠️ Monitor your breathing and seek help if it worsens." },
      { id: "resp_r2", cat: "respiratory", min: 6, max: 15, urgency: "urgent", booking: 1, zh_hant: "根據您的症狀，建議盡快就診。呼吸系統問題需要專業評估。\n\n⚠️ 建議您預約醫師進行檢查。", en: "We recommend seeing a doctor soon. Respiratory issues need professional assessment.\n\n⚠️ Please book an appointment." },
      { id: "resp_r3", cat: "respiratory", min: 16, max: 100, urgency: "emergency", booking: 1, zh_hant: "⚠️ 您的症狀非常嚴重，請立即就醫！\n\n嚴重呼吸困難可能危及生命，請馬上前往急診。", en: "⚠️ Your symptoms are very severe. Seek emergency care immediately!\n\nSevere breathing difficulty can be life-threatening. Go to the ER now." },
      { id: "allergy_r1", cat: "allergy", min: 0, max: 5, urgency: "normal", booking: 0, zh_hant: "根據您的症狀，目前情況尚可。建議避開已知過敏源，可使用抗敏藥物。\n\n⚠️ 請留意症狀變化，如有惡化請就醫。", en: "Your condition seems manageable. Avoid known allergens and use antihistamines.\n\n⚠️ Monitor symptoms and seek help if they worsen." },
      { id: "allergy_r2", cat: "allergy", min: 6, max: 15, urgency: "urgent", booking: 1, zh_hant: "根據您的症狀，建議就診檢查。可能需要進行過敏測試和專業治療。\n\n⚠️ 建議您預約醫師進行評估。", en: "We recommend seeing a doctor. You may need allergy testing and treatment.\n\n⚠️ Please book an appointment." },
      { id: "allergy_r3", cat: "allergy", min: 16, max: 100, urgency: "emergency", booking: 1, zh_hant: "⚠️ 您可能出現嚴重過敏反應！請立即就醫！\n\n嚴重過敏反應（如呼吸困難、面部腫脹）需要緊急處理。", en: "⚠️ You may be having a severe allergic reaction! Seek emergency care immediately!\n\nSevere reactions require urgent medical attention." }
    ];
    const stmt = db.prepare("INSERT INTO ai_recommendations (id, category_id, min_score, max_score, recommendation_zh_hant, recommendation_en, urgency_level, show_booking_button) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    recs.forEach((r) => stmt.run(r.id, r.cat, r.min, r.max, r.zh_hant, r.en, r.urgency, r.booking));
    stmt.finalize();
    console.log("✅ 已建立 AI 問診診斷建議");
  });
}

function initializeTriageQuestions(db) {
  db.get("SELECT COUNT(*) as count FROM triage_questions", (err, row) => {
    if (err || cnt(row) > 0) return;
    const questions = [
      { id: 1, question_zh: "請選擇最能描述您主要症狀的類別：", question_en: "Please select the category that best describes your main symptoms:", sort_order: 1,
        options: [{ option_zh: "痛症", option_en: "Pain", scores: { d1: 10, d2: 2, d3: 2, d4: 8 } }, { option_zh: "與調理", option_en: "Conditioning & Regulation", scores: { d1: 2, d2: 4, d3: 10, d4: 2 } }, { option_zh: "感冒", option_en: "Cold / Flu", scores: { d1: 3, d2: 10, d3: 6, d4: 2 } }] },
      { id: 2, question_zh: "您的具體症狀是什麼？（可選擇最接近的）", question_en: "What are your specific symptoms? (Choose the closest match)", sort_order: 2,
        options: [{ option_zh: "肩頸僵硬疼痛", option_en: "Stiff and painful neck/shoulders", scores: { d1: 8, d2: 3, d3: 2, d4: 4 } }, { option_zh: "腰背酸痛", option_en: "Lower back pain", scores: { d1: 8, d2: 2, d3: 2, d4: 4 } }, { option_zh: "頭痛、偏頭痛", option_en: "Headache, migraine", scores: { d1: 2, d2: 8, d3: 3, d4: 3 } }, { option_zh: "失眠、睡眠質素差", option_en: "Insomnia, poor sleep quality", scores: { d1: 1, d2: 8, d3: 4, d4: 2 } }, { option_zh: "手腳麻痺、刺痛", option_en: "Numbness or tingling in limbs", scores: { d1: 2, d2: 8, d3: 2, d4: 4 } }, { option_zh: "扭傷、拉傷", option_en: "Sprains, strains", scores: { d1: 4, d2: 3, d3: 2, d4: 8 } }, { option_zh: "關節疼痛、活動受限", option_en: "Joint pain, limited mobility", scores: { d1: 4, d2: 4, d3: 2, d4: 8 } }, { option_zh: "消化不良、胃脹", option_en: "Indigestion, bloating", scores: { d1: 1, d2: 3, d3: 8, d4: 1 } }, { option_zh: "月經不調、經痛", option_en: "Menstrual disorders, period pain", scores: { d1: 1, d2: 4, d3: 8, d4: 2 } }, { option_zh: "疲勞、體質虛弱", option_en: "Fatigue, weakness", scores: { d1: 2, d2: 3, d3: 8, d4: 2 } }, { option_zh: "其他 / 多種症狀", option_en: "Other / Multiple symptoms", scores: { d1: 3, d2: 3, d3: 8, d4: 3 } }] },
      { id: 3, question_zh: "您的症狀持續多長時間？", question_en: "How long have your symptoms persisted?", sort_order: 3,
        options: [{ option_zh: "剛發生（1-3天）", option_en: "Just occurred (1-3 days)", scores: { d1: 5, d2: 2, d3: 2, d4: 6 } }, { option_zh: "1週以內", option_en: "Within 1 week", scores: { d1: 4, d2: 3, d3: 3, d4: 5 } }, { option_zh: "1-4週", option_en: "1-4 weeks", scores: { d1: 4, d2: 4, d3: 3, d4: 4 } }, { option_zh: "1-3個月", option_en: "1-3 months", scores: { d1: 3, d2: 5, d3: 4, d4: 4 } }, { option_zh: "超過3個月（慢性）", option_en: "Over 3 months (chronic)", scores: { d1: 3, d2: 5, d3: 5, d4: 3 } }] },
      { id: 4, question_zh: "症狀的嚴重程度？", question_en: "How severe are your symptoms?", sort_order: 4,
        options: [{ option_zh: "輕微，不太影響日常", option_en: "Mild, doesn't affect daily life much", scores: { d1: 4, d2: 3, d3: 4, d4: 3 } }, { option_zh: "中等，有些不適", option_en: "Moderate, some discomfort", scores: { d1: 4, d2: 4, d3: 3, d4: 4 } }, { option_zh: "較嚴重，影響工作/生活", option_en: "Severe, affects work/life", scores: { d1: 3, d2: 5, d3: 3, d4: 5 } }, { option_zh: "非常嚴重，難以忍受", option_en: "Very severe, unbearable", scores: { d1: 2, d2: 5, d3: 4, d4: 5 } }] },
      { id: 5, question_zh: "您偏好的治療方式？", question_en: "What is your preferred treatment method?", sort_order: 5,
        options: [{ option_zh: "推拿按摩", option_en: "Tuina massage", scores: { d1: 8, d2: 0, d3: 2, d4: 4 } }, { option_zh: "針灸治療", option_en: "Acupuncture", scores: { d1: 0, d2: 8, d3: 3, d4: 4 } }, { option_zh: "推拿+針灸結合", option_en: "Tuina + Acupuncture combined", scores: { d1: 3, d2: 3, d3: 2, d4: 8 } }, { option_zh: "聽從醫師建議", option_en: "Follow doctor's recommendation", scores: { d1: 3, d2: 3, d3: 6, d4: 3 } }, { option_zh: "無特別偏好", option_en: "No preference", scores: { d1: 3, d2: 3, d3: 5, d4: 3 } }] }
    ];
    questions.forEach((q) => {
      db.run("INSERT INTO triage_questions (question_zh, question_en, sort_order, is_active) VALUES (?, ?, ?, 1)",
        [q.question_zh, q.question_en, q.sort_order], function (err) {
          if (err) { console.error("插入分流問題失敗:", err.message); return; }
          const qid = this.lastID;
          const oStmt = db.prepare("INSERT INTO triage_options (question_id, option_zh, option_en, scores, sort_order) VALUES (?, ?, ?, ?, ?)");
          q.options.forEach((opt, idx) => oStmt.run(qid, opt.option_zh, opt.option_en, JSON.stringify(opt.scores), idx + 1));
          oStmt.finalize();
        });
    });
    console.log("✅ 已建立醫療分流問題和選項");
  });
}

function initializeFaqs(db) {
  db.get("SELECT COUNT(*) as count FROM faqs", (err, row) => {
    if (err || cnt(row) > 0) return;
    const faqs = [
      { q: "診所的營業時間是？", a: "我們的營業時間為星期一至五 10:00-19:00；星期六 10:00-13:00（星期日及公眾假期休息）。", order: 1 },
      { q: "如何預約服務？", a: "您可以透過我們的線上預約系統選擇日期、時間和服務項目，或致電診所進行預約。", order: 2 },
      { q: "初診需要準備什麼？", a: "請攜帶身份證件，如有相關的醫療記錄或檢查報告也請一併帶來。", order: 3 },
      { q: "推拿療程需要多長時間？", a: "一般推拿療程約 30-60 分鐘，實際時間依個人狀況調整。", order: 4 },
      { q: "可以使用醫療保險嗎？", a: "我們接受多種醫療保險，建議您先向保險公司確認承保範圍。", order: 5 },
      { q: "如何取消或更改預約？", a: "請至少提前 24 小時聯絡診所進行更改，以便我們安排其他病人。", order: 6 },
      { q: "診所提供哪些服務？", a: "我們提供推拿、針灸、拔罐、刮痧等中醫治療服務。", order: 7 },
      { q: "停車方便嗎？", a: "診所本身不設時租停車場，但步行約 1 至 3 分鐘範圍內有多個大型商業大廈停車場可供停泊。", order: 8 }
    ];
    const stmt = db.prepare("INSERT INTO faqs (question, answer, display_order, is_active) VALUES (?, ?, ?, 1)");
    faqs.forEach((f) => stmt.run(f.q, f.a, f.order));
    stmt.finalize();
    console.log("✅ 已建立預設常見問題");
  });
}

// ---------- 初始化（同步返回 adapter；背景跑 connect/schema/seed） ----------
function initializeDatabase() {
  const pool = buildPool();
  const db = makeAdapter(pool);
  (async () => {
    try {
      await pool.query('SELECT 1');
      console.log('✅ 已連接到 Amazon RDS PostgreSQL');
      const schema = fs.readFileSync(path.join(__dirname, 'schema.pg.sql'), 'utf8');
      await pool.query(schema);              // 多語句（simple protocol）
      await runPgMigrations(pool);
      db._flush();                            // 開閘：排隊嘅查詢開始執行
      seedDatabase(db);                      // seeds 即時跑（ready）
    } catch (e) {
      console.error('❌ RDS PostgreSQL 初始化失敗：', e.message);
      db._fail(e);
    }
  })();
  return db;
}

module.exports = { initializeDatabase, hashPassword, verifyPassword };
