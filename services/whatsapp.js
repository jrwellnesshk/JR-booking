/**
 * WhatsApp 通知服務 - 使用 Twilio WhatsApp API
 * 
 * 設置步驟：
 * 1. 登入 Twilio Console: https://console.twilio.com
 * 2. 前往 Messaging > Try it out > Send a WhatsApp message
 * 3. 按照指示啟用 WhatsApp Sandbox（測試用）或申請正式 WhatsApp Business API
 * 4. 獲取 WhatsApp 發送號碼（Sandbox 通常是 +14155238886）
 * 
 * 注意：
 * - Sandbox 模式下，用戶需要先發送 "join <your-sandbox-keyword>" 到 Twilio WhatsApp 號碼
 * - 正式 WhatsApp Business API 需要通過 Meta 審核
 */

// ⚠️ 重要：在生產環境中，這些憑證應該放在環境變數中
const TWILIO_CONFIG = {
  accountSid: process.env.TWILIO_ACCOUNT_SID || 'YOUR_ACCOUNT_SID',
  authToken: process.env.TWILIO_AUTH_TOKEN || 'YOUR_AUTH_TOKEN',
  // WhatsApp Sandbox 號碼（測試用）
  whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
};

// 初始化 Twilio 客戶端
let twilioClient = null;

const initTwilioClient = () => {
  if (!twilioClient && TWILIO_CONFIG.accountSid !== 'YOUR_ACCOUNT_SID') {
    try {
      const twilio = require('twilio');
      twilioClient = twilio(TWILIO_CONFIG.accountSid, TWILIO_CONFIG.authToken);
      console.log('✅ Twilio WhatsApp 客戶端初始化成功');
    } catch (error) {
      console.error('❌ Twilio WhatsApp 客戶端初始化失敗:', error.message);
    }
  }
  return twilioClient;
};

/**
 * 查詢訊息狀態
 * @param {string} messageSid - 訊息 SID
 * @returns {Promise<object>} - 訊息狀態
 */
const getMessageStatus = async (messageSid) => {
  try {
    const client = initTwilioClient();
    if (!client) return null;
    
    const message = await client.messages(messageSid).fetch();
    return {
      sid: message.sid,
      status: message.status,
      errorCode: message.errorCode,
      errorMessage: message.errorMessage,
      dateSent: message.dateSent,
      dateUpdated: message.dateUpdated
    };
  } catch (error) {
    console.error('查詢訊息狀態失敗:', error.message);
    return null;
  }
};

/**
 * 等待並驗證訊息發送狀態
 * Twilio 狀態流程: queued -> sending -> sent -> delivered (成功)
 *                  queued -> sending -> failed/undelivered (失敗)
 * @param {string} messageSid - 訊息 SID
 * @param {number} maxWaitMs - 最大等待時間（毫秒）
 * @param {number} intervalMs - 檢查間隔（毫秒）
 * @returns {Promise<object>} - 最終狀態
 */
