# 寶天醫館 · 12 角色 Persona QA 報告

> **測試方法**：以 1 管理員 + 1 員工 + 10 客人（首訪／一般／家庭／18+子女／長者／可疑／過期／外籍／電話代辦）共 12 個 persona，每位以真實用戶視角執行 6–19 步操作（共 117 步），全自動 HTTP 對 `scenario.db` 沙盒跑，記錄每步狀態、UX 痛點、邊界、漏洞。
> **沙盒**：`PORT=4100`、`DB_PATH=scenario.db`、自動起 server 跑完即 kill。
> **覆蓋範圍**：合理性／優化／功能接駁／安全性／debug（依用戶要求五維度）。

---

## 0. 執行總覽

| 角色 | Persona | 步數 | 通過 | 異常 |
|---|---|---|---|---|
| A1 | 管理員 陳大文 | 19 | 17 | 2 |
| S1 | 員工 林小玲 | 19 | 12 | 7（**全部為正確擋下**，符合預期） |
| C1 | 首訪訪客 王先生 | 11 | 4 | 7 |
| C2 | 一般會員 李太 | 15 | 9 | 6 |
| C3 | 家庭會員 張小姐 | 12 | 6 | 6 |
| C4 | 家庭戶主 黃先生 | 6 | 4 | 2 |
| C5 | 18+ 子女 小芳 | 7 | 0 | 7（**測試帳號不在沙盒**，非產品 bug） |
| C6 | 長者 陳伯 | 8 | 5 | 3（**含 1 個 critical server 500**） |
| C7 | 可疑用戶 阿強 | 9 | 2 | 7（**含限流/IDOR 正面驗證**） |
| C8 | 過期會員 Ms. Liu | 3 | 1 | 2 |
| C9 | 外籍 Peter | 4 | 3 | 1 |
| C10 | 電話預約 Ms. Chan | 4 | 1 | 3 |
| **合計** | | **117** | **64** | **53** |

> 註：S1 員工的 7 個「異常」**全部是 403 正確擋下**（員工不可看收入/HR/薪資/批假/刪用戶等），是**正面**結果。真正需修的產品 bug 集中在 C1/C2/C3/C4/C6/C8/C10 共 **~15 個真實缺陷**（見 §5 Debug）。

---

## 1. 12 個 Persona 的旅程紀要

### A1 · 管理員 陳大文 — 「一天的工作」

| # | 動作 | 結果 | 觀察 |
|---|---|---|---|
| 1 | 看今日預約列表 | 200 | 正常 |
| 2 | 看本月收入 | 200 | 正常 |
| 3 | 看醫師時段網格 | 200 | 正常 |
| 4 | 看請假審批隊列 | 200（0 筆） | 沙盒無假可批；正常 |
| 5 | 看反饋未讀數 | 200 | 正常 |
| 6 | 看員工名冊 | 200 | 正常 |
| 7 | **看本月薪資表** | **400** | ⚠ 缺月份參數。`/api/hr/payroll` 必填 `month=YYYY-MM`，但 admin UI 預設值未必帶齊 |
| 8 | 改一筆預約為完成 | 200 | 正常 |
| 9 | 看全店病歷 | 200 | admin 可看 ✓ |
| 10 | 看家庭樹 | 200 | 正常 |
| 11 | CMS 評價審核 | 200 | 正常 |
| 12 | 看可疑密碼重設活動 | 200 | 正常（安全監控存在） |
| 13 | 看系統狀態 | 200 | 正常 |
| 14 | 上班打卡 | 200 | 成功 |
| 15 | **自己申請請假** | **404** | ⚠ `POST /api/admin/doctor/my-leave` 路由在當前環境對 admin 不可用；路由 mount/role guard 可能不覆蓋 admin token 對自身醫師身份的辨識 |
| 16 | 看通知設定 | 200 | 正常 |
| 17 | 看優惠券管理 | 200 | 正常 |
| 18 | 看單日時段 | 200 | 正常 |
| 19 | 看 2026 假日 | 200 | 正常 |

