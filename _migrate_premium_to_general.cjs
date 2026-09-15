#!/usr/bin/env node
/**
 * ============================================================================
 *  舊「高級會員 premium」→「一般會員 general（免費）」資料遷移腳本
 *  專案：寶天JR 智能預約系統 (booking-aurora)
 *  背景：2026-09-15 業主決定「取消高級會員」，方案改為「一般帳戶」+「家庭帳戶 A/B/C/D」
 * ============================================================================
 *
 * 【本腳本假設的資料表與欄位】（啟動時會自動校驗，缺欄位會直接中止）
 *
 *  1) users（會員主表）
 *     - id                    會員 ID
 *     - username / name / phone / email   個資（本腳本【不會】修改）
 *     - role                  系統角色 customer/staff/doctor/admin
 *                            ⚠️ 呢個係「系統角色」而唔係會員等級，改咗會破壞登入權限，
 *                               所以本腳本【保留不動】，只改 membership_tier。
 *     - membership_tier       會員類型 general | premium | family   ← 主要轉換欄位
 *     - subscription_status   訂閱狀態 active | canceled | past_due | none
 *                            （既有程式碼用 'canceled' 單 l，見 memberships.js:266）
 *     - payment_method        付款方式（付費開關之一，轉換時清空）
 *     - member_invoice_no     會員單號（付費開關之一，轉換時清空）
 *     - stripe_subscription_id Stripe 訂閱關聯（如欄位存在則清空；唔會真係去 Stripe 取消）
 *     - member_no             會員編號（依 2026-09-15 新規格統一為 JR＋電話末 4 碼）
 *     - family_head_id / family_plan   家庭結構（用於排除涉家庭嘅帳戶）
 *
 *  2) subscriptions（訂閱紀錄表）
 *     - user_id, tier, status, start_date, end_date
 *     → 用嚟判斷「現行有效訂閱者」，有有效訂閱者一律【略過】，絕不波及。
 *
 *  3) family_links(parent_user_id, child_user_id) / account_links(user_a, user_b)
 *     → 用嚟判斷是否涉家庭結構；涉家庭者一律【略過】並列出，避免破壞家庭樹與單號。
 *
 *  4) premium_migration_log（本腳本自動建立，UNIQUE(user_id) 保證冪等）
 *     → 記錄每一筆轉換前後嘅值，同時作為【還原（rollback）】嘅依據。
 *
 * 【舊 premium 用戶的判定條件】（必須全部成立才會被轉換）
 *   ① users.membership_tier = 'premium'
 *   ② users.role = 'customer'（只處理客人，唔掂員工／醫師／管理員）
 *   ③ 沒有「現行有效」嘅 premium 訂閱
 *      （不存在 subscriptions 中 status='active' 且 end_date >= 今天 或 end_date 為空 的列）
 *      → 呢條係最重要嘅保護：仲付緊費／未到期嘅人唔會被降級。
 *   ④ 完全沒有涉家庭結構（family_head_id 為空、唔係戶主、唔係子成員、無 account_links）
 *      → 避免影響家庭帳戶、家庭單號（JRA/JRB/JRC/JRD）與關係圖。
 *   ⑤ premium_migration_log 中未曾處理過（冪等：重複執行唔會重複影響）
 *
 * 【轉換動作】（只改下列欄位，其餘個資／預約／病歷／紀錄一律原封不動）
 *   - membership_tier      → 'general'
 *   - subscription_status  → 'canceled'（關閉付費訂閱狀態）
 *   - payment_method       → NULL（關閉付款方式）
 *   - member_invoice_no    → NULL（清除會員單號）
 *   - stripe_subscription_id → NULL（如欄位存在；註：Stripe 端嘅訂閱需另行於 Stripe 後台取消）
 *   - member_no            → 'JR' + 電話末 4 碼（一般帳戶新編號規格，無電話則 '0000'）
 *   - subscriptions 中殘餘嘅 premium / active 列 → status='canceled'（安全網，正常應為 0 筆）
 *
 * 【使用方式】
 *   node _migrate_premium_to_general.cjs --db=./database.db              # 乾跑（預設，不改資料）
 *   node _migrate_premium_to_general.cjs --db=./database.db --apply      # 真正執行
 *   node _migrate_premium_to_general.cjs --db=./database.db --rollback   # 依 log 還原
 *   --batch-size=200  每批筆數（預設 200）
 *   --sample=5        驗證抽樣筆數（預設 5）
 * ============================================================================
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// ---------------------- 命令列參數 ----------------------
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
};
const has = (name) => argv.includes(`--${name}`);

const DB_PATH = arg('db', './database.db');
const APPLY = has('apply');
const ROLLBACK = has('rollback');
const BATCH_SIZE = Math.max(1, parseInt(arg('batch-size', '200'), 10) || 200);
const SAMPLE = Math.max(1, parseInt(arg('sample', '5'), 10) || 5);

// ---------------------- sqlite3 promise 封裝 ----------------------
function openDb(readonly) {
  return new Promise((resolve, reject) => {
    const mode = readonly ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE;
    const db = new sqlite3.Database(DB_PATH, mode, (err) => (err ? reject(err) : resolve(db)));
  });
}
const all = (db, sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r || []))));
const get = (db, sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => (e ? rej(e) : res(r))));
const run = (db, sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
const exec = (db, sql) => new Promise((res, rej) => db.exec(sql, (e) => (e ? rej(e) : res())));

// ---------------------- 通用：取電話末 4 碼 ----------------------
function last4OfPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.slice(-4) || '0000';
}
// 一般帳戶會員編號：JR + 電話末 4 碼（2026-09-15 新規格）
const generalMemberNo = (phone) => 'JR' + last4OfPhone(phone);

// 今天（YYYY-MM-DD），用於判斷訂閱是否已到期
function today() {
  return new Date().toISOString().slice(0, 10);
}

// 批次 id，方便追蹤同一批轉換
const BATCH_ID = 'P2G-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

// ---------------------- 0. 建立還原/冪等用的紀錄表 ----------------------
async function ensureLogTable(db) {
  await exec(db, `
    CREATE TABLE IF NOT EXISTS premium_migration_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,      -- UNIQUE 保證同一個人唔會被重複處理（冪等）
      username TEXT,
      old_tier TEXT, old_subscription_status TEXT, old_payment_method TEXT,
      old_member_invoice_no TEXT, old_member_no TEXT, old_stripe_sub_id TEXT,
      new_tier TEXT, new_subscription_status TEXT, new_member_no TEXT,
      batch_id TEXT,
      migrated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

// ---------------------- 1. 校驗 schema（缺欄位直接中止）----------------------
async function verifySchema(db) {
  const cols = await all(db, 'PRAGMA table_info(users)');
  const names = new Set(cols.map((c) => c.name));
  const required = ['id', 'username', 'phone', 'role', 'membership_tier', 'subscription_status', 'member_no', 'family_head_id'];
  const missing = required.filter((c) => !names.has(c));
  if (missing.length) {
    throw new Error(`users 表缺少必要欄位：${missing.join(', ')}，請先確認 migration 已執行`);
  }
  // 唔係必要，但存在就要一併處理
  const hasStripe = names.has('stripe_subscription_id');
  const hasPayMethod = names.has('payment_method');
  const hasInvoiceNo = names.has('member_invoice_no');

  // subscriptions / family_links / account_links 表存在性
  const tables = (await all(db, "SELECT name FROM sqlite_master WHERE type='table'"))
    .map((t) => t.name);
  for (const t of ['subscriptions', 'family_links', 'account_links']) {
    if (!tables.includes(t)) throw new Error(`缺少資料表：${t}`);
  }
  return {
    names, hasStripe, hasPayMethod, hasInvoiceNo,
    hasLog: tables.includes('premium_migration_log')   // 還原/冪等紀錄表是否已存在
  };
}

// ---------------------- 2. 撈出「符合條件」的舊 premium 用戶 ----------------------
// 條件見檔案最上方說明（①~⑤）
async function fetchCandidates(db, schema) {
  const sql = `
    SELECT u.id, u.username, u.name, u.phone, u.member_no,
           u.membership_tier, u.subscription_status,
           ${schema.hasPayMethod ? 'u.payment_method,' : 'NULL AS payment_method,'}
           ${schema.hasInvoiceNo ? 'u.member_invoice_no,' : 'NULL AS member_invoice_no,'}
           ${schema.hasStripe ? 'u.stripe_subscription_id' : 'NULL AS stripe_subscription_id'}
    FROM users u
    WHERE u.membership_tier = 'premium'                       -- ① 只處理 premium
      AND u.role = 'customer'                                 -- ② 只處理客人
      AND NOT EXISTS (                                        -- ③ 排除「現行有效訂閱」
            SELECT 1 FROM subscriptions s
            WHERE s.user_id = u.id
              AND s.status = 'active'
              AND (s.end_date IS NULL OR date(s.end_date) >= date('now'))
          )
      ${schema.hasStripe
        ? "AND (u.stripe_subscription_id IS NULL OR u.stripe_subscription_id = '')"
        : '-- 若無 stripe_subscription_id 欄位則略過此保護'}
      -- ↑ 額外保護：只要仍連住 Stripe 訂閱（仲扣緊費），一律略過、唔會被降級
      AND (u.family_head_id IS NULL OR u.family_head_id = '')  -- ④ 唔涉家庭
      AND NOT EXISTS (SELECT 1 FROM family_links fl WHERE fl.parent_user_id = u.id OR fl.child_user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM account_links al WHERE al.user_a = u.id OR al.user_b = u.id)
      ${schema.hasLog
        ? 'AND NOT EXISTS (SELECT 1 FROM premium_migration_log lg WHERE lg.user_id = u.id)'
        : '-- ⑤ 紀錄表尚未建立：乾跑時略過此條件，確保唯讀、零寫入'}
    ORDER BY u.id
  `;
  return all(db, sql);
}

// ---------------------- 3. 列出「仲係 premium 但被略過」的帳戶 + 原因 ----------------------
// 目的：等你可以人工覆核，確保冇「應該轉但冇轉」或「唔應該轉」嘅漏網之魚
async function fetchExcluded(db, schema, candidateIds = new Set()) {
  const rows = await all(db, `
    SELECT u.id, u.username, u.name, u.role, u.family_head_id,
           (SELECT COUNT(*) FROM subscriptions s
             WHERE s.user_id = u.id AND s.status='active'
               AND (s.end_date IS NULL OR date(s.end_date) >= date('now'))) AS active_sub_cnt,
           (SELECT COUNT(*) FROM family_links fl WHERE fl.parent_user_id=u.id OR fl.child_user_id=u.id) AS fam_cnt,
           (SELECT COUNT(*) FROM account_links al WHERE al.user_a=u.id OR al.user_b=u.id) AS link_cnt
    FROM users u
    WHERE u.membership_tier = 'premium'
  `);
  const out = [];
  for (const r of rows) {
    if (candidateIds.has(r.id)) continue;   // 已符合條件、列入「待轉換」，唔算略過
    // 已被處理過的（log 有記錄）唔算「略過」；還原後 log 會被刪除，條件具對稱性
    if (schema.hasLog) {
      const done = await get(db, 'SELECT 1 FROM premium_migration_log WHERE user_id=?', [r.id]);
      if (done) continue;
    }
    const reasons = [];
    if (r.role !== 'customer') reasons.push(`非客人角色(${r.role})`);
    if (r.active_sub_cnt > 0) reasons.push('仍有有效訂閱（保護中）');
    if (r.fam_cnt > 0) reasons.push('涉家庭成員關係');
    if (r.link_cnt > 0) reasons.push('涉帳戶連結');
    if (r.family_head_id) reasons.push('已歸屬家庭');
    out.push({ id: r.id, username: r.username, name: r.name, reason: reasons.join(' / ') || '原因未知（請人工檢查）' });
  }
  return out;
}

// ---------------------- 4. 執行轉換（分批 + 每批一個 transaction）----------------------
async function convert(db, schema, candidates) {
  const stats = { success: 0, failed: 0, failures: [] };

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    // 每批一個 transaction：中途出錯只回滾嗰批，唔會影響之前已成功嘅批次
    await exec(db, 'BEGIN TRANSACTION');
    for (const u of batch) {
      try {
        const newNo = generalMemberNo(u.phone);

        // 4-1 寫入還原紀錄（成功先寫，確保 rollback 有得還原）
        await run(db, `
          INSERT INTO premium_migration_log
            (user_id, username, old_tier, old_subscription_status, old_payment_method,
             old_member_invoice_no, old_member_no, old_stripe_sub_id,
             new_tier, new_subscription_status, new_member_no, batch_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        `, [u.id, u.username, u.membership_tier, u.subscription_status,
            u.payment_method, u.member_invoice_no, u.member_no, u.stripe_subscription_id,
            'general', 'canceled', newNo, BATCH_ID]);

        // 4-2 更新會員類型 + 關閉付費開關（個資／預約／病歷一律唔掂）
        const sets = ['membership_tier = ?', "subscription_status = 'canceled'"];
        const params = ['general'];
        if (schema.hasPayMethod) { sets.push('payment_method = NULL'); }
        if (schema.hasInvoiceNo) { sets.push('member_invoice_no = NULL'); }
        if (schema.hasStripe) { sets.push('stripe_subscription_id = NULL'); }
        sets.push('member_no = ?');
        params.push(newNo);
        params.push(u.id);
        await run(db, `UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);

        // 4-3 安全網：殘餘嘅 premium/active 訂閱列標記取消（正常應為 0 筆）
        await run(db, `
          UPDATE subscriptions SET status='canceled', updated_at=CURRENT_TIMESTAMP
          WHERE user_id=? AND tier='premium' AND status='active'
        `, [u.id]);

        stats.success++;
      } catch (e) {
        // 單一會員失敗：記錄落 failure list，繼續處理其他人（唔會整批中止）
        stats.failed++;
        stats.failures.push({ id: u.id, username: u.username, reason: e.message });
      }
    }
    await exec(db, 'COMMIT');
  }
  return stats;
}

// ---------------------- 5. 還原（rollback）：依 log 還原舊值 ----------------------
async function rollback(db, schema) {
  const logs = await all(db, 'SELECT * FROM premium_migration_log ORDER BY id');
  const stats = { restored: 0, failed: 0, failures: [] };
  if (!logs.length) {
    console.log('ℹ️  冇任何轉換紀錄，無需還原。');
    return stats;
  }
  await exec(db, 'BEGIN TRANSACTION');
  for (const l of logs) {
    try {
      const sets = ['membership_tier = ?', 'subscription_status = ?'];
      const params = [l.old_tier, l.old_subscription_status];
      if (schema.hasPayMethod) { sets.push('payment_method = ?'); params.push(l.old_payment_method); }
      if (schema.hasInvoiceNo) { sets.push('member_invoice_no = ?'); params.push(l.old_member_invoice_no); }
      if (schema.hasStripe) { sets.push('stripe_subscription_id = ?'); params.push(l.old_stripe_sub_id); }
      sets.push('member_no = ?');
      params.push(l.old_member_no);
      params.push(l.user_id);
      await run(db, `UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
      await run(db, 'DELETE FROM premium_migration_log WHERE id = ?', [l.id]);
      stats.restored++;
    } catch (e) {
      stats.failed++;
      stats.failures.push({ id: l.user_id, username: l.username, reason: e.message });
    }
  }
  await exec(db, 'COMMIT');
  return stats;
}

// ---------------------- 6. 遷移前／後驗證 + 抽樣比對 ----------------------
async function validate(db, phase) {
  const dist = await all(db, 'SELECT membership_tier, COUNT(*) c FROM users GROUP BY membership_tier');
  console.log(`\n【${phase}】會員類型分佈：`);
  dist.forEach((d) => console.log(`   ${d.membership_tier || '(null)'}: ${d.c} 位`));

  // 防護檢查：確保冇「仍有有效訂閱」嘅人被降級
  const violated = await all(db, `
    SELECT u.id, u.username FROM users u
    WHERE u.membership_tier = 'general'
      AND EXISTS (SELECT 1 FROM premium_migration_log lg WHERE lg.user_id = u.id)
      AND EXISTS (SELECT 1 FROM subscriptions s
                  WHERE s.user_id = u.id AND s.status='active'
                    AND (s.end_date IS NULL OR date(s.end_date) >= date('now')))
  `);
  if (violated.length) {
    console.log(`   ⚠️  警告：${violated.length} 位仍持有效訂閱者被轉換！`);
    violated.forEach((v) => console.log(`      - #${v.id} ${v.username}`));
  } else {
    console.log('   ✅ 防護檢查通過：冇任何「仍持有效訂閱」嘅會員被降級');
  }

  // 抽樣：顯示轉換前後對照
  const samples = await all(db, `
    SELECT user_id, username, old_tier, new_tier, old_subscription_status, new_subscription_status,
           old_member_no, new_member_no, old_payment_method, old_member_invoice_no
    FROM premium_migration_log ORDER BY id LIMIT ?
  `, [SAMPLE]);
  if (samples.length) {
    console.log(`\n【${phase}】抽樣比對（最多 ${SAMPLE} 筆）：`);
    samples.forEach((s) => {
      console.log(`   #${s.user_id} ${s.username}`);
      console.log(`      類型：${s.old_tier} → ${s.new_tier}`);
      console.log(`      訂閱：${s.old_subscription_status} → ${s.new_subscription_status}`);
      console.log(`      編號：${s.old_member_no} → ${s.new_member_no}`);
      console.log(`      付款方式：${s.old_payment_method || '(空)'} → 已清空`);
      console.log(`      會員單號：${s.old_member_invoice_no || '(空)'} → 已清空`);
    });
  }
}

// ---------------------- 主流程 ----------------------
(async () => {
  console.log('='.repeat(70));
  console.log(' 舊 premium → 一般會員（免費）遷移腳本');
  console.log(` 資料庫：${path.resolve(DB_PATH)}`);
  console.log(` 模式：${ROLLBACK ? '還原 (rollback)' : APPLY ? '正式執行 (apply)' : '乾跑 (dry-run，不會改資料)'}`);
  console.log(` 批次大小：${BATCH_SIZE}　抽樣：${SAMPLE}`);
  console.log('='.repeat(70));

  let db;
  try {
    db = await openDb(!APPLY && !ROLLBACK);   // 乾跑用唯讀，雙重保險
    const schema = await verifySchema(db);
    console.log('\n✅ Schema 校驗通過（users / subscriptions / family_links / account_links 皆存在）');

    if (ROLLBACK) {
      const rdb = await openDb(false);
      await ensureLogTable(rdb);
      const st = await rollback(rdb, schema);
      console.log(`\n【還原結果】成功：${st.restored}　失敗：${st.failed}`);
      if (st.failures.length) {
        console.log('失敗清單：');
        st.failures.forEach((f) => console.log(`   - #${f.id} ${f.username}：${f.reason}`));
      }
      await validate(rdb, '還原後');
      return;
    }

    // 乾跑（唯讀）唔建表，確保「零寫入」；只有正式執行／還原先建立紀錄表
    if (APPLY || ROLLBACK) {
      await ensureLogTable(db);
      schema.hasLog = true;   // 建完表，後續查詢先可以安全參照
    }

    const candidates = await fetchCandidates(db, schema);
    const excluded = await fetchExcluded(db, schema, new Set(candidates.map((c) => c.id)));

    console.log(`\n【遷移前】符合條件待轉換：${candidates.length} 位`);
    if (candidates.length) {
      console.log('   名單：' + candidates.slice(0, 10).map((c) => `#${c.id} ${c.username}`).join('、')
        + (candidates.length > 10 ? ` …（共 ${candidates.length} 位）` : ''));
    }
    if (excluded.length) {
      console.log(`\n【略過・需人工覆核】${excluded.length} 位（仍係 premium 但唔符合條件，本腳本不會處理）：`);
      excluded.forEach((e) => console.log(`   - #${e.id} ${e.username}：${e.reason}`));
    }

    if (!APPLY) {
      console.log('\n🔎 乾跑模式結束，未修改任何資料。確認無誤後請加 --apply 正式執行。');
      return;
    }

    // 真正執行
    const stats = await convert(db, schema, candidates);
    console.log(`\n【執行結果】成功：${stats.success}　失敗：${stats.failed}　略過：${excluded.length}`);
    if (stats.failures.length) {
      console.log('失敗清單：');
      stats.failures.forEach((f) => console.log(`   - #${f.id} ${f.username}：${f.reason}`));
    }

    await validate(db, '遷移後');

    // 冪等性驗證：再撈一次，應該係 0（因為 log 已有記錄且 tier 已改）
    const again = await fetchCandidates(db, schema);
    console.log(`\n【冪等檢查】重複執行將影響 ${again.length} 位（應為 0）→ ${again.length === 0 ? '✅ 冪等' : '⚠️ 有殘留'}`);
    console.log('\n💡 如需還原，請執行：node _migrate_premium_to_general.cjs --db=' + DB_PATH + ' --rollback');
  } catch (e) {
    console.error('\n❌ 發生錯誤：', e.message);
    process.exitCode = 1;
  } finally {
    if (db) db.close();
  }
})();
