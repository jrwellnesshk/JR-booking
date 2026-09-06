const { createApp, ref, computed, onMounted, onUnmounted, watch, nextTick } = Vue;

      // API 基礎 URL
      const API_URL = "/api";

      // ===== 版本檢查 - 如果你在控制台看到這個,表示已載入新版本 =====
      console.log(
        "🔥🔥🔥 INDEX.HTML 版本: 2025-11-18-V2 - category_id 修復版 🔥🔥🔥"
      );
      console.log("如果看到這個訊息,表示已經載入修復後的版本");
      // =====================================================

      createApp({
        setup() {
          // 資料定義（預設資料）
          const DOCTORS = ref([
            { id: "d1", name: "張醫師", specialty: "推拿專家" },
            { id: "d2", name: "李醫師", specialty: "針灸專家" },
            { id: "d3", name: "王醫師", specialty: "綜合治療" },
          ]);

          const SERVICES = ref([
            {
              id: "S1",
              name: "初體驗（一小時）",              short: "初體驗 60m",
              bedType: "none",
              duration: 60,
              price: 380,
            },
            {
              id: "S2",
              name: "針灸治療（30 分鐘）",
              short: "針灸 30m",
              bedType: "acup",
              duration: 30,
              price: 250,
            },
            {
              id: "S3",
              name: "推拿 + 針灸（60 分鐘）",
              short: "推 + 針 60m",
              bedType: "mixed",
              duration: 60,
              price: 500,
            },
            {
              id: "S4",
              name: "新症諮詢（30 分鐘）",
              short: "新症諮詢 30m",
              bedType: "none",
              duration: 30,
              price: 150,
            },
          ]);

          // 🔒 初體驗服務只限訪客——會員預約時隱藏
          const bookableServices = computed(() => {
            if (!currentMember.value) return SERVICES.value;
            return SERVICES.value.filter(s => !/初體驗/.test(s.name || ""));
          });

          const TOTAL_BEDS = ref({ tuina: 5, vip: 5, acup: 5 });
          const totalDoctors = ref(3);
          const closedDays = ref([0]); // 休息日陣列，預設星期日 (0=星期日, 1=星期一, ..., 6=星期六)
          const holidaysEnabled = ref(true); // 公眾假期是否啟用
          const holidays = ref([]); // 公眾假期列表
          const workingHolidays = ref([]); // 要營業的假期日期列表
          const openMonths = ref([]); // 開放預約的月份列表 (格式: ['2025-02', '2025-03'])
          const customClosedDates = ref([]); // 自訂額外休息日列表 (格式: ['2025-02-01', '2025-03-15'])
          const customOpenDates = ref([]); // 自訂額外營業日列表 (格式: ['2025-02-05'])
          
          // 營業時間設定（診所開放時間 10:00–19:00）
          const businessHours = ref({
            morning_start: '10:00',
            morning_end: '14:00',
            afternoon_start: '14:00',
            afternoon_end: '19:00',
            slot_interval: 30
          });
          
          // 狀態變數
          const bookings = ref([]); // 當前用戶的預約（登入後由 API 載入）
          const allBookings = ref([]); // 所有用戶的預約（用於即時狀況顯示）
          const step = ref(0); // 0: 登入, 1: 選服務, 2: 選時間, 3: 聯絡資料, 4: 完成
          const selectedService = ref(SERVICES.value[0]?.id || "S1");
          const selectedDoctor = ref("any");
          const selectedDate = ref("2025-10-20");
          const selectedTime = ref(null);
      // 🛏️ 床位揀選狀態
      const selectedBed = ref(null);
      const selectedBedType = ref('tuina'); // 'tuina'=手法床, 'vip'=VIP房
      const bedOptions = ref([]);
      const bedLoading = ref(false);
          const customerName = ref("");
          const customerNameEn = ref("");
          const customerPhone = ref("");
          const customerEmail = ref("");
          const customerAge = ref(null); // 🆕 訪客預約：顧客歲數
          const customerNotes = ref("");
          const result = ref(null);
          const currentMember = ref(null);
          const view = ref("booking");
          const editingBooking = ref(null);
          const loginPassword = ref("");
          const loginId = ref("");
          const showLoginPassword = ref(false); // 控制登入密碼顯示/隱藏
          const loginRole = ref("customer"); // 🆕 登入角色切換: customer, doctor, staff/admin
          const sendWhatsApp = ref(true);

          // ==================== 會員中心 / 家庭帳戶 ====================
          const membership = ref({ loading: false, tier: 'general', tierName: '一般會員', subscription: null, upgradeOptions: {}, isFamilyHead: false, canApplyFamily: false, parent: null, children: [], insurance: false, profile_completed: false });
          const realTier = ref(null);          // 登入後真正嘅 membership_tier
          const tierLabel = computed(() => {
            if (realTier.value === 'family') return '家庭會員';
            if (realTier.value === 'premium') return '高級會員';
            return '一般會員';
          });
          const upgradeTier = ref(null);
          const upgrading = ref(false);
          const cancellingSub = ref(false);
          const familyList = ref({ children: [] });
          const selectedChildBookings = ref(null);
          // 🆕 通用帳戶連結（親戚／同輩／朋友，客人自助連結）
          const accountLinks = ref([]);
          const linkLoading = ref(false);
          const linkBusy = ref(false);
          const linkError = ref('');
          const linkForm = ref({ targetUsername: '', relation: '朋友', customRelation: '', fromUserId: null });
          const linkRelationOptions = ['父母', '子女', '配偶', '兄弟', '姐妹', '親戚', '朋友', '其他'];
          const currentMemberId = computed(() => (currentMember.value && (currentMember.value.dbId || currentMember.value.id)) || null);
          const currentMemberName = computed(() => (currentMember.value && (currentMember.value.name || currentMember.value.id)) || '');
          const myFamilyChildren = computed(() => (membership.value && membership.value.isFamilyHead) ? (familyList.value.children || []) : []);
          // 🆕 連結來源可選項：自己 + 已連結嘅帳戶（子女 / account_links 對方），對應用家「揀已連結 A 再搜尋 B」
          const myLinkSources = computed(() => {
            const src = [];
            if (currentMember.value) src.push({ id: currentMemberId.value, name: (currentMemberName.value || '我自己') + '（我自己）' });
            (myFamilyChildren.value || []).forEach(c => src.push({ id: c.id, name: `${c.name || c.username || '子女'}（子女）` }));
            (accountLinks.value || []).forEach(lk => {
              const o = lk.other;
              if (o && o.id && !src.some(s => s.id === o.id)) src.push({ id: o.id, name: `${o.name || o.username}（已連結）` });
            });
            return src;
          });
          const familyHint = computed(() => {
            if (membership.value.tier !== 'family') return '家庭會員可集中查看子女狀況及病歷、管理家庭預約。請先升級至家庭會員。';
            if (!membership.value.isFamilyHead) return '殷請先「啟用家庭帳戶」，即可查看子女狀況及病歷。';
            return '子女帳戶（18 歲以下）由診所職員於後台建立；哩個帳戶可以查看子女的狀況及病歷。';
          });

          // ==================== 官網內容（公告/影片/社交/評價/成功案例/討論區/文字）====================
          const siteAnnouncements = ref([]);
          const siteVideos = ref([]);
          const siteSocial = ref({});
          const siteReviews = ref([]);
          const siteCases = ref([]);
          const siteTexts = ref({});
          const forumPosts = ref([]);
          const activeForumPost = ref(null);
          const forumReplyContent = ref("");
          const forumReplySending = ref(false);
          const forumNewPostOpen = ref(false);
          const forumNewPostTitle = ref("");
          const forumNewPostCategory = ref("中醫問題");
          const forumNewPostContent = ref("");
          const forumPostSending = ref(false);
          const userAvatar = ref("");
          const avatarEmoji = ref("🙂");
          const avatarUploading = ref(false);

          // 網站文字 helper：管理員修改後即時反映
          const t = (key, fallback = "") => siteTexts.value[key] || fallback;

          const loadSiteContent = async () => {
            try {
              const [a, v, s, r, cs, tx] = await Promise.all([
                fetch(`${API_URL}/content/announcements`).then(r => r.ok ? r.json() : []),
                fetch(`${API_URL}/content/videos`).then(r => r.ok ? r.json() : []),
                fetch(`${API_URL}/content/social`).then(r => r.ok ? r.json() : {}),
                fetch(`${API_URL}/content/reviews`).then(r => r.ok ? r.json() : []),
                fetch(`${API_URL}/content/cases`).then(r => r.ok ? r.json() : []),
                fetch(`${API_URL}/content/texts`).then(r => r.ok ? r.json() : {})
              ]);
              siteAnnouncements.value = a || [];
              siteVideos.value = v || [];
              siteSocial.value = s || {};
              siteReviews.value = r || [];
              siteCases.value = cs || [];
              siteTexts.value = tx || {};
            } catch (e) { console.error("載入官網內容失敗:", e); }
          };

          const forumLoading = ref(false);
          const loadForumPosts = async () => {
            forumLoading.value = true;
            try {
              const resp = await fetch(`${API_URL}/content/forum/posts`);
              if (resp.ok) forumPosts.value = await resp.json();
            } catch (e) { console.error("載入討論區失敗:", e); }
            finally { forumLoading.value = false; }
          };

          const printPage = () => window.print();

          const openForumPost = async (post) => {
            try {
              const resp = await fetch(`${API_URL}/content/forum/posts/${post.id}`);
              if (resp.ok) activeForumPost.value = await resp.json();
            } catch (e) { console.error("載入帖子失敗:", e); }
          };

          const closeForumPost = () => { activeForumPost.value = null; };

          const submitForumReply = async () => {
            if (!forumReplyContent.value.trim()) return;
            if (!currentMember.value) { alert("請先登入先可以回覆"); return; }
            forumReplySending.value = true;
            try {
              const resp = await fetch(`${API_URL}/content/forum/posts/${activeForumPost.value.id}/replies`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (localStorage.getItem("jwtToken") || "") },
                body: JSON.stringify({ content: forumReplyContent.value })
              });
              if (resp.ok) {
                forumReplyContent.value = "";
                await openForumPost(activeForumPost.value);
              } else {
                const d = await resp.json();
                alert(d.error || "回覆失敗");
              }
            } catch (e) { console.error("回覆失敗:", e); }
            finally { forumReplySending.value = false; }
          };

          const submitForumPost = async () => {
            if (!forumNewPostTitle.value.trim() || !forumNewPostContent.value.trim()) { alert("請填寫標題與內容"); return; }
            if (!currentMember.value) { alert("請先登入先可以發帖"); return; }
            forumPostSending.value = true;
            try {
              const resp = await fetch(`${API_URL}/content/forum/posts`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (localStorage.getItem("jwtToken") || "") },
                body: JSON.stringify({
                  title: forumNewPostTitle.value,
                  content: forumNewPostContent.value,
                  category: forumNewPostCategory.value
                })
              });
              if (resp.ok) {
                forumNewPostOpen.value = false;
                forumNewPostTitle.value = "";
                forumNewPostContent.value = "";
                await loadForumPosts();
              } else {
                const d = await resp.json();
                alert(d.error || "發帖失敗");
              }
            } catch (e) { console.error("發帖失敗:", e); }
            finally { forumPostSending.value = false; }
          };

          const setAvatarEmoji = (emoji) => { avatarEmoji.value = emoji; };

          const saveAvatar = async () => {
            if (!currentMember.value) return;
            try {
              const resp = await fetch(`${API_URL}/content/avatar`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (localStorage.getItem("jwtToken") || "") },
                body: JSON.stringify({ avatar: avatarEmoji.value })
              });
              if (resp.ok) {
                userAvatar.value = avatarEmoji.value;
                currentMember.value.avatar = avatarEmoji.value;
                alert("頭像已更新");
              } else { const d = await resp.json(); alert(d.error || "更新失敗"); }
            } catch (e) { console.error("更新頭像失敗:", e); }
          };

          const onAvatarFileChange = async (event) => {
            const file = event.target.files[0];
            if (!file || !currentMember.value) return;
            avatarUploading.value = true;
            try {
              const fd = new FormData();
              fd.append("avatar", file);
              const resp = await fetch(`${API_URL}/content/upload/avatar`, {
                method: "POST",
                headers: { "Authorization": "Bearer " + (localStorage.getItem("jwtToken") || "") },
                body: fd
              });
              if (resp.ok) {
                const d = await resp.json();
                userAvatar.value = d.avatar;
                currentMember.value.avatar = d.avatar;
                alert("頭像已更新");
              } else { const d = await resp.json(); alert(d.error || "上傳失敗"); }
            } catch (e) { console.error("上傳頭像失敗:", e); }
            finally { avatarUploading.value = false; }
          };

          // 🔒 驗證碼（登入/註冊）
          const captchaUrl = ref("");
          const loginCaptchaAnswer = ref("");
          const registerCaptchaAnswer = ref("");

          // 載入驗證碼圖片
          const loadCaptcha = () => {
            captchaUrl.value = `${API_URL}/auth/captcha?t=${Date.now()}`;
            loginCaptchaAnswer.value = "";
            registerCaptchaAnswer.value = "";
          };
          
          // 按鈕載入狀態
          const isBooking = ref(false);        // 預約中
          const isUpdating = ref(false);       // 更改預約中
          const isCancelling = ref(false);     // 取消預約中
          const cancellingBookingId = ref(null); // 正在取消的預約ID
          const bookingError = ref("");        // 預約錯誤訊息（內嵌顯示）

          // 註冊相關變數
          const showRegister = ref(false);
          const guestTrialFlow = ref(false); // 🆕 訪客初體驗預約流程（建立帳戶後導向初體驗預約）
          // 🆕 免帳戶訪客預約（淨填姓名+電話直接預約初體驗）
          const showGuestBooking = ref(false);
          const guestBookingInfo = ref({ name_zh: "", name_en: "", phone: "", age: "", email: "" });
          const guestBookingError = ref(""); // 訪客預約表單驗證錯誤（內嵌顯示，避免只靠 alert）
          const guestFlowActive = ref(false); // 訪客預約流程進行中（顯示預約選單）

          // 重設密碼相關變數（支持電郵或電話驗證碼方式）
          const showResetPassword = ref(false);
          const resetPasswordStep = ref(1);  // 1: 選擇驗證方式, 2: 輸入驗證碼和新密碼
          const resetVerifyMethod = ref('email');  // 'email' 或 'phone'
          const resetPasswordData = ref({
            email: "",
            phone: "",
            code: "",
            newPassword: "",
            confirmPassword: "",
          });
          const resetPasswordError = ref("");
          const resetPasswordSuccess = ref("");
          const showNewPasswordResetText = ref(false);
          const showConfirmPasswordResetText = ref(false);
          const sendingCode = ref(false);       // 發送驗證碼中
          const resettingPassword = ref(false); // 重設密碼中
          const codeCountdown = ref(0);         // 驗證碼有效倒計時（秒）
          const resendCountdown = ref(0);       // 重新發送倒計時（秒）
          const canResendCode = ref(false);     // 是否可以重新發送
          let codeCountdownInterval = null;
          let resendCountdownInterval = null;
          
          // 已登入用戶更改密碼相關變數
          const changePasswordData = ref({
            newPassword: "",
            confirmPassword: "",
          });
          const changePasswordError = ref("");
          const changePasswordSuccess = ref("");
          const showNewPasswordChangeText = ref(false);
          const showConfirmPasswordChangeText = ref(false);

          // 🔒 首登／臨時密碼強制更改（子帳戶 must_change_password=1）
          const forceChangePw = ref(false);
          const forcePwData = ref({ currentPassword: "", newPassword: "", confirmPassword: "" });
          const forcePwError = ref("");
          const forcePwBusy = ref(false);

          // 忘記ID相關變數
          const showFindUserId = ref(false);
          const findUserIdData = ref({
            name: "",
            phone: "",
          });
          const findUserIdError = ref("");
          const findUserIdResult = ref(null);

          // 用戶個人資料
          const userProfile = ref({
            username: "",
            name: "",
            name_en: "",
            phone: "",
            email: "",
            id_card: "",
            address: "",
            birth_date: "",
            emergency_contact: "",
            emergency_phone: "",
            username_last_changed: "",
            name_last_changed: "",
          });
          const profileSaveSuccess = ref(false);

          // 🆕 WhatsApp 通知偏好（通訊偏好中心）
          const whatsappPrefs = ref({ weather: true, confirm: true, health: true });
          const whatsappPrefsSaving = ref(false);
          const whatsappPrefsSaved = ref(false);
          const saveWhatsappPrefs = async () => {
            const dbId = currentMember.value?.dbId || loginId.value;
            if (!dbId) return;
            whatsappPrefsSaving.value = true;
            whatsappPrefsSaved.value = false;
            try {
              const res = await fetch(`${API_URL}/users/${dbId}/notifications`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  whatsapp_weather: whatsappPrefs.value.weather ? 1 : 0,
                  whatsapp_confirm: whatsappPrefs.value.confirm ? 1 : 0,
                  whatsapp_health: whatsappPrefs.value.health ? 1 : 0,
                }),
              });
              if (res.ok) {
                whatsappPrefsSaved.value = true;
                setTimeout(() => { whatsappPrefsSaved.value = false; }, 3000);
              } else {
                alert('儲存 WhatsApp 通知偏好失敗');
              }
            } catch (e) {
              console.error(e);
              alert('儲存失敗，請稍後再試');
            } finally {
              whatsappPrefsSaving.value = false;
            }
          };
          
          // 🆕 會員ID和中文姓名修改相關
          const editingUsername = ref(false);
          const editingName = ref(false);
          const newUsername = ref("");
          const newName = ref("");
          const usernameError = ref("");
          const nameError = ref("");
          const canChangeUsername = ref(true);
          const canChangeName = ref(true);
          const usernameNextChangeDate = ref("");
          const nameNextChangeDate = ref("");

          // 出生日期分開的欄位
          const birthYear = ref("");
          const birthMonth = ref("");
          const birthDay = ref("");

          // 日曆相關變數
          const calendarMonth = ref(new Date().getMonth());
          const calendarYear = ref(new Date().getFullYear());
          
          // 獲取本地日期字串的函數（避免時區問題）
          const getLocalDateString = () => {
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
          };
          const todayDate = ref(getLocalDateString()); // 響應式的今日日期（本地時間）

          // 時段管理
            const timeSlotsFromAPI = ref([]);
            // 🛏️ 床位透明化：需要床位服務嘅每時段剩餘床位 { 'HH:MM': { bedLeft, bedCap, available } }
            const bedSlotInfo = ref({});

          // AI問診相關變數（語言狀態供醫療分流使用）
          const aiConsultationEnabled = ref(true); // AI問診是否開放（預設開放）
          const aiLang = ref("zh_hant"); // 預設語言：繁體中文
          const aiLanguageSelected = ref(false); // 是否已選擇語言

          // 🆕 醫療分流相關變數
          const triageQuestions = ref([]); // 分流問題列表
          const triageCurrentIndex = ref(0); // 當前問題索引
          const triageAnswers = ref([]); // 已回答的答案
          const triageScores = ref({}); // 累計分數（按醫師）
          const triageResult = ref(null); // 分流結果
          const triageDoctorMap = ref([]); // 醫師與服務對應關係
          const triageInProgress = ref(false); // 是否正在進行分流

          const faqs = ref([]);
          const expandedFaq = ref(null);
          
          // 意見箱相關變數
          const feedbackForm = ref({
            category: 'general',
            subject: '',
            message: ''
          });
          const isSubmittingFeedback = ref(false);
          const myFeedbacks = ref([]);
          const unreadReplyCount = ref(0);
          const showReplyNotification = ref(false);
          
          // 預約成功彈窗
          const showBookingSuccess = ref(false);
          const bookingResult = ref(null);
          
          // 即時預約狀況自動刷新相關變數
          const autoRefreshCountdown = ref(30); // 30秒倒數
          const isRefreshingStatus = ref(false);
          
          // 天氣提醒相關變數
          const showWeatherAlert = ref(false);
          const weatherData = ref(null);
          const dontShowWeatherToday = ref(false);
          let autoRefreshInterval = null;

          // 病歷詳情
          const showMedicalRecordDetailModal = ref(false);
          const selectedMedicalRecord = ref(null);

                    // 相片 lightbox
                    const photoLightboxVisible = ref(false);
                    const photoLightboxUrl = ref('');
                    const photoLightboxList = ref([]);
                    const photoLightboxIndex = ref(0);

                    // 病歷相片比較
                    const medicalPhotoCompareList = ref([]);
                    const medicalPhotoPairIndex = ref(0);

                    // 客戶療程進度資料 (bookingId -> array of medical_records with progress[])
                    const bookingMedical = ref({});

                    // 取得 booking 的病歷與進度
                    const fetchMedicalForBooking = async (bookingId) => {
                      try {
                        if (!currentMember.value || !currentMember.value.id) return;
                        const response = await fetch(`${API_URL}/medical-records/customer/booking/${bookingId}`, {
                          headers: { 'x-user-id': (currentMember.value.dbId || currentMember.value.id) }
                        });
                        if (response.ok) {
                          const data = await response.json();
                          // data.data 是陣列，每筆 medical_record 裡可能包含 progress 陣列
                          bookingMedical.value[bookingId] = (data.data || []).map(r => ({
                            ...r,
                            audio_url: r.audio_file_path
                              ? `${r.audio_file_path}`
                              : null,
                            photo_urls: (r.photos && r.photos.length > 0)
                              ? r.photos.map(p => `${p.photo_file_path}`)
                              : []
                          }));
                        } else {
                          console.warn('fetchMedicalForBooking failed', await response.text());
                          bookingMedical.value[bookingId] = [];
                        }
                      } catch (err) {
                        console.error('fetchMedicalForBooking error', err);
                        bookingMedical.value[bookingId] = [];
                      }
                    };

                    // 百分比轉 1-10 塊數
                    const percentToSquares = (percent) => {
                      const p = Number(percent) || 0;
                      const filled = Math.round(Math.min(100, Math.max(0, p)) / 10); // 0-10
                      return filled;
                    };

                    // ===== 我的病歴頁面 =====
                    const medicalHistory = ref([]);
                    const medicalHistoryLoading = ref(false);
                    const aiScores = ref({});
                    const aiAnalyzingId = ref(null);

                    // 載入客戶全部病歴與療程進度
                    const loadMedicalHistory = async () => {
                      if (!currentMember.value || !currentMember.value.id) return;
                      medicalHistoryLoading.value = true;
                      try {
                        const response = await fetch(`${API_URL}/medical-records/customer/history`, {
                          headers: { 'x-user-id': (currentMember.value.dbId || currentMember.value.id) }
                        });
                        if (response.ok) {
                          const data = await response.json();
                          medicalHistory.value = (data.data || []).map(r => ({
                            ...r,
                            audio_url: r.audio_file_path
                              ? `${r.audio_file_path}`
                              : null,
                            photo_urls: (r.photos && r.photos.length > 0)
                              ? r.photos.map(p => `${p.photo_file_path}`)
                              : []
                          }));
                        } else {
                          medicalHistory.value = [];
                        }
                      } catch (err) {
                        console.error('loadMedicalHistory error', err);
                        medicalHistory.value = [];
                      } finally {
                        medicalHistoryLoading.value = false;
                      }
                    };

                    // 進度方格的顯示樣式（基於 progress_score 或 current_value 百分比）
                    const progressSquareClass = (n, entry) => {
                      let level = 0;
                      if (entry.progress_score) {
                        level = Number(entry.progress_score) || 0;
                      } else if (entry.current_value !== undefined && entry.current_value !== null) {
                        const v = String(entry.current_value);
                        const num = parseFloat(v.replace('%', '').replace('%', ''));
                        if (!isNaN(num)) {
                          level = Math.round(Math.min(100, Math.max(0, num)) / 10);
                        }
                      }
                      if (n <= level) {
                        if (level <= 3) return 'bg-red-400';
                        if (level <= 6) return 'bg-amber-400';
                        return 'bg-emerald-500';
                      }
                      return 'bg-slate-100';
                    };

                    // AI 分析病歴康復進度（本地規則）
                    const aiAnalyzeMedicalRecord = async (recordId) => {
                      if (aiAnalyzingId.value) return;
                      if (!currentMember.value) return;
                      aiAnalyzingId.value = recordId;
                      try {
                        const response = await fetch(`${API_URL}/medical-records/records/${recordId}/ai-analyze`, {
                          method: "POST",
                          headers: {
                            'Content-Type': 'application/json',
                            'x-user-id': (currentMember.value.dbId || currentMember.value.id)
                          }
                        });
                        if (response.ok) {
                          const data = await response.json();
                          aiScores.value = { ...aiScores.value, [recordId]: data.data };
                        } else {
                          const err = await response.json();
                          alert(err.error || "AI 分析失敗，請稍後再試");
                        }
                      } catch (err) {
                        console.error('aiAnalyzeMedicalRecord error', err);
                        alert("AI 分析失敗，請檢查網絡連接");
                      } finally {
                        aiAnalyzingId.value = null;
                      }
                    };

                    // 橫向圓柱狀分格進度條：每個 segment 顯示到達程度
                    const progressBarClass = (n, entry) => {
                      let level = 0;
                      if (entry && entry.progress_score) {
                        level = Number(entry.progress_score) || 0;
                      } else if (entry && entry.current_value !== undefined && entry.current_value !== null) {
                        const v = String(entry.current_value);
                        const num = parseFloat(v.replace('%', '').replace('%', ''));
                        if (!isNaN(num)) {
                          level = Math.round(Math.min(100, Math.max(0, num)) / 10);
                        }
                      }
                      if (n <= level) {
                        if (level <= 3) return 'bg-red-400 shadow-inner';
                        if (level <= 6) return 'bg-amber-400 shadow-inner';
                        return 'bg-emerald-500 shadow-inner';
                      }
                      return 'bg-slate-200';
                    };

                    // 格式化進度數值（優先顯示 1-10 分數，其次為百分比）
                    const formatProgressValue = (entry) => {
                      if (!entry) return '—';
                      if (entry.progress_score) return entry.progress_score + '/10';
                      if (entry.current_value !== undefined && entry.current_value !== null) {
                        const v = String(entry.current_value);
                        if (/^\d+(\.\d+)?$/.test(v)) return v + '%';
                        return v;
                      }
                      return '—';
                    };

          // 切換 FAQ 展開/收起
          const toggleFaq = (faqId) => {
            expandedFaq.value = expandedFaq.value === faqId ? null : faqId;
          };

          // 載入常見問題
          const loadFaqs = async () => {
            try {
              console.log("🔍 開始載入常見問題...");
              const response = await fetch(`${API_URL}/faqs`);
              console.log("📡 FAQ API 回應狀態:", response.status);
              
              if (response.ok) {
                const data = await response.json();
                console.log("📦 從 API 取得的 FAQ 原始資料:", data);
                console.log("📦 資料類型:", typeof data, Array.isArray(data) ? "是陣列" : "不是陣列");
                
                // 處理兩種可能的回應格式：直接陣列 或 {faqs: 陣列}
                const faqArray = Array.isArray(data) ? data : (data.faqs || []);
                console.log("📦 處理後的 FAQ 陣列:", faqArray);
                
                faqs.value = faqArray.sort((a, b) => a.display_order - b.display_order);
                console.log("✅ 已載入常見問題 (排序後):", faqs.value);
                console.log("📊 FAQ 數量:", faqs.value.length);
              } else {
                console.error("❌ FAQ API 回應失敗:", response.status, response.statusText);
              }
            } catch (error) {
              console.error("❌ 載入常見問題失敗:", error);
            }
          };

          // 計算屬性
          // 病歷相片比較：找出上一次有相片的病歷並配對
          const canCompareMedicalPhotos = computed(() => {
            const cur = selectedMedicalRecord.value;
            if (!cur) return false;
            const curPhotos = cur.photo_urls || [];
            if (curPhotos.length === 0) return false;
            const prev = findPreviousMedicalRecordWithPhotos(cur);
            medicalPhotoCompareList.value = buildPhotoCompareList(cur, prev);
            medicalPhotoPairIndex.value = 0;
            return true;
          });

          // 在上一次病歷中找有相片的（與今次病歷日期較早者）
          const findPreviousMedicalRecordWithPhotos = (cur) => {
            const curId = cur.id;
            const curDate = cur.record_date || cur.appointment_date || cur.progress_date || '';
            const others = medicalHistory.value.filter((r) => r.id !== curId && r.photo_urls && r.photo_urls.length > 0);
            if (others.length === 0) return null;
            const sorted = [...others].sort((a, b) => {
              const da = a.record_date || a.appointment_date || a.progress_date || '';
              const db = b.record_date || b.appointment_date || b.progress_date || '';
              if (da !== db) return da < db ? 1 : -1;
              return b.id - a.id;
            });
            return sorted[0];
          };

          // 將今次相片與上次相片逐對配對
          const buildPhotoCompareList = (cur, prev) => {
            const pairs = [];
            const curPhotos = cur.photo_urls || [];
            const prevPhotos = (prev && prev.photo_urls) || [];
            const count = Math.max(curPhotos.length, prevPhotos.length);
            const curLabel = `今次 (${cur.record_date || cur.appointment_date || '—'})`;
            const prevLabel = prev ? `上次 (${prev.record_date || prev.appointment_date || '—'})` : '上次';
            for (let i = 0; i < count; i++) {
              if (i < curPhotos.length || i < prevPhotos.length) {
                pairs.push({
                  currentUrl: curPhotos[i] || null,
                  previousUrl: prevPhotos[i] || null,
                  currentLabel: curLabel,
                  previousLabel: prevLabel,
                });
              }
            }
            return pairs;
          };

          // 切換到下一組比較相片
          const cycleMedicalPhotoPair = () => {
            if (medicalPhotoCompareList.value.length === 0) return;
            medicalPhotoPairIndex.value = (medicalPhotoPairIndex.value + 1) % medicalPhotoCompareList.value.length;
          };

          // 相片放大檢視
          const viewPhotoLightbox = (url, list) => {
            if (!url) return;
            photoLightboxList.value = (list && list.length > 0) ? list.filter(Boolean) : [url];
            photoLightboxIndex.value = photoLightboxList.value.indexOf(url) >= 0 ? photoLightboxList.value.indexOf(url) : 0;
            photoLightboxUrl.value = photoLightboxList.value[photoLightboxIndex.value];
            photoLightboxVisible.value = true;
          };
          const photoLightboxPrev = () => {
            if (photoLightboxList.value.length === 0) return;
            photoLightboxIndex.value = (photoLightboxIndex.value - 1 + photoLightboxList.value.length) % photoLightboxList.value.length;
            photoLightboxUrl.value = photoLightboxList.value[photoLightboxIndex.value];
          };
          const photoLightboxNext = () => {
            if (photoLightboxList.value.length === 0) return;
            photoLightboxIndex.value = (photoLightboxIndex.value + 1) % photoLightboxList.value.length;
            photoLightboxUrl.value = photoLightboxList.value[photoLightboxIndex.value];
          };

          const timeslots = computed(() => {
            const slots = [];
            const now = new Date();
            const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000); // 當前時間 + 1小時

            // 解析營業時間設定
            const parseTime = (timeStr) => {
              const [h, m] = timeStr.split(':').map(Number);
              return { hour: h, minute: m };
            };
            
            const morningStart = parseTime(businessHours.value.morning_start);
            const morningEnd = parseTime(businessHours.value.morning_end);
            const afternoonStart = parseTime(businessHours.value.afternoon_start);
            const afternoonEnd = parseTime(businessHours.value.afternoon_end);
            const interval = businessHours.value.slot_interval;

            // 檢查指定時段的可用性（考慮醫師）
            const checkSlotAvailability = (timeStr) => {
              const doctorSlots = doctorTimeSlots.value[timeStr];
              
              // 如果沒有醫師時段數據，使用舊的 API 數據
              if (!doctorSlots) {
                const apiSlot = timeSlotsFromAPI.value.find(
                  (s) => s.time === timeStr && s.date === selectedDate.value
                );
                return apiSlot ? apiSlot.is_available === 1 : true;
              }
              
              // 如果選擇了特定醫師
              if (selectedDoctor.value !== 'any') {
                // 前端醫師 ID 格式是 "d1", "d2"，需要轉換為數字 1, 2
                const doctorIdStr = selectedDoctor.value.replace('d', '');
                const doctorId = parseInt(doctorIdStr);
                const doctorSlot = doctorSlots[doctorId];
                if (doctorSlot) {
                  return doctorSlot.is_available && doctorSlot.current_bookings < (doctorSlot.max_capacity || 1);
                }
                return true;
              }
              
              // 如果選擇「任何醫師」，檢查是否有任何可用醫師
              const availableDoctors = Object.values(doctorSlots).filter(d => 
                d.is_available && d.current_bookings < (d.max_capacity || 1)
              );
              return availableDoctors.length > 0;
            };

            // 生成時段的輔助函數
            const generateSlotsForPeriod = (startTime, endTime) => {
              let currentHour = startTime.hour;
              let currentMinute = startTime.minute;
              
              while (currentHour < endTime.hour || (currentHour === endTime.hour && currentMinute < endTime.minute)) {
                const timeStr = `${String(currentHour).padStart(2, "0")}:${String(currentMinute).padStart(2, "0")}`;
                const startIso = `${selectedDate.value}T${timeStr}:00`;
                const slotDateTime = new Date(startIso);

                // 檢查時段是否已過去
                const isPast = slotDateTime < now;

                // 檢查時段是否在1小時內（太近了不能預約）
                const isTooSoon = slotDateTime <= oneHourLater;

                // 檢查時段可用性（考慮醫師）
                const slotAvailable = checkSlotAvailability(timeStr);

                // 如果 API 有設定，使用 API 的狀態；否則預設為可用
                const available =
                  isPast || isTooSoon
                    ? false
                    : slotAvailable;

                // 計算結束時間
                let endMinute = currentMinute + interval;
                let endHour = currentHour;
                if (endMinute >= 60) {
                  endHour += Math.floor(endMinute / 60);
                  endMinute = endMinute % 60;
                }
                const endIso = `${selectedDate.value}T${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}:00`;

                slots.push({
                  startIso,
                  endIso,
                  available,
                  time: timeStr,
                  isPast,
                  isTooSoon,
                });
                
                // 移動到下一個時段
                currentMinute += interval;
                if (currentMinute >= 60) {
                  currentHour += Math.floor(currentMinute / 60);
                  currentMinute = currentMinute % 60;
                }
              }
            };

            // 生成上午時段
            generateSlotsForPeriod(morningStart, morningEnd);

            // 生成下午時段
            generateSlotsForPeriod(afternoonStart, afternoonEnd);

            // 🛏️ 併入床位資訊：需要床位嘅服務，每個時段顯示剩餘床位；滿咗就標記不可約
            for (const slot of slots) {
              const bi = bedSlotInfo.value[slot.time];
              if (bi) {
                slot.bedLeft = bi.bedLeft;
                slot.bedCap = bi.bedCap;
                if (!bi.available && !slot.isPast && !slot.isTooSoon) {
                  slot.available = false;
                  slot.bedFull = true;
                }
              }
            }

            return slots;
          });

          const myBookings = computed(() => {
            // 支持新舊格式：舊格式用 username，新格式用數據庫 ID
            const currentUsername = String(currentMember.value?.id || '');
            const currentDbId = String(currentMember.value?.dbId || '');
            
            return bookings.value.filter((b) => {
              const memberId = String(b.memberId);
              // 比對 username 或 數據庫 ID
              const isMyBooking = memberId === currentUsername || memberId === currentDbId;
              const isNotCancelled = b.status !== "cancelled";
              const isCancelledRecently = 
                b.status === "cancelled" &&
                new Date() - new Date(b.cancelledAt) < 15 * 60 * 1000;
              return isMyBooking && (isNotCancelled || isCancelledRecently);
            });
          });

          const recentBookings = computed(() => {
            return bookings.value
              .filter((b) => b.status !== "cancelled")
              .sort((a, b) => new Date(a.start) - new Date(b.start))
              .slice(0, 5);
          });

          // 日曆計算
          const calendarDays = computed(() => {
            const firstDay = new Date(
              calendarYear.value,
              calendarMonth.value,
              1
            );
            const lastDay = new Date(
              calendarYear.value,
              calendarMonth.value + 1,
              0
            );
            const firstDayOfWeek = firstDay.getDay();
            const daysInMonth = lastDay.getDate();

            const days = [];

            // 上個月的日期
            const prevMonthLastDay = new Date(
              calendarYear.value,
              calendarMonth.value,
              0
            ).getDate();
            for (let i = firstDayOfWeek - 1; i >= 0; i--) {
              days.push({
                date: `${calendarYear.value}-${String(
                  calendarMonth.value
                ).padStart(2, "0")}-${String(prevMonthLastDay - i).padStart(
                  2,
                  "0"
                )}`,
                day: prevMonthLastDay - i,
                isCurrentMonth: false,
              });
            }

            // 當月的日期
            const todayStr = todayDate.value; // 使用響應式的今日日期
            const today = new Date(todayStr);
            const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
            for (let i = 1; i <= daysInMonth; i++) {
              const dateStr = `${calendarYear.value}-${String(
                calendarMonth.value + 1
              ).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
              const monthStr = dateStr.substring(0, 7); // 格式: YYYY-MM
              // 計算該日期是星期幾 (0=星期日, 1=星期一, ...)
              const dateObj = new Date(dateStr);
              const dayOfWeek = dateObj.getDay();
              const isNormallyClosedDay = closedDays.value.includes(dayOfWeek);
              
              // 檢查自訂特別日期
              const isCustomClosed = customClosedDates.value.includes(dateStr);
              const isCustomOpen = customOpenDates.value.includes(dateStr);
              
              // 實際休息日邏輯：
              // 1. 如果是自訂額外休息日 → 休息
              // 2. 如果是固定休息日但被設為額外營業日 → 營業
              // 3. 如果是固定休息日 → 休息
              const isClosed = isCustomClosed || (isNormallyClosedDay && !isCustomOpen);
              
              // 檢查是否為公眾假期（排除設定為營業的假期）
              const holidayInfo = holidaysEnabled.value ? holidays.value.find(h => h.date === dateStr) : null;
              const isWorkingHoliday = workingHolidays.value.includes(dateStr); // 檢查是否為營業假期
              const isHoliday = !!holidayInfo && !isWorkingHoliday; // 只有非營業假期才標記為假期
              // 檢查月份是否開放（當前月份永遠開放，其他月份需在 openMonths 列表中）
              const isMonthClosed = monthStr !== currentMonth && !openMonths.value.includes(monthStr);
              days.push({
                date: dateStr,
                day: i,
                isCurrentMonth: true,
                isToday: todayStr === dateStr,
                isPast: dateStr < todayStr,
                isClosed: isClosed || isHoliday || isMonthClosed, // 休息日或（非營業的）公眾假期或月份未開放
                isHoliday: isHoliday,
                isWorkingHoliday: isWorkingHoliday && !!holidayInfo, // 營業假期標記
                isCustomClosed: isCustomClosed, // 自訂額外休息日標記
                isCustomOpen: isCustomOpen && isNormallyClosedDay, // 自訂額外營業日標記（只有原本是休息日才顯示）
                holidayName: holidayInfo ? holidayInfo.name : null,
                isMonthClosed: isMonthClosed, // 月份未開放標記
              });
            }

            // 下個月的日期
            const totalCells = 42; // 6行x7列
            const nextMonthDays = totalCells - days.length;
            for (let i = 1; i <= nextMonthDays; i++) {
              days.push({
                date: `${calendarYear.value}-${String(
                  calendarMonth.value + 2
                ).padStart(2, "0")}-${String(i).padStart(2, "0")}`,
                day: i,
                isCurrentMonth: false,
              });
            }

            return days;
          });

          // 工具函數
          const addMinutes = (iso, mins) => {
            return new Date(new Date(iso).getTime() + mins * 60000)
              .toISOString()
              .slice(0, 16);
          };

          const formatShort = (dtIso) => {
            const d = new Date(dtIso);
            return d.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            });
          };

          // 取得 24 小時制的時間字串 (HH:MM)
          const getTime24 = (dtIso) => {
            const d = new Date(dtIso);
            const hours = String(d.getHours()).padStart(2, "0");
            const minutes = String(d.getMinutes()).padStart(2, "0");
            return `${hours}:${minutes}`;
          };

          const formatDate = (dtIso) => {
            console.log("🔍 formatDate 收到:", dtIso);
            const d = new Date(dtIso);
            console.log(
              "🔍 轉換後的 Date 物件:",
              d,
              "是否有效:",
              !isNaN(d.getTime())
            );

            if (isNaN(d.getTime())) {
              return "Invalid Date";
            }

            return d.toLocaleDateString("zh-TW", {
              year: "numeric",
              month: "long",
              day: "numeric",
            });
          };

          const getService = (serviceId) => {
            return (
              SERVICES.value?.find((s) => s.id === serviceId) || {
                name: "載入中",
                price: 0,
                duration: 0,
              }
            );
          };

          const getDoctor = (doctorId) => {
            return (
              DOCTORS.value?.find((d) => d.id === doctorId) || {
                name: "醫師",
                specialty: "專科",
              }
            );
          };

          const getDoctorTodayBookings = (doctorId) => {
            // 優先使用伺服器時間，如果沒有則用客戶端時間
            const today = window.SERVER_TODAY || new Date().toISOString().slice(0, 10);
            
            // 取得該醫師的名稱（用於匹配）
            const doctor = DOCTORS.value.find(d => d.id === doctorId);
            const doctorName = doctor ? doctor.name : null;
            
            console.log(`🔍 檢查今日預約 - doctorId: ${doctorId}, doctorName: ${doctorName}, today: ${today}`);
            
            const result = allBookings.value.filter((b) => {
              const bookingDate = b.start.slice(0, 10);
              // 同時支援 doctorId 和 doctorName 匹配
              const idMatch = b.doctorId === doctorId;
              const nameMatch = doctorName && b.doctorName === doctorName;
              const match = (idMatch || nameMatch) && bookingDate === today && b.status !== "cancelled";
              if (match) {
                console.log(`✅ 今日預約找到: ${b.id}, doctorId: ${b.doctorId}, doctorName: ${b.doctorName}, date: ${bookingDate}`);
              }
              return match;
            });
            console.log(`📊 今日預約總數 (${doctorName || doctorId}): ${result.length}`);
            return result;
          };

          const getDoctorWeekBookings = (doctorId) => {
            // 優先使用伺服器時間，否則用客戶端時間
            let todayStr = window.SERVER_TODAY;
            if (!todayStr) {
              // 備用：用客戶端時間
              todayStr = new Date().toISOString().slice(0, 10);
            }

            const today = new Date(todayStr);
            const weekStart = new Date(today);
            weekStart.setDate(today.getDate() - today.getDay()); // 本週日開始
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6); // 本週六結束

            const weekStartStr = weekStart.toISOString().slice(0, 10);
            const weekEndStr = weekEnd.toISOString().slice(0, 10);
            
            // 取得該醫師的名稱（用於匹配）
            const doctor = DOCTORS.value.find(d => d.id === doctorId);
            const doctorName = doctor ? doctor.name : null;

            console.log(`🔍 檢查本週預約 - doctorId: ${doctorId}, doctorName: ${doctorName}, 週日: ${weekStartStr}, 週六: ${weekEndStr}`);

            const result = allBookings.value.filter((b) => {
              const bookingDate = b.start.slice(0, 10);
              // 同時支援 doctorId 和 doctorName 匹配
              const idMatch = b.doctorId === doctorId;
              const nameMatch = doctorName && b.doctorName === doctorName;
              // 只計算 confirmed 狀態的預約（待完成的預約）
              const match = (idMatch || nameMatch) &&
                bookingDate >= weekStartStr &&
                bookingDate <= weekEndStr &&
                b.status === "confirmed";
              if (match) {
                console.log(`✅ 本週預約找到: ${b.id}, doctorName: ${b.doctorName}, date: ${bookingDate}, status: ${b.status}`);
              }
              return match;
            });
            
            console.log(`📊 本週待完成預約 (${doctorName || doctorId}): ${result.length}`);
            return result;
          };

          const getDoctorAvailableSlots = (doctorId) => {
            const doctorBookings = getDoctorTodayBookings(doctorId);
            
            // 動態解析營業時間設定
            const parseTime = (timeStr) => {
              if (!timeStr) return 0;
              const [h, m] = timeStr.split(':').map(Number);
              return h * 60 + (m || 0);
            };
            
            // 從 businessHours 取得設定（使用預設值作為備援）
            const morningStart = parseTime(businessHours.value.morning_start || '10:00');
            const morningEnd = parseTime(businessHours.value.morning_end || '14:00');
            const afternoonStart = parseTime(businessHours.value.afternoon_start || '14:00');
            const afternoonEnd = parseTime(businessHours.value.afternoon_end || '19:00');
            const interval = businessHours.value.slot_interval || 30;
            
            // 計算總時段數
            const morningSlots = Math.floor((morningEnd - morningStart) / interval);
            const afternoonSlots = Math.floor((afternoonEnd - afternoonStart) / interval);
            const totalSlots = morningSlots + afternoonSlots;
            
            // 計算該醫師的可用時段（總時段 - 已預約數）
            const availableSlots = totalSlots - doctorBookings.length;
            return Math.max(0, availableSlots);
          };
          
          // 取得每位醫師的總時段數（用於計算使用率）
          const getTotalSlots = () => {
            const parseTime = (timeStr) => {
              if (!timeStr) return 0;
              const [h, m] = timeStr.split(':').map(Number);
              return h * 60 + (m || 0);
            };
            
            const morningStart = parseTime(businessHours.value.morning_start || '10:00');
            const morningEnd = parseTime(businessHours.value.morning_end || '14:00');
            const afternoonStart = parseTime(businessHours.value.afternoon_start || '14:00');
            const afternoonEnd = parseTime(businessHours.value.afternoon_end || '19:00');
            const interval = businessHours.value.slot_interval || 30;
            
            const morningSlots = Math.floor((morningEnd - morningStart) / interval);
            const afternoonSlots = Math.floor((afternoonEnd - afternoonStart) / interval);
            return morningSlots + afternoonSlots;
          };
          
          // 手動刷新預約狀況
          const refreshBookingStatus = async () => {
            isRefreshingStatus.value = true;
            try {
              await loadAllBookings();
              autoRefreshCountdown.value = 30; // 重置倒數
            } catch (error) {
              console.error("刷新預約狀況失敗:", error);
            } finally {
              isRefreshingStatus.value = false;
            }
          };
          
          // 啟動自動刷新
          const startAutoRefresh = () => {
            if (autoRefreshInterval) clearInterval(autoRefreshInterval);
            
            autoRefreshInterval = setInterval(() => {
              autoRefreshCountdown.value--;
              
              if (autoRefreshCountdown.value <= 0) {
                refreshBookingStatus();
              }
            }, 1000);
          };
          
          // 停止自動刷新
          const stopAutoRefresh = () => {
            if (autoRefreshInterval) {
              clearInterval(autoRefreshInterval);
              autoRefreshInterval = null;
            }
          };
          
          // 午夜自動更新今日日期
          let midnightTimeout = null;
          const scheduleMidnightUpdate = () => {
            // 計算距離午夜的毫秒數
            const now = new Date();
            const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            const msUntilMidnight = tomorrow - now + 1000; // 加1秒確保已過午夜
            
            if (midnightTimeout) clearTimeout(midnightTimeout);
            
            midnightTimeout = setTimeout(() => {
              // 更新今日日期（使用本地時間）
              const newToday = getLocalDateString();
              if (todayDate.value !== newToday) {
                todayDate.value = newToday;
                console.log('📅 日曆今日日期已更新:', newToday);
              }
              // 設置下一次午夜更新
              scheduleMidnightUpdate();
            }, msUntilMidnight);
            
            console.log(`⏰ 下次日期更新: ${Math.round(msUntilMidnight / 1000 / 60)} 分鐘後`);
          };

          // 🌤️ 天氣提醒相關函數
          const formatWeatherTime = (timeStr) => {
            if (!timeStr) return '';
            try {
              const date = new Date(timeStr);
              return date.toLocaleString('zh-HK', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              });
            } catch {
              return timeStr;
            }
          };

          const checkAndShowWeatherAlert = async () => {
            try {
              // 檢查今日是否已經選擇「今日不再顯示」
              const today = new Date().toDateString();
              const dismissedDate = localStorage.getItem('weatherAlertDismissed');
              if (dismissedDate === today) {
                console.log('🌤️ 今日已選擇不顯示天氣提醒');
                return;
              }

              console.log('🌤️ 正在獲取天氣資訊...');
              const response = await fetch(`${API_URL}/weather`);
              
              if (!response.ok) {
                console.warn('⚠️ 無法獲取天氣資訊');
                return;
              }

              const data = await response.json();
              console.log('🌤️ 天氣資訊:', data);

              // 無論天氣如何，登入時都顯示天氣資訊
              if (data) {
                weatherData.value = data;
                showWeatherAlert.value = true;
                console.log('🌤️ 顯示天氣提醒彈窗');
              }
            } catch (error) {
              console.error('❌ 獲取天氣資訊失敗:', error);
            }
          };

          const closeWeatherAlert = () => {
            if (dontShowWeatherToday.value) {
              // 儲存今日不再顯示的設定
              const today = new Date().toDateString();
              localStorage.setItem('weatherAlertDismissed', today);
              console.log('🌤️ 已設定今日不再顯示天氣提醒');
            }
            showWeatherAlert.value = false;
            dontShowWeatherToday.value = false;
          };

          const canCancelBooking = (booking) => {
            if (booking.status === "cancelled") return false;

            // 直接使用系統本地時間（無需轉換）
            const now = new Date();
            const bookingTime = new Date(booking.start);

            // 正確解析 createdAt（可能是 "2025-11-11 14:30:00" 格式）
            let createdAt;
            if (booking.createdAt.includes("T")) {
              // ISO 格式：2025-11-11T14:30:00Z 或 2025-11-11T14:30:00
              createdAt = new Date(booking.createdAt);
            } else {
              // 空格格式：2025-11-11 14:30:00
              // 直接當作本地時間解析
              const parts = booking.createdAt.split(/[- :]/);
              createdAt = new Date(
                parts[0],
                parts[1] - 1,
                parts[2],
                parts[3],
                parts[4],
                parts[5]
              );
            }

            // 計算預約創建到現在經過的時間（毫秒）
            const msSinceCreated = now - createdAt;
            const minutesSinceCreated = msSinceCreated / (1000 * 60);

            console.log("canCancelBooking 詳細檢查:", {
              bookingId: booking.id,
              原始createdAt字串: booking.createdAt,
              解析後createdAt: createdAt.toString(),
              現在時間now: now.toString(),
              時間差毫秒: msSinceCreated,
              時間差分鐘: minutesSinceCreated.toFixed(2),
              是否小於等於15分鐘: minutesSinceCreated <= 15,
              判斷結果: minutesSinceCreated <= 15 ? "可以取消" : "不能取消",
            });

            // 規則：預約創建後15分鐘內可以取消
            return minutesSinceCreated <= 15;
          };

          // 🆕 訪客「初體驗預約」流程：免帳戶訪客填姓名+電話後直接預約初體驗
          const startGuestTrial = () => {
            console.log("startGuestTrial", currentMember.value);
            if (currentMember.value) {
              // 已登入：直接跳去初體驗服務（step 1）
              guestTrialFlow.value = true;
              const trial = SERVICES.value.find((s) => s.name && s.name.includes('初體驗'));
              if (trial) selectedService.value = trial.id;
              view.value = "booking";
              step.value = 1;
              return;
            }
            // 未登入訪客：彈出「訪客預約」表格（淨填姓名+電話）
            guestBookingInfo.value = { name_zh: "", name_en: "", phone: "", age: "", email: "" };
            guestBookingError.value = "";
            showGuestBooking.value = true;
          };

          // 訪客提交姓名電話 → 直接進入初體驗預約流程
          const submitGuestBooking = () => {
            const nameZh = (guestBookingInfo.value.name_zh || "").trim();
            const nameEn = (guestBookingInfo.value.name_en || "").trim();
            const phone = (guestBookingInfo.value.phone || "").trim();
            const age = String(guestBookingInfo.value.age ?? "").trim(); // v-model number input 會綁成數字，先轉字串先可以 .trim()
            const email = String(guestBookingInfo.value.email ?? "").trim();
            const fail = (msg) => { guestBookingError.value = msg; return false; };
            guestBookingError.value = "";
            if (!nameZh) return fail("請輸入中文全名");
            if (!nameEn) return fail("請輸入英文全名");
            if (!/^[A-Za-z\s.'-]+$/.test(nameEn)) return fail("請輸入有效嘅英文全名（只能含有英文字母）");
            if (!/^[0-9]{8}$/.test(phone)) return fail("請輸入有效嘅 8 位電話號碼");
            if (age && (!/^\d{1,3}$/.test(age) || Number(age) < 1 || Number(age) > 120)) return fail("請輸入有效嘅歲數（1-120）");
            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("請輸入有效嘅電郵地址");

            // 填寫客戶聯絡資料（step 3 會自動帶入）
            customerName.value = nameZh;
            customerNameEn.value = nameEn;
            customerPhone.value = phone;
            customerEmail.value = email;
            customerAge.value = age ? Number(age) : null;

            // 直接進入初體驗預約流程（訪客預約選單）
            const trial = SERVICES.value.find((s) => s.name && s.name.includes('初體驗'));
            selectedService.value = trial ? trial.id : (SERVICES.value[0]?.id || 'S1');
            showGuestBooking.value = false;
            guestFlowActive.value = true;
            step.value = 1;
            // 自動滾動到預約區
            nextTick(() => {
              const el = document.getElementById('guest-booking-panel');
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
          };

          // 關閉訪客預約流程（返回官網首頁）
          const closeGuestBooking = () => {
            guestFlowActive.value = false;
            resetBooking();
          };

          // 登入功能
          const handleLogin = async () => {
            try {
              const response = await fetch(`${API_URL}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  username: loginId.value,
                  password: loginPassword.value,
                  captchaAnswer: loginCaptchaAnswer.value,
                  portal: loginRole.value,
                }),
              });

              if (response.ok) {
                const data = await response.json();

                // 🔑 儲存 JWT Token（所有受保護 API 驗證用）
                if (data.token) {
                  localStorage.setItem('jwtToken', data.token);
                }

                // 🆕 如果是管理員，跳轉到管理員後台
                if (data.user.role === "admin") {
                  localStorage.setItem('adminToken', JSON.stringify({
                    id: data.user.id,
                    username: data.user.username,
                    name: data.user.name,
                    role: data.user.role
                  }));
                  alert("歡迎管理員，" + data.user.name + "！將帶您前往管理後台。");
                  window.location.href = 'admin.html';
                  return;
                }

                // 👨‍⚕️ 如果是醫師，跳轉到醫師專屬版面
                if (data.user.role === "doctor") {
                  localStorage.setItem('doctorUser', JSON.stringify(data.user));
                  alert("歡迎，" + data.user.name + "！將帶您前往醫師管理版面。");
                  window.location.href = 'doctor.html';
                  return;
                }

                // 🧑‍💼 如果是員工，跳轉到員工專屬版面
                if (data.user.role === "staff") {
                  localStorage.setItem('staffUser', JSON.stringify(data.user));
                  alert("歡迎，" + data.user.name + "！將帶您前往員工管理版面。");
                  window.location.href = 'staff.html';
                  return;
                }

                // 一般用戶繼續使用預約系統
                // 保存用戶的數據庫 ID
                loginId.value = data.user.id;
                currentMember.value = {
                  id: data.user.username,
                  dbId: data.user.id,
                  name: data.user.name,
                  phone: data.user.phone,
                  email: data.user.email || "",
                  memberLevel: "一般會員",
                  profile_completed: data.user.profile_completed || 0,
                  days_remaining: data.user.days_remaining || null,
                  must_change_password: !!data.mustChangePassword,
                };

                // 💾 儲存登入狀態到 localStorage（保持登入）
                localStorage.setItem('userToken', JSON.stringify({
                  id: data.user.username,
                  dbId: data.user.id,
                  name: data.user.name,
                  phone: data.user.phone,
                  email: data.user.email || "",
                  memberLevel: "一般會員",
                  profile_completed: data.user.profile_completed || 0,
                  days_remaining: data.user.days_remaining || null,
                  must_change_password: !!data.mustChangePassword,
                  loginTime: new Date().toISOString()
                }));

                // 🔒 子帳戶臨時密碼：強制首次更改
                const needsPwChange = !!(data.mustChangePassword || data.user.must_change_password);
                currentMember.value.must_change_password = needsPwChange;
                if (needsPwChange) {
                  forceChangePw.value = true;
                  try {
                    const savedTok = JSON.parse(localStorage.getItem('userToken') || 'null');
                    if (savedTok) { savedTok.must_change_password = true; localStorage.setItem('userToken', JSON.stringify(savedTok)); }
                  } catch (e) {}
                }
                
                customerName.value = data.user.name;
                customerPhone.value = data.user.phone;
                customerEmail.value = data.user.email || "";
                step.value = 1;

                // 🆕 訪客初體驗流程：登入後自動導向初體驗服務
                if (guestTrialFlow.value) {
                  guestTrialFlow.value = false;
                  const trial = SERVICES.value.find((s) => s.name && s.name.includes('初體驗'));
                  if (trial) selectedService.value = trial.id;
                  view.value = "booking";
                }

                // 載入該用戶的預約記錄
                loadBookings();

                // 載入所有預約以更新即時狀況
                loadAllBookings();
                
                // 🆕 載入用戶的完整個人資料
                loadUserProfile();
                
                // 🆕 載入會員資料（級別/訂閱/家庭帳戶）
                loadMyMembership();
                
                // 🔔 檢查是否有管理員回覆
                checkUnreadReplies();

                // 🛡️ 登入成功後返回頁頂（會員介面由頭開始）
                window.scrollTo({ top: 0, behavior: "auto" });

                // 🆕 檢查是否需要完善個人資料（加入倒數天數提示）
                if (data.user.profile_completed === 0) {
                  view.value = "mySettings";
                  const daysRemaining = data.user.days_remaining || 3;
                  const urgency = daysRemaining <= 1 ? "⚠️ 緊急提醒：" : "歡迎！";
                  alert(`${urgency}請在 ${daysRemaining} 天內完善您的個人資料（身份證號、出生日期、地址、緊急聯絡人及電子郵件），否則賬戶將被自動取消，需要重新註冊。`);
                }
                
                // 🌤️ 檢查並顯示天氣提醒
                checkAndShowWeatherAlert();

                // 🔝 登入成功後將畫面滾動到最頂端（初體驗預約流程則留在預約區）
                if (!guestTrialFlow.value) {
                  nextTick(() => {
                    window.scrollTo({ top: 0, behavior: 'auto' });
                  });
                }
              } else {
                const error = await response.json();
                // 驗證碼錯誤時自動重新整理驗證碼
                if (error.field === 'captcha') {
                  loadCaptcha();
                }
                alert(error.error || "會員ID或電話號碼不正確，請確認後再試");
              }
            } catch (error) {
              console.error("登入錯誤:", error);
              alert("登入失敗，請稍後再試");
            }
          };

          // 登出功能
          const handleLogout = () => {
            // 🔒 通知伺服器將 token 加入黑名單（如仍在有效期間）
            try {
              fetch(`${API_URL}/auth/logout`, { method: "POST" }).catch(() => {});
            } catch (e) {}
            // 🗑️ 清除 localStorage 中的登入狀態
            localStorage.removeItem('userToken');
            localStorage.removeItem('jwtToken');
            
            currentMember.value = null;
            step.value = 0;
            guestTrialFlow.value = false;
            loginPassword.value = "";
            loginId.value = "";
            view.value = "booking";
            loadCaptcha();
            
            // 🆕 清除個人資料，防止登出後舊資料還在
            userProfile.value = {
              username: "",
              name: "",
              name_en: "",
              phone: "",
              email: "",
              id_card: "",
              address: "",
              birth_date: "",
              emergency_contact: "",
              emergency_email: "",
            };
            birthYear.value = "";
            birthMonth.value = "";
            birthDay.value = "";
            
            resetBooking();
            // 🆕 重置會員資料
            membership.value = { loading: false, tier: 'general', tierName: '一般會員', subscription: null, upgradeOptions: {}, isFamilyHead: false, canApplyFamily: false, parent: null, children: [], insurance: false, profile_completed: false };
            // 🛡️ 登出後即時返回官網頁頂（避免停留喺登入表格位置，看起來似卡死）
            window.scrollTo({ top: 0, behavior: "auto" });
            if (window.location.hash) history.replaceState(null, "", window.location.pathname);
            realTier.value = null;
            upgradeTier.value = null;
            selectedChildBookings.value = null;
            familyList.value = { children: [] };
          };

          // 設定視圖
          const setView = (newView) => {
            console.log("setView called with:", newView);
            
            // 檢查是否需要完善個人資料（除了 mySettings 頁面、中醫討論區）
            if (currentMember.value && currentMember.value.profile_completed === 0 && newView !== "mySettings" && newView !== "forum") {
              alert("請先完善您的個人資料，才能使用其他功能。");
              view.value = "mySettings";
              loadUserProfile();
              return;
            }
            
            // 檢查 AI 問診是否開放
            if (newView === "aiCustomerService" && !aiConsultationEnabled.value) {
              alert("該功能尚在開發中");
              return;
            }
            
            view.value = newView;
            // 💄 切換頁面時自動返回頂部，避免停留喺上一頁嘅捲動位置
            window.scrollTo({ top: 0, behavior: 'smooth' });
            if (newView === "booking") {
              resetBooking();
            } else if (newView === "myBookings") {
              // 當切換到「我的預約」頁面時，重新載入預約記錄以獲取最新狀態
              loadBookings();
            } else if (newView === "myMedical") {
              // 當切換到「我的病歴」時載入病歴與療程進度
              loadMedicalHistory();
            } else if (newView === "mySettings") {
              // 當切換到「我的設定」時載入個人資料
              loadUserProfile();
              // 🆕 確保會員資料已載入（家庭帳戶按鈕需要）
              if (!membership.value.tier || membership.value.tier === 'general') loadMyMembership();
            } else if (newView === "feedback") {
              // 當切換到「意見箱」時載入我的反饋記錄
              loadMyFeedbacks();
            } else if (newView === "myMembership") {
              // 當切換到「會員中心」時載入會員資料
              loadMyMembership();
            } else if (newView === "forum") {
              // 當切換到「中醫討論區」時載入最新帖子
              loadForumPosts();
            }
          };

          // ==================== 會員中心 / 家庭帳戶 ====================
          const loadMyMembership = async () => {
            if (!currentMember.value?.dbId) return;
            membership.value.loading = true;
            try {
              const res = await fetch(`${API_URL}/membership`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('jwtToken') || ''}` }
              });
              if (!res.ok) throw new Error('status');
              const data = await res.json();
              membership.value = { ...membership.value, ...data };
              membership.value.subStatus = data.subscriptionStatus || 'none';
              membership.value.loading = false;
              familyList.value = { children: data.children || [] };
              realTier.value = data.tier || 'general';
              loadAccountLinks();
            } catch (e) {
              console.warn('無法載入會員資料', e);
              membership.value.loading = false;
              realTier.value = (currentMember.value && currentMember.value.tier) || 'general';
            }
          };

          // 🆕 載入「我的連結帳戶」
          const loadAccountLinks = async () => {
            if (!currentMember.value?.dbId) return;
            linkLoading.value = true;
            try {
              const res = await fetch(`${API_URL}/membership/account-links`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('jwtToken') || ''}` }
              });
              if (!res.ok) throw new Error('status');
              const data = await res.json();
              accountLinks.value = data.links || [];
            } catch (e) {
              console.warn('無法載入連結帳戶', e);
              accountLinks.value = [];
            } finally {
              linkLoading.value = false;
            }
          };

          // 🆕 連結新帳戶（客人自助；家庭戶主可代子女）
          const createAccountLink = async () => {
            linkError.value = '';
            const target = (linkForm.value.targetUsername || '').trim();
            if (!target) { linkError.value = '請輸入對方用戶名'; return; }
            if (linkForm.value.relation === '其他' && !(linkForm.value.customRelation || '').trim()) {
              linkError.value = '請輸入關係說明'; return;
            }
            linkBusy.value = true;
            try {
              const body = {
                targetUsername: target,
                relation: linkForm.value.relation,
                customRelation: linkForm.value.relation === '其他' ? linkForm.value.customRelation.trim() : undefined,
                fromUserId: linkForm.value.fromUserId || currentMemberId.value
              };
              const res = await fetch(`${API_URL}/membership/account-links`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('jwtToken') || ''}` },
                body: JSON.stringify(body)
              });
              const data = await res.json();
              if (res.ok && data.ok) {
                linkForm.value = { targetUsername: '', relation: '朋友', customRelation: '', fromUserId: currentMemberId.value };
                await loadMyMembership();
              } else {
                linkError.value = data.error || '連結失敗';
              }
            } catch (e) {
              linkError.value = '連結服務暫時不可用';
            } finally {
              linkBusy.value = false;
            }
          };

          // 🆕 解除連結
          const removeAccountLink = async (lk) => {
            if (!confirm(`確定解除與「${lk.other.name || lk.other.username}」嘅連結？`)) return;
            try {
              const res = await fetch(`${API_URL}/membership/account-links/${lk.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${localStorage.getItem('jwtToken') || ''}` }
              });
              const data = await res.json();
              if (res.ok && data.ok) await loadAccountLinks();
              else alert(data.error || '解除失敗');
            } catch (e) {
              alert('解除服務暫時不可用');
            }
          };

          const startCheckout = async (tier) => {
            if (!tier || upgrading.value) return;
            upgrading.value = true;
            try {
              const res = await fetch(`${API_URL}/membership/checkout`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${localStorage.getItem('jwtToken') || ''}`
                },
                body: JSON.stringify({ tier })
              });
              const data = await res.json();
              if (data.url) {
                window.location.href = data.url;
              } else {
                alert(data.error || '無法建立付款連結');
              }
            } catch (e) {
              console.error(e);
              alert('付款服務暫時不可用');
            } finally {
              upgrading.value = false;
            }
          };

          const cancelSubscription = async () => {
            const isFamily = membership.value.tier === 'family';
            const kidsCount = (familyList.value.children || []).length;
            const msg = isFamily
              ? `確定取消家庭月費計劃？\n\n取消後會即時降級為一般會員並停止扣款${kidsCount ? `，同時解除 ${kidsCount} 位家庭成員連結（成員帳戶會保留，級別返回一般，日後升返家庭可由職員重新連結）` : ''}。`
              : '確定取消月費計劃？取消後會即時降級為一般會員，並停止日後自動扣款。';
            if (!confirm(msg)) return;
            if (cancellingSub.value) return;
            cancellingSub.value = true;
            try {
              const res = await fetch(`${API_URL}/membership/cancel`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('jwtToken') || ''}` }
              });
              const data = await res.json();
              if (res.ok && data.ok) {
                alert(data.message || '已取消月費計劃');
                await loadMyMembership();
              } else {
                alert(data.error || '取消失敗');
              }
            } catch (e) {
              console.error(e);
              alert('取消服務暫時不可用');
            } finally {
              cancellingSub.value = false;
            }
          };

          const activateFamily = async () => {
            try {
              const res = await fetch(`${API_URL}/membership/apply-family`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('jwtToken') || ''}` }
              });
              const data = await res.json();
              if (data.ok) {
                await loadMyMembership();
              } else {
                alert(data.error || '啟用失敗');
              }
            } catch (e) {
              console.error(e);
              alert('啟用服務暫時不可用');
            }
          };

          const loadChildBookings = async (child) => {
            try {
              const res = await fetch(`${API_URL}/membership/family/${child.id}/bookings`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('jwtToken') || ''}` }
              });
              const data = await res.json();
              selectedChildBookings.value = {
                label: `${child.name} 的預約記錄`,
                bookings: data.bookings || []
              };
            } catch (e) {
              console.error(e);
              alert('無法載入預約狀態');
            }
          };

          // 重設密碼功能（電郵驗證碼方式）
          // 關閉重設密碼彈窗並重置狀態
          const closeResetPasswordModal = () => {
            showResetPassword.value = false;
            resetPasswordStep.value = 1;
            // 清除倒計時計時器
            if (codeCountdownInterval) {
              clearInterval(codeCountdownInterval);
              codeCountdownInterval = null;
            }
            if (resendCountdownInterval) {
              clearInterval(resendCountdownInterval);
              resendCountdownInterval = null;
            }
            codeCountdown.value = 0;
            resendCountdown.value = 0;
            canResendCode.value = false;
            sendingCode.value = false;
            resettingPassword.value = false;
            resetVerifyMethod.value = 'email';
            resetPasswordData.value = {
              email: "",
              phone: "",
              code: "",
              newPassword: "",
              confirmPassword: "",
            };
            resetPasswordError.value = "";
            resetPasswordSuccess.value = "";
          };

          // 發送驗證碼（只支援電郵）
          const sendResetCode = async () => {
            resetPasswordError.value = "";
            resetPasswordSuccess.value = "";

            // 驗證電郵輸入
            if (!resetPasswordData.value.email) {
              resetPasswordError.value = "請輸入電子郵件地址";
              return;
            }
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(resetPasswordData.value.email)) {
              resetPasswordError.value = "請輸入有效的電子郵件地址";
              return;
            }

            sendingCode.value = true;

            try {
              const response = await fetch(`${API_URL}/auth/send-reset-code`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: resetPasswordData.value.email }),
              });

              const data = await response.json();

              if (response.ok) {
                resetPasswordSuccess.value = data.message || "驗證碼已發送到您的電子郵件";
                resetPasswordStep.value = 2;
                
                // 啟動驗證碼有效期倒計時（10 分鐘）
                codeCountdown.value = 600;
                if (codeCountdownInterval) {
                  clearInterval(codeCountdownInterval);
                }
                codeCountdownInterval = setInterval(() => {
                  codeCountdown.value--;
                  if (codeCountdown.value <= 0) {
                    clearInterval(codeCountdownInterval);
                    codeCountdownInterval = null;
                    resetPasswordError.value = "驗證碼已過期，請重新發送";
                    resetPasswordStep.value = 1;
                    resetPasswordData.value.code = "";
                  }
                }, 1000);
                
                // 啟動重新發送倒計時（60 秒）
                resendCountdown.value = 60;
                canResendCode.value = false;
                if (resendCountdownInterval) {
                  clearInterval(resendCountdownInterval);
                }
                resendCountdownInterval = setInterval(() => {
                  resendCountdown.value--;
                  if (resendCountdown.value <= 0) {
                    clearInterval(resendCountdownInterval);
                    resendCountdownInterval = null;
                    canResendCode.value = true;
                  }
                }, 1000);
                
              } else {
                resetPasswordError.value = data.error || "發送驗證碼失敗";
              }
            } catch (error) {
              console.error("發送驗證碼錯誤:", error);
              resetPasswordError.value = "系統錯誤，請稍後再試";
            } finally {
              sendingCode.value = false;
            }
          };

          // 使用驗證碼重設密碼
          const handleResetPassword = async () => {
            resetPasswordError.value = "";
            resetPasswordSuccess.value = "";

            // 驗證輸入
            if (!resetPasswordData.value.code) {
              resetPasswordError.value = "請輸入驗證碼";
              return;
            }

            if (resetPasswordData.value.code.length !== 6) {
              resetPasswordError.value = "驗證碼必須是 6 位數字";
              return;
            }

            if (!resetPasswordData.value.newPassword || !resetPasswordData.value.confirmPassword) {
              resetPasswordError.value = "請填寫新密碼";
              return;
            }

            if (resetPasswordData.value.newPassword !== resetPasswordData.value.confirmPassword) {
              resetPasswordError.value = "兩次輸入的密碼不一致";
              return;
            }

            if (resetPasswordData.value.newPassword.length < 6) {
              resetPasswordError.value = "密碼長度至少需要6個字元";
              return;
            }

            resettingPassword.value = true;

            try {
              // 🔒 SMS 已全面取消，重設密碼一律經電郵驗證碼
              const endpoint = `${API_URL}/auth/reset-password-with-code`;

              const bodyData = {
                email: resetPasswordData.value.email,
                code: resetPasswordData.value.code,
                newPassword: resetPasswordData.value.newPassword,
              };

              const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(bodyData),
              });

              const data = await response.json();

              if (response.ok) {
                // 停止所有倒計時
                if (codeCountdownInterval) {
                  clearInterval(codeCountdownInterval);
                  codeCountdownInterval = null;
                }
                if (resendCountdownInterval) {
                  clearInterval(resendCountdownInterval);
                  resendCountdownInterval = null;
                }
                resetPasswordSuccess.value = "密碼已成功重設！請使用新密碼登入";
                setTimeout(() => {
                  closeResetPasswordModal();
                }, 2000);
              } else {
                resetPasswordError.value = data.error || "重設密碼失敗";
              }
            } catch (error) {
              console.error("重設密碼錯誤:", error);
              resetPasswordError.value = "系統錯誤，請稍後再試";
            } finally {
              resettingPassword.value = false;
            }
          };

          // 已登入用戶更改密碼
          const handleChangePassword = async () => {
            changePasswordError.value = "";
            changePasswordSuccess.value = "";

            // 驗證：只需要檢查新密碼欄位
            if (
              !changePasswordData.value.newPassword ||
              !changePasswordData.value.confirmPassword
            ) {
              changePasswordError.value = "請填寫新密碼和確認密碼";
              return;
            }

            if (changePasswordData.value.newPassword !== changePasswordData.value.confirmPassword) {
              changePasswordError.value = "兩次輸入的密碼不一致";
              return;
            }

            const newPw = changePasswordData.value.newPassword;
            if (newPw.length < 8 || !/[A-Za-z]/.test(newPw) || !/\d/.test(newPw)) {
              changePasswordError.value = "密碼至少 8 個字元，且需包含英文字母和數字";
              return;
            }

            // 使用 currentMember.value.id (即 username)
            if (!currentMember.value || !currentMember.value.id) {
              changePasswordError.value = "用戶資訊錯誤，請重新登入";
              return;
            }

            try {
              const response = await fetch(`${API_URL}/reset-password-authenticated`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  username: currentMember.value.id,  // currentMember.id 就是 username
                  newPassword: changePasswordData.value.newPassword,
                  confirmPassword: changePasswordData.value.confirmPassword,
                }),
              });

              const data = await response.json();

              if (response.ok) {
                changePasswordSuccess.value = "密碼已成功更新！";
                changePasswordData.value = {
                  newPassword: "",
                  confirmPassword: "",
                };
                setTimeout(() => {
                  changePasswordSuccess.value = "";
                }, 3000);
              } else {
                changePasswordError.value = data.error || "更新密碼失敗";
              }
            } catch (error) {
              console.error("更新密碼錯誤:", error);
              changePasswordError.value = "系統錯誤，請稍後再試";
            }
          };

          // 🔒 強制更改臨時密碼（子帳戶首登）
          const submitForcePassword = async () => {
            forcePwError.value = "";
            const { currentPassword, newPassword, confirmPassword } = forcePwData.value;
            if (!currentPassword || !newPassword || !confirmPassword) {
              forcePwError.value = "請填寫臨時密碼、新密碼及確認新密碼";
              return;
            }
            if (newPassword !== confirmPassword) {
              forcePwError.value = "兩次輸入的新密碼不一致";
              return;
            }
            if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
              forcePwError.value = "新密碼至少 8 個字元，且需包含英文字母和數字";
              return;
            }
            if (newPassword === currentPassword) {
              forcePwError.value = "新密碼不可與臨時密碼相同";
              return;
            }
            forcePwBusy.value = true;
            try {
              const response = await fetch(`${API_URL}/auth/change-password`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${localStorage.getItem("jwtToken") || ""}`,
                },
                body: JSON.stringify({ currentPassword, newPassword }),
              });
              const data = await response.json().catch(() => ({}));
              if (response.ok) {
                // 同步清除本地旗標
                try {
                  const saved = JSON.parse(localStorage.getItem('userToken') || 'null');
                  if (saved) { saved.must_change_password = false; localStorage.setItem('userToken', JSON.stringify(saved)); }
                } catch (e) {}
                if (currentMember.value) currentMember.value.must_change_password = false;
                forceChangePw.value = false;
                forcePwData.value = { currentPassword: "", newPassword: "", confirmPassword: "" };
                alert("密碼已更新，歡迎使用！");
              } else {
                forcePwError.value = data.error || "更改密碼失敗，請確認臨時密碼是否正確";
              }
            } catch (error) {
              console.error("強制更改密碼錯誤:", error);
              forcePwError.value = "系統錯誤，請稍後再試";
            } finally {
              forcePwBusy.value = false;
            }
          };

          // 查找用戶ID功能
          const handleFindUserId = async () => {
            findUserIdError.value = "";
            findUserIdResult.value = null;

            if (!findUserIdData.value.name || !findUserIdData.value.phone) {
              findUserIdError.value = "請填寫所有欄位";
              return;
            }

            try {
              const response = await fetch(`${API_URL}/find-user-id`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: findUserIdData.value.name,
                  phone: findUserIdData.value.phone,
                }),
              });

              const data = await response.json();

              if (response.ok) {
                findUserIdResult.value = {
                  username: data.username,
                  name: data.name,
                };
              } else {
                findUserIdError.value = data.error || "找不到符合的用戶資料";
              }
            } catch (error) {
              console.error("查找用戶ID錯誤:", error);
              findUserIdError.value = "系統錯誤，請稍後再試";
            }
          };

          // 載入用戶個人資料
          const loadUserProfile = async () => {
            if (!currentMember.value) {
              console.warn("⚠️ currentMember 未設置，跳過 loadUserProfile");
              return;
            }

            if (!loginId.value) {
              console.warn("⚠️ loginId 未設置，使用 currentMember.dbId:", currentMember.value.dbId);
              loginId.value = currentMember.value.dbId;
            }

            console.log("🔄 正在載入用戶個人資料... loginId:", loginId.value);

            try {
              const response = await fetch(
                `${API_URL}/users/${loginId.value}/profile`
              );
              
              console.log("📍 API 端點:", `${API_URL}/users/${loginId.value}/profile`);
              console.log("📊 API 回應狀態:", response.status);
              
              if (response.ok) {
                const data = await response.json();
                console.log("✅ 成功載入個人資料:", data);
                
                userProfile.value = {
                  username: data.username || "",
                  name: data.name || "",
                  name_en: data.name_en || "",
                  phone: data.phone || "",
                  email: data.email || "",
                  id_card: data.id_card || "",
                  address: data.address || "",
                  birth_date: data.birth_date || "",
                  emergency_contact: data.emergency_contact || "",
                  emergency_phone: data.emergency_phone || "",
                  username_last_changed: data.username_last_changed || "",
                  name_last_changed: data.name_last_changed || "",
                };

                // 🆕 載入 WhatsApp 通知偏好
                whatsappPrefs.value = {
                  weather: Number(data.whatsapp_weather) !== 0,
                  confirm: Number(data.whatsapp_confirm) !== 0,
                  health: Number(data.whatsapp_health) !== 0,
                };

                // 🆕 檢查是否可以修改會員ID和中文姓名
                checkCanChangeUsername();
                checkCanChangeName();

                // 將出生日期拆分成年月日
                if (data.birth_date) {
                  const parts = data.birth_date.split("-");
                  if (parts.length === 3) {
                    birthYear.value = parts[0];
                    birthMonth.value = parts[1];
                    birthDay.value = parts[2];
                  }
                }

                // 🆕 同步頭像（公仔或上傳圖片）
                if (data.avatar) {
                  userAvatar.value = data.avatar;
                  currentMember.value.avatar = data.avatar;
                  if (!data.avatar.startsWith('/')) avatarEmoji.value = data.avatar;
                }
              } else {
                console.error("❌ 載入個人資料失敗，狀態碼:", response.status);
                const errorData = await response.json();
                console.error("❌ 錯誤信息:", errorData);
              }
            } catch (error) {
              console.error("❌ 載入個人資料錯誤:", error);
            }
          };
          
          // 🆕 檢查是否可以修改會員ID
          const checkCanChangeUsername = () => {
            if (userProfile.value.username_last_changed) {
              const lastChanged = new Date(userProfile.value.username_last_changed);
              const oneYearAgo = new Date();
              oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
              
              if (lastChanged > oneYearAgo) {
                canChangeUsername.value = false;
                const nextDate = new Date(lastChanged);
                nextDate.setFullYear(nextDate.getFullYear() + 1);
                usernameNextChangeDate.value = nextDate.toLocaleDateString('zh-TW');
              } else {
                canChangeUsername.value = true;
                usernameNextChangeDate.value = "";
              }
            } else {
              canChangeUsername.value = true;
              usernameNextChangeDate.value = "";
            }
          };
          
          // 🆕 檢查是否可以修改中文姓名
          const checkCanChangeName = () => {
            if (userProfile.value.name_last_changed) {
              const lastChanged = new Date(userProfile.value.name_last_changed);
              const oneYearAgo = new Date();
              oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
              
              if (lastChanged > oneYearAgo) {
                canChangeName.value = false;
                const nextDate = new Date(lastChanged);
                nextDate.setFullYear(nextDate.getFullYear() + 1);
                nameNextChangeDate.value = nextDate.toLocaleDateString('zh-TW');
              } else {
                canChangeName.value = true;
                nameNextChangeDate.value = "";
              }
            } else {
              canChangeName.value = true;
              nameNextChangeDate.value = "";
            }
          };
          
          // 🆕 開始編輯會員ID
          const startEditUsername = () => {
            newUsername.value = userProfile.value.username;
            usernameError.value = "";
            editingUsername.value = true;
          };
          
          // 🆕 取消編輯會員ID
          const cancelEditUsername = () => {
            editingUsername.value = false;
            newUsername.value = "";
            usernameError.value = "";
          };
          
          // 🆕 保存會員ID
          const saveUsername = async () => {
            usernameError.value = "";
            
            if (!newUsername.value.trim()) {
              usernameError.value = "請輸入會員ID";
              return;
            }
            
            if (!/^[a-zA-Z0-9_]+$/.test(newUsername.value.trim())) {
              usernameError.value = "只能包含英文字母、數字和底線";
              return;
            }
            
            if (newUsername.value.trim().length < 3 || newUsername.value.trim().length > 20) {
              usernameError.value = "長度必須在 3-20 個字符之間";
              return;
            }
            
            try {
              const response = await fetch(`${API_URL}/users/${loginId.value}/username`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ newUsername: newUsername.value.trim() }),
              });
              
              const data = await response.json();
              
              if (response.ok) {
                userProfile.value.username = data.newUsername || newUsername.value.trim();
                userProfile.value.username_last_changed = data.usernameLastChanged;
                // 更新 currentMember
                if (currentMember.value) {
                  currentMember.value.username = userProfile.value.username;
                }
                checkCanChangeUsername();
                editingUsername.value = false;
                newUsername.value = "";
                alert("✅ 會員ID已更新！請注意：下次修改需等待一年。");
              } else {
                usernameError.value = data.error || "更新失敗";
              }
            } catch (error) {
              console.error("更新會員ID錯誤:", error);
              usernameError.value = "系統錯誤，請稍後再試";
            }
          };
          
          // 🆕 開始編輯中文姓名
          const startEditName = () => {
            newName.value = userProfile.value.name;
            nameError.value = "";
            editingName.value = true;
          };
          
          // 🆕 取消編輯中文姓名
          const cancelEditName = () => {
            editingName.value = false;
            newName.value = "";
            nameError.value = "";
          };
          
          // 🆕 保存中文姓名
          const saveName = async () => {
            nameError.value = "";
            
            if (!newName.value.trim()) {
              nameError.value = "請輸入中文姓名";
              return;
            }
            
            if (newName.value.trim().length < 2 || newName.value.trim().length > 20) {
              nameError.value = "長度必須在 2-20 個字符之間";
              return;
            }
            
            try {
              const response = await fetch(`${API_URL}/users/${loginId.value}/name`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ newName: newName.value.trim() }),
              });
              
              const data = await response.json();
              
              if (response.ok) {
                userProfile.value.name = data.newName || newName.value.trim();
                userProfile.value.name_last_changed = data.nameLastChanged;
                // 更新 currentMember
                if (currentMember.value) {
                  currentMember.value.name = userProfile.value.name;
                }
                checkCanChangeName();
                editingName.value = false;
                newName.value = "";
                alert("✅ 中文姓名已更新！請注意：下次修改需等待一年。");
              } else {
                nameError.value = data.error || "更新失敗";
              }
            } catch (error) {
              console.error("更新中文姓名錯誤:", error);
              nameError.value = "系統錯誤，請稍後再試";
            }
          };

          // 儲存用戶個人資料
          const saveProfile = async () => {
            profileSaveSuccess.value = false;

            // 🆕 檢查必填欄位是否完整
            const missingFields = [];
            
            // 電話必填
            if (!userProfile.value.phone) missingFields.push("電話號碼");
            // 驗證電話格式
            if (userProfile.value.phone && !/^\d{8}$/.test(userProfile.value.phone)) {
              alert("❌ 請輸入有效的 8 位電話號碼");
              return;
            }
            // 電郵必填
            if (!userProfile.value.email) missingFields.push("電子郵件");
            // 驗證電郵格式
            if (userProfile.value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userProfile.value.email)) {
              alert("❌ 請輸入有效的電子郵件地址");
              return;
            }
            
            if (!userProfile.value.id_card) missingFields.push("身份證號碼");
            if (!userProfile.value.address) missingFields.push("地址");
            if (!birthYear.value || !birthMonth.value || !birthDay.value) missingFields.push("出生日期");
            if (!userProfile.value.emergency_contact) missingFields.push("緊急聯絡人姓名");
            if (!userProfile.value.emergency_phone) missingFields.push("緊急聯絡人電話");

            if (missingFields.length > 0) {
              alert("❌ 請完成以下欄位的填寫：\n\n" + missingFields.join("\n") + "\n\n所有欄位都必須填寫才能完成個人資料設定。");
              return;
            }

            // 組合年月日成完整日期格式 YYYY-MM-DD
            if (birthYear.value && birthMonth.value && birthDay.value) {
              const year = birthYear.value.padStart(4, "0");
              const month = birthMonth.value.padStart(2, "0");
              const day = birthDay.value.padStart(2, "0");
              userProfile.value.birth_date = `${year}-${month}-${day}`;
            }

            try {
              const response = await fetch(
                `${API_URL}/users/${loginId.value}/profile`,
                {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(userProfile.value),
                }
              );

              if (response.ok) {
                profileSaveSuccess.value = true;
                // 更新 currentMember 的資料
                currentMember.value.phone = userProfile.value.phone;
                currentMember.value.email = userProfile.value.email;
                customerPhone.value = userProfile.value.phone;
                customerEmail.value = userProfile.value.email;

                // 如果個人資料尚未完成，檢查是否已填寫所有必填欄位並標記為完成
                if (currentMember.value.profile_completed === 0) {
                  const completeResponse = await fetch(
                    `${API_URL}/users/${currentMember.value.id}/complete-profile`,
                    { method: "PATCH" }
                  );
                  
                  if (completeResponse.ok) {
                    currentMember.value.profile_completed = 1;
                    
                    // 🆕 更新 localStorage 中的 userToken，保存新的 profile_completed 狀態
                    const updatedToken = localStorage.getItem('userToken');
                    if (updatedToken) {
                      const userData = JSON.parse(updatedToken);
                      userData.profile_completed = 1;
                      localStorage.setItem('userToken', JSON.stringify(userData));
                      console.log("✅ localStorage 已更新 profile_completed 狀態");
                    }
                    
                    alert("✅ 個人資料已完善！您現在可以使用所有功能了。");
                  }
                } else {
                  alert("✅ 個人資料已成功儲存");
                }

                setTimeout(() => {
                  profileSaveSuccess.value = false;
                }, 3000);
              } else {
                const error = await response.json();
                console.error("❌ 儲存失敗:", error);
                // 🆕 顯示具體的錯誤信息（例如身份證號已被使用）
                alert("❌ " + (error.error || "儲存失敗，請稍後再試"));
              }
            } catch (error) {
              console.error("儲存個人資料錯誤:", error);
              alert("系統錯誤，請稍後再試");
            }
          };

          // 載入時段狀態（支援醫師時段）
          const doctorTimeSlots = ref({});
          
          // 🛏️ 床位透明化：需要床位嘅服務，攞每個時段剩餘床位
          const loadBedSlotInfo = async () => {
            bedSlotInfo.value = {};
            const svc = SERVICES.value.find((s) => s.id === selectedService.value);
            if (!svc || !svc.requires_bed || !selectedDate.value) return;
            try {
              const res = await fetch(
                `${API_URL}/bookings/timeslots/available?date=${selectedDate.value}&serviceId=${svc.id}&bedType=${selectedBedType.value}`
              );
              if (!res.ok) return;
              const data = await res.json();
              const map = {};
              for (const s of data) {
                if (s.bedLeft !== undefined) {
                  map[s.time] = { bedLeft: s.bedLeft, bedCap: s.bedCap, available: s.available };
                }
              }
              bedSlotInfo.value = map;
            } catch (e) {
              console.warn('載入床位資訊失敗:', e);
            }
          };

          const loadTimeSlots = async () => {
            try {
              // 🛏️ 順便更新床位資訊（唔阻塞時段載入）
              loadBedSlotInfo();
              // 先嘗試使用醫師時段 API
              const doctorResponse = await fetch(
                `${API_URL}/bookings/doctor-time-slots/${selectedDate.value}`
              );
              
              if (doctorResponse.ok) {
                const data = await doctorResponse.json();
                doctorTimeSlots.value = data.slots || {};
                
                // 更新營業時間
                if (data.businessHours) {
                  businessHours.value = {
                    morning_start: data.businessHours.morningStart || '10:00',
                    morning_end: data.businessHours.morningEnd || '14:00',
                    afternoon_start: data.businessHours.afternoonStart || '14:00',
                    afternoon_end: data.businessHours.afternoonEnd || '19:00',
                    slot_interval: data.businessHours.slotInterval || 30
                  };
                }
                
                // 同時更新舊格式數據以保持兼容
                const allTimes = [...(data.morningSlots || []), ...(data.afternoonSlots || [])];
                timeSlotsFromAPI.value = allTimes.map(time => {
                  const slotData = data.slots[time] || {};
                  // 計算該時段是否有任何可用醫師
                  const availableDoctors = Object.values(slotData).filter(d => 
                    d.is_available && d.current_bookings < (d.max_capacity || 1)
                  ).length;
                  
                  return {
                    date: selectedDate.value,
                    time: time,
                    is_available: availableDoctors > 0 ? 1 : 0
                  };
                });
                
                console.log("✅ 載入醫師時段:", Object.keys(doctorTimeSlots.value).length, "個時段");
                return;
              }
              
              // 備援：使用舊 API
              const response = await fetch(
                `${API_URL}/time-slots/${selectedDate.value}`
              );
              if (response.ok) {
                const data = await response.json();
                timeSlotsFromAPI.value = data.timeSlots || [];
              }
            } catch (error) {
              console.error("載入時段狀態失敗:", error);
            }
          };

          // 載入服務列表
          const loadServices = async () => {
            try {
              console.log("🔄 正在載入服務列表...");
              const response = await fetch(`${API_URL}/services`);
              console.log(
                "📡 API 回應狀態:",
                response.status,
                response.statusText
              );

              if (response.ok) {
                const data = await response.json();
                console.log("📦 從 API 取得的原始資料:", data);

                if (!data || data.length === 0) {
                  console.warn("⚠️ API 回傳空的服務列表");
                  return;
                }

                // 更新 SERVICES，保留 bedType 和 short 屬性
                SERVICES.value = data.map((service) => {
                  // 根據服務名稱判斷 bedType
                  let bedType = "none";
                  let short = service.name;

                  if (
                    service.name.includes("推拿") &&
                    service.name.includes("針灸")
                  ) {
                    bedType = "mixed";
                    short = `推 + 針 ${service.duration}m`;
                  } else if (service.name.includes("推拿")) {
                    bedType = "tuina";
                    short = `推拿 ${service.duration}m`;
                  } else if (service.name.includes("針灸")) {
                    bedType = "acup";
                    short = `針灸 ${service.duration}m`;
                  } else if (service.name.includes("諮詢")) {
                    bedType = "none";
                    short = `新症諮詢 ${service.duration}m`;
                  }

                  return {
                    id: service.id,
                    name: service.name,
                    short: short,
                    bedType: bedType,
                    requires_bed: service.requires_bed === 1 || service.requires_bed === true,
                    duration: service.duration,
                    price: service.price || 0,
                  };
                });
                console.log(
                  "✅ 服務列表已載入，共",
                  SERVICES.value.length,
                  "項:",
                  SERVICES.value
                );
              } else {
                console.error(
                  "❌ API 回應錯誤:",
                  response.status,
                  response.statusText
                );
              }
            } catch (error) {
              console.error("❌ 載入服務列表失敗:", error);
            }
          };

          // 載入預約記錄（當前用戶的預約）
          // 載入預約記錄（當前用戶的預約）
          const loadBookings = async () => {
            if (!currentMember.value) return;

            // 使用數據庫 ID（dbId）來查詢，兼容舊數據也用 username（id）查詢
            const dbId = currentMember.value.dbId || currentMember.value.id;
            const username = currentMember.value.id;

            try {
              // 同時用 dbId 和 username 查詢以兼容新舊數據
              const response = await fetch(
                `${API_URL}/bookings?userId=${dbId}&username=${username}`
              );
              if (response.ok) {
                const apiResponse = await response.json();
                
                console.log("📥 loadBookings API 原始回應:", apiResponse);
                
                // 兼容新舊 API 格式
                const bookingsList = apiResponse.data || apiResponse;
                console.log("📋 處理的預約列表:", bookingsList);

                bookings.value = bookingsList.map((booking) => {
                  try {
                    if (!booking.appointment_date || !booking.appointment_time) {
                      return null;
                    }

                    let timeStr = booking.appointment_time;
                    if (!timeStr.includes(":")) {
                      timeStr = "00:00:00";
                    } else {
                      const colonCount = (timeStr.match(/:/g) || []).length;
                      if (colonCount === 1) {
                        timeStr = timeStr + ":00";
                      }
                    }

                    const dateStr = booking.appointment_date.trim();
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                      return null;
                    }

                    const startDateTime = `${dateStr}T${timeStr}`;
                    const testDate = new Date(startDateTime);
                    if (isNaN(testDate.getTime())) {
                      return null;
                    }

                    let doctorId = "d1";
                    if (booking.doctor_name) {
                      const doctor = DOCTORS.value.find(
                        (d) => d.name === booking.doctor_name
                      );
                      if (doctor) {
                        doctorId = doctor.id;
                      }
                    }

                    return {
                      id: booking.id,
                      memberId: booking.user_id,
                      doctorId: doctorId,
                      serviceId: booking.service_id,
                      start: startDateTime,
                      end: startDateTime,
                      status: booking.status || "confirmed",
                      is_locked: booking.is_locked === 1 || booking.is_locked === true,
                      customerName: booking.customer_name,
                      customerPhone: booking.customer_phone,
                      customerEmail: booking.customer_email,
                      notes: booking.notes,
                      createdAt: booking.created_at,
                      cancelledAt: booking.cancelled_at,
                    };
                  } catch (err) {
                    return null;
                  }
                });

                bookings.value = bookings.value.filter((b) => b !== null);
                // 自動載入每筆預約的病歴與療程進度，方便在「我的預約」顯示追蹤方格
                bookings.value.forEach((b) => {
                  fetchMedicalForBooking(b.id);
                });
              }
            } catch (error) {
              console.error("載入預約記錄失敗:", error);
            }
          };

          // 載入所有預約記錄（用於即時狀況顯示）
          const loadAllBookings = async () => {
            try {
              // 🛡️ 此 API 需要登入；訪客唔使亦唔應該打（避免 401 噪音）
              if (!currentMember.value) return;
              const response = await fetch(`${API_URL}/bookings`);
              if (response.ok) {
                const apiResponse = await response.json();
                
                console.log("📥 loadAllBookings API 原始回應:", apiResponse);
                
                // 兼容新舊 API 格式
                const bookingsList = apiResponse.data || apiResponse;
                console.log("📋 所有預約列表:", bookingsList);
                console.log("📋 當前 DOCTORS:", DOCTORS.value);
                
                allBookings.value = bookingsList.map((booking) => {
                  // 確保時間格式正確
                  let timeStr = booking.appointment_time;
                  if (!timeStr.includes(":")) {
                    timeStr = "00:00:00";
                  } else if (timeStr.split(":").length === 2) {
                    timeStr = timeStr + ":00";
                  }

                  // 根據醫師名稱映射到 doctorId
                  let doctorId = null;
                  const doctorName = booking.doctor_name || "";
                  if (doctorName) {
                    const doctor = DOCTORS.value.find(
                      (d) => d.name === doctorName
                    );
                    if (doctor) {
                      doctorId = doctor.id;
                    } else {
                      console.warn(`⚠️ 找不到醫師: ${doctorName}, 可用醫師:`, DOCTORS.value.map(d => d.name));
                    }
                  }

                  return {
                    id: booking.id,
                    memberId: booking.user_id,
                    doctorId: doctorId,
                    doctorName: doctorName, // 保存原始醫師名稱以便後續匹配
                    serviceId: booking.service_id,
                    start: `${booking.appointment_date}T${timeStr}`,
                    end: `${booking.appointment_date}T${timeStr}`,
                    status: booking.status || "confirmed",
                    is_locked: booking.is_locked === 1 || booking.is_locked === true,
                    customerName: booking.customer_name,
                    customerPhone: booking.customer_phone,
                    customerEmail: booking.customer_email,
                    notes: booking.notes,
                    createdAt: booking.created_at,
                    cancelledAt: booking.cancelled_at,
                  };
                });
              }
            } catch (error) {
              console.error("載入所有預約記錄失敗:", error);
            }
          };

          // 載入診所設定
          const loadClinicSettings = async () => {
            try {
              const response = await fetch(`${API_URL}/clinic-settings`);
              if (response.ok) {
                const data = await response.json();
                TOTAL_BEDS.value.tuina = parseInt(data.tuina_beds || 5);
                TOTAL_BEDS.value.vip = parseInt(data.vip_rooms || data.vip_beds || 5);
                TOTAL_BEDS.value.acup = parseInt(data.acupuncture_beds || 5);
                totalDoctors.value = parseInt(data.total_doctors || 3);
                // 載入休息日設定
                if (data.closed_days !== undefined && data.closed_days !== '') {
                  closedDays.value = data.closed_days.split(',').map(d => parseInt(d)).filter(d => !isNaN(d));
                } else {
                  closedDays.value = [0]; // 預設星期日休息
                }
                console.log("✅ 休息日設定:", closedDays.value);
                
                // 載入公眾假期設定
                holidaysEnabled.value = data.holidays_enabled === '1' || data.holidays_enabled === 1 || data.holidays_enabled === true;
                console.log("✅ 公眾假期啟用:", holidaysEnabled.value);
                
                // 載入營業假期設定
                if (data.working_holidays && data.working_holidays !== '') {
                  workingHolidays.value = data.working_holidays.split(',').filter(d => d);
                } else {
                  workingHolidays.value = [];
                }
                console.log("✅ 營業假期:", workingHolidays.value);
                
                // 載入開放月份設定
                if (data.open_months && data.open_months !== '') {
                  openMonths.value = data.open_months.split(',').filter(m => m);
                } else {
                  openMonths.value = [];
                }
                console.log("✅ 開放月份:", openMonths.value);
                
                // 載入自訂特別日期設定
                if (data.custom_closed_dates && data.custom_closed_dates !== '') {
                  customClosedDates.value = data.custom_closed_dates.split(',').filter(d => d);
                } else {
                  customClosedDates.value = [];
                }
                console.log("✅ 自訂額外休息日:", customClosedDates.value);
                
                if (data.custom_open_dates && data.custom_open_dates !== '') {
                  customOpenDates.value = data.custom_open_dates.split(',').filter(d => d);
                } else {
                  customOpenDates.value = [];
                }
                console.log("✅ 自訂額外營業日:", customOpenDates.value);
                
                // 載入營業時間設定
                businessHours.value = {
                  morning_start: data.morning_start || '10:00',
                  morning_end: data.morning_end || '14:00',
                  afternoon_start: data.afternoon_start || '14:00',
                  afternoon_end: data.afternoon_end || '19:00',
                  slot_interval: parseInt(data.slot_interval || 30)
                };
                console.log("✅ 營業時間:", businessHours.value);
                
                // 如果啟用公眾假期，載入假期數據
                if (holidaysEnabled.value) {
                  await loadHolidays();
                }
              }
            } catch (error) {
              console.error("載入診所設定失敗:", error);
            }

            // 載入醫師資料
            try {
              const response = await fetch(`${API_URL}/doctors`);
              if (response.ok) {
                const doctors = await response.json();
                DOCTORS.value = doctors.map((doc, index) => ({
                  id: `d${doc.id}`,
                  name: doc.name,
                  specialty: doc.specialty,
                }));
                totalDoctors.value = DOCTORS.value.length;
              }
            } catch (error) {
              console.error("載入醫師資料失敗:", error);
            }
            
            // 載入 API 設定（AI 問診開關）
            try {
              const response = await fetch(`${API_URL}/api-settings`);
              if (response.ok) {
                const data = await response.json();
                aiConsultationEnabled.value = data.ai_consultation_enabled !== false && data.ai_consultation_enabled !== 'false';
                console.log("✅ AI 問診開放:", aiConsultationEnabled.value);
              }
            } catch (error) {
              console.error("載入 API 設定失敗:", error);
            }
          };
          
          // 載入公眾假期
          const loadHolidays = async () => {
            try {
              const response = await fetch(`${API_URL}/holidays`);
              if (response.ok) {
                const data = await response.json();
                holidays.value = data.holidays || [];
                console.log("✅ 已載入公眾假期:", holidays.value.length, "個");
              }
            } catch (error) {
              console.error("載入公眾假期失敗:", error);
            }
          };
          
          // 選擇服務
          const isServiceLocked = (svc) => {
            const tier = realTier.value || 'general';
            if (tier === 'premium' || tier === 'family') return false;
            return !(svc && svc.name && svc.name.includes('初體驗'));
          };
          const selectService = (serviceId) => {
            const svc = SERVICES.value.find((s) => s.id === serviceId);
            if (isServiceLocked(svc)) {
              if (!currentMember.value) {
                alert("訪客模式僅可預約「初體驗（一小時）」服務。如需預約其他服務，請先註冊會員。");
                return;
              }
              const go = confirm('此服務需要升級至「高級會員」或「家庭會員」方可預約。是否前往會員中心查看升級方案？');
              if (go) { setView('myMembership'); loadMyMembership(); }
              return;
            }
            selectedService.value = serviceId;
            // 🛏️ 揀完服務即攞床位資訊（需要床位嘅服務）
            loadBedSlotInfo();
            step.value = 2;
          };

          // 🛏️ 載入所選床位類型嘅空閒床位（手法床 / VIP房）
          const loadBedOptions = async () => {
            const svc = SERVICES.value.find((s) => s.id === selectedService.value);
            if (!svc || !svc.requires_bed || !selectedTime.value) { bedOptions.value = []; return; }
            bedLoading.value = true;
            try {
              const res = await fetch(
                `${API_URL}/bookings/beds/available?date=${selectedDate.value}&serviceId=${svc.id}&time=${getTime24(selectedTime.value.startIso)}&bedType=${selectedBedType.value}`
              );
              if (res.ok) bedOptions.value = (await res.json()).beds || [];
            } catch (e) {
              console.warn('載入床位失敗:', e);
            } finally {
              bedLoading.value = false;
            }
          };

          // 設定選擇時間
          const setSelectedTime = async (slot) => {
            selectedTime.value = slot;
            // 🛏️ 需要床位嘅服務：攞該時段每張床嘅空閒狀態
            selectedBed.value = null;
            bedOptions.value = [];
            await loadBedOptions();
          };

          // 揀床位
          const pickBed = (n) => { selectedBed.value = n; };

          // 切換床位類型（手法床 / VIP房），重載可選床位
          const selectBedType = async (type) => {
            if (selectedBedType.value === type) return;
            selectedBedType.value = type;
            selectedBed.value = null;
            bedOptions.value = [];
            await loadBedOptions();
            loadBedSlotInfo();
          };

          // 驗證並繼續
          const validateAndProceed = () => {
            // 檢查日期是否為休息日或未開放月份
            const today = new Date();
            const todayStr = today.toISOString().slice(0, 10);
            const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
            const selectedDateStr = selectedDate.value;
            const selectedMonthStr = selectedDateStr.substring(0, 7);
            
            // 檢查是否為過去日期
            if (selectedDateStr < todayStr) {
              alert("無法選擇過去的日期，請選擇今天或之後的日期");
              return;
            }
            
            // 檢查月份是否開放（當前月份永遠開放）
            if (selectedMonthStr !== currentMonth && !openMonths.value.includes(selectedMonthStr)) {
              alert(`該月份 (${selectedMonthStr}) 尚未開放預約，請預約已開放的日子`);
              return;
            }
            
            // 檢查是否為休息日
            const dateObj = new Date(selectedDateStr);
            const dayOfWeek = dateObj.getDay();
            const isNormallyClosedDay = closedDays.value.includes(dayOfWeek);
            const isCustomClosed = customClosedDates.value.includes(selectedDateStr);
            const isCustomOpen = customOpenDates.value.includes(selectedDateStr);
            
            // 額外休息日直接阻擋
            if (isCustomClosed) {
              alert(`該日期已設為休息日，請選擇其他日子`);
              return;
            }
            
            // 如果是正常休息日但不是額外營業日
            if (isNormallyClosedDay && !isCustomOpen) {
              const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
              alert(`星期${weekDays[dayOfWeek]}為診所休息日，請選擇其他日子`);
              return;
            }
            
            // 檢查是否為公眾假期（排除設定為營業的假期）
            if (holidaysEnabled.value) {
              const holidayInfo = holidays.value.find(h => h.date === selectedDateStr);
              if (holidayInfo && !workingHolidays.value.includes(selectedDateStr)) {
                alert(`${holidayInfo.name} 診所休息，請選擇其他日子`);
                return;
              }
            }
            
            if (!selectedTime.value) {
              alert("請選擇時段");
              return;
            }

            // 🛏️ 需要床位嘅服務：必須揀床
            const bedSvc = SERVICES.value.find((s) => s.id === selectedService.value);
            if (bedSvc && bedSvc.requires_bed && !selectedBed.value) {
              alert("請選擇床位");
              return;
            }
            step.value = 3;
          };

          // 模擬發送 WhatsApp 通知
          const sendWhatsAppNotification = (booking) => {
            const service = SERVICES.value.find(
              (s) => s.id === booking.serviceId
            );
            const doctor = DOCTORS.value.find((d) => d.id === booking.doctorId);

            if (!service || !doctor) {
              console.warn("服務或醫師資料未找到", {
                service,
                doctor,
                booking,
              });
              return;
            }

            const message = `📅 預約確認通知\n\n親愛的 ${
              booking.customerName
            }，\n您已成功更改預約 ${formatDate(booking.start)} ${formatShort(
              booking.start
            )} 的 ${service.name}，由 ${
              doctor.name
            } 為您服務。\n\n📍 寶天醫館\n📞 服務專線：2345-6789`;

            console.log("電子郵件通知已發送:", message);
            alert(
              `📧 電子郵件通知已發送至 ${booking.customerEmail}\n\n${message}`
            );
          };

          // 預約功能（直接建立預約）
          const reserve = async () => {
            bookingError.value = "";
            if (!selectedTime.value) { bookingError.value = "請選擇時段"; return; }

            const svc = SERVICES.value.find(
              (s) => s.id === selectedService.value
            );

            if (!svc) {
              bookingError.value = "服務資料載入中，請稍後再試";
              return;
            }

            const doctor =
              selectedDoctor.value === "any"
                ? DOCTORS.value[
                    Math.floor(Math.random() * DOCTORS.value.length)
                  ]
                : DOCTORS.value.find((d) => d.id === selectedDoctor.value);

            const doctorName = doctor ? doctor.name : "張醫師";

            // 設置載入狀態
            isBooking.value = true;

            try {
              // 直接建立預約（訪客免帳戶：唔傳 userId + 帶 isGuest 旗標）
              const bodyPayload = {
                customerName: customerName.value,
                customerNameEn: customerNameEn.value,
                customerPhone: customerPhone.value,
                customerEmail: customerEmail.value,
                customerAge: customerAge.value || null,
                serviceId: svc.id,
                doctorName: doctorName,
                appointmentDate: selectedDate.value,
                appointmentTime: getTime24(selectedTime.value.startIso),
                notes: customerNotes.value,
                sendEmailNotification: true,
              };
              // 🛏️ 需要床位嘅服務：帶客人揀嘅床位類型 + 床號
              if (svc.requires_bed && selectedBed.value) {
                bodyPayload.bedType = selectedBedType.value;
                bodyPayload.bedNumber = selectedBed.value;
              }
              if (!currentMember.value) {
                bodyPayload.isGuest = true;
              } else {
                bodyPayload.userId = currentMember.value?.dbId || currentMember.value?.id;
              }

              const response = await fetch(`${API_URL}/bookings`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(bodyPayload),
              });

              if (response.ok) {
                const data = await response.json();
                bookingError.value = "";

                // 儲存預約成功資訊
                bookingResult.value = {
                  id: data.booking?.id || data.id,
                  service: svc,
                  doctorName: doctorName,
                  date: selectedDate.value,
                  time: selectedTime.value,
                };

                // 更新本地預約列表（訪客無帳戶，跳過需登入嘅載入）
                await loadBookings();
                if (currentMember.value) await loadAllBookings();

                // 顯示預約成功彈窗
                showBookingSuccess.value = true;
              } else {
                const error = await response.json();
                bookingError.value = error.error || "預約失敗，請稍後再試";
              }
            } catch (error) {
              console.error("預約錯誤:", error);
              bookingError.value = "預約失敗，請檢查網絡連接後再試";
            } finally {
              isBooking.value = false;
            }
          };

          // 關閉預約成功彈窗
          const closeBookingSuccess = () => {
            showBookingSuccess.value = false;
            bookingResult.value = null;

            // 重置預約流程
            step.value = 1;
            selectedService.value = "";
            selectedDoctor.value = "any";
            selectedTime.value = null;

            if (currentMember.value) {
              // 切換到「我的預約」視圖
              view.value = "myBookings";
              // 重新載入預約列表
              loadBookings();
            } else if (guestFlowActive.value) {
              // 訪客預約：留在訪客預約面板，可繼續預約
              step.value = 1;
              const trial = SERVICES.value.find((s) => s.name && s.name.includes('初體驗'));
              selectedService.value = trial ? trial.id : (SERVICES.value[0]?.id || 'S1');
              resetBooking();
            } else {
              // 訪客無帳戶：留在預約頁首步，可繼續預約
              view.value = "booking";
              resetBooking();
            }

            result.value = {
              success: true,
              msg: `✅ 預約成功！`
            };
          };

          // 取消預約
          const cancelBooking = async (bookingId) => {
            if (confirm("⚠️ 確定要取消這個預約嗎？\n\n（如用戶遇上不可抗力的情況，本診所會酌情處理）")) {
              // 設置載入狀態
              isCancelling.value = true;
              cancellingBookingId.value = bookingId;
              
              try {
                // 更新資料庫
                const response = await fetch(
                  `${API_URL}/bookings/${bookingId}/status`,
                  {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: "cancelled" }),
                  }
                );

                if (response.ok) {
                  // 更新本地狀態
                  const cancelledAt = new Date().toISOString();
                  bookings.value = bookings.value.map((b) =>
                    b.id === bookingId
                      ? { ...b, status: "cancelled", cancelledAt }
                      : b
                  );

                  // 重新載入所有預約以更新即時狀況
                  await loadAllBookings();

                  alert("✅ 預約已取消，取消通知已發送至您的聯絡方式");

                  // 15分鐘後從列表中移除
                  setTimeout(() => {
                    bookings.value = bookings.value.filter(
                      (b) => !(b.id === bookingId && b.status === "cancelled")
                    );
                  }, 15 * 60 * 1000);
                } else {
                  alert("取消預約失敗，請稍後再試");
                }
              } catch (error) {
                console.error("取消預約錯誤:", error);
                alert("取消預約失敗，請稍後再試");
              } finally {
                isCancelling.value = false;
                cancellingBookingId.value = null;
              }
            }
          };

          // 開始修改預約
          const startEditBooking = (booking) => {
            if (booking.is_locked || booking.status === 'confirmed') {
              alert("此預約已確認並鎖定，無法修改。請聯繫診所。");
              return;
            }
            editingBooking.value = booking;
            selectedService.value = booking.serviceId;
            selectedDoctor.value = booking.doctorId;
            selectedDate.value = booking.start.slice(0, 10);
            view.value = "booking";
            step.value = 2;
          };

          // 取消編輯
          const cancelEdit = () => {
            editingBooking.value = null;
            resetBooking();
            view.value = "myBookings";
          };

          // 更新預約
          const updateBooking = async () => {
            if (!selectedTime.value) return alert("請選擇時段");
            const svc = SERVICES.value.find(
              (s) => s.id === selectedService.value
            );

            if (!svc) {
              alert("服務資料載入中，請稍後再試");
              return;
            }

            const doctor =
              selectedDoctor.value === "any"
                ? DOCTORS.value[
                    Math.floor(Math.random() * DOCTORS.value.length)
                  ].id
                : selectedDoctor.value;

            const doctorName =
              DOCTORS.value.find((d) => d.id === doctor)?.name || "張醫師";

            // 設置載入狀態
            isUpdating.value = true;

            try {
              // 更新資料庫
              const response = await fetch(
                `${API_URL}/bookings/${editingBooking.value.id}`,
                {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    serviceId: svc.id,
                    doctorName: doctorName,
                    appointmentDate: selectedDate.value,
                    appointmentTime: getTime24(selectedTime.value.startIso),
                    customerName: customerName.value,
                    customerPhone: customerPhone.value,
                    customerEmail: customerEmail.value,
                    notes: customerNotes.value,
                  }),
                }
              );

              if (response.ok) {
                // 更新本地狀態
                bookings.value = bookings.value.map((b) =>
                  b.id === editingBooking.value.id
                    ? {
                        ...b,
                        doctorId: doctor,
                        serviceId: svc.id,
                        start: selectedTime.value.startIso,
                        end: selectedTime.value.endIso,
                        customerName: customerName.value,
                        customerPhone: customerPhone.value,
                        customerEmail: customerEmail.value,
                        notes: customerNotes.value,
                      }
                    : b
                );

                // 重新載入所有預約以更新即時狀況
                await loadAllBookings();

                if (sendWhatsApp.value) {
                  sendWhatsAppNotification({
                    ...editingBooking.value,
                    doctorId: doctor,
                    serviceId: svc.id,
                    start: selectedTime.value.startIso,
                    end: selectedTime.value.endIso,
                    customerName: customerName.value,
                    customerPhone: customerPhone.value,
                  });
                }

                result.value = {
                  success: true,
                  msg: `✅ 預約已更新！\n${
                    svc.name
                  }\n醫師：${doctorName}\n時間：${formatDate(
                    selectedTime.value.startIso
                  )} ${formatShort(selectedTime.value.startIso)}`,
                };
                editingBooking.value = null;
                step.value = 4;
              } else {
                alert("更新預約失敗，請稍後再試");
              }
            } catch (error) {
              console.error("更新預約錯誤:", error);
              alert("更新預約失敗，請稍後再試");
            } finally {
              isUpdating.value = false;
            }
          };

          // 重置預約表單
          const resetBooking = () => {
            console.log("resetBooking called");
            step.value = 1;
            // 會員介面已過濾「初體驗」，重置時要揀會員可見嘅第一個服務，避免選中隱形服務
            const pool = currentMember.value ? bookableServices.value : SERVICES.value;
            selectedService.value = pool[0]?.id || "S1";
            selectedDoctor.value = "any";
            selectedDate.value = new Date().toISOString().slice(0, 10);
            selectedTime.value = null;
            customerNotes.value = "";
            result.value = null;
            editingBooking.value = null;

            // 保留會員資料
            if (currentMember.value) {
              customerName.value = currentMember.value.name;
              customerPhone.value = currentMember.value.phone;
              customerEmail.value = currentMember.value.email;
              customerAge.value = null;
            }
          };

          // 日曆功能
          const prevMonth = () => {
            if (calendarMonth.value === 0) {
              calendarMonth.value = 11;
              calendarYear.value--;
            } else {
              calendarMonth.value--;
            }
          };

          const nextMonth = () => {
            if (calendarMonth.value === 11) {
              calendarMonth.value = 0;
              calendarYear.value++;
            } else {
              calendarMonth.value++;
            }
          };

          const selectCalendarDate = (day) => {
            if (!day.isCurrentMonth) return;
            if (day.isPast) {
              alert('無法選擇過去的日期');
              return;
            }
            if (day.isMonthClosed) {
              const monthStr = day.date.substring(0, 7);
              alert(`該月份 (${monthStr}) 尚未開放預約，請聯繫診所查詢`);
              return;
            }
            if (day.isClosed) {
              if (day.isHoliday) {
                alert(`${day.holidayName} - 診所休息`);
              } else {
                alert('該日為診所休息日');
              }
              return;
            }
            selectedDate.value = day.date;
          };

          // ====== 醫療分流功能 ======

          // 分流文字輔助函數
          const getTriageText = (zh, en) => {
            if (aiLang.value === "en") return en;
            return zh;
          };

          // 開始分流流程
          const startTriage = async (lang) => {
            aiLang.value = lang;
            aiLanguageSelected.value = true;
            triageInProgress.value = true;
            triageCurrentIndex.value = 0;
            triageAnswers.value = [];
            triageScores.value = {};
            triageResult.value = null;

            try {
              // 載入分流問題
              const response = await fetch(`${API_URL}/triage/questions`);
              if (response.ok) {
                const data = await response.json();
                triageQuestions.value = data.questions || [];
                console.log("✅ 載入分流問題:", triageQuestions.value.length, "題");
              } else {
                alert(getTriageText("無法載入問題", "Failed to load questions"));
                resetTriage();
              }

              // 載入醫師對應關係
              const doctorResponse = await fetch(`${API_URL}/triage/doctors`);
              if (doctorResponse.ok) {
                const doctorData = await doctorResponse.json();
                triageDoctorMap.value = doctorData.doctors || [];
                console.log("✅ 載入醫師對應:", triageDoctorMap.value);
              }
            } catch (error) {
              console.error("載入分流資料錯誤:", error);
              alert(getTriageText("系統錯誤", "System error"));
              resetTriage();
            }
          };

          // 選擇分流選項
          const selectTriageOption = (option) => {
            const currentQuestion = triageQuestions.value[triageCurrentIndex.value];
            
            // 記錄答案
            triageAnswers.value.push({
              question_zh: currentQuestion.question_zh,
              question_en: currentQuestion.question_en,
              option_zh: option.option_zh,
              option_en: option.option_en,
              scores: option.scores
            });

            // 累計分數
            for (const [doctorId, score] of Object.entries(option.scores)) {
              if (!triageScores.value[doctorId]) {
                triageScores.value[doctorId] = 0;
              }
              triageScores.value[doctorId] += score;
            }

            console.log("📊 當前累計分數:", triageScores.value);

            // 進入下一題或顯示結果
            if (triageCurrentIndex.value < triageQuestions.value.length - 1) {
              triageCurrentIndex.value++;
            } else {
              // 計算結果
              calculateTriageResult();
            }
          };

          // 計算分流結果
          const calculateTriageResult = () => {
            triageInProgress.value = false;

            // 找出最高分的醫師
            let highestScore = -1;
            let recommendedDoctorId = null;

            for (const [doctorId, score] of Object.entries(triageScores.value)) {
              if (score > highestScore) {
                highestScore = score;
                recommendedDoctorId = doctorId;
              }
            }

            console.log("🏆 最高分醫師:", recommendedDoctorId, "分數:", highestScore);

            // 根據醫師ID找到對應資料
            const doctorInfo = triageDoctorMap.value.find(d => d.doctorId === recommendedDoctorId);

            if (doctorInfo) {
              // 計算匹配度百分比（最高可能分數基於問題數量和最高單題分數）
              const maxPossibleScore = triageQuestions.value.length * 5; // 假設每題最高5分
              const matchScore = Math.round((highestScore / maxPossibleScore) * 100);

              triageResult.value = {
                doctorId: doctorInfo.doctorId,
                doctorDbId: doctorInfo.doctorDbId,
                doctorName: doctorInfo.doctorName,
                specialty: doctorInfo.specialty,
                serviceId: doctorInfo.serviceId,
                serviceName: doctorInfo.serviceName,
                totalScore: highestScore,
                matchScore: Math.min(100, Math.max(50, matchScore + 30)) // 確保在50-100之間
              };

              console.log("✅ 分流結果:", triageResult.value);
            } else {
              // 如果找不到對應醫師，使用默認
              const defaultDoctor = triageDoctorMap.value[0] || {
                doctorId: "d1",
                doctorName: "張醫師",
                specialty: "推拿專家",
                serviceId: "S1",
                serviceName: "推拿治療"
              };

              triageResult.value = {
                ...defaultDoctor,
                totalScore: highestScore,
                matchScore: 70
              };
            }
          };

          // 跳轉到預約頁面（帶預選醫師和服務）
          const goToBookingWithTriage = () => {
            if (triageResult.value) {
              // 找到對應的服務ID
              const service = SERVICES.value.find(s => 
                s.id === triageResult.value.serviceId || 
                s.name.includes(triageResult.value.serviceName?.split('（')[0])
              );
              
              // 找到對應的醫師ID
              const doctor = DOCTORS.value.find(d => 
                d.name === triageResult.value.doctorName
              );

              if (service) {
                selectedService.value = service.id;
                console.log("📌 預選服務:", service.id, service.name);
              }

              if (doctor) {
                selectedDoctor.value = doctor.id;
                console.log("📌 預選醫師:", doctor.id, doctor.name);
              }

              // 跳轉到預約頁面
              view.value = "booking";
              step.value = 2; // 直接跳到選擇時間步驟
              
              // 重置分流狀態
              resetTriage();
            }
          };

          // 重置分流
          const resetTriage = () => {
            aiLanguageSelected.value = false;
            triageInProgress.value = false;
            triageCurrentIndex.value = 0;
            triageQuestions.value = [];
            triageAnswers.value = [];
            triageScores.value = {};
            triageResult.value = null;
          };

          // ====== 意見箱功能 ======
          
          // 提交意見反饋
          const submitFeedback = async () => {
            if (!feedbackForm.value.subject || !feedbackForm.value.message) {
              alert('請填寫主題和內容');
              return;
            }
            
            isSubmittingFeedback.value = true;
            
            try {
              const response = await fetch(`${API_URL}/feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  user_id: currentMember.value?.dbId || currentMember.value?.id,
                  user_name: currentMember.value?.name || '匿名用戶',
                  user_phone: currentMember.value?.phone || '',
                  category: feedbackForm.value.category,
                  subject: feedbackForm.value.subject,
                  message: feedbackForm.value.message
                })
              });
              
              const data = await response.json();
              
              if (response.ok) {
                alert('✅ ' + (data.message || '意見已提交成功！感謝您的反饋。'));
                // 清空表單
                feedbackForm.value = {
                  category: 'general',
                  subject: '',
                  message: ''
                };
                // 重新載入我的反饋記錄
                await loadMyFeedbacks();
              } else {
                alert('❌ ' + (data.error || '提交失敗，請稍後再試'));
              }
            } catch (error) {
              console.error('提交意見失敗:', error);
              alert('系統錯誤，請稍後再試');
            } finally {
              isSubmittingFeedback.value = false;
            }
          };
          
          // 載入我的反饋記錄
          const loadMyFeedbacks = async () => {
            if (!currentMember.value) {
              myFeedbacks.value = [];
              return;
            }
            
            try {
              const userId = currentMember.value.dbId || currentMember.value.id;
              const response = await fetch(`${API_URL}/feedback/my-feedback/${userId}`);
              
              if (response.ok) {
                myFeedbacks.value = await response.json();
                // 同時更新未讀數量
                checkUnreadReplies();
              }
            } catch (error) {
              console.error('載入反饋記錄失敗:', error);
            }
          };
          
          // 🔔 檢查未讀的管理員回覆
          const checkUnreadReplies = async () => {
            if (!currentMember.value) return;
            
            try {
              const userId = currentMember.value.dbId || currentMember.value.id;
              const response = await fetch(`${API_URL}/feedback/my-feedback/${userId}/unread-count`);
              
              if (response.ok) {
                const data = await response.json();
                unreadReplyCount.value = data.unreadCount || 0;
                
                // 如果有未讀回覆，顯示通知
                if (unreadReplyCount.value > 0) {
                  showReplyNotification.value = true;
                }
              }
            } catch (error) {
              console.error('檢查未讀回覆失敗:', error);
            }
          };
          
          // 標記回覆為已讀
          const markReplyAsRead = async (feedbackId) => {
            try {
              await fetch(`${API_URL}/feedback/my-feedback/${feedbackId}/mark-read`, {
                method: 'POST'
              });
              // 重新檢查未讀數量
              checkUnreadReplies();
            } catch (error) {
              console.error('標記已讀失敗:', error);
            }
          };
          
          // 前往意見箱並關閉通知
          const goToFeedbackFromNotification = () => {
            showReplyNotification.value = false;
            view.value = 'feedback';
            loadMyFeedbacks();
          };
          
          // 關閉回覆通知
          const dismissReplyNotification = () => {
            showReplyNotification.value = false;
          };
          
          // 獲取反饋類別名稱
          const getFeedbackCategoryName = (category) => {
            const categoryMap = {
              'general': '一般意見',
              'service': '服務質素',
              'booking': '預約系統',
              'suggestion': '改善建議',
              'complaint': '投訴',
              'praise': '讚賞'
            };
            return categoryMap[category] || category;
          };
          
          // 獲取反饋狀態名稱
          const getFeedbackStatusName = (status) => {
            const statusMap = {
              'pending': '待處理',
              'read': '已閱讀',
              'replied': '已回覆',
              'resolved': '已解決',
              'archived': '已歸檔'
            };
            return statusMap[status] || status;
          };
          
          // 格式化反饋日期
          const formatFeedbackDate = (dateStr) => {
            if (!dateStr) return '';
            const date = new Date(dateStr);
            return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
          };

          // 載入伺服器時間（解決時區問題）
          const loadServerTime = async () => {
            try {
              const response = await fetch(`${API_URL}/server-time`);
              if (response.ok) {
                const data = await response.json();
                window.SERVER_TODAY = data.dateStr;
                console.log(`✅ 從伺服器取得今日日期: ${window.SERVER_TODAY}`);
              }
            } catch (error) {
              console.error("❌ 無法取得伺服器時間:", error);
              // 備用：使用客戶端時間
              window.SERVER_TODAY = new Date().toISOString().slice(0, 10);
            }
          };

          // 初始化
          onMounted(async () => {
            console.log("🚀 頁面開始初始化");

            // 🛡️ A: 客戶版面角色閘門 —— 非客戶角色（admin/doctor/staff）跳返對應後台
            if (localStorage.getItem('adminToken') || localStorage.getItem('adminUser')) {
              window.location.href = 'admin.html'; return;
            }
            if (localStorage.getItem('doctorUser')) {
              window.location.href = 'doctor.html'; return;
            }
            if (localStorage.getItem('staffUser')) {
              window.location.href = 'staff.html'; return;
            }

            console.log("📋 初始 SERVICES 內容:", SERVICES.value);

            // 🆕 載入官網內容（公告/影片/社交/評價/動態文字）
            loadSiteContent();
            // 🆕 載入討論區帖子
            loadForumPosts();

            // 🔐 先同步恢復登入狀態，避免重整/登入/登出時「登入畫面閃一下」或彈出登入頁
            const savedUser = localStorage.getItem('userToken');
            let restored = false;
            if (savedUser && !localStorage.getItem('jwtToken')) {
              // 🔑 有登入紀錄但無 JWT，視為失效，清除
              localStorage.removeItem('userToken');
              localStorage.removeItem('jwtToken');
            } else if (savedUser) {
              try {
                const userData = JSON.parse(savedUser);
                console.log("✅ 發現已保存的登入狀態，自動登入:", userData.name);
                loginId.value = userData.dbId;
                currentMember.value = {
                  id: userData.id,
                  dbId: userData.dbId,
                  name: userData.name,
                  phone: userData.phone,
                  email: userData.email || "",
                  memberLevel: userData.memberLevel || "一般會員",
                  profile_completed: userData.profile_completed || 0,
                  days_remaining: userData.days_remaining || null,
                  must_change_password: !!userData.must_change_password
                };
                // 🔒 臨時密碼未改：繼續強制更改
                if (userData.must_change_password) forceChangePw.value = true;
                customerName.value = userData.name;
                customerPhone.value = userData.phone;
                customerEmail.value = userData.email || "";
                step.value = 1;
                // 立即切換到會員介面，唔會再顯示登入畫面
                view.value = userData.profile_completed === 0 ? "mySettings" : "booking";
                restored = true;
              } catch (error) {
                console.error("❌ 恢復登入狀態失敗:", error);
                localStorage.removeItem('userToken');
              }
            }

            // 🆕 首先載入伺服器時間
            await loadServerTime();

            // 🔒 載入驗證碼圖片（登入/註冊用）
            loadCaptcha();

            // 已登入用戶：後台靜默載入資料（唔阻塞介面、唔彈 alert）
            if (restored && currentMember.value) {
              loadBookings();
              loadUserProfile();
              loadMyMembership();

              // 未完成資料的用戶：背景檢查帳戶有冇被取消，得番必要時先提醒
              if (currentMember.value.profile_completed === 0) {
                fetch('/api/users/' + currentMember.value.dbId + '/profile')
                  .then(function (r) {
                    if (!r.ok) {
                      localStorage.removeItem('userToken');
                      localStorage.removeItem('jwtToken');
                      currentMember.value = null;
                      alert("您的賬戶因未在 3 天內完成個人資料而被自動取消，請重新註冊。");
                    }
                  })
                  .catch(function () {});
              }
            }

            // 設置預設值
            selectedDate.value = new Date().toISOString().slice(0, 10);
            // 載入服務列表
            loadServices();
            // 載入時段狀態
            loadTimeSlots();
            // 載入診所設定（包含醫師資料）- 必須先完成
            await loadClinicSettings();
            // 載入所有預約記錄（需要醫師資料已載入）
            await loadAllBookings();
            // 載入常見問題
            loadFaqs();
            // 🆕 啟動即時預約狀況自動刷新
            startAutoRefresh();
            // 🆕 啟動午夜日期自動更新
            scheduleMidnightUpdate();
          });
          
          // 組件卸載時停止自動刷新
          onUnmounted(() => {
            stopAutoRefresh();
            if (midnightTimeout) clearTimeout(midnightTimeout);
          });

          // 監聽日期變化，重新載入時段
          watch(selectedDate, () => {
            loadTimeSlots();
          });

          // 客戶端查看病歷詳情
          async function viewMedicalRecord(bookingId) {
            try {
              // 載入病歴歷史，確保「今次 vs 上次 相片比較」有對比資料
              if (medicalHistory.value.length === 0 && currentMember.value) {
                await loadMedicalHistory();
              }
              const response = await fetch(`${API_URL}/medical-records/customer/booking/${bookingId}`, {
                headers: { 'x-user-id': (currentMember.value.dbId || currentMember.value.id) }
              });
              if (response.ok) {
                const data = await response.json();
                if (data.ok && data.data && data.data.length > 0) {
                  const record = data.data[0];
                  const progress = (record.progress && record.progress.length > 0)
                    ? record.progress[record.progress.length - 1]
                    : null;
                  selectedMedicalRecord.value = {
                    ...record,
                    doctor_name: record.doctor_name || '—',
                    progress: record.progress || [],
                    metric_name: progress?.metric_name,
                    current_value: progress?.current_value,
                    target_value: progress?.target_value,
                    progress_score: progress?.progress_score,
                    audio_url: record.audio_file_path
                      ? `${record.audio_file_path}`
                      : null,
                    photo_urls: (record.photos && record.photos.length > 0)
                      ? record.photos.map(p => `${p.photo_file_path}`)
                      : [],
                  };
                  showMedicalRecordDetailModal.value = true;
                } else {
                  alert("此預約沒有相關病歷記錄。");
                }
              } else {
                const errorData = await response.json();
                alert(`載入病歷失敗: ${errorData.error || '未知錯誤'}`);
              }
            } catch (error) {
              console.error("載入病歷時發生錯誤:", error);
              alert("載入病歷時發生錯誤，請稍後再試。");
            }
          }

          // 下載錄音檔案
          async function downloadMedicalAudio(recordId) {
            try {
              const response = await fetch(`${API_URL}/medical-records/customer/records/${recordId}/audio`, {
                headers: { 'x-user-id': (currentMember.value.dbId || currentMember.value.id) }
              });
              if (!response.ok) {
                alert('下載錄音失敗，請稍後再試');
                return;
              }
              const blob = await response.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `medical-audio-${recordId}.mp3`;
              a.click();
              URL.revokeObjectURL(url);
            } catch (error) {
              console.error('下載錄音時發生錯誤:', error);
              alert('下載錄音時發生錯誤，請稍後再試');
            }
          }

          // 下載病歷摘要文字檔
          function downloadMedicalSummary(record) {
            const r = record || selectedMedicalRecord.value;
            if (!r) return;
            const progressArr = r.progress && r.progress.length > 0 ? r.progress : [];
            const lines = [
              '=== 寶天醫館 病歷摘要 ===',
              `日期: ${r.appointment_date || r.record_date || r.progress_date || ''} ${r.appointment_time || ''}`,
              `醫師: ${r.doctor_name || '—'}`,
              '',
              '【診斷結果】',
              r.diagnosis || '—',
              '',
              '【治療方案】',
              r.treatment_plan || '—',
            ];
            if (r.notes) lines.push('', '【備註】', r.notes);
            if (progressArr.length > 0) {
              lines.push('', '【療程進度追蹤】');
              progressArr.forEach((p) => {
                lines.push(`- ${p.progress_date} ${p.metric_name || ''}: ${p.current_value !== undefined && p.current_value !== null ? p.current_value : '—'}${p.target_value ? ' / 目標 ' + p.target_value : ''}${p.progress_score ? ' / 評分 ' + p.progress_score + '/10' : ''}`);
              });
            }
            const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `medical-record-${r.id || Date.now()}.txt`;
            a.click();
            URL.revokeObjectURL(url);
          }

          // 判斷客戶是否可修改預約
          // 客戶不可更改已確認或已鎖定的預約（一按確認後即鎖定）
          const canEditBooking = (booking) => {
            return false; // 客戶不能更改booking，如需更改請聯絡診所
          };

          return {
            DOCTORS,
            SERVICES,
            bookableServices,
            TOTAL_BEDS,
            totalDoctors,
            closedDays,
            holidaysEnabled,
            holidays,
            workingHolidays,
            openMonths,
            customClosedDates,
            customOpenDates,
            businessHours,
            bookings,
            step,
            selectedService,
            selectedDoctor,
            selectedDate,
            selectedTime,
            customerName,
            customerNameEn,
            customerPhone,
            customerEmail,
            customerAge,
            customerNotes,
            result,
            currentMember,
            view,
            editingBooking,
            loginPassword,
            loginId,
            showLoginPassword,
            sendWhatsApp,
            // 🔒 驗證碼
            captchaUrl,
            loginCaptchaAnswer,
            registerCaptchaAnswer,
            loadCaptcha,
            // 按鈕載入狀態
            isBooking,
            isUpdating,
            isCancelling,
            cancellingBookingId,
            bookingError,
            showRegister,
            guestTrialFlow,
            startGuestTrial,
            showGuestBooking,
            guestBookingInfo,
            guestBookingError,
            submitGuestBooking,
            guestFlowActive,
            closeGuestBooking,
            isServiceLocked,
            showResetPassword,
            resetPasswordData,
            resetPasswordError,
            resetPasswordSuccess,
            showNewPasswordResetText,
            showConfirmPasswordResetText,
            changePasswordData,
            changePasswordError,
            changePasswordSuccess,
            showNewPasswordChangeText,
            showConfirmPasswordChangeText,
            showFindUserId,
            findUserIdData,
            findUserIdError,
            findUserIdResult,
            userProfile,
            profileSaveSuccess,
            birthYear,
            birthMonth,
            birthDay,
            // ==================== 官網內容 ====================
            siteAnnouncements,
            siteVideos,
            siteCases,
            siteSocial,
            siteReviews,
            siteTexts,
            t,
            forumPosts,
            activeForumPost,
            forumReplyContent,
            forumReplySending,
            forumNewPostOpen,
            forumNewPostTitle,
            forumNewPostCategory,
            forumNewPostContent,
            forumPostSending,
            forumLoading,
            printPage,
            loadForumPosts,
            openForumPost,
            closeForumPost,
            submitForumReply,
            submitForumPost,
            userAvatar,
            avatarEmoji,
            avatarUploading,
            setAvatarEmoji,
            saveAvatar,
            onAvatarFileChange,
            // AI 問診（語言狀態供醫療分流使用）
            aiConsultationEnabled,
            aiLang,
            aiLanguageSelected,
            // 醫療分流
            triageQuestions,
            triageCurrentIndex,
            triageAnswers,
            triageScores,
            triageResult,
            triageDoctorMap,
            triageInProgress,
            getTriageText,
            startTriage,
            selectTriageOption,
            calculateTriageResult,
            goToBookingWithTriage,
            resetTriage,
            // 意見箱
            feedbackForm,
            isSubmittingFeedback,
            myFeedbacks,
            unreadReplyCount,
            showReplyNotification,
            submitFeedback,
            loadMyFeedbacks,
            checkUnreadReplies,
            markReplyAsRead,
            goToFeedbackFromNotification,
            dismissReplyNotification,
            getFeedbackCategoryName,
            getFeedbackStatusName,
            formatFeedbackDate,
            // 預約成功
            showBookingSuccess,
            bookingResult,
            closeBookingSuccess,
            faqs,
            expandedFaq,
            toggleFaq,
            timeslots,
            myBookings,
            recentBookings,
            calendarMonth,
            calendarYear,
            todayDate,
            calendarDays,
            timeSlotsFromAPI,
            doctorTimeSlots,
            loadTimeSlots,
            loadClinicSettings,
            loadBookings,
            handleLogin,
            handleLogout,
            loginRole, // 🆕 暴露登入角色變數
            closeResetPasswordModal,
            sendResetCode,
            handleResetPassword,
            resetPasswordStep,
            resetVerifyMethod,
            sendingCode,
            resettingPassword,
            codeCountdown,
            resendCountdown,
            canResendCode,
            handleChangePassword,
            forceChangePw,
            forcePwData,
            forcePwError,
            forcePwBusy,
            submitForcePassword,
            handleFindUserId,
            loadUserProfile,
            saveProfile,
            whatsappPrefs,
            whatsappPrefsSaving,
            whatsappPrefsSaved,
            saveWhatsappPrefs,
            // 🆕 會員ID和中文姓名修改
            editingUsername,
            editingName,
            newUsername,
            newName,
            usernameError,
            nameError,
            canChangeUsername,
            canChangeName,
            usernameNextChangeDate,
            nameNextChangeDate,
            startEditUsername,
            cancelEditUsername,
            saveUsername,
            startEditName,
            cancelEditName,
            saveName,
            setView,
            selectService,
            setSelectedTime,
            selectedBed,
            selectedBedType,
            selectBedType,
            bedOptions,
            bedLoading,
            pickBed,
            validateAndProceed,
            reserve,
            cancelBooking,
            startEditBooking,
            cancelEdit,
            updateBooking,
            resetBooking,
            addMinutes,
            formatShort,
            formatDate,
            getService,
            getDoctor,
            getDoctorTodayBookings,
            getDoctorWeekBookings,
            getDoctorAvailableSlots,
            getTotalSlots,
            canCancelBooking,
            sendWhatsAppNotification,
            prevMonth,
            nextMonth,
            selectCalendarDate,
            // 即時預約狀況自動刷新
            autoRefreshCountdown,
            isRefreshingStatus,
            refreshBookingStatus,
            // 🌤️ 天氣提醒
            showWeatherAlert,
            weatherData,
            dontShowWeatherToday,
            checkAndShowWeatherAlert,
            closeWeatherAlert,
            formatWeatherTime,
            // 病歷詳情
            showMedicalRecordDetailModal,
            selectedMedicalRecord,
            bookingMedical,
            fetchMedicalForBooking,
            percentToSquares,
            viewMedicalRecord,
            downloadMedicalAudio,
            downloadMedicalSummary,
            canEditBooking,
            // 病歷相片比較與檢視
            canCompareMedicalPhotos,
            medicalPhotoCompareList,
            medicalPhotoPairIndex,
            cycleMedicalPhotoPair,
            photoLightboxVisible,
            photoLightboxUrl,
            photoLightboxList,
            photoLightboxIndex,
            viewPhotoLightbox,
            photoLightboxPrev,
            photoLightboxNext,
            // 我的病歴
            medicalHistory,
            medicalHistoryLoading,
            loadMedicalHistory,
            aiScores,
            aiAnalyzingId,
            aiAnalyzeMedicalRecord,
            progressSquareClass,
            progressBarClass,
            formatProgressValue,
            // 會員中心 / 家庭帳戶
            membership,
            realTier,
            tierLabel,
            familyHint,
            upgradeTier,
            upgrading,
            cancellingSub,
            familyList,
            selectedChildBookings,
            loadMyMembership,
            startCheckout,
            cancelSubscription,
            activateFamily,
            loadChildBookings,
            // 🆕 通用帳戶連結
            accountLinks,
            linkLoading,
            linkBusy,
            linkError,
            linkForm,
            linkRelationOptions,
            currentMemberId,
            currentMemberName,
            myFamilyChildren,
            myLinkSources,
            loadAccountLinks,
            createAccountLink,
            removeAccountLink,
          };
        },
      }).mount("#app");