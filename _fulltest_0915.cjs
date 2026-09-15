/* 全功能 E2E 測試（2026-09-15）— 隔離快照 _fulltest_0915.db @ :4762（checkout 用 :4763 無 Stripe 執行個體）
 * 覆蓋：會員編號新規格、論壇審核、客人心聲、家庭戶主自助開戶＋計劃上限、
 *       伺服器端家庭資料隔離、門戶頁面改名、checkout 基本閘門。
 * 用法： NODE_PATH=./node_modules node _fulltest_0915.cjs
 */
const path = require('path');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();

const BASE = 'http://localhost:4762';
const BASE_NS = 'http://localhost:4763'; // 無 Stripe 執行個體
const DB = path.join(__dirname, '_fulltest_0915.db');
const PW = 'Pw123456!';

let pass = 0, fail = 0; const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; failures.push(name + (extra ? ' | ' + JSON.stringify(extra).slice(0, 200) : '')); console.log('  ❌ ' + name, extra || ''); }
}

async function api(base, method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let j = null; const txt = await r.text();
  try { j = JSON.parse(txt); } catch (_) { j = txt; }
  return { status: r.status, body: j };
}

async function login(username, password, base) {
  const r = await api(base || BASE, 'POST', '/api/auth/login', { username, password, captchaAnswer: 'test999' });
  if (r.status !== 200 || !r.body.token) throw new Error('login failed ' + username + ': ' + JSON.stringify(r.body).slice(0, 200));
  return r.body.token;
}

function dbRun(sql, params) {
  return new Promise((res, rej) => {
    const d = new sqlite3.Database(DB);
    d.run(sql, params, function (e) { d.close(); e ? rej(e) : res(this); });
  });
}
function dbAll(sql, params) {
  return new Promise((res, rej) => {
    const d = new sqlite3.Database(DB, sqlite3.OPEN_READONLY);
    d.all(sql, params, (e, rows) => { d.close(); e ? rej(e) : res(rows); });
  });
}

