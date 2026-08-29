/**
 * 寶天醫館預約系統 - 主伺服器
 * 精簡版：所有 API 已模組化到 routes/ 資料夾
 */

// 載入環境變數（必須在最開頭）
require('dotenv').config();

// 📋 日誌輪轉（每日檔案 + 自動清理，必須喺其他模組之前掛載）
require('./services/logger');

const helmet = require('helmet');
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");

// ==================== Session Cookie 簽名 ====================

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.log('⚠️ 未設定 SESSION_SECRET 環境變數，已生成隨機密鑰（伺服器重啟後所有登入會失效）');
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ 生產環境必須設定 SESSION_SECRET（否則 JWT 每次重啟失效，且可被重放攻擊）。請在 .env 設定後再啟動。');
    process.exit(1);
  }
}

const signSession = (userId) => {
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(String(userId)).digest('hex');
  return `${userId}.${sig}`;
};

const verifySession = (token) => {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [id, sig] = parts;
  if (!id || !sig || isNaN(Number(id))) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(String(id)).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? Number(id) : null;
};

const parseCookies = (req) => {
  const header = req.headers.cookie || '';
  const cookies = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(val);
  });
  return cookies;
};

// 引入模組化配置
const { initializeDatabase, hashPassword, verifyPassword } = require("./config/db");
const { getHongKongHolidays, isHoliday, getHolidaysInRange } = require("./services/holidays");
const { validatePassword } = require("./services/passwordPolicy");
const emailService = require("./services/email");
// 供 admin 路由（醫師請假批量通知）使用電郵服務
global.__emailService = emailService;
const weatherService = require("./services/weather");

// ℹ️ SMS 已全面取消（見 README），統一使用 WhatsApp 通知

// WhatsApp 服務 - 根據環境變數選擇 Twilio、360dialog 或 Android Gateway
const whatsappProvider = process.env.WHATSAPP_PROVIDER || 'twilio';
let whatsappService;
if (whatsappProvider === 'android') {
  whatsappService = require("./services/whatsapp-android");
  console.log('💬 WhatsApp 服務: Android WhatsApp Gateway (測試模式)');
} else if (whatsappProvider === '360dialog') {
  whatsappService = require("./services/whatsapp-360dialog");
  const sandbox = process.env.DIALOG360_USE_SANDBOX === 'true' ? ' (Sandbox)' : '';
  console.log('💬 WhatsApp 服務: 360dialog' + sandbox);
} else {
  whatsappService = require("./services/whatsapp");
  console.log('💬 WhatsApp 服務: Twilio');
}

// 引入路由模組
const authRoutes = require("./routes/auth");
const usersRoutes = require("./routes/users");
const bookingsRoutes = require("./routes/bookings");
const adminRoutes = require("./routes/admin");
const settingsRoutes = require("./routes/settings");
const aiRoutes = require("./routes/ai");
const miscRoutes = require("./routes/misc");
const feedbackRoutes = require("./routes/feedback");
const medicalRecordsRoutes = require("./routes/medicalRecords");
const triageRoutes = require("./routes/triage");
const notificationsRoutes = require("./routes/notifications");
const contentRoutes = require("./routes/content");
const adminContentRoutes = require("./routes/admin-content");

// 引入通知排程服務
const notificationScheduler = require("./services/notification-scheduler");
const createAuthMiddleware = require("./middlewares/auth");
const jwt = require("./services/jwt");
const captchaService = require("./services/captcha");

const app = express();
const PORT = process.env.PORT || 4000;

// 生產經 Caddy / Nginx 等反向代理，必須信任 proxy 先可以正確讀取客戶 IP
// （否則 express-rate-limit 見到 X-Forwarded-For 會擲 ValidationError，login 等路由變 500）
app.set('trust proxy', 1);

// ==================== 輔助函數 ====================

/**
 * 獲取本地時間字串（格式：YYYY-MM-DD HH:MM:SS）
 */
const getLocalTimeString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

// ==================== 速率限制配置 ====================

// 全局 API 速率限制：每個 IP 每 15 分鐘最多 500 次請求
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: "請求過於頻繁，請稍後再試" },
  standardHeaders: true,
  legacyHeaders: false,
});

// ==================== 中間件配置 ====================

// 🔒 安全回應標頭（helmet）
// CSP 關閉：頁面使用 Vue CDN + 大量 inline script/style，開啟會全面破壞前端
// CORP 關閉：允許圖片/檔案被合法跨站引用（如 WhatsApp 預覽）
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// 🔒 CORS：只允許同源（localhost 開發）與 ALLOWED_ORIGINS 白名單
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // 沒有 Origin 頭（同源導航、curl、伺服器間呼叫）一律放行
    if (!origin) return callback(null, true);
    // 本機開發同源
    if (/^https?:\/\/localhost(:\d+)?$/i.test(origin)) return callback(null, true);
    if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(origin)) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed'));
  },
  credentials: true,
}));

