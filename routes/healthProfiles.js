const { serverError } = require('../services/httpResp');

const express = require('express');
const router = express.Router();

// 客人健康檔案（長期病患 / 長期服用藥 / 過往病歷）
// 設計：Phase 1 客人自填（GET/PUT /me）+ 醫護唯讀搜尋（GET /search、GET /user/:user_id）
// 欄位長度上限（防止濫用）
const FIELD_LIMIT = 5000;

const cleanText = (v) => {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, FIELD_LIMIT);
};

module.exports = (db, { requireAuth, requireRole } = {}) => {

  // 中間件：驗證 JWT 身份 + 角色（與 medicalRecords.js 同一 pattern）
  const authorizeRole = (roles) => (req, res, next) => {
    requireAuth(req, res, (err) => {
      if (err) return next(err);
      requireRole(...roles)(req, res, next);
    });
  };

  // 🙋 客人：讀取自己的健康檔案（未填過 → 空殼，前端顯示引導填寫）
  router.get('/me', requireAuth, (req, res) => {
    db.get(
      `SELECT chronic_conditions, long_term_medications, medical_history, source, updated_at
       FROM customer_health_profiles WHERE user_id=?`,
      [req.userId],
      (err, row) => {
        if (err) return serverError(res, err);
        res.json({
          success: true,
          profile: row || { chronic_conditions: '', long_term_medications: '', medical_history: '', source: 'customer', updated_at: null },
        });
      }
    );
  });

  // 🙋 客人：填寫／更新自己的健康檔案（upsert，只可改自己嗰份）
  router.put('/me', requireAuth, (req, res) => {
    const body = req.body || {};
    const chronic = cleanText(body.chronic_conditions);
    const meds = cleanText(body.long_term_medications);
    const history = cleanText(body.medical_history);

    db.run(
      `INSERT INTO customer_health_profiles (user_id, chronic_conditions, long_term_medications, medical_history, source, updated_at)
       VALUES (?, ?, ?, ?, 'customer', CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         chronic_conditions=excluded.chronic_conditions,
         long_term_medications=excluded.long_term_medications,
         medical_history=excluded.medical_history,
         source='customer',
         updated_at=CURRENT_TIMESTAMP`,
      [req.userId, chronic, meds, history],
      function (err) {
        if (err) return serverError(res, err);
        res.json({ success: true, message: '健康檔案已更新' });
      }
    );
  });

  // 🔍 醫護：搜尋客人（姓名 / 電話 / 會員編號 / 電郵 / ID），只回基本資料 + 檔案填寫狀態
  router.get('/search', authorizeRole(['doctor', 'staff', 'admin']), (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ success: true, results: [] });

    // LIKE 萬用字元轉義，防止輸入 % _ 影響結果
    const escaped = q.replace(/([%_\\])/g, '\\$1');
    const like = `%${escaped}%`;
    const exactId = Number.parseInt(q, 10);

    const sql = `
      SELECT u.id, u.name, u.phone, u.email, u.member_no, u.membership_tier,
             CASE WHEN hp.id IS NULL THEN 0 ELSE 1 END AS has_profile,
             hp.updated_at AS profile_updated_at
      FROM users u
      LEFT JOIN customer_health_profiles hp ON hp.user_id = u.id
      WHERE u.role = 'customer'
        AND (u.name LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\' OR u.member_no LIKE ? ESCAPE '\\'
             OR u.email LIKE ? ESCAPE '\\' ${Number.isFinite(exactId) && String(exactId) === q ? 'OR u.id = ?' : ''})
      ORDER BY CASE WHEN u.name = ? THEN 0 ELSE 1 END, u.name
      LIMIT 20`;
    const params = [like, like, like, like];
    if (Number.isFinite(exactId) && String(exactId) === q) params.push(exactId);
    params.push(q);

    db.all(sql, params, (err, rows) => {
      if (err) return serverError(res, err);
      res.json({ success: true, results: rows });
    });
  });

  // 📋 醫護：查看單一客人嘅完整健康檔案 + 病歷摘要（唯讀）
  router.get('/user/:user_id', authorizeRole(['doctor', 'staff', 'admin']), (req, res) => {
    const userId = Number.parseInt(req.params.user_id, 10);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: '無效的用戶 ID' });

    db.get(
      `SELECT u.id, u.name, u.username, u.phone, u.email, u.member_no, u.membership_tier, u.birth_date
       FROM users u WHERE u.id=? AND u.role='customer'`,
      [userId],
      (err, user) => {
        if (err) return serverError(res, err);
        if (!user) return res.status(404).json({ error: '客人不存在' });

        db.get(
          `SELECT chronic_conditions, long_term_medications, medical_history, source, updated_at
           FROM customer_health_profiles WHERE user_id=?`,
          [userId],
          (err2, profile) => {
            if (err2) return serverError(res, err2);

            // 病歷摘要（最近 20 條 + 相片數量），診斷醫師名一併帶出
            db.all(
              `SELECT mr.id, mr.record_date, mr.diagnosis, mr.treatment_plan, mr.notes,
                      (SELECT COUNT(*) FROM medical_record_photos p WHERE p.medical_record_id = mr.id) AS photo_count,
                      du.name AS doctor_name
               FROM medical_records mr
               LEFT JOIN users du ON du.id = mr.doctor_user_id
               WHERE mr.user_id=?
               ORDER BY mr.record_date DESC, mr.id DESC
               LIMIT 20`,
              [userId],
              (err3, records) => {
                if (err3) return serverError(res, err3);
                res.json({
                  success: true,
                  user,
                  profile: profile || { chronic_conditions: '', long_term_medications: '', medical_history: '', source: 'customer', updated_at: null },
                  records: records || [],
                });
              }
            );
          }
        );
      }
    );
  });

  return router;
};
