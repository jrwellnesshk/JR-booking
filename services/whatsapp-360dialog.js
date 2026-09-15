/**
 * 360dialog WhatsApp Business API 服務
 * 官方文檔：https://docs.360dialog.com/
 * 
 * 設置步驟：
 * 1. 註冊 360dialog: https://www.360dialog.com
 * 2. 在 360dialog Hub 連接 WhatsApp Business 帳戶
 * 3. 獲取 API Key
 * 4. 在 .env 文件設置 DIALOG360_API_KEY
 * 
 * 費用說明：
 * - 平台費：免費
 * - 訊息費：按 Meta 官方價格（比 Twilio 便宜）
 * - 香港訊息費約 HK$0.3-0.8/條（視乎類型）
 */

// 從環境變數獲取配置
const DIALOG360_CONFIG = {
  apiKey: process.env.DIALOG360_API_KEY || '',
  // Sandbox API URL（測試用）
  sandboxUrl: 'https://waba-sandbox.360dialog.io/v1',
  // Production API URL（正式用）
  productionUrl: 'https://waba.360dialog.io/v1',
  // 使用 Sandbox 還是 Production
  useSandbox: process.env.DIALOG360_USE_SANDBOX === 'true',
};

/**
 * 獲取 API Base URL
 */
function getBaseUrl() {
  return DIALOG360_CONFIG.useSandbox 
    ? DIALOG360_CONFIG.sandboxUrl 
    : DIALOG360_CONFIG.productionUrl;
}

/**
 * 檢查服務是否已配置
 */
function isConfigured() {
  return !!(DIALOG360_CONFIG.apiKey);
}

/**
 * 格式化電話號碼（移除 + 號和空格）
 * @param {string} phone - 原始電話號碼
 * @returns {string} - 格式化後的號碼
 */
function formatPhoneNumber(phone) {
  let formatted = phone.replace(/[\s\-\(\)\+]/g, '');
  // 如果是 8 位數，假設是香港號碼，加上 852
  if (formatted.length === 8 && !formatted.startsWith('852')) {
    formatted = '852' + formatted;
  }
  return formatted;
}

/**
 * 發送 WhatsApp 文字訊息
 * @param {string} to - 收件人電話號碼
 * @param {string} message - 訊息內容
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendWhatsApp(to, message) {
  if (!isConfigured()) {
    console.warn('⚠️ 360dialog 未配置，跳過 WhatsApp 發送');
    return { success: false, error: '360dialog 未配置' };
  }

  try {
    const formattedPhone = formatPhoneNumber(to);
    console.log(`📱 正在透過 360dialog 發送 WhatsApp 到 ${formattedPhone}...`);

    const response = await fetch(`${getBaseUrl()}/messages`, {
      method: 'POST',
      headers: {
        'D360-API-KEY': DIALOG360_CONFIG.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to: formattedPhone,
        type: 'text',
        text: {
          body: message
        }
      })
    });

    const result = await response.json();

    if (response.ok && result.messages && result.messages[0]) {
      const messageId = result.messages[0].id;
      console.log(`✅ 360dialog WhatsApp 發送成功，Message ID: ${messageId}`);
      return {
        success: true,
        messageId: messageId,
        provider: '360dialog'
      };
    } else {
      const errorMsg = result.error?.message || result.errors?.[0]?.details || '發送失敗';
      console.error(`❌ 360dialog WhatsApp 發送失敗:`, errorMsg);
      return { success: false, error: errorMsg };
    }
  } catch (error) {
    console.error('❌ 360dialog WhatsApp 錯誤:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 發送 WhatsApp 模板訊息（用於主動通知）
 * 注意：24小時外的主動訊息必須使用已審批的模板
 * @param {string} to - 收件人電話號碼
 * @param {string} templateName - 模板名稱
 * @param {string} languageCode - 語言代碼（如 zh_HK, en）
 * @param {Array} components - 模板參數
 */
