# 寶天JR 全面升級 — 11 項改造完成報告（2026-09-15）

## 總結

**11 項全部完成，E2E 自動化測試 41/41 通過、0 錯誤。** 測試喺隔離快照（`_fulltest_0915.db`、埠 4762/4763）進行，全程無掂 live `database.db` 同 :4000 正式伺服器。

---

## 逐項狀態

| # | 項目 | 狀態 | 實作要點 |
|---|------|------|----------|
| 1 | 帳戶計劃改「一般 + 家庭 A/B/C/D」 | ✅ 完成 | 官網價目頁、會員中心改為一般帳戶 + 家庭帳戶 A($8,800)/B($12,800)/C($16,800)/D($20,800)；admin/staff 後台標籤同步；checkout 接受 `plan` 參數並寫入 `family_plan` |
| 2 | A/B/C 按計劃限人數、D 無限 | ✅ 完成 | 後端 `checkFamilyPlanLimit`（A:2/B:5/C:9/D:∞）伺服器端強制；滿額回 `PLAN_LIMIT` + 提示升級；前端提示改為動態按計劃顯示 |
| 3 | 會員編號新規格 | ✅ 完成 | 主帳戶 `S`+方案字母+電話後4（SA1234）、子帳戶 `M`+方案字母（MA1234）、一般 `JR`+後4（JR1234）。四個生成點（註冊/更新資料/開機遷移/開戶重算）全部統一；LIKE 搜尋依賴確認不受影響 |
| 4 | 子帳戶功能對齊 + 戶主自助開戶 | ✅ 完成 | `/family/register`、`/family/add` 開放畀家庭戶主自助（限自己家庭、受計劃上限約束）；子女需 18 歲以下；成功回覆臨時密碼；會員中心加「新增家庭成員（戶主自助）」UI |
| 5 | 討論區審核機制 | ✅ 完成 | `forum_posts` 加 `status` 欄（新帖預設 `pending`）；公開列表只顯示 approved；作者經「我的討論區帖子」見到自己帖 + 待審核/已公開/未獲批徽章；admin/staff 加通過/駁回掣（`PUT /api/admin/content/forum/posts/:id/status`） |
| 6 | 客人心聲復活 | ✅ 完成 | 新建 `customer_voices` 表 + 提交/審批/刪除 API；官網首頁展示（每頁 6 筆、分頁制）；admin 加管理分頁；staff/doctor 加登記表單 |
| 7 | 「寶天醫館」→「寶天JR」 | ✅ 完成 | 所有運行中檔案（5 個門戶、privacy、i18n、server、routes、services）共 73 處全部替換；`design/` 原型圖與 `_i18n_backup/` 備份保留原樣；**注意：背景圖片上烘焙嘅舊名需要另用圖像工具處理** |
| 8 | 家庭關係圖顯示頭像 | ✅ 完成 | admin/staff ftree 節點加頭像（URL 顯示圖片、否則 icon 後備） |
| 9 | 同代同層 + 分代篩選 | ✅ 完成 | ftree 按世代分層（父母層/戶主層/子女層，上至下）；動態世代篩選掣（第一代/第二代/全部），只顯示存在嘅世代 |
| 10 | 家庭資料隔離（伺服器端） | ✅ 完成 | admin 睇全部；主/子帳戶只限自己家庭：bookings/profile/medical 三組端點改為「同家庭任何成員可睇、跨家庭 403」；`GET /family`、`/family/my-tree` 支援子帳戶睇自己家庭 |
| 11 | UI 間距加大 | ✅ 完成 | 5 個門戶加 inline `<style>` 覆寫（space-y/gap 全系列上調約 30%）——因 `css/tailwind.css` 係預建檔，inline 覆寫係唯一可靠做法 |

## 附帶完成

- **Premium 遷移腳本**：`_migrate_premium_to_general.cjs`（`--dry-run`/`--apply`/`--rollback`，冪等、有 `premium_migration_log` 審計表）；舊 premium 用戶現有服務權限保留、身份轉一般帳戶。Live DB 實測 0 個 premium 用戶受影響。
- **admin 離線收款預設**：記錄付款表單移除 premium 選項、預設 family。

## 測試結果（41/41 通過）

- **登入+會員編號**：管理員/一般用戶登入、`JR2233` 格式 ✅
- **論壇審核**（8 項）：發帖預設 pending、公開列表隱藏、作者自見、審批後公開、駁回、非審核者 403 ✅
- **客人心聲**（7 項）：未登入 401、提交 pending、審批後公開、分頁 6 筆/2 頁 ✅
- **家庭自助開戶**（7 項）：開戶+臨時密碼、子帳戶 `MA3333`、18 歲以上拒絕、A 計劃第 3 人 `PLAN_LIMIT`、D 計劃無限 ✅
- **資料隔離**（6 項）：跨家庭 bookings/profile/medical 全部 403、自己 200、子帳戶睇自己家庭樹/列表 ✅
- **門戶渲染**（5 項）：五個門戶 200 + 全部顯示「寶天JR」✅
- **Checkout 閘門**（2 項）：無效 tier 400、無 Stripe 時 503 ✅

## 測試限制（如實聲明）

1. **Stripe 真實付款流程未端到端測試**（避免真實副作用）：checkout 收到 `plan` 後邏輯經代碼審查確認；A–D 分級 Stripe 價格未配置（Stripe 沿用單一家庭計劃 priceId，方案字母由 `family_plan` 驅動會員編號）。
2. **WhatsApp 通知 / Stripe 支付**按既定範圍不覆蓋。
3. 背景圖片烘焙文字（舊「寶天醫館」）需圖像工具另行處理。

## 提交

- 見 git commit hash（本報告同批提交）
- **未提交**（按慣例保留用戶自己嘅未提交變更）：`hr.html`（混合用戶 computed 修復 + 本項改名/間距）、`middlewares/auth.js`、`routes/coupons.js`、`routes/hr.js`、`_i18n_sync.cjs`、docs 刪除

## 測試檔案

- `_fulltest_0915.cjs` — E2E 測試腳本（41 項斷言，冪等，可重跑）
- `_fulltest_0915.db` — 隔離測試快照（可刪）
