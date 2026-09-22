const { serverError } = require("../services/httpResp");
/**
 * 官網內容管理（管理員專用）
 * 公告 / 影片 / 社交媒體連結 / 評價審核 / 討論區管理
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

module.exports = (db, { requireAuth, requireRole } = {}) => {
  const router = express.Router();
  const adminOnly = [requireAuth, requireRole('admin')];
  const adminOrStaff = [requireAuth, requireRole('admin', 'staff')];

  // ==================== 上傳設定 ====================

  const MIME_ALLOWED = {
    // 🔒 不接受 SVG：可夾帶腳本造成 stored XSS
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg',
    '.mov': 'video/quicktime'
  };

  const sanitizeFileName = (original) => {
    const ext = path.extname(original || '').toLowerCase();
    if (!MIME_ALLOWED[ext]) return null;
    const base = path.basename(original, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    return (base || 'file') + '_' + crypto.randomBytes(6).toString('hex') + ext;
  };

  const mkdirSafe = (dir) => {
    const full = path.join(__dirname, '..', 'uploads', dir);
    if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
    return full;
  };

  const videoStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, mkdirSafe('videos')),
    filename: (req, file, cb) => {
      const name = sanitizeFileName(file.originalname);
      if (!name) return cb(new Error('不支援的檔案格式'));
      cb(null, name);
    }
  });

  const uploadVideo = multer({
    storage: videoStorage,
    limits: { fileSize: 200 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, !!MIME_ALLOWED[path.extname(file.originalname).toLowerCase()])
  });

  const SOCIAL_KEYS = ['social_facebook', 'social_instagram', 'social_youtube', 'social_whatsapp', 'social_wechat', 'clinic_phone', 'clinic_email', 'clinic_address', 'clinic_hours'];

  // ==================== 公告管理 ====================

  router.get('/announcements', ...adminOnly, (req, res) => {
    db.all('SELECT * FROM announcements ORDER BY publish_date DESC, id DESC', [], (err, rows) => {
      if (err) return serverError(res, err);
      res.json(rows || []);
    });
  });

  router.post('/announcements', ...adminOnly, (req, res) => {
    const { title, category, content, publish_date, is_active } = req.body || {};
    if (!title || !title.trim() || !content || !content.trim()) {
      return res.status(400).json({ error: '請填寫標題與內容' });
    }
    db.run(
      `INSERT INTO announcements (title, category, content, publish_date, is_active)
       VALUES (?, ?, ?, ?, ?)`,
      [title.trim().slice(0, 120), (category || '診所資訊').slice(0, 20), content.trim().slice(0, 5000),
       publish_date || null, is_active === false || is_active === 0 ? 0 : 1],
      function (err) {
        if (err) return serverError(res, err);
        res.json({ ok: true, id: this.lastID });
      }
    );
  });

  router.put('/announcements/:id', ...adminOnly, (req, res) => {
    const id = parseInt(req.params.id);
    const { title, category, content, publish_date, is_active } = req.body || {};
    if (isNaN(id)) return res.status(400).json({ error: '無效 ID' });
    if (!title || !title.trim() || !content || !content.trim()) {
      return res.status(400).json({ error: '請填寫標題及內容' });
    }
    db.run(
      `UPDATE announcements SET title=?, category=?, content=?, publish_date=?, is_active=? WHERE id=?`,
      [title.trim().slice(0, 120), (category || '診所資訊').slice(0, 20), content.trim().slice(0, 5000),
       publish_date || null, is_active === false || is_active === 0 ? 0 : 1, id],
      function (err) {
        if (err) return serverError(res, err);
        if (this.changes === 0) return res.status(404).json({ error: '公告不存在' });
        res.json({ ok: true });
      }
    );
  });

  router.delete('/announcements/:id', ...adminOnly, (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: '無效 ID' });
    db.run('DELETE FROM announcements WHERE id=?', [id], function (err) {
      if (err) return serverError(res, err);
      if (this.changes === 0) return res.status(404).json({ error: '公告不存在' });
      res.json({ ok: true });
    });
  });

  // ==================== 影片管理 ====================

  router.get('/videos', ...adminOnly, (req, res) => {
    db.all('SELECT * FROM videos ORDER BY id DESC', [], (err, rows) => {
      if (err) return serverError(res, err);
      res.json(rows || []);
    });
  });

  router.post('/videos', ...adminOnly, (req, res) => {
    const { title, source, youtube_id, file_path, description, is_active } = req.body || {};
    if (!title || !title.trim()) return res.status(400).json({ error: '請填寫影片標題' });
    const src = source === 'upload' ? 'upload' : 'youtube';
    if (src === 'youtube' && !youtube_id) return res.status(400).json({ error: '請填寫 YouTube 連結' });
    db.run(
      `INSERT INTO videos (title, source, youtube_id, file_path, description, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [title.trim().slice(0, 120), src, youtube_id || null, file_path || null,
       (description || '').slice(0, 500), is_active === false || is_active === 0 ? 0 : 1],
      function (err) {
        if (err) return serverError(res, err);
        res.json({ ok: true, id: this.lastID });
      }
    );
  });

  router.put('/videos/:id', ...adminOnly, (req, res) => {
    const id = parseInt(req.params.id);
    const { title, source, youtube_id, file_path, description, is_active } = req.body || {};
    if (isNaN(id)) return res.status(400).json({ error: '無效 ID' });
    if (!title || !title.trim()) return res.status(400).json({ error: '請填寫影片標題' });
    const src = source === 'upload' ? 'upload' : 'youtube';
    db.run(
      `UPDATE videos SET title=?, source=?, youtube_id=?, file_path=?, description=?, is_active=? WHERE id=?`,
      [title.trim().slice(0, 120), src, youtube_id || null, file_path || null,
       (description || '').slice(0, 500), is_active === false || is_active === 0 ? 0 : 1, id],
      function (err) {
        if (err) return serverError(res, err);
        if (this.changes === 0) return res.status(404).json({ error: '影片不存在' });
        res.json({ ok: true });
      }
    );
  });

  router.delete('/videos/:id', ...adminOnly, (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: '無效 ID' });
    db.run('DELETE FROM videos WHERE id=?', [id], function (err) {
      if (err) return serverError(res, err);
      if (this.changes === 0) return res.status(404).json({ error: '影片不存在' });
      res.json({ ok: true });
    });
  });

  // 影片檔案上傳
  router.post('/videos/upload', ...adminOnly, uploadVideo.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: '請選擇影片檔案' });
    res.json({ ok: true, file_path: '/uploads/videos/' + req.file.filename });
  });

  // ==================== 社交媒體連結 ====================

  router.get('/social', ...adminOnly, (req, res) => {
    db.all('SELECT setting_key, setting_value FROM clinic_settings', [], (err, rows) => {
      if (err) return serverError(res, err);
      const map = {};
      (rows || []).forEach(r => { map[r.setting_key] = r.setting_value; });
      const out = {};
      SOCIAL_KEYS.forEach(k => { out[k] = map[k] || ''; });
      res.json(out);
    });
  });

  router.put('/social', ...adminOnly, (req, res) => {
    const body = req.body || {};
    const pending = SOCIAL_KEYS.filter(k => body[k] !== undefined);
    if (pending.length === 0) return res.json({ ok: true });
    db.serialize(() => {
      const stmt = db.prepare(
        `INSERT INTO clinic_settings (setting_key, setting_value) VALUES (?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value, updated_at=CURRENT_TIMESTAMP`
      );
      pending.forEach(k => {
        let v = String(body[k]).slice(0, 300);
        // WhatsApp 統一存純數字（剝走 wa.me / +852 / 空格等），前端再動態組 wa.me 連結
        if (k === 'social_whatsapp') v = v.replace(/[^0-9]/g, '');
        stmt.run(k, v);
      });
      stmt.finalize((err) => {
        if (err) return serverError(res, err);
        // 清除診所設定快取，令官網/電郵/通知即時讀到新值
        try { require('../services/clinicSettings').invalidate(); } catch (e) {}
        res.json({ ok: true });
      });
    });
  });

  // ==================== 評價審核 ====================

  router.get('/reviews', ...adminOnly, (req, res) => {
    db.all('SELECT * FROM reviews ORDER BY created_at DESC', [], (err, rows) => {
      if (err) return serverError(res, err);
      res.json(rows || []);
    });
  });

  router.put('/reviews/:id/status', ...adminOnly, (req, res) => {
    const id = parseInt(req.params.id);
    const { status } = req.body || {};
    if (isNaN(id)) return res.status(400).json({ error: '無效 ID' });
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: '無效狀態' });
    }
    db.run('UPDATE reviews SET status=? WHERE id=?', [status, id], function (err) {
      if (err) return serverError(res, err);
      if (this.changes === 0) return res.status(404).json({ error: '評價不存在' });
      res.json({ ok: true });
    });
  });

  router.delete('/reviews/:id', ...adminOnly, (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: '無效 ID' });
    db.run('DELETE FROM reviews WHERE id=?', [id], function (err) {
      if (err) return serverError(res, err);
      if (this.changes === 0) return res.status(404).json({ error: '評價不存在' });
      res.json({ ok: true });
    });
  });

  // ==================== 討論區管理 ====================

  router.delete('/forum/posts/:id', ...adminOnly, (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: '無效 ID' });
    db.serialize(() => {
      db.run('DELETE FROM forum_replies WHERE post_id=?', [id]);
      db.run('DELETE FROM forum_posts WHERE id=?', [id], function (err) {
        if (err) return serverError(res, err);
        res.json({ ok: true });
      });
    });
  });

  router.delete('/forum/replies/:id', ...adminOnly, (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: '無效 ID' });
    db.get('SELECT post_id FROM forum_replies WHERE id=?', [id], (err, row) => {
      if (err) return serverError(res, err);
      db.run('DELETE FROM forum_replies WHERE id=?', [id], function (err2) {
        if (err2) return res.status(500).json({ error: err2.message });
        if (row) db.run('UPDATE forum_posts SET reply_count=MAX(0,reply_count-1) WHERE id=?', [row.post_id]);
        res.json({ ok: true });
      });
    });
  });

  // ==================== 討論區審核（醫護審批後先公開）====================

  // 審核列表（醫護 + 管理員）：返回全部帖子（含待審核 pending），供審核介面使用
  router.get('/forum/posts', requireAuth, requireRole('admin', 'staff'), (req, res) => {
    db.all(
      `SELECT p.id, p.user_id, p.user_name, p.avatar, p.title, p.content, p.category,
              p.reply_count, p.is_pinned, p.status, p.created_at
       FROM forum_posts p
       ORDER BY (p.status <> 'approved') DESC, p.created_at DESC LIMIT 200`,
      [], (err, rows) => {
        if (err) return serverError(res, err);
        res.json(rows || []);
      }
    );
  });

  router.put('/forum/posts/:id/status', requireAuth, requireRole('admin', 'staff'), (req, res) => {
    const id = parseInt(req.params.id);
    const { status } = req.body || {};
    if (isNaN(id)) return res.status(400).json({ error: '無效 ID' });
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: '無效狀態' });
    }
    db.run('UPDATE forum_posts SET status=? WHERE id=?', [status, id], function (err) {
      if (err) return serverError(res, err);
      if (this.changes === 0) return res.status(404).json({ error: '帖子不存在' });
      res.json({ ok: true });
    });
  });

  // ==================== 客人心聲（到診意見）管理 ====================

  router.get('/customer-voices', ...adminOrStaff, (req, res) => {
    db.all('SELECT * FROM customer_voices ORDER BY created_at DESC', [], (err, rows) => {
      if (err) return serverError(res, err);
      res.json(rows || []);
    });
  });

  router.put('/customer-voices/:id/status', ...adminOrStaff, (req, res) => {
    const id = parseInt(req.params.id);
    const { status } = req.body || {};
    if (isNaN(id)) return res.status(400).json({ error: '無效 ID' });
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: '無效狀態' });
    }
    db.run('UPDATE customer_voices SET status=? WHERE id=?', [status, id], function (err) {
      if (err) return serverError(res, err);
      if (this.changes === 0) return res.status(404).json({ error: '客人心聲不存在' });
      res.json({ ok: true });
    });
  });

  router.delete('/customer-voices/:id', ...adminOrStaff, (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: '無效 ID' });
    db.run('DELETE FROM customer_voices WHERE id=?', [id], function (err) {
      if (err) return serverError(res, err);
      if (this.changes === 0) return res.status(404).json({ error: '客人心聲不存在' });
      res.json({ ok: true });
    });
  });

  // ==================== 影片/頭像刪除後清理檔案 ====================

  router.post('/cleanup-file', ...adminOnly, (req, res) => {
    const { file_path } = req.body || {};
    if (!file_path || typeof file_path !== 'string') return res.status(400).json({ error: '無效路徑' });
    const m = file_path.match(/^\/uploads\/(avatars|videos)\/([A-Za-z0-9_.-]+)$/);
    if (!m) return res.status(400).json({ error: '無效路徑' });
    const full = path.join(__dirname, '..', 'uploads', m[1], m[2]);
    if (fs.existsSync(full)) fs.unlinkSync(full);
    res.json({ ok: true });
  });

  // ==================== 網站動態文字管理 ====================

  // 預設文字（首次建立時寫入，之後以管理員編輯為準）
  const DEFAULT_TEXTS = [
    { key: 'hero_title', value: '現代中醫，守護健康', section: '首頁橫幅' },
    { key: 'hero_subtitle', value: '結合傳統智慧與現代科技，為您提供專業、安心嘅中醫診療服務', section: '首頁橫幅' },
    { key: 'about_text', value: '本診所以「治未病」為理念，由經驗豐富嘅註冊中醫師主診，提供針灸、推拿、中藥內調等全方位診療服務，細心聆聽每位病人嘅需要。', section: '關於我們' },
    { key: 'footer_desc', value: '現代中醫，為中環專業人士而設。以仁心仁術，結合現代科技，悉心守護您的健康。', section: '頁尾' },
    { key: 'cta_title', value: '準備好開始調理身體？', section: '預約橫幅' },
    { key: 'cta_subtitle', value: '立即預約，感受中醫嘅力量', section: '預約橫幅' },
    { key: 'login_title', value: '登入預約系統', section: '登入' },
    { key: 'login_subtitle', value: '管理您的預約、查看療程紀錄', section: '登入' }
  ];

  const ensureDefaultTexts = (cb) => {
    db.get('SELECT COUNT(*) AS c FROM site_texts', [], (err, row) => {
      if (err || !row || row.c === 0) {
        const stmt = db.prepare('INSERT OR IGNORE INTO site_texts (text_key, text_value, section) VALUES (?, ?, ?)');
        DEFAULT_TEXTS.forEach(t => stmt.run(t.key, t.value, t.section));
        stmt.finalize(cb || (() => {}));
      } else {
        if (cb) cb();
      }
    });
  };

  // 全部文字（key + value + section）
  router.get('/texts', ...adminOnly, (req, res) => {
    ensureDefaultTexts(() => {
      db.all('SELECT id, text_key, text_value, section FROM site_texts ORDER BY section, id', [], (err, rows) => {
        if (err) return serverError(res, err);
        res.json(rows || []);
      });
    });
  });

  // 新增自訂文字
  router.post('/texts', ...adminOnly, (req, res) => {
    const { text_key, text_value, section } = req.body || {};
    if (!text_key || !text_key.trim()) return res.status(400).json({ error: '請輸入文字名稱' });
    const key = text_key.trim().slice(0, 60);
    db.run(
      'INSERT INTO site_texts (text_key, text_value, section) VALUES (?, ?, ?)',
      [key, (text_value || '').slice(0, 5000), (section || '一般').slice(0, 20)],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE')) return res.status(409).json({ error: '此文字名稱已存在' });
          return serverError(res, err);
        }
        res.json({ ok: true, id: this.lastID });
      }
    );
  });

  // 更新文字內容
  router.put('/texts/:id', ...adminOnly, (req, res) => {
    const id = parseInt(req.params.id);
    const { text_value, section } = req.body || {};
    if (isNaN(id)) return res.status(400).json({ error: '無效 ID' });
    db.run(
      'UPDATE site_texts SET text_value=?, section=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
      [(text_value || '').slice(0, 5000), (section || '一般').slice(0, 20), id],
      function (err) {
        if (err) return serverError(res, err);
        if (this.changes === 0) return res.status(404).json({ error: '文字不存在' });
        res.json({ ok: true });
      }
    );
  });

  // 刪除自訂文字
  router.delete('/texts/:id', ...adminOnly, (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: '無效 ID' });
    db.run('DELETE FROM site_texts WHERE id=?', [id], function (err) {
      if (err) return serverError(res, err);
      if (this.changes === 0) return res.status(404).json({ error: '文字不存在' });
      res.json({ ok: true });
    });
  });

  // ==================== 成功案例庫管理（無個人資料，匿名化）====================

  // 全部案例（管理員）
  router.get('/cases', ...adminOnly, (req, res) => {
    db.all('SELECT * FROM cases ORDER BY created_at DESC', [], (err, rows) => {
      if (err) return serverError(res, err);
      res.json(rows || []);
    });
  });

  // 新增案例
  router.post('/cases', ...adminOnly, (req, res) => {
    const { title, condition_name, treatment, summary, duration, outcome, anonymous_name, is_published } = req.body || {};
    if (!title || !title.trim()) return res.status(400).json({ error: '請輸入案例標題' });
    db.run(
      `INSERT INTO cases (title, condition_name, treatment, summary, duration, outcome, anonymous_name, is_published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [title.trim().slice(0, 200), (condition_name || '').slice(0, 200), (treatment || '').slice(0, 2000),
        (summary || '').slice(0, 2000), (duration || '').slice(0, 100), (outcome || '').slice(0, 2000),
        (anonymous_name || '').slice(0, 100), is_published ? 1 : 0],
      function (err) {
        if (err) return serverError(res, err);
        res.json({ ok: true, id: this.lastID });
      }
    );
  });

  // 更新案例
  router.put('/cases/:id', ...adminOnly, (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: '無效 ID' });
    const { title, condition_name, treatment, summary, duration, outcome, anonymous_name, is_published } = req.body || {};
    db.run(
      `UPDATE cases SET title=COALESCE(?,title), condition_name=COALESCE(?,condition_name),
         treatment=COALESCE(?,treatment), summary=COALESCE(?,summary), duration=COALESCE(?,duration),
         outcome=COALESCE(?,outcome), anonymous_name=COALESCE(?,anonymous_name),
         is_published=COALESCE(?,is_published), updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [title ? title.trim().slice(0, 200) : null, condition_name || null, treatment || null,
        summary || null, duration || null, outcome || null, anonymous_name || null,
        is_published === undefined ? null : (is_published ? 1 : 0), id],
      function (err) {
        if (err) return serverError(res, err);
        if (this.changes === 0) return res.status(404).json({ error: '案例不存在' });
        res.json({ ok: true });
      }
    );
  });

  // 刪除案例
  router.delete('/cases/:id', ...adminOnly, (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: '無效 ID' });
    db.run('DELETE FROM cases WHERE id=?', [id], function (err) {
      if (err) return serverError(res, err);
      if (this.changes === 0) return res.status(404).json({ error: '案例不存在' });
      res.json({ ok: true });
    });
  });

  return router;
};
