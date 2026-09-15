/**
 * 24節氣計算服務
 * 包含節氣日期計算和健康提示信息
 */

// 24節氣信息（固定語句）
const SOLAR_TERMS = {
  // 春季
  '立春': {
    emoji: '🌱',
    message: '今日立春，萬物初醒。乍暖還寒，記得「春捂」保暖，迎接新生之氣。',
    month: 2,
    dayRange: [3, 5]
  },
  '雨水': {
    emoji: '🌧️',
    message: '雨水至，春風帶潤。宜健脾祛濕，出門備傘，靜候草木萌動。',
    month: 2,
    dayRange: [18, 20]
  },
  '驚蟄': {
    emoji: '⚡',
    message: '驚蟄雷響，蟄蟲甦醒。飲食宜清淡防「春困」，適當運動喚活力。',
    month: 3,
    dayRange: [5, 7]
  },
  '春分': {
    emoji: '🌓',
    message: '春分晝夜平，陰陽各半。宜調理平衡，踏青賞花，莫負好春光。',
    month: 3,
    dayRange: [20, 21]
  },
  '清明': {
    emoji: '🌿',
    message: '清明時節，氣清景明。掃墓踏青兩相宜，注意防火，慎食生冷。',
    month: 4,
    dayRange: [4, 6]
  },
  '穀雨': {
    emoji: '🌾',
    message: '穀雨生百穀，春雨貴如油。宜防濕邪，嘗新茶食香椿，惜春之尾。',
    month: 4,
    dayRange: [19, 21]
  },
  
  // 夏季
  '立夏': {
    emoji: '☀️',
    message: '今日立夏，暑氣漸升。養心靜神，少食冷飲，午間小憩解疲乏。',
    month: 5,
    dayRange: [5, 7]
  },
  '小滿': {
    emoji: '🌾',
    message: '小滿未滿，萬物將熟。濕熱漸盛，宜祛濕健脾，飲食清淡。',
    month: 5,
    dayRange: [20, 22]
  },
  '芒種': {
    emoji: '🌻',
    message: '芒種忙種，夏收夏播。注意防暑補水，晚睡早起避烈日。',
    month: 6,
    dayRange: [5, 7]
  },
  '夏至': {
    emoji: '🌞',
    message: '夏至晝最長，陽極陰始生。宜食苦味清心，午休養陽，忌貪涼。',
    month: 6,
    dayRange: [21, 22]
  },
  '小暑': {
    emoji: '🔥',
    message: '小暑溫風至，盛夏始炎炎。防暑降溫，多飲溫水，靜心避煩躁。',
    month: 7,
    dayRange: [6, 8]
  },
  '大暑': {
    emoji: '🌡️',
    message: '大暑極熱時，濕熱交加。宜清熱解暑，綠豆湯相伴，避免暴曬。',
    month: 7,
    dayRange: [22, 24]
  },
  
  // 秋季
  '立秋': {
    emoji: '🍂',
    message: '今日立秋，暑去涼來。莫急添衣，「秋老虎」仍猛，宜潤肺防燥。',
    month: 8,
    dayRange: [7, 9]
  },
  '處暑': {
    emoji: '🌅',
    message: '處暑出暑，涼風漸起。早睡早起解秋乏，飲食增酸少辛辣。',
    month: 8,
    dayRange: [22, 24]
  },
  '白露': {
    emoji: '💦',
    message: '白露夜寒，草木凝露。早晚溫差大，及時添衣，防秋燥生津。',
    month: 9,
    dayRange: [7, 9]
  },
  '秋分': {
    emoji: '🌗',
    message: '秋分晝夜均，寒暑各半。宜滋陰潤肺，登高望遠，平衡身心。',
    month: 9,
    dayRange: [22, 24]
  },
  '寒露': {
    emoji: '🍁',
    message: '寒露露重，秋意漸濃。腳部保暖防寒從足生，少食生冷。',
    month: 10,
    dayRange: [7, 9]
  },
  '霜降': {
    emoji: '🍂',
    message: '霜降見霜，暮秋將至。宜補肝腎，食栗子紅柿，添衣防寒。',
    month: 10,
    dayRange: [23, 24]
  },
  
  // 冬季
  '立冬': {
    emoji: '❄️',
    message: '今日立冬，萬物收藏。宜溫補養腎，早睡晚起，儲備能量。',
    month: 11,
    dayRange: [7, 8]
  },
  '小雪': {
    emoji: '🌨️',
    message: '小雪雪輕，寒未深重。防抑鬱多曬太陽，熱湯暖身暖心。',
    month: 11,
    dayRange: [22, 23]
  },
  '大雪': {
    emoji: '🏔️',
    message: '大雪紛飛，寒冬已至。溫補避寒，早臥晚起，注意關節保暖。',
    month: 12,
    dayRange: [6, 8]
  },
  '冬至': {
    emoji: '🥟',
    message: '冬至一陽生，晝短夜最長。食餃子湯圓，補陽氣，靜待春歸。',
    month: 12,
    dayRange: [21, 23]
  },
  '小寒': {
    emoji: '🌬️',
    message: '小寒凍土，冷氣積久。防寒補腎，熱粥暖胃，減少戶外勞作。',
    month: 1,
    dayRange: [5, 7]
  },
  '大寒': {
    emoji: '❄️',
    message: '大寒歲終，冬盡春生。防風防寒，適當進補，靜候新年迎新。',
    month: 1,
    dayRange: [20, 21]
  }
};

