const { serverError } = require("../services/httpResp");
/**
 * 設定路由
 * 包括：診所設定、API設定、醫師管理、服務管理
 */

const express = require('express');
const router = express.Router();

module.exports = (db, { requireAuth, requireRole } = {}) => {

  // 全部設定路由均需管理員權限（GET /doctors + GET /services 例外：公開官網要展示）
  router.use((req, res, next) => {
    if (req.method === 'GET' && (req.path === '/doctors' || req.path === '/services')) {
      return next();
    }
    return requireAuth(req, res, () => requireRole('admin')(req, res, next));
  });

  // ==================== 診所設定 ====================

  // 取得診所設定
  router.get("/clinic", (req, res) => {
    db.all("SELECT * FROM clinic_settings", [], (err, rows) => {
      if (err) return serverError(res, err);
      
      const settings = {};
      rows.forEach(row => {
        settings[row.setting_key] = row.setting_value;
      });
      
      res.json(settings);
    });
  });

  // 更新診所設定
  router.put("/clinic", (req, res) => {
    const { tuina_beds, acupuncture_beds, vip_rooms, total_doctors, closed_days, holidays_enabled, working_holidays, open_months,
            custom_closed_dates, custom_open_dates,
            morning_start, morning_end, afternoon_start, afternoon_end, slot_interval,
            saturday_start, saturday_end,
            tuina_bed_names, acupuncture_bed_names, vip_bed_names,
            sms_notification_enabled, whatsapp_notification_enabled, email_notification_enabled } = req.body;
    
    const updates = [];
    if (tuina_beds !== undefined) updates.push({ key: 'tuina_beds', value: tuina_beds });
    if (acupuncture_beds !== undefined) updates.push({ key: 'acupuncture_beds', value: acupuncture_beds });
    if (vip_rooms !== undefined) updates.push({ key: 'vip_rooms', value: vip_rooms });
    if (total_doctors !== undefined) updates.push({ key: 'total_doctors', value: total_doctors });
    // 床位自訂名稱（陣列 → JSON 字串）
    if (tuina_bed_names !== undefined) {
      const v = Array.isArray(tuina_bed_names) ? JSON.stringify(tuina_bed_names) : String(tuina_bed_names);
      updates.push({ key: 'tuina_bed_names', value: v });
    }
    if (acupuncture_bed_names !== undefined) {
      const v = Array.isArray(acupuncture_bed_names) ? JSON.stringify(acupuncture_bed_names) : String(acupuncture_bed_names);
      updates.push({ key: 'acupuncture_bed_names', value: v });
    }
    if (vip_bed_names !== undefined) {
      const v = Array.isArray(vip_bed_names) ? JSON.stringify(vip_bed_names) : String(vip_bed_names);
      updates.push({ key: 'vip_bed_names', value: v });
    }
    if (closed_days !== undefined) updates.push({ key: 'closed_days', value: closed_days });
    if (holidays_enabled !== undefined) updates.push({ key: 'holidays_enabled', value: holidays_enabled });
    if (working_holidays !== undefined) updates.push({ key: 'working_holidays', value: working_holidays });
    if (open_months !== undefined) updates.push({ key: 'open_months', value: open_months });
    // 自訂特別日期設定
    if (custom_closed_dates !== undefined) updates.push({ key: 'custom_closed_dates', value: custom_closed_dates });
    if (custom_open_dates !== undefined) updates.push({ key: 'custom_open_dates', value: custom_open_dates });
    // 營業時間設定
    if (morning_start !== undefined) updates.push({ key: 'morning_start', value: morning_start });
    if (morning_end !== undefined) updates.push({ key: 'morning_end', value: morning_end });
    if (afternoon_start !== undefined) updates.push({ key: 'afternoon_start', value: afternoon_start });
    if (afternoon_end !== undefined) updates.push({ key: 'afternoon_end', value: afternoon_end });
    if (slot_interval !== undefined) updates.push({ key: 'slot_interval', value: slot_interval });
    // 🕐 功能5：星期六營業時間（預設 10:00-13:00）
    if (saturday_start !== undefined) updates.push({ key: 'saturday_start', value: saturday_start });
    if (saturday_end !== undefined) updates.push({ key: 'saturday_end', value: saturday_end });
    // SMS/WhatsApp/Email 通知設定
    if (sms_notification_enabled !== undefined) updates.push({ key: 'sms_notification_enabled', value: sms_notification_enabled });
    if (whatsapp_notification_enabled !== undefined) updates.push({ key: 'whatsapp_notification_enabled', value: whatsapp_notification_enabled });
    if (email_notification_enabled !== undefined) updates.push({ key: 'email_notification_enabled', value: email_notification_enabled });
    
    if (updates.length === 0) {
      return res.status(400).json({ error: "沒有要更新的設定" });
    }
    
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO clinic_settings (setting_key, setting_value, updated_at) 
       VALUES (?, ?, CURRENT_TIMESTAMP)`
    );
    
    updates.forEach(update => {
      stmt.run(update.key, String(update.value));
    });
    
    stmt.finalize(err => {
      if (err) return serverError(res, err);
      res.json({ success: true, message: "診所設定已更新" });
    });
  });

  // ==================== API 設定 ====================

  // 取得 API 設定（🔒 敏感值遮罩，避免完整密鑰外洩；寫入仍可用完整值更新）
  const MASK_KEYS = new Set(['whatsapp_token', 'ai_key', 'email_pass']);
  const maskValue = (v) => {
    if (v == null || v === '') return '';
    const s = String(v);
    if (s.length <= 4) return '****';
    return s.slice(0, 2) + '****' + s.slice(-2);
  };
  router.get("/api", (req, res) => {
    db.all("SELECT * FROM api_settings", [], (err, rows) => {
      if (err) return serverError(res, err);

      const settings = {};
      rows.forEach(row => {
        settings[row.setting_key] = MASK_KEYS.has(row.setting_key)
          ? maskValue(row.setting_value)
          : row.setting_value;
      });

      res.json(settings);
    });
  });

  // 更新 API 設定
  router.put("/api", (req, res) => {
    const { whatsapp_url, whatsapp_token, ai_url, ai_key, email_user, email_pass, email_from } = req.body;
    
    const updates = [];
    if (whatsapp_url !== undefined) updates.push({ key: 'whatsapp_url', value: whatsapp_url });
    if (whatsapp_token !== undefined) updates.push({ key: 'whatsapp_token', value: whatsapp_token });
    if (ai_url !== undefined) updates.push({ key: 'ai_url', value: ai_url });
    if (ai_key !== undefined) updates.push({ key: 'ai_key', value: ai_key });
    if (email_user !== undefined) updates.push({ key: 'email_user', value: email_user });
    if (email_pass !== undefined) updates.push({ key: 'email_pass', value: email_pass });
    if (email_from !== undefined) updates.push({ key: 'email_from', value: email_from });
    
    if (updates.length === 0) {
      return res.status(400).json({ error: "沒有要更新的設定" });
    }
    
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO api_settings (setting_key, setting_value, updated_at) 
       VALUES (?, ?, CURRENT_TIMESTAMP)`
    );
    
    updates.forEach(update => {
      stmt.run(update.key, String(update.value));
    });
    
    stmt.finalize(err => {
      if (err) return serverError(res, err);
      res.json({ success: true, message: "API 設定已更新" });
    });
  });

  // ==================== 醫師管理 ====================

  // 取得所有醫師
  router.get("/doctors", (req, res) => {
    db.all("SELECT * FROM doctors WHERE is_active=1 ORDER BY id ASC", [], (err, rows) => {
      if (err) return serverError(res, err);
      res.json(rows);
    });
  });

  // 新增醫師
  router.post("/doctors", (req, res) => {
    const { name, specialty } = req.body;
    if (!name || !specialty) {
      return res.status(400).json({ error: "缺少必要欄位" });
    }
    
    db.run(
      "INSERT INTO doctors (name, specialty, is_active) VALUES (?, ?, 1)",
      [name, specialty],
      function(err) {
        if (err) return serverError(res, err);
        res.json({ success: true, id: this.lastID });
      }
    );
  });

  // 更新醫師
  router.put("/doctors/:id", (req, res) => {
    const { id } = req.params;
    const { name, specialty } = req.body;
    
    db.run(
      "UPDATE doctors SET name=?, specialty=? WHERE id=?",
      [name, specialty, id],
      function(err) {
        if (err) return serverError(res, err);
        res.json({ success: true });
      }
    );
  });

  // 刪除醫師（軟刪除）
  router.delete("/doctors/:id", (req, res) => {
    const { id } = req.params;
    
    db.run(
      "UPDATE doctors SET is_active=0 WHERE id=?",
      [id],
      function(err) {
        if (err) return serverError(res, err);
        res.json({ success: true });
      }
    );
  });

  // ==================== 服務管理 ====================

  // 取得所有服務
  router.get("/services", (req, res) => {
    db.all("SELECT * FROM services ORDER BY id ASC", [], (err, rows) => {
      if (err) return serverError(res, err);
      res.json(rows);
    });
  });

  // 新增服務
  router.post("/services", (req, res) => {
    const { name, duration, price } = req.body;
    if (!name || !duration) {
      return res.status(400).json({ error: "缺少必要欄位" });
    }
    
    // 先獲取最大的服務ID來生成新ID
    db.get("SELECT id FROM services ORDER BY id DESC LIMIT 1", (err, row) => {
      let newId = 'S1';
      if (!err && row) {
        const match = row.id.match(/S(\d+)/);
        if (match) {
          newId = `S${parseInt(match[1]) + 1}`;
        }
      }
      
      db.run(
        "INSERT INTO services (id, name, duration, price) VALUES (?, ?, ?, ?)",
        [newId, name, duration, price || 0],
        function(err) {
          if (err) return serverError(res, err);
          res.json({ success: true, id: newId });
        }
      );
    });
  });

  // 更新服務
  router.put("/services/:id", (req, res) => {
    const { id } = req.params;
    const { name, duration, price } = req.body;
    
    db.run(
      "UPDATE services SET name=?, duration=?, price=? WHERE id=?",
      [name, duration, price || 0, id],
      function(err) {
        if (err) return serverError(res, err);
        if (this.changes === 0) {
          return res.status(404).json({ error: "服務不存在" });
        }
        res.json({ success: true });
      }
    );
  });

  // 刪除服務
  router.delete("/services/:id", (req, res) => {
    const { id } = req.params;
    
    db.run(
      "DELETE FROM services WHERE id=?",
      [id],
      function(err) {
        if (err) return serverError(res, err);
        res.json({ success: true });
      }
    );
  });

  // ==================== 通用設定 API ====================
  // 用於讀取/更新單一設定項目（如 SMS、WhatsApp 通知開關）

  // 讀取單一設定
  router.get("/:key", (req, res) => {
    const { key } = req.params;
    
    db.get("SELECT setting_value FROM clinic_settings WHERE setting_key = ?", [key], (err, row) => {
      if (err) return serverError(res, err);
      
      if (!row) {
        // 如果設定不存在，返回預設值
        return res.json({ key, value: 'false' });
      }
      
      res.json({ key, value: row.setting_value });
    });
  });

  // 更新單一設定
  router.put("/:key", (req, res) => {
    const { key } = req.params;
    const { value } = req.body;
    
    if (value === undefined) {
      return res.status(400).json({ error: "缺少 value 參數" });
    }
    
    db.run(
      `INSERT OR REPLACE INTO clinic_settings (setting_key, setting_value, updated_at) VALUES (?, ?, datetime('now', 'localtime'))`,
      [key, String(value)],
      function(err) {
        if (err) return serverError(res, err);
        res.json({ success: true, key, value: String(value) });
      }
    );
  });

  return router;
};