(async () => {
  console.log('==== SETUP：冪等清理 + 直接注入測試帳戶 ====');
  // 冪等：清走之前 run 留低嘅測試帳戶同相關記錄
  {
    const olds = await dbAll("SELECT id FROM users WHERE username IN ('ftadmin01','ftgen001','fthead01','fthead02','ftsub002') OR username LIKE 'fthead01%'");
    const ids = olds.map(r => r.id);
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      await dbRun(`DELETE FROM forum_posts WHERE user_id IN (${ph})`, ids);
      await dbRun(`DELETE FROM customer_voices WHERE user_id IN (${ph})`, ids);
      await dbRun(`DELETE FROM family_links WHERE parent_user_id IN (${ph}) OR child_user_id IN (${ph})`, [...ids, ...ids]);
      await dbRun(`DELETE FROM users WHERE id IN (${ph})`, ids);
    }
  }
  const hash = bcrypt.hashSync(PW, 10);
  async function mkUser(u, name, phone, extra) {
    extra = extra || {};
    const cols = extra.cols ? ', ' + extra.cols : '';
    const qs = extra.cols ? ', ' + String(extra.qs || '').replace(/^,\s*/, '') : '';
    const r = await dbRun(
      `INSERT INTO users (username, password, name, phone, role, membership_tier, profile_completed, is_active, member_no${cols})
       VALUES (?,?,?,?,?,?,?,?,?${qs})`,
      [u, hash, name, phone, extra.role || 'customer', extra.tier || 'general', 1, 1, extra.memberNo || null, ...(extra.vals || [])]);
    const row = await dbAll('SELECT id FROM users WHERE username=?', [u]);
    return row[0].id;
  }
  const adminId = await mkUser('ftadmin01', '測管一', '90000001', { role: 'admin', memberNo: 'JR0001' });
  const genId = await mkUser('ftgen001', '測試生', '91112233', { memberNo: 'JR2233' });
  const head1Id = await mkUser('fthead01', '測家一', '92223333', { tier: 'family', memberNo: 'SA3333', cols: 'family_head_id, family_plan', qs: ',?,?', vals: [null, 'A'] });
  await dbRun('UPDATE users SET family_head_id=? WHERE id=?', [head1Id, head1Id]);
  const head2Id = await mkUser('fthead02', '測家二', '93334444', { tier: 'family', memberNo: 'SA4444', cols: 'family_head_id, family_plan', qs: ',?,?', vals: [null, 'A'] });
  await dbRun('UPDATE users SET family_head_id=? WHERE id=?', [head2Id, head2Id]);
  const sub2Id = await mkUser('ftsub002', '測子二', '93334444', { tier: 'family', memberNo: 'MA4444', cols: 'family_head_id, birth_date', qs: ',?,?', vals: [head2Id, '2015-01-01'] });
  await dbRun("INSERT INTO family_links (parent_user_id, child_user_id, relation) VALUES (?,?,?)", [head2Id, sub2Id, 'parent']);
  console.log(`  帳戶: admin=${adminId} gen=${genId} head1=${head1Id} head2=${head2Id} sub2=${sub2Id}`);

  // ---------- 1. 登入 + 會員編號（Item 3）----------
  console.log('\n==== 1) 登入 + 會員編號新規格 ====');
  const adminTok = await login('ftadmin01', PW);
  check('管理員登入', !!adminTok);
  const genTok = await login('ftgen001', PW);
  check('一般用戶登入', !!genTok);
  const mem1 = await api(BASE, 'GET', '/api/membership/', null, genTok);
  check('一般帳戶 memberNo=JR2233', mem1.status === 200 && JSON.stringify(mem1.body).includes('JR2233'), mem1.body);

  // ---------- 2. 論壇審核（Item 5）----------
  console.log('\n==== 2) 論壇審核機制 ====');
  const p1 = await api(BASE, 'POST', '/api/content/forum/posts', { title: 'E2E帖一', content: '測試內容一', category: '中醫問題' }, genTok);
  check('發帖成功（預設待審核）', p1.status === 200 && p1.body.ok && p1.body.id, p1.body);
  const pid1 = p1.body.id;
  const pub1 = await api(BASE, 'GET', '/api/content/forum/posts');
  check('公開列表唔見待審核帖', pub1.status === 200 && !JSON.stringify(pub1.body).includes('"id":' + pid1 + ','), null);
  const mine1 = await api(BASE, 'GET', '/api/content/forum/posts/mine', null, genTok);
  check('作者本人見到待審核帖', mine1.status === 200 && JSON.stringify(mine1.body).includes('"id":' + pid1) && JSON.stringify(mine1.body).includes('pending'), mine1.body);
  const ap1 = await api(BASE, 'PUT', `/api/admin/content/forum/posts/${pid1}/status`, { status: 'approved' }, adminTok);
  check('管理員通過帖子', ap1.status === 200 && ap1.body.ok, ap1.body);
  const pub2 = await api(BASE, 'GET', '/api/content/forum/posts');
  check('通過後公開列表見到', pub2.status === 200 && JSON.stringify(pub2.body).includes('"id":' + pid1 + ','));
  const p2 = await api(BASE, 'POST', '/api/content/forum/posts', { title: 'E2E帖二', content: '測試內容二', category: '中醫問題' }, genTok);
  const rj1 = await api(BASE, 'PUT', `/api/admin/content/forum/posts/${p2.body.id}/status`, { status: 'rejected' }, adminTok);
  check('管理員駁回帖子', rj1.status === 200 && rj1.body.ok, rj1.body);
  const mine2 = await api(BASE, 'GET', '/api/content/forum/posts/mine', null, genTok);
  check('作者見到「未獲批」狀態', JSON.stringify(mine2.body).includes('rejected'));
  const noAuth = await api(BASE, 'PUT', `/api/admin/content/forum/posts/${pid1}/status`, { status: 'rejected' }, genTok);
  check('一般用戶唔可以審帖（403）', noAuth.status === 403, noAuth);

  // ---------- 3. 客人心聲（Item 6）----------
  console.log('\n==== 3) 客人心聲 ====');
  const anonV = await api(BASE, 'POST', '/api/content/customer-voices', { rating: 5, visit_type: '針灸', content: '匿名測試' });
  check('未登入提交心聲 → 401', anonV.status === 401, anonV);
  const v1 = await api(BASE, 'POST', '/api/content/customer-voices', { rating: 5, visit_type: '針灸', content: 'E2E心聲：好正' }, genTok);
  check('登入提交心聲 → pending', v1.status === 200 && v1.body.ok && v1.body.status === 'pending', v1.body);
  const vp1 = await api(BASE, 'GET', '/api/content/customer-voices?page=1&limit=6');
  check('未審核心聲唔會公開顯示', vp1.status === 200 && !JSON.stringify(vp1.body).includes('E2E心聲'), vp1.body);
  const av = await api(BASE, 'GET', '/api/admin/content/customer-voices', null, adminTok);
  check('管理員見到全部心聲（含 pending）', av.status === 200 && JSON.stringify(av.body).includes('E2E心聲'), av.body);
  const vid = (Array.isArray(av.body) ? av.body : av.body.items || []).find(v => v.content && v.content.includes('E2E心聲'));
  const avOk = await api(BASE, 'PUT', `/api/admin/content/customer-voices/${vid.id}/status`, { status: 'approved' }, adminTok);
  check('管理員審批心聲', avOk.status === 200 && avOk.body.ok, avOk.body);
  const vp2 = await api(BASE, 'GET', '/api/content/customer-voices?page=1&limit=6');
  check('審批後官網顯示心聲', JSON.stringify(vp2.body).includes('E2E心聲'));
  for (let i = 0; i < 7; i++) {
    await dbRun("INSERT INTO customer_voices (user_id, user_name, rating, visit_type, content, status) VALUES (?,?,?,?,?,'approved')",
      [genId, '測試生', 4, '拔罐', `E2E補充心聲${i}`]);
  }
  const vp3 = await api(BASE, 'GET', '/api/content/customer-voices?page=1&limit=6');
  check('分頁：page1 有 6 筆、pages>=2', vp3.body.items && vp3.body.items.length === 6 && vp3.body.pages >= 2, { n: vp3.body.items && vp3.body.items.length, pages: vp3.body.pages });
  const vp4 = await api(BASE, 'GET', '/api/content/customer-voices?page=2&limit=6');
  check('分頁：page2 有內容', vp4.body.items && vp4.body.items.length >= 1, vp4.body.items && vp4.body.items.length);

  // ---------- 4. 家庭戶主自助開戶 + 計劃上限（Item 2/4）----------
  console.log('\n==== 4) 家庭戶主自助開戶（計劃 A=2人上限）====');
  const head1Tok = await login('fthead01', PW);
  check('戶主登入', !!head1Tok);
  const c1 = await api(BASE, 'POST', '/api/membership/family/register', { name: '陳小一', birth_date: '2019-05-05' }, head1Tok);
  check('戶主自助開第一個子帳戶', c1.status === 200 && c1.body.ok, c1.body);
  const cred = c1.body.credentials || {};
  check('回覆包含臨時登入資料', cred.username && cred.tempPassword, Object.keys(c1.body));
  const childTok = await login(cred.username, cred.tempPassword);
  check('子帳戶用臨時密碼登入', !!childTok);
  const childMem = await api(BASE, 'GET', '/api/membership/', null, childTok);
  check('子帳戶編號 = MA3333（M+方案A+電話後4）', JSON.stringify(childMem.body).includes('MA3333'), childMem.body);
  const adultBlock = await api(BASE, 'POST', '/api/membership/family/register', { name: '陳成年', birth_date: '1990-01-01' }, head1Tok);
  check('18歲以上拒絕開戶', adultBlock.status === 403, adultBlock.body);
  await api(BASE, 'POST', '/api/membership/family/register', { name: '陳小二', birth_date: '2020-06-06' }, head1Tok);
  const c3 = await api(BASE, 'POST', '/api/membership/family/register', { name: '陳小三', birth_date: '2021-07-07' }, head1Tok);
  check('計劃 A 第 3 人 → PLAN_LIMIT 擋', c3.status === 403 && c3.body.code === 'PLAN_LIMIT' && c3.body.nextPlan === 'B', c3.body);
  await dbRun("UPDATE users SET family_plan='D' WHERE id=?", [head1Id]);
  const c4 = await api(BASE, 'POST', '/api/membership/family/register', { name: '陳小三', birth_date: '2021-07-07' }, head1Tok);
  check('計劃 D 不設上限 → 第 3 人通過', c4.status === 200 && c4.body.ok, c4.body);

  // ---------- 5. 伺服器端家庭資料隔離（Item 10）----------
  console.log('\n==== 5) 家庭資料隔離（伺服器端）====');
  const sub2Tok = await login('ftsub002', PW);
  check('他戶子帳戶登入', !!sub2Tok);
  const kids = await dbAll("SELECT u.id, u.name FROM family_links fl JOIN users u ON u.id=fl.child_user_id WHERE fl.parent_user_id=? ORDER BY u.id", [head1Id]);
  const otherChildId = kids[0].id;
  const cross1 = await api(BASE, 'GET', `/api/membership/family/${otherChildId}/bookings`, null, sub2Tok);
  check('跨家庭看預約 → 403', cross1.status === 403, cross1);
  const cross2 = await api(BASE, 'GET', `/api/membership/family/${otherChildId}/profile`, null, sub2Tok);
  check('跨家庭看個人資料 → 403', cross2.status === 403, cross2);
  const cross3 = await api(BASE, 'GET', `/api/membership/family/${otherChildId}/medical`, null, sub2Tok);
  check('跨家庭看病歷 → 403', cross3.status === 403, cross3);
  const own1 = await api(BASE, 'GET', `/api/membership/family/${sub2Id}/bookings`, null, sub2Tok);
  check('看自己預約 → 200', own1.status === 200, own1.status + ' ' + JSON.stringify(own1.body).slice(0, 120));
  const ownTree = await api(BASE, 'GET', '/api/membership/family/my-tree', null, sub2Tok);
  check('子帳戶睇自己家庭樹（head=自己戶主、成員含自己）', ownTree.status === 200 && ownTree.body.head && ownTree.body.head.name === '測家二' && JSON.stringify(ownTree.body.children || []).includes('測子二'), ownTree.body);
  const ownFam = await api(BASE, 'GET', '/api/membership/family', null, sub2Tok);
  check('子帳戶睇自己家庭成員列表（parentName=戶主名）', ownFam.status === 200 && ownFam.body.parentName === '測家二' && JSON.stringify(ownFam.body).includes('測子二'), ownFam.body);

  // ---------- 6. 門戶頁面改名 + 渲染（Item 7）----------
  console.log('\n==== 6) 門戶頁面渲染 + 改名 ====');
  for (const pg of ['index.html', 'admin.html', 'staff.html', 'doctor.html', 'hr.html']) {
    const r = await fetch(BASE + '/' + pg);
    const txt = await r.text();
    check(`${pg} 200 + 寶天JR`, r.status === 200 && txt.includes('寶天JR') && !txt.includes('寶天醫館'));
  }

  // ---------- 7. Checkout 閘門（Item 1，無 Stripe 執行個體）----------
  console.log('\n==== 7) Checkout 閘門（:4763 無 Stripe）====');
  const badTier = await api(BASE, 'POST', '/api/membership/checkout', { tier: 'vip' }, genTok);
  check('無效 tier → 400', badTier.status === 400, badTier);
  const nsLogin = await login('ftgen001', PW, BASE_NS).catch(e => { console.log('  ⚠️ 4763 登入失敗：' + e.message); return null; });
  if (nsLogin) {
    const ck = await api(BASE_NS, 'POST', '/api/membership/checkout', { tier: 'family', plan: 'C' }, nsLogin);
    check('無 Stripe 時 checkout → 503 stripe_not_configured（plan 參數被接受）', ck.status === 503 && ck.body.code === 'stripe_not_configured', ck);
  } else {
    console.log('  ⚠️ 4763 執行個體不可用，略過 checkout 503 測試');
  }

  // ---------- 總結 ----------
  console.log(`\n==================== 總結 ====================`);
  console.log(`通過 ${pass}項 / 失敗 ${fail}項`);
  if (failures.length) { console.log('失敗明細：'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(2); });