/**
 * 計算指定年份的24節氣精確日期
 * 使用壽星萬年曆算法，會根據每年實際情況計算
 * @param {number} year - 年份
 * @returns {Object} - 節氣日期對照表
 */
function calculateSolarTermDates(year) {
  const dates = {};
  
  // 24節氣名稱（按順序，從小寒開始）
  const termNames = [
    '小寒', '大寒', '立春', '雨水', '驚蟄', '春分',
    '清明', '穀雨', '立夏', '小滿', '芒種', '夏至',
    '小暑', '大暑', '立秋', '處暑', '白露', '秋分',
    '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'
  ];
  
  // 計算每個節氣的準確日期
  for (let i = 0; i < 24; i++) {
    const termName = termNames[i];
    const termDate = getSolarTermDate(year, i);
    
    dates[termName] = {
      date: termDate,
      dateString: formatDateString(termDate),
      ...SOLAR_TERMS[termName]
    };
  }

  return dates;
}

/**
 * 計算指定節氣的準確日期
 * 基於壽星萬年曆的節氣計算公式: [Y * D + C] - L
 * @param {number} year - 年份
 * @param {number} termIndex - 節氣索引 (0-23, 0=小寒)
 * @returns {Date} - 節氣日期
 */
function getSolarTermDate(year, termIndex) {
  // 21世紀節氣 C 值（壽星萬年曆數據）
  const termC21 = [
    6.11, 20.84,   // 小寒、大寒
    4.6295, 19.4599, // 立春、雨水
    6.3826, 21.4155, // 驚蟄、春分
    5.59, 20.888,    // 清明、穀雨
    6.318, 21.86,    // 立夏、小滿
    6.5, 22.2,       // 芒種、夏至
    7.928, 23.65,    // 小暑、大暑
    8.35, 23.95,     // 立秋、處暑
    8.44, 23.822,    // 白露、秋分
    9.098, 24.218,   // 寒露、霜降
    8.218, 23.08,    // 立冬、小雪
    7.9, 22.6        // 大雪、冬至
  ];
  
  // 20世紀節氣 C 值
  const termC20 = [
    6.11, 20.84,
    4.6295, 19.4599,
    6.3826, 21.4155,
    5.59, 20.888,
    6.318, 21.86,
    6.5, 22.2,
    7.928, 23.65,
    8.35, 23.95,
    8.44, 23.822,
    9.098, 24.218,
    8.218, 23.08,
    7.9, 22.6
  ];
  
  // 選擇對應世紀的 C 值
  const C = year >= 2000 ? termC21[termIndex] : termC20[termIndex];
  const y = year % 100;
  
  // 計算公式: [Y * D + C] - L
  // D = 0.2422 (地球繞太陽公轉的周期差)
  // L = 閏年數 = (Y-1)/4 向下取整
  const D = 0.2422;
  const L = Math.floor((y - 1) / 4);
  
  let day = Math.floor(y * D + C) - L;
  
  // 特殊年份修正（根據香港天文台數據）
  day = adjustTermDay(year, termIndex, day);
  
  // 計算月份（每2個節氣對應一個月）
  const month = Math.floor(termIndex / 2) + 1;
  
  return new Date(year, month - 1, day);
}

/**
 * 特殊年份的節氣日期修正
 * @param {number} year - 年份
 * @param {number} termIndex - 節氣索引
 * @param {number} day - 計算出的日期
 * @returns {number} - 修正後的日期
 */
