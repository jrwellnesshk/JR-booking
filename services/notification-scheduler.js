/**
 * 通知排程服務
 * 負責定時發送節氣提醒、節日祝賀、天氣提醒
 */

const cron = require('node-cron');
const solarTermsService = require('./solar-terms');
const lunarHolidaysService = require('./lunar-holidays');
const weatherService = require('./weather');

// ℹ️ SMS 已全面取消，統一使用 WhatsApp

// WhatsApp 服務 - 根據環境變數選擇
const whatsappProvider = process.env.WHATSAPP_PROVIDER || 'twilio';
let whatsappService;
if (whatsappProvider === 'android') {
  whatsappService = require('./whatsapp-android');
} else {
  whatsappService = require('./whatsapp');
}

// 資料庫連接（將在初始化時設定）
let db = null;

/**
 * 初始化排程服務
 * @param {Object} database - SQLite 資料庫連接
 */
function initialize(database) {
  db = database;
  
  // 使用 serialize 確保表按順序創建
  db.serialize(() => {
    // 建立通知設定表
    db.run(`
      CREATE TABLE IF NOT EXISTS notification_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        setting_key TEXT UNIQUE NOT NULL,
        setting_value TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);
    
    // 建立節日自訂表
    db.run(`
      CREATE TABLE IF NOT EXISTS custom_holidays (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        month INTEGER,
        day INTEGER,
        weekday INTEGER,
        week INTEGER,
        emoji TEXT,
        default_message TEXT,
        custom_message TEXT,
        enabled INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);
    
    // 建立通知發送記錄表
    db.run(`
      CREATE TABLE IF NOT EXISTS notification_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        title TEXT,
        message TEXT,
        recipients_count INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        sent_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);
    
    // 建立用戶通知偏好表
    db.run(`
      CREATE TABLE IF NOT EXISTS user_notification_preferences (
        user_id INTEGER PRIMARY KEY,
        receive_solar_terms INTEGER DEFAULT 1,
        receive_holidays INTEGER DEFAULT 1,
        receive_weather INTEGER DEFAULT 1,
        prefer_whatsapp INTEGER DEFAULT 1,
        updated_at TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    
    // 建立節氣自訂訊息表
    db.run(`
      CREATE TABLE IF NOT EXISTS custom_solar_terms (
        name TEXT PRIMARY KEY,
        emoji TEXT NOT NULL,
        default_message TEXT NOT NULL,
        custom_message TEXT,
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `, [], (err) => {
      if (err) {
        console.error('建立節氣自訂訊息表失敗:', err);
        return;
      }
      
      // 表創建完成後，初始化預設設定和節日
      initializeDefaultSettings();
      initializeDefaultHolidays();
      initializeDefaultSolarTerms();
      
      console.log('📅 通知排程服務已初始化');
    });
  });
}

/**
 * 初始化預設設定
 */
function initializeDefaultSettings() {
  const defaultSettings = [
    { key: 'solar_terms_enabled', value: '1' },
    { key: 'holidays_enabled', value: '1' },
    { key: 'weather_enabled', value: '1' },
    { key: 'send_time', value: '08:00' },
    { key: 'weather_cold_threshold', value: '15' }, // 低於15度發送天氣提醒
    { key: 'weather_temp_drop_threshold', value: '5' }, // 溫度下降5度以上發送提醒
    // 預約提醒設定
    { key: 'booking_reminder_enabled', value: '1' }, // 啟用預約提醒
    { key: 'booking_reminder_sameday', value: '1' }, // 到診當日提醒（即日通知）
    { key: 'booking_reminder_1day', value: '1' }, // 到診前一日提醒
    { key: 'booking_reminder_3days', value: '1' }, // 到診前3日提醒
    { key: 'booking_reminder_7days', value: '0' } // 到診前一星期提醒（預設關閉）
  ];
  
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO notification_settings (setting_key, setting_value) VALUES (?, ?)
  `);
  
  defaultSettings.forEach(s => stmt.run(s.key, s.value));
  stmt.finalize();
}

/**
 * 初始化預設節日到資料庫
 */
function initializeDefaultHolidays() {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO custom_holidays 
    (id, name, type, month, day, weekday, week, emoji, default_message, enabled) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  lunarHolidaysService.DEFAULT_HOLIDAYS.forEach(h => {
    stmt.run(
      h.id, h.name, h.type, h.month, h.day || null, 
      h.weekday || null, h.week || null, h.emoji, 
      h.defaultMessage, h.enabled ? 1 : 0
    );
  });
  
  stmt.finalize();
}

/**
 * 初始化預設節氣訊息到資料庫
 */
function initializeDefaultSolarTerms() {
  const SOLAR_TERMS = solarTermsService.SOLAR_TERMS;
  
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO custom_solar_terms 
    (name, emoji, default_message) 
    VALUES (?, ?, ?)
  `);
  
  Object.entries(SOLAR_TERMS).forEach(([name, data]) => {
    stmt.run(name, data.emoji, data.message);
  });
  
  stmt.finalize();
}

/**
 * 獲取所有節氣（包含自訂訊息）
 * @returns {Promise<Array>} - 節氣列表
 */
function getSolarTermsWithCustom() {
  return new Promise((resolve, reject) => {
    const year = new Date().getFullYear();
    const termDates = solarTermsService.calculateSolarTermDates(year);
    
    db.all('SELECT * FROM custom_solar_terms', [], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      
      // 組合節氣日期和自訂訊息
      const result = Object.entries(termDates)
        .map(([name, data]) => {
          const customData = rows.find(r => r.name === name);
          return {
            name,
            date: data.dateString,
            emoji: customData?.emoji || data.emoji,
            default_message: data.message,
            custom_message: customData?.custom_message || null,
            message: customData?.custom_message || data.message
          };
        })
        .sort((a, b) => new Date(a.date) - new Date(b.date));
      
      resolve(result);
    });
  });
}

/**
 * 更新節氣自訂訊息
 * @param {string} name - 節氣名稱
 * @param {Object} data - 更新資料
 */
function updateSolarTerm(name, data) {
  return new Promise((resolve, reject) => {
    const sql = `
      UPDATE custom_solar_terms 
      SET custom_message = ?, emoji = ?, updated_at = datetime('now', 'localtime')
      WHERE name = ?
    `;
    
    db.run(sql, [data.custom_message || null, data.emoji, name], function(err) {
      if (err) reject(err);
      else resolve({ success: true, changes: this.changes });
    });
  });
}

/**
 * 重置節氣為預設訊息
 * @param {string} name - 節氣名稱
 */
function resetSolarTerm(name) {
  return new Promise((resolve, reject) => {
    const sql = `
      UPDATE custom_solar_terms 
      SET custom_message = NULL, updated_at = datetime('now', 'localtime')
      WHERE name = ?
    `;
    
    db.run(sql, [name], function(err) {
      if (err) reject(err);
      else resolve({ success: true, changes: this.changes });
    });
  });
}

/**
 * 獲取節氣訊息（優先使用自訂訊息）
 * @param {string} name - 節氣名稱
 * @returns {Promise<Object>} - 節氣訊息
 */
function getSolarTermMessage(name) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM custom_solar_terms WHERE name = ?', [name], (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      
      if (row) {
        const message = row.custom_message || row.default_message;
        resolve({
          name,
          emoji: row.emoji,
          message,
          isCustom: !!row.custom_message
        });
      } else {
        // 如果資料庫沒有，從原始數據獲取
        const term = solarTermsService.SOLAR_TERMS[name];
        if (term) {
          resolve({
            name,
            emoji: term.emoji,
            message: term.message,
            isCustom: false
          });
        } else {
          resolve(null);
        }
      }
    });
  });
}

