/**
 * clinicSettings.js — 集中讀取 clinic_settings（診所電話 / WhatsApp / 電郵等）
 *
 * 用途：解決「後台改咗號碼，官網/電郵/通知冇同步」嘅根因。
 * 所有輸出端（官網、電郵、WhatsApp、排程通知）都要經呢度讀取，
 * 唔好再硬碼 2555-1136 / 91350162 等數字。
 *
 * 使用方式：
 *   1) server.js 啟動時：clinicSettings.setDb(db); clinicSettings.loadCache();
 *   2) 各服務同步讀取：clinicSettings.getClinicPhone() / getWhatsappUrl() ...
 *   3) 後台改完 social 設定：clinicSettings.invalidate()（快取 60s 內自動過期，亦可以手動清）
 */

let _db = null;
let _cache = null;
let _expiry = 0;
const TTL = 60 * 1000; // 60 秒

const DEFAULTS = {
  clinic_phone: '2555-1136',
  social_whatsapp: '85291350162', // 純數字（含 852 區號），前端動態組 wa.me 連結
  clinic_email: 'admin@jrwellnesshk.com'
};

function setDb(db) { _db = db; }

function loadCache() {
  return new Promise((resolve) => {
    if (!_db) return resolve(null);
    _db.all('SELECT setting_key, setting_value FROM clinic_settings', [], (err, rows) => {
      if (err) { console.error('clinicSettings.loadCache 失敗:', err.message); return resolve(null); }
      const m = {};
      (rows || []).forEach(r => { m[r.setting_key] = r.setting_value; });
      _cache = m;
      _expiry = Date.now() + TTL;
      resolve(m);
    });
  });
}

// 同步取快取（冇就 fallback default）；首次或過期後由 loadCache 異步刷新
function get() {
  if (_cache && Date.now() < _expiry) return _cache;
  // 觸發背景刷新（唔阻塞）
  if (_db) loadCache();
  return _cache || {};
}

function invalidate() { _cache = null; _expiry = 0; }

function getClinicPhone() {
  const m = get();
  const v = m.clinic_phone;
  if (v && v !== '00000000') return v;
  return DEFAULTS.clinic_phone;
}

// 取 WhatsApp 純數字（永遠含 852 區號）
function getWhatsappDigits() {
  let w = (get().social_whatsapp || DEFAULTS.social_whatsapp);
  w = String(w).replace(/[^0-9]/g, '');
  if (!w.startsWith('852')) w = '852' + w;
  return w;
}

// 完整 wa.me 連結（前端浮動按鈕 / WhatsApp 圖標用）
function getWhatsappUrl() {
  return 'https://wa.me/' + getWhatsappDigits();
}

function getClinicEmail() {
  const m = get();
  return m.clinic_email || DEFAULTS.clinic_email;
}

module.exports = {
  setDb, loadCache, get, invalidate,
  getClinicPhone, getWhatsappDigits, getWhatsappUrl, getClinicEmail,
  DEFAULTS
};
