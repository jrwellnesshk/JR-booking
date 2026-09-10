// _i18n_sync.cjs — 掃描 4 個 portal 所有 t('...') key，補齊 js/i18n.js 字典並套用翻譯
// 解決：template 有 t('密碼') 但 dict 冇呢個 key（fallback 中文）嘅問題。
// 安全設計：保留所有現有 key（含 null），淨係補齊模板用到的、且 key 含 CJK 嘅項。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const DICT = path.join(ROOT, 'js', 'i18n.js');
const PORTALS = ['admin.html', 'staff.html', 'doctor.html', 'hr.html'];
const hasCJK = (s) => /[一-鿿]/.test(s);

// 載入現有字典
const code = fs.readFileSync(DICT, 'utf8');
const sandbox = { window: {} };
const existing = new Function('window', code + '\nreturn window.I18N_EN;')(sandbox.window) || {};

// 掃描所有 portal 嘅 t('...') key（靜態字串字面量）
const keyRe = /t\('((?:[^'\\]|\\.)*)'\)/g;
const found = new Set();
for (const f of PORTALS) {
  const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
  let m;
  while ((m = keyRe.exec(html))) {
    const k = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    if (k && hasCJK(k)) found.add(k); // 只收含 CJK 嘅，過濾 - / : / , / a / #app 等 false-positive
  }
}
console.log('templates 搵到', found.size, '個含 CJK 嘅 t() key');

// 載入翻譯表
const MAP = require('./_i18n_translate.cjs').MAP;

// 合併策略：保留 all existing（含 null），再補齊 found 中未譯且 MAP 有嘅項
const merged = Object.assign({}, existing); // 1. 保留全部現有（譯咗 + null）
let translated = 0, added = 0;
for (const k of found) {
  if (merged[k] == null && MAP[k] != null) { merged[k] = MAP[k]; translated++; }
  else if (!(k in merged)) { merged[k] = null; added++; }
}
// 2. 加返 MAP 中有但 template 冇用到嘅（確保翻譯唔會遺失）
for (const k of Object.keys(MAP)) {
  if (!(k in merged)) { merged[k] = MAP[k]; }
}

// 3. 深層 UI 翻譯：填補所有仍為 null 嘅 key（Part 1 範圍擴展：一次過補曬 652 個）
const DEEP = require('./_i18n_deep.cjs');
let deepFilled = 0;
const deepKeys = new Set();
for (const [k, en] of DEEP) {
  if (deepKeys.has(k)) continue; // 跳過重複
  deepKeys.add(k);
  if (merged[k] == null && en) { merged[k] = en; deepFilled++; }
  else if (!(k in merged) && en) { merged[k] = en; deepFilled++; }
}

// 寫回（保留原本 window.I18N_EN = 頭；用 ' = ' 避免命中 line 2 註解）
const idx = code.indexOf('window.I18N_EN =');
const header = idx >= 0 ? code.slice(0, idx) : '';
const keys = Object.keys(merged).sort();
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const body = keys.map(k => `  '${esc(k)}': ${merged[k] == null ? 'null' : `'${esc(merged[k])}'`},`).join('\n');
const out = `${header}window.I18N_EN = {\n${body}\n};\n`;
fs.writeFileSync(DICT, out, 'utf8');
console.log(`✅ 字典同步完成：總 key ${keys.length}（原 ${Object.keys(existing).length}），本輪新譯 ${translated}，新增 fallback null ${added}，深層補譯 ${deepFilled}`);
