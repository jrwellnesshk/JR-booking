/**
 * 醫療分流路由
 * 提供分流問題查詢和管理功能
 */

const express = require("express");

module.exports = function (db, { requireAuth, requireRole } = {}) {
  const router = express.Router();

  // ==================== 用戶端 API ====================

  /**
   * GET /api/triage/questions
   * 獲取所有啟用的分流問題和選項
   */
  router.get("/questions", (req, res) => {
    db.all(
      `SELECT id, question_zh, question_en, sort_order 
       FROM triage_questions 
       WHERE is_active = 1 
       ORDER BY sort_order ASC`,
      [],
      (err, questions) => {
        if (err) {
          console.error("獲取分流問題失敗:", err);
          return res.status(500).json({ error: "獲取問題失敗" });
        }

        // 獲取每個問題的選項
        const questionIds = questions.map(q => q.id);
        if (questionIds.length === 0) {
          return res.json({ questions: [] });
        }

        const placeholders = questionIds.map(() => "?").join(",");
        db.all(
          `SELECT id, question_id, option_zh, option_en, scores, sort_order 
           FROM triage_options 
           WHERE question_id IN (${placeholders}) 
           ORDER BY sort_order ASC`,
          questionIds,
          (err, options) => {
            if (err) {
              console.error("獲取分流選項失敗:", err);
              return res.status(500).json({ error: "獲取選項失敗" });
            }

            // 將選項分配給對應問題
            const questionsWithOptions = questions.map(q => ({
              ...q,
              options: options
                .filter(o => o.question_id === q.id)
                .map(o => ({
                  ...o,
                  scores: JSON.parse(o.scores || "{}")
                }))
            }));

            res.json({ questions: questionsWithOptions });
          }
        );
      }
    );
  });

  /**
   * GET /api/triage/doctors
   * 獲取醫師與服務的對應關係
   */
  router.get("/doctors", (req, res) => {
    db.all(
      "SELECT id, name, specialty FROM doctors WHERE is_active = 1 ORDER BY id",
      [],
      (err, doctors) => {
        if (err) {
          console.error("獲取醫師失敗:", err);
          return res.status(500).json({ error: "獲取醫師失敗" });
        }

        db.all(
          "SELECT id, name FROM services ORDER BY id",
          [],
          (err, services) => {
            if (err) {
              console.error("獲取服務失敗:", err);
              return res.status(500).json({ error: "獲取服務失敗" });
            }

            // 建立醫師與服務的對應關係
            const doctorServiceMap = doctors.map((doc, index) => {
              // 根據醫師專科匹配服務
              let serviceId = null;
              let serviceName = null;
              
              if (doc.specialty.includes("推拿") && doc.specialty.includes("針灸")) {
                // 推拿+針灸
                const svc = services.find(s => s.name.includes("推拿") && s.name.includes("針灸"));
                if (svc) {
                  serviceId = svc.id;
                  serviceName = svc.name;
                }
              } else if (doc.specialty.includes("推拿")) {
                const svc = services.find(s => s.name.includes("推拿") && !s.name.includes("針灸"));
                if (svc) {
                  serviceId = svc.id;
                  serviceName = svc.name;
                }
              } else if (doc.specialty.includes("針灸") || doc.specialty.includes("鍼灸")) {
                const svc = services.find(s => (s.name.includes("針灸") || s.name.includes("鍼灸")) && !s.name.includes("推拿"));
                if (svc) {
                  serviceId = svc.id;
                  serviceName = svc.name;
                }
              } else if (doc.specialty.includes("綜合")) {
                const svc = services.find(s => s.name.includes("綜合") || s.name.includes("諮詢"));
                if (svc) {
                  serviceId = svc.id;
                  serviceName = svc.name;
                }
              }

              // 如果沒找到匹配，使用第一個服務
              if (!serviceId && services.length > 0) {
                serviceId = services[0].id;
                serviceName = services[0].name;
              }

              return {
                doctorId: `d${index + 1}`,
                doctorDbId: doc.id,
                doctorName: doc.name,
                specialty: doc.specialty,
                serviceId: serviceId,
                serviceName: serviceName
              };
            });

            res.json({ 
              doctors: doctorServiceMap,
              services: services
            });
          }
        );
      }
    );
  });

  // ==================== 管理員 API（需管理員權限） ====================

  // 管理員權限保護所有 /admin/* 路由
  router.use("/admin", requireAuth, requireRole('admin'));

  /**
   * GET /api/triage/admin/questions
   * 管理員獲取所有分流問題（包括停用的）
   */
  router.get("/admin/questions", (req, res) => {
    db.all(
      `SELECT id, question_zh, question_en, sort_order, is_active, created_at 
       FROM triage_questions 
       ORDER BY sort_order ASC`,
      [],
      (err, questions) => {
        if (err) {
          console.error("獲取分流問題失敗:", err);
          return res.status(500).json({ error: "獲取問題失敗" });
        }

        const questionIds = questions.map(q => q.id);
        if (questionIds.length === 0) {
          return res.json({ questions: [] });
        }

        const placeholders = questionIds.map(() => "?").join(",");
        db.all(
          `SELECT id, question_id, option_zh, option_en, scores, sort_order 
           FROM triage_options 
           WHERE question_id IN (${placeholders}) 
           ORDER BY sort_order ASC`,
          questionIds,
          (err, options) => {
            if (err) {
              console.error("獲取分流選項失敗:", err);
              return res.status(500).json({ error: "獲取選項失敗" });
            }

            const questionsWithOptions = questions.map(q => ({
              ...q,
              options: options
                .filter(o => o.question_id === q.id)
                .map(o => ({
                  ...o,
                  scores: JSON.parse(o.scores || "{}")
                }))
            }));

            res.json({ questions: questionsWithOptions });
          }
        );
      }
    );
  });

  /**
   * POST /api/triage/admin/questions
   * 新增分流問題
   */
  router.post("/admin/questions", (req, res) => {
    const { question_zh, question_en, sort_order, options } = req.body;

    if (!question_zh || !question_en) {
      return res.status(400).json({ error: "請提供中文和英文問題" });
    }

    db.run(
      `INSERT INTO triage_questions (question_zh, question_en, sort_order, is_active) 
       VALUES (?, ?, ?, 1)`,
      [question_zh, question_en, sort_order || 0],
      function (err) {
        if (err) {
          console.error("新增分流問題失敗:", err);
          return res.status(500).json({ error: "新增問題失敗" });
        }

        const questionId = this.lastID;

        // 如果有選項，一併插入
        if (options && Array.isArray(options) && options.length > 0) {
          const stmt = db.prepare(
            `INSERT INTO triage_options (question_id, option_zh, option_en, scores, sort_order) 
             VALUES (?, ?, ?, ?, ?)`
          );

          options.forEach((opt, index) => {
            stmt.run(
              questionId,
              opt.option_zh,
              opt.option_en,
              JSON.stringify(opt.scores || {}),
              opt.sort_order || index + 1
            );
          });

          stmt.finalize();
        }

        res.json({ ok: true, id: questionId });
      }
    );
  });

  /**
   * PUT /api/triage/admin/questions/:id
   * 更新分流問題
   */
  router.put("/admin/questions/:id", (req, res) => {
    const { id } = req.params;
    const { question_zh, question_en, sort_order, is_active } = req.body;

    db.run(
      `UPDATE triage_questions 
       SET question_zh = ?, question_en = ?, sort_order = ?, is_active = ?
       WHERE id = ?`,
      [question_zh, question_en, sort_order, is_active ? 1 : 0, id],
      function (err) {
        if (err) {
          console.error("更新分流問題失敗:", err);
          return res.status(500).json({ error: "更新問題失敗" });
        }

        res.json({ ok: true });
      }
    );
  });

  /**
   * DELETE /api/triage/admin/questions/:id
   * 刪除分流問題（同時刪除其選項）
   */
  router.delete("/admin/questions/:id", (req, res) => {
    const { id } = req.params;

    // 先刪除選項
    db.run("DELETE FROM triage_options WHERE question_id = ?", [id], (err) => {
      if (err) {
        console.error("刪除選項失敗:", err);
        return res.status(500).json({ error: "刪除選項失敗" });
      }

      // 再刪除問題
      db.run("DELETE FROM triage_questions WHERE id = ?", [id], function (err) {
        if (err) {
          console.error("刪除問題失敗:", err);
          return res.status(500).json({ error: "刪除問題失敗" });
        }

        res.json({ ok: true });
      });
    });
  });

  /**
   * POST /api/triage/admin/options
   * 新增選項
   */
  router.post("/admin/options", (req, res) => {
    const { question_id, option_zh, option_en, scores, sort_order } = req.body;

    if (!question_id || !option_zh || !option_en) {
      return res.status(400).json({ error: "請提供完整選項資料" });
    }

    db.run(
      `INSERT INTO triage_options (question_id, option_zh, option_en, scores, sort_order) 
       VALUES (?, ?, ?, ?, ?)`,
      [question_id, option_zh, option_en, JSON.stringify(scores || {}), sort_order || 0],
      function (err) {
        if (err) {
          console.error("新增選項失敗:", err);
          return res.status(500).json({ error: "新增選項失敗" });
        }

        res.json({ ok: true, id: this.lastID });
      }
    );
  });

  /**
   * PUT /api/triage/admin/options/:id
   * 更新選項
   */
  router.put("/admin/options/:id", (req, res) => {
    const { id } = req.params;
    const { option_zh, option_en, scores, sort_order } = req.body;

    db.run(
      `UPDATE triage_options 
       SET option_zh = ?, option_en = ?, scores = ?, sort_order = ?
       WHERE id = ?`,
      [option_zh, option_en, JSON.stringify(scores || {}), sort_order, id],
      function (err) {
        if (err) {
          console.error("更新選項失敗:", err);
          return res.status(500).json({ error: "更新選項失敗" });
        }

        res.json({ ok: true });
      }
    );
  });

  /**
   * DELETE /api/triage/admin/options/:id
   * 刪除選項
   */
  router.delete("/admin/options/:id", (req, res) => {
    const { id } = req.params;

    db.run("DELETE FROM triage_options WHERE id = ?", [id], function (err) {
      if (err) {
        console.error("刪除選項失敗:", err);
        return res.status(500).json({ error: "刪除選項失敗" });
      }

      res.json({ ok: true });
    });
  });

  return router;
};
