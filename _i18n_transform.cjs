// 一次性 i18n 包裝腳本：將 index.html 嘅靜態中文字串包成 {{ t('...') }}
// 用法：node _i18n_transform.cjs
// 產出：index.html（已包裝）+ js/i18n.js（window.I18N_EN 字典，value=null 待填英文）
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const HTML = path.join(ROOT, 'index.html');
const OUT_JS = path.join(ROOT, 'js', 'i18n.js');

let html = fs.readFileSync(HTML, 'utf8');

// 1) 保護 <script> / <style> 唔俾 regex 碰（用 printable sentinel）
const protectedBlks = [];
const blocker = (m) => { protectedBlks.push(m); return `%%BLOCK_${protectedBlks.length - 1}%%`; };
html = html.replace(/<script\b[\s\S]*?<\/script>/gi, blocker);
html = html.replace(/<style\b[\s\S]*?<\/style>/gi, blocker);

const hasCJK = (s) => /[一-鿿]/.test(s);
const needsSkip = (s) =>
  s.includes('{{') || s.includes('<') || s.includes('"') ||
  (s.includes(':') && /[一-鿿]/.test(s)) || (s.includes('=') && /[一-鿿]/.test(s)) ||
  s.includes('v-') || s.includes('@');

// 2) 包裝文字節點： > (空白) 內容 (空白) <
const txtRe = />(\s*)([^<]*[一-鿿][^<]*)(\s*)</g;
const keys = new Map();
let html2 = html.replace(txtRe, (m, pre, content, post) => {
  if (needsSkip(content)) return m;
  const key = content.trim();
  if (!hasCJK(key)) return m;
  if (key.length > 200) return m;
  keys.set(key, (keys.get(key) || 0) + 1);
  const esc = key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `>${pre}{{ t('${esc}') }}${post}<`;
});

// 3) 包裝 CJK 屬性：title / placeholder / aria-label / alt / content / label
const attrRe = /(\s)(title|placeholder|aria-label|alt|content|label)="([^"]*[一-鿿][^"]*)"/g;
html2 = html2.replace(attrRe, (m, sp, attr, val) => {
  if (val.includes('{{')) return m;
  if (val.includes(':') && /[一-鿿]/.test(val)) return m;
  const key = val.trim();
  if (!hasCJK(key)) return m;
  keys.set(key, (keys.get(key) || 0) + 1);
  const esc = key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `${sp}:${attr}="t('${esc}')"`;
});

// 4) 還原保護區塊
html2 = html2.replace(/%%BLOCK_(\d+)%%/g, (m, i) => protectedBlks[Number(i)]);

fs.writeFileSync(HTML, html2, 'utf8');

// 5) 產出 i18n.js（en value = null，待填；zh-TW 用 key fallback）
const dict = [...keys.keys()].sort();
const lines = dict.map((k) => {
  const esc = k.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `  '${esc}': null,`;
});
const js = `// 多語言字典 — 英文翻譯（key = 中文原文，zh-TW 直接用 key fallback）
// 用法：window.I18N_EN[key] 返英文；value=null 表示未譯（顯示中文）
window.I18N_EN = {
${lines.join('\n')}
};
`;
fs.writeFileSync(OUT_JS, js, 'utf8');

console.log(`✅ 包裝完成：唯一中文字串 ${dict.length} 條`);
console.log(`   index.html 已更新，js/i18n.js 已生成（${dict.length} keys，待填英文）`);