// ?? bodyParser：保留 rawBody 供 Stripe webhook 簽名驗證使用
app.use(bodyParser.json({
  verify(req, res, buf) {
    try { req.rawBody = buf; } catch (e) { /* ignore */ }
  }
}));

// 🔒 安全：只暴露必要嘅公共靜態資源，防止 .env / 資料庫 / 源碼 / node_modules 被下載
const PUBLIC_STATIC_DIRS = ['css', 'js', 'picture'];
PUBLIC_STATIC_DIRS.forEach((dir) => {
  app.use(`/${dir}`, express.static(path.join(__dirname, dir)));
});
// 阻擋一切敏感檔案（即使放到公共目錄外）
const BLOCKED_STATIC = [/\.env$/i, /\.db$/i, /\.sqlite/i, /\.log$/i, /\.bak$/i, /\.aibak$/i, /(^|\/)_/i,
  /^\/server\.js$/i, /^\/package(-lock)?\.json$/i, /^\/backup\//i,
  /^\/node_modules\//i, /^\/routes\//i, /^\/services\//i, /^\/config\//i,
  /^\/build_.*\.(js|py)$/i, /^\/validate_.*\.(js|py)$/i, /^\/cleanup\.js$/i];
app.use((req, res, next) => {
  if (BLOCKED_STATIC.some((re) => re.test(req.path))) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
});

// 應用全局速率限制到所有 API 路由
app.use('/api/', globalLimiter);

// ==================== 初始化資料庫 ====================

const db = initializeDatabase();

// ==================== 靜態頁面路由 ====================

// 根路徑返回 index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 其他頁面檔（明確暴露，唔使開成個目錄）
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});
app.get('/doctor.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'doctor.html'));
});
app.get('/staff.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'staff.html'));
});

// 醫師版面
app.get('/doctor', (req, res) => {
  res.sendFile(path.join(__dirname, 'doctor.html'));
});

// 員工版面
app.get('/staff', (req, res) => {
  res.sendFile(path.join(__dirname, 'staff.html'));
});

// 私隱政策（PDPO）
app.get('/privacy.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'privacy.html'));
});
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'privacy.html'));
});

// ==================== 掛載 API 路由模組 ====================

// 認證中間件（驗證 JWT token，提供 req.userId / req.user / req.auth）
const { requireAuth, requireRole, optionalAuth } = createAuthMiddleware(db);

// 認證相關路由（註冊、登入、忘記密碼）
// 路徑前綴: /api/auth
app.use('/api/auth', authRoutes(db, hashPassword, verifyPassword, signSession, { requireAuth, requireRole }));

// 用戶管理路由
// 路徑前綴: /api/users
app.use('/api/users', usersRoutes(db, hashPassword, verifyPassword, { requireAuth, requireRole }));

// 預約管理路由（包含電郵通知）
// 路徑前綴: /api/bookings
app.use('/api/bookings', bookingsRoutes(db, emailService, getLocalTimeString, { requireAuth, requireRole, optionalAuth, verifyPassword }));

// 會員訂閱 / 家庭帳戶 / Stripe 支付路由
// 路徑前綴: /api/membership
const membershipRoutes = require("./routes/memberships");
app.use('/api/membership', membershipRoutes(db, { requireAuth, requireRole }));

// 管理員路由（包含二次驗證）
// 路徑前綴: /api/admin
app.use('/api/admin', adminRoutes(db, hashPassword, verifyPassword, { requireAuth, requireRole }));

// 設定路由（診所、API、醫師、服務）
// 路徑前綴: /api/settings
app.use('/api/settings', settingsRoutes(db, { requireAuth, requireRole }));

// AI 問診路由
// 路徑前綴: /api/ai
app.use('/api/ai', aiRoutes(db, { requireAuth, requireRole }));

// 意見反饋路由
// 路徑前綴: /api/feedback
app.use("/api/feedback", feedbackRoutes(db, { requireAuth, requireRole }));
app.use("/api/medical-records", medicalRecordsRoutes(db, getLocalTimeString, { requireAuth, requireRole }));

// 官網內容管理（公告/影片/社交/評價/討論區/頭像）
// 路徑前綴: /api/content（公開+登入）、/api/admin/content（管理員）
app.use("/api/content", contentRoutes(db, { requireAuth, requireRole }));
app.use("/api/admin/content", adminContentRoutes(db, { requireAuth, requireRole }));

