# 寶天醫館預約系統 · AWS 上線手把手教學（新手版）— STORY

## ① 用戶意圖對齊
- **目標受眾**：完全冇 AWS 經驗嘅新手（診所負責人 / 小商戶），想自己將個預約網站安全放上雲端。
- **核心目標**：跟完整份教學，可以獨立喺 AWS 開一部 EC2 伺服器、裝好環境、將 寶天醫館 預約系統上線，並且做到基本安全同備份。
- **PPT 長度**：18 頁（Hero 頁佔 4 頁：封面、兩個章節扉頁、結語）。
- **視覺調性**：溫柔專業 / 地球綠 spa 感 / 步驟清晰 / 預警醒目。
- **內容邊界**：必講——先決條件、整體架構、費用預警、開帳號、建 EC2、連接、裝 Node、上傳代碼+.env 安全、PM2、Nginx+HTTPS+網域、安全強化、備份、上線清單、救火。禁碰——RDS 深層調校、CI/CD、容器編排（只提升級路徑）。

## ② 頁面佈局骨架
- 總頁數 18；章節扉頁 2 個（第 6、10 頁），與目錄 2 章一一對應。
- 章節契約：目錄第 1 章 → 第 6 頁扉頁（階段一：開帳號與建立伺服器，涵蓋 7-9）；目錄第 2 章 → 第 10 頁扉頁（階段二：安裝環境與正式上線，涵蓋 11-17）。
- Hero / 節奏：封面(peak)→目錄(valley)→先決條件(valley)→架構(peak)→費用(peak)→[6 章節 transition]→7-9(valley)→[10 章節 transition]→11-14(valley)→15 安全(peak)→16-17(valley)→18 結語(peak)。
- 非對稱版式佔多數（≥40%）；N 卡片橫排只喺第 15 頁用 1 次。

## ③ 頁面大綱
| # | title | type | role | rhythm | layout | visual | visual_role | density | anti_pattern |
| :- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 01 | 封面 | cover | hero | peak | 全屏視覺+大標題 | L1 雲端+診所主視覺 | anchor | 30字/1圖/35% | 禁止裝飾小圖 |
| 02 | 目錄 | catalog | supporting | valley | 左標題+右內容 | — | — | 120字 | 禁止四卡預覽 |
| 03 | 你需要準備嘅嘢 | content | supporting | valley | 非對稱雙欄 | FAIcon 清單 | evidence | 320字 | 禁止等寬卡片 |
| 04 | 整體架構圖 | content | hero | peak | 左大圖+右文字 | L1 架構 SVG | anchor | 260字 | 禁止 L3 頂替 L1 |
| 05 | 費用預估與免費層預警 | content | hero | peak | 圖表+洞察 | 費用表 | evidence | 240字 | 禁止等寬卡 |
| 06 | 第1章 開帳號與建立伺服器 | section | transition | transition | 章節大字 | L3 編號 | atmosphere | 40字 | 禁止鋪滿正文 |
| 07 | 開 AWS 帳號與設定付款 | content | supporting | valley | 左標題+右內容 | FAIcon 步驟 | evidence | 300字 | 禁止對稱雙欄 |
| 08 | 建立 EC2 實例 | content | supporting | valley | 非對稱雙欄 | 小 SVG 示意 | evidence | 340字 | 禁止 N 卡 |
| 09 | 連接 EC2（瀏覽器免裝） | content | supporting | valley | 左標題+右內容 | FAIcon 步驟 | evidence | 260字 | 禁止對稱 |
| 10 | 第2章 安裝環境與正式上線 | section | transition | transition | 章節大字 | L3 編號 | atmosphere | 40字 | 禁止鋪滿 |
| 11 | 安裝 Node.js 與系統依賴 | content | supporting | valley | 左標題+右內容 | CodeBlock | evidence | 220字/1碼 | 禁止對稱 |
| 12 | 上傳代碼與 .env 安全設定 | content | supporting | valley | 非對稱雙欄 | 左碼右警示 | evidence | 300字/1碼 | 禁止同11版式 |
| 13 | PM2 常駐與開機自啟 | content | supporting | valley | 左標題+右內容 | CodeBlock | evidence | 240字/1碼 | 禁止同12 |
| 14 | Nginx 反向代理 + HTTPS + 網域 | content | supporting | valley | 非對稱雙欄 | 左碼右步驟 | evidence | 320字/1碼 | 禁止同13 |
| 15 | 安全強化與資料備份 | content | hero | peak | 卡片組 | 警示卡 | anchor | 360字 | 禁止等寬卡濫用 |
| 16 | 上線前檢查清單 | content | supporting | valley | 左標題+右內容 | 勾選清單 | evidence | 300字 | 禁止對稱 |
| 17 | 常見問題救火與維運指令 | content | supporting | valley | 非對稱雙欄 | 左 Q 右指令 | evidence | 340字 | 禁止同16 |
| 18 | 重要預警總結與結語 | ending | hero | peak | 全屏視覺+大標題 | L1 總結卡 | anchor | 200字 | 禁止裝飾小圖 |
