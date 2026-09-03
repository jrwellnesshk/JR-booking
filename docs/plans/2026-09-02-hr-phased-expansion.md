# HR 系統 三階段擴充 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 將現有 HR 考勤系統擴充成一個完整、可出糧、可排班嘅中小診所 HR 系統，分三階段逐步落地。

**Architecture:** 沿用現有 Node.js + Express 5 + SQLite + Vue 3 技術棧。資料層喺 `config/migrations.js` 用「CREATE TABLE IF NOT EXISTS + PRAGMA 檢查加欄位」模式。業務邏輯集中喺 `routes/hr.js`。前端係獨立全屏 `hr.html`（admin-only）+ 日後員工端。每一項功能 = 遷移加表/欄 + HR API + hr.html（或員工端）UI + smoke test。

**Tech Stack:** Node.js、Express 5、SQLite（`sqlite3`）、Vue 3 CDN、Tailwind CDN、auth-fetch.js、Font Awesome。

---

## 現有系統（已完成）
- `attendance` 表：每員工每日一條（UNIQUE(attendance_date,user_id)），存 clock_in/clock_out、work_minutes、is_late/is_early_leave/is_absent、source
- `leave_requests` 表：status pending/approved/rejected、假額扣減
- users 已加 `is_active`、`leave_balance`（JSON）
- HR API：打卡/考勤/報表/名冊/補打卡/請假審批
- 規則：寫死 `WORK_START="10:00"`、`WORK_END="19:00"`（見 `routes/hr.js:22-23`）

---

# 階段一：核心完善（必做）

## P1-A：排班 / 營業日曆（員工預設時間 + 例外）

**設計（已同用戶確認）：** 員工個人預設上下班時間 + 逐日例外覆寫。

### 資料表（`config/migrations.js`）

```sql
-- 員工個人預設返工時間（hr_user_schedules）
CREATE TABLE IF NOT EXISTS hr_user_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  work_start TEXT DEFAULT '10:00',
  work_end TEXT DEFAULT '19:00',
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_schedule_user ON hr_user_schedules(user_id);

-- 逐日例外（hr_schedule_exceptions）: 覆寫某員工某日嘅時間，或標記休診/特別收工
CREATE TABLE IF NOT EXISTS hr_schedule_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  exc_date TEXT NOT NULL,
  work_start TEXT,
  work_end TEXT,
  is_off INTEGER DEFAULT 0,          -- 1 = 全天休息（唔返工，唔當缺席）
  note TEXT,
  UNIQUE(user_id, exc_date)
);
CREATE INDEX IF NOT EXISTS idx_hr_exc_date ON hr_schedule_exceptions(exc_date);

-- 診所全局休診日 / 公眾假期（hr_clinic_offdays）
CREATE TABLE IF NOT EXISTS hr_clinic_offdays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  off_date TEXT UNIQUE NOT NULL,
  name TEXT,                          -- 例如「中秋節」
  is_annual INTEGER DEFAULT 0
);
```

**改動核心邏輯（`routes/hr.js`）：**
- 新增 helper `getWorkTimeFor(userId, dateStr)` → 優先 `hr_schedule_exceptions`，其次 `hr_user_schedules`，最後診所休診日，預設 10:00-19:00。
- clock-in / clock-out / 遲到早退判斷 / work_minutes / 缺席計算全部改用 helper，唔再寫死常量。
- 若該日屬 `hr_clinic_offdays` 或該員工 `is_off`，唔會當缺席。
- 缺席計算排除診所休診日（而家只排除週末）。

**新 API：**
- `GET /api/hr/schedules/all` (admin) — 所有員工預設時間
- `PUT /api/hr/schedules/:userId` (admin) — 設某員工預設返工時間
- `GET /api/hr/schedule-exceptions?from&to` (admin) — 列例外
- `POST /api/hr/schedule-exceptions` (admin) — 加例外（含 is_off）
- `DELETE /api/hr/schedule-exceptions/:id` (admin)
- `GET /api/hr/clinic-offdays` / `POST` / `DELETE` (admin) — 診所休診/公眾假期
- `GET /api/hr/my-status` (staff/doctor) 回應加返「今日更表時間」

**前端（hr.html）：** 新增「排班管理」view：員工預設時間編輯 + 例外日曆（揀日期、逐員工覆寫/休息）+ 診所休診日管理。

## P1-B：考勤狀態細分（兼職半日 / 外勤 / 培訓）

**設計：** 現時 attendance 只得完整返工。加入「出勤類型」（attendance_type），令一日可以係 半日 / 外勤 / 培訓，影響工時與缺席統計。

### 資料表
```sql
ALTER TABLE attendance ADD COLUMN attendance_type TEXT DEFAULT 'full';  -- full, half, fieldwork, training
```

**邏輯改動：**
- 打卡時 / 補打卡時可指定 attendance_type。
- 半日（half）：只用上班或下班其一，唔當早退/早到。
- 外勤 / 培訓（fieldwork / training）：唔計入遲到早退，缺席唔當（有紀錄即可）。
- 報表/異常查詢加上 attendance_type 欄位。

**新 API：** 打卡 / 補打卡 body 加 `attendance_type`；`/today`、`/history`、`/report` 回應加欄位。

**前端：** 表加「類型」欄；補打卡 form 加類型選擇。

## P1-C：詳細 HR 個人檔案（出糧 / 私隱）

**設計（已同用戶確認為「詳細 HR 檔案」）：** users 表加出糧及 HR 資料欄位。