// 靜態檔案：提供上傳嘅頭像與影片（只允許白名單檔案類型，blocked 清單已阻擋 .env/.db 等）
app.use("/uploads", (req, res, next) => {
  // 只允許圖片與影片格式，其他一律 404
  if (!/\.(jpg|jpeg|png|gif|webp|svg|mp4|webm|ogg|mov)$/i.test(req.path)) {
    return res.status(404).end();
  }
  next();
}, express.static(path.join(__dirname, 'uploads'), {
  index: false,
  dotfiles: 'deny'
}));

// 靜態檔案服務：提供上傳的醫療記錄檔案（需登入，客戶只可存取自己的檔案）
app.use("/uploads/medical_records", (req, res) => {
  // 1. 驗證登入身份（優先 JWT token，其次 session cookie；不再接受可偽造嘅 x-user-id header）
  const token = jwt.extractTokenFromRequest(req);
  const payload = token ? jwt.verifyToken(token) : null;
  const sessionUserId = verifySession(parseCookies(req).clinic_session);
  const userId = (payload && payload.userId) || sessionUserId;

  if (!userId) {
    return res.status(401).json({ error: '未登入：請先登入系統' });
  }

  // 2. 確認用戶存在
  db.get("SELECT id, role FROM users WHERE id=?", [userId], (err, user) => {
    if (err || !user) {
      return res.status(403).json({ error: '無權限存取此檔案' });
    }

    // 3. 確認目標檔案路徑安全
    const relativePath = req.path.replace(/^\/+/, '');
    if (!relativePath || relativePath.includes('..')) {
      return res.status(400).json({ error: '非法檔案路徑' });
    }
    const filePath = path.join(__dirname, 'uploads', 'medical_records', relativePath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '檔案不存在' });
    }

    // 4. 客戶只可存取屬於自己的檔案（管理員/醫師可存取所有檔案）
    const dbFileName = '/uploads/medical_records/' + relativePath;
    const checkFileOwnership = (callback) => {
      db.get(
        `SELECT mr.user_id FROM medical_records mr WHERE mr.audio_file_path=? 
         UNION 
         SELECT mr.user_id FROM medical_record_photos p JOIN medical_records mr ON p.medical_record_id=mr.id WHERE p.photo_file_path=?`,
        [dbFileName, dbFileName],
        (err, ownerRow) => callback(err, ownerRow ? ownerRow.user_id : null)
      );
    };

    checkFileOwnership((err, ownerId) => {
      if (err) return res.status(500).json({ error: '系統錯誤' });
      if (user.role === 'customer' && ownerId !== user.id) {
        return res.status(403).json({ error: '無權限存取此檔案' });
      }
      // 5. 授權通過，以附件形式提供檔案（避免被 <audio>/<img> 之外直接內嵌）
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.sendFile(filePath);
    });
  });
});

// 醫療分流路由
// 路徑前綴: /api/triage
app.use('/api/triage', triageRoutes(db, { requireAuth, requireRole }));

// 通知管理路由（節氣、節日、天氣提醒）
// 路徑前綴: /api/notifications
notificationScheduler.initialize(db);
app.use('/api/notifications', notificationsRoutes(db, notificationScheduler, { requireAuth, requireRole }));

// 啟動通知排程服務（每天 08:00 自動發送）
notificationScheduler.startScheduler();

// ==================== 天氣 API ====================

// 獲取天氣資訊和提醒
app.get('/api/weather', async (req, res) => {
  try {
    const weatherInfo = await weatherService.getWeatherInfo();
    res.json(weatherInfo);
  } catch (error) {
    console.error('天氣 API 錯誤:', error);
    res.status(500).json({ success: false, error: '獲取天氣資訊失敗' });
  }
});

// ==================== WhatsApp 通知 API ====================

// 檢查通知服務狀態（限管理員）
app.get('/api/notifications/status', requireAuth, requireRole('admin'), (req, res) => {
  const whatsappProviderName = process.env.WHATSAPP_PROVIDER || 'twilio';
  res.json({
    sms: { configured: false, provider: '已取消' },
    whatsapp: {
      configured: whatsappService.isConfigured(),
      provider: whatsappProviderName === 'android' ? 'Android WhatsApp Gateway (測試)' : 'Twilio'
    }
  });
});

