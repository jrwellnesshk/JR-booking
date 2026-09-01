/**
 * HTTP 回應輔助
 * serverError：將真錯誤寫入 log（經 console -> logger 落檔），但回傳俾用戶嘅係通用訊息，
 * 避免將內部 SQL／路徑／檔案細節洩漏俾客戶端。
 */
const serverError = (res, err, fallback = '系統錯誤，請稍後再試') => {
  console.error('❌ API 500:', err && (err.stack || err.message) ? (err.stack || err.message) : err);
  if (!res.headersSent) {
    return res.status(500).json({ error: fallback });
  }
  return res;
};

module.exports = { serverError };
