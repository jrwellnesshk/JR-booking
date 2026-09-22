const { serverError } = require("../services/httpResp");
/**
 * 管理員路由
 * 包括：用戶管理（需二次驗證）、FAQ管理、系統狀態、審計日誌
 */

const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const { validatePassword, generateTempPassword } = require('../services/passwordPolicy');

// 🔗 診所設定（電話 / WhatsApp）— 集中讀取，唔好硬碼
const clinicSettings = require('../services/clinicSettings');
// 🔔 醫師請假通知模板（可於後台自定義）
const notificationScheduler = require('../services/notification-scheduler');

module.exports = (db, hashPassword, verifyPassword, { requireAuth, requireRole, recomputeMemberNo, recomputeFamilyMemberNos } = {}) => {

  // #1：星星（新客標記）判定 —— 只畀「已完成／已到訪」嘅**非初體驗**服務，
  //      而且係該客人第一筆呢類預約。初體驗本身永遠冇星（舊邏輯會錯畀初體驗）。
  const IS_NEW_SQL =
    "CASE WHEN b.user_id IS NULL THEN 0 " +
    "WHEN IFNULL(s.name,'') LIKE '%初體驗%' THEN 0 " +
    "WHEN b.status NOT IN ('completed','visited') THEN 0 " +
    "ELSE NOT EXISTS (SELECT 1 FROM bookings x LEFT JOIN services sx ON sx.id = x.service_id " +
    "  WHERE x.user_id = b.user_id AND x.status IN ('completed','visited') " +
    "    AND IFNULL(sx.name,'') NOT LIKE '%初體驗%' " +
    "    AND (x.appointment_date < b.appointment_date OR (x.appointment_date = b.appointment_date AND x.id < b.id)) " +
    ") END AS is_new";

  // ==================== 二次驗證中間件 ====================
  
  /**
   * 驗證管理員密碼中間件
   * 用於敏感操作前的二次確認（需先通過 requireAuth + requireRole('admin')）
   */
  const verifyAdminPassword = (req, res, next) => {
    const { adminPassword } = req.body || {};
    
    if (!adminPassword) {
      return res.status(400).json({ 
        error: "此操作需要輸入您的登入密碼進行驗證",
        requiresVerification: true 
      });
    }
    
    db.get("SELECT password, role FROM users WHERE id=?", [req.user.id], (err, admin) => {
      if (err) return serverError(res, err);
      
      if (!admin || (admin.role !== 'admin' && admin.role !== 'staff')) {
        return res.status(403).json({ error: "無權限執行此操作" });
      }
      
      if (!verifyPassword(adminPassword, admin.password)) {
        return res.status(401).json({ error: "登入密碼不正確" });
      }
      
      // 驗證通過，繼續執行
      next();
    });
  };

  // ==================== 用戶管理（敏感操作需二次驗證） ====================

  // 新增帳號（管理員專用）- 需要二次驗證
  router.post("/users", requireAuth, requireRole('admin', 'staff'), verifyAdminPassword, (req, res) => {
    const { username, name, name_en, phone, email, role, insurance_covered, employment_type } = req.body;
    let { password } = req.body;

    // 驗證必填欄位（密碼可省略：由後端自動生成強隨機暫時密碼）
    const b = req.body || {};
    const missingFields = ['username', 'name', 'phone'].filter(k => !b[k]);
    if (missingFields.length) {
      return res.status(400).json({ error: "缺少必要欄位：" + missingFields.join('、'), missing: missingFields });
    }

    // 驗證角色
    const allowedRoles = ['customer', 'doctor', 'admin', 'staff'];
    const userRole = role || 'customer';
    if (!allowedRoles.includes(userRole)) {
      return res.status(400).json({ error: "無效的角色類型" });
    }

    // 🔒 提權防護：員工不得建立管理員帳戶
    if (req.user.role === 'staff' && userRole === 'admin') {
      return res.status(403).json({ error: "員工無權限建立管理員帳戶，請由管理員操作" });
    }

    // 🔒 員工/管理員帳戶必須設定「保險」覆蓋欄位
    if ((userRole === 'staff' || userRole === 'admin') && insurance_covered === undefined) {
      return res.status(400).json({ error: "員工/管理員帳戶必須確認是否包含保險覆蓋（insurance_covered）" });
    }

    // 🔒 未提供密碼 → 後端自動生成強隨機暫時密碼（按角色分層政策）；有提供則照驗
    let generatedPassword = false;
    if (!password) {
      password = generateTempPassword();
      generatedPassword = true;
    }

    // 🔒 密碼強度檢查（按新帳戶角色分層）
    const pwResult = validatePassword(password, userRole);
    if (!pwResult.ok) {
      return res.status(400).json({ error: pwResult.error, field: "password" });
    }


    // 驗證電郵格式（選填）
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "請輸入有效的電子郵件地址" });
    }

    // 檢查重複
    db.get(
      "SELECT id, username, phone, email FROM users WHERE username=? OR phone=?",
      [username, phone],
      (err, existing) => {
        if (err) return serverError(res, err);
        if (existing) {
          if (existing.username === username) return res.status(400).json({ error: "用戶名已存在" });
          if (existing.phone === phone) return res.status(400).json({ error: "電話號碼已被使用" });
        }

        const hashedPassword = hashPassword(password);
        // 🔒 新建立的管理員帳號需於首次登入修改密碼
        const mustChange = userRole === 'admin' ? 1 : 0;
        const insurance = ['staff', 'admin'].includes(userRole) ? (insurance_covered ? 1 : 0) : null;
        // 🆕 #13 醫師 part-time：醫師/員工角色支援兼職（part），預設全職（full）；其他角色唔適用
        const employmentType = (userRole === 'doctor' || userRole === 'staff')
          ? (employment_type === 'part' ? 'part' : 'full')
          : null;
        // 會員級別：高級會員已於 2026-09-15 取消，新開帳戶一律一般帳戶（general）；
        // membership_tier 對員工/醫師/管理員無實際意義，但沿用 general 保持以往行為一致
        const memberTier = 'general';
        // 🔢 會員編號（2026-09-15 新規格）：新開帳戶尚未有家庭連結 → 一般帳戶 = JR + 電話末 4 碼；
        //    之後若被連結入家庭，memberships.recomputeMemberNo 會自動改做 S（主）/ M（子）開頭
        const phoneDigits = String(phone || '').replace(/\D/g, '');
        const memberNo = userRole === 'customer' ? ('JR' + (phoneDigits.slice(-4) || '0000')) : null;
        db.run(
          "INSERT INTO users (username, password, name, name_en, phone, email, role, employment_type, profile_completed, must_change_password, insurance_covered, membership_tier, member_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [username, hashedPassword, name, name_en || "", phone, email || "", userRole, employmentType, 1, mustChange, insurance, memberTier, memberNo],
          function(insertErr) {
            if (insertErr) return res.status(500).json({ error: insertErr.message });
            const newUserId = this.lastID;

            // 如果是醫師角色，嘗試關聯 doctors 表
            if (userRole === 'doctor') {
              // 先嘗試用姓名匹配現有醫師
              db.get(
                "SELECT id FROM doctors WHERE name=? AND is_active=1",
                [name],
                (docErr, doctor) => {
                  if (!docErr && doctor) {
                    // 關聯現有醫師記錄
                    db.run("UPDATE doctors SET user_id=? WHERE id=?", [newUserId, doctor.id]);
                  } else {
                    // 新增醫師記錄
                    db.run(
                      "INSERT INTO doctors (name, specialty, is_active, user_id) VALUES (?, ?, 1, ?)",
                      [name, name_en || '醫師', newUserId]
                    );
                  }
                }
              );
            }

            // 自動生成密碼時回傳臨時密碼供職員即時告知客人
            res.json({
              ok: true,
              userId: newUserId,
              message: "帳號已建立",
              ...(generatedPassword ? { credentials: { username, tempPassword: password } } : {})
            });
          }
        );
      }
    );
  });

  // 修改用戶資料（管理員專用）- 需要二次驗證
  router.put("/users/:id", requireAuth, requireRole('admin', 'staff'), verifyAdminPassword, (req, res) => {
    const { id } = req.params;
    const { name, name_en, username, phone, email, role } = req.body;
    
    // 檢查用戶是否存在
    db.get("SELECT * FROM users WHERE id=?", [id], (err, user) => {
      if (err) return serverError(res, err);
      if (!user) return res.status(404).json({ error: "用戶不存在" });

      // 🔒 提權防護：員工不得修改管理員帳戶，亦不得將任何人提升為管理員
      if (req.user.role === 'staff' && (user.role === 'admin' || role === 'admin')) {
        return res.status(403).json({ error: "員工無權限修改管理員帳戶或設定管理員角色" });
      }
      
      // 如果要修改用戶名，檢查是否已被使用
      if (username && username !== user.username) {
        db.get("SELECT id FROM users WHERE username=? AND id!=?", [username, id], (checkErr, existing) => {
          if (checkErr) return res.status(500).json({ error: checkErr.message });
          if (existing) return res.status(400).json({ error: "此會員ID已被使用" });
          
          performUpdate();
        });
      } else {
        performUpdate();
      }
      
      function performUpdate() {
        db.run(
          `UPDATE users SET 
            name = COALESCE(?, name),
            name_en = COALESCE(?, name_en),
            username = COALESCE(?, username),
            phone = COALESCE(?, phone),
            email = COALESCE(?, email),
            role = COALESCE(?, role)
          WHERE id = ?`,
          [name, name_en, username, phone, email, role, id],
          function(updateErr) {
            if (updateErr) return res.status(500).json({ error: updateErr.message });
            res.json({ ok: true, message: "用戶資料已更新" });
          }
        );
      }
    });
  });

  // 修改用戶密碼（管理員專用）- 需要二次驗證
  router.put("/users/:id/password", requireAuth, requireRole('admin', 'staff'), verifyAdminPassword, (req, res) => {
    const { id } = req.params;
    let { newPassword } = req.body;

    // 🔒 提權防護：員工不得重設管理員密碼（同時取目標角色作分層密碼檢查）
    db.get("SELECT role, username FROM users WHERE id=?", [id], (gErr, target) => {
      if (gErr) return res.status(500).json({ error: gErr.message });
      if (!target) return res.status(404).json({ error: "用戶不存在" });
      if (req.user.role === 'staff' && target.role === 'admin') {
        return res.status(403).json({ error: "員工無權限重設管理員密碼" });
      }

      // 🔒 未提供新密碼 → 後端以強隨機生成器產生暫時密碼（符合該角色分層政策）
      const generated = !newPassword;
      if (generated) {
        newPassword = generateTempPassword();
      } else if (newPassword.length < 6) {
        return res.status(400).json({ error: "新密碼長度至少需要 6 個字符" });
      }

      // 🔒 密碼強度檢查（按目標帳戶角色分層，防止重設時繞過強密碼政策）
      const pwResult = validatePassword(newPassword, target.role);
      if (!pwResult.ok) {
        return res.status(400).json({ error: pwResult.error, field: "password" });
      }

      const hashedPassword = hashPassword(newPassword);
      db.run("UPDATE users SET password=?, must_change_password=1 WHERE id=?", [hashedPassword, id], function(err) {
        if (err) return serverError(res, err);
        if (this.changes === 0) return res.status(404).json({ error: "用戶不存在" });
        // 自動生成時回傳臨時密碼供職員即時告知客人
        res.json({
          ok: true,
          message: "密碼已更新",
          ...(generated ? { credentials: { username: target.username, tempPassword: newPassword } } : {})
        });
      });
    });
  });

  // 刪除用戶（管理員專用）- 需要二次驗證
  router.delete("/users/:id", requireAuth, requireRole('admin'), verifyAdminPassword, (req, res) => {
    const { id } = req.params;
    
    // 不能刪除自己
    if (parseInt(id) === parseInt(req.body.adminId)) {
      return res.status(400).json({ error: "不能刪除自己的帳號" });
    }
    
    db.run("DELETE FROM users WHERE id=?", [id], function(err) {
      if (err) return serverError(res, err);
      if (this.changes === 0) return res.status(404).json({ error: "用戶不存在" });
      res.json({ ok: true, message: "用戶已刪除" });
    });
  });

  // 🔓 手動解鎖被鎖定帳戶（管理員／員工；員工不可解鎖管理員）
  router.post("/users/:id/unlock", requireAuth, requireRole('admin', 'staff'), verifyAdminPassword, (req, res) => {
    const { id } = req.params;
    const actorId = req.user.id;
    const actorRole = req.user.role;
    const actorName = req.user.name;

    db.get("SELECT id, username, role FROM users WHERE id=?", [id], (err, target) => {
      if (err) return serverError(res, err);
      if (!target) return res.status(404).json({ error: "用戶不存在" });
      // 🔒 員工唔可以解鎖管理員帳戶
      if (actorRole === 'staff' && target.role === 'admin') {
        return res.status(403).json({ error: "員工無權限解鎖管理員帳戶" });
      }
      // 清除該帳戶所有失敗登入記錄（解除鎖定）
      db.run("DELETE FROM login_attempts WHERE username=?", [target.username], (dErr) => {
        if (dErr) return serverError(res, dErr);
        // 留存解鎖紀錄（操作人／時間／對象）
        db.run(
          `INSERT INTO account_unlock_logs (actor_id, actor_name, actor_role, target_user_id, target_username, target_role, created_at)
           VALUES (?,?,?,?,?,?,datetime('now'))`,
          [actorId, actorName, actorRole, target.id, target.username, target.role],
          (iErr) => {
            if (iErr) return serverError(res, iErr);
            res.json({ ok: true, message: `已為 ${target.username} 解鎖`, unlocked: true });
          }
        );
      });
    });
  });

  // 修改用戶姓名（管理員專用，不受一年一次限制）- 需要二次驗證
  router.put("/users/:id/name", requireAuth, requireRole('admin', 'staff'), verifyAdminPassword, (req, res) => {
    const { id } = req.params;
    const { newName, newNameEn, newUsername } = req.body;
    
    // 驗證輸入
    if (!newName || !newName.trim()) {
      return res.status(400).json({ error: "請提供新的中文姓名" });
    }
    
    // 先獲取用戶當前資料
    db.get("SELECT name, username FROM users WHERE id = ?", [id], (err, currentUser) => {
      if (err) return serverError(res, err);
      if (!currentUser) return res.status(404).json({ error: "用戶不存在" });

      // 🔒 提權防護：員工不得修改管理員帳戶資料
      db.get("SELECT role FROM users WHERE id=?", [id], (rErr, targetRole) => {
        if (rErr) return res.status(500).json({ error: rErr.message });
        if (req.user.role === 'staff' && targetRole && targetRole.role === 'admin') {
          return res.status(403).json({ error: "員工無權限修改管理員帳戶" });
        }
        proceedLookup();
      });

      function proceedLookup() {
        const oldName = currentUser.name;
        const oldUsername = currentUser.username;

        // 如果要修改用戶名，檢查是否已被使用
        if (newUsername && newUsername.trim()) {
          db.get("SELECT id FROM users WHERE username=? AND id!=?", [newUsername.trim(), id], (checkErr, existing) => {
            if (checkErr) return res.status(500).json({ error: checkErr.message });
            if (existing) return res.status(400).json({ error: "此會員ID已被使用" });

            performNameUpdate(true, oldName, oldUsername);
          });
        } else {
          performNameUpdate(false, oldName, oldUsername);
        }
      }
    });
    
    function performNameUpdate(updateUsername, oldName, oldUsername) {
      let updateFields = "name = ?";
      let params = [newName.trim()];
      
      if (newNameEn !== undefined) {
        updateFields += ", name_en = ?";
        params.push(newNameEn.trim() || null);
      }
      
      if (updateUsername && newUsername) {
        updateFields += ", username = ?";
        params.push(newUsername.trim());
      }
      
      params.push(id);
      
      db.run(
        `UPDATE users SET ${updateFields} WHERE id = ?`,
        params,
        function(err) {
          if (err) return serverError(res, err);
          if (this.changes === 0) return res.status(404).json({ error: "用戶不存在" });
          
          // 同步更新預約記錄中的用戶姓名
          const bookingUpdates = [];
          
          // 更新預約表中的客戶姓名（如果姓名有變更）
          if (newName.trim() !== oldName) {
            bookingUpdates.push(new Promise((resolve, reject) => {
              db.run(
                "UPDATE bookings SET customer_name = ? WHERE user_id = ?",
                [newName.trim(), id],
                function(bookingErr) {
                  if (bookingErr) {
                    console.error("更新預約姓名失敗:", bookingErr);
                    reject(bookingErr);
                  } else {
                    console.log(`已更新 ${this.changes} 筆預約記錄的客戶姓名`);
                    resolve(this.changes);
                  }
                }
              );
            }));
          }
          
          // 執行所有更新
          Promise.all(bookingUpdates)
            .then(() => {
              res.json({ 
                ok: true, 
                message: "用戶姓名已更新，相關預約記錄已同步更新" 
              });
            })
            .catch(() => {
              // 即使預約更新失敗，用戶資料已更新成功
              res.json({ 
                ok: true, 
                message: "用戶姓名已更新（部分預約記錄同步可能失敗）" 
              });
            });
        }
      );
    }
  });

  // ==================== 系統狀態 ====================

  // 系統狀態（管理員）
  router.get("/system/status", requireAuth, requireRole('admin'), (req, res) => {
    const status = {
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      nodejs: process.version,
      platform: process.platform,
      memory: {
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB',
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB'
      }
    };

    db.get("SELECT COUNT(*) as count FROM users", (err, users) => {
      db.get("SELECT COUNT(*) as count FROM bookings WHERE status='confirmed'", (err, bookings) => {
        db.get("SELECT COUNT(*) as count FROM bookings WHERE status='confirmed' AND appointment_date >= date('now')", (err, upcoming) => {
          status.statistics = {
            totalUsers: users ? users.count : 0,
            totalBookings: bookings ? bookings.count : 0,
            upcomingBookings: upcoming ? upcoming.count : 0
          };
          res.json(status);
        });
      });
    });
  });

  // ==================== FAQ 管理 ====================

  // 取得所有常見問題（管理員）
  router.get("/faqs", requireAuth, requireRole('admin'), (req, res) => {
    db.all("SELECT * FROM faqs ORDER BY display_order, id", [], (err, rows) => {
      if (err) return serverError(res, err);
      res.json({ faqs: rows });
    });
  });

  // 新增常見問題（管理員）
  router.post("/faqs", requireAuth, requireRole('admin'), (req, res) => {
    const { question, answer, display_order, is_active } = req.body;
    
    if (!question || !answer) {
      return res.status(400).json({ error: "請提供問題和答案" });
    }
    
    db.run(
      "INSERT INTO faqs (question, answer, display_order, is_active) VALUES (?, ?, ?, ?)",
      [question, answer, display_order || 0, is_active ? 1 : 0],
      function (err) {
        if (err) return serverError(res, err);
        res.json({ ok: true, id: this.lastID });
      }
    );
  });

  // 更新常見問題
  router.put("/faqs/:id", requireAuth, requireRole('admin'), (req, res) => {
    const { id } = req.params;
    const { question, answer, display_order, is_active } = req.body;
    
    db.run(
      "UPDATE faqs SET question=?, answer=?, display_order=?, is_active=? WHERE id=?",
      [question, answer, display_order || 0, is_active ? 1 : 0, id],
      function (err) {
        if (err) return serverError(res, err);
        if (this.changes === 0) {
          return res.status(404).json({ error: "找不到該常見問題" });
        }
        res.json({ ok: true });
      }
    );
  });

  // 更新常見問題狀態
  router.patch("/faqs/:id/status", requireAuth, requireRole('admin'), (req, res) => {
    const { id } = req.params;
    const { is_active } = req.body;
    
    db.run(
      "UPDATE faqs SET is_active=? WHERE id=?",
      [is_active ? 1 : 0, id],
      function (err) {
        if (err) return serverError(res, err);
        if (this.changes === 0) {
          return res.status(404).json({ error: "找不到該常見問題" });
        }
        res.json({ ok: true });
      }
    );
  });

  // 刪除常見問題
  router.delete("/faqs/:id", requireAuth, requireRole('admin'), (req, res) => {
    const { id } = req.params;
    
    db.run("DELETE FROM faqs WHERE id=?", [id], function (err) {
      if (err) return serverError(res, err);
      if (this.changes === 0) {
        return res.status(404).json({ error: "找不到該常見問題" });
      }
      res.json({ ok: true });
    });
  });

  // ==================== 醫師專屬 API ====================

  // 醫師查看自己的預約（需提供 doctor userId）
  // 醫師查看自己的預約（管理員可指定 userId 查看特定醫師）
  router.get("/doctor/bookings", requireAuth, requireRole('admin', 'doctor'), (req, res) => {
    const isDoctor = req.user.role === 'doctor';
    // 醫師角色：嚴格只睇自己（doctor_user_id）；管理員可指定 userId 睇特定醫師（兼容舊數據 OR doctor_name）
    const userId = isDoctor ? req.user.id : (req.query.userId || req.user.id);
    const { date, status } = req.query;

    // 驗證是醫師角色
    db.get("SELECT id, role, name FROM users WHERE id=? AND role='doctor'", [userId], (err, user) => {
      if (err) return serverError(res, err);
      if (!user) return res.status(403).json({ error: "無此權限" });

      // 優先使用 user_id 匹配 bookings，如果沒有則使用姓名（兼容舊數據）
      db.get("SELECT name FROM doctors WHERE user_id=? AND is_active=1", [userId], (docErr, doctor) => {
        const doctorName = doctor ? doctor.name : user.name;

        // #12 修復：醫師只睇自己 doctor_user_id 嘅預約；管理員保留 OR doctor_name 兼容舊數據
        let whereClause, whereParams;
        if (isDoctor) {
          whereClause = "b.doctor_user_id=?";
          whereParams = [userId];
        } else {
          whereClause = "(b.doctor_user_id=? OR b.doctor_name=?)";
          whereParams = [userId, doctorName];
        }
        let query = "SELECT b.*, s.name as service_name, " + IS_NEW_SQL + " FROM bookings b LEFT JOIN services s ON b.service_id = s.id WHERE " + whereClause;
        let params = whereParams.slice();

        if (date) {
          query += " AND b.appointment_date=?";
          params.push(date);
        }

        if (status) {
          query += " AND b.status=?";
          params.push(status);
        }

        query += " ORDER BY b.appointment_date DESC, b.appointment_time ASC";

        db.all(query, params, (bookErr, rows) => {
          if (bookErr) return res.status(500).json({ error: bookErr.message });
          res.json({ ok: true, data: rows, doctorName: doctorName });
        });
      });
    });
  });

  // 員工查看全部醫師的預約（限員工/管理員）
  router.get("/staff/bookings", requireAuth, requireRole('admin', 'staff'), (req, res) => {
    const { date, status } = req.query;

    // 驗證身份
    db.get("SELECT id, role, name FROM users WHERE id=?", [req.user.id], (err, user) => {
      if (err) return serverError(res, err);
      if (!user) return res.status(403).json({ error: "無此權限" });

      let query = "SELECT b.*, s.name as service_name, u.member_no as member_no, " + IS_NEW_SQL + " FROM bookings b LEFT JOIN services s ON b.service_id = s.id LEFT JOIN users u ON b.user_id = u.id WHERE 1=1";
      let params = [];

      if (date) {
        query += " AND b.appointment_date=?";
        params.push(date);
      }

      if (status) {
        query += " AND b.status=?";
        params.push(status);
      }

      query += " ORDER BY b.appointment_date DESC, b.appointment_time ASC";

      db.all(query, params, (bookErr, rows) => {
        if (bookErr) return res.status(500).json({ error: bookErr.message });
        res.json({ ok: true, data: rows, staffName: user.name });
      });
    });
  });

  // 醫師/員工更新預約狀態（身份以 JWT 為準）
  router.put("/doctor/bookings/:id/status", requireAuth, requireRole('admin', 'doctor', 'staff'), (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user.id;

    const allowedStatuses = ['pending', 'confirmed', 'in-progress', 'in-treatment', 'visited', 'dispensing', 'completed', 'no-show', 'cancelled'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: "無效的狀態" });
    }

    // 驗證是醫師或員工角色
    db.get("SELECT id, role, name FROM users WHERE id=? AND role IN ('doctor', 'staff', 'admin')", [userId], (err, user) => {
      if (err) return serverError(res, err);
      if (!user) return res.status(403).json({ error: "無此權限" });

      // 由 doctors 表取得醫師姓名（員工不受限，可更新任何預約）
      db.get("SELECT name FROM doctors WHERE user_id=? AND is_active=1", [userId], (docErr, doctor) => {
        const doctorName = doctor ? doctor.name : user.name;

        // 員工/管理員可更新任何預約；醫師只能更新自己的預約
        const checkBooking = (cb) => {
          if (user.role === 'staff' || user.role === 'admin') {
            db.get("SELECT id FROM bookings WHERE id=?", [id], cb);
          } else {
            db.get("SELECT id FROM bookings WHERE id=? AND (doctor_user_id=? OR doctor_name=?)", [id, userId, doctorName], cb);
          }
        };

        checkBooking((bookErr, booking) => {
          if (bookErr) return res.status(500).json({ error: bookErr.message });
          if (!booking) return res.status(403).json({ error: "無權限修改此預約" });

          db.run(
            "UPDATE bookings SET status=?, updated_at=datetime('now','localtime') WHERE id=?",
            [status, id],
            function(updateErr) {
              if (updateErr) return res.status(500).json({ error: updateErr.message });
              res.json({ ok: true, message: "預約狀態已更新" });
            }
          );
        });
      });
    });
  });

  // 醫師取得自己的資料（管理員可指定 userId）
  router.get("/doctor/profile", requireAuth, requireRole('admin', 'doctor'), (req, res) => {
    const userId = (req.user.role === 'admin' && req.query.userId) ? req.query.userId : req.user.id;

    db.get("SELECT id, username, name, name_en, phone, email, role FROM users WHERE id=? AND role='doctor'", [userId], (err, user) => {
      if (err) return serverError(res, err);
      if (!user) return res.status(404).json({ error: "醫師帳號不存在" });

      db.get("SELECT id, name, specialty FROM doctors WHERE user_id=? AND is_active=1", [userId], (docErr, doctor) => {
        res.json({ ok: true, user, doctor: doctor || null });
      });
    });
  });

  // ==================== 審計日誌 ====================

  // 獲取密碼重設審計日誌（管理員）
  router.get("/password-reset-logs", requireAuth, requireRole('admin'), (req, res) => {
    const { limit = 100, username, success, startDate, endDate } = req.query;
    
    let query = "SELECT * FROM password_reset_logs WHERE 1=1";
    let params = [];
    
    if (username) {
      query += " AND username LIKE ?";
      params.push(`%${username}%`);
    }
    
    if (success !== undefined) {
      query += " AND success = ?";
      params.push(success === 'true' ? 1 : 0);
    }
    
    if (startDate) {
      query += " AND datetime(created_at) >= datetime(?)";
      params.push(startDate);
    }
    
    if (endDate) {
      query += " AND datetime(created_at) <= datetime(?)";
      params.push(endDate);
    }
    
    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(parseInt(limit));
    
    db.all(query, params, (err, rows) => {
      if (err) return serverError(res, err);
      res.json(rows);
    });
  });

  // 獲取可疑的密碼重設活動（管理員）
  router.get("/suspicious-reset-activity", requireAuth, requireRole('admin'), (req, res) => {
    const query = `
      SELECT 
        ip_address,
        COUNT(*) as attempt_count,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_count,
        MIN(created_at) as first_attempt,
        MAX(created_at) as last_attempt,
        GROUP_CONCAT(DISTINCT username) as attempted_usernames
      FROM password_reset_logs
      WHERE datetime(created_at) >= datetime('now', '-24 hours')
      GROUP BY ip_address
      HAVING failed_count >= 3
      ORDER BY failed_count DESC
    `;
    
    db.all(query, [], (err, rows) => {
      if (err) return serverError(res, err);
      res.json(rows);
    });
  });

  // ==================== 收入報表 ====================

  // 按年/月/日查看收入（以已確認的預約服務價格計算，管理員專用）
  // 🆕 附加：應診人數（visited）與訂閱人數 / 訂閱收入統計
  router.get("/income", requireAuth, requireRole('admin'), (req, res) => {
    const period = ['day', 'month', 'year'].includes(req.query.period) ? req.query.period : 'day';

    const formatMap = {
      day: '%Y-%m-%d',
      month: '%Y-%m',
      year: '%Y'
    };
    const fmt = formatMap[period];

    // 🆕 可選日期範圍（只對「按日」生效）：管理員喺網頁揀咗 start/end，報表同匯出一致
    const safeDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
    const rqStart = safeDate(req.query.start), rqEnd = safeDate(req.query.end);
    const inDayRange = period === 'day' && rqStart && rqEnd;
    const rangeClause = inDayRange ? ` AND b.appointment_date >= '${rqStart}' AND b.appointment_date <= '${rqEnd}'` : '';
    const adjRange = inDayRange ? ` AND adjustment_date >= '${rqStart}' AND adjustment_date <= '${rqEnd}'` : '';
    const adjWhere = inDayRange ? "COALESCE(period_type,'day')='day'" : '1=1';

    const sql = `
      SELECT
        strftime('${fmt}', b.appointment_date) AS period,
        COUNT(*) AS count,
        COALESCE(SUM(s.price), 0) AS total
      FROM bookings b
      LEFT JOIN services s ON b.service_id = s.id
      WHERE b.status IN ('confirmed', 'completed')${rangeClause}
      GROUP BY period
      ORDER BY period DESC
    `;

    db.all(sql, [], (err, rows) => {
      if (err) return serverError(res, err);

      // 🔒 方案B：非訂閱收入只根據管理員匯入嘅 Excel 資料（income_adjustments）；
      // 系統預約金額只作「參考」顯示，唔會計入任何收入總數
      const adjFmt = { day: '%Y-%m-%d', month: '%Y-%m', year: '%Y' }[period];
      db.all(
        `SELECT strftime('${adjFmt}', adjustment_date) AS period, COUNT(*) AS count, COALESCE(SUM(amount),0) AS total
         FROM income_adjustments
         WHERE ${adjWhere}${adjRange}
         GROUP BY period ORDER BY period DESC`,
        [],
        (adjErr, adjRows) => {
          const bookMap = {};
          (rows || []).forEach(r => { bookMap[r.period] = r; });
          const adjMap = {};
          (adjRows || []).forEach(a => { adjMap[a.period] = a; });
          const periodSet = new Set([
            ...(rows || []).map(r => r.period),
            ...(adjRows || []).map(a => a.period)
          ]);
          const data = Array.from(periodSet).map(p => ({
            period: p,
            count: (bookMap[p] && bookMap[p].count) || 0,
            // 收入只計 Excel 匯入
            total: (adjMap[p] && adjMap[p].total) || 0,
            // 系統預約金額：僅供參考，不計入收入
            booking_ref_total: (bookMap[p] && bookMap[p].total) || 0,
            source: 'excel'
          }));
          data.sort((x, y) => String(y.period).localeCompare(String(x.period)));

          // 🆕 按類別（type）統計：包含「其他款項」(other) 並計入總額
          db.all(
            `SELECT strftime('${adjFmt}', adjustment_date) AS period,
                    COALESCE(type,'service') AS type,
                    COALESCE(SUM(amount),0) AS total
             FROM income_adjustments
             WHERE ${adjWhere}${adjRange}
             GROUP BY period, type`,
            [],
            (typeErr, typeRows) => {
              const byTypeByPeriod = {};
              (typeRows || []).forEach(t => {
                byTypeByPeriod[t.period] = byTypeByPeriod[t.period] || {};
                byTypeByPeriod[t.period][t.type] = (byTypeByPeriod[t.period][t.type] || 0) + (t.total || 0);
              });
              data.forEach(d => { d.byType = byTypeByPeriod[d.period] || {}; });

          // 🆕 應診人數（當期狀態為 visited / completed 的預約）
          db.all(
            `SELECT strftime('${fmt}', appointment_date) AS period, COUNT(*) AS visited_count
             FROM bookings WHERE status IN ('visited','completed')${rangeClause} GROUP BY period`,
            [],
            (vErr, vRows) => {
              (vRows || []).forEach(v => {
                const found = data.find(d => d.period === v.period);
                if (found) found.visited_count = v.visited_count;
                else data.push({ period: v.period, count: 0, total: 0, visited_count: v.visited_count });
              });
              data.forEach(d => { if (d.visited_count == null) d.visited_count = 0; });

              // 🆕 訂閱統計：各級別活躍人數、每月訂閱收入（按月費估算）、當期訂閱收入（以 start_date 計）
              const TIER_PRICE = { general: 0, premium: 8800, family: 16800 };
              db.all(
                `SELECT u.membership_tier AS tier, COUNT(DISTINCT u.id) AS count
                 FROM users u WHERE u.role='customer' GROUP BY u.membership_tier`,
                [],
                (tErr, tRows) => {
                  db.all(
                    `SELECT strftime('${fmt}', start_date) AS period, tier, COUNT(*) AS count
                     FROM subscriptions WHERE status='active' GROUP BY period, tier`,
                    [],
                    (sErr, sRows) => {
                      const tierCounts = { general: 0, premium: 0, family: 0 };
                      (tRows || []).forEach(t => { tierCounts[t.tier || 'general'] = t.count; });
                      const monthlyRecurring = (tierCounts.premium || 0) * TIER_PRICE.premium + (tierCounts.family || 0) * TIER_PRICE.family;

                      // 每期訂閱收入（該期開始嘅活躍訂閱 × 月費）
                      const subRevByPeriod = {};
                      (sRows || []).forEach(s => {
                        const price = TIER_PRICE[s.tier] || 0;
                        subRevByPeriod[s.period] = (subRevByPeriod[s.period] || 0) + price * s.count;
                      });
                      data.forEach(d => {
                        d.subscription_revenue = subRevByPeriod[d.period] || 0;
                        d.total_with_subscription = (d.total || 0) + (d.subscription_revenue || 0);
                      });

                      // 🆕 按類別小計（含「其他款項」other）
                      const byTypeTotals = {};
                      (typeRows || []).forEach(t => { byTypeTotals[t.type] = (byTypeTotals[t.type] || 0) + (t.total || 0); });

                      const summary = {
                        total: data.reduce((sum, r) => sum + (r.total || 0), 0),
                        count: data.reduce((sum, r) => sum + (r.count || 0), 0),
                        periods: data.length,
                        visited_count: data.reduce((sum, r) => sum + (r.visited_count || 0), 0),
                        // 系統預約金額（僅參考，不計入收入）
                        booking_reference_total: data.reduce((sum, r) => sum + (r.booking_ref_total || 0), 0),
                        byType: byTypeTotals,
                        otherTotal: byTypeTotals['other'] || 0,
                        subscription: {
                          counts: tierCounts,
                          total_members: (tierCounts.general || 0) + (tierCounts.premium || 0) + (tierCounts.family || 0),
                          monthly_recurring: monthlyRecurring,
                          total_subscription_revenue: data.reduce((sum, r) => sum + (r.subscription_revenue || 0), 0)
                        }
                      };

                      res.json({ period, data, summary });
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  });
});

  // ==================== 收入報表匯出 Excel ====================
  // 🆕 #11：匯出指定日期範圍嘅收入明細試算表
  // 🆕 #2：升級做「超級詳細同完整」多工作表活頁簿：
  //        ① 總覽摘要 ② 收入明細 ③ 預約明細 ④ 按服務統計 ⑤ 按醫師統計
  //        ⑥ 按日期統計 ⑦ 會籍／訂閱收入 ⑧ 付款紀錄 ⑨ 社福券使用
  // ============ 自包含 OOXML 樣式注入（community xlsx 唔支援寫入 cell.s，手動加 styles.xml） ============
  function colToIndex(letters) {
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }
  function unzipXlsx(buf) {
    const zlib = require('zlib');
    const entries = {};
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('EOCD not found in xlsx');
    const cdCount = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    for (let n = 0; n < cdCount; n++) {
      if (buf.readUInt32LE(p) !== 0x02014b50) break;
      const method = buf.readUInt16LE(p + 10);
      const compSize = buf.readUInt32LE(p + 20);
      const nameLen = buf.readUInt16LE(p + 28);
      const extraLen = buf.readUInt16LE(p + 30);
      const commentLen = buf.readUInt16LE(p + 32);
      const localOffset = buf.readUInt32LE(p + 42);
      const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      let data = buf.slice(dataStart, dataStart + compSize);
      if (method === 8) {
        try { data = zlib.inflateRawSync(data); } catch (e) { data = zlib.inflateSync(data); }
      }
      entries[name] = data;
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }
  function zipXlsx(entries) {
    const zlib = require('zlib');
    const names = Object.keys(entries).sort();
    const local = [];
    const central = [];
    let offset = 0;
    for (const name of names) {
      const data = entries[name];
      const nameBuf = Buffer.from(name, 'utf8');
      const crc = zlib.crc32(data) >>> 0;
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0);
      lh.writeUInt16LE(20, 4);
      lh.writeUInt16LE(0x0800, 6);
      lh.writeUInt16LE(0, 8);
      lh.writeUInt32LE(crc, 14);
      lh.writeUInt32LE(data.length, 18);
      lh.writeUInt32LE(data.length, 22);
      lh.writeUInt16LE(nameBuf.length, 26);
      lh.writeUInt16LE(0, 28);
      local.push(lh, nameBuf, data);
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0);
      ch.writeUInt16LE(20, 4);
      ch.writeUInt16LE(20, 6);
      ch.writeUInt16LE(0x0800, 8);
      ch.writeUInt16LE(0, 10);
      ch.writeUInt16LE(0, 12);
      ch.writeUInt16LE(0, 14);
      ch.writeUInt32LE(crc, 16);
      ch.writeUInt32LE(data.length, 20);
      ch.writeUInt32LE(data.length, 24);
      ch.writeUInt16LE(nameBuf.length, 28);
      ch.writeUInt16LE(0, 30);
      ch.writeUInt16LE(0, 32);
      ch.writeUInt16LE(0, 34);
      ch.writeUInt16LE(0, 36);
      ch.writeUInt32LE(0, 38);
      ch.writeUInt32LE(offset, 42);
      central.push(ch, nameBuf);
      offset += 30 + nameBuf.length + data.length;
    }
    const centralBuf = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(names.length, 8);
    eocd.writeUInt16LE(names.length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);
    return Buffer.concat([...local, centralBuf, eocd]);
  }
  function buildStylesXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n' +
      '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0"/></numFmts>\n' +
      '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>\n' +
      '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F855A"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6F4EA"/><bgColor indexed="64"/></patternFill></fill></fills>\n' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD0D5DD"/></left><right style="thin"><color rgb="FFD0D5DD"/></right><top style="thin"><color rgb="FFD0D5DD"/></top><bottom style="thin"><color rgb="FFD0D5DD"/></bottom><diagonal/></border></borders>\n' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>\n' +
      '<cellXfs count="8">\n' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>\n' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>\n' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>\n' +
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>\n' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>\n' +
      '<xf numFmtId="164" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>\n' +
      '<xf numFmtId="165" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>\n' +
      '<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>\n' +
      '</cellXfs>\n' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>\n' +
      '</styleSheet>';
  }
  function styleXlsx(buffer, specs) {
    const entries = unzipXlsx(buffer);
    const wbXml = entries['xl/workbook.xml'].toString('utf8');
    const sheetMatches = Array.from(wbXml.matchAll(/<sheet\b([^>]*)>/g)).map(m => {
      const a = m[1];
      return { name: (a.match(/name="([^"]*)"/) || [])[1], rid: (a.match(/r:id="([^"]*)"/) || [])[1] };
    });
    const relsXml = entries['xl/_rels/workbook.xml.rels'].toString('utf8');
    const relMap = {};
    Array.from(relsXml.matchAll(/<Relationship\b([^>]*)>/g)).forEach(m => {
      const a = m[1];
      const id = (a.match(/Id="([^"]*)"/) || [])[1];
      const tgt = (a.match(/Target="([^"]*)"/) || [])[1];
      if (id && tgt) relMap[id] = tgt;
    });
    // SheetJS 已經喺 workbook.xml.rels 加咗 styles 關係（Type=.../styles → styles.xml）。
    // 我哋直接 overwrite styles.xml 內容就得，千祈唔好再加多一個關係 ——
    // 否則兩個 styles 關係會令 Excel 唔知點 resolve 樣式，開檔時彈「修復全部 sheet 嘅 cell 資訊」。
    const alreadyHasStylesRel = /Type="[^"]*relationships\/styles"/.test(relsXml);
    entries['xl/styles.xml'] = Buffer.from(buildStylesXml(), 'utf8');
    sheetMatches.forEach((sm, idx) => {
      let tgt = relMap[sm.rid];
      if (!tgt) return;
      if (tgt.startsWith('/')) tgt = tgt.slice(1);
      else if (!tgt.startsWith('xl/')) tgt = 'xl/' + tgt;
      if (!entries[tgt]) return;
      let xml = entries[tgt].toString('utf8');
      const spec = specs[idx] || { totals: false };
      const dim = xml.match(/<dimension ref="([^"]+)"/);
      let lastRow = 0;
      if (dim) {
        const end = (dim[1].split(':')[1] || dim[1]);
        const m = end.match(/[A-Z]+([0-9]+)/);
        if (m) lastRow = parseInt(m[1], 10);
      }
      const isIntVal = (inner) => {
        const v = inner.match(/<v>([^<]*)<\/v>/);
        if (!v) return false;
        const num = Number(v[1]);
        return Number.isFinite(num) && Number.isInteger(num);
      };
      xml = xml.replace(/<c\b([^>]*)>([\s\S]*?)<\/c>/g, (full, attrs, inner) => {
        const rm = attrs.match(/\br="([A-Z]+)([0-9]+)"/);
        if (!rm) return full;
        const col = colToIndex(rm[1]);
        const row = parseInt(rm[2], 10);
        const tm = attrs.match(/\bt="([^"]*)"/);
        const type = tm ? tm[1] : 'n';
        let s;
        if (row === 1) s = 1;
        else if (spec.totals && row === lastRow) {
          s = (type === 's') ? 7 : (isIntVal(inner) ? 6 : 5);
        } else {
          if (type === 's' || type === 'inlineStr') s = 4;
          else s = isIntVal(inner) ? 3 : 2;
        }
        const newAttrs = attrs.replace(/\bs="\d+"/g, '').trim();
        return '<c ' + newAttrs + ' s="' + s + '">' + inner + '</c>';
      });
      xml = xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/,
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>');
      entries[tgt] = Buffer.from(xml, 'utf8');
    });
    let newRels = relsXml;
    if (!alreadyHasStylesRel) {
      let maxNum = 0;
      Object.keys(relMap).forEach(id => {
        const n = parseInt(String(id).replace(/\D/g, ''), 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      });
      const styleRid = 'rId' + (maxNum + 1);
      newRels = relsXml.replace(/<\/Relationships>/,
        '  <Relationship Id="' + styleRid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    }
    entries['xl/_rels/workbook.xml.rels'] = Buffer.from(newRels, 'utf8');
    let ct = entries['[Content_Types].xml'].toString('utf8');
    if (!/styles\.xml/.test(ct)) {
      ct = ct.replace(/<\/Types>/,
        '  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
      entries['[Content_Types].xml'] = Buffer.from(ct, 'utf8');
    }
    return zipXlsx(entries);
  }

  router.get("/income/export", requireAuth, requireRole('admin'), async (req, res) => {
    const { start: reqStart, end: reqEnd } = req.query;
    const q = (sql, params = []) => new Promise((resolve, reject) =>
      db.all(sql, params, (e, r) => e ? reject(e) : resolve(r || [])));

    try {
      // 🆕 未提供 start/end 時，自動推算「盡可能涉及收入嘅全部資料」min/max，
      // 確保管理員匯入嘅過往月份資料一定會被納入報表（唔會因預設當月而變空白）
      let start = reqStart, end = reqEnd;
      if (!start || !end) {
        const span = await q(`SELECT MIN(c) AS mn, MAX(c) AS mx FROM (
          SELECT adjustment_date AS c FROM income_adjustments WHERE adjustment_date IS NOT NULL
          UNION ALL SELECT appointment_date FROM bookings WHERE appointment_date IS NOT NULL
          UNION ALL SELECT start_date FROM subscriptions WHERE start_date IS NOT NULL
          UNION ALL SELECT substr(paid_at,1,10) FROM payments WHERE paid_at IS NOT NULL
        )`);
        const mn = span && span[0] && span[0].mn;
        const mx = span && span[0] && span[0].mx;
        const now = new Date();
        const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0');
        const last = String(new Date(y, now.getMonth() + 1, 0).getDate()).padStart(2, '0');
        start = mn || `${y}-${m}-01`;
        end = mx || `${y}-${m}-${last}`;
      }

      const [
        adjustments, bookingRows, serviceStats, doctorStats, dayStats,
        subs, payments, couponUsage, memberCount,
      ] = await Promise.all([
        // ① 管理員匯入嘅收入調整
        q(`SELECT adjustment_date AS 日期, COALESCE(type,'service') AS 類別,
                  COALESCE(service_name,'') AS 描述, COALESCE(amount,0) AS 金額,
                  COALESCE(note,'') AS 備註, created_at AS 建立時間
           FROM income_adjustments
           WHERE adjustment_date >= ? AND adjustment_date <= ?
           ORDER BY adjustment_date ASC, id ASC`, [start, end]),
        // ② 預約明細（全部欄位）
        q(`SELECT b.id AS 預約編號, b.appointment_date AS 預約日期, b.appointment_time AS 時間,
                  b.status AS 狀態, u.member_no AS 會員編號, b.customer_name AS 客戶姓名,
                  b.customer_phone AS 客戶電話, b.customer_email AS 電郵, b.customer_age AS 年齡,
                  COALESCE(s.name,'') AS 服務, COALESCE(s.duration,0) AS 時長分鐘, COALESCE(s.price,0) AS 服務金額,
                  b.doctor_name AS 醫師, du.name AS 醫師帳戶, b.bed_type AS 床位類型, b.bed_number AS 床位編號,
                  COALESCE(b.lateness_minutes,0) AS 遲到分鐘, b.is_free AS 免費診症, b.notes AS 備註,
                  b.created_at AS 落單時間, b.updated_at AS 更新時間
           FROM bookings b
           LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN users u ON u.id = b.user_id
           LEFT JOIN users du ON du.id = b.doctor_user_id
           WHERE b.appointment_date >= ? AND b.appointment_date <= ?
           ORDER BY b.appointment_date ASC, b.appointment_time ASC, b.id ASC`, [start, end]),
        // ③ 按服務統計
        q(`SELECT COALESCE(s.name,'（未指定）') AS 服務, COUNT(*) AS 預約次數,
                  SUM(CASE WHEN b.status IN ('completed','visited') THEN 1 ELSE 0 END) AS 已完成次數,
                  SUM(CASE WHEN b.status = 'no-show' THEN 1 ELSE 0 END) AS 缺席次數,
                  SUM(CASE WHEN b.status = 'cancelled' THEN 1 ELSE 0 END) AS 取消次數,
                  ROUND(SUM(CASE WHEN b.status IN ('completed','visited') THEN COALESCE(s.price,0) ELSE 0 END),2) AS 完成金額
           FROM bookings b LEFT JOIN services s ON s.id = b.service_id
           WHERE b.appointment_date >= ? AND b.appointment_date <= ?
           GROUP BY COALESCE(s.name,'（未指定）')
           ORDER BY 完成金額 DESC`, [start, end]),
        // ④ 按醫師統計
        q(`SELECT COALESCE(b.doctor_name,'（未指定）') AS 醫師, COUNT(*) AS 預約次數,
                  SUM(CASE WHEN b.status IN ('completed','visited') THEN 1 ELSE 0 END) AS 已完成次數,
                  SUM(CASE WHEN b.status = 'no-show' THEN 1 ELSE 0 END) AS 缺席次數,
                  ROUND(SUM(CASE WHEN b.status IN ('completed','visited') THEN COALESCE(s.price,0) ELSE 0 END),2) AS 完成金額
           FROM bookings b LEFT JOIN services s ON s.id = b.service_id
           WHERE b.appointment_date >= ? AND b.appointment_date <= ?
           GROUP BY COALESCE(b.doctor_name,'（未指定）')
           ORDER BY 完成金額 DESC`, [start, end]),
        // ⑤ 按日期統計
        q(`SELECT b.appointment_date AS 日期, COUNT(*) AS 預約次數,
                  SUM(CASE WHEN b.status IN ('completed','visited') THEN 1 ELSE 0 END) AS 已完成次數,
                  SUM(CASE WHEN b.status = 'no-show' THEN 1 ELSE 0 END) AS 缺席次數,
                  SUM(CASE WHEN b.status = 'cancelled' THEN 1 ELSE 0 END) AS 取消次數,
                  ROUND(SUM(CASE WHEN b.status IN ('completed','visited') THEN COALESCE(s.price,0) ELSE 0 END),2) AS 完成金額
           FROM bookings b LEFT JOIN services s ON s.id = b.service_id
           WHERE b.appointment_date >= ? AND b.appointment_date <= ?
           GROUP BY b.appointment_date
           ORDER BY b.appointment_date ASC`, [start, end]),
        // ⑥ 會籍／訂閱
        q(`SELECT s.id AS 訂閱編號, u.member_no AS 會員編號, u.name AS 會員姓名, u.phone AS 電話,
                  s.tier AS 級別, u.family_plan AS 家庭計劃, s.status AS 狀態,
                  s.start_date AS 開始日, s.end_date AS 到期日
           FROM subscriptions s LEFT JOIN users u ON u.id = s.user_id
           WHERE (s.start_date <= ? AND s.end_date >= ?)
              OR (s.start_date >= ? AND s.start_date <= ?)
           ORDER BY s.start_date ASC`, [end, start, start, end]),
        // ⑦ 付款紀錄
        q(`SELECT p.id AS 付款編號, u.member_no AS 會員編號, u.name AS 會員姓名,
                  p.payment_method AS 付款方式, COALESCE(p.amount,0) AS 金額, p.status AS 狀態,
                  p.transaction_id AS 交易編號, p.paid_at AS 付款時間, COALESCE(p.note,'') AS 備註
           FROM payments p LEFT JOIN users u ON u.id = p.user_id
           WHERE (p.paid_at IS NULL) OR (substr(p.paid_at,1,10) >= ? AND substr(p.paid_at,1,10) <= ?)
           ORDER BY p.paid_at DESC, p.id DESC`, [start, end]),
        // ⑧ 社福券使用
        q(`SELECT uc.id, u.member_no AS 會員編號, u.name AS 會員姓名, uc.coupon_code AS 券密碼,
                  COALESCE(c.title,'') AS 券名稱, uc.free_total AS 總免費次數, uc.free_used AS 已用次數,
                  (uc.free_total - uc.free_used) AS 剩餘次數, uc.status AS 狀態,
                  uc.purchased_at AS 購買時間, uc.redeemed_at AS 啟用時間
           FROM user_coupons uc
           LEFT JOIN users u ON u.id = uc.user_id
           LEFT JOIN coupons c ON c.code = uc.coupon_code
           ORDER BY uc.id DESC
           LIMIT 500`),
        // ⑨ 會員總數
        q(`SELECT COUNT(*) AS c FROM users WHERE role='customer'`),
      ]);

      const adjTotal = (adjustments || []).reduce((s, r) => s + Number(r.金額 || 0), 0);
      const payTotal = (payments || []).filter(p => p.狀態 === 'paid' || p.狀態 === 'completed')
        .reduce((s, p) => s + Number(p.金額 || 0), 0);
      const bookingCompleted = (bookingRows || []).filter(b => ['completed', 'visited'].includes(b.狀態));
      const bookingTotal = bookingCompleted.reduce((s, b) => s + Number(b.服務金額 || 0), 0);
      const noShow = (bookingRows || []).filter(b => b.狀態 === 'no-show').length;
      const cancelled = (bookingRows || []).filter(b => b.狀態 === 'cancelled').length;
      const lateCount = (bookingRows || []).filter(b => Number(b.遲到分鐘 || 0) > 0).length;

      const summary = [
        { 項目: '報表期間', 數值: `${start} ~ ${end}` },
        { 項目: '匯出時間', 數值: new Date().toLocaleString('zh-HK') },
        { 項目: '會員總數', 數值: (memberCount[0] && memberCount[0].c) || 0 },
        { 項目: '預約總數', 數值: (bookingRows || []).length },
        { 項目: '已完成／已到訪', 數值: bookingCompleted.length },
        { 項目: '缺席', 數值: noShow },
        { 項目: '取消', 數值: cancelled },
        { 項目: '遲到記錄筆數', 數值: lateCount },
        { 項目: '預約服務金額（已完成）HK$', 數值: Number(bookingTotal.toFixed(2)) },
        { 項目: '收入調整總額 HK$', 數值: Number(adjTotal.toFixed(2)) },
        { 項目: '付款紀錄總額 HK$', 數值: Number(payTotal.toFixed(2)) },
        { 項目: '生效訂閱筆數', 數值: (subs || []).length },
        { 項目: '社福券持有筆數', 數值: (couponUsage || []).length },
      ];

      const wb = XLSX.utils.book_new();

      const thinBorder = () => ({
        top: { style: 'thin', color: { rgb: 'D0D5DD' } }, bottom: { style: 'thin', color: { rgb: 'D0D5DD' } },
        left: { style: 'thin', color: { rgb: 'D0D5DD' } }, right: { style: 'thin', color: { rgb: 'D0D5DD' } }
      });
      const isMoneyKey = (k) => /金額|總計|總|收入|金|費|款|amount|price/i.test(k);
      const isIntKey = (k) => /次數|人數|數|count|visited|no.show|cancel/i.test(k);

      const specs = [];

      const addSheet = (rows, name, opts = {}) => {
        const data = (rows && rows.length) ? rows : [{ 提示: '呢段期間冇資料' }];
        const ws = XLSX.utils.json_to_sheet(data);
        const keys = Object.keys(data[0] || {});
        ws['!cols'] = keys.map(k => ({
          wch: Math.min(42, Math.max(10, String(k).length * 2 + 4,
            ...data.slice(0, 80).map(r => String(r[k] == null ? '' : r[k]).length + 2)))
        }));
        const numCols = keys.map((k, ci) => ({
          ci, type: isMoneyKey(k) ? 'money' : isIntKey(k) ? 'int' : null
        })).filter(x => x.type);
        const doTotals = !!opts.totals && numCols.length > 0 && data.length > 1;
        if (doTotals) {
          const lastR = XLSX.utils.decode_range(ws['!ref']).e.r;
          const tr = lastR + 1;
          numCols.forEach(({ ci, type }) => {
            let sum = 0;
            data.forEach(r => { const v = Number(r[keys[ci]]); if (Number.isFinite(v)) sum += v; });
            sum = type === 'money' ? Number(sum.toFixed(2)) : Math.round(sum);
            ws[XLSX.utils.encode_cell({ r: tr, c: ci })] = { t: 'n', v: sum, z: type === 'money' ? '#,##0.00' : '#,##0' };
          });
          ws[XLSX.utils.encode_cell({ r: tr, c: 0 })] = { t: 's', v: '合計' };
          ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: tr, c: keys.length - 1 } });
        }
        XLSX.utils.book_append_sheet(wb, ws, name);
        specs.push({ totals: doTotals });
      };

      addSheet(summary, '總覽摘要');
      addSheet(adjustments, '收入明細', { totals: true });
      addSheet(bookingRows, '預約明細', { totals: true });
      addSheet(serviceStats, '按服務統計', { totals: true });
      addSheet(doctorStats, '按醫師統計', { totals: true });
      addSheet(dayStats, '按日期統計', { totals: true });
      addSheet(subs, '會籍訂閱');
      addSheet(payments, '付款紀錄', { totals: true });
      addSheet(couponUsage, '社福券使用');


      const raw = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const buf = styleXlsx(raw, specs);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=income-${start}-${end}.xlsx`);
      res.send(buf);
    } catch (e) {
      console.error('匯出收入報表失敗:', e);
      res.status(500).json({ error: '匯出失敗：' + (e.message || '') });
    }
  });

  // ==================== 特殊時間異常管理（紅字日） ====================

  // 取得所有異常設定（附醫師姓名）
  router.get("/exceptions", requireAuth, requireRole('admin'), (req, res) => {
    db.all(`
      SELECT e.*, u.name AS doctor_name
      FROM exceptions e LEFT JOIN users u ON u.id = e.doctor_user_id
      ORDER BY e.exception_date DESC, e.id DESC
    `, [], (err, rows) => {
      if (err) return serverError(res, err);
      res.json(rows || []);
    });
  });

  // 新增/更新異常（診所層級：依日期 upsert；醫師請假：依日期+醫師 upsert）
  router.post("/exceptions", requireAuth, requireRole('admin'), (req, res) => {
    const { exception_date, name, type, time_open, time_close, reason, doctor_user_id } = req.body || {};
    if (!exception_date || !name) {
      return res.status(400).json({ error: "日期與名稱必須填寫" });
    }
    const allowedTypes = ['full_day_closed', 'special_hours', 'red_day', 'doctor_leave', 'weather'];
    const excType = allowedTypes.includes(type) ? type : 'red_day';

    if (excType === 'doctor_leave') {
      if (!doctor_user_id) return res.status(400).json({ error: "醫師請假必須指定醫師" });
      db.get(
        "SELECT id FROM exceptions WHERE exception_date=? AND type='doctor_leave' AND doctor_user_id=?",
        [exception_date, doctor_user_id],
        (fErr, existing) => {
          if (fErr) return res.status(500).json({ error: fErr.message });
          if (existing) {
            db.run("UPDATE exceptions SET name=?, type=?, time_open=?, time_close=?, reason=? WHERE id=?",
              [name, excType, time_open || null, time_close || null, reason || null, existing.id],
              (uErr) => {
                if (uErr) return res.status(500).json({ error: uErr.message });
                res.json({ ok: true });
              });
          } else {
            db.run(
              `INSERT INTO exceptions (exception_date, name, type, time_open, time_close, reason, doctor_user_id, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [exception_date, name, excType, time_open || null, time_close || null, reason || null, doctor_user_id, req.user.id],
              (iErr) => {
                if (iErr) return res.status(500).json({ error: iErr.message });
                res.json({ ok: true });
              });
          }
        });
      return;
    }

    // 診所層級異常（doctor_user_id 為 NULL）
    db.get("SELECT id FROM exceptions WHERE exception_date=? AND doctor_user_id IS NULL", [exception_date], (fErr, existing) => {
      if (fErr) return res.status(500).json({ error: fErr.message });
      if (existing) {
        db.run("UPDATE exceptions SET name=?, type=?, time_open=?, time_close=?, reason=? WHERE id=?",
          [name, excType, time_open || null, time_close || null, reason || null, existing.id],
          (uErr) => {
            if (uErr) return res.status(500).json({ error: uErr.message });
            res.json({ ok: true });
          });
      } else {
        db.run(
          `INSERT INTO exceptions (exception_date, name, type, time_open, time_close, reason, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [exception_date, name, excType, time_open || null, time_close || null, reason || null, req.user.id],
          (iErr) => {
            if (iErr) return res.status(500).json({ error: iErr.message });
            res.json({ ok: true });
          });
      }
    });
  });

  // 🆕 醫師請假 / 天氣停診：自動過濾受影響預約 + 批量通知（Email / WhatsApp 可選）
  // POST /api/admin/exceptions/doctor-leave
  // type='doctor_leave'（預設，需 doctor_user_id）或 type='weather'（全診所，doctor_user_id 可免）
  router.post("/exceptions/doctor-leave", requireAuth, requireRole('admin'), async (req, res) => {
    const { type = 'doctor_leave', doctor_user_id, exception_date, reason, name, notifyEmail = false, notifyWhatsapp = true, cancelBookings = false, leaveType = 'personal' } = req.body || {};
    if (!exception_date) {
      return res.status(400).json({ error: "請指定日期" });
    }
    const excType = ['doctor_leave', 'weather'].includes(type) ? type : 'doctor_leave';
    if (excType === 'doctor_leave' && !doctor_user_id) {
      return res.status(400).json({ error: "請指定醫師" });
    }

    try {
      let doctor = null;
      if (excType === 'doctor_leave') {
        doctor = await new Promise((resolve) => {
          db.get("SELECT id, name, phone FROM users WHERE id=? AND role IN ('doctor','admin')", [doctor_user_id], (e, r) => resolve(r || null));
        });
        if (!doctor) return res.status(404).json({ error: "找不到該醫師帳號" });
      }

      // 1. 儲存異常
      if (excType === 'weather') {
        // 天氣停診：全診所閉診（upsert 同日期診所層級異常）
        await new Promise((resolve, reject) => {
          db.get("SELECT id FROM exceptions WHERE exception_date=? AND doctor_user_id IS NULL", [exception_date], (e, row) => {
            if (e) return reject(e);
            if (row) {
              db.run("UPDATE exceptions SET name=?, type='full_day_closed', reason=?, created_by=? WHERE id=?",
                [name || '天氣停診', reason || '天氣影響暫停營業', req.user.id, row.id], (e2) => e2 ? reject(e2) : resolve());
            } else {
              db.run(`INSERT INTO exceptions (exception_date, name, type, reason, created_by) VALUES (?,?,?,?,?)`,
                [exception_date, name || '天氣停診', 'full_day_closed', reason || '天氣影響暫停營業', req.user.id],
                (e2) => e2 ? reject(e2) : resolve());
            }
          });
        });
      } else {
        await new Promise((resolve, reject) => {
          db.get("SELECT id FROM exceptions WHERE exception_date=? AND type='doctor_leave' AND doctor_user_id=?",
            [exception_date, doctor_user_id], (e, row) => {
              if (e) return reject(e);
              if (row) {
                db.run("UPDATE exceptions SET name=?, reason=?, created_by=? WHERE id=?",
                  [name || `${doctor.name}請假`, reason || '', req.user.id, row.id], (e2) => e2 ? reject(e2) : resolve());
              } else {
                db.run(`INSERT INTO exceptions (exception_date, name, type, reason, doctor_user_id, created_by) VALUES (?,?,?,?,?,?)`,
                  [exception_date, name || `${doctor.name}請假`, 'doctor_leave', reason || '', doctor_user_id, req.user.id],
                  (e2) => e2 ? reject(e2) : resolve());
              }
            });
        });
      }

      // 2. 查詢受影響預約（醫師請假：該醫師當日；天氣：全診所當日）
      const activeStatuses = "('pending','confirmed','in-progress','in-treatment','visited','dispensing')";
      const affected = await new Promise((resolve, reject) => {
        const where = excType === 'weather'
          ? `b.appointment_date=? AND b.status IN ${activeStatuses}`
          : `b.appointment_date=? AND (b.doctor_user_id=? OR b.doctor_name=?) AND b.status IN ${activeStatuses}`;
        const params = excType === 'weather' ? [exception_date] : [exception_date, doctor_user_id, doctor.name];
        db.all(
          `SELECT b.*, s.name AS service_name FROM bookings b LEFT JOIN services s ON s.id=b.service_id
           WHERE ${where}
           ORDER BY b.appointment_time`,
          params,
          (e, rows) => e ? reject(e) : resolve(rows || [])
        );
      });

      // 3. 批量通知（依選項）
      const whatsappService = require('../services/whatsapp');
      const notifyResults = { whatsapp: 0, email: 0, failed: 0 };
      const clinicPhone = clinicSettings.getClinicPhone();
      const waUrl = clinicSettings.getWhatsappUrl();
      let messageText;
      if (excType === 'weather') {
        messageText = `【JR】通知：因天氣影響（${reason || '天氣惡劣'}），${exception_date} 全日暫停營業，您嘅預約需要改期。請致電 ${clinicPhone} 或登入系統重新預約，造成不便敬請原諒。`;
      } else {
        // 使用後台可自定義嘅「醫師請假通知」模板（病假 / 事假）：先致歉 → 說明醫師未能應診 → 提供診所聯絡方式
        const tmpl = await notificationScheduler.getDoctorLeaveTemplates();
        const body = leaveType === 'sick' ? tmpl.sick : tmpl.personal;
        messageText = notificationScheduler.renderDoctorLeaveTemplate(body, {
          doctorName: doctor ? doctor.name : (name || '主診醫師'),
          date: exception_date,
          clinicPhone,
          waUrl
        });
      }

      for (const b of affected) {
        // WhatsApp
        if (notifyWhatsapp && whatsappService.isConfigured() && b.customer_phone) {
          try {
            let phone = b.customer_phone;
            if (!phone.startsWith('+')) phone = '+852' + phone.replace(/^852/, '');
            const wa = await whatsappService.sendWhatsApp(phone, messageText);
            if (wa && wa.success) notifyResults.whatsapp++;
            else notifyResults.failed++;
          } catch (e) { notifyResults.failed++; }
        }
        // Email（Gmail 通知，管理員可於後台設定；需提供 emailService 及客戶電郵）
        if (notifyEmail && b.customer_email && global.__emailService && typeof global.__emailService.sendBookingCancellation === 'function') {
          try {
            await global.__emailService.sendBookingCancellation(b.customer_email, {
              customerName: b.customer_name,
              bookingId: b.id,
              serviceName: b.service_name,
              doctorName: doctor ? doctor.name : (b.doctor_name || ''),
              date: b.appointment_date,
              time: b.appointment_time,
              notes: excType === 'weather' ? `天氣停診：${reason || ''}` : `醫師請假：${reason || '休假'}`
            });
            notifyResults.email++;
          } catch (e) { notifyResults.failed++; }
        }

        // 寫入客人站内通知（唔依賴 WhatsApp，確保客人於門戶見到管理員輸入嘅內容）
        try {
          db.run(
            `INSERT INTO customer_notifications (user_id, phone, title, message, type, ref_date, is_read) VALUES (?,?,?,?,?,?,0)`,
            [
              b.user_id || null,
              b.customer_phone || null,
              excType === 'weather' ? '天氣停診通知' : (leaveType === 'sick' ? '醫師病假通知' : '醫師事假通知'),
              messageText,
              excType === 'weather' ? 'weather_close' : 'doctor_leave',
              exception_date
            ],
            () => {}
          );
        } catch (e) { console.error('寫入客人通知失敗:', e.message); }
      }

      // 3.1 系統自動聯絡診所：記錄內部通知 + 經 WhatsApp 通知診所（用診所自己嘅 WhatsApp 號碼），方便職員跟進受影響預約
      if (excType === 'doctor_leave' && affected.length) {
        try {
          const leaveLabel = leaveType === 'sick' ? '病假' : '事假';
          db.run(
            `INSERT INTO notification_logs (type, title, message, channel, status, created_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)`,
            ['clinic_internal', `${doctor ? doctor.name : (name || '醫師')} 請假跟進`, `【${leaveLabel}】${doctor ? doctor.name : ''} 醫師於 ${exception_date} 請假，共 ${affected.length} 筆預約受影響，請職員跟進安排第二位醫師 / 聯絡客人。`, 'internal', 'pending'],
            () => {}
          );
          if (whatsappService.isConfigured()) {
            const clinicWaDigits = clinicSettings.getWhatsappDigits();
            await whatsappService.sendWhatsApp('+852' + clinicWaDigits, `【JR 內部通知】${doctor ? doctor.name : ''}醫師於 ${exception_date} 因${leaveLabel}請假，共 ${affected.length} 筆預約受影響，請盡快跟進安排。`);
          }
        } catch (e) { console.error('診所內部通知失敗:', e.message); }
      }

      // 4. 可選：自動取消受影響預約
      let cancelled = 0;
      if (cancelBookings && affected.length) {
        await new Promise((resolve, reject) => {
          const where = excType === 'weather'
            ? `appointment_date=? AND status IN ${activeStatuses}`
            : `appointment_date=? AND (doctor_user_id=? OR doctor_name=?) AND status IN ${activeStatuses}`;
          const params = excType === 'weather' ? [exception_date] : [exception_date, doctor_user_id, doctor.name];
          db.run(
            `UPDATE bookings SET status='cancelled', notes=COALESCE(notes,'') || ' [${excType === 'weather' ? '天氣停診' : '醫師請假'}自動取消]', updated_at=CURRENT_TIMESTAMP
             WHERE ${where}`,
            params,
            (e) => e ? reject(e) : resolve()
          );
        });
        cancelled = affected.length;
      }

      res.json({
        ok: true,
        type: excType,
        doctor: doctor ? { id: doctor.id, name: doctor.name } : null,
        exception_date,
        affected_count: affected.length,
        affected: affected.map(b => ({
          id: b.id, customer_name: b.customer_name, customer_phone: b.customer_phone,
          customer_email: b.customer_email, service_name: b.service_name,
          appointment_time: b.appointment_time, status: b.status
        })),
        notified: notifyResults,
        cancelled
      });
    } catch (e) {
      console.error('醫師請假處理失敗:', e);
      res.status(500).json({ error: '處理失敗：' + (e.message || '') });
    }
  });

  // ==================== 🩺 醫師自助排程／請假 ====================

  // GET /api/admin/doctor/my-leaves — 醫師查看即將請假日子（管理員／醫師可代查）
  router.get("/doctor/my-leaves", requireAuth, requireRole('doctor', 'admin'), (req, res) => {
    const targetId = (req.query.doctorUserId && ['admin', 'doctor'].includes(req.user.role)) ? Number(req.query.doctorUserId) : req.user.id;
    const todayStr = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD（本地時區）
    db.all(
      `SELECT e.*, u.name AS doctor_name, cu.name AS cover_doctor_name FROM exceptions e
       LEFT JOIN users u ON e.doctor_user_id = u.id
       LEFT JOIN users cu ON e.reassigned_to = cu.id
       WHERE e.type='doctor_leave' AND e.doctor_user_id=? AND e.exception_date >= ?
       ORDER BY e.exception_date ASC`,
      [targetId, todayStr],
      (err, rows) => {
        if (err) return serverError(res, err);
        res.json({ ok: true, data: rows || [] });
      }
    );
  });

  // POST /api/admin/doctor/my-leave — 醫師申請請假（預設自己，可代其他醫師請假；自動通知受影響客戶，可選取消預約）
  router.post("/doctor/my-leave", requireAuth, requireRole('doctor', 'admin'), async (req, res) => {
    const {
      exception_date, reason, time_open, time_close, reassigned_to, leave_type,
      notify_customer = true, doctorUserId: reqDoctorUserId, clinicWide
    } = req.body || {};
    const lvType = leave_type === 'personal' ? 'personal' : 'sick';
    const actorId = req.user.id;
    const isClinic = !!clinicWide && req.user.role === 'admin';
    // 🔒 醫師只可為自己請假；只有 admin 先可代他人 / 全診所
    const doctorUserId = isClinic ? null
      : (req.user.role === 'admin' && reqDoctorUserId)
        ? Number(reqDoctorUserId)
        : req.user.id;
    if (!exception_date || !/^\d{4}-\d{2}-\d{2}$/.test(exception_date)) {
      return res.status(400).json({ error: '請選擇請假日期' });
    }
    const todayStr = new Date().toLocaleDateString('sv-SE');
    if (exception_date < todayStr) {
      return res.status(400).json({ error: '請假日期不可以係過去日子' });
    }
    // ① 重複守衛：同一醫師（或全診所）同一日只可以有一筆生效中（非 rejected）請假
    {
      const dupKey = doctorUserId == null ? -999 : doctorUserId;
      const conflict = await new Promise((resolve, reject) => db.get(
        `SELECT id, status FROM exceptions WHERE exception_date=? AND type='doctor_leave' AND (doctor_user_id IS NULL OR doctor_user_id=?) ORDER BY status='approved' DESC, id DESC LIMIT 1`,
        [exception_date, dupKey], (e, r) => e ? reject(e) : resolve(r || null)));
      if (conflict && conflict.status === 'approved') {
        return res.status(409).json({ error: isClinic
          ? `該日已經有批核中嘅全診所／醫師請假，請先取消再提交`
          : `你已經喺 ${exception_date} 有已批核嘅請假，請先取消再提交`, conflict });
      }
    }
    const partial = !!(time_open && time_close);
    if (partial && (!/^\d{2}:\d{2}$/.test(time_open) || !/^\d{2}:\d{2}$/.test(time_close) || time_open >= time_close)) {
      return res.status(400).json({ error: '請假時段格式無效（需 HH:MM 且 開始 < 結束）' });
    }
    let coverDoc = null;
    if (reassigned_to) {
      coverDoc = await new Promise((resolve) => {
        db.get("SELECT id, name FROM users WHERE id=? AND role='doctor'", [Number(reassigned_to)], (e, r) => resolve(r || null));
      });
      if (!coverDoc) return res.status(400).json({ error: '揀嘅補位醫師唔存在' });
    }

    try {
      const doctor = isClinic ? null : await new Promise((resolve) => {
        db.get("SELECT id, name, role FROM users WHERE id=? AND role='doctor'", [doctorUserId], (e, r) => resolve(r || null));
      });
      if (!isClinic && !doctor) {
        if (req.user.role === 'admin' && !reqDoctorUserId) {
          return res.status(400).json({ error: '管理員申請非全診所請假時，請指定 doctorUserId，或設定 clinicWide=true 申請全診所休診' });
        }
        return res.status(404).json({ error: '找不到醫師帳戶' });
      }

      // 受影響預約（俾醫師/管理員先知範圍；pending 階段未生效）
      const activeStatuses = "('pending','confirmed','in-progress','in-treatment','visited','dispensing')";
      const timeFilterSql = partial ? ` AND b.appointment_time >= ? AND b.appointment_time < ?` : '';
      const timeParams = partial ? [time_open, time_close] : [];
      const affected = await new Promise((resolve, reject) => {
        const where = isClinic
          ? `b.appointment_date=? AND b.status IN ${activeStatuses}`
          : `b.appointment_date=? AND (b.doctor_user_id=? OR b.doctor_name=?) AND b.status IN ${activeStatuses}`;
        const params = isClinic ? [exception_date, ...timeParams] : [exception_date, doctorUserId, doctor ? doctor.name : '', ...timeParams];
        db.all(
          `SELECT b.id, b.customer_name, b.appointment_time, s.name AS service_name FROM bookings b LEFT JOIN services s ON s.id=b.service_id
           WHERE ${where} ${timeFilterSql}
           ORDER BY b.appointment_time`,
          params,
          (e, rows) => e ? reject(e) : resolve(rows || [])
        );
      });

      // 建立 pending 請假（未生效：唔改 slot / 唔通知客人 / 唔轉嫁）
      const excId = await new Promise((resolve, reject) => {
        const dupKey = doctorUserId == null ? -999 : doctorUserId;
        db.get("SELECT id, status FROM exceptions WHERE exception_date=? AND type='doctor_leave' AND (doctor_user_id IS NULL OR doctor_user_id=?)",
          [exception_date, dupKey], (e, row) => {
            if (e) return reject(e);
            if (row) {
              db.run("UPDATE exceptions SET reason=?, time_open=?, time_close=?, reassigned_to=?, notify_customer=?, created_by=?, status='pending', approved_by=NULL, approved_at=NULL WHERE id=?",
                [reason || '', partial ? time_open : null, partial ? time_close : null, coverDoc ? coverDoc.id : null, notify_customer ? 1 : 0, actorId, row.id],
                (e2) => e2 ? reject(e2) : resolve(row.id));
            } else {
              db.run(`INSERT INTO exceptions (exception_date, name, type, reason, doctor_user_id, time_open, time_close, reassigned_to, notify_customer, leave_type, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
                [exception_date, isClinic ? '全診所休診' : `${doctor.name}請假`, 'doctor_leave', reason || '', doctorUserId, partial ? time_open : null, partial ? time_close : null, coverDoc ? coverDoc.id : null, notify_customer ? 1 : 0, lvType, 'pending', actorId],
                function (e2) { e2 ? reject(e2) : resolve(this.lastID); });
            }
          });
      });

      // 通知管理員批核（WA 如配置）
      const whatsappService = require('../services/whatsapp');
      const adminMsg = isClinic
        ? `【JR】全診所休診申請：${exception_date}${partial ? ` ${time_open}-${time_close}` : ''}（${reason || '休息'}），請登入後台批核。`
        : `【JR】${doctor.name}醫師申請 ${exception_date}${partial ? ` ${time_open}-${time_close}` : ''} 請假（${reason || '休息'}），請登入後台批核。${coverDoc ? `已揀補位：${coverDoc.name}。` : ''}`;
      if (whatsappService.isConfigured()) {
        const admins = await new Promise((resolve) => db.all("SELECT phone, whatsapp_enabled FROM users WHERE role='admin' AND phone IS NOT NULL AND phone<>''", [], (e, r) => resolve(r || [])));
        for (const a of admins) {
          if (a.whatsapp_enabled === 0) continue; // 🔕 尊重管理員個人 WhatsApp 總開關
          try {
            let phone = String(a.phone);
            if (!phone.startsWith('+')) phone = '+852' + phone.replace(/^852/, '');
            await whatsappService.sendWhatsApp(phone, adminMsg);
          } catch (e) { /* ignore */ }
        }
      }

      res.json({
        ok: true,
        pending: true,
        clinic: isClinic,
        exception_id: excId,
        exception_date,
        partial,
        time_open: partial ? time_open : null,
        time_close: partial ? time_close : null,
        affected_count: affected.length,
        affected: affected.map(b => ({ id: b.id, customer_name: b.customer_name, service_name: b.service_name, appointment_time: b.appointment_time })),
        reassigned_to: coverDoc ? coverDoc.id : null,
        notify_customer: !!notify_customer,
        message: isClinic
          ? '已提交全診所休診，待管理員批核。批核後會關閉所有醫師嗰日時段並通知客人。'
          : '已提交，待管理員批核。批核後會通知客人' + (coverDoc ? `並轉嫁畀 ${coverDoc.name} 醫師` : '') + '。'
      });
    } catch (e) {
      console.error('醫師自助請假失敗:', e);
      res.status(500).json({ error: '處理失敗：' + (e.message || '') });
    }
  });

  // POST /api/admin/doctor/my-leaves/:id/approve — 管理員批核（生效：閂 slot、通知客人、轉嫁補位）
  // 醫師請假通知模板（病假 / 事假）— 管理員可自定義 send 訊息內容
  router.get('/notification/doctor-leave-templates', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const tmpl = await notificationScheduler.getDoctorLeaveTemplates();
      res.json(tmpl);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/notification/doctor-leave-templates', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const { sick, personal } = req.body || {};
      const current = await notificationScheduler.getDoctorLeaveTemplates();
      await notificationScheduler.updateSettings({
        doctor_leave_sick_template: (typeof sick === 'string' && sick.trim()) ? sick : current.sick,
        doctor_leave_personal_template: (typeof personal === 'string' && personal.trim()) ? personal : current.personal
      });
      res.json({ success: true, templates: await notificationScheduler.getDoctorLeaveTemplates() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/doctor/my-leaves/:id/approve", requireAuth, requireRole('admin'), async (req, res) => {
    const id = Number(req.params.id);
    const whatsappService = require('../services/whatsapp');
    try {
      const exc = await new Promise((resolve, reject) => db.get("SELECT * FROM exceptions WHERE id=? AND type='doctor_leave'", [id], (e, r) => e ? reject(e) : resolve(r || null)));
      if (!exc) return res.status(404).json({ error: '找不到該請假記錄' });
      if (exc.status === 'approved') return res.status(400).json({ error: '已經批核過' });
      const isClinic = !exc.doctor_user_id;
      const doctor = isClinic ? null : await new Promise((resolve) => db.get("SELECT id, name FROM users WHERE id=?", [exc.doctor_user_id], (e, r) => resolve(r || null)));
      // ⚠️ 關鍵映射：exceptions.doctor_user_id 係 users.id，但 doctor_time_slots.doctor_id 存嘅係 doctors.id
      const docRow = isClinic ? null : await new Promise((resolve) => db.get("SELECT id FROM doctors WHERE user_id=?", [exc.doctor_user_id], (e, r) => resolve(r || null)));
      const doctorSlotId = docRow ? docRow.id : exc.doctor_user_id;
      const partial = !!exc.time_open && !!exc.time_close;
      const activeStatuses = "('pending','confirmed','in-progress','in-treatment','visited','dispensing')";
      const timeFilterSql = partial ? ` AND b.appointment_time >= ? AND b.appointment_time < ?` : '';
      const timeParams = partial ? [exc.time_open, exc.time_close] : [];
      const affected = await new Promise((resolve, reject) => {
        const where = isClinic
          ? `b.appointment_date=? AND b.status IN ${activeStatuses}`
          : `b.appointment_date=? AND (b.doctor_user_id=? OR b.doctor_name=?) AND b.status IN ${activeStatuses}`;
        const params = isClinic ? [exc.exception_date, ...timeParams] : [exc.exception_date, exc.doctor_user_id, doctor ? doctor.name : '', ...timeParams];
        db.all(
          `SELECT b.*, s.name AS service_name FROM bookings b LEFT JOIN services s ON s.id=b.service_id
           WHERE ${where} ${timeFilterSql}
           ORDER BY b.appointment_time`,
          params,
          (e, rows) => e ? reject(e) : resolve(rows || [])
        );
      });

      // 1. 閂 slot（令網格反映 + availability 一致）
      const slotFilterSql = partial ? ` AND time >= ? AND time < ?` : '';
      const slotParams = partial ? [exc.time_open, exc.time_close] : [];
      await new Promise((resolve, reject) => {
        if (isClinic) {
          db.run(`UPDATE doctor_time_slots SET status='leave', is_available=0, updated_at=CURRENT_TIMESTAMP WHERE date=? ${slotFilterSql}`,
            [exc.exception_date, ...slotParams], (e) => e ? reject(e) : resolve());
        } else {
          db.run(`UPDATE doctor_time_slots SET status='leave', is_available=0, updated_at=CURRENT_TIMESTAMP WHERE doctor_id=? AND date=? ${slotFilterSql}`,
            [doctorSlotId, exc.exception_date, ...slotParams], (e) => e ? reject(e) : resolve());
        }
      });

      // 2. 通知客人（醫師勾選先）
      let notified = 0;
      const notifyResults = { whatsapp: 0, failed: 0 };
      if (exc.notify_customer) {
        const clinicPhone = clinicSettings.getClinicPhone();
        const waUrl = clinicSettings.getWhatsappUrl();
        const whenTxt = partial ? ` ${exc.time_open}-${exc.time_close}` : '';
        const lvLabel = { sick: '病假', personal: '事假', other: '假' }[exc.leave_type] || '假';
        const contactTxt = `如有疑問請致電診所 ${clinicPhone} 或 WhatsApp ${waUrl} 聯絡。`;
        const msg = isClinic
          ? `【JR】通知：診所於 ${exc.exception_date}${whenTxt} 全診所休診（${exc.reason || '休息'}），您的預約唔使改期，我哋會為您安排第二位醫師跟進。${contactTxt}麻煩回覆「OK」確認，我哋會盡快同您聯絡。不便之處，敬請原諒。`
          : `【JR】通知：${(doctor ? doctor.name : '該')}醫師於 ${exc.exception_date}${whenTxt} 請${lvLabel}（${exc.reason || '休息'}），您的預約唔使改期，我哋會為您安排第二位醫師跟進。${contactTxt}麻煩回覆「OK」確認，我哋會盡快同您聯絡。不便之處，敬請原諒。`;
        for (const b of affected) {
          if (whatsappService.isConfigured() && b.customer_phone) {
            try {
              let phone = String(b.customer_phone);
              if (!phone.startsWith('+')) phone = '+852' + phone.replace(/^852/, '');
              const wa = await whatsappService.sendWhatsApp(phone, msg);
              if (wa && wa.success) notifyResults.whatsapp++; else notifyResults.failed++;
            } catch (e) { notifyResults.failed++; }
          }
        }
        notified = 1;
      }

      // 3. 標記受影響預約為「待安排第二位醫師」（唔自動轉；等客人 OK 後由我哋手動安排）
      //    —— 個別醫師請假保留原本 doctor_user_id，只標 needs_arrange；俾管理員/員工稍後用手動補位安排。
      let needsArrangeCount = 0;
      for (const b of affected) {
        await new Promise((resolve, reject) => {
          db.run("UPDATE bookings SET reassignment_status='needs_arrange', updated_at=CURRENT_TIMESTAMP WHERE id=?", [b.id], (e) => e ? reject(e) : resolve());
        });
        needsArrangeCount++;
      }

      await new Promise((resolve, reject) => {
        db.run("UPDATE exceptions SET status='approved', approved_by=?, approved_at=?, notified=? WHERE id=?",
          [req.user.id, new Date().toISOString(), notified, id], (e) => e ? reject(e) : resolve());
      });

      // 🔗 同步 HR 考勤請假（leave_requests），避免兩套請假系統報表矛盾
      if (exc && exc.doctor_user_id && exc.exception_date) {
        try {
          const docUser = await new Promise((resolve) => {
            db.get("SELECT id, name, role FROM users WHERE id=?", [exc.doctor_user_id], (e, r) => resolve(r || null));
          });
          if (docUser) {
            const existing = await new Promise((resolve) => {
              db.get(
                `SELECT id FROM leave_requests
                 WHERE user_id=? AND start_date=? AND end_date=? AND status!='rejected' LIMIT 1`,
                [exc.doctor_user_id, exc.exception_date, exc.exception_date],
                (e, r) => resolve(r || null)
              );
            });
            if (!existing) {
              await new Promise((resolve) => {
                db.run(
                  `INSERT INTO leave_requests (user_id, name, role, leave_type, start_date, end_date, reason, status, reviewed_by, reviewed_at, reviewed_note)
                   VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?)`,
                  [docUser.id, docUser.name, docUser.role || 'doctor', exc.leave_type || 'other', exc.exception_date, exc.exception_date,
                   exc.reason || '醫師排程請假', 'approved', req.user.id, '自動同步自排程請假 doctor_leave#' + id],
                  () => resolve()
                );
              });
            }
          }
        } catch (syncErr) {
          console.error('同步 leave_requests 失敗:', syncErr.message);
        }
      }

      res.json({ ok: true, status: 'approved', clinic: isClinic, affected_count: affected.length, notified: notifyResults, needs_arrange_count: needsArrangeCount, reassigned_to: exc.reassigned_to });
    } catch (e) {
      console.error('批核請假失敗:', e);
      res.status(500).json({ error: '處理失敗：' + (e.message || '') });
    }
  });

  // POST /api/admin/doctor/my-leaves/:id/reject — 管理員拒絕
  router.post("/doctor/my-leaves/:id/reject", requireAuth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    db.get("SELECT * FROM exceptions WHERE id=? AND type='doctor_leave'", [id], (err, exc) => {
      if (err) return serverError(res, err);
      if (!exc) return res.status(404).json({ error: '找不到該請假記錄' });
      db.run("UPDATE exceptions SET status='rejected', approved_by=?, approved_at=? WHERE id=?", [req.user.id, new Date().toISOString(), id], (e2) => {
        if (e2) return res.status(500).json({ error: e2.message });
        res.json({ ok: true, status: 'rejected' });
      });
    });
  });

  // DELETE /api/admin/doctor/my-leaves/:id — 取消未來嘅請假（回復應診；管理員／醫師）
  router.delete("/doctor/my-leaves/:id", requireAuth, requireRole('doctor', 'admin'), (req, res) => {
    const id = Number(req.params.id);
    const todayStr = new Date().toLocaleDateString('sv-SE');
    db.get("SELECT * FROM exceptions WHERE id=? AND type='doctor_leave'", [id], (err, exc) => {
      if (err) return serverError(res, err);
      if (!exc) return res.status(404).json({ error: '找不到該請假記錄' });
      // 🔒 醫師只可取消自己嘅請假（admin 不限）
      if (req.user.role !== 'admin' && exc.doctor_user_id && Number(exc.doctor_user_id) !== Number(req.user.id)) {
        return res.status(403).json({ error: '只可以取消自己嘅請假' });
      }
      // 非管理員唔可以刪過去嘅請假
      if (req.user.role !== 'admin' && exc.exception_date < todayStr) {
        return res.status(400).json({ error: '過去嘅請假記錄不可以刪除' });
      }
      // 只有已批核（已閂 slot）嘅請假先要回復 slot；pending 仲未生效，唔使恢復
      const finish = () => db.run("DELETE FROM exceptions WHERE id=?", [id], (e3) => {
        if (e3) return res.status(500).json({ error: e3.message });
        res.json({ ok: true, message: `已取消 ${exc.exception_date} 嘅請假，該時段恢復接受預約` });
      });
      if (exc.status !== 'approved') return finish();
      const partial = !!exc.time_open && !!exc.time_close;
      const slotSql = partial ? ` AND time >= ? AND time < ?` : '';
      const slotParams = partial ? [exc.time_open, exc.time_close] : [];
      if (!exc.doctor_user_id) {
        // 診所級：恢復所有醫師嗰日時段 + 重設受影響預約嘅待安排標記
        db.run(`UPDATE bookings SET reassignment_status=NULL, updated_at=CURRENT_TIMESTAMP WHERE appointment_date=? AND reassignment_status='needs_arrange'`,
          [exc.exception_date], (eR) => {
          if (eR) console.error('重置 reassignment_status 失敗(clinic):', eR.message);
          db.run(`UPDATE doctor_time_slots SET status='open', is_available=1, updated_at=CURRENT_TIMESTAMP WHERE date=? ${slotSql}`,
            [exc.exception_date, ...slotParams], (e2) => {
            if (e2) return res.status(500).json({ error: e2.message });
            finish();
          });
        });
      } else {
        // ⚠️ doctor_user_id(users.id) → doctors.id 映射，先查 doctors 表
        db.get("SELECT id FROM doctors WHERE user_id=?", [exc.doctor_user_id], (e1, docRow) => {
          const doctorSlotId = docRow ? docRow.id : exc.doctor_user_id;
          db.run(`UPDATE bookings SET reassignment_status=NULL, updated_at=CURRENT_TIMESTAMP WHERE appointment_date=? AND doctor_user_id=? AND reassignment_status='needs_arrange'`,
            [exc.exception_date, exc.doctor_user_id], (eR) => {
            if (eR) console.error('重置 reassignment_status 失敗(individual):', eR.message);
            db.run(`UPDATE doctor_time_slots SET status='open', is_available=1, updated_at=CURRENT_TIMESTAMP WHERE doctor_id=? AND date=? ${slotSql}`,
              [doctorSlotId, exc.exception_date, ...slotParams], (e2) => {
              if (e2) return res.status(500).json({ error: e2.message });
              finish();
            });
          });
        });
      }
    });
  });

  // PATCH /api/admin/doctor/my-leaves/:id — 管理員／員工指定補位醫師
  //   · pending  ：只記錄 reassigned_to / notify_customer（批核時唔會自動轉，等客人 OK 後先安排）
  //   · approved ：手動安排第二位醫師 —— 將該請假下「待安排」嘅預約轉嫁去揀定嘅補位醫師
  router.patch("/doctor/my-leaves/:id", requireAuth, requireRole('admin', 'staff'), async (req, res) => {
    const id = Number(req.params.id);
    const { reassigned_to, notify_customer } = req.body || {};
    const whatsappService = require('../services/whatsapp');
    try {
      const exc = await new Promise((resolve, reject) => db.get(
        "SELECT id, status, doctor_user_id, exception_date, time_open, time_close FROM exceptions WHERE id=? AND type='doctor_leave'", [id], (e, r) => e ? reject(e) : resolve(r)));
      if (!exc) return res.status(404).json({ error: '找不到該請假記錄' });
      if (exc.status !== 'pending' && exc.status !== 'approved') {
        return res.status(400).json({ error: '只有待批核或已批核（待安排）嘅請假可以指定補位醫師（已拒絕請先取消再改）' });
      }
      const isClinic = !exc.doctor_user_id;
      const sets = []; const params = [];
      if (reassigned_to !== undefined) {
        const coverId = reassigned_to ? Number(reassigned_to) : null;
        if (coverId) {
          // 唔可以係請假緊嘅醫師本人（診所級 doctor_user_id 為 NULL，無此限制）
          if (exc.doctor_user_id && coverId === Number(exc.doctor_user_id)) {
            return res.status(400).json({ error: '補位醫師唔可以係請假緊嘅醫師本人' });
          }
          const coverDoc = await new Promise((resolve, reject) => db.get(
            "SELECT id, name FROM users WHERE id=? AND role='doctor'", [coverId], (e, r) => e ? reject(e) : resolve(r || null)));
          if (!coverDoc) return res.status(400).json({ error: '補位醫師無效' });
          sets.push("reassigned_to=?"); params.push(coverId);
        } else {
          sets.push("reassigned_to=NULL");
        }
      }
      if (notify_customer !== undefined) { sets.push("notify_customer=?"); params.push(notify_customer ? 1 : 0); }

      // 已批核 → 實際轉嫁「待安排」預約去補位醫師（手動安排第二位）
      let reassignedCount = 0, skippedCount = 0;
      const coverIssues = [];
      if (exc.status === 'approved' && reassigned_to !== undefined && !isClinic) {
        const coverId = reassigned_to ? Number(reassigned_to) : null;
        if (coverId) {
          const coverDoc = await new Promise((resolve, reject) => db.get("SELECT id, name, phone FROM users WHERE id=? AND role='doctor'", [coverId], (e, r) => e ? reject(e) : resolve(r || null)));
          const coverRow = coverDoc ? await new Promise((resolve) => db.get("SELECT id FROM doctors WHERE user_id=?", [coverDoc.id], (e, r) => resolve(r || null))) : null;
          const coverSlotId = coverRow ? coverRow.id : null;
          if (coverDoc && coverSlotId) {
            const activeStatuses = "('pending','confirmed','in-progress','in-treatment','visited','dispensing')";
            const bookingsToReassign = await new Promise((resolve, reject) => db.all(
              `SELECT b.* FROM bookings b WHERE b.appointment_date=? AND b.doctor_user_id=? AND b.reassignment_status='needs_arrange' AND b.status IN ${activeStatuses}`,
              [exc.exception_date, exc.doctor_user_id], (e, rows) => e ? reject(e) : resolve(rows || [])));
            for (const b of bookingsToReassign) {
              const slot = await new Promise((resolve) => db.get(
                `SELECT max_capacity, status, is_available FROM doctor_time_slots WHERE doctor_id=? AND date=? AND time=?`,
                [coverSlotId, exc.exception_date, b.appointment_time], (e, r) => resolve(r || null)));
              let canTake = !!slot && slot.status === 'open' && slot.is_available === 1;
              if (canTake) {
                const cap = (slot.max_capacity || 1);
                const used = await new Promise((resolve) => db.get(
                  `SELECT COUNT(*) AS c FROM bookings WHERE appointment_date=? AND appointment_time=? AND doctor_user_id=? AND status IN ${activeStatuses}`,
                  [exc.exception_date, b.appointment_time, coverDoc.id], (e, r) => resolve(r ? r.c : 0)));
                if (used >= cap) canTake = false;
              }
              if (canTake) {
                await new Promise((resolve, reject) => db.run(
                  `UPDATE bookings SET doctor_user_id=?, doctor_name=?, reassignment_status='arranged', notes=COALESCE(notes,'') || ? , updated_at=CURRENT_TIMESTAMP WHERE id=?`,
                  [coverDoc.id, coverDoc.name, ` [醫師請假轉嫁至 ${coverDoc.name} 醫師]`, b.id], (e) => e ? reject(e) : resolve()));
                reassignedCount++;
                if (whatsappService.isConfigured() && b.customer_phone) {
                  try {
                    let phone = String(b.customer_phone);
                    if (!phone.startsWith('+')) phone = '+852' + phone.replace(/^852/, '');
                    await whatsappService.sendWhatsApp(phone, `【JR】通知：您於 ${exc.exception_date} ${b.appointment_time} 嘅預約，我哋已為您安排 ${coverDoc.name} 醫師跟進（唔使改期）。唔使額外操作，多謝惠顧。`);
                  } catch (e2) { /* ignore */ }
                }
              } else {
                skippedCount++;
                coverIssues.push({ booking_id: b.id, time: b.appointment_time, customer: b.customer_name });
              }
            }
            if (whatsappService.isConfigured() && coverDoc.phone && reassignedCount) {
              try {
                let phone = String(coverDoc.phone);
                if (!phone.startsWith('+')) phone = '+852' + phone.replace(/^852/, '');
                await whatsappService.sendWhatsApp(phone, `【JR】${exc.exception_date} 有醫師請假，以下 ${reassignedCount} 個預約已安排畀你跟進，請登入系統查看。`);
              } catch (e2) { /* ignore */ }
            }
          }
        }
      }

      if (!sets.length && reassignedCount === 0 && skippedCount === 0) {
        return res.status(400).json({ error: '冇嘢要更新' });
      }
      if (sets.length) {
        await new Promise((resolve, reject) => db.run(`UPDATE exceptions SET ${sets.join(', ')} WHERE id=?`, [...params, id], (e) => e ? reject(e) : resolve()));
      }
      res.json({ ok: true, id, status: exc.status, reassigned_to: reassigned_to ? Number(reassigned_to) : null, notify_customer, reassigned_count: reassignedCount, skipped_count: skippedCount, cover_issues: coverIssues });
    } catch (e) { serverError(res, e); }
  });

  // GET /api/admin/doctor/leaves-range — 全部醫師請假（醫師睇 coverage / 管理員及員工檢視批核）
  router.get("/doctor/leaves-range", requireAuth, requireRole('doctor', 'admin', 'staff'), (req, res) => {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: '需要 start 同 end' });
    db.all(
      `SELECT e.id, e.exception_date, e.doctor_user_id, u.name AS doctor_name,
              e.time_open, e.time_close, e.reason, e.notified, e.notified_at, e.reassigned_to,
              e.status, e.notify_customer, e.approved_by, e.approved_at,
              cu.name AS cover_doctor_name, au.name AS approved_by_name, e.created_at,
              (SELECT COUNT(*) FROM bookings b WHERE b.appointment_date = e.exception_date AND b.reassignment_status='needs_arrange' AND (e.doctor_user_id IS NULL OR b.doctor_user_id = e.doctor_user_id)) AS needs_arrange_count
       FROM exceptions e
       LEFT JOIN users u ON e.doctor_user_id = u.id
       LEFT JOIN users cu ON e.reassigned_to = cu.id
       LEFT JOIN users au ON e.approved_by = au.id
       WHERE e.type='doctor_leave' AND e.exception_date >= ? AND e.exception_date <= ?
       ORDER BY e.exception_date ASC, u.name ASC`,
      [start, end],
      (err, rows) => {
        if (err) return serverError(res, err);
        res.json({ ok: true, data: rows || [] });
      }
    );
  });

  // 🆕 初體驗用戶申請記錄（管理員查看全部：預約中 / 完成 / 就診中）
  // GET /api/admin/trial-bookings
  router.get("/trial-bookings", requireAuth, requireRole('admin'), (req, res) => {
    const sql = `
      SELECT b.id, b.customer_name, b.customer_name_en, b.customer_phone, b.customer_age,
             b.appointment_date, b.appointment_time, b.status, b.notes, b.created_at,
             b.user_id, u.username, u.membership_tier, s.name AS service_name, s.price
      FROM bookings b
      LEFT JOIN users u ON u.id = b.user_id
      LEFT JOIN services s ON s.id = b.service_id
      WHERE b.service_id = 'S1'
      ORDER BY b.appointment_date DESC, b.appointment_time DESC
      LIMIT 500
    `;
    db.all(sql, [], (err, rows) => {
      if (err) return serverError(res, err);
      const statusLabel = {
        'pending': '待確認', 'confirmed': '預約中', 'in-progress': '就診中',
        'in-treatment': '治療中', 'visited': '已到訪', 'dispensing': '配藥中',
        'completed': '完成', 'cancelled': '已取消', 'no-show': '未到訪'
      };
      const data = (rows || []).map(r => ({ ...r, status_label: statusLabel[r.status] || r.status }));
      const summary = {
        total: data.length,
        booking: data.filter(r => ['pending', 'confirmed'].includes(r.status)).length,
        in_clinic: data.filter(r => ['in-progress', 'in-treatment', 'visited', 'dispensing'].includes(r.status)).length,
        completed: data.filter(r => r.status === 'completed').length,
        cancelled: data.filter(r => ['cancelled', 'no-show'].includes(r.status)).length
      };
      res.json({ data, summary });
    });
  });

  // 刪除異常
  router.delete("/exceptions/:id", requireAuth, requireRole('admin'), (req, res) => {
    db.run("DELETE FROM exceptions WHERE id=?", [req.params.id], (err) => {
      if (err) return serverError(res, err);
      res.json({ ok: true });
    });
  });

  // ==================== 收入 Excel 匯入 ====================

  router.post("/income/import", requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const fileBuffer = req.body && req.body.file ? Buffer.from(req.body.file, 'base64') : null;
      if (!fileBuffer) {
        return res.status(400).json({ error: "請上傳 Excel 檔案（透過檔案選擇器）" });
      }
      // 🔒 上傳大小上限 5MB：Excel 解析器要一次過 inflate 成個 workbook 入記憶體，
      // 無上限嘅話一個細細嘅「zip bomb」就可以打爆 Node process。
      const MAX_XLSX_BYTES = 5 * 1024 * 1024;
      if (fileBuffer.length > MAX_XLSX_BYTES) {
        return res.status(413).json({ error: `Excel 檔案過大（上限 ${MAX_XLSX_BYTES / 1024 / 1024}MB）` });
      }
      const xlsx = require('xlsx');
      // cellFormula/cellNF 唔需要，關咗可以縮小攻擊面（避免公式字串做後續解析）
      const workbook = xlsx.read(fileBuffer, { type: 'buffer', cellFormula: false, cellNF: false, cellText: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawGrid = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });

      const insertAdjustment = (row) => new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO income_adjustments (adjustment_date, amount, type, customer, service_name, payment_method, doctor_name, note, period_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [row.adjustment_date, row.amount, row.type || 'service', row.customer || null, row.service_name || null, row.payment_method || null, row.doctor_name || null, row.note || null, row.period_type || 'day'],
          (err) => err ? reject(err) : resolve()
        );
      });

      const existsImport = (dateStr, type) => new Promise((resolve) => {
        db.get("SELECT id FROM income_adjustments WHERE adjustment_date=? AND type=? LIMIT 1", [dateStr, type], (e, r) => resolve(!e && !!r));
      });

      // 日期正規化：支援 JS Date / Excel 序號 / 2026-08-20 / 2026/8/20
      const normDate = (val) => {
        if (val === undefined || val === null || val === '') return '';
        if (val instanceof Date) return val.toISOString().slice(0, 10);
        if (typeof val === 'number' && val > 20000) {
          const epoch = new Date(Date.UTC(1899, 11, 30));
          epoch.setUTCDate(epoch.getUTCDate() + val);
          return epoch.toISOString().slice(0, 10);
        }
        const s = String(val).trim().replace(/[\/.]/g, '-');
        const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
        const dt = new Date(s);
        if (!isNaN(dt.getTime()) && /^\d{4}-/.test(s)) return dt.toISOString().slice(0, 10);
        return '';
      };

      let imported = 0, importedMonthly = 0, skipped = 0;
      const errors = [];
      const flat = rawGrid;

      // ==================== 偵測診所報表格式 ====================
      const hasTitle = (kw) => flat.some(r => r.some(c => typeof c === 'string' && c.includes(kw)));
      const findHeaderIdx = (colNames) => flat.findIndex(r => colNames.every(n => r.includes(n)));

      // ── A) 每日收入細列表：一張收據一行 ──
      if (hasTitle('每日收入細列表')) {
        let ds = '';
        outer1: for (const r of flat.slice(0, 6)) {
          for (const c of r) { ds = normDate(c); if (ds) break outer1; }
        }
        if (!ds) return res.status(400).json({ error: '每日報表搵唔到日期（標題區，例如 2026/08/20）' });
        if (await existsImport(ds, 'daily_report')) {
          return res.status(409).json({ error: `${ds} 嘅每日報表已經匯入過。請先喺下方「Excel 收入紀錄」刪除舊紀錄再重新匯入。`, duplicate: true });
        }
        const hIdx = findHeaderIdx(['收據編號', '總計']);
        if (hIdx === -1) return res.status(400).json({ error: '每日報表搾唔到收據表格（收據編號／總計 欄）' });
        const hdr = flat[hIdx];
        const iTot = hdr.lastIndexOf('總計');
        const iPay = hdr.indexOf('收費方法');
        const iName = hdr.indexOf('病人姓名');
        for (const r of flat.slice(hIdx + 1)) {
          const receipt = String(r[0] || '').trim();
          if (!/^I\d+/i.test(receipt)) continue; // 只收收據行；跳過付款方式統計等尾段
          const amount = Number(r[iTot] ?? 0);
          if (!isFinite(amount) || amount <= 0) { skipped++; continue; }
          await insertAdjustment({
            adjustment_date: ds, amount,
            type: 'daily_report',
            customer: iName >= 0 ? String(r[iName] || '').trim() : '',
            payment_method: iPay >= 0 ? String(r[iPay] || '').trim() : '',
            note: `收據 ${receipt}`,
            period_type: 'day'
          });
          imported++;
        }
        return res.json({ mode: 'daily', date: ds, imported, imported_monthly: 0, skipped, errors: errors.slice(0, 50) });
      }

      // ── B) 每月收入總覽表：一日一行，溝成一件月結 ──
      if (hasTitle('每月收入總覽表')) {
        let ym = '';
        outer2: for (const r of flat.slice(0, 6)) {
          for (const c of r) {
            const m = String(c).trim().match(/^(\d{4})[\/-](\d{1,2})$/);
            if (m) { ym = `${m[1]}-${String(Number(m[2])).padStart(2, '0')}`; break outer2; }
          }
        }
        if (!ym) return res.status(400).json({ error: '每月報表搾唔到月份（標題區，例如 2026/07）' });
        const monthStart = ym + '-01';
        if (await existsImport(monthStart, 'monthly_report')) {
          return res.status(409).json({ error: `${ym} 嘅每月報表已經匯入過。請先刪除舊紀錄再重新匯入。`, duplicate: true });
        }
        const hIdx = findHeaderIdx(['日期', '總計']);
        if (hIdx === -1) return res.status(400).json({ error: '每月報表搾唔到表格欄頭' });
        const hdr = flat[hIdx];
        const iDate = hdr.indexOf('日期');
        const iTot = hdr.lastIndexOf('總計');
        let days = 0, total = 0;
        for (const r of flat.slice(hIdx + 1)) {
          const d = normDate(iDate >= 0 ? r[iDate] : '');
          if (!d) continue; // 跳過「總計:」尾行
          const v = Number(r[iTot] ?? 0);
          if (isFinite(v) && v > 0) { total += v; days++; }
        }
        if (total <= 0) return res.status(400).json({ error: '每月報表入面搾唔到任何有效收入數字' });
        await insertAdjustment({
          adjustment_date: monthStart, amount: total,
          type: 'monthly_report',
          note: `${ym} 月結（${days} 日）`,
          period_type: 'month'
        });
        importedMonthly = 1;
        return res.json({ mode: 'monthly', month: ym, days, total, imported: 0, imported_monthly: 1, skipped: 0, errors: [] });
      }

      // ── C) 一般格式：日期／月份 ＋ 金額 欄 ──
      const parseMonthValue = (val) => {
        if (val === undefined || val === null || val === '') return null;
        const s = String(val).trim();
        let m = s.match(/^(\d{4})\s*[-/年]\s*(\d{1,2})(?:月)?$/);
        if (!m) m = s.match(/^(\d{4})(\d{2})$/);
        if (m) {
          const y = Number(m[1]), mo = Number(m[2]);
          if (y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12) return `${y}-${String(mo).padStart(2, '0')}-01`;
        }
        return null;
      };

      const objRows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
      for (const r of objRows) {
        let ds = normDate(r['日期'] ?? r['date']);
        let amount = Number(r['金額'] ?? r['amount'] ?? 0);
        if (isNaN(amount)) amount = 0;
        const serviceName = String(r['服務'] || r['service'] || '').trim();
        const type = String(r['類型'] || r['type'] || 'service').trim();

        skipped++;

        let periodType = 'day';
        if (!ds) {
          const ms = parseMonthValue(r['月份'] ?? r['month'] ?? r['期間']);
          if (ms) { ds = ms; periodType = 'month'; }
        }

        if (!ds) {
          errors.push(`第 ${imported + importedMonthly + skipped} 行：請提供「日期」(YYYY-MM-DD) 或「月份」(2026-08) 欄`);
          continue;
        }
        if (amount <= 0) {
          errors.push(`第 ${imported + importedMonthly + skipped} 行：無效金額`);
          continue;
        }

        try {
          await insertAdjustment({
            adjustment_date: ds, amount, type,
            customer: String(r['客戶'] || r['customer'] || '').trim(),
            service_name: serviceName,
            payment_method: String(r['支付方式'] || r['payment_method'] || '').trim(),
            doctor_name: String(r['醫師'] || r['doctor'] || '').trim(),
            note: String(r['備註'] || r['note'] || '').trim(),
            period_type: periodType
          });
          if (periodType === 'month') importedMonthly++; else imported++;
          skipped--;
        } catch (e) {
          errors.push(`第 ${imported + importedMonthly + skipped} 行：${e.message}`);
        }
      }

      res.json({ mode: 'generic', imported, imported_monthly: importedMonthly, skipped, errors: errors.slice(0, 50) });
    } catch (e) {
      console.error('匯入 Excel 失敗:', e);
      res.status(500).json({ error: '匯入失敗：' + e.message });
    }
  });

  // 取得收入調整記錄（結合系統收入報表）
  router.get("/income/adjustments", requireAuth, requireRole('admin'), (req, res) => {
    db.all("SELECT * FROM income_adjustments ORDER BY adjustment_date DESC, id DESC LIMIT 500", [], (err, rows) => {
      if (err) return serverError(res, err);
      res.json(rows || []);
    });
  });

  // 🗑️ 刪除單筆匯入紀錄（方便重複匯入前清理）
  router.delete("/income/adjustments/:id", requireAuth, requireRole('admin'), (req, res) => {
    db.run("DELETE FROM income_adjustments WHERE id=?", [Number(req.params.id)], function (err) {
      if (err) return serverError(res, err);
      if (this.changes === 0) return res.status(404).json({ error: "紀錄不存在" });
      res.json({ ok: true });
    });
  });

  // ============================================================
  // 💳 會員付款管理（管理員）：集中檢視 + 管理全部會員帳戶嘅
  //    付款方式 / 付款日 / 單號 / 帳戶狀況，並可手動記錄離線付款
  // ============================================================
  const mq = (sql, params = []) => new Promise((res, rej) => {
    db.all(sql, params, (e, rows) => e ? rej(e) : res(rows || []));
  });
  const mq1 = (sql, params = []) => new Promise((res, rej) => {
    db.get(sql, params, (e, row) => e ? rej(e) : res(row));
  });
  const mrun = (sql, params = []) => new Promise((res, rej) => {
    db.run(sql, params, function (e) { e ? rej(e) : res(this); });
  });

  const TIER_PRICE = { general: 0, premium: 8800, family: 16800 };
  const TIER_NAME = { general: '一般會員', premium: '高級會員', family: '家庭會員' };
  // #3：家庭計劃 A-D 分級月費（開通／續費要按實際計劃收費，唔再一律 16800）
  // #93：價錢以 membership_plans 表為真源（管理員可改），fallback 返硬編碼價；30 秒快取
  const FAMILY_PLAN_PRICE = { A: 8800, B: 12800, C: 16800, D: 20800 };
  let _fpmCache = null, _fpmAt = 0;
  async function familyPlanPriceMap() {
    if (_fpmCache && Date.now() - _fpmAt < 30000) return _fpmCache;
    try {
      const rows = await mq("SELECT plan_key, price FROM membership_plans WHERE is_active=1");
      const m = {};
      (rows || []).forEach((r) => { m[String(r.plan_key).toUpperCase()] = Number(r.price); });
      if (Object.keys(m).length) { _fpmCache = m; _fpmAt = Date.now(); return m; }
    } catch (e) { /* 表未建立：用 fallback */ }
    return FAMILY_PLAN_PRICE;
  }
  const FAMILY_PLAN_LABEL = {
    A: '家庭計劃 A（1-2 人）', B: '家庭計劃 B（3-5 人）',
    C: '家庭計劃 C（6-9 人）', D: '家庭計劃 D（10 人或以上）'
  };
  async function tierPriceFor(tier, familyPlan) {
    if (tier === 'family') {
      const m = await familyPlanPriceMap();
      const p = String(familyPlan || '').toUpperCase();
      if (m[p] != null) return m[p];
      return TIER_PRICE.family;
    }
    return TIER_PRICE[tier] || 0;
  }
  // 付款方式代碼 → 中文標籤
  const PAY_METHOD_LABEL = {
    cash: '現金', card: '信用卡', transfer: '銀行轉帳', fps: '轉數快 (FPS)', other: '其他'
  };
  const PAY_METHODS = Object.keys(PAY_METHOD_LABEL);

  // 計算會員嘅「帳戶狀況」顯示碼（familyCovered = 由家庭戶主訂閱覆蓋）
  function deriveAccountStatus(user, sub, familyCovered) {
    const tier = user.membership_tier || 'general';
    if (tier === 'general') return { code: 'free', label: '一般會員（免費）' };
    if ((user.subscription_status || '') === 'past_due') return { code: 'overdue', label: '扣款失敗・逾期待繳' };
    if (sub) {
      const end = sub.end_date ? new Date(sub.end_date) : null;
      const now = new Date();
      if (end && end < now) return { code: 'overdue', label: '會籍過期・待續費' };
      const daysLeft = end ? Math.ceil((end - now) / 86400000) : 999;
      if (daysLeft <= 7) return { code: 'expiring', label: `快到期（${daysLeft} 日內）` };
      return { code: 'active', label: familyCovered ? '家庭計劃生效中' : '生效中' };
    }
    if ((user.subscription_status || '') === 'canceled') return { code: 'cancelled', label: '已取消' };
    return { code: 'pending', label: '未開通・待繳費' };
  }

  // 💡 收款單號（付款憑證，並非「會員編號」member_no）：家庭計劃用 JRA/JRB/JRC-xxxx（按 A/B/C 計劃）；舊 premium 個人用 MEM-xxxx。
  //   ⚠️ 與 memberships.js 嘅 recomputeMemberNo() 係兩套唔同嘢——後者生成會員編號（SA/MA/JR），本函數生成收款單號，命名相近易淆，切記分清。
  const FAMILY_PLAN_PREFIX = { A: 'JRA', B: 'JRB', C: 'JRC', D: 'JRD' };
  async function resolveInvoiceNo(user) {
    const isFamily = (user.membership_tier || 'general') === 'family';
    if (isFamily) {
      const headId = (Number(user.family_head_id) === Number(user.id)) ? user.id : (user.family_head_id || user.id);
      let inv = await mq1("SELECT invoice_no FROM family_invoices WHERE family_head_id=?", [headId]);
      if (!inv) {
        const maxRow = await mq1("SELECT COALESCE(MAX(CAST(SUBSTR(invoice_no,5) AS INTEGER)),1000) AS m FROM family_invoices");
        const prefix = FAMILY_PLAN_PREFIX[user.family_plan || 'A'] || 'JRA';
        const nextNo = prefix + '-' + (maxRow.m + 1);
        // 🏠 輕量版 B：owner_user_id = 最初付款人（= head）
        await mrun("INSERT INTO family_invoices (invoice_no, family_head_id, plan, owner_user_id) VALUES (?,?,?,?)", [nextNo, headId, user.family_plan || 'A', headId]);
        inv = { invoice_no: nextNo };
      }
      return inv.invoice_no;
    }
    if ((user.membership_tier || 'general') === 'premium') {
      if (user.member_invoice_no) return user.member_invoice_no;
      const maxRow = await mq1("SELECT COALESCE(MAX(CAST(SUBSTR(member_invoice_no,5) AS INTEGER)),1000) AS m FROM users WHERE member_invoice_no LIKE 'MEM-%'");
      const nextNo = 'MEM-' + (maxRow.m + 1);
      await mrun("UPDATE users SET member_invoice_no=? WHERE id=?", [nextNo, user.id]);
      return nextNo;
    }
    return null;
  }

  // 組裝單一會員嘅付款摘要（需要預先載入嘅 lookup map）
  async function buildMemberSummary(user, lookups) {
    const tier = user.membership_tier || 'general';
    // 最新生效訂閱（家庭成員冇自己訂閱時，改看戶主訂閱）
    const subs = lookups.subsByUser[user.id] || [];
    let activeSub = subs.find(s => s.status === 'active') || subs[0] || null;
    let familyCovered = false;
    const headId = (Number(user.family_head_id) === Number(user.id)) ? null : (user.family_head_id || null);
    if (!activeSub && headId && lookups.subsByUser[headId]) {
      const headSub = lookups.subsByUser[headId].find(s => s.status === 'active');
      if (headSub) { activeSub = headSub; familyCovered = true; }
    }
    // 最新成功付款
    const pays = lookups.paysByUser[user.id] || [];
    const lastPaid = pays[0] || null;
    const status = deriveAccountStatus(user, activeSub, familyCovered);
    const invoiceNo = await resolveInvoiceNo(user);
    // 付款方式：優先用用戶欄位，其次最新付款紀錄
    const method = user.payment_method || (lastPaid ? lastPaid.payment_method : null);
    return {
      id: user.id,
      name: user.name,
      username: user.username,
      memberNo: user.member_no || (user.phone || ''),
      phone: user.phone,
      tier,
      tierName: (tier === 'family' && user.family_plan)
        ? (FAMILY_PLAN_LABEL[String(user.family_plan).toUpperCase()] || TIER_NAME[tier])
        : (TIER_NAME[tier] || tier),
      // #3：家庭會員按實際計劃（A-D）計價，唔再一律 16800（#93：價錢讀 membership_plans）
      amount: await tierPriceFor(tier, user.family_plan),
      familyPlan: (user.family_plan || '').toString().toUpperCase() || null,
      familyPlanLabel: user.family_plan ? (FAMILY_PLAN_LABEL[String(user.family_plan).toUpperCase()] || null) : null,
      accountStatus: status.code,
      accountStatusLabel: status.label,
      paymentMethod: method || null,
      paymentMethodLabel: method ? (PAY_METHOD_LABEL[method] || method) : '—',
      lastPaidAt: lastPaid ? lastPaid.paid_at : null,
      subscriptionEnd: activeSub ? activeSub.end_date : null,
      subscriptionStart: activeSub ? activeSub.start_date : null,
      invoiceNo,
      familyHeadId: user.family_head_id || null,
      isFamilyHead: Number(user.family_head_id) === Number(user.id)
    };
  }

  // GET /api/admin/member-payments — 全部會員付款總覽（搜尋 + 狀態篩選）
  router.get('/member-payments', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const q = (req.query.q || '').toString().trim();
      const statusFilter = (req.query.status || '').toString().trim();
      const tierFilter = (req.query.tier || '').toString().trim();
      const users = await mq(
        `SELECT id, username, name, phone, member_no, membership_tier, subscription_status,
                family_head_id, family_plan, payment_method, member_invoice_no
         FROM users WHERE role='customer' ORDER BY id`
      );
      const allSubs = await mq("SELECT * FROM subscriptions ORDER BY id");
      const allPays = await mq("SELECT id, user_id, payment_method, amount, status, paid_at, note FROM payments WHERE status IN ('paid','completed') ORDER BY paid_at DESC, id DESC");
      const lookups = {
        subsByUser: {},
        paysByUser: {}
      };
      allSubs.forEach(s => { (lookups.subsByUser[s.user_id] = lookups.subsByUser[s.user_id] || []).push(s); });
      allPays.forEach(p => { if (!(lookups.paysByUser[p.user_id] || []).length) lookups.paysByUser[p.user_id] = [p]; });

      const members = [];
      for (const u of users) {
        const m = await buildMemberSummary(u, lookups);
        if (q) {
          const hay = (m.name + m.memberNo + m.username + (m.phone || '') + (m.invoiceNo || '')).toLowerCase();
          if (!hay.includes(q.toLowerCase())) continue;
        }
        if (statusFilter && m.accountStatus !== statusFilter) continue;
        if (tierFilter && m.tier !== tierFilter) continue;
        members.push(m);
      }

      const summary = {
        total: members.length,
        active: members.filter(m => m.accountStatus === 'active').length,
        expiring: members.filter(m => m.accountStatus === 'expiring').length,
        overdue: members.filter(m => m.accountStatus === 'overdue').length,
        cancelled: members.filter(m => m.accountStatus === 'cancelled').length,
        free: members.filter(m => m.accountStatus === 'free').length,
        // 家庭帳戶總數：一張單 = 一個家庭帳戶（以 family_invoices 單數計）
        familyHeadCount: (await mq1("SELECT COUNT(*) AS c FROM family_invoices"))?.c || 0,
        monthlyRecurring: members.filter(m => m.accountStatus === 'active' || m.accountStatus === 'expiring')
          .reduce((s, m) => s + (m.amount || 0), 0)
      };
      res.json({ ok: true, members, summary });
    } catch (e) {
      console.error('載入會員付款總覽失敗:', e);
      res.status(500).json({ error: '系統錯誤' });
    }
  });

  // GET /api/admin/member-payments/:id — 單一會員詳情（訂閱 + 付款歷史 + 單號）
  router.get('/member-payments/:id', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const uid = Number(req.params.id);
      const user = await mq1(
        `SELECT id, username, name, phone, member_no, membership_tier, subscription_status,
                family_head_id, family_plan, payment_method, member_invoice_no, created_at
         FROM users WHERE id=? AND role='customer'`, [uid]);
      if (!user) return res.status(404).json({ error: '找不到該會員帳戶' });
      const lookups = { subsByUser: {}, paysByUser: {} };
      const subs = await mq("SELECT * FROM subscriptions WHERE user_id=? ORDER BY id DESC", [uid]);
      const pays = await mq("SELECT id, user_id, payment_method, amount, status, paid_at, transaction_id, note FROM payments WHERE user_id=? ORDER BY paid_at DESC, id DESC", [uid]);
      lookups.subsByUser[uid] = subs;
      lookups.paysByUser[uid] = pays.filter(p => p.status === 'paid' || p.status === 'completed');
      const summary = await buildMemberSummary(user, lookups);
      res.json({
        ok: true,
        user: summary,
        subscriptions: subs,
        payments: pays,
        payMethodOptions: PAY_METHODS.map(k => ({ value: k, label: PAY_METHOD_LABEL[k] }))
      });
    } catch (e) {
      console.error('載入會員付款詳情失敗:', e);
      res.status(500).json({ error: '系統錯誤' });
    }
  });

  // POST /api/admin/member-payments/:id/record — 管理員手動記錄離線付款（現金／轉帳等）
  router.post('/member-payments/:id/record', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const uid = Number(req.params.id);
      const { method, amount, note, tier, familyPlan } = req.body || {};
      if (!method || !PAY_METHODS.includes(method)) {
        return res.status(400).json({ error: '請選擇有效嘅付款方式', code: 'invalid_method' });
      }
      if (!tier || !['general', 'family'].includes(tier)) {
        return res.status(400).json({ error: '請選擇要開通／續費嘅會員級別', code: 'invalid_tier' });
      }
      // #3：家庭會員必須指明計劃 A-D（#93：計劃鍵以 membership_plans 為準，可新增）
      const plan = String(familyPlan || '').toUpperCase();
      const planPriceMap0 = tier === 'family' ? await familyPlanPriceMap() : null;
      if (tier === 'family' && planPriceMap0[plan] == null) {
        return res.status(400).json({ error: '家庭會員請指定計劃（A／B／C／D）', code: 'invalid_family_plan' });
      }
      const user = await mq1("SELECT id, membership_tier, family_head_id, subscription_status, family_plan FROM users WHERE id=? AND role='customer'", [uid]);
      if (!user) return res.status(404).json({ error: '找不到該會員帳戶' });

      const now = new Date();
      const paidAt = now.toISOString().slice(0, 19).replace('T', ' ');
      const txn = 'MAN-' + now.getTime();
      const payAmount = (amount !== undefined && amount !== null && amount !== '') ? Number(amount) : await tierPriceFor(tier, plan);

      // 1) 寫入付款紀錄
      await mrun(
        "INSERT INTO payments (user_id, amount, payment_method, status, transaction_id, paid_at, note, created_at) VALUES (?,?,?,?,?,?,?,?)",
        [uid, payAmount, method, 'paid', txn, paidAt, note || null, paidAt]
      );
      // 2) 更新/建立生效訂閱（30 日週期）
      const start = paidAt.slice(0, 10);
      const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const existing = await mq1("SELECT id FROM subscriptions WHERE user_id=? AND status='active' ORDER BY id DESC LIMIT 1", [uid]);
      if (existing) {
        await mrun("UPDATE subscriptions SET start_date=?, end_date=?, tier=?, payment_id=(SELECT id FROM payments WHERE transaction_id=?) WHERE id=?",
          [start, end, tier, txn, existing.id]);
      } else {
        await mrun("INSERT INTO subscriptions (user_id, tier, status, start_date, end_date, payment_id) VALUES (?,?,?,?,?,(SELECT id FROM payments WHERE transaction_id=?))",
          [uid, tier, 'active', start, end, txn]);
      }
      // 3) 更新用戶狀態
      await mrun("UPDATE users SET subscription_status='active', payment_method=? WHERE id=?", [method, uid]);
      // 4) 若指定咗級別且不同，套用（家庭會自動建 FAM 單號）
      if (tier && ['general', 'family'].includes(tier) && tier !== user.membership_tier) {
        await mrun("UPDATE users SET membership_tier=? WHERE id=?", [tier, uid]);
        if (tier === 'family') {
          // 🔒 只有「本身完全無家庭連結」嘅 general 客，開通 family 先設自己做 head；
          //    否則（已係子女→family_head_id 指向父母）千祈唔可以強行改做自己，否則會悄悄脫離原家庭、變獨立戶主（資料破壞）
          if (!user.family_head_id) {
            await mrun("UPDATE users SET family_head_id=? WHERE id=?", [uid, uid]);
          }
        } else {
          // 降級為 general：離開家庭，清走 family_head_id（無論係 head 定子女），避免殘留 S/M 編號
          await mrun("UPDATE users SET family_head_id=NULL WHERE id=?", [uid]);
        }
      }
      // #3：同步家庭計劃（A-D）—— 開通／續費都要固定返呢個計劃
      if (tier === 'family') {
        await mrun("UPDATE users SET family_plan=? WHERE id=?", [plan, uid]);
      } else if (tier === 'general') {
        await mrun("UPDATE users SET family_plan=NULL WHERE id=?", [uid]);
      }
      // 5) 重新讀取最新用戶狀態（含級別／家庭連結變動），供後續重算會員編號同單號
      const updatedUser = await mq1("SELECT * FROM users WHERE id=?", [uid]);
      // 🔢 級別／家庭連結／計劃變動後，重算會員編號（一般 JR→家庭主 S/子 M 開頭，編號含方案字母）
      //    否則升級 family 後 member_no 仍係舊嘅 JRxxxx，顯示與實際級別唔符（silent bug）
      if (tier === 'family' && Number(updatedUser.family_head_id) === Number(uid)) {
        await recomputeFamilyMemberNos(uid); // 戶主計劃變動，全家編號都要跟手更新
      } else if (recomputeMemberNo) {
        await recomputeMemberNo(uid);
      }
      // 6) 確保單號存在（家庭→FAM，個人 premium→MEM）
      const invoiceNo = await resolveInvoiceNo(updatedUser);

      res.json({ ok: true, message: '已記錄付款並開通會籍', transactionId: txn, invoiceNo, method });
    } catch (e) {
      console.error('記錄會員付款失敗:', e);
      res.status(500).json({ error: '記錄失敗：' + (e.message || '') });
    }
  });

  // ================= #9：管理員 社福券管理 =================
  // 券定義放 routes/coupons.js（/api/coupons），呢度只補管理員要嘅
  //   · 使用紀錄（邊個客人用咗邊張券、剩餘免費次數）
  //   · 啟用／停用開關（coupons.js 只有 DELETE，無得重新啟用）

  // 📋 社福券使用紀錄
  router.get('/coupon-usage', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const rows = await mq(
        `SELECT uc.id, uc.coupon_code, uc.free_total, uc.free_used,
                (uc.free_total - uc.free_used) AS remaining, uc.status,
                uc.purchased_at, uc.redeemed_at,
                u.name AS user_name, u.phone AS user_phone, u.member_no,
                c.title AS coupon_title, c.price_hkd, c.active AS coupon_active
         FROM user_coupons uc
         LEFT JOIN users u ON u.id = uc.user_id
         LEFT JOIN coupons c ON c.code = uc.coupon_code
         ORDER BY uc.id DESC
         LIMIT 300`
      );
      const summary = {
        holders: new Set((rows || []).map(r => r.member_no || r.user_phone)).size,
        records: (rows || []).length,
        totalGranted: (rows || []).reduce((s, r) => s + (r.free_total || 0), 0),
        totalUsed: (rows || []).reduce((s, r) => s + (r.free_used || 0), 0),
        totalRemaining: (rows || []).reduce((s, r) => s + ((r.free_total || 0) - (r.free_used || 0)), 0),
      };
      res.json({ ok: true, usage: rows || [], summary });
    } catch (e) {
      console.error('載入社福券使用紀錄失敗:', e);
      res.status(500).json({ error: '系統錯誤' });
    }
  });

  // 🔁 啟用／停用社福券
  router.post('/coupons/:id/toggle', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const cid = Number(req.params.id);
      const row = await mq1("SELECT id, code, active FROM coupons WHERE id=?", [cid]);
      if (!row) return res.status(404).json({ error: '搵唔到呢張社福券' });
      const next = row.active ? 0 : 1;
      await mrun("UPDATE coupons SET active=? WHERE id=?", [next, cid]);
      res.json({ ok: true, id: cid, code: row.code, active: !!next });
    } catch (e) {
      console.error('切換社福券狀態失敗:', e);
      res.status(500).json({ error: '系統錯誤' });
    }
  });

  // ==================== 會員計劃管理（#93：價錢／簡介可設定，可新增與刪除）====================
  // 真源 = membership_plans 表；官網價錢頁／會員中心經 GET /api/membership/plans 同步讀取
  const parsePlanRow = (r) => ({
    ...r,
    price: Number(r.price),
    features: (() => { try { return JSON.parse(r.features || '[]'); } catch (e) { return []; } })(),
    popular: !!Number(r.popular),
    is_active: !!Number(r.is_active),
  });

  // GET /api/admin/plans — 全部計劃（含停用）
  router.get('/plans', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const rows = await mq("SELECT * FROM membership_plans ORDER BY sort, id");
      res.json({ ok: true, plans: rows.map(parsePlanRow) });
    } catch (e) {
      console.error('載入會員計劃失敗:', e);
      res.status(500).json({ error: '系統錯誤' });
    }
  });

  // POST /api/admin/plans — 新增計劃
  router.post('/plans', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const { plan_key, name, price, range_label, intro, features, popular, sort, is_active } = req.body || {};
      const key = String(plan_key || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{1,4}$/.test(key)) return res.status(400).json({ error: '計劃代碼須為 1-4 位英數（如 A、B、S1）', code: 'invalid_key' });
      if (!String(name || '').trim()) return res.status(400).json({ error: '請填寫計劃名稱', code: 'invalid_name' });
      const priceNum = Number(price);
      if (!isFinite(priceNum) || priceNum < 0) return res.status(400).json({ error: '價錢必須係 0 或以上嘅數字', code: 'invalid_price' });
      const dup = await mq1("SELECT id FROM membership_plans WHERE plan_key=?", [key]);
      if (dup) return res.status(409).json({ error: `計劃代碼 ${key} 已存在`, code: 'duplicate_key' });
      const maxSort = await mq1("SELECT COALESCE(MAX(sort),0) AS m FROM membership_plans");
      const r = await mrun(
        "INSERT INTO membership_plans (plan_key, name, price, range_label, intro, features, popular, sort, is_active) VALUES (?,?,?,?,?,?,?,?,?)",
        [key, String(name).trim(), priceNum, String(range_label || '').trim(), String(intro || '').trim(),
          JSON.stringify(Array.isArray(features) ? features : []), popular ? 1 : 0,
          Number.isFinite(Number(sort)) ? Number(sort) : (maxSort.m + 1), is_active === false ? 0 : 1]
      );
      const row = await mq1("SELECT * FROM membership_plans WHERE id=?", [r.lastID]);
      res.json({ ok: true, plan: parsePlanRow(row) });
    } catch (e) {
      console.error('新增會員計劃失敗:', e);
      res.status(500).json({ error: '系統錯誤' });
    }
  });

  // PUT /api/admin/plans/:id — 更新計劃（價錢／簡介／名稱／人數範圍／功能／排序／啟用）
  router.put('/plans/:id', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const pid = Number(req.params.id);
      const row = await mq1("SELECT * FROM membership_plans WHERE id=?", [pid]);
      if (!row) return res.status(404).json({ error: '搵唔到呢個會員計劃' });
      const b = req.body || {};
      const name = b.name !== undefined ? String(b.name).trim() : row.name;
      if (!name) return res.status(400).json({ error: '計劃名稱唔可以空白', code: 'invalid_name' });
      const price = b.price !== undefined ? Number(b.price) : Number(row.price);
      if (!isFinite(price) || price < 0) return res.status(400).json({ error: '價錢必須係 0 或以上嘅數字', code: 'invalid_price' });
      const range_label = b.range_label !== undefined ? String(b.range_label).trim() : row.range_label;
      const intro = b.intro !== undefined ? String(b.intro).trim() : row.intro;
      const features = b.features !== undefined ? JSON.stringify(Array.isArray(b.features) ? b.features : []) : row.features;
      const popular = b.popular !== undefined ? (b.popular ? 1 : 0) : Number(row.popular);
      const sort = b.sort !== undefined ? Number(b.sort) : Number(row.sort);
      const is_active = b.is_active !== undefined ? (b.is_active ? 1 : 0) : Number(row.is_active);
      await mrun(
        "UPDATE membership_plans SET name=?, price=?, range_label=?, intro=?, features=?, popular=?, sort=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
        [name, price, range_label, intro, features, popular, sort, is_active, pid]
      );
      const updated = await mq1("SELECT * FROM membership_plans WHERE id=?", [pid]);
      res.json({ ok: true, plan: parsePlanRow(updated) });
    } catch (e) {
      console.error('更新會員計劃失敗:', e);
      res.status(500).json({ error: '系統錯誤' });
    }
  });

  // DELETE /api/admin/plans/:id — 刪除計劃（連結中嘅用戶 family_plan 保持原值，價錢查詢會 fallback）
  router.delete('/plans/:id', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const pid = Number(req.params.id);
      const row = await mq1("SELECT id, plan_key, name FROM membership_plans WHERE id=?", [pid]);
      if (!row) return res.status(404).json({ error: '搵唔到呢個會員計劃' });
      await mrun("DELETE FROM membership_plans WHERE id=?", [pid]);
      res.json({ ok: true, deleted: row });
    } catch (e) {
      console.error('刪除會員計劃失敗:', e);
      res.status(500).json({ error: '系統錯誤' });
    }
  });

  return router;
};
