// config/memberno.js
// 會員編號 / 員工編號 生成工具（2026-09-30 v2）
// 改用成個電話號碼（香港 8 位），解決舊制「尾 4 位」會撞號嘅問題。
//   - 會員編號：JR（一般）/ S+方案字母（家庭主）/ M+方案字母（家庭子） + 8 位電話
//   - 員工編號：J + 8 位電話（取代舊 ST + 4 位序號）
// 呢啲係純函數，唔掂 DB；撞號 de-dup 由 resolveUnique() 配合各 route 嘅 DB 查詢做。

function digitsOf(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function planLetterOf(p) {
  return ['A', 'B', 'C', 'D'].includes(p) ? p : 'A';
}

// 取電話尾 len 位；短過 len 就用晒再補 0（極少情況，通常靠 de-dup 解決）
function phoneTail(phone, len = 8) {
  const d = digitsOf(phone);
  if (d.length >= len) return d.slice(-len);
  return d.padEnd(len, '0');
}

// 會員編號：prefix 已含 S/M/JR 前綴，呢度只加電話尾綴
function buildMemberNo(prefix, phone) {
  return prefix + phoneTail(phone);
}

// 員工編號：J + 8 位電話；無電話用 id 兜底（保證唯一，避免全部變 J00000000 撞號）
function buildStaffNo(phone, id) {
  const d = digitsOf(phone);
  if (d.length >= 8) return 'J' + d.slice(-8);
  if (d.length > 0) return 'J' + d.padEnd(8, '0');
  return 'J' + String(id == null ? '' : id).padStart(4, '0');
}

// 撞號 de-dup：existsFn(candidate) 返回 Promise<boolean>（存在=true）；
// 撞就加 -2 / -3 ... 尾綴，直到搵到無人用為止。
async function resolveUnique(existsFn, base) {
  let cand = base;
  let n = 2;
  while (await existsFn(cand)) {
    cand = base + '-' + n;
    n++;
  }
  return cand;
}

module.exports = {
  digitsOf,
  planLetterOf,
  phoneTail,
  buildMemberNo,
  buildStaffNo,
  resolveUnique,
};
