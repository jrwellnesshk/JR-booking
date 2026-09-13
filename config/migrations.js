
const sqlite3 = require('sqlite3').verbose();

function runMigrations(db) {
  db.serialize(() => {
    // ==================================================================
    // 🕘 HR 考勤表 (Attendance)
    // 每位 staff/doctor 每日以 (attendance_date, user_id) 唯一定義一次出勤。
    // clock_in  / clock_out 儲存 "HH:MM" 時間；late/early_leave/absent 自動標記；
    // work_minutes 以下班打卡時間減上班打卡時間計（跨日唔支援，深夜收工視為當日）。
    // 管理員可手動補打卡 (source='manual') 或修改記錄。
    // ==================================================================
    db.run(`
      CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(attendance_date, user_id)
      )
    `, (err) => {
      if (err) console.error("創建 attendance 表失敗:", err.message);
      else console.log("✅ attendance 考勤表已準備就緒");
    });

    // 為 attendance 表建立索引
    db.run("CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(attendance_date)", (err) => {
      if (err) console.error("建立 attendance 索引失敗:", err.message);
    });
    db.run("CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance(user_id)", (err) => {
      if (err) console.error("建立 attendance 索引失敗:", err.message);
    });

    // ==================================================================
    // 🏖️ 請假申請表 (Leave Requests)
    // 員工/醫生遞交請假申請 → 管理員審批(pending/approved/rejected)。
    // 類別：annual(年假)/sick(病假)/personal(事假)/statutory(勞工假期補假)/personal_other(個人原因)
    // 批準後日期唔會當缺席 (attendance 會標記為請假)。
    // ==================================================================
    db.run(`
      CREATE TABLE IF NOT EXISTS leave_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      )
    `, (err) => {
      if (err) console.error("創建 leave_requests 表失敗:", err.message);
      else console.log("✅ leave_requests 請假表已準備就緒");
    });

    db.run("CREATE INDEX IF NOT EXISTS idx_leave_user ON leave_requests(user_id)", (err) => {
      if (err) console.error("建立 leave_requests 索引失敗:", err.message);
    });

    // HR 名冊：users 表加入 is_active 欄位（1=在職可用，0=停用唔准打卡）
    db.all("PRAGMA table_info(users)", (aErr, aCols) => {
      if (aErr || !aCols) return;
      if (!aCols.some(c => c.name === 'is_active')) {
        db.run("ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1", (e) => {
          if (e) console.error("加入 users.is_active 欄位失敗:", e.message);
          else console.log("✅ users.is_active 已就緒（HR 名冊停用）");
        });
      }
      // HR 假額：存 JSON，例 {"annual":12,"sick":12,"personal":2,"statutory":-1,"personal_other":-1}
      if (!aCols.some(c => c.name === 'leave_balance')) {
        db.run("ALTER TABLE users ADD COLUMN leave_balance TEXT", (e) => {
          if (e) console.error("加入 users.leave_balance 欄位失敗:", e.message);
          else console.log("✅ users.leave_balance 已就緒（HR 假額）");
        });
      }
      // ================= 階段一：詳細 HR 個人檔案（出糧/私隱） =================
      // 注意：users 已有 id_card / address / birth_date / emergency_contact / emergency_phone，
      // 故此處只加真正新增嘅欄位，其餘重用現有 column。
      const HR_COLS = {
        hire_date: "TEXT",       // 入職日期
        hourly_rate: "REAL",     // 時薪 (HKD)
        basic_salary: "REAL",    // 月薪（可選，優先於時薪）
        bank_account: "TEXT",    // 銀行戶口
      };
      Object.keys(HR_COLS).forEach((col) => {
        if (!aCols.some(c => c.name === col)) {
          db.run(`ALTER TABLE users ADD COLUMN ${col} ${HR_COLS[col]}`, (e) => {
            if (e) console.error(`加入 users.${col} 欄位失敗:`, e.message);
            else console.log(`✅ users.${col} 已就緒`);
          });
        }
      });
      // attendance 加「出勤類型」：full=全日 / half=半日 / fieldwork=外勤 / training=培訓（階段一③）
      db.all("PRAGMA table_info(attendance)", (atErr, atCols) => {
        if (!atErr && atCols && !atCols.some(c => c.name === 'attendance_type')) {
          db.run("ALTER TABLE attendance ADD COLUMN attendance_type TEXT DEFAULT 'full'", (e) => {
            if (e) console.error("加入 attendance.attendance_type 欄位失敗:", e.message);
            else console.log("✅ attendance.attendance_type 已就緒（出勤類型）");
          });
        }
      });
    });

    // ==================================================================
    // 🗓️ 階段一：排班 / 營業日曆
    // 員工個人預設返工時間 + 逐日例外覆寫 + 診所休診日/公眾假期
    // ==================================================================
    db.run(`
      CREATE TABLE IF NOT EXISTS hr_user_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        work_start TEXT DEFAULT '10:00',
        work_end TEXT DEFAULT '19:00',
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `, (err) => {
      if (err) console.error("創建 hr_user_schedules 表失敗:", err.message);
      else console.log("✅ hr_user_schedules 排班表已就緒");
    });
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_schedule_user ON hr_user_schedules(user_id)", (err) => {
      if (err) console.error("建立 hr_schedule_user 索引失敗:", err.message);
    });
    // 每週更表模式（階段三）：is_weekly=1 時用 hours JSON（key=星期幾 getDay() 0-6，
    // val="HH:MM-HH:MM"，冇列出=嗰日唔返工）。預設一至五 10:00-19:00、六 10:00-13:00。
    db.all("PRAGMA table_info(hr_user_schedules)", (wsErr, wsCols) => {
      if (wsErr || !wsCols) return;
      if (!wsCols.some(c => c.name === 'is_weekly')) {
        db.run("ALTER TABLE hr_user_schedules ADD COLUMN is_weekly INTEGER DEFAULT 0", (e) => {
          if (e && !/duplicate column/i.test(e.message)) console.error("加入 is_weekly 失敗:", e.message);
          else console.log("✅ hr_user_schedules.is_weekly 已就緒（每週更表模式）");
        });
      }
      if (!wsCols.some(c => c.name === 'hours')) {
        // 每週時段 JSON，key=星期幾(getDay 0-6)，val="HH:MM-HH:MM"
        db.run(
          `ALTER TABLE hr_user_schedules ADD COLUMN hours TEXT DEFAULT '{"1":"10:00-19:00","2":"10:00-19:00","3":"10:00-19:00","4":"10:00-19:00","5":"10:00-19:00","6":"10:00-13:00"}'`,
          (e) => {
            if (e && !/duplicate column/i.test(e.message)) console.error("加入 hours 失敗:", e.message);
            else console.log("✅ hr_user_schedules.hours 已就緒（每週時段）");
          }
        );
      }
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS hr_schedule_exceptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        exc_date TEXT NOT NULL,
        work_start TEXT,
        work_end TEXT,
        is_off INTEGER DEFAULT 0,
        note TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        UNIQUE(user_id, exc_date)
      )
    `, (err) => {
      if (err) console.error("創建 hr_schedule_exceptions 表失敗:", err.message);
      else console.log("✅ hr_schedule_exceptions 排班例外已就緒");
    });
    db.run("CREATE INDEX IF NOT EXISTS idx_hr_exc_date ON hr_schedule_exceptions(exc_date)", (err) => {
      if (err) console.error("建立 hr_exc_date 索引失敗:", err.message);
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS hr_clinic_offdays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        off_date TEXT UNIQUE NOT NULL,
        name TEXT,
        is_annual INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      )
    `, (err) => {
      if (err) console.error("創建 hr_clinic_offdays 表失敗:", err.message);
      else console.log("✅ hr_clinic_offdays 診所休診/公眾假期已就緒");
    });

    // ==================================================================
    // 📄 階段三：員工文件管理 (hr_documents)
    // 員工/醫生上傳自己嘅文件（合約/證書/醫療證明/其他），管理員可視。
    // file_path 存相對於 server.js mount 上傳目錄嘅靜態路徑。
    // ==================================================================
    db.run(`
      CREATE TABLE IF NOT EXISTS hr_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        doc_type TEXT DEFAULT 'other',
        file_path TEXT NOT NULL,
        original_name TEXT,
        note TEXT,
        uploaded_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `, (err) => {
      if (err) console.error("創建 hr_documents 表失敗:", err.message);
      else console.log("✅ hr_documents 文件表已就緒");
    });
    db.run("CREATE INDEX IF NOT EXISTS idx_hr_doc_user ON hr_documents(user_id)", (err) => {
      if (err) console.error("建立 hr_documents 索引失敗:", err.message);
    });

    // ==================================================================
    // 🕐 階段三：全職 / 兼職 (employment_type) + 兼職報更
    // employment_type：'full'（全職，用每週更表）/ 'part'（兼職，自己揀更後管理員審批）
    // ==================================================================
    db.all("PRAGMA table_info(users)", (etErr, etCols) => {
      if (!etErr && etCols && !etCols.some(c => c.name === 'employment_type')) {
        db.run("ALTER TABLE users ADD COLUMN employment_type TEXT DEFAULT 'full'", (e) => {
          if (e && !/duplicate column/i.test(e.message)) console.error("加入 users.employment_type 失敗:", e.message);
          else console.log("✅ users.employment_type 已就緒（full/part）");
        });
      }
    });

    // 兼職報更表：一份報更 = 某兼職同事為某工作週提交嘅更表，管理員審批。
    // roster_start 記錄該工作週嘅星期一日期（作唯一定義一週）。
    db.run(`
      CREATE TABLE IF NOT EXISTS hr_shift_rosters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        roster_start TEXT NOT NULL,           -- 工作週星期一
        status TEXT DEFAULT 'pending',        -- pending / approved / rejected
        submitted_at TEXT DEFAULT (datetime('now','localtime')),
        approved_by INTEGER,
        approved_at TEXT,
        note TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, roster_start)
      )
    `, (err) => {
      if (err) console.error("創建 hr_shift_rosters 表失敗:", err.message);
      else console.log("✅ hr_shift_rosters 兼職報更表已就緒");
    });
    db.run("CREATE INDEX IF NOT EXISTS idx_roster_user ON hr_shift_rosters(user_id)", (err) => {
      if (err) console.error("建立 hr_shift_rosters 索引失敗:", err.message);
    });
    db.run("CREATE INDEX IF NOT EXISTS idx_roster_start ON hr_shift_rosters(roster_start)", (err) => {
      if (err) console.error("建立 hr_shift_rosters 索引失敗:", err.message);
    });

    // 兼職報更細項：每項 = 某一日返工嘅時段（來自兼職同事揀嘅更 或 管理員代排）。
    // 管理員審批後，已批細項會作為當日應返工時間窗（供打卡/出糧）。
    db.run(`
      CREATE TABLE IF NOT EXISTS hr_shift_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        roster_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        shift_date TEXT NOT NULL,
        time_start TEXT,
        time_end TEXT,
        FOREIGN KEY (roster_id) REFERENCES hr_shift_rosters(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `, (err) => {
      if (err) console.error("創建 hr_shift_items 表失敗:", err.message);
      else console.log("✅ hr_shift_items 兼職報更細項已就緒");
    });
    db.run("CREATE INDEX IF NOT EXISTS idx_shiftitem_user ON hr_shift_items(user_id)", (err) => {
      if (err) console.error("建立 hr_shift_items 索引失敗:", err.message);
    });
    db.run("CREATE INDEX IF NOT EXISTS idx_shiftitem_date ON hr_shift_items(shift_date)", (err) => {
      if (err) console.error("建立 hr_shift_items 索引失敗:", err.message);
    });

    // 創建 medical_records 表
    db.run(`
      CREATE TABLE IF NOT EXISTS medical_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      )
    `, (err) => {
      if (err) console.error("創建 medical_records 表失敗:", err.message);
      else console.log("✅ medical_records 表已準備就緒");
    });

    // 創建 treatment_progress 表
    db.run(`
      CREATE TABLE IF NOT EXISTS treatment_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      )
    `, (err) => {
      if (err) console.error("創建 treatment_progress 表失敗:", err.message);
      else console.log("✅ treatment_progress 表已準備就緒");
    });

    // 創建 medical_record_photos 表
    db.run(`
      CREATE TABLE IF NOT EXISTS medical_record_photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        medical_record_id INTEGER NOT NULL,
        photo_file_path TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (medical_record_id) REFERENCES medical_records(id)
      )
    `, (err) => {
      if (err) console.error("創建 medical_record_photos 表失敗:", err.message);
      else console.log("✅ medical_record_photos 表已準備就緒");
    });

    // 創建 customer_health_profiles 表（客人健康檔案：長期病患/長期用藥/過往病歷，客人自填）
    db.run(`
      CREATE TABLE IF NOT EXISTS customer_health_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        chronic_conditions TEXT,
        long_term_medications TEXT,
        medical_history TEXT,
        source TEXT NOT NULL DEFAULT 'customer',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `, (err) => {
      if (err) console.error("創建 customer_health_profiles 表失敗:", err.message);
      else console.log("✅ customer_health_profiles 表已準備就緒");
    });
    db.run("CREATE INDEX IF NOT EXISTS idx_health_profile_user ON customer_health_profiles(user_id)", (err) => {
      if (err) console.error("建立 customer_health_profiles 索引失敗:", err.message);
    });

    // Phase 2：醫師確認欄位（舊資料庫自動升級，重複啟動唔會報錯）
    db.all("PRAGMA table_info(customer_health_profiles)", (e, cols) => {
      if (e) { console.error("讀取 customer_health_profiles 結構失敗:", e.message); return; }
      const existing = new Set((cols || []).map(c => c.name));
      [['verified_by', 'INTEGER'], ['verified_at', 'TEXT'], ['updated_by', 'INTEGER']].forEach(([col, type]) => {
        if (existing.has(col)) return;
        db.run(`ALTER TABLE customer_health_profiles ADD COLUMN ${col} ${type}`, (err2) => {
          if (err2) console.error(`新增 customer_health_profiles.${col} 欄位失敗:`, err2.message);
        });
      });
    });

    // 為 bookings 表添加 is_locked 欄位
    db.all("PRAGMA table_info(bookings)", (err, columns) => {
      if (!err && columns && columns.length > 0) {
        const hasIsLocked = columns.some(col => col.name === 'is_locked');
        if (!hasIsLocked) {
          console.log("🔄 正在為 bookings 表添加 is_locked 欄位...");
          db.run("ALTER TABLE bookings ADD COLUMN is_locked INTEGER DEFAULT 0", (err) => {
            if (err) console.error("添加 bookings.is_locked 欄位失敗:", err.message);
            else console.log("✅ 已添加 bookings.is_locked 欄位");
          });
        }
      }
    });

    // ==================================================================
    // 會員 / 家庭帳戶 / 通知偏好 / 保險 / 異常 / 案例庫 / 收入匯入 結構
    // ==================================================================

    // 會員訂閱表 (Membership Subscription)
    db.run(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        tier TEXT NOT NULL DEFAULT 'general',   -- general | premium | family
        status TEXT NOT NULL DEFAULT 'active',  -- active | expired | cancelled
        start_date TEXT,
        end_date TEXT,
        payment_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `, (err) => {
      if (err) console.error("創建 subscriptions 表失敗:", err.message);
      else console.log("✅ subscriptions 表已準備就緒");
    });

    // 家庭帳戶關係表 (Family Account: parent → child)
    db.run(`
      CREATE TABLE IF NOT EXISTS family_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_user_id INTEGER NOT NULL,
        child_user_id INTEGER NOT NULL,
        relation TEXT,                          -- parent / spouse / guardian
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(parent_user_id, child_user_id),
        FOREIGN KEY (parent_user_id) REFERENCES users(id),
        FOREIGN KEY (child_user_id) REFERENCES users(id)
      )
    `, (err) => {
      if (err) console.error("創建 family_links 表失敗:", err.message);
      else console.log("✅ family_links 表已準備就緒");
    });

    // 通用帳戶連結表（親戚／同輩／朋友，客人自助連結，與 family_links 家庭訂閱分開）
    // user_a / user_b 為無序 pair（細 id 存 user_a），relation 為關係標籤，custom_relation 為「其他」自填
    db.run(`
      CREATE TABLE IF NOT EXISTS account_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_a INTEGER NOT NULL,
        user_b INTEGER NOT NULL,
        relation TEXT NOT NULL,
        custom_relation TEXT,
        initiated_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_a, user_b),
        FOREIGN KEY (user_a) REFERENCES users(id),
        FOREIGN KEY (user_b) REFERENCES users(id)
      )
    `, (err) => {
      if (err) console.error("創建 account_links 表失敗:", err.message);
      else console.log("✅ account_links 表已準備就緒");
    });

    // ==================================================================
    // 🎟️ 優惠券 / 家庭單號 / 會員編號 / 時段狀態（2026-09 新功能）
    // ==================================================================
    // 優惠券定義表（管理員建立，每張 code 對應 N 次免費診症）
    db.run(`
      CREATE TABLE IF NOT EXISTS coupons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        title TEXT,
        free_count INTEGER NOT NULL DEFAULT 1,
        price_hkd REAL DEFAULT 0,
        active INTEGER DEFAULT 1,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => { if (err) console.error("創建 coupons 表失敗:", err.message); else console.log("✅ coupons 表已準備就緒"); });

    // 客戶已購/已啟用優惠券（free_total 總次數，free_used 已用次數）
    db.run(`
      CREATE TABLE IF NOT EXISTS user_coupons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        coupon_code TEXT NOT NULL,
        free_total INTEGER NOT NULL DEFAULT 0,
        free_used INTEGER NOT NULL DEFAULT 0,
        status TEXT DEFAULT 'active',
        purchased_at TEXT,
        redeemed_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `, (err) => { if (err) console.error("創建 user_coupons 表失敗:", err.message); else console.log("✅ user_coupons 表已準備就緒"); });

    // 家庭單號（每個主帳戶一張，跟死全家所有帳戶）
    db.run(`
      CREATE TABLE IF NOT EXISTS family_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_no TEXT UNIQUE NOT NULL,
        family_head_id INTEGER NOT NULL,
        plan TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(family_head_id) REFERENCES users(id)
      )
    `, (err) => { if (err) console.error("創建 family_invoices 表失敗:", err.message); else console.log("✅ family_invoices 表已準備就緒"); });

    // users 欄位：會員編號 / 家庭私隱開關 / 家庭計劃
    db.all("PRAGMA table_info(users)", (err, cols) => {
      if (err || !cols) return;
      const uAdd = [
        { name: 'member_no', ddl: "ALTER TABLE users ADD COLUMN member_no TEXT" },
        { name: 'hide_from_head', ddl: "ALTER TABLE users ADD COLUMN hide_from_head INTEGER DEFAULT 0" },
        { name: 'family_plan', ddl: "ALTER TABLE users ADD COLUMN family_plan TEXT" }
      ];
      uAdd.forEach((c) => {
        if (!cols.some(col => col.name === c.name)) {
          db.run(c.ddl, (e) => {
            if (e) console.error(`添加 users.${c.name} 失敗:`, e.message);
            else console.log(`✅ 已添加 users.${c.name} 欄位`);
          });
        }
      });
      // 回填：會員編號 = 電話（客戶 / 家庭成員）
      db.run("UPDATE users SET member_no = phone WHERE (member_no IS NULL OR member_no='') AND phone IS NOT NULL AND phone<>''", (e) => {
        if (!e) console.log("✅ 已回填 member_no = phone");
      });
    });

    // doctor_time_slots.status 回填（open=開放 / rest=休息 / waiting=候診 / blank=空白關閉）
    db.all("PRAGMA table_info(doctor_time_slots)", (err, cols) => {
      if (err || !cols) return;
      if (!cols.some(col => col.name === 'status')) {
        db.run("ALTER TABLE doctor_time_slots ADD COLUMN status TEXT DEFAULT 'open'", (e) => {
          if (e) console.error("添加 doctor_time_slots.status 失敗:", e.message);
          else console.log("✅ 已添加 doctor_time_slots.status 欄位");
        });
      }
      db.run("UPDATE doctor_time_slots SET status='open' WHERE status IS NULL AND is_available=1", () => {});
      db.run("UPDATE doctor_time_slots SET status='blank' WHERE status IS NULL AND (is_available=0 OR is_available IS NULL)", () => {});
    });

    // 預約時段改 15 分鐘（slot_interval 預設）
    db.run("UPDATE clinic_settings SET setting_value='15' WHERE setting_key='slot_interval'", (e) => {
      if (!e) console.log("✅ slot_interval 已設為 15 分鐘");
    });

    // 異常管理表 (紅字日 / 全日照停 / 特別營業時段)
    db.run(`
      CREATE TABLE IF NOT EXISTS exceptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doctor_user_id INTEGER,
        exception_date TEXT NOT NULL UNIQUE,
        name TEXT,
        type TEXT NOT NULL DEFAULT 'red_day',
        time_open TEXT,
        time_close TEXT,
        reason TEXT,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (doctor_user_id) REFERENCES users(id)
      )
    `, (err) => {
      if (err) console.error("創建 exceptions 表失敗:", err.message);
      else console.log("✅ exceptions 表已準備就緒");
    });

    // 遷移：若 exceptions 表為舊結構（缺 name/time_open/time_close），重建以統一欄位
    db.all("PRAGMA table_info(exceptions)", (err, cols) => {
      if (err || !cols || cols.length === 0) return;
      const hasName = cols.some(c => c.name === 'name');
      const hasTimeOpen = cols.some(c => c.name === 'time_open');
      if (!hasName || !hasTimeOpen) {
        console.log("🔄 正在重建 exceptions 表以統一欄位結構...");
        db.run("DROP TABLE exceptions", (e) => {
          if (e) {
            console.error("重建 exceptions 失敗:", e.message);
            return;
          }
          db.run(`
            CREATE TABLE exceptions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              doctor_user_id INTEGER,
              exception_date TEXT NOT NULL UNIQUE,
              name TEXT,
              type TEXT NOT NULL DEFAULT 'red_day',
              time_open TEXT,
              time_close TEXT,
              reason TEXT,
              created_by INTEGER,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (doctor_user_id) REFERENCES users(id)
            )
          `, (e2) => {
            if (e2) console.error("重建 exceptions 表失敗:", e2.message);
            else console.log("✅ exceptions 表已重建（含 UNIQUE(exception_date)）");
          });
        });
      }
    });

    // 遷移：移除 exceptions.exception_date 的 UNIQUE 約束（支援同日多位醫師請假 + 診所層級異常並存）
    db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='exceptions'", (err, row) => {
      if (err || !row || !row.sql) return;
      if (/exception_date\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(row.sql)) {
        console.log("🔄 正在重建 exceptions 表（移除 UNIQUE(exception_date)，支援同日多筆異常）...");
        db.serialize(() => {
          db.run(`
            CREATE TABLE exceptions_v2 (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              doctor_user_id INTEGER,
              exception_date TEXT NOT NULL,
              name TEXT,
              type TEXT NOT NULL DEFAULT 'red_day',
              time_open TEXT,
              time_close TEXT,
              reason TEXT,
              created_by INTEGER,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (doctor_user_id) REFERENCES users(id)
            )
          `, (e1) => {
            if (e1) { console.error("建立 exceptions_v2 失敗:", e1.message); return; }
            db.run("INSERT INTO exceptions_v2 SELECT id, doctor_user_id, exception_date, name, type, time_open, time_close, reason, created_by, created_at FROM exceptions", (e2) => {
              if (e2) { console.error("搬移 exceptions 資料失敗:", e2.message); return; }
              db.run("DROP TABLE exceptions", (e3) => {
                if (e3) { console.error("刪除舊 exceptions 失敗:", e3.message); return; }
                db.run("ALTER TABLE exceptions_v2 RENAME TO exceptions", (e4) => {
                  if (e4) console.error("重新命名 exceptions 失敗:", e4.message);
                  else {
                    db.run("CREATE INDEX IF NOT EXISTS idx_exceptions_date ON exceptions(exception_date)");
                    console.log("✅ exceptions 表已升級（同日可含多位醫師請假）");
                  }
                });
              });
            });
          });
        });
      }
    });

    // 遷移：exceptions 加請假審批 / 通知 / 補位欄位
    db.all("PRAGMA table_info(exceptions)", (err, cols) => {
      if (err || !cols) return;
      const names = cols.map(c => c.name);
      const adds = [];
      if (!names.includes('notified')) adds.push("ALTER TABLE exceptions ADD COLUMN notified INTEGER DEFAULT 0");
      if (!names.includes('notified_at')) adds.push("ALTER TABLE exceptions ADD COLUMN notified_at TEXT");
      if (!names.includes('reassigned_to')) adds.push("ALTER TABLE exceptions ADD COLUMN reassigned_to INTEGER REFERENCES users(id)");
      if (!names.includes('status')) adds.push("ALTER TABLE exceptions ADD COLUMN status TEXT DEFAULT 'pending'");
      if (!names.includes('approved_by')) adds.push("ALTER TABLE exceptions ADD COLUMN approved_by INTEGER");
      if (!names.includes('approved_at')) adds.push("ALTER TABLE exceptions ADD COLUMN approved_at TEXT");
      if (!names.includes('notify_customer')) adds.push("ALTER TABLE exceptions ADD COLUMN notify_customer INTEGER DEFAULT 1");
      if (!adds.length) return;
      db.serialize(() => {
        adds.forEach(sql => db.run(sql, (e) => { if (e) console.error("exceptions 加欄失敗:", e.message); }));
        console.log("✅ exceptions 表已加 notified / notified_at / reassigned_to / status / approved_by / approved_at / notify_customer 欄位");
      });
    });

    // 診所預設設定（冇先建立）：營業時間 10:00-19:00 / 通知開關 / 公眾註冊閘門
    const defaultSettings = [
      ['morning_start', '10:00'],
      ['morning_end', '14:00'],
      ['afternoon_start', '14:00'],
      ['afternoon_end', '19:00'],
      ['slot_interval', '15'],
      ['sms_notification_enabled', 'false'],
      ['email_notification_enabled', 'false'],
      ['whatsapp_notification_enabled', 'true'],
      ['allow_public_registration', 'false'],
      ['vip_rooms', '5'],
      ['vip_bed_names', '[]']
    ];
    defaultSettings.forEach(([key, value]) => {
      db.get("SELECT id FROM clinic_settings WHERE setting_key=?", [key], (e, row) => {
        if (e || row) return;
        db.run("INSERT OR IGNORE INTO clinic_settings (setting_key, setting_value) VALUES (?, ?)", [key, value], (e2) => {
          if (e2) console.error(`初始化 ${key} 失敗:`, e2.message);
          else console.log(`✅ 已初始化 clinic_settings.${key} = ${value}`);
        });
      });
    });

    // 成功案例庫 (Case Library, 匿名化)
    db.run(`
      CREATE TABLE IF NOT EXISTS cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      )
    `, (err) => {
      if (err) console.error("創建 cases 表失敗:", err.message);
      else console.log("✅ cases 表已準備就緒");
    });

    // 收入報表匯入表 (Excel 匯入)
    db.run(`
      CREATE TABLE IF NOT EXISTS income_imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        record_date TEXT NOT NULL,
        amount REAL NOT NULL,
        service_name TEXT,
        customer_name TEXT,
        source TEXT DEFAULT 'excel',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error("創建 income_imports 表失敗:", err.message);
      else console.log("✅ income_imports 表已準備就緒");
    });

    // 收入調整記錄表（Excel 匯入 / 手動調整，含完整欄位）
    db.run(`
      CREATE TABLE IF NOT EXISTS income_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        adjustment_date TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        type TEXT DEFAULT 'service',
        customer TEXT,
        service_name TEXT,
        payment_method TEXT,
        doctor_name TEXT,
        note TEXT,
        created_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error("創建 income_adjustments 表失敗:", err.message);
      else console.log("✅ income_adjustments 表已準備就緒");
    });

    // 🆕 period_type：'day'＝每日 Excel；'month'＝每月 Excel（adjustment_date 存該月一號）
    db.all("PRAGMA table_info(income_adjustments)", [], (pErr, cols) => {
      if (pErr) return console.error("檢查 income_adjustments 欄位失敗:", pErr.message);
      if (!(cols || []).some(c => c.name === 'period_type')) {
        db.run("ALTER TABLE income_adjustments ADD COLUMN period_type TEXT DEFAULT 'day'", (aErr) => {
          if (aErr && !/duplicate column/i.test(aErr.message)) console.error("加入 period_type 失敗:", aErr.message);
          else console.log("✅ income_adjustments.period_type 已就緒");
        });
      }
    });

    // 📝 客戶員工備註欄
    db.all("PRAGMA table_info(users)", [], (pErr2, uCols) => {
      if (pErr2) return;
      if (!(uCols || []).some(c => c.name === 'staff_note')) {
        db.run("ALTER TABLE users ADD COLUMN staff_note TEXT DEFAULT ''", (aErr2) => {
          if (aErr2 && !/duplicate column/i.test(aErr2.message)) console.error("加入 staff_note 失敗:", aErr2.message);
          else console.log("✅ users.staff_note 已就緒");
        });
      }
    });

    // users 欄位擴展：會員層級 / 保險 / 家庭 / WhatsApp 偏好
    const userCols = [
      { name: 'membership_tier', ddl: "ALTER TABLE users ADD COLUMN membership_tier TEXT DEFAULT 'general'" },
      { name: 'stripe_customer_id', ddl: "ALTER TABLE users ADD COLUMN stripe_customer_id TEXT" },
      { name: 'stripe_subscription_id', ddl: "ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT" },
      { name: 'subscription_status', ddl: "ALTER TABLE users ADD COLUMN subscription_status TEXT DEFAULT 'none'" },
      { name: 'insurance_covered', ddl: "ALTER TABLE users ADD COLUMN insurance_covered INTEGER DEFAULT 0" },
      { name: 'family_head_id', ddl: "ALTER TABLE users ADD COLUMN family_head_id INTEGER" },
      { name: 'whatsapp_weather', ddl: "ALTER TABLE users ADD COLUMN whatsapp_weather INTEGER DEFAULT 1" },
      { name: 'whatsapp_confirm', ddl: "ALTER TABLE users ADD COLUMN whatsapp_confirm INTEGER DEFAULT 1" },
      { name: 'whatsapp_health', ddl: "ALTER TABLE users ADD COLUMN whatsapp_health INTEGER DEFAULT 1" },
      { name: 'member_invoice_no', ddl: "ALTER TABLE users ADD COLUMN member_invoice_no TEXT" },
      { name: 'payment_method', ddl: "ALTER TABLE users ADD COLUMN payment_method TEXT" }
    ];
    db.all("PRAGMA table_info(users)", (err, cols) => {
      if (err || !cols) return;
      userCols.forEach((c) => {
        if (!cols.some(col => col.name === c.name)) {
          db.run(c.ddl, (e) => {
            if (e) console.error(`添加 users.${c.name} 欄位失敗:`, e.message);
            else console.log(`✅ 已添加 users.${c.name} 欄位`);
          });
        }
      });
    });

    // payments 欄位擴展：管理員備註（離線收款記錄用）
    db.all("PRAGMA table_info(payments)", (err, cols) => {
      if (err || !cols) return;
      const pCols = [
        { name: 'note', ddl: "ALTER TABLE payments ADD COLUMN note TEXT" }
      ];
      pCols.forEach((c) => {
        if (!cols.some(col => col.name === c.name)) {
          db.run(c.ddl, (e) => {
            if (e) console.error(`添加 payments.${c.name} 欄位失敗:`, e.message);
            else console.log(`✅ 已添加 payments.${c.name} 欄位`);
          });
        }
      });
    });

    // bookings 欄位擴展：結束時間 / 遲到分鐘 / 床位類型
    db.all("PRAGMA table_info(bookings)", (err, cols) => {
      if (err || !cols) return;
      const bAdd = (name, ddl) => {
        if (!cols.some(col => col.name === name)) {
          db.run(ddl, (e) => {
            if (e) console.error(`添加 bookings.${name} 欄位失敗:`, e.message);
            else console.log(`✅ 已添加 bookings.${name} 欄位`);
          });
        }
      };
      bAdd('end_time', "ALTER TABLE bookings ADD COLUMN end_time TEXT");
      bAdd('lateness_minutes', "ALTER TABLE bookings ADD COLUMN lateness_minutes INTEGER DEFAULT 0");
      bAdd('bed_type', "ALTER TABLE bookings ADD COLUMN bed_type TEXT");
      bAdd('bed_number', "ALTER TABLE bookings ADD COLUMN bed_number INTEGER");
      bAdd('customer_age', "ALTER TABLE bookings ADD COLUMN customer_age INTEGER");
      bAdd('customer_name_en', "ALTER TABLE bookings ADD COLUMN customer_name_en TEXT");
      bAdd('is_free', "ALTER TABLE bookings ADD COLUMN is_free INTEGER DEFAULT 0");
    });

    // services 欄位擴展：床位需求（S6 一定要等 requires_bed 欄位存在先插入，否則 fresh DB 會 race 撞「no column named requires_bed」）
    const upsertS6Service = () => {
      db.run(`
        INSERT INTO services (id, name, duration, price, requires_bed) VALUES
          ('S6', '針灸組合治療（含床位）', 45, 450, 1)
        ON CONFLICT(id) DO UPDATE SET duration=excluded.duration, price=excluded.price, name=excluded.name, requires_bed=1
      `, (err) => {
        if (err) console.error("創建 S6 床位服務失敗:", err.message);
        else console.log("✅ 床位服務 S6 已準備就緒");
      });
    };
    db.all("PRAGMA table_info(services)", (err, cols) => {
      if (err || !cols) return;
      if (!cols.some(col => col.name === 'requires_bed')) {
        db.run("ALTER TABLE services ADD COLUMN requires_bed INTEGER DEFAULT 0", (e) => {
          if (e) { console.error("添加 services.requires_bed 欄位失敗:", e.message); upsertS6Service(); }
          else { console.log("✅ 已添加 services.requires_bed 欄位"); upsertS6Service(); }
        });
      } else {
        upsertS6Service();
      }
      if (!cols.some(col => col.name === 'short_name')) {
        db.run("ALTER TABLE services ADD COLUMN short_name TEXT", (e) => {
          if (e) console.error("添加 services.short_name 欄位失敗:", e.message);
          else console.log("✅ 已添加 services.short_name 欄位");
        });
      }
    });

    // 更新服務時長（規格：內科開藥 15m / 針灸 15m / 手法治療 30m / 小兒推拿 30m）
    db.run(`
      INSERT INTO services (id, name, duration, price) VALUES
        ('S1', '初體驗（一小時）', 60, 380),
        ('S2', '針灸（Acupuncture）', 15, 250),
        ('S3', '內科開藥（Internal Medicine & Dispensing）', 15, 200),
        ('S4', '手法治療（Manual Therapy）', 30, 300),
        ('S5', '小兒推拿（Pediatric Tui Na）', 30, 280)
      ON CONFLICT(id) DO UPDATE SET duration=excluded.duration, price=excluded.price, name=excluded.name
    `, (err) => {
      if (err) console.error("更新 services 失敗:", err.message);
      else console.log("✅ 服務時長已更新（15/15/30/30 + 初體驗 60）");
    });

    // 修正 medical_records 表的 doctor_user_id 為可選（允許 NULL）
    // 舊版表定義為 NOT NULL，導致客戶自行記錄療程進度時失敗
    db.all("PRAGMA table_info(medical_records)", (err, columns) => {
      if (err || !columns || columns.length === 0) return;
      const doctorCol = columns.find(c => c.name === 'doctor_user_id');
      if (doctorCol && doctorCol.notnull === 1) {
        console.log("🔄 正在修正 medical_records.doctor_user_id 為可選（允許 NULL）...");
        db.serialize(() => {
          db.run("DROP TABLE IF EXISTS treatment_progress");
          db.run("DROP TABLE IF EXISTS medical_record_photos");
          db.run("DROP TABLE IF EXISTS medical_records", (dropErr) => {
            if (dropErr) {
              console.error("重建 medical_records 表失敗:", dropErr.message);
              return;
            }
            db.run(`
              CREATE TABLE medical_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
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
              )
            `, (createErr) => {
              if (createErr) console.error("重建 medical_records 表失敗:", createErr.message);
              else console.log("✅ medical_records 表已重建（doctor_user_id 允許 NULL）");
            });
            db.run(`
              CREATE TABLE IF NOT EXISTS treatment_progress (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
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
              )
            `);
          });
        });
      }
    });
  });

  // ==================================================================
  // 🔗 醫師帳戶 ↔ doctors 表自動連結（自癒）
  // 若醫生登入帳戶冇對應 doctors 記錄（user_id 為 NULL／冇匹配），
  // 先按姓名匹配現有醫師，冇就自動建立連結，令醫生入口嘅
  // 時段管理／返工月曆／預約列表正常運作（否則 doctorInfo 一直係空）。
  // ==================================================================
  db.all("SELECT id, name FROM users WHERE role='doctor' ORDER BY id", (e1, docUsers) => {
    if (e1 || !docUsers || !docUsers.length) return;
    let di = 0;
    const next = () => {
      const u = docUsers[di++];
      if (!u) return;
      db.get("SELECT id FROM doctors WHERE user_id=? LIMIT 1", [u.id], (e2, linked) => {
        if (e2) return next();
        if (linked) return next();
        db.get("SELECT id FROM doctors WHERE name=? AND is_active=1 LIMIT 1", [u.name], (e3, matched) => {
          if (e3) return next();
          if (matched) {
            db.run("UPDATE doctors SET user_id=? WHERE id=?", [u.id, matched.id], (e4) => {
              if (e4) return next();
              console.log(`✅ 醫師帳戶「${u.name}」已關聯診所醫師（id=${matched.id}）`);
              next();
            });
          } else {
            db.run("INSERT INTO doctors (name, specialty, is_active, user_id) VALUES (?, '醫師', 1, ?)", [u.name, u.id], function (e5) {
              if (e5) return next();
              console.log(`✅ 醫師帳戶「${u.name}」已建立診所醫師記錄（id=${this.lastID}）`);
              next();
            });
          }
        });
      });
    };
    next();
  });
}

module.exports = { runMigrations };
