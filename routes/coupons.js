const express = require('express');

// ==================== 社福卷（買券 → 享特定次數免費診症）====================
// 客戶在會員中心輸入社福卷密碼 → 享有免費診症次數（free_total）。
// 購買流程接 Stripe Checkout；未配置 STRIPE_SECRET_KEY 時走 test-bypass 直接啟用。

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  try { return require('stripe')(process.env.STRIPE_SECRET_KEY); } catch (e) { return null; }
}

// 把免費次數加到客戶帳戶（避免重複計：同一 code+user 只計一次）
async function grantFreeConsults(db, userId, coupon, { purchased = false } = {}) {
  // 已經有呢張 code 嘅記錄就唔重複加
  const existing = await new Promise((res, rej) =>
    db.get('SELECT id FROM user_coupons WHERE user_id=? AND coupon_code=?', [userId, coupon.code], (e, r) => e ? rej(e) : res(r)));
  if (existing) return { already: true, id: existing.id };
  const ts = new Date().toISOString();
  return await new Promise((res, rej) =>
    db.run(
      'INSERT INTO user_coupons (user_id, coupon_code, free_total, free_used, status, purchased_at, redeemed_at) VALUES (?,?,?,0,?,?,?)',
      [userId, coupon.code, coupon.free_count, 'active', purchased ? ts : null, ts],
      function (e) { e ? rej(e) : res({ already: false, id: this.lastID }); }
    ));
}

function getFreeRemaining(db, userId) {
  return new Promise((res, rej) =>
    db.get(
      'SELECT COALESCE(SUM(free_total - free_used),0) AS remaining, COUNT(*) AS count FROM user_coupons WHERE user_id=? AND status="active"',
      [userId], (e, r) => e ? rej(e) : res(r || { remaining: 0, count: 0 })));
}

function q1(db, sql, params) {
  return new Promise((res, rej) => db.get(sql, params, (e, r) => e ? rej(e) : res(r)));
}