function adjustTermDay(year, termIndex, day) {
  // 特殊年份修正表（根據天文台數據）
  const adjustments = {
    // 小寒 (0)
    '0_1982': -1, '0_2019': -1,
    // 大寒 (1)
    '1_2082': 1,
    // 立春 (2) - 2026年立春是2月3日
    '2_2026': -1,
    // 雨水 (3)
    '3_2026': -1,
    // 驚蟄 (4)
    '4_2084': 1,
    // 春分 (5)
    '5_2084': 1,
    // 穀雨 (7)
    '7_2088': 1,
    // 立夏 (8)
    '8_2088': 1,
    // 小滿 (9)
    '9_2008': 1,
    // 芒種 (10)
    '10_1902': 1,
    // 夏至 (11)
    '11_1928': 1,
    // 小暑 (12)
    '12_1925': 1, '12_2016': 1,
    // 大暑 (13)
    '13_1922': 1,
    // 立秋 (14)
    '14_2002': 1,
    // 白露 (16)
    '16_1927': 1,
    // 秋分 (17)
    '17_1942': 1,
    // 寒露 (18)
    '18_2088': 1,
    // 霜降 (19)
    '19_2089': 1,
    // 立冬 (20)
    '20_2089': 1,
    // 小雪 (21)
    '21_1978': 1,
    // 大雪 (22)
    '22_1954': 1,
    // 冬至 (23)
    '23_1918': -1, '23_2021': -1
  };
  
  const key = `${termIndex}_${year}`;
  if (adjustments[key]) {
    return day + adjustments[key];
  }
  
  return day;
}

/**
 * 格式化日期字符串
 * @param {Date} date - 日期對象
 * @returns {string} - 格式化的日期字符串 YYYY-MM-DD
 */
function formatDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 獲取今天的節氣（如果是節氣日）
 * @returns {Object|null} - 節氣信息或null
 */
function getTodaySolarTerm() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const day = today.getDate();
  
  const todayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const solarTermDates = calculateSolarTermDates(year);
  
  for (const [term, data] of Object.entries(solarTermDates)) {
    if (data.dateString === todayStr) {
      return {
        name: term,
        ...data
      };
    }
  }
  
  return null;
}

/**
 * 獲取指定日期的節氣
 * @param {Date} date - 日期
 * @returns {Object|null} - 節氣信息或null
 */
function getSolarTermByDate(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const solarTermDates = calculateSolarTermDates(year);
  
  for (const [term, data] of Object.entries(solarTermDates)) {
    if (data.dateString === dateStr) {
      return {
        name: term,
        ...data
      };
    }
  }
  
  return null;
}

/**
 * 獲取節氣提醒信息
 * @param {string} termName - 節氣名稱
 * @returns {string} - 格式化的提醒信息
 */
function getSolarTermMessage(termName) {
  const term = SOLAR_TERMS[termName];
  if (!term) return null;
  
  return `【寶天JR提醒您】\n${term.emoji}${term.message}`;
}

/**
 * 獲取指定年份所有節氣日期列表
 * @param {number} year - 年份
 * @returns {Array} - 節氣日期列表
 */
function getSolarTermList(year) {
  const dates = calculateSolarTermDates(year);
  return Object.entries(dates)
    .map(([name, data]) => ({
      name,
      date: data.dateString,
      emoji: data.emoji,
      message: data.message
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

/**
 * 獲取即將到來的節氣（未來30天內）
 * @returns {Array} - 即將到來的節氣列表
 */
function getUpcomingSolarTerms() {
  const today = new Date();
  const year = today.getFullYear();
  const futureDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  
  const thisYearTerms = calculateSolarTermDates(year);
  const nextYearTerms = calculateSolarTermDates(year + 1);
  
  const allTerms = [
    ...Object.entries(thisYearTerms).map(([name, data]) => ({ name, ...data })),
    ...Object.entries(nextYearTerms).map(([name, data]) => ({ name, ...data }))
  ];
  
  return allTerms
    .filter(term => {
      const termDate = new Date(term.dateString);
      return termDate >= today && termDate <= futureDate;
    })
    .sort((a, b) => new Date(a.dateString) - new Date(b.dateString));
}

module.exports = {
  SOLAR_TERMS,
  calculateSolarTermDates,
  getTodaySolarTerm,
  getSolarTermByDate,
  getSolarTermMessage,
  getSolarTermList,
  getUpcomingSolarTerms
};
