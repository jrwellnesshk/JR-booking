const { serverError } = require("../services/httpResp");
/**
 * AI 問診路由
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

module.exports = (db, { requireAuth } = {}) => {

  // 🔒 AI 分流寫入限速（防未登入用戶灌爆 ai_consultation_logs）
  const aiWriteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: '查詢次數過多，請稍後再試' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // 取得症狀分類列表
  router.get("/categories", requireAuth, (req, res) => {
    const lang = req.query.lang || 'zh_hant';
    db.all("SELECT * FROM symptom_categories ORDER BY id", [], (err, rows) => {
      if (err) return serverError(res, err);
      
      const categories = rows.map(row => ({
        id: row.id,
        name_zh_hant: row.name_zh_hant,
        name_en: row.name_en,
        description_zh_hant: row.description_zh_hant,
        description_en: row.description_en,
        icon: row.icon
      }));
      
      res.json({ categories });
    });
  });

  // 開始問診（取得第一個問題）
  router.post("/start-consultation", requireAuth, aiWriteLimiter, (req, res) => {
    const { category_id, lang = 'zh_hant' } = req.body;
    
    if (!category_id) {
      return res.status(400).json({ error: "缺少 category_id" });
    }

    // 生成 session ID
    const session_id = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 取得第一個問題
    db.get(
      "SELECT * FROM ai_questions WHERE category_id=? ORDER BY question_order LIMIT 1",
      [category_id],
      (err, question) => {
        if (err) return serverError(res, err);
        if (!question) return res.status(404).json({ error: "找不到問題" });

        // 取得該問題的答案選項
        db.all(
          "SELECT * FROM ai_answer_options WHERE question_id=?",
          [question.id],
          (err, options) => {
            if (err) return serverError(res, err);

            res.json({
              session_id,
              category_id,
              question: {
                id: question.id,
                question_zh_hant: question.question_zh_hant,
                question_zh_hans: question.question_zh_hans,
                question_en: question.question_en,
                question_type: question.question_type,
                question_order: question.question_order
              },
              options: options.map(opt => ({
                id: opt.id,
                option_zh_hant: opt.option_zh_hant,
                option_zh_hans: opt.option_zh_hans,
                option_en: opt.option_en,
                severity_score: opt.severity_score
              }))
            });
          }
        );
      }
    );
  });

  // 提交答案並取得下一題
  router.post("/submit-answer", requireAuth, aiWriteLimiter, (req, res) => {
    const { session_id, category_id, question_id, option_ids, lang = 'zh_hant' } = req.body;

    if (!session_id || !question_id || !option_ids) {
      return res.status(400).json({ error: "缺少必要參數" });
    }

    const optionIds = Array.isArray(option_ids) ? option_ids : [option_ids];

    // 記錄答案並計算分數
    let totalScore = 0;
    let nextQuestionId = null;
    let processedCount = 0;

    optionIds.forEach((optionId, index) => {
      db.get(
        "SELECT * FROM ai_answer_options WHERE id=?",
        [optionId],
        (err, option) => {
          if (!err && option) {
            totalScore += option.severity_score;
            if (index === 0) nextQuestionId = option.next_question_id;

            // 記錄到日誌
            db.run(
              "INSERT INTO ai_consultation_logs (session_id, category_id, question_id, answer_option_id, score) VALUES (?, ?, ?, ?, ?)",
              [session_id, category_id, question_id, optionId, option.severity_score]
            );
          }

          processedCount++;

          // 所有選項都處理完畢
          if (processedCount === optionIds.length) {
            // 如果有下一題
            if (nextQuestionId) {
              db.get(
                "SELECT * FROM ai_questions WHERE id=?",
                [nextQuestionId],
                (err, nextQuestion) => {
                  if (err) return serverError(res, err);
                  if (!nextQuestion) {
                    // 沒有下一題，返回結束狀態
                    return res.json({
                      completed: true,
                      score: totalScore,
                      session_id
                    });
                  }

                  // 取得下一題的選項
                  db.all(
                    "SELECT * FROM ai_answer_options WHERE question_id=?",
                    [nextQuestionId],
                    (err, options) => {
                      if (err) return serverError(res, err);

                      res.json({
                        completed: false,
                        score: totalScore,
                        session_id,
                        question: {
                          id: nextQuestion.id,
                          question_zh_hant: nextQuestion.question_zh_hant,
                          question_zh_hans: nextQuestion.question_zh_hans,
                          question_en: nextQuestion.question_en,
                          question_type: nextQuestion.question_type,
                          question_order: nextQuestion.question_order,
                          is_critical: nextQuestion.is_critical
                        },
                        options: options.map(opt => ({
                          id: opt.id,
                          option_zh_hant: opt.option_zh_hant,
                          option_zh_hans: opt.option_zh_hans,
                          option_en: opt.option_en,
                          severity_score: opt.severity_score
                        }))
                      });
                    }
                  );
                }
              );
            } else {
              // 沒有下一題，返回結束狀態
              res.json({
                completed: true,
                score: totalScore,
                session_id
              });
            }
          }
        }
      );
    });
  });

  // 取得建議結果
  router.get("/get-recommendation", requireAuth, (req, res) => {
    const { session_id, category_id, lang = 'zh_hant' } = req.query;

    // 🆕 缺 session_id 時回熱門症狀/推薦列表（唔好 400 整死前端）
    if (!session_id) {
      db.all(
        "SELECT category_id, recommendation_zh_hant, recommendation_en, urgency_level FROM ai_recommendations ORDER BY category_id ASC LIMIT 10",
        [],
        (err, recs) => {
          if (err) return serverError(res, err);
          return res.json({
            ok: true,
            fallback: true,
            message: "請選擇症狀分類或直接預約初體驗服務",
            popular_recommendations: recs || [],
            recommendation: {
              zh_hant: "請揀選下方症狀，我哋會根據你嘅情況推薦合適嘅服務。",
              en: "Please select a symptom below for more accurate recommendations."
            }
          });
        }
      );
      return;
    }

    // 計算該 session 的總分
    db.all(
      "SELECT SUM(score) as total_score FROM ai_consultation_logs WHERE session_id=?",
      [session_id],
      (err, rows) => {
        if (err) return serverError(res, err);

        const totalScore = rows[0]?.total_score || 0;

        // 根據分數和分類取得建議
        db.get(
          "SELECT * FROM ai_recommendations WHERE category_id=? AND min_score<=? AND max_score>=?",
          [category_id, totalScore, totalScore],
          (err, recommendation) => {
            if (err) return serverError(res, err);

            if (!recommendation) {
              return res.json({
                score: totalScore,
                recommendation: {
                  zh_hant: "根據您的症狀，建議諮詢專業醫師。",
                  en: "Based on your symptoms, please consult a professional doctor."
                },
                urgency_level: "normal",
                show_booking_button: true
              });
            }

            res.json({
              score: totalScore,
              recommendation: {
                zh_hant: recommendation.recommendation_zh_hant,
                en: recommendation.recommendation_en
              },
              urgency_level: recommendation.urgency_level,
              show_booking_button: recommendation.show_booking_button === 1
            });
          }
        );
      }
    );
  });

  return router;
};
