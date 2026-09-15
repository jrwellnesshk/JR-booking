/**
 * 農曆節日計算服務
 * 包含農曆轉換和節日計算
 */

/**
 * 農曆數據表（1900-2100年）
 * 每年用16進制表示，包含閏月和每月大小
 */
const LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900-1909
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910-1919
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920-1929
  0x06566, 0x0d4a0, 0x0ea50, 0x16a95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930-1939
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940-1949
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950-1959
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960-1969
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, // 1970-1979
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980-1989
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0, // 1990-1999
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000-2009
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010-2019
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020-2029
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030-2039
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040-2049
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, // 2050-2059
  0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060-2069
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070-2079
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080-2089
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252  // 2090-2099
];

/**
 * 獲取農曆年的總天數
 */
function getLunarYearDays(year) {
  let sum = 348;
  for (let i = 0x8000; i > 0x8; i >>= 1) {
    sum += (LUNAR_INFO[year - 1900] & i) ? 1 : 0;
  }
  return sum + getLeapDays(year);
}

/**
 * 獲取閏月天數
 */
function getLeapDays(year) {
  if (getLeapMonth(year)) {
    return (LUNAR_INFO[year - 1900] & 0x10000) ? 30 : 29;
  }
  return 0;
}

/**
 * 獲取閏月月份（0表示無閏月）
 */
function getLeapMonth(year) {
  return LUNAR_INFO[year - 1900] & 0xf;
}

/**
 * 獲取農曆某月的天數
 */
function getLunarMonthDays(year, month) {
  return (LUNAR_INFO[year - 1900] & (0x10000 >> month)) ? 30 : 29;
}

/**
 * 公曆轉農曆
 * @param {Date} date - 公曆日期
 * @returns {Object} - 農曆日期 {year, month, day, isLeap}
 */
function solarToLunar(date) {
  const baseDate = new Date(1900, 0, 31); // 農曆1900年正月初一
  let offset = Math.floor((date - baseDate) / 86400000);
  
  let lunarYear = 1900;
  let daysOfYear;
  
  // 計算農曆年
  while (lunarYear < 2100 && offset > 0) {
    daysOfYear = getLunarYearDays(lunarYear);
    if (offset < daysOfYear) break;
    offset -= daysOfYear;
    lunarYear++;
  }
  
  // 計算閏月
  const leapMonth = getLeapMonth(lunarYear);
  let isLeap = false;
  let lunarMonth = 1;
  let daysOfMonth;
  
  // 計算農曆月
  for (let i = 1; i <= 12; i++) {
    // 閏月
    if (leapMonth > 0 && i === leapMonth + 1 && !isLeap) {
      isLeap = true;
      i--;
      daysOfMonth = getLeapDays(lunarYear);
    } else {
      daysOfMonth = getLunarMonthDays(lunarYear, i);
    }
    
    if (offset < daysOfMonth) {
      lunarMonth = i;
      break;
    }
    offset -= daysOfMonth;
    
    if (isLeap && i === leapMonth + 1) {
      isLeap = false;
    }
  }
  
  const lunarDay = offset + 1;
  
  return {
    year: lunarYear,
    month: lunarMonth,
    day: lunarDay,
    isLeap: isLeap
  };
}

/**
 * 農曆轉公曆
 * @param {number} lunarYear - 農曆年
 * @param {number} lunarMonth - 農曆月
 * @param {number} lunarDay - 農曆日
 * @param {boolean} isLeap - 是否閏月
 * @returns {Date} - 公曆日期
 */
function lunarToSolar(lunarYear, lunarMonth, lunarDay, isLeap = false) {
  const baseDate = new Date(1900, 0, 31);
  let offset = 0;
  
  // 累加年份天數
  for (let y = 1900; y < lunarYear; y++) {
    offset += getLunarYearDays(y);
  }
  
  // 累加月份天數
  const leapMonth = getLeapMonth(lunarYear);
  for (let m = 1; m < lunarMonth; m++) {
    offset += getLunarMonthDays(lunarYear, m);
    // 加上閏月天數
    if (m === leapMonth) {
      offset += getLeapDays(lunarYear);
    }
  }
  
  // 如果是閏月，再加上正常月份天數
  if (isLeap && lunarMonth === leapMonth) {
    offset += getLunarMonthDays(lunarYear, lunarMonth);
  }
  
  // 加上日期
  offset += lunarDay - 1;
  
  return new Date(baseDate.getTime() + offset * 86400000);
}

