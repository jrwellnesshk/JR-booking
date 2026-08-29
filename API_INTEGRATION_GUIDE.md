# API 集成指南

## 如何將此預約系統連接到外部 API

---

## 1. WhatsApp Business API 集成

### 步驟：

#### A. 註冊 WhatsApp Business API

推薦服務商：

- **Twilio** (https://www.twilio.com/whatsapp)
- **Meta WhatsApp Business API** (https://business.whatsapp.com/)
- **MessageBird** (https://messagebird.com/)
- **360dialog** (https://www.360dialog.com/)

#### B. 獲取 API 憑證

註冊後會得到：

- API Token / API Key
- Phone Number ID
- WhatsApp Business Account ID

#### C. 在 `server.js` 中配置

找到第 340 行左右的 `sendWhatsAppNotification` 函數，修改為：

```javascript
async function sendWhatsAppNotification(
  phone,
  customerName,
  service,
  date,
  time,
  doctorName
) {
  // 從數據庫讀取API設定
  const apiSettings = await getApiSettings();

  const WHATSAPP_TOKEN =
    apiSettings.whatsapp_token || process.env.WHATSAPP_TOKEN;
  const WHATSAPP_PHONE_ID =
    apiSettings.whatsapp_phone_id || process.env.WHATSAPP_PHONE_ID;

  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    console.log("⚠️ WhatsApp API 未配置");
    return;
  }

  const message = `🏥 *寶天醫館預約確認*

尊敬的 ${customerName}，您好！

您的預約已確認：
📋 服務：${service}
👨‍⚕️ 醫師：${doctorName}
📅 日期：${date}
⏰ 時間：${time}

請準時到達，如需更改請聯繫我們。

寶天醫館
電話：+852-XXXX-XXXX`;

  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone.replace(/\+/g, ""), // 移除 + 號
          type: "text",
          text: {
            body: message,
          },
        }),
      }
    );

    const result = await response.json();

    if (response.ok) {
      console.log(`✅ WhatsApp 通知已發送到 ${phone}`);
      return { success: true, data: result };
    } else {
      console.error("❌ WhatsApp 發送失敗:", result);
      return { success: false, error: result };
    }
  } catch (error) {
    console.error("❌ WhatsApp API 錯誤:", error);
    return { success: false, error: error.message };
  }
}

// 輔助函數：從數據庫獲取API設定
function getApiSettings() {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM api_settings", [], (err, rows) => {
      if (err) return reject(err);
      const settings = {};
      rows.forEach((row) => {
        settings[row.setting_key] = row.setting_value;
      });
      resolve(settings);
    });
  });
}
```

---

## 2. Google Calendar API 集成

### 用途：

- 自動同步預約到 Google Calendar
- 醫師可在手機查看預約

### 步驟：

#### A. 啟用 Google Calendar API

1. 前往 https://console.cloud.google.com/
2. 創建新項目
3. 啟用 "Google Calendar API"
4. 創建服務帳號（Service Account）
5. 下載 JSON 密鑰文件

#### B. 安裝依賴

```bash
npm install googleapis
```

#### C. 添加到 `server.js`

```javascript
const { google } = require("googleapis");

// 初始化 Google Calendar
const calendar = google.calendar({
  version: "v3",
  auth: new google.auth.GoogleAuth({
    keyFile: "./google-credentials.json", // 你的密鑰文件路徑
    scopes: ["https://www.googleapis.com/auth/calendar"],
  }),
});

// 創建日曆事件
async function addToGoogleCalendar(booking) {
  try {
    const event = {
      summary: `預約：${booking.customer_name} - ${booking.service_id}`,
      description: `
        客戶：${booking.customer_name}
        電話：${booking.customer_phone}
        服務：${booking.service_id}
        醫師：${booking.doctor_name}
        備註：${booking.notes || "無"}
      `,
      start: {
        dateTime: `${booking.appointment_date}T${booking.appointment_time}:00`,
        timeZone: "Asia/Hong_Kong",
      },
      end: {
        dateTime: `${booking.appointment_date}T${addHour(
          booking.appointment_time
        )}:00`,
        timeZone: "Asia/Hong_Kong",
      },
      attendees: [{ email: booking.customer_email }],
      reminders: {
        useDefault: false,
        overrides: [
          { method: "email", minutes: 24 * 60 }, // 提前1天
          { method: "popup", minutes: 60 }, // 提前1小時
        ],
      },
    };

    const response = await calendar.events.insert({
      calendarId: "primary", // 或指定日曆ID
      resource: event,
    });

    console.log("✅ 已添加到 Google Calendar:", response.data.htmlLink);
    return response.data;
  } catch (error) {
    console.error("❌ Google Calendar 錯誤:", error);
    return null;
  }
}

// 輔助函數：時間加1小時
function addHour(time) {
  const [h, m] = time.split(":");
  return `${String(parseInt(h) + 1).padStart(2, "0")}:${m}`;
}
```

然後在創建預約的 API 中調用：

```javascript
app.post("/api/bookings", async (req, res) => {
  // ... 現有代碼 ...

  db.run(insertQuery, insertParams, async function (err) {
    if (err) return res.status(500).json({ error: err.message });

    const bookingId = this.lastID;

    // 發送 WhatsApp
    if (sendWhatsApp) {
      await sendWhatsAppNotification(/* ... */);
    }

    // 添加到 Google Calendar
    const bookingData = { ...req.body, id: bookingId };
    await addToGoogleCalendar(bookingData);

    res.json({ ok: true, id: bookingId });
  });
});
```

---

## 3. 支付 API 集成 (Stripe)

### 步驟：

#### A. 註冊 Stripe

https://stripe.com/

#### B. 安裝

```bash
npm install stripe
```

#### C. 添加到 `server.js`

```javascript
const stripe = require("stripe")("sk_test_YOUR_SECRET_KEY");

// 創建支付
app.post("/api/create-payment", async (req, res) => {
  const { amount, bookingId, customerEmail } = req.body;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100, // 轉換為分
      currency: "hkd",
      metadata: { bookingId },
      receipt_email: customerEmail,
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 確認支付
app.post("/api/confirm-payment", async (req, res) => {
  const { paymentIntentId, bookingId } = req.body;

  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status === "succeeded") {
      // 更新預約狀態為已支付
      db.run("UPDATE bookings SET payment_status = 'paid' WHERE id = ?", [
        bookingId,
      ]);
      res.json({ success: true });
    } else {
      res.json({ success: false });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

---

## 4. SMS API 集成 (Twilio)

```javascript
const twilio = require("twilio");
const client = twilio("ACCOUNT_SID", "AUTH_TOKEN");

async function sendSMS(phone, message) {
  try {
    const result = await client.messages.create({
      body: message,
      from: "+1234567890", // 你的 Twilio 號碼
      to: phone,
    });
    console.log("✅ SMS 已發送:", result.sid);
    return { success: true };
  } catch (error) {
    console.error("❌ SMS 發送失敗:", error);
    return { success: false, error };
  }
}
```

---

## 5. Email API 集成 (SendGrid)

```bash
npm install @sendgrid/mail
```

```javascript
const sgMail = require("@sendgrid/mail");
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendEmailConfirmation(email, bookingDetails) {
  const msg = {
    to: email,
    from: "booking@your-clinic.com",
    subject: "預約確認 - 寶天醫館",
    html: `
      <h2>預約確認</h2>
      <p>您的預約詳情：</p>
      <ul>
        <li>服務：${bookingDetails.service}</li>
        <li>醫師：${bookingDetails.doctor}</li>
        <li>日期：${bookingDetails.date}</li>
        <li>時間：${bookingDetails.time}</li>
      </ul>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log("✅ 郵件已發送");
  } catch (error) {
    console.error("❌ 郵件發送失敗:", error);
  }
}
```

---

## 環境變數設定

創建 `.env` 文件：

```env
# WhatsApp
WHATSAPP_TOKEN=your_token_here
WHATSAPP_PHONE_ID=your_phone_id_here

# Google Calendar
GOOGLE_CREDENTIALS_PATH=./google-credentials.json

# Stripe
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_PUBLIC_KEY=pk_test_xxxxx

# Twilio SMS
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_PHONE_NUMBER=+1234567890

# SendGrid
SENDGRID_API_KEY=SG.xxxxx
```

安裝 dotenv：

```bash
npm install dotenv
```

在 `server.js` 頂部添加：

```javascript
require("dotenv").config();
```

---

## 管理員頁面配置 API

在 `admin.html` 的系統設定中，可以添加 API 配置界面：

```html
<div class="mb-6">
  <h3 class="text-lg font-semibold mb-3">API 設定</h3>

  <div class="space-y-4">
    <div>
      <label class="block text-sm font-medium mb-1">WhatsApp Token</label>
      <input
        type="password"
        v-model="apiSettings.whatsapp_token"
        class="w-full border p-2 rounded"
      />
    </div>

    <div>
      <label class="block text-sm font-medium mb-1">WhatsApp Phone ID</label>
      <input
        v-model="apiSettings.whatsapp_phone_id"
        class="w-full border p-2 rounded"
      />
    </div>

    <button
      @click="saveApiSettings"
      class="bg-emerald-600 text-white px-4 py-2 rounded"
    >
      儲存 API 設定
    </button>
  </div>
</div>
```

---

## 測試 API 連接

創建測試端點在 `server.js`：

```javascript
// 測試 WhatsApp API
app.post("/api/test-whatsapp", async (req, res) => {
  const { phone } = req.body;
  const result = await sendWhatsAppNotification(
    phone,
    "測試用戶",
    "測試服務",
    "2025-11-15",
    "14:00",
    "張醫師"
  );
  res.json(result);
});

// 測試 Google Calendar
app.post("/api/test-calendar", async (req, res) => {
  const testBooking = {
    customer_name: "測試客戶",
    customer_phone: "+852-1234-5678",
    customer_email: "test@example.com",
    service_id: "test-service",
    doctor_name: "張醫師",
    appointment_date: "2025-11-15",
    appointment_time: "14:00",
    notes: "測試預約",
  };
  const result = await addToGoogleCalendar(testBooking);
  res.json({ success: !!result, data: result });
});
```

---

## 注意事項

1. **安全性**：

   - 不要將 API 密鑰提交到 Git
   - 使用 `.gitignore` 排除 `.env` 和憑證文件
   - 在生產環境使用環境變數

2. **錯誤處理**：

   - 所有 API 調用都應該有 try-catch
   - 記錄錯誤日誌
   - 向用戶顯示友好的錯誤訊息

3. **成本控制**：

   - WhatsApp、SMS 都有費用
   - 設置每日發送限制
   - 監控 API 使用量

4. **測試**：
   - 先使用測試模式（sandbox）
   - 確認所有功能正常後才切換到生產環境

---

## 需要幫助？

如果你需要具體集成某個 API，請告訴我：

1. 你想集成哪個 API？
2. 你已經有該 API 的帳號嗎？
3. 你需要什麼具體功能？

我可以幫你完成完整的集成代碼！