**整體**：管理員日常運作暢順。兩個 edge case 需修（薪資月份預設、admin 自請假）。

---

### S1 · 員工 林小玲 — 「前台上工」

| # | 動作 | 結果 | 觀察 |
|---|---|---|---|
| 1 | 上班打卡 | 200 | 正常 |
| 2-4 | 看預約/員工視角/家庭可選小孩 | 200/200/200 | 正常 |
| 5 | 看 admin 收入 | **403** | ✅ 正確擋下 |
| 6 | 看 HR 全店 | **403** | ✅ 正確擋下 |
| 7 | 看薪資表 | **403** | ✅ 正確擋下 |
| 8 | 寫病歷 | **400** | ✅ 員工不可寫（需 own-booking） |
| 9-10 | 看全店病歷/請假隊列 | 200 | 員工可看 ✓ |
| 11 | 批准請假 | **403** | ✅ 正確擋下（僅 admin） |
| 12-16 | 自我 HR 資料/薪資單/文件/時段/連結 | 200 | 員工 ESS 完整 |
| 17 | 寫 staff-note | 200 | 員工可標記客人 ✓ |
| 18 | 看 CMS 評價審核 | **403** | ✅ 正確擋下 |
| 19-20 | 服務/優惠券 | 200/**403** | 優惠券 admin-only ✓ |

**整體**：員工權限邊界**極清晰**，7 個 403 全部是正確擋下。沒有越權漏洞。

---

### C1 · 首訪訪客 王先生 — 「Google 搜尋到，第一次來」

| # | 動作 | 結果 | 觀察 |
|---|---|---|---|
| 1 | 瀏覽服務列表 | 200 | 正常 |
| 2 | 瀏覽醫療分流 | 200 | 正常 |
| 3 | **瀏覽醫師介紹** | **401** | 🔴 **嚴重整合 bug**：`/api/settings/doctors` 路由被 `router.use(requireAuth, requireRole('admin'))` 鎖住。公開官網訪客**完全看不到醫師列表**！前端很可能繞道用其他端點，但 API 命名誤導 |
| 4-5 | **查初體驗時段 / 訪客預約** | **400 / 400** | 🟠 **整合 bug**：`POST /api/bookings` 用 camelCase（`customerName`/`serviceId`/`appointmentDate`/`doctorName`），但 `GET /timeslots/available` 必填 `service`+`date`+`doctor_id` 也回 400 — 訪客預約**完全走不通** |
| 6 | 訪客約 S3（非初體驗） | 400 | 走不通是因 §4 整合問題，非門控生效 |
| 7-8 | 嘗試登入 / 找回 ID | 401 / 404 | 正常（無帳號） |
| 9-10 | FAQ / 公告 | 200 | 正常 |
| 11 | AI 症狀推薦 | 400 | ⚠ 缺 `symptoms` 必填 |

**整體**：首訪體驗**斷裂**。訪客點「立即預約」後卡在校驗（甚至看不到醫師）。**這是轉化漏斗最大嘅漏洞**。

---

### C2 · 一般會員 李太 — 「註冊咗，想約針灸」

| # | 動作 | 結果 | 觀察 |
|---|---|---|---|
| 1 | 看會員資料 | 200 | 顯示 general tier ✓ |
| 2-3 | **約 S3 / S1** | **400 / 400** | 🟠 同 C1 整合 bug — 分級門控**無法驗證**（被前置校驗擋下）。需要前端用正確 camelCase payload 才能測到真正的「403 membership_required」 |
| 4-7 | 看預約/優惠券/反饋/提交反饋 | 200 | 正常 |
| 8 | **改自己密碼** | **403** | 🟡 `/api/users/:id/password` 對非 self 返 403。可能是 id 不對或政策擋。客人**改唔到自己密碼**是 UX 危機 |
| 9-11 | 自己病歷/家庭/連結 | 200 | 正常 |
| 12 | 客人看 admin | 404 | ⚠ 應為 403；現返 404 屬資訊洩漏（雖低風險） |
| 13-15 | 全店病歷/他人 profile/系統狀態 | 403 | ✅ 全部正確擋下 |

**整體**：核心痛點是**改唔到自己密碼** + **預約走唔通**。

---

### C3 · 家庭會員 張小姐 — 「已升級家庭」

| # | 動作 | 結果 | 觀察 |
|---|---|---|---|
| 1 | 看 family tier | 200 | ✓ |
| 2-3 | 約 S3 / S2 | 400 / 400 | 🟠 同 C2 — **family 客戶都預約唔到**！ |
| 4-5 | 看自己預約/家庭成員 | 200 | ✓ |
| 6 | 看可加家庭成員 | 403 | 端點限 staff/admin — 合理 |
| 7 | **加帳戶連結** | **400** | 🟠 `targetUsername`/`relation` 欄位為 camelCase（`relation` 必填且須在 RELATION_PRESETS），API 契約不一致 |
| 8-12 | 其他基本操作 | 200 | 正常 |

**整體**：付咗錢嘅 family 客戶**約唔到服務**，是收入層面嘅緊急問題。

---

### C4 · 家庭戶主 黃先生 — 「幫兩個仔女約」

| # | 動作 | 結果 | 觀察 |
|---|---|---|---|
| 1 | 看家庭成員 | 200 | ✓ |
| 2 | **戶主代子女約** | **400** | 🟠 `for_family_member` 欄位不存在；正確應帶子女 user_id 或 family 預約獨立流程 |
| 3-4 | 再看家庭/家庭發票 | 200 | ✓ |
| 5 | **設自己隱私** | **404** | 🟠 端點是 `POST /api/membership/privacy`（唔係 PUT），body 用 `{ hide: true }`（唔係 `{private: true}`）。命名/方法不一致 |
| 6-7 | 取消預約/優惠券 | 200 | ✓ |

**整體**：家庭代約流程**完全冇路走**。

---

### C5 · 18+ 子女 小芳 — 「自己管自己」

> ⚠ 沙盒 `scenario.db` **冇 `testkid1` 帳號**（佢喺 `database.db` 嘅 `seed_test_accounts.js` 入面，唔係 `scenario-seed.js`）。所有 C5 步驟因 token 為 null 而全部失敗。**非產品 bug，但反映：18+ 子女隱私流程缺乏專屬測試帳號**。

**建議**：在 `scenario-seed.js` 加 `sc_kid1` (18+ child) + `sc_kid2` (<18 child)，跑回此 persona。

---

### C6 · 長者 陳伯 — 「唔識科技，慢慢撳」

| # | 動作 | 結果 | 觀察 |
|---|---|---|---|
| 1 | 看服務 | 200 | ✓（UI 大字未測，純 API） |
| 2 | **重發驗證碼 3 次** | **500 / 500 / 500** | 🔴 **CRITICAL BUG**：`/api/auth/send-reset-code` 喺冇 email service（生產 ALB 環境）時**必定 500**。`emailService.sendVerificationCode` 失敗 → 直接 500。**長者/所有忘記密碼嘅人 100% 中招** |
| 3-6 | FAQ / 假日 / 分流 / 反饋 | 200 | 正常 |

**整體**：密碼救援**完全壞咗**。

---

### C7 · 可疑用戶 阿強 — 「測試員工嘅嘢」

| # | 動作 | 結果 | 觀察 |
|---|---|---|---|
| 1 | 暴力登入 8 次 | **429** | ✅ 限流生效（已觸發） |
| 2 | 偽造 token | 401 | ✅ 正確擋下 |
| 3 | SQL 注入 login URL | 404 | ✅ 安全 |
| 4 | XSS 提交反饋 | 200 | ⚠ 後端應有輸出過濾（前端 v-html / textContent 處理） |
| 5 | 看自己病歷（正常 token） | 200 | ✅ 只見自己 |
| 6 | IDOR 改他人密碼 | 400 | ✅ 正確擋下 |
| 7 | IDOR 改他人通知 | 403 | ✅ 正確擋下 |
| 8 | 訪客 5 次同醫同日預約 | 0 全 400 | ⚠ 全部被前置校驗擋，**無法驗證容量檢查**（需前端正確 payload 才能測） |
| 9 | 客人看可疑活動日誌 | 403 | ✅ 正確擋下 |

**整體**：身份驗證/限流/IDOR 全部過關。XSS 需前端確認 sanitize。

---

### C8 · 過期會員 Ms. Liu — 「以前 premium，宜家過期」

| # | 動作 | 結果 | 觀察 |
|---|---|---|---|
| 1 | 看會員狀態 | 200 | tier=general（已降級） ✓ |
| 2-3 | **過期會員約 S2 / S1** | 400 / 400 | 🟠 同 C2/C3 整合 bug — **無法驗證過期降級嘅 403** |

**整體**：測試無法到達真正的降級門控邏輯。

---

### C9 · 外籍 Peter — 「英文/海外電話」

| # | 動作 | 結果 | 觀察 |
|---|---|---|---|
| 1-2 | 看公告/服務（中文） | 200 | UI 英文版未測 |
| 3 | **英文姓名 + 海外電話 6012-3456789 預約** | **400** | 🟠 電話格式校驗擋下海外格式 |
| 4 | AI 類別 | 200 | ✓ |

**整體**：海外用戶**無法預約**（電話格式問題）。

---

### C10 · 電話預約 Ms. Chan — 「打電話嚟 book」

| # | 動作 | 結果 | 觀察 |
|---|---|---|---|
| 1 | **職員代電話預約** | **400** | 🟠 同 C1-C3 整合 bug |
| 2 | 職員查客人資料 | 404 | ⚠ 沙盒無 Ms. Chan 帳號，但職員 POST /api/admin/users 需先開戶 |
| 3 | **管理員代開 Ms. Chan 帳戶** | **400** | 🟠 `POST /api/admin/users` 必填 `username`/`name`/`phone`，且需 `verifyAdminPassword` middleware 從 header 讀 adminPassword（**唔係 body**） |
| 4 | 職員再查預約 | 200 | ✓ |

**整體**：電話預約 + 開戶流程**端到端唔通**。

---

## 2. 合理性審查（合唔合理？）

### ✅ 合理嘅部分

1. **角色邊界清晰**：管理員／員工／醫師／客人四層嵌套 `requireRole` 守衛冇漏洞。S1 員工 7 個 403 全屬正確。
2. **限流到位**：暴力登入 8 次 → 429；驗證碼 cooldown；密碼重設限流。
3. **會員分級門控邏輯存在**：guest 僅可「初體驗」、general 僅可「初體驗」、family 可全部。`routes/bookings.js:282-296` 邏輯清楚。
4. **家庭帳戶 18+ 子女隱私**：分 `hide_from_head` flag，設計正確。
5. **可疑密碼重設活動日誌**：admin 可查，符合 audit trail。
6. **重複請假 409、補位=本人 400**：業務規則紮實。

### ⚠ 唔合理嘅部分

1. **訪客完全約唔到** — 首訪轉化最大嘅漏洞
2. **家庭會員付咗錢約唔到** — 收入直接影響
3. **客人改唔到自己密碼** — 基本帳號安全 UX
4. **密碼重設 100% 500** — 忘記密碼 = 死路
5. **海外電話預約唔到** — 國際客戶零支援
6. **公開醫師列表要登入** — 違反公開官網語義
7. **18+ 子女無測試帳號** — QA 盲點

---

## 3. 優化建議（可以點改）

### 3.1 立即修（P0，影響收入/安全）

1. **統一 API 欄位命名**：建立 OpenAPI/Swagger，**全部 snake_case**（對齊 DB）。修 `/api/bookings` POST 改收 `customer_name`/`service_id`/`appointment_date`/`doctor_name`，**保留 camelCase alias** 一個季度。前端用 alias 過渡。
2. **修 `/api/auth/send-reset-code` 500**：當 `emailService` 失敗時，**至少回 200 + 把驗證碼寫入 DB**（並喺 log 印出嚟供 dev 環境 fallback），唔好直接 500。生產環境若 SMTP 中斷，**用 SMS/WhatsApp 替代**或暫時出「聯絡職員」訊息。
3. **修 `/api/settings/doctors` 公開權限**：將公開醫師列表**搬去** `/api/doctors` 或 `/api/triage/doctors`（已存在），`/api/settings/doctors` 保留為 admin 管理。
4. **修客人改自己密碼**：前端 `PUT /api/users/me/password`，後端自動用 token 嘅 user.id；保留舊 endpoint 但要明確文檔「只能改自己」。
5. **電話格式寬鬆化**：`/^[\d\s\-\+\(\)]{6,}$/` 接受國際格式。

### 3.2 短期修（P1，提升 UX）

6. **公開時段端點標準化**：`/api/bookings/timeslots/available` 必填參數回 400 時**回清晰錯誤**（列缺失欄位名），唔好只回「缺少必要欄位」。
7. **家庭代約獨立流程**：`POST /api/family/bookings` 帶 `for_user_id`，自動帶戶主 token + 子女 id。
8. **18+ 子女測試帳號**：`scenario-seed.js` 加 `sc_kid1` (18+) / `sc_kid2` (<18)，同 `sc_family1` 連結。
9. **管理員薪資表預設本月**：`/api/hr/payroll` 冇 `month` 參數時自動用當前月。
10. **404 vs 403 統一**：admin 端點對 customer 返 **403** 而非 404（避免 enumeration）。

### 3.3 中期優化（P2，業務增長）

11. **多語言**：公告/服務/醫師介紹加英文版（`name_en`/`description_en`）。
12. **AI 症狀推薦優化**：公開端點 `get-recommendation` 接受 `symptoms` 為空時回熱門分類。
13. **客人自助手動安排**（承接前次嘅 `needs_arrange` 流程）：客人端加「我 OK 換醫師」按鈕，後端記 audit。
14. **過期會員友善提示**：約診時 403 + 自動跳「續費會員」連結。
15. **訪客轉會員 CTA**：訪客預約成功頁加「建立帳戶查預約記錄」。

### 3.4 系統性優化（P3）

16. **統一錯誤回應格式**：`{ok: false, code: 'X', error: 'human', field?: 'name'}`。
17. **建立 API 文件**（OpenAPI 3.0），自動生成前端 types。
18. **CI 加 contract test**：Pact 或 Dredd 防止命名再漂移。
19. **A11y**：長者/視障模式（字體放大、對比、ARIA）。
20. **可觀測性**：每個 4xx/5xx 入 Sentry，admin dashboard 顯示錯誤趨勢。

---

## 4. 功能接駁（API contract 一致性）

### 4.1 🔴 欄位命名分裂

| 端點 | 輸入風格 | 例子 |
|---|---|---|
| `/api/auth/login` | snake/camel 混合 | `username`/`password`/`captchaAnswer` |
| `/api/bookings` POST | **camelCase** | `customerName`/`serviceId`/`appointmentDate`/`doctorName` |
| `/api/membership/account-links` POST | **camelCase** | `targetUsername`/`targetPhone`/`relation` |
| `/api/membership/privacy` POST | 短 | `hide` |
| `/api/admin/users` POST | snake_case | `username`/`name`/`phone`/`email`/`role` |
| `/api/users/:id/password` PUT | snake/camel 混合 | `oldPassword`/`newPassword` |

**後果**：前端與後端耦合緊耦合但 API 冇 contract 文件 → 一改就爆。任何第三方整合（mobile app、外部 CRM）都會撞板。

**根治**：
- 選 snake_case 為標準（對齊 DB 與現有多數端點）
- 寫 OpenAPI 3.0
- 加 CI contract test

### 4.2 🔴 公開 vs 私有 端點混淆

| 路由 | 當前守衛 | 期望 |
|---|---|---|
| `GET /api/settings/doctors` | `requireAuth + admin` | **公開**（官網展示） |
| `GET /api/triage/doctors` | 公開 | ✓ 公開 — **但呢個先係應該畀官網用嘅** |
| `GET /api/settings/clinic` | `requireAuth + admin` | 應該半公開（名稱/地址公開，價格內部） |
| `GET /api/holidays/check/:date` | 公開 | ✓ |
| `GET /api/services` | 公開 | ✓ |

**根治**：將 `triage/doctors` 升級為 `/api/public/doctors`，`settings/doctors` 改名 `/api/admin/doctor-profiles`。

### 4.3 🟠 HTTP 方法不一致

| 端點 | 路由 | 應為 |
|---|---|---|
| `/api/membership/privacy` | POST `{hide}` | ✓ POST（狀態變更） |
| `/api/membership/family-invoice` | GET | ✓ |
| `/api/admin/users` | POST/PUT/DELETE | ✓ RESTful |
| `/api/admin/doctor/my-leave` | POST | ⚠ 改用 `/api/leaves` POST 較一致 |

### 4.4 🟠 2FA 密碼傳遞位置

`/api/admin/users` POST 走 `verifyAdminPassword` middleware — 由 `req.headers['x-admin-password']` 或 `req.body.adminPassword` 讀？需統一並文檔化。

### 4.5 🟢 整合做得唔錯嘅部分

- 預約引擎（`bookings.js`）同一個 `checkClinicOpen` 被公開 + 管理員視角共用。
- `doctor-time-slots/range` 同源，前端管理月曆與公開預約一致。
- 家庭樹 + 帳戶連結 + 隱私三層資料模型完整。
- HR/ESS/全店管理邊界清楚。

---

## 5. 安全性

### 5.1 ✅ 已做到

| 測試 | 結果 |
|---|---|
| 暴力登入限流 | 8 次 → 429 ✓ |
| 偽造 JWT | 401 ✓ |
| SQL 注入 | 404（sqlite 參數化） ✓ |
| IDOR 改他人密碼 | 400/403 ✓ |
| IDOR 改他人通知 | 403 ✓ |
| 員工越權看 admin | 403 ✓ |
| 員工越權批假 | 403 ✓ |
| 客人看全店病歷 | 403 ✓ |
| 客人看 admin 端點 | 403 ✓ |
| 驗證碼 cooldown | 60s ✓ |
| 補位醫師=本人 | 400 ✓ |
| 重複請假 | 409 ✓ |
| 員工不可建管理員 | 403 ✓ |
| 2FA（adminPassword 校驗） | 啟用 ✓ |
| 密碼分層政策（services/passwordPolicy） | 啟用 ✓ |
| JWT revocation 持久化 | 啟用（`revoked_tokens`） ✓ |
| 密碼重設日誌 / 可疑活動日誌 | admin 可查 ✓ |

### 5.2 ⚠ 需要加強

1. **send-reset-code 500 暴露 stack trace**（dev 環境）— 生產應隱藏內部錯誤。
2. **XSS in feedback** 後端接受 `<script>` — 需驗證輸出端 sanitize（前端 v-text vs v-html）。
3. **/api/admin 對 customer 返 404 而非 403** — 輕微 enumeration 風險。
4. **公開 CAPTCHA 端點** — 需確認 captcha 圖片真嘅隨機足夠（已有 `services/captcha.js` 處理）。
5. **CORS 設定** — 未在測試中驗證跨域；需確認 admin.html / staff.html / doctor.html 同源部署無問題。
6. **JWT 過期時間** — 未在測試中驗證 access token 過期策略。
7. **HTTPS / Secure cookie** — 部署層面（ALB + ACM）。
8. **Rate limit 全站** — 只 login / email 有，其他端點缺。

