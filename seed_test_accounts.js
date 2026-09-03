// 建立測試帳戶：醫生 / 員工 / 一般客戶 / 家庭帳戶(頭 + 子帳戶)
const sqlite3 = require('sqlite3');
const bcrypt = require('bcrypt');

const DB = './database.db';
const PWD = 'Aurora@123';
const hash = bcrypt.hashSync(PWD, 10);

const db = new sqlite3.Database(DB);
const run = (s, p = []) => new Promise((res, rej) => db.run(s, p, function (e) { return e ? rej(e) : res(this.lastID); }));
const get = (s, p = []) => new Promise((res, rej) => db.get(s, p, (e, r) => e ? rej(e) : res(r)));
const all = (s, p = []) => new Promise((res, rej) => db.all(s, p, (e, r) => e ? rej(e) : res(r)));

async function main() {
  const cols = await all('PRAGMA table_info(users)');
  if (!cols.some(c => c.name === 'family_head_id')) {
    await run("ALTER TABLE users ADD COLUMN family_head_id INTEGER");
    console.log('add column family_head_id');
  }

  // 冚賬戶先清一遍（idempotent，可重跑）
  const names = ['testdoctor', 'teststaff', 'testcustomer', 'testfamily', 'testkid1', 'testkid2'];
  for (const n of names) {
    const u = await get('SELECT id FROM users WHERE username=?', [n]);
    if (u) {
      await run('DELETE FROM family_links WHERE parent_user_id=? OR child_user_id=?', [u.id, u.id]);
      await run('DELETE FROM users WHERE id=?', [u.id]);
      console.log('cleared old:', n, 'id', u.id);
    }
  }

  // 1) 醫生
  const drId = await run(
    "INSERT INTO users (username,password,name,phone,email,role,profile_completed,must_change_password,membership_tier) VALUES (?,?,?,?,?,?,1,0,'general')",
    ['testdoctor', hash, '陳世昌', '9100 0001', 'testdoctor@example.com', 'doctor']);

  // 2) 員工
  const stId = await run(
    "INSERT INTO users (username,password,name,phone,email,role,profile_completed,must_change_password,membership_tier) VALUES (?,?,?,?,?,?,1,0,'general')",
    ['teststaff', hash, '前台林小玲', '9100 0002', 'teststaff@example.com', 'staff']);

  // 3) 一般客戶
  const cuId = await run(
    "INSERT INTO users (username,password,name,phone,email,role,profile_completed,must_change_password,membership_tier) VALUES (?,?,?,?,?,?,1,0,'general')",
    ['testcustomer', hash, '王小明', '9100 0003', 'testcustomer@example.com', 'customer']);

  // 4) 家庭帳戶頭
  const headId = await run(
    "INSERT INTO users (username,password,name,phone,email,role,profile_completed,must_change_password,membership_tier) VALUES (?,?,?,?,?,?,1,0,'family')",
    ['testfamily', hash, '李家豪', '9100 0004', 'testfamily@example.com', 'customer']);
  await run('UPDATE users SET family_head_id=? WHERE id=?', [headId, headId]);

  // 5) 家庭子帳戶（兩位成員）
  const kids = [
    { u: 'testkid1', n: '李一心', p: '9100 0005', rel: 'child' },
    { u: 'testkid2', n: '李二朗', p: '9100 0006', rel: 'child' },
  ];
  for (const k of kids) {
    const kidId = await run(
      "INSERT INTO users (username,password,name,phone,email,role,profile_completed,must_change_password,membership_tier) VALUES (?,?,?,?,?,?,1,0,'family')",
      [k.u, hash, k.n, k.p, k.u + '@example.com', 'customer']);
    await run('UPDATE users SET family_head_id=?, membership_tier=? WHERE id=?', [headId, 'family', kidId]);
    await run('INSERT INTO family_links (parent_user_id, child_user_id, relation) VALUES (?,?,?)', [headId, kidId, k.rel]);
  }

  const rows = await all("SELECT id, username, name, role, membership_tier, family_head_id FROM users WHERE username IN ('testdoctor','teststaff','testcustomer','testfamily','testkid1','testkid2') ORDER BY id");
  console.log('=== 測試帳戶已建立 ===');
  console.log('共用密碼:', PWD);
  for (const r of rows) {
    console.log(`  #${String(r.id).padEnd(3)} ${r.username.padEnd(12)} ${String(r.name).padEnd(10)} role=${String(r.role).padEnd(8)} tier=${String(r.membership_tier).padEnd(7)} head_id=${r.family_head_id ?? '-'}`);
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); }).finally(() => { db.close(); });
