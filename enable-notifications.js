// 臨時腳本：開啟 SMS 和 WhatsApp 通知
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'clinic.db');
console.log('資料庫路徑:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('無法連接資料庫:', err);
    process.exit(1);
  }
  console.log('已連接資料庫');
});

db.serialize(() => {
  // 先確保表存在
  db.run(`
    CREATE TABLE IF NOT EXISTS clinic_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_key TEXT UNIQUE NOT NULL,
      setting_value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('建表錯誤:', err);
    else console.log('✅ 確保 clinic_settings 表存在');
  });

  // 插入 SMS 設定
  db.run(
    "INSERT OR REPLACE INTO clinic_settings (setting_key, setting_value) VALUES ('sms_notification_enabled', 'true')",
    function(err) {
      if (err) console.error('SMS 設定錯誤:', err);
      else console.log('✅ SMS 通知已開啟');
    }
  );

  // 插入 WhatsApp 設定
  db.run(
    "INSERT OR REPLACE INTO clinic_settings (setting_key, setting_value) VALUES ('whatsapp_notification_enabled', 'true')",
    function(err) {
      if (err) console.error('WhatsApp 設定錯誤:', err);
      else console.log('✅ WhatsApp 通知已開啟');
    }
  );

  // 顯示所有設定
  db.all('SELECT * FROM clinic_settings', (err, rows) => {
    if (err) {
      console.error('查詢錯誤:', err);
    } else {
      console.log('\n目前所有診所設定:');
      console.table(rows);
    }
    
    db.close((err) => {
      if (err) console.error('關閉資料庫錯誤:', err);
      else console.log('\n已關閉資料庫連接');
    });
  });
});
