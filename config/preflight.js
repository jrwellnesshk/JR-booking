/**
 * 生產啟動安全預檢（Preflight）
 *
 * 目的：喺 server 真正listen端口之前，擋低「帶住開發/後門設定上生產」呢類低級但致命嘅錯誤。
 * 只喺 NODE_ENV === 'production' 生效；開發 / 測試環境一律放行，唔影響本地 QA。
 *
 * 設計原則：
 *   - 發現問題就 process.exit(1)，絕唔好「warning 照跑」（warning 會被淹沒喺 log 海入面）
 *   - 錯誤訊息要講清楚「點解」+「點修」
 *   - 唔可以印出機密值本身
 */

// 呢啲係「一睇就知係 demo / 未改」嘅管理員密碼，生產見到要即刻擋
const WEAK_ADMIN_PASSWORDS = new Set([
  'admin123', 'password', '123456', 'changeme', 'test', 'test123',
  'admin', 'aurora', 'AuroraDock3r!Test',
]);

// 呢啲 domain 代表「根本未設定對外域名」，通常係由 .env.example 直接抄落嚟
const PLACEHOLDER_DOMAINS = new Set([
  'localhost', '127.0.0.1', 'example.com', 'yourdomain.com', 'booking.yourdomain.com',
]);

/**
 * 執行預檢。有致命問題會直接 process.exit(1)。
 * @param {{ logger?: { warn: Function, error: Function } }} [opts]
 */
const runPreflight = (opts = {}) => {
  const log = {
    warn: opts.logger?.warn || ((...a) => console.warn('⚠️ ', ...a)),
    error: opts.logger?.error || ((...a) => console.error('❌ ', ...a)),
  };

  if (process.env.NODE_ENV !== 'production') {
    return { ok: true, skipped: true, reason: 'non-production' };
  }

  const fatal = [];
  const warn = [];

  // ---- 1. 驗證碼測試後門 ----------------------------------------------------
  // services/captcha.js 已經喺 production 硬性停用 bypass，
  // 呢度再做多一層：連環境變數都唔俾出現（避免日後有人改返 captcha.js 嗰條閘就即刻中招）
  if (process.env.CAPTCHA_TEST_BYPASS) {
    fatal.push(
      'CAPTCHA_TEST_BYPASS 唔可以喺生產環境設定 —— 任何人用固定答案就可以繞過驗證碼做暴力破解 / 批量註冊。\n' +
      '   修法：喺 .env 刪除 CAPTCHA_TEST_BYPASS 呢行（測試環境由 npm run qa 自己注入）。'
    );
  }

  // ---- 2. Session 密鑰 ------------------------------------------------------
  if (!process.env.SESSION_SECRET) {
    fatal.push(
      'SESSION_SECRET 未設定 —— JWT 每次重啟都會失效，而且隨機密鑰代表無法做多實例水平擴展（ALB 後面會隨機登出使用者）。\n' +
      '   修法：node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))" 生成後寫入 .env / AWS Secrets Manager。'
    );
  } else if (process.env.SESSION_SECRET.length < 32) {
    fatal.push('SESSION_SECRET 太短（< 32 字元），容易被爆破。請改用至少 48 bytes 嘅隨機值。');
  }

  // ---- 3. 管理員初始密碼 ----------------------------------------------------
  const adminPw = process.env.ADMIN_PASSWORD;
  if (adminPw && WEAK_ADMIN_PASSWORDS.has(adminPw)) {
    fatal.push(
      'ADMIN_PASSWORD 仍然係已知嘅預設 / 測試值。首次建庫後呢個密碼會成為真實 admin 密碼。\n' +
      '   修法：改用強密碼，或者唔設 ADMIN_PASSWORD（系統會隨機生成並印喺 log）。'
    );
  }

  // ---- 4. 對外域名 ----------------------------------------------------------
  const domain = (process.env.SITE_DOMAIN || '').trim();
  if (!domain || PLACEHOLDER_DOMAINS.has(domain)) {
    warn.push(
      'SITE_DOMAIN 未設定或仍係 placeholder（' + (domain || '(空)') + '）。' +
      'Stripe / WhatsApp 嘅回呼連結會指去錯地方。上 ALB 前記得設成真實域名。'
    );
  }

  // ---- 5. Stripe Webhook 機密 ----------------------------------------------
  if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_WEBHOOK_SECRET) {
    warn.push('已設 STRIPE_SECRET_KEY 但無 STRIPE_WEBHOOK_SECRET —— webhook 簽名驗證會失敗，付款狀態無法自動更新。');
  }

  // ---- 輸出 ----------------------------------------------------------------
  warn.forEach((w) => log.warn(w));

  if (fatal.length > 0) {
    log.error('============================================================');
    log.error(' 生產環境安全預檢失敗，伺服器拒絕啟動');
    log.error('============================================================');
    fatal.forEach((f, i) => log.error(` ${i + 1}. ${f}`));
    log.error('------------------------------------------------------------');
    log.error(' 若你確知風險並想強行啟動（只限緊急排障）：設 ALLOW_UNSAFE_START=1');
    log.error('============================================================');
    if (process.env.ALLOW_UNSAFE_START !== '1') {
      process.exit(1);
    }
    log.warn('ALLOW_UNSAFE_START=1 已設定 —— 強行啟動，上述風險由操作者承擔。');
    return { ok: false, forced: true, fatal, warn };
  }

  return { ok: true, skipped: false, fatal: [], warn };
};

module.exports = { runPreflight, WEAK_ADMIN_PASSWORDS, PLACEHOLDER_DOMAINS };
