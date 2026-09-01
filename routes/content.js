const { serverError } = require("../services/httpResp");
/**
 * 官網內容管理路由
 * 包括：診所公告、影片（YouTube/自訂上傳）、社交媒體連結、客戶評價、討論區、頭像上傳
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

module.exports = (db, { requireAuth, requireRole } = {}) => {
  const router = express.Router();

  // ==================== 安全上傳設定 ====================

  const MIME_ALLOWED = {
    // 圖片（🔒 不接受 SVG：可夾帶腳本造成 stored XSS）
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp',
    // 影片
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg',
    '.mov': 'video/quicktime'
  };

  const sanitizeFileName = (original) => {
    const ext = path.extname(original || '').toLowerCase();
    if (!MIME_ALLOWED[ext]) return null;
    // 只保留檔名，防路徑穿越
    const base = path.basename(original, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    return (base || 'file') + '_' + crypto.randomBytes(6).toString('hex') + ext;
  };

  const mkdirSafe = (dir) => {
    const full = path.join(__dirname, '..', 'uploads', dir);
    if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
    return full;
  };

  const avatarStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, mkdirSafe('avatars')),
    filename: (req, file, cb) => {
      const name = sanitizeFileName(file.originalname);
      if (!name) return cb(new Error('不支援的檔案格式'));
      cb(null, name);
    }
  });

  const videoStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, mkdirSafe('videos')),
    filename: (req, file, cb) => {
      const name = sanitizeFileName(file.originalname);
      if (!name) return cb(new Error('不支援的檔案格式'));
      cb(null, name);
    }
  });

  const uploadAvatar = multer({
    storage: avatarStorage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, !!MIME_ALLOWED[path.extname(file.originalname).toLowerCase()])
  });

  const uploadVideo = multer({
    storage: videoStorage,
    limits: { fileSize: 200 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, !!MIME_ALLOWED[path.extname(file.originalname).toLowerCase()])
  });

  const validateYoutubeId = (url) => {
    if (!url) return null;
    const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/);
    return m ? m[1] : null;
  };

  // ==================== 公開內容（官網首頁讀取）====================

  // 公告列表
  router.get('/announcements', (req, res) => {
    db.all(
      `SELECT id, title, category, content, publish_date, created_at
       FROM announcements WHERE is_active=1 ORDER BY publish_date DESC, id DESC LIMIT 10`,
      [], (err, rows) => {
        if (err) return serverError(res, err);
        res.json(rows || []);
      }
    );
  });

  // 影片列表
  router.get('/videos', (req, res) => {
    db.all(
      `SELECT id, title, source, youtube_id, file_path, description, created_at
       FROM videos WHERE is_active=1 ORDER BY id DESC LIMIT 12`,
      [], (err, rows) => {
        if (err) return serverError(res, err);
        res.json(rows || []);
      }
    );
  });

  // 社交媒體連結（存喺 clinic_settings）
  const SOCIAL_KEYS = ['social_facebook', 'social_instagram', 'social_youtube', 'social_whatsapp', 'social_wechat', 'clinic_phone', 'clinic_address', 'clinic_hours'];

  router.get('/social', (req, res) => {
    db.all('SELECT setting_key, setting_value FROM clinic_settings', [], (err, rows) => {
      if (err) return serverError(res, err);
      const map = {};
      (rows || []).forEach(r => { map[r.setting_key] = r.setting_value; });
      const out = {};
      SOCIAL_KEYS.forEach(k => { out[k] = map[k] || ''; });
      res.json(out);
    });
  });

  // 網站動態文字（管理員編輯過嘅文字）
  router.get('/texts', (req, res) => {
    db.all('SELECT text_key, text_value, section FROM site_texts', [], (err, rows) => {
      if (err) return serverError(res, err);
      const map = {};
      (rows || []).forEach(r => { map[r.text_key] = r.text_value; });
      res.json(map);
    });
  });

  // 客戶評價（只顯示已審核）
  router.get('/reviews', (req, res) => {
    db.all(
      `SELECT id, user_name, avatar, rating, service, content, created_at
       FROM reviews WHERE status='approved' ORDER BY created_at DESC LIMIT 20`,
      [], (err, rows) => {
        if (err) return serverError(res, err);
        res.json(rows || []);
      }
    );
  });

  // ==================== 客戶評價（提交）====================

  router.post('/reviews', requireAuth, (req, res) => {
    const { rating, service, content } = req.body || {};
    if (!content || !content.trim()) return res.status(400).json({ error: '請填寫評價內容' });
    const r = Math.max(1, Math.min(5, parseInt(rating) || 5));
    db.run(
      `INSERT INTO reviews (user_id, user_name, avatar, rating, service, content, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [req.user.id, req.user.name, req.user.avatar || null, r, (service || '').slice(0, 50), content.trim().slice(0, 2000)],
      function (err) {
        if (err) return serverError(res, err);
        res.json({ ok: true, id: this.lastID, message: '評價已提交，待管理員審核' });
      }
    );
  });

  // ==================== 討論區（公開讀取 / 登入發帖）====================

  const getAvatarForUser = (user) => user && user.avatar ? user.avatar : (user ? null : null);

  // 帖子列表（含回覆數）
  router.get('/forum/posts', (req, res) => {
    db.all(
      `SELECT p.id, p.user_id, p.user_name, p.avatar, p.title, p.content, p.category,
              p.reply_count, p.is_pinned, p.created_at,
              u.avatar AS user_avatar
       FROM forum_posts p LEFT JOIN users u ON u.id=p.user_id
       ORDER BY p.is_pinned DESC, p.created_at DESC LIMIT 100`,
      [], (err, rows) => {
        if (err) return serverError(res, err);
        (rows || []).forEach(r => { if (!r.avatar && r.user_avatar) r.avatar = r.user_avatar; });
        res.json(rows || []);
      }
    );
  });

  // 單帖詳情 + 回覆
  router.get('/forum/posts/:id', (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: '無效帖子' });
    db.get(
      `SELECT p.id, p.user_id, p.user_name, p.avatar, p.title, p.content, p.category,
              p.reply_count, p.is_pinned, p.created_at
       FROM forum_posts p WHERE p.id=?`,
      [id], (err, post) => {
        if (err) return serverError(res, err);
        if (!post) return res.status(404).json({ error: '帖子不存在' });
        db.all(
          `SELECT r.id, r.user_name, r.avatar, r.content, r.created_at,
                  u.avatar AS user_avatar
           FROM forum_replies r LEFT JOIN users u ON u.id=r.user_id
           WHERE r.post_id=? ORDER BY r.created_at ASC`,
          [id], (err2, replies) => {
            if (err2) return res.status(500).json({ error: err2.message });
            (replies || []).forEach(r => { if (!r.avatar && r.user_avatar) r.avatar = r.user_avatar; });
            res.json({ ...post, replies: replies || [] });
          }
        );
      }
    );
  });

  // 開帖（登入用戶）
  router.post('/forum/posts', requireAuth, (req, res) => {
    const { title, content, category } = req.body || {};
    if (!title || !title.trim() || !content || !content.trim()) {
      return res.status(400).json({ error: '請填寫標題與內容' });
    }
    const avatar = req.user.avatar || null;
    db.run(
      `INSERT INTO forum_posts (user_id, user_name, avatar, title, content, category)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, req.user.name, avatar, title.trim().slice(0, 80), content.trim().slice(0, 5000),
       (category || '中醫問題').slice(0, 20)],
      function (err) {
        if (err) return serverError(res, err);
        res.json({ ok: true, id: this.lastID });
      }
    );
  });

  // 回覆帖子（登入用戶）
  router.post('/forum/posts/:id/replies', requireAuth, (req, res) => {
    const postId = parseInt(req.params.id);
    const { content } = req.body || {};
    if (isNaN(postId)) return res.status(400).json({ error: '無效帖子' });
    if (!content || !content.trim()) return res.status(400).json({ error: '請填寫回覆內容' });
    db.get('SELECT id FROM forum_posts WHERE id=?', [postId], (err, post) => {
      if (err) return serverError(res, err);
      if (!post) return res.status(404).json({ error: '帖子不存在' });
      const avatar = req.user.avatar || null;
      db.run(
        `INSERT INTO forum_replies (post_id, user_id, user_name, avatar, content)
         VALUES (?, ?, ?, ?, ?)`,
        [postId, req.user.id, req.user.name, avatar, content.trim().slice(0, 3000)],
        function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          db.run('UPDATE forum_posts SET reply_count=reply_count+1 WHERE id=?', [postId]);
          res.json({ ok: true, id: this.lastID });
        }
      );
    });
  });

  // ==================== 頭像上傳（登入用戶）====================

  router.post('/upload/avatar', requireAuth, uploadAvatar.single('avatar'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: '請選擇圖片' });
    const url = '/uploads/avatars/' + req.file.filename;
    db.run('UPDATE users SET avatar=? WHERE id=?', [url, req.user.id], (err) => {
      if (err) return serverError(res, err);
      res.json({ ok: true, avatar: url });
    });
  });

  // 更新頭像（公仔 emoji）
  router.put('/avatar', requireAuth, (req, res) => {
    const { avatar } = req.body || {};
    if (typeof avatar !== 'string' || avatar.length > 20) {
      return res.status(400).json({ error: '無效頭像' });
    }
    db.run('UPDATE users SET avatar=? WHERE id=?', [avatar, req.user.id], (err) => {
      if (err) return serverError(res, err);
      res.json({ ok: true, avatar });
    });
  });

  // ==================== 成功案例庫（公開，只顯示已發佈）====================

  router.get('/cases', (req, res) => {
    db.all(
      `SELECT id, title, condition_name, treatment, summary, duration, outcome, anonymous_name, created_at
       FROM cases WHERE is_published=1 ORDER BY created_at DESC LIMIT 100`,
      [],
      (err, rows) => {
        if (err) return serverError(res, err);
        res.json(rows || []);
      }
    );
  });

  return router;
};
