const fs = require('fs');
const path = require('path');

// holidays.js - 香港公眾假期模組
// 優先使用香港政府 1823 官方公眾假期 JSON feed（每年由官方更新，公布咗就自動 update）
// 斷網 / 首次無 cache 時，fallback 返下方預計算（lunar 對照表）嘅計算法
//
// 官方來源（繁中）：https://www.1823.gov.hk/common/ical/tc.json
//   結構為 iCal-JSON：{ vcalendar:[{ vevent:[{ dtstart:["20250101",{value:"DATE"}], summary:"一月一日" }, ...] }] }
//   dtstart[0] = "YYYYMMDD"，summary = 假期中文名
const CACHE_PATH = path.join(__dirname, '..', 'data', 'holidays-cache.json');
const SOURCE_URL = 'https://www.1823.gov.hk/common/ical/tc.json';
const REFRESH_MS = 24 * 60 * 60 * 1000; // 每日自動刷新一次
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // cache 超過 7 日就當 stale

// 運行期 cache：{ fetchedAt, byYear: { "2026": [{date,name,name_en}] } }
let cache = { fetchedAt: 0, byYear: {} };
let refreshTimer = null;

/**
 * 香港公眾假期列表
 * 數據來源：香港政府公佈的公眾假期
 * 農曆假期使用預計算日期（每年需更新或使用農曆轉換庫）
 */

// 農曆新年日期對照表（西曆日期，農曆正月初一）
// 數據來源：香港天文台
const lunarNewYearDates = {
  2024: '2024-02-10',
  2025: '2025-01-29',
  2026: '2026-02-17',
  2027: '2027-02-06',
  2028: '2028-01-26',
  2029: '2029-02-13',
  2030: '2030-02-03',
  2031: '2031-01-23',
  2032: '2032-02-11',
  2033: '2033-01-31',
  2034: '2034-02-19',
  2035: '2035-02-08'
};

// 清明節日期對照表
const chingMingDates = {
  2024: '2024-04-04',
  2025: '2025-04-04',
  2026: '2026-04-05',
  2027: '2027-04-05',
  2028: '2028-04-04',
  2029: '2029-04-04',
  2030: '2030-04-05',
  2031: '2031-04-05',
  2032: '2032-04-04',
  2033: '2033-04-04',
  2034: '2034-04-05',
  2035: '2035-04-05'
};

// 端午節日期對照表（農曆五月初五）
const dragonBoatDates = {
  2024: '2024-06-10',
  2025: '2025-05-31',
  2026: '2026-06-19',
  2027: '2027-06-09',
  2028: '2028-05-28',
  2029: '2029-06-16',
  2030: '2030-06-05',
  2031: '2031-06-24',
  2032: '2032-06-12',
  2033: '2033-06-01',
  2034: '2034-06-20',
  2035: '2035-06-10'
};

// 中秋節翌日日期對照表（農曆八月十六）
const midAutumnDates = {
  2024: '2024-09-18',
  2025: '2025-10-07',
  2026: '2026-09-26',
  2027: '2027-09-16',
  2028: '2028-10-04',
  2029: '2029-09-23',
  2030: '2030-09-13',
  2031: '2031-10-02',
  2032: '2032-09-20',
  2033: '2033-09-09',
  2034: '2034-09-28',
  2035: '2035-09-17'
};

// 重陽節日期對照表（農曆九月初九）
const chungYeungDates = {
  2024: '2024-10-11',
  2025: '2025-10-29',
  2026: '2026-10-18',
  2027: '2027-10-08',
  2028: '2028-10-26',
  2029: '2029-10-16',
  2030: '2030-10-05',
  2031: '2031-10-24',
  2032: '2032-10-12',
  2033: '2033-10-01',
  2034: '2034-10-20',
  2035: '2035-10-09'
};