// WhatsApp 測試端點的速率限制（每 IP 每小時最多 5 次）
const testSmsLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 小時
  max: 5, // 最多 5 次
  message: { success: false, error: '測試次數過多，請稍後再試（每小時最多 5 次）' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 測試發送 WhatsApp（限管理員，加入速率限制）
app.post('/api/notifications/test-whatsapp', requireAuth, requireRole('admin'), testSmsLimiter, async (req, res) => {
  try {
    const { phone } = req.body;
    
    // 驗證輸入
    if (!phone) {
      return res.status(400).json({ success: false, error: '請輸入電話號碼' });
    }
    
    // 電話號碼格式驗證
    const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
    if (!/^\+?[0-9]{8,15}$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, error: '電話號碼格式不正確' });
    }
    
    if (!whatsappService.isConfigured()) {
      return res.status(400).json({ success: false, error: 'WhatsApp 服務尚未配置，請先在 .env 文件設置 Twilio 憑證' });
    }
    
    console.log(`💬 測試 WhatsApp 發送到: ${cleanPhone}`);
    const result = await whatsappService.sendWhatsApp(cleanPhone, '🏥 *寶天醫館*\n\n這是一條測試訊息，如果您收到此訊息，表示 WhatsApp 服務配置成功！✅');
    res.json(result);
  } catch (error) {
    console.error('測試 WhatsApp 錯誤:', error);
    res.status(500).json({ success: false, error: error.message || '發送失敗' });
  }
});

// ==================== 向後兼容的 API 路由 ====================
// 這些是為了保持舊版 API 路徑的相容性
// 注意：必須在 miscRoutes 之前定義，以確保正確匹配

// 查找用戶ID（向後兼容 /api/find-user-id）
// 查詢用戶ID（舊版兼容 /api/find-user-id）
// 🔒 加上速率限制（防帳戶枚舉爆破），與 /api/auth 版本一致
const legacyFindUserLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: "查詢次數過多，請稍後再試" },
  standardHeaders: true,
  legacyHeaders: false,
});
app.post("/api/find-user-id", legacyFindUserLimiter, (req, res) => {
  const { name, phone } = req.body;
  
  console.log("find-user-id 收到:", { name, phone });
  
  if (!name || !phone) {
    return res.status(400).json({ error: "請提供姓名和電話號碼" });
  }

  // 移除電話號碼中的分隔符進行比對
  const cleanPhone = phone.replace(/[-\s]/g, '');
  
  // 同時查詢中文名(name)和英文名(name_en)
  db.get(
    `SELECT username, name, name_en, email, phone as db_phone FROM users 
     WHERE (name=? OR name_en=?) 
     AND (phone=? OR REPLACE(REPLACE(phone, '-', ''), ' ', '')=?)`,
    [name, name, phone, cleanPhone],
    (err, row) => {
      console.log("查詢結果:", { err, row });
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: "找不到匹配的用戶" });
      
      // 返回用戶名和姓名（優先返回中文名，如果沒有則返回英文名）
      res.json({ ok: true, username: row.username, name: row.name || row.name_en || name });
    }
  );
});

// 註冊（向後兼容 /api/register）
app.post("/api/register", async (req, res) => {
  const { username, password, name, name_en, phone, email, captchaAnswer } = req.body;

  // 🔒 公眾註冊閘門：預設關閉，註冊必須由診所工作人員於後台進行
  const allowPublic = await new Promise((resolve) => {
    db.get("SELECT setting_value FROM clinic_settings WHERE setting_key='allow_public_registration'", (e, r) => resolve(r ? r.setting_value : 'false'));
  });
  if (String(allowPublic) !== 'true') {
    return res.status(403).json({
      error: "本診所暫不接受網上自行註冊，請聯絡診所職員為您開戶（電話 2555-1136）。",
      code: "registration_closed"
    });
  }

  // 🔒 驗證 CAPTCHA（防機械人註冊）
  const captchaId = getCaptchaIdFromRequest(req);
  const captchaResult = captchaService.verifyCaptcha(captchaId, captchaAnswer);
  if (!captchaResult.ok) {
    return res.status(400).json({ error: captchaResult.error || '驗證碼錯誤', field: 'captcha' });
  }
  
  // 驗證必填欄位（電話必填，電郵選填）
  if (!username || !password || !name || !phone) {
    return res.status(400).json({ error: "缺少必要欄位（用戶名、密碼、姓名、電話為必填）" });
  }

  // 驗證會員ID格式（1-6個英文字母或數字）
  if (!/^[A-Za-z0-9]{1,6}$/.test(username)) {
    return res.status(400).json({ error: "會員ID必須為1-6個字元，只能包含英文字母和數字" });
  }

  // 驗證中文姓名
  if (!/[\u4E00-\u9FFF]/.test(name)) {
    return res.status(400).json({ error: "姓名必須包含中文字符" });
  }

  // 驗證電話格式
  if (!/^\d{8}$/.test(phone)) {
    return res.status(400).json({ error: "請輸入有效的 8 位電話號碼" });
  }

  // 驗證電郵格式（選填，如有填寫則需有效）
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "請輸入有效的電子郵件地址" });
  }

  // 驗證帳戶名和密碼不能相同（大小寫不敏感）
  if (username.toLowerCase() === password.toLowerCase()) {
    return res.status(400).json({ error: "帳戶名和密碼不能相同", field: "password" });
  }

  // 🔒 密碼強度檢查（公開註冊一律為客人層級）
  const registerPwResult = validatePassword(password, 'customer');
  if (!registerPwResult.ok) {
    return res.status(400).json({ error: registerPwResult.error, field: "password" });
  }

  // 檢查重複 - 根據有無電郵調整查詢（用戶名大小寫不敏感）
  let checkQuery, checkParams;
  if (email) {
    checkQuery = "SELECT id, username, password, phone, email FROM users WHERE username=? COLLATE NOCASE OR phone=? OR email=?";
    checkParams = [username, phone, email];
  } else {
    checkQuery = "SELECT id, username, password, phone FROM users WHERE username=? COLLATE NOCASE OR phone=?";
    checkParams = [username, phone];
  }

  db.get(checkQuery, checkParams, (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      
      if (row) {
        if (row.username.toLowerCase() === username.toLowerCase()) {
          // 若密碼也相同，視為該用戶名及密碼組合已被使用
          if (password && verifyPassword(password, row.password)) {
            return res.status(400).json({ error: "已經有人使用", field: "username" });
          }
          return res.status(400).json({ error: "用戶名已存在", field: "username" });
        }
        if (row.phone === phone) return res.status(400).json({ error: "電話號碼已被使用", field: "phone" });
        if (email && row.email === email) return res.status(400).json({ error: "電子郵件已被使用", field: "email" });
      }

      const hashedPassword = hashPassword(password);
      db.run(
        "INSERT INTO users (username, password, name, name_en, phone, email, role, profile_completed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [username, hashedPassword, name, name_en || "", phone, email || "", "customer", 0],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ ok: true, userId: this.lastID });
        }
      );
    }
  );
});

