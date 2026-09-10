// js/i18n-runtime.js — 共享多語言 runtime（繁中 + 英文）
// 載入順序：Vue（CDN 或 vendor）→ js/i18n.js（window.I18N_EN 字典）→ 本檔 → portal app script
// 本檔 monkeypatch Vue.createApp，自動將 t / lang / setLang / currentLang 注入為
// globalProperties，所以所有 portal（admin / staff / doctor / hr）嘅模板都可以直接用：
//   {{ t('中文') }}  ·  lang.value（'zh-TW' | 'en'）  ·  setLang('en')  ·  currentLang()
// 語言跟 login session：用 localStorage 'lang' 儲，唔改 DB。英文版登入→成個 UI 英文，中文版→中文。
(function () {
  if (typeof window === 'undefined' || typeof Vue === 'undefined') return;

  var I18N_EN = window.I18N_EN || {};
  var SUPPORTED = ['zh-TW', 'en'];
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
      document.documentElement.lang = (l === 'en') ? 'en' : 'zh-TW';
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
  // body 可能尚未解析（script 喺 head），body ready 後再補一次 class
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      applyDom(langRef.value);
      applyOutOfApp();
    });
  }

  // 翻譯函數：英文查字典；冇譯→fallback 中文（nav. 去 namespace）
  function t(key) {
    if (key == null) return key;
    if (typeof key !== 'string') return key;
    if (langRef.value === 'en') {
      if (I18N_EN[key] != null) return I18N_EN[key];
      if (key.indexOf('nav.') === 0) return key.slice(4);
      return key;
    }
    if (key.indexOf('nav.') === 0) return key.slice(4);
    return key;
  }

  function setLang(l) {
    if (SUPPORTED.indexOf(l) < 0) l = 'zh-TW';
    if (langRef.value === l) return;
    langRef.value = l;
    try { localStorage.setItem(LS_KEY, l); } catch (e) {}
    applyDom(l);
    applyOutOfApp();
  }

  function currentLang() { return langRef.value; }

  window.t = t;
  window.setLang = setLang;
  window.currentLang = currentLang;
  window.__i18nLang = langRef; // 畀想直接用 ref 嘅 portal

  // 自動注入 globalProperties 到每一個 createApp（包含 index.html，但 index.html setup 自有 t/lang 優先）
  var _createApp = Vue.createApp;
  Vue.createApp = function (opts) {
    var app = _createApp(opts);
    app.config.globalProperties.t = t;
    app.config.globalProperties.lang = langRef;
    app.config.globalProperties.setLang = setLang;
    app.config.globalProperties.currentLang = currentLang;
    return app;
  };
})();
