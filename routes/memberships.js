const express = require('express');

// 🔒 分層密碼政策：暫時密碼改用強隨機生成器（混合大小寫 + 數字，符合新政策）
const { generateTempPassword } = require('../services/passwordPolicy');

// WhatsApp 服務 - 根據環境變數選擇（子帳戶帳號/暫時密碼經 WhatsApp 發送給家長）
const whatsappProvider = process.env.WHATSAPP_PROVIDER || 'twilio';
let whatsappService;
if (whatsappProvider === 'android') {
  whatsappService = require('../services/whatsapp-android');
} else if (whatsappProvider === '360dialog') {
  whatsappService = require('../services/whatsapp-360dialog');
} else {
  whatsappService = require('../services/whatsapp');
}

// ==================== 會員訂閱 / 家庭帳戶 / Stripe 支付 ====================
// 注意：webhook 使用已由全局 bodyParser.json 解析後的 req.body（Test Mode 不驗簽名）

const TIER_INFO = {
  general: { name: '一般會員', price: 0, desc: '基礎預約與個人資料管理' },
  premium: { name: '高級會員', price: 8800, desc: '全部服務預約、優先時段、案例庫' },
  family: { name: '家庭會員', price: 16800, desc: '高級會員功能 + 家庭帳戶（子帳戶管理）' }
};

function computeAge(birthDate) {
  if (!birthDate) return 0;
  const b = new Date(birthDate);
  if (isNaN(b.getTime())) return 0;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

// 距離 18 歲生日仲有几多日（資料無效回 null）
function daysUntil18(birthDate) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (isNaN(b.getTime())) return null;
  const now = new Date();
  const d18 = new Date(b.getFullYear() + 18, b.getMonth(), b.getDate());
  return Math.ceil((d18 - now) / 86400000);
}

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  try { return require('stripe')(process.env.STRIPE_SECRET_KEY); } catch (e) { return null; }
}

