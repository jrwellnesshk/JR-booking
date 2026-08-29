const express = require("express");

module.exports = (db, { requireAuth, requireRole } = {}) => {
  const router = express.Router();

  // ===== 用戶端 API =====
  
  // 提交意見反饋（需登入，user_id 以 JWT 身份為準）
  router.post("/", requireAuth, (req, res) => {
    const user_id = req.userId;
    const { user_name, user_phone, category, subject, message } = req.body;
    
    if (!subject || !message) {
      return res.status(400).json({ error: "請填寫主題和內容" });
    }
    
    db.run(
      `INSERT INTO feedback (user_id, user_name, user_phone, category, subject, message, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
      [user_id, user_name || '匿名用戶', user_phone || '', category || 'general', subject, message],
      function(err) {
        if (err) {
          console.error("提交意見失敗:", err);
          return res.status(500).json({ error: "提交失敗，請稍後再試" });
        }
        res.json({ 
          success: true, 
          message: "感謝您的意見！我們會認真閱讀並改進服務。",
          feedbackId: this.lastID 
        });
      }
    );
  });
  
  // 獲取自己的反饋記錄（需登入，只限本人）
  router.get("/my-feedback/:userId", requireAuth, (req, res) => {
    const userId = req.userId;
    
    db.all(
      `SELECT id, category, subject, message, status, admin_reply, replied_at, created_at, user_read_reply 
       FROM feedback 
       WHERE user_id = ? 
       ORDER BY created_at DESC`,
      [userId],
      (err, rows) => {
        if (err) {
          console.error("獲取反饋記錄失敗:", err);
          return res.status(500).json({ error: "獲取失敗" });
        }
        res.json(rows || []);
      }
    );
  });
  
  // 獲取自己的未讀回覆數量（需登入，只限本人）
  router.get("/my-feedback/:userId/unread-count", requireAuth, (req, res) => {
    const userId = req.userId;
    
    db.get(
      `SELECT COUNT(*) as count 
       FROM feedback 
       WHERE user_id = ? 
         AND admin_reply IS NOT NULL 
         AND admin_reply != ''
         AND (user_read_reply IS NULL OR user_read_reply = 0)`,
      [userId],
      (err, row) => {
        if (err) {
          console.error("獲取未讀回覆數量失敗:", err);
          return res.status(500).json({ error: "獲取失敗" });
        }
        res.json({ unreadCount: row ? row.count : 0 });
      }
    );
  });
  
  // 標記回覆為已讀（需登入，只限本人）
  router.post("/my-feedback/:feedbackId/mark-read", requireAuth, (req, res) => {
    const { feedbackId } = req.params;
    
    db.run(
      `UPDATE feedback SET user_read_reply = 1 WHERE id = ? AND user_id = ?`,
      [feedbackId, req.userId],
      function(err) {
        if (err) {
          console.error("標記已讀失敗:", err);
          return res.status(500).json({ error: "標記失敗" });
        }
        res.json({ success: true });
      }
    );
  });

  // ===== 管理員 API（需管理員權限） =====

  // 管理員權限保護所有 /admin/* 路由
  router.use("/admin", requireAuth, requireRole('admin'));
  
  // 獲取所有反饋（管理員用）
  router.get("/admin/all", (req, res) => {
    const { status, category, limit = 50, offset = 0 } = req.query;
    
    let sql = "SELECT * FROM feedback";
    const params = [];
    const conditions = [];
    
    if (status && status !== 'all') {
      conditions.push("status = ?");
      params.push(status);
    }
    
    if (category && category !== 'all') {
      conditions.push("category = ?");
      params.push(category);
    }
    
    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    
    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(parseInt(limit), parseInt(offset));
    
    db.all(sql, params, (err, rows) => {
      if (err) {
        console.error("獲取反饋列表失敗:", err);
        return res.status(500).json({ error: "獲取失敗" });
      }
      
      // 獲取統計數據
      db.get(
        "SELECT COUNT(*) as total, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending FROM feedback",
        (err, stats) => {
          res.json({
            data: rows || [],
            total: stats?.total || 0,
            pending: stats?.pending || 0
          });
        }
      );
    });
});

  // 獲取未讀數量（必須定義於 /admin/:id 之前，避免被 :id 捕獲）
  router.get("/admin/unread-count", (req, res) => {
    db.get(
      "SELECT COUNT(*) as count FROM feedback WHERE is_read = 0",
      (err, row) => {
        if (err) {
          console.error("獲取未讀數量失敗:", err);
          return res.status(500).json({ error: "獲取失敗" });
        }
        res.json({ count: row?.count || 0 });
      }
    );
  });

  // 獲取單個反饋詳情
  router.get("/admin/:id", (req, res) => {
    const { id } = req.params;
    
    db.get("SELECT * FROM feedback WHERE id = ?", [id], (err, row) => {
      if (err) {
        console.error("獲取反饋詳情失敗:", err);
        return res.status(500).json({ error: "獲取失敗" });
      }
      if (!row) {
        return res.status(404).json({ error: "找不到該反饋" });
      }
      
      // 標記為已讀
      db.run("UPDATE feedback SET is_read = 1 WHERE id = ?", [id]);
      
      res.json(row);
    });
  });
  
  // 回覆反饋
  router.put("/admin/:id/reply", (req, res) => {
    const { id } = req.params;
    const { reply, status } = req.body;
    
    if (!reply) {
      return res.status(400).json({ error: "請填寫回覆內容" });
    }
    
    db.run(
      `UPDATE feedback SET admin_reply = ?, replied_at = datetime('now', 'localtime'), status = ? WHERE id = ?`,
      [reply, status || 'replied', id],
      function(err) {
        if (err) {
          console.error("回覆反饋失敗:", err);
          return res.status(500).json({ error: "回覆失敗" });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: "找不到該反饋" });
        }
        res.json({ success: true, message: "回覆已發送" });
      }
    );
  });
  
  // 更新反饋狀態
  router.put("/admin/:id/status", (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    
    const validStatuses = ['pending', 'read', 'replied', 'resolved', 'archived'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "無效的狀態" });
    }
    
    db.run(
      "UPDATE feedback SET status = ? WHERE id = ?",
      [status, id],
      function(err) {
        if (err) {
          console.error("更新狀態失敗:", err);
          return res.status(500).json({ error: "更新失敗" });
        }
        res.json({ success: true });
      }
    );
  });
  
  // 刪除反饋
  router.delete("/admin/:id", (req, res) => {
    const { id } = req.params;
    
    db.run("DELETE FROM feedback WHERE id = ?", [id], function(err) {
      if (err) {
        console.error("刪除反饋失敗:", err);
        return res.status(500).json({ error: "刪除失敗" });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: "找不到該反饋" });
      }
      res.json({ success: true, message: "已刪除" });
    });
});

  return router;
};
