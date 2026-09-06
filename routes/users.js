const { serverError } = require("../services/httpResp");
/**
 * 用戶管理路由
 * 包括：用戶資料、修改姓名/用戶名等
 */

const express = require('express');
const router = express.Router();
const { validatePassword } = require('../services/passwordPolicy');

module.exports = (db, hashPassword, verifyPassword, { requireAuth, requireRole } = {}) => {

  // 權限輔助：目標用戶係自己或管理員
  const isSelfOrAdmin = (req, targetId) => {
    if (!req.user) return false;
    if (req.user.role === 'admin') return true;
    return Number(req.user.id) === Number(targetId);
  };

  // 取得所有用戶（管理員：全部；職員：只限客戶 role=customer）
  router.get("/", requireAuth, requireRole('admin', 'staff'), (req, res) => {
    const staffOnlyCustomers = req.user && req.user.role === 'staff';
    db.all(
      `SELECT u.id, u.username, u.name, u.name_en, u.phone, u.email, u.role, u.profile_completed, u.created_at,
          u.membership_tier, u.insurance_covered, u.family_head_id, u.member_no, u.hide_from_head, u.family_plan, u.staff_note,
          u.subscription_status, u.stripe_subscription_id,
          CASE WHEN u.family_head_id IS NULL THEN NULL
               WHEN u.family_head_id = u.id THEN 'head'
               ELSE (SELECT fh.name FROM users fh WHERE fh.id = u.family_head_id) END AS family_head_name,
          (SELECT COUNT(*) FROM family_links fl WHERE fl.parent_user_id = u.id) AS family_children_count,
          (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id AND b.lateness_minutes > 0) AS late_count,
          (SELECT COALESCE(SUM(b.lateness_minutes), 0) FROM bookings b WHERE b.user_id = u.id AND b.lateness_minutes > 0) AS late_total_minutes,
          (SELECT MAX(b.appointment_date || ' ' || b.appointment_time)
             FROM bookings b WHERE b.user_id = u.id AND b.lateness_minutes > 0) AS last_late_record
        FROM users u
        ${staffOnlyCustomers ? "WHERE u.role='customer'" : ''}
        ORDER BY u.created_at DESC`,
      [],
      (err, rows) => {
        if (err) return serverError(res, err);

        // 計算每個用戶的剩餘天數（未完成資料的用戶）
        const now = new Date();
        const usersWithStatus = rows.map(user => {
          if (user.profile_completed === 0 && user.created_at) {
            const createdAt = new Date(user.created_at);
            const daysPassed = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
            const daysRemaining = Math.max(0, 3 - daysPassed);
            return { ...user, days_remaining: daysRemaining, is_expired: daysRemaining === 0 };
          }
          return { ...user, days_remaining: null, is_expired: false };
        });

        res.json(usersWithStatus);
      }
    );
  });

  // 📝 職員/管理員更新客戶備註（VIP／敏感標記等）
  router.put("/:id/staff-note", requireAuth, requireRole('admin', 'staff'), (req, res) => {
    const note = String((req.body && req.body.staff_note) || '').slice(0, 500);
    db.run("UPDATE users SET staff_note=? WHERE id=? AND role='customer'", [note, Number(req.params.id)], function (err) {
      if (err) return serverError(res, err);
      if (this.changes === 0) return res.status(404).json({ error: '客戶不存在' });
      res.json({ ok: true });
    });
  });

  // 獲取用戶個人資料
  router.get("/:id/profile", requireAuth, (req, res) => {
    const { id } = req.params;

    // 只能查看自己或管理員查看其他用戶
    if (!isSelfOrAdmin(req, id)) {
      return res.status(403).json({ error: "無權限查看此用戶資料" });
    }
    
    db.get(
      "SELECT id, username, name, name_en, phone, email, id_card, address, birth_date, emergency_contact, emergency_phone, username_last_changed, name_last_changed, membership_tier, insurance_covered, family_head_id, whatsapp_weather, whatsapp_confirm, whatsapp_health FROM users WHERE id=?",
      [id],
      (err, row) => {
        if (err) return serverError(res, err);
        if (!row) return res.status(404).json({ error: "用戶不存在" });
        res.json(row);
      }
    );
  });

  // 更新 WhatsApp 通知偏好（通訊偏好中心）
  router.put("/:id/notifications", requireAuth, (req, res) => {
    const { id } = req.params;
    if (!isSelfOrAdmin(req, id)) {
      return res.status(403).json({ error: "無權限修改此用戶資料" });
    }
    const { whatsapp_weather, whatsapp_confirm, whatsapp_health } = req.body || {};
    const toInt = (v) => (v === undefined ? null : v ? 1 : 0);
    const values = [toInt(whatsapp_weather), toInt(whatsapp_confirm), toInt(whatsapp_health)];
    const sql = "UPDATE users SET whatsapp_weather=COALESCE(?,whatsapp_weather), whatsapp_confirm=COALESCE(?,whatsapp_confirm), whatsapp_health=COALESCE(?,whatsapp_health) WHERE id=?";
    db.run(sql, [...values, id], (err) => {
      if (err) return serverError(res, err);
      res.json({ ok: true });
    });
  });

  // 更新用戶個人資料
  router.put("/:id/profile", requireAuth, (req, res) => {
    const { id } = req.params;

    // 只能更新自己或管理員更新其他用戶
    if (!isSelfOrAdmin(req, id)) {
      return res.status(403).json({ error: "無權限修改此用戶資料" });
    }

    const { id_card, address, birth_date, emergency_contact, emergency_phone, phone, email, name_en } = req.body;
    
    // 需要檢查唯一性的欄位（除地址外）
    // 建立一個檢查隊列，依次檢查每個需要唯一性的欄位
    const uniqueChecks = [];
    
    // 檢查身份證號
    if (id_card) {
      uniqueChecks.push({
        field: 'id_card',
        value: id_card,
        errorMsg: '該身份證號已被其他用戶使用，無法更新'
      });
    }
    
    // 檢查電話號碼
    if (phone) {
      uniqueChecks.push({
        field: 'phone',
        value: phone,
        errorMsg: '該電話號碼已被其他用戶使用，無法更新'
      });
    }
    
    // 檢查電郵（如果有填寫）
    if (email && email.trim()) {
      uniqueChecks.push({
        field: 'email',
        value: email,
        errorMsg: '該電子郵件已被其他用戶使用，無法更新'
      });
    }
    
    // 檢查英文姓名（如果有填寫）
    if (name_en && name_en.trim()) {
      uniqueChecks.push({
        field: 'name_en',
        value: name_en,
        errorMsg: '該英文姓名已被其他用戶使用，無法更新'
      });
    }
    
    // 檢查緊急聯絡人姓名（如果有填寫）
    if (emergency_contact && emergency_contact.trim()) {
      uniqueChecks.push({
        field: 'emergency_contact',
        value: emergency_contact,
        errorMsg: '該緊急聯絡人姓名已被其他用戶使用，無法更新'
      });
    }
    
    // 檢查緊急聯絡人電話（如果有填寫）
    if (emergency_phone && emergency_phone.trim()) {
      uniqueChecks.push({
        field: 'emergency_phone',
        value: emergency_phone,
        errorMsg: '該緊急聯絡人電話已被其他用戶使用，無法更新'
      });
    }
    
    // 遞歸檢查所有唯一性欄位
    function checkUnique(index) {
      // 所有檢查完成，執行更新
      if (index >= uniqueChecks.length) {
        return performProfileUpdate();
      }
      
      const check = uniqueChecks[index];
      db.get(
        `SELECT id FROM users WHERE ${check.field}=? AND id!=?`,
        [check.value, id],
        (err, existingUser) => {
          if (err) {
            return serverError(res, err);
          }
          
          if (existingUser) {
            return res.status(400).json({ error: check.errorMsg });
          }
          
          // 繼續檢查下一個欄位
          checkUnique(index + 1);
        }
      );
    }
    
    // 開始唯一性檢查
    checkUnique(0);

    function performProfileUpdate() {
      // 🛡️ 只更新請求中有提供的欄位，避免 undefined 寫入 NOT NULL 欄位造成 500
      const fieldMap = {
        id_card,
        address,
        birth_date,
        emergency_contact,
        emergency_phone,
        phone,
        email,
        name_en,
      };
      const sets = [];
      const params = [];
      Object.entries(fieldMap).forEach(([key, val]) => {
        if (val !== undefined) {
          sets.push(`${key}=?`);
          params.push(val);
        }
      });
      // 會員編號 = 電話（改電話即同步 member_no）
      if (phone !== undefined) { sets.push('member_no=?'); params.push(phone); }
      if (sets.length === 0) {
        return res.status(400).json({ error: "沒有提供任何可更新的欄位" });
      }
      params.push(id);
      db.run(
        `UPDATE users SET ${sets.join(", ")} WHERE id=?`,
        params,
        function (err) {
          if (err) return serverError(res, err);
          res.json({ ok: true, message: "個人資料已更新" });
        }
      );
    }
  });

  // 更改密碼（自己更改需驗證舊密碼；管理員重置需二次驗證）
  router.put("/:id/password", requireAuth, (req, res) => {
    const { id } = req.params;
    const { currentPassword, newPassword, adminPassword } = req.body;
    
    if (!newPassword) {
      return res.status(400).json({ error: "缺少新密碼" });
    }

    // 🔒 先查目標用戶角色（分層密碼政策需按角色驗證）
    db.get("SELECT role FROM users WHERE id=?", [id], (roleErr, targetRow) => {
      if (roleErr) return res.status(500).json({ error: roleErr.message });

      // 🔒 密碼強度檢查（按目標帳戶角色分層）
      const pwResult = validatePassword(newPassword, targetRow ? targetRow.role : undefined);
      if (!pwResult.ok) {
        return res.status(400).json({ error: pwResult.error, field: "password" });
      }
      continueChange();
    });

    function continueChange() {
      // 🔒 只有自己或管理員可以更改密碼
      if (!isSelfOrAdmin(req, id)) {
        return res.status(403).json({ error: "無權限更改此用戶密碼" });
      }

      const isAdmin = req.user && req.user.role === 'admin';

      // 管理員重置他人密碼：需二次驗證管理員密碼
      if (isAdmin && Number(req.user.id) !== Number(id)) {
        if (!adminPassword) {
          return res.status(400).json({ error: "此操作需要輸入管理員密碼進行驗證", requiresVerification: true });
        }
        db.get("SELECT password, role FROM users WHERE id=?", [req.user.id], (err, admin) => {
          if (err) return serverError(res, err);
          if (!admin || admin.role !== 'admin') {
            return res.status(403).json({ error: "無權限執行此操作" });
          }
          if (!verifyPassword(adminPassword, admin.password)) {
            return res.status(401).json({ error: "管理員密碼不正確" });
          }
          updatePassword();
        });
        return;
      }

      // 自己更改密碼：必須驗證舊密碼
      if (Number(req.user.id) === Number(id)) {
        if (!currentPassword) {
          return res.status(400).json({ error: "請輸入目前密碼" });
        }
        db.get("SELECT password FROM users WHERE id=?", [id], (err, user) => {
          if (err) return serverError(res, err);
          if (!user) return res.status(404).json({ error: "用戶不存在" });
          if (!verifyPassword(currentPassword, user.password)) {
            return res.status(401).json({ error: "目前密碼不正確" });
          }
          updatePassword();
        });
        return;
      }

      updatePassword();

      function updatePassword() {
        const hashedPassword = hashPassword(newPassword);
        // 管理員重置他人密碼：設定 must_change_password，強制對方下次登入修改
        const mustChange = (isAdmin && Number(req.user.id) !== Number(id)) ? 1 : 0;
        db.run("UPDATE users SET password=?, must_change_password=? WHERE id=?", [hashedPassword, mustChange, id], function (err) {
          if (err) return serverError(res, err);
          res.json({ ok: true });
        });
      }
    }
  });

  // 刪除用戶（管理員專用，需二次驗證）
  router.delete("/:id", requireAuth, requireRole('admin'), (req, res) => {
    const { id } = req.params;
    const adminPassword = req.body?.adminPassword;
    
    // 必須提供管理員密碼進行二次驗證
    if (!adminPassword) {
      return res.status(400).json({ error: "此操作需要輸入管理員密碼進行驗證", requiresVerification: true });
    }

    db.get("SELECT password, role FROM users WHERE id=?", [req.user.id], (err, admin) => {
      if (err) return serverError(res, err);
      if (!admin || admin.role !== 'admin') {
        return res.status(403).json({ error: "無權限執行此操作" });
      }
      
      if (!verifyPassword(adminPassword, admin.password)) {
        return res.status(401).json({ error: "管理員密碼不正確" });
      }

      deleteUser();
    });

    function deleteUser() {
      // 先刪除相關數據（處理外鍵約束）- 忽略不存在的表
      const deleteRelatedData = () => {
        return new Promise((resolve) => {
          // 刪除用戶的預約記錄
          db.run("DELETE FROM bookings WHERE user_id=?", [id], () => {
            // 刪除用戶的付款記錄
            db.run("DELETE FROM payments WHERE user_id=?", [id], () => {
              // 刪除用戶的回饋記錄
              db.run("DELETE FROM feedback WHERE user_id=?", [id], () => {
                // 刪除用戶的登入嘗試記錄（忽略錯誤）
                db.run("DELETE FROM login_attempts WHERE username IN (SELECT username FROM users WHERE id=?)", [id], () => {
                  resolve();
                });
              });
            });
          });
        });
      };
      
      deleteRelatedData().then(() => {
        // 解綁醫師資料（如果是醫師帳號）
        db.run("UPDATE doctors SET user_id = NULL WHERE user_id = ?", [id], () => {
          // 最後刪除用戶
          db.run("DELETE FROM users WHERE id=?", [id], function (err) {
            if (err) return serverError(res, err);
            res.json({ ok: true });
          });
        });
      });
    }
  });

  // 修改會員ID（每年只能修改一次）
  router.put("/:id/username", requireAuth, (req, res) => {
    const { id } = req.params;
    const { newUsername } = req.body;

    // 只能修改自己或管理員修改其他用戶
    if (!isSelfOrAdmin(req, id)) {
      return res.status(403).json({ error: "無權限修改此會員ID" });
    }
    
    if (!newUsername || !newUsername.trim()) {
      return res.status(400).json({ error: "請提供新的會員ID" });
    }
    
    const trimmedUsername = newUsername.trim();
    
    if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
      return res.status(400).json({ error: "會員ID只能包含英文字母、數字和底線" });
    }
    
    if (trimmedUsername.length < 3 || trimmedUsername.length > 20) {
      return res.status(400).json({ error: "會員ID長度必須在 3-20 個字符之間" });
    }
    
    db.get("SELECT username, username_last_changed FROM users WHERE id=?", [id], (err, user) => {
      if (err) return serverError(res, err);
      if (!user) return res.status(404).json({ error: "用戶不存在" });
      
      // 檢查是否在一年內已修改過
      if (user.username_last_changed) {
        const lastChanged = new Date(user.username_last_changed);
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        
        if (lastChanged > oneYearAgo) {
          const nextChangeDate = new Date(lastChanged);
          nextChangeDate.setFullYear(nextChangeDate.getFullYear() + 1);
          return res.status(400).json({ 
            error: `會員ID每年只能修改一次，下次可修改時間：${nextChangeDate.toLocaleDateString('zh-TW')}`,
            nextChangeDate: nextChangeDate.toISOString()
          });
        }
      }
      
      if (user.username === trimmedUsername) {
        return res.json({ ok: true, message: "會員ID未變更" });
      }
      
      db.get("SELECT id FROM users WHERE username=? AND id!=?", [trimmedUsername, id], (err, existing) => {
        if (err) return serverError(res, err);
        if (existing) return res.status(400).json({ error: "此會員ID已被使用，請選擇其他ID" });
        
        const now = new Date().toISOString();
        db.run(
          "UPDATE users SET username=?, username_last_changed=? WHERE id=?",
          [trimmedUsername, now, id],
          function(err) {
            if (err) return serverError(res, err);
            res.json({ 
              ok: true, 
              message: "會員ID已更新",
              newUsername: trimmedUsername,
              usernameLastChanged: now
            });
          }
        );
      });
    });
  });

  // 修改中文姓名（每年只能修改一次）
  router.put("/:id/name", requireAuth, (req, res) => {
    const { id } = req.params;
    const { newName } = req.body;

    // 只能修改自己或管理員修改其他用戶
    if (!isSelfOrAdmin(req, id)) {
      return res.status(403).json({ error: "無權限修改此用戶姓名" });
    }
    
    if (!newName || !newName.trim()) {
      return res.status(400).json({ error: "請提供新的中文姓名" });
    }
    
    const trimmedName = newName.trim();
    
    if (trimmedName.length < 2 || trimmedName.length > 20) {
      return res.status(400).json({ error: "中文姓名長度必須在 2-20 個字符之間" });
    }
    
    db.get("SELECT name, name_last_changed FROM users WHERE id=?", [id], (err, user) => {
      if (err) return serverError(res, err);
      if (!user) return res.status(404).json({ error: "用戶不存在" });
      
      if (user.name_last_changed) {
        const lastChanged = new Date(user.name_last_changed);
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        
        if (lastChanged > oneYearAgo) {
          const nextChangeDate = new Date(lastChanged);
          nextChangeDate.setFullYear(nextChangeDate.getFullYear() + 1);
          return res.status(400).json({ 
            error: `中文姓名每年只能修改一次，下次可修改時間：${nextChangeDate.toLocaleDateString('zh-TW')}`,
            nextChangeDate: nextChangeDate.toISOString()
          });
        }
      }
      
      if (user.name === trimmedName) {
        return res.json({ ok: true, message: "中文姓名未變更" });
      }
      
      // 檢查姓名是否已被其他用戶使用
      db.get("SELECT id FROM users WHERE name=? AND id!=?", [trimmedName, id], (err, existing) => {
        if (err) return serverError(res, err);
        if (existing) return res.status(400).json({ error: "此中文姓名已被其他用戶使用，請使用不同的姓名" });
        
        const now = new Date().toISOString();
        db.run(
          "UPDATE users SET name=?, name_last_changed=? WHERE id=?",
          [trimmedName, now, id],
          function(err) {
            if (err) return serverError(res, err);
            res.json({ 
              ok: true, 
              message: "中文姓名已更新",
              newName: trimmedName,
              nameLastChanged: now
            });
          }
        );
      });
    });
  });

  // 完成個人資料
  router.patch("/:username/complete-profile", requireAuth, (req, res) => {
    const { username } = req.params;

    // 只能完成自己的資料
    if (req.user.username !== username) {
      return res.status(403).json({ error: "無權限操作" });
    }
    
    db.run(
      "UPDATE users SET profile_completed=1 WHERE username=?",
      [username],
      function(err) {
        if (err) return serverError(res, err);
        if (this.changes === 0) {
          return res.status(404).json({ error: "用戶不存在" });
        }
        res.json({ ok: true, message: "個人資料狀態已更新" });
      }
    );
  });

  return router;
};