### 資料表（`config/migrations.js` PRAGMA 加欄）
```sql
ALTER TABLE users ADD COLUMN hire_date TEXT;          -- 入職日期
ALTER TABLE users ADD COLUMN hourly_rate REAL;        -- 時薪 (HKD)
ALTER TABLE users ADD COLUMN id_number TEXT;          -- 身份證（已遮罩顯示）
ALTER TABLE users ADD COLUMN address TEXT;
ALTER TABLE users ADD COLUMN bank_account TEXT;       -- 銀行戶口
ALTER TABLE users ADD COLUMN emergency_name TEXT;
ALTER TABLE users ADD COLUMN emergency_phone TEXT;
ALTER TABLE users ADD COLUMN basic_salary REAL;       -- 月薪（可選，用嚟代替時薪）
```

**新 API：**
- `GET /api/hr/employees` 回應加上述欄位（id_number 遮罩，如 `A***3(4)`）
- `PUT /api/hr/employees/:id` 可更新 HR 資料（hr field 用獨立 endpoint 避免同登入資料混埋）
- 加 `PUT /api/hr/employees/:id/hr-profile` (admin) 集中更新 HR 欄位

**前端：** 員工名冊行加「HR 檔案」掣 → modal 編輯詳細資料；表可選睇入職日/時薪。

## P1-D：出糧 CSV 匯出（月結 / OT / 時薪）

**設計：** 用報表引擎計一個月每個員工：出勤日數、總工時、OT 小時、應發薪金，匯出 CSV。

**邏輯（`routes/hr.js` 新 endpoint）：**
- `GET /api/hr/payroll?from&to` (admin) — 計算：
  - 出勤日數 = 有打卡嘅工作日數
  - 總工時 = sum(work_minutes)
  - OT = max(0, 每日 work_minutes - 應返工分鐘) 累積（若員工該日實際返工超過更表時間）
  - 基本薪金 = 總工時 × hourly_rate（或用 monthly salary 按比例，暫以 hourly 為主）
  - OT 薪金 = OT 小時 × hourly_rate × 1.5（可設定）
- `GET /api/hr/payroll/export?from&to` (admin) — 回傳 CSV（text/csv，BOM for Excel 中文）
- 只計有 `hourly_rate` 或 `basic_salary` 嘅員工，無嘅標「未設薪金」

**前端：** 「出糧」view：揀月份 → 表格預覽 + 「匯出 CSV」掣（用 Blob download）。列出未設薪金嘅員工提示。

---

### 階段一收尾
- smoke test：temp server + fresh DB，逐 API 驗證；hr.html 各新 view 拉資料。
- 你驗收後先開始階段二。

---

# 階段二：流程與協作（揀做：② 加班、④ 文件、⑥ 假額自動累積）

## P2-B：加班（Overtime）
- `hr_overtime` 表：user_id、date、start/end 或 hours、type(補鐘/薪金)、status(pending/approved)、reviewed_by 等
- 員工申請加班 → admin/主管審批；審批後計入 OT
- hr.html「加班審批」view；員工端「申請加班」
- 出糧時 OT 加乘

## P2-D：文件管理（Documents）
- 通用檔案表 `hr_documents`：user_id、type(合約/證書/醫療證明/其他)、file_path、expiry_date、note、uploaded_by
- 上傳（用現有 multer / upload 機制）、按員工/類型查、到期提醒（expiry_date 30 日內）
- 上傳檔案放 `uploads/hr/`，並確保 BLOCKED_STATIC 唔阻 uploads（或另設 protected static route）
- hr.html「文件管理」view；員工端上傳自己文件

## P2-F：假額自動累積（按年資）
- 新增 `hr_leave_policies` 表：leave_type、base、按年資加乘規則（例如每年 +1，上限）
- 或實作「年度重置」job：每年 1 月 1 日按入職年資重設/累積假額
- 用 SQLite `UPDATE ... WHERE` 或 Node 排程（setInterval 檢查日期）——睇服器有冇 job runner；無就用「查閱時 lazy 計算 + 記錄上次重設日期」
- hr.html 假額顯示改為實時計算；EMP 可手動調整

---

# 階段三：智能與擴展（揀做：② 員工自助 ESS、① 進階報表）

## P3-B：員工自助 ESS 完善
- 為 staff/doctor 做一個 ESS 版面（可沿用/擴充 staff.html 或新 hr-self.html）
- 功能：睇自己班表、假額餘額、請假申請、睇出糧單（月薪金額）、更新個人資料、上傳文件
- 權限：staff/doctor 只睇自己

## P3-A：進階考勤報表 / 圖表
- 用 Chart.js CDN 加圖表：缺勤趨勢、遲到熱點、OT 成本、部門/角色匯總
- `/api/hr/report` 擴充返統計維度（按角色/月份）
- hr.html「統計報表」加入圖表 tab

---

## 測試方法（每階段）
- 用 temp server（port 4200，fresh DB，`ADMIN_PASSWORD=testAdmin123`、`CAPTCHA_TEST_BYPASS=test999`）做端到端 smoke test：
  1. admin 登入
  2. 建/查員工
  3. 每項新 API 用 `Invoke-RestMethod` 驗證
  4. hr.html `node --check` 驗證 Vue script 語法
- 完成後殺 temp server。
- 只 stage 相關檔案 commit（唔好 commit PPT、seed_test_accounts.js 等無關檔案）。

## 驗收 checkpoint
- 每個階段完成後停低俾用戶驗收，先開始下一個階段
- 用戶已揀：逐階段完整交付