/**
 * 預設節日列表（包含農曆和公曆）
 */
const DEFAULT_HOLIDAYS = [
  // 公曆節日
  { id: 'new_year', name: '元旦', type: 'solar', month: 1, day: 1, emoji: '🎊', defaultMessage: '新年快樂！祝您在新的一年身體健康、萬事如意！', enabled: true },
  { id: 'valentines', name: '情人節', type: 'solar', month: 2, day: 14, emoji: '💕', defaultMessage: '情人節快樂！願有情人終成眷屬，幸福美滿！', enabled: true },
  { id: 'mothers_day', name: '母親節', type: 'solar_special', month: 5, weekday: 0, week: 2, emoji: '👩‍👧', defaultMessage: '母親節快樂！感恩母愛，祝天下母親健康平安！', enabled: true },
  { id: 'fathers_day', name: '父親節', type: 'solar_special', month: 6, weekday: 0, week: 3, emoji: '👨‍👧', defaultMessage: '父親節快樂！感謝父愛如山，祝天下父親健康長壽！', enabled: true },
  { id: 'national_day', name: '國慶日', type: 'solar', month: 10, day: 1, emoji: '🇨🇳', defaultMessage: '國慶日快樂！祝福祖國繁榮昌盛！', enabled: true },
  { id: 'christmas', name: '聖誕節', type: 'solar', month: 12, day: 25, emoji: '🎄', defaultMessage: '聖誕快樂！願平安喜樂與您同在！', enabled: true },
  
  // 農曆節日
  { id: 'lunar_new_year_eve', name: '除夕', type: 'lunar', month: 12, day: -1, emoji: '🧧', defaultMessage: '除夕快樂！闔家團圓，幸福美滿！', enabled: true },
  { id: 'lunar_new_year', name: '農曆新年', type: 'lunar', month: 1, day: 1, emoji: '🧧', defaultMessage: '恭賀新禧！祝您龍馬精神、萬事勝意！', enabled: true },
  { id: 'lunar_new_year_2', name: '年初二', type: 'lunar', month: 1, day: 2, emoji: '🧧', defaultMessage: '年初二，開年大吉！祝您財源廣進！', enabled: true },
  { id: 'lunar_new_year_3', name: '年初三', type: 'lunar', month: 1, day: 3, emoji: '🧧', defaultMessage: '年初三，赤口日注意言行，和氣生財！', enabled: true },
  { id: 'lantern_festival', name: '元宵節', type: 'lunar', month: 1, day: 15, emoji: '🏮', defaultMessage: '元宵節快樂！月圓人團圓，湯圓甜心間！', enabled: true },
  { id: 'qingming', name: '清明節', type: 'solar', month: 4, day: 5, emoji: '🌿', defaultMessage: '清明時節，慎終追遠，緬懷先人。', enabled: true },
  { id: 'dragon_boat', name: '端午節', type: 'lunar', month: 5, day: 5, emoji: '🐲', defaultMessage: '端午安康！粽葉飄香，龍舟競渡，祝您平安健康！', enabled: true },
  { id: 'qixi', name: '七夕節', type: 'lunar', month: 7, day: 7, emoji: '🌌', defaultMessage: '七夕快樂！願有情人終成眷屬！', enabled: true },
  { id: 'mid_autumn', name: '中秋節', type: 'lunar', month: 8, day: 15, emoji: '🥮', defaultMessage: '中秋節快樂！月圓人團圓，祝您闔家幸福！', enabled: true },
  { id: 'double_ninth', name: '重陽節', type: 'lunar', month: 9, day: 9, emoji: '🏔️', defaultMessage: '重陽節快樂！登高望遠，祝您健康長壽！', enabled: true },
  { id: 'winter_solstice', name: '冬至', type: 'solar', month: 12, day: 22, emoji: '🥟', defaultMessage: '冬至快樂！吃湯圓餃子，溫暖過冬！', enabled: true },
  
  // 香港公眾假期
  { id: 'hk_sar_day', name: '香港特區成立紀念日', type: 'solar', month: 7, day: 1, emoji: '🇭🇰', defaultMessage: '香港特區成立紀念日快樂！', enabled: true },
  { id: 'buddha_birthday', name: '佛誕', type: 'lunar', month: 4, day: 8, emoji: '🙏', defaultMessage: '佛誕吉祥！願佛光普照，平安喜樂！', enabled: true },
  { id: 'labor_day', name: '勞動節', type: 'solar', month: 5, day: 1, emoji: '👷', defaultMessage: '勞動節快樂！向辛勤的勞動者致敬！', enabled: true }
];

