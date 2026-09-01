/**
 * 認證 fetch 包裝器
 * 自動為所有 API 請求加上 JWT Bearer header（讀取 window.__AUTH_TOKEN_KEY 指定的 localStorage 鍵）
 * 需在 app.js / 內嵌 script 之前載入
 */
(function () {
  if (window.__authFetchInstalled) return;
  window.__authFetchInstalled = true;

  const getToken = function () {
    var key = window.__AUTH_TOKEN_KEY || 'jwtToken';
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  };

  var originalFetch = window.fetch;

  window.fetch = function (input, init) {
    init = init || {};
    init.headers = init.headers || {};

    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = (init.method || (input && input.method) || 'GET').toUpperCase();
    // 登入/註冊/驗證碼等公開端點不需 token（但登出需要，故排除）
    // 注意：/api/doctors、/api/time-slots 僅「查詢（GET）」屬公開；寫入（POST/PUT/DELETE）必須帶 token，
    // 否則管理員後台嘅醫師管理／時段儲存會因缺少 Authorization 而靜默 401
    var isPublic = /\/api\/auth\/(login|register|captcha|send-reset-code|reset-password-with-code)|\/api\/login|\/api\/register|\/api\/captcha|\/register\/check|\/api\/find-user-id|\/api\/send-reset-code|\/api\/server-time|\/api\/time-slots|\/api\/timeslots|\/api\/services|\/api\/doctors|\/api\/faqs|\/api\/chat|\/api\/holidays|\/api\/weather|\/api\/triage\/questions|\/api\/triage\/doctors|\/api\/notifications\/solar-terms\/upcoming|\/api\/notifications\/holidays\/upcoming|\/api\/ai\//.test(url);
    if (method !== 'GET' && /\/api\/(doctors|time-slots|timeslots)/.test(url)) {
      isPublic = false;
    }

    var token = getToken();
    if (token && !isPublic) {
      // 若 headers 已是 Headers 物件，用 set 加入
      if (typeof Headers !== 'undefined' && init.headers instanceof Headers) {
        if (!init.headers.has('Authorization')) {
          init.headers.set('Authorization', 'Bearer ' + token);
        }
      } else {
        if (!init.headers.Authorization) {
          init.headers.Authorization = 'Bearer ' + token;
        }
      }
    }

    return originalFetch(input, init);
  };
})();
