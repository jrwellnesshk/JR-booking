const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { serverError } = require("../services/httpResp");
const { isHoliday, getHolidaysInRange } = require("../services/holidays");

// ==================================================================
// 📄 員工文件上傳（階段三）：允許 PDF / 圖片 / Office 文檔
// 檔名由伺服器生成（防止路徑注入），寫入 uploads/hr_documents。
// ==================================================================
const DOC_EXT_MAP = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "text/plain": ".txt",
};
const hrDocStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "..", "uploads", "hr_documents");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = DOC_EXT_MAP[file.mimetype] || ".bin";
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});
const hrDocUpload = multer({
  storage: hrDocStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (DOC_EXT_MAP[file.mimetype]) return cb(null, true);
    cb(new Error("不允許嘅檔案類型：只可上傳 PDF、圖片或 Office 文檔"));
  },
});

/**
 * 👥 HR 路由（人力資源部）
 * 參考一般 HR/考勤系統：打卡、考勤總覽、統計報表、員工名冊、出勤異常、手動補打卡、請假管理。
 *
 * 權限：
 *  - staff / doctor / admin：自己打卡、睇自己考勤/請假、申請/取消請假（自助）
 *  - admin：名冊管理、即日考勤、歷史/報表、補打卡、審批請假、排班/營業日曆、出糧
 *
 * 規則：
 *  - 營業時間 / 更表：診所休診日 > 員工逐日例外 > 員工預設時間 > 全局 10:00-19:00
 *  - 遲到：上班打卡遲過當日更表上班時間
 *  - 早退：有上班打卡但收工早過當日更表下班時間
 *  - 缺席：過去工作日(非假日/非休息)冇任何打卡、亦冇批準請假
 *  - 批準請假嘅日期：唔當缺席，狀態顯示「請假」
 */