// 從 cookie 取得 captchaId（與 auth router 一致）
const getCaptchaIdFromRequest = (req) => {
  const header = req.headers.cookie || '';
  const match = header.match(/(?:^|;\s*)captcha_id=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
};

// 登入（向後兼容 /api/login，需驗證碼）
app.post("/api/login", (req, res) => {
  const { username, password, captchaAnswer } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "請提供用戶名和密碼" });
  }

  // 🔒 驗證 CAPTCHA（防機械人繞過新登入保護）
  const captchaId = getCaptchaIdFromRequest(req);
  const captchaResult = captchaService.verifyCaptcha(captchaId, captchaAnswer);
  if (!captchaResult.ok) {
    return res.status(400).json({ error: captchaResult.error || '驗證碼錯誤', field: 'captcha' });
  }

  db.get(
    "SELECT id, username, name, name_en, phone, email, role, profile_completed, must_change_password, created_at, password FROM users WHERE username=?",
    [username],
    (err, user) => {
      if (err) return res.status(500).json({ error: "系統錯誤" });
      if (!user) return res.status(401).json({ error: "登入失敗，請檢查用戶名和密碼" });

      const isPasswordValid = verifyPassword(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ error: "登入失敗，請檢查用戶名和密碼" });
      }

      // 🆕 檢查未完成資料的用戶是否已過期（3天）
      if (user.profile_completed === 0 && user.created_at) {
        const createdAt = new Date(user.created_at);
        const now = new Date();
        const daysPassed = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
        
        if (daysPassed >= 3) {
          // 自動刪除過期用戶
          db.run("DELETE FROM users WHERE id=?", [user.id], (deleteErr) => {
            if (deleteErr) console.error("刪除過期用戶失敗:", deleteErr);
            else console.log(`🗑️ 已自動刪除過期用戶: ${user.username} (ID: ${user.id})`);
          });
          return res.status(401).json({ 
            error: "您的賬戶因未在 3 天內完成個人資料而被自動取消，請重新註冊。",
            expired: true
          });
        }
        
        // 計算剩餘天數
        const daysRemaining = 3 - daysPassed;
        const { password: _pwd1, must_change_password: _mcp1, ...userWithoutPassword1 } = user;
        // 設定 Session Cookie（保護病歷檔案上傳區）
        if (signSession) {
          res.cookie('clinic_session', signSession(user.id), {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: 30 * 24 * 60 * 60 * 1000,
          });
        }
        // 🔑 發行 JWT Token
        const token = jwt.signToken({
          userId: user.id,
          role: user.role,
          username: user.username,
        });
        return res.json({ 
          ok: true, 
          user: { ...userWithoutPassword1, days_remaining: daysRemaining },
          token,
          mustChangePassword: _mcp1 === 1,
        });
      }

      const { password: _pwd2, must_change_password: _mcp2, ...userWithoutPassword2 } = user;
      // 設定 Session Cookie
      if (signSession) {
        res.cookie('clinic_session', signSession(user.id), {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });
      }
      // 🔑 發行 JWT Token
      const token2 = jwt.signToken({
        userId: user.id,
        role: user.role,
        username: user.username,
      });
      res.json({ ok: true, user: userWithoutPassword2, token: token2, mustChangePassword: _mcp2 === 1 });
    }
  );
});

