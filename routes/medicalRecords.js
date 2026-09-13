const { serverError } = require('../services/httpResp');
﻿
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// 允許的檔案 MIME 類型白名單（只限圖片；音頻功能已取消，只保留相片）
const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/heic', 'image/heif', 'image/tiff'];
const FILE_EXT_MAP = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/tiff': '.tiff',
};

// 配置 multer 用於檔案上傳（只允許圖片，檔名由伺服器生成防止路徑注入；音頻已取消）
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads/medical_records');
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const ext = FILE_EXT_MAP[file.mimetype] || '';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});
const upload = multer({
  storage: storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE.includes(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error('不允許的檔案類型：只可上傳圖片'));
  },
});
// 只允許圖片上傳（音頻功能已取消）
const uploadFields = upload.fields([
  { name: 'photos', maxCount: 10 },
]);

module.exports = (db, getLocalTimeString, { requireAuth, requireRole } = {}) => {

  // 中間件：驗證 JWT 身份 + 角色（取代原本可偽造的 x-user-id header）
  const authorizeRole = (roles) => (req, res, next) => {
    requireAuth(req, res, (err) => {
      if (err) return next(err);
      requireRole(...roles)(req, res, next);
    });
  };

  // 🔒 產權守衛：醫師只可以處理自己名下嘅預約／病歷（職員、管理員不受限）
  //    與 bookings.js 狀態更新嘅守衛邏輯一致
  const doctorOwnsTarget = async (req, bookingId, recordDoctorUserId) => {
    const myId = Number(req.userId ?? (req.user && req.user.id));
    if (recordDoctorUserId != null) return Number(recordDoctorUserId) === myId;
    if (!bookingId) return false;
    const bk = await new Promise((resolve) => {
      db.get("SELECT doctor_user_id, doctor_name FROM bookings WHERE id=?", [bookingId], (e, r) => resolve(r || null));
    });
    if (!bk) return true; // 預約已唔存在，交由後續邏輯報錯
    if (bk.doctor_user_id != null) return Number(bk.doctor_user_id) === myId;
    return bk.doctor_name === req.user.name;
  };

  // 取得某病歷的照片清單
  const getPhotos = (recordId) => new Promise((resolve, reject) => {
    db.all(
      "SELECT id, photo_file_path, created_at FROM medical_record_photos WHERE medical_record_id=? ORDER BY created_at ASC, id ASC",
      [recordId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });

  // 為一批病歷附加 photos 欄位
  const attachPhotos = async (records) => {
    return await Promise.all(records.map(async (r) => {
      const photos = await getPhotos(r.id);
      return { ...r, photos };
    }));
  };

  // 儲存上傳的照片至資料庫
  const savePhotos = (medicalRecordId, files) => {
    if (!files || !Array.isArray(files) || files.length === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const insert = (i) => {
        if (i >= files.length) return resolve();
        const filePath = `/uploads/medical_records/${files[i].filename}`;
        db.run(
          "INSERT INTO medical_record_photos (medical_record_id, photo_file_path) VALUES (?, ?)",
          [medicalRecordId, filePath],
          (err) => {
            if (err) return reject(err);
            insert(i + 1);
          }
        );
      };
      insert(0);
    });
  };

  // 醫師上傳病歷與相片 (需要 doctor 角色；音頻已取消)
  router.post('/doctor/records', authorizeRole(['doctor', 'staff', 'admin']), uploadFields, async (req, res) => {
    const { booking_id, user_id, diagnosis, treatment_plan, notes, metric_name, current_value, target_value, progress_score } = req.body;
    const audio_file_path = null; // 音頻功能已取消，一律不寫入
    const photoFiles = (req.files && req.files.photos) || [];

    if (!booking_id || !user_id || !diagnosis || !treatment_plan) {
      return res.status(400).json({ error: '缺少必要的病歷欄位' });
    }

    // 🔒 醫師只可以為自己名下嘅預約寫病歷
    if (req.user && req.user.role === 'doctor') {
      const owns = await doctorOwnsTarget(req, booking_id, null);
      if (!owns) return res.status(403).json({ error: '醫師只可以為自己嘅預約撰寫病歷' });
    }

    // 🔒 病歷醫師欄：優先用預約上嘅醫師；staff/admin 代寫時唔好污染成自己 id
    let doctor_user_id = req.userId;
    const bookingRow = await new Promise((resolve) => {
      db.get("SELECT doctor_user_id FROM bookings WHERE id=?", [booking_id], (e, r) => resolve(r || null));
    });
    if (req.user && req.user.role !== 'doctor') {
      if (req.body.doctor_user_id) {
        doctor_user_id = Number(req.body.doctor_user_id);
      } else if (bookingRow && bookingRow.doctor_user_id) {
        doctor_user_id = Number(bookingRow.doctor_user_id);
      }
    }

    try {
      const recordDate = getLocalTimeString().split(' ')[0]; // 只取日期部分

      // 插入 medical_records
      const medicalRecordId = await new Promise((resolve, reject) => {
        db.run(
          "INSERT INTO medical_records (booking_id, user_id, doctor_user_id, record_date, diagnosis, treatment_plan, notes, audio_file_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [booking_id, user_id, doctor_user_id, recordDate, diagnosis, treatment_plan, notes, audio_file_path],
          function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
          }
        );
      });

      // 儲存相片
      await savePhotos(medicalRecordId, photoFiles);

      // 如果有進度數據，插入 treatment_progress
      if (metric_name && current_value) {
        await new Promise((resolve, reject) => {
          db.run(
            "INSERT INTO treatment_progress (medical_record_id, progress_date, metric_name, current_value, target_value, progress_score, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [medicalRecordId, recordDate, metric_name, current_value, target_value, progress_score, notes],
            function(err) {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      }

      res.json({ ok: true, message: '病歷和療程進度已成功上傳', medicalRecordId });
    } catch (error) {
      console.error('上傳病歷失敗:', error.message);
      res.status(500).json({ error: '上傳病歷失敗' }); console.error('❌ medicalRecords 錯誤:', error);
    }
  });

  // 醫師查看某次預約的病歷 (需要 doctor 角色)
  router.get('/doctor/booking/:booking_id', authorizeRole(['doctor', 'staff', 'admin']), async (req, res) => {
    const { booking_id } = req.params;
    // 🔒 醫師只可讀取自己名下預約嘅病歷（staff/admin 可讀全部）
    if (req.user && req.user.role === 'doctor') {
      const owns = await doctorOwnsTarget(req, booking_id, null);
      if (!owns) return res.status(403).json({ error: '醫師只可以查看自己預約嘅病歷' });
    }
    try {
      const records = await new Promise((resolve, reject) => {
        db.all(
          "SELECT mr.*, u.name as customer_name FROM medical_records mr JOIN users u ON mr.user_id = u.id WHERE mr.booking_id=? ORDER BY mr.record_date DESC",
          [booking_id],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      const withProgress = await Promise.all(records.map(async (r) => {
        const progress = await new Promise((resolve, reject) => {
          db.all(
            "SELECT tp.* FROM treatment_progress tp WHERE tp.medical_record_id=? ORDER BY tp.progress_date ASC, tp.id ASC",
            [r.id],
            (err, rows) => {
              if (err) reject(err);
              else resolve(rows || []);
            }
          );
        });
        return { ...r, progress };
      }));

      const withPhotos = await attachPhotos(withProgress);

      res.json({ ok: true, data: withPhotos });
    } catch (error) {
      console.error('取得預約病歷失敗:', error.message);
      res.status(500).json({ error: '取得病歷失敗' }); console.error('❌ medicalRecords 錯誤:', error);
    }
  });

  // 醫師更新病歷 (需要 doctor 角色；音頻已取消，不再接受新錄音)
  router.put('/doctor/records/:record_id', authorizeRole(['doctor', 'staff', 'admin']), uploadFields, async (req, res) => {
    const { record_id } = req.params;
    const { diagnosis, treatment_plan, notes } = req.body;
    const photoFiles = (req.files && req.files.photos) || [];

    if (!record_id) {
      return res.status(400).json({ error: '缺少病歷 ID' });
    }

    try {
      const existing = await new Promise((resolve, reject) => {
        db.get("SELECT * FROM medical_records WHERE id=?", [record_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!existing) {
        return res.status(404).json({ error: '病歷不存在' });
      }

      // 🔒 醫師只可以修改自己撰寫嘅病歷
      if (req.user && req.user.role === 'doctor') {
        const owns = await doctorOwnsTarget(req, existing.booking_id, existing.doctor_user_id);
        if (!owns) return res.status(403).json({ error: '醫師只可以修改自己嘅病歷' });
      }

      const updatedAudio = existing.audio_file_path; // 音頻已取消：保留舊值不覆寫，亦不再接受新錄音
      const updatedDiagnosis = (diagnosis !== undefined && diagnosis !== null) ? diagnosis : existing.diagnosis;
      const updatedTreatment = (treatment_plan !== undefined && treatment_plan !== null) ? treatment_plan : existing.treatment_plan;
      const updatedNotes = (notes !== undefined && notes !== null) ? notes : existing.notes;

      await new Promise((resolve, reject) => {
        db.run(
          "UPDATE medical_records SET diagnosis=?, treatment_plan=?, notes=?, audio_file_path=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
          [updatedDiagnosis, updatedTreatment, updatedNotes, updatedAudio, record_id],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      // 儲存新增的相片
      await savePhotos(record_id, photoFiles);

      res.json({ ok: true, message: '病歷已更新', medicalRecordId: record_id });
    } catch (error) {
      console.error('更新病歷失敗:', error.message);
      res.status(500).json({ error: '更新病歷失敗' }); console.error('❌ medicalRecords 錯誤:', error);
    }
  });

  // 醫師刪除病歷相片 (需要 doctor 角色)
  router.delete('/doctor/records/:record_id/photos/:photo_id', authorizeRole(['doctor', 'staff', 'admin']), async (req, res) => {
    const { record_id, photo_id } = req.params;
    try {
      const photo = await new Promise((resolve, reject) => {
        db.get("SELECT * FROM medical_record_photos WHERE id=? AND medical_record_id=?", [photo_id, record_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      if (!photo) {
        return res.status(404).json({ error: '相片不存在' });
      }
      // 刪除實體檔案
      const filePath = path.join(__dirname, '..', photo.photo_file_path);
      fs.unlink(filePath, () => {}); // 忽略刪檔失敗（檔案可能已不存在）
      await new Promise((resolve, reject) => {
        db.run("DELETE FROM medical_record_photos WHERE id=?", [photo_id], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      res.json({ ok: true, message: '相片已刪除' });
    } catch (error) {
      console.error('刪除相片失敗:', error.message);
      res.status(500).json({ error: '刪除相片失敗' }); console.error('❌ medicalRecords 錯誤:', error);
    }
  });

  // 客戶查看自己的全部病歷連療程進度 (需要 customer 角色)
  router.get('/customer/history', authorizeRole(['customer']), async (req, res) => {
    const user_id = req.userId;
    try {
      const records = await new Promise((resolve, reject) => {
        db.all(
          "SELECT mr.*, COALESCE(u.name, b.doctor_name) as doctor_name, b.appointment_date, b.appointment_time, s.name as service_name FROM medical_records mr LEFT JOIN users u ON mr.doctor_user_id = u.id LEFT JOIN bookings b ON mr.booking_id = b.id LEFT JOIN services s ON b.service_id = s.id WHERE mr.user_id=? ORDER BY mr.record_date DESC, mr.id DESC",
          [user_id],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      const withProgress = await Promise.all(records.map(async (r) => {
        const progress = await new Promise((resolve, reject) => {
          db.all(
            "SELECT tp.* FROM treatment_progress tp WHERE tp.medical_record_id=? ORDER BY tp.progress_date ASC, tp.id ASC",
            [r.id],
            (err, rows) => {
              if (err) reject(err);
              else resolve(rows || []);
            }
          );
        });
        return { ...r, progress };
      }));

      const withPhotos = await attachPhotos(withProgress);

      res.json({ ok: true, data: withPhotos });
    } catch (error) {
      console.error('取得客戶病歷歷史失敗:', error.message);
      res.status(500).json({ error: '取得病歷失敗' }); console.error('❌ medicalRecords 錯誤:', error);
    }
  });

  // 醫師新增療程進度到指定病歷 (需要 doctor 角色)
  router.post('/doctor/records/:record_id/progress', authorizeRole(['doctor', 'staff', 'admin']), async (req, res) => {
    const { record_id } = req.params;
    const { metric_name, current_value, target_value, progress_score, notes } = req.body;

    if (!record_id) {
      return res.status(400).json({ error: '缺少病歷 ID' });
    }
    if (!metric_name || (current_value === undefined || current_value === null)) {
      return res.status(400).json({ error: '需要 metric_name 與 current_value' });
    }

    try {
      const existing = await new Promise((resolve, reject) => {
        db.get("SELECT * FROM medical_records WHERE id=?", [record_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!existing) {
        return res.status(404).json({ error: '病歷不存在' });
      }

      const recordDate = getLocalTimeString().split(' ')[0];

      await new Promise((resolve, reject) => {
        db.run(
          "INSERT INTO treatment_progress (medical_record_id, progress_date, metric_name, current_value, target_value, progress_score, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [record_id, recordDate, metric_name, current_value, target_value || null, progress_score || null, notes || ''],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      res.json({ ok: true, message: '療程進度已新增', medicalRecordId: record_id });
    } catch (error) {
      console.error('新增療程進度失敗:', error.message);
      res.status(500).json({ error: '新增療程進度失敗' }); console.error('❌ medicalRecords 錯誤:', error);
    }
  });

  // 客戶查看自己的病歷 (需要 customer 角色)
  router.get('/customer/records', authorizeRole(['customer']), (req, res) => {
    const user_id = req.userId;

    db.all(
      "SELECT mr.*, u.name as doctor_name, b.appointment_date, b.appointment_time FROM medical_records mr JOIN users u ON mr.doctor_user_id = u.id JOIN bookings b ON mr.booking_id = b.id WHERE mr.user_id=? ORDER BY mr.record_date DESC",
      [user_id],
      (err, records) => {
        if (err) return serverError(res, err);
        res.json({ ok: true, data: records });
      }
    );
  });

  // 客戶查看單一病歷的療程進度 (需要 customer 角色)
  router.get('/customer/records/:record_id/progress', authorizeRole(['customer']), (req, res) => {
    const user_id = req.userId;
    const { record_id } = req.params;

    db.all(
      "SELECT tp.* FROM treatment_progress tp JOIN medical_records mr ON tp.medical_record_id = mr.id WHERE mr.id=? AND mr.user_id=? ORDER BY tp.progress_date ASC",
      [record_id, user_id],
      (err, progress) => {
        if (err) return serverError(res, err);
        res.json({ ok: true, data: progress });
      }
    );
  });

  // 客戶下載錄音檔案 — 已取消（音頻功能停用，只保留相片）
  // （原有 GET /customer/records/:record_id/audio 端點已移除）

  // 新增：依 booking 取得該客戶的病歷與進度（需要 customer 角色）
  router.get('/customer/booking/:booking_id', authorizeRole(['customer']), async (req, res) => {
    const user_id = req.userId;
    const { booking_id } = req.params;

    try {
      const records = await new Promise((resolve, reject) => {
        db.all(
          "SELECT mr.*, COALESCE(u.name, b.doctor_name) as doctor_name, b.appointment_date, b.appointment_time FROM medical_records mr LEFT JOIN users u ON mr.doctor_user_id = u.id JOIN bookings b ON mr.booking_id = b.id WHERE mr.booking_id=? AND mr.user_id=? ORDER BY mr.record_date DESC",
          [booking_id, user_id],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      // 對找到的每一筆病歷抓進度
      const withProgress = await Promise.all(records.map(async (r) => {
        const progress = await new Promise((resolve, reject) => {
          db.all(
            "SELECT tp.* FROM treatment_progress tp WHERE tp.medical_record_id=? ORDER BY tp.progress_date ASC",
            [r.id],
            (err, rows) => {
              if (err) reject(err);
              else resolve(rows || []);
            }
          );
        });
        return { ...r, progress };
      }));

      const withPhotos = await attachPhotos(withProgress);

      res.json({ ok: true, data: withPhotos });
    } catch (error) {
      console.error('取得 booking 病歷失敗:', error.message);
      res.status(500).json({ error: '取得病歷失敗' }); console.error('❌ medicalRecords 錯誤:', error);
    }
  });

  // 新增：客戶新增/記錄療程進度 (會自動建立 minimal medical_record 如果不存在)
  router.post('/customer/bookings/:booking_id/progress', authorizeRole(['customer']), async (req, res) => {
    const user_id = req.userId;
    const { booking_id } = req.params;
    const { metric_name, current_value, target_value, progress_score, notes } = req.body;

    if (!metric_name || (current_value === undefined || current_value === null)) {
      return res.status(400).json({ error: '需要 metric_name 與 current_value' });
    }

    try {
      // 檢查是否有 medical_record
      const medicalRecord = await new Promise((resolve, reject) => {
        db.get("SELECT * FROM medical_records WHERE booking_id=? AND user_id=? ORDER BY record_date DESC", [booking_id, user_id], (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        });
      });

      let medicalRecordId = medicalRecord ? medicalRecord.id : null;
      const recordDate = getLocalTimeString().split(' ')[0];

      if (!medicalRecordId) {
        // 取得預約的醫師，若預約有 doctor_user_id 則記錄之
        const booking = await new Promise((resolve, reject) => {
          db.get("SELECT doctor_user_id FROM bookings WHERE id=?", [booking_id], (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
          });
        });

        // 建立 minimal 的 medical_record
        medicalRecordId = await new Promise((resolve, reject) => {
          db.run(
            "INSERT INTO medical_records (booking_id, user_id, doctor_user_id, record_date, diagnosis, treatment_plan, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [booking_id, user_id, (booking && booking.doctor_user_id) || null, recordDate, '自動建立', '', notes || ''],
            function(err) {
              if (err) reject(err);
              else resolve(this.lastID);
            }
          );
        });
      }

      // 插入 treatment_progress
      await new Promise((resolve, reject) => {
        db.run(
          "INSERT INTO treatment_progress (medical_record_id, progress_date, metric_name, current_value, target_value, progress_score, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [medicalRecordId, recordDate, metric_name, current_value, target_value || null, progress_score || null, notes || ''],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      res.json({ ok: true, message: '療程進度已記錄', medicalRecordId });
    } catch (error) {
      console.error('記錄療程進度失敗:', error.message);
      res.status(500).json({ error: '記錄療程進度失敗' }); console.error('❌ medicalRecords 錯誤:', error);
    }
  });

  // 本地規則式 AI：根據病歴內容分析康復進度 1-10 分
  const aiAnalyzeRecord = (record, photos, progress) => {
    const diagnosis = (record.diagnosis || '').toLowerCase();
    const treatment = (record.treatment_plan || '').toLowerCase();
    const notes = (record.notes || '').toLowerCase();
    const text = `${diagnosis} ${treatment} ${notes}`;

    const negativeKeywords = ['惡化', '加劇', '未好轉', '無改善', '冇好轉', '唔好', '反覆', '復發', '嚴重', '劇痛', '持續疼痛', '加重', '感染', '發炎', '腫脹', '癌症', '癌', '惡性', '擴散', '昏迷', '危急', '急症'];
    const positiveKeywords = ['好轉', '改善', '康復', '恢復', '減輕', '緩解', '穩定', '見效', '進展', '好咗', '好左', '痊愈', '痊癒', '正常', '無礙', '冇事', '減退', '消退'];
    const engagementKeywords = ['復診', '跟進', '持續', '療程', '完成', '按時', '配合', '覆診'];

    let neg = 0, pos = 0, eng = 0;
    negativeKeywords.forEach(k => { if (text.includes(k)) neg++; });
    positiveKeywords.forEach(k => { if (text.includes(k)) pos++; });
    engagementKeywords.forEach(k => { if (text.includes(k)) eng++; });

    // 基礎分 5
    let score = 5;
    const reasons = [];

    // 嚴重關鍵字：每個 -1.5
    if (neg > 0) {
      score -= neg * 1.5;
      reasons.push(`病歴內容出現 ${neg} 個負面訊號（如：${negativeKeywords.filter(k => text.includes(k)).slice(0, 3).join('、')}）`);
    }

    // 正面關鍵字：每個 +1
    if (pos > 0) {
      score += pos * 1;
      reasons.push(`病歴內容出現 ${pos} 個康復訊號（如：${positiveKeywords.filter(k => text.includes(k)).slice(0, 3).join('、')}）`);
    }

    // 治療配合度：每個 +0.5
    if (eng > 0) {
      score += eng * 0.5;
      reasons.push(`治療方案顯示有 ${eng} 項跟進/療程訊號`);
    }

    // 相片記錄：可輔助評估，每張 +0.2（上限 +1）
    if (photos && photos.length > 0) {
      const boost = Math.min(1, photos.length * 0.2);
      score += boost;
      reasons.push(`已上傳 ${photos.length} 張問題相片，有助觀察病情進展`);
    }

    // 已有進度記錄則參考（不重複扣分，純參考）
    if (progress && progress.length > 0) {
      const latest = progress[progress.length - 1];
      const latestScore = Number(latest.progress_score || latest.current_value || 0);
      score = (score + latestScore) / 2;
      reasons.push('參考了既有療程進度記錄');
    }

    // 夾在 1-10
    score = Math.max(1, Math.min(10, Math.round(score)));

    let levelLabel;
    if (score <= 3) levelLabel = '情況較差，建議持續治療';
    else if (score <= 6) levelLabel = '中度，正在恢復中';
    else levelLabel = '良好，康復進展理想';

    return { score, levelLabel, reasons };
  };

  // AI 分析病歴康復進度（管理員/醫師/員工可分析任何病歴，客戶僅限自己的）
  router.post('/records/:record_id/ai-analyze', authorizeRole(['customer', 'doctor', 'staff', 'admin']), async (req, res) => {
    const { record_id } = req.params;

    try {
      const record = await new Promise((resolve, reject) => {
        db.get("SELECT * FROM medical_records WHERE id=?", [record_id], (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        });
      });

      if (!record) return res.status(404).json({ error: '病歷不存在' });

      // 客戶只能分析自己的病歴
      if (req.user.role === 'customer' && String(record.user_id) !== String(req.userId)) {
        return res.status(403).json({ error: '無權限分析此病歷' });
      }

      const photos = await getPhotos(record_id);
      const progress = await new Promise((resolve, reject) => {
        db.all(
          "SELECT tp.* FROM treatment_progress tp WHERE tp.medical_record_id=? ORDER BY tp.progress_date ASC, tp.id ASC",
          [record_id],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      const result = aiAnalyzeRecord(record, photos, progress.filter(p => p.metric_name !== 'AI 評估'));

      // 同步：將 AI 建議進度寫入 treatment_progress，令「我的預約」追蹤與「我的病歴」一致
      const recordDate = getLocalTimeString().split(' ')[0];
      const aiNotes = result.levelLabel + (result.reasons.length > 0 ? '\n' + result.reasons.join('\n') : '');
      const existingAI = await new Promise((resolve, reject) => {
        db.get("SELECT id FROM treatment_progress WHERE medical_record_id=? AND metric_name='AI 評估'", [record_id], (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        });
      });

      if (existingAI) {
        await new Promise((resolve, reject) => {
          db.run(
            "UPDATE treatment_progress SET progress_score=?, current_value=?, notes=?, progress_date=? WHERE id=?",
            [result.score, String(result.score), aiNotes, recordDate, existingAI.id],
            function (err) {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      } else {
        await new Promise((resolve, reject) => {
          db.run(
            "INSERT INTO treatment_progress (medical_record_id, progress_date, metric_name, current_value, target_value, progress_score, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [record_id, recordDate, 'AI 評估', String(result.score), null, result.score, aiNotes],
            function (err) {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      }

      res.json({ ok: true, data: result });
    } catch (error) {
      console.error('AI 分析病歴失敗:', error.message);
      res.status(500).json({ error: 'AI 分析病歴失敗' }); console.error('❌ medicalRecords 錯誤:', error);
    }
  });

  // ==================== 🏥 員工／管理員：病歷記錄管理（全店所有客戶） ====================

  // GET /api/medical-records/admin/all — 列出全部客戶病歷（含客戶/醫師/預約資訊＋進度＋相片）
  // 支援篩選：q（客戶姓名／會員ID／診斷關鍵字）、doctor（醫師 user_id 或姓名）、from、to（就診日期 YYYY-MM-DD）、limit
  router.get('/admin/all', authorizeRole(['admin', 'staff']), async (req, res) => {
    const { q, doctor, from, to } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);

    try {
      const conds = [];
      const params = [];
      if (q && String(q).trim()) {
        conds.push("(cu.name LIKE ? OR cu.username LIKE ? OR mr.diagnosis LIKE ? OR mr.treatment_plan LIKE ?)");
        const like = `%${String(q).trim()}%`;
        params.push(like, like, like, like);
      }
      if (doctor && String(doctor).trim()) {
        conds.push("(CAST(mr.doctor_user_id AS TEXT)=? OR du.name LIKE ? OR mr.booking_doctor_name LIKE ?)");
        params.push(String(doctor).trim(), `%${String(doctor).trim()}%`, `%${String(doctor).trim()}%`);
      }
      if (from) { conds.push("COALESCE(b.appointment_date, mr.record_date) >= ?"); params.push(String(from)); }
      if (to) { conds.push("COALESCE(b.appointment_date, mr.record_date) <= ?"); params.push(String(to)); }
      const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

      const records = await new Promise((resolve, reject) => {
        db.all(
          `SELECT mr.*, cu.name AS customer_name, cu.username AS customer_username,
                  cu.hide_from_head, cu.birth_date,
                  du.name AS doctor_user_name, b.appointment_date, b.appointment_time,
                  b.doctor_name AS booking_doctor_name, s.name AS service_name
             FROM medical_records mr
             LEFT JOIN users cu ON mr.user_id = cu.id
             LEFT JOIN users du ON mr.doctor_user_id = du.id
             LEFT JOIN bookings b ON mr.booking_id = b.id
             LEFT JOIN services s ON b.service_id = s.id
             ${where}
            ORDER BY COALESCE(b.appointment_date, mr.record_date) DESC, mr.id DESC
            LIMIT ?`,
          [...params, limit],
          (err, rows) => (err ? reject(err) : resolve(rows || []))
        );
      });

      const withProgress = await Promise.all(records.map(async (r) => {
        const progress = await new Promise((resolve) => {
          db.all(
            "SELECT tp.* FROM treatment_progress tp WHERE tp.medical_record_id=? ORDER BY tp.progress_date ASC, tp.id ASC",
            [r.id],
            (err, rows) => resolve(err ? [] : (rows || []))
          );
        });
        return { ...r, progress, doctor_name: r.doctor_user_name || r.booking_doctor_name || '—' };
      }));

      const withPhotos = await attachPhotos(withProgress);
      // 🔒 私隱：子帳戶已開「唔俾主帳戶睇」且成年 → 醫護列表亦過濾（尊重病人選擇）
      const ageOf = (bd) => { if (!bd) return 0; const b = new Date(bd); if (isNaN(b.getTime())) return 0; const n = new Date(); let a = n.getFullYear() - b.getFullYear(); const m = n.getMonth() - b.getMonth(); if (m < 0 || (m === 0 && n.getDate() < b.getDate())) a--; return a; };
      const visible = withPhotos.filter(r => !(r.hide_from_head === 1 && ageOf(r.birth_date) >= 18));
      res.json({ ok: true, total: visible.length, data: visible });
    } catch (error) {
      console.error('取得全部病歷失敗:', error.message);
      res.status(500).json({ error: '取得病歷失敗' }); console.error('❌ medicalRecords 錯誤:', error);
    }
  });

  // GET /api/medical-records/admin/records/:record_id/audio — 已取消（音頻功能停用，只保留相片）

  return router;
};
