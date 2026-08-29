/**
 * 香港天文台天氣服務
 * 使用官方免費 API 獲取天氣資訊
 */

const https = require('https');

// 天文台 API 端點
const HKO_API = {
  currentWeather: 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc',
  warnings: 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warningInfo&lang=tc',
  forecast: 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=tc',
  localForecast: 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=flw&lang=tc'
};

/**
 * 發送 HTTPS 請求
 */
function fetchData(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('解析天氣數據失敗'));
        }
      });
    }).on('error', reject);
  });
}

/**
 * 獲取當前天氣
 */
async function getCurrentWeather() {
  try {
    const data = await fetchData(HKO_API.currentWeather);
    
    // 提取氣溫（取香港天文台的數據）
    let temperature = null;
    if (data.temperature && data.temperature.data) {
      const hkoTemp = data.temperature.data.find(t => t.place === '香港天文台');
      temperature = hkoTemp ? hkoTemp.value : data.temperature.data[0]?.value;
    }
    
    // 提取濕度
    let humidity = null;
    if (data.humidity && data.humidity.data) {
      humidity = data.humidity.data[0]?.value;
    }
    
    // 提取紫外線指數
    let uvIndex = null;
    if (data.uvindex && data.uvindex.data) {
      uvIndex = data.uvindex.data[0]?.value;
    }
    
    // 提取圖標和天氣概況
    let icon = data.icon ? data.icon[0] : null;
    
    return {
      temperature,
      humidity,
      uvIndex,
      icon,
      updateTime: data.updateTime
    };
  } catch (error) {
    console.error('獲取當前天氣失敗:', error);
    return null;
  }
}

/**
 * 獲取天氣警告
 */
async function getWarnings() {
  try {
    const data = await fetchData(HKO_API.warnings);
    
    const warnings = [];
    
    if (data && data.details) {
      // 檢查各種警告
      for (const warning of data.details) {
        warnings.push({
          name: warning.warningStatementCode,
          contents: warning.contents || [],
          updateTime: warning.updateTime
        });
      }
    }
    
    // 常見警告代碼對應中文名稱
    const warningNames = {
      'WTCSGNL': '熱帶氣旋警告',
      'WRAIN': '暴雨警告',
      'WFROST': '霜凍警告',
      'WHOT': '酷熱天氣警告',
      'WCOLD': '寒冷天氣警告',
      'WMSGNL': '季候風警告',
      'WFNTSA': '新界北部水浸特別報告',
      'WL': '山泥傾瀉警告',
      'WTMW': '海嘯警告',
      'WTS': '雷暴警告',
      'WFIRE': '火災危險警告'
    };
    
    return {
      hasWarning: warnings.length > 0,
      warnings: warnings.map(w => ({
        ...w,
        displayName: warningNames[w.name] || w.name
      })),
      warningNames
    };
  } catch (error) {
    console.error('獲取天氣警告失敗:', error);
    return { hasWarning: false, warnings: [] };
  }
}

/**
 * 獲取本地天氣預報概述
 */
async function getLocalForecast() {
  try {
    const data = await fetchData(HKO_API.localForecast);
    return {
      generalSituation: data.generalSituation,
      forecastDesc: data.forecastDesc,
      outlook: data.outlook,
      updateTime: data.updateTime
    };
  } catch (error) {
    console.error('獲取本地預報失敗:', error);
    return null;
  }
}

/**
 * 生成天氣提醒訊息
 */