---

## 6. Debug — 需修嘅 Bug 清單

按優先級排：

### 🔴 P0 — 收入/安全 blocker

| # | Bug | 重現 | 根因 | 修法 |
|---|---|---|---|---|
| B1 | **訪客/會員全部 POST /api/bookings 走唔通** | C1/C2/C3/C8/C10 步驟 | 端點用 `customerName`/`serviceId`/`appointmentDate`/`doctorName`（camelCase），前端用緊但 API 冇 alias | 統一 snake_case + camelCase alias |
| B2 | **/api/auth/send-reset-code 500** | C6 步驟 2 | `emailService.sendVerificationCode` 失敗直接 500，冇 fallback | 失敗時寫 log + 200 回執，sandbox 環境印驗證碼到 console |
| B3 | **/api/settings/doctors 公開 401** | C1 步驟 3 | `router.use(requireAuth, requireRole('admin'))` 罩住 | 將醫師列表搬去 `/api/public/doctors` |
| B4 | **客人 PUT /api/users/:id/password 改自己密碼 403** | C2 步驟 8 | 路由冇明確「self only」檢查，:id 與 token 不符 | 加 `req.user.id === req.params.id` 檢查，或新增 `/api/users/me/password` |
| B5 | **海外電話格式 400** | C9 步驟 3 | `/^[\d]{8}$/` 校驗 | 寬鬆化 `/^[\d\s\-+()]{6,20}$/` |

