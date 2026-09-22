-- =====================================================================
-- Amazon RDS PostgreSQL — 全表結構（booking-aurora）
-- ---------------------------------------------------------------------
-- 用法：
--   1) psql "$DATABASE_URL" -f config/schema.pg.sql
--   2) 或交畀 config/db-pg.js 喺伺服器啟動時自動執行（CREATE TABLE IF NOT EXISTS）
--
-- 設計要點（相容現有 SQLite 代碼）：
--   * 主鍵用 SERIAL（代替 AUTOINCREMENT）
--   * created_at / updated_at 用 TEXT DEFAULT CURRENT_TIMESTAMP，保留字串語義
--     （現有 route 代碼對呢啲欄位做字串比較，唔轉做 TIMESTAMPTZ 以免 node-pg 返 Date）
--   * scores / leave_balance 等 JSON 欄用 TEXT 儲（app 自行 JSON.stringify/parse）
--   * 所有 ALTER 喺 db-pg.js 嘅 pg migrations 用 ADD COLUMN IF NOT EXISTS 補
-- =====================================================================

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  name_en TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  id_card TEXT,
  address TEXT,
  birth_date TEXT,
  emergency_contact TEXT,
  emergency_phone TEXT,
  role TEXT DEFAULT 'customer',
  profile_completed INTEGER DEFAULT 0,
  must_change_password INTEGER DEFAULT 0,
  username_last_changed TEXT,
  name_last_changed TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  is_active INTEGER DEFAULT 1,
  leave_balance TEXT,
  hire_date TEXT,
  hourly_rate REAL,
  basic_salary REAL,
  bank_account TEXT,
  avatar TEXT,
  employment_type TEXT DEFAULT 'full',
  member_no TEXT,
  hide_from_head INTEGER DEFAULT 0,
  family_plan TEXT,
  hide_medical_from_head INTEGER DEFAULT 0,
  hide_booking_from_head INTEGER DEFAULT 0,
  hide_profile_from_head INTEGER DEFAULT 0,
  membership_tier TEXT DEFAULT 'general',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_status TEXT DEFAULT 'none',
  insurance_covered INTEGER DEFAULT 0,
  family_head_id INTEGER,
  whatsapp_weather INTEGER DEFAULT 1,
  whatsapp_confirm INTEGER DEFAULT 1,
  whatsapp_health INTEGER DEFAULT 1,
  member_invoice_no TEXT,
  payment_method TEXT,
  staff_note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT,
  duration INTEGER,
  price INTEGER DEFAULT 0,
  requires_bed INTEGER DEFAULT 0,
  short_name TEXT
);

CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  customer_name TEXT,
  customer_name_en TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  customer_age INTEGER,
  service_id TEXT,
  doctor_name TEXT DEFAULT '張醫師',
  appointment_date TEXT,
  appointment_time TEXT,
  notes TEXT,
  status TEXT DEFAULT 'confirmed',
  doctor_user_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  end_time TEXT,
  lateness_minutes INTEGER DEFAULT 0,
  bed_type TEXT,
  bed_number INTEGER,
  is_free INTEGER DEFAULT 0,
  is_locked INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (doctor_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS time_slots (
  id SERIAL PRIMARY KEY,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  is_available INTEGER DEFAULT 1,
  max_capacity INTEGER DEFAULT 3,
  current_bookings INTEGER DEFAULT 0,
  notes TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date, time)
);

CREATE TABLE IF NOT EXISTS doctor_time_slots (
  id SERIAL PRIMARY KEY,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  doctor_id INTEGER NOT NULL,
  is_available INTEGER DEFAULT 1,
  status TEXT DEFAULT 'open',
  max_capacity INTEGER DEFAULT 1,
  notes TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date, time, doctor_id),
  FOREIGN KEY(doctor_id) REFERENCES doctors(id)
);