module.exports = (db, hashPassword, { requireAuth, requireRole } = {}) => {

  const toMin = (t) => {
    if (!t) return null;
    const m = String(t).match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  };
  const fmtMin = (min) => {
    if (min == null || isNaN(min)) return "";
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return `${h}小時${m > 0 ? ` ${m}分` : ""}`.trim();
  };
  const todayStr = () => {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  };
  const nowTime = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const isWeekend = (dateStr) => {
    const d = new Date(dateStr + "T12:00:00");
    const wd = d.getDay();
    return wd === 0 || wd === 6; // 星期日/六
  };
  const dateRange = (start, end) => {
    const out = [];
    const s = new Date(start + "T00:00:00");
    const e = new Date(end + "T00:00:00");
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const m = String(d.getMonth() + 1).padStart(2, "0");
      out.push(`${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, "0")}`);
    }
    return out;
  };

  // ==================================================================
  // 員工假期日曆：全員「已批准」請假，按日展開，供 HR 一眼睇晒邊日邊人放假
  // 返回 { year, month, days:{ "YYYY-MM-DD":[{name,role,leave_type,leave_type_label,reason}] }, legend }
  // ==================================================================
  router.get("/leave-calendar", requireAuth, requireRole('admin'), (req, res) => {
    const now = new Date();
    const year = req.query.year ? parseInt(req.query.year, 10) : now.getFullYear();
    const month = req.query.month
      ? String(req.query.month).padStart(2, "0")
      : String(now.getMonth() + 1).padStart(2, "0");
    const ym = `${year}-${month}`;
    const daysInMonth = new Date(year, parseInt(month, 10), 0).getDate();
    const start = `${ym}-01`;
    const end = `${ym}-${String(daysInMonth).padStart(2, "0")}`;
    db.all(
      `SELECT lr.user_id, lr.name AS lr_name, lr.role AS lr_role, lr.leave_type, lr.start_date, lr.end_date, lr.reason,
              u.name AS user_name, u.role AS user_role
       FROM leave_requests lr LEFT JOIN users u ON u.id=lr.user_id
       WHERE lr.status='approved' AND lr.end_date>=? AND lr.start_date<=?`,
      [start, end],
      (err, rows) => {
        if (err) return serverError(res, err);
        const days = {};
        (rows || []).forEach((l) => {
          const s = l.start_date < start ? start : l.start_date;
          const e = l.end_date > end ? end : l.end_date;
          const name = l.user_name || l.lr_name || "—";
          const role = l.user_role || l.lr_role || "";
          const typeLabel = leaveTypeLabel[l.leave_type] || l.leave_type;
          dateRange(s, e).forEach((d) => {
            if (!days[d]) days[d] = [];
            days[d].push({
              name,
              role,
              leave_type: l.leave_type,
              leave_type_label: typeLabel,
              reason: l.reason || "",
            });
          });
        });
        Object.keys(days).forEach((d) =>
          days[d].sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-Hant"))
        );
        res.json({ year, month: parseInt(month, 10), days, legend: leaveTypeLabel });
      }
    );
  });

  // ==================================================================
  // 🗓️ 排班 / 營業日曆（階段一）
  // 優先次序：診所休診日 > 員工逐日例外(is_off/time) > 員工預設時間 > 全局 10:00-19:00
  // ==================================================================
  const GLOBAL_START = "10:00";
  const GLOBAL_END = "19:00";

  // 檢查某日係咪診所休診日（callback）
  const isClinicOffday = (dateStr, cb) => {
    db.get("SELECT id FROM hr_clinic_offdays WHERE off_date=?", [dateStr], (err, row) => cb(null, !!row));
  };

  // 每週更表預設時段：一至五 10:00-19:00、六 10:00-13:00（key=星期幾 getDay 0-6）
  const DEFAULT_WEEKLY_HOURS = {
    "1": "10:00-19:00", "2": "10:00-19:00", "3": "10:00-19:00",
    "4": "10:00-19:00", "5": "10:00-19:00", "6": "10:00-13:00"
  };
  const parseHours = (json) => {
    if (!json) return { ...DEFAULT_WEEKLY_HOURS };
    try {
      const obj = JSON.parse(json);
      return { ...DEFAULT_WEEKLY_HOURS, ...obj };
    } catch (e) {
      return { ...DEFAULT_WEEKLY_HOURS };
    }
  };

  // 查某員工某日應返工時間窗（promise）→ { off, work_start, work_end }
  const getWorkWindow = (userId, dateStr) => new Promise((resolve) => {
    db.get(
      "SELECT work_start, work_end, is_off FROM hr_schedule_exceptions WHERE user_id=? AND exc_date=?",
      [userId, dateStr],
      (excErr, exc) => {
        if (excErr) return resolve({ off: false, work_start: GLOBAL_START, work_end: GLOBAL_END });
        if (exc && exc.is_off) return resolve({ off: true, work_start: GLOBAL_START, work_end: GLOBAL_END });
        if (exc && (exc.work_start || exc.work_end)) {
          return resolve({ off: false, work_start: exc.work_start || GLOBAL_START, work_end: exc.work_end || GLOBAL_END });
        }
        // 兼職：以「已批更表」為準 —— 嗰日有已批兼職更就用該時段，冇就休息
        db.get("SELECT employment_type FROM users WHERE id=?", [userId], (etErr, etRow) => {
          const isPart = etErr ? false : (etRow && etRow.employment_type === 'part');
          if (isPart) {
            db.get(
              "SELECT i.time_start, i.time_end FROM hr_shift_items i JOIN hr_shift_rosters r ON r.id=i.roster_id AND r.status='approved' WHERE i.user_id=? AND i.shift_date=?",
              [userId, dateStr],
              (siErr, item) => {
                if (siErr) return resolve({ off: false, work_start: GLOBAL_START, work_end: GLOBAL_END });
                if (item && (item.time_start || item.time_end)) {
                  return resolve({ off: false, work_start: (item.time_start || GLOBAL_START).trim(), work_end: (item.time_end || GLOBAL_END).trim() });
                }
                return resolve({ off: true, work_start: GLOBAL_START, work_end: GLOBAL_END });
              }
            );
            return;
          }
          // 香港公眾假期 → 全職休假
          if (isHoliday(dateStr)) {
            return resolve({ off: true, work_start: GLOBAL_START, work_end: GLOBAL_END });
          }
          db.get("SELECT * FROM hr_user_schedules WHERE user_id=?", [userId], (sErr, s) => {
            if (sErr) return resolve({ off: false, work_start: GLOBAL_START, work_end: GLOBAL_END });
            const dow = new Date(dateStr + "T12:00:00").getDay();
            // 冇排班記錄 → 用每週預設（一至五10-19、六10-13，其餘休息）
            if (!s) {
              const slot = DEFAULT_WEEKLY_HOURS[String(dow)];
              if (slot) {
                const [ws, we] = slot.split("-");
                return resolve({ off: false, work_start: (ws || GLOBAL_START).trim(), work_end: (we || GLOBAL_END).trim() });
              }
              return resolve({ off: true, work_start: GLOBAL_START, work_end: GLOBAL_END });
            }
            // is_active=0 → 停用，用單一時間（同舊式）
            if (s.is_active === 0) {
              return resolve({ off: false, work_start: s.work_start || GLOBAL_START, work_end: s.work_end || GLOBAL_END });
            }
            if (s.is_weekly == 1) {
              // 每週模式：按星期幾拎時段
              const hours = parseHours(s.hours);
              const slot = hours[String(dow)];
              if (slot) {
                const [ws, we] = slot.split("-");
                return resolve({ off: false, work_start: (ws || GLOBAL_START).trim(), work_end: (we || GLOBAL_END).trim() });
              }
              return resolve({ off: true, work_start: GLOBAL_START, work_end: GLOBAL_END });
            }
            // 舊式單一時段
            return resolve({ off: false, work_start: s.work_start || GLOBAL_START, work_end: s.work_end || GLOBAL_END });
          });
        });
        return;
      }
    );
  });

  // 檢查某員工某日係咪休息（員工 is_off 例外）（promise）
  const isUserOff = (userId, dateStr) => new Promise((resolve) => {
    db.get(
      "SELECT is_off FROM hr_schedule_exceptions WHERE user_id=? AND exc_date=?",
      [userId, dateStr],
      (err, exc) => {
        if (err) return resolve(false);
        if (exc && exc.is_off) return resolve(true);
        return resolve(false);
      }
    );
  });

  // 預設假額
  const DEFAULT_BALANCE = { annual: 12, sick: 12, personal: 2, statutory: -1, personal_other: -1 };
  const parseBalance = (user) => {
    let b = {};
    try {
      b = JSON.parse((user && user.leave_balance) || "{}");
      if (b === null || typeof b !== 'object') b = {};
    } catch (e) {
      b = {};
    }
    const merged = { ...DEFAULT_BALANCE, ...b };
    // 🔧 防禦：個別假期類型若被設成 null/undefined（例如管理員手動編輯 JSON 出錯），
    //    會蓋過預設值，令 `balance[x] >= 0` 判斷失效 → 變相無限額。統一還原成預設值（保留 -1 = 無限）。
    for (const k of Object.keys(merged)) {
      if (merged[k] === null || merged[k] === undefined) merged[k] = (DEFAULT_BALANCE[k] !== undefined ? DEFAULT_BALANCE[k] : 0);
    }
    return merged;
  };
  const leaveTypeLabel = {
    annual: "有薪年假",
    sick: "有薪病假",
    personal: "事假",
    statutory: "勞工假期補假",
    personal_other: "個人原因",
  };
  const attTypeLabel = {
    full: "全日",
    half: "半日",
    fieldwork: "外勤",
    training: "培訓",
  };

  // 計算某員工某年已批準請假日數（按類別）
  const usedDays = (userId, year, cb) => {
    db.all(
      `SELECT leave_type, start_date, end_date FROM leave_requests
       WHERE user_id=? AND status='approved'`,
      [userId],
      (err, rows) => {
        if (err) return cb(err, {});
        const used = { annual: 0, sick: 0, personal: 0, statutory: 0, personal_other: 0 };
        (rows || []).forEach((r) => {
          const s = r.start_date.slice(0, 4);
          const e = r.end_date.slice(0, 4);
          if (s !== String(year) && e !== String(year)) return;
          let days = 0;
          dateRange(r.start_date, r.end_date).forEach((d) => {
            if (d.slice(0, 4) === String(year)) days += 1;
          });
          if (used[r.leave_type] !== undefined) used[r.leave_type] += days;
        });
        cb(null, used);
      }
    );
  };

  // 查詢員工是否在某日期有批準請假（返回 leave_type）
  const approvedLeaveOn = (userId, dateStr, cb) => {
    db.get(
      `SELECT leave_type FROM leave_requests
       WHERE user_id=? AND status='approved' AND start_date<=? AND end_date>=?`,
      [userId, dateStr, dateStr],
      (err, row) => cb(err, row ? row.leave_type : null)
    );
  };

  // ==================================================================
  // 員工 / 醫生 / 管理員 自助
  // ==================================================================

  // 上班打卡
  router.post("/clock-in", requireAuth, requireRole('staff', 'doctor', 'admin'), (req, res) => {
    const user = req.user;
    db.get(
      "SELECT id, is_active, role FROM users WHERE id=?",
      [user.id],
      (e, u) => {
        if (e) return serverError(res, e);
        if (!u) return res.status(404).json({ error: "帳戶不存在" });
        if (u.is_active === 0) return res.status(403).json({ error: "帳戶已停用，無法打卡" });
        const date = todayStr();
        const time = nowTime();
        getWorkWindow(user.id, date).then((win) => {
          if (win.off) return res.status(400).json({ error: "今日為休息/休診日，無需打卡" });
          const workStart = win.work_start;
          db.get(
            "SELECT * FROM attendance WHERE attendance_date=? AND user_id=?",
            [date, user.id],
            (err, row) => {
              if (err) return serverError(res, err);
              if (row && row.clock_in) {
                return res.status(400).json({ error: "今日已打卡上班", data: row });
              }
              const isLate = toMin(time) > toMin(workStart) ? 1 : 0;
              if (row) {
                db.run(
                  "UPDATE attendance SET clock_in=?, is_late=?, source='self', updated_at=CURRENT_TIMESTAMP WHERE id=?",
                  [time, isLate, row.id],
                  function (updateErr) {
                    if (updateErr) return serverError(res, updateErr);
                    res.json({ success: true, message: "上班打卡成功", clock_in: time, is_late: isLate, id: row.id, work_start: workStart });
                  }
                );
              } else {
                db.run(
                  `INSERT INTO attendance (user_id, name, role, attendance_date, clock_in, is_late, source)
                   VALUES (?, ?, ?, ?, ?, ?, 'self')`,
                  [user.id, user.name, user.role, date, time, isLate],
                  function (insErr) {
                    if (insErr) return serverError(res, insErr);
                    res.json({ success: true, message: "上班打卡成功", clock_in: time, is_late: isLate, id: this.lastID, work_start: workStart });
                  }
                );
              }
            }
          );
        });
      }
    );
  });

  // 下班打卡
  router.post("/clock-out", requireAuth, requireRole('staff', 'doctor', 'admin'), (req, res) => {
    const user = req.user;
    const date = todayStr();
    const time = nowTime();
    db.get(
      "SELECT * FROM attendance WHERE attendance_date=? AND user_id=?",
      [date, user.id],
      (err, row) => {
        if (err) return serverError(res, err);
        if (!row || !row.clock_in) {
          return res.status(400).json({ error: "今日尚未打卡上班，無法下班打卡" });
        }
        if (row.clock_out) {
          return res.status(400).json({ error: "今日已打卡下班", data: row });
        }
        getWorkWindow(user.id, date).then((win) => {
          const workEnd = win.work_end;
          const workMinutes = Math.max(0, toMin(time) - toMin(row.clock_in));
          const isEarly = toMin(time) < toMin(workEnd) ? 1 : 0;
          db.run(
            `UPDATE attendance SET clock_out=?, work_minutes=?, is_early_leave=?, source='self', updated_at=CURRENT_TIMESTAMP WHERE id=?`,
            [time, workMinutes, isEarly, row.id],
            function (updErr) {
              if (updErr) return serverError(res, updErr);
              res.json({
                success: true, message: "下班打卡成功",
                clock_in: row.clock_in, clock_out: time,
                work_minutes: workMinutes, work_label: fmtMin(workMinutes), is_early_leave: isEarly, work_end: workEnd,
              });
            }
          );
        });
      }
    );
  });

  // 自己今日狀態 + 假額 + 今日更表
  router.get("/my-status", requireAuth, requireRole('staff', 'doctor', 'admin'), (req, res) => {
    const user = req.user;
    const date = todayStr();
    db.get(
      "SELECT * FROM attendance WHERE attendance_date=? AND user_id=?",
      [date, user.id],
      (err, row) => {
        if (err) return serverError(res, err);
        const year = new Date().getFullYear();
        usedDays(user.id, year, (udErr, used) => {
          if (udErr) return serverError(res, udErr);
          db.get("SELECT leave_balance FROM users WHERE id=?", [user.id], (lbErr, lbRow) => {
            if (lbErr) return serverError(res, lbErr);
            const balance = parseBalance({ leave_balance: lbRow ? lbRow.leave_balance : null });
            const avail = {};
            Object.keys(balance).forEach((k) => {
              avail[k] = balance[k] < 0 ? -1 : Math.max(0, balance[k] - (used[k] || 0));
            });
            getWorkWindow(user.id, date).then((win) => {
              res.json({
                date,
                attendance: row || null,
                work_label: row && row.work_minutes ? fmtMin(row.work_minutes) : "",
                balance,
                used,
                available: avail,
                schedule: { work_start: win.work_start, work_end: win.work_end, off: win.off },
              });
            });
          });
        });
      }
    );
  });

  // 自己考勤歷史
  router.get("/my-records", requireAuth, requireRole('staff', 'doctor', 'admin'), (req, res) => {
    const user = req.user;
    const from = req.query.from || todayStr().slice(0, 8) + "01";
    const to = req.query.to || todayStr();
    db.all(
      "SELECT * FROM attendance WHERE user_id=? AND attendance_date>=? AND attendance_date<=? ORDER BY attendance_date DESC",
      [user.id, from, to],
      (err, rows) => {
        if (err) return serverError(res, err);
        (rows || []).forEach((r) => { r.work_label = fmtMin(r.work_minutes); });
        res.json({ from, to, records: rows || [] });
      }
    );
  });

  // 自己請假紀錄
  router.get("/my-leaves", requireAuth, requireRole('staff', 'doctor', 'admin'), (req, res) => {
    const user = req.user;
    db.all(
      "SELECT * FROM leave_requests WHERE user_id=? ORDER BY created_at DESC, id DESC",
      [user.id],
      (err, rows) => {
        if (err) return serverError(res, err);
        (rows || []).forEach((r) => {
          r.leave_type_label = leaveTypeLabel[r.leave_type] || r.leave_type;
          const s = new Date(r.start_date), e = new Date(r.end_date);
          r.days = Math.round((e - s) / 86400000) + 1;
        });
        res.json(rows || []);
      }
    );
  });

  // 申請請假（含假額檢查）
  router.post("/leaves", requireAuth, requireRole('staff', 'doctor', 'admin'), (req, res) => {
    const user = req.user;
    const { leave_type, start_date, end_date, reason } = req.body;
    if (!leave_type || !start_date || !end_date) {
      return res.status(400).json({ error: "請提供假別、開始日期與結束日期" });
    }
    if (!leaveTypeLabel[leave_type]) return res.status(400).json({ error: "無效嘅假別" });
    if (String(end_date) < String(start_date)) return res.status(400).json({ error: "結束日期不能早於開始日期" });
    // 檢查重疊（已批準或待審批）
    db.get(
      `SELECT id FROM leave_requests WHERE user_id=? AND status!='rejected' AND start_date<=? AND end_date>=?`,
      [user.id, end_date, start_date],
      (oErr, overlap) => {
        if (oErr) return serverError(res, oErr);
        if (overlap) return res.status(400).json({ error: "該期間已有請假申請，請刪除後再申請" });
        const year = new Date().getFullYear();
        db.get("SELECT leave_balance FROM users WHERE id=?", [user.id], (lbErr, lbRow) => {
          if (lbErr) return serverError(res, lbErr);
          const balance = parseBalance({ leave_balance: lbRow ? lbRow.leave_balance : null });
          const s = new Date(start_date), e = new Date(end_date);
          const days = Math.round((e - s) / 86400000) + 1;
          if (balance[leave_type] !== undefined && balance[leave_type] >= 0) {
            usedDays(user.id, year, (udErr, used) => {
              if (udErr) return serverError(res, udErr);
              const remaining = balance[leave_type] - (used[leave_type] || 0);
              if (days > remaining) {
                return res.status(400).json({ error: `假額不足：${leaveTypeLabel[leave_type]}剩餘 ${Math.max(0, remaining)} 日` });
              }
              db.run(
                `INSERT INTO leave_requests (user_id, name, role, leave_type, start_date, end_date, reason, leave_balance)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [user.id, user.name, user.role, leave_type, start_date, end_date, reason || "", JSON.stringify(balance)],
                function (insErr) {
                  if (insErr) return serverError(res, insErr);
                  res.json({ success: true, message: "請假申請已提交，等待審批", id: this.lastID });
                }
              );
            });
          } else {
            db.run(
              `INSERT INTO leave_requests (user_id, name, role, leave_type, start_date, end_date, reason, leave_balance)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [user.id, user.name, user.role, leave_type, start_date, end_date, reason || "", JSON.stringify(balance)],
              function (insErr) {
                if (insErr) return serverError(res, insErr);
                res.json({ success: true, message: "請假申請已提交，等待審批", id: this.lastID });
              }
            );
          }
        });
      }
    );
  });

  // 取消自己嘅 pending 請假
  router.delete("/leaves/:id", requireAuth, requireRole('staff', 'doctor', 'admin'), (req, res) => {
    const user = req.user;
    db.get("SELECT * FROM leave_requests WHERE id=? AND user_id=?", [req.params.id, user.id], (err, leave) => {
      if (err) return serverError(res, err);
      if (!leave) return res.status(404).json({ error: "請假記錄不存在" });
      if (leave.status !== "pending") return res.status(400).json({ error: "只有待審批嘅請假先可以取消" });
      db.run("DELETE FROM leave_requests WHERE id=?", [leave.id], function (delErr) {
        if (delErr) return serverError(res, delErr);
        res.json({ success: true, message: "請假申請已取消" });
      });
    });
  });

  // ==================================================================
  // 👤 員工自助 (ESS) — 自己個人資料 / 更表 / 出糧單 / 文件（階段三）
  // ==================================================================

  // 自己個人資料（敏感欄位遮罩）
  router.get("/my-profile", requireAuth, requireRole('staff', 'doctor', 'admin'), (req, res) => {
    const user = req.user;
    db.get(
      `SELECT id, username, name, name_en, phone, email, role, hire_date, address,
              emergency_contact, emergency_phone, id_card, bank_account, hourly_rate, basic_salary
       FROM users WHERE id=?`,
      [user.id],
      (err, row) => {
        if (err) return serverError(res, err);
        if (!row) return res.status(404).json({ error: "用戶不存在" });
        row.id_card_masked = maskId(row.id_card);
        row.bank_account_masked = row.bank_account ? "****" + String(row.bank_account).slice(-4) : "";
        delete row.id_card;
        delete row.bank_account;
        res.json(row);
      }
    );
  });

  // 更新自己個人資料（只限可編輯欄位，薪酬/身份證/銀行一律唔俾改）
  router.put("/my-profile", requireAuth, requireRole('staff', 'doctor', 'admin'), (req, res) => {
    const user = req.user;
    const { phone, email, address, emergency_contact, emergency_phone } = req.body;
    db.run(
      `UPDATE users SET
         phone=COALESCE(?, phone),
         email=COALESCE(?, email),
         address=COALESCE(?, address),
         emergency_contact=COALESCE(?, emergency_contact),
         emergency_phone=COALESCE(?, emergency_phone)
       WHERE id=?`,
      [phone != null ? phone : null, email != null ? email : null, address != null ? address : null,
       emergency_contact != null ? emergency_contact : null, emergency_phone != null ? emergency_phone : null, user.id],
      function (uErr) {
        if (uErr) return serverError(res, uErr);
        res.json({ success: true, message: "個人資料已更新" });
      }
    );
  });

  // 自己返工更表（日期範圍，按每週時段/逐日例外計算）
  // 自己返工時間表（兼職專用：睇自己已批更表；全職唔開放自我查看）
  router.get("/my-schedule", requireAuth, requireRole('staff', 'doctor', 'admin'), (req, res) => {
    const user = req.user;
    const isPart = user.employment_type === 'part';
    if (user.role !== 'admin' && !isPart) return res.status(403).json({ error: "只有兼職員工可以查看自己嘅返工時間表" });
    const from = req.query.from || todayStr().slice(0, 8) + "01";
    const to = req.query.to || todayStr();
    if (String(to) < String(from)) return res.status(400).json({ error: "結束日期不能早於開始日期" });
    const days = dateRange(from, to);
    const tasks = days.map((d) =>
      getWorkWindow(user.id, d).then((win) => ({ date: d, ...win }))
    );
    Promise.all(tasks).then((list) => res.json({ from, to, days: list }));
  });

  // ==================================================================
  // 📅 兼職報更（自己揀更 → 管理員審批）
  // ==================================================================
  const ADD_DAY = (ds, n) => {
    const d = new Date(ds + "T00:00:00");
    d.setDate(d.getDate() + n);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const MONDAY_OF = (ds) => {
    const d = new Date(ds + "T00:00:00");
    const diff = (d.getDay() + 6) % 7; // Monday=0
    return ADD_DAY(ds, -diff);
  };
  // 兼職可報更嘅「下一工作週」：下一個未開始嘅星期一（週一至六為工作週），
  // 截止 = 該週前一個星期日（逢星期日前報更）。
  const offerRosterWeek = (today) => {
    let ws = ADD_DAY(MONDAY_OF(today), 7); // 下一個星期一
    let deadline = ADD_DAY(ws, -1);          // 前一個星期日
    if (String(today) > String(deadline)) {  // 已過截止 → 報更下一個星期
      ws = ADD_DAY(ws, 7);
      deadline = ADD_DAY(ws, -1);
    }
    return { week_start: ws, week_end: ADD_DAY(ws, 5), deadline };
  };
  const isRosterWeekLocked = (weekStart, today) => {
    const deadline = ADD_DAY(weekStart, -1);
    return String(today) > String(deadline);
  };

  // 兼職：查看可報更嗰週（系統派定）
  router.get("/my-roster/week", requireAuth, requireRole('staff', 'doctor', 'admin'), (req, res) => {
    const user = req.user;
    if (user.role !== 'admin' && user.employment_type !== 'part') {
      return res.status(403).json({ error: "只有兼職員工可以報更" });
    }
    const off = offerRosterWeek(todayStr());
    const dates = dateRange(off.week_start, off.week_end).map((date) => ({
      date,
      day: "星期" + "日一二三四五六"[new Date(date + "T12:00:00").getDay()],
    }));
    db.get(
      "SELECT * FROM hr_shift_rosters WHERE user_id=? AND roster_start=?",
      [user.id, off.week_start],
      (err, roster) => {
        if (err) return serverError(res, err);
        const respond = (items) => res.json({
          week_start: off.week_start, week_end: off.week_end, deadline: off.deadline,
          dates,
          canModify: !isRosterWeekLocked(off.week_start, todayStr()) && (!roster || roster.status !== 'pending'),
          existing: roster ? { ...roster, items: items || [] } : null,
        });
        if (!roster) return respond(null);
        db.all("SELECT * FROM hr_shift_items WHERE roster_id=?", [roster.id], (iErr, items) => {
          if (iErr) return serverError(res, iErr);
          respond(items || []);
        });
      }
    );
  });

  // 兼職：提交 / 更新報更（自己揀更）
  router.post("/my-roster", requireAuth, requireRole('staff', 'doctor', 'admin'), (req, res) => {
    const user = req.user;
    if (user.employment_type !== 'part') return res.status(403).json({ error: "只有兼職員工可以報更" });
    const { week_start, shifts, note } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(week_start || ""))) return res.status(400).json({ error: "請提供有效嘅工作週" });
    if (!Array.isArray(shifts) || shifts.length === 0) return res.status(400).json({ error: "請至少揀一日更" });
    if (isRosterWeekLocked(week_start, todayStr())) {
      return res.status(400).json({ error: "報更已截止（需喺前一星期日或之前報更）" });
    }
    const valid = shifts.every((sh) =>
      /^\d{4}-\d{2}-\d{2}$/.test(String(sh.date || "")) &&
      /^\d{2}:\d{2}$/.test(String(sh.time_start || "")) &&
      /^\d{2}:\d{2}$/.test(String(sh.time_end || ""))
    );
    if (!valid) return res.status(400).json({ error: "報更時段格式不正確" });
    db.serialize(() => {
      db.run(
        `INSERT INTO hr_shift_rosters (user_id, roster_start, status, submitted_at, note)
         VALUES (?, ?, 'pending', datetime('now','localtime'), ?)
         ON CONFLICT(user_id, roster_start) DO UPDATE SET
           status='pending', submitted_at=datetime('now','localtime'),
           note=excluded.note, approved_by=NULL, approved_at=NULL`,
        [user.id, week_start, note || ""],
        function (rErr) {
          if (rErr) return serverError(res, rErr);
          const rosterId = this.lastID;
          db.run("DELETE FROM hr_shift_items WHERE roster_id=?", [rosterId], (dErr) => {
            if (dErr) return serverError(res, dErr);
            const stmt = db.prepare("INSERT INTO hr_shift_items (roster_id, user_id, shift_date, time_start, time_end) VALUES (?, ?, ?, ?, ?)");
            shifts.forEach((sh) => stmt.run(rosterId, user.id, sh.date, sh.time_start, sh.time_end));
            stmt.finalize((fErr) => {
              if (fErr) return serverError(res, fErr);
              res.json({ success: true, message: "報更已提交，等待管理員審批", id: rosterId });
            });
          });
        }
      );
    });
  });

  // 兼職：查看自己嘅報更紀錄（含每週細項）
  router.get("/my-roster", requireAuth, requireRole('staff', 'doctor', 'admin'), (req, res) => {
    const user = req.user;
    if (user.employment_type !== 'part') return res.status(403).json({ error: "只有兼職員工可以查看報更" });
    const from = req.query.from || ADD_DAY(todayStr(), -60);
    const to = req.query.to || ADD_DAY(todayStr(), 60);
    db.all(
      "SELECT r.*, u.name FROM hr_shift_rosters r JOIN users u ON u.id=r.user_id WHERE r.user_id=? AND r.roster_start>=? AND r.roster_start<=? ORDER BY r.roster_start DESC",
      [user.id, from, to],
      (err, rows) => {
        if (err) return serverError(res, err);
        const task = (rows || []).map((r) => new Promise((resolve) => {
          db.all("SELECT * FROM hr_shift_items WHERE roster_id=?", [r.id], (iErr, items) => resolve({ ...r, items: items || [] }));
        }));
        Promise.all(task).then((list) => res.json(list));
      }
    );
  });

  // 管理員：查看所有兼職報更（可篩選狀態）
  router.get("/rosters", requireAuth, requireRole('admin'), (req, res) => {
    const from = req.query.from || ADD_DAY(todayStr(), -60);
    const to = req.query.to || ADD_DAY(todayStr(), 60);
    const status = req.query.status;
    let q = `SELECT r.*, u.name AS user_name FROM hr_shift_rosters r JOIN users u ON u.id=r.user_id
             WHERE r.roster_start>=? AND r.roster_start<=?`;
    const params = [from, to];
    if (status && status !== 'all' && status !== '') { q += " AND r.status=?"; params.push(status); }
    q += " ORDER BY r.roster_start DESC, r.id";
    db.all(q, params, (err, rows) => {
      if (err) return serverError(res, err);
      const task = (rows || []).map((r) => new Promise((resolve) => {
        db.all("SELECT * FROM hr_shift_items WHERE roster_id=?", [r.id], (iErr, items) => resolve({ ...r, items: items || [] }));
      }));
      Promise.all(task).then((list) => res.json(list));
    });
  });

  // 管理員：審批 / 拒絕某份報更
  router.post("/rosters/:id/approve", requireAuth, requireRole('admin'), (req, res) => {
    const rosterId = req.params.id;
    db.get("SELECT id FROM hr_shift_rosters WHERE id=?", [rosterId], (e, r) => {
      if (e) return serverError(res, e);
      if (!r) return res.status(404).json({ error: "報更不存在" });
      db.run(
        "UPDATE hr_shift_rosters SET status='approved', approved_by=?, approved_at=datetime('now','localtime') WHERE id=?",
        [req.user.id, rosterId],
        (uErr) => {
          if (uErr) return serverError(res, uErr);
          res.json({ success: true, message: "已批准該週更表" });
        }
      );
    });
  });
  router.post("/rosters/:id/reject", requireAuth, requireRole('admin'), (req, res) => {
    const rosterId = req.params.id;
    db.get("SELECT id FROM hr_shift_rosters WHERE id=?", [rosterId], (e, r) => {
      if (e) return serverError(res, e);
      if (!r) return res.status(404).json({ error: "報更不存在" });
      db.run(
        "UPDATE hr_shift_rosters SET status='rejected', approved_by=?, approved_at=datetime('now','localtime') WHERE id=?",
        [req.user.id, rosterId],
        (uErr) => {
          if (uErr) return serverError(res, uErr);
          res.json({ success: true, message: "已拒絕該週更表" });
        }
      );
    });
  });

  // 自己出糧單（月結計算，只含自己一列）
  router.get("/my-payslip", requireAuth, requireRole('staff', 'doctor', 'admin'), (req, res) => {
    const user = req.user;
    let from = req.query.from || "";
    let to = req.query.to || "";
    if (!from || !to) {
      // 預設上一個月（每月 7 號出上月糧）
      const now = new Date();
      const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const ym = `${pm.getFullYear()}-${String(pm.getMonth() + 1).padStart(2, "0")}`;
      from = `${ym}-01`;
      to = `${ym}-${String(new Date(pm.getFullYear(), pm.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;
    }
    calcPayroll(from, to, (err, data) => {
      if (err) return serverError(res, err);
      const row = (data.rows || []).filter((r) => r.id === user.id)[0] || null;
      res.json({ from, to, workdays: data.workdays, row });
    });
  });

  // 自己文件列表
  router.get("/my-documents", requireAuth, requireRole('staff', 'doctor', 'admin'), (req, res) => {
    const user = req.user;
    db.all(
      "SELECT id, doc_type, file_path, original_name, note, uploaded_at FROM hr_documents WHERE user_id=? ORDER BY id DESC",
      [user.id],
      (err, rows) => {
        if (err) return serverError(res, err);
        res.json(rows || []);
      }
    );
  });

  // 上傳自己文件
  router.post("/my-documents", requireAuth, requireRole('staff', 'doctor', 'admin'), hrDocUpload.single('file'), (req, res) => {
    const user = req.user;
    if (!req.file) return res.status(400).json({ error: "請上傳文件" });
    const docType = req.body.doc_type || "other";
    const note = req.body.note || "";
    const filePath = `/uploads/hr_documents/${req.file.filename}`;
    db.run(
      "INSERT INTO hr_documents (user_id, doc_type, file_path, original_name, note) VALUES (?, ?, ?, ?, ?)",
      [user.id, docType, filePath, req.file.originalname || req.file.filename, note],
      function (insErr) {
        if (insErr) return serverError(res, insErr);
        res.json({ success: true, message: "文件已上傳", id: this.lastID, file_path: filePath });
      }
    );
  });

  // 刪除自己文件
  router.delete("/my-documents/:id", requireAuth, requireRole('staff', 'doctor', 'admin'), (req, res) => {
    const user = req.user;
    db.get("SELECT * FROM hr_documents WHERE id=? AND user_id=?", [req.params.id, user.id], (err, doc) => {
      if (err) return serverError(res, err);
      if (!doc) return res.status(404).json({ error: "文件不存在" });
      db.run("DELETE FROM hr_documents WHERE id=?", [doc.id], function (delErr) {
        if (delErr) return serverError(res, delErr);
        if (doc.file_path) {
          const rel = doc.file_path.replace(/^\/uploads\/hr_documents\//, "");
          if (rel && !rel.includes("..")) {
            fs.unlink(path.join(__dirname, "..", "uploads", "hr_documents", rel), () => {});
          }
        }
        res.json({ success: true, message: "文件已刪除" });
      });
    });
  });

  // ==================================================================
  // 管理員：名冊
  // ==================================================================

  // 查詢員工名冊（含 HR 詳細資料，id_number 遮罩）
  const maskId = (v) => {
    if (!v) return "";
    const s = String(v);
    if (s.length <= 4) return s[0] + "***";
    const first = s.slice(0, 1);
    const bracket = s.match(/\((\d+)\)$/);
    let mid = "***";
    if (bracket) mid = "***" + bracket[0];
    return first + mid;
  };

  router.get("/employees", requireAuth, requireRole('admin'), (req, res) => {
    db.all(
      `SELECT id, username, name, name_en, phone, email, role, employment_type, is_active, leave_balance,
              hire_date, hourly_rate, basic_salary, id_card, address, bank_account,
              emergency_contact, emergency_phone
       FROM users WHERE role IN ('staff','doctor','admin') ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'doctor' THEN 1 ELSE 2 END, id`,
      [],
      (err, rows) => {
        if (err) return serverError(res, err);
        (rows || []).forEach((r) => {
          let balance = {};
          try { balance = JSON.parse(r.leave_balance || "{}"); } catch (e) {}
          r.leave_balance_obj = balance;
          r.id_number_masked = maskId(r.id_card);
        });
        res.json(rows || []);
      }
    );
  });

  // 新增員工 / 醫生（自動建立登入帳戶 + 假額 + doctor 表）
  router.post("/employees", requireAuth, requireRole('admin'), (req, res) => {
    const { username, name, name_en, phone, email, role } = req.body;
    if (!username || !name || !phone) return res.status(400).json({ error: "請提供用戶名、姓名、電話" });
    const finalRole = role === 'doctor' ? 'doctor' : 'staff';
    // 全職 / 兼職：only staff 可以兼職；醫生一律全職
    const employmentType = (finalRole === 'doctor') ? 'full' : (req.body.employment_type === 'part' ? 'part' : 'full');
    db.get("SELECT id FROM users WHERE username=?", [username], (eU, exists) => {
      if (eU) return serverError(res, eU);
      if (exists) return res.status(400).json({ error: "用戶名已被使用" });
      const tempPassword = Math.random().toString(36).slice(-8);
      const hashed = hashPassword(tempPassword);
      const lb = req.body.leave_balance || {};
      const balanceJson = JSON.stringify({ ...DEFAULT_BALANCE, ...lb });
      const respondCreated = (userId) => {
        if (employmentType === 'part') {
          // 兼職：唔建立固定每週排班，用報更改表（由同事揀更 + 管理員審批）
          return res.json({
            success: true, message: "已新增兼職員工並建立登入帳戶（使用報更功能）",
            id: userId,
            credentials: { username, tempPassword },
          });
        }
        // 全職：建立預設每週更表（一至五 10:00-19:00、六 10:00-13:00）
        db.run(
          `INSERT INTO hr_user_schedules (user_id, work_start, work_end, is_active, is_weekly, hours)
           VALUES (?, '10:00', '19:00', 1, 1, ?)
           ON CONFLICT(user_id) DO NOTHING`,
          [userId, JSON.stringify(DEFAULT_WEEKLY_HOURS)],
          () => res.json({
            success: true, message: `已新增${finalRole === 'doctor' ? '醫生' : '全職員工'}並建立登入帳戶`,
            id: userId,
            credentials: { username, tempPassword },
          })
        );
      };
      if (finalRole === 'doctor') {
        // 建立 users 帳戶
        db.run(
          `INSERT INTO users (username, password, name, name_en, phone, email, role, employment_type, must_change_password, leave_balance)
           VALUES (?, ?, ?, ?, ?, ?, 'doctor', 'full', 1, ?)`,
          [username, hashed, name, name_en, phone, email || "", balanceJson],
          function (uErr) {
            if (uErr) return serverError(res, uErr);
            const newUserId = this.lastID;
            // 建立 doctors 記錄（實際 schema：name, specialty, is_active, user_id）
            db.run(
              `INSERT INTO doctors (name, specialty, is_active, user_id) VALUES (?, ?, 1, ?)`,
              [name, "", newUserId],
              function (dErr) {
                if (dErr) return serverError(res, dErr);
                respondCreated(newUserId);
              }
            );
          }
        );
      } else {
        db.run(
          `INSERT INTO users (username, password, name, name_en, phone, email, role, employment_type, must_change_password, leave_balance)
           VALUES (?, ?, ?, ?, ?, ?, 'staff', ?, 1, ?)`,
          [username, hashed, name, name_en, phone, email || "", employmentType, balanceJson],
          function (iErr) {
            if (iErr) return serverError(res, iErr);
            respondCreated(this.lastID);
          }
        );
      }
    });
  });

  // 更新員工（基本資料 / 角色 / 在職狀態 / 假額 / HR 詳細資料）
  router.put("/employees/:id", requireAuth, requireRole('admin'), (req, res) => {
    const { id } = req.params;
    const { name, name_en, phone, email, role, is_active, leave_balance, hire_date, hourly_rate, basic_salary, id_card, address, bank_account, emergency_contact, emergency_phone } = req.body;
    const employmentType = req.body.employment_type === 'part' ? 'part' : (req.body.employment_type === 'full' ? 'full' : null);
    db.get("SELECT * FROM users WHERE id=? AND role IN ('staff','doctor','admin')", [id], (err, emp) => {
      if (err) return serverError(res, err);
      if (!emp) return res.status(404).json({ error: "員工不存在" });
      let balance = parseBalance(emp);
      if (leave_balance && typeof leave_balance === 'object') {
        balance = { ...balance, ...leave_balance };
      }
      const newRole = role === 'doctor' ? 'doctor' : (role === 'staff' ? 'staff' : emp.role);
      const newEmpType = (newRole === 'doctor') ? 'full' : (employmentType || emp.employment_type || 'full');
      const afterUpdate = (uErr) => {
        if (uErr) return serverError(res, uErr);
        // 兼職：移除固定每週更表（用報更）；全職：確保有每週更表
        if (newEmpType === 'part') {
          db.run("DELETE FROM hr_user_schedules WHERE user_id=?", [id], () => res.json({ success: true, message: "員工資料已更新（兼職）" }));
        } else {
          db.run(
            `INSERT INTO hr_user_schedules (user_id, work_start, work_end, is_active, is_weekly, hours)
             VALUES (?, '10:00', '19:00', 1, 1, ?)
             ON CONFLICT(user_id) DO NOTHING`,
            [id, JSON.stringify(DEFAULT_WEEKLY_HOURS)],
            () => res.json({ success: true, message: "員工資料已更新（全職）" })
          );
        }
      };
      db.run(
        `UPDATE users SET
           name=COALESCE(?, name),
           name_en=COALESCE(?, name_en),
           phone=COALESCE(?, phone),
           email=COALESCE(?, email),
           role=COALESCE(?, role),
           is_active=COALESCE(?, is_active),
           employment_type=COALESCE(?, employment_type),
           leave_balance=?,
           hire_date=COALESCE(?, hire_date),
           hourly_rate=COALESCE(?, hourly_rate),
           basic_salary=COALESCE(?, basic_salary),
           id_card=COALESCE(?, id_card),
           address=COALESCE(?, address),
           bank_account=COALESCE(?, bank_account),
           emergency_contact=COALESCE(?, emergency_contact),
           emergency_phone=COALESCE(?, emergency_phone)
         WHERE id=?`,
        [name != null ? name : null, name_en != null ? name_en : null, phone != null ? phone : null, email != null ? email : null, newRole, is_active != null ? is_active : null, newEmpType, JSON.stringify(balance), hire_date != null ? hire_date : null, hourly_rate != null ? hourly_rate : null, basic_salary != null ? basic_salary : null, id_card != null ? id_card : null, address != null ? address : null, bank_account != null ? bank_account : null, emergency_contact != null ? emergency_contact : null, emergency_phone != null ? emergency_phone : null, id],
        afterUpdate
      );
    });
  });

  // 重設員工密碼
  router.put("/employees/:id/password", requireAuth, requireRole('admin'), (req, res) => {
    const { id } = req.params;
    const newPassword = req.body.password;
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: "密碼至少 6 位" });
    }
    const hashed = hashPassword(newPassword);
    db.run(
      "UPDATE users SET password=?, must_change_password=1 WHERE id=? AND role IN ('staff','doctor')",
      [hashed, id],
      function (updErr) {
        if (updErr) return serverError(res, updErr);
        if (this.changes === 0) return res.status(404).json({ error: "員工不存在" });
        res.json({ success: true, message: "員工密碼已重設" });
      }
    );
  });

  // ==================================================================
  // 管理員：考勤
  // ==================================================================

  // 即日考勤總覽（每位 staff/doctor 今日狀態）
  router.get("/today", requireAuth, requireRole('admin'), (req, res) => {
    const date = todayStr();
    db.all(
      `SELECT id, name, name_en, role, is_active FROM users WHERE role IN ('staff','doctor') ORDER BY role, id`,
      [],
      (err, employees) => {
        if (err) return serverError(res, err);
        if (!employees || employees.length === 0) return res.json({ date, employees: [] });
        db.all("SELECT * FROM attendance WHERE attendance_date=?", [date], (aErr, atts) => {
          if (aErr) return serverError(res, aErr);
          const attMap = {};
          (atts || []).forEach((a) => { attMap[a.user_id] = a; });
          db.all(
            "SELECT user_id, leave_type FROM leave_requests WHERE status='approved' AND start_date<=? AND end_date>=?",
            [date, date],
            (lErr, leaves) => {
              if (lErr) return serverError(res, lErr);
              const leaveMap = {};
              (leaves || []).forEach((l) => { leaveMap[l.user_id] = l.leave_type; });
              isClinicOffday(date, (cErr, clinicOff) => {
                db.all(
                  "SELECT user_id, is_off, work_start, work_end FROM hr_schedule_exceptions WHERE exc_date=?",
                  [date],
                  (xErr, excs) => {
                    if (xErr) return serverError(res, xErr);
                    const offMap = {};
                    const timeMap = {};
                    (excs || []).forEach((x) => {
                      if (x.is_off) offMap[x.user_id] = true;
                      timeMap[x.user_id] = { work_start: x.work_start, work_end: x.work_end };
                    });
                    const rows = (employees || []).map((emp) => {
                      const a = attMap[emp.id] || null;
                      const leaveType = leaveMap[emp.id] || null;
                      const isOff = clinicOff || !!offMap[emp.id];
                      let status = "absent";
                      if (leaveType) status = "on_leave";
                      else if (a && a.clock_in && a.clock_out) status = "completed";
                      else if (a && a.clock_in) status = "working";
                      else if (isOff) status = "off";
                      return {
                        ...emp,
                        attendance: a,
                        work_label: a && a.work_minutes ? fmtMin(a.work_minutes) : "",
                        status,
                        leave_type: leaveType,
                        leave_type_label: leaveType ? (leaveTypeLabel[leaveType] || leaveType) : null,
                        schedule: timeMap[emp.id] || null,
                      };
                    });
                    res.json({ date, employees: rows, clinic_off: clinicOff });
                  }
                );
              });
            }
          );
        });
      }
    );
  });

  // 歷史考勤（可篩選日期範圍 + 員工，自動標記缺席）
  router.get("/history", requireAuth, requireRole('admin'), (req, res) => {
    const from = req.query.from || todayStr();
    const to = req.query.to || todayStr();
    const userId = req.query.userId ? Number(req.query.userId) : null;
    db.all(
      `SELECT id, name, role, is_active FROM users WHERE role IN ('staff','doctor')` + (userId ? " AND id=?" : ""),
      userId ? [userId] : [],
      (e2, employees) => {
        if (e2) return serverError(res, e2);
        db.all(
          "SELECT a.*, u.name AS u_name, u.role AS u_role FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.attendance_date>=? AND a.attendance_date<=?" + (userId ? " AND a.user_id=?" : "") + " ORDER BY a.attendance_date DESC, a.user_id",
          userId ? [from, to, userId] : [from, to],
          (aErr, atts) => {
            if (aErr) return serverError(res, aErr);
            (atts || []).forEach((r) => { r.attendance_type_label = attTypeLabel[r.attendance_type] || "全日"; });
            res.json({ from, to, records: atts || [] });
          }
        );
      }
    );
  });

  // 統計報表（每月 / 每員工：出勤日、遲到、早退、工時、缺席、請假、休息）
  router.get("/report", requireAuth, requireRole('admin'), (req, res) => {
    const from = req.query.from || "";
    const to = req.query.to || "";
    if (!from || !to) return res.status(400).json({ error: "請提供日期範圍 from / to" });
    db.all(
      `SELECT id, name, name_en, role, is_active FROM users WHERE role IN ('staff','doctor') ORDER BY role, id`,
      [],
      (e2, employees) => {
        if (e2) return serverError(res, e2);
        db.all(
          "SELECT a.* FROM attendance a WHERE a.attendance_date>=? AND a.attendance_date<=?",
          [from, to],
          (aErr, atts) => {
            if (aErr) return serverError(res, aErr);
            db.all(
              "SELECT * FROM leave_requests WHERE status='approved' AND start_date<=? AND end_date>=?",
              [to, from],
              (lErr, leaves) => {
                if (lErr) return serverError(res, lErr);
                db.all(
                  "SELECT off_date FROM hr_clinic_offdays WHERE off_date>=? AND off_date<=?",
                  [from, to],
                  (cErr, offs) => {
                    if (cErr) return serverError(res, cErr);
                    const clinicOffSet = new Set((offs || []).map((o) => o.off_date));
                    db.all(
                      "SELECT user_id, exc_date, is_off FROM hr_schedule_exceptions WHERE exc_date>=? AND exc_date<=?",
                      [from, to],
                      (xErr, excs) => {
                        if (xErr) return serverError(res, xErr);
                        const userOffMap = {};
                        (excs || []).forEach((x) => {
                          if (x.is_off) {
                            if (!userOffMap[x.user_id]) userOffMap[x.user_id] = new Set();
                            userOffMap[x.user_id].add(x.exc_date);
                          }
                        });
                        const days = dateRange(from, to);
                        const holidaySet = new Set(getHolidaysInRange(from, to).map((h) => h.date));
                        const baseWorkdays = days.filter((d) => !isWeekend(d) && !clinicOffSet.has(d) && !holidaySet.has(d));
                        const report = (employees || []).map((emp) => {
                          const empAtts = (atts || []).filter((a) => a.user_id === emp.id);
                          const empLeaves = (leaves || []).filter((l) => l.user_id === emp.id);
                          const empDates = {};
                          empAtts.forEach((a) => { empDates[a.attendance_date] = a; });
                          const leaveDates = {};
                          empLeaves.forEach((l) => {
                            dateRange(l.start_date, l.end_date).forEach((d) => { leaveDates[d] = l.leave_type; });
                          });
                          const myOff = userOffMap[emp.id] || new Set();
                          const workdayDates = baseWorkdays.filter((d) => !myOff.has(d));
                          let late = 0, early = 0, absent = 0, onLeave = 0, worked = 0, totalMin = 0;
                          workdayDates.forEach((d) => {
                            const a = empDates[d];
                            if (leaveDates[d]) { onLeave += 1; return; }
                            if (a && a.clock_in) {
                              worked += 1;
                              if (a.clock_out) totalMin += (a.work_minutes || 0);
                              if (a.is_late) late += 1;
                              if (a.is_early_leave) early += 1;
                            } else {
                              absent += 1;
                            }
                          });
                          const off = baseWorkdays.length - workdayDates.length;
                          return {
                            ...emp,
                            work_days: worked,
                            late, early, absent, on_leave: onLeave, off,
                            total_minutes: totalMin,
                            total_label: fmtMin(totalMin),
                            avg_label: worked ? fmtMin(Math.round(totalMin / worked)) : "",
                          };
                        });
                        res.json({ from, to, workdays: baseWorkdays.length, report });
                      }
                    );
                  }
                );
              }
            );
          }
        );
      }
    );
  });

  // 即日 / 某日出席異常（遲到/早退/缺席/請假/休息）
  router.get("/exceptions", requireAuth, requireRole('admin'), (req, res) => {
    const date = req.query.date || todayStr();
    db.all(
      `SELECT id, name, name_en, role, is_active FROM users WHERE role IN ('staff','doctor') ORDER BY role, id`,
      [],
      (e2, employees) => {
        if (e2) return serverError(res, e2);
        if (!employees || employees.length === 0) return res.json({ date, anomalies: [] });
        db.all("SELECT * FROM attendance WHERE attendance_date=?", [date], (aErr, atts) => {
          if (aErr) return serverError(res, aErr);
          const attMap = {};
          (atts || []).forEach((a) => { attMap[a.user_id] = a; });
          db.all(
            "SELECT user_id, leave_type FROM leave_requests WHERE status='approved' AND start_date<=? AND end_date>=?",
            [date, date],
            (lErr, leaves) => {
              if (lErr) return serverError(res, lErr);
              const leaveMap = {};
              (leaves || []).forEach((l) => { leaveMap[l.user_id] = l.leave_type; });
              isClinicOffday(date, (cErr, clinicOff) => {
                db.all(
                  "SELECT user_id, is_off FROM hr_schedule_exceptions WHERE exc_date=? AND is_off=1",
                  [date],
                  (xErr, excs) => {
                    if (xErr) return serverError(res, xErr);
                    const offSet = new Set((excs || []).map((x) => x.user_id));
                    const anomalies = [];
                    (employees || []).forEach((emp) => {
                      const a = attMap[emp.id] || null;
                      const leaveType = leaveMap[emp.id] || null;
                      const isOff = clinicOff || offSet.has(emp.id);
                      if (a && a.is_late) anomalies.push({ ...emp, type: "late", label: "遲到", attendance: a });
                      if (a && a.is_early_leave) anomalies.push({ ...emp, type: "early_leave", label: "早退", attendance: a });
                      if (leaveType) anomalies.push({ ...emp, type: "on_leave", label: "請假", attendance: a });
                      else if (!a && !isOff) anomalies.push({ ...emp, type: "absent", label: "缺席", attendance: null });
                    });
                    res.json({ date, anomalies });
                  }
                );
              });
            }
          );
        });
      }
    );
  });

  // 手動補打卡（新增/建立當日紀錄並重算）
  router.post("/attendance", requireAuth, requireRole('admin'), (req, res) => {
    const { user_id, attendance_date, clock_in, clock_out, note, attendance_type } = req.body;
    if (!user_id || !attendance_date) return res.status(400).json({ error: "請提供員工與日期" });
    db.get("SELECT id, name, role FROM users WHERE id=? AND role IN ('staff','doctor')", [user_id], (e, emp) => {
      if (e) return serverError(res, e);
      if (!emp) return res.status(404).json({ error: "員工不存在" });
      db.get(
        "SELECT * FROM attendance WHERE attendance_date=? AND user_id=?",
        [attendance_date, user_id],
        (oErr, existing) => {
          if (oErr) return serverError(res, oErr);
          if (existing && (existing.clock_in || existing.clock_out)) {
            return res.status(400).json({ error: "該日已有考勤紀錄，請用編輯功能", data: existing });
          }
          getWorkWindow(user_id, attendance_date).then((win) => {
            if (win.off) return res.status(400).json({ error: "該日為休息/休診日，無法補打卡" });
            const ci = clock_in || null;
            const co = clock_out || null;
            const typeFinal = ["full", "half", "fieldwork", "training"].includes(attendance_type) ? attendance_type : "full";
            const isHalfOrSpecial = typeFinal !== "full";
            let workMinutes = 0, isLate = 0, isEarly = 0;
            if (ci && co) {
              workMinutes = Math.max(0, toMin(co) - toMin(ci));
              if (!isHalfOrSpecial) {
                isLate = toMin(ci) > toMin(win.work_start) ? 1 : 0;
                isEarly = toMin(co) < toMin(win.work_end) ? 1 : 0;
              }
            }
            if (existing) {
              db.run(
                `UPDATE attendance SET clock_in=?, clock_out=?, work_minutes=?, is_late=?, is_early_leave=?, is_absent=0, attendance_type=?, note=?, source='manual', updated_at=CURRENT_TIMESTAMP WHERE id=?`,
                [ci, co, workMinutes, isLate, isEarly, typeFinal, note || existing.note || "", existing.id],
                function (uErr) {
                  if (uErr) return serverError(res, uErr);
                  res.json({ success: true, message: "補打卡已儲存", id: existing.id, work_label: fmtMin(workMinutes) });
                }
              );
            } else {
              db.run(
                `INSERT INTO attendance (user_id, name, role, attendance_date, clock_in, clock_out, work_minutes, is_late, is_early_leave, is_absent, attendance_type, note, source)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')`,
                [user_id, emp.name, emp.role, attendance_date, ci, co, workMinutes, isLate, isEarly, 0, typeFinal, note || ""],
                function (iErr) {
                  if (iErr) return serverError(res, iErr);
                  res.json({ success: true, message: "補打卡已儲存", id: this.lastID, work_label: fmtMin(workMinutes) });
                }
              );
            }
          });
        }
      );
    });
  });

  // 編輯考勤紀錄
  router.put("/attendance/:id", requireAuth, requireRole('admin'), (req, res) => {
    const { id } = req.params;
    const { clock_in, clock_out, note, attendance_type } = req.body;
    db.get("SELECT * FROM attendance WHERE id=?", [id], (aErr, existing) => {
      if (aErr) return serverError(res, aErr);
      if (!existing) return res.status(404).json({ error: "考勤紀錄不存在" });
      getWorkWindow(existing.user_id, existing.attendance_date).then((win) => {
        const ci = clock_in != null ? clock_in : existing.clock_in;
        const co = clock_out != null ? clock_out : existing.clock_out;
        const typeFinal = ["full", "half", "fieldwork", "training"].includes(attendance_type) ? attendance_type : (existing.attendance_type || "full");
        const isHalfOrSpecial = typeFinal !== "full";
        let workMinutes = 0, isLate = 0, isEarly = 0;
        if (ci && co) {
          workMinutes = Math.max(0, toMin(co) - toMin(ci));
          if (!isHalfOrSpecial) {
            isLate = toMin(ci) > toMin(win.work_start) ? 1 : 0;
            isEarly = toMin(co) < toMin(win.work_end) ? 1 : 0;
          }
        }
        db.run(
          `UPDATE attendance SET clock_in=?, clock_out=?, work_minutes=?, is_late=?, is_early_leave=?, attendance_type=?, note=COALESCE(?, note), updated_at=CURRENT_TIMESTAMP WHERE id=?`,
          [ci, co, workMinutes, isLate, isEarly, typeFinal, note != null ? note : null, id],
          function (uErr) {
            if (uErr) return serverError(res, uErr);
            res.json({ success: true, message: "考勤已更新", work_label: fmtMin(workMinutes) });
          }
        );
      });
    });
  });

  // 刪除考勤紀錄
  router.delete("/attendance/:id", requireAuth, requireRole('admin'), (req, res) => {
    db.run("DELETE FROM attendance WHERE id=?", [req.params.id], function (dErr) {
      if (dErr) return serverError(res, dErr);
      if (this.changes === 0) return res.status(404).json({ error: "考勤紀錄不存在" });
      res.json({ success: true, message: "考勤紀錄已刪除" });
    });
  });

  // ==================================================================
  // 管理員：請假
  // ==================================================================

  router.get("/leaves/all", requireAuth, requireRole('admin'), (req, res) => {
    const status = req.query.status;
    let q = `SELECT l.*, u.name AS user_name, u.role AS user_role
             FROM leave_requests l JOIN users u ON u.id=l.user_id`;
    const cond = [];
    const params = [];
    if (status && status !== 'all') { cond.push("l.status=?"); params.push(status); }
    if (cond.length) q += " WHERE " + cond.join(" AND ");
    q += " ORDER BY (l.status='pending') DESC, l.created_at DESC";
    db.all(q, params, (err, rows) => {
      if (err) return serverError(res, err);
      (rows || []).forEach((r) => {
        r.leave_type_label = leaveTypeLabel[r.leave_type] || r.leave_type;
        const s = new Date(r.start_date), e = new Date(r.end_date);
        r.days = Math.round((e - s) / 86400000) + 1;
      });
      res.json(rows || []);
    });
  });

  // 審批請假（approved/rejected）
  router.put("/leaves/:id/review", requireAuth, requireRole('admin'), (req, res) => {
    const { action, note } = req.body;
    const id = req.params.id;
    if (!["approved", "rejected"].includes(action)) {
      return res.status(400).json({ error: "無效操作" });
    }
    db.get("SELECT * FROM leave_requests WHERE id=?", [id], (err, leave) => {
      if (err) return serverError(res, err);
      if (!leave) return res.status(404).json({ error: "請假申請不存在" });
      if (leave.status !== "pending") return res.status(400).json({ error: "該申請已處理" });
      db.run(
        "UPDATE leave_requests SET status=?, reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP, reviewed_note=? WHERE id=?",
        [action, req.user.id, note || "", id],
        function (uErr) {
          if (uErr) return serverError(res, uErr);
          res.json({ success: true, message: action === "approved" ? "已批准請假" : "已拒絕請假" });
        }
      );
    });
  });

  // ==================================================================
  // 管理員：排班 / 營業日曆（階段一）
  // ==================================================================

  // 所有員工預設返工時間
  router.get("/schedules/all", requireAuth, requireRole('admin'), (req, res) => {
    db.all(
      `SELECT s.user_id, u.name, u.employment_type, s.work_start, s.work_end, s.is_active, s.is_weekly, s.hours,
              '10:00' AS dflt_ws, '19:00' AS dflt_we
       FROM hr_user_schedules s JOIN users u ON u.id=s.user_id
       UNION
       SELECT u.id, u.name, u.employment_type, '10:00' AS work_start, '19:00' AS work_end, 1 AS is_active,
              NULL AS is_weekly, NULL AS hours, '10:00' AS dflt_ws, '19:00' AS dflt_we
       FROM users u WHERE u.role IN ('staff','doctor') AND u.id NOT IN (SELECT user_id FROM hr_user_schedules)`,
      [],
      (err, rows) => {
        if (err) return serverError(res, err);
        (rows || []).forEach((r) => { r.hours_obj = parseHours(r.is_weekly == 1 ? r.hours : null); });
        res.json(rows || []);
      }
    );
  });

  // 設定某員工預設返工時間 / 每週更表
  router.put("/schedules/:userId", requireAuth, requireRole('admin'), (req, res) => {
    const userId = req.params.userId;
    const ws = req.body.work_start || "10:00";
    const we = req.body.work_end || "19:00";
    const active = req.body.is_active != null ? req.body.is_active : 1;
    // 每週模式：is_weekly=1 + hours（objects：{"1":"10:00-19:00",...}）
    const useWeekly = req.body.is_weekly != null ? (req.body.is_weekly ? 1 : 0) : null;
    const hoursJson = useWeekly === 1 ? JSON.stringify({ ...DEFAULT_WEEKLY_HOURS, ...(req.body.hours || {}) }) : null;
    db.get("SELECT id FROM users WHERE id=? AND role IN ('staff','doctor')", [userId], (e, u) => {
      if (e) return serverError(res, e);
      if (!u) return res.status(404).json({ error: "員工不存在" });
      const doUpdate = (isWeekly, hours) => db.run(
        `INSERT INTO hr_user_schedules (user_id, work_start, work_end, is_active, is_weekly, hours, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))
         ON CONFLICT(user_id) DO UPDATE SET work_start=excluded.work_start, work_end=excluded.work_end, is_active=excluded.is_active, is_weekly=excluded.is_weekly, hours=excluded.hours, updated_at=datetime('now','localtime')`,
        [userId, ws, we, active, isWeekly, hours],
        function (uErr) {
          if (uErr) return serverError(res, uErr);
          res.json({ success: true, message: "排班已更新" });
        }
      );
      if (useWeekly === 1) {
        doUpdate(1, hoursJson);
      } else if (useWeekly === 0) {
        doUpdate(0, null);
      } else {
        // 未指明模式：保留現有 is_weekly（若存在），否則以每週為預設
        db.get("SELECT is_weekly, hours FROM hr_user_schedules WHERE user_id=?", [userId], (selErr, existing) => {
          if (selErr) return serverError(res, selErr);
          const isW = existing && existing.is_weekly == 1 ? 1 : 1;
          doUpdate(isW, isW === 1 ? (existing && existing.hours ? existing.hours : JSON.stringify(DEFAULT_WEEKLY_HOURS)) : null);
        });
      }
    });
  });

  // 排班例外列表
  router.get("/schedule-exceptions", requireAuth, requireRole('admin'), (req, res) => {
    const from = req.query.from || "";
    const to = req.query.to || "";
    let q = `SELECT e.*, u.name FROM hr_schedule_exceptions e LEFT JOIN users u ON u.id=e.user_id`;
    const cond = [];
    const params = [];
    if (from && to) { cond.push("e.exc_date>=? AND e.exc_date<=?"); params.push(from, to); }
    if (cond.length) q += " WHERE " + cond.join(" AND ");
    q += " ORDER BY e.exc_date DESC";
    db.all(q, params, (err, rows) => {
      if (err) return serverError(res, err);
      res.json(rows || []);
    });
  });

  // 新增排班例外（逐日覆寫 / 休息）
  router.post("/schedule-exceptions", requireAuth, requireRole('admin'), (req, res) => {
    const { user_id, exc_date, work_start, work_end, is_off, note } = req.body;
    if (!exc_date) return res.status(400).json({ error: "請提供日期" });
    db.get("SELECT id, name FROM users WHERE id=? AND role IN ('staff','doctor')", [user_id], (e, u) => {
      if (e) return serverError(res, e);
      if (!u) return res.status(404).json({ error: "員工不存在" });
      db.run(
        `INSERT INTO hr_schedule_exceptions (user_id, exc_date, work_start, work_end, is_off, note)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, exc_date) DO UPDATE SET work_start=excluded.work_start, work_end=excluded.work_end, is_off=excluded.is_off, note=excluded.note`,
        [user_id, exc_date, work_start || null, work_end || null, is_off ? 1 : 0, note || ""],
        function (iErr) {
          if (iErr) return serverError(res, iErr);
          res.json({ success: true, message: "排班例外已儲存" });
        }
      );
    });
  });

  // 刪除排班例外
  router.delete("/schedule-exceptions/:id", requireAuth, requireRole('admin'), (req, res) => {
    db.run("DELETE FROM hr_schedule_exceptions WHERE id=?", [req.params.id], function (dErr) {
      if (dErr) return serverError(res, dErr);
      if (this.changes === 0) return res.status(404).json({ error: "記錄不存在" });
      res.json({ success: true, message: "排班例外已刪除" });
    });
  });

  // 診所休診日 / 公眾假期
  router.get("/clinic-offdays", requireAuth, requireRole('admin'), (req, res) => {
    db.all("SELECT * FROM hr_clinic_offdays ORDER BY off_date", [], (err, rows) => {
      if (err) return serverError(res, err);
      res.json(rows || []);
    });
  });

  router.post("/clinic-offdays", requireAuth, requireRole('admin'), (req, res) => {
    const { off_date, name, is_annual } = req.body;
    if (!off_date) return res.status(400).json({ error: "請提供日期" });
    db.run(
      "INSERT OR REPLACE INTO hr_clinic_offdays (off_date, name, is_annual) VALUES (?, ?, ?)",
      [off_date, name || "", is_annual ? 1 : 0],
      function (iErr) {
        if (iErr) return serverError(res, iErr);
        res.json({ success: true, message: "休診日已儲存" });
      }
    );
  });

  router.delete("/clinic-offdays/:id", requireAuth, requireRole('admin'), (req, res) => {
    db.run("DELETE FROM hr_clinic_offdays WHERE id=?", [req.params.id], function (dErr) {
      if (dErr) return serverError(res, dErr);
      if (this.changes === 0) return res.status(404).json({ error: "記錄不存在" });
      res.json({ success: true, message: "休診日已刪除" });
    });
  });

  // ==================================================================
  // 管理員：出糧 CSV（階段一）
  // ==================================================================

  // 計算月結：出勤日數、總工時、OT、薪金
  const calcPayroll = (from, to, cb) => {
    db.all(
      `SELECT id, name, name_en, hourly_rate, basic_salary FROM users WHERE role IN ('staff','doctor') AND is_active=1 ORDER BY role, id`,
      [],
      (e2, employees) => {
        if (e2) return cb(e2);
        const empIds = (employees || []).map((e) => e.id);
        const processAttendance = (schedMap) => {
          db.all(
            "SELECT a.* FROM attendance a WHERE a.attendance_date>=? AND a.attendance_date<=?",
            [from, to],
            (aErr, atts) => {
              if (aErr) return cb(aErr);
              const days = dateRange(from, to);
              const holidaySet = new Set(getHolidaysInRange(from, to).map((h) => h.date));
              const workdayDates = days.filter((d) => !isWeekend(d) && !holidaySet.has(d));
              const rows = (employees || []).map((emp) => {
                const expected = schedMap[emp.id] || 9 * 60; // 該員工標準每日分鐘（由 hr_user_schedules 推算）
                const expectedHours = expected / 60;
                const empAtts = (atts || []).filter((a) => a.user_id === emp.id);
                let workedDays = 0, totalMin = 0, otMin = 0, normalMin = 0;
                empAtts.forEach((a) => {
                  if (a.clock_in) workedDays += 1;
                  const wm = a.work_minutes || 0;
                  if (a.clock_out) {
                    totalMin += wm;
                    if (wm > expected) otMin += (wm - expected);
                    else normalMin += wm;
                  } else if (a.clock_in) {
                    // 🔧 漏 clock_out：當做做咗完整更表（計足 expected 分鐘，唔計 OT）
                    //    避免時薪員工當日 0 出糧、日薪員工 OT 漏計；OT 因無準確下班時間唔估計，偏保守。
                    totalMin += expected;
                    normalMin += expected;
                  }
                });
                const otHours = otMin / 60;
                let gross = 0;
                if (emp.hourly_rate && emp.hourly_rate > 0) {
                  gross = (totalMin / 60) * emp.hourly_rate + otHours * emp.hourly_rate * 0.5;
                } else if (emp.basic_salary && emp.basic_salary > 0) {
                  const baseDays = workdayDates.length;
                  const perDayRate = baseDays > 0 ? emp.basic_salary / baseDays : 0;
                  const perHourRate = expectedHours > 0 ? perDayRate / expectedHours : 0;
                  gross = baseDays > 0 ? perDayRate * workedDays + otHours * perHourRate * 1.5 : 0;
                }
                return {
                  ...emp,
                  worked_days: workedDays,
                  total_minutes: totalMin,
                  total_label: fmtMin(totalMin),
                  ot_hours: Math.round(otHours * 100) / 100,
                  normal_minutes: normalMin,
                  expected_daily_minutes: expected,
                  gross: Math.round(gross * 100) / 100,
                  has_rate: !!(emp.hourly_rate && emp.hourly_rate > 0) || !!(emp.basic_salary && emp.basic_salary > 0),
                };
              });
              cb(null, { rows, workdays: workdayDates.length });
            }
          );
        };
        if (!empIds.length) return processAttendance({});
        db.all(
          `SELECT user_id, work_start, work_end, is_weekly, hours FROM hr_user_schedules WHERE user_id IN (${empIds.map(() => '?').join(',')})`,
          empIds,
          (sErr, scheds) => {
            const schedMap = {};
            (scheds || []).forEach((s) => {
              let dailyMin = 9 * 60;
              if (s.work_start && s.work_end) {
                const [sh, sm] = s.work_start.split(':').map(Number);
                const [eh, em] = s.work_end.split(':').map(Number);
                const diff = (eh * 60 + em) - (sh * 60 + sm);
                if (diff > 0) dailyMin = diff;
              } else if (s.is_weekly && s.hours) {
                dailyMin = Math.round((s.hours / 6) * 60); // 一週約 6 個工作天
              }
              schedMap[s.user_id] = dailyMin;
            });
            processAttendance(schedMap);
          }
        );
      }
    );
  };

  // 🆕 預設上一個月（每月 7 號出上月糧，管理員多數查上月）
  function prevMonthRange() {
    const d = new Date();
    d.setDate(0); // 上個月最後一日
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const last = String(d.getDate()).padStart(2, '0');
    return [`${y}-${m}-01`, `${y}-${m}-${last}`];
  }

  router.get("/payroll", requireAuth, requireRole('admin'), (req, res) => {
    let from = req.query.from || "";
    let to = req.query.to || "";
    if (!from || !to) {
      const [df, dt] = prevMonthRange();
      from = from || df; to = to || dt;
    }
    calcPayroll(from, to, (err, data) => {
      if (err) return serverError(res, err);
      res.json({ from, to, workdays: data.workdays, report: data.rows });
    });
  });

  // 匯出 CSV（含 BOM 俾 Excel 開中文）
  router.get("/payroll/export", requireAuth, requireRole('admin'), (req, res) => {
    let from = req.query.from || "";
    let to = req.query.to || "";
    if (!from || !to) {
      const [df, dt] = prevMonthRange();
      from = from || df; to = to || dt;
    }
    calcPayroll(from, to, (err, data) => {
      if (err) return serverError(res, err);
      const head = ["姓名", "角色", "出勤日數", "總工時", "OT小時", "應發薪金(HKD)"];
      const lines = [head.join(",")];
      (data.rows || []).forEach((r) => {
        const role = r.role === 'doctor' ? '醫生' : '員工';
        lines.push([`"${r.name}"`, role, r.worked_days, r.total_label.replace(/小時/g, "h").replace(/分/g, "m"), r.ot_hours, r.gross.toFixed(2)].join(","));
      });
      const csv = "\uFEFF" + lines.join("\r\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="payroll_${from}_${to}.csv"`);
      res.send(csv);
    });
  });

  return router;
};