// 已登入用戶更改密碼（向後兼容 /api/reset-password-authenticated）
// 已登入用戶修改密碼（需登入，只准改自己的密碼）
app.post("/api/reset-password-authenticated", requireAuth, (req, res) => {
  const { username, newPassword, confirmPassword } = req.body;
  
  if (!username || !newPassword) {
    return res.status(400).json({ error: "缺少必要欄位" });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: "兩次輸入的密碼不一致" });
  }

  // 🔒 密碼強度檢查（按登入者角色分層）
  const pwResult = validatePassword(newPassword, req.user.role);
  if (!pwResult.ok) {
    return res.status(400).json({ error: pwResult.error, field: "password" });
  }

  // 只允許修改自己的密碼（以 JWT 身份為準，防止越權重置他人密碼）
  if (String(req.user.username).toLowerCase() !== String(username).toLowerCase()) {
    return res.status(403).json({ error: "無權限修改此帳戶的密碼" });
  }

  // 根據 username 查找用戶
  db.get("SELECT id FROM users WHERE username=? COLLATE NOCASE", [username], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(404).json({ error: "用戶不存在" });

    const hashedPassword = hashPassword(newPassword);
    db.run("UPDATE users SET password=?, must_change_password=0 WHERE id=?", [hashedPassword, user.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true, message: "密碼已更新" });
    });
  });
});

// 註冊可用性檢查（即時顯示「已經有人使用」）
// 注意：必須在 miscRoutes 之前定義，以確保正確匹配
app.get("/api/register/check", (req, res) => {
  const { username } = req.query;
  if (!username) return res.json({ available: true });

  db.get("SELECT username FROM users WHERE username=? COLLATE NOCASE", [username], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });

    if (!row) return res.json({ available: true });

    return res.json({ available: false, reason: "username_taken" });
  });
});

// 雜項路由（聊天、時間、FAQ、假期等）
// 路徑前綴: /api
// 注意：這個必須在向後兼容路由之後，以避免路由衝突
app.use('/api', miscRoutes(db, getLocalTimeString, { requireAuth, requireRole }));

