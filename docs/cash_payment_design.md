# 客人現金付款 — 設計方案（待決定）

> 狀態：**設計提案，未實作**。用戶要求先睇設計再決定。

## 1. 現狀痛點

- `bookings` 表**冇任何付款欄位**：預約一撳即 `confirmed`，語義上係「到診才付款」，但系統無紀錄、無追蹤。
- `payments` 表已有 `payment_method` / `status` / `paid_at`（目前只供 Stripe 模擬用）。
- 會員升級：經 Stripe 網上付款。官網 index.html:1720 寫死「如需轉數快或現金付款，請致電 2555-1136 由職員代為開通」——即現金 = 打電話、職員手動開通，無系統化。
- **結果**：現金客人的收款完全靠職員記憶／紙本，易漏收、難對數、冇跟進清單。

## 2. 目標

1. 客人可揀「**到店付現金**」作為付款方式（適用：服務預約 + 會員升級）。
2. 預約即確認，但標記 `payment_status = pending_cash`；職員到診確認收款 → `paid`。
3. 會員升級揀現金 → `pending_cash`，職員確認收款後才**激活**會員。
4. 職員／管理後台有「**待收現金**」清單 + 「確認收現金」掣 + 每日現金對數報告。

## 3. 資料模型變更（向後兼容）

### `bookings` 加欄
```sql
ALTER TABLE bookings ADD COLUMN payment_method TEXT DEFAULT 'cash';   -- cash | online
ALTER TABLE bookings ADD COLUMN payment_status TEXT DEFAULT 'paid';   -- unpaid | pending_cash | paid
ALTER TABLE bookings ADD COLUMN cash_received_at TEXT;                -- 職員確認時間
ALTER TABLE bookings ADD COLUMN cash_received_by INTEGER;             -- 職員 user_id
```
- default `'cash'` + `'paid'`：舊預約當「已收現金」處理，**唔會爆現有流程**。
- 新預約如客人揀現金 → `payment_status='pending_cash'`，顯「請於到診繳 $XXX 現金」。

### 會員 `subscriptions` 加欄
```sql
ALTER TABLE subscriptions ADD COLUMN payment_method TEXT DEFAULT 'cash';
ALTER TABLE subscriptions ADD COLUMN payment_status TEXT DEFAULT 'pending_cash';  -- pending_cash | active
ALTER TABLE subscriptions ADD COLUMN cash_confirmed_at TEXT;
ALTER TABLE subscriptions ADD COLUMN cash_confirmed_by INTEGER;
```
- 升級揀現金 → `pending_cash`，會員**未激活**；職員確認收款 → `active` + 更新 `users.membership_tier`。

## 4. 三條流程

### A. 服務預約收現金
1. 客人預約（訪客初體驗 / 會員）時，步驟加「付款方式」：**到店付現金（預設）** / 網上付款（Stripe，稍後）。
2. 提交 → booking 建 `payment_method='cash'`, `payment_status='pending_cash'`，顯「預約成功，請於到診時繳付現金 $XXX」。
3. 職員後台 → 該 booking 顯「待收現金 $XXX」徽章 + 「確認收現金」掣 → 設 `paid` + `cash_received_at` + `cash_received_by`。

### B. 會員升級收現金
1. 會員計劃頁升級選項加「**到店付現金**」（與 Stripe 並排）。
2. 揀現金 → 建 subscription `payment_method='cash'`, `payment_status='pending_cash'`，顯「請於到診繳 $XXX 激活會員」。
3. 職員確認收款 → subscription `active`，`users.membership_tier` 升級，客人即刻享家庭／全部服務。

### C. 職員代約 / 電話預約（staff phone booking）
- 職員落單時揀付款方式，標現金待收；到診由前台確認。

## 5. UI 觸點

| 位置 | 改動 |
|---|---|
| `index.html` 預約流程 | 加付款方式選擇（到店付現金 default），完成頁顯應繳金額 |
| `index.html` 會員計劃 | 升級加「到店付現金」選項 |
| `staff.html` / `admin.html` | booking / subscription 加「確認收現金」掣；「待收現金」篩選；每日現金對數摘要 |

## 6. 安全 / 邊界

- **確認收現金只限 `staff` / `admin`**（權限檢查，唔俾客人自己確認）。
- **走數跟進**：`pending_cash` 未收 = 跟進清單；no-show 可標記。
- **對數**：每日現金報告（筆數 + 總額），交畀執班職員。
- **金額**：預約按 `services.price` 計；會員按 plan 價計；職員可手動調整（optional）。

## 7. 實作範圍（如批准）

1. **DB migration**：加上述欄（全部有 default，向後兼容）。
2. **後端**：
   - `POST /api/bookings` 收 `payment_method`，set `payment_status`。
   - `POST /api/bookings/:id/confirm-cash`（staff/admin）→ `paid` + 紀錄。
   - 會員升級 endpoint 收 `cash` → `pending_cash` subscription。
   - `POST /api/subscriptions/:id/confirm-cash`（staff/admin）→ 激活。
3. **前端**：index 選擇器 + staff/admin 確認掣 + 待收清單。

## 8. 未涵蓋（用戶跟進項）

- WhatsApp / 短信「已確認收款」通知 → 用戶自己搞 WhatsApp 通知。
- Stripe 線上付款 key → 用戶自己搞。
- 收銀機／電子錢包（轉數快、PayMe）→ 後續期。

---
*設計日：2026-09-08 · 寶天醫館 · 現金付款提案 v1*
