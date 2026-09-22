// js/i18n-runtime.js — 共享多語言 runtime（繁中 + 英文 + 簡體）
// 載入順序：Vue（CDN 或 vendor）→ js/i18n.js（window.I18N_EN 字典）→ 本檔 → portal app script
// 本檔 monkeypatch Vue.createApp，自動將 t / lang / setLang / currentLang 注入為
// globalProperties，所以所有 portal（admin / staff / doctor / hr）嘅模板都可以直接用：
//   {{ t('中文') }}  ·  lang.value（'zh-TW' | 'en' | 'zh-CN'）  ·  setLang('en')  ·  currentLang()
// 語言跟 login session：用 localStorage 'lang' 儲，唔改 DB。
// #8：新增簡體（zh-CN）。繁→簡用 opencc-js（js/vendor/opencc-t2cn.js，109KB）做準確嘅詞組級轉換，
//     只喺用戶切去簡體時先 lazily load，繁中／英文用戶零額外流量。
(function () {
  if (typeof window === 'undefined' || typeof Vue === 'undefined') return;

  var I18N_EN = window.I18N_EN || {};
  var SUPPORTED = ['zh-TW', 'en', 'zh-CN'];
  var LS_KEY = 'lang';

  function detect() {
    var l = (typeof localStorage !== 'undefined') ? localStorage.getItem(LS_KEY) : null;
    if (!l || SUPPORTED.indexOf(l) < 0) l = 'zh-TW';
    return l;
  }

  // 全局 reactive lang（所有 portal 共用，確保 toggle 即時重渲）
  var langRef = Vue.ref(detect());

  function applyDom(l) {
    try {
      document.body.classList.toggle('lang-en', l === 'en');
      document.body.classList.toggle('lang-zh', l !== 'en');
      document.documentElement.lang = (l === 'en') ? 'en' : (l === 'zh-CN' ? 'zh-CN' : 'zh-TW');
    } catch (e) {}
  }

  // 🩹 更新 Vue mount（#app）*以外* 嘅元素：<title> 同 boot splash。
  // 呢啲 DOM 唔會被 Vue compile，所以唔可以用 {{ t('…') }}（會淨低字面 braces/quotes）；
  // 改用 data-i18n="<中文 key>" + 呢個 updater，先至可以跟語言切換。
  function applyOutOfApp() {
    if (typeof document === 'undefined') return;
    try {
      var els = document.querySelectorAll('[data-i18n]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var key = el.getAttribute('data-i18n');
        if (key) el.textContent = t(key);
      }
    } catch (e) {}
  }

  applyDom(langRef.value);
  applyOutOfApp();
  // #8：記住咗簡體嘅話，開頁就要預先載入轉換器
  if (langRef.value === 'zh-CN') { loadT2S().catch(function () {}); }
  // body 可能尚未解析（script 喺 head），body ready 後再補一次 class
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      applyDom(langRef.value);
      applyOutOfApp();
    });
  }

  // ── #8 繁→簡轉換器（lazily load opencc-js）──────────────────────────────
  // 用 ref 包住版本號：t() 入面讀 convTick.value，轉換器載入完 ++ 就會觸發全站重渲。
  var convTick = Vue.ref(0);
  var t2s = null;          // 載入完成後嘅轉換函式
  var t2sLoading = null;   // 進行中嘅 Promise
  var t2sCache = Object.create(null);

  function loadT2S() {
    if (t2s) return Promise.resolve(t2s);
    if (t2sLoading) return t2sLoading;
    t2sLoading = new Promise(function (resolve, reject) {
      try {
        if (window.OpenCC && window.OpenCC.ConverterFactory) return build(null);
        var s = document.createElement('script');
        s.src = 'js/vendor/opencc-t2cn.js';
        s.async = true;
        s.onload = function () { build(null); };
        s.onerror = function () { t2sLoading = null; reject(new Error('opencc load failed')); };
        document.head.appendChild(s);
      } catch (e) { t2sLoading = null; reject(e); }

      function build() {
        try {
          var O = window.OpenCC;
          // opencc-js 1.4 嘅 locale key 係 from.tw（唔係 from.t），to.cn
          var from = (O.Locale.from && (O.Locale.from.tw || O.Locale.from.t));
          var to = (O.Locale.to && O.Locale.to.cn);
          if (!from || !to) throw new Error('opencc locale missing');
          var conv = O.ConverterFactory(from, to);
          t2s = function (s) { return conv(s); };
          convTick.value++;
          resolve(t2s);
        } catch (e) { t2sLoading = null; reject(e); }
      }
    });
    return t2sLoading;
  }

  // 繁→簡（含快取；轉換器未 ready 時原樣返回，ready 後靠 convTick 重渲）
  function toSimplified(key) {
    if (!t2s) return key;
    if (t2sCache[key] !== undefined) return t2sCache[key];
    var v;
    try { v = t2s(key); } catch (e) { v = key; }
    t2sCache[key] = v;
    return v;
  }

  // 翻譯函數：
  //  · en    → 查 I18N_EN 字典，冇譯→fallback 中文
  //  · zh-CN → 中文再經 opencc 轉簡體
  //  · zh-TW → 中文原文
  // 讀 convTick.value 係為咗建立響應式依賴（轉換器載入完會自動重渲）。
  function t(key) {
    if (key == null) return key;
    if (typeof key !== 'string') return key;
    var tick = convTick.value; // eslint-disable-line no-unused-vars
    var out = key;
    if (langRef.value === 'en') {
      if (I18N_EN[key] != null) out = I18N_EN[key];
    } else if (langRef.value === 'zh-CN') {
      out = toSimplified(key);
    }
    if (out.indexOf('nav.') === 0) out = out.slice(4);
    return out;
  }

  function setLang(l) {
    if (SUPPORTED.indexOf(l) < 0) l = 'zh-TW';
    if (l === 'zh-CN' && !t2s) {
      // 先載入轉換器，載完先切（避免畫面出現未轉換嘅繁體字）
      loadT2S().then(function () {
        if (langRef.value !== l) { langRef.value = l; }
        try { localStorage.setItem(LS_KEY, l); } catch (e) {}
        applyDom(l);
        applyOutOfApp();
      }).catch(function () {
        // 載入失敗都照切，最壞情況顯示繁體（唔好 block 用戶）
        langRef.value = l; applyDom(l); applyOutOfApp();
      });
      return;
    }
    if (langRef.value === l) return;
    langRef.value = l;
    try { localStorage.setItem(LS_KEY, l); } catch (e) {}
    applyDom(l);
    applyOutOfApp();
  }

  function currentLang() { return langRef.value; }

  // ── 本地化日期／星期輔助（畀各 portal 嘅 formatter 用）──────────────
  // 讀 langRef.value → 語言切換時 computed 會自動重算（響應式）。
  function i18nLocale() { return (langRef.value === 'en') ? 'en-US' : (langRef.value === 'zh-CN' ? 'zh-CN' : 'zh-TW'); }
  var WD_SHORT_ZH = ['日', '一', '二', '三', '四', '五', '六'];
  var WD_SHORT_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var WD_LONG_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  var WD_LONG_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function i18nWeekdays() { return (langRef.value === 'en') ? WD_SHORT_EN : WD_SHORT_ZH; }
  function i18nWeekdayShort(i) { return ((langRef.value === 'en') ? WD_SHORT_EN : WD_SHORT_ZH)[i] || ''; }
  function i18nWeekdayLong(i) { return ((langRef.value === 'en') ? WD_LONG_EN : WD_LONG_ZH)[i] || ''; }
  // 「2026 年 09 月」/「September 2026」式嘅月份標題
  function i18nMonthTitle(year, month) {
    if (langRef.value === 'en') {
      var m = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      return (m[month - 1] || month) + ' ' + year;
    }
    return year + ' 年 ' + String(month).padStart(2, '0') + ' 月';
  }

  // 伺服器回傳嘅中文狀態標籤 → 英譯（支援「快到期（N 日內）」動態樣式）
  function i18nServerLabel(text) {
    if (!text) return text;
    var v = t(text);
    if (v !== text) return v;                       // 字典命中
    var m = String(text).match(/^快到期（(\d+) 日內）$/);
    if (m) return (langRef.value === 'en') ? ('Expiring in ' + m[1] + ' days') : text;
    return text;
  }

  window.t = t;
  window.setLang = setLang;
  window.currentLang = currentLang;
  window.loadT2S = loadT2S;          // #8：畀 portal 預載繁→簡轉換器
  window.toSimplified = toSimplified; // #8：畀非模板（alert 等）手動轉簡體
  window.i18nLocale = i18nLocale;
  window.i18nWeekdays = i18nWeekdays;
  window.i18nWeekdayShort = i18nWeekdayShort;
  window.i18nWeekdayLong = i18nWeekdayLong;
  window.i18nMonthTitle = i18nMonthTitle;
  window.i18nServerLabel = i18nServerLabel;
  window.__i18nLang = langRef; // 畀想直接用 ref 嘅 portal
  window.__i18nConvTick = convTick; // #8：繁→簡轉換器載入完會 ++，觸發全站重渲

  // 自動注入 globalProperties 到每一個 createApp（包含 index.html，但 index.html setup 自有 t/lang 優先）
  var _createApp = Vue.createApp;
  Vue.createApp = function (opts) {
    var app = _createApp(opts);
    app.config.globalProperties.t = t;
    app.config.globalProperties.lang = langRef;
    app.config.globalProperties.setLang = setLang;
    app.config.globalProperties.currentLang = currentLang;
    app.config.globalProperties.i18nLocale = i18nLocale;
    app.config.globalProperties.i18nWeekdays = i18nWeekdays;
    app.config.globalProperties.i18nWeekdayShort = i18nWeekdayShort;
    app.config.globalProperties.i18nWeekdayLong = i18nWeekdayLong;
    // #20：「返回官網」——去 index.html 並保留 session（由 js/session-guard.js 提供）
    app.config.globalProperties.goToSite = function () {
      if (typeof window.goToSite === 'function') window.goToSite();
      else window.location.href = 'index.html';
    };
    app.config.globalProperties.i18nMonthTitle = i18nMonthTitle;
    app.config.globalProperties.i18nServerLabel = i18nServerLabel;
    return app;
  };
})();
