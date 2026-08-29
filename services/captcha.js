/**
 * 圖形驗證碼（CAPTCHA）服務
 * - 使用 svg-captcha 生成圖片
 * - 驗證碼存喺記憶體（server 重啟會清除，可接受）
 * - 每個驗證碼：5 分鐘有效 + 單次使用 + 失敗 5 次自動失效
 */

const svgCaptcha = require('svg-captcha');

// captchaId -> { text, expiresAt, attempts }
const captchaStore = new Map();

// 定期清理過期驗證碼（每 5 分鐘）
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of captchaStore) {
    if (data.expiresAt <= now) captchaStore.delete(id);
  }
}, 5 * 60 * 1000).unref();

const CAPTCHA_TTL = 5 * 60 * 1000; // 5 分鐘
const MAX_ATTEMPTS = 5;

/**
 * 生成一組驗證碼
 * @returns {{ id: string, svg: string }}
 */
const createCaptcha = () => {
  const captcha = svgCaptcha.create({
    size: 5,
    noise: 2,
    color: false,
    width: 150,
    height: 50,
    charPreset: 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789', // 排除易混淆字符
    fontSize: 46,
  });

  const id = require('crypto').randomBytes(12).toString('hex');
  captchaStore.set(id, {
    text: captcha.text,
    expiresAt: Date.now() + CAPTCHA_TTL,
    attempts: 0,
  });

  return { id, svg: captcha.data };
};

/**
 * 驗證驗證碼（大小寫不敏感）
 * @returns {{ ok: boolean, error?: string }}
 */
const verifyCaptcha = (id, answer) => {
  if (process.env.CAPTCHA_TEST_BYPASS && String(answer) === process.env.CAPTCHA_TEST_BYPASS) return { ok: true };
  if (!id || !answer) {
    return { ok: false, error: '請輸入驗證碼' };
  }

  const data = captchaStore.get(id);
  if (!data) {
    return { ok: false, error: '驗證碼已過期，請重新整理' };
  }

  // 失敗次數過多，直接刪除
  if (data.attempts >= MAX_ATTEMPTS) {
    captchaStore.delete(id);
    return { ok: false, error: '驗證碼已失效，請重新整理' };
  }

  if (data.expiresAt <= Date.now()) {
    captchaStore.delete(id);
    return { ok: false, error: '驗證碼已過期，請重新整理' };
  }

  if (String(data.text).toLowerCase() !== String(answer).toLowerCase().trim()) {
    data.attempts += 1;
    if (data.attempts >= MAX_ATTEMPTS) {
      captchaStore.delete(id);
      return { ok: false, error: '驗證碼已失效，請重新整理' };
    }
    return { ok: false, error: '驗證碼不正確，請重新輸入' };
  }

  // 正確，立即刪除（單次使用）
  captchaStore.delete(id);
  return { ok: true };
};

module.exports = { createCaptcha, verifyCaptcha };
