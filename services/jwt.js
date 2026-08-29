/**
 * JWT Token 工具模組
 * - 自製 HMAC-SHA256 簽名 Token（不需額外 npm 套件）
 * - Payload 包含 userId、role、username、exp、jti（唯一 ID，用於登出黑名單）
 */

const crypto = require('crypto');

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.log('⚠️ 未設定 SESSION_SECRET 環境變數，已生成隨機密鑰（伺服器重啟後所有登入會失效）');
}

// Token 黑名單（登出後加入，直到原本到期時間）
// jti -> 過期時間戳（毫秒）
const tokenBlacklist = new Map();

// 定期清理已過期嘅黑名單項目（每 10 分鐘）
setInterval(() => {
  const now = Date.now();
  for (const [jti, exp] of tokenBlacklist) {
    if (exp <= now) tokenBlacklist.delete(jti);
  }
}, 10 * 60 * 1000).unref();

const b64urlEncode = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
const b64urlDecode = (str) => JSON.parse(Buffer.from(str, 'base64url').toString('utf8'));

/**
 * 產生 JWT Token
 * @param {object} payload - 包含 userId, role, username 等
 * @param {number} expiresInMs - 到期時間（毫秒），預設 30 天
 */
const signToken = (payload, expiresInMs = 30 * 24 * 60 * 60 * 1000) => {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Date.now();
  const jti = crypto.randomBytes(16).toString('hex');
  const body = {
    ...payload,
    jti,
    iat: now,
    exp: now + expiresInMs,
  };
  const headerPart = b64urlEncode(header);
  const bodyPart = b64urlEncode(body);
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`${headerPart}.${bodyPart}`)
    .digest('base64url');
  return `${headerPart}.${bodyPart}.${signature}`;
};

/**
 * 驗證 JWT Token
 * @returns {object|null} 成功返回 payload，失敗返回 null
 */
const verifyToken = (token) => {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, bodyPart, signature] = parts;

  // 重新計算簽名並比對（防篡改）
  const expected = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`${headerPart}.${bodyPart}`)
    .digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let body;
  try {
    body = b64urlDecode(bodyPart);
  } catch {
    return null;
  }

  // 檢查過期
  if (!body.exp || body.exp <= Date.now()) return null;

  // 檢查黑名單（已登出）
  if (tokenBlacklist.has(body.jti)) return null;

  return body;
};

/**
 * 登出：將 token 加入黑名單
 */
const revokeToken = (token) => {
  const payload = verifyToken(token);
  if (!payload || !payload.jti || !payload.exp) return;
  tokenBlacklist.set(payload.jti, payload.exp);
};

/**
 * 登出該用戶所有 token：清空該用戶所有有效 token（jti）
 */
const revokeAllUserTokens = (userId) => {
  // 對簡單嘅黑名單機制，用「user 層級」無法直接列舉未過期 jti。
  // 做法：加入一個永久標記到 userBlacklist，驗證時檢查。
  userBlacklist.set(String(userId), Date.now() + 30 * 24 * 60 * 60 * 1000);
};

// 用戶級黑名單（登出所有裝置用）：userId -> 該時間前簽發嘅 token 全部失效
const userBlacklist = new Map();

/**
 * 檢查用戶級登出標記（用於「登出所有裝置」）
 * @returns {boolean} true 表示該用戶嘅 token 已全部失效
 */
const isUserRevoked = (userId, iat) => {
  const revokedAt = userBlacklist.get(String(userId));
  if (!revokedAt) return false;
  return iat && iat < revokedAt;
};

/**
 * 從 Authorization header 提取 Bearer token
 */
const extractTokenFromRequest = (req) => {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header) return null;
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  if (header.startsWith('bearer ')) return header.slice(7).trim();
  return header.trim();
};

module.exports = {
  SESSION_SECRET,
  signToken,
  verifyToken,
  revokeToken,
  revokeAllUserTokens,
  isUserRevoked,
  extractTokenFromRequest,
};