module.exports = (db, { requireAuth, requireRole } = {}) => {
  const router = express.Router();

  // 🔒 H3：家庭帳戶單一來源服務（family_links 為真源，family_head_id 為同步鏡像）
  const familyService = require('../services/family')(db);

  const q = (sql, params) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
  const q1 = (sql, params) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
  const run = (sql, params) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
  });

  const activateSubscription = async (userId, tier, paymentId) => {
    const now = new Date();
    const start = now.toISOString().slice(0, 10);
    const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await run("INSERT INTO subscriptions (user_id, tier, status, start_date, end_date, payment_id) VALUES (?,?,?,?,?,?)",
      [userId, tier, 'active', start, end, paymentId || null]);
    await run("UPDATE users SET membership_tier=? WHERE id=?", [tier, userId]);
  };

  // 🔁 取得/建立 Stripe 月費 Price（lookup_key 冪等；或讀取 .env 指定 price id）
  const getOrCreatePrice = async (stripe, tier) => {
    const info = TIER_INFO[tier];
    if (!info) throw new Error('無效會員級別');
    const envKey = process.env['STRIPE_PRICE_' + tier.toUpperCase()];
    if (envKey) return envKey;
    const lookupKey = `bw_membership_${tier}_monthly`;
    const list = await stripe.prices.list({ lookup_key: lookupKey, active: true, limit: 1 });
    if (list.data && list.data.length) return list.data[0].id;
    const product = await stripe.products.create({ name: `寶天醫館 ${info.name}`, metadata: { tier } });
    const price = await stripe.prices.create({
      currency: 'hkd',
      unit_amount: info.price * 100,
      recurring: { interval: 'month' },
      product: product.id,
      lookup_key: lookupKey,
      nickname: info.name
    });
    return price.id;
  };

  // 🔁 取得/建立 Stripe Customer（按 user 資料；冇 email 就用 phone 做備註）
  const getOrCreateCustomer = async (stripe, user) => {
    if (user.stripe_customer_id) {
      try {
        const c = await stripe.customers.retrieve(user.stripe_customer_id);
        if (c && !c.deleted) return c.id;
      } catch (e) { /* 跌咗就重建 */ }
    }
    const customerData = { metadata: { userId: String(user.id), username: user.username || '' } };
    if (user.email) customerData.email = user.email;
    if (user.name) customerData.name = user.name;
    if (user.phone) customerData.phone = user.phone;
    const c = await stripe.customers.create(customerData);
    await run("UPDATE users SET stripe_customer_id=? WHERE id=?", [c.id, user.id]);
    return c.id;
  };

  // 🔁 套用「生效中」嘅月費訂閱（Stripe Subscription 模式）
  const applyActiveSubscription = async (userId, tier, stripeSubId, stripeCustomerId) => {
    const now = new Date();
    const start = now.toISOString().slice(0, 10);
    const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await run(
      "UPDATE users SET membership_tier=?, stripe_subscription_id=?, stripe_customer_id=COALESCE(?, stripe_customer_id), subscription_status='active' WHERE id=?",
      [tier, stripeSubId || null, stripeCustomerId || null, userId]);
    await run("UPDATE subscriptions SET status='replaced' WHERE user_id=? AND status='active'", [userId]);
    await run("INSERT INTO subscriptions (user_id, tier, status, start_date, end_date, payment_id) VALUES (?,?,?,?,?,?)",
      [userId, tier, 'active', start, end, stripeSubId || null]);
  };

  // 🔁 取消月費訂閱：通知 Stripe 停止扣款 + 本地回復會籍（家庭連結一併解除）
  // 回傳解除咗幾多位家庭成員，等訊息可以講清楚後果
  const cancelUserSubscription = async (user) => {
    const stripe = getStripe();
    if (user.stripe_subscription_id && stripe) {
      try { await stripe.subscriptions.cancel(user.stripe_subscription_id); }
      catch (e) { console.error('取消 Stripe 訂閱失敗:', e.message); }
    }
    const oldTier = user.membership_tier || 'general';
    let detached = 0;
    if (oldTier === 'family') {
      detached = await familyService.detachAllChildren(user.id);
    }
    await run("UPDATE subscriptions SET status='cancelled' WHERE user_id=? AND status='active'", [user.id]);
    await run("UPDATE users SET membership_tier='general', stripe_subscription_id=NULL, subscription_status='canceled' WHERE id=?", [user.id]);
    return detached;
  };

  const userBySubscription = (subId) =>
    q1("SELECT id, membership_tier, stripe_subscription_id FROM users WHERE stripe_subscription_id=?", [subId]);

  // GET /api/membership — 會員儀表板資料
  router.get('/', requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const tier = user.membership_tier || 'general';
      const subStatusRow = await q1("SELECT subscription_status FROM users WHERE id=?", [user.id]);
      const subStatus = (subStatusRow && subStatusRow.subscription_status) || 'none';
      const sub = await q1("SELECT * FROM subscriptions WHERE user_id=? AND status='active' ORDER BY id DESC LIMIT 1", [user.id]);
      const children = await q(
        `SELECT u.id, u.name, u.username, u.birth_date, u.created_at, fl.relation, fl.created_at AS linked_at
         FROM family_links fl JOIN users u ON u.id = fl.child_user_id
         WHERE fl.parent_user_id=? ORDER BY u.id`, [user.id]);
      const parent = await q1(
        `SELECT u.id, u.name, u.username FROM family_links fl JOIN users u ON u.id = fl.parent_user_id
         WHERE fl.child_user_id=? LIMIT 1`, [user.id]);
      const isFamilyHead = Number(user.family_head_id) === Number(user.id) || children.length > 0;
      res.json({
        tier,
        tierName: (TIER_INFO[tier] || TIER_INFO.general).name,
        subscriptionStatus: subStatus,
        subscription: sub || null,
        upgradeOptions: TIER_INFO,
        isFamilyHead,
        canApplyFamily: tier === 'family' && !isFamilyHead,
        parent: parent || null,
        children: children.map(c => ({ ...c, age: computeAge(c.birth_date), isAdult: computeAge(c.birth_date) >= 18 })),
        insurance: Number(user.insurance_covered) === 1,
        profile_completed: user.profile_completed
      });
    } catch (e) {
      console.error('查詢會員資料失敗:', e);
      res.status(500).json({ error: '系統錯誤' });
    }
  });

  // GET /api/membership/stripe-config
  router.get('/stripe-config', requireAuth, (req, res) => {
    res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null, testMode: true });
  });

  // POST /api/membership/checkout — 建立 Stripe Checkout Session（Subscription 模式，每月自動扣款）
  router.post('/checkout', requireAuth, async (req, res) => {
    const { tier } = req.body || {};
    if (!['premium', 'family'].includes(tier)) return res.status(400).json({ error: '無效的會員級別' });
    const user = req.user;
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ error: '支付服務未設定（請在 .env 設定 STRIPE_SECRET_KEY）', code: 'stripe_not_configured' });
    }
    try {
      const fullUser = await q1("SELECT id, username, name, email, phone, stripe_customer_id FROM users WHERE id=?", [user.id]);
      const customerId = await getOrCreateCustomer(stripe, fullUser);
      const priceId = await getOrCreatePrice(stripe, tier);
      const baseUrl = process.env.SITE_URL || `http://localhost:${process.env.PORT || 4000}`;
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${baseUrl}/index.html?payment=success&tier=${tier}`,
        cancel_url: `${baseUrl}/index.html?payment=cancelled`,
        client_reference_id: String(user.id),
        metadata: { userId: String(user.id), tier, initiatedBy: 'self' }
      });
      res.json({ url: session.url });
    } catch (e) {
      console.error('建立 Stripe Checkout 失敗:', e.message);
      res.status(500).json({ error: '支付建立失敗' });
    }
  });

  // POST /api/membership/cancel — 🔒 客戶自行取消月費訂閱（降級為一般會員）；職員/管理員不可代辦
  router.post('/cancel', requireAuth, async (req, res) => {
    const user = req.user;
    if (user.role !== 'customer') return res.status(403).json({ error: '只有客戶可以自行取消月費計劃' });
    try {
      const fullUser = await q1("SELECT id, membership_tier, stripe_subscription_id, family_head_id FROM users WHERE id=?", [user.id]);
      if (!fullUser) return res.status(404).json({ error: '帳戶不存在' });
      // 🛠️ 冇 Stripe 訂閱（例如職員代開／示範帳戶）都照樣可以本地降級，唔會乜都唔做
      if ((fullUser.membership_tier || 'general') === 'general') {
        return res.json({ ok: true, already: true, message: '您目前係一般會員，無需要取消' });
      }
      const detached = await cancelUserSubscription(fullUser);
      res.json({
        ok: true,
        detached,
        message: '月費計劃已取消，已即時降級為一般會員並停止日後扣款。' +
          (detached ? `同時解除 ${detached} 位家庭成員連結（成員帳戶保留，級別返回一般，日後可由職員重新連結）。` : '')
      });
    } catch (e) {
      console.error('客戶取消訂閱失敗:', e.message);
      res.status(500).json({ error: '取消失敗，請稍後再試' });
    }
  });

  // POST /api/membership/webhook — Stripe Webhook（🔒 必須通過官方簽名驗證；未配置密鑰時拒絕）
  router.post('/webhook', (req, res) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey || !secret) return res.status(503).json({ error: '支付服務未設定' });
    const sig = req.headers['stripe-signature'];
    if (!sig || !req.rawBody) return res.status(400).json({ error: '無效簽名' });
    let event;
    try {
      const stripe = require('stripe')(stripeKey);
      event = stripe.webhooks.constructEvent(req.rawBody, sig, secret);
    } catch (e) {
      console.error('❌ Stripe webhook 簽名驗證失敗:', e.message);
      return res.status(400).json({ error: '簽名驗證失敗' });
    }
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object || {};
      const userId = Number((s.metadata && s.metadata.userId) || s.client_reference_id);
      const tier = s.metadata && s.metadata.tier;
      if (userId && ['premium', 'family'].includes(tier)) {
        if (s.subscription) {
          // 🔁 Subscription 模式：啟用月費會籍（之後 Stripe 每月自動扣款）
          applyActiveSubscription(userId, tier, s.subscription, s.customer)
            .then(() => console.log(`✅ Webhook 已啟用月費會員 user=${userId} tier=${tier} sub=${s.subscription}`))
            .catch(err => console.error('Webhook 啟用訂閱失敗:', err.message));
        } else {
          // 舊式一次性付款（例如 confirm 唔經呢度；保留兼容）
          activateSubscription(userId, tier, s.payment_intent || s.id || null)
            .then(() => console.log(`✅ Webhook 已啟用會員 user=${userId} tier=${tier}`))
            .catch(err => console.error('Webhook 啟用訂閱失敗:', err.message));
        }
      }
    } else if (event.type === 'invoice.paid') {
      // 🔁 每月續費成功 → 確保會籍維持生效
      const inv = event.data.object || {};
      const subId = inv.subscription;
      if (subId) {
        userBySubscription(subId).then(u => {
          if (u) return run("UPDATE users SET subscription_status='active' WHERE id=?", [u.id]);
        }).catch(err => console.error('續費狀態更新失敗:', err.message));
      }
    } else if (event.type === 'invoice.payment_failed') {
      // 🔁 扣款失敗 → 標記 past_due（會籍保留，職員跟進）
      const inv = event.data.object || {};
      const subId = inv.subscription;
      if (subId) {
        userBySubscription(subId).then(u => {
          if (u) return run("UPDATE users SET subscription_status='past_due' WHERE id=?", [u.id]);
        }).catch(err => console.error('扣款失敗狀態更新失敗:', err.message));
      }
    } else if (event.type === 'customer.subscription.deleted') {
      // 🔁 訂閱取消（我方或 Stripe）→ 回復一般會員、解除家庭連結、停止扣款
      const sub = event.data.object || {};
      const subId = sub.id;
      if (subId) {
        userBySubscription(subId).then(u => {
          if (!u) return;
          return cancelUserSubscription(u);
        }).catch(err => console.error('訂閱取消處理失敗:', err.message));
      }
    }
    res.json({ received: true });
  });

  // POST /api/membership/apply-family — 申請轉用家庭帳戶
  router.post('/apply-family', requireAuth, async (req, res) => {
    const user = req.user;
    const tier = user.membership_tier || 'general';
    if (tier !== 'family') {
      return res.status(403).json({ error: '請先升級至家庭會員，即可申請家庭帳戶', code: 'needs_family_tier' });
    }
    try {
      await familyService.enableHead(user.id);
      res.json({ ok: true, message: '已啟用家庭帳戶，可以開始加入子帳戶' });
    } catch (e) {
      res.status(500).json({ error: '啟用失敗' });
    }
  });

  // POST /api/membership/family/add — 加入子帳戶（關聯現有帳戶）
  // 🔒 規格：子帳戶申請必須喺員工/管理員帳戶實行，一般家庭帳戶只可觀看
  router.post('/family/add', requireAuth, requireRole('staff', 'admin'), async (req, res) => {
    const { parentUserId, parentUsername, childUsername, childBirthDate, relation } = req.body || {};
    if (!childUsername) return res.status(400).json({ error: '請輸入子帳戶的用戶名' });
    if (!childBirthDate) return res.status(400).json({ error: '請提供子帳戶的出生日期' });
    const parent = await resolveParent(parentUserId, parentUsername, { allowNonFamilyTier: !!req.body.allowNonFamilyTier });
    if (!parent.ok) {
      return res.status(parent.status || 400).json({
        error: parent.error,
        ...(parent.code ? { code: parent.code, tier: parent.tier } : {})
      });
    }
    const head = parent.user;
    try {
      const child = await q1("SELECT id, username, birth_date FROM users WHERE username=? COLLATE NOCASE", [childUsername]);
      if (!child) return res.status(404).json({ error: '找不到該用戶名嘅帳戶' });
      // 🔒 一個帳戶只可屬於一個家庭：已連結另一戶主時拒絕（避免資料混亂）
      const existingLink = await q1("SELECT * FROM family_links WHERE child_user_id=?", [child.id]);
      if (existingLink && Number(existingLink.parent_user_id) !== Number(head.id)) {
        return res.status(409).json({ error: `「${child.username}」已連結咗另一個家庭帳戶，請先由該家庭移除後再連結` });
      }
      // 👨‍👩‍👧 連結入家庭：general 級自動升做 family 級（premium 保持不變，永不降級）
      await run("UPDATE users SET birth_date=? WHERE id=?", [childBirthDate, child.id]);
      await familyService.addChild(head.id, child.id, relation || 'parent');
      res.json({ ok: true, message: '已加入子帳戶', child: { id: child.id, username: child.username } });
    } catch (e) {
      console.error('加入子帳戶失敗:', e);
      res.status(500).json({ error: '加入失敗' });
    }
  });

  // 經 WhatsApp 發送子帳戶登入資料給家長（SMS 已取消，統一 WhatsApp）
  const sendChildCredentials = async (phone, title, childName, username, tempPassword) => {
    const result = { whatsapp: false, error: null };
    try {
      if (!whatsappService.isConfigured()) { result.error = 'WhatsApp 未配置'; return result; }
      if (!phone || !/^\d{8}$/.test(String(phone))) { result.error = '家長電話無效'; return result; }
      let formatted = String(phone);
      if (!formatted.startsWith('+')) formatted = '+852' + formatted.replace(/^852/, '');
      const message = [
        `【寶天醫館】${title}`,
        '',
        `成員姓名：${childName}`,
        `登入帳戶：${username}`,
        `暫時密碼：${tempPassword}`,
        '',
        '首次登入後請立即修改密碼。如對此訊息有疑問，請致電 2555-1136 與職員聯絡。'
      ].join('\n');
      const r = await whatsappService.sendWhatsApp(formatted, message);
      result.whatsapp = !!(r && r.success);
      if (!result.whatsapp) result.error = (r && r.error) || '發送失敗';
    } catch (e) {
      result.error = e.message || '發送異常';
    }
    return result;
  };

  // 依 parentUserId / parentUsername 解析家庭帳戶戶主（員工代操作時使用）
  // 🛠️ 容錯：parentUsername 搵唔到時，後備用中文姓名精確匹配（員工好易撈亂「會員ID」同「姓名」）
  const resolveParent = async (parentUserId, parentUsername, opts = {}) => {
    let head = null;
    const norm = (s) => String(s || '').trim();
    if (parentUserId) {
      head = await q1("SELECT id, username, name, phone, family_head_id, membership_tier FROM users WHERE id=?", [parentUserId]);
    } else if (norm(parentUsername)) {
      head = await q1("SELECT id, username, name, phone, family_head_id, membership_tier FROM users WHERE username=? COLLATE NOCASE", [norm(parentUsername)]);
      if (!head) {
        head = await q1("SELECT id, username, name, phone, family_head_id, membership_tier FROM users WHERE name=? AND role='customer'", [norm(parentUsername)]);
      }
      if (!head) {
        // 再後備：姓名 LIKE 部分匹配（只有一個候選先自動採用，避免撞名錯誤連結）
        const like = await q(
          "SELECT id, username, name, phone, family_head_id, membership_tier FROM users WHERE name LIKE ? AND role='customer'",
          [`%${norm(parentUsername)}%`]);
        if (like && like.length === 1) head = like[0];
      }
    } else {
      return { ok: false, status: 400, error: '請指定家庭帳戶戶主（parentUserId 或 parentUsername）' };
    }
    if (!head) return { ok: false, status: 404, error: '找不到該家庭帳戶戶主，請確認輸入嘅係「會員ID」（例如 NAN000）或完整中文姓名' };
    // 戶主未啟用家庭帳戶 → 自動啟用（員工代操作視為已確認）
    if (Number(head.family_head_id) !== Number(head.id)) {
      // 💰 非家庭會員：先要員工二次確認（前端 confirm 後帶 allowNonFamilyTier=true 重試），
      //    避免一嘢幫一般／高級會員開咗家庭帳戶、漏收月費差額
      if ((head.membership_tier || 'general') !== 'family' && !opts.allowNonFamilyTier) {
        return {
          ok: false, status: 409, code: 'parent_not_family_tier', tier: head.membership_tier,
          error: `「${head.name}」目前係「${head.membership_tier || 'general'}」會員（非家庭會員）。照樣啟用家庭帳戶？費用差額按現行安排處理。`
        };
      }
      await familyService.enableHead(head.id);
    }
    return { ok: true, user: head };
  };

  // 生成唯一用戶名（1-6 位英數字，COLLATE NOCASE 唯一）
  const generateChildUsername = async (base) => {
    const prefix = (base || 'fam').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toLowerCase() || 'fam';
    for (let i = 1; i <= 9999; i++) {
      const suffix = String(i).padStart(2, '0');
      const candidate = (prefix + suffix).slice(0, 6);
      const exists = await q1("SELECT id FROM users WHERE username=? COLLATE NOCASE", [candidate]);
      if (!exists) return candidate;
    }
    // 極端情況下用隨機
    for (let i = 0; i < 100; i++) {
      const candidate = String(Math.floor(100000 + Math.random() * 900000));
      const exists = await q1("SELECT id FROM users WHERE username=? COLLATE NOCASE", [candidate]);
      if (!exists) return candidate;
    }
    throw new Error('無法生成唯一用戶名');
  };

  // POST /api/membership/family/register — 親子家庭成員註冊（自動生成帳戶 + 一次性臨時密碼）
  // 🔒 規格：子帳戶申請必須喺員工/管理員帳戶實行（需指定戶主 parentUserId / parentUsername）
  router.post('/family/register', requireAuth, requireRole('staff', 'admin'), async (req, res) => {
    const { parentUserId, parentUsername, name, name_en, birth_date, phone, id_card, address, relation, gender } = req.body || {};

    const parent = await resolveParent(parentUserId, parentUsername, { allowNonFamilyTier: !!req.body.allowNonFamilyTier });
    if (!parent.ok) {
      return res.status(parent.status || 400).json({
        error: parent.error,
        ...(parent.code ? { code: parent.code, tier: parent.tier } : {})
      });
    }
    const head = parent.user;

    if (!name || !/[\u4E00-\u9FFF]/.test(name)) {
      return res.status(400).json({ error: '子帳戶姓名必須包含中文字元' });
    }
    if (!birth_date) {
      return res.status(400).json({ error: '必須提供子帳戶出生日期' });
    }
    const age = computeAge(birth_date);
    if (age >= 18) {
      return res.status(403).json({ error: '家庭帳戶嘅子帳戶必須為 18 歲以下。成年成員請由職員以「連結帳戶」加入。' });
    }
    // 🛠️ 電話容錯：自動清走空格／橫線等分隔符（例如「6123 4567」→「61234567」）
    const cleanPhone = (p) => String(p || '').replace(/[\s\-–—]/g, '');
    const childPhone = cleanPhone(phone) || cleanPhone(head.phone);
    if (!childPhone || !/^\d{8}$/.test(childPhone)) {
      return res.status(400).json({
        error: phone
          ? '請輸入有效的 8 位電話號碼（只須數字）'
          : `監護人（${head.name}）電話號碼無效或不存在，請為子帳戶提供 8 位電話號碼`
      });
    }
    // 同一位監護人不可重複為同名子女開戶
    const dup = await q1(
      "SELECT u.name FROM family_links fl JOIN users u ON u.id=fl.child_user_id WHERE fl.parent_user_id=? AND u.name=? COLLATE NOCASE",
      [head.id, name]);
    if (dup) return res.status(400).json({ error: `子帳戶「${name}」已經存在，請直接連結或使用其他姓名` });

    try {
      const username = await generateChildUsername(head.username);
      // 臨時密碼：強隨機生成（BT 前綴 + 混合大小寫字母與數字，同時符合客人及特權密碼政策）
      const tempPassword = generateTempPassword();
      const hashed = require('bcrypt').hashSync(tempPassword, 10);
      // 👨‍👩‍👧 子帳戶自動跟戶主做 family 級：家庭計劃保障全家，仔女即時可以預約所有服務
      const inserted = await run(
        `INSERT INTO users (username, password, name, name_en, phone, email, id_card, address, birth_date,
          role, membership_tier, profile_completed, must_change_password, insurance_covered)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [username, hashed, name, name_en || '', childPhone, null, id_card || null, address || null, birth_date,
          'customer', 'family', 1, 1, 1]);
      const childId = inserted.lastID;
      await familyService.addChild(head.id, childId, relation || 'parent');

      // 📲 自動經 WhatsApp 將登入帳戶 + 暫時密碼發送給家長
      const notified = await sendChildCredentials(childPhone, '家庭成員子帳戶已建立', name, username, tempPassword);

      res.json({
        ok: true,
        message: notified.whatsapp ? '子帳戶已建立，登入資料已發送至家長 WhatsApp' : '子帳戶已建立',
        child: { id: childId, username, name },
        credentials: { username, tempPassword },
        notified
      });
    } catch (e) {
      console.error('註冊子帳戶失敗:', e);
      res.status(500).json({ error: '子帳戶註冊失敗：' + (e.message || '') });
    }
  });

  // POST /api/membership/family/reset-child-password — 重設子帳戶暫時密碼並重新發送（職員/管理員）
  router.post('/family/reset-child-password', requireAuth, requireRole('staff', 'admin'), async (req, res) => {
    const { childUserId, childUsername } = req.body || {};
    if (!childUserId && !childUsername) {
      return res.status(400).json({ error: '請指定子帳戶（childUserId 或 childUsername）' });
    }
    try {
      const child = childUserId
        ? await q1("SELECT id, username, name, phone, family_head_id FROM users WHERE id=?", [Number(childUserId)])
        : await q1("SELECT id, username, name, phone, family_head_id FROM users WHERE username=? COLLATE NOCASE", [String(childUsername).trim()]);
      if (!child) return res.status(404).json({ error: '找不到該子帳戶' });

      // 收件人：優先子帳戶自己電話，否則用戶主電話
      let headPhone = null;
      if (child.family_head_id) {
        const h = await q1("SELECT phone FROM users WHERE id=?", [child.family_head_id]);
        headPhone = h && h.phone;
      }
      if (!headPhone) {
        const link = await q1("SELECT parent_user_id FROM family_links WHERE child_user_id=? ORDER BY created_at DESC LIMIT 1", [child.id]);
        if (link) {
          const h = await q1("SELECT phone FROM users WHERE id=?", [link.parent_user_id]);
          headPhone = h && h.phone;
        }
      }

      const tempPassword = generateTempPassword();
      const hashed = require('bcrypt').hashSync(tempPassword, 10);
      await run("UPDATE users SET password=?, must_change_password=1 WHERE id=?", [hashed, child.id]);

      const targetPhone = (child.phone && /^\d{8}$/.test(String(child.phone))) ? child.phone : headPhone;
      const notified = await sendChildCredentials(targetPhone, '子帳戶暫時密碼已重設', child.name, child.username, tempPassword);

      res.json({
        ok: true,
        message: notified.whatsapp ? '暫時密碼已重設並發送至 WhatsApp' : '暫時密碼已重設',
        credentials: { username: child.username, tempPassword },
        notified
      });
    } catch (e) {
      console.error('重設子帳戶密碼失敗:', e);
      res.status(500).json({ error: '重設失敗' });
    }
  });

  // GET /api/membership/family — 家庭成員 + 年齡權限
  router.get('/family', requireAuth, async (req, res) => {
    try {
      const user = req.user;
      let parentId = user.id;
      let parentName = user.name;
      // 職員/管理員可指定家長帳戶名查詢其家庭成員
      // 🛠️ 同 resolveParent 一致：會員ID → 中文姓名精確 → 姓名部分匹配（唯一先採用）
      if ((user.role === 'staff' || user.role === 'admin') && req.query.parentUsername) {
        const qn = String(req.query.parentUsername).trim();
        let p = await q1("SELECT id, name, username FROM users WHERE username=? COLLATE NOCASE", [qn]);
        if (!p) p = await q1("SELECT id, name, username FROM users WHERE name=? AND role='customer'", [qn]);
        if (!p) {
          const like = await q("SELECT id, name, username FROM users WHERE name LIKE ? AND role='customer'", [`%${qn}%`]);
          if (like && like.length === 1) p = like[0];
        }
        if (!p) return res.status(404).json({ error: '找不到該家庭帳戶戶主（請輸入會員ID 或 完整中文姓名）' });
        parentId = p.id;
        parentName = p.name;
      }
      const children = await q(
        `SELECT u.id, u.name, u.username, u.birth_date, u.created_at, fl.relation, fl.created_at AS linked_at
         FROM family_links fl JOIN users u ON u.id = fl.child_user_id
         WHERE fl.parent_user_id=? ORDER BY u.id`, [parentId]);
      const withPerm = children.map((c) => {
        const age = computeAge(c.birth_date);
        return {
          ...c,
          age,
          isAdult: age >= 18,
          canManage: age < 18,
          canViewBookings: true,
          canViewMedical: age < 18,
          canViewLateness: age < 18
        };
      });
      res.json({ children: withPerm, parentName, parentUsername: req.query.parentUsername || user.username });
    } catch (e) {
      res.status(500).json({ error: '系統錯誤' });
    }
  });

  // PUT /api/membership/family/:id — 修改子帳戶（僅 18 歲以下）
  router.put('/family/:id', requireAuth, async (req, res) => {
    const childId = Number(req.params.id);
    const user = req.user;
    try {
      const link = await q1("SELECT * FROM family_links WHERE parent_user_id=? AND child_user_id=?", [user.id, childId]);
      if (!link) return res.status(403).json({ error: '沒有權限' });
      const child = await q1("SELECT birth_date FROM users WHERE id=?", [childId]);
      if (computeAge(child && child.birth_date) >= 18) {
        return res.status(403).json({ error: '該子帳戶已成年（18 歲或以上），父帳戶只能查看預約狀態，不能修改個人資料' });
      }
      const { name, phone, address, emergency_contact } = req.body || {};
      await run("UPDATE users SET name=COALESCE(?,name), phone=COALESCE(?,phone), address=COALESCE(?,address), emergency_contact=COALESCE(?,emergency_contact) WHERE id=?",
        [name || null, phone || null, address || null, emergency_contact || null, childId]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: '更新失敗' });
    }
  });

  // GET /api/membership/family/:id/bookings — 子帳戶預約（18+ 只顯示「預約成功」狀態）
  router.get('/family/:id/bookings', requireAuth, async (req, res) => {
    const childId = Number(req.params.id);
    const user = req.user;
    try {
      const link = await q1("SELECT * FROM family_links WHERE parent_user_id=? AND child_user_id=?", [user.id, childId]);
      if (!link) return res.status(403).json({ error: '沒有權限' });
      const child = await q1("SELECT birth_date FROM users WHERE id=?", [childId]);
      const age = computeAge(child && child.birth_date);
      const rows = await q(
        "SELECT id, service_id, appointment_date, appointment_time, status FROM bookings WHERE user_id=? ORDER BY appointment_date DESC, appointment_time DESC",
        [childId]);
      const bookings = age >= 18
        ? rows.map(r => ({ ...r, status: r.status === 'cancelled' ? 'cancelled' : '預約成功' }))
        : rows;
      res.json({ bookings, age });
    } catch (e) {
      res.status(500).json({ error: '系統錯誤' });
    }
  });

  // 管理員：家庭樹狀結構（admin）
  router.get('/admin/tree', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const heads = await q(
        `SELECT u.id, u.name, u.username, u.membership_tier FROM users u
         WHERE u.family_head_id IS NOT NULL AND u.family_head_id = u.id`);
      const tree = [];
      for (const h of heads) {
        const members = await q(
          `SELECT u.id, u.name, u.username, u.phone, u.birth_date, u.membership_tier,
             (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id) AS booking_count
           FROM family_links fl JOIN users u ON u.id = fl.child_user_id
           WHERE fl.parent_user_id=?`, [h.id]);
        tree.push({ ...h, age: computeAge(h.birth_date), members: members.map(m => {
          const age = computeAge(m.birth_date);
          const d18 = daysUntil18(m.birth_date);
          const isAdult = age >= 18;
          return {
            ...m, age, isAdult,
            // 🔔 成年跟進：已成年仍連結 → 職員要按指引處理；60 日內滿 18 → 提早通知家長
            days_to_18: d18,
            turning18Soon: !isAdult && d18 !== null && d18 <= 60
          };
        }) });
      }
      res.json({ tree });
    } catch (e) {
      res.status(500).json({ error: '系統錯誤' });
    }
  });

  // 🗑️ DELETE /api/membership/admin/link/:childUserId — 職員/管理員移除家庭成員連結
  router.delete('/admin/link/:childUserId', requireAuth, requireRole('staff', 'admin'), async (req, res) => {
    try {
      const childId = Number(req.params.childUserId);
      const removed = await familyService.removeChildLink(childId);
      if (!removed) return res.status(404).json({ error: '該成員沒有家庭連結' });
      res.json({ ok: true });
    } catch (e) {
      console.error('移除家庭成員失敗:', e);
      res.status(500).json({ error: '移除失敗' });
    }
  });

  // ==================== 通用帳戶連結（親戚／同輩／朋友，客人自助連結）====================
  // 與 family_links（家庭訂閱父→子）分開：account_links 係純關係圖，唔影響會員級別／保險。
  const RELATION_PRESETS = ['父母', '子女', '配偶', '兄弟', '姐妹', '親戚', '朋友', '其他'];
  // 無序 pair：細 id → user_a，大 id → user_b，保證 (A,B) 唯一
  const normalizePair = (x, y) => (Number(x) < Number(y) ? [Number(x), Number(y)] : [Number(y), Number(x)]);
  // 判斷 caller 能否以 fromUserId 身份連結（admin 任意；家庭戶主可代自己或子女）
  const canLinkAs = async (user, fromUserId) => {
    if (user.role === 'admin') return true;
    if (Number(fromUserId) === Number(user.id)) return true;
    const isHead = Number(user.family_head_id) === Number(user.id);
    if (isHead) {
      const child = await q1("SELECT 1 FROM family_links WHERE parent_user_id=? AND child_user_id=?", [user.id, Number(fromUserId)]);
      return !!child;
    }
    return false;
  };

  // POST /api/membership/account-links — 連結兩個帳戶（客人自助 / 管理員代連所選主帳戶 / 家庭戶主代子女）；連結後來源主帳戶自動轉 family
  router.post('/account-links', requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const { targetUsername, targetPhone, relation, customRelation, fromUserId, fromUsername } = req.body || {};
      if (!relation || !RELATION_PRESETS.includes(relation)) return res.status(400).json({ error: '請選擇有效的關係類型' });
      const displayRelation = relation === '其他' ? String(customRelation || '').trim() : null;
      if (relation === '其他' && !displayRelation) return res.status(400).json({ error: '請輸入關係說明' });

      // 決定連結來源帳戶 fromId（fromUserId 數字 或 fromUsername 文字；管理員可用 fromUsername 代指 A）
      let fromId = user.id;
      if (fromUserId || fromUsername) {
        let candidateId = Number(fromUserId) || null;
        if (!candidateId && fromUsername) {
          const fu = await q1("SELECT id FROM users WHERE username=? COLLATE NOCASE", [String(fromUsername).trim()]);
          if (!fu) return res.status(404).json({ error: '找不到帳戶 A（fromUsername）' });
          candidateId = fu.id;
        }
        if (candidateId && Number(candidateId) !== Number(user.id)) {
          const allowed = await canLinkAs(user, candidateId);
          if (!allowed) return res.status(403).json({ error: '你沒有權限以該帳戶身份連結' });
          fromId = candidateId;
        }
      }

      // 解析目標帳戶
      let target = null;
      if (targetUsername) target = await q1("SELECT id, username, name, role FROM users WHERE username=? COLLATE NOCASE", [String(targetUsername).trim()]);
      else if (targetPhone) target = await q1("SELECT id, username, name, role FROM users WHERE phone=?", [String(targetPhone).trim()]);
      if (!target) return res.status(404).json({ error: '找不到該帳戶（請檢查用戶名或電話）' });
      if (target.role !== 'customer') return res.status(400).json({ error: '只能連結客戶帳戶' });
      if (Number(target.id) === Number(fromId)) return res.status(400).json({ error: '唔可以連結自己' });

      const [a, b] = normalizePair(fromId, target.id);
      const existing = await q1("SELECT id FROM account_links WHERE user_a=? AND user_b=?", [a, b]);
      if (existing) return res.status(409).json({ error: '呢兩個帳戶已經連結咗' });

      const ins = await run(
        "INSERT INTO account_links (user_a, user_b, relation, custom_relation, initiated_by, created_at) VALUES (?,?,?,?,?,?)",
        [a, b, relation, displayRelation, user.id, new Date().toISOString()]);
      // 「一連即轉」：連接第一個成員即將來源主帳戶升為 family（只對 customer；管理員代連時升被選主帳戶）
      const ownerId = (user.role === 'admin') ? fromId : user.id;
      const owner = await q1("SELECT id, role, membership_tier FROM users WHERE id=?", [ownerId]);
      let ownerUpgradedToFamily = false;
      if (owner && owner.role === 'customer' && owner.membership_tier !== 'family') {
        await run("UPDATE users SET membership_tier='family' WHERE id=?", [ownerId]);
        ownerUpgradedToFamily = true;
      }
      res.json({ ok: true, id: ins.lastID, relation, customRelation: displayRelation, fromId, targetId: target.id, ownerUpgradedToFamily });
    } catch (e) {
      console.error('連結帳戶失敗:', e);
      res.status(500).json({ error: '連結失敗' });
    }
  });

  // GET /api/membership/account-links — 列出與自己有關嘅連結（admin / 家庭戶主可指定 userId）
  router.get('/account-links', requireAuth, async (req, res) => {
    try {
      const user = req.user;
      let viewId = user.id;
      if (req.query.userId && Number(req.query.userId) !== Number(user.id)) {
        const allowed = await canLinkAs(user, req.query.userId);
        if (!allowed) return res.status(403).json({ error: '沒有權限檢視該帳戶的連結' });
        viewId = Number(req.query.userId);
      }
      const rows = await q(
        `        SELECT l.id, l.relation, l.custom_relation, l.initiated_by,
                CASE WHEN l.user_a=? THEN l.user_b ELSE l.user_a END AS other_id,
                u.name, u.username, u.membership_tier, u.role
         FROM account_links l
         JOIN users u ON u.id = (CASE WHEN l.user_a=? THEN l.user_b ELSE l.user_a END)
         WHERE l.user_a=? OR l.user_b=?
         ORDER BY l.created_at DESC`,
        [viewId, viewId, viewId, viewId]);
      const links = rows.map(r => ({
        id: r.id,
        relation: r.relation,
        customRelation: r.customRelation,
        other: { id: r.other_id, name: r.name, username: r.username, avatar_url: r.avatar_url, membership_tier: r.membership_tier, role: r.role },
        isSelfInitiated: Number(r.initiated_by) === Number(viewId)
      }));
      res.json({ links });
    } catch (e) {
      console.error('讀取連結失敗:', e);
      res.status(500).json({ error: '系統錯誤' });
    }
  });

  // DELETE /api/membership/account-links/:id — 移除連結（本人／對方／管理員／家庭戶主可移除）
  router.delete('/account-links/:id', requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const linkId = Number(req.params.id);
      const link = await q1("SELECT * FROM account_links WHERE id=?", [linkId]);
      if (!link) return res.status(404).json({ error: '找不到該連結' });
      const involvesSelf = Number(link.user_a) === Number(user.id) || Number(link.user_b) === Number(user.id);
      let allowed = user.role === 'admin' || involvesSelf;
      if (!allowed) {
        const isHead = Number(user.family_head_id) === Number(user.id);
        if (isHead) {
          const child = await q1(
            "SELECT 1 FROM family_links WHERE parent_user_id=? AND (child_user_id=? OR child_user_id=?)",
            [user.id, link.user_a, link.user_b]);
          allowed = !!child;
        }
      }
      if (!allowed) return res.status(403).json({ error: '沒有權限移除該連結' });
      await run("DELETE FROM account_links WHERE id=?", [linkId]);
      // 保守還原：若雙方已無任何連結（account_links + family_links 皆空），將 membership_tier 退回 general
      for (const pid of [link.user_a, link.user_b]) {
        const remain = await q1(
          "SELECT 1 FROM account_links WHERE user_a=? OR user_b=? UNION SELECT 1 FROM family_links WHERE parent_user_id=? OR child_user_id=?",
          [pid, pid, pid, pid]);
        if (!remain) {
          await run("UPDATE users SET membership_tier='general' WHERE id=? AND membership_tier='family'", [pid]);
        }
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('移除連結失敗:', e);
      res.status(500).json({ error: '移除失敗' });
    }
  });

  // GET /api/membership/admin/account-links — 管理員檢視全部連結
  router.get('/admin/account-links', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const rows = await q(
        `SELECT l.id, l.relation, l.custom_relation, l.initiated_by, l.created_at,
                a.id AS a_id, a.name AS a_name, a.username AS a_username,
                b.id AS b_id, b.name AS b_name, b.username AS b_username
         FROM account_links l
         JOIN users a ON a.id = l.user_a
         JOIN users b ON b.id = l.user_b
         ORDER BY l.created_at DESC`);
      res.json({ links: rows });
    } catch (e) {
      console.error('讀取連結列表失敗:', e);
      res.status(500).json({ error: '系統錯誤' });
    }
  });

  // 🔧 POST /api/membership/confirm — 職員/管理員代客啟動會員（電話收款／現金後手動開通）
  // 客戶自助升級一律經 Stripe；呢個端點只係補返離線收款嘅通道
  router.post('/confirm', requireAuth, requireRole('staff', 'admin'), async (req, res) => {
    const { tier, userId } = req.body || {};
    if (!['premium', 'family'].includes(tier)) return res.status(400).json({ error: '無效的會員級別' });
    const targetId = userId ? Number(userId) : req.user.id;
    try {
      const target = await q1("SELECT id FROM users WHERE id=?", [targetId]);
      if (!target) return res.status(404).json({ error: '找不到該客戶' });
      await applyActiveSubscription(targetId, tier, null, null);
      res.json({ ok: true, tier, message: '會員已啟用（離線收款登記）' });
    } catch (e) {
      console.error('啟用會員失敗:', e.message);
      res.status(500).json({ error: '啟用會員失敗' });
    }
  });

  // 🔧 POST /api/membership/change — 職員/管理員代客更改會員級別（升級／降級／轉一般）
  // 💰 系統權限即時生效；實際收費差額由診所喺下個月月結一併處理（介面有標明）
  // 🔒 職員操作必須附自己登入密碼二次驗證；管理員免
  router.post('/change', requireAuth, requireRole('staff', 'admin'), async (req, res) => {
    const { userId, username, tier, adminPassword } = req.body || {};
    if (!['general', 'premium', 'family'].includes(tier)) return res.status(400).json({ error: '無效的會員級別' });
    if (req.user.role === 'staff') {
      if (!adminPassword) return res.status(400).json({ error: '此操作需要輸入你嘅職員登入密碼確認', requiresVerification: true });
      const me = await q1("SELECT password FROM users WHERE id=?", [req.user.id]);
      if (!me || !require('bcrypt').compareSync(String(adminPassword), me.password)) {
        return res.status(401).json({ error: '職員密碼不正確' });
      }
    }
    try {
      let user = null;
      if (userId) user = await q1("SELECT id, membership_tier, family_head_id FROM users WHERE id=?", [Number(userId)]);
      else if (username) user = await q1("SELECT id, membership_tier, family_head_id FROM users WHERE username=? COLLATE NOCASE", [String(username).trim()]);
      if (!user) return res.status(404).json({ error: '找不到該客戶' });
      const oldTier = user.membership_tier || 'general';
      if (oldTier === tier) return res.json({ ok: true, changed: false, message: '級別未變' });

      // 由家庭離開：解除戶主身分＋全部子女連結（子帳戶保留，日後可再連結）
      let detached = 0;
      if (oldTier === 'family') {
        detached = await familyService.detachAllChildren(user.id);
      }

      await run("UPDATE subscriptions SET status='changed' WHERE user_id=? AND status='active'", [user.id]);
      if (tier !== 'general') {
        await applyActiveSubscription(user.id, tier, null, null);
      } else {
        await run("UPDATE users SET membership_tier='general', subscription_status='none' WHERE id=?", [user.id]);
      }
      res.json({
        ok: true, changed: true, from: oldTier, to: tier, detached,
        message: `已由「${oldTier}」更改為「${tier}」` +
          (detached ? `，並解除 ${detached} 位家庭成員連結（成員帳戶保留）` : '') +
          '。費用差額將於下個月月結處理。'
      });
    } catch (e) {
      console.error('更改會員級別失敗:', e);
      res.status(500).json({ error: '更改失敗' });
    }
  });

  return router;
};
