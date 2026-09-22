/**
 * 認證中間件
 * 取代原本靠 req.headers['x-user-id'] / req.body.userId 嘅身份偽造漏洞
 * 所有需要登入嘅 route 必須經過 requireAuth，再按角色 requireRole
 */

const jwt = require('../services/jwt');

/**
 * 建立認證 middleware
 * @param {Database} db - SQLite 資料庫實例
 */
const createAuthMiddleware = (db) => {
  /**
   * 必須登入：驗證 Authorization Bearer token
   * 成功後 req.auth = { userId, role, username, ... }，並載入 req.user
   */
  const requireAuth = (req, res, next) => {
    const token = jwt.extractTokenFromRequest(req);
    const payload = jwt.verifyToken(token);

    if (!payload || !payload.userId) {
      return res.status(401).json({ error: '未登入或登入已過期，請重新登入' });
    }

    // 用戶級登出檢查（登出所有裝置）
    if (jwt.isUserRevoked(payload.userId, payload.iat)) {
      return res.status(401).json({ error: '登入已失效，請重新登入' });
    }

    // 載入用戶最新資料（確保角色/帳戶狀態最新）
    db.get("SELECT id, username, name, name_en, phone, email, role, employment_type, profile_completed, created_at, membership_tier, insurance_covered, family_head_id, is_active, whatsapp_weather, whatsapp_confirm, whatsapp_health, must_change_password FROM users WHERE id=?", [payload.userId], (err, user) => {
      if (err) return res.status(500).json({ error: '系統錯誤，請稍後再試' });
      if (!user) return res.status(401).json({ error: '帳戶不存在，請重新登入' });
      // 停用帳戶拒絕（is_active=0）
      if (user.is_active === 0) {
        return res.status(403).json({ error: '帳戶已停用，請聯絡診所職員' });
      }

      // 計算未完成資料用戶嘅剩餘天數
      let days_remaining = null;
      if (user.profile_completed === 0 && user.created_at) {
        const createdAt = new Date(user.created_at);
        const daysPassed = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
        days_remaining = Math.max(0, 3 - daysPassed);
      }

      req.auth = { ...payload, user };
      req.userId = user.id;
      req.user = { ...user, days_remaining };

      // 🔓 已按用戶要求取消「強制修改密碼」門檻：
      //    must_change_password=1 不再封鎖任何 API，登入後可直接使用系統。
      //    （欄位仍保留作記錄，改密入口仍在，但改為自願性質）
      next();
    });
  };

  /**
   * 🔓 已停用：原本作「must_change_password=1 時封鎖其他 API」之用。
   * 按用戶要求取消強制改密後，此中間件改為直接放行（保留函式名以兼容既有路由引用）。
   */
  const requirePasswordUpToDate = (req, res, next) => next();

  /**
   * 可選登入：有 token 就驗證並載入 req.user / req.userId；無 token 都照樣通過（訪客模式）
   * 訪問者（guest）時 req.user / req.userId 保持 undefined
   */
  const optionalAuth = (req, res, next) => {
    const token = jwt.extractTokenFromRequest(req);
    const payload = jwt.verifyToken(token);

    if (!payload || !payload.userId) {
      return next(); // 訪客模式：唔強制登入
    }

    if (jwt.isUserRevoked(payload.userId, payload.iat)) {
      return res.status(401).json({ error: '登入已失效，請重新登入' });
    }

    db.get("SELECT id, username, name, name_en, phone, email, role, employment_type, profile_completed, created_at, membership_tier, insurance_covered, family_head_id, is_active, whatsapp_weather, whatsapp_confirm, whatsapp_health FROM users WHERE id=?", [payload.userId], (err, user) => {
      if (err) return res.status(500).json({ error: '系統錯誤，請稍後再試' });
      if (!user) return res.status(401).json({ error: '帳戶不存在，請重新登入' });
      // 停用帳戶拒絕（is_active=0）
      if (user.is_active === 0) {
        return res.status(403).json({ error: '帳戶已停用，請聯絡診所職員' });
      }

      let days_remaining = null;
      if (user.profile_completed === 0 && user.created_at) {
        const createdAt = new Date(user.created_at);
        const daysPassed = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
        days_remaining = Math.max(0, 3 - daysPassed);
      }

      req.auth = { ...payload, user };
      req.userId = user.id;
      req.user = { ...user, days_remaining };
      next();
    });
  };

  /**
   * 角色限制：必須在 requireAuth 之後使用
   * @param {string[]} roles - 允許嘅角色
   */
  const requireRole = (...roles) => (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: '未登入' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '無權限執行此操作' });
    }
    next();
  };

  return { requireAuth, requireRole, optionalAuth, requirePasswordUpToDate };
};

module.exports = createAuthMiddleware;