// 取得所有用戶（向後兼容 /api/users，限管理員）— 含會員層級 / 保險 / 遲到統計
app.get("/api/users", requireAuth, requireRole('admin'), (req, res) => {
  db.all(`
    SELECT u.id, u.username, u.name, u.name_en, u.phone, u.email, u.role, u.profile_completed, u.created_at,
           u.membership_tier, u.insurance_covered, u.family_head_id,
           (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id AND b.lateness_minutes > 0) AS late_count,
           (SELECT COALESCE(SUM(b.lateness_minutes), 0) FROM bookings b WHERE b.user_id = u.id AND b.lateness_minutes > 0) AS late_total_minutes,
           (SELECT b.appointment_date || ' ' || b.appointment_time || '（遲到 ' || b.lateness_minutes || ' 分鐘）'
              FROM bookings b WHERE b.user_id = u.id AND b.lateness_minutes > 0
              ORDER BY b.appointment_date DESC, b.appointment_time DESC LIMIT 1) AS last_late_record
    FROM users u ORDER BY u.created_at DESC
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    // 計算每個用戶的剩餘天數（未完成資料的用戶）
    const now = new Date();
    const usersWithStatus = rows.map(user => {
      if (user.profile_completed === 0 && user.created_at) {
        const createdAt = new Date(user.created_at);
        const daysPassed = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
        const daysRemaining = Math.max(0, 3 - daysPassed);
        return { ...user, days_remaining: daysRemaining, is_expired: daysRemaining === 0 };
      }
      return { ...user, days_remaining: null, is_expired: false };
    });

    res.json(usersWithStatus);
  });
});

// 時段查詢（向後兼容 /api/timeslots）
app.get("/api/timeslots", async (req, res) => {
  const { date, service_id } = req.query;

  // 營業時段由 clinic_settings 讀取（預設 10:00-19:00），每 30 分鐘一格
  const t2m = (t) => { const p = String(t).split(':').map(Number); return p[0] * 60 + (p[1] || 0); };
  const m2t = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const getSetting = (key) => new Promise((resolve) => {
    db.get("SELECT setting_value FROM clinic_settings WHERE setting_key=?", [key], (e, r) => resolve(r ? r.setting_value : null));
  });
  const morningStart = t2m(await getSetting('morning_start') || '10:00');
  const morningEnd = t2m(await getSetting('morning_end') || '14:00');
  const aftStart = t2m(await getSetting('afternoon_start') || '14:00');
  const aftEnd = t2m(await getSetting('afternoon_end') || '19:00');
  const slotInterval = parseInt(await getSetting('slot_interval'), 10) || 30;
  const timeSlots = [];
  for (let m = morningStart; m < morningEnd; m += slotInterval) timeSlots.push(m2t(m));
  for (let m = aftStart; m < aftEnd; m += slotInterval) timeSlots.push(m2t(m));

  if (!date) {
    return res.json({ timeSlots: timeSlots.map(t => ({ time: t, available: true })) });
  }

  // 查詢已被預約的時段
  db.all(
    "SELECT appointment_time, COUNT(*) as count FROM bookings WHERE appointment_date=? AND status='confirmed' GROUP BY appointment_time",
    [date],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      // 查詢時段設定
      db.all(
        "SELECT time, is_available, max_capacity, current_bookings FROM time_slots WHERE date=?",
        [date],
        (err, slotSettings) => {
          if (err) return res.status(500).json({ error: err.message });

          const bookedMap = {};
          rows.forEach(r => { bookedMap[r.appointment_time] = r.count; });

          const settingsMap = {};
          slotSettings.forEach(s => {
            settingsMap[s.time] = {
              isAvailable: s.is_available === 1,
              maxCapacity: s.max_capacity,
              currentBookings: s.current_bookings
            };
          });

          const result = timeSlots.map(t => {
            const booked = bookedMap[t] || 0;
            const setting = settingsMap[t];
            
            if (setting) {
              return {
                time: t,
                available: setting.isAvailable && booked < setting.maxCapacity,
                bookedCount: booked,
                maxCapacity: setting.maxCapacity
              };
            }
            
            return {
              time: t,
              available: booked < 3,
              bookedCount: booked,
              maxCapacity: 3
            };
          });

          res.json({ timeSlots: result });
        }
      );
    }
  );
});

// 時段管理（向後兼容）
app.get("/api/time-slots/:date", (req, res) => {
  const { date } = req.params;

  // 營業時段由 clinic_settings 讀取（預設 10:00-19:00）
  const t2m = (t) => { const p = String(t).split(':').map(Number); return p[0] * 60 + (p[1] || 0); };
  const m2t = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const timeSlots = [];
  for (let m = 600; m < 840; m += 30) timeSlots.push(m2t(m));  // 10:00 - 14:00
  for (let m = 840; m < 1140; m += 30) timeSlots.push(m2t(m)); // 14:00 - 19:00

  db.all(
    "SELECT * FROM time_slots WHERE date=?",
    [date],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      const settingsMap = {};
      rows.forEach(r => {
        settingsMap[r.time] = {
          isAvailable: r.is_available === 1,
          maxCapacity: r.max_capacity,
          currentBookings: r.current_bookings,
          notes: r.notes
        };
      });

      const result = timeSlots.map(t => {
        const setting = settingsMap[t];
        if (setting) {
          return {
            time: t,
            ...setting
          };
        }
        return {
          time: t,
          isAvailable: true,
          maxCapacity: 3,
          currentBookings: 0,
          notes: ""
        };
      });

      res.json({ date, timeSlots: result });
    }
  );
});

// 更新時段（限管理員）
app.put("/api/time-slots", requireAuth, requireRole('admin'), (req, res) => {
  const { date, time, isAvailable, maxCapacity, notes } = req.body;

  db.run(
    `INSERT OR REPLACE INTO time_slots (date, time, is_available, max_capacity, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
    [date, time, isAvailable ? 1 : 0, maxCapacity || 3, notes || ""],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true });
    }
  );
});

// 批量更新時段（限管理員）
app.post("/api/time-slots/batch", requireAuth, requireRole('admin'), (req, res) => {
  const { date, slots } = req.body;

  if (!date || !slots || !Array.isArray(slots)) {
    return res.status(400).json({ error: "缺少必要參數" });
  }

  const stmt = db.prepare(
    `INSERT OR REPLACE INTO time_slots (date, time, is_available, max_capacity, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))`
  );

  slots.forEach(slot => {
    stmt.run(date, slot.time, slot.isAvailable ? 1 : 0, slot.maxCapacity || 3, slot.notes || "");
  });

  stmt.finalize((err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, updated: slots.length });
  });
});

