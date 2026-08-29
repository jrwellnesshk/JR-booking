/**
 * 🔐 pm2 進程管理設定
 * 用法：
 *   pm2 start ecosystem.config.js     # 啟動（首次）
 *   pm2 save                          # 儲存進程清單
 *   pm2 startup                       # 設定開機自啟（跟畫面指示執行返回嘅命令）
 *   pm2 logs potin-clinic             # 即時日誌
 *   pm2 restart potin-clinic          # 重啟
 *   pm2 monit                         # 監控面板
 *
 * 建議另外安裝日誌輪轉模組（pm2 自身日誌）：
 *   pm2 install pm2-logrotate
 */
module.exports = {
  apps: [
    {
      name: 'potin-clinic',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,          // SQLite 單寫入者，必須 1 instance
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      watch: false,
      // 日誌：應用內 logger 已寫 logs/；pm2 這份只收 crash/異常輸出
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-err.log',
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