/**
 * 獲取通知設定
 * @returns {Promise<Object>} - 設定對象
 */
function getSettings() {
  return new Promise((resolve, reject) => {
    db.all('SELECT setting_key, setting_value FROM notification_settings', [], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      
      const settings = {};
      rows.forEach(row => {
        settings[row.setting_key] = row.setting_value;
      });
      resolve(settings);
    });
  });
}

/**
 * 更新通知設定
 * @param {Object} settings - 設定對象
 */
function updateSettings(settings) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO notification_settings (setting_key, setting_value, updated_at) 
      VALUES (?, ?, datetime('now', 'localtime'))
    `);
    
    Object.entries(settings).forEach(([key, value]) => {
      stmt.run(key, String(value));
    });
    
    stmt.finalize(err => {
      if (err) reject(err);
      else resolve({ success: true });
    });
  });
}

/**
 * 獲取所有節日
 * @returns {Promise<Array>} - 節日列表
 */
function getHolidays() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM custom_holidays ORDER BY month, day', [], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows.map(r => ({
        ...r,
        enabled: r.enabled === 1
      })));
    });
  });
}

/**
 * 更新節日
 * @param {string} id - 節日ID
 * @param {Object} data - 更新資料
 */
function updateHoliday(id, data) {
  return new Promise((resolve, reject) => {
    const fields = [];
    const values = [];
    
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.emoji !== undefined) { fields.push('emoji = ?'); values.push(data.emoji); }
    if (data.custom_message !== undefined) { fields.push('custom_message = ?'); values.push(data.custom_message); }
    if (data.enabled !== undefined) { fields.push('enabled = ?'); values.push(data.enabled ? 1 : 0); }
    
    fields.push("updated_at = datetime('now', 'localtime')");
    values.push(id);
    
    const sql = `UPDATE custom_holidays SET ${fields.join(', ')} WHERE id = ?`;
    
    db.run(sql, values, function(err) {
      if (err) reject(err);
      else resolve({ success: true, changes: this.changes });
    });
  });
}

/**
 * 新增自訂節日
 * @param {Object} holiday - 節日資料
 */
function addHoliday(holiday) {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT INTO custom_holidays 
      (id, name, type, month, day, emoji, default_message, custom_message, enabled) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const id = holiday.id || `custom_${Date.now()}`;
    
    db.run(sql, [
      id, holiday.name, holiday.type || 'solar', holiday.month, holiday.day,
      holiday.emoji || '🎉', holiday.default_message || '', 
      holiday.custom_message || '', holiday.enabled !== false ? 1 : 0
    ], function(err) {
      if (err) reject(err);
      else resolve({ success: true, id: id });
    });
  });
}

/**
 * 刪除節日
 * @param {string} id - 節日ID
 */
function deleteHoliday(id) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM custom_holidays WHERE id = ?', [id], function(err) {
      if (err) reject(err);
      else resolve({ success: true, changes: this.changes });
    });
  });
}

/**
 * 獲取符合條件的用戶列表（已完成個人資料，排除管理員）
 * @returns {Promise<Array>} - 用戶列表
 */
function getEligibleUsers() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT u.id, u.username, u.name, u.phone, u.email,
             COALESCE(p.receive_solar_terms, 1) as receive_solar_terms,
             COALESCE(p.receive_holidays, 1) as receive_holidays,
             COALESCE(p.receive_weather, 1) as receive_weather,
             COALESCE(p.prefer_whatsapp, 1) as prefer_whatsapp
      FROM users u
      LEFT JOIN user_notification_preferences p ON u.id = p.user_id
      WHERE u.name IS NOT NULL AND u.name != ''
        AND u.phone IS NOT NULL AND u.phone != ''
        AND u.profile_completed = 1
        AND (u.role IS NULL OR u.role != 'admin')
    `;
    
    db.all(sql, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

/**
 * 發送通知給用戶（WhatsApp）
 * @param {Object} user - 用戶對象
 * @param {string} message - 通知內容
 * @returns {Promise<Object>} - 發送結果
 */
async function sendNotificationToUser(user, message) {
  const phone = user.phone;
  
  // 獲取系統設定
  const whatsappEnabled = await getSettingValue('whatsapp_notification_enabled');
  
  // 只經 WhatsApp 發送通知（SMS 及 Gmail 已取消，統一使用 WhatsApp）
  if (whatsappEnabled === 'true' && user.prefer_whatsapp && whatsappService.isConfigured()) {
    try {
      const result = await whatsappService.sendWhatsApp(phone, message);
      if (result.success) {
        return { success: true, channel: 'whatsapp', ...result };
      }
    } catch (error) {
      console.error(`WhatsApp 發送失敗 (${phone}):`, error.message);
    }
  }
  
  return { success: false, error: 'WhatsApp 未啟用或未設定' };
}

/**
 * 獲取單個設定值
 */
function getSettingValue(key) {
  return new Promise((resolve, reject) => {
    db.get('SELECT setting_value FROM clinic_settings WHERE setting_key = ?', [key], (err, row) => {
      if (err) reject(err);
      else resolve(row ? row.setting_value : null);
    });
  });
}

/**
 * 發送節氣提醒
 */
async function sendSolarTermNotification() {
  const settings = await getSettings();
  if (settings.solar_terms_enabled !== '1') {
    console.log('📅 節氣提醒已停用');
    return { success: false, reason: 'disabled', message: '節氣提醒功能已停用' };
  }
  
  const todayTerm = solarTermsService.getTodaySolarTerm();
  if (!todayTerm) {
    console.log('📅 今天不是節氣日');
    return { success: false, reason: 'not_today', message: '今天不是節氣日，無需發送' };
  }
  
  console.log(`📅 今天是${todayTerm.name}，開始發送提醒...`);
  
  // 使用自訂訊息（如果有）
  const termData = await getSolarTermMessage(todayTerm.name);
  const message = `【寶天JR提醒您】\n${termData.emoji}${termData.message}`;
  
  const users = await getEligibleUsers();
  const eligibleUsers = users.filter(u => u.receive_solar_terms);
  
  if (eligibleUsers.length === 0) {
    return { success: false, reason: 'no_users', message: '沒有符合條件的用戶' };
  }
  
  let successCount = 0;
  let failedCount = 0;
  
  for (const user of eligibleUsers) {
    const result = await sendNotificationToUser(user, message);
    if (result.success) {
      successCount++;
    } else {
      failedCount++;
    }
    // 避免發送過快
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // 記錄發送日誌
  logNotification('solar_term', todayTerm.name, message, eligibleUsers.length, successCount, failedCount);
  
  console.log(`📅 節氣提醒發送完成: 成功 ${successCount}, 失敗 ${failedCount}`);
  
  return { 
    success: true, 
    term: todayTerm.name,
    totalUsers: eligibleUsers.length,
    successCount, 
    failedCount,
    message: `${todayTerm.name}通知已發送：成功 ${successCount} 人，失敗 ${failedCount} 人`
  };
}

/**
 * 發送節日祝賀
 */
async function sendHolidayNotification() {
  const settings = await getSettings();
  if (settings.holidays_enabled !== '1') {
    console.log('🎊 節日祝賀已停用');
    return { success: false, reason: 'disabled', message: '節日祝賀功能已停用' };
  }
  
  const holidays = await getHolidays();
  const todayHoliday = lunarHolidaysService.getTodayHoliday(holidays);
  
  if (!todayHoliday) {
    console.log('🎊 今天不是節日');
    return { success: false, reason: 'not_today', message: '今天不是節日，無需發送' };
  }
  
  console.log(`🎊 今天是${todayHoliday.name}，開始發送祝賀...`);
  
  const message = lunarHolidaysService.getHolidayMessage(todayHoliday);
  const users = await getEligibleUsers();
  const eligibleUsers = users.filter(u => u.receive_holidays);
  
  if (eligibleUsers.length === 0) {
    return { success: false, reason: 'no_users', message: '沒有符合條件的用戶' };
  }
  
  let successCount = 0;
  let failedCount = 0;
  
  for (const user of eligibleUsers) {
    const result = await sendNotificationToUser(user, message);
    if (result.success) {
      successCount++;
    } else {
      failedCount++;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  logNotification('holiday', todayHoliday.name, message, eligibleUsers.length, successCount, failedCount);
  
  console.log(`🎊 節日祝賀發送完成: 成功 ${successCount}, 失敗 ${failedCount}`);
  
  return { 
    success: true, 
    holiday: todayHoliday.name,
    totalUsers: eligibleUsers.length,
    successCount, 
    failedCount,
    message: `${todayHoliday.name}祝賀已發送：成功 ${successCount} 人，失敗 ${failedCount} 人`
  };
}

/**
 * 發送天氣提醒
 */
async function sendWeatherNotification() {
  const settings = await getSettings();
  if (settings.weather_enabled !== '1') {
    console.log('🌡️ 天氣提醒已停用');
    return { success: false, reason: 'disabled', message: '天氣提醒功能已停用' };
  }
  
  try {
    const weatherData = await weatherService.getWeatherInfo();
    const coldThreshold = parseInt(settings.weather_cold_threshold) || 15;
    
    // 從 weatherData.current 取得溫度
    const currentTemp = weatherData.current?.temperature;
    const weatherDescription = weatherData.forecast?.forecastDesc || '正常';
    const warnings = weatherData.warnings || [];
    
    console.log(`🌡️ 當前溫度: ${currentTemp}°C，寒冷閾值: ${coldThreshold}°C`);
    
    // 檢查是否需要發送天氣提醒
    let shouldSend = false;
    let weatherMessage = '';
    let triggerReason = '';
    
    // 檢查寒冷天氣
    if (currentTemp !== null && currentTemp !== undefined && currentTemp <= coldThreshold) {
      shouldSend = true;
      triggerReason = `溫度 ${currentTemp}°C ≤ 閾值 ${coldThreshold}°C`;
      weatherMessage = `【寶天JR提醒您】\n🌡️天氣轉涼提醒\n\n今日氣溫約 ${currentTemp}°C，天氣${weatherDescription}。\n\n請注意添衣保暖，預防感冒。老人、小孩及長期病患者應特別注意保暖。\n\n如有不適，請及早求醫。`;
    }
    
    // 檢查天氣警告
    if (warnings && warnings.length > 0) {
      shouldSend = true;
      triggerReason = `天氣警告: ${warnings.map(w => w.name || w).join(', ')}`;
      const warningText = warnings.map(w => `⚠️ ${w.name || w}`).join('\n');
      weatherMessage = `【寶天JR提醒您】\n🌡️天氣警告\n\n${warningText}\n\n請注意安全，如有不適請及早求醫。`;
    }
    
    if (!shouldSend) {
      console.log('🌡️ 天氣正常，無需發送提醒');
      return { 
        success: false, 
        reason: 'not_triggered', 
        message: `天氣正常，無需發送提醒\n（當前溫度 ${currentTemp !== undefined ? currentTemp + '°C' : '未知'}，閾值 ${coldThreshold}°C）`,
        currentTemp: currentTemp,
        threshold: coldThreshold
      };
    }
    
    console.log(`🌡️ 觸發天氣提醒: ${triggerReason}，開始發送...`);
    
    const users = await getEligibleUsers();
    const eligibleUsers = users.filter(u => u.receive_weather);
    
    if (eligibleUsers.length === 0) {
      return { success: false, reason: 'no_users', message: '沒有符合條件的用戶' };
    }
    
    let successCount = 0;
    let failedCount = 0;
    
    for (const user of eligibleUsers) {
      const result = await sendNotificationToUser(user, weatherMessage);
      if (result.success) {
        successCount++;
      } else {
        failedCount++;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    logNotification('weather', '天氣提醒', weatherMessage, eligibleUsers.length, successCount, failedCount);
    
    console.log(`🌡️ 天氣提醒發送完成: 成功 ${successCount}, 失敗 ${failedCount}`);
    
    return { 
      success: true, 
      triggerReason,
      currentTemp: currentTemp,
      threshold: coldThreshold,
      totalUsers: eligibleUsers.length,
      successCount, 
      failedCount,
      message: `天氣提醒已發送：成功 ${successCount} 人，失敗 ${failedCount} 人\n（${triggerReason}）`
    };
    
  } catch (error) {
    console.error('🌡️ 獲取天氣資訊失敗:', error.message);
    return { success: false, reason: 'error', message: '獲取天氣資訊失敗: ' + error.message };
  }
}

/**
 * 發送預約提醒通知
 * 根據設定發送即日、前一日、前3日、前7日的預約提醒
 */
async function sendBookingReminders() {
  const settings = await getSettings();
  
  // 檢查是否啟用預約提醒
  if (settings.booking_reminder_enabled !== '1') {
    console.log('📋 預約提醒已停用');
    return { success: false, reason: 'disabled', message: '預約提醒功能已停用' };
  }
  
  // 檢查系統是否啟用 WhatsApp
  const whatsappEnabled = await getSettingValue('whatsapp_notification_enabled');

  if (!whatsappEnabled) {
    console.log('📋 WhatsApp 已停用，無法發送預約提醒');
    return { success: false, reason: 'no_channel', message: 'WhatsApp 已停用' };
  }
  
  const results = {
    day0: { enabled: false, sent: 0, failed: 0, bookings: [] },  // 即日通知
    day1: { enabled: false, sent: 0, failed: 0, bookings: [] },
    day3: { enabled: false, sent: 0, failed: 0, bookings: [] },
    day7: { enabled: false, sent: 0, failed: 0, bookings: [] }
  };
  
  // 獲取今天日期（香港時間）
  const today = new Date();
  const hkOffset = 8 * 60 * 60 * 1000;
  const hkToday = new Date(today.getTime() + hkOffset);
  const todayStr = hkToday.toISOString().split('T')[0];
  
  // 計算提醒日期
  const getDateStr = (daysFromNow) => {
    const date = new Date(hkToday);
    date.setDate(date.getDate() + daysFromNow);
    return date.toISOString().split('T')[0];
  };
  
  const targetDates = {
    day0: todayStr,       // 今天的預約（即日通知）
    day1: getDateStr(1),  // 明天的預約
    day3: getDateStr(3),  // 3天後的預約
    day7: getDateStr(7)   // 7天後的預約
  };
  
  console.log(`📋 開始檢查預約提醒...`);
  console.log(`   今天: ${todayStr}`);
  console.log(`   即日提醒目標日期: ${targetDates.day0}`);
  console.log(`   前1日提醒目標日期: ${targetDates.day1}`);
  console.log(`   前3日提醒目標日期: ${targetDates.day3}`);
  console.log(`   前7日提醒目標日期: ${targetDates.day7}`);
  
  // 獲取需要提醒的預約（使用正確的欄位名 appointment_date）
  const getBookingsForDate = (targetDate) => {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT b.id, b.user_id, b.appointment_date, b.appointment_time, 
               b.doctor_name, b.service_id, b.status,
               u.name as user_name, u.phone as user_phone, u.email as user_email,
               s.name as service_name
        FROM bookings b
        JOIN users u ON b.user_id = u.id
        LEFT JOIN services s ON b.service_id = s.id
        WHERE b.appointment_date = ? 
          AND b.status = 'confirmed'
          AND u.phone IS NOT NULL AND u.phone != ''
      `;
      db.all(sql, [targetDate], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  };
  
  // 發送提醒的輔助函數
  const sendReminderToBooking = async (booking, daysUntil) => {
    let daysText, urgencyEmoji;
    
    if (daysUntil === 0) {
      daysText = '今天';
      urgencyEmoji = '🔴';
    } else if (daysUntil === 1) {
      daysText = '明天';
      urgencyEmoji = '⚠️';
    } else {
      daysText = `${daysUntil}天後`;
      urgencyEmoji = '📅';
    }
    
    const message = `【寶天JR】${urgencyEmoji} 預約提醒

您有一個預約在${daysText}：
📅 日期：${booking.appointment_date}
⏰ 時間：${booking.appointment_time}
👨‍⚕️ 醫師：${booking.doctor_name || '待定'}
💆 服務：${booking.service_name || '一般診症'}

📍 地址：香港島中環德輔道中61-65號華人銀行大廈10樓1002室
📞 電話：2555-1136

${daysUntil === 0 ? '請準時到達！' : '請準時到達，如需更改請提前通知。'}`;

    const user = {
      phone: booking.user_phone,
      prefer_whatsapp: true
    };
    
    return await sendNotificationToUser(user, message);
  };
  
  let totalSuccess = 0;
  let totalFailed = 0;
  
  // 即日提醒（到診當日）
  if (settings.booking_reminder_sameday === '1') {
    results.day0.enabled = true;
    const bookings = await getBookingsForDate(targetDates.day0);
    results.day0.bookings = bookings;
    
    console.log(`📋 即日提醒：找到 ${bookings.length} 個預約`);
    
    for (const booking of bookings) {
      const result = await sendReminderToBooking(booking, 0);
      if (result.success) {
        results.day0.sent++;
        totalSuccess++;
      } else {
        results.day0.failed++;
        totalFailed++;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // 前1日提醒
  if (settings.booking_reminder_1day === '1') {
    results.day1.enabled = true;
    const bookings = await getBookingsForDate(targetDates.day1);
    results.day1.bookings = bookings;
    
    console.log(`📋 前1日提醒：找到 ${bookings.length} 個預約`);
    
    for (const booking of bookings) {
      const result = await sendReminderToBooking(booking, 1);
      if (result.success) {
        results.day1.sent++;
        totalSuccess++;
      } else {
        results.day1.failed++;
        totalFailed++;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // 前3日提醒
  if (settings.booking_reminder_3days === '1') {
    results.day3.enabled = true;
    const bookings = await getBookingsForDate(targetDates.day3);
    results.day3.bookings = bookings;
    
    console.log(`📋 前3日提醒：找到 ${bookings.length} 個預約`);
    
    for (const booking of bookings) {
      const result = await sendReminderToBooking(booking, 3);
      if (result.success) {
        results.day3.sent++;
        totalSuccess++;
      } else {
        results.day3.failed++;
        totalFailed++;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // 前7日提醒
  if (settings.booking_reminder_7days === '1') {
    results.day7.enabled = true;
    const bookings = await getBookingsForDate(targetDates.day7);
    results.day7.bookings = bookings;
    
    console.log(`📋 前7日提醒：找到 ${bookings.length} 個預約`);
    
    for (const booking of bookings) {
      const result = await sendReminderToBooking(booking, 7);
      if (result.success) {
        results.day7.sent++;
        totalSuccess++;
      } else {
        results.day7.failed++;
        totalFailed++;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // 記錄日誌
  const totalBookings = results.day0.bookings.length + results.day1.bookings.length + results.day3.bookings.length + results.day7.bookings.length;
  if (totalBookings > 0) {
    const logMessage = `即日: ${results.day0.sent}/${results.day0.bookings.length}, 前1日: ${results.day1.sent}/${results.day1.bookings.length}, 前3日: ${results.day3.sent}/${results.day3.bookings.length}, 前7日: ${results.day7.sent}/${results.day7.bookings.length}`;
    logNotification('booking_reminder', '預約提醒', logMessage, totalBookings, totalSuccess, totalFailed);
  }
  
  console.log(`📋 預約提醒發送完成: 成功 ${totalSuccess}, 失敗 ${totalFailed}`);
  
  return {
    success: true,
    results,
    totalSuccess,
    totalFailed,
    message: `預約提醒已發送：成功 ${totalSuccess} 人，失敗 ${totalFailed} 人`
  };
}

/**
 * 手動發送預約提醒（用於測試或手動觸發）
 */
async function triggerBookingReminders() {
  console.log('📋 手動觸發預約提醒...');
  return await sendBookingReminders();
}

/**
 * 記錄通知發送日誌
 */
function logNotification(type, title, message, total, success, failed) {
  db.run(`
    INSERT INTO notification_logs (type, title, message, recipients_count, success_count, failed_count)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [type, title, message, total, success, failed]);
}

/**
 * 獲取發送記錄
 * @param {number} limit - 記錄數量
 * @returns {Promise<Array>} - 發送記錄列表
 */
function getNotificationLogs(limit = 50) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT * FROM notification_logs 
      ORDER BY sent_at DESC 
      LIMIT ?
    `, [limit], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// 測試索引追蹤（每次測試自動選下一個）
let testSolarTermIndex = 0;
let testHolidayIndex = 0;

/**
 * 手動發送測試通知
 * @param {string} type - 通知類型 (solar_term, holiday, weather, custom)
 * @param {string} phone - 測試電話號碼
 * @param {string} customMessage - 自訂訊息（可選）
 * @param {string} channel - 發送渠道 (whatsapp)
 */
async function sendTestNotification(type, phone, customMessage = null, channel = null) {
  let message;
  let testInfo = {};
  
  switch (type) {
    case 'solar_term':
      // 使用完整的24節氣列表來測試（按順序循環）
      const year = new Date().getFullYear();
      const allTerms = solarTermsService.getSolarTermList(year);
      const termIndex = testSolarTermIndex % allTerms.length;
      const selectedTerm = allTerms[termIndex];
      // 使用資料庫版本的 getSolarTermMessage（支援自訂訊息）
      const termData = await getSolarTermMessage(selectedTerm.name);
      message = `【寶天JR提醒您】\n${termData.emoji}${termData.message}`;
      testInfo.currentItem = selectedTerm.name;
      testInfo.currentIndex = termIndex + 1;
      testInfo.totalCount = allTerms.length;
      testInfo.nextItem = allTerms[(termIndex + 1) % allTerms.length].name;
      testSolarTermIndex++;
      break;
      
    case 'holiday':
      // 使用所有節日列表來測試（按順序循環）
      const holidays = await getHolidays();
      const enabledHolidays = holidays.filter(h => h.enabled);
      if (enabledHolidays.length === 0) {
        const defaultHoliday = { name: '農曆新年', emoji: '🧧', default_message: '恭賀新禧！祝您龍馬精神，身體健康！' };
        message = lunarHolidaysService.getHolidayMessage(defaultHoliday);
        testInfo.currentItem = defaultHoliday.name;
        testInfo.currentIndex = 1;
        testInfo.totalCount = 1;
        testInfo.nextItem = defaultHoliday.name;
      } else {
        const holidayIndex = testHolidayIndex % enabledHolidays.length;
        const selectedHoliday = enabledHolidays[holidayIndex];
        message = lunarHolidaysService.getHolidayMessage(selectedHoliday);
        testInfo.currentItem = selectedHoliday.name;
        testInfo.currentIndex = holidayIndex + 1;
        testInfo.totalCount = enabledHolidays.length;
        testInfo.nextItem = enabledHolidays[(holidayIndex + 1) % enabledHolidays.length].name;
        testHolidayIndex++;
      }
      break;
      
    case 'weather':
      message = `【寶天JR提醒您】\n🌡️天氣轉涼提醒（測試）\n\n今日氣溫約 15°C，天氣清涼。\n\n請注意添衣保暖，預防感冒。`;
      break;
      
    case 'custom':
      message = customMessage || '【寶天JR】這是一條測試訊息';
      break;
      
    default:
      message = '【寶天JR】這是一條測試訊息';
  }
  
  // 根據指定渠道發送測試通知
  let result;
  
  if (channel === 'whatsapp') {
    // 強制使用 WhatsApp
    if (whatsappService.isConfigured()) {
      try {
        const waResult = await whatsappService.sendWhatsApp(phone, message);
        result = { success: waResult.success, channel: 'whatsapp', ...waResult };
      } catch (error) {
        console.error(`WhatsApp 測試發送失敗 (${phone}):`, error.message);
        result = { success: false, channel: 'whatsapp', error: error.message };
      }
    } else {
      result = { success: false, channel: 'whatsapp', error: 'WhatsApp 服務未設定' };
    }
  } else {
    // 沒指定渠道，使用預設邏輯（優先 WhatsApp）
    const testUser = { phone, prefer_whatsapp: true };
    result = await sendNotificationToUser(testUser, message);
  }
  
  return {
    success: result.success,
    channel: result.channel,
    message: message,
    error: result.error,
    testInfo: testInfo
  };
}

/**
 * 啟動定時任務
 */
function startScheduler() {
  // 每天早上 8:00 執行（節氣、節日、天氣提醒）
  cron.schedule('0 8 * * *', async () => {
    console.log('⏰ 開始執行每日通知任務...');
    
    try {
      await sendSolarTermNotification();
      await sendHolidayNotification();
      await sendWeatherNotification();
      await sendBookingReminders(); // 預約提醒
    } catch (error) {
      console.error('❌ 每日通知任務執行失敗:', error);
    }
  }, {
    timezone: 'Asia/Hong_Kong'
  });
  
  console.log('⏰ 每日通知排程已啟動（每天 08:00 執行，包含預約提醒）');
}

/**
 * 手動執行所有通知（用於測試）
 */
async function runAllNotifications() {
  console.log('🔄 手動執行所有通知...');
  await sendSolarTermNotification();
  await sendHolidayNotification();
  await sendWeatherNotification();
  await sendBookingReminders();
  console.log('✅ 所有通知執行完成');
}

module.exports = {
  initialize,
  startScheduler,
  getSettings,
  updateSettings,
  getHolidays,
  updateHoliday,
  addHoliday,
  deleteHoliday,
  getNotificationLogs,
  getEligibleUsers,
  sendTestNotification,
  sendSolarTermNotification,
  sendHolidayNotification,
  sendWeatherNotification,
  sendBookingReminders,
  triggerBookingReminders,
  runAllNotifications,
  // 節氣管理
  getSolarTermsWithCustom,
  getSolarTermMessage,
  updateSolarTerm,
  resetSolarTerm
};