module.exports = (db, { requireAuth, requireRole } = {}) => {
  const router = express.Router();

  // 🔒 管理員：列出所有社福卷定義
  router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const list = await new Promise((r, j) =>
        db.all('SELECT id, code, title, free_count, price_hkd, active, created_at FROM coupons ORDER BY id DESC', [], (e, x) => e ? j(e) : r(x || [])));
      res.json({ ok: true, coupons: list });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 🔒 管理員：建立社福卷
  router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const { code, title, free_count, price_hkd } = req.body || {};
      if (!code || !/^[A-Za-z0-9_-]{3,40}$/.test(code)) return res.status(400).json({ error: '社福卷密碼格式無效（3-40 位英文數字）' });
      const fc = parseInt(free_count, 10);
      if (!fc || fc < 1) return res.status(400).json({ error: '免費診症次數必須 ≥ 1' });
      const exist = await q1(db, 'SELECT id FROM coupons WHERE code=?', [code]);
      if (exist) return res.status(409).json({ error: '呢個社福卷密碼已經存在' });
      const id = await new Promise((r, j) =>
        db.run('INSERT INTO coupons (code, title, free_count, price_hkd, active, created_by) VALUES (?,?,?,?,1,?)',
          [code, title || '', fc, parseFloat(price_hkd || 0), req.user.id],
          function (e) { e ? j(e) : r(this.lastID); }));
      res.json({ ok: true, id, code });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 🔒 管理員：停用社福卷
  router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      await new Promise((r, j) => db.run('UPDATE coupons SET active=0 WHERE id=?', [req.params.id], e => e ? j(e) : r()));
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 👤 客戶：查看自己嘅社福卷 + 剩餘免費診症
  router.get('/my', requireAuth, async (req, res) => {
    try {
      if (req.user.role !== 'customer') return res.status(403).json({ error: '只限客戶' });
      const list = await new Promise((r, j) =>
        db.all(
          `SELECT uc.id, uc.coupon_code, uc.free_total, uc.free_used, uc.status, uc.purchased_at, uc.redeemed_at,
                  (uc.free_total - uc.free_used) AS remaining, c.title, c.price_hkd
           FROM user_coupons uc LEFT JOIN coupons c ON c.code = uc.coupon_code
           WHERE uc.user_id=? ORDER BY uc.id DESC`, [req.user.id], (e, x) => e ? j(e) : r(x || [])));
      const total = await getFreeRemaining(db, req.user.id);
      res.json({ ok: true, coupons: list, totalRemaining: total.remaining });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 👤 客戶：購買社福卷（接 Stripe；有價券必須付款，唔可 test-bypass 白嫖）
  router.post('/purchase', requireAuth, async (req, res) => {
    try {
      if (req.user.role !== 'customer') return res.status(403).json({ error: '只限客戶' });
      const { code } = req.body || {};
      const coupon = await q1(db, 'SELECT * FROM coupons WHERE code=? AND active=1', [code]);
      if (!coupon) return res.status(404).json({ error: '社福卷不存在或已停用' });
      // 宣傳碼（$0）唔走購買，請用 /redeem
      if (!coupon.price_hkd || coupon.price_hkd <= 0) {
        return res.status(400).json({ error: '此為宣傳碼，請用「輸入優惠碼」啟用', code: 'use_redeem' });
      }

      const stripe = getStripe();
      if (!stripe) {
        return res.status(503).json({ error: '付款服務未配置，請聯絡診所職員購買' });
      }
      const base = process.env.PUBLIC_BASE_URL || 'http://localhost:4000';
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'hkd',
            product_data: { name: coupon.title || ('社福卷 ' + coupon.code) },
            unit_amount: Math.round(coupon.price_hkd * 100)
          },
          quantity: 1
        }],
        success_url: `${base}/index.html?coupon=success&code=${encodeURIComponent(code)}`,
        cancel_url: `${base}/index.html?coupon=cancel`,
        metadata: { type: 'coupon', code, userId: String(req.user.id) }
      });
      return res.json({ ok: true, requiresPayment: true, sessionUrl: session.url, sessionId: session.id });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 👤 客戶：輸入宣傳碼啟用（僅限 $0 宣傳碼；有價券必須經 Stripe 購買）
  router.post('/redeem', requireAuth, async (req, res) => {
    try {
      if (req.user.role !== 'customer') return res.status(403).json({ error: '只限客戶' });
      const { code } = req.body || {};
      const coupon = await q1(db, 'SELECT * FROM coupons WHERE code=? AND active=1', [code]);
      if (!coupon) return res.status(404).json({ error: '優惠碼無效或已停用' });
      // 🔒 有價券唔可 redeem 白嫖
      if (coupon.price_hkd && coupon.price_hkd > 0) {
        return res.status(403).json({ error: '此社福卷需付款購買，請經會員中心購買', code: 'payment_required' });
      }
      const g = await grantFreeConsults(db, req.user.id, coupon, { purchased: false });
      if (g.already) return res.status(409).json({ error: '呢張優惠碼已經啟用過' });
      const total = await getFreeRemaining(db, req.user.id);
      res.json({ ok: true, granted: true, freeAdded: coupon.free_count, totalRemaining: total.remaining, code });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 🔒 Stripe webhook：付款成功後啟用社福卷
  //    未配置 STRIPE_WEBHOOK_SECRET 時一律拒絕，避免偽造事件白嫖
  router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const stripe = getStripe();
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(503).json({ error: 'Stripe webhook 未配置' });
    }
    let event;
    try {
      const sig = req.headers['stripe-signature'];
      const raw = req.rawBody || req.body;
      event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (e) { return res.status(400).send(`Webhook Error: ${e.message}`); }
    try {
      if (event && event.type === 'checkout.session.completed') {
        const meta = (event.data && event.data.object && event.data.object.metadata) || {};
        if (meta.type === 'coupon' && meta.code && meta.userId) {
          const coupon = await q1(db, 'SELECT * FROM coupons WHERE code=? AND active=1', [meta.code]);
          if (coupon) await grantFreeConsults(db, parseInt(meta.userId, 10), coupon, { purchased: true });
        }
      }
      res.json({ received: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