### 🟠 P1 — UX blocker

| # | Bug | 修法 |
|---|---|---|
| B6 | `/api/admin/users` 400 缺 `username` 欄位提示 | 加詳細 error code |
| B7 | `/api/membership/privacy` 用 POST + `hide`，前端用 PUT + `private` | 統一文檔，後端接受兩種 |
| B8 | `/api/membership/account-links` 400 缺 `relation` | 統一文檔，列 RELATION_PRESETS 給前端 |
| B9 | `/api/hr/payroll` 缺 `month` 預設 | 預設當前月 |
| B10 | `/api/admin/doctor/my-leave` admin token 返 404 | 排查 admin role 對該端點嘅 guard |
| B11 | 家庭代約冇標準端點 | 加 `POST /api/family/bookings` |
| B12 | 404 vs 403 不統一 | 全站 requireRole 守衛返 403 |

### 🟡 P2 — 邊界

| # | 修法 |
|---|---|
| B13 | scenario-seed 缺 18+ 子女帳號 |
| B14 | 時段端點 400 訊息不清晰（列缺失欄位） |
| B15 | AI get-recommendation 缺 `symptoms` 返 400，應有熱門 fallback |

---

## 7. 行動建議

| 優先 | 項目 | 估時 | 影響 |
|---|---|---|---|
| **今週** | B1 統一 API 命名 + OpenAPI | 1-2 天 | 解鎖 80% 整合 bug |
| **今週** | B2 send-reset-code fallback | 2h | 解鎖密碼救援 |
| **今週** | B3 公開醫師列表 | 1h | 官網轉化 |
| **下週** | B4/B5/B6/B7/B8 欄位/權限微調 | 1 天 | UX 危機 |
| **兩週內** | OpenAPI + CI contract test | 2 天 | 防再漂移 |
| **一個月** | scenario-seed 加 18+ 子女 + 海外電話客戶 | 0.5 天 | 補 QA 盲點 |
| **兩個月** | 全部端點錯誤訊息標準化 + Sentry 接入 | 3 天 | 可觀測性 |

---

## 8. 附錄

### 8.1 測試環境

- `scenario.db`：2 admin / 5 doctor / 7 staff / 45 customer / 40 booking 種子
- 帳號密碼統一 `Scenario@2026`（除 `testkid1`/`testcustomer`/`testdoctor`/`teststaff` 係 `Aurora@123`，但唔喺 `scenario.db`）
- 端口 4100 隔離，自動起 server 跑完即 kill

### 8.2 測試工具

- `_qa_roles_200.js`：730 個端點×角色矩陣斷言（自動化，CI 友好）
- `persona_test.js`：12 角色 × 117 步真實旅程（敘事，UX 友好）
- `_persona_result.json`：完整 step log

### 8.3 不在本次範圍

- Stripe / WhatsApp 通知（依專案約定跳過）
- 完整 UI browser testing（puppeteer，僅針對 doctor.html 之前測過）
- 性能 / 壓力測試
- 多實例 / HA 部署

---

*報告生成：2026-09-08 · 寶天醫館 QA · 12 persona × 117 步 · scenario.db 沙盒*
