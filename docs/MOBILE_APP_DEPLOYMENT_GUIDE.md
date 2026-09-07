# 寶天醫館 — 手機 App 部署完整指南

> 版本：v1.0 | 更新日期：2026-09-04
> 適用對象：完全零經驗新手，手拖手教學

---

## 目錄

1. [手機 App 方案總覽](#1-手機-app-方案總覽)
2. [方案 A：PWA 手機網頁版（推薦先做）](#2-方案-apwa-手機網頁版推薦先做)
3. [方案 B：React Native 原生 App](#3-方案-breact-native-原生-app)
4. [方案 C：混合方案（PWA + 原生 App）](#4-方案-c混合方案pwa--原生-app)
5. [AWS App 部署資源](#5-aws-app-部署資源)
6. [App 上架流程](#6-app-上架流程)
7. [成本預算](#7-成本預算)
8. [常見問題](#8-常見問題)

---

## 1. 手機 App 方案總覽

### 三種方案比較

| 項目 | PWA（推薦先做） | React Native | 混合方案 |
|------|----------------|--------------|---------|
| **開發時間** | 1-2 天 | 2-4 週 | 4-6 週 |
| **開發成本** | 免費 | 免費（用 Expo） | 免費（用 Expo） |
| **上架費用** | 免費 | iOS $99/年 + Android $25 | iOS $99/年 + Android $25 |
| **推送通知** | 有限制 | 完整支援 | 完整支援 |
| **離線使用** | 有限制 | 完整支援 | 完整支援 |
| **App Store 上架** | 唔需要 | 需要 | 需要 |
| **自動更新** | 即時 | 需要提交審核 | 需要提交審核 |
| **推薦** | **初期用呢個** | **之後再做** | **最終方案** |

### 我嘅建議

```
第 1 階段（即刻做）：PWA 手機網頁版
  → 1-2 天完成
  → 用戶手機瀏覽器訪問即可使用
  → 唔需要 App Store 審核

第 2 階段（之後做）：React Native 原生 App
  → 2-4 週開發
  → App Store + Google Play 上架
  → 支援推送通知

第 3 階段（最終方案）：混合方案
  → PWA + 原生 App 同時運行
  → 最佳用戶體驗
```

---

## 2. 方案 A：PWA 手機網頁版（推薦先做）

### 什麼是 PWA？

**Progressive Web App**（漸進式網頁應用）係一種用手機瀏覽器訪問嘅網站，但可以好似 App 咁使用：

- 手機瀏覽器打開 → 「添加到主屏幕」→ 變成 App 圖標
- 全屏顯示（冇瀏覽器地址列）
- 支援離線緩存（部分功能）
- 支援推播通知（Android 支援，iOS 有限制）
- **唔需要 App Store 審核，即時上線**

### PWA 需要嘅文件

| 文件 | 用途 | 大小 |
|------|------|------|
| `manifest.json` | App 配置（名稱、圖標、顏色、啟動 URL） | ~1KB |
| `sw.js` | Service Worker（離線緩存策略） | ~2KB |
| `icon-192.png` | App 圖標 192x192 | ~10KB |
| `icon-512.png` | App 圖標 512x512 | ~50KB |

### 步驟 2.1：建立 manifest.json

在你嘅項目根目錄建立 `manifest.json`：

```json
{
  "name": "寶天醫館智能預約",
  "short_name": "寶天醫館",
  "description": "寶天醫館智能預約系統 - 隨時隨地預約中醫服務",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#6366f1",
  "orientation": "portrait",
  "icons": [
    {
      "src": "/picture/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/picture/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ],
  "categories": ["medical", "health"],
  "lang": "zh-HK",
  "dir": "ltr"
}
```

### 步驟 2.2：建立 Service Worker (sw.js)

在你嘅項目根目錄建立 `sw.js`：

```javascript
const CACHE_NAME = 'potin-clinic-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/css/tailwind.css',
  '/css/style.css',
  '/js/app.js',
  '/js/auth-fetch.js',
  '/js/vendor/vue.global.prod.js',
  '/picture/logo.jpg',
  '/picture/favicon.svg'
];

// 安裝 - 緩存靜態資源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

// 啟用 - 清理舊緩存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(cacheName => {
          return cacheName !== CACHE_NAME;
        }).map(cacheName => {
          return caches.delete(cacheName);
        })
      );
    })
  );
});

// 請求 - 網絡優先，緩存後備
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // 如果網絡正常，緩存並返回
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // 網絡失敗，使用緩存
        return caches.match(event.request);
      })
  );
});
```

### 步驟 2.3：在 index.html 加入引用

在你嘅 `index.html` 嘅 `<head>` 中加入：

```html
<!-- PWA 配置 -->
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#6366f1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="寶天醫館">
<link rel="apple-touch-icon" href="/picture/icon-192.png">

<!-- Service Worker 註冊 -->
<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(registration => {
          console.log('SW registered:', registration);
        })
        .catch(error => {
          console.log('SW registration failed:', error);
        });
    });
  }
</script>
```

### 步驟 2.4：生成 App 圖標

你需要準備兩張圖標：
- `icon-192.png`：192x192 像素
- `icon-512.png`：512x512 像素

可以用以下工具生成：
- **Canva**（免費）：https://www.canva.com
- **Favicon.io**（免費）：https://favicon.io
- **AI 圖標生成器**：用你嘅 logo 生成不同尺寸

### 步驟 2.5：部署到 AWS

PWA 會跟隨你嘅網站自動部署，唔需要額外步驟：

```bash
# 在伺服器上更新代碼
cd ~/booking-aurora
git pull origin main

# 重啟服務
docker compose up -d --build
```

### 步驟 2.6：測試 PWA

在你嘅手機上：

1. 打開 Chrome/Safari
2. 訪問 `https://你嘅域名.com`
3. **Android Chrome**：點擊右上角 「⋮」→ 「新增至主畫面」
4. **iPhone Safari**：點擊底部分享按鈕 → 「加入主畫面」
5. 確認 App 圖標出現在主屏幕

### ⚠️ PWA 預警

> **iOS 限制：**
> - Safari 嘅 PWA 不支援推播通知
> - 離線緩存有限制
> - 建議 iOS 用戶用 App Store 版本
>
> **Android：**
> - 完整支援 PWA 功能
> - 支援推播通知
> - 建議 Android 用戶先用 PWA

---

## 3. 方案 B：React Native 原生 App

### 點解揀 React Native？

| 優勢 | 說明 |
|------|------|
| **一套代碼** | 同時出 iOS + Android |
| ** Expo** | 免費、易用、自動構建 |
| **熱更新** | 用 EAS Update 即時更新 App |
| **社群大** | 问题容易搵到答案 |
| **免費** | Expo 開發免費 |

### 步驟 3.1：安裝開發環境

在你嘅電腦（Windows/Mac）安裝：

```bash
# 1. 安裝 Node.js（你已經有）

# 2. 安裝 Expo CLI
npm install -g expo-cli

# 3. 安裝 EAS CLI（用嚟構建 App）
npm install -g eas-cli

# 4. 註冊 Expo 帳戶（免費）
# 去 https://expo.dev 註冊
```

### 步驟 3.2：建立 React Native 項目

```bash
# 1. 建立新項目
npx create-expo-app potin-clinic-app --template blank

# 2. 進入項目
cd potin-clinic-app

# 3. 啟動開發服務器
npx expo start
```

### 步驟 3.3：連接你嘅 API

在 `App.js` 中，連接你嘅 Node.js API：

```javascript
import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';

const API_BASE = 'https://你嘅域名.com';

export default function App() {
  const [services, setServices] = useState([]);

  useEffect(() => {
    // 獲取服務列表
    fetch(`${API_BASE}/api/settings/services`)
      .then(res => res.json())
      .then(data => setServices(data))
      .catch(err => console.error(err));
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>寶天醫館</Text>
      <FlatList
        data={services}
        keyExtractor={item => item.id.toString()}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <Text style={styles.itemTitle}>{item.name}</Text>
            <Text style={styles.itemDesc}>{item.description}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  item: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  itemTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  itemDesc: {
    fontSize: 14,
    color: '#666',
  },
});
```

### 步驟 3.4：設定 App 圖標同啟動畫面

在 `app.json` 中設定：

```json
{
  "expo": {
    "name": "寶天醫館",
    "slug": "potin-clinic",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "light",
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#6366f1"
    },
    "assetBundlePatterns": [
      "**/*"
    ],
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.potin.clinic",
      "buildNumber": "1"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#6366f1"
      },
      "package": "com.potin.clinic",
      "versionCode": 1
    },
    "web": {
      "favicon": "./assets/favicon.png"
    },
    "plugins": [
      [
        "expo-notifications",
        {
          "icon": "./assets/notification-icon.png",
          "color": "#6366f1"
        }
      ]
    ]
  }
}
```

### 步驟 3.5：設定推送通知

```javascript
import * as Notifications from 'expo-notifications';

// 請求通知權限
async function registerForPushNotifications() {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') {
    alert('需要通知權限才能接收預約提醒');
    return;
  }

  // 獲取 token
  const token = await Notifications.getExpoPushTokenAsync();
  console.log('Push token:', token.data);

  // 發送到你嘅 API 儲存
  await fetch(`${API_BASE}/api/users/push-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pushToken: token.data })
  });
}

// 處理通知
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});
```

### 步驟 3.6：構建 App

```bash
# 1. 登入 Expo
eas login

# 2. 建立構建配置
eas build:configure

# 3. 構建 Android App（APK）
eas build --platform android --profile preview

# 4. 構建 iOS App（需要 Mac）
eas build --platform ios --profile preview
```

### 步驟 3.7：測試 App

```bash
# 在手機上安裝 Expo Go App（免費）
# Android：Google Play 搜尋 "Expo Go"
# iOS：App Store 搜尋 "Expo Go"

# 掃描 QR Code 即時測試
npx expo start
```

---

## 4. 方案 C：混合方案（PWA + 原生 App）

### 最終架構

```
用戶手機
├── PWA（手機瀏覽器）
│   └── 直接訪問 https://你嘅域名.com
│
├── iOS App（App Store）
│   └── 推送通知 + 離線使用
│
└── Android App（Google Play）
    └── 推送通知 + 離線使用

所有平台 → 同一個 Node.js API → 同一個 SQLite 數據庫
```

### 優勢

- **PWA**：即時上線，唔使審核，覆蓋所有手機
- **原生 App**：推送通知、離線使用、更好的性能
- **統一後端**：一套 API 服務所有平台

---

## 5. AWS App 部署資源

### AWS 服務用於 App

| 服務 | 用途 | 免費額度 | 月費 |
|------|------|---------|------|
| **S3** | App 圖標/資源存儲 | 5GB 免費 | $0 |
| **CloudFront** | App 資源 CDN | 1TB/月免費 | $0 |
| **SNS** | 推送通知 | 100 萬次免費 | $0 |
| **Cognito** | 用戶認證（可選） | 5 萬月活免費 | $0 |

### 推薦架構

```
原生 App (iOS/Android)
  → Expo Push Notifications (免費)
  → EC2 (Node.js API)
    → SQLite

PWA 手機網頁
  → EC2 (Node.js API)
    → SQLite
```

---

## 6. App 上架流程

### Apple App Store 上架

| 步驟 | 說明 | 時間 | 費用 |
|------|------|------|------|
| 1. Apple 開發者帳號 | 去 https://developer.apple.com 註冊 | 立即 | $99/年 |
| 2. App Store Connect | 建立 App 記錄、截圖、描述 | 1 天 | 免費 |
| 3. 上傳 App | 用 EAS Build | 1 天 | 免費 |
| 4. 提交審核 | Apple 審核 | 1-3 天 | 免費 |
| 5. 上架 | 用戶可下載 | 立即 | 免費 |

#### App Store 截圖要求

| 裝置 | 尺寸 | 數量 |
|------|------|------|
| iPhone 6.7" | 1290 x 2796 | 至少 1 張 |
| iPhone 6.5" | 1242 x 2688 | 至少 1 張 |
| iPhone 5.5" | 1242 x 2208 | 至少 1 張 |
| iPad 12.9" | 2048 x 2732 | 至少 1 張（如果支援） |

#### App Store 描述範例

```
寶天醫館智能預約系統

輕鬆預約中醫服務，隨時隨地管理您的健康。

功能特色：
• 智能預約：選擇醫師、時間，一鍵預約
• 會員管理：查看積分、等級、優惠
• 醫療記錄：安全儲存您的醫療資料
• 預約提醒：推送通知提醒您預約時間
• 家庭帳戶：管理家人的預約

寶天醫館 - 您的健康夥伴
```

### Google Play Store 上架

| 步驟 | 說明 | 時間 | 費用 |
|------|------|------|------|
| 1. Google 開發者帳號 | 去 https://play.google.com/console 註冊 | 立即 | $25 一次性 |
| 2. Google Play Console | 建立 App、截圖、描述 | 1 天 | 免費 |
| 3. 上傳 App | 用 EAS Build | 1 天 | 免費 |
| 4. 提交審核 | Google 審核 | 1-3 天 | 免費 |
| 5. 上架 | 用戶可下載 | 立即 | 免費 |

#### Google Play 截圖要求

| 裝置 | 尺寸 | 數量 |
|------|------|------|
| Phone | 1080 x 1920 | 至少 2 張 |
| 7" Tablet | 1080 x 1920 | 至少 1 張（如果支援） |
| 10" Tablet | 1800 x 2560 | 至少 1 張（如果支援） |

---

## 7. 成本預算

### PWA 成本

| 項目 | 費用 |
|------|------|
| 開發 | 免費 |
| 部署 | 免費（跟隨網站） |
| 維護 | 免費 |
| **合計** | **$0** |

### 原生 App 成本

| 項目 | 費用 |
|------|------|
| 開發 | 免費（用 Expo） |
| Apple 開發者帳號 | $99/年（約 HK$775） |
| Google 開發者帳號 | $25 一次性（約 HK$195） |
| EAS Build（每月 30 次免費） | $0 |
| 推送通知 | 免費（Expo 免費額度） |
| **合計（第一年）** | **~HK$970** |
| **合計（之後每年）** | **~HK$775** |

### 免費 vs 付費方案

| 項目 | 免費方案 | 付費方案 |
|------|---------|---------|
| Expo 開發 | 免費 | $0 |
| EAS Build | 30 次/月免費 | $19/月（無限） |
| EAS Update | 1000 次/月免費 | $19/月（無限） |
| 推送通知 | 100 萬次/月免費 | $0 |
| **建議** | **初期用呢個** | 用戶量增加後升級 |

---

## 8. 常見問題

### Q: PWA 同原生 App 有咩分別？

**A:**
| 功能 | PWA | 原生 App |
|------|-----|---------|
| 安裝 | 添加到主屏幕 | App Store 下載 |
| 推送通知 | Android 支援，iOS 有限制 | 完整支援 |
| 離線使用 | 有限制 | 完整支援 |
| 性能 | 較慢 | 較快 |
| 更新 | 即時 | 需要審核 |
| 審核 | 唔需要 | 需要 |

### Q: 我應該先做邊個？

**A:** 先做 PWA，因為：
1. 即時上線（1-2 天）
2. 唔使 App Store 審核
3. 唔使花錢
4. 可以即刻收集用戶反饋

### Q: 開發原生 App 要幾耐？

**A:** 用 React Native + Expo，約 2-4 週：
- 第 1 週：基本功能（預約、登入）
- 第 2 週：進階功能（推送通知、醫療記錄）
- 第 3 週：測試同修復
- 第 4 週：上架準備

### Q: App Store 審核要幾耐？

**A:**
- Apple：約 1-3 日（第一次可能要 1 週）
- Google：約 1-3 日

### Q: App 開發要幾錢？

**A:**
- 開發：免費（用 Expo）
- 上架：iOS $99/年 + Android $25 一次性
- 維護：免費（自己維護）

### Q: 點解唔用其他 App 開發平台？

**A:**
| 平台 | 優點 | 缺點 |
|------|------|------|
| React Native + Expo（推薦） | 免費、一套代碼、社群大 | 需要學 JavaScript |
| Flutter | 性能好、一套代碼 | 需要學 Dart |
| 原生 iOS/Android | 性能最好 | 需要寫兩套代碼 |
| No-Code（Adalo, Bubble） | 唔使寫代碼 | 功能有限、要月費 |

### Q: 我唔識寫代碼，點算？

**A:** 有幾個選擇：
1. **用 PWA**：我幫你加 PWA 功能，你只需要複製貼上
2. **用 No-Code**：用 Adalo 或 Bubble 建立簡單 App
3. **請人開發**：用 Fiverr 或 Upwork 請人，約 HK$5,000-15,000

---

## 附錄：快速開始 PWA

如果你想即刻開始 PWA，只需要做以下步驟：

### 1. 建立 manifest.json

```bash
# 在你嘅項目根目錄
nano manifest.json
```

貼上下列內容（記得改名稱同圖標）：

```json
{
  "name": "寶天醫館智能預約",
  "short_name": "寶天醫館",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#6366f1",
  "icons": [
    {
      "src": "/picture/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/picture/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

### 2. 在 index.html 加入引用

在 `<head>` 中加入：

```html
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#6366f1">
```

### 3. 部署到 AWS

```bash
cd ~/booking-aurora
git add .
git commit -m "Add PWA support"
git push origin main

# 在伺服器上
ssh -i potin-key.pem ubuntu@你嘅IP
cd ~/booking-aurora
git pull origin main
docker compose up -d --build
```

### 4. 測試

在手機瀏覽器訪問你嘅網站，應該見到「添加到主屏幕」嘅選項。

---

> **最後提醒：** 建議先做 PWA（1-2 天），再考慮原生 App（2-4 週）。PWA 可以即時上線，讓你嘅用戶即刻用手機預約。
