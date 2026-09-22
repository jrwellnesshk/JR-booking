/* js/session-guard.js — #20：登入後「瀏覽器上一頁」行為 + 「返回官網」掣
 *
 * 純 vanilla，唔依賴 Vue；必須喺 Vue / i18n / portal app script **之前** 載入。
 *
 * 設計（業主 2026-09-17 確認）：
 *  1. 瀏覽器「上一頁／下一頁」**永遠唔會登出** —— session 放喺 localStorage，
 *     只有明確撳「登出」掣先會清。本檔唔會喺 unload / popstate / pageshow 清除任何 token。
 *  2. 防「登出後撳上一頁，由 bfcache 還原出已登入畫面」：
 *     handleLogout 會呼叫 window.markLoggedOut() 喺 sessionStorage 記低時間戳；
 *     之後 60 秒內若頁面由 bfcache 還原（pageshow persisted），就 reload 一次，
 *     等門戶重新行 auth check，彈返登入頁而唔會見到舊資料。
 *     （60 秒後標記自動失效，所以重新登入後唔會再有副作用，唔使額外清 flag）
 *  3. 提供 window.goToSite()：去官網 index.html，**保留 session**（唔清任何 token），
 *     畀各門戶嘅「返回官網」掣用。
 *  4. 注入 .btn-site-back 樣式：css/tailwind.css 係預建檔，
 *     動態加嘅 Tailwind class 唔會被掃描生成，所以統一由本檔注入。
 */
(function () {
  if (typeof window === 'undefined' || window.__sessionGuardInstalled) return;
  window.__sessionGuardInstalled = true;

  var LOGOUT_FLAG = '__sgLoggedOutAt';
  var LOGOUT_TTL = 60 * 1000; // 60 秒內嘅 bfcache 還原先會 reload
  var BYPASS_FLAG = '__sgToSite'; // 「由後台主動去官網」→ 客人端角色閘門要放行一次

  // ---- 樣式注入（預建 Tailwind 唔會生成新 class） ----
  try {
    var css =
      '.btn-site-back{display:flex;align-items:center;gap:.45rem;width:100%;' +
      'padding:.5rem .75rem;border:none;cursor:pointer;border-radius:.5rem;' +
      'font-size:.85rem;font-weight:500;line-height:1.3;color:#fff;' +
      'background:#4b5563;transition:background .2s ease;-webkit-appearance:none;}' +
      '.btn-site-back:hover{background:#374151;}' +
      '.btn-site-back i{flex:none;}';
    var st = document.createElement('style');
    st.setAttribute('data-session-guard', '1');
    st.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(st);
  } catch (e) {}

  // ---- 登出標記（由各門戶 handleLogout 呼叫） ----
  window.markLoggedOut = function () {
    try { sessionStorage.setItem(LOGOUT_FLAG, String(Date.now())); } catch (e) {}
  };

  // ---- bfcache 還原保護 ----
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return; // 只處理倒退快取還原
    var ts = 0;
    try { ts = parseInt(sessionStorage.getItem(LOGOUT_FLAG) || '0', 10) || 0; } catch (err) {}
    if (!ts) return;
    try { sessionStorage.removeItem(LOGOUT_FLAG); } catch (err) {}
    if (Date.now() - ts < LOGOUT_TTL) window.location.reload();
  });

  // ---- 明確「返回官網」：保留 session ----
  window.goToSite = function () {
    try {
      sessionStorage.removeItem(LOGOUT_FLAG);
      // 客人端（js/app.js）有角色閘門：見到 adminUser/doctorUser/staffUser 會即時彈返後台。
      // 由後台主動「返回官網」時要放行一次，否則會彈返轉頭。
      sessionStorage.setItem(BYPASS_FLAG, '1');
    } catch (e) {}
    window.location.href = 'index.html';
  };
})();
