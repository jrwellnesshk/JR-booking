/**
 * 家庭帳戶單一來源服務（H3 修正）
 *
 * 問題：原本 family_head_id（users 欄位）同 family_links（關係表）兩套機制並存，
 *       靠各處手動同步，改漏就會唔同步 → 家庭成員睇唔到彼此預約 / 計錯會員層級。
 *
 * 解決：family_links 為「關係真源」，family_head_id 為「同步鏡像欄位」。
 *       所有寫入都經呢個模組，保證兩者永遠一致；
 *       另提供 reconcile() 喺 server 啟動時修復任何歷史遺留嘅唔同步。
 *
 * 語意約定（與舊有邏輯一致）：
 *   - 戶主（head）：family_head_id = 自己 id（即使暫時無子女，apply-family 已啟用）
 *   - 子女（child）：family_head_id = parent 嘅 id
 *   - 子女層級：general 自動升 family；premium 唔變（永不降級）
 */

module.exports = (db) => {
  const run = (sql, params) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
  });
  const get = (sql, params) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
  const all = (sql, params) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });

  // 戶主啟用家庭帳戶（無子女時都要標記 family_head_id = 自己 id）
  const enableHead = (userId) =>
    run("UPDATE users SET family_head_id=? WHERE id=?", [userId, userId]);

  // 新增一條親屬連結：寫入 family_links + 同步鏡像欄位 + 子女升級 family
  const addChild = async (parentId, childId, relation = 'parent') => {
    await run(
      "INSERT OR IGNORE INTO family_links (parent_user_id, child_user_id, relation) VALUES (?,?,?)",
      [parentId, childId, relation]
    );
    // 確保 parent 自己標記為 head
    await enableHead(parentId);
    // child 鏡像指向 parent（若未設定或與現有唔同，以 parent 為準）
    await run(
      "UPDATE users SET family_head_id=? WHERE id=? AND (family_head_id IS NULL OR family_head_id != ?)",
      [parentId, childId, parentId]
    );
    // general 級自動升 family；premium 唔變
    await run("UPDATE users SET membership_tier='family' WHERE id=? AND membership_tier='general'", [childId]);
    return true;
  };

  // 解除單一子女嘅連結（按 child_user_id）。返回其 parent id；無連結則返回 null。
  const removeChildLink = async (childUserId) => {
    const link = await get("SELECT parent_user_id FROM family_links WHERE child_user_id=? LIMIT 1", [childUserId]);
    if (!link) return null;
    const parentId = link.parent_user_id;
    await run("DELETE FROM family_links WHERE child_user_id=?", [childUserId]);
    // 若該 child 已無其他 parent 連結，清除鏡像 + family tier 降返 general
    const remaining = await get("SELECT 1 FROM family_links WHERE child_user_id=?", [childUserId]);
    if (!remaining) {
      await run("UPDATE users SET family_head_id=NULL WHERE id=? AND family_head_id != id", [childUserId]);
      await run("UPDATE users SET membership_tier='general' WHERE id=? AND membership_tier='family'", [childUserId]);
    }
    return parentId;
  };

  // 將某用戶完全移出家庭（無論佢係 head 定 child）
  const removeUserFromFamily = async (userId) => {
    // 若係 head：清子女鏡像 + tier，刪 links
    const kids = await all("SELECT child_user_id FROM family_links WHERE parent_user_id=?", [userId]);
    for (const k of kids) {
      await run("UPDATE users SET family_head_id=NULL WHERE id=? AND family_head_id != id", [k.child_user_id]);
      await run("UPDATE users SET membership_tier='general' WHERE id=? AND membership_tier='family'", [k.child_user_id]);
    }
    await run("DELETE FROM family_links WHERE parent_user_id=?", [userId]);
    // 若係 child：清自己鏡像 + tier
    await removeChildLink(userId);
    // 清自己 head 標記（若曾係 head）
    await run("UPDATE users SET family_head_id=NULL WHERE id=? AND family_head_id = id", [userId]);
    return true;
  };

  // 取消家庭訂閱：解除全部子女連結 + 清 head 標記（保留子女帳戶）。返回解除咗幾多位。
  const detachAllChildren = async (parentId) => {
    const kids = await all("SELECT child_user_id FROM family_links WHERE parent_user_id=?", [parentId]);
    await run("DELETE FROM family_links WHERE parent_user_id=?", [parentId]);
    let detached = 0;
    for (const k of kids) {
      await run("UPDATE users SET family_head_id=NULL WHERE id=? AND family_head_id != id", [k.child_user_id]);
      await run("UPDATE users SET membership_tier='general' WHERE id=? AND membership_tier='family'", [k.child_user_id]);
      detached++;
    }
    // 清自己 head 標記
    await run("UPDATE users SET family_head_id=NULL WHERE id=? AND family_head_id = id", [parentId]);
    return detached;
  };

  // 🔧 單一來源修復：以 family_links 為準，重算 users.family_head_id
  const reconcile = async () => {
    const parents = await all("SELECT DISTINCT parent_user_id AS id FROM family_links");
    const children = await all("SELECT child_user_id AS child, parent_user_id AS parent FROM family_links");
    const headIds = new Set(parents.map((p) => p.id));

    // 1) 所有有子女嘅用戶 → head（family_head_id = 自己 id）
    for (const p of parents) {
      await run("UPDATE users SET family_head_id=? WHERE id=?", [p.id, p.id]);
    }
    // 2) 所有 child → 指向 parent（多代家庭嘅 head 保留自己 head 標記，唔覆蓋）
    for (const c of children) {
      if (headIds.has(c.child)) continue;
      await run("UPDATE users SET family_head_id=? WHERE id=?", [c.parent, c.child]);
    }
    // 3) 清走「無任何 link 但 family_head_id 非 NULL」嘅孤兒（歷史遺留）
    const orphans = await all(
      `SELECT id FROM users WHERE family_head_id IS NOT NULL
       AND id NOT IN (SELECT parent_user_id FROM family_links)
       AND id NOT IN (SELECT child_user_id FROM family_links)`
    );
    for (const o of orphans) {
      await run("UPDATE users SET family_head_id=NULL WHERE id=?", [o.id]);
    }
    return { parents: parents.length, children: children.length, orphansCleared: orphans.length };
  };

  return { enableHead, addChild, removeChildLink, removeUserFromFamily, detachAllChildren, reconcile };
};
