// 測試用：喺唯讀快照副本注入各種 premium 情境，驗證遷移腳本嘅判定 / 冪等 / 還原
// ⚠️ 只操作 _prem_test.db（快照副本），絕對唔掂 live database.db
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

if (!fs.existsSync('./_prem_snap.db')) {
  console.error('缺少 _prem_snap.db，請先建立快照');
  process.exit(1);
}
fs.copyFileSync('./_prem_snap.db', './_prem_test.db');

const db = new sqlite3.Database('./_prem_test.db');
const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
const get = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => (e ? rej(e) : res(r))));

(async () => {
  // 清掉上一次測試殘留
  await run("DELETE FROM users WHERE username LIKE 'prem_%'");
  await run("DROP TABLE IF EXISTS premium_migration_log");

  const mk = async (username, name, phone, role, tier) => {
    const r = await run(
      `INSERT INTO users (username,password,name,phone,role,membership_tier,
                          subscription_status,payment_method,member_invoice_no,member_no)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [username, 'x', name, phone, role, tier, 'active', 'stripe', 'MEM-0001', 'J' + phone.slice(-4)]
    );
    return r.lastID;
  };

  const plain1 = await mk('prem_plain1', '舊高級一', '91001111', 'customer', 'premium');
  const plain2 = await mk('prem_plain2', '舊高級二', '91002222', 'customer', 'premium');
  const active = await mk('prem_active', '仲付緊費', '91003333', 'customer', 'premium');
  const head   = await mk('prem_head',   '家庭戶主', '91004444', 'customer', 'premium');
  const linked = await mk('prem_linked', '已連結',   '91005555', 'customer', 'premium');
  const staff  = await mk('prem_staff',  '員工prem', '91006666', 'staff',    'premium');

  // 情境③：有「現行有效」訂閱（未到期）→ 必須被保護，絶對唔可以降級
  await run(`INSERT INTO subscriptions (user_id,tier,status,start_date,end_date)
             VALUES (?,?,?,?,?)`, [active, 'premium', 'active', '2026-01-01', '2027-01-01']);

  // 情境④a：家庭戶主 → 必須略過（避免破壞家庭樹 / 家庭單號）
  await run(`UPDATE users SET family_head_id=? WHERE id=?`, [head, head]);

  // 情境④b：涉 account_links → 必須略過
  const other = await get(`SELECT id FROM users WHERE username NOT LIKE 'prem_%' LIMIT 1`);
  try {
    await run(`INSERT INTO account_links (user_a,user_b,relation) VALUES (?,?,?)`, [linked, other.id, 'friend']);
  } catch (e) {
    // 若 relation 唔容許 null 或欄位名不同，退而求其次只插兩個 id
    await run(`INSERT INTO account_links (user_a,user_b) VALUES (?,?)`, [linked, other.id]);
  }

  // 情境②：非客人角色 → 必須略過（唔可以影響員工 / 醫師 / 管理員）

  console.log('✅ 測試資料注入完成（目標 DB：_prem_test.db）');
  console.log(`   應轉換(2)：prem_plain1 #${plain1}、prem_plain2 #${plain2}`);
  console.log(`   應略過(4)：prem_active #${active}(有效訂閱)、prem_head #${head}(家庭戶主)、`);
  console.log(`              prem_linked #${linked}(帳戶連結)、prem_staff #${staff}(非客人)`);
  db.close();
})();
