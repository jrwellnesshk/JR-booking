#!/usr/bin/env node
/*
 * 模板結構守門（Template Balance Gate）
 * ---------------------------------------------------------------
 * 目的：防止 in-DOM Vue 模板（五個 portal HTML）出現「盒未閉合」嘅結構甩漏，
 *       呢類甩漏會令後面嘅整個視圖被錯誤嵌套、切換時變空白（即 2026-09 撞過嘅
 *       admin 官網內容/中醫討論區/我的打卡考勤 三頁空白 bug）。
 *
 * 範圍：只查「結構層容器」標籤（一旦未閉合會吞掉兄弟視圖嗰類），
 *       唔查 <span>/<li>/<td>/<p> 等行內標籤，避免噪音同「狼來了」效應。
 *
 * 穩健性：
 *   - 用「字元位置 → 行號」對照表，唔會有行數漂移。
 *   - 掃描時將 {{ }}（Vue mustache）、&entity; 當作不透明文字跳過，
 *     避免 {{ x < y }} / &lt; 入面嘅 '<' 被誤當標籤。
 *   - <script>/<style>/<svg> 成段跳過（入面嘅 < > 當字面，唔驗）。
 *   - 只喺 '<' 後面係合法標籤名起手（[a-zA-Z/!?]）先當佢係標籤，
 *     咁 `數量 < 10` 呢類文字 '<' 唔會中招。
 *
 * 用法：
 *   node scripts/template-balance-gate.cjs            # 驗證五個 portal
 *   node scripts/template-balance-gate.cjs --selftest   # 自檢（證明守門有效）
 *   npm run gate:templates
 *
 * 退出碼：0 = 全部合格；1 = 有甩漏 / 唔平衡 / 讀檔失敗
 * ---------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORTALS = ['admin.html', 'staff.html', 'doctor.html', 'hr.html', 'index.html'];

// 只查呢啲結構層容器（白名單）。void / 行內標籤一律忽略。
const CONTAINER = new Set([
  'div', 'section', 'main', 'header', 'footer', 'nav', 'aside', 'article',
  'form', 'table', 'thead', 'tbody', 'tfoot', 'ul', 'ol', 'figure',
  'fieldset', 'details', 'dialog', 'template', 'body'
]);

// 結構內嘅 void 元素（永遠自閉合，唔入 stack）
const VOID = new Set([
  'br', 'img', 'input', 'hr', 'meta', 'link', 'area', 'base', 'col', 'embed',
  'source', 'track', 'wbr', 'param'
]);

// 預建 字元位置 → 行號 對照表（1-based）
function buildLineStarts(src) {
  const arr = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') arr.push(i + 1);
  return arr;
}
function lineOf(lineStarts, offset) {
  let lo = 0, hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

// quote-aware 搵 tag 結尾 '>'（屬性值入面嘅 > 唔計）
function scanTagEnd(src, start) {
  let i = start;
  let q = null;
  while (i < src.length) {
    const c = src[i];
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") {
      q = c;
    } else if (c === '>') {
      return i;
    }
    i++;
  }
  return -1;
}

// 喺文字區搵下一個「真嘅」標籤起手 '<'：
//   跳過 {{ }} mustache、&entity;、同文字入面嘅 '<'（如 `數量 < 10`）
function nextTagStart(src, from) {
  const n = src.length;
  let i = from;
  while (i < n) {
    const c = src[i];
    if (c === '{' && src[i + 1] === '{') {
      const close = src.indexOf('}}', i + 2);
      i = close === -1 ? n : close + 2;
      continue;
    }
    if (c === '&' && /[a-zA-Z#]/.test(src[i + 1] || '')) {
      const close = src.indexOf(';', i + 1);
      i = close === -1 ? n : close + 1;
      continue;
    }
    if (c === '<') {
      const nc = src[i + 1];
      if (nc === undefined) { i = n; break; }
      if (/[a-zA-Z/!?]/.test(nc)) return i; // 合法標籤起手
      i++; // 文字入面嘅 '<'（如 `< 10`），跳過
      continue;
    }
    i++;
  }
  return -1;
}

function validateString(src) {
  const lineStarts = buildLineStarts(src);
  const issues = [];
  const stack = []; // {tag, offset}
  let idx = 0;
  const n = src.length;

  while (idx < n) {
    const lt = nextTagStart(src, idx);
    if (lt === -1) break;
    idx = lt;

    // 註解 <!-- -->
    if (src.startsWith('<!--', idx)) {
      const end = src.indexOf('-->', idx + 4);
      idx = end === -1 ? n : end + 3;
      continue;
    }
    // <!DOCTYPE> / <?xml?>
    if (src.startsWith('<!', idx) || src.startsWith('<?', idx)) {
      const end = src.indexOf('>', idx);
      idx = end === -1 ? n : end + 1;
      continue;
    }
    // 跳過 script / style / svg 成段
    const tagMatch = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(src.slice(idx));
    if (tagMatch) {
      const name = tagMatch[1].toLowerCase();
      if (name === 'script' || name === 'style' || name === 'svg') {
        const closeRe = new RegExp('</' + name + '\\s*>', 'i');
        const m = closeRe.exec(src.slice(idx));
        idx = m ? idx + m.index + m[0].length : n;
        continue;
      }
    }
    // 普通 tag
    const gt = scanTagEnd(src, idx + 1);
    if (gt === -1) {
      issues.push({ offset: idx, type: 'unterminated-tag', tag: tagMatch && tagMatch[1] });
      break;
    }
    const raw = src.slice(idx + 1, gt);
    idx = gt + 1;

    const selfClose = raw.endsWith('/');
    const isClose = raw.startsWith('/');
    const nm = (isClose ? raw.slice(1) : raw).replace(/\s*\/$/, '').match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
    if (!nm) continue;
    const tname = nm[1].toLowerCase();

    if (!CONTAINER.has(tname)) continue; // 只理結構層容器

    if (isClose) {
      const top = stack[stack.length - 1];
      if (top && top.tag === tname) {
        stack.pop();
      } else {
        const pos = stack.findIndex(s => s.tag === tname);
        if (pos !== -1) {
          const unclosed = stack.splice(pos);
          issues.push({
            offset: idx, type: 'mismatch-close', tag: tname,
            swallowed: unclosed.map(u => u.tag + '@L' + lineOf(lineStarts, u.offset))
          });
          stack.pop();
        } else {
          issues.push({ offset: idx, type: 'stray-close', tag: tname });
        }
      }
    } else if (selfClose || VOID.has(tname)) {
      // 自閉合 / void，唔入 stack
    } else {
      stack.push({ tag: tname, offset: idx });
    }
  }

  for (const s of stack) {
    issues.push({ offset: s.offset, type: 'unclosed', tag: s.tag });
  }
  for (const it of issues) it.line = lineOf(lineStarts, it.offset);
  return issues;
}

function validateFile(file) {
  const full = path.join(ROOT, file);
  let src;
  try {
    src = fs.readFileSync(full, 'utf8');
  } catch (e) {
    return { file, error: e.message, issues: [{ line: 0, type: 'read-error' }] };
  }
  return { file, error: null, issues: validateString(src) };
}

function runSelfTest() {
  const good = '<div><section><main>hi</main></section></div>';
  const bad1 = '<div><section>oops</div>';          // section 未閉合（mismatch）
  const bad2 = '<div><div>no close';                 // div 未閉合（unclosed @ EOF）
  const mustache = '<div>{{ x < y }}</div><ul><li>a</li></ul>'; // mustache 入面 '<' 唔應中招，且結構平衡
  const r1 = validateString(good);
  const r2 = validateString(bad1);
  const r3 = validateString(bad2);
  const r4 = validateString(mustache);
  const ok = r1.length === 0 && r2.length > 0 && r3.length > 0 && r4.length === 0;
  console.log('[selftest] 合格樣本      issues =', r1.length, '(期望 0)');
  console.log('[selftest] 錯配樣本      issues =', r2.length, '(期望 >0)', JSON.stringify(r2));
  console.log('[selftest] 未閉合樣本    issues =', r3.length, '(期望 >0)', JSON.stringify(r3));
  console.log('[selftest] mustache樣本  issues =', r4.length, '(期望 0 — {{ x < y }} 唔中招)');
  console.log(ok ? '[selftest] PASS — 守門有效' : '[selftest] FAIL — 守門失效');
  return ok ? 0 : 1;
}

function main() {
  if (process.argv.includes('--selftest')) {
    process.exit(runSelfTest());
  }
  let failed = 0;
  console.log('=== 模板結構守門 (Template Balance Gate) ===');
  for (const f of PORTALS) {
    const r = validateFile(f);
    if (r.error) {
      console.log(`✗ ${f}  — 讀檔失敗: ${r.error}`);
      failed++;
      continue;
    }
    if (r.issues.length === 0) {
      console.log(`✓ ${f}  — 結構平衡`);
    } else {
      failed++;
      console.log(`✗ ${f}  — ${r.issues.length} 項甩漏:`);
      for (const it of r.issues) {
        const extra = it.swallowed ? ' (中間未閉合: ' + it.swallowed.join(', ') + ')' : '';
        console.log(`    L${it.line}  ${it.type}  <${it.tag || ''}>${extra}`);
      }
    }
  }
  console.log('=============================================');
  if (failed === 0) {
    console.log('全部合格 ✓  可以出冊');
    process.exit(0);
  } else {
    console.log(`${failed} 個檔案有問題 ✗  禁止出冊，請修好上面甩漏`);
    process.exit(1);
  }
}

main();
