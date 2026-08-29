/**
 * 通知管理路由
 * 包括：通知設定、節日管理、發送記錄、測試發送
 */

const express = require('express');
const router = express.Router();

module.exports = (db, notificationScheduler, { requireAuth, requireRole } = {}) => {

  // 公開端點：即將到來的節氣/節日資訊
  const PUBLIC_PATHS = ['/solar-terms/upcoming', '/holidays/upcoming'];

  // 除公開端點外，其餘通知管理路由均需管理員權限
  router.use((req, res, next) => {
    if (PUBLIC_PATHS.includes(req.path)) return next();
    return requireAuth(req, res, (err) => {
      if (err) return next(err);
      requireRole('admin')(req, res, next);
    });
  });

  // ==================== 通知設定 ====================

  // 獲取通知設定
  router.get('/settings', async (req, res) => {
    try {
      const settings = await notificationScheduler.getSettings();
      res.json(settings);
    } catch (error) {
      console.error('獲取通知設定失敗:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 更新通知設定
  router.put('/settings', async (req, res) => {
    try {
      const result = await notificationScheduler.updateSettings(req.body);
      res.json(result);
    } catch (error) {
      console.error('更新通知設定失敗:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== 節日管理 ====================

  // 獲取所有節日
  router.get('/holidays', async (req, res) => {
    try {
      const holidays = await notificationScheduler.getHolidays();
      res.json(holidays);
    } catch (error) {
      console.error('獲取節日列表失敗:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 更新節日
  router.put('/holidays/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const result = await notificationScheduler.updateHoliday(id, req.body);
      res.json(result);
    } catch (error) {
      console.error('更新節日失敗:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 新增自訂節日
  router.post('/holidays', async (req, res) => {
    try {
      const result = await notificationScheduler.addHoliday(req.body);
      res.json(result);
    } catch (error) {
      console.error('新增節日失敗:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 刪除節日
  router.delete('/holidays/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const result = await notificationScheduler.deleteHoliday(id);
      res.json(result);
    } catch (error) {
      console.error('刪除節日失敗:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== 發送記錄 ====================

  // 獲取發送記錄
  router.get('/logs', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const logs = await notificationScheduler.getNotificationLogs(limit);
      res.json(logs);
    } catch (error) {
      console.error('獲取發送記錄失敗:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 刪除單條發送記錄
  router.delete('/logs/:id', async (req, res) => {
    try {
      const { id } = req.params;
      db.run('DELETE FROM notification_logs WHERE id = ?', [id], function(err) {
        if (err) {
          console.error('刪除發送記錄失敗:', err);
          return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, message: '記錄已刪除' });
      });
    } catch (error) {
      console.error('刪除發送記錄失敗:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 清空所有發送記錄
  router.delete('/logs', async (req, res) => {
    try {
      db.run('DELETE FROM notification_logs', function(err) {
        if (err) {
          console.error('清空發送記錄失敗:', err);
          return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, message: '所有記錄已清空' });
      });
    } catch (error) {
      console.error('清空發送記錄失敗:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== 測試發送 ====================

  // 發送測試通知
  router.post('/test', async (req, res) => {
    try {
      const { type, phone, message, channel } = req.body;
      
      if (!phone) {
        return res.status(400).json({ error: '請輸入電話號碼' });
      }
      
      const result = await notificationScheduler.sendTestNotification(type, phone, message, channel);
      res.json(result);
    } catch (error) {
      console.error('測試發送失敗:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== 手動執行 ====================

  // 手動執行所有通知
  router.post('/run-all', async (req, res) => {
    try {
      await notificationScheduler.runAllNotifications();
      res.json({ success: true, message: '所有通知任務已執行' });
    } catch (error) {
      console.error('執行通知任務失敗:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 手動執行節氣通知
  router.post('/run-solar-term', async (req, res) => {
    try {
      const result = await notificationScheduler.sendSolarTermNotification();
      res.json(result || { success: true, message: '節氣通知已執行' });
    } catch (error) {
      console.error('執行節氣通知失敗:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 手動執行節日通知
  router.post('/run-holiday', async (req, res) => {
    try {
      const result = await notificationScheduler.sendHolidayNotification();
      res.json(result || { success: true, message: '節日通知已執行' });
    } catch (error) {
      console.error('執行節日通知失敗:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 手動執行天氣通知
  router.post('/run-weather', async (req, res) => {
    try {
      const result = await notificationScheduler.sendWeatherNotification();
      res.json(result || { success: true, message: '天氣通知已執行' });
    } catch (error) {
      console.error('執行天氣通知失敗:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 手動執行預約提醒
  router.post('/run-booking-reminder', async (req, res) => {
    try {
      const result = await notificationScheduler.triggerBookingReminders();
      res.json(result || { success: true, message: '預約提醒已執行' });
    } catch (error) {
      console.error('執行預約提醒失敗:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== 節氣資訊 ====================

  // 獲取今年所有節氣（包含自訂訊息）
  router.get('/solar-terms', async (req, res) => {
    try {
      const terms = await notificationScheduler.getSolarTermsWithCustom();
      res.json(terms);
    } catch (error) {
      console.error('獲取節氣列表失敗:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 更新節氣自訂訊息
  router.put('/solar-terms/:name', async (req, res) => {
    try {
      const { name } = req.params;
      const result = await notificationScheduler.updateSolarTerm(decodeURIComponent(name), req.body);
      res.json(result);
    } catch (error) {
      console.error('更新節氣訊息失敗:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 重置節氣為預設訊息
  router.post('/solar-terms/:name/reset', async (req, res) => {
    try {
      const { name } = req.params;
      const result = await notificationScheduler.resetSolarTerm(decodeURIComponent(name));
      res.json(result);
    } catch (error) {
      console.error('重置節氣訊息失敗:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 獲取即將到來的節氣
  router.get('/solar-terms/upcoming', (req, res) => {
    try {
      const solarTermsService = require('../services/solar-terms');
      const terms = solarTermsService.getUpcomingSolarTerms();
      res.json(terms);
    } catch (error) {
      console.error('獲取即將到來的節氣失敗:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== 即將到來的通知 ====================

  // 獲取即將到來的節日
  router.get('/holidays/upcoming', async (req, res) => {
    try {
      const lunarHolidaysService = require('../services/lunar-holidays');
      const holidays = await notificationScheduler.getHolidays();
      const upcoming = lunarHolidaysService.getUpcomingHolidays(holidays);
      res.json(upcoming);
    } catch (error) {
      console.error('獲取即將到來的節日失敗:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== 用戶統計 ====================

  // 獲取符合條件的用戶數量
  router.get('/eligible-users/count', async (req, res) => {
    try {
      const users = await notificationScheduler.getEligibleUsers();
      res.json({
        total: users.length,
        receiveSolarTerms: users.filter(u => u.receive_solar_terms).length,
        receiveHolidays: users.filter(u => u.receive_holidays).length,
        receiveWeather: users.filter(u => u.receive_weather).length
      });
    } catch (error) {
      console.error('獲取用戶統計失敗:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
