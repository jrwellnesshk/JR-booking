# API 端點文檔

## 基礎 URL

```
http://localhost:6000
```

---

## 用戶認證 API

### 1. 用戶註冊

**POST** `/api/register`

**請求體：**

```json
{
  "username": "user001",
  "password": "123456",
  "name": "張小明",
  "phone": "0912-345-678",
  "email": "user@example.com"
}
```

**回應：**

```json
{
  "ok": true,
  "userId": 1
}
```

---

### 2. 用戶登入

**POST** `/api/login`

**請求體：**

```json
{
  "username": "user001",
  "password": "123456"
}
```

**回應：**

```json
{
  "ok": true,
  "user": {
    "id": 1,
    "username": "user001",
    "name": "張小明",
    "phone": "0912-345-678",
    "email": "user@example.com",
    "role": "customer"
  }
}
```

---

## 服務 API

### 3. 取得服務列表

**GET** `/api/services`

**回應：**

```json
[
  {
    "id": "S1",
    "name": "推拿治療（45 分鐘）",
    "duration": 45
  },
  {
    "id": "S2",
    "name": "針灸治療（30 分鐘）",
    "duration": 30
  }
]
```

---

## 預約 API

### 4. 建立預約

**POST** `/api/bookings`

**請求體：**

```json
{
  "userId": 1,
  "customerName": "張小明",
  "customerPhone": "0912-345-678",
  "customerEmail": "user@example.com",
  "serviceId": "S1",
  "appointmentDate": "2025-11-15",
  "appointmentTime": "10:00",
  "notes": "肩頸痠痛"
}
```

**回應：**

```json
{
  "ok": true,
  "id": 1
}
```

**注意：** 此 API 會自動觸發 WhatsApp 通知功能

---

### 5. 查詢所有預約

**GET** `/api/bookings`

**回應：**

```json
[
  {
    "id": 1,
    "user_id": 1,
    "customer_name": "張小明",
    "customer_phone": "0912-345-678",
    "customer_email": "user@example.com",
    "service_id": "S1",
    "appointment_date": "2025-11-15",
    "appointment_time": "10:00",
    "notes": "肩頸痠痛",
    "status": "confirmed",
    "created_at": "2025-11-10T10:30:00.000Z"
  }
]
```

---

### 6. 修改預約

**PUT** `/api/bookings/:id`

**請求體：**

```json
{
  "customerName": "張小明",
  "customerPhone": "0912-345-678",
  "customerEmail": "user@example.com",
  "serviceId": "S2",
  "appointmentDate": "2025-11-16",
  "appointmentTime": "14:00",
  "notes": "更改為針灸治療"
}
```

**回應：**

```json
{
  "ok": true
}
```

**注意：** 此 API 會自動觸發 WhatsApp 通知功能

---

### 7. 取消預約

**DELETE** `/api/bookings/:id`

**回應：**

```json
{
  "ok": true
}
```

---

### 8. 查詢可預約時段

**GET** `/api/timeslots?date=2025-11-15&serviceId=S1`

**參數：**

- `date`: 預約日期 (YYYY-MM-DD)
- `serviceId`: 服務 ID

**回應：**

```json
[
  {
    "time": "09:00",
    "available": true
  },
  {
    "time": "09:30",
    "available": false
  },
  {
    "time": "10:00",
    "available": true
  }
]
```

---

## AI 客服 API

### 9. AI 聊天

**POST** `/api/chat`

**請求體：**

```json
{
  "message": "營業時間是幾點？"
}
```

**回應：**

```json
{
  "reply": "我們營業時間為星期一至五 10:00-19:00；星期六 10:00-13:00（星期日及公眾假期休息）。"
}
```

**注意：**

- 當前使用本地備用回覆系統
- 可配置外部 AI API（如 OpenAI）
- 預設外部 API URL: `https://api.openai.com/v1/chat/completions`

---

## 用戶管理 API（管理員）

### 10. 取得所有用戶

**GET** `/api/users`

**回應：**

```json
[
  {
    "id": 1,
    "username": "admin",
    "name": "系統管理員",
    "phone": "0900-000-000",
    "email": "admin@baotian.com",
    "role": "admin",
    "created_at": "2025-11-10T08:00:00.000Z"
  }
]
```