async function sendTemplateMessage(to, templateName, languageCode = 'zh_HK', components = []) {
  if (!isConfigured()) {
    console.warn('⚠️ 360dialog 未配置');
    return { success: false, error: '360dialog 未配置' };
  }

  try {
    const formattedPhone = formatPhoneNumber(to);
    console.log(`📱 正在發送 WhatsApp 模板訊息到 ${formattedPhone}...`);

    const requestBody = {
      to: formattedPhone,
      type: 'template',
      template: {
        namespace: process.env.DIALOG360_NAMESPACE || 'default',
        name: templateName,
        language: {
          policy: 'deterministic',
          code: languageCode
        }
      }
    };

    // 如果有參數，添加 components
    if (components.length > 0) {
      requestBody.template.components = components;
    }

    const response = await fetch(`${getBaseUrl()}/messages`, {
      method: 'POST',
      headers: {
        'D360-API-KEY': DIALOG360_CONFIG.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const result = await response.json();

    if (response.ok && result.messages && result.messages[0]) {
      console.log(`✅ 模板訊息發送成功，Message ID: ${result.messages[0].id}`);
      return {
        success: true,
        messageId: result.messages[0].id,
        provider: '360dialog'
      };
    } else {
      const errorMsg = result.error?.message || '發送失敗';
      console.error(`❌ 模板訊息發送失敗:`, errorMsg);
      return { success: false, error: errorMsg };
    }
  } catch (error) {
    console.error('❌ 模板訊息錯誤:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 發送預約確認 WhatsApp
 * @param {string} phone - 客戶電話
 * @param {object} booking - 預約資訊
 */
async function sendBookingConfirmationWhatsApp(phone, booking) {
  const servicePrice = booking.price || 0;
  const depositPaid = 100;
  const remainingAmount = Math.max(0, servicePrice - depositPaid);
  
  const priceDisplay = servicePrice > 0 
    ? `HK$${servicePrice}\n💳 已付訂金：HK$${depositPaid}\n💵 到診需付：HK$${remainingAmount}`
    : '請到診所查詢';

  const message = `【寶天JR - 預約確認】

✅ 您的預約已確認！

📋 預約詳情：
👤 姓名：${booking.name}
📅 日期：${booking.date}
⏰ 時間：${booking.time}
🏥 服務：${booking.service || '中醫診症'}
💰 費用：${priceDisplay}

📍 地址：[診所地址]
📞 電話：[診所電話]

如需更改預約，請提前24小時通知。
感謝您選擇寶天JR！🙏`;

  return await sendWhatsApp(phone, message);
}

/**
 * 發送預約提醒 WhatsApp
 * @param {string} phone - 客戶電話
 * @param {object} booking - 預約資訊
 */
async function sendBookingReminderWhatsApp(phone, booking) {
  const message = `【寶天JR - 預約提醒】

⏰ 溫馨提醒：您有即將到來的預約

📋 預約詳情：
👤 姓名：${booking.name}
📅 日期：${booking.date}
⏰ 時間：${booking.time}
🏥 服務：${booking.service || '中醫診症'}

📍 地址：[診所地址]

請準時到達，如需更改請提前通知。
期待您的到來！🙏`;

  return await sendWhatsApp(phone, message);
}

/**
 * 發送預約取消通知
 * @param {string} phone - 客戶電話
 * @param {object} booking - 預約資訊
 * @param {string} reason - 取消原因
 */
async function sendBookingCancellationWhatsApp(phone, booking, reason = '') {
  const reasonText = reason ? `\n📝 原因：${reason}` : '';
  
  const message = `【寶天JR - 預約取消通知】

❌ 您的預約已取消

📋 已取消的預約：
👤 姓名：${booking.name}
📅 日期：${booking.date}
⏰ 時間：${booking.time}${reasonText}

如需重新預約，歡迎聯繫我們。
📞 電話：[診所電話]

感謝您的理解！🙏`;

  return await sendWhatsApp(phone, message);
}

/**
 * 獲取帳戶資訊
 */
async function getAccountInfo() {
  if (!isConfigured()) {
    return { success: false, error: '360dialog 未配置' };
  }

  try {
    const response = await fetch(`${getBaseUrl()}/configs/webhook`, {
      method: 'GET',
      headers: {
        'D360-API-KEY': DIALOG360_CONFIG.apiKey
      }
    });

    const result = await response.json();
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 檢查號碼是否有 WhatsApp
 * @param {string} phone - 電話號碼
 */
async function checkWhatsAppNumber(phone) {
  if (!isConfigured()) {
    return { success: false, error: '360dialog 未配置' };
  }

  try {
    const formattedPhone = formatPhoneNumber(phone);
    
    const response = await fetch(`${getBaseUrl()}/contacts`, {
      method: 'POST',
      headers: {
        'D360-API-KEY': DIALOG360_CONFIG.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        blocking: 'wait',
        contacts: ['+' + formattedPhone]
      })
    });

    const result = await response.json();
    
    if (result.contacts && result.contacts[0]) {
      const contact = result.contacts[0];
      return {
        success: true,
        hasWhatsApp: contact.status === 'valid',
        waId: contact.wa_id
      };
    }
    
    return { success: false, hasWhatsApp: false };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendWhatsApp,
  sendTemplateMessage,
  sendBookingConfirmationWhatsApp,
  sendBookingReminderWhatsApp,
  sendBookingCancellationWhatsApp,
  getAccountInfo,
  checkWhatsAppNumber,
  isConfigured,
  DIALOG360_CONFIG
};