// 診所設定（向後兼容）
app.get("/api/clinic-settings", (req, res) => {
  db.all("SELECT setting_key, setting_value FROM clinic_settings", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const settings = {};
    rows.forEach(row => {
      settings[row.setting_key] = row.setting_value;
    });
    
    res.json(settings);
  });
});

// 更新診所設定（限管理員）
app.put("/api/clinic-settings", requireAuth, requireRole('admin'), (req, res) => {
  const settings = req.body;
  const updates = Object.entries(settings);
  
  if (updates.length === 0) {
    return res.status(400).json({ error: "沒有提供設定" });
  }

  const stmt = db.prepare(
    "INSERT OR REPLACE INTO clinic_settings (setting_key, setting_value, updated_at) VALUES (?, ?, datetime('now', 'localtime'))"
  );

  updates.forEach(([key, value]) => {
    stmt.run(key, String(value));
  });

  stmt.finalize((err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

// API 設定（向後兼容）——只公開非敏感欄位，過濾 token/key/密碼
app.get("/api/api-settings", (req, res) => {
  const SAFE_KEYS = ['ai_consultation_enabled', 'email_notification_enabled', 'sms_notification_enabled', 'whatsapp_notification_enabled'];
  db.all("SELECT setting_key, setting_value FROM api_settings", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const settings = {};
    rows.forEach(row => {
      if (SAFE_KEYS.includes(row.setting_key)) {
        settings[row.setting_key] = row.setting_value;
      }
    });
    
    res.json(settings);
  });
});

// 更新 API 設定（限管理員）
app.put("/api/api-settings", requireAuth, requireRole('admin'), (req, res) => {
  const settings = req.body;
  const updates = Object.entries(settings);
  
  if (updates.length === 0) {
    return res.status(400).json({ error: "沒有提供設定" });
  }

  const stmt = db.prepare(
    "INSERT OR REPLACE INTO api_settings (setting_key, setting_value, updated_at) VALUES (?, ?, datetime('now', 'localtime'))"
  );

  updates.forEach(([key, value]) => {
    stmt.run(key, String(value));
  });

  stmt.finalize((err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

// 醫師管理（向後兼容）
app.get("/api/doctors", (req, res) => {
  db.all("SELECT * FROM doctors WHERE is_active=1 ORDER BY id", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 新增醫師（限管理員）
app.post("/api/doctors", requireAuth, requireRole('admin'), (req, res) => {
  const { name, specialty } = req.body;
  if (!name || !specialty) {
    return res.status(400).json({ error: "缺少必要欄位" });
  }

  db.run(
    "INSERT INTO doctors (name, specialty, is_active) VALUES (?, ?, 1)",
    [name, specialty],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true, id: this.lastID });
    }
  );
});

// 更新醫師（限管理員）
app.put("/api/doctors/:id", requireAuth, requireRole('admin'), (req, res) => {
  const { id } = req.params;
  const { name, specialty, is_active } = req.body;

  db.run(
    "UPDATE doctors SET name=?, specialty=?, is_active=? WHERE id=?",
    [name, specialty, is_active ? 1 : 0, id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true });
    }
  );
});

// 刪除醫師（限管理員）
app.delete("/api/doctors/:id", requireAuth, requireRole('admin'), (req, res) => {
  const { id } = req.params;

  db.run("UPDATE doctors SET is_active=0 WHERE id=?", [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

// 🔒 CORS 錯誤處理（拒絕跨域請求）
app.use((err, req, res, next) => {
  if (err && err.message === 'Origin not allowed') {
    return res.status(403).json({ error: '跨域請求已被拒絕' });
  }
  if (err) {
    console.error('伺服器錯誤:', err);
    return res.status(500).json({ error: '系統錯誤，請稍後再試' });
  }
  next();
});

// ==================== 啟動伺服器 ====================

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                   🏥 寶天醫館預約系統                      ║
╠════════════════════════════════════════════════════════════╣
║  伺服器已啟動：http://localhost:${PORT}                      ║
║  管理後台：http://localhost:${PORT}/admin.html               ║
╠════════════════════════════════════════════════════════════╣
║  📁 專案結構（已模組化）：                                  ║
║     ├── config/db.js        資料庫配置                     ║
║     ├── services/email.js   電郵服務                       ║
║     ├── services/holidays.js 假期計算                      ║
║     └── routes/                                            ║
║         ├── auth.js         認證路由                       ║
║         ├── users.js        用戶路由                       ║
║         ├── bookings.js     預約路由                       ║
║         ├── admin.js        管理員路由                     ║
║         ├── settings.js     設定路由                       ║
║         ├── ai.js           AI問診路由                     ║
║         └── misc.js         雜項路由                       ║
╚════════════════════════════════════════════════════════════╝
  `);
});
