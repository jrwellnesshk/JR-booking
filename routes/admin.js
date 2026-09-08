const { serverError } = require("../services/httpResp");
/**
 * 管理員路由
 * 包括：用戶管理（需二次驗證）、FAQ管理、系統狀態、審計日誌
 */

const express = require('express');
const router = express.Router();
const { validatePassword, generateTempPassword } = require('../services/passwordPolicy');

module.exports = (db, hashPassword, verifyPassword, { requireAuth, requireRole } = {}) => {

  // ==================== 二次驗證中間件 ====================
  
  /**
   * 驗證管理員密碼中間件
   * 用於敏感操作前的二次確認（需先通過 requireAuth + requireRole('admin')）
   */
  const verifyAdminPassword = (req, res, next) => {
    const { adminPassword } = req.body;
    
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
    const { username, name, name_en, phone, email, role, insurance_covered } = req.body;
    let { password } = req.body;

    // 驗證必填欄位（密碼可省略：由後端自動生成強隨機暫時密碼）
    if (!username || !name || !phone) {
      return res.status(400).json({ error: "缺少必要欄位（用戶名、姓名、電話為必填）" });
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
        db.run(
          "INSERT INTO users (username, password, name, name_en, phone, email, role, profile_completed, must_change_password, insurance_covered) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [username, hashedPassword, name, name_en || "", phone, email || "", userRole, 1, mustChange, insurance],
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
    // 管理員／醫師都可指定其他醫師（診所共享排程）、唔指明就自己
    const userId = (req.query.userId && ['admin', 'doctor'].includes(req.user.role)) ? req.query.userId : req.user.id;
    const { date, status } = req.query;

    // 驗證是醫師角色
    db.get("SELECT id, role, name FROM users WHERE id=? AND role='doctor'", [userId], (err, user) => {
      if (err) return serverError(res, err);
      if (!user) return res.status(403).json({ error: "無此權限" });

      // 優先使用 user_id 匹配 bookings，如果沒有則使用姓名（兼容舊數據）
      db.get("SELECT name FROM doctors WHERE user_id=? AND is_active=1", [userId], (docErr, doctor) => {
        const doctorName = doctor ? doctor.name : user.name;

        let query = "SELECT b.*, s.name as service_name, CASE WHEN b.user_id IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM bookings x WHERE x.user_id = b.user_id AND x.status='completed') = 0 END AS is_new FROM bookings b LEFT JOIN services s ON b.service_id = s.id WHERE (b.doctor_user_id=? OR b.doctor_name=?)";
        let params = [userId, doctorName];

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

      let query = "SELECT b.*, s.name as service_name, CASE WHEN b.user_id IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM bookings x WHERE x.user_id = b.user_id AND x.status='completed') = 0 END AS is_new FROM bookings b LEFT JOIN services s ON b.service_id = s.id WHERE 1=1";
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

        // 員工可更新任何預約；醫師只能更新自己的預約
        const checkBooking = (cb) => {
          if (user.role === 'staff') {
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

    const sql = `
      SELECT
        strftime('${fmt}', b.appointment_date) AS period,
        COUNT(*) AS count,
        COALESCE(SUM(s.price), 0) AS total
      FROM bookings b
      LEFT JOIN services s ON b.service_id = s.id
      WHERE b.status IN ('confirmed', 'completed')
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
         ${period === 'day' ? "WHERE COALESCE(period_type,'day')='day'" : ''}
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

          // 🆕 應診人數（當期狀態為 visited / completed 的預約）
          db.all(
            `SELECT strftime('${fmt}', appointment_date) AS period, COUNT(*) AS visited_count
             FROM bookings WHERE status IN ('visited','completed') GROUP BY period`,
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

                      const summary = {
                        total: data.reduce((sum, r) => sum + (r.total || 0), 0),
                        count: data.reduce((sum, r) => sum + (r.count || 0), 0),
                        periods: data.length,
                        visited_count: data.reduce((sum, r) => sum + (r.visited_count || 0), 0),
                        // 系統預約金額（僅參考，不計入收入）
                        booking_reference_total: data.reduce((sum, r) => sum + (r.booking_ref_total || 0), 0),
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
    const { type = 'doctor_leave', doctor_user_id, exception_date, reason, name, notifyEmail = false, notifyWhatsapp = true, cancelBookings = false } = req.body || {};
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
      const messageText = excType === 'weather'
        ? `【寶天醫館】通知：因天氣影響（${reason || '天氣惡劣'}），${exception_date} 全日暫停營業，您嘅預約需要改期。請致電 2555-1136 或登入系統重新預約，造成不便敬請原諒。`
        : `【寶天醫館】通知：${doctor.name}醫師於 ${exception_date} 請假（${reason || '休假'}），您嘅預約需要改期。請致電 2555-1136 或登入系統重新預約，造成不便敬請原諒。`;

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
      `SELECT e.*, u.name AS doctor_name FROM exceptions e LEFT JOIN users u ON e.doctor_user_id = u.id
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
    const { exception_date, reason, notifyWhatsapp = true, cancelBookings = false } = req.body || {};
    const doctorUserId = (req.body && req.body.doctorUserId && ['admin', 'doctor'].includes(req.user.role))
      ? Number(req.body.doctorUserId)
      : req.user.id;
    if (!exception_date || !/^\d{4}-\d{2}-\d{2}$/.test(exception_date)) {
      return res.status(400).json({ error: '請選擇請假日期' });
    }
    const todayStr = new Date().toLocaleDateString('sv-SE');
    if (exception_date < todayStr) {
      return res.status(400).json({ error: '請假日期不可以係過去日子' });
    }

    try {
      const doctor = await new Promise((resolve) => {
        db.get("SELECT id, name, role FROM users WHERE id=? AND role='doctor'", [doctorUserId], (e, r) => resolve(r || null));
      });
      if (!doctor) return res.status(404).json({ error: '找不到醫師帳戶' });

      // 1. 記錄請假（同一日重複申請 → 更新原因）
      await new Promise((resolve, reject) => {
        db.get("SELECT id FROM exceptions WHERE exception_date=? AND type='doctor_leave' AND doctor_user_id=?",
          [exception_date, doctorUserId], (e, row) => {
            if (e) return reject(e);
            if (row) {
              db.run("UPDATE exceptions SET reason=?, created_by=? WHERE id=?", [reason || '', req.user.id, row.id], (e2) => e2 ? reject(e2) : resolve());
            } else {
              db.run(`INSERT INTO exceptions (exception_date, name, type, reason, doctor_user_id, created_by) VALUES (?,?,?,?,?,?)`,
                [exception_date, `${doctor.name}請假`, 'doctor_leave', reason || '', doctorUserId, req.user.id],
                (e2) => e2 ? reject(e2) : resolve());
            }
          });
      });

      // 2. 查詢受影響預約
      const activeStatuses = "('pending','confirmed','in-progress','in-treatment','visited','dispensing')";
      const affected = await new Promise((resolve, reject) => {
        db.all(
          `SELECT b.*, s.name AS service_name FROM bookings b LEFT JOIN services s ON s.id=b.service_id
           WHERE b.appointment_date=? AND (b.doctor_user_id=? OR b.doctor_name=?) AND b.status IN ${activeStatuses}
           ORDER BY b.appointment_time`,
          [exception_date, doctorUserId, doctor.name],
          (e, rows) => e ? reject(e) : resolve(rows || [])
        );
      });

      // 3. WhatsApp 通知受影響客戶
      const whatsappService = require('../services/whatsapp');
      const notifyResults = { whatsapp: 0, failed: 0 };
      const messageText = `【寶天醫館】通知：${doctor.name}醫師於 ${exception_date} 請假（${reason || '休息'}），您的預約需要改期。請致電 2555-1136 或登入系統重新預約。不便之處，敬請原諒。`;
      if (notifyWhatsapp) {
        for (const b of affected) {
          if (whatsappService.isConfigured() && b.customer_phone) {
            try {
              let phone = String(b.customer_phone);
              if (!phone.startsWith('+')) phone = '+852' + phone.replace(/^852/, '');
              const wa = await whatsappService.sendWhatsApp(phone, messageText);
              if (wa && wa.success) notifyResults.whatsapp++;
              else notifyResults.failed++;
            } catch (e) { notifyResults.failed++; }
          }
        }
      }

      // 4. 可選：自動取消受影響預約
      let cancelled = 0;
      if (cancelBookings && affected.length) {
        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE bookings SET status='cancelled', notes=COALESCE(notes,'') || ' [醫師請假自動取消]', updated_at=CURRENT_TIMESTAMP
             WHERE appointment_date=? AND (doctor_user_id=? OR doctor_name=?) AND status IN ${activeStatuses}`,
            [exception_date, doctorUserId, doctor.name],
            (e) => e ? reject(e) : resolve()
          );
        });
        cancelled = affected.length;
      }

      res.json({
        ok: true,
        exception_date,
        affected_count: affected.length,
        affected: affected.map(b => ({
          id: b.id, customer_name: b.customer_name, service_name: b.service_name,
          appointment_time: b.appointment_time, status: b.status
        })),
        notified: notifyResults,
        cancelled
      });
    } catch (e) {
      console.error('醫師自助請假失敗:', e);
      res.status(500).json({ error: '處理失敗：' + (e.message || '') });
    }
  });

  // DELETE /api/admin/doctor/my-leaves/:id — 取消未來嘅請假（回復應診；管理員／醫師）
  router.delete("/doctor/my-leaves/:id", requireAuth, requireRole('doctor', 'admin'), (req, res) => {
    const id = Number(req.params.id);
    const todayStr = new Date().toLocaleDateString('sv-SE');
    db.get("SELECT * FROM exceptions WHERE id=? AND type='doctor_leave'", [id], (err, exc) => {
      if (err) return serverError(res, err);
      if (!exc) return res.status(404).json({ error: '找不到該請假記錄' });
      // 非管理員唔可以刪過去嘅請假
      if (req.user.role !== 'admin' && exc.exception_date < todayStr) {
        return res.status(400).json({ error: '過去嘅請假記錄不可以刪除' });
      }
      // 計算受影響（原本被擋新增、但已存在嘅預約不變，只回復可約狀態）
      db.run("DELETE FROM exceptions WHERE id=?", [id], function (e2) {
        if (e2) return res.status(500).json({ error: e2.message });
        res.json({ ok: true, message: `已取消 ${exc.exception_date} 嘅請假，該日恢復接受預約` });
      });
    });
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

  // 取得會員單號（家庭用 JRA/JRB/JRC-xxxx 按計劃；個人 premium 用 MEM-xxxx）
  const FAMILY_PLAN_PREFIX = { A: 'JRA', B: 'JRB', C: 'JRC' };
  async function resolveInvoiceNo(user) {
    const isFamily = (user.membership_tier || 'general') === 'family';
    if (isFamily) {
      const headId = (Number(user.family_head_id) === Number(user.id)) ? user.id : (user.family_head_id || user.id);
      let inv = await mq1("SELECT invoice_no FROM family_invoices WHERE family_head_id=?", [headId]);
      if (!inv) {
        const maxRow = await mq1("SELECT COALESCE(MAX(CAST(SUBSTR(invoice_no,5) AS INTEGER)),1000) AS m FROM family_invoices");
        const prefix = FAMILY_PLAN_PREFIX[user.family_plan || 'A'] || 'JRA';
        const nextNo = prefix + '-' + (maxRow.m + 1);
        await mrun("INSERT INTO family_invoices (invoice_no, family_head_id, plan) VALUES (?,?,?)", [nextNo, headId, user.family_plan || 'A']);
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
      tierName: TIER_NAME[tier] || tier,
      amount: TIER_PRICE[tier] || 0,
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
      const { method, amount, note, tier } = req.body || {};
      if (!method || !PAY_METHODS.includes(method)) {
        return res.status(400).json({ error: '請選擇有效嘅付款方式', code: 'invalid_method' });
      }
      if (!tier || !['general', 'premium', 'family'].includes(tier)) {
        return res.status(400).json({ error: '請選擇要開通／續費嘅會員級別', code: 'invalid_tier' });
      }
      const user = await mq1("SELECT id, membership_tier, family_head_id, subscription_status FROM users WHERE id=? AND role='customer'", [uid]);
      if (!user) return res.status(404).json({ error: '找不到該會員帳戶' });

      const now = new Date();
      const paidAt = now.toISOString().slice(0, 19).replace('T', ' ');
      const txn = 'MAN-' + now.getTime();
      const payAmount = (amount !== undefined && amount !== null && amount !== '') ? Number(amount) : (TIER_PRICE[tier] || 0);

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
      if (tier && ['general', 'premium', 'family'].includes(tier) && tier !== user.membership_tier) {
        await mrun("UPDATE users SET membership_tier=? WHERE id=?", [tier, uid]);
        if (tier === 'family' && Number(user.family_head_id) !== Number(uid)) {
          await mrun("UPDATE users SET family_head_id=? WHERE id=?", [uid, uid]);
        }
      }
      // 5) 確保單號存在（家庭→FAM，個人 premium→MEM）
      const updatedUser = await mq1("SELECT * FROM users WHERE id=?", [uid]);
      const invoiceNo = await resolveInvoiceNo(updatedUser);

      res.json({ ok: true, message: '已記錄付款並開通會籍', transactionId: txn, invoiceNo, method });
    } catch (e) {
      console.error('記錄會員付款失敗:', e);
      res.status(500).json({ error: '記錄失敗：' + (e.message || '') });
    }
  });

  return router;
};