const waitForDeliveryStatus = async (messageSid, maxWaitMs = 10000, intervalMs = 2000) => {
  const startTime = Date.now();
  const terminalStatuses = ['delivered', 'read', 'sent', 'failed', 'undelivered'];
  
  while (Date.now() - startTime < maxWaitMs) {
    const status = await getMessageStatus(messageSid);
    if (!status) break;
    
    console.log(`📊 訊息 ${messageSid} 狀態: ${status.status}`);
    
    if (terminalStatuses.includes(status.status)) {
      return status;
    }
    
    // 等待後再檢查
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  
  // 超時返回最後狀態
  return await getMessageStatus(messageSid);
};

/**
 * 發送 WhatsApp 訊息
 * @param {string} to - 收件人電話號碼（需要包含國際區號，如 +852XXXXXXXX）
 * @param {string} message - 訊息內容
 * @param {boolean} verifyDelivery - 是否等待驗證發送狀態（預設 true）
 * @returns {Promise<object>} - 發送結果
 */
const sendWhatsApp = async (to, message, verifyDelivery = true) => {
  try {
    const client = initTwilioClient();
    
    if (!client) {
      console.warn('⚠️ Twilio 未配置，跳過 WhatsApp 發送');
      return { success: false, error: 'Twilio 未配置' };
    }

    // 確保電話號碼格式正確
    let formattedPhone = to.replace(/\D/g, '');
    if (!formattedPhone.startsWith('852') && formattedPhone.length === 8) {
      // 假設是香港號碼
      formattedPhone = '852' + formattedPhone;
    }
    formattedPhone = 'whatsapp:+' + formattedPhone;

    console.log(`📱 正在發送 WhatsApp 到 ${formattedPhone}...`);

    const result = await client.messages.create({
      body: message,
      from: TWILIO_CONFIG.whatsappNumber,
      to: formattedPhone
    });

    console.log(`📤 WhatsApp 已提交，SID: ${result.sid}，初始狀態: ${result.status}`);
    
    // 驗證發送狀態
    if (verifyDelivery) {
      console.log(`⏳ 正在驗證發送狀態...`);
      const finalStatus = await waitForDeliveryStatus(result.sid, 10000, 2000);
      
      if (finalStatus) {
        const isSuccess = ['delivered', 'read', 'sent'].includes(finalStatus.status);
        const isFailed = ['failed', 'undelivered'].includes(finalStatus.status);
        
        if (isFailed) {
          // 解析常見錯誤碼
          let errorDescription = finalStatus.errorMessage || '發送失敗';
          if (finalStatus.errorCode === 63003) {
            errorDescription = '該號碼未註冊 WhatsApp 或未加入 Sandbox';
          } else if (finalStatus.errorCode === 63015) {
            errorDescription = '該號碼未加入 WhatsApp Sandbox（測試模式下，收件人需要先發送 join 指令）';
          } else if (finalStatus.errorCode === 63016) {
            errorDescription = '該號碼未開通 WhatsApp';
          } else if (finalStatus.errorCode === 21608) {
            errorDescription = '該號碼未加入 WhatsApp Sandbox（測試模式限制）';
          }
          
          console.error(`❌ WhatsApp 發送失敗: ${errorDescription} (錯誤碼: ${finalStatus.errorCode})`);
          return { 
            success: false, 
            sid: result.sid,
            status: finalStatus.status,
            errorCode: finalStatus.errorCode,
            error: errorDescription
          };
        }
        
        if (isSuccess) {
          console.log(`✅ WhatsApp 發送成功，最終狀態: ${finalStatus.status}`);
          return { 
            success: true, 
            sid: result.sid,
            status: finalStatus.status 
          };
        }
      }
      
      // 狀態不確定（可能還在處理中）
      console.warn(`⚠️ WhatsApp 發送狀態未確定，請稍後檢查: ${result.sid}`);
      return { 
        success: true, 
        sid: result.sid,
        status: result.status,
        pending: true,
        warning: '訊息已提交但狀態未確認，可能稍後才送達'
      };
    }
    
    // 不驗證，直接返回
    console.log(`✅ WhatsApp 已提交，SID: ${result.sid}`);
    return { 
      success: true, 
      sid: result.sid,
      status: result.status 
    };

  } catch (error) {
    // 處理 Twilio API 即時錯誤
    let errorDescription = error.message;
    if (error.code === 21211) {
      errorDescription = '無效的電話號碼格式';
    } else if (error.code === 21608) {
      errorDescription = '該號碼未加入 WhatsApp Sandbox（測試模式需要先加入）';
    } else if (error.code === 63003) {
      errorDescription = '該號碼未註冊 WhatsApp';
    }
    
    console.error('❌ WhatsApp 發送失敗:', errorDescription);
    return { 
      success: false, 
      error: error.message 
    };
  }
};

/**
 * 發送預約確認 WhatsApp
 * @param {string} phone - 客戶電話
 * @param {object} booking - 預約資訊
 */
const sendBookingConfirmationWhatsApp = async (phone, booking) => {
  // 計算剩餘需付款項（服務價格 - $100 訂金）
  const servicePrice = booking.price || 0;
  const depositPaid = 100;
  const remainingAmount = Math.max(0, servicePrice - depositPaid);
  
  const priceDisplay = servicePrice > 0 
    ? `HK$${servicePrice}\n💳 *已付訂金：* HK$${depositPaid}\n💵 *到診需付：* HK$${remainingAmount}`
    : '請到診所查詢';
  
  const message = `🏥 *寶天JR - 預約確認*

您好！您的預約已確認 ✅

📅 *日期：* ${booking.date}
⏰ *時間：* ${booking.time}
👨‍⚕️ *醫師：* ${booking.doctorName}
💆 *服務：* ${booking.serviceName}
💰 *服務費用：* ${priceDisplay}

📍 *地址：* 香港島中環德輔道中61-65號華人銀行大廈10樓1002室
📞 *聯絡電話：* 2555-1136

如需更改或取消預約，請登入系統或致電診所。

感謝您選擇寶天JR！🙏`;

  return await sendWhatsApp(phone, message);
};

/**
 * 發送預約提醒 WhatsApp
 * @param {string} phone - 客戶電話
 * @param {object} booking - 預約資訊
 */
const sendBookingReminderWhatsApp = async (phone, booking) => {
  const message = `🔔 *寶天JR - 預約提醒*

您好！提醒您明天有預約：

📅 *日期：* ${booking.date}
⏰ *時間：* ${booking.time}
👨‍⚕️ *醫師：* ${booking.doctorName}

請準時到達，如需取消請提前24小時通知。

祝您健康！💚`;

  return await sendWhatsApp(phone, message);
};

/**
 * 發送預約取消 WhatsApp
 * @param {string} phone - 客戶電話
 * @param {object} booking - 預約資訊
 */
const sendBookingCancellationWhatsApp = async (phone, booking) => {
  const message = `📋 *寶天JR - 預約已取消*

您的預約已成功取消：

📅 *原日期：* ${booking.date}
⏰ *原時間：* ${booking.time}
👨‍⚕️ *醫師：* ${booking.doctorName}

如需重新預約，請登入系統或致電診所。

祝您健康！💚`;

  return await sendWhatsApp(phone, message);
};

/**
 * 發送預約更改 WhatsApp
 * @param {string} phone - 客戶電話
 * @param {object} oldBooking - 舊預約資訊
 * @param {object} newBooking - 新預約資訊
 */
const sendBookingUpdateWhatsApp = async (phone, oldBooking, newBooking) => {
  const message = `📝 *寶天JR - 預約已更改*

您的預約已成功更改：

*原預約：*
📅 ${oldBooking.date} ${oldBooking.time}

*新預約：*
📅 ${newBooking.date} ${newBooking.time}
👨‍⚕️ 醫師：${newBooking.doctorName}

請按新時間到達，謝謝！💚`;

  return await sendWhatsApp(phone, message);
};

/**
 * 發送 WhatsApp 模板訊息（正式 API 用）
 * 用於 24 小時外的主動通知
 * @param {string} to - 收件人電話號碼
 * @param {string} templateName - 模板名稱（如 appointment_reminder）
 * @param {Array<string>} parameters - 模板參數
 * @returns {Promise<object>} - 發送結果
 */
const sendTemplateMessage = async (to, templateName, parameters = []) => {
  try {
    const client = initTwilioClient();
    
    if (!client) {
      console.warn('⚠️ Twilio 未配置，跳過 WhatsApp 發送');
      return { success: false, error: 'Twilio 未配置' };
    }

    // 確保電話號碼格式正確
    let formattedPhone = to.replace(/\D/g, '');
    if (!formattedPhone.startsWith('852') && formattedPhone.length === 8) {
      formattedPhone = '852' + formattedPhone;
    }
    formattedPhone = 'whatsapp:+' + formattedPhone;

    console.log(`📱 正在發送 WhatsApp 模板訊息到 ${formattedPhone}...`);
    console.log(`📝 模板: ${templateName}, 參數: ${parameters.join(', ')}`);

    // 構建 Content SID 或使用模板
    // 注意：Twilio 的模板訊息使用 contentSid 或 contentVariables
    const messageOptions = {
      from: TWILIO_CONFIG.whatsappNumber,
      to: formattedPhone,
    };

    // 如果有設定 Content SID（預先在 Twilio 創建的模板）
    if (process.env.TWILIO_CONTENT_SID_PREFIX) {
      const contentSid = process.env[`TWILIO_CONTENT_SID_${templateName.toUpperCase()}`];
      if (contentSid) {
        messageOptions.contentSid = contentSid;
        if (parameters.length > 0) {
          const contentVariables = {};
          parameters.forEach((param, index) => {
            contentVariables[(index + 1).toString()] = param;
          });
          messageOptions.contentVariables = JSON.stringify(contentVariables);
        }
      }
    }

    // 如果冇 Content SID，fallback 用普通訊息（Sandbox 模式）
    if (!messageOptions.contentSid) {
      // Sandbox 模式下直接發送普通訊息
      console.log('⚠️ 未找到模板 Content SID，使用普通訊息模式');
      return { success: false, error: '模板未設定，請在 Twilio Console 創建 Content Template' };
    }

    const result = await client.messages.create(messageOptions);

    console.log(`✅ WhatsApp 模板訊息發送成功，SID: ${result.sid}`);
    return { 
      success: true, 
      sid: result.sid,
      status: result.status,
      isTemplate: true
    };

  } catch (error) {
    console.error('❌ WhatsApp 模板訊息發送失敗:', error.message);
    return { 
      success: false, 
      error: error.message 
    };
  }
};

/**
 * 發送預約確認（使用模板，正式 API）
 * @param {string} phone - 客戶電話
 * @param {object} booking - 預約資訊
 */
const sendBookingConfirmationTemplate = async (phone, booking) => {
  return await sendTemplateMessage(phone, 'appointment_confirmation', [
    booking.name,
    booking.date,
    booking.time,
    booking.service || '中醫診症'
  ]);
};

/**
 * 發送預約提醒（使用模板，正式 API）
 * @param {string} phone - 客戶電話
 * @param {object} booking - 預約資訊
 */
const sendBookingReminderTemplate = async (phone, booking) => {
  return await sendTemplateMessage(phone, 'appointment_reminder', [
    booking.name,
    booking.date,
    booking.time
  ]);
};

/**
 * 發送節氣/節日祝福（使用模板，正式 API）
 * @param {string} phone - 客戶電話
 * @param {string} message - 祝福訊息
 */
const sendSeasonalGreetingTemplate = async (phone, message) => {
  return await sendTemplateMessage(phone, 'seasonal_greeting', [message]);
};

/**
 * 檢查 Twilio 配置是否有效
 */
const isConfigured = () => {
  return TWILIO_CONFIG.accountSid !== 'YOUR_ACCOUNT_SID' && 
         TWILIO_CONFIG.authToken !== 'YOUR_AUTH_TOKEN';
};

module.exports = {
  sendWhatsApp,
  sendBookingConfirmationWhatsApp,
  sendBookingReminderWhatsApp,
  sendBookingCancellationWhatsApp,
  sendBookingUpdateWhatsApp,
  sendTemplateMessage,
  sendBookingConfirmationTemplate,
  sendBookingReminderTemplate,
  sendSeasonalGreetingTemplate,
  isConfigured,
  getMessageStatus,
  waitForDeliveryStatus,
  TWILIO_CONFIG
};
