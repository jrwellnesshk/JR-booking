// _i18n_translate.cjs — 將 curated 高頻 UI 字串翻譯成英文，寫入 js/i18n.js
// 未匹配嘅 key 維持 null（中文 fallback）。可重複執行（已譯嘅唔會覆寫，除非重設）。
const fs = require('fs');
const DICT = 'js/i18n.js';

// ===== curated 翻譯表（中文 key → 英文 value）=====
const MAP = {
  // 登入 / auth
  '登入': 'Log in', '登出': 'Log out', '帳號': 'Account', '用戶名': 'Username',
  '密碼': 'Password', '驗證碼': 'Captcha', '記住我': 'Remember me',
  '忘記密碼': 'Forgot password', '登入中…': 'Signing in…', '登入失敗': 'Login failed',
  '正在登入': 'Logging in', '歡迎回來': 'Welcome back', '請先登入': 'Please log in first',
  '提交': 'Submit', '取消': 'Cancel', '確認': 'Confirm', '確定': 'OK',
  '管理員後台': 'Admin Panel', '員工系統': 'Staff Portal', '醫師系統': 'Doctor Portal',
  '人力資源系統': 'HR System', 'HR 系統': 'HR System', '寶天醫館': 'Po Tin Clinic',
  '寶天醫館 · 人力資源管理': 'Po Tin Clinic · HR Management',
  '寶天醫館 · 醫師': 'Po Tin Clinic · Doctor', '寶天醫館 · 醫師版': 'Po Tin Clinic · Doctor Edition',
  '寶天醫館 · 醫師管理系統': 'Po Tin Clinic · Doctor Management', '醫師版面 - 寶天醫館': 'Doctor Portal - Po Tin Clinic',
  '員工登入': 'Staff Login', '寶天醫館 · 員工管理系統': 'Po Tin Clinic · Staff Management', '寶天醫館·員工管理系統': 'Po Tin Clinic · Staff Management',
  '登入帳戶': 'Log in to Account', '首次登入後系統會要求修改密碼。': 'System will require a password change after first login.',
  '目前密碼': 'Current Password', '新密碼（最少 10 字元，含英文大細階＋數字）': 'New password (min 10 chars, upper+lower case + number)',
  '更改密碼': 'Change Password', '重設並發送暫時密碼': 'Reset and send temporary password',
  '暫時密碼': 'Temporary Password', '請輸入密碼': 'Please enter password',
  // 常用動作
  '儲存': 'Save', '保存': 'Save', '儲存打卡': 'Save Clock-in', '刪除': 'Delete',
  '編輯': 'Edit', '新增': 'Add', '搜尋': 'Search', '清除': 'Clear', '關閉': 'Close',
  '重新整理': 'Refresh', '刷新': 'Refresh', '匯出': 'Export', '匯出 CSV': 'Export CSV',
  '匯入': 'Import', '查詢': 'Query', '返回': 'Back', '下一頁': 'Next', '上一頁': 'Previous',
  '全部': 'All', '套用': 'Apply', '重設': 'Reset', '上載': 'Upload', '下載': 'Download',
  '列印': 'Print', '複製': 'Copy', '檢視': 'View', '詳情': 'Details', '更多': 'More',
  '篩選': 'Filter', '查看': 'View', '提交申請': 'Submit Application', '提交假期申請': 'Submit Leave Request',
  '提交報更': 'Submit Shift', '開新客戶帳戶': 'Open New Customer Account', '新客戶': 'New Customer',
  '新增另一筆': 'Add Another', '標記完成': 'Mark Complete', '還原確認': 'Confirm Restore',
  '開啟/關閉選單': 'Open/Close Menu', '配藥中': 'Dispensing',
  // 狀態
  '啟用': 'Enabled', '停用': 'Disabled', '啟用中': 'Active', '待審批': 'Pending',
  '已審批': 'Approved', '已確認': 'Confirmed', '已完成': 'Completed', '已取消': 'Cancelled',
  '未履行': 'Not fulfilled', '處理中': 'Processing', '生效中': 'Active', '已過期': 'Expired',
  '活躍': 'Active', '非活躍': 'Inactive', '正常': 'Normal', '異常': 'Abnormal', '開放': 'Open',
  '未到場': 'No-show', '治療中': 'In Treatment',
  // 通用欄位 / 標籤
  '名稱': 'Name', '姓名': 'Full name', '客戶': 'Customer', '客戶姓名': 'Customer name',
  '員工': 'Employee', '員工名冊': 'Employee Directory', '醫師': 'Doctor', '醫師姓名': 'Doctor name',
  '日期': 'Date', '日期：': 'Date:', '時間': 'Time', '開始時間': 'Start time', '結束時間': 'End time',
  '備註': 'Remarks', '備注': 'Remarks', '原因': 'Reason', '狀態：': 'Status:', '狀態': 'Status',
  '類型': 'Type', '電話': 'Phone', '電郵': 'Email', '地址': 'Address', '性別': 'Gender',
  '年齡': 'Age', '總數': 'Total', '數量': 'Quantity', '金額': 'Amount', '價錢': 'Price',
  '收費': 'Fee', '付款方式': 'Payment Method', '支付方式': 'Payment Method', '現金': 'Cash',
  '信用卡': 'Credit card', '檔案': 'File', '附件': 'Attachment', '文件': 'Documents',
  '證書/資格': 'Certificate/Qualification', '身份證': 'ID Card', '診斷': 'Diagnosis',
  '診症錄音': 'Consultation Recording', '醫療證明': 'Medical Certificate', '病歷': 'Medical Record',
  '病歷記錄': 'Medical Records', '病歴管理': 'Medical History Management', '病歷記錄管理': 'Medical Records Management',
  '病歷管理': 'Medical Record Management', '進度': 'Progress', '進度評分 (1-10)': 'Progress Score (1-10)',
  '目標數值 (選填)': 'Target Value (optional)', '療程進度追蹤 (選填)': 'Treatment Progress Tracking (optional)',
  '登記名（可留空自動）': 'Registered Name (optional)',
  // 導航 / 區塊（admin）
  '儀表板': 'Dashboard', '預約管理': 'Booking Management', '醫師管理': 'Doctor Management',
  '客戶管理': 'Customer Management', '收入': 'Income', '收入報表': 'Income Report',
  '報表': 'Reports', '設定': 'Settings', '系統': 'System', '系統設定': 'System Settings',
  '意見反饋': 'Feedback', '排班': 'Schedule', '班次': 'Shifts', '假期': 'Leave',
  '休假': 'Leave', '員工假期': 'Employee Leave', '統計': 'Statistics', '首頁': 'Home',
  '會員': 'Membership', '訂閱': 'Subscription', '帳戶': 'Account', '個人資料': 'Profile',
  '修改密碼': 'Change password', '通知': 'Notifications', '預約': 'Booking',
  '預約列表': 'Booking List', '預約日曆': 'Booking Calendar', '預約時段管理': 'Booking Slot Management',
  '預約編號': 'Booking No.', '預約詳情': 'Booking Details', '預設本月': 'Default This Month',
  '時段': 'Time Slot', '時段管理': 'Time Slot Management', '時段網格': 'Time Slot Grid',
  '時段網格（拖掃選取）': 'Time Slot Grid (drag to select)', '日曆': 'Calendar', '月曆': 'Monthly Calendar',
  '選擇日期': 'Select Date', '選擇醫師': 'Select Doctor', '請選擇醫師': 'Please select a doctor',
  '補位醫師': 'Substitute Doctor', '補位醫師：': 'Substitute Doctor:', '醫師顏色（新增醫師會同步顯示）': 'Doctor Color (synced for new doctors)',
  'VIP房名稱': 'VIP Room Name', 'VIP房數量': 'VIP Room Count', '放假': 'Day Off',
  '排程／請假': 'Schedule/Leave', '排程': 'Schedule',
  // 收入報表區
  '系統運行': 'System Running', '系統資訊': 'System Info', 'Node.js 版本': 'Node.js Version',
  '記憶體使用': 'Memory Usage', '按日': 'By Day', '按月': 'By Month', '按年': 'By Year',
  'Excel 資料匯入': 'Excel Data Import', 'Excel 收入': 'Excel Income', 'Excel 收入紀錄': 'Excel Income Records',
  'Excel 資料匯入': 'Excel Data Import', '日期查詢': 'Date Query', '總收入': 'Total Income',
  '預約數': 'Booking Count', '應診人數': 'Patients Seen', '期間數': 'Periods',
  '一般會員（免費）': 'Standard Member (Free)', '高級會員': 'Premium Member', '家庭會員': 'Family Member',
  '每月訂閱收入（經常性）': 'Monthly Recurring Subscription Revenue', '預約參考': 'Booking Reference',
  '合計': 'Total', '暫無收入記錄': 'No income records', '暫無資料可顯示趨勢': 'No data to show trend',
  '日期／月份': 'Date/Month', '類型': 'Type', '客戶／服務': 'Customer/Service', '匯入時間': 'Import Time',
  '最近 500 筆 · 刪除後可以重新匯入同一日／月': 'Recent 500; re-import same day/month after deletion',
  '付款歷史': 'Payment History', '上次付款': 'Last Payment', '下次／到期日': 'Next / Due Date',
  '下次測試將發送：': 'Next test will send:', '不計入收入': 'Not counted as income',
  'HK$8,800 / 月': 'HK$8,800 / month', 'HK$16,800 / 月': 'HK$16,800 / month',
  // HR / 出勤
  '人力資源': 'Human Resources', '今日': 'Today', '今日冇出勤異常': 'No attendance issues today',
  '今日即時出勤狀況': "Today's Live Attendance", '來源': 'Source', '假別': 'Leave Type',
  '假別：': 'Leave Type:', '上班': 'Clock In', '上班時間': 'Clock-in Time', '下班': 'Clock Out',
  '下班時間': 'Clock-out Time', '出勤': 'Attendance', '出勤日': 'Attendance Day',
  '出勤異常': 'Attendance Anomaly', '出勤類型': 'Attendance Type', '出糧': 'Payroll',
  '事假額': 'Personal Leave Quota', '事假額（日）': 'Personal Leave Quota (days)', '事假': 'Personal Leave',
  '病假': 'Sick Leave', '年假': 'Annual Leave', '全日': 'Full Day', '半日': 'Half Day',
  '全職': 'Full-time', '兼職': 'Part-time', '全職 / 兼職': 'Full-time / Part-time', '全/兼職': 'Full/Part-time',
  '全部員工': 'All Employees', '兼職報更（待審批）': 'Part-time Shift (Pending)', '入職日期': 'Join Date',
  '回到本月': 'Back to This Month', '紅日': 'Red Day', '考勤': 'Attendance', '自助': 'Self-Service',
  '我的假期': 'My Leave', '我的考勤紀錄': 'My Attendance Records', '我的自助': 'My Self-Service',
  '我的請假紀錄': 'My Leave Records', '打卡考勤': 'Clock-in Attendance', '申請請假': 'Apply for Leave',
  '申請請假（假期）': 'Apply for Leave', '取消請假': 'Cancel Leave', '請假日期 *': 'Leave Date *',
  '請假醫師': 'Leave Doctor', '目前冇已申請嘅請假': 'No pending leave applications',
  '即將請假日子': 'Upcoming leave days', '取消（還原開放）': 'Cancel (reopen)',
  '原因（會顯示喺通知入面）': 'Reason (shown in notification)', '記錄遲到': 'Record Late',
  '（早退）': '(Left early)', '（遲到）': '(Late)', '明日': 'Tomorrow', '星期': 'Week',
  '週（一至日）': 'Week (Mon-Sun)', '至': 'To', '由': 'From', '返工時段': 'Work Shift',
  '返工時間': 'Work Time', '返工時間：': 'Work Time:', '返工更表': 'Work Schedule',
  '時薪 / 月薪': 'Hourly / Monthly', '薪金按時薪或月薪自動計算，如需查詢細節請聯絡管理員。': 'Salary is auto-calculated by hourly or monthly rate; contact admin for details.',
  '該月份尚無出糧紀錄（需已設定時薪或月薪）': 'No payroll record this month (hourly/monthly rate required)',
  '今日床位佔用': "Today's Bed Occupancy", '今日暫無需要床位嘅預約': "No bed-required bookings today",
  'OT小時': 'OT Hours',
  // 客戶 / 家庭
  '新客戶': 'New Customer', '搵唔到相關客戶': 'No matching customer found',
  '搜尋（客戶姓名／會員ID／診斷／治療）': 'Search (Customer name / Member ID / Diagnosis / Treatment)',
  '輸入姓名／電話／帳號搜尋，留空列出全部': 'Enter name/phone/account to search; leave blank for all',
  '連結到家庭': 'Link to Family', '改級別': 'Change Tier', '18 歲以下由戶主管理': 'Under 18 managed by account holder',
  '查詢此家庭成員': 'View this family member', '查看個人資料、返工更表、出糧單與文件': 'View profile, shift schedule, payslips and documents',
  '· 家庭會員': '· Family Member', '· 非 family 級': '· Non-family tier', '上一代': 'Previous Generation',
  // 醫師時段 / 請假
  '時段網格純粹設定你自己嘅時段狀態，唔顯示預約；拖掃揀時段，再撳「放假／休息／候診／取消」。如該時段已有預約，揀「放假」或「休息」會彈出提醒。睇預約紀錄請去「預約／假期」。': 'The slot grid only sets your own slot status (no bookings shown); drag to select slots then choose Day Off / Rest / On-call / Cancel. If a slot has bookings, choosing Day Off or Rest shows a reminder. See booking records under Bookings/Leave.',
  '請先選擇一位醫師以管理佢嘅時段。': 'Please select a doctor to manage their time slots.',
  '列出所揀日期範圍，顯示全部醫師嘅預約／假期。': "Lists the selected date range showing all doctors’ bookings/leave.",
  '呢段日期範圍冇醫師請假。': 'No doctor leave in this date range.',
  '呢段日期範圍暫無預約。': 'No bookings in this date range.',
  '點日期睇當日詳情': 'Click a date to see that day’s details',
  '有預約嘅日子（數字＝當日單數）': 'Days with bookings (number = daily count)',
  '月費生效中': 'Monthly fee active', '暫無時段資料，請揀選日期。': 'No time slot data. Please select a date.',
  '暫無時段資料，請揀選日期範圍。': 'No time slot data. Please select a date range.',
  '暫無考勤紀錄': 'No attendance records', '暫無請假紀錄': 'No leave records', '暫無醫師請假記錄。': 'No doctor leave records.',
  '未來有預約嘅日子': 'Days with upcoming bookings',
  '揀第二位醫師…': 'Select second doctor…',
  '筆（已取消唔計）': 'records (cancelled excluded)',
  '3–9 人': '3-9 people', '1–2 人': '1-2 people', '10 人以上': '10+ people',
  // 視頻 / YouTube
  'YouTube 網址': 'YouTube URL', 'YouTube 連結': 'YouTube Link', '上載影片檔': 'Upload Video',
  '上傳影片檔': 'Upload Video', '上傳影片檔案': 'Upload Video File',
  '上傳包含 日期/金額/服務/客戶名稱 欄位嘅 Excel (.xlsx/.csv) 檔案': 'Upload Excel (.xlsx/.csv) with Date/Amount/Service/Customer Name columns',
  // 雜項系統
  'IP 地址': 'IP Address', 'Sandbox 模式：': 'Sandbox Mode:', 'WhatsApp 通知': 'WhatsApp Notification',
  'WhatsApp 通知（依客戶偏好）': 'WhatsApp Notification (per customer preference)',
  '醫師版': 'Doctor Edition', '未有醫師資料': 'No doctor data', '中文姓名（醫師請輸入與 doctors 表相同姓名以自動關聯）': 'Chinese name (doctors: enter same name as doctors table to auto-link)',
  '通知客人（批核後會 WhatsApp 通知受影響客戶）': 'Notify customers (WhatsApp after approval)',
  '例如：外出復診補打卡': 'e.g. Outpatient follow-up catch-up clock-in',
  '例如：進修 / 休息 / 私人事務': 'e.g. Study / Rest / Personal matters', '例：醫師證書': 'e.g. Doctor certificate',
  '請填寫原因': 'Please fill in the reason', '開放': 'Open',
  '電話（可選，預設用家長電話收 WhatsApp）': 'Phone (optional; defaults to parent phone for WhatsApp)',
  '上午時段': 'Morning Slot', '下午時段': 'Afternoon Slot', '上午結束至下午開始之間為午休時間，客戶無法預約此時段。': 'Midday break between morning end and afternoon start; not bookable.',
  // 登入頁面（最高優先）
  '管理員後台系統': 'Admin Console', '管理員帳號': 'Admin Account', '請輸入管理員帳號': 'Enter admin account',
  '密碼': 'Password', '請輸入密碼': 'Enter password', '驗證碼': 'Captcha', '請輸入驗證碼': 'Enter captcha',
  '點擊重新整理驗證碼': 'Click to refresh captcha', '登入後台': 'Log in to Console', '請輸入圖片中的文字': 'Enter code',
  '返回主頁登入頁面': 'Back to Home / Login', '寶天醫館 · 管理': 'Po Tin Clinic · Admin',
  '寶天醫館後台': 'Po Tin Clinic Admin', '登出': 'Log out',
  '用戶管理': 'User Management', '初體驗記錄': 'Trial Experience Records',
  '醫師排班': 'Doctor Schedule', '醫師請假': 'Doctor Leave', '系統設定': 'System Settings',
  '數據統計': 'Data Statistics', '意見管理': 'Feedback Management', '病歷管理': 'Medical Records Management',
  '員工管理': 'Employee Management', '出勤管理': 'Attendance Management', '報更管理': 'Shift Management',
  '假期管理': 'Leave Management', '薪酬管理': 'Payroll Management', '診所設定': 'Clinic Settings',
};

// 供 _i18n_sync.cjs require 使用（apply 段受 require.main 守衛保護，唔會重複執行）
module.exports = { MAP };

// ===== apply =====
if (require.main === module) {
function esc(s) { return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
let code = fs.readFileSync(DICT, 'utf8');
let done = 0, skipped = 0;
code = code.replace(/^(\s*)'((?:[^'\\]|\\.)*)':\s*null,/gm, (m, pre, rawKey) => {
  const key = rawKey.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  if (MAP.hasOwnProperty(key)) {
    done++;
    return `${pre}'${rawKey}': '${esc(MAP[key])}',`;
  }
  skipped++;
  return m;
});
fs.writeFileSync(DICT, code, 'utf8');
console.log(`✅ 翻譯完成：譯咗 ${done} 個 key，跳過（仍 null）${skipped} 個`);
}