// 佛誕日期對照表（農曆四月初八）
const buddhaBirthdayDates = {
  2024: '2024-05-15',
  2025: '2025-05-05',
  2026: '2026-05-24',
  2027: '2027-05-13',
  2028: '2028-05-02',
  2029: '2029-05-20',
  2030: '2030-05-09',
  2031: '2031-05-28',
  2032: '2032-05-16',
  2033: '2033-05-06',
  2034: '2034-05-25',
  2035: '2035-05-15'
};

// 復活節日期對照表
const easterDates = {
  2024: '2024-03-31',
  2025: '2025-04-20',
  2026: '2026-04-05',
  2027: '2027-03-28',
  2028: '2028-04-16',
  2029: '2029-04-01',
  2030: '2030-04-21',
  2031: '2031-04-13',
  2032: '2032-03-28',
  2033: '2033-04-17',
  2034: '2034-04-09',
  2035: '2035-03-25'
};

/**
 * 添加天數到日期
 */
function addDays(dateStr, days) {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

/**
 * 獲取指定日期是星期幾 (0=星期日, 1=星期一, ..., 6=星期六)
 */
function getDayOfWeek(dateStr) {
  return new Date(dateStr).getDay();
}

/**
 * 如果假期落在星期日，獲取補假日期（通常是下一個工作日）
 */
function getSubstituteHoliday(dateStr, existingHolidays = []) {
  const dayOfWeek = getDayOfWeek(dateStr);
  if (dayOfWeek === 0) { // 星期日
    // 找下一個非假期的工作日
    let substitute = addDays(dateStr, 1);
    while (existingHolidays.includes(substitute) || getDayOfWeek(substitute) === 0) {
      substitute = addDays(substitute, 1);
    }
    return substitute;
  }
  return null;
}

/**
 * 獲取指定年份的香港公眾假期
 * @param {number} year - 年份
 * @returns {Array} 假期列表，每個項目包含 date 和 name
 */
function computeHolidays(year) {
  const holidays = [];
  const holidayDates = new Set(); // 用於追踪已添加的日期

  // 1. 元旦 (1月1日)
  const newYear = `${year}-01-01`;
  holidays.push({ date: newYear, name: '元旦', name_en: "New Year's Day" });
  holidayDates.add(newYear);

  // 2. 農曆新年（年初一、初二、初三）
  if (lunarNewYearDates[year]) {
    const cnyDay1 = lunarNewYearDates[year];
    const cnyDay2 = addDays(cnyDay1, 1);
    const cnyDay3 = addDays(cnyDay1, 2);
    
    holidays.push({ date: cnyDay1, name: '農曆年初一', name_en: 'Lunar New Year Day 1' });
    holidays.push({ date: cnyDay2, name: '農曆年初二', name_en: 'Lunar New Year Day 2' });
    holidays.push({ date: cnyDay3, name: '農曆年初三', name_en: 'Lunar New Year Day 3' });
    holidayDates.add(cnyDay1);
    holidayDates.add(cnyDay2);
    holidayDates.add(cnyDay3);
    
    // 檢查是否需要補假（如果有任何一天落在星期日）
    [cnyDay1, cnyDay2, cnyDay3].forEach(date => {
      const sub = getSubstituteHoliday(date, Array.from(holidayDates));
      if (sub && !holidayDates.has(sub)) {
        holidays.push({ date: sub, name: '農曆新年補假', name_en: 'Lunar New Year (Substitute)' });
        holidayDates.add(sub);
      }
    });
  }

  // 3. 清明節
  if (chingMingDates[year]) {
    const chingMing = chingMingDates[year];
    holidays.push({ date: chingMing, name: '清明節', name_en: 'Ching Ming Festival' });
    holidayDates.add(chingMing);
    
    const sub = getSubstituteHoliday(chingMing, Array.from(holidayDates));
    if (sub && !holidayDates.has(sub)) {
      holidays.push({ date: sub, name: '清明節補假', name_en: 'Ching Ming Festival (Substitute)' });
      holidayDates.add(sub);
    }
  }

  // 4. 復活節（耶穌受難節、耶穌受難節翌日、復活節星期一）
  if (easterDates[year]) {
    const easterSunday = easterDates[year];
    const goodFriday = addDays(easterSunday, -2);
    const easterSaturday = addDays(easterSunday, -1);
    const easterMonday = addDays(easterSunday, 1);
    
    holidays.push({ date: goodFriday, name: '耶穌受難節', name_en: 'Good Friday' });
    holidays.push({ date: easterSaturday, name: '耶穌受難節翌日', name_en: 'Day after Good Friday' });
    holidays.push({ date: easterMonday, name: '復活節星期一', name_en: 'Easter Monday' });
    holidayDates.add(goodFriday);
    holidayDates.add(easterSaturday);
    holidayDates.add(easterMonday);
  }

  // 5. 勞動節 (5月1日)
  const labourDay = `${year}-05-01`;
  holidays.push({ date: labourDay, name: '勞動節', name_en: 'Labour Day' });
  holidayDates.add(labourDay);
  
  const labourDaySub = getSubstituteHoliday(labourDay, Array.from(holidayDates));
  if (labourDaySub && !holidayDates.has(labourDaySub)) {
    holidays.push({ date: labourDaySub, name: '勞動節補假', name_en: 'Labour Day (Substitute)' });
    holidayDates.add(labourDaySub);
  }

  // 6. 佛誕
  if (buddhaBirthdayDates[year]) {
    const buddhaBirthday = buddhaBirthdayDates[year];
    holidays.push({ date: buddhaBirthday, name: '佛誕', name_en: "Buddha's Birthday" });
    holidayDates.add(buddhaBirthday);
    
    const sub = getSubstituteHoliday(buddhaBirthday, Array.from(holidayDates));
    if (sub && !holidayDates.has(sub)) {
      holidays.push({ date: sub, name: '佛誕補假', name_en: "Buddha's Birthday (Substitute)" });
      holidayDates.add(sub);
    }
  }

  // 7. 端午節
  if (dragonBoatDates[year]) {
    const dragonBoat = dragonBoatDates[year];
    holidays.push({ date: dragonBoat, name: '端午節', name_en: 'Tung Ng Festival' });
    holidayDates.add(dragonBoat);
    
    const sub = getSubstituteHoliday(dragonBoat, Array.from(holidayDates));
    if (sub && !holidayDates.has(sub)) {
      holidays.push({ date: sub, name: '端午節補假', name_en: 'Tung Ng Festival (Substitute)' });
      holidayDates.add(sub);
    }
  }

  // 8. 香港特別行政區成立紀念日 (7月1日)
  const hksarDay = `${year}-07-01`;
  holidays.push({ date: hksarDay, name: '香港特別行政區成立紀念日', name_en: 'HKSAR Establishment Day' });
  holidayDates.add(hksarDay);
  
  const hksarDaySub = getSubstituteHoliday(hksarDay, Array.from(holidayDates));
  if (hksarDaySub && !holidayDates.has(hksarDaySub)) {
    holidays.push({ date: hksarDaySub, name: '香港特別行政區成立紀念日補假', name_en: 'HKSAR Establishment Day (Substitute)' });
    holidayDates.add(hksarDaySub);
  }

  // 9. 中秋節翌日
  if (midAutumnDates[year]) {
    const midAutumn = midAutumnDates[year];
    holidays.push({ date: midAutumn, name: '中秋節翌日', name_en: 'Day after Mid-Autumn Festival' });
    holidayDates.add(midAutumn);
    
    // 中秋節翌日如果是星期日，則中秋節當天補假
    const dayOfWeek = getDayOfWeek(midAutumn);
    if (dayOfWeek === 0) {
      const midAutumnEve = addDays(midAutumn, -1);
      if (!holidayDates.has(midAutumnEve)) {
        holidays.push({ date: midAutumnEve, name: '中秋節', name_en: 'Mid-Autumn Festival' });
        holidayDates.add(midAutumnEve);
      }
    }
  }

  // 10. 國慶日 (10月1日)
  const nationalDay = `${year}-10-01`;
  holidays.push({ date: nationalDay, name: '國慶日', name_en: 'National Day' });
  holidayDates.add(nationalDay);
  
  const nationalDaySub = getSubstituteHoliday(nationalDay, Array.from(holidayDates));
  if (nationalDaySub && !holidayDates.has(nationalDaySub)) {
    holidays.push({ date: nationalDaySub, name: '國慶日補假', name_en: 'National Day (Substitute)' });
    holidayDates.add(nationalDaySub);
  }

  // 11. 重陽節
  if (chungYeungDates[year]) {
    const chungYeung = chungYeungDates[year];
    holidays.push({ date: chungYeung, name: '重陽節', name_en: 'Chung Yeung Festival' });
    holidayDates.add(chungYeung);
    
    const sub = getSubstituteHoliday(chungYeung, Array.from(holidayDates));
    if (sub && !holidayDates.has(sub)) {
      holidays.push({ date: sub, name: '重陽節補假', name_en: 'Chung Yeung Festival (Substitute)' });
      holidayDates.add(sub);
    }
  }

  // 12. 聖誕節 (12月25日) 和 聖誕節後第一個周日 (12月26日)
  const christmas = `${year}-12-25`;
  const boxingDay = `${year}-12-26`;
  holidays.push({ date: christmas, name: '聖誕節', name_en: 'Christmas Day' });
  holidays.push({ date: boxingDay, name: '聖誕節後第一個周日', name_en: 'Day after Christmas' });
  holidayDates.add(christmas);
  holidayDates.add(boxingDay);
  
  // 聖誕假期補假處理
  const christmasDayOfWeek = getDayOfWeek(christmas);
  if (christmasDayOfWeek === 0) { // 聖誕節是星期日
    const christmasSub = `${year}-12-27`;
    holidays.push({ date: christmasSub, name: '聖誕節補假', name_en: 'Christmas Day (Substitute)' });
    holidayDates.add(christmasSub);
  } else if (christmasDayOfWeek === 6) { // 聖誕節是星期六，Boxing Day是星期日
    const boxingDaySub = `${year}-12-27`;
    holidays.push({ date: boxingDaySub, name: '聖誕節後第一個周日補假', name_en: 'Day after Christmas (Substitute)' });
    holidayDates.add(boxingDaySub);
  }

  // 按日期排序
  holidays.sort((a, b) => new Date(a.date) - new Date(b.date));

  return holidays;
}

/**
 * 檢查指定日期是否為公眾假期
 * @param {string} dateStr - 日期字串 (YYYY-MM-DD)
 * @returns {object|null} 如果是假期返回假期信息，否則返回 null
 */
function isHoliday(dateStr) {
  const year = parseInt(dateStr.split('-')[0]);
  const holidays = getHongKongHolidays(year);
  return holidays.find(h => h.date === dateStr) || null;
}

/**
 * 獲取指定月份的假期
 * @param {number} year - 年份
 * @param {number} month - 月份 (1-12)
 * @returns {Array} 該月份的假期列表
 */
function getHolidaysForMonth(year, month) {
  const holidays = getHongKongHolidays(year);
  const monthStr = String(month).padStart(2, '0');
  return holidays.filter(h => h.date.startsWith(`${year}-${monthStr}`));
}

/**
 * 獲取指定日期範圍內的假期
 * @param {string} startDate - 開始日期 (YYYY-MM-DD)
 * @param {string} endDate - 結束日期 (YYYY-MM-DD)
 * @returns {Array} 該範圍內的假期列表
 */
function getHolidaysInRange(startDate, endDate) {
  const startYear = parseInt(startDate.split('-')[0]);
  const endYear = parseInt(endDate.split('-')[0]);
  const allHolidays = [];
  
  for (let year = startYear; year <= endYear; year++) {
    allHolidays.push(...getHongKongHolidays(year));
  }
  
  return allHolidays.filter(h => h.date >= startDate && h.date <= endDate);
}

/**
 * 解析 1823 官方 iCal-JSON feed → byYear map
 * 結構：{ vcalendar:[{ vevent:[{ dtstart:["20250101",{value:"DATE"}], summary:"一月一日" }] }] }
 * dtstart[0] = "YYYYMMDD"，summary = 假期中文名
 */
function parse1823(json) {
  const byYear = {};
  try {
    const cal = json && json.vcalendar && json.vcalendar[0];
    const vevent = cal && cal.vevent;
    const events = Array.isArray(vevent) ? vevent : (vevent ? [vevent] : []);
    events.forEach((ev) => {
      const raw = Array.isArray(ev.dtstart) ? ev.dtstart[0] : ev.dtstart;
      if (!raw || typeof raw !== 'string' || raw.length < 8) return;
      const ds = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
      const name = ev.summary || '公眾假期';
      const y = raw.slice(0, 4);
      if (!byYear[y]) byYear[y] = [];
      byYear[y].push({ date: ds, name, name_en: name });
    });
    Object.keys(byYear).forEach((y) => byYear[y].sort((a, b) => a.date.localeCompare(b.date)));
  } catch (e) { /* ignore parse errors */ }
  return byYear;
}

function loadCache() {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
      cache = { fetchedAt: parsed.fetchedAt || 0, byYear: parsed.byYear || {} };
    }
  } catch (e) { cache = { fetchedAt: 0, byYear: {} }; }
}

