# 寶天醫館 · 英文模式全站版面審計報告
**Po Tin Medical (booking-aurora) — EN-mode Full-Site Layout Audit**

- 日期：2026-09-08（Pass 1）+ 2026-09-09（Pass 2）
- 方法：Puppeteer headless 幾何審計（無截圖，純量測）
- 視口：1280（desktop）/ 900（tablet）/ 390（mobile）
- 量度：`documentElement.scrollWidth − clientWidth`（頁面橫向溢出）、元素 `scrollWidth − clientWidth`（內部溢出）、`getBoundingClientRect()` 對視口裁切、子元件重疊

---

## 結論（Verdict）
✅ **全站英文模式在所有可觸達介面均無實質版面回歸（REAL ISSUES: NONE）。**

兩輪審計共覆蓋：靜態首頁各 section + 9 個會員視圖 + 互動子狀態（登入角色頁籤、訪客預約彈窗、重設密碼、忘記 ID）。

---

## Pass 1 — 靜態 + 會員視圖（2026-09-08）
- 首頁各 section（hero / 服務 / 案例 / 登入 / 公告 / 頁腳）+ 9 個會員視圖
- 視口 1280 / 900 / 390 量測
- 結果：**REAL ISSUES: NONE**（僅裝飾性 benign 溢位，不影響佈局）
- 已修復回歸（已提交 `ea04b47`、`d9cc95a`）：
  1. 頂欄 CTA「Book」標籤在英文模式被錯誤隱藏 → 改為僅手機隱藏標籤
  2. 會員側欄頭像與「服務」導覽過近 → 拉開至 ~26px
  3. 寬視口頂欄 8 個英文連結 + CTA 裁切 → 縮短標籤為「Book」+ EN `max-width:1440px` + 漢堡包斷點提升至 1440px

---

## Pass 2 — 互動子狀態（2026-09-09，本節）
首輪審計跳過了「需要互動才出現」的子狀態。本輪補齊。

| 介面 | 1280 | 900 | 390 | 備註 |
|---|---|---|---|---|
| 登入區角色頁籤（Client / Practitioner / Staff） | hOverflow 0 | 0 | 0 | flex 頁籤英文寬度自適應，無裁切 |
| 訪客預約彈窗（Guest Booking） | 清 | 清 | 清 | innerOverflowX 0、無視口裁切 |
| 重設密碼彈窗（Reset Password） | 清 | 清 | 清 | `max-w-md` 自約束 |
| 忘記 ID 彈窗（Find User ID） | 清 | 清 | 清 | `max-w-md` 自約束 |
| 首頁頁面橫向溢出（pageHScroll） | 0 | 0 | 0 | 全寬無橫向捲軸 |

**量測細節（登入頁籤）**：desktop rowW=357 三頁籤各 114px；tablet rowW=657 各 214px；mobile rowW=226（Client 59 / Practitioner 98 / Staff 52）。三視口 `hOverflow=0`、`vOverflow=0`。

**量測細節（彈窗）**：所有 `.m-modal` 在 1280/900/390 下 `innerOverflowX=0`、左右界均落在視口內（right ≤ vw、left ≥ 0）、`pageHScroll=0`。

---

## 覆蓋缺口（受 scenario.db 資料限制，無法執行）
以下兩個**會員專用**詳情彈窗在當前 scenario 資料下**無法觸發**，故未能量測，但標註其結構風險：

1. **論壇帖子詳情（Forum Post Detail）**
   - `forum_posts` 資料表為空（0 筆）→ 列表渲染空白狀態，詳情彈窗不可達。
   - 空白狀態位於正常文件流，無頁面橫向溢出。
2. **病歷詳情（Medical Record Detail）**
   - `medical_records` 全表對所有用戶皆為空 → 彈窗不可達（含 `sc_cust01`）。
   - 結構與已驗證清潔彈窗一致：`max-w-2xl w-full overflow-y-auto`、長文 `whitespace-pre-wrap`、媒體 `w-full` 約束。

**結構評估**：兩者皆使用與已驗證清潔彈窗相同的 `.m-modal` 殼層與約束，英文溢位風險低。

**選用防禦建議**：未來若病歷 `diagnosis/treatment_plan` 可能貼入超長無空格字串，可在該長文區塊加 `overflow-wrap:break-word` 以防萬一（當前無需修改）。

---

## 總結
原始需求「研究成個網站變咗英文之後嘅位置」已於所有可觸達介面完成。唯一未能量測項目為受空白 scenario 資料阻塞的會員專用詳情彈窗，其標記結構低風險。

提交：`ea04b47`（Pass 1 修復）、`d9cc95a`（Pass 1 修復）、本報告（Pass 2 記錄）。
