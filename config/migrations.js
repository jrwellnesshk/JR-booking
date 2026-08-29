
const sqlite3 = require('sqlite3').verbose();

function runMigrations(db) {
  db.serialize(() => {
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

    // 診所預設設定（冇先建立）：營業時間 10:00-19:00 / 通知開關 / 公眾註冊閘門
    const defaultSettings = [
      ['morning_start', '10:00'],
      ['morning_end', '14:00'],
      ['afternoon_start', '14:00'],
      ['afternoon_end', '19:00'],
      ['slot_interval', '30'],
      ['sms_notification_enabled', 'false'],
      ['email_notification_enabled', 'false'],
      ['whatsapp_notification_enabled', 'true'],
      ['allow_public_registration', 'false']
    ];
    defaultSettings.forEach(([key, value]) => {
      db.get("SELECT id FROM clinic_settings WHERE setting_key=?", [key], (e, row) => {
        if (e || row) return;
        db.run("INSERT INTO clinic_settings (setting_key, setting_value) VALUES (?, ?)", [key, value], (e2) => {
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
      { name: 'whatsapp_health', ddl: "ALTER TABLE users ADD COLUMN whatsapp_health INTEGER DEFAULT 1" }
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
    });

    // services 欄位擴展：床位需求
    db.all("PRAGMA table_info(services)", (err, cols) => {
      if (err || !cols) return;
      if (!cols.some(col => col.name === 'requires_bed')) {
        db.run("ALTER TABLE services ADD COLUMN requires_bed INTEGER DEFAULT 0", (e) => {
          if (e) console.error("添加 services.requires_bed 欄位失敗:", e.message);
          else console.log("✅ 已添加 services.requires_bed 欄位");
        });
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

    // 針灸組合服務需要床位資源
    db.run(`
      INSERT INTO services (id, name, duration, price, requires_bed) VALUES
        ('S6', '針灸組合治療（含床位）', 45, 450, 1)
      ON CONFLICT(id) DO UPDATE SET duration=excluded.duration, price=excluded.price, name=excluded.name, requires_bed=1
    `, (err) => {
      if (err) console.error("創建 S6 床位服務失敗:", err.message);
      else console.log("✅ 床位服務 S6 已準備就緒");
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
}

module.exports = { runMigrations };
