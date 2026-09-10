// _i18n_portal.cjs — 將某個 portal 嘅靜態中文字串包成 {{ t('...') }} / :attr="t('...')"
// 唔會覆寫 js/i18n.js 已有翻譯：只將「新 key」以 value=null 追加落去。
// 用法：node _i18n_portal.cjs <portal.html>
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const HTML = path.resolve(ROOT, process.argv[2]);
const DICT = path.join(ROOT, 'js', 'i18n.js');

// 載入現有字典（避免重複 append）
function loadDict() {
  const code = fs.readFileSync(DICT, 'utf8');
  const sandbox = { window: {} };
  // 安全 eval：純物件字面，冇副作用
  const fn = new Function('window', code + '\nreturn window.I18N_EN;');
  return fn(sandbox.window) || {};
}
const existing = loadDict();

let html = fs.readFileSync(HTML, 'utf8');

// 1) 保護 <script> / <style> / <!-- 註解 -->
//    重要：唔保護 HTML 註解會出事。註解入面如果有 `>` 跟住 CJK（例：<!-- 醫師 > 病人 說明 -->），
//    文字包裝 regex `>([^<]*CJK[^<]*)<` 會由個 `>` 開始 match，食到 `-->` 甚至下一個 tag，
//    搞到註解冇閂返，成個 template 被當註解食咗（#app 變空）。所以必先保護註解。
const protectedBlks = [];
const blocker = (m) => { protectedBlks.push(m); return `%%BLOCK_${protectedBlks.length - 1}%%`; };
html = html.replace(/<script\b[\s\S]*?<\/script>/gi, blocker);
html = html.replace(/<style\b[\s\S]*?<\/style>/gi, blocker);
html = html.replace(/<!--[\s\S]*?-->/g, blocker);

const hasCJK = (s) => /[一-鿿]/.test(s);
// HTML 字符參照（&amp; &lt; &#10; 等）。transform 處理嘅係 RAW HTML，
// 參照仲係字面 5 字元（例如 &#10;），所以 transform 階段睇唔到真正嘅換行/引號。
// 瀏覽器 decode 後會變成真正換行/引號，搞到生成嘅 t('...') 字面量爛掉
// （典型：placeholder="例如：&#10;房" → t('例如：\n房') → Invalid or unexpected token）。
// 所以凡 value 含完整字符參照就 skip，唔包裝。
const hasEntity = (s) => /&(?:[a-zA-Z][a-zA-Z0-9]*|#[0-9]+|#x[0-9A-Fa-f]+);/.test(s);
const needsSkip = (s) =>
  s.includes('{{') || s.includes('<') || s.includes('"') ||
  (s.includes(':') && /[一-鿿]/.test(s)) || (s.includes('=') && /[一-鿿]/.test(s)) ||
  s.includes('v-') || s.includes('@') || hasEntity(s);

const keys = new Set();

// 2) 包裝文字節點
const txtRe = />(\s*)([^<]*[一-鿿][^<]*)(\s*)</g;
let html2 = html.replace(txtRe, (m, pre, content, post) => {
  if (needsSkip(content)) return m;
  const key = content.trim();
  if (!hasCJK(key)) return m;
  if (key.length > 200) return m;
  if (/[\n\r]/.test(key)) return m; // 跳過多行字串，避免換行破壞字串字面量
  keys.add(key);
  const esc = key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `>${pre}{{ t('${esc}') }}${post}<`;
});

// 3) 包裝 CJK 屬性
const attrRe = /(\s)(title|placeholder|aria-label|alt|content|label)="([^"]*[一-鿿][^"]*)"/g;
html2 = html2.replace(attrRe, (m, sp, attr, val) => {
  if (val.includes('{{')) return m;
  if (hasEntity(val)) return m; // 含字符參照（&#10; 等）唔包裝，避免 decode 後爛字面量
  if (val.includes(':') && /[一-鿿]/.test(val)) return m;
  const key = val.trim();
  if (!hasCJK(key)) return m;
  if (/[\n\r]/.test(key)) return m; // 跳過多行屬性值
  keys.add(key);
  const esc = key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `${sp}:${attr}="t('${esc}')"`;
});

// 4) 還原保護區塊
html2 = html2.replace(/%%BLOCK_(\d+)%%/g, (m, i) => protectedBlks[Number(i)]);

// 5) 寫回 portal
fs.writeFileSync(HTML, html2, 'utf8');

// 6) 只將新 key（唔喺 existing）以 null 追加落 js/i18n.js
const newKeys = [...keys].filter((k) => !(k in existing));
if (newKeys.length) {
  const dictCode = fs.readFileSync(DICT, 'utf8');
  const lines = newKeys.sort().map((k) => {
    const esc = k.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `  '${esc}': null,`;
  });
  // 喺最後一個 `};` 前插入
  const idx = dictCode.lastIndexOf('};');
  if (idx >= 0) {
    const updated = dictCode.slice(0, idx) + lines.join('\n') + '\n' + dictCode.slice(idx);
    fs.writeFileSync(DICT, updated, 'utf8');
  }
}

console.log(`✅ ${path.basename(HTML)} 包裝完成：包咗 ${keys.size} 個字串，新增 ${newKeys.length} 個 key 落 i18n.js`);
