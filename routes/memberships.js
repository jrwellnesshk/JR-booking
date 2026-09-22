const express = require('express');
const rateLimit = require('express-rate-limit');

// 🔒 分層密碼政策：暫時密碼改用強隨機生成器（混合大小寫 + 數字，符合新政策）
const { generateTempPassword } = require('../services/passwordPolicy');

// 🔗 診所設定（電話）— 集中讀取，唔好硬碼
const clinicSettings = require('../services/clinicSettings');

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

// ==================== 關係世代分類器（模塊級，routes 與單元測試共用）====================
// ⚠️ 關鍵需求：親戚（relation = '親戚' 或含 'relative'）必須獨立於「同輩」(兄弟姊妹/朋友)，
//    唔可以同層渲染；兄弟姊妹等真正同輩維持原樣。前端關係圖代理 (#19) 應依此分類。
//   parent   = 上一代（父母）
//   child    = 下一代（子女）
//   spouse   = 同層配偶（配偶）
//   sibling  = 同輩（兄弟 / 姐妹 / 朋友）—— 留喺戶主同一層
//   relative = 親戚 / 其他連結 —— 非同輩，另置「其他連結 / 第五代」層，唔喺戶主同輩
// #5：表／堂兄弟姊妹 = 同輩（同戶主一層，連喺戶主左／右邊）；長輩稱謂 = 親戚層（另置）
const COUSIN_RE = /(表|堂)(兄|弟|姐|妹|哥|姊)/;
const ELDER_RE = /(姨|姑|舅|伯|叔|嬸|爺|嫲|公|婆|丈|母|父)/;
// 🆕 配偶字眼（唔係長輩／同輩通用詞，優先判定配偶群組）
const SPOUSE_RE = /(配偶|丈夫|妻子|老公|老婆|太太|伴侶|夫|妻)/;
// 🆕 親戚（generic）字眼
const RELATIVE_RE = /(親戚|親人|relative)/;
// 🆕 依「具體稱謂」自動判定群組：優先配偶 → 再按世代（GENERATION_OF）歸層。
//    咁樣哥哥／弟弟／姐姐／妹妹 等具體同輩稱謂會正確落入 sibling（戶主層），
//    唔會因為冇喺 switch 枚舉而跌落 relative（第五代層）。
function RELATION_GROUP_OF(relation, customRelation) {
  const r = String(relation || '').trim();
  const c = String(customRelation || '').trim();
  // 配偶優先判定
  if (SPOUSE_RE.test(r) || SPOUSE_RE.test(c)) return 'spouse';
  // 系統枚舉「親戚／其他」：實際關係喺 customRelation
  if (r === '親戚' || r === '其他') {
    if (COUSIN_RE.test(c)) return 'sibling';
    if (ELDER_RE.test(c)) return 'relative';
    // 🆕 自訂具體稱謂：依世代判定（契姐／世姪等未匹配者預設同輩）
    const cgen = GENERATION_OF(r, c);
    if (cgen === 1 || cgen === 2) return 'parent';
    if (cgen === -1 || cgen === -2) return 'child';
    if (RELATIVE_RE.test(c)) return 'relative';
    return 'sibling';
  }
  // 具體稱謂：依世代（GENERATION_OF）判定群組
  const gen = GENERATION_OF(r, c);
  if (gen === 1 || gen === 2) return 'parent';    // 父母輩／祖父母輩 → 上層
  if (gen === -1 || gen === -2) return 'child';   // 子女輩／孫輩 → 下層
  if (RELATIVE_RE.test(r) || RELATIVE_RE.test(c)) return 'relative';
  return 'sibling';                                // 同輩（戶主層）
}
// 關係分組 → 家庭樹層級（供前端分層渲染；第 5 層為「其他連結（親戚／朋友）」非同輩）
const GROUP_TREE_TIER = {
  parent: 1,    // 第一代 · 上一代
  spouse: 2,    // 第二代 · 戶主層
  sibling: 2,   // 同輩 · 戶主層
  child: 3,     // 第三代 · 子女
  relative: 5   // 第五代 · 其他連結（非同輩）
};

// 🆕 世代偏移（相對戶主「本人」，參考華文親屬輩分九族：高祖→玄孫）：
//   +2 祖父母輩（祖父/祖母/外祖父母/爺嫲/公婆）— 最上層
//   +1 父母輩（父母 ＋ 伯叔姑舅姨 等父毋兄弟姐妹）— 家豪上面一層
//    0 同輩（戶主 ＋ 配偶 ＋ 兄弟姊妹 ＋ 朋友 ＋ 表堂）— 家豪同一層
//   -1 子女輩（子女 ＋ 侄甥）— 家豪下面一層
//   -2 孫輩（孫/外孫）— 最下層
//   自訂稱謂（customRelation）優先於系統枚舉（relation）判定世代。
const GEN_TERMS = {
  '+2': ['祖父', '祖母', '外祖父', '外祖母', '爺爺', '嫲嫲', '阿公', '阿嬤', '公公', '婆婆', '太公', '太婆', '曾祖父', '曾祖母', '外曾祖父', '外曾祖母', '祖'],
  '+1': ['父母', '父親', '母親', '爸爸', '媽媽', '阿爸', '阿媽', '老豆', '老母', '父', '母',
    '伯父', '伯母', '叔父', '嬸母', '姑媽', '姑姐', '姑母', '舅父', '舅母', '姨媽', '姨母', '阿姨',
    '丈人', '岳父', '岳母', '家公', '家婆', '世伯', '世叔', '公', '婆'],
  '0': ['配偶', '丈夫', '妻子', '老公', '老婆', '太太', '伴侶', '夫', '妻',
    '兄弟', '姊妹', '哥哥', '姐姐', '細佬', '家姐', '兄', '弟', '姐', '妹', '嫂', '姐夫', '妹夫',
    '朋友', '表弟', '表妹', '表哥', '表姐', '堂弟', '堂妹', '堂哥', '堂姐'],
  '-1': ['子女', '兒子', '女兒', '仔', '囡', '子', '息', '姪', '姪子', '姪女', '外甥', '外甥女'],
  '-2': ['孫', '孫子', '孫女', '孫兒', '外孫', '外孫女'],
};
function GENERATION_OF(relation, customRelation) {
  const r = String(relation || '').trim();
  const c = String(customRelation || '').trim();
  const text = c || r; // 自訂稱謂優先
  // 先查具體詞表：上層（＋2）→ 下下層（−2）→ 父母輩（＋1）→ 子女輩（−1）→ 同輩（0）
  if (GEN_TERMS['+2'].some(t => text.includes(t))) return 2;
  if (GEN_TERMS['-2'].some(t => text.includes(t))) return -2;
  if (GEN_TERMS['+1'].some(t => text.includes(t))) return 1;
  if (GEN_TERMS['-1'].some(t => text.includes(t))) return -1;
  if (GEN_TERMS['0'].some(t => text.includes(t))) return 0;
  // 系統枚舉兜底
  switch (r) {
    case '父母': return 1;
    case '子女': return -1;
    case '配偶': case '兄弟': case '姐妹': case '朋友': return 0;
    case '親戚': case '其他': return 0; // 無自訂稱謂：預設同輩（家豪隔籬）
    default: return 0;
  }
}

