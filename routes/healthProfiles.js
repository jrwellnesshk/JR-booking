const { serverError } = require('../services/httpResp');

const express = require('express');
const router = express.Router();

// 客人健康檔案（長期病患 / 長期服用藥 / 過往病歷）
// 設計：Phase 1 客人自填（GET/PUT /me）+ 醫護唯讀搜尋（GET /search、GET /user/:user_id）
//       Phase 2 醫師確認：醫師/員工/管理員可代為補充修正（PUT /user/:user_id），
//       只有 doctor 角色嘅修改會寫入「醫師已確認」標記（verified_by / verified_at）；
//       客人其後再自行改動內容 → 確認標記自動作廢（避免標記與內容不一致）。
// 欄位長度上限（防止濫用）
const FIELD_LIMIT = 5000;

const cleanText = (v) => {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, FIELD_LIMIT);
};

// 共用的健康檔案欄位選取（帶出確認醫師名）
const PROFILE_SELECT = `
  SELECT hp.chronic_conditions, hp.long_term_medications, hp.medical_history,
         hp.source, hp.updated_at, hp.verified_at,
         vu.name AS verified_by_name, vu.role AS verified_by_role
  FROM customer_health_profiles hp
  LEFT JOIN users vu ON vu.id = hp.verified_by`;

const emptyProfile = () => ({
  chronic_conditions: '', long_term_medications: '', medical_history: '',
  source: 'customer', updated_at: null, verified_at: null,
  verified_by_name: null, verified_by_role: null,
});

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
      `${PROFILE_SELECT} WHERE hp.user_id=?`,
      [req.userId],
      (err, row) => {
        if (err) return serverError(res, err);
        res.json({ success: true, profile: row || emptyProfile() });
      }
    );
  });

  // 🙋 客人：填寫／更新自己的健康檔案（upsert，只可改自己嗰份）
  // 內容有變動 → 清除「醫師已確認」標記（verified_by / verified_at）
  router.put('/me', requireAuth, (req, res) => {
    const body = req.body || {};
    const chronic = cleanText(body.chronic_conditions);
    const meds = cleanText(body.long_term_medications);
    const history = cleanText(body.medical_history);

    db.get(
      `SELECT chronic_conditions, long_term_medications, medical_history
       FROM customer_health_profiles WHERE user_id=?`,
      [req.userId],
      (e, cur) => {
        if (e) return serverError(res, e);
        const changed = !cur
          || (cur.chronic_conditions || '') !== chronic
          || (cur.long_term_medications || '') !== meds
          || (cur.medical_history || '') !== history;
        // changed 由程式判斷（非用戶輸入），安全拼接進 SQL
        const invalidate = changed ? ', verified_by=NULL, verified_at=NULL' : '';

        db.run(
          `INSERT INTO customer_health_profiles (user_id, chronic_conditions, long_term_medications, medical_history, source, updated_by, updated_at)
           VALUES (?, ?, ?, ?, 'customer', ?, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id) DO UPDATE SET
             chronic_conditions=excluded.chronic_conditions,
             long_term_medications=excluded.long_term_medications,
             medical_history=excluded.medical_history,
             source='customer',
             updated_by=excluded.updated_by,
             updated_at=CURRENT_TIMESTAMP${invalidate}`,
          [req.userId, chronic, meds, history, req.userId],
          function (err) {
            if (err) return serverError(res, err);
            res.json({
              success: true,
              message: '健康檔案已更新',
              verification_kept: !changed,
            });
          }
        );
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
          `${PROFILE_SELECT} WHERE hp.user_id=?`,
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
                  profile: profile || emptyProfile(),
                  records: records || [],
                  can_edit: true,
                  can_verify: !!(req.user && ['doctor', 'staff', 'admin'].includes(req.user.role)),
                  viewer_role: (req.user && req.user.role) || null,
                });
              }
            );
          }
        );
      }
    );
  });

  // ✍️ 醫護（醫師/員工/管理員）：代客人補充或修正健康檔案
  // - 診所端（醫師/員工/管理員）儲存 → 一併寫入「已確認」標記（verified_by / verified_at）
  // - 客人其後自行改動 → 標記自動作廢（見 PUT /me），確保標記同內容一致
  router.put('/user/:user_id', authorizeRole(['doctor', 'staff', 'admin']), (req, res) => {
    const userId = Number.parseInt(req.params.user_id, 10);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: '無效的用戶 ID' });

    const body = req.body || {};
    const chronic = cleanText(body.chronic_conditions);
    const meds = cleanText(body.long_term_medications);
    const history = cleanText(body.medical_history);
    const source = (req.user && req.user.role) || 'staff';

    db.get("SELECT id FROM users WHERE id=? AND role='customer'", [userId], (e, user) => {
      if (e) return serverError(res, e);
      if (!user) return res.status(404).json({ error: '客人不存在' });

      db.run(
        `INSERT INTO customer_health_profiles (user_id, chronic_conditions, long_term_medications, medical_history, source, updated_by, verified_by, verified_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id) DO UPDATE SET
           chronic_conditions=excluded.chronic_conditions,
           long_term_medications=excluded.long_term_medications,
           medical_history=excluded.medical_history,
           source=excluded.source,
           updated_by=excluded.updated_by,
           verified_by=excluded.verified_by,
           verified_at=CURRENT_TIMESTAMP,
           updated_at=CURRENT_TIMESTAMP`,
        [userId, chronic, meds, history, source, req.userId, req.userId],
        function (err) {
          if (err) return serverError(res, err);
          res.json({ success: true, message: '健康檔案已更新', verified: true });
        }
      );
    });
  });

  // ✅ 醫師／員工／管理員：確認客人現有內容正確（唔改內容，只寫確認標記）
  router.post('/user/:user_id/verify', authorizeRole(['doctor', 'staff', 'admin']), (req, res) => {
    const userId = Number.parseInt(req.params.user_id, 10);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: '無效的用戶 ID' });

    db.get("SELECT id FROM users WHERE id=? AND role='customer'", [userId], (e, user) => {
      if (e) return serverError(res, e);
      if (!user) return res.status(404).json({ error: '客人不存在' });

      db.run(
        `UPDATE customer_health_profiles SET verified_by=?, verified_at=CURRENT_TIMESTAMP WHERE user_id=?`,
        [req.userId, userId],
        function (err) {
          if (err) return serverError(res, err);
          if (this.changes === 0) return res.status(404).json({ error: '此客人尚未填寫健康檔案' });
          res.json({ success: true, message: '已標記為醫師確認', verified: true });
        }
      );
    });
  });

  return router;
};
