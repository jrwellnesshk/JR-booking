/**
 * 認證相關路由
 * 包括：註冊、登入、忘記密碼、重設密碼（支持電郵和 SMS）
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const emailService = require('../services/email');
const captchaService = require('../services/captcha');
const jwt = require('../services/jwt');
const { validatePassword } = require('../services/passwordPolicy');

// ℹ️ SMS 已全面取消；密碼重設驗證碼經 WhatsApp／電郵發送

// WhatsApp 服務 - 根據環境變數選擇（密碼重設驗證碼改經 WhatsApp 發送）
const whatsappProvider = process.env.WHATSAPP_PROVIDER || 'twilio';
let whatsappService;
if (whatsappProvider === 'android') {
  whatsappService = require('../services/whatsapp-android');
} else if (whatsappProvider === '360dialog') {
  whatsappService = require('../services/whatsapp-360dialog');
} else {
  whatsappService = require('../services/whatsapp');
}

// 速率限制配置（保留作為額外保護）
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // 每 15 分鐘最多 20 次登入嘗試（防暴力破解）
  message: { error: "請求過於頻繁，請稍後再試" },
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分鐘
  max: 30, // 放寬 IP 限制，因為我們已有驗證碼冷卻時間機制
  message: { error: "密碼重置請求過於頻繁，請稍後再試" },
  standardHeaders: true,
  legacyHeaders: false,
});

const verifyEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "驗證嘗試次數過多，請稍後再試" },
  standardHeaders: true,
  legacyHeaders: false,
});

// 生成 6 位數驗證碼
const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// 🆕 登入失敗鎖定配置
const MAX_LOGIN_ATTEMPTS = 5;        // 最大登入失敗次數
const LOCKOUT_DURATION_MINUTES = 10; // 鎖定時間（分鐘）

// 🆕 驗證碼發送限制配置
const VERIFICATION_CODE_COOLDOWN_MINUTES = 1; // 同一電郵驗證碼冷卻時間（分鐘）

module.exports = (db, hashPassword, verifyPassword, signSession, { requireAuth, requireRole } = {}) => {

  // 取得驗證碼（登入/註冊用）- captchaId 以 httpOnly cookie 綁定
  router.get("/captcha", (req, res) => {
    const { id, svg } = captchaService.createCaptcha();
    res.cookie('captcha_id', id, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 5 * 60 * 1000, // 5 分鐘
    });
    res.type('image/svg+xml');
    res.setHeader('Cache-Control', 'no-store');
    res.send(svg);
  });

  // 內部工具：從 cookie 取得 captchaId
  const getCaptchaId = (req) => {
    const header = req.headers.cookie || '';
    const match = header.match(/(?:^|;\s*)captcha_id=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  };


  // 🆕 檢查帳戶是否被鎖定（🔒 以 帳戶+IP 組合計算，防止攻擊者惡意鎖死任何客戶嘅帳戶）
  // ⏱️ 一併計埋剩餘鎖定分鐘數，等用戶知要等幾耐
  const checkAccountLocked = (username, ipAddress) => {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as failedAttempts,
                CAST(CEIL((julianday(MIN(attempt_time), '+${LOCKOUT_DURATION_MINUTES} minutes') - julianday('now')) * 24 * 60) AS INTEGER) as minutesRemaining
         FROM login_attempts
         WHERE username = ? AND ip_address = ? AND success = 0
           AND attempt_time > datetime('now', '-${LOCKOUT_DURATION_MINUTES} minutes')`,
        [username, ipAddress || ''],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            const isLocked = row.failedAttempts >= MAX_LOGIN_ATTEMPTS;
            resolve({
              isLocked,
              failedAttempts: row.failedAttempts,
              minutesRemaining: isLocked ? Math.max(1, row.minutesRemaining || 1) : 0
            });
          }
        }
      );
    });
  };

  // 🆕 記錄登入嘗試
  const recordLoginAttempt = (username, success, ipAddress) => {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO login_attempts (username, success, ip_address) VALUES (?, ?, ?)`,
        [username, success ? 1 : 0, ipAddress],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  };

  // 🆕 登入成功後清除該組合的失敗記錄
  const clearFailedAttempts = (username, ipAddress) => {
    return new Promise((resolve) => {
      db.run(
        `DELETE FROM login_attempts WHERE username = ? AND ip_address = ? AND success = 0`,
        [username, ipAddress || ''],
        () => resolve()
      );
    });
  };

  // 🆕 檢查電郵驗證碼冷卻時間
  const checkVerificationCodeCooldown = (email) => {
    return new Promise((resolve, reject) => {
      // 使用 SQLite 的 datetime 函數進行比較
      db.get(
        `SELECT sent_at FROM verification_code_logs 
         WHERE email = ? AND datetime(sent_at) > datetime('now', '-${VERIFICATION_CODE_COOLDOWN_MINUTES} minutes')
         ORDER BY sent_at DESC LIMIT 1`,
        [email],
        (err, row) => {
          if (err) {
            console.error("檢查驗證碼冷卻時間錯誤:", err);
            reject(err);
          } else if (row) {
            // 計算剩餘時間
            const sentAt = new Date(row.sent_at + 'Z'); // 加 Z 確保解析為 UTC
            const cooldownEnd = new Date(sentAt.getTime() + VERIFICATION_CODE_COOLDOWN_MINUTES * 60 * 1000);
            const remainingMs = cooldownEnd.getTime() - Date.now();
            const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
            
            console.log(`🚫 電郵 ${email} 在冷卻中，剩餘 ${remainingMinutes} 分鐘`);
            resolve({
              canSend: false,
              remainingMinutes: remainingMinutes
            });
          } else {
            resolve({ canSend: true });
          }
        }
      );
    });
  };

  // 🆕 記錄驗證碼發送
  const recordVerificationCodeSent = (email, ipAddress) => {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO verification_code_logs (email, ip_address) VALUES (?, ?)`,
        [email, ipAddress],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  };

  // 用戶註冊
  router.post("/register", async (req, res) => {
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
    const captchaId = getCaptchaId(req);
    const captchaResult = captchaService.verifyCaptcha(captchaId, captchaAnswer);
    if (!captchaResult.ok) {
      return res.status(400).json({ error: captchaResult.error || '驗證碼錯誤', field: 'captcha' });
    }

    console.log("📝 註冊請求:", { username, name, name_en, phone, email, hasPassword: !!password });
    
    // 驗證必填欄位（電話必填，電郵選填）
    if (!username || !password || !name || !phone) {
      console.log("❌ 缺少必要欄位:", { username: !!username, password: !!password, name: !!name, phone: !!phone });
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
    const pwResult = validatePassword(password, 'customer');
    if (!pwResult.ok) {
      return res.status(400).json({ error: pwResult.error, field: "password" });
    }

    // 檢查重複 - 根據有無電郵調整查詢（包括姓名唯一性檢查，用戶名大小寫不敏感）
    let checkQuery, checkParams;
    if (email) {
      checkQuery = "SELECT id, username, password, name, phone, email FROM users WHERE username=? COLLATE NOCASE OR name=? OR phone=? OR email=?";
      checkParams = [username, name, phone, email];
    } else {
      checkQuery = "SELECT id, username, password, name, phone FROM users WHERE username=? COLLATE NOCASE OR name=? OR phone=?";
      checkParams = [username, name, phone];
    }
    
    db.get(checkQuery, checkParams, (err, row) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        if (row) {
          if (row.username.toLowerCase() === username.toLowerCase()) {
            // 若密碼也相同，視為該用戶名及密碼組合已被使用
            if (password && verifyPassword(password, row.password)) {
              return res.status(400).json({ error: "已經有人使用", field: "username" });
            }
            return res.status(400).json({ error: "用戶名已存在，無法註冊", field: "username" });
          }
          if (row.name === name) {
            return res.status(400).json({ error: "該姓名已被使用，無法註冊", field: "name" });
          }
          if (row.phone === phone) {
            return res.status(400).json({ error: "該電話號碼已被使用，無法註冊", field: "phone" });
          }
          if (email && row.email === email) {
            return res.status(400).json({ error: "該電子郵件已被使用，無法註冊", field: "email" });
          }
        }

        // 進行註冊
        const hashedPassword = hashPassword(password);
        db.run(
          "INSERT INTO users (username, password, name, name_en, phone, email, role, profile_completed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [username, hashedPassword, name, name_en || "", phone, email || "", "customer", 0],
          function (err) {
            if (err) {
              if (err.message.includes("UNIQUE")) {
                return res.status(400).json({ error: "用戶資料衝突，無法註冊" });
              }
              return res.status(500).json({ error: err.message });
            }
            
            // 發送歡迎郵件（只有有電郵才發送）
            if (email) {
              emailService.sendWelcomeEmail(email, username, name).catch(err => {
                console.error('發送歡迎郵件失敗:', err);
              });
            }
            
            res.json({ ok: true, userId: this.lastID });
          }
        );
      }
    );
  });

  // 用戶登入（含帳戶鎖定機制）
  router.post("/login", loginLimiter, async (req, res) => {
    const { username, password, captchaAnswer, portal } = req.body;
    const clientIP = req.ip || req.connection.remoteAddress;

    // 🆕 入口角色映射：登入 tab → 允許嘅角色（嚴格分隔）
    // 員工 tab 同時接受 staff 同 admin（後台管理員經員工入口登入）
    const PORTAL_ROLES = { customer: ['customer'], doctor: ['doctor'], staff: ['staff', 'admin'], admin: ['admin'] };
    const ROLE_NAMES = { admin: '管理員', doctor: '醫師', staff: '員工', customer: '客戶' };
    
    if (!username || !password) {
      return res.status(400).json({ error: "請提供用戶名和密碼" });
    }

    // 🔒 驗證 CAPTCHA（防機械人登入）
    const captchaId = getCaptchaId(req);
    const captchaResult = captchaService.verifyCaptcha(captchaId, captchaAnswer);
    if (!captchaResult.ok) {
      return res.status(400).json({ error: captchaResult.error || '驗證碼錯誤', field: 'captcha' });
    }

    try {
      // 🆕 檢查帳戶是否被鎖定
      const lockStatus = await checkAccountLocked(username, clientIP);
      if (lockStatus.isLocked) {
        return res.status(429).json({
          error: `登入失敗次數過多，帳戶已被鎖定。請約 ${lockStatus.minutesRemaining} 分鐘後再試`,
          locked: true,
          remainingMinutes: lockStatus.minutesRemaining
        });
      }

      db.get(
        "SELECT id, username, name, name_en, phone, email, role, profile_completed, must_change_password, password FROM users WHERE username=?",
        [username],
        async (err, user) => {
          if (err) return res.status(500).json({ error: "系統錯誤，請稍後再試" });
          
          if (!user) {
            // 記錄失敗嘗試（即使用戶不存在也記錄，防止用戶枚舉）
            await recordLoginAttempt(username, false, clientIP);
            const newStatus = await checkAccountLocked(username, clientIP);
            const remainingAttempts = MAX_LOGIN_ATTEMPTS - newStatus.failedAttempts;
            
            return res.status(401).json({ 
              error: "登入失敗，請檢查您的用戶名和密碼",
              remainingAttempts: remainingAttempts > 0 ? remainingAttempts : 0
            });
          }

          const isPasswordValid = verifyPassword(password, user.password);
          
          if (!isPasswordValid) {
            // 🆕 記錄登入失敗
            await recordLoginAttempt(username, false, clientIP);
            const newStatus = await checkAccountLocked(username, clientIP);
            const remainingAttempts = MAX_LOGIN_ATTEMPTS - newStatus.failedAttempts;
            
            if (newStatus.isLocked) {
              return res.status(429).json({
                error: `登入失敗次數過多，帳戶已被鎖定。請約 ${newStatus.minutesRemaining} 分鐘後再試`,
                locked: true,
                remainingMinutes: newStatus.minutesRemaining
              });
            }
            
            return res.status(401).json({ 
              error: `登入失敗，請檢查您的用戶名和密碼。剩餘 ${remainingAttempts} 次嘗試機會`,
              remainingAttempts: remainingAttempts
            });
          }

          // 🆕 入口角色驗證：按登入 tab 限制可登入嘅角色（嚴格分隔）
          if (portal && PORTAL_ROLES[portal] && !PORTAL_ROLES[portal].includes(user.role)) {
            return res.status(403).json({
              error: `請使用對應入口登入（此帳號為 ${ROLE_NAMES[user.role] || user.role}）`,
              field: 'role'
            });
          }

          // 🆕 登入成功，清除失敗記錄
          await recordLoginAttempt(username, true, clientIP);
          await clearFailedAttempts(username, clientIP);

          // 自動升級密碼為 bcrypt
          if (!user.password.startsWith('$2a$') && !user.password.startsWith('$2b$') && !user.password.startsWith('$2y$')) {
            const newHashedPassword = hashPassword(password);
            db.run("UPDATE users SET password=? WHERE id=?", [newHashedPassword, user.id], (updateErr) => {
              if (updateErr) console.error('密碼升級失敗:', updateErr.message);
              else console.log(`✅ 用戶 ${username} 的密碼已自動升級為 bcrypt`);
            });
          }

          const { password: _, must_change_password, ...userWithoutPassword } = user;
          // 設定登入 Session Cookie（保護病歷檔案上傳區）
          if (signSession) {
            res.cookie('clinic_session', signSession(user.id), {
              httpOnly: true,
              sameSite: 'lax',
              secure: process.env.NODE_ENV === 'production',
              maxAge: 30 * 24 * 60 * 60 * 1000, // 30 天
            });
          }
          // 🔑 發行 JWT Token（所有受保護 API 驗證用）
          const token = jwt.signToken({
            userId: user.id,
            role: user.role,
            username: user.username,
          });
          res.json({
            ok: true,
            user: userWithoutPassword,
            token,
            mustChangePassword: must_change_password === 1,
          });
        }
      );
    } catch (error) {
      console.error("登入錯誤:", error);
      res.status(500).json({ error: "系統錯誤，請稍後再試" });
    }
  });

  // 登出（將 token 加入黑名單，之後即失效）
  router.post("/logout", (req, res) => {
    const token = jwt.extractTokenFromRequest(req);
    if (token) jwt.revokeToken(token);
    res.clearCookie('clinic_session');
    res.clearCookie('captcha_id');
    res.json({ ok: true, message: "已登出" });
  });

  // 登出所有裝置（撤銷該用戶所有 token）
  router.post("/logout-all", (req, res) => {
    const token = jwt.extractTokenFromRequest(req);
    const payload = token ? jwt.verifyToken(token) : null;
    if (!payload || !payload.userId) {
      return res.status(401).json({ error: '未登入' });
    }
    jwt.revokeAllUserTokens(payload.userId);
    res.clearCookie('clinic_session');
    res.clearCookie('captcha_id');
    res.json({ ok: true, message: "已登出所有裝置" });
  });

  // 發送驗證碼（忘記密碼 - 第一步）
  router.post("/send-reset-code", verifyEmailLimiter, async (req, res) => {
    const { email } = req.body;
    const clientIP = req.ip || req.connection.remoteAddress;
    
    if (!email) {
      return res.status(400).json({ error: "請提供電子郵件地址" });
    }

    try {
      // 🆕 檢查驗證碼發送冷卻時間（1 分鐘內不能重複發送）
      const cooldownStatus = await checkVerificationCodeCooldown(email);
      if (!cooldownStatus.canSend) {
        return res.status(429).json({ 
          error: `此電郵已於 ${VERIFICATION_CODE_COOLDOWN_MINUTES} 分鐘內發送過驗證碼，請稍後再試（約 ${cooldownStatus.remainingMinutes} 分鐘後）`,
          cooldown: true,
          remainingMinutes: cooldownStatus.remainingMinutes
        });
      }

      // 查找用戶
      db.get(
        "SELECT id, username, name, email FROM users WHERE email=? AND role IN ('customer', 'user')",
        [email],
        async (err, user) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          
          if (!user) {
            // 通知用戶電郵未註冊
            return res.status(404).json({ error: "此電子郵件沒有登記" });
          }

          // 生成 6 位驗證碼
          const verificationCode = generateVerificationCode();
          const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 分鐘有效

          // 儲存驗證碼到資料庫
          db.run(
            `INSERT OR REPLACE INTO reset_tokens (token, username, expires_at, used) VALUES (?, ?, ?, 0)`,
            [verificationCode, user.username, expiresAt],
            async function(err) {
              if (err) {
                console.error("儲存驗證碼失敗:", err);
                return res.status(500).json({ error: "系統錯誤" });
              }

              // 發送驗證碼郵件
              const emailResult = await emailService.sendVerificationCode(
                user.email,
                verificationCode,
                user.name
              );

              if (emailResult.success) {
                // 🆕 記錄驗證碼發送（用於冷卻時間檢查）
                await recordVerificationCodeSent(email, clientIP);
                
                // 記錄日誌
                db.run(
                  `INSERT INTO password_reset_logs (username, action, ip_address, success, details) VALUES (?, 'send_code', ?, 1, ?)`,
                  [user.username, clientIP, '驗證碼已發送']
                );
                
                res.json({ 
                  ok: true, 
                  message: "驗證碼已發送至您的電子郵件",
                  expiresAt: expiresAt
                });
              } else {
                db.run(
                  `INSERT INTO password_reset_logs (username, action, ip_address, success, details) VALUES (?, 'send_code', ?, 0, ?)`,
                  [user.username, clientIP, '郵件發送失敗']
                );
                res.status(500).json({ error: "發送驗證碼失敗，請稍後再試" });
              }
            }
          );
        }
      );
    } catch (error) {
      console.error("發送驗證碼錯誤:", error);
      res.status(500).json({ error: "系統錯誤，請稍後再試" });
    }
  });

  // 驗證碼確認並重設密碼（忘記密碼 - 第二步）
  router.post("/reset-password-with-code", passwordResetLimiter, (req, res) => {
    const { email, code, newPassword } = req.body;
    const clientIP = req.ip || req.connection.remoteAddress;
    
    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: "請提供電郵、驗證碼和新密碼" });
    }

    // 查找用戶（同時取角色作分層密碼檢查）
    db.get(
      "SELECT id, username, role FROM users WHERE email=?",
      [email],
      (err, user) => {
        if (err || !user) {
          return res.status(400).json({ error: "用戶不存在" });
        }

        // 🔒 密碼強度檢查（按用戶角色分層）
        const codePwResult = validatePassword(newPassword, user.role);
        if (!codePwResult.ok) {
          return res.status(400).json({ error: codePwResult.error, field: "password" });
        }

        // 驗證驗證碼
        db.get(
          "SELECT * FROM reset_tokens WHERE token=? AND username=? AND used=0 AND expires_at > datetime('now')",
          [code, user.username],
          (err, token) => {
            if (err || !token) {
              db.run(
                `INSERT INTO password_reset_logs (username, action, ip_address, success, details) VALUES (?, 'verify_code', ?, 0, ?)`,
                [user.username, clientIP, '驗證碼無效或已過期']
              );
              return res.status(400).json({ error: "驗證碼無效或已過期" });
            }

            // 更新密碼
            const hashedPassword = hashPassword(newPassword);
            db.run(
              "UPDATE users SET password=?, must_change_password=0 WHERE id=?",
              [hashedPassword, user.id],
              function(err) {
                if (err) {
                  return res.status(500).json({ error: err.message });
                }

                // 標記驗證碼已使用
                db.run("UPDATE reset_tokens SET used=1 WHERE token=?", [code]);

                // 記錄日誌
                db.run(
                  `INSERT INTO password_reset_logs (username, action, ip_address, success, details) VALUES (?, 'reset_password', ?, 1, ?)`,
                  [user.username, clientIP, '密碼重設成功']
                );

                res.json({ ok: true, message: "密碼已成功重設" });
              }
            );
          }
        );
      }
    );
  });

  // 查找用戶ID（加入速率限制防止帳戶枚舉）
  router.post("/find-user-id", verifyEmailLimiter, (req, res) => {
    const { name, phone, email } = req.body;
    
    if (!name || !email) {
      return res.status(400).json({ error: "請提供姓名和電子郵件" });
    }

    let query = "SELECT username FROM users WHERE name=? AND email=? AND role IN ('customer', 'user')";
    let params = [name, email];
    
    if (phone) {
      query = "SELECT username FROM users WHERE name=? AND email=? AND phone=? AND role IN ('customer', 'user')";
      params = [name, email, phone];
    }

    db.get(query, params, (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: "找不到符合的用戶" });
      
      res.json({ ok: true, username: row.username });
    });
  });

  // 已登入用戶修改密碼（需登入，只限自己，身份以 JWT 為準）
  router.post("/change-password", requireAuth, (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.userId;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "缺少必要欄位" });
    }

    db.get("SELECT id, password, role FROM users WHERE id=?", [userId], (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(404).json({ error: "用戶不存在" });

      // 🔒 密碼強度檢查（按登入者角色分層）
      const pwResult = validatePassword(newPassword, user.role);
      if (!pwResult.ok) {
        return res.status(400).json({ error: pwResult.error, field: "password" });
      }

      if (!verifyPassword(currentPassword, user.password)) {
        return res.status(401).json({ error: "目前密碼不正確" });
      }

      // 🔒 新密碼不可與目前密碼相同
      if (newPassword === currentPassword) {
        return res.status(400).json({ error: "新密碼不可與目前密碼相同", field: "password" });
      }

      const hashedPassword = hashPassword(newPassword);
      db.run("UPDATE users SET password=?, must_change_password=0 WHERE id=?", [hashedPassword, userId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ ok: true, message: "密碼已更新" });
      });
    });
  });

  return router;
};