// 統一對外：輸出 relationGroup / treeTier / generation，前端 (#19) 唔使再自己估關係
function classifyLink(relation, customRelation) {
  const relationGroup = RELATION_GROUP_OF(relation, customRelation);
  const generation = GENERATION_OF(relation, customRelation);
  return { relationGroup, treeTier: GROUP_TREE_TIER[relationGroup], generation };
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

  // 🏠 家庭計劃 A/B/C/D + 跟死全家嘅單號（JRA/JRB/JRC/JRD 順序）
  // 單號每個計劃對應自己嘅 prefix，一張單 = 一個家庭帳戶
  const PLAN_INVOICE_PREFIX = { A: 'JRA', B: 'JRB', C: 'JRC', D: 'JRD' };
  const familyInvoicePrefix = (plan) => PLAN_INVOICE_PREFIX[plan] || 'JRA';

  // 🔢 計劃上限：A 1-2 人、B 3-5 人、C 6-9 人、D 10 人以上（不設上限）
  // （用家 2026-09-15 要求：A=2 / B=5 / C=9 / D=∞）
  const PLAN_ORDER = { A: 0, B: 1, C: 2, D: 3 };
  const PLAN_MAX = { A: 2, B: 5, C: 9, D: Infinity };
  const nextPlanOf = (p) => (p === 'A' ? 'B' : p === 'B' ? 'C' : p === 'C' ? 'D' : null);

  // 💰 各家庭計劃月費（#93 起以 membership_plans 表為真源，fallback 返原硬編碼價）
  //    用家 2026-09-15 提供：A 8,800 / B 12,800 / C 16,800 / D 20,800；種子暫設 $0.01 以利測試
  const PLAN_PRICE = { A: 8800, B: 12800, C: 16800, D: 20800 };
  // 計劃價錢快取（30 秒 TTL；管理員改價後最遲 30 秒生效）
  let _planPriceMap = null, _planPriceMapAt = 0;
  async function planPriceMap() {
    if (_planPriceMap && Date.now() - _planPriceMapAt < 30000) return _planPriceMap;
    try {
      const rows = await q("SELECT plan_key, price FROM membership_plans WHERE is_active=1");
      const m = {};
      (rows || []).forEach((r) => { m[String(r.plan_key).toUpperCase()] = Number(r.price); });
      if (Object.keys(m).length) { _planPriceMap = m; _planPriceMapAt = Date.now(); return m; }
    } catch (e) { /* 表未建立：用 fallback */ }
    return PLAN_PRICE;
  }
  const familyPlanPrice = async (plan) => {
    const m = await planPriceMap();
    const p = String(plan || 'A').toUpperCase();
    if (m[p] != null) return m[p];
    return PLAN_PRICE[p] != null ? PLAN_PRICE[p] : PLAN_PRICE.A;
  };

  // ==================== 會員計劃（#93：管理員設定價錢／簡介，官網同步）====================
  const parsePlanRow = (r) => ({
    ...r,
    price: Number(r.price),
    features: (() => { try { return JSON.parse(r.features || '[]'); } catch (e) { return []; } })(),
    popular: !!Number(r.popular),
    is_active: !!Number(r.is_active),
  });

  // 公開：官網價錢頁／會員中心讀取生效中計劃（按 sort 排序）
  router.get('/plans', async (req, res) => {
    try {
      const rows = await q("SELECT * FROM membership_plans WHERE is_active=1 ORDER BY sort, id");
      res.json({ ok: true, plans: rows.map(parsePlanRow) });
    } catch (e) {
      console.error('載入會員計劃失敗:', e.message);
      res.status(500).json({ error: '無法載入會員計劃' });
    }
  });

  // 📋 各計劃人數描述（前後端共用，避免 UI 硬編碼走樣）
  const PLAN_RANGE_LABEL = { A: '1-2 人', B: '3-5 人', C: '6-9 人', D: '10 人以上' };

  // 取得某用戶所屬家庭嘅戶主 id（用於資料隔離 / Item 10）：
  //   - 本身係戶主（family_head_id=自己）或有子女 → 自己
  //   - 係子帳戶（family_head_id 指向戶主）→ 該戶主
  //   - 非家庭成員 → null
  async function familyHeadOf(userId) {
    const u = await q1("SELECT id, family_head_id FROM users WHERE id=?", [userId]);
    if (!u) return null;
    if (u.family_head_id && Number(u.family_head_id) === Number(u.id)) return Number(u.id);
    if (u.family_head_id) return Number(u.family_head_id);
    const asParent = await q1("SELECT 1 FROM family_links WHERE parent_user_id=? LIMIT 1", [userId]);
    if (asParent) return Number(u.id);
    return null;
  }

  // 收集家庭所有成員 id：戶主 + family_links 子女 + 戶主/子女經 account_links 連結嘅親戚
  // （account_links 嘅人一樣計入張家庭單，呢個先符合「連結後喺張單入邊」）
  async function getFamilyMemberIds(headId) {
    const ids = new Set([Number(headId)]);
    const childrenRows = await q("SELECT child_user_id FROM family_links WHERE parent_user_id=?", [headId]);
    for (const r of childrenRows) ids.add(Number(r.child_user_id));
    const memPids = [...ids];
    if (memPids.length) {
      const ph = memPids.map(() => '?').join(',');
      const links = await q(
        `SELECT user_a, user_b FROM account_links WHERE user_a IN (${ph}) OR user_b IN (${ph})`,
        [...memPids, ...memPids]);
      for (const l of links) { ids.add(l.user_a); ids.add(l.user_b); }
    }
    return [...ids];
  }

  // 計家庭總人數 → 計劃（A:1-2 / B:3-5 / C:6-9 / D:10+）
  async function computeFamilyPlan(headId) {
    const memIds = await getFamilyMemberIds(headId);
    const total = memIds.length;
    return { total, plan: total <= 2 ? 'A' : (total <= 5 ? 'B' : (total <= 9 ? 'C' : 'D')) };
  }

  // 生成下一個家庭單號（全 prefix 共一條順序，1001 起）
  async function nextFamilyInvoiceNo(plan) {
    const prefix = familyInvoicePrefix(plan);
    const maxRow = await q1("SELECT COALESCE(MAX(CAST(SUBSTR(invoice_no,5) AS INTEGER)),1000) AS m FROM family_invoices");
    return prefix + '-' + (maxRow.m + 1);
  }

  // 🧾 輕量版 B：將收款單號同步去 Stripe subscription metadata（付款人 = owner），方便後台對數。
  //   owner 可能 ≠ 現時 head（家庭重組後），所以用張單嘅 owner_user_id 拎付款人嘅 stripe_subscription_id。
  async function syncStripeInvoiceMeta(headId, invoiceNo) {
    try {
      const inv = await q1("SELECT owner_user_id FROM family_invoices WHERE family_head_id=? ORDER BY id DESC LIMIT 1", [headId]);
      const ownerId = (inv && inv.owner_user_id) || headId;
      const u = await q1("SELECT stripe_subscription_id FROM users WHERE id=?", [ownerId]);
      const subId = u && u.stripe_subscription_id;
      if (!subId) return;
      const stripe = getStripe();
      if (!stripe) return;
      await stripe.subscriptions.update(subId, { metadata: { invoice_no: invoiceNo } });
    } catch (e) {
      // 對數 metadata 失敗唔影響主流程（付款 / 升級照常）
      console.error('syncStripeInvoiceMeta 失敗:', e && e.message);
    }
  }

  async function syncFamilyPlan(headId) {
    const { total, plan: derived } = await computeFamilyPlan(headId);
    const cur = await q1("SELECT family_plan FROM users WHERE id=?", [headId]);
    const curPlan = (cur && cur.family_plan) || 'A';
    // 計劃只會升唔會降：取「按人數推」同「已升級 plan」嘅較高者（用家升級後唔會因加人少而變返低）
    const plan = PLAN_ORDER[derived] >= PLAN_ORDER[curPlan] ? derived : curPlan;
    await run("UPDATE users SET family_plan=? WHERE id=?", [plan, headId]);
    const exist = await q1("SELECT id, invoice_no, owner_user_id FROM family_invoices WHERE family_head_id=?", [headId]);
    const desiredPrefix = familyInvoicePrefix(plan);
    let finalNo = exist && exist.invoice_no;
    let touched = false; // 張單號有冇新建 / 改 prefix（A→B）→ 決定要唔要同步去 Stripe metadata
    if (!exist) {
      const nextNo = await nextFamilyInvoiceNo(plan);
      // 🏠 輕量版 B：owner_user_id = 最初付款人（= 建立時嘅 head），與 family_head_id 拆開
      await run("INSERT INTO family_invoices (invoice_no, family_head_id, plan, owner_user_id) VALUES (?,?,?,?)", [nextNo, headId, plan, headId]);
      finalNo = nextNo; touched = true;
    } else if (!exist.invoice_no || !String(exist.invoice_no).startsWith(desiredPrefix + '-')) {
      // 計劃改變（A→B→C）→ 換返對應 prefix，維持同一張單（同一順序段，避免撞號）
      const numStart = String(exist.invoice_no).indexOf('-') + 1;
      const baseNum = numStart > 0 ? String(exist.invoice_no).slice(numStart) : '';
      let nextNo = desiredPrefix + '-' + (baseNum || '1001');
      const dup = await q1("SELECT id FROM family_invoices WHERE invoice_no=? AND family_head_id<>?", [nextNo, headId]);
      if (dup) nextNo = await nextFamilyInvoiceNo(plan);
      await run("UPDATE family_invoices SET plan=?, invoice_no=? WHERE family_head_id=?", [plan, nextNo, headId]);
      finalNo = nextNo; touched = true;
    } else {
      await run("UPDATE family_invoices SET plan=? WHERE family_head_id=?", [plan, headId]);
    }
    // 🧾 輕量版 B：張單號新建 / 改 prefix（A→B）時，同步去 Stripe subscription metadata（對數用）
    if (touched && finalNo) await syncStripeInvoiceMeta(headId, finalNo);
    return { plan, total, invoiceNo: finalNo };
  }

  // 🔒 家庭計劃加人上限檢查：返回是否封鎖 + 當前計劃 + 下一個計劃
  // 加到當前 plan 上限（A:2 / B:5 / C:9）就封鎖，提示升級；D（10+）無上限
  async function checkFamilyPlanLimit(headId) {
    const { total, plan: derived } = await computeFamilyPlan(headId);
    const cur = await q1("SELECT family_plan FROM users WHERE id=?", [headId]);
    const curPlan = (cur && cur.family_plan) || 'A';
    // 計劃只升唔降：實際人數推出嘅 plan 比存儲低（例如 legacy/seed 數據未同步）時，
    // 以實際人數為準，避免存儲計劃過低而誤封鎖加人（D 仍不設上限）。
    const effPlan = PLAN_ORDER[curPlan] >= PLAN_ORDER[derived] ? curPlan : derived;
    const max = PLAN_MAX[effPlan];
    if (effPlan !== 'D' && total >= max) {
      return { blocked: true, currentPlan: effPlan, next: nextPlanOf(effPlan), max };
    }
    return { blocked: false, currentPlan: effPlan, max };
  }

  // 🔢 會員編號（2026-09-15 新規格）：
  //   主帳戶   = S  + 方案字母 + 電話末 4 碼（如 SA1234）
  //   子帳戶   = M  + 方案字母 + 電話末 4 碼（如 MA1234）
  //   一般帳戶 = JR + 電話末 4 碼（如 JR1234）
  // 前綴按 family_head_id 決定：=自己→主帳戶；=其他人→子帳戶（用該戶主嘅方案字母）；null/非家庭→一般
  // 💡 此為「會員編號」(member_no)，與 admin.js 嘅 resolveInvoiceNo()「收款單號」(JRA-/MEM-) 係兩套完全不同嘅編號，命名相近易淆。
  const planLetter = (p) => (PLAN_ORDER[p] != null ? p : 'A');
  async function recomputeMemberNo(userId) {
    const u = await q1("SELECT id, phone, family_head_id, family_plan, member_no FROM users WHERE id=?", [userId]);
    if (!u) return;
    let prefix;
    if (u.family_head_id && Number(u.family_head_id) !== Number(u.id)) {
      const h = await q1("SELECT family_plan FROM users WHERE id=?", [u.family_head_id]);
      prefix = 'M' + planLetter(h && h.family_plan);
    } else if (u.family_head_id && Number(u.family_head_id) === Number(u.id)) {
      prefix = 'S' + planLetter(u.family_plan);
    } else {
      prefix = 'JR';
    }
    const digits = String(u.phone || '').replace(/\D/g, '');
    const last4 = digits.slice(-4) || '0000';
    const no = prefix + last4;
    if (no !== u.member_no) await run("UPDATE users SET member_no=? WHERE id=?", [no, userId]);
  }

  // 🔁 方案升降級 / 家庭成員變動後，重算全家人嘅會員編號（編號內含方案字母，會跟住變）
  async function recomputeFamilyMemberNos(headId) {
    const ids = await getFamilyMemberIds(headId);
    for (const id of ids) {
      try { await recomputeMemberNo(id); } catch (e) { /* 單一會員出錯唔影響其他人 */ }
    }
  }

  const activateSubscription = async (userId, tier, paymentId) => {
    const now = new Date();
    const start = now.toISOString().slice(0, 10);
    const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await run("INSERT INTO subscriptions (user_id, tier, status, start_date, end_date, payment_id) VALUES (?,?,?,?,?,?)",
      [userId, tier, 'active', start, end, paymentId || null]);
    await run("UPDATE users SET membership_tier=? WHERE id=?", [tier, userId]);
    // 🏠 舊式一次性付款升級家庭會員：同樣自動成為主帳戶（保持與月費路徑一致）
    if (tier === 'family') {
      await run("UPDATE users SET family_head_id=? WHERE id=? AND family_head_id IS NULL", [userId, userId]);
      await recomputeMemberNo(userId);
    }
  };

  // 🔁 取得/建立 Stripe 月費 Price（lookup_key 冪等；或讀取 .env 指定 price id）
  //    #93 修復：收錢價錢 = membership_plans 表真源（Admin 改價即生效），唔再用 TIER_INFO.family.price hardcode
  //    家庭計劃按 A/B/C/D 各自獨立 lookup_key + 各自獨立 Stripe Price（唔可以共用一條）
  const getOrCreatePrice = async (stripe, tier, plan) => {
    const info = TIER_INFO[tier];
    if (!info) throw new Error('無效會員級別');
    const envKey = process.env['STRIPE_PRICE_' + tier.toUpperCase()];
    if (envKey) return envKey; // 手動指定 price id 優先（部署後可固定）
    // 家庭計劃：按所選 A/B/C/D 各自計價（價錢嚟自 membership_plans 表）
    let lookupKey, targetPriceHkd;
    if (tier === 'family' && plan) {
      lookupKey = `bw_membership_family_${plan}_monthly`;
      targetPriceHkd = await familyPlanPrice(plan); // 來自 membership_plans 表（Admin 可改）
    } else {
      lookupKey = `bw_membership_${tier}_monthly`;
      targetPriceHkd = info.price;
    }
    const unitAmount = Math.round(Number(targetPriceHkd) * 100);
    if (!unitAmount || unitAmount <= 0) throw new Error('計劃價錢無效（必須大於 0）');
    const list = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 10 });
    // 搵金額啱嘅（Admin 改價後會建新版，舊版停用）→ 確保收嘅錢 == 表入面嘅價
    const match = (list.data || []).find((p) => p.unit_amount === unitAmount);
    if (match) return match.id;
    // 金額唔啱（Admin 改咗價）：停用舊 price，建新 price 反映新價
    for (const old of (list.data || [])) {
      try { await stripe.prices.update(old.id, { active: false }); } catch (e) { /* 已停用就當搞掂 */ }
    }
    const product = await stripe.products.create({
      name: `JR ${info.name}${tier === 'family' ? ` 計劃 ${plan}` : ''}`,
      metadata: { tier, plan: plan || '' }
    });
    const price = await stripe.prices.create({
      currency: 'hkd',
      unit_amount: unitAmount,
      recurring: { interval: 'month' },
      product: product.id,
      lookup_key: lookupKey,
      nickname: info.name + (tier === 'family' ? ` ${plan}` : '')
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
    // 🏠 升級家庭會員：若仍未綁任何家庭角色，自動成為主帳戶（戶主）
    //    （已係人哋子帳戶者 family_head_id 指向其他人 → 唔會被搶走現有家庭關係）
    if (tier === 'family') {
      await run("UPDATE users SET family_head_id=? WHERE id=? AND family_head_id IS NULL", [userId, userId]);
      // 會員編號即時計返 S 前綴（主帳戶），對齊 apply-family / migrations 規則
      await recomputeMemberNo(userId);
      // 🧾 升級家庭會員即同步生成家庭單號（JRA/B/C/D）— 付款跟張單號，唔係跟帳戶：
      //   頭嘅 Stripe 訂閱經 family_invoices.family_head_id 對返呢張單，成個家庭一張單一個付款人
      await syncFamilyPlan(userId);
    }
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
    // 🔢 取消後：家庭連結已解除（family_head_id 清返 NULL）→ 會員編號計返 JR 前綴，
    //    避免殘留 S 前綴扮仲係主帳戶（子女由 detachAllChildren 同樣會喺下次開機 migration 重算）
    await recomputeMemberNo(user.id);
    return detached;
  };

  const userBySubscription = (subId) =>
    q1("SELECT id, membership_tier, stripe_subscription_id FROM users WHERE stripe_subscription_id=?", [subId]);

  // GET /api/membership — 會員儀表板資料
  router.get('/', requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const tier = user.membership_tier || 'general';
      const subStatusRow = await q1("SELECT subscription_status, member_no, family_plan, member_invoice_no FROM users WHERE id=?", [user.id]);
      const subStatus = (subStatusRow && subStatusRow.subscription_status) || 'none';
      const memberNo = (subStatusRow && subStatusRow.member_no) || '';
      // #14：賬單編號（MEM-xxxx），會員中心會員編號旁邊顯示
      const invoiceNo = (subStatusRow && subStatusRow.member_invoice_no) || '';
      // 🔢 顯示計劃以「存儲 vs 實際人數」較高者為準（計劃只升唔降，避免 legacy/seed 未同步數據顯示偏低）
      const storedPlan = (subStatusRow && subStatusRow.family_plan) || 'A';
      const { plan: derivedPlan } = await computeFamilyPlan(user.id);
      const familyPlan = PLAN_ORDER[storedPlan] >= PLAN_ORDER[derivedPlan] ? storedPlan : derivedPlan;
      const sub = await q1("SELECT * FROM subscriptions WHERE user_id=? AND status='active' ORDER BY id DESC LIMIT 1", [user.id]);
      const children = await q(
        `SELECT u.id, u.name, u.username, u.birth_date, u.member_no, u.hide_medical_from_head, u.hide_booking_from_head, u.hide_profile_from_head, u.hide_from_head, u.created_at, fl.relation, fl.created_at AS linked_at
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
        children: children.map((c) => {
          const age = computeAge(c.birth_date);
          const isAdult = age >= 18;
          const forcedOpen = !isAdult; // 未滿 18 歲強制開放
          const hm = c.hide_medical_from_head === 1;
          const hb = c.hide_booking_from_head === 1;
          const hp = c.hide_profile_from_head === 1;
          return {
            ...c, age, isAdult, forcedOpen,
            hideMedical: hm, hideBooking: hb, hideProfile: hp,
            hiddenFromHead: (c.hide_from_head === 1),
            // 未滿 18 歲：三類資料強制開放；18+：視乎該成員授權
            canViewMedical: forcedOpen || !hm,
            canViewBooking: forcedOpen || !hb,
            canViewProfile: forcedOpen || !hp,
          };
        }),
        insurance: Number(user.insurance_covered) === 1,
        profile_completed: user.profile_completed,
        memberNo,
        invoiceNo,
        familyPlan
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
    const { tier, plan } = req.body || {};
    if (!['family'].includes(tier)) return res.status(400).json({ error: '無效的會員級別' });
    const user = req.user;
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ error: '支付服務未設定（請在 .env 設定 STRIPE_SECRET_KEY）', code: 'stripe_not_configured' });
    }
    // 🏠 家庭計劃所選方案（A/B/C/D）：記錄落 family_plan（驅動會員編號字母），Stripe 金額按家庭計劃統一處理
    const chosenPlan = (tier === 'family' && ['A', 'B', 'C', 'D'].includes(plan)) ? plan : null;
    try {
      const fullUser = await q1("SELECT id, username, name, email, phone, stripe_customer_id, family_head_id FROM users WHERE id=?", [user.id]);
      // 🔒 家庭計劃「一張單一個付款人」：若家庭已有人供緊款，擋第二個付款人（符「是但一個俾錢張單就完成」）
      if (tier === 'family') {
        const headId = (fullUser.family_head_id && Number(fullUser.family_head_id) !== Number(fullUser.id))
          ? Number(fullUser.family_head_id) : Number(fullUser.id);
        const memberIds = await getFamilyMemberIds(headId);
        if (memberIds.length) {
          const ph = memberIds.map(() => '?').join(',');
          const activePayer = await q1(
            `SELECT user_id FROM subscriptions WHERE user_id IN (${ph}) AND status='active' AND tier='family' AND user_id != ? LIMIT 1`,
            [...memberIds, fullUser.id]);
          if (activePayer) {
            const payer = await q1("SELECT name, username FROM users WHERE id=?", [activePayer.user_id]);
            return res.status(400).json({
              error: '你的家庭計劃已有成員供款中，無需重複付款；如要接手供款，請先由現有付款人取消訂閱。',
              code: 'FAMILY_ALREADY_PAID',
              payerName: (payer && (payer.name || payer.username)) || '家庭成員'
            });
          }
        }
        // 記錄所選方案（樂觀寫入 family_plan，供會員編號／計劃顯示；Webhook 完成付款後會再確認）
        if (chosenPlan) {
          const headId = (fullUser.family_head_id && Number(fullUser.family_head_id) !== Number(fullUser.id))
            ? Number(fullUser.family_head_id) : Number(fullUser.id);
          await run("UPDATE users SET family_plan=? WHERE id=?", [chosenPlan, headId]);
        }
      }
      const customerId = await getOrCreateCustomer(stripe, fullUser);
      const priceId = await getOrCreatePrice(stripe, tier, chosenPlan); // #93 修復：家庭按 A/B/C/D 各自價錢（來自 membership_plans 表）
      const baseUrl = process.env.SITE_URL || `http://localhost:${process.env.PORT || 4000}`;
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${baseUrl}/index.html?payment=success&tier=${tier}`,
        cancel_url: `${baseUrl}/index.html?payment=cancelled`,
        client_reference_id: String(user.id),
        metadata: { userId: String(user.id), tier, plan: chosenPlan || '', initiatedBy: 'self' }
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
      // 🔒 子帳戶（非戶主家庭成員）不可自行退訂，只可繼續供款
      if (fullUser.membership_tier === 'family' && Number(fullUser.family_head_id) !== Number(fullUser.id)) {
        return res.status(403).json({ error: '只有家庭戶主可以取消訂閱；子帳戶只可繼續供款，不可退訂' });
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
      // 🔢 啟用後按 family_head_id 重算會員編號（主帳戶 S）— 否則新戶主會殘留 J 前綴
      await recomputeMemberNo(user.id);
      res.json({ ok: true, message: '已啟用家庭帳戶，可以開始加入子帳戶' });
    } catch (e) {
      res.status(500).json({ error: '啟用失敗' });
    }
  });

  // POST /api/membership/family/add — 加入子帳戶（關聯現有帳戶）
  // 🔒 規格：子帳戶申請必須喺員工/管理員帳戶實行，一般家庭帳戶只可觀看
  // GET /api/membership/family/available-children — 列出可連結為子帳戶嘅客戶（管理員／員工）
  router.get('/family/available-children', requireAuth, requireRole('staff', 'admin'), async (req, res) => {
    try {
      const excludeHead = parseInt(req.query.excludeHeadId, 10) || 0;
      const rows = await q(
        `SELECT u.id, u.username, u.name, u.phone
         FROM users u
         WHERE u.role='customer'
           AND u.id <> ?
           AND u.id NOT IN (SELECT child_user_id FROM family_links)
           AND u.id NOT IN (SELECT child_user_id FROM family_links WHERE parent_user_id=?)
         ORDER BY u.name COLLATE NOCASE`,
        [excludeHead, excludeHead]
      );
      res.json({ ok: true, children: rows || [] });
    } catch (e) {
      console.error('列出可連結子帳戶失敗:', e);
      res.status(500).json({ error: '載入失敗' });
    }
  });

  router.post('/family/add', requireAuth, async (req, res) => {
    const { parentUserId, parentUsername, childUsername, childBirthDate, relation, name } = req.body || {};
    if (!childUsername) return res.status(400).json({ error: '請輸入子帳戶的用戶名' });
    if (!childBirthDate) return res.status(400).json({ error: '請提供子帳戶的出生日期' });
    const isPrivileged = (req.user.role === 'staff' || req.user.role === 'admin');
    let head;
    if (isPrivileged) {
      const parent = await resolveParent(parentUserId, parentUsername, { allowNonFamilyTier: !!req.body.allowNonFamilyTier });
      if (!parent.ok) {
        return res.status(parent.status || 400).json({
          error: parent.error,
          ...(parent.code ? { code: parent.code, tier: parent.tier } : {})
        });
      }
      head = parent.user;
    } else {
      // 🔒 客人家庭戶主自助理連結（僅限自己家庭）
      const me = await q1("SELECT id, username, name, phone, family_head_id, membership_tier FROM users WHERE id=?", [req.user.id]);
      const isHead = Number(me.family_head_id) === Number(me.id) || !!(await q1("SELECT 1 FROM family_links WHERE parent_user_id=? LIMIT 1", [me.id]));
      if (!isHead) return res.status(403).json({ error: '只有家庭戶主可以連結家庭成員，請由職員協助或先啟用家庭帳戶' });
      if (Number(me.family_head_id) !== Number(me.id)) await familyService.enableHead(me.id);
      head = me;
    }
    // 🔒 家庭計劃加人上限檢查（A:2 / B:5 / C:9；D 不設上限）
    const planLim = await checkFamilyPlanLimit(head.id);
    if (planLim.blocked) {
      return res.status(403).json({
        error: `你的家庭計劃【${planLim.currentPlan}】已達上限（${planLim.max} 人），請升級至計劃 ${planLim.next} 以添加更多成員。`,
        code: 'PLAN_LIMIT', currentPlan: planLim.currentPlan, nextPlan: planLim.next
      });
    }
    try {
      const child = await q1("SELECT id, username, birth_date FROM users WHERE username=? COLLATE NOCASE", [childUsername]);
      if (!child) return res.status(404).json({ error: '找不到該用戶名嘅帳戶' });
      // 📝 管理員連結時可一併設定／更新子帳戶名稱
      if (name && String(name).trim()) {
        await run("UPDATE users SET name=? WHERE id=?", [String(name).trim(), child.id]);
      }
      // 🔒 一個帳戶只可屬於一個家庭：已連結另一戶主時拒絕（避免資料混亂）
      const existingLink = await q1("SELECT * FROM family_links WHERE child_user_id=?", [child.id]);
      if (existingLink && Number(existingLink.parent_user_id) !== Number(head.id)) {
        return res.status(409).json({ error: `「${child.username}」已連結咗另一個家庭帳戶，請先由該家庭移除後再連結` });
      }
      // 👨‍👩‍👧 連結入家庭：general 級自動升做 family 級（premium 保持不變，永不降級）
      await run("UPDATE users SET birth_date=? WHERE id=?", [childBirthDate, child.id]);
      await familyService.addChild(head.id, child.id, relation || 'parent');
      await recomputeMemberNo(child.id);
      await recomputeMemberNo(head.id);
      await syncFamilyPlan(head.id);
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
      if (!phone || !/^[+\d(][\d\s\-()]{4,19}$/.test(String(phone))) { result.error = '家長電話無效'; return result; }
      let formatted = String(phone).trim();
      if (!formatted.startsWith('+')) {
        const digitsOnly = formatted.replace(/[^\d]/g, '');
        if (digitsOnly.length === 8) formatted = '+852' + digitsOnly;
        // 非 8 位（國際號碼）保持原樣，交由 WhatsApp 服務處理
      }
      const message = [
        `【JR】${title}`,
        '',
        `成員姓名：${childName}`,
        `登入帳戶：${username}`,
        `暫時密碼：${tempPassword}`,
        '',
        `首次登入後請立即修改密碼。如對此訊息有疑問，請致電 ${clinicSettings.getClinicPhone()} 與職員聯絡。`
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
  // 🔒 規格：職員/管理員代辦（可指定戶主），或用戶自己係家庭戶主亦可自助理兒童開戶（限自己家庭）
  router.post('/family/register', requireAuth, async (req, res) => {
    const { parentUserId, parentUsername, name, name_en, birth_date, phone, id_card, address, relation, gender } = req.body || {};
    const isPrivileged = (req.user.role === 'staff' || req.user.role === 'admin');
    let head;
    if (isPrivileged) {
      const parent = await resolveParent(parentUserId, parentUsername, { allowNonFamilyTier: !!req.body.allowNonFamilyTier });
      if (!parent.ok) {
        return res.status(parent.status || 400).json({
          error: parent.error,
          ...(parent.code ? { code: parent.code, tier: parent.tier } : {})
        });
      }
      head = parent.user;
    } else {
      // 🔒 客人家庭戶主自助理兒童開戶（僅限自己家庭，受計劃人數上限約束）
      const me = await q1("SELECT id, username, name, phone, family_head_id, membership_tier FROM users WHERE id=?", [req.user.id]);
      const isHead = Number(me.family_head_id) === Number(me.id) || !!(await q1("SELECT 1 FROM family_links WHERE parent_user_id=? LIMIT 1", [me.id]));
      if (!isHead) return res.status(403).json({ error: '只有家庭戶主可以新增家庭成員，請由職員協助或先啟用家庭帳戶' });
      if ((me.membership_tier || 'general') !== 'family') return res.status(403).json({ error: '請先升級至家庭計劃以新增家庭成員', code: 'NEED_FAMILY_TIER' });
      if (Number(me.family_head_id) !== Number(me.id)) await familyService.enableHead(me.id);
      head = me;
    }

    // 🔒 家庭計劃加人上限檢查（A:2 / B:5 / C:9；D 不設上限）
    const planLim = await checkFamilyPlanLimit(head.id);
    if (planLim.blocked) {
      return res.status(403).json({
        error: `你的家庭計劃【${planLim.currentPlan}】已達上限（${planLim.max} 人），請升級至計劃 ${planLim.next} 以添加更多成員。`,
        code: 'PLAN_LIMIT', currentPlan: planLim.currentPlan, nextPlan: planLim.next
      });
    }

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
    if (!childPhone || !/^[+\d(][\d\s\-()]{4,19}$/.test(childPhone)) {
      return res.status(400).json({
        error: phone
          ? '請輸入有效的電話號碼（香港 8 位或含國際區號）'
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
      await recomputeMemberNo(childId);
      await recomputeMemberNo(head.id);
      await syncFamilyPlan(head.id);

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

      const isValidPhone = (p) => p && /^[+\d(][\d\s\-()]{4,19}$/.test(String(p));
      const targetPhone = isValidPhone(child.phone) ? child.phone : headPhone;
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
      } else if (user.role === 'customer') {
        // 🔒 資料隔離（Item 10）：客人查自己家庭——戶主用自己，子帳戶用所屬戶主
        const myHead = await familyHeadOf(user.id);
        if (myHead) {
          parentId = myHead;
          const h = await q1("SELECT name, username FROM users WHERE id=?", [myHead]);
          parentName = h ? h.name : user.name;
        }
      }
      const children = await q(
        `SELECT u.id, u.name, u.username, u.birth_date, u.member_no, u.hide_medical_from_head, u.hide_booking_from_head, u.hide_profile_from_head, u.hide_from_head, u.created_at, fl.relation, fl.created_at AS linked_at
         FROM family_links fl JOIN users u ON u.id = fl.child_user_id
         WHERE fl.parent_user_id=? ORDER BY u.id`, [parentId]);
      const withPerm = children.map((c) => {
        const age = computeAge(c.birth_date);
        const isAdult = age >= 18;
        const forcedOpen = !isAdult; // 未滿 18 歲強制開放
        const hm = c.hide_medical_from_head === 1;
        const hb = c.hide_booking_from_head === 1;
        const hp = c.hide_profile_from_head === 1;
        return {
          ...c,
          age,
          isAdult,
          forcedOpen,
          hiddenFromHead: (c.hide_from_head === 1), // 舊版主開關（兼容 staff/admin）
          hideMedical: hm,
          hideBooking: hb,
          hideProfile: hp,
          // 未滿 18 歲：三類資料強制開放；18+：視乎該成員授權
          canViewMedical: forcedOpen || !hm,
          canViewBooking: forcedOpen || !hb,
          canViewProfile: forcedOpen || !hp,
          canManage: age < 18,
          canViewLateness: forcedOpen || !hb
        };
      });
      const inv = await q1("SELECT invoice_no, plan FROM family_invoices WHERE family_head_id=?", [parentId]);
      const headRow = await q1("SELECT member_no, family_plan FROM users WHERE id=?", [parentId]);
      res.json({ children: withPerm, parentName, parentUsername: req.query.parentUsername || user.username,
        plan: inv ? inv.plan : (headRow ? headRow.family_plan : null),
        invoiceNo: inv ? inv.invoice_no : null,
        headMemberNo: headRow ? headRow.member_no : null });
    } catch (e) {
      res.status(500).json({ error: '系統錯誤' });
    }
  });

  // GET /api/membership/family-invoice — 全家共用嘅單號 + 計劃（戶主或任何成員都可查）
  router.get('/family-invoice', requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const headId = (Number(user.family_head_id) === Number(user.id)) ? user.id : (user.family_head_id || user.id);
      const inv = await q1("SELECT invoice_no, plan FROM family_invoices WHERE family_head_id=?", [headId]);
      const head = await q1("SELECT name, member_no, family_plan FROM users WHERE id=?", [headId]);
      res.json({
        ok: true,
        invoiceNo: inv ? inv.invoice_no : null,
        plan: inv ? inv.plan : (head ? head.family_plan : null),
        headId,
        headName: head ? head.name : null,
        headMemberNo: head ? head.member_no : null
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 🆕 GET /api/membership/family-payment — 家庭計劃供款狀態（戶主/子成員都可查）
  // 用途：dashboard 顯示中性「家庭計劃生效中」+ 子帳戶「接手供款」掣；不回傳付款人姓名（用戶要求中性文案）
  // 狀態：
  //   hasActivePayer=true  → 全家有人供緊款（頭或接手咗嘅子帳戶）
  //   canTakeOver=true     → 子帳戶（非戶主）+ 全家無人供款 → 可以接手供款（startCheckout('family')）
  router.get('/family-payment', requireAuth, async (req, res) => {
    try {
      const u = await q1("SELECT id, username, name, membership_tier, family_head_id FROM users WHERE id=?", [req.user.id]);
      if (!u) return res.status(404).json({ error: '帳戶不存在' });
      const isHead = Number(u.family_head_id) === Number(u.id);
      const headId = Number(u.family_head_id) || Number(u.id);
      const famIds = await getFamilyMemberIds(headId);
      // 搵全家有冇人供緊款（active family subscription）
      let hasActivePayer = false;
      let amIPayer = false;
      if (famIds.length) {
        const ph = famIds.map(() => '?').join(',');
        const payers = await q(
          `SELECT user_id FROM subscriptions WHERE user_id IN (${ph}) AND status='active' AND tier='family'`,
          famIds);
        hasActivePayer = payers.length > 0;
        amIPayer = payers.some(p => Number(p.user_id) === Number(u.id));
      }
      const canTakeOver = (u.membership_tier || 'general') === 'family' && !isHead && !hasActivePayer;
      res.json({
        ok: true,
        isHead,
        headId,
        memberCount: famIds.length,
        hasActivePayer,
        amIPayer,
        canTakeOver
      });
    } catch (e) {
      console.error('查詢家庭供款狀態失敗:', e.message);
      res.status(500).json({ error: '系統錯誤' });
    }
  });

  // 🆕 同時接受 POST + PUT，支援細分授權：hideMedical / hideBooking / hideProfile（任一）或舊版 hide（一次過隱藏全部）
  const recomputeHideFromHead = (med, book, prof) => (med || book || prof ? 1 : 0);
  const privacyHandler = async (req, res) => {
    try {
      if (req.user.role !== 'customer') return res.status(403).json({ error: '只限客戶' });
      const b = req.body || {};
      // 舊版：hide / private / is_private 一次過控制全部三類
      if (b.hide !== undefined || b.private !== undefined || b.is_private !== undefined) {
        const v = (b.hide ?? b.private ?? b.is_private) ? 1 : 0;
        await run("UPDATE users SET hide_medical_from_head=?, hide_booking_from_head=?, hide_profile_from_head=?, hide_from_head=? WHERE id=?",
          [v, v, v, v, req.user.id]);
        return res.json({ ok: true, hideMedical: v, hideBooking: v, hideProfile: v, hide_from_head: v });
      }
      // 新版：細分授權（未傳嘅類別維持原值）
      const cur = await q1("SELECT hide_medical_from_head, hide_booking_from_head, hide_profile_from_head FROM users WHERE id=?", [req.user.id]);
      const med = (b.hideMedical !== undefined) ? (b.hideMedical ? 1 : 0) : (cur ? cur.hide_medical_from_head : 0);
      const book = (b.hideBooking !== undefined) ? (b.hideBooking ? 1 : 0) : (cur ? cur.hide_booking_from_head : 0);
      const prof = (b.hideProfile !== undefined) ? (b.hideProfile ? 1 : 0) : (cur ? cur.hide_profile_from_head : 0);
      const master = recomputeHideFromHead(med, book, prof);
      await run("UPDATE users SET hide_medical_from_head=?, hide_booking_from_head=?, hide_profile_from_head=?, hide_from_head=? WHERE id=?",
        [med, book, prof, master, req.user.id]);
      res.json({ ok: true, hideMedical: med, hideBooking: book, hideProfile: prof, hide_from_head: master });
    } catch (e) { res.status(500).json({ error: e.message }); }
  };
  router.post('/privacy', requireAuth, privacyHandler);
  router.put('/privacy',  requireAuth, privacyHandler);

  // GET /api/membership/privacy — 讀取子帳戶細分授權狀態（含年齡/強制開放判斷）
  router.get('/privacy', requireAuth, async (req, res) => {
    try {
      if (req.user.role !== 'customer') return res.status(403).json({ error: '只限客戶' });
      const u = await q1("SELECT hide_medical_from_head, hide_booking_from_head, hide_profile_from_head, hide_from_head, family_head_id, id, birth_date FROM users WHERE id=?", [req.user.id]);
      const isChild = !!(u && u.family_head_id && Number(u.family_head_id) !== Number(u.id));
      const age = computeAge(u && u.birth_date);
      const isAdult = age >= 18;
      const forcedOpen = !isAdult; // 未滿 18 歲：資料強制開放畀主帳戶
      let headName = null;
      if (isChild) {
        const h = await q1("SELECT name FROM users WHERE id=?", [u.family_head_id]);
        headName = h ? h.name : null;
      }
      res.json({
        ok: true,
        isChild,
        headName,
        age,
        isAdult,
        forcedOpen,
        hideMedical: u ? u.hide_medical_from_head : 0,
        hideBooking: u ? u.hide_booking_from_head : 0,
        hideProfile: u ? u.hide_profile_from_head : 0,
        hide_from_head: u ? u.hide_from_head : 0
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
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

  // POST /api/membership/family/:id/privacy — 職員/管理員代 18+ 子帳戶開關授權
  router.post('/family/:id/privacy', requireAuth, requireRole('staff', 'admin'), async (req, res) => {
    try {
      const childId = Number(req.params.id);
      const b = req.body || {};
      const child = await q1("SELECT id, birth_date, hide_medical_from_head, hide_booking_from_head, hide_profile_from_head FROM users WHERE id=?", [childId]);
      if (!child) return res.status(404).json({ error: '找不到該成員' });
      if (computeAge(child.birth_date) < 18) return res.status(400).json({ error: '只有 18 歲或以上嘅成員可以設定私隱' });
      let med, book, prof;
      if (b.hide !== undefined || b.private !== undefined || b.is_private !== undefined) {
        const v = (b.hide ?? b.private ?? b.is_private) ? 1 : 0;
        med = book = prof = v;
      } else {
        med = (b.hideMedical !== undefined) ? (b.hideMedical ? 1 : 0) : (child.hide_medical_from_head || 0);
        book = (b.hideBooking !== undefined) ? (b.hideBooking ? 1 : 0) : (child.hide_booking_from_head || 0);
        prof = (b.hideProfile !== undefined) ? (b.hideProfile ? 1 : 0) : (child.hide_profile_from_head || 0);
      }
      const master = (med || book || prof) ? 1 : 0;
      await run("UPDATE users SET hide_medical_from_head=?, hide_booking_from_head=?, hide_profile_from_head=?, hide_from_head=? WHERE id=?",
        [med, book, prof, master, childId]);
      res.json({ ok: true, hideMedical: med, hideBooking: book, hideProfile: prof, hide_from_head: master });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/membership/family/:id/bookings — 子帳戶預約
  // 規則：18歲以下戶主必見全部；18+ 若 hide_from_head=1 則戶主不可見
  router.get('/family/:id/bookings', requireAuth, async (req, res) => {
    const childId = Number(req.params.id);
    const user = req.user;
    try {
      // 🔒 資料隔離（Item 10）：只可查閱自己家庭（同戶主）成員；跨家庭一律 403
      const targetHead = await familyHeadOf(childId);
      const myHead = await familyHeadOf(user.id);
      if (!(targetHead && myHead && targetHead === myHead)) return res.status(403).json({ error: '沒有權限' });
      const viewerIsHead = Number(myHead) === Number(user.id);
      const child = await q1("SELECT birth_date, hide_booking_from_head FROM users WHERE id=?", [childId]);
      const age = computeAge(child && child.birth_date);
      const isAdult = age >= 18;
      // 🔒 18+ 且開啟預約私隱 → 戶主不可見其預約（未滿 18 歲強制開放；子帳戶檢視不受此限）
      if (viewerIsHead && isAdult && child && child.hide_booking_from_head === 1) {
        return res.status(403).json({ error: '該成員未開放預約記錄', code: 'hidden_from_head' });
      }
      const rows = await q(
        "SELECT id, service_id, appointment_date, appointment_time, status FROM bookings WHERE user_id=? ORDER BY appointment_date DESC, appointment_time DESC",
        [childId]);
      // 18+ 只顯示中性「預約成功」狀態（詳情仍受私隱開關控制）
      const bookings = isAdult
        ? rows.map(r => ({ ...r, status: r.status === 'cancelled' ? 'cancelled' : '預約成功' }))
        : rows;
      res.json({ bookings, age });
    } catch (e) {
      res.status(500).json({ error: '系統錯誤' });
    }
  });

  // GET /api/membership/family/:id/profile — 子帳戶個人資料（戶主可睇）
  // 規則：未滿 18 歲強制開放；18+ 若 hide_profile_from_head=1 則戶主不可見
  router.get('/family/:id/profile', requireAuth, async (req, res) => {
    const childId = Number(req.params.id);
    const user = req.user;
    try {
      // 🔒 資料隔離（Item 10）：只可查閱自己家庭（同戶主）成員；跨家庭一律 403
      const targetHead = await familyHeadOf(childId);
      const myHead = await familyHeadOf(user.id);
      if (!(targetHead && myHead && targetHead === myHead)) return res.status(403).json({ error: '沒有權限' });
      const viewerIsHead = Number(myHead) === Number(user.id);
      const child = await q1(
        "SELECT id, name, username, birth_date, phone, email, id_card, address, emergency_contact, emergency_phone, insurance_covered, member_no, profile_completed, hide_profile_from_head FROM users WHERE id=?",
        [childId]);
      if (!child) return res.status(404).json({ error: '找不到該成員' });
      const age = computeAge(child.birth_date);
      const isAdult = age >= 18;
      if (viewerIsHead && isAdult && child.hide_profile_from_head === 1) {
        return res.status(403).json({ error: '該成員未開放個人資料', code: 'hidden_from_head' });
      }
      res.json({
        ok: true,
        profile: {
          id: child.id,
          name: child.name,
          username: child.username,
          birth_date: child.birth_date,
          age,
          isAdult,
          phone: child.phone,
          email: child.email,
          id_card: child.id_card,
          address: child.address,
          emergency_contact: child.emergency_contact,
          emergency_phone: child.emergency_phone,
          insurance_covered: child.insurance_covered,
          member_no: child.member_no,
          profile_completed: child.profile_completed
        }
      });
    } catch (e) { res.status(500).json({ error: '系統錯誤' }); }
  });

  // GET /api/membership/family/:id/medical — 子帳戶病歷（戶主可睇）
  // 規則：未滿 18 歲強制開放；18+ 若 hide_medical_from_head=1 則戶主不可見
  router.get('/family/:id/medical', requireAuth, async (req, res) => {
    const childId = Number(req.params.id);
    const user = req.user;
    try {
      // 🔒 資料隔離（Item 10）：只可查閱自己家庭（同戶主）成員；跨家庭一律 403
      const targetHead = await familyHeadOf(childId);
      const myHead = await familyHeadOf(user.id);
      if (!(targetHead && myHead && targetHead === myHead)) return res.status(403).json({ error: '沒有權限' });
      const viewerIsHead = Number(myHead) === Number(user.id);
      const child = await q1("SELECT birth_date, hide_medical_from_head FROM users WHERE id=?", [childId]);
      if (!child) return res.status(404).json({ error: '找不到該成員' });
      const age = computeAge(child.birth_date);
      const isAdult = age >= 18;
      if (viewerIsHead && isAdult && child.hide_medical_from_head === 1) {
        return res.status(403).json({ error: '該成員未開放病歷', code: 'hidden_from_head' });
      }
      const records = await q(
        `SELECT mr.id, mr.record_date, mr.diagnosis, mr.treatment_plan, mr.notes, mr.created_at,
                COALESCE(u.name, b.doctor_name) as doctor_name, b.appointment_date, b.appointment_time, s.name as service_name
         FROM medical_records mr
         LEFT JOIN users u ON mr.doctor_user_id = u.id
         LEFT JOIN bookings b ON mr.booking_id = b.id
         LEFT JOIN services s ON b.service_id = s.id
         WHERE mr.user_id=? ORDER BY mr.record_date DESC, mr.id DESC`,
        [childId]);
      res.json({ ok: true, records: records || [] });
    } catch (e) { res.status(500).json({ error: '系統錯誤' }); }
  });

  // 家庭樹狀結構（admin / staff —— 員工家庭子帳戶管理介面與管理員一致）
  router.get('/admin/tree', requireAuth, requireRole('staff', 'admin'), async (req, res) => {
    try {
      const heads = await q(
        `SELECT u.id, u.name, u.username, u.membership_tier, u.avatar AS avatar_url FROM users u
         WHERE u.family_head_id IS NOT NULL AND u.family_head_id = u.id`);
      const tree = [];
      for (const h of heads) {
        const members = await q(
          `SELECT u.id, u.name, u.username, u.phone, u.birth_date, u.membership_tier, u.avatar AS avatar_url,
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

  // 🌳 GET /api/membership/family/my-tree — 客人（家庭戶主）查看自己嘅家庭帳戶關係圖
  //    回傳：{ head: {...}, children: [...], links: [{ member, relations: [...] }] }
  //    功能 4：升級家庭帳戶後，左欄顯示家庭帳戶關係圖，連結功能置於其下方
  router.get('/family/my-tree', requireAuth, async (req, res) => {
    try {
      const me = req.user;
      if (me.role !== 'customer') return res.status(403).json({ error: '只限客戶帳戶' });
      // 🔒 資料隔離（Item 10）：戶主或子帳戶都可睇自己家庭（同戶主）關係圖
      const headId = await familyHeadOf(me.id);
      if (!headId) return res.json({ is_head: false, head: null, children: [], links: [] });

      const head = await q1(
        `SELECT id, name, username, membership_tier, avatar FROM users WHERE id=?`, [headId]);
      const children = await q(
        `SELECT u.id, u.name, u.username, u.avatar, u.membership_tier, u.birth_date
         FROM family_links fl JOIN users u ON u.id = fl.child_user_id
         WHERE fl.parent_user_id=? ORDER BY u.birth_date ASC`, [headId]);

      // 家庭內每位成員（戶主 + 子女）嘅帳戶連結（親戚／同輩／朋友）
      const memberIds = [headId, ...children.map(c => c.id)];
      const linkRows = await q(
        `SELECT al.id, al.user_a, al.user_b, al.relation, al.custom_relation
         FROM account_links al
         WHERE al.user_a IN (${memberIds.map(() => '?').join(',')})
            OR al.user_b IN (${memberIds.map(() => '?').join(',')})`,
        [...memberIds, ...memberIds]);
      const idSet = new Set(memberIds);
      const links = [];
      for (const lr of linkRows) {
        const fromId = idSet.has(Number(lr.user_a)) ? Number(lr.user_a) : Number(lr.user_b);
        const otherId = Number(fromId) === Number(lr.user_a) ? Number(lr.user_b) : Number(lr.user_a);
        if (idSet.has(otherId)) continue; // 家庭內部互連（戶主↔子女）唔當對外連結顯示
        const other = await q1(
          `SELECT id, name, username, avatar, membership_tier FROM users WHERE id=?`, [otherId]);
        if (!other) continue;
        // 🆕 統一世代分類：親戚(relative) 與 同輩(sibling) 分開 group，唔可以同層
        const cls = classifyLink(lr.relation, lr.custom_relation);
        links.push({
          link_id: lr.id, from_user_id: fromId,
          relation: lr.custom_relation || lr.relation,
          relationGroup: cls.relationGroup,
          treeTier: cls.treeTier,
          generation: cls.generation,
          other,
        });
      }
      res.json({
        is_head: Number(me.id) === Number(headId),
        head: head || null,
        children: children.map(c => ({ ...c, is_me: Number(c.id) === Number(me.id) })),
        links,
      });
    } catch (e) {
      console.error('載入家庭關係圖失敗:', e);
      res.status(500).json({ error: '系統錯誤' });
    }
  });

  // 🗑️ DELETE /api/membership/admin/link/:childUserId — 職員/管理員移除家庭成員連結
  router.delete('/admin/link/:childUserId', requireAuth, requireRole('staff', 'admin'), async (req, res) => {
    try {
      const childId = Number(req.params.childUserId);
      const child = await q1("SELECT family_head_id FROM users WHERE id=?", [childId]);
      const removed = await familyService.removeChildLink(childId);
      if (!removed) return res.status(404).json({ error: '該成員沒有家庭連結' });
      const headId = child ? (child.family_head_id || childId) : childId;
      await syncFamilyPlan(headId);
      res.json({ ok: true });
    } catch (e) {
      console.error('移除家庭成員失敗:', e);
      res.status(500).json({ error: '移除失敗' });
    }
  });

  // ==================== 通用帳戶連結（親戚／同輩／朋友，客人自助連結）====================
  // 與 family_links（家庭訂閱父→子）分開：account_links 係通用關係圖（親戚／同輩／朋友）。
  // 注意：連結後會按用戶第 5 項需求將雙方升 family 會籍（見下方 POST /account-links 實作 :923-936），
  // 故 account_links 實際會影響會員級別（一般帳戶本身已可使用全部服務，升 family 主要係家庭計劃／帳單語義）。
  // 🆕 擴充：涵蓋所有具體稱謂（哥哥／弟弟／姐姐／妹妹、父親／母親、祖父／祖母、兒子／女兒、伯父／叔父／姑媽／舅父／姨媽、孫子／孫女…），
  //    前端下拉按輩分分組提供；後端驗證同錯誤訊息一併放寬。
  const RELATION_PRESETS = [
    '父母', '父親', '母親', '子女', '兒子', '女兒',
    '配偶', '丈夫', '妻子',
    '兄弟', '哥哥', '弟弟', '姐姐', '妹妹', '姐妹', '朋友',
    '祖父', '祖母', '外祖父', '外祖母',
    '伯父', '叔父', '姑媽', '姑姐', '姑母', '舅父', '姨媽', '嬸母', '舅母', '姨母', '阿姨',
    '表哥', '表姐', '表弟', '表妹', '堂哥', '堂姐', '堂弟', '堂妹',
    '姪子', '姪女', '外甥', '外甥女',
    '孫子', '孫女', '外孫', '外孫女',
    '親戚', '其他'
  ];
  // 無序 pair：細 id → user_a，大 id → user_b，保證 (A,B) 唯一
  const normalizePair = (x, y) => (Number(x) < Number(y) ? [Number(x), Number(y)] : [Number(y), Number(x)]);
  // 判斷 caller 能否以 fromUserId 身份連結（admin/staff 任意；家庭戶主可代自己或子女）
  const canLinkAs = async (user, fromUserId) => {
    if (user.role === 'admin' || user.role === 'staff') return true;
    if (Number(fromUserId) === Number(user.id)) return true;
    // 戶主定義同 GET /membership 一致：family_head_id=自己 或 名下已有 family_links 子女
    let isHead = Number(user.family_head_id) === Number(user.id);
    if (!isHead) {
      const c = await q1("SELECT 1 FROM family_links WHERE parent_user_id=? LIMIT 1", [user.id]);
      isHead = !!c;
    }
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
      // 🔒 權限：只有家庭主帳戶（或員工／管理員代操作）先可以建立連結；子帳戶唔可以
      if (user.role === 'customer') {
        const me = await q1("SELECT family_head_id FROM users WHERE id=?", [user.id]);
        const hasChildren = await q1("SELECT 1 FROM family_links WHERE parent_user_id=? LIMIT 1", [user.id]);
        const isHead = me && (Number(me.family_head_id) === Number(user.id) || !!hasChildren);
        if (!isHead) {
          return res.status(403).json({ error: '只有家庭主帳戶才可以連結帳戶；子帳戶請聯絡主帳戶處理。' });
        }
      }
      // 🆕 snake_case alias：target_username / target_phone / from_user_id / from_username / custom_relation
      const body = req.body || {};
      const targetUsername = body.targetUsername || body.target_username;
      const targetPhone    = body.targetPhone    || body.target_phone;
      const relation       = body.relation;
      const customRelation = body.customRelation || body.custom_relation;
      const fromUserId     = body.fromUserId     || body.from_user_id;
      const fromUsername   = body.fromUsername   || body.from_username;
      if (!relation || !RELATION_PRESETS.includes(relation)) {
        return res.status(400).json({ error: '請選擇有效的關係類型', allowed: RELATION_PRESETS });
      }
      const displayRelation = String(customRelation || '').trim() || null;
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
      if (targetUsername) target = await q1("SELECT id, username, name, role, family_head_id, membership_tier FROM users WHERE username=? COLLATE NOCASE", [String(targetUsername).trim()]);
      else if (targetPhone) target = await q1("SELECT id, username, name, role, family_head_id, membership_tier FROM users WHERE phone=?", [String(targetPhone).trim()]);
      if (!target) return res.status(404).json({ error: '找不到該帳戶（請檢查用戶名或電話）' });
      if (target.role !== 'customer') return res.status(400).json({ error: '只能連結客戶帳戶' });
      if (Number(target.id) === Number(fromId)) return res.status(400).json({ error: '唔可以連結自己' });

      const [a, b] = normalizePair(fromId, target.id);
      const existing = await q1("SELECT id FROM account_links WHERE user_a=? AND user_b=?", [a, b]);
      if (existing) return res.status(409).json({ error: '呢兩個帳戶已經連結咗' });

      // 搵出來源帳戶所屬嘅家庭戶主（來源係家庭子女→跟戶主；否則自己做戶主）
      const fromUser = await q1("SELECT id, role, family_head_id, membership_tier FROM users WHERE id=?", [fromId]);
      if (!fromUser) return res.status(404).json({ error: '找不到帳戶 A' });
      const headId = (fromUser.family_head_id && Number(fromUser.family_head_id) !== Number(fromId))
        ? Number(fromUser.family_head_id)
        : Number(fromId);

      // 🔒 目標屬於另一個家庭 → 拒絕（避免一個帳戶出現喺兩張單）
      if (target.family_head_id && Number(target.family_head_id) !== Number(headId)) {
        return res.status(409).json({ error: '對方已經屬於另一個家庭帳戶，唔可以再連結' });
      }

      // 🔒 家庭計劃加人上限檢查（A:2 / B:9 / C:∞）
      const planLim = await checkFamilyPlanLimit(headId);
      if (planLim.blocked) {
        return res.status(403).json({
          error: `你的家庭計劃【${planLim.currentPlan}】已達上限（${planLim.max} 人），請升級至計劃 ${planLim.next} 以添加更多成員。`,
          code: 'PLAN_LIMIT', currentPlan: planLim.currentPlan, nextPlan: planLim.next
        });
      }

      const ins = await run(
        "INSERT INTO account_links (user_a, user_b, relation, custom_relation, initiated_by, created_at) VALUES (?,?,?,?,?,?)",
        [a, b, relation, displayRelation, user.id, new Date().toISOString()]);

      // 「一連即轉」：連結後雙方都入張家庭單。來源主帳戶（管理員代連時係被選來源）升 family
      // 目標帳戶亦要升 family + 綁返戶主，等佢喺張單入邊（用户第 5 項要求：連結後應升級）
      const ownerId = (user.role === 'admin') ? fromId : user.id;
      const owner = await q1("SELECT id, role, membership_tier FROM users WHERE id=?", [ownerId]);
      let ownerUpgradedToFamily = false;
      if (owner && owner.role === 'customer' && owner.membership_tier !== 'family') {
        await run("UPDATE users SET membership_tier='family' WHERE id=?", [ownerId]);
        ownerUpgradedToFamily = true;
      }
      // 🔧 戶主自己補埋 family_head_id=自己（同步鏡像）；
      //    之前漏咗呢步 → /family-payment isHead 誤判 false、戶主被引導「接手供款」
      if (owner && Number(headId) === Number(ownerId)) {
        await run("UPDATE users SET family_head_id=? WHERE id=? AND (family_head_id IS NULL OR family_head_id='')", [headId, ownerId]);
      }
      let targetUpgradedToFamily = false;
      if (target.role === 'customer' && target.membership_tier !== 'family') {
        await run("UPDATE users SET membership_tier='family' WHERE id=?", [target.id]);
        targetUpgradedToFamily = true;
      }
      // 目標帳戶綁返戶主（等佢喺張單入邊）
      if (!target.family_head_id || Number(target.family_head_id) !== Number(headId)) {
        const curHead = await q1("SELECT family_head_id FROM users WHERE id=?", [target.id]);
        if (!curHead || !curHead.family_head_id) await run("UPDATE users SET family_head_id=? WHERE id=?", [headId, target.id]);
      }
      // 重算計劃 + 確保張單存在（新成員都會入張單）
      await syncFamilyPlan(headId);
      // 🔢 連結後按 family_head_id 重算會員編號（主帳戶 S / 子帳戶 M / 一般 J）
      await recomputeMemberNo(target.id);
      await recomputeMemberNo(fromId);
      await recomputeMemberNo(headId);
      res.json({ ok: true, id: ins.lastID, relation, customRelation: displayRelation, fromId, targetId: target.id, ownerUpgradedToFamily, targetUpgradedToFamily, headId });
    } catch (e) {
      console.error('連結帳戶失敗:', e);
      res.status(500).json({ error: '連結失敗' });
    }
  });

  // POST /api/membership/family/upgrade-plan — 家庭戶主自助升級計劃（A→B→C→D），突破加人上限
  router.post('/family/upgrade-plan', requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const me = await q1("SELECT id, family_head_id, family_plan FROM users WHERE id=?", [user.id]);
      const hasChildren = await q1("SELECT 1 FROM family_links WHERE parent_user_id=? LIMIT 1", [user.id]);
      const isHead = me && (Number(me.family_head_id) === Number(me.id) || !!hasChildren);
      if (!isHead) return res.status(403).json({ error: '只有家庭主帳戶才可以升級家庭計劃' });
      const cur = (me.family_plan) || 'A';
      const nxt = nextPlanOf(cur);
      if (!nxt) return res.status(400).json({ error: '已是最高的計劃 D，無需升級' });
      await run("UPDATE users SET family_plan=? WHERE id=?", [nxt, user.id]);
      await syncFamilyPlan(user.id);
      // 🔢 編號內含方案字母（SA→SB…），升級後要重算全家會員編號
      await recomputeFamilyMemberNos(user.id);
      res.json({ ok: true, plan: nxt, price: await familyPlanPrice(nxt), message: `已升級至家庭計劃 ${nxt}` });
    } catch (e) {
      console.error('升級家庭計劃失敗:', e);
      res.status(500).json({ error: '升級失敗' });
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
        // #5：原本只揀 l.custom_relation（snake_case），下面 map 卻讀 r.customRelation →
        //      永遠 undefined，導致關係圖一律 fallback 顯示「親戚」。補 alias。
        // #17b：順便帶埋頭像 url，等關係圖同客人頭像同步。
        `SELECT l.id, l.relation, l.custom_relation AS customRelation, l.initiated_by,
                CASE WHEN l.user_a=? THEN l.user_b ELSE l.user_a END AS other_id,
                u.name, u.username, u.avatar AS avatar_url, u.membership_tier, u.role
         FROM account_links l
         JOIN users u ON u.id = (CASE WHEN l.user_a=? THEN l.user_b ELSE l.user_a END)
         WHERE l.user_a=? OR l.user_b=?
         ORDER BY l.created_at DESC`,
        [viewId, viewId, viewId, viewId]);
      const links = rows.map(r => {
        // 🆕 統一世代分類：親戚(relative) 與 同輩(sibling) 分開 group，供前端關係圖 (#19) 渲染
        const cls = classifyLink(r.relation, r.customRelation);
        return {
          id: r.id,
          relation: r.relation,
          customRelation: r.customRelation,
          relationGroup: cls.relationGroup,
          treeTier: cls.treeTier,
          other: { id: r.other_id, name: r.name, username: r.username, avatar_url: r.avatar_url, membership_tier: r.membership_tier, role: r.role },
          isSelfInitiated: Number(r.initiated_by) === Number(viewId)
        };
      });
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
      // 🔒 權限：只有家庭主帳戶（或員工／管理員）先可以解除連結；子帳戶唔可以
      if (user.role === 'customer') {
        const me = await q1("SELECT family_head_id FROM users WHERE id=?", [user.id]);
        const hasChildren = await q1("SELECT 1 FROM family_links WHERE parent_user_id=? LIMIT 1", [user.id]);
        const isHead = me && (Number(me.family_head_id) === Number(user.id) || !!hasChildren);
        if (!isHead) {
          return res.status(403).json({ error: '只有家庭主帳戶才可以解除連結；子帳戶請聯絡主帳戶處理。' });
        }
      }
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
      // 🔧 同步清走 family_head_id（「一連即轉」曾將對方綁入家庭，唔清會「已解除仍顯示家庭帳戶」）
      for (const pid of [link.user_a, link.user_b]) {
        const remain = await q1(
          "SELECT 1 FROM account_links WHERE user_a=? OR user_b=? UNION SELECT 1 FROM family_links WHERE parent_user_id=? OR child_user_id=?",
          [pid, pid, pid, pid]);
        if (!remain) {
          await run("UPDATE users SET membership_tier='general', family_head_id=NULL WHERE id=? AND membership_tier='family'", [pid]);
        } else {
          // 仲有連結 → 重算計劃（人數可能縮減到另一個計劃）
          const row = await q1("SELECT id, family_head_id, membership_tier FROM users WHERE id=?", [pid]);
          if (row && Number(row.family_head_id) === Number(pid) && row.membership_tier === 'family') {
            await syncFamilyPlan(pid);
          }
        }
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('移除連結失敗:', e);
      res.status(500).json({ error: '移除失敗' });
    }
  });

  // 🔒 防止帳戶連結搜尋被用嚟高頻枚舉其他客戶 PII（電話）
  const linkSearchLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 分鐘
    max: 20,             // 同一 IP 最多 20 次
    message: { ok: false, error: '搜尋過於頻繁，請稍後再試' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // 🔍 GET /api/membership/account-links/search?q= — 戶主搜尋可以連結嘅客戶帳戶（按名稱／用戶名／會員編號）
  // 安全收緊（P2 帳戶連結搜尋 PII 外洩）：
  //   ① 唔返 phone 欄（防其他客戶電話外洩）；
  //   ② 唔按 phone 搜尋（防電話號碼枚舉）；
  //   ③ 關鍵字至少 2 字先搜（防單字廣撒網，中文姓名常 2 字故唔用 3）；
  //   ④ 頻率限制（linkSearchLimiter）。
  // 排除：自己、自己名下嘅家庭子女、以及雙方已存在嘅 account_links（避免重複連結）
  // 管理員可傳 userId ?excludeHeadId= 代指定主帳戶搜尋（排除該戶主及其下子女/已連結）
  router.get('/account-links/search', requireAuth, linkSearchLimiter, async (req, res) => {
    try {
      const kw = String(req.query.q || '').trim();
      if (kw.length < 2) return res.json({ ok: true, results: [] });
      const like = `%${kw}%`;
      let me = req.user.id;
      if (req.query.excludeHeadId && Number(req.query.excludeHeadId) !== Number(req.user.id)) {
        const allowed = req.user.role === 'admin' || (await canLinkAs(req.user, req.query.excludeHeadId));
        if (!allowed) return res.status(403).json({ error: '沒有權限搜尋該帳戶' });
        me = Number(req.query.excludeHeadId);
      }
      if (req.query.excludeUserId) {
        const allowed = req.user.role === 'admin' || (Number(req.query.excludeUserId) === Number(req.user.id)) ||
          (await canLinkAs(req.user, req.query.excludeUserId));
        if (!allowed) return res.status(403).json({ error: '沒有權限搜尋該帳戶' });
        me = Number(req.query.excludeUserId);
      }
      const rows = await q(
        `SELECT u.id, u.username, u.name, u.membership_tier
         FROM users u
         WHERE u.role='customer' AND u.id <> ?
           AND (u.name LIKE ? COLLATE NOCASE OR u.username LIKE ? COLLATE NOCASE OR u.member_no LIKE ?)
           AND u.id NOT IN (SELECT child_user_id FROM family_links WHERE parent_user_id=?)
           AND u.id NOT IN (
             SELECT CASE WHEN user_a=? THEN user_b ELSE user_a END
             FROM account_links WHERE user_a=? OR user_b=?
           )
         ORDER BY u.name COLLATE NOCASE
         LIMIT 12`,
        [me, like, like, like, me, me, me]
      );
      // 🔒 防禦式：無論查詢點寫，返出去嘅結果一律唔帶 phone 欄
      const safe = (rows || []).map(({ phone, ...rest }) => rest);
      res.json({ ok: true, results: safe });
    } catch (e) {
      console.error('搜尋可連結帳戶失敗:', e);
      res.status(500).json({ error: '搜尋失敗' });
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
    if (!['family'].includes(tier)) return res.status(400).json({ error: '無效的會員級別' });
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
    if (!['general', 'family'].includes(tier)) return res.status(400).json({ error: '無效的會員級別' });
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

  // 🆕 POST /api/membership/family/bookings — 家庭戶主代家庭成員預約
  //   Body: { for_user_id, service_id, doctor_name, appointment_date, appointment_time, customer_phone, customer_name?, customer_email? }
  //   校驗：req.user 必須係 for_user_id 嘅家庭戶主（family_head_id = req.user.id）
  //   業務規則：成員若係 general 級別（非家庭連結），只可預約「初體驗」；family/premium 可全部
  router.post('/family/bookings', requireAuth, async (req, res) => {
    try {
      const headId = req.user.id;
      const b = req.body || {};
      const forUserId    = b.forUserId     || b.for_user_id;
      const serviceId    = b.serviceId     || b.service_id;
      const doctorName   = b.doctorName    || b.doctor_name || '張醫師';
      const apptDate     = b.appointmentDate || b.appointment_date || b.date;
      const apptTime     = b.appointmentTime || b.appointment_time || b.time;
      const customerName = b.customerName  || b.customer_name;
      const customerPhone= b.customerPhone || b.customer_phone;
      const customerEmail= b.customerEmail || b.customer_email;
      const extraNotes   = b.notes || '';
      if (!forUserId) return res.status(400).json({ error: "缺少 forUserId" });
      if (!serviceId || !apptDate || !apptTime) return res.status(400).json({ error: "缺少必要欄位：serviceId、appointmentDate、appointmentTime" });
      // 查成員
      const member = await q1("SELECT id, name, family_head_id, role FROM users WHERE id=?", [forUserId]);
      if (!member) return res.status(404).json({ error: "找不到該家庭成員" });
      if (member.role !== 'customer') return res.status(400).json({ error: "只能為客戶帳戶代約" });
      // 戶主驗證
      const isSelf = Number(forUserId) === Number(headId);
      const isMyChild = member.family_head_id && Number(member.family_head_id) === Number(headId);
      if (!isSelf && !isMyChild) {
        return res.status(403).json({ error: "你唔係該成員嘅家庭戶主，無權代約" });
      }
      // 查服務
      const svc = await q1("SELECT name, duration FROM services WHERE id=?", [serviceId]);
      if (!svc) return res.status(400).json({ error: "服務不存在" });
      // 🔒 功能3（2026-09-14）：「初體驗」僅限訪客；會員（任何級別）可預約全部其他治療服務
      if (svc.name.includes('初體驗')) {
        return res.status(403).json({ error: "「初體驗」僅限訪客預約，會員請選擇其他治療服務", code: 'trial_guest_only' });
      }
      // 醫師 user_id
      const docRow = await q1("SELECT id, user_id FROM doctors WHERE name=? AND is_active=1", [doctorName]);
      const doctorUserId = docRow ? docRow.user_id : null;
      // 🔒 與主預約路徑一致：基本開診/日期/衝突檢查（唔可裸寫 confirmed）
      const todayStr = new Date().toLocaleDateString('sv-SE');
      if (!apptDate || apptDate < todayStr) {
        return res.status(400).json({ error: '不可預約過去日期', code: 'past_date' });
      }
      // 簡單衝突：同日同醫師同時段已有預約
      const conflict = await q1(
        `SELECT id FROM bookings WHERE appointment_date=? AND appointment_time=? AND doctor_name=? AND status NOT IN ('cancelled','no-show') LIMIT 1`,
        [apptDate, apptTime, doctorName]
      );
      if (conflict) {
        return res.status(409).json({ error: '該時段已被預約，請另選時段', code: 'slot_taken' });
      }
      const startMin = (() => {
        const p = String(apptTime).split(':').map(Number);
        return p[0] * 60 + (p[1] || 0);
      })();
      const durationMin = Number(svc.duration) || 30;
      const endMin = startMin + durationMin;
      const endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
      const notes = (extraNotes ? extraNotes + ' ' : '') + `[代約 by ${req.user.name}#${req.user.id}]`;
      const r = await run(
        `INSERT INTO bookings (user_id, customer_name, customer_phone, customer_email, service_id, doctor_name, doctor_user_id, appointment_date, appointment_time, end_time, status, notes, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
        [forUserId, customerName || member.name, customerPhone || null, customerEmail || null,
         serviceId, doctorName, doctorUserId, apptDate, apptTime,
         endTime,
         'confirmed', notes]
      );
      res.json({ ok: true, booking_id: r.lastID || r.id, for_user_id: forUserId, member_name: member.name, message: `已代 ${member.name} 預約成功` });
    } catch (e) {
      console.error('family proxy booking error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  return { router, recomputeMemberNo, recomputeFamilyMemberNos };
};

// 🆕 匯出關係世代分類器：供單元測試及前端關係圖代理 (#19) 共用，統一「親戚非同輩」分類
module.exports.RELATION_GROUP_OF = RELATION_GROUP_OF;
module.exports.GENERATION_OF = GENERATION_OF;
module.exports.GROUP_TREE_TIER = GROUP_TREE_TIER;
module.exports.classifyLink = classifyLink;