function saveCache() {
  try {
    const dir = path.dirname(CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache), 'utf8');
  } catch (e) { /* ignore */ }
}

/**
 * 從香港政府 1823 官方來源 live fetch 公眾假期，寫入本地 cache。
 * 失敗（斷網 / 來源掛咗）就保留舊 cache；無 cache 則下次靠硬編碼計算法 fallback。
 * 政府每逢公布新假期（每年更新 / 特別假期），下個刷新周期自動反映，無需人手改 lunar 表。
 */
async function refreshHolidays() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(SOURCE_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const json = JSON.parse(text.replace(/^﻿/, '')); // strip UTF-8 BOM
    const byYear = parse1823(json);
    if (!Object.keys(byYear).length) throw new Error('解析到 0 個假期');
    cache = { fetchedAt: Date.now(), byYear };
    saveCache();
    console.log(`[holidays] 已從政府官方來源更新公眾假期，涵蓋年份: ${Object.keys(byYear).join(', ')}`);
  } catch (e) {
    console.warn('[holidays] 無法從政府來源更新公眾假期（沿用 cache / 硬編碼計算）:', e.message);
  }
}

/**
 * 公開取假期的 wrapper：優先用 live cache，無 cache 嘅年份 fallback 硬編碼計算法。
 */
function getHongKongHolidays(year) {
  const y = String(year);
  if (cache.byYear[y] && cache.byYear[y].length) return cache.byYear[y];
  return computeHolidays(year);
}

/**
 * 啟動：load cache → 如空 / 過期就 refresh（fire-and-forget）→ 每日定時刷新。
 */
function initHolidays() {
  loadCache();
  const empty = !cache.byYear || Object.keys(cache.byYear).length === 0;
  const stale = cache.fetchedAt && (Date.now() - cache.fetchedAt > CACHE_MAX_AGE_MS);
  if (empty || stale) refreshHolidays();
  if (!refreshTimer) {
    refreshTimer = setInterval(refreshHolidays, REFRESH_MS);
    if (refreshTimer.unref) refreshTimer.unref();
  }
}

initHolidays();

module.exports = {
  getHongKongHolidays,
  computeHolidays,
  isHoliday,
  getHolidaysForMonth,
  getHolidaysInRange,
  addDays,
  getDayOfWeek,
  initHolidays
};
