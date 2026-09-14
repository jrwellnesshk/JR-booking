const { serverError } = require("../services/httpResp");
/**
 * 雜項路由
 * 包括：聊天機器人、伺服器時間、公共 FAQ 等
 */
const express = require('express');
const router = express.Router();
const { getHongKongHolidays, isHoliday, getHolidaysInRange } = require('../services/holidays');

module.exports = (db, getLocalTimeString, { requireAuth, requireRole } = {}) => {

  // AI 客服（連接外部AI）
  router.post("/chat", async (req, res) => {
    const { message } = req.body;
    if (!message) return res.json({ reply: "請輸入問題 😊" });

    console.log(`🤖 收到客戶問題: ${message}`);

    // 簡單本地回覆（備用）
    const text = message.toLowerCase();
    let reply = "感謝您的提問，我會儘快回覆。";

    if (text.includes("取消")) reply = "您可以在預約列表中按『取消預約』即可。";
    else if (text.includes("營業") || text.includes("時間")) reply = "我們營業時間為星期一至五 10:00-19:00；星期六 10:00-13:00（星期日及公眾假期休息）。";
    else if (text.includes("價") || text.includes("收費") || text.includes("費用")) 
      reply = "推拿治療 45分鐘、針灸治療 30分鐘、推拿+針灸 60分鐘、新症諮詢 30分鐘。詳細收費請致電查詢。";
    else if (text.includes("服務") || text.includes("項目")) 
      reply = "目前提供：推拿治療、針灸治療、推拿+針灸組合、新症諮詢等服務。";
    else if (text.includes("預約")) 
      reply = "您可以在首頁選擇服務後，選擇適合的時間進行預約。";
    else if (text.includes("地址") || text.includes("位置")) 
      reply = "我們位於香港島中環德輔道中61-65號華人銀行大廈10樓1002室，港鐵中環站 D2 出口步行 3 分鐘。";

    res.json({ reply });
  });

  // 取得伺服器時間
  router.get("/server-time", (req, res) => {
    res.json({ 
      serverTime: getLocalTimeString(),
      timestamp: Date.now()
    });
  });

  // 測試時間 API
  router.get("/test-time", (req, res) => {
    const now = new Date();
    const localTimeStr = getLocalTimeString();
    const jsDate = new Date();
    
    res.json({
      serverTime: localTimeStr,
      timestamp: now.getTime(),
      isoString: now.toISOString(),
      jsDateToString: jsDate.toString(),
      jsDateToLocaleString: jsDate.toLocaleString('zh-TW', { timeZone: 'Asia/Hong_Kong' })
    });
  });

  // 取得公開 FAQ 列表
  router.get("/faqs", (req, res) => {
    db.all("SELECT id, question, answer, display_order FROM faqs WHERE is_active=1 ORDER BY display_order", [], (err, rows) => {
      if (err) return serverError(res, err);
      res.json(rows);
    });
  });

  // 取得床位自訂名稱（公開）
  router.get("/beds/labels", (req, res) => {
    db.all("SELECT setting_key, setting_value FROM clinic_settings WHERE setting_key IN ('tuina_bed_names','acupuncture_bed_names','vip_bed_names')", [], (err, rows) => {
      if (err) return serverError(res, err);
      const parse = (k) => {
        const r = rows.find(x => x.setting_key === k);
        if (!r || !r.setting_value) return [];
        try { const a = JSON.parse(r.setting_value); return Array.isArray(a) ? a : []; } catch (e) { return []; }
      };
      res.json({ tuina: parse('tuina_bed_names'), vip: parse('vip_bed_names'), acupuncture: parse('acupuncture_bed_names') });
    });
  });

  // 取得服務列表（公開）
  router.get("/services", (req, res) => {
    db.all("SELECT * FROM services", [], (err, rows) => {
      if (err) return serverError(res, err);
      res.json(rows);
    });
  });

  // 修改服務（限管理員）
  router.put("/services/:id", requireAuth, requireRole('admin'), (req, res) => {
    const { id } = req.params;
    const { name, duration, price } = req.body;

    // 構建動態更新語句
    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push("name=?");
      params.push(name);
    }
    if (duration !== undefined) {
      updates.push("duration=?");
      params.push(duration);
    }
    if (price !== undefined) {
      updates.push("price=?");
      params.push(price);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "沒有提供要更新的欄位" });
    }

    params.push(id);

    db.run(`UPDATE services SET ${updates.join(", ")} WHERE id=?`, params, function (err) {
      if (err) return serverError(res, err);
      res.json({ ok: true });
    });
  });

  // === 假期 API ===
  
  // 獲取指定年份的假期
  router.get("/holidays/:year", (req, res) => {
    const { year } = req.params;
    
    try {
      const holidays = getHongKongHolidays(parseInt(year));
      res.json({ year, holidays });
    } catch (error) {
      res.status(500).json({ error: "無法獲取假期數據" });
    }
  });

  // 獲取日期範圍內的假期
  router.get("/holidays", (req, res) => {
    const { start, end } = req.query;
    
    if (!start || !end) {
      // 如果沒有指定範圍，返回當前年份和下一年的假期
      const currentYear = new Date().getFullYear();
      const holidays = [
        ...getHongKongHolidays(currentYear),
        ...getHongKongHolidays(currentYear + 1)
      ];
      return res.json({ holidays });
    }
    
    try {
      const holidays = getHolidaysInRange(start, end);
      res.json({ holidays });
    } catch (error) {
      res.status(500).json({ error: "無法獲取假期數據" });
    }
  });

  // 檢查特定日期是否為假期
  router.get("/holidays/check/:date", (req, res) => {
    const { date } = req.params;
    
    // 驗證日期格式
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "日期格式錯誤，請使用 YYYY-MM-DD" });
    }
    
    const holiday = isHoliday(date);
    res.json({ 
      date, 
      isHoliday: !!holiday, 
      holiday: holiday || null 
    });
  });

  // 完成用戶資料（需登入，只限自己）
  router.patch("/users/:username/complete-profile", requireAuth, (req, res) => {
    const { username } = req.params;

    if (req.user.username !== username) {
      return res.status(403).json({ error: "無權限操作" });
    }
    
    db.run(
      "UPDATE users SET profile_completed=1 WHERE username=?",
      [username],
      function(err) {
        if (err) return serverError(res, err);
        if (this.changes === 0) return res.status(404).json({ error: "找不到用戶" });
        res.json({ ok: true, message: "資料已完成" });
      }
    );
  });

  return router;
};
