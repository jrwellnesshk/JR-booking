const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { runMigrations } = require('./migrations');

// 密碼加密函數 - 使用 bcrypt
function hashPassword(password) {
  const saltRounds = 10;
  return bcrypt.hashSync(password, saltRounds);
}

// 驗證密碼 - 支援舊的 SHA-256 和新的 bcrypt
function verifyPassword(password, hashedPassword) {
  // 判斷是 bcrypt 還是 SHA-256
  // bcrypt hash 通常以 $2a$、$2b$ 或 $2y$ 開頭
  if (hashedPassword.startsWith('$2a$') || hashedPassword.startsWith('$2b$') || hashedPassword.startsWith('$2y$')) {
    // 使用 bcrypt 驗證
    return bcrypt.compareSync(password, hashedPassword);
  } else {
    // 舊的 SHA-256 驗證（向後兼容）
    const sha256Hash = crypto.createHash('sha256').update(password).digest('hex');
    return sha256Hash === hashedPassword;
  }
}

// 初始化資料庫
function initializeDatabase() {
  const DB_PATH = process.env.DB_PATH || './database.db';
  const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
      console.error("無法連接到資料庫:", err);
    } else {
      console.log("✅ 已連接到 SQLite 資料庫");
    }
  });

  db.serialize(() => {
    // 先檢查並遷移舊數據庫結構
    db.all("PRAGMA table_info(users)", (err, columns) => {
      if (!err && columns && columns.length > 0) {
        const hasNameEn = columns.some(col => col.name === 'name_en');
        const hasProfileCompleted = columns.some(col => col.name === 'profile_completed');
        const hasUsernameLastChanged = columns.some(col => col.name === 'username_last_changed');
        const hasNameLastChanged = columns.some(col => col.name === 'name_last_changed');
        const hasMustChangePassword = columns.some(col => col.name === 'must_change_password');

        // 🔒 添加「首次登入須修改密碼」欄位
        if (!hasMustChangePassword) {
          console.log("🔄 正在添加 must_change_password 欄位...");
          db.run("ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0", (err) => {
            if (err) console.error("添加 must_change_password 失敗:", err.message);
            else console.log("✅ 已添加 must_change_password 欄位");
          });
        }

        // 🔓 已按用戶要求取消「強制管理員修改密碼」：不再於啟動時自動將 admin 設為 must_change_password=1。
        //    手動修改密碼功能 (/api/auth/change-password) 仍然保留可用。
        //    如日後想恢復此安全機制，請在此重新啟用以下邏輯：
        //    db.all("SELECT id, password FROM users WHERE role='admin'", (err, rows) => {
        //      if (!err && rows) {
        //        rows.forEach((row) => {
        //          if (verifyPassword("admin123", row.password)) {
        //            db.run("UPDATE users SET must_change_password=1 WHERE id=?", [row.id]);
        //          }
        //        });
        //      }
        //    });

        if (!hasNameEn) {
          console.log("🔄 正在添加 name_en 欄位...");
          db.run("ALTER TABLE users ADD COLUMN name_en TEXT", (err) => {
            if (err) console.error("添加 name_en 失敗:", err.message);
            else console.log("✅ 已添加 name_en 欄位");
          });
        }
        
        if (!hasProfileCompleted) {
          console.log("🔄 正在添加 profile_completed 欄位...");
          db.run("ALTER TABLE users ADD COLUMN profile_completed INTEGER DEFAULT 0", (err) => {
            if (err) console.error("添加 profile_completed 失敗:", err.message);
            else {
              console.log("✅ 已添加 profile_completed 欄位");
              // 將現有用戶標記為已完成（避免影響現有用戶）
              db.run("UPDATE users SET profile_completed=1 WHERE profile_completed IS NULL OR profile_completed=0", (err) => {
                if (!err) console.log("✅ 已更新現有用戶的 profile_completed 狀態");
              });
            }
          });
        }
        
        // 🆕 添加會員ID最後修改時間欄位
        if (!hasUsernameLastChanged) {
          console.log("🔄 正在添加 username_last_changed 欄位...");
          db.run("ALTER TABLE users ADD COLUMN username_last_changed TEXT", (err) => {
            if (err) console.error("添加 username_last_changed 失敗:", err.message);
            else console.log("✅ 已添加 username_last_changed 欄位");
          });
        }
        
        // 🆕 添加中文姓名最後修改時間欄位
        if (!hasNameLastChanged) {
          console.log("🔄 正在添加 name_last_changed 欄位...");
          db.run("ALTER TABLE users ADD COLUMN name_last_changed TEXT", (err) => {
            if (err) console.error("添加 name_last_changed 失敗:", err.message);
            else console.log("✅ 已添加 name_last_changed 欄位");
          });
        }
      }
    });

    // 🆕 為 bookings 表添加 doctor_user_id 欄位（如果不存在）
    db.all("PRAGMA table_info(bookings)", (err, columns) => {
      if (!err && columns && columns.length > 0) {
        const hasDoctorUserId = columns.some(col => col.name === 'doctor_user_id');
        if (!hasDoctorUserId) {
          console.log("🔄 正在添加 bookings.doctor_user_id 欄位...");
          db.run("ALTER TABLE bookings ADD COLUMN doctor_user_id INTEGER", (err) => {
            if (err) console.error("添加 doctor_user_id 失敗:", err.message);
            else console.log("✅ 已添加 bookings.doctor_user_id 欄位");
          });
        }
      }
    });

    // 用戶表
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 服務表
    db.run(`
      CREATE TABLE IF NOT EXISTS services (
        id TEXT PRIMARY KEY,
        name TEXT,
        duration INTEGER,
        price INTEGER DEFAULT 0
      )
    `);

    // 預約表
    db.run(`
CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (doctor_user_id) REFERENCES users(id)
      )
    `);

    // 時段表
    db.run(`
      CREATE TABLE IF NOT EXISTS time_slots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        is_available INTEGER DEFAULT 1,
        max_capacity INTEGER DEFAULT 3,
        current_bookings INTEGER DEFAULT 0,
        notes TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(date, time)
      )
    `);

    // 醫師時段表 - 每個醫師每個時段的可用狀態
    db.run(`
      CREATE TABLE IF NOT EXISTS doctor_time_slots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        doctor_id INTEGER NOT NULL,
        is_available INTEGER DEFAULT 1,
        max_capacity INTEGER DEFAULT 1,
        notes TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(date, time, doctor_id),
        FOREIGN KEY(doctor_id) REFERENCES doctors(id)
      )
    `);

    // 診所設定表
    db.run(`
      CREATE TABLE IF NOT EXISTS clinic_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        setting_key TEXT UNIQUE NOT NULL,
        setting_value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // API 設定表
    db.run(`
      CREATE TABLE IF NOT EXISTS api_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        setting_key TEXT UNIQUE NOT NULL,
        setting_value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 醫師資料表
    db.run(`
      CREATE TABLE IF NOT EXISTS doctors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        specialty TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        user_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    // 遷移：為 doctors 表添加 user_id 欄位（如果不存在）
    db.all("PRAGMA table_info(doctors)", (err, columns) => {
      if (!err && columns) {
        const hasUserId = columns.some(col => col.name === 'user_id');
        if (!hasUserId) {
          db.run("ALTER TABLE doctors ADD COLUMN user_id INTEGER", (err) => {
            if (!err) console.log('✅ 已添加 doctors.user_id 欄位');
          });
        }
      }
    });

    // 執行資料庫遷移
    runMigrations(db);

    // AI 問診 - 症狀分類表
    db.run(`
      CREATE TABLE IF NOT EXISTS symptom_categories (
        id TEXT PRIMARY KEY,
        name_zh_hant TEXT NOT NULL,
        name_en TEXT NOT NULL,
        description_zh_hant TEXT,
        description_en TEXT,
        icon TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // AI 問診 - 問題表
    db.run(`
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
      )
    `);

    // AI 問診 - 答案選項表
    db.run(`
      CREATE TABLE IF NOT EXISTS ai_answer_options (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL,
        option_zh_hant TEXT NOT NULL,
        option_en TEXT NOT NULL,
        severity_score INTEGER DEFAULT 0,
        next_question_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(question_id) REFERENCES ai_questions(id)
      )
    `);

    // AI 問診 - 診斷建議表
    db.run(`
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
      )
    `);

    // AI 問診 - 問診記錄表
    db.run(`
      CREATE TABLE IF NOT EXISTS ai_consultation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        user_id TEXT,
        category_id TEXT,
        question_id TEXT,
        answer_option_id TEXT,
        score INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 醫療分流 - 問題表
    db.run(`
      CREATE TABLE IF NOT EXISTS triage_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question_zh TEXT NOT NULL,
        question_en TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 醫療分流 - 選項表（包含每個醫師的分數）
    db.run(`
      CREATE TABLE IF NOT EXISTS triage_options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question_id INTEGER NOT NULL,
        option_zh TEXT NOT NULL,
        option_en TEXT NOT NULL,
        scores TEXT NOT NULL DEFAULT '{}',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(question_id) REFERENCES triage_questions(id)
      )
    `);

    // 常見問題表
    db.run(`
      CREATE TABLE IF NOT EXISTS faqs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        display_order INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 用戶意見反饋表
    db.run(`
      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      )
    `);
    
    // 遷移：為 feedback 表添加 user_read_reply 欄位
    db.get("PRAGMA table_info(feedback)", [], (err, row) => {
      db.all("PRAGMA table_info(feedback)", [], (err, columns) => {
        if (columns && !columns.find(c => c.name === 'user_read_reply')) {
          db.run("ALTER TABLE feedback ADD COLUMN user_read_reply INTEGER DEFAULT 0", (err) => {
            if (!err) console.log('✅ 已添加 feedback.user_read_reply 欄位');
          });
        }
      });
    });

    // ==================== 官網內容管理（公告 / 影片 / 評價 / 討論區）====================

    // 診所公告表
    db.run(`
      CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        category TEXT DEFAULT '診所資訊',
        content TEXT NOT NULL,
        publish_date TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 影片表（YouTube 連結 或 自訂上傳）
    db.run(`
      CREATE TABLE IF NOT EXISTS videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        source TEXT DEFAULT 'youtube',
        youtube_id TEXT,
        file_path TEXT,
        description TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 客戶評價表（管理員審核後先顯示）
    db.run(`
      CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        user_name TEXT NOT NULL,
        rating INTEGER DEFAULT 5,
        service TEXT,
        content TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    // 討論區帖子
    db.run(`
      CREATE TABLE IF NOT EXISTS forum_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        user_name TEXT NOT NULL,
        avatar TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT DEFAULT '中醫問題',
        reply_count INTEGER DEFAULT 0,
        is_pinned INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    // 討論區回覆
    db.run(`
      CREATE TABLE IF NOT EXISTS forum_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        user_id INTEGER,
        user_name TEXT NOT NULL,
        avatar TEXT,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(post_id) REFERENCES forum_posts(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    // 遷移：為 users 表添加 avatar 欄位（預設公仔 / 自訂圖片）
    db.all("PRAGMA table_info(users)", [], (err, columns) => {
      if (columns && !columns.find(c => c.name === 'avatar')) {
        db.run("ALTER TABLE users ADD COLUMN avatar TEXT", (err) => {
          if (!err) console.log('✅ 已添加 users.avatar 欄位');
        });
      }
    });

    // 遷移：為 reviews 表添加 avatar 欄位
    db.all("PRAGMA table_info(reviews)", [], (err, columns) => {
      if (columns && !columns.find(c => c.name === 'avatar')) {
        db.run("ALTER TABLE reviews ADD COLUMN avatar TEXT", (err) => {
          if (!err) console.log('✅ 已添加 reviews.avatar 欄位');
        });
      }
    });

    // 遷移：為 forum_posts / forum_replies 表添加 avatar 欄位（兼容已存在舊表）
    db.all("PRAGMA table_info(forum_posts)", [], (err, columns) => {
      if (columns && !columns.find(c => c.name === 'avatar')) {
        db.run("ALTER TABLE forum_posts ADD COLUMN avatar TEXT", (err) => {
          if (!err) console.log('✅ 已添加 forum_posts.avatar 欄位');
        });
      }
    });
    db.all("PRAGMA table_info(forum_replies)", [], (err, columns) => {
      if (columns && !columns.find(c => c.name === 'avatar')) {
        db.run("ALTER TABLE forum_replies ADD COLUMN avatar TEXT", (err) => {
          if (!err) console.log('✅ 已添加 forum_replies.avatar 欄位');
        });
      }
    });

    // 網站動態文字表（管理員可隨時修改官網任何文字）
    db.run(`
      CREATE TABLE IF NOT EXISTS site_texts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text_key TEXT UNIQUE NOT NULL,
        text_value TEXT NOT NULL DEFAULT '',
        section TEXT DEFAULT '一般',
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 遷移：為 announcements 表添加 updated_at 欄位
    db.all("PRAGMA table_info(announcements)", [], (err, columns) => {
      if (columns && !columns.find(c => c.name === 'updated_at')) {
        db.run("ALTER TABLE announcements ADD COLUMN updated_at TEXT", (err) => {
          if (!err) console.log('✅ 已添加 announcements.updated_at 欄位');
        });
      }
    });

    // 模擬支付記錄表
    db.run(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        FOREIGN KEY(booking_id) REFERENCES bookings(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    // 臨時預約保留表（支付前的暫存）
    db.run(`
      CREATE TABLE IF NOT EXISTS pending_reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      )
    `);

    // 密碼重設 Token 表
    db.run(`
      CREATE TABLE IF NOT EXISTS reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT UNIQUE NOT NULL,
        username TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL,
        used INTEGER DEFAULT 0
      )
    `);

    // 密碼重設審計日誌表
    db.run(`
      CREATE TABLE IF NOT EXISTS password_reset_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_address TEXT,
        username TEXT,
        action TEXT NOT NULL,
        success INTEGER DEFAULT 0,
        details TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 🆕 登入失敗記錄表（用於帳戶鎖定）
    db.run(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        attempt_time TEXT DEFAULT CURRENT_TIMESTAMP,
        success INTEGER DEFAULT 0,
        ip_address TEXT
      )
    `);

    // 🆕 驗證碼發送記錄表（用於防止濫用）
    db.run(`
      CREATE TABLE IF NOT EXISTS verification_code_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
        ip_address TEXT
      )
    `);

    // 初始化診所設定
    db.get("SELECT COUNT(*) as count FROM clinic_settings", (err, row) => {
      if (!err && row.count === 0) {
        const stmt = db.prepare("INSERT INTO clinic_settings (setting_key, setting_value) VALUES (?, ?)");
        stmt.run("tuina_beds", "5");
        stmt.run("acupuncture_beds", "5");
        stmt.run("vip_rooms", "5");
        stmt.run("total_doctors", "3");
        stmt.run("closed_days", "0"); // 預設星期日休息 (0=星期日, 1=星期一, ..., 6=星期六，多個用逗號分隔)
        stmt.finalize();
        console.log("✅ 已建立診所設定");
      }
    });
    
    // 檢查並添加 closed_days 設定（如果不存在）
    db.get("SELECT * FROM clinic_settings WHERE setting_key = 'closed_days'", (err, row) => {
      if (!err && !row) {
        db.run("INSERT INTO clinic_settings (setting_key, setting_value) VALUES (?, ?)", ["closed_days", "0"], (err) => {
          if (!err) console.log("✅ 已添加休息日設定（預設星期日）");
        });
      }
    });
    
    // 檢查並添加 holidays_enabled 設定（如果不存在）- 預設啟用公眾假期休息
    db.get("SELECT * FROM clinic_settings WHERE setting_key = 'holidays_enabled'", (err, row) => {
      if (!err && !row) {
        db.run("INSERT INTO clinic_settings (setting_key, setting_value) VALUES (?, ?)", ["holidays_enabled", "1"], (err) => {
          if (!err) console.log("✅ 已添加公眾假期設定（預設啟用）");
        });
      }
    });
    
    // 檢查並添加 working_holidays 設定（如果不存在）- 儲存要營業的特定假期日期
    db.get("SELECT * FROM clinic_settings WHERE setting_key = 'working_holidays'", (err, row) => {
      if (!err && !row) {
        db.run("INSERT INTO clinic_settings (setting_key, setting_value) VALUES (?, ?)", ["working_holidays", ""], (err) => {
          if (!err) console.log("✅ 已添加營業假期設定");
        });
      }
    });

    // 檢查並添加 SMS 通知設定（如果不存在）- 預設開啟
    db.get("SELECT * FROM clinic_settings WHERE setting_key = 'sms_notification_enabled'", (err, row) => {
      if (!err && !row) {
        db.run("INSERT INTO clinic_settings (setting_key, setting_value) VALUES (?, ?)", ["sms_notification_enabled", "true"], (err) => {
          if (!err) console.log("✅ 已添加 SMS 通知設定（預設開啟）");
        });
      }
    });

    // 檢查並添加 WhatsApp 通知設定（如果不存在）- 預設開啟
    db.get("SELECT * FROM clinic_settings WHERE setting_key = 'whatsapp_notification_enabled'", (err, row) => {
      if (!err && !row) {
        db.run("INSERT INTO clinic_settings (setting_key, setting_value) VALUES (?, ?)", ["whatsapp_notification_enabled", "true"], (err) => {
          if (!err) console.log("✅ 已添加 WhatsApp 通知設定（預設開啟）");
        });
      }
    });

    // 初始化醫師資料
    db.get("SELECT COUNT(*) as count FROM doctors", (err, row) => {
      if (!err && row.count === 0) {
        const stmt = db.prepare("INSERT INTO doctors (name, specialty, is_active) VALUES (?, ?, ?)");
        stmt.run("張醫師", "推拿專家", 1);
        stmt.run("李醫師", "針灸專家", 1);
        stmt.run("王醫師", "綜合治療", 1);
        stmt.run("陳醫師", "骨傷科", 1);
        stmt.finalize();
        console.log("✅ 已建立預設醫師資料");
      } else if (!err && row.count === 3) {
        // 如果只有3位醫師，新增第4位
        db.run("INSERT INTO doctors (name, specialty, is_active) VALUES (?, ?, ?)", 
          ["陳醫師", "骨傷科", 1], (err) => {
            if (!err) console.log("✅ 已新增第4位醫師");
          });
      }
    });


    // 初始化管理員
    db.get("SELECT COUNT(*) as count FROM users WHERE role='admin'", (err, row) => {
      if (!err && row.count === 0) {
        const adminInitPw = process.env.ADMIN_PASSWORD
          ? process.env.ADMIN_PASSWORD
          : crypto.randomBytes(12).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
        const adminPassword = hashPassword(adminInitPw);
        db.run(
          "INSERT INTO users (username, password, name, name_en, phone, email, role, profile_completed, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)",
          ["admin", adminPassword, "管理員", "Admin", "0900-000-000", "admin@clinic.com", "admin", 1],
          (err) => {
            if (!err) {
              if (process.env.ADMIN_PASSWORD) {
                console.log("✅ 已建立管理員帳戶：username=admin（密碼取自 ADMIN_PASSWORD 環境變數，請盡快登入修改）");
              } else {
                console.log("✅ 已建立管理員帳戶：username=admin，臨時密碼=" + adminInitPw + "（請盡快登入修改）");
              }
            }
          }
        );
      }
    });

    // 初始化客戶帳戶：生產環境唔自動建立 demo 客人（避免弱密碼帳戶）。客人由前線職員建立或自行註冊。

    // 預設 4 個服務
    db.all("SELECT COUNT(*) as count FROM services", (err, rows) => {
      if (rows && rows[0].count === 0) {
        const stmt = db.prepare("INSERT INTO services (id, name, duration, price) VALUES (?,?,?,?)");
        stmt.run("S1", "推拿治療（45 分鐘）", 45, 300);
        stmt.run("S2", "針灸治療（30 分鐘）", 30, 250);
        stmt.run("S3", "推拿 + 針灸（60 分鐘）", 60, 500);
        stmt.run("S4", "新症諮詢（30 分鐘）", 30, 150);
        stmt.finalize();
        console.log("✅ 已建立預設 4 個服務項目");
      }
    });
    
    // 檢查並添加 price 欄位到現有 services 表
    db.all("PRAGMA table_info(services)", (err, columns) => {
      if (!err) {
        const columnNames = columns.map(col => col.name);
        if (!columnNames.includes('price')) {
          db.run("ALTER TABLE services ADD COLUMN price INTEGER DEFAULT 0");
          console.log("✅ 已添加 price 欄位到 services 表");
        }
      }
    });

    // 初始化 AI 問診資料 - 症狀分類
    db.get("SELECT COUNT(*) as count FROM symptom_categories", (err, row) => {
      if (!err && row.count === 0) {
        const stmt = db.prepare("INSERT INTO symptom_categories (id, name_zh_hant, name_en, description_zh_hant, description_en, icon) VALUES (?, ?, ?, ?, ?, ?)");
        stmt.run("cold_flu", "感冒/流感", "Cold/Flu", "發燒、咳嗽、喉嚨痛等", "Fever, cough, sore throat, etc.", "fa-temperature-high");
        stmt.run("digestive", "腸胃問題", "Digestive Issues", "肚痛、腹瀉、嘔吐等", "Stomach pain, diarrhea, vomiting, etc.", "fa-stomach");
        stmt.run("pain", "痛症", "Pain", "頭痛、腰痛、肌肉痠痛等", "Headache, back pain, muscle aches, etc.", "fa-hand-dots");
        stmt.run("respiratory", "呼吸系統", "Respiratory", "咳嗽、氣喘、呼吸困難等", "Cough, asthma, breathing difficulty, etc.", "fa-lungs");
        stmt.run("allergy", "過敏", "Allergy", "皮膚紅疹、鼻敏感等", "Skin rash, allergies, etc.", "fa-allergies");
        stmt.finalize();
        console.log("✅ 已建立 AI 問診症狀分類");
      }
    });

    // 初始化 AI 問診資料 - 問題和答案（延遲執行以確保症狀分類已建立）
    setTimeout(() => {
      initializeAIQuestions(db);
      initializeAIRecommendations(db);
      initializeTriageQuestions(db);
    }, 100);
  });

  return db;
}

// 初始化 AI 問題和答案選項
function initializeAIQuestions(db) {
  db.get("SELECT COUNT(*) as count FROM ai_questions", (err, row) => {
    if (err || row.count > 0) return;

    const questions = [];
    const options = [];

    // === 感冒/流感 (cold_flu) ===
    questions.push({ id: "cf_q1", category: "cold_flu", order: 1, type: "single", critical: 0,
      zh_hant: "您現在的體溫如何？", en: "What is your current body temperature?" });
    options.push({ id: "cf_q1_a", qid: "cf_q1", score: 0, next: "cf_q2",
      zh_hant: "正常 (<37.5°C)", en: "Normal (<37.5°C)" });
    options.push({ id: "cf_q1_b", qid: "cf_q1", score: 3, next: "cf_q2",
      zh_hant: "輕微發燒 (37.5-38°C)", en: "Slight fever (37.5-38°C)" });
    options.push({ id: "cf_q1_c", qid: "cf_q1", score: 6, next: "cf_q2",
      zh_hant: "高燒 (38-39°C)", en: "High fever (38-39°C)" });
    options.push({ id: "cf_q1_d", qid: "cf_q1", score: 10, next: "cf_q3",
      zh_hant: "持續高燒 (>39°C)", en: "Persistent high fever (>39°C)" });

    questions.push({ id: "cf_q2", category: "cold_flu", order: 2, type: "single", critical: 0,
      zh_hant: "這些症狀持續多久了？", en: "How long have you had these symptoms?" });
    options.push({ id: "cf_q2_a", qid: "cf_q2", score: 1, next: "cf_q3",
      zh_hant: "今天才開始", en: "Started today" });
    options.push({ id: "cf_q2_b", qid: "cf_q2", score: 3, next: "cf_q3",
      zh_hant: "1-2天", en: "1-2 days" });
    options.push({ id: "cf_q2_c", qid: "cf_q2", score: 5, next: "cf_q3",
      zh_hant: "3-5天", en: "3-5 days" });
    options.push({ id: "cf_q2_d", qid: "cf_q2", score: 8, next: "cf_q4",
      zh_hant: "超過5天", en: "More than 5 days" });

    questions.push({ id: "cf_q3", category: "cold_flu", order: 3, type: "multiple", critical: 0,
      zh_hant: "您有以下哪些症狀？（可多選）", en: "Which of these symptoms do you have? (Multiple choice)" });
    options.push({ id: "cf_q3_a", qid: "cf_q3", score: 2, next: "cf_q4",
      zh_hant: "咳嗽", en: "Cough" });
    options.push({ id: "cf_q3_b", qid: "cf_q3", score: 2, next: "cf_q4",
      zh_hant: "喉嚨痛", en: "Sore throat" });
    options.push({ id: "cf_q3_c", qid: "cf_q3", score: 1, next: "cf_q4",
      zh_hant: "流鼻水", en: "Runny nose" });
    options.push({ id: "cf_q3_d", qid: "cf_q3", score: 2, next: "cf_q4",
      zh_hant: "頭痛", en: "Headache" });
    options.push({ id: "cf_q3_e", qid: "cf_q3", score: 3, next: "cf_q4",
      zh_hant: "全身肌肉痠痛", en: "Body aches" });

    questions.push({ id: "cf_q4", category: "cold_flu", order: 4, type: "multiple", critical: 1,
      zh_hant: "您是否有以下情況？（可多選）", en: "Do you have any of the following? (Multiple choice)" });
    options.push({ id: "cf_q4_a", qid: "cf_q4", score: 10, next: null,
      zh_hant: "呼吸困難", en: "Difficulty breathing" });
    options.push({ id: "cf_q4_b", qid: "cf_q4", score: 10, next: null,
      zh_hant: "胸痛", en: "Chest pain" });
    options.push({ id: "cf_q4_c", qid: "cf_q4", score: 6, next: null,
      zh_hant: "持續嘔吐", en: "Persistent vomiting" });
    options.push({ id: "cf_q4_d", qid: "cf_q4", score: 0, next: null,
      zh_hant: "以上都沒有", en: "None of the above" });

    // === 腸胃問題 (digestive) ===
    questions.push({ id: "dg_q1", category: "digestive", order: 1, type: "single", critical: 0,
      zh_hant: "請問主要是哪種不適？", en: "What is your main discomfort?" });
    options.push({ id: "dg_q1_a", qid: "dg_q1", score: 3, next: "dg_q2",
      zh_hant: "胃部不適/胃痛", en: "Stomach discomfort/pain" });
    options.push({ id: "dg_q1_b", qid: "dg_q1", score: 4, next: "dg_q2",
      zh_hant: "腹部疼痛", en: "Abdominal pain" });
    options.push({ id: "dg_q1_c", qid: "dg_q1", score: 3, next: "dg_q3",
      zh_hant: "腹瀉", en: "Diarrhea" });
    options.push({ id: "dg_q1_d", qid: "dg_q1", score: 5, next: "dg_q3",
      zh_hant: "嘔吐", en: "Vomiting" });

    questions.push({ id: "dg_q2", category: "digestive", order: 2, type: "single", critical: 0,
      zh_hant: "疼痛程度如何？", en: "How severe is the pain?" });
    options.push({ id: "dg_q2_a", qid: "dg_q2", score: 1, next: "dg_q4",
      zh_hant: "輕微，不影響日常", en: "Mild, doesn't affect daily life" });
    options.push({ id: "dg_q2_b", qid: "dg_q2", score: 3, next: "dg_q4",
      zh_hant: "中等，有點不舒服", en: "Moderate, somewhat uncomfortable" });
    options.push({ id: "dg_q2_c", qid: "dg_q2", score: 6, next: "dg_q4",
      zh_hant: "嚴重，影響活動", en: "Severe, affects activities" });
    options.push({ id: "dg_q2_d", qid: "dg_q2", score: 10, next: null,
      zh_hant: "劇痛，無法忍受", en: "Extreme pain, unbearable" });

    questions.push({ id: "dg_q3", category: "digestive", order: 3, type: "single", critical: 0,
      zh_hant: "症狀頻率如何？", en: "How frequent are the symptoms?" });
    options.push({ id: "dg_q3_a", qid: "dg_q3", score: 2, next: "dg_q4",
      zh_hant: "偶爾（1-2次/天）", en: "Occasional (1-2 times/day)" });
    options.push({ id: "dg_q3_b", qid: "dg_q3", score: 4, next: "dg_q4",
      zh_hant: "頻繁（3-5次/天）", en: "Frequent (3-5 times/day)" });
    options.push({ id: "dg_q3_c", qid: "dg_q3", score: 8, next: "dg_q4",
      zh_hant: "非常頻繁（>6次/天）", en: "Very frequent (>6 times/day)" });

    questions.push({ id: "dg_q4", category: "digestive", order: 4, type: "multiple", critical: 1,
      zh_hant: "是否有以下情況？（可多選）", en: "Do you have any of the following? (Multiple choice)" });
    options.push({ id: "dg_q4_a", qid: "dg_q4", score: 5, next: null,
      zh_hant: "發燒", en: "Fever" });
    options.push({ id: "dg_q4_b", qid: "dg_q4", score: 10, next: null,
      zh_hant: "血便或黑便", en: "Blood or black stool" });
    options.push({ id: "dg_q4_c", qid: "dg_q4", score: 8, next: null,
      zh_hant: "持續嘔吐超過6小時", en: "Vomiting for >6 hours" });
    options.push({ id: "dg_q4_d", qid: "dg_q4", score: 0, next: null,
      zh_hant: "以上都沒有", en: "None of the above" });

    // === 痛症 (pain) ===
    questions.push({ id: "pain_q1", category: "pain", order: 1, type: "single", critical: 0,
      zh_hant: "請問疼痛的主要部位在哪裡？", en: "Where is the main location of pain?" });
    options.push({ id: "pain_q1_a", qid: "pain_q1", score: 2, next: "pain_q2",
      zh_hant: "頭部", en: "Head" });
    options.push({ id: "pain_q1_b", qid: "pain_q1", score: 3, next: "pain_q2",
      zh_hant: "頸部/肩膀", en: "Neck/Shoulder" });
    options.push({ id: "pain_q1_c", qid: "pain_q1", score: 3, next: "pain_q2",
      zh_hant: "腰背部", en: "Lower back" });
    options.push({ id: "pain_q1_d", qid: "pain_q1", score: 2, next: "pain_q2",
      zh_hant: "四肢關節", en: "Limbs/Joints" });

    questions.push({ id: "pain_q2", category: "pain", order: 2, type: "single", critical: 0,
      zh_hant: "疼痛程度如何？", en: "How severe is the pain?" });
    options.push({ id: "pain_q2_a", qid: "pain_q2", score: 1, next: "pain_q3",
      zh_hant: "輕微，不影響日常", en: "Mild, doesn't affect daily life" });
    options.push({ id: "pain_q2_b", qid: "pain_q2", score: 3, next: "pain_q3",
      zh_hant: "中等，有點不舒服", en: "Moderate, somewhat uncomfortable" });
    options.push({ id: "pain_q2_c", qid: "pain_q2", score: 6, next: "pain_q3",
      zh_hant: "嚴重，影響活動", en: "Severe, affects activities" });
    options.push({ id: "pain_q2_d", qid: "pain_q2", score: 10, next: null,
      zh_hant: "劇痛，無法忍受", en: "Extreme pain, unbearable" });

    questions.push({ id: "pain_q3", category: "pain", order: 3, type: "single", critical: 0,
      zh_hant: "疼痛持續多久了？", en: "How long have you had the pain?" });
    options.push({ id: "pain_q3_a", qid: "pain_q3", score: 1, next: "pain_q4",
      zh_hant: "今天才開始", en: "Started today" });
    options.push({ id: "pain_q3_b", qid: "pain_q3", score: 2, next: "pain_q4",
      zh_hant: "1-3天", en: "1-3 days" });
    options.push({ id: "pain_q3_c", qid: "pain_q3", score: 4, next: "pain_q4",
      zh_hant: "1-2週", en: "1-2 weeks" });
    options.push({ id: "pain_q3_d", qid: "pain_q3", score: 6, next: "pain_q4",
      zh_hant: "超過2週", en: "More than 2 weeks" });

    questions.push({ id: "pain_q4", category: "pain", order: 4, type: "multiple", critical: 1,
      zh_hant: "是否有以下情況？（可多選）", en: "Do you have any of the following? (Multiple choice)" });
    options.push({ id: "pain_q4_a", qid: "pain_q4", score: 8, next: null,
      zh_hant: "手腳麻痺或無力", en: "Numbness or weakness in limbs" });
    options.push({ id: "pain_q4_b", qid: "pain_q4", score: 10, next: null,
      zh_hant: "劇烈頭痛伴隨嘔吐", en: "Severe headache with vomiting" });
    options.push({ id: "pain_q4_c", qid: "pain_q4", score: 5, next: null,
      zh_hant: "疼痛逐漸加劇", en: "Pain gradually worsening" });
    options.push({ id: "pain_q4_d", qid: "pain_q4", score: 0, next: null,
      zh_hant: "以上都沒有", en: "None of the above" });

    // === 呼吸系統 (respiratory) ===
    questions.push({ id: "resp_q1", category: "respiratory", order: 1, type: "multiple", critical: 0,
      zh_hant: "您有哪些呼吸相關症狀？（可多選）", en: "What respiratory symptoms do you have? (Multiple choice)" });
    options.push({ id: "resp_q1_a", qid: "resp_q1", score: 2, next: "resp_q2",
      zh_hant: "咳嗽", en: "Cough" });
    options.push({ id: "resp_q1_b", qid: "resp_q1", score: 3, next: "resp_q2",
      zh_hant: "氣喘/呼吸急促", en: "Wheezing/Shortness of breath" });
    options.push({ id: "resp_q1_c", qid: "resp_q1", score: 4, next: "resp_q2",
      zh_hant: "胸悶", en: "Chest tightness" });
    options.push({ id: "resp_q1_d", qid: "resp_q1", score: 2, next: "resp_q2",
      zh_hant: "有痰", en: "Phlegm" });

    questions.push({ id: "resp_q2", category: "respiratory", order: 2, type: "single", critical: 0,
      zh_hant: "症狀持續多久了？", en: "How long have you had these symptoms?" });
    options.push({ id: "resp_q2_a", qid: "resp_q2", score: 1, next: "resp_q3",
      zh_hant: "今天才開始", en: "Started today" });
    options.push({ id: "resp_q2_b", qid: "resp_q2", score: 2, next: "resp_q3",
      zh_hant: "2-3天", en: "2-3 days" });
    options.push({ id: "resp_q2_c", qid: "resp_q2", score: 4, next: "resp_q3",
      zh_hant: "4-7天", en: "4-7 days" });
    options.push({ id: "resp_q2_d", qid: "resp_q2", score: 6, next: "resp_q3",
      zh_hant: "超過1週", en: "More than 1 week" });

    questions.push({ id: "resp_q3", category: "respiratory", order: 3, type: "single", critical: 0,
      zh_hant: "呼吸困難程度如何？", en: "How difficult is it to breathe?" });
    options.push({ id: "resp_q3_a", qid: "resp_q3", score: 1, next: "resp_q4",
      zh_hant: "沒有困難，正常呼吸", en: "No difficulty, breathing normally" });
    options.push({ id: "resp_q3_b", qid: "resp_q3", score: 3, next: "resp_q4",
      zh_hant: "活動時有點喘", en: "Slight breathlessness during activity" });
    options.push({ id: "resp_q3_c", qid: "resp_q3", score: 6, next: "resp_q4",
      zh_hant: "稍微活動就很喘", en: "Very breathless with slight activity" });
    options.push({ id: "resp_q3_d", qid: "resp_q3", score: 10, next: null,
      zh_hant: "休息時也感到呼吸困難", en: "Difficulty breathing even at rest" });

    questions.push({ id: "resp_q4", category: "respiratory", order: 4, type: "multiple", critical: 1,
      zh_hant: "是否有以下情況？（可多選）", en: "Do you have any of the following? (Multiple choice)" });
    options.push({ id: "resp_q4_a", qid: "resp_q4", score: 10, next: null,
      zh_hant: "嘴唇或指甲發紫", en: "Blue lips or nails" });
    options.push({ id: "resp_q4_b", qid: "resp_q4", score: 8, next: null,
      zh_hant: "胸痛", en: "Chest pain" });
    options.push({ id: "resp_q4_c", qid: "resp_q4", score: 5, next: null,
      zh_hant: "發燒", en: "Fever" });
    options.push({ id: "resp_q4_d", qid: "resp_q4", score: 0, next: null,
      zh_hant: "以上都沒有", en: "None of the above" });

    // === 過敏 (allergy) ===
    questions.push({ id: "allergy_q1", category: "allergy", order: 1, type: "multiple", critical: 0,
      zh_hant: "您有哪些過敏症狀？（可多選）", en: "What allergy symptoms do you have? (Multiple choice)" });
    options.push({ id: "allergy_q1_a", qid: "allergy_q1", score: 2, next: "allergy_q2",
      zh_hant: "皮膚紅疹/痕癢", en: "Skin rash/itching" });
    options.push({ id: "allergy_q1_b", qid: "allergy_q1", score: 2, next: "allergy_q2",
      zh_hant: "鼻塞/流鼻水", en: "Stuffy/Runny nose" });
    options.push({ id: "allergy_q1_c", qid: "allergy_q1", score: 2, next: "allergy_q2",
      zh_hant: "眼睛痕癢/流眼水", en: "Itchy/Watery eyes" });
    options.push({ id: "allergy_q1_d", qid: "allergy_q1", score: 3, next: "allergy_q2",
      zh_hant: "打噴嚏", en: "Sneezing" });

    questions.push({ id: "allergy_q2", category: "allergy", order: 2, type: "single", critical: 0,
      zh_hant: "症狀持續多久了？", en: "How long have you had these symptoms?" });
    options.push({ id: "allergy_q2_a", qid: "allergy_q2", score: 1, next: "allergy_q3",
      zh_hant: "剛開始", en: "Just started" });
    options.push({ id: "allergy_q2_b", qid: "allergy_q2", score: 2, next: "allergy_q3",
      zh_hant: "幾天", en: "A few days" });
    options.push({ id: "allergy_q2_c", qid: "allergy_q2", score: 3, next: "allergy_q3",
      zh_hant: "1-2週", en: "1-2 weeks" });
    options.push({ id: "allergy_q2_d", qid: "allergy_q2", score: 4, next: "allergy_q3",
      zh_hant: "長期反覆發作", en: "Chronic/Recurring" });

    questions.push({ id: "allergy_q3", category: "allergy", order: 3, type: "single", critical: 0,
      zh_hant: "您知道過敏源是什麼嗎？", en: "Do you know what you're allergic to?" });
    options.push({ id: "allergy_q3_a", qid: "allergy_q3", score: 1, next: "allergy_q4",
      zh_hant: "知道，已避開過敏源", en: "Yes, avoiding the allergen" });
    options.push({ id: "allergy_q3_b", qid: "allergy_q3", score: 2, next: "allergy_q4",
      zh_hant: "知道，但難以避免", en: "Yes, but hard to avoid" });
    options.push({ id: "allergy_q3_c", qid: "allergy_q3", score: 3, next: "allergy_q4",
      zh_hant: "不確定", en: "Not sure" });
    options.push({ id: "allergy_q3_d", qid: "allergy_q3", score: 3, next: "allergy_q4",
      zh_hant: "不知道", en: "Don't know" });

    questions.push({ id: "allergy_q4", category: "allergy", order: 4, type: "multiple", critical: 1,
      zh_hant: "是否有以下嚴重情況？（可多選）", en: "Do you have any severe symptoms? (Multiple choice)" });
    options.push({ id: "allergy_q4_a", qid: "allergy_q4", score: 10, next: null,
      zh_hant: "呼吸困難/氣喘", en: "Difficulty breathing/Wheezing" });
    options.push({ id: "allergy_q4_b", qid: "allergy_q4", score: 10, next: null,
      zh_hant: "面部/喉嚨腫脹", en: "Face/Throat swelling" });
    options.push({ id: "allergy_q4_c", qid: "allergy_q4", score: 5, next: null,
      zh_hant: "大範圍紅疹/水泡", en: "Widespread rash/Blisters" });
    options.push({ id: "allergy_q4_d", qid: "allergy_q4", score: 0, next: null,
      zh_hant: "以上都沒有", en: "None of the above" });

    // 插入問題
    const qStmt = db.prepare("INSERT INTO ai_questions (id, category_id, question_zh_hant, question_en, question_order, question_type, is_critical) VALUES (?, ?, ?, ?, ?, ?, ?)");
    questions.forEach(q => {
      qStmt.run(q.id, q.category, q.zh_hant, q.en, q.order, q.type, q.critical);
    });
    qStmt.finalize();

    // 插入答案選項
    const oStmt = db.prepare("INSERT INTO ai_answer_options (id, question_id, option_zh_hant, option_en, severity_score, next_question_id) VALUES (?, ?, ?, ?, ?, ?)");
    options.forEach(o => {
      oStmt.run(o.id, o.qid, o.zh_hant, o.en, o.score, o.next);
    });
    oStmt.finalize();

    console.log("✅ 已建立 AI 問診問題和答案選項");
  });
}

// 初始化 AI 診斷建議
function initializeAIRecommendations(db) {
  db.get("SELECT COUNT(*) as count FROM ai_recommendations", (err, row) => {
    if (err || row.count > 0) return;

    const recs = [];

    // 感冒/流感建議
    recs.push({ id: "cf_r1", cat: "cold_flu", min: 0, max: 5, urgency: "normal", booking: 0,
      zh_hant: "根據您的症狀，目前情況尚可。建議多休息、多喝水。\n\n⚠️ 請留意身體狀況，如有轉差（如發燒、疼痛加劇、持續不適等），必須立即就醫。",
      en: "Based on your symptoms, your condition seems manageable. Please rest and stay hydrated.\n\n⚠️ Please monitor your condition. Seek immediate medical attention if symptoms worsen." });

    recs.push({ id: "cf_r2", cat: "cold_flu", min: 6, max: 15, urgency: "urgent", booking: 1,
      zh_hant: "根據您的症狀，建議盡快就診檢查。您可能需要專業診斷和治療。\n\n⚠️ 建議您預約真實醫師進行診斷。",
      en: "Based on your symptoms, we recommend seeing a doctor soon for proper diagnosis and treatment.\n\n⚠️ Please book an appointment with a real doctor." });

    recs.push({ id: "cf_r3", cat: "cold_flu", min: 16, max: 100, urgency: "emergency", booking: 1,
      zh_hant: "⚠️ 您的症狀較為嚴重，建議立即就醫！\n\n可能需要緊急處理，請盡快預約或前往急診。",
      en: "⚠️ Your symptoms are severe. Please seek medical attention immediately!\n\nYou may need urgent care. Please book an appointment or go to the ER." });

    // 腸胃問題建議
    recs.push({ id: "dg_r1", cat: "digestive", min: 0, max: 6, urgency: "normal", booking: 0,
      zh_hant: "根據您的症狀，目前情況尚可。建議清淡飲食、多喝水。\n\n⚠️ 請留意身體狀況，如有轉差（如發燒、疼痛加劇、持續不適等），必須立即就醫。",
      en: "Your condition seems manageable. Eat light foods and stay hydrated.\n\n⚠️ Monitor your condition and seek help if it worsens." });

    recs.push({ id: "dg_r2", cat: "digestive", min: 7, max: 15, urgency: "urgent", booking: 1,
      zh_hant: "根據您的症狀，建議就診檢查。腸胃問題可能需要專業治療。\n\n⚠️ 建議您預約醫師進行診斷。",
      en: "We recommend seeing a doctor. Digestive issues may need professional treatment.\n\n⚠️ Please book an appointment." });

    recs.push({ id: "dg_r3", cat: "digestive", min: 16, max: 100, urgency: "emergency", booking: 1,
      zh_hant: "⚠️ 您的症狀需要盡快就醫！\n\n可能有嚴重腸胃問題，請立即預約或前往急診。",
      en: "⚠️ Please seek medical attention immediately!\n\nYou may have a serious digestive issue. Book an appointment or go to the ER." });

    // 痛症建議
    recs.push({ id: "pain_r1", cat: "pain", min: 0, max: 5, urgency: "normal", booking: 0,
      zh_hant: "根據您的症狀，目前情況尚可。建議多休息，可使用熱敷或冷敷緩解。\n\n⚠️ 請留意身體狀況，如疼痛持續或加劇，請就醫檢查。",
      en: "Your condition seems manageable. Rest and apply hot/cold compress.\n\n⚠️ Seek help if pain persists or worsens." });

    recs.push({ id: "pain_r2", cat: "pain", min: 6, max: 15, urgency: "urgent", booking: 1,
      zh_hant: "根據您的症狀，建議就診檢查。疼痛問題可能需要專業治療。\n\n⚠️ 建議您預約中醫或物理治療師進行評估。",
      en: "We recommend seeing a doctor. Pain issues may need professional treatment.\n\n⚠️ Please book an appointment for assessment." });

    recs.push({ id: "pain_r3", cat: "pain", min: 16, max: 100, urgency: "emergency", booking: 1,
      zh_hant: "⚠️ 您的症狀較為嚴重，建議立即就醫！\n\n劇烈疼痛或伴隨其他症狀可能需要緊急處理。",
      en: "⚠️ Your symptoms are severe. Please seek medical attention immediately!\n\nSevere pain may require urgent care." });

    // 呼吸系統建議
    recs.push({ id: "resp_r1", cat: "respiratory", min: 0, max: 5, urgency: "normal", booking: 0,
      zh_hant: "根據您的症狀，目前情況尚可。建議多休息、保持空氣流通。\n\n⚠️ 請留意呼吸狀況，如有惡化請立即就醫。",
      en: "Your condition seems manageable. Rest and maintain good air circulation.\n\n⚠️ Monitor your breathing and seek help if it worsens." });

    recs.push({ id: "resp_r2", cat: "respiratory", min: 6, max: 15, urgency: "urgent", booking: 1,
      zh_hant: "根據您的症狀，建議盡快就診。呼吸系統問題需要專業評估。\n\n⚠️ 建議您預約醫師進行檢查。",
      en: "We recommend seeing a doctor soon. Respiratory issues need professional assessment.\n\n⚠️ Please book an appointment." });

    recs.push({ id: "resp_r3", cat: "respiratory", min: 16, max: 100, urgency: "emergency", booking: 1,
      zh_hant: "⚠️ 您的症狀非常嚴重，請立即就醫！\n\n嚴重呼吸困難可能危及生命，請馬上前往急診。",
      en: "⚠️ Your symptoms are very severe. Seek emergency care immediately!\n\nSevere breathing difficulty can be life-threatening. Go to the ER now." });

    // 過敏建議
    recs.push({ id: "allergy_r1", cat: "allergy", min: 0, max: 5, urgency: "normal", booking: 0,
      zh_hant: "根據您的症狀，目前情況尚可。建議避開已知過敏源，可使用抗敏藥物。\n\n⚠️ 請留意症狀變化，如有惡化請就醫。",
      en: "Your condition seems manageable. Avoid known allergens and use antihistamines.\n\n⚠️ Monitor symptoms and seek help if they worsen." });

    recs.push({ id: "allergy_r2", cat: "allergy", min: 6, max: 15, urgency: "urgent", booking: 1,
      zh_hant: "根據您的症狀，建議就診檢查。可能需要進行過敏測試和專業治療。\n\n⚠️ 建議您預約醫師進行評估。",
      en: "We recommend seeing a doctor. You may need allergy testing and treatment.\n\n⚠️ Please book an appointment." });

    recs.push({ id: "allergy_r3", cat: "allergy", min: 16, max: 100, urgency: "emergency", booking: 1,
      zh_hant: "⚠️ 您可能出現嚴重過敏反應！請立即就醫！\n\n嚴重過敏反應（如呼吸困難、面部腫脹）需要緊急處理。",
      en: "⚠️ You may be having a severe allergic reaction! Seek emergency care immediately!\n\nSevere reactions require urgent medical attention." });

    const stmt = db.prepare("INSERT INTO ai_recommendations (id, category_id, min_score, max_score, recommendation_zh_hant, recommendation_en, urgency_level, show_booking_button) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    recs.forEach(r => {
      stmt.run(r.id, r.cat, r.min, r.max, r.zh_hant, r.en, r.urgency, r.booking);
    });
    stmt.finalize();

    console.log("✅ 已建立 AI 問診診斷建議");
  });

  // 初始化常見問題
  db.get("SELECT COUNT(*) as count FROM faqs", (err, row) => {
    if (!err && row.count === 0) {
      const faqs = [
        { q: "診所的營業時間是？", a: "我們的營業時間為週一至週六 09:00-18:00，週日及公眾假期休息。", order: 1 },
        { q: "如何預約服務？", a: "您可以透過我們的線上預約系統選擇日期、時間和服務項目，或致電診所進行預約。", order: 2 },
        { q: "初診需要準備什麼？", a: "請攜帶身份證件，如有相關的醫療記錄或檢查報告也請一併帶來。", order: 3 },
        { q: "推拿療程需要多長時間？", a: "一般推拿療程約 30-60 分鐘，實際時間依個人狀況調整。", order: 4 },
        { q: "可以使用醫療保險嗎？", a: "我們接受多種醫療保險，建議您先向保險公司確認承保範圍。", order: 5 },
        { q: "如何取消或更改預約？", a: "請至少提前 24 小時聯絡診所進行更改，以便我們安排其他病人。", order: 6 },
        { q: "診所提供哪些服務？", a: "我們提供推拿、針灸、拔罐、刮痧等中醫治療服務。", order: 7 },
        { q: "停車方便嗎？", a: "診所附近設有公共停車場，步行約 3 分鐘即可到達。", order: 8 }
      ];
      
      const stmt = db.prepare("INSERT INTO faqs (question, answer, display_order, is_active) VALUES (?, ?, ?, ?)");
      faqs.forEach(faq => {
        stmt.run(faq.q, faq.a, faq.order, 1);
      });
      stmt.finalize();
      
      console.log("✅ 已建立預設常見問題");
    }
  });
}

// 初始化醫療分流問題
function initializeTriageQuestions(db) {
  db.get("SELECT COUNT(*) as count FROM triage_questions", (err, row) => {
    if (err || row.count > 0) return;

    // 醫師ID對應（根據分流表）：
    // d1 = 張醫師 → 推拿治療（肌肉骨骼問題：肩頸痛、腰背痛、肌肉緊繃）
    // d2 = 李醫師 → 針灸治療（神經系統問題：頭痛、失眠、手腳麻痺）
    // d3 = 王醫師 → 綜合治療（內科調理、不確定/多種症狀）
    // d4 = 梁醫師 → 推拿+針灸（運動傷害：扭傷、拉傷、關節痛）

    const questions = [
      {
        id: 1,
        question_zh: "請選擇最能描述您主要症狀的類別：",
        question_en: "Please select the category that best describes your main symptoms:",
        sort_order: 1,
        options: [
          { option_zh: "肌肉骨骼問題（肩頸痛、腰背痛、肌肉緊繃）", option_en: "Musculoskeletal issues (neck/shoulder pain, back pain, muscle tension)", scores: { d1: 10, d2: 2, d3: 3, d4: 5 } },
          { option_zh: "神經系統問題（頭痛、失眠、手腳麻痺）", option_en: "Nervous system issues (headache, insomnia, numbness in hands/feet)", scores: { d1: 2, d2: 10, d3: 3, d4: 4 } },
          { option_zh: "運動傷害（扭傷、拉傷、關節痛）", option_en: "Sports injuries (sprains, strains, joint pain)", scores: { d1: 4, d2: 4, d3: 2, d4: 10 } },
          { option_zh: "內科調理（消化不良、月經不調、體質調理）", option_en: "Internal medicine (digestive issues, menstrual disorders, body conditioning)", scores: { d1: 1, d2: 3, d3: 10, d4: 2 } },
          { option_zh: "不確定 / 多種症狀", option_en: "Unsure / Multiple symptoms", scores: { d1: 3, d2: 3, d3: 10, d4: 3 } }
        ]
      },
      {
        id: 2,
        question_zh: "您的具體症狀是什麼？（可選擇最接近的）",
        question_en: "What are your specific symptoms? (Choose the closest match)",
        sort_order: 2,
        options: [
          { option_zh: "肩頸僵硬疼痛", option_en: "Stiff and painful neck/shoulders", scores: { d1: 8, d2: 3, d3: 2, d4: 4 } },
          { option_zh: "腰背酸痛", option_en: "Lower back pain", scores: { d1: 8, d2: 2, d3: 2, d4: 4 } },
          { option_zh: "頭痛、偏頭痛", option_en: "Headache, migraine", scores: { d1: 2, d2: 8, d3: 3, d4: 3 } },
          { option_zh: "失眠、睡眠質素差", option_en: "Insomnia, poor sleep quality", scores: { d1: 1, d2: 8, d3: 4, d4: 2 } },
          { option_zh: "手腳麻痺、刺痛", option_en: "Numbness or tingling in limbs", scores: { d1: 2, d2: 8, d3: 2, d4: 4 } },
          { option_zh: "扭傷、拉傷", option_en: "Sprains, strains", scores: { d1: 4, d2: 3, d3: 2, d4: 8 } },
          { option_zh: "關節疼痛、活動受限", option_en: "Joint pain, limited mobility", scores: { d1: 4, d2: 4, d3: 2, d4: 8 } },
          { option_zh: "消化不良、胃脹", option_en: "Indigestion, bloating", scores: { d1: 1, d2: 3, d3: 8, d4: 1 } },
          { option_zh: "月經不調、經痛", option_en: "Menstrual disorders, period pain", scores: { d1: 1, d2: 4, d3: 8, d4: 2 } },
          { option_zh: "疲勞、體質虛弱", option_en: "Fatigue, weakness", scores: { d1: 2, d2: 3, d3: 8, d4: 2 } },
          { option_zh: "其他 / 多種症狀", option_en: "Other / Multiple symptoms", scores: { d1: 3, d2: 3, d3: 8, d4: 3 } }
        ]
      },
      {
        id: 3,
        question_zh: "您的症狀持續多長時間？",
        question_en: "How long have your symptoms persisted?",
        sort_order: 3,
        options: [
          { option_zh: "剛發生（1-3天）", option_en: "Just occurred (1-3 days)", scores: { d1: 5, d2: 2, d3: 2, d4: 6 } },
          { option_zh: "1週以內", option_en: "Within 1 week", scores: { d1: 4, d2: 3, d3: 3, d4: 5 } },
          { option_zh: "1-4週", option_en: "1-4 weeks", scores: { d1: 4, d2: 4, d3: 3, d4: 4 } },
          { option_zh: "1-3個月", option_en: "1-3 months", scores: { d1: 3, d2: 5, d3: 4, d4: 4 } },
          { option_zh: "超過3個月（慢性）", option_en: "Over 3 months (chronic)", scores: { d1: 3, d2: 5, d3: 5, d4: 3 } }
        ]
      },
      {
        id: 4,
        question_zh: "症狀的嚴重程度？",
        question_en: "How severe are your symptoms?",
        sort_order: 4,
        options: [
          { option_zh: "輕微，不太影響日常", option_en: "Mild, doesn't affect daily life much", scores: { d1: 4, d2: 3, d3: 4, d4: 3 } },
          { option_zh: "中等，有些不適", option_en: "Moderate, some discomfort", scores: { d1: 4, d2: 4, d3: 3, d4: 4 } },
          { option_zh: "較嚴重，影響工作/生活", option_en: "Severe, affects work/life", scores: { d1: 3, d2: 5, d3: 3, d4: 5 } },
          { option_zh: "非常嚴重，難以忍受", option_en: "Very severe, unbearable", scores: { d1: 2, d2: 5, d3: 4, d4: 5 } }
        ]
      },
      {
        id: 5,
        question_zh: "您偏好的治療方式？",
        question_en: "What is your preferred treatment method?",
        sort_order: 5,
        options: [
          { option_zh: "推拿按摩", option_en: "Tuina massage", scores: { d1: 8, d2: 0, d3: 2, d4: 4 } },
          { option_zh: "針灸治療", option_en: "Acupuncture", scores: { d1: 0, d2: 8, d3: 3, d4: 4 } },
          { option_zh: "推拿+針灸結合", option_en: "Tuina + Acupuncture combined", scores: { d1: 3, d2: 3, d3: 2, d4: 8 } },
          { option_zh: "聽從醫師建議", option_en: "Follow doctor's recommendation", scores: { d1: 3, d2: 3, d3: 6, d4: 3 } },
          { option_zh: "無特別偏好", option_en: "No preference", scores: { d1: 3, d2: 3, d3: 5, d4: 3 } }
        ]
      }
    ];

    // 逐個插入問題和選項（使用 Promise 確保順序執行）
    let questionIndex = 0;
    
    const insertQuestion = () => {
      if (questionIndex >= questions.length) {
        console.log("✅ 已建立醫療分流問題和選項");
        return;
      }
      
      const q = questions[questionIndex];
      db.run(
        "INSERT INTO triage_questions (question_zh, question_en, sort_order, is_active) VALUES (?, ?, ?, 1)",
        [q.question_zh, q.question_en, q.sort_order],
        function(err) {
          if (err) {
            console.error("插入分流問題失敗:", err);
            questionIndex++;
            insertQuestion();
            return;
          }
          
          const questionId = this.lastID;
          let optionIndex = 0;
          
          const insertOption = () => {
            if (optionIndex >= q.options.length) {
              questionIndex++;
              insertQuestion();
              return;
            }
            
            const opt = q.options[optionIndex];
            db.run(
              "INSERT INTO triage_options (question_id, option_zh, option_en, scores, sort_order) VALUES (?, ?, ?, ?, ?)",
              [questionId, opt.option_zh, opt.option_en, JSON.stringify(opt.scores), optionIndex + 1],
              (err) => {
                if (err) console.error("插入分流選項失敗:", err);
                optionIndex++;
                insertOption();
              }
            );
          };
          
          insertOption();
        }
      );
    };
    
    insertQuestion();
  });
}

module.exports = {
  initializeDatabase,
  hashPassword,
  verifyPassword
};