/**
 * 計算指定年份的節日日期
 * @param {number} year - 年份
 * @param {Array} holidays - 節日列表
 * @returns {Array} - 包含具體日期的節日列表
 */
function calculateHolidayDates(year, holidays = DEFAULT_HOLIDAYS) {
  return holidays.map(holiday => {
    let date;
    
    switch (holiday.type) {
      case 'solar':
        // 公曆固定日期
        date = new Date(year, holiday.month - 1, holiday.day);
        break;
        
      case 'lunar':
        // 農曆日期
        if (holiday.day === -1) {
          // 除夕（農曆12月最後一天）
          const nextYear = lunarToSolar(year + 1, 1, 1);
          date = new Date(nextYear.getTime() - 86400000);
        } else {
          date = lunarToSolar(year, holiday.month, holiday.day);
        }
        break;
        
      case 'solar_special':
        // 特殊公曆日期（如母親節：5月第2個星期日）
        const firstDay = new Date(year, holiday.month - 1, 1);
        const firstWeekday = firstDay.getDay();
        let targetDay = 1 + (holiday.weekday - firstWeekday + 7) % 7;
        targetDay += (holiday.week - 1) * 7;
        date = new Date(year, holiday.month - 1, targetDay);
        break;
        
      default:
        date = new Date(year, holiday.month - 1, holiday.day || 1);
    }
    
    return {
      ...holiday,
      date: date,
      dateString: formatDate(date)
    };
  });
}

/**
 * 格式化日期為 YYYY-MM-DD
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 獲取今天的節日（如果是節日）
 * @param {Array} customHolidays - 自訂節日列表（從資料庫）
 * @returns {Object|null} - 節日信息或null
 */
function getTodayHoliday(customHolidays = null) {
  const today = new Date();
  const year = today.getFullYear();
  const todayStr = formatDate(today);
  
  const holidays = customHolidays || DEFAULT_HOLIDAYS;
  const holidayDates = calculateHolidayDates(year, holidays);
  
  for (const holiday of holidayDates) {
    if (holiday.dateString === todayStr && holiday.enabled) {
      return holiday;
    }
  }
  
  return null;
}

/**
 * 獲取節日祝賀信息
 * @param {Object} holiday - 節日對象
 * @returns {string} - 格式化的祝賀信息
 */
function getHolidayMessage(holiday) {
  // 兼容不同欄位名稱（資料庫用底線，代碼用駝峰式）
  const message = holiday.custom_message || holiday.customMessage || holiday.default_message || holiday.defaultMessage || '';
  const emoji = holiday.emoji || '🎉';
  const name = holiday.name || '節日';
  
  if (message) {
    return `【寶天JR祝您】\n${emoji}${name}快樂！\n${message}`;
  } else {
    return `【寶天JR祝您】\n${emoji}${name}快樂！`;
  }
}

/**
 * 獲取即將到來的節日（未來30天內）
 * @param {Array} customHolidays - 自訂節日列表
 * @returns {Array} - 即將到來的節日列表
 */
function getUpcomingHolidays(customHolidays = null) {
  const today = new Date();
  const year = today.getFullYear();
  const futureDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  
  const holidays = customHolidays || DEFAULT_HOLIDAYS;
  
  // 計算今年和明年的節日
  const thisYearHolidays = calculateHolidayDates(year, holidays);
  const nextYearHolidays = calculateHolidayDates(year + 1, holidays);
  
  const allHolidays = [...thisYearHolidays, ...nextYearHolidays];
  
  return allHolidays
    .filter(h => {
      const hDate = new Date(h.dateString);
      return hDate >= today && hDate <= futureDate && h.enabled;
    })
    .sort((a, b) => new Date(a.dateString) - new Date(b.dateString));
}

module.exports = {
  DEFAULT_HOLIDAYS,
  solarToLunar,
  lunarToSolar,
  calculateHolidayDates,
  getTodayHoliday,
  getHolidayMessage,
  getUpcomingHolidays,
  formatDate
};
