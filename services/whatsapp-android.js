/**
 * Android WhatsApp Gateway 服務
 * 使用 Android 手機作為 WhatsApp 發送器（僅供測試）
 * ⚠️ 警告：非官方方式，正式使用請改用 WhatsApp Business API
 */

// 從環境變數獲取配置
const ANDROID_WHATSAPP_GATEWAY_URL = process.env.ANDROID_WHATSAPP_GATEWAY_URL;
const ANDROID_WHATSAPP_API_KEY = process.env.ANDROID_WHATSAPP_GATEWAY_API_KEY;

/**
 * 檢查服務是否已配置
 */
function isConfigured() {
  return !!(ANDROID_WHATSAPP_GATEWAY_URL);
}

/**
 * 發送 WhatsApp 訊息
 * @param {string} to - 收件人電話號碼（需包含國碼，如 +852XXXXXXXX）
 * @param {string} message - 訊息內容
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendWhatsApp(to, message) {
  if (!isConfigured()) {
    return { success: false, error: 'Android WhatsApp Gateway 尚未配置' };
  }

  try {
    // 格式化電話號碼（移除空格、連字符，保留+號）
    let formattedPhone = to.replace(/[\s-]/g, '');
    // 確保有國碼
    if (!formattedPhone.startsWith('+')) {
      formattedPhone = '+852' + formattedPhone; // 默認香港
    }
    // 移除 + 號（某些 Gateway App 不需要）
    const phoneWithoutPlus = formattedPhone.replace('+', '');
    
    // 構建 API URL（適用於多種 WhatsApp Gateway App）
    const url = new URL('/send', ANDROID_WHATSAPP_GATEWAY_URL);
    
    // 請求參數
    const params = new URLSearchParams({
      phone: phoneWithoutPlus,
      message: message
    });
    
    if (ANDROID_WHATSAPP_API_KEY) {
      params.append('api_key', ANDROID_WHATSAPP_API_KEY);
    }

    const response = await fetch(`${url.toString()}?${params.toString()}`, {
      method: 'GET',
      timeout: 30000
    });

    const result = await response.text();
    
    if (response.ok || result.includes('OK') || result.includes('success') || result.includes('sent')) {
      console.log(`✅ Android WhatsApp Gateway 發送成功: ${formattedPhone}`);
      return { 
        success: true, 
        messageId: `android_wa_${Date.now()}`,
        provider: 'Android WhatsApp Gateway'
      };
    } else {
      console.error(`❌ Android WhatsApp Gateway 發送失敗:`, result);
      return { success: false, error: result };
    }
  } catch (error) {
    console.error('❌ Android WhatsApp Gateway 錯誤:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 發送預約確認 WhatsApp
 */
async function sendBookingConfirmationWhatsApp(to, bookingDetails) {
  const { patientName, date, time, service, doctor } = bookingDetails;
  
  const message = `🏥 *寶天醫館* - 預約確認

${patientName} 您好！

您的預約已確認 ✅

📅 *日期*：${date}
⏰ *時間*：${time}
${service ? `📋 *服務*：${service}` : ''}
${doctor ? `👨‍⚕️ *醫師*：${doctor}` : ''}

如需更改或取消，請致電診所或回覆此訊息。

感謝您選擇寶天醫館！`;

  return sendWhatsApp(to, message);
}

/**
 * 發送預約提醒 WhatsApp
 */
async function sendBookingReminderWhatsApp(to, bookingDetails) {
  const { patientName, date, time } = bookingDetails;
  
  const message = `🏥 *寶天醫館* - 預約提醒

${patientName} 您好！

提醒您明天有預約 📌

📅 *日期*：${date}
⏰ *時間*：${time}

請準時到達，如需更改請提前聯繫我們。

祝您健康！🙏`;

  return sendWhatsApp(to, message);
}

/**
 * 發送預約取消 WhatsApp
 */
async function sendBookingCancellationWhatsApp(to, bookingDetails) {
  const { patientName, date, time, reason } = bookingDetails;
  
  const message = `🏥 *寶天醫館* - 預約取消通知

${patientName} 您好！

您以下的預約已取消：

📅 *日期*：${date}
⏰ *時間*：${time}
${reason ? `📝 *原因*：${reason}` : ''}

如需重新預約，請訪問我們的網站或致電診所。

感謝您的理解！`;

  return sendWhatsApp(to, message);
}

/**
 * 測試連接
 */
async function testConnection() {
  if (!isConfigured()) {
    return { success: false, error: 'Android WhatsApp Gateway 尚未配置' };
  }

  try {
    const url = new URL('/status', ANDROID_WHATSAPP_GATEWAY_URL);
    const response = await fetch(url.toString(), { 
      method: 'GET',
      timeout: 10000 
    });
    
    if (response.ok) {
      return { success: true, message: 'Android WhatsApp Gateway 連接正常' };
    } else {
      return { success: false, error: '無法連接到 Android WhatsApp Gateway' };
    }
  } catch (error) {
    return { success: false, error: `連接失敗: ${error.message}` };
  }
}

module.exports = {
  isConfigured,
  sendWhatsApp,
  sendBookingConfirmationWhatsApp,
  sendBookingReminderWhatsApp,
  sendBookingCancellationWhatsApp,
  testConnection
};
