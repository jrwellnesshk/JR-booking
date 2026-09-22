const { serverError } = require("../services/httpResp");
/**
 * 預約管理路由
 * 包括：建立預約、查詢預約、修改預約、取消預約、時段管理
 * 新增：電郵通知功能、WhatsApp 通知功能
 */

const express = require('express');
const router = express.Router();

// ℹ️ SMS 已全面取消，通知統一經 WhatsApp／電郵

// WhatsApp 服務 - 根據環境變數選擇
const whatsappProvider = process.env.WHATSAPP_PROVIDER || 'twilio';
let whatsappService;
if (whatsappProvider === 'android') {
  whatsappService = require('../services/whatsapp-android');
} else {
  whatsappService = require('../services/whatsapp');
}

module.exports = (db, emailService, getLocalTimeString, { requireAuth, requireRole, optionalAuth, verifyPassword } = {}) => {

  // 權限輔助：該預約屬於自己（客戶）或管理員/醫師/員工
  const isOwnerOrStaff = (req, booking) => {
    if (!req.user) return false;
    if (req.user.role === 'admin' || req.user.role === 'doctor' || req.user.role === 'staff') return true;
    return booking && Number(booking.user_id) === Number(req.user.id);
  };

  // 🔒 日誌遮罩：避免電話/電郵 PII 明文入 log
  const maskPhone = (p) => (p && p.length >= 4) ? p.slice(0, 3) + '****' + p.slice(-2) : (p ? '****' : null);
  const maskEmail = (e) => (e && /@/.test(e)) ? e.replace(/^(.)[^@]*@/, '$1***@') : e;

  // 🔓 會員付費門禁已移除（按設計：一本帳戶都可以用晒所有服務；
  //    會員級別只影響折扣 / 免費特定次數門診，呢部分遲啲補上，唔影響 access）。
  //    訪客（無帳戶）仍然只可約「初體驗」，見下方 guestMode 檢查。
  //    （原本 userHasActivePaidMembership 判定 helper 已一併移除；
  //      將來做折扣 / 免費次數時可喺 memberships.js 重用家庭「一張單一個付款人」模型重新引入。）

  // ==================== 重疊時段邏輯 ====================
  // 規則：每個預約可與前一個預約重疊最多 15 分鐘（後 15 分鐘），
  //       並與下一個預約重疊最多 15 分鐘（前 15 分鐘）。
  const timeToMinutes = (t) => {
    if (t == null) return null;
    const parts = String(t).split(':').map(Number);
    return parts[0] * 60 + (parts[1] || 0);
  };
  const minutesToTime = (m) => {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };

  // bookings: 同一日期同一醫師之現有預約（含 appointment_time 與 duration），依時間排序
  // startMin/durationMin: 新預約的開始時間與時長（分鐘）
  const checkOverlap = (bookings, startMin, durationMin) => {
    if (startMin < 0) return { ok: false, reason: '無效時段' };
    let prev = null;
    let next = null;
    for (const b of bookings || []) {
      const s = timeToMinutes(b.appointment_time);
      if (s == null) continue;
      const e = s + (Number(b.duration) || 0);
      if (s === startMin) return { ok: false, reason: '該時段已被預約' };
      if (s < startMin) {
        if (!prev || s > prev.s) prev = { s, e };
      } else if (!next || s < next.s) {
        next = { s, e };
      }
    }
    if (prev && (prev.e - startMin) > 15) {
      return { ok: false, reason: `與前一預約（${minutesToTime(prev.s)}）重疊超過 15 分鐘，請改選其他時段` };
    }
    if (next && next.s < startMin + durationMin && (startMin + durationMin - next.s) > 15) {
      return { ok: false, reason: `與下一預約（${minutesToTime(next.s)}）重疊超過 15 分鐘，請改選其他時段` };
    }
    return { ok: true };
  };

  // 床位置檢查（針對需要床位嘅服務）
  const checkBedAvailable = (bookings, startMin, durationMin, bedCapacity, bedType) => {
    if (bedType !== 'tuina' && bedType !== 'acup' && bedType !== 'mixed' && bedType !== 'vip') return { ok: true };
    const cap = bedCapacity || 5;
    let used = 0;
    for (const b of bookings || []) {
      if (!b.bed_type) continue;
      const s = timeToMinutes(b.appointment_time);
      if (s == null) continue;
      const e = s + (Number(b.duration) || 0);
      // 床位預約：同一時間區段內被佔用
      if ((s >= startMin && s < startMin + durationMin) ||
          (e > startMin && e <= startMin + durationMin) ||
          (s <= startMin && e >= startMin + durationMin)) {
        used += 1;
      }
    }
    return { ok: used < cap, used, cap };
  };

  // 由服務名稱推斷床位類型：手法床(tuina) / VIP房(vip) / 針灸床(acup, legacy) / 混合(mixed, legacy)
  const serviceBedType = (name) => {
    const n = name || '';
    if (n.includes('推拿') && n.includes('針灸')) return 'mixed';
    if (n.includes('VIP') || n.includes('貴賓') || n.includes('房')) return 'vip';
    if (n.includes('推拿') || n.includes('手法')) return 'tuina';
    if (n.includes('針灸')) return 'acup';
    return 'none';
  };

  // 床位類型 → clinic_settings 容量鍵
  const bedCapacityKey = (bt) => {
    if (bt === 'vip') return 'vip_rooms';
    if (bt === 'tuina') return 'tuina_beds';
    return 'acupuncture_beds'; // legacy
  };

  // 床位類型 → 中文顯示名
  const bedTypeLabel = (bt) => {
    if (bt === 'tuina') return '手法床';
    if (bt === 'vip') return 'VIP房';
    if (bt === 'acup') return '針灸床';
    if (bt === 'mixed') return '混合床';
    return '床位';
  };

  // 🕐 功能5（2026-09-14）：按日期取營業時段
  //    星期一至五：morning/afternoon 兩段；星期六：saturday_start ~ saturday_end（預設 10:00-13:00）
  //    回傳 { ranges: [[startMin, endMin], ...] } 供時段生成／營業時間檢查共用
  const getDayBusinessRanges = async (qGet, date) => {
    const dow = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T00:00:00').getDay() : NaN;
    if (dow === 6) {
      const satStart = timeToMinutes(await qGet('saturday_start')) ?? (10 * 60);
      const satEnd = timeToMinutes(await qGet('saturday_end')) ?? (13 * 60);
      return { isSaturday: true, ranges: [[satStart, satEnd]] };
    }
    const morningStart = timeToMinutes(await qGet('morning_start')) ?? (10 * 60);
    const morningEnd = timeToMinutes(await qGet('morning_end')) ?? (14 * 60);
    const aftStart = timeToMinutes(await qGet('afternoon_start')) ?? (14 * 60);
    const aftEnd = timeToMinutes(await qGet('afternoon_end')) ?? (19 * 60);
    return { isSaturday: false, ranges: [[morningStart, morningEnd], [aftStart, aftEnd]], morningStart, aftEnd };
  };

  // ==================== 診所開診日檢查（閉診日/公眾假期/紅字日/特別時段）====================
  // date: 'YYYY-MM-DD'，time: 'HH:MM'，doctorName: 可選，檢查該醫師當日請假。
  // 回傳 { ok:true } 或 { ok:false, error, code }
  const checkClinicOpen = async (date, time, doctorName) => {
    const holidays = require('../services/holidays');
    const qGet = (key) => new Promise((resolve) => {
      db.get("SELECT setting_value FROM clinic_settings WHERE setting_key=?", [key], (err, row) => resolve(row ? row.setting_value : null));
    });

    // 1. 公眾假期（如啟用）
    const holidaysEnabled = await qGet('holidays_enabled');
    if (holidaysEnabled !== 'false') {
      const workingHolidays = (await qGet('working_holidays') || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!workingHolidays.includes(date) && isHolidaySafe(holidays, date)) {
        return { ok: false, error: '公眾假期休息，暫停預約', code: 'holiday' };
      }
    }

    // 2. 紅字日 / 全日閉診 / 特別營業時段（exceptions 表，僅診所層級：doctor_user_id IS NULL）
    const exc = await new Promise((resolve) => {
      db.get("SELECT * FROM exceptions WHERE exception_date=? AND doctor_user_id IS NULL", [date], (err, row) => resolve(row || null));
    });
    if (exc) {
      if (exc.type === 'full_day_closed' || exc.type === 'red_day') {
        return { ok: false, error: `${exc.name || '紅字日'}暫停預約`, code: 'exception' };
      }
      if (exc.type === 'doctor_leave') {
        // 全診所休診（doctor_user_id IS NULL）→ 全日封鎖公開預約／落單
        return { ok: false, error: `${exc.name || '全診所休診'}暫停預約`, code: 'doctor_leave_clinic' };
      }
      if (exc.type === 'special_hours') {
        const open = timeToMinutes(exc.time_open);
        const close = timeToMinutes(exc.time_close);
        const t = timeToMinutes(time);
        if (open != null && close != null && (t < open || t >= close)) {
          return { ok: false, error: `當日特別營業時段為 ${exc.time_open}-${exc.time_close}`, code: 'special_hours' };
        }
      }
    }

    // 2b. 醫師請假（type='doctor_leave'）：指定醫師當日暫停預約
    if (doctorName) {
      const leave = await new Promise((resolve) => {
        db.get(
          `SELECT e.* FROM exceptions e LEFT JOIN users u ON u.id = e.doctor_user_id
           WHERE e.exception_date=? AND e.type='doctor_leave' AND u.name=?`,
          [date, doctorName],
          (err, row) => resolve(row || null)
        );
      });
      if (leave) {
        return { ok: false, error: `${doctorName} 醫師當日請假（${leave.reason || leave.name || '休假'}），請選擇其他醫師或日期`, code: 'doctor_leave' };
      }
    }

    // 3. 定期閉診日（closed_days，0=星期日）—— 未設定／空值時預設星期日休息（功能5：一至六營業）
    const closedDaysRaw = await qGet('closed_days');
    {
      const raw = closedDaysRaw == null ? '' : String(closedDaysRaw).trim();
      const list = raw === '' ? [0] : raw.split(',').map(s => parseInt(s, 10)).filter(n => !isNaN(n));
      const dow = new Date(date + 'T00:00:00').getDay();
      if (list.length && list.includes(dow)) {
        const customOpenDates = (await qGet('custom_open_dates') || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!customOpenDates.includes(date)) {
          return { ok: false, error: '診所當日休息（定期閉診日），暫停預約', code: 'closed' };
        }
      }
    }

    // 4. 自訂閉診日（custom_closed_dates）
    const customClosedDates = (await qGet('custom_closed_dates') || '').split(',').map(s => s.trim()).filter(Boolean);
    if (customClosedDates.includes(date)) {
      const customOpenDates = (await qGet('custom_open_dates') || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!customOpenDates.includes(date)) {
        return { ok: false, error: '診所當日休息，暫停預約', code: 'custom_closed' };
      }
    }

    // 4b. 開放預約月份（open_months，逗號分隔月份如 "9,10,11"）
    //     注意：空值／未設定 = 不限制（保持向後兼容，唔會影響現有預約）
    const openMonthsRaw = await qGet('open_months');
    if (openMonthsRaw != null && String(openMonthsRaw).trim() !== '') {
      // #26：同時兼容 'YYYY-MM'（admin 現行寫法）與月份數字（'9,10,11'，不分年份）。
      // 舊寫法對 'YYYY-MM' 做 parseInt 會得出年份（2026），令月份判斷必定失敗。
      const tokens = String(openMonthsRaw).split(',').map(s => s.trim()).filter(Boolean);
      const m = parseInt(String(date).slice(5, 7), 10);
      const ym = String(date).slice(0, 7);
      const monthOk = tokens.some((tok) => (
        /^\d{4}-\d{2}$/.test(tok) ? tok === ym : parseInt(tok, 10) === m
      ));
      if (tokens.length && !monthOk) {
        const customOpenDates = (await qGet('custom_open_dates') || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!customOpenDates.includes(date)) {
          return { ok: false, error: `${m} 月暫未開放預約，請選擇其他月份`, code: 'month_closed' };
        }
      }
    }

    // 5. 營業時間範圍（由 clinic_settings 讀取；星期六用 saturday_start/end = 10:00-13:00，功能5）
    const t = timeToMinutes(time);
    const { ranges, isSaturday } = await getDayBusinessRanges(qGet, date);
    const inRange = ranges.some(([s, e]) => t >= s && t < e);
    if (!inRange) {
      const fmt = (m) => minutesToTime(m);
      const label = isSaturday
        ? `${fmt(ranges[0][0])}-${fmt(ranges[0][1])}`
        : `${fmt(timeToMinutes(await qGet('morning_start')) ?? (10 * 60))}-${fmt(timeToMinutes(await qGet('afternoon_end')) ?? (19 * 60))}`;
      return { ok: false, error: `請於營業時間內預約（${label}）`, code: 'business_hours' };
    }

    // 6. 過去日期檢查
    const today = getLocalTimeString ? getLocalTimeString().slice(0, 10) : '';
    if (date < today) {
      return { ok: false, error: '無法預約過往日期', code: 'past_date' };
    }

    return { ok: true };
  };

  const isHolidaySafe = (holidaysSvc, date) => {
    try {
      if (typeof holidaysSvc.isHoliday === 'function') return holidaysSvc.isHoliday(date);
    } catch (e) { /* ignore */ }
    return false;
  };

  // ==================== 預約 CRUD ====================

  // 建立預約（可選登入：已登入用戶記錄 userId；訪客以 isGuest / 無 token 建立，只可預約「初體驗」）
  // 🔧 Walk-in：staff/admin 可帶 forUserId / for_user_id 為客戶代落單
  router.post("/", optionalAuth, async (req, res) => {
    const b0 = req.body || {};
    const actorRole = req.user && req.user.role;
    const forUserRaw = b0.forUserId || b0.for_user_id || b0.userId || b0.user_id;
    let userId = req.userId; // 訪客時為 undefined
    // 員工/管理員代客預約：改用目標客戶 id
    if ((actorRole === 'staff' || actorRole === 'admin') && forUserRaw) {
      const target = await new Promise((resolve) => {
        db.get("SELECT id, role, is_active FROM users WHERE id=?", [Number(forUserRaw)], (e, r) => resolve(r || null));
      });
      if (!target || target.role !== 'customer' || target.is_active === 0) {
        return res.status(400).json({ error: '找不到有效客戶帳戶（forUserId）' });
      }
      userId = target.id;
    }
    // 🆕 同時接受 camelCase（前端）+ snake_case（API 契約統一），第一個有值嘅 wins
    const b = b0;
    const customerName       = b.customerName       || b.customer_name;
    const customerNameEn     = b.customerNameEn     || b.customer_name_en;
    const customerPhone      = b.customerPhone      || b.customer_phone;
    const customerEmail      = b.customerEmail      || b.customer_email;
    const customerAge        = b.customerAge        || b.customer_age;
    const serviceId          = b.serviceId          || b.service_id;
    const doctorName         = b.doctorName         || b.doctor_name || b.doctor;
    const doctorId           = b.doctorId           || b.doctor_id;
    const appointmentDate    = b.appointmentDate    || b.appointment_date || b.date;
    const appointmentTime    = b.appointmentTime    || b.appointment_time || b.time;
    const notes              = b.notes;
    const sendEmailNotification = b.sendEmailNotification ?? b.send_email_notification ?? true;
    const bedNumber          = b.bedNumber          || b.bed_number;
    const reqBedType         = b.bedType            || b.bed_type;
    const isGuest            = b.isGuest ?? b.is_guest;
    // Walk-in（staff/admin 代客）唔算 guest mode
    const walkInStaff = (actorRole === 'staff' || actorRole === 'admin') && !!(forUserRaw);
    const guestMode = walkInStaff ? false : !userId;

    if (!customerName || !customerPhone || !serviceId || !appointmentDate || !appointmentTime) {
      const missing = ['customerName', 'customerPhone', 'serviceId', 'appointmentDate', 'appointmentTime']
        .filter(k => !b[k] && !b[k.replace(/[A-Z]/g, m => '_' + m.toLowerCase())]);
      return res.status(400).json({ error: "缺少必要欄位：" + missing.join('、'), missing });
    }

    try {
      // 🔒 訪客模式：跳過個人資料檢查（未註冊用戶無 profile_completed）
      if (!guestMode) {
        // 🆕 檢查用戶是否已完成個人資料
        const userCheck = await new Promise((resolve, reject) => {
          db.get("SELECT profile_completed, created_at FROM users WHERE id=?", [userId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
      
        if (userCheck && userCheck.profile_completed === 0) {
          // 檢查是否已過期
          const createdAt = new Date(userCheck.created_at);
          const now = new Date();
          const daysPassed = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
          
          if (daysPassed >= 3) {
            return res.status(403).json({ 
              error: "您的賬戶因未完成個人資料而已過期，請重新註冊。",
              expired: true
            });
          }
          
          const daysRemaining = 3 - daysPassed;
          return res.status(403).json({ 
            error: `請先完成個人資料更新才能使用預約功能。您還有 ${daysRemaining} 天時間完成資料。`,
            profile_incomplete: true,
            days_remaining: daysRemaining
          });
        }
      }
      // 🔓 預約月份開放控制已取消：全部月份均接受預約
      //（閉診日／假期／營業時間檢查保留，見下方 checkClinicOpen）

      // 🆕 診所開診日檢查（閉診日/公眾假期/紅字日/特別時段/營業時間/過往日期）
      const openCheck = await checkClinicOpen(appointmentDate, appointmentTime, doctorName || "張醫師");
      if (!openCheck.ok) {
        return res.status(400).json({ error: openCheck.error, code: openCheck.code });
      }

      const localTime = getLocalTimeString();

      // 獲取服務名稱與時長
      db.get("SELECT name, duration, requires_bed FROM services WHERE id=?", [serviceId], async (svcErr, svc) => {
        // 🔒 訪客模式：強制只能預約「初體驗」服務（防濫用）
        if (guestMode && (!svc || !svc.name || !svc.name.includes('初體驗'))) {
          return res.status(403).json({ error: "訪客模式僅可預約「初體驗（一小時）」服務，如需其他服務請先註冊帳戶。" });
        }
        // 🔒 功能3（2026-09-14）：「初體驗」僅限訪客 —— 登入客戶（任何會員級別）不可自約初體驗；
        //    員工／管理員代落單（walk-in）不受此限
        if (!guestMode && req.user && req.user.role === 'customer' && svc && svc.name && svc.name.includes('初體驗')) {
          return res.status(403).json({ error: "「初體驗」僅限訪客預約，會員請選擇其他治療服務。", code: 'trial_guest_only' });
        }
        // 🔓 會員付費門禁已移除（按設計：一本帳戶都可以用晒所有服務；
        //    會員級別只影響折扣 / 免費特定次數門診，遲啲補上，唔影響 access）。
        //    訪客（無帳戶）仍然只可約「初體驗」，見上方 guestMode 檢查。
        const serviceName = svc ? svc.name : `服務 #${serviceId}`;
        const durationMin = svc && svc.duration ? Number(svc.duration) : 30;
        const needsBed = svc ? (svc.requires_bed === 1) : false;
        
        // 🆕 嘗試獲取醫師的 user_id
        let doctorUserId = null;
        try {
          const doctorRow = await new Promise((resolve) => {
            db.get("SELECT user_id FROM doctors WHERE name=? AND is_active=1", [doctorName || "張醫師"], (err, row) => {
              resolve(row);
            });
          });
          if (doctorRow) doctorUserId = doctorRow.user_id;
        } catch (e) {
          console.error("獲取醫師 user_id 失敗:", e);
        }

        // 🆕 重疊時段衝突檢查（與前一/後一預約最多重疊 15 分鐘）
        const activeStatuses = "('pending','confirmed','in-progress','in-treatment','visited','dispensing')";
        const existingBookings = await new Promise((resolve, reject) => {
          db.all(
            `SELECT b.appointment_time, s.duration, b.bed_type FROM bookings b
             LEFT JOIN services s ON s.id = b.service_id
             WHERE b.appointment_date=? AND b.doctor_name=? AND b.status IN ${activeStatuses}`,
            [appointmentDate, doctorName || "張醫師"],
            (err, rows) => err ? reject(err) : resolve(rows || [])
          );
        }).catch((e) => { console.error("查詢現有預約失敗:", e); return []; });

        const startMin = timeToMinutes(appointmentTime);
        const conflict = checkOverlap(existingBookings, startMin, durationMin);
        if (!conflict.ok) {
          return res.status(409).json({ error: conflict.reason, code: 'overlap' });
        }

        // 🆕 床位資源檢查（需床位嘅服務）—— 床位係全院共享資源，需跨醫師統計
        const bedType = needsBed
          ? (['tuina', 'vip', 'acup', 'mixed'].includes(reqBedType) ? reqBedType : serviceBedType(serviceName))
          : null;
        let assignedBedNumber = null;
          if (needsBed) {
            const bedKey = bedCapacityKey(bedType);
          const bedCapRow = await new Promise((resolve, reject) => {
            db.get("SELECT setting_value FROM clinic_settings WHERE setting_key=?", [bedKey], (err, row) => err ? reject(err) : resolve(row));
          });
          const bedCap = bedCapRow ? parseInt(bedCapRow.setting_value, 10) : 5;
          const allBedBookings = await new Promise((resolve, reject) => {
            db.all(
              `SELECT b.appointment_time, s.duration, b.bed_type, b.bed_number FROM bookings b
               LEFT JOIN services s ON s.id = b.service_id
               WHERE b.appointment_date=? AND b.status IN ${activeStatuses} AND b.bed_type IS NOT NULL`,
              [appointmentDate],
              (err, rows) => err ? reject(err) : resolve(rows || [])
            );
          });
          const bedCheck = checkBedAvailable(allBedBookings, startMin, durationMin, bedCap, bedType);
          if (!bedCheck.ok) {
            return res.status(409).json({ error: `床位資源已滿（剩餘 ${bedCheck.cap - bedCheck.used} 張），請改選其他時段`, code: 'bed' });
          }
          // 🛏️ 具體床號：客人揀咗就驗嗰張床；冇揀就自動編最低張空床
          const occupied = new Set();
          for (const b of allBedBookings) {
            const s = timeToMinutes(b.appointment_time);
            if (s == null) continue;
            const e2 = s + (Number(b.duration) || 0);
            const overlaps = (s >= startMin && s < startMin + durationMin) ||
              (e2 > startMin && e2 <= startMin + durationMin) ||
              (s <= startMin && e2 >= startMin + durationMin);
            if (!overlaps) continue;
            const samePool = b.bed_type === bedType || b.bed_type === 'mixed' || bedType === 'mixed';
            if (samePool && b.bed_number) occupied.add(b.bed_number);
          }
          if (bedNumber != null) {
            const n = parseInt(bedNumber, 10);
            if (!Number.isInteger(n) || n < 1 || n > bedCap) {
              return res.status(400).json({ error: `床號無效（只可 1-${bedCap}）`, code: 'bed' });
            }
            if (occupied.has(n)) {
              return res.status(409).json({ error: `${bedTypeLabel(bedType)} #${n} 該時段已被預約，請揀其他床位`, code: 'bed_taken' });
            }
            assignedBedNumber = n;
          } else {
            for (let n = 1; n <= bedCap; n++) { if (!occupied.has(n)) { assignedBedNumber = n; break; } }
          }
        }

        const endTime = minutesToTime(startMin + durationMin);

        // 🎟️ 免費診症扣減：客戶有剩餘免費次數就標 is_free 並扣 1（優惠券購買嘅免費診症）
        // 🔒 用交易包住扣減 + 寫入，INSERT 失敗會回滾，避免白扣次數
        let isFreeBooking = 0;
        let freeCouponId = null;
        if (!guestMode && userId) {
          const uc = await new Promise((resolve) => {
            db.get(`SELECT id, free_total, free_used FROM user_coupons
                    WHERE user_id=? AND status='active' AND (free_total - free_used) > 0
                    ORDER BY id ASC LIMIT 1`, [userId], (e, r) => resolve(r || null));
          });
          if (uc) {
            isFreeBooking = 1;
            freeCouponId = uc.id;
            await new Promise((resolve) => db.run('BEGIN IMMEDIATE', () => resolve()));
            await new Promise((resolve) => db.run('UPDATE user_coupons SET free_used = free_used + 1 WHERE id=?', [uc.id], () => resolve()));
          }
        }

        const rollbackFree = () => {
          if (freeCouponId != null) {
            db.run('UPDATE user_coupons SET free_used = free_used - 1 WHERE id=? AND free_used > 0', [freeCouponId]);
            db.run('COMMIT');
          }
        };

        const stmt = db.prepare(
          "INSERT INTO bookings (user_id, customer_name, customer_name_en, customer_phone, customer_email, customer_age, service_id, doctor_name, appointment_date, appointment_time, end_time, notes, doctor_user_id, bed_type, bed_number, is_free, created_at, is_locked) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
        );

        stmt.run(
          userId || null,
          customerName,
          customerNameEn || "",
          customerPhone,
          customerEmail || "",
          customerAge || null,
          serviceId,
          doctorName || "張醫師",
          appointmentDate,
          appointmentTime,
          endTime,
          notes || "",
          doctorUserId,
          bedType || null,
          assignedBedNumber,
          isFreeBooking,
          localTime,
          1, // is_locked 預設為 1 (true)
          async function (err) {
            if (err) {
              rollbackFree();
              return serverError(res, err);
            }
            if (freeCouponId != null) {
              await new Promise((resolve) => db.run('COMMIT', () => resolve()));
            }
            
            const bookingId = this.lastID;
            console.log(`✅ 預約已建立 - ID: ${bookingId}, created_at: ${localTime}`);
            
            // 🆕 處理通知（新邏輯：WhatsApp 優先 → 電郵同時）
            console.log(`🚀 開始處理通知...`);
            console.log(`📞 原始電話號碼: ${maskPhone(customerPhone)}`);
            try {
              // 獲取通知設定
              
              const whatsappEnabled = await new Promise((resolve, reject) => {
                db.get("SELECT setting_value FROM clinic_settings WHERE setting_key = 'whatsapp_notification_enabled'", (err, row) => {
                  if (err) reject(err);
                  else resolve(row ? row.setting_value === 'true' : false);
                });
              });

              const emailEnabled = await new Promise((resolve, reject) => {
                db.get("SELECT setting_value FROM clinic_settings WHERE setting_key = 'email_notification_enabled'", (err, row) => {
                  if (err) reject(err);
                  else resolve(row ? row.setting_value === 'true' : true); // 預設開啟，管理員可於後台設定
                });
              });

              console.log(`📊 通知設定狀態: WhatsApp=${whatsappEnabled}, Email=${emailEnabled}`);
              console.log(`📞 客戶電話: ${maskPhone(customerPhone)}, 電郵: ${maskEmail(customerEmail)}`);

              // 🔒 用戶 WhatsApp 偏好閘門：已登入用戶如關閉「預約確認」偏好，則跳過訊息通知
              let whatsappPrefOk = true;
              if (userId) {
                const pref = await new Promise((resolve) => {
                  db.get("SELECT whatsapp_confirm FROM users WHERE id=?", [userId], (e, r) => resolve(r || {}));
                });
                if (pref && Number(pref.whatsapp_confirm) === 0) {
                  whatsappPrefOk = false;
                  console.log(`🔕 用戶 ${userId} 已關閉預約確認 WhatsApp 偏好，跳過訊息通知`);
                }
              }
              const waAllowed = whatsappEnabled && whatsappPrefOk;

              // 格式化電話號碼（如果冇國際區號，自動加 +852）
              let formattedPhone = customerPhone;
              if (customerPhone && !customerPhone.startsWith('+')) {
                formattedPhone = '+852' + customerPhone.replace(/^852/, '');
                console.log(`📞 電話號碼已格式化: ${customerPhone} -> ${formattedPhone}`);
              }

              const bookingInfo = {
                date: appointmentDate,
                time: appointmentTime,
                doctorName: doctorName || "張醫師",
                serviceName: serviceName,
                price: null
              };

              // 🆕 通知發送邏輯：WhatsApp 優先
              let messageSent = false;
              
              // 1️⃣ 優先嘗試 WhatsApp（需診所開啟 + 用戶偏好允許）
              if (waAllowed && formattedPhone && whatsappService.isConfigured()) {
                console.log(`💬 優先嘗試發送 WhatsApp 到 ${formattedPhone}...`);
                try {
                  const waResult = await whatsappService.sendBookingConfirmationWhatsApp(formattedPhone, bookingInfo);
                  if (waResult.success) {
                    console.log(`✅ WhatsApp 預約確認已發送到 ${formattedPhone}`);
                    messageSent = true;
                  } else {
                    console.log(`❌ WhatsApp 發送失敗:`, waResult.error);
                  }
                } catch (waErr) {
                  console.error('❌ 發送 WhatsApp 通知失敗:', waErr.message);
                }
              }
              
              if (!messageSent) {
                console.log(`⚠️ WhatsApp 通知未能發送`);
              }

              // 3️⃣ 電郵同時發送（如開啟且有電郵）
              if (emailEnabled && customerEmail && emailService) {
                console.log(`📧 同時發送電郵通知到 ${customerEmail}...`);
                try {
                  await emailService.sendBookingConfirmation(customerEmail, {
                    customerName: customerName,
                    bookingId: bookingId,
                    serviceName: serviceName,
                    doctorName: doctorName || "張醫師",
                    date: appointmentDate,
                    time: appointmentTime,
                    notes: notes
                  });
                  console.log(`✅ 電郵預約確認已發送到 ${customerEmail}`);
                } catch (emailErr) {
                  console.error('❌ 發送電郵通知失敗:', emailErr.message);
                }
              } else if (!emailEnabled) {
                console.log(`⏭️ 電郵通知已關閉`);
              } else if (!customerEmail) {
                console.log(`⏭️ 客戶未提供電郵`);
              }
              
            } catch (notifyErr) {
              console.error('獲取通知設定或發送通知失敗:', notifyErr);
              // 通知失敗不影響預約成功
            }

            res.json({ 
              success: true, 
              booking: {
                id: bookingId,
                user_id: userId,
                customer_name: customerName,
                customer_phone: customerPhone,
                customer_email: customerEmail,
                service_id: serviceId,
                service_name: serviceName,
                doctor_name: doctorName || "張醫師",
                appointment_date: appointmentDate,
                appointment_time: appointmentTime,
                notes: notes,
                status: 'confirmed',
                created_at: localTime
              }
            });
          }
        );
      });
    } catch (error) {
      console.error('預約處理錯誤:', error);
      return res.status(500).json({ error: '預約處理失敗，請稍後再試' });
    }
  });

  // 查詢預約（客戶只能查自己的；管理員/醫師/員工可查全部）
  router.get("/", requireAuth, (req, res) => {
    const { username } = req.query;
    const isStaff = ['admin', 'doctor', 'staff'].includes(req.user.role);
    const userId = isStaff ? (req.query.userId || null) : req.userId;
    const queryUsername = isStaff ? (username || null) : (req.user.username || null);
    
    // #1：星星只畀「参加完初體驗 + 開咗帳戶 + 第一次預約其他（非初體驗）服務」嗰筆完成／到訪預約。
    //      初體驗本身永遠唔會有星；之後第二、三筆普通服務都唔會有星。
    const IS_NEW_SQL =
      "CASE WHEN b.user_id IS NULL THEN 0 " +
      "WHEN IFNULL(s.name,'') LIKE '%初體驗%' THEN 0 " +
      "WHEN b.status NOT IN ('completed','visited') THEN 0 " +
      "ELSE NOT EXISTS (SELECT 1 FROM bookings x LEFT JOIN services sx ON sx.id = x.service_id " +
      "  WHERE x.user_id = b.user_id AND x.status IN ('completed','visited') " +
      "    AND IFNULL(sx.name,'') NOT LIKE '%初體驗%' " +
      "    AND (x.appointment_date < b.appointment_date OR (x.appointment_date = b.appointment_date AND x.id < b.id)) " +
      ") END AS is_new";
    let query = "SELECT b.*, u.member_no as member_no, " + IS_NEW_SQL + " FROM bookings b LEFT JOIN users u ON b.user_id = u.id LEFT JOIN services s ON s.id = b.service_id";
    let params = [];

    // 支持同時用 userId (數據庫ID) 和 username 查詢，以兼容新舊數據
    if (userId || queryUsername) {
      if (userId && queryUsername) {
        query += " WHERE (b.user_id = ? OR b.user_id = ?)";
        params.push(userId, queryUsername);
      } else if (userId) {
        query += " WHERE b.user_id = ?";
        params.push(userId);
      } else if (queryUsername) {
        query += " WHERE b.user_id = ?";
        params.push(queryUsername);
      }
    }
    
    // #10 面診優先排序：活躍（未結束）預約排最前、按最近日期升序；
    //     已結束（completed/no-show/cancelled）排後、按日期降序。
    query += " ORDER BY CASE WHEN b.status IN ('completed','no-show','cancelled') THEN 1 ELSE 0 END, b.appointment_date ASC, b.appointment_time ASC";
    
    db.all(query, params, (err, rows) => {
      if (err) return serverError(res, err);
      
      const currentTime = getLocalTimeString();
      const serverDate = currentTime.slice(0, 10);
      console.log(`📋 查詢預約 - 當前伺服器時間: ${currentTime}, userId: ${userId}, username: ${queryUsername}, 找到 ${rows.length} 筆`);
      
      res.json({
        data: rows,
        serverDate: serverDate,
        serverTime: currentTime
      });
    });
  });

  // ==================== #8 當日當值醫師 ====================
  // ⚠️ 必須註冊喺 /:id 路由之前，避免被 :id 通配符捕獲
  // 回傳當日有當值嘅醫師清單（只含當值者），每個含 id/name/user_id/work_start/work_end。
  const defaultWeeklyWindow = (dow) => {
    // dow: getDay() 0=日 1=一 ... 6=六；預設 一二三四五 10-19、六 10-13、日休
    if (dow >= 1 && dow <= 5) return { start: '10:00', end: '19:00' };
    if (dow === 6) return { start: '10:00', end: '13:00' };
    return null; // 日休
  };

  const evaluateDoctorOnDuty = (doc, dow, date, cb) => {
    const userId = doc.user_id;
    // 1) 例外：hr_schedule_exceptions(user_id, exc_date=date)
    db.get(
      "SELECT is_off, work_start, work_end FROM hr_schedule_exceptions WHERE user_id = ? AND exc_date = ?",
      [userId, date],
      (eErr, exc) => {
        if (eErr) { console.error('查 hr_schedule_exceptions 失敗:', eErr.message); return cb(null); }
        if (exc) {
          if (exc.is_off === 1) return cb(null); // 休
          if (exc.work_start && exc.work_end) {
            return cb({ id: doc.doctor_id, name: doc.name, user_id: userId, work_start: exc.work_start, work_end: exc.work_end });
          }
          // 有例外但無時段 → 跌落下面一般邏輯
        }
        // 2) 兼職：employment_type='part' → 查已批報更細項
        if (doc.employment_type === 'part') {
          db.get(
            `SELECT si.time_start, si.time_end
             FROM hr_shift_items si
             JOIN hr_shift_rosters sr ON sr.id = si.roster_id
             WHERE si.user_id = ? AND si.shift_date = ? AND sr.status = 'approved'
             LIMIT 1`,
            [userId, date],
            (sErr, shift) => {
              if (sErr) { console.error('查 hr_shift_items 失敗:', sErr.message); return cb(null); }
              if (shift && shift.time_start && shift.time_end) {
                return cb({ id: doc.doctor_id, name: doc.name, user_id: userId, work_start: shift.time_start, work_end: shift.time_end });
              }
              return cb(null); // 冇批更 → 休
            }
          );
          return;
        }
        // 3) 全職：hr_user_schedules（冇記錄→預設每週時段）
        db.get(
          "SELECT work_start, work_end, is_weekly, hours FROM hr_user_schedules WHERE user_id = ?",
          [userId],
          (sErr, sch) => {
            if (sErr) { console.error('查 hr_user_schedules 失敗:', sErr.message); return cb(null); }
            if (!sch) {
              const def = defaultWeeklyWindow(dow);
              return cb(def ? { id: doc.doctor_id, name: doc.name, user_id: userId, work_start: def.start, work_end: def.end } : null);
            }
            if (sch.is_weekly === 1 && sch.hours) {
              let hoursObj = {};
              try { hoursObj = JSON.parse(sch.hours); } catch (_) { hoursObj = {}; }
              const win = hoursObj[String(dow)];
              if (win && win.indexOf('-') > -1) {
                const [s, e] = win.split('-');
                return cb({ id: doc.doctor_id, name: doc.name, user_id: userId, work_start: s, work_end: e });
              }
              return cb(null); // 該 dow 無時段 → 休
            }
            // 單一 work_start/work_end
            if (sch.work_start && sch.work_end) {
              return cb({ id: doc.doctor_id, name: doc.name, user_id: userId, work_start: sch.work_start, work_end: sch.work_end });
            }
            return cb(null);
          }
        );
      }
    );
  };

  router.get("/doctors-on-duty", requireAuth, (req, res) => {
    const date = (req.query.date || getLocalTimeString().slice(0, 10)).slice(0, 10);
    const d = new Date(date + 'T00:00:00');
    const dow = d.getDay();

    // 診所休診日（全日休，無醫師當值）
    db.get("SELECT 1 FROM hr_clinic_offdays WHERE off_date = ?", [date], (offErr, offRow) => {
      if (offErr) return serverError(res, offErr);
      if (offRow) return res.json({ date, doctors: [] });

      // 拉啟用醫師（同步 doctors 表 is_active=1）
      const q = `SELECT u.id AS user_id, u.name, u.employment_type, d.id AS doctor_id
                 FROM users u
                 LEFT JOIN doctors d ON d.user_id = u.id
                 WHERE u.role = 'doctor' AND u.is_active = 1 AND (d.is_active IS NULL OR d.is_active = 1)`;
      db.all(q, [], (docErr, doctors) => {
        if (docErr) return serverError(res, docErr);
        if (!doctors || doctors.length === 0) return res.json({ date, doctors: [] });

        const result = [];
        let pending = doctors.length;
        doctors.forEach((doc) => {
          evaluateDoctorOnDuty(doc, dow, date, (info) => {
            if (info) result.push(info);
            pending--;
            if (pending === 0) {
              // 同一日多醫師按 user_id 排序，結果穩定
              result.sort((a, b) => a.user_id - b.user_id);
              res.json({ date, doctors: result });
            }
          });
        });
      });
    });
  });

  // ==================== 清除預約記錄 ====================
  // 注意：此路由必須放在 /:id 路由之前，否則會被通配符捕獲
  
  // 批量刪除預約記錄（僅限管理員，需二次驗證）
  router.delete("/clear", requireAuth, requireRole('admin'), async (req, res) => {
    // 無 body 的 DELETE（curl -X DELETE 不帶 payload）時 req.body 為 undefined，需防禦
    const { bookingIds, adminPassword } = req.body || {};
    
    if (!bookingIds || !Array.isArray(bookingIds) || bookingIds.length === 0) {
      return res.status(400).json({ error: "請提供要刪除的預約ID列表" });
    }
    
    try {
      // 二次驗證：管理員需提供密碼（adminPassword 已於上方連同 req.body 防禦一併解構）
      if (!adminPassword) {
        return res.status(400).json({
          error: "此操作需要輸入管理員密碼進行驗證",
          requiresVerification: true
        });
      }

      const adminCheck = await new Promise((resolve, reject) => {
        db.get("SELECT password, role FROM users WHERE id = ? AND role = 'admin'", [req.user.id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      
      if (!adminCheck) {
        return res.status(403).json({ error: "無權限執行此操作" });
      }
      
      if (!verifyPassword(adminPassword, adminCheck.password)) {
        return res.status(401).json({ error: "管理員密碼不正確" });
      }
      
      // 只刪除已完成、未履行、已取消的預約
      const placeholders = bookingIds.map(() => '?').join(',');
      
      // 先檢查要刪除的預約狀態
      const bookingsToDelete = await new Promise((resolve, reject) => {
        db.all(
          `SELECT id, status, customer_name, appointment_date FROM bookings 
           WHERE id IN (${placeholders}) AND status IN ('completed', 'no-show', 'cancelled')`,
          bookingIds,
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      });
      
      if (bookingsToDelete.length === 0) {
        return res.status(400).json({ error: "沒有找到可刪除的預約記錄" });
      }
      
      // 執行刪除
      const deleteResult = await new Promise((resolve, reject) => {
        const idsToDelete = bookingsToDelete.map(b => b.id);
        const deletePlaceholders = idsToDelete.map(() => '?').join(',');
        
        db.run(
          `DELETE FROM bookings WHERE id IN (${deletePlaceholders})`,
          idsToDelete,
          function(err) {
            if (err) reject(err);
            else resolve({ deletedCount: this.changes });
          }
        );
      });
      
      console.log(`🗑️ 管理員 ${req.user.id} 刪除了 ${deleteResult.deletedCount} 筆預約記錄`);
      
      res.json({ 
        success: true, 
        deletedCount: deleteResult.deletedCount,
        message: `成功刪除 ${deleteResult.deletedCount} 筆預約記錄` 
      });
      
    } catch (error) {
      console.error("刪除預約記錄失敗:", error);
      serverError(res, error);
    }
  });

  // 獲取單一預約（需登入，只限本人或管理員/醫師/員工）
  router.get("/:id", requireAuth, (req, res, next) => {
    if (req.params.id === 'doctor-time-slots') return next();
    const { id } = req.params;
    
    db.get("SELECT * FROM bookings WHERE id=?", [id], (err, row) => {
      if (err) return serverError(res, err);
      if (!row) return res.status(404).json({ error: "預約不存在" });
      if (!isOwnerOrStaff(req, row)) {
        return res.status(403).json({ error: "無權限查看此預約" });
      }
      res.json(row);
    });
  });

  // 修改預約（需登入，只限本人或管理員/醫師/員工）
  router.put("/:id", requireAuth, async (req, res, next) => {
    // 🔧 避免與 /doctor-time-slots、/time-slots 路由衝突：該等路徑交由專用 handler 處理
    if (req.params.id === 'doctor-time-slots' || req.params.id === 'time-slots') return next();
    const { id } = req.params;
    const { customerName, customerNameEn, customerPhone, customerEmail, customerAge, serviceId, doctorName, appointmentDate, appointmentTime, notes } = req.body;

    // 獲取原有預約資料以比較變更
    db.get("SELECT * FROM bookings WHERE id=?", [id], (err, oldBooking) => {
      if (err) return serverError(res, err);
      if (!oldBooking) return res.status(404).json({ error: "預約不存在" });

      // 權限檢查：僅限本人或管理員/醫師/員工
      if (!isOwnerOrStaff(req, oldBooking)) {
        return res.status(403).json({ error: "無權限修改此預約" });
      }

      // 客戶不可更改已確認/鎖定預約
      if ((oldBooking.is_locked === 1 || oldBooking.status === 'confirmed') && !['admin', 'doctor', 'staff'].includes(req.user.role)) {
        return res.status(403).json({ error: "此預約已鎖定或已確認，無法修改。請聯繫診所。" });
      }

      // 獲取服務名稱
      db.get("SELECT name, duration, requires_bed FROM services WHERE id=?", [serviceId], async (svcErr, svc) => {
        if (svcErr) return res.status(500).json({ error: svcErr.message });
        if (!svc) return res.status(404).json({ error: "找不到服務" });
        const serviceName = svc.name;

        const localTime = getLocalTimeString();

        // 🆕 改期衝突檢查：只有時間/日期/醫師/服務有變更時先重新驗證
        const dateChanged = !!appointmentDate && appointmentDate !== oldBooking.appointment_date;
        const timeChanged = !!appointmentTime && appointmentTime !== oldBooking.appointment_time;
        const doctorChanged = !!doctorName && doctorName !== oldBooking.doctor_name;
        const newDuration = svc.duration ? Number(svc.duration) : 30;
        const dateToUse = appointmentDate || oldBooking.appointment_date;
        const timeToUse = appointmentTime || oldBooking.appointment_time;
        const doctorToUse = doctorName || oldBooking.doctor_name;

        if (dateChanged || timeChanged) {
          // 診所開診日 + 過往日期 + 營業時間 + 紅字日
          const openCheck = await checkClinicOpen(dateToUse, timeToUse, doctorToUse);
          if (!openCheck.ok) return res.status(400).json({ error: openCheck.error, code: openCheck.code });
        }

        if (dateChanged || timeChanged || doctorChanged) {
          const activeStatuses = "('pending','confirmed','in-progress','in-treatment','visited','dispensing')";
          const rows = await new Promise((resolve) => {
            db.all(
              `SELECT b.appointment_time, s.duration, b.bed_type FROM bookings b
               LEFT JOIN services s ON s.id=b.service_id
               WHERE b.appointment_date=? AND b.doctor_name=? AND b.id<>? AND b.status IN ${activeStatuses}`,
              [dateToUse, doctorToUse, id],
              (e, r) => resolve(r || [])
            );
          });
          const conflict = checkOverlap(rows, timeToMinutes(timeToUse), newDuration);
          if (!conflict.ok) return res.status(409).json({ error: conflict.reason, code: 'overlap' });

          // 床位資源（全院共享）
          if (svc.requires_bed === 1) {
            const bedType = oldBooking.bed_type || serviceBedType(svc.name);
            const bedKey = bedCapacityKey(bedType);
            const bedCapRow = await new Promise((resolve) => db.get("SELECT setting_value FROM clinic_settings WHERE setting_key=?", [bedKey], (e, r) => resolve(r)));
            const bedCap = bedCapRow ? parseInt(bedCapRow.setting_value, 10) : 5;
            const bedRows = await new Promise((resolve) => {
              db.all(
                `SELECT b.appointment_time, s.duration, b.bed_type FROM bookings b
                 LEFT JOIN services s ON s.id=b.service_id
                 WHERE b.appointment_date=? AND b.id<>? AND b.bed_type IS NOT NULL AND b.status IN ${activeStatuses}`,
                [dateToUse, id],
                (e, r) => resolve(r || [])
              );
            });
            const bedCheck = checkBedAvailable(bedRows, timeToMinutes(timeToUse), newDuration, bedCap, bedType);
            if (!bedCheck.ok) return res.status(409).json({ error: `床位資源已滿（剩餘 ${bedCheck.cap - bedCheck.used} 張），請改選其他時段`, code: 'bed' });
          }
        }

        // 🆕 時間/日期/醫師變更時重算結束時間
        const newEndTime = (dateChanged || timeChanged || doctorChanged)
          ? minutesToTime(timeToMinutes(timeToUse) + newDuration)
          : (oldBooking.end_time || minutesToTime(timeToMinutes(timeToUse) + newDuration));

        db.run(
          `UPDATE bookings SET customer_name=?, customer_name_en=?, customer_phone=?, customer_email=?, customer_age=?, service_id=?, doctor_name=?, appointment_date=?, appointment_time=?, end_time=?, notes=?, updated_at=? WHERE id=?`,
          [customerName, customerNameEn || oldBooking.customer_name_en, customerPhone, customerEmail, customerAge || oldBooking.customer_age, serviceId, doctorToUse, dateToUse, timeToUse, newEndTime, notes, localTime, id],
          async function (updateErr) {
            if (updateErr) return res.status(500).json({ error: updateErr.message });
            
            console.log(`✅ 預約已更新 - ID: ${id}`);
            
            // 獲取原服務名稱
            db.get("SELECT name FROM services WHERE id=?", [oldBooking.service_id], async (oldSvcErr, oldSvc) => {
              const oldServiceName = oldSvc ? oldSvc.name : `服務 #${oldBooking.service_id}`;
              
              const oldBookingData = {
                customerName: oldBooking.customer_name,
                date: oldBooking.appointment_date,
                time: oldBooking.appointment_time,
                doctorName: oldBooking.doctor_name,
                serviceName: oldServiceName
              };
              
              const newBookingData = {
                customerName: customerName || oldBooking.customer_name,
                date: appointmentDate,
                time: appointmentTime,
                doctorName: doctorName || "張醫師",
                serviceName: serviceName
              };
              
              // 🆕 發送更改通知 - WhatsApp 優先 → 電郵同時發送
              try {
                
                const whatsappEnabled = await new Promise((resolve, reject) => {
                  db.get("SELECT setting_value FROM clinic_settings WHERE setting_key = 'whatsapp_notification_enabled'", (err, row) => {
                    if (err) reject(err);
                    else resolve(row ? row.setting_value === 'true' : false);
                  });
                });

                const emailEnabled = await new Promise((resolve, reject) => {
                  db.get("SELECT setting_value FROM clinic_settings WHERE setting_key = 'email_notification_enabled'", (err, row) => {
                    if (err) reject(err);
                    else resolve(row ? row.setting_value === 'true' : false);
                  });
                });

                let formattedPhone = customerPhone || oldBooking.customer_phone;
                if (formattedPhone && !formattedPhone.startsWith('+')) {
                  formattedPhone = '+852' + formattedPhone.replace(/^852/, '');
                }

                // 🆕 WhatsApp 優先發送
                let messageSent = false;

                // 1️⃣ 優先嘗試 WhatsApp
                if (whatsappEnabled && formattedPhone && whatsappService.isConfigured()) {
                  try {
                    const waResult = await whatsappService.sendBookingUpdateWhatsApp(formattedPhone, oldBookingData, newBookingData);
                    if (waResult && waResult.success !== false) {
                      console.log(`✅ 更改預約 WhatsApp 已發送到 ${formattedPhone}`);
                      messageSent = true;
                    } else {
                      console.log(`❌ 更改預約 WhatsApp 發送失敗`);
                    }
                  } catch (waErr) {
                    console.error('❌ 發送更改 WhatsApp 失敗:', waErr.message);
                  }
                }

                if (!messageSent) {
                  console.log(`⚠️ 更改預約 WhatsApp 通知未能發送`);
                }

                // 3️⃣ 電郵同時發送（如開啟且有電郵）
                const emailToUse = customerEmail || oldBooking.customer_email;
                if (emailEnabled && emailToUse && emailService) {
                  console.log(`📧 同時發送更改預約電郵通知到 ${emailToUse}...`);
                  try {
                    await emailService.sendBookingUpdate(emailToUse, oldBookingData, newBookingData);
                    console.log(`✅ 更改預約電郵通知已發送到 ${emailToUse}`);
                  } catch (emailErr) {
                    console.error('❌ 發送更改預約電郵通知失敗:', emailErr.message);
                  }
                } else if (!emailEnabled) {
                  console.log(`⏭️ 電郵通知已關閉`);
                } else if (!emailToUse) {
                  console.log(`⏭️ 客戶未提供電郵`);
                }
              } catch (notifyErr) {
                console.error('處理更改通知時出錯:', notifyErr);
              }
            });

            res.json({ ok: true, message: "預約已更新" });
          }
        );
      });
    });
  });

  // 取消預約（需登入，只限本人或管理員/醫師/員工）
  router.delete("/:id", requireAuth, (req, res) => {
    const { id } = req.params;
    const localTime = getLocalTimeString();
    
    // 獲取預約資料用於發送取消通知
    db.get("SELECT * FROM bookings WHERE id=?", [id], (err, booking) => {
      if (err) return serverError(res, err);
      if (!booking) return res.status(404).json({ error: "預約不存在" });

      // 權限檢查：僅限本人或管理員/醫師/員工
      if (!isOwnerOrStaff(req, booking)) {
        return res.status(403).json({ error: "無權限取消此預約" });
      }

      // 狀態守衛：只有未完成/未到場嘅單先可以取消
      if (['completed', 'no-show', 'cancelled'].includes(booking.status)) {
        return res.status(400).json({ error: `此預約狀態為「${booking.status}」，無法取消` });
      }

      // 🆕 客戶取消時間窗：建立後 15 分鐘內 或 預約前 24 小時內
      if (req.user && req.user.role === 'customer') {
        // 🕐 一致用本地時區解析：資料庫儲存嘅係本地時間字串（YYYY-MM-DD HH:mm:ss）
        //    舊版錯誤噉加 'Z' 當 UTC 解析，令實際經過時間虛大 8 小時，15 分鐘寬限永遠失效
        const createdAtStr = String(booking.created_at || '');
        const created = createdAtStr.includes('T')
          ? new Date(createdAtStr)
          : new Date(createdAtStr.replace(' ', 'T'));
        const minsSinceCreate = (Date.now() - created.getTime()) / 60000;
        if (minsSinceCreate > 15) {
          const apptTime = new Date(`${booking.appointment_date}T${booking.appointment_time}:00`);
          const hoursToAppt = (apptTime.getTime() - Date.now()) / 3600000;
          if (hoursToAppt > 24) {
            return res.status(400).json({
              error: "客戶只可於預約前 24 小時內或預約建立後 15 分鐘內取消，如需要請致電診所",
              code: 'cancel_window'
            });
          }
        }
      }

      // 獲取服務名稱
      db.get("SELECT name FROM services WHERE id=?", [booking.service_id], (svcErr, svc) => {
        const serviceName = svc ? svc.name : `服務 #${booking.service_id}`;
        
        db.run("UPDATE bookings SET status='cancelled', updated_at=? WHERE id=?", [localTime, id], async function (updateErr) {
          if (updateErr) return res.status(500).json({ error: updateErr.message });
          
          console.log(`✅ 預約已取消 - ID: ${id}`);
          
          const notificationData = {
            customerName: booking.customer_name,
            bookingId: id,
            serviceName: serviceName,
            doctorName: booking.doctor_name,
            date: booking.appointment_date,
            time: booking.appointment_time
          };
          
          // 🆕 發送取消通知 - WhatsApp 優先 → 電郵同時發送
          try {
            
            const whatsappEnabled = await new Promise((resolve, reject) => {
              db.get("SELECT setting_value FROM clinic_settings WHERE setting_key = 'whatsapp_notification_enabled'", (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.setting_value === 'true' : false);
              });
            });

            const emailEnabled = await new Promise((resolve, reject) => {
              db.get("SELECT setting_value FROM clinic_settings WHERE setting_key = 'email_notification_enabled'", (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.setting_value === 'true' : false);
              });
            });

            // 格式化電話號碼
            let formattedPhone = booking.customer_phone;
            if (formattedPhone && !formattedPhone.startsWith('+')) {
              formattedPhone = '+852' + formattedPhone.replace(/^852/, '');
            }

            // 🆕 WhatsApp 優先發送
            let messageSent = false;

            // 1️⃣ 優先嘗試 WhatsApp
            if (whatsappEnabled && formattedPhone && whatsappService.isConfigured()) {
              try {
                const waResult = await whatsappService.sendBookingCancellationWhatsApp(formattedPhone, notificationData);
                if (waResult && waResult.success !== false) {
                  console.log(`✅ 取消預約 WhatsApp 已發送到 ${formattedPhone}`);
                  messageSent = true;
                } else {
                  console.log(`❌ 取消預約 WhatsApp 發送失敗`);
                }
              } catch (waErr) {
                console.error('❌ 發送取消 WhatsApp 失敗:', waErr.message);
              }
            }

            if (!messageSent) {
              console.log(`⚠️ 取消預約 WhatsApp 通知未能發送`);
            }

            // 3️⃣ 電郵同時發送（如開啟且有電郵）
            if (emailEnabled && booking.customer_email && emailService) {
              console.log(`📧 同時發送取消預約電郵通知到 ${booking.customer_email}...`);
              try {
                await emailService.sendBookingCancellation(booking.customer_email, notificationData);
                console.log(`✅ 取消預約電郵通知已發送到 ${booking.customer_email}`);
              } catch (emailErr) {
                console.error('❌ 發送取消預約電郵通知失敗:', emailErr.message);
              }
            } else if (!emailEnabled) {
              console.log(`⏭️ 電郵通知已關閉`);
            } else if (!booking.customer_email) {
              console.log(`⏭️ 客戶未提供電郵`);
            }
          } catch (notifyErr) {
            console.error('處理取消通知時出錯:', notifyErr);
          }

          res.json({ ok: true, message: "預約已取消" });
        });
      });
    });
  });

  // 更新預約狀態
  // 更新預約狀態（限管理員/醫師/員工）
  router.put("/:id/status", requireAuth, requireRole('admin', 'doctor', 'staff'), async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['confirmed', 'in-progress', 'in-treatment', 'visited', 'dispensing', 'completed', 'no-show', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "無效的狀態值" });
    }
    const localTime = getLocalTimeString();
    
    // 先獲取預約資料（用於發送郵件）
    db.get("SELECT * FROM bookings WHERE id=?", [id], (err, booking) => {
      if (err) return serverError(res, err);
      if (!booking) return res.status(404).json({ error: "預約不存在" });

      // 🆕 權限：員工可改任何單；醫師只可改自己嘅單（與 admin.js 一致，避免繞過）
      if (req.user && req.user.role === 'doctor') {
        const ownName = req.user.name;
        const isOwn = (booking.doctor_user_id && Number(booking.doctor_user_id) === Number(req.user.id)) || (ownName && booking.doctor_name === ownName);
        if (!isOwn) {
          return res.status(403).json({ error: "醫師只可更新自己嘅預約" });
        }
      }

      // 獲取服務名稱
      db.get("SELECT name FROM services WHERE id=?", [booking.service_id], (svcErr, svc) => {
        const serviceName = svc ? svc.name : `服務 #${booking.service_id}`;
        
        db.run(
          "UPDATE bookings SET status=?, updated_at=? WHERE id=?", 
          [status, localTime, id], 
          async function (updateErr) {
            if (updateErr) return res.status(500).json({ error: updateErr.message });
            
            const notificationData = {
              customerName: booking.customer_name,
              bookingId: id,
              serviceName: serviceName,
              doctorName: booking.doctor_name,
              date: booking.appointment_date,
              time: booking.appointment_time
            };
            
            // 如果是取消預約，發送取消通知（WhatsApp 優先 → 電郵同時）
            if (status === 'cancelled') {
              try {
                
                const whatsappEnabled = await new Promise((resolve, reject) => {
                  db.get("SELECT setting_value FROM clinic_settings WHERE setting_key = 'whatsapp_notification_enabled'", (err, row) => {
                    if (err) reject(err);
                    else resolve(row ? row.setting_value === 'true' : false);
                  });
                });

                const emailEnabled = await new Promise((resolve, reject) => {
                  db.get("SELECT setting_value FROM clinic_settings WHERE setting_key = 'email_notification_enabled'", (err, row) => {
                    if (err) reject(err);
                    else resolve(row ? row.setting_value === 'true' : true);
                  });
                });

                let formattedPhone = booking.customer_phone;
                if (formattedPhone && !formattedPhone.startsWith('+')) {
                  formattedPhone = '+852' + formattedPhone.replace(/^852/, '');
                }

                // 🆕 WhatsApp 優先發送
                let messageSent = false;

                // 1️⃣ 優先嘗試 WhatsApp
                if (whatsappEnabled && formattedPhone && whatsappService.isConfigured()) {
                  try {
                    const waResult = await whatsappService.sendBookingCancellationWhatsApp(formattedPhone, notificationData);
                    if (waResult && waResult.success !== false) {
                      console.log(`✅ 取消預約 WhatsApp 已發送到 ${formattedPhone}`);
                      messageSent = true;
                    } else {
                      console.log(`❌ 取消預約 WhatsApp 發送失敗`);
                    }
                  } catch (waErr) {
                    console.error('❌ 發送取消 WhatsApp 失敗:', waErr.message);
                  }
                }

                if (!messageSent) {
                  console.log(`⚠️ 取消預約 WhatsApp 通知未能發送`);
                }

                // 3️⃣ 電郵同時發送（如開啟且有電郵）
                if (emailEnabled && booking.customer_email && emailService) {
                  console.log(`📧 同時發送取消預約電郵通知到 ${booking.customer_email}...`);
                  try {
                    await emailService.sendBookingCancellation(booking.customer_email, notificationData);
                    console.log(`✅ 取消預約電郵通知已發送到 ${booking.customer_email}`);
                  } catch (emailErr) {
                    console.error('❌ 發送取消預約電郵通知失敗:', emailErr.message);
                  }
                } else if (!emailEnabled) {
                  console.log(`⏭️ 電郵通知已關閉`);
                } else if (!booking.customer_email) {
                  console.log(`⏭️ 客戶未提供電郵`);
                }
              } catch (notifyErr) {
                console.error('處理取消通知時出錯:', notifyErr);
              }
            }
            
            res.json({ ok: true, message: "狀態已更新" });
          }
        );
      });
    });
  });

  // 記錄遲到分鐘數（限管理員/醫師/員工）—— 由預約時間 vs 實際到診時間自動建議
  router.put("/:id/lateness", requireAuth, requireRole('admin', 'doctor', 'staff'), (req, res) => {
    const { id } = req.params;
    const { lateness_minutes, actual_arrival_time } = req.body || {};

    db.get("SELECT id, appointment_date, appointment_time, status FROM bookings WHERE id=?", [id], (err, booking) => {
      if (err) return serverError(res, err);
      if (!booking) return res.status(404).json({ error: "預約不存在" });
      if (booking.status === 'cancelled' || booking.status === 'no-show') {
        return res.status(400).json({ error: "已取消或未到場嘅預約無法記錄遲到" });
      }

      let minutes = lateness_minutes;
      if (minutes == null && actual_arrival_time) {
        const appt = timeToMinutes(booking.appointment_time);
        const arr = timeToMinutes(actual_arrival_time);
        if (appt != null && arr != null) minutes = Math.max(0, arr - appt);
      }
      if (minutes == null || isNaN(Number(minutes)) || Number(minutes) < 0) {
        return res.status(400).json({ error: "遲到分鐘數無效" });
      }
      minutes = Math.round(Number(minutes));

      db.run("UPDATE bookings SET lateness_minutes=?, updated_at=? WHERE id=?",
        [minutes, getLocalTimeString(), id],
        function (updateErr) {
          if (updateErr) return res.status(500).json({ error: updateErr.message });
          res.json({ ok: true, lateness_minutes: minutes, message: minutes > 0 ? `已記錄遲到 ${minutes} 分鐘` : '無遲到' });
        });
    });
  });

  // ==================== 時段管理 ====================

  // 🛏️ 查詢某日某服務某時段嘅具體床位空閒狀態（客人揀床用）
  router.get("/beds/available", async (req, res) => {
    const { date, serviceId, time } = req.query;
    if (!date || !serviceId || !time) return res.status(400).json({ error: "缺少日期、服務ID或時間" });
    db.get("SELECT name, duration, requires_bed FROM services WHERE id=?", [serviceId], async (err, svc) => {
      if (err || !svc) return res.status(404).json({ error: "找不到服務" });
      if (svc.requires_bed !== 1) return res.json({ bedType: 'none', cap: 0, beds: [] });
      let bedType = (req.query.bedType && ['tuina', 'vip'].includes(req.query.bedType)) ? req.query.bedType : serviceBedType(svc.name);
      if (bedType !== 'tuina' && bedType !== 'acup' && bedType !== 'mixed' && bedType !== 'vip') return res.json({ bedType: 'none', cap: 0, beds: [] });
      const bedKey = bedCapacityKey(bedType);
      const capRow = await new Promise((resolve) => db.get("SELECT setting_value FROM clinic_settings WHERE setting_key=?", [bedKey], (e, r) => resolve(r)));
      const cap = capRow ? parseInt(capRow.setting_value, 10) : 5;
      const startMin = timeToMinutes(time);
      const duration = svc.duration || 30;
      const activeStatuses = "('pending','confirmed','in-progress','in-treatment','visited','dispensing')";
      const rows = await new Promise((resolve) => {
        db.all(
          `SELECT b.appointment_time, s.duration, b.bed_type, b.bed_number FROM bookings b
           LEFT JOIN services s ON s.id = b.service_id
           WHERE b.appointment_date=? AND b.status IN ${activeStatuses} AND b.bed_type IS NOT NULL`,
          [date], (e, r) => resolve(r || []));
      });
      const occupied = new Set();
      for (const b of rows) {
        const s = timeToMinutes(b.appointment_time);
        if (s == null) continue;
        const e2 = s + (Number(b.duration) || 0);
        const overlaps = (s >= startMin && s < startMin + duration) ||
          (e2 > startMin && e2 <= startMin + duration) ||
          (s <= startMin && e2 >= startMin + duration);
        if (!overlaps) continue;
        const samePool = b.bed_type === bedType || b.bed_type === 'mixed' || bedType === 'mixed';
        if (samePool && b.bed_number) occupied.add(b.bed_number);
      }
      const beds = [];
      for (let n = 1; n <= cap; n++) beds.push({ n, free: !occupied.has(n) });
      res.json({ bedType, cap, time, beds });
    });
  });

  // 查詢可預約時段（重疊邏輯：每 30 分鐘一個時段，與前後最多重疊 15 分鐘）
  router.get("/timeslots/available", (req, res) => {
    const { date, serviceId, service: serviceAlias, doctor } = req.query;
    // 🆕 同時接受 serviceId / service_id / service
    const svcId = serviceId || req.query.service_id || serviceAlias;
    if (!date || !svcId) {
      const missing = [];
      if (!date) missing.push('date');
      if (!svcId) missing.push('serviceId (or service_id)');
      return res.status(400).json({ error: "缺少必要 query 參數：" + missing.join('、'), missing });
    }

    db.get("SELECT name, duration, requires_bed FROM services WHERE id=?", [svcId], async (err, svc) => {
      if (err || !svc) return res.status(404).json({ error: "找不到服務：" + svcId });

      const duration = svc.duration || 30;
      const needsBed = svc.requires_bed === 1;
      // 營業時段由 clinic_settings 讀取（星期一至五 10:00-19:00；星期六 10:00-13:00，功能5）
      const settingGet = (key) => new Promise((resolve) => {
        db.get("SELECT setting_value FROM clinic_settings WHERE setting_key=?", [key], (e, r) => resolve(r ? r.setting_value : null));
      });
      const slotInterval = parseInt(await settingGet('slot_interval'), 10) || 30;
      const { ranges } = await getDayBusinessRanges(settingGet, date);
      const slots = [];
      for (const [rs, re] of ranges) for (let m = rs; m < re; m += slotInterval) slots.push(minutesToTime(m));

      // 診所開診日檢查（閉診日/假期/紅字日/特別時段/過往日期）
      const openCheck = await checkClinicOpen(date, minutesToTime(ranges[0][0])).catch(() => ({ ok: true }));
      let dayClosed = false, dayClosedReason = '', specialOpen = null, specialClose = null;
      if (!openCheck.ok) {
        if (openCheck.code === 'special_hours') {
          const exc = await new Promise((resolve) => db.get("SELECT * FROM exceptions WHERE exception_date=? AND doctor_user_id IS NULL", [date], (e, r) => resolve(r || null)));
          if (exc) { specialOpen = exc.time_open; specialClose = exc.time_close; }
        } else {
          dayClosed = true;
          dayClosedReason = openCheck.error;
        }
      }

      // 醫師請假檢查：該醫師當日全部時段不可約
      let doctorOnLeave = false, doctorLeaveReason = '';
      if (doctor) {
        const leave = await new Promise((resolve) => db.get(
          `SELECT e.* FROM exceptions e LEFT JOIN users u ON u.id = e.doctor_user_id
           WHERE e.exception_date=? AND e.type='doctor_leave' AND u.name=?`,
          [date, doctor], (e, r) => resolve(r || null)
        ));
        if (leave) {
          doctorOnLeave = true;
          doctorLeaveReason = `${doctor} 醫師當日請假（${leave.reason || leave.name || '休假'}），請選擇其他日期或醫師`;
        }
      }

      const activeStatuses = "('pending','confirmed','in-progress','in-treatment','visited','dispensing')";
      let bookingWhere = `b.appointment_date=? AND b.status IN ${activeStatuses}`;
      const params = [date];
      if (doctor) {
        bookingWhere += " AND b.doctor_name=?";
        params.push(doctor);
      }

      db.all(
        `SELECT b.appointment_time, s.duration, b.bed_type, b.doctor_name FROM bookings b
         LEFT JOIN services s ON s.id = b.service_id
         WHERE ${bookingWhere}`,
        params,
        async (err, rows) => {
          if (err) return serverError(res, err);

          // 特別時段限制
          let filtered = slots;
          if (specialOpen && specialClose) {
            const so = timeToMinutes(specialOpen), sc = timeToMinutes(specialClose);
            filtered = slots.filter(t => { const m = timeToMinutes(t); return m >= so && m < sc; });
          }
          const bedCapRows = needsBed ? await new Promise((resolve) => db.get("SELECT setting_value FROM clinic_settings WHERE setting_key=?", [bedCapacityKey((req.query.bedType && ['tuina','vip'].includes(req.query.bedType)) ? req.query.bedType : serviceBedType(svc.name))], (e, r) => resolve(r ? r.setting_value : null))) : null;
          const bedCap = bedCapRows ? parseInt(bedCapRows, 10) : 5;
          const bedType = needsBed ? ((req.query.bedType && ['tuina','vip'].includes(req.query.bedType)) ? req.query.bedType : serviceBedType(svc.name)) : null;

          const result = filtered.map((t) => {
            if (dayClosed) return { time: t, available: false, reason: dayClosedReason };
            if (doctorOnLeave) return { time: t, available: false, reason: doctorLeaveReason };
            const startMin = timeToMinutes(t);
            const conflict = checkOverlap(rows, startMin, duration);
            if (!conflict.ok) return { time: t, available: false, reason: conflict.reason };
            if (needsBed) {
              const bedCheck = checkBedAvailable(rows, startMin, duration, bedCap, bedType);
              const bedLabel = bedTypeLabel(bedType);
              // 🛏️ 透明化：每個時段回傳剩餘床位，等客人揀之前就見到
              if (!bedCheck.ok) return { time: t, available: false, reason: `${bedLabel}已滿（${bedCap} 張全被預約）`, bedLeft: 0, bedCap };
              return { time: t, available: true, bedLeft: bedCap - bedCheck.used, bedCap };
            }
            return { time: t, available: true };
          });

          res.json(result);
        }
      );
    });
  });

  // 獲取指定日期的時段狀態
  router.get("/time-slots/:date", (req, res) => {
    const { date } = req.params;
    
    const timeSlots = [];
    for (let hour = 8; hour < 19; hour++) {
      for (let minute of [0, 30]) {
        const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        timeSlots.push(time);
      }
    }
    
    db.all(
      "SELECT * FROM time_slots WHERE date = ?",
      [date],
      (err, rows) => {
        if (err) return serverError(res, err);
        
        const slots = timeSlots.map(time => {
          const dbSlot = rows.find(r => r.time === time);
          return {
            date,
            time,
            is_available: dbSlot ? dbSlot.is_available : 1,
            max_capacity: dbSlot ? dbSlot.max_capacity : 3,
            current_bookings: dbSlot ? dbSlot.current_bookings : 0,
            notes: dbSlot ? dbSlot.notes : ''
          };
        });
        
        res.json(slots);
      }
    );
  });

  // 更新時段狀態（限管理員）
  router.put("/time-slots", requireAuth, requireRole('admin'), (req, res) => {
    const { date, time, is_available, max_capacity, notes } = req.body;
    
    if (!date || !time) {
      return res.status(400).json({ error: "缺少日期或時間" });
    }
    
    db.run(
      `INSERT OR REPLACE INTO time_slots (date, time, is_available, max_capacity, notes, updated_at) 
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [date, time, is_available ? 1 : 0, max_capacity || 3, notes || ''],
      function(err) {
        if (err) return serverError(res, err);
        res.json({ success: true, message: "時段狀態已更新" });
      }
    );
  });

  // 批量更新時段狀態（限管理員）
  router.post("/time-slots/batch", requireAuth, requireRole('admin'), (req, res) => {
    const { slots } = req.body;
    
    if (!slots || !Array.isArray(slots)) {
      return res.status(400).json({ error: "無效的資料格式" });
    }
    
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO time_slots (date, time, is_available, max_capacity, notes, updated_at) 
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    );
    
    let successCount = 0;
    slots.forEach(slot => {
      stmt.run(
        slot.date,
        slot.time,
        slot.is_available ? 1 : 0,
        slot.max_capacity || 3,
        slot.notes || ''
      );
      successCount++;
    });
    
    stmt.finalize(err => {
      if (err) return serverError(res, err);
      res.json({ success: true, message: `已更新 ${successCount} 個時段` });
    });
  });

  // ===== 醫師時段管理 API =====
  
  // 獲取指定日期的醫師時段狀態
  router.get("/doctor-time-slots/:date", (req, res, next) => {
    const { date } = req.params;

    // 子路由（如 range）唔係日期 → 交俾後續 handler 處理
    if (date === 'range' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return next();
    
    // 先獲取診所設定的營業時間
    db.all("SELECT setting_key, setting_value FROM clinic_settings", (err, settingsRows) => {
      if (err) return serverError(res, err);
      
      // 將設定轉換為物件
      const clinicSettings = {};
      if (settingsRows) {
        settingsRows.forEach(row => {
          clinicSettings[row.setting_key] = row.setting_value;
        });
      }
      
      const morningStart = clinicSettings.morning_start || '10:00';
      const morningEnd = clinicSettings.morning_end || '14:00';
      const afternoonStart = clinicSettings.afternoon_start || '14:00';
      const afternoonEnd = clinicSettings.afternoon_end || '19:00';
      const slotInterval = parseInt(clinicSettings.slot_interval) || 30;

      // 🕐 功能5：星期六 10:00-13:00（saturday_start/end，未設定用預設）
      const dateDow = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T00:00:00').getDay() : NaN;
      const isSaturday = dateDow === 6;
      const satStart = clinicSettings.saturday_start || '10:00';
      const satEnd = clinicSettings.saturday_end || '13:00';

      // 生成所有時段
      const generateTimeSlots = (start, end) => {
        const slots = [];
        const [startH, startM] = start.split(':').map(Number);
        const [endH, endM] = end.split(':').map(Number);
        let currentMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        while (currentMinutes < endMinutes) {
          const h = Math.floor(currentMinutes / 60);
          const m = currentMinutes % 60;
          slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
          currentMinutes += slotInterval;
        }
        return slots;
      };

      const morningSlots = isSaturday ? generateTimeSlots(satStart, satEnd) : generateTimeSlots(morningStart, morningEnd);
      const afternoonSlots = isSaturday ? [] : generateTimeSlots(afternoonStart, afternoonEnd);
      const allTimeSlots = [...morningSlots, ...afternoonSlots];
      
      // 獲取醫師列表
      db.all("SELECT id, name FROM doctors WHERE is_active = 1 ORDER BY id", (err, doctors) => {
        if (err) return serverError(res, err);
        
        // 如果沒有醫師資料，使用預設醫師
        if (!doctors || doctors.length === 0) {
          doctors = [
            { id: 1, name: '張醫師' },
            { id: 2, name: '李醫師' },
            { id: 3, name: '王醫師' },
            { id: 4, name: '陳醫師' }
          ];
        }
        
        // 獲取該日期的醫師時段設定
        db.all(
          "SELECT * FROM doctor_time_slots WHERE date = ?",
          [date],
          (err, doctorSlots) => {
            if (err) return serverError(res, err);
            
            // 獲取該日期的預約記錄 - 使用正確的欄位名
            db.all(
              "SELECT doctor_name, appointment_time, COUNT(*) as count FROM bookings WHERE appointment_date = ? AND status != 'cancelled' GROUP BY doctor_name, appointment_time",
              [date],
              (err, bookings) => {
                if (err) return serverError(res, err);
                
                // 構建結果
                const result = {
                  date,
                  businessHours: {
                    morningStart, morningEnd, afternoonStart, afternoonEnd, slotInterval
                  },
                  morningSlots,
                  afternoonSlots,
                  doctors,
                  slots: {}
                };
                
                // 為每個時段和醫師組合生成狀態
                allTimeSlots.forEach(time => {
                  result.slots[time] = {};
                  doctors.forEach(doctor => {
                    const dbSlot = doctorSlots ? doctorSlots.find(s => s.time === time && s.doctor_id === doctor.id) : null;
                    const booking = bookings ? bookings.find(b => b.appointment_time === time && b.doctor_name === doctor.name) : null;
                    
                    result.slots[time][doctor.id] = {
                      is_available: dbSlot ? dbSlot.is_available === 1 : true,
                      current_bookings: booking ? booking.count : 0,
                      max_capacity: dbSlot ? dbSlot.max_capacity : 1, // 每個醫師每時段預設最多1人
                      status: dbSlot ? (dbSlot.status || 'open') : 'open',
                      notes: dbSlot ? dbSlot.notes : ''
                    };
                  });
                });
                
                res.json(result);
              }
            );
          }
        );
      });
    });
  });
  
  // 查詢某範圍內各醫師嘅返工日（月曆用，TimeTree 風格）
  router.get("/doctor-time-slots/range", async (req, res) => {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: "缺少開始或結束日期" });
      db.all("SELECT id, name, user_id FROM doctors WHERE is_active=1 ORDER BY id", (err, doctors) => {
        if (err) return serverError(res, err);
        const docList = (doctors && doctors.length) ? doctors : [{ id: 1, name: '張醫師', user_id: null }, { id: 2, name: '李醫師', user_id: null }];
      db.all(
        `SELECT doctor_id, date, COUNT(*) as total,
                SUM(CASE WHEN is_available=1 THEN 1 ELSE 0 END) as avail
         FROM doctor_time_slots WHERE date>=? AND date<=? GROUP BY doctor_id, date`,
        [start, end],
        (err2, rows) => {
          if (err2) return serverError(res, err2);
          db.all(
            `SELECT e.exception_date, u.name FROM exceptions e
             LEFT JOIN users u ON u.id=e.doctor_user_id
             WHERE e.type='doctor_leave' AND e.exception_date>=? AND e.exception_date<=?`,
            [start, end],
            (err3, leaves) => {
              if (err3) return serverError(res, err3);
              const days = {};
              (rows || []).forEach(r => {
                if (!days[r.date]) days[r.date] = {};
                days[r.date][r.doctor_id] = { totalSlots: r.total, availableSlots: r.avail, working: r.avail > 0 };
              });
              (leaves || []).forEach(l => {
                if (!l.name) {
                  // 全診所休診（doctor_user_id IS NULL）→ 所有醫師當日標記 leave
                  if (!days[l.exception_date]) days[l.exception_date] = {};
                  docList.forEach(d => {
                    days[l.exception_date][d.id] = Object.assign(days[l.exception_date][d.id] || {}, { leave: true, working: false });
                  });
                  return;
                }
                const did = (docList.find(d => d.name === l.name) || {}).id;
                if (did) {
                  if (!days[l.exception_date]) days[l.exception_date] = {};
                  days[l.exception_date][did] = Object.assign(days[l.exception_date][did] || {}, { leave: true, working: false });
                }
              });
              res.json({ doctors: docList, days });
            }
          );
        }
      );
    });
  });

  // 🆕 診所月曆：一段日期內嘅預約（月曆預約數＋範圍清單，可篩選醫師）｜管理員／醫師／員工
  router.get("/doctor-appointments/range", requireAuth, requireRole('admin', 'doctor', 'staff'), (req, res) => {
    const { start, end, doctorId } = req.query;
    if (!start || !end) return res.status(400).json({ error: "缺少開始或結束日期" });
    const runQuery = (extraWhere, params) => {
      db.all(
        `SELECT b.*, s.name AS service_name, u.name AS doctor_name
         FROM bookings b
         LEFT JOIN services s ON b.service_id = s.id
         LEFT JOIN users u ON u.id = b.doctor_user_id
         WHERE b.appointment_date >= ? AND b.appointment_date <= ? ${extraWhere}
         ORDER BY b.appointment_date ASC, b.appointment_time ASC`,
        params,
        (err, rows) => {
          if (err) return serverError(res, err);
          res.json({ ok: true, bookings: rows || [] });
        }
      );
    };
    if (!doctorId) return runQuery('', [start, end]);
    db.get("SELECT name FROM users WHERE id=? AND role='doctor'", [doctorId], (err, docUser) => {
      if (err) return serverError(res, err);
      if (docUser) {
        runQuery('AND (b.doctor_user_id=? OR b.doctor_name=?)', [start, end, Number(doctorId), docUser.name]);
      } else {
        // 若係 doctors 表 id，改用醫師名稱匹配（doctor_user_id 可能對應唔到）
        db.get("SELECT name FROM doctors WHERE id=?", [doctorId], (err2, docRow) => {
          if (err2) return serverError(res, err2);
          if (docRow) {
            runQuery('AND (b.doctor_user_id=? OR b.doctor_name=?)', [start, end, Number(doctorId), docRow.name]);
          } else {
            runQuery('AND b.doctor_user_id=?', [start, end, Number(doctorId)]);
          }
        });
      }
    });
  });

  // 更新醫師時段狀態（限管理員）
  router.put("/doctor-time-slots", requireAuth, requireRole('admin'), (req, res) => {
    const { date, time, doctor_id, is_available, status, max_capacity, notes } = req.body;

    if (!date || !time || !doctor_id) {
      return res.status(400).json({ error: "缺少必要參數" });
    }

    // status 優先：open=開放 / rest=休息 / waiting=候診 / blank=空白關閉
    let finalStatus = status || (is_available ? 'open' : 'blank');
    let finalAvail = (status === 'rest' || status === 'blank') ? 0 : 1;

    db.run(
      `INSERT OR REPLACE INTO doctor_time_slots (date, time, doctor_id, is_available, status, max_capacity, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [date, time, doctor_id, finalAvail, finalStatus, max_capacity || 1, notes || ''],
      function (err) {
        if (err) return serverError(res, err);
        res.json({ success: true, message: "醫師時段狀態已更新", status: finalStatus });
      }
    );
  });

  // 批量更新醫師時段狀態（限管理員 / 醫師 / 員工）
  // 🔒 醫師只可改自己嘅時段；staff/admin 可跨醫師
  router.post("/doctor-time-slots/batch", requireAuth, requireRole('admin', 'doctor', 'staff'), async (req, res) => {
    const { slots } = req.body;

    if (!slots || !Array.isArray(slots)) {
      return res.status(400).json({ error: "無效的資料格式" });
    }

    // 醫師：解析自己嘅 doctors.id，唔允許改他人
    let allowedDoctorId = null;
    if (req.user.role === 'doctor') {
      const myDoc = await new Promise((resolve) => {
        db.get("SELECT id FROM doctors WHERE user_id=? AND is_active=1", [req.user.id], (e, r) => resolve(r || null));
      });
      if (!myDoc) {
        return res.status(403).json({ error: '找不到你的醫師資料，無法更新時段' });
      }
      allowedDoctorId = Number(myDoc.id);
      const foreign = slots.filter((s) => Number(s.doctor_id) !== allowedDoctorId);
      if (foreign.length) {
        return res.status(403).json({ error: '醫師只可以修改自己嘅時段' });
      }
    }

    const stmt = db.prepare(
      `INSERT OR REPLACE INTO doctor_time_slots (date, time, doctor_id, is_available, status, max_capacity, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    );

    let successCount = 0;
    slots.forEach(slot => {
      const st = slot.status || (slot.is_available ? 'open' : 'blank');
      const avail = (st === 'rest' || st === 'blank' || st === 'leave') ? 0 : 1;
      stmt.run(
        slot.date,
        slot.time,
        slot.doctor_id,
        avail,
        st,
        slot.max_capacity || 1,
        slot.notes || ''
      );
      successCount++;
    });

    stmt.finalize(err => {
      if (err) return serverError(res, err);
      res.json({ success: true, message: `已更新 ${successCount} 個醫師時段` });
    });
  });

  return router;
};
