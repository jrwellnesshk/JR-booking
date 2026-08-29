/**
 * 分層密碼強度政策
 * 所有建立/修改密碼的位置統一使用此規則，確保一致性。
 *
 * 分層：
 *   - 客人 / 一般會員（customer / user）：≥8 字元，含英文字母 + 數字
 *   - 職員 / 醫師 / 管理員（staff / doctor / admin）：
 *       ≥10 字元，同時含大寫、小寫英文字母及數字，並排除弱密碼黑名單
 *
 * ⚠️ 收緊政策後，暫時密碼生成器（generateTempPassword）一併升級，
 *    改為混合大小寫 + 數字的強隨機密碼，避免「純大寫 + 數字」組合過窄。
 */

const crypto = require('crypto');

// 特權角色（職員 / 醫師 / 管理員）適用更嚴格政策
const PRIVILEGED_ROLES = new Set(['admin', 'staff', 'doctor']);

const CUSTOMER_MIN_LENGTH = 8;
const PRIVILEGED_MIN_LENGTH = 10;
const MAX_LENGTH = 128;

// 弱密碼黑名單（大小寫不敏感，含常見組合與診所相關字眼）
const WEAK_PASSWORDS = new Set([
  'password', 'passw0rd', 'p@ssw0rd', 'password1', 'password123',
  '123456', '12345678', '123456789', '1234567890',
  'qwerty', 'qwerty123', 'abc123', 'iloveyou', 'admin', 'admin123',
  'root', 'root123', 'letmein', 'welcome', 'welcome1',
  '111111', '000000', '88888888', '666666', '123123',
  'baoting', 'baotian', 'bt123456', 'bt12345678', 'btadmin', 'btpassword',
  'changeme', 'test1234', 'guest123', 'doctor123', 'staff123'
]);

// 隨機字元集（剔除易混淆字元 I/O/0/1）
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGIT = '23456789';
const ALL = UPPER + LOWER + DIGIT;

function isPrivileged(role) {
  return PRIVILEGED_ROLES.has(String(role || '').toLowerCase());
}

// 安全隨機取字
function randChar(set) {
  const buf = crypto.randomBytes(1);
  return set[buf[0] % set.length];
}

/**
 * 生成強隨機密碼
 * @param {string} role 用戶角色（決定長度與是否需要大小寫混合）
 * @returns {string} 符合對應政策強度的密碼
 */
function generatePassword(role) {
  const privileged = isPrivileged(role);
  const length = privileged ? PRIVILEGED_MIN_LENGTH : CUSTOMER_MIN_LENGTH + 2; // 客人 10 位、特權 10 位
  // 保證至少含一個大寫、一個小寫、一個數字
  const chars = [randChar(UPPER), randChar(LOWER), randChar(DIGIT)];
  while (chars.length < length) {
    chars.push(randChar(ALL));
  }
  // Fisher–Yates 洗牌（用密碼學安全隨機數）
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomBytes(1)[0] % (i + 1);
    const t = chars[i];
    chars[i] = chars[j];
    chars[j] = t;
  }
  return chars.join('');
}

/**
 * 生成暫時密碼（用於子帳戶 / 職員代開戶）
 * 保留 BT 前綴供職員識別，後綴為強隨機混合大小寫 + 數字，
 * 同時符合客人及特權政策，避免「純大寫 + 數字」組合過窄。
 * @returns {string}
 */
function generateTempPassword() {
  return 'BT' + generatePassword('customer');
}

/**
 * 驗證密碼強度（分層）
 * @param {string} password
 * @param {string} [role] 用戶角色；預設視為客人（最寬鬆）
 * @returns {{ok:boolean, error?:string}}
 */
function validatePassword(password, role) {
  if (!password) {
    return { ok: false, error: '請輸入密碼' };
  }
  if (typeof password !== 'string') {
    return { ok: false, error: '密碼格式不正確' };
  }
  if (password.length > MAX_LENGTH) {
    return { ok: false, error: `密碼長度不能超過 ${MAX_LENGTH} 個字元` };
  }

  const privileged = isPrivileged(role);
  const minLength = privileged ? PRIVILEGED_MIN_LENGTH : CUSTOMER_MIN_LENGTH;
  const roleLabel = privileged ? '職員 / 醫師 / 管理員' : '一般會員';

  if (password.length < minLength) {
    return { ok: false, error: `密碼長度至少需要 ${minLength} 個字元（${roleLabel}）` };
  }
  if (!/[A-Za-z]/.test(password)) {
    return { ok: false, error: '密碼必須包含英文字母' };
  }
  if (!/\d/.test(password)) {
    return { ok: false, error: '密碼必須包含數字' };
  }

  if (privileged) {
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
      return { ok: false, error: '密碼必須同時包含大寫及小寫英文字母' };
    }
    if (WEAK_PASSWORDS.has(password.toLowerCase())) {
      return { ok: false, error: '密碼過於常見或容易被猜中，請使用更獨特的密碼' };
    }
  }

  return { ok: true };
}

module.exports = {
  validatePassword,
  generatePassword,
  generateTempPassword,
  isPrivileged,
  CUSTOMER_MIN_LENGTH,
  PRIVILEGED_MIN_LENGTH,
};