function generateWeatherAlert(weather, warnings) {
  const alerts = [];
  const tips = [];
  
  if (!weather) {
    return { alerts: [], tips: [], severity: 'normal' };
  }
  
  let severity = 'normal'; // normal, mild, moderate, severe
  
  // 溫度提醒
  if (weather.temperature !== null) {
    if (weather.temperature <= 12) {
      alerts.push(`🥶 目前氣溫只有 ${weather.temperature}°C，天氣非常寒冷`);
      tips.push('請穿著足夠保暖衣物');
      tips.push('長者及長期病患者應特別注意保暖');
      severity = 'moderate';
    } else if (weather.temperature <= 15) {
      alerts.push(`❄️ 目前氣溫 ${weather.temperature}°C，天氣寒冷`);
      tips.push('外出請注意添衣保暖');
      severity = 'mild';
    } else if (weather.temperature >= 33) {
      alerts.push(`🔥 目前氣溫高達 ${weather.temperature}°C，天氣酷熱`);
      tips.push('請注意防暑降溫，多補充水分');
      tips.push('避免長時間在戶外曝曬');
      severity = 'moderate';
    } else if (weather.temperature >= 30) {
      alerts.push(`☀️ 目前氣溫 ${weather.temperature}°C，天氣炎熱`);
      tips.push('外出請注意防曬及補充水分');
      severity = 'mild';
    }
  }
  
  // 濕度提醒
  if (weather.humidity !== null) {
    if (weather.humidity >= 95) {
      alerts.push(`💧 濕度高達 ${weather.humidity}%，非常潮濕`);
      tips.push('地面可能濕滑，小心行走');
    } else if (weather.humidity <= 40) {
      alerts.push(`🏜️ 濕度只有 ${weather.humidity}%，天氣乾燥`);
      tips.push('請多補充水分');
    }
  }
  
  // 紫外線提醒
  if (weather.uvIndex !== null && weather.uvIndex >= 8) {
    alerts.push(`☀️ 紫外線指數 ${weather.uvIndex}（甚高）`);
    tips.push('外出請做好防曬措施');
    if (severity === 'normal') severity = 'mild';
  }
  
  // 天氣警告
  if (warnings && warnings.hasWarning) {
    severity = 'severe';
    warnings.warnings.forEach(w => {
      if (w.name === 'WTCSGNL') {
        // 熱帶氣旋（颱風）
        const signalMatch = w.contents.join(' ').match(/(\d+|一|三|八|九|十)號/);
        if (signalMatch) {
          alerts.push(`🌀 天文台已發出 ${signalMatch[0]} 熱帶氣旋警告信號`);
          tips.push('請留意天文台最新消息');
          tips.push('非必要請勿外出');
        }
      } else if (w.name === 'WRAIN') {
        alerts.push(`🌧️ 天文台已發出暴雨警告信號`);
        tips.push('外出請帶備雨具');
        tips.push('避免前往低窪地區');
      } else if (w.name === 'WHOT') {
        alerts.push(`🌡️ 天文台已發出酷熱天氣警告`);
        tips.push('避免長時間在戶外活動');
      } else if (w.name === 'WCOLD') {
        alerts.push(`🥶 天文台已發出寒冷天氣警告`);
        tips.push('請確保有足夠禦寒衣物');
      } else if (w.name === 'WTS') {
        alerts.push(`⛈️ 天文台已發出雷暴警告`);
        tips.push('避免在空曠地方活動');
        tips.push('遠離樹木和金屬物件');
      } else if (w.name === 'WFIRE') {
        alerts.push(`🔥 天文台已發出火災危險警告`);
        tips.push('郊遊時切勿生火');
      } else {
        alerts.push(`⚠️ 天文台已發出${w.displayName}`);
      }
    });
  }
  
  return {
    alerts,
    tips,
    severity,
    temperature: weather.temperature,
    humidity: weather.humidity,
    uvIndex: weather.uvIndex
  };
}

/**
 * 獲取完整天氣資訊和提醒
 */
async function getWeatherInfo() {
  try {
    const [weather, warnings, forecast] = await Promise.all([
      getCurrentWeather(),
      getWarnings(),
      getLocalForecast()
    ]);
    
    const alert = generateWeatherAlert(weather, warnings);
    
    return {
      success: true,
      current: weather,
      warnings: warnings,
      forecast: forecast,
      alert: alert,
      updateTime: weather?.updateTime || new Date().toISOString()
    };
  } catch (error) {
    console.error('獲取天氣資訊失敗:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  getCurrentWeather,
  getWarnings,
  getLocalForecast,
  getWeatherInfo,
  generateWeatherAlert
};