---

### 11. 更改用戶密碼

**PUT** `/api/users/:id/password`

**請求體：**

```json
{
  "newPassword": "newpassword123"
}
```

**回應：**

```json
{
  "ok": true
}
```

---

### 12. 刪除用戶

**DELETE** `/api/users/:id`

**回應：**

```json
{
  "ok": true
}
```

---

## 系統管理 API

### 13. 系統狀態

**GET** `/api/system/status`

**回應：**

```json
{
  "uptime": 3600,
  "timestamp": "2025-11-10T12:00:00.000Z",
  "nodejs": "v18.0.0",
  "platform": "win32",
  "memory": {
    "total": "128 MB",
    "used": "64 MB"
  },
  "statistics": {
    "totalUsers": 5,
    "totalBookings": 10,
    "upcomingBookings": 3
  }
}
```

---

## WhatsApp 通知功能

### 觸發時機

1. 建立新預約時
2. 修改預約時

### 配置

- **預設 API URL**: `https://api.whatsapp.com/send`
- **配置位置**: 管理後台 → 系統設定 → WhatsApp API 設定

### 通知內容格式

```
【寶天醫館預約確認】
您好 {客戶姓名}，
您的預約已確認：
服務：{服務名稱}
日期：{預約日期}
時間：{預約時間}
如需更改請聯繫我們。
```

### 實際部署配置

```javascript
// 在 server.js 中取消註釋以下代碼
fetch(WHATSAPP_API_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer YOUR_TOKEN",
  },
  body: JSON.stringify({ phone, message }),
});
```

---

## 外部 AI API 整合

### 配置

- **預設 API URL**: `https://api.openai.com/v1/chat/completions`
- **配置位置**: 管理後台 → 系統設定 → AI 客服 API 設定

### 實際部署配置

在 `server.js` 的 `/api/chat` 端點中取消註釋：

```javascript
try {
  const response = await fetch(EXTERNAL_AI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer YOUR_API_KEY",
    },
    body: JSON.stringify({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "你是寶天醫館的AI客服助手" },
        { role: "user", content: message },
      ],
    }),
  });
  const data = await response.json();
  reply = data.choices[0].message.content;
} catch (error) {
  console.error("AI API 錯誤:", error);
}
```

---

## 錯誤處理

### 錯誤回應格式

```json
{
  "error": "錯誤訊息"
}
```

### 常見錯誤代碼

- **400**: 缺少必要欄位
- **401**: 認證失敗
- **404**: 資源不存在
- **500**: 伺服器錯誤

---

## 測試範例（使用 curl）

### 註冊用戶

```bash
curl -X POST http://localhost:6000/api/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test001","password":"123456","name":"測試用戶","phone":"0912-345-678"}'
```

### 登入

```bash
curl -X POST http://localhost:6000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test001","password":"123456"}'
```

### 建立預約

```bash
curl -X POST http://localhost:6000/api/bookings \
  -H "Content-Type: application/json" \
  -d '{"userId":1,"customerName":"測試用戶","customerPhone":"0912-345-678","serviceId":"S1","appointmentDate":"2025-11-15","appointmentTime":"10:00"}'
```

### 查詢預約

```bash
curl http://localhost:6000/api/bookings
```

### AI 聊天

```bash
curl -X POST http://localhost:6000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"營業時間是幾點？"}'
```

---

## 安全注意事項

1. **密碼加密**: 使用 SHA-256 加密（生產環境建議使用 bcrypt）
2. **HTTPS**: 生產環境必須使用 HTTPS
3. **CORS**: 當前允許所有來源，生產環境需限制
4. **API Token**: WhatsApp 和 AI API 的 Token 需要妥善保管
5. **輸入驗證**: 所有 API 都有基本的輸入驗證

---

## 開發建議

1. **認證中間件**: 建議添加 JWT 認證中間件
2. **速率限制**: 添加 API 速率限制防止濫用
3. **日誌記錄**: 完善的日誌系統
4. **錯誤追蹤**: 整合錯誤追蹤服務（如 Sentry）
5. **測試**: 編寫單元測試和整合測試

---

## 聯繫資訊

如需更多 API 詳情或技術支援，請參考：

- README.md
- 使用指南.md
- 系統控制台日誌