CREATE TABLE IF NOT EXISTS clinic_settings (
  id SERIAL PRIMARY KEY,
  setting_key TEXT UNIQUE NOT NULL,
  setting_value TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_settings (
  id SERIAL PRIMARY KEY,
  setting_key TEXT UNIQUE NOT NULL,
  setting_value TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS doctors (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  specialty TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  user_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS symptom_categories (
  id TEXT PRIMARY KEY,
  name_zh_hant TEXT NOT NULL,
  name_en TEXT NOT NULL,
  description_zh_hant TEXT,
  description_en TEXT,
  icon TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_questions (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  question_zh_hant TEXT NOT NULL,
  question_en TEXT NOT NULL,
  question_order INTEGER NOT NULL,
  question_type TEXT DEFAULT 'single',
  is_critical INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(category_id) REFERENCES symptom_categories(id)
);

CREATE TABLE IF NOT EXISTS ai_answer_options (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  option_zh_hant TEXT NOT NULL,
  option_en TEXT NOT NULL,
  severity_score INTEGER DEFAULT 0,
  next_question_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(question_id) REFERENCES ai_questions(id)
);

CREATE TABLE IF NOT EXISTS ai_recommendations (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  min_score INTEGER NOT NULL,
  max_score INTEGER NOT NULL,
  recommendation_zh_hant TEXT NOT NULL,
  recommendation_en TEXT NOT NULL,
  urgency_level TEXT NOT NULL,
  show_booking_button INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(category_id) REFERENCES symptom_categories(id)
);

CREATE TABLE IF NOT EXISTS ai_consultation_logs (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT,
  category_id TEXT,
  question_id TEXT,
  answer_option_id TEXT,
  score INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS triage_questions (
  id SERIAL PRIMARY KEY,
  question_zh TEXT NOT NULL,
  question_en TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS triage_options (
  id SERIAL PRIMARY KEY,
  question_id INTEGER NOT NULL,
  option_zh TEXT NOT NULL,
  option_en TEXT NOT NULL,
  scores TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(question_id) REFERENCES triage_questions(id)
);

CREATE TABLE IF NOT EXISTS faqs (
  id SERIAL PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  user_name TEXT,
  user_phone TEXT,
  category TEXT DEFAULT 'general',
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  admin_reply TEXT,
  replied_at TEXT,
  is_read INTEGER DEFAULT 0,
  user_read_reply INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT DEFAULT '診所資訊',
  content TEXT NOT NULL,
  publish_date TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS videos (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT DEFAULT 'youtube',
  youtube_id TEXT,
  file_path TEXT,
  description TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  user_name TEXT NOT NULL,
  rating INTEGER DEFAULT 5,
  service TEXT,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  avatar TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS forum_posts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  user_name TEXT NOT NULL,
  avatar TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT DEFAULT '中醫問題',
  reply_count INTEGER DEFAULT 0,
  is_pinned INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS forum_replies (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL,
  user_id INTEGER,
  user_name TEXT NOT NULL,
  avatar TEXT,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(post_id) REFERENCES forum_posts(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS customer_voices (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  user_name TEXT NOT NULL,
  avatar TEXT,
  rating INTEGER DEFAULT 5,
  visit_type TEXT,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS site_texts (
  id SERIAL PRIMARY KEY,
  text_key TEXT UNIQUE NOT NULL,
  text_value TEXT NOT NULL DEFAULT '',
  section TEXT DEFAULT '一般',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER,
  user_id INTEGER,
  amount REAL NOT NULL DEFAULT 100,
  payment_method TEXT DEFAULT 'credit_card',
  card_last_four TEXT,
  status TEXT DEFAULT 'pending',
  transaction_id TEXT,
  expires_at TEXT,
  paid_at TEXT,
  refunded_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  note TEXT,
  FOREIGN KEY(booking_id) REFERENCES bookings(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS pending_reservations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  service_id TEXT NOT NULL,
  doctor_id INTEGER,
  doctor_name TEXT,
  appointment_date TEXT NOT NULL,
  appointment_time TEXT NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  notes TEXT,
  amount REAL DEFAULT 100,
  status TEXT DEFAULT 'pending_payment',
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS reset_tokens (
  id SERIAL PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS password_reset_logs (
  id SERIAL PRIMARY KEY,
  ip_address TEXT,
  username TEXT,
  action TEXT NOT NULL,
  success INTEGER DEFAULT 0,
  details TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  attempt_time TEXT DEFAULT CURRENT_TIMESTAMP,
  success INTEGER DEFAULT 0,
  ip_address TEXT
);

CREATE TABLE IF NOT EXISTS verification_code_logs (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
  ip_address TEXT
);

CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name TEXT,
  role TEXT,
  attendance_date TEXT NOT NULL,
  clock_in TEXT,
  clock_out TEXT,
  work_minutes INTEGER DEFAULT 0,
  is_late INTEGER DEFAULT 0,
  is_early_leave INTEGER DEFAULT 0,
  is_absent INTEGER DEFAULT 0,
  note TEXT,
  source TEXT DEFAULT 'self',
  attendance_type TEXT DEFAULT 'full',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(attendance_date, user_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance(user_id);

CREATE TABLE IF NOT EXISTS leave_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name TEXT,
  role TEXT,
  leave_type TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending',
  reviewed_by INTEGER,
  reviewed_at TEXT,
  reviewed_note TEXT,
  leave_balance JSON,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_leave_user ON leave_requests(user_id);

CREATE TABLE IF NOT EXISTS hr_user_schedules (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  work_start TEXT DEFAULT '10:00',
  work_end TEXT DEFAULT '19:00',
  is_active INTEGER DEFAULT 1,
  is_weekly INTEGER DEFAULT 0,
  hours TEXT DEFAULT '{"1":"10:00-19:00","2":"10:00-19:00","3":"10:00-19:00","4":"10:00-19:00","5":"10:00-19:00","6":"10:00-13:00"}',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_schedule_user ON hr_user_schedules(user_id);

CREATE TABLE IF NOT EXISTS hr_schedule_exceptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  exc_date TEXT NOT NULL,
  work_start TEXT,
  work_end TEXT,
  is_off INTEGER DEFAULT 0,
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, exc_date)
);
CREATE INDEX IF NOT EXISTS idx_hr_exc_date ON hr_schedule_exceptions(exc_date);

CREATE TABLE IF NOT EXISTS hr_clinic_offdays (
  id SERIAL PRIMARY KEY,
  off_date TEXT UNIQUE NOT NULL,
  name TEXT,
  is_annual INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hr_documents (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  doc_type TEXT DEFAULT 'other',
  file_path TEXT NOT NULL,
  original_name TEXT,
  note TEXT,
  uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_hr_doc_user ON hr_documents(user_id);

CREATE TABLE IF NOT EXISTS hr_shift_rosters (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  roster_start TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
  approved_by INTEGER,
  approved_at TEXT,
  note TEXT,
  UNIQUE(user_id, roster_start),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_roster_user ON hr_shift_rosters(user_id);
CREATE INDEX IF NOT EXISTS idx_roster_start ON hr_shift_rosters(roster_start);

CREATE TABLE IF NOT EXISTS hr_shift_items (
  id SERIAL PRIMARY KEY,
  roster_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  shift_date TEXT NOT NULL,
  time_start TEXT,
  time_end TEXT,
  FOREIGN KEY (roster_id) REFERENCES hr_shift_rosters(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_shiftitem_user ON hr_shift_items(user_id);
CREATE INDEX IF NOT EXISTS idx_shiftitem_date ON hr_shift_items(shift_date);

CREATE TABLE IF NOT EXISTS medical_records (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER,
  user_id INTEGER NOT NULL,
  doctor_user_id INTEGER,
  record_date TEXT NOT NULL,
  diagnosis TEXT,
  treatment_plan TEXT,
  notes TEXT,
  audio_file_path TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (doctor_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS treatment_progress (
  id SERIAL PRIMARY KEY,
  medical_record_id INTEGER NOT NULL,
  progress_date TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  current_value TEXT NOT NULL,
  target_value TEXT,
  progress_score INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medical_record_id) REFERENCES medical_records(id)
);

CREATE TABLE IF NOT EXISTS medical_record_photos (
  id SERIAL PRIMARY KEY,
  medical_record_id INTEGER NOT NULL,
  photo_file_path TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medical_record_id) REFERENCES medical_records(id)
);

CREATE TABLE IF NOT EXISTS customer_health_profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  chronic_conditions TEXT,
  long_term_medications TEXT,
  medical_history TEXT,
  source TEXT NOT NULL DEFAULT 'customer',
  verified_by INTEGER,
  verified_at TEXT,
  updated_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_health_profile_user ON customer_health_profiles(user_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  tier TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'active',
  start_date TEXT,
  end_date TEXT,
  payment_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS family_links (
  id SERIAL PRIMARY KEY,
  parent_user_id INTEGER NOT NULL,
  child_user_id INTEGER NOT NULL,
  relation TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(parent_user_id, child_user_id),
  FOREIGN KEY (parent_user_id) REFERENCES users(id),
  FOREIGN KEY (child_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS account_links (
  id SERIAL PRIMARY KEY,
  user_a INTEGER NOT NULL,
  user_b INTEGER NOT NULL,
  relation TEXT NOT NULL,
  custom_relation TEXT,
  initiated_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_a, user_b),
  FOREIGN KEY (user_a) REFERENCES users(id),
  FOREIGN KEY (user_b) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS coupons (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  title TEXT,
  free_count INTEGER NOT NULL DEFAULT 1,
  price_hkd REAL DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_coupons (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  coupon_code TEXT NOT NULL,
  free_total INTEGER NOT NULL DEFAULT 0,
  free_used INTEGER NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'active',
  purchased_at TEXT,
  redeemed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS family_invoices (
  id SERIAL PRIMARY KEY,
  invoice_no TEXT UNIQUE NOT NULL,
  family_head_id INTEGER NOT NULL,
  plan TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(family_head_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS exceptions (
  id SERIAL PRIMARY KEY,
  doctor_user_id INTEGER,
  exception_date TEXT NOT NULL,
  name TEXT,
  type TEXT NOT NULL DEFAULT 'red_day',
  time_open TEXT,
  time_close TEXT,
  reason TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  notified INTEGER DEFAULT 0,
  notified_at TEXT,
  reassigned_to INTEGER REFERENCES users(id),
  status TEXT DEFAULT 'pending',
  approved_by INTEGER,
  approved_at TEXT,
  notify_customer INTEGER DEFAULT 1,
  FOREIGN KEY (doctor_user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_exceptions_date ON exceptions(exception_date);

CREATE TABLE IF NOT EXISTS cases (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  condition_name TEXT,
  treatment TEXT,
  summary TEXT,
  duration TEXT,
  outcome TEXT,
  anonymous_name TEXT,
  is_published INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS income_imports (
  id SERIAL PRIMARY KEY,
  record_date TEXT NOT NULL,
  amount REAL NOT NULL,
  service_name TEXT,
  customer_name TEXT,
  source TEXT DEFAULT 'excel',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS income_adjustments (
  id SERIAL PRIMARY KEY,
  adjustment_date TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  type TEXT DEFAULT 'service',
  customer TEXT,
  service_name TEXT,
  payment_method TEXT,
  doctor_name TEXT,
  note TEXT,
  period_type TEXT DEFAULT 'day',
  created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
