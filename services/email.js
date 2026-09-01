/**
 * 電郵服務模組
 * 用於發送驗證碼、預約通知等郵件
 */

const nodemailer = require('nodemailer');

// 郵件傳輸配置
// 建議使用環境變數儲存敏感資料
const transporter = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS 
  }
});

// 診所資訊（可從資料庫讀取）
const CLINIC_INFO = {
  name: '寶天醫館',
  phone: '2555-1136',
  address: '香港九龍新蒲崗大有街3號萬迪廣場9樓E鋪',
  email: 'info@potinhk.com'
};

// 寄件人電郵：以 EMAIL_USER 為準；未設定時退回診所官方電郵（唔好再用個人 Gmail）
const SENDER_EMAIL = process.env.EMAIL_USER || CLINIC_INFO.email;
if (!process.env.EMAIL_USER) {
  console.warn('⚠️ EMAIL_USER 未設定，寄件人將使用診所官方電郵:', SENDER_EMAIL, '（建議喺 .env 設 EMAIL_USER / EMAIL_PASS 以正常發送個人化郵件）');
}

/**
 * 發送驗證碼郵件（忘記密碼用）
 */
async function sendVerificationCode(to, code, username) {
  const mailOptions = {
    from: `"${CLINIC_INFO.name}" <${SENDER_EMAIL}>`,
    to: to,
    subject: `【${CLINIC_INFO.name}】密碼重設驗證碼`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; }
          .code-box { background: #fff; border: 2px dashed #10b981; padding: 20px; text-align: center; margin: 20px 0; border-radius: 10px; }
          .code { font-size: 36px; font-weight: bold; color: #10b981; letter-spacing: 8px; }
          .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; }
          .footer { background: #1e293b; color: #94a3b8; padding: 20px; text-align: center; font-size: 12px; border-radius: 0 0 10px 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin:0;">🏥 ${CLINIC_INFO.name}</h1>
            <p style="margin:10px 0 0 0;">密碼重設驗證碼</p>
          </div>
          <div class="content">
            <p>親愛的 <strong>${username}</strong>，您好！</p>
            <p>我們收到您的密碼重設請求。請使用以下驗證碼完成密碼重設：</p>
            
            <div class="code-box">
              <p style="margin:0 0 10px 0; color:#64748b;">您的驗證碼</p>
              <div class="code">${code}</div>
              <p style="margin:10px 0 0 0; color:#64748b; font-size:14px;">有效期限：10 分鐘</p>
            </div>
            
            <div class="warning">
              <strong>⚠️ 安全提示：</strong><br>
              • 請勿將驗證碼告知任何人<br>
              • 如非本人操作，請忽略此郵件<br>
              • 驗證碼過期後需重新申請
            </div>
            
            <p>如有任何問題，歡迎聯繫我們。</p>
          </div>
          <div class="footer">
            <p>${CLINIC_INFO.name}</p>
            <p>📍 ${CLINIC_INFO.address}</p>
            <p>📞 ${CLINIC_INFO.phone}</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ 驗證碼郵件已發送:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ 發送驗證碼郵件失敗:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 發送預約確認郵件
 */
async function sendBookingConfirmation(to, booking) {
  const mailOptions = {
    from: `"${CLINIC_INFO.name}" <${SENDER_EMAIL}>`,
    to: to,
    subject: `【${CLINIC_INFO.name}】預約確認 - ${booking.date} ${booking.time}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; }
          .booking-card { background: #fff; border-radius: 10px; padding: 20px; margin: 20px 0; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .booking-item { display: flex; padding: 10px 0; border-bottom: 1px solid #e2e8f0; }
          .booking-item:last-child { border-bottom: none; }
          .booking-label { color: #64748b; width: 100px; }
          .booking-value { font-weight: 600; color: #1e293b; }
          .success-badge { background: #dcfce7; color: #166534; padding: 10px 20px; border-radius: 20px; display: inline-block; margin-bottom: 20px; }
          .reminder { background: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; }
          .footer { background: #1e293b; color: #94a3b8; padding: 20px; text-align: center; font-size: 12px; border-radius: 0 0 10px 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin:0;">🏥 ${CLINIC_INFO.name}</h1>
            <p style="margin:10px 0 0 0;">預約確認通知</p>
          </div>
          <div class="content">
            <div class="success-badge">✅ 預約成功</div>
            
            <p>親愛的 <strong>${booking.customerName}</strong>，您好！</p>
            <p>感謝您的預約，以下是您的預約詳情：</p>
            
            <div class="booking-card">
              <div class="booking-item">
                <span class="booking-label">📅 日期</span>
                <span class="booking-value">${booking.date}</span>
              </div>
              <div class="booking-item">
                <span class="booking-label">⏰ 時間</span>
                <span class="booking-value">${booking.time}</span>
              </div>
              <div class="booking-item">
                <span class="booking-label">👨‍⚕️ 醫師</span>
                <span class="booking-value">${booking.doctorName}</span>
              </div>
              <div class="booking-item">
                <span class="booking-label">💊 服務</span>
                <span class="booking-value">${booking.serviceName}</span>
              </div>
              ${booking.notes ? `
              <div class="booking-item">
                <span class="booking-label">📝 備註</span>
                <span class="booking-value">${booking.notes}</span>
              </div>
              ` : ''}
            </div>
            
            <div class="reminder">
              <strong>📌 溫馨提示：</strong><br>
              • 請提前 10-15 分鐘到達診所<br>
              • 如需更改或取消預約，請登入系統或致電診所<br>
              • 請攜帶身份證明文件
            </div>
            
            <p>如有任何問題，歡迎聯繫我們。</p>
          </div>
          <div class="footer">
            <p>${CLINIC_INFO.name}</p>
            <p>📍 ${CLINIC_INFO.address}</p>
            <p>📞 ${CLINIC_INFO.phone}</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ 預約確認郵件已發送:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ 發送預約確認郵件失敗:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 發送預約更改通知郵件
 */
async function sendBookingUpdate(to, oldBooking, newBooking) {
  const mailOptions = {
    from: `"${CLINIC_INFO.name}" <${SENDER_EMAIL}>`,
    to: to,
    subject: `【${CLINIC_INFO.name}】預約更改通知 - ${newBooking.date} ${newBooking.time}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; }
          .update-badge { background: #fef3c7; color: #92400e; padding: 10px 20px; border-radius: 20px; display: inline-block; margin-bottom: 20px; }
          .comparison { display: table; width: 100%; margin: 20px 0; }
          .comparison-row { display: table-row; }
          .comparison-cell { display: table-cell; padding: 15px; background: #fff; border: 1px solid #e2e8f0; }
          .old-booking { background: #fef2f2; }
          .new-booking { background: #f0fdf4; }
          .arrow { text-align: center; font-size: 24px; padding: 10px; }
          .footer { background: #1e293b; color: #94a3b8; padding: 20px; text-align: center; font-size: 12px; border-radius: 0 0 10px 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin:0;">🏥 ${CLINIC_INFO.name}</h1>
            <p style="margin:10px 0 0 0;">預約更改通知</p>
          </div>
          <div class="content">
            <div class="update-badge">📝 預約已更改</div>
            
            <p>親愛的 <strong>${newBooking.customerName}</strong>，您好！</p>
            <p>您的預約已成功更改，請確認以下資訊：</p>
            
            <table style="width:100%; border-collapse: collapse; margin: 20px 0;">
              <tr>
                <th style="background:#fef2f2; padding:15px; border:1px solid #e2e8f0;">❌ 原預約</th>
                <th style="background:#f0fdf4; padding:15px; border:1px solid #e2e8f0;">✅ 新預約</th>
              </tr>
              <tr>
                <td style="padding:15px; border:1px solid #e2e8f0; vertical-align:top;">
                  📅 ${oldBooking.date}<br>
                  ⏰ ${oldBooking.time}<br>
                  👨‍⚕️ ${oldBooking.doctorName}<br>
                  💊 ${oldBooking.serviceName}
                </td>
                <td style="padding:15px; border:1px solid #e2e8f0; vertical-align:top;">
                  📅 ${newBooking.date}<br>
                  ⏰ ${newBooking.time}<br>
                  👨‍⚕️ ${newBooking.doctorName}<br>
                  💊 ${newBooking.serviceName}
                </td>
              </tr>
            </table>
            
            <p>如有任何問題，歡迎聯繫我們。</p>
          </div>
          <div class="footer">
            <p>${CLINIC_INFO.name}</p>
            <p>📍 ${CLINIC_INFO.address}</p>
            <p>📞 ${CLINIC_INFO.phone}</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ 預約更改郵件已發送:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ 發送預約更改郵件失敗:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 發送預約取消通知郵件
 */
async function sendBookingCancellation(to, booking) {
  const mailOptions = {
    from: `"${CLINIC_INFO.name}" <${SENDER_EMAIL}>`,
    to: to,
    subject: `【${CLINIC_INFO.name}】預約取消通知 - ${booking.date} ${booking.time}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #ef4444, #dc2626); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; }
          .cancel-badge { background: #fef2f2; color: #991b1b; padding: 10px 20px; border-radius: 20px; display: inline-block; margin-bottom: 20px; }
          .booking-card { background: #fff; border-radius: 10px; padding: 20px; margin: 20px 0; box-shadow: 0 2px 10px rgba(0,0,0,0.1); opacity: 0.7; }
          .booking-item { padding: 10px 0; border-bottom: 1px solid #e2e8f0; }
          .booking-item:last-child { border-bottom: none; }
          .rebook { background: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; }
          .footer { background: #1e293b; color: #94a3b8; padding: 20px; text-align: center; font-size: 12px; border-radius: 0 0 10px 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin:0;">🏥 ${CLINIC_INFO.name}</h1>
            <p style="margin:10px 0 0 0;">預約取消通知</p>
          </div>
          <div class="content">
            <div class="cancel-badge">❌ 預約已取消</div>
            
            <p>親愛的 <strong>${booking.customerName}</strong>，您好！</p>
            <p>以下預約已被取消：</p>
            
            <div class="booking-card" style="text-decoration: line-through;">
              <div class="booking-item">
                📅 日期：${booking.date}
              </div>
              <div class="booking-item">
                ⏰ 時間：${booking.time}
              </div>
              <div class="booking-item">
                👨‍⚕️ 醫師：${booking.doctorName}
              </div>
              <div class="booking-item">
                💊 服務：${booking.serviceName}
              </div>
            </div>
            
            <div class="rebook">
              <strong>📅 需要重新預約嗎？</strong><br>
              歡迎隨時透過我們的網站重新預約，或致電 ${CLINIC_INFO.phone} 查詢。
            </div>
            
            <p>如有任何問題，歡迎聯繫我們。</p>
          </div>
          <div class="footer">
            <p>${CLINIC_INFO.name}</p>
            <p>📍 ${CLINIC_INFO.address}</p>
            <p>📞 ${CLINIC_INFO.phone}</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ 預約取消郵件已發送:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ 發送預約取消郵件失敗:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 發送歡迎郵件（新用戶註冊）
 */
async function sendWelcomeEmail(to, username, name) {
  const mailOptions = {
    from: `"${CLINIC_INFO.name}" <${SENDER_EMAIL}>`,
    to: to,
    subject: `【${CLINIC_INFO.name}】歡迎加入！`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Microsoft JhengHei', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; }
          .welcome-badge { background: #dcfce7; color: #166534; padding: 10px 20px; border-radius: 20px; display: inline-block; margin-bottom: 20px; }
          .features { background: #fff; border-radius: 10px; padding: 20px; margin: 20px 0; }
          .feature-item { padding: 10px 0; border-bottom: 1px solid #e2e8f0; }
          .feature-item:last-child { border-bottom: none; }
          .footer { background: #1e293b; color: #94a3b8; padding: 20px; text-align: center; font-size: 12px; border-radius: 0 0 10px 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin:0;">🏥 ${CLINIC_INFO.name}</h1>
            <p style="margin:10px 0 0 0;">歡迎加入！</p>
          </div>
          <div class="content">
            <div class="welcome-badge">🎉 註冊成功</div>
            
            <p>親愛的 <strong>${name}</strong>，您好！</p>
            <p>感謝您註冊成為我們的會員，您的會員帳號是：<strong>${username}</strong></p>
            
            <div class="features">
              <p style="font-weight:600; margin-bottom:15px;">您現在可以享用以下服務：</p>
              <div class="feature-item">📅 線上預約診症</div>
              <div class="feature-item">📋 查看預約記錄</div>
              <div class="feature-item">🤖 AI 智能問診</div>
              <div class="feature-item">📧 電郵通知提醒</div>
            </div>
            
            <p>如有任何問題，歡迎聯繫我們。</p>
          </div>
          <div class="footer">
            <p>${CLINIC_INFO.name}</p>
            <p>📍 ${CLINIC_INFO.address}</p>
            <p>📞 ${CLINIC_INFO.phone}</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ 歡迎郵件已發送:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ 發送歡迎郵件失敗:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 測試郵件連線
 */
async function testConnection() {
  try {
    await transporter.verify();
    console.log('✅ 郵件伺服器連線成功');
    return true;
  } catch (error) {
    console.error('❌ 郵件伺服器連線失敗:', error);
    return false;
  }
}

module.exports = {
  sendVerificationCode,
  sendBookingConfirmation,
  sendBookingUpdate,
  sendBookingCancellation,
  sendWelcomeEmail,
  testConnection,
  CLINIC_INFO
};
