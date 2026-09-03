# -*- coding: utf-8 -*-
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

ACCENT = RGBColor(0x0F, 0x76, 0x6E)   # teal
ACCENT2 = RGBColor(0x10, 0x4B, 0x4A)
DARK = RGBColor(0x1A, 0x2B, 0x2A)
LIGHT = RGBColor(0xF2, 0xF7, 0xF6)
GREY = RGBColor(0x55, 0x5F, 0x5E)
WARN = RGBColor(0xC0, 0x39, 0x2B)
OK = RGBColor(0x1E, 0x8A, 0x4E)
FONT = "Microsoft JhengHei"
MONO = "Consolas"

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
BLANK = prs.slide_layouts[6]

def _set_font(run, name=FONT, size=18, bold=False, color=DARK):
    run.font.name = name
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    # ensure east-asian font binding
    rPr = run._r.get_or_add_rPr()
    ea = rPr.find('{http://schemas.openxmlformats.org/drawingml/2006/main}ea')
    if ea is None:
        ea = rPr.makeelement('{http://schemas.openxmlformats.org/drawingml/2006/main}ea', {})
        rPr.append(ea)
    ea.set('typeface', name)

def add_bg(slide, color=LIGHT):
    f = slide.background.fill
    f.solid()
    f.fore_color.rgb = color

def band(slide, color=ACCENT, h=Inches(1.15)):
    from pptx.enum.shapes import MSO_SHAPE
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, h)
    shp.fill.solid(); shp.fill.fore_color.rgb = color
    shp.line.fill.background()
    shp.shadow.inherit = False
    return shp

def textbox(slide, l, t, w, h, anchor=MSO_ANCHOR.TOP):
    tb = slide.shapes.add_textbox(l, t, w, h)
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    return tb, tf

def cover(title, subtitle):
    s = prs.slides.add_slide(BLANK)
    add_bg(s, DARK)
    from pptx.enum.shapes import MSO_SHAPE
    bar = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, Inches(3.05), prs.slide_width, Inches(0.09))
    bar.fill.solid(); bar.fill.fore_color.rgb = ACCENT; bar.line.fill.background(); bar.shadow.inherit=False
    tb, tf = textbox(s, Inches(0.8), Inches(2.0), Inches(11.7), Inches(1.2), MSO_ANCHOR.MIDDLE)
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); r.text = title; _set_font(r, FONT, 40, True, RGBColor(0xFF,0xFF,0xFF))
    tb2, tf2 = textbox(s, Inches(0.8), Inches(3.3), Inches(11.7), Inches(1.6), MSO_ANCHOR.TOP)
    p2 = tf2.paragraphs[0]; p2.alignment = PP_ALIGN.CENTER
    r2 = p2.add_run(); r2.text = subtitle; _set_font(r2, FONT, 20, False, RGBColor(0xBF,0xE3,0xDF))
    foot, foot_tf = textbox(s, Inches(0.8), Inches(6.6), Inches(11.7), Inches(0.5))
    pf = foot_tf.paragraphs[0]; pf.alignment = PP_ALIGN.CENTER
    rf = pf.add_run(); rf.text = "寶天醫館預約系統 · 部署上線完整指南"; _set_font(rf, FONT, 14, False, RGBColor(0x8F,0xB8,0xB4))
    return s

def slide(title, bullets, subtitle=None, section=False):
    s = prs.slides.add_slide(BLANK)
    add_bg(s, LIGHT)
    band(s, ACCENT if not section else ACCENT2)
    tb, tf = textbox(s, Inches(0.6), Inches(0.18), Inches(12.1), Inches(0.85), MSO_ANCHOR.MIDDLE)
    p = tf.paragraphs[0]
    r = p.add_run(); r.text = title; _set_font(r, FONT, 26 if not section else 30, True, RGBColor(0xFF,0xFF,0xFF))
    top = Inches(1.45)
    if subtitle:
        stb, stf = textbox(s, Inches(0.7), Inches(1.3), Inches(12.0), Inches(0.5))
        sp = stf.paragraphs[0]
        sr = sp.add_run(); sr.text = subtitle; _set_font(sr, FONT, 16, False, GREY)
        top = Inches(1.9)
    bb, bf = textbox(s, Inches(0.7), top, Inches(11.9), Inches(7.5)-top-Inches(0.3))
    first = True
    for item in bullets:
        code = False; txt = item
        if isinstance(item, tuple):
            code = (item[0] == 'code'); txt = item[1]
        p = bf.paragraphs[0] if first else bf.add_paragraph()
        first = False
        p.space_after = Pt(9)
        bullet = "▸ " if not code else ""
        r = p.add_run(); r.text = bullet + txt
        if code:
            _set_font(r, MONO, 15, False, ACCENT2)
        else:
            _set_font(r, FONT, 17, False, DARK)
    return s

# ---------------- SLIDES ----------------
cover("寶天醫館預約系統", "部署上線完整指南 · 逐 Part 教學\n自訂網域 · 資料安全 · WhatsApp 通知 · 支付系統")

slide("目錄 — 呢份 Guide 講咩", [
    "上線流程總覽（一句講晒）",
    "要唔要上 GitHub？（結論 + 點做）",
    "採購清單（網域 / VPS / Twilio / Stripe）",
    "10 步部署實戰（逐拍逐 part）",
    "資料安全 & 香港 PDPO 合規",
    "上線前檢查表 + 常見排錯",
], section=True)

slide("上線流程總覽（一句講晒）", [
    "買網域 + 開 VPS（Docker 主機）",
    "拎源碼到 VPS（GitHub clone 或直接上傳）",
    "填 .env（密碼 / 密鑰 / 網域）",
    "docker compose up → Caddy 自動簽 HTTPS 證書",
    "接 Twilio（WhatsApp 通知）、Stripe（付款，可選）",
    "設 DB 自動備份 + 監控 → 正式啟用",
    "預計用時：半日至一日（視 Twilio / Stripe 公司驗證速度）",
])

slide("要唔要上 GitHub？（結論：要，用 Private Repo）", [
    "✅ 源碼版本控制：改錯可返轉頭、隨時 rollback",
    "✅ VPS 直接 `git clone` 拎最新碼，部署最方便",
    "✅ 可加 CI 自動測試 / 自動 build Docker image",
    "✅ 團隊協作、開 issue / 記錄改動",
    "⚠️ 診所病人資料（DB）同 .env 絕對唔落 Git（已 gitignore）",
    "建議：GitHub Private Repository — 得你同開發者睇到",
    "唔使 GitHub 都用到（上傳 zip），但 GitHub 方便好多",
])

slide("採購清單（要買 / 要開嘅嘢）", [
    "網域 Domain — SITE_DOMAIN（Cloudflare / HKIRC，約 HK$80–250/年）",
    "VPS 主機 — Ubuntu 22.04 + Docker（Hetzner / DigitalOcean，約 HK$40–80/月）",
    "Cloudflare 帳戶 — 免費 DNS + TLS 友好（DNS-01 挑戰唔使開 80）",
    "Gmail / Google Workspace — EMAIL_USER / EMAIL_PASS（預約通知 email）",
    "Twilio — WhatsApp + SMS（要公司驗證，按用量計費）",
    "Stripe — 付款，可選（無月費，按交易 % 抽）",
    "詳細金額同採購順序見之前畀嘅《採購清單》",
], section=True)

slide("第 1 步：網域 + DNS（Cloudflare）", [
    "買網域，例如 booking.yourclinic.hk",
    "Nameserver 指去 Cloudflare（免費）",
    "加 A 記錄 → 指向 VPS 嘅 IP",
    "Caddy 會自動向外簽 Let's Encrypt 證書（免費 + 自動續期）",
    "想唔開 80 port？用 Cloudflare DNS-01 挑戰：設 CLOUDFLARE_API_TOKEN",
    ("code", "SITE_DOMAIN=booking.yourclinic.hk"),
])

slide("第 2 步：VPS 主機 + Docker", [
    "開 VPS：Ubuntu 22.04，2GB RAM 起（診所低併發夠用）",
    "裝 Docker + Docker Compose（官方一鍵腳本）",
    "開 firewall（ufw）：allow 22 / 80 / 443，其他 deny",
    "設時區 Asia/Hong_Kong（預約時間要準）",
    ("code", "curl -fsSL https://get.docker.com | sh"),
    ("code", "sudo ufw allow 22,80,443/tcp"),
])

slide("第 3 步：拎源碼到 VPS", [
    "方法 A（GitHub）：`git clone <repo>` 再 `cd booking-aurora`",
    "方法 B（冇 Git）：scp / 上傳 zip 解壓",
    "複製環境範本：`cp .env.example .env` 然後填寫",
    "記住：.env 同 database.db 永遠唔 commit（已 gitignore）",
    "Docker 部署已實際跑通驗證（login + 授權端點全 200）",
])

slide("第 4 步：填寫 .env（最重要！）", [
    "SESSION_SECRET：生成長亂碼（指令下面），生產必須設",
    "ADMIN_PASSWORD：首次建庫時 admin 嘅密碼",
    "SITE_DOMAIN=booking.yourclinic.hk",
    "EMAIL_USER / EMAIL_PASS、TWILIO_*、STRIPE_*（冇就留空）",
    "ALLOWED_ORIGINS=https://booking.yourclinic.hk",
    "⚠️ 絕對唔好留 CAPTCHA_TEST_BYPASS=test999（呢行係後門！）",
    ("code", "node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\""),
])

slide("第 5 步：Docker 部署", [
    "一鍵起動（build + 後台跑）：",
    ("code", "docker compose up -d --build"),
    "Caddy 反向代理 app:4000，自動 HTTPS",
    "睇 log 確認無錯：",
    ("code", "docker compose logs app"),
    "⚠️ 首度部署前先 `rm -rf data`（app 會建全新 DB 同 admin）",
])

slide("第 6 步：HTTPS / TLS 證書", [
    "Caddy 自動向外簽 Let's Encrypt（免費，自動續期）",
    "瀏覽器落 https://booking.yourclinic.hk 見到鎖頭",
    "證書擺喺 caddy_data volume，唔使手動搞",
    "如果攞唔到證書：檢查 80 port 開、DNS 已生效、SITE_DOMAIN 啱",
], section=True)

slide("資料安全 — 已做定要做", [
    "✅ bcrypt 密碼加密、cookie httpOnly+Secure、JWT 簽名",
    "✅ CORS 白名單、login rate-limit 防暴破、SESSION_SECRET 漏設會拒絕啟動",
    "✅ .env / DB 唔落 Git、trust proxy 已開（Caddy 後 IP 正確）",
    "⚠️ 要做：DB 自動備份（每日 cp + 離站存放）",
    "⚠️ 要做：清走 email.js 硬編碼 fallback a8006300@gmail.com",
    "⚠️ 要做：路由唔好將內部錯誤訊息（SQL）漏畀客戶",
    "⚠️ 私隱：log 唔好記病人電話 / 姓名",
], section=True)

slide("香港 PDPO 合規提醒", [
    "病人資料（姓名 / 電話 / 病歷）受《個人資料（私隱）條例》規管",
    "收集要有明確目的、得當事人同意",
    "保存要安全（加密備份、受控存取）、保留期要合理",
    "建議：私隱政策頁、資料保留期設定、員工角色權限分隔",
    "DB 備份都要加密 / 限制邊個睇到",
])

slide("第 7 步：WhatsApp 通知（Twilio）", [
    "開 Twilio 帳號（公司 email + 身份驗證）",
    "買 Twilio 電話號（+852），開 WhatsApp Sender（Meta 商戶驗證）",
    "填 TWILIO_ACCOUNT_SID / AUTH_TOKEN / PHONE_NUMBER / MESSAGING_SERVICE_SID / WHATSAPP_NUMBER",
    "WHATSAPP_PROVIDER=twilio",
    "後台「發送測試 WhatsApp」確認收到 → 預約 / 改期 / 提醒都會推",
])

slide("第 8 步：支付系統（Stripe，可選）", [
    "開 Stripe 帳號（公司實體 + 香港銀行戶口）",
    "拎 Secret Key，設 Product / Price（月 / 季 / 年）→ 填 STRIPE_PRICE_*",
    "部署後設 Webhook：https://網域/api/stripe/webhook，拎 Webhook Secret",
    "唔設 Stripe → 付款功能自動停用，其餘功能正常",
    "無月費，按交易 % 抽；啟用前記得測試模式先試",
])

slide("上線前檢查表（Go-Live Checklist）", [
    "☐ 網域指向 VPS，HTTPS 鎖頭出現",
    "☐ .env 無 CAPTCHA_TEST_BYPASS、SESSION_SECRET 已設",
    "☐ admin 首次登入改密碼（must_change_password）",
    "☐ Twilio 測試 WhatsApp 收到",
    "☐ （如需付款）Stripe webhook 收得到",
    "☐ DB 自動備份設定好 + 試過還原",
    "☐ 員工帳號建立、角色權限核對（B/A 分隔）",
])

slide("常見問題 / 排錯", [
    "登入 500？檢查 trust proxy（已修）、.env 有冇壞字元 / 漏 SESSION_SECRET",
    "DB 開唔到？Docker 要用 ./data 目錄 volume，唔好 bind 單一 database.db 檔",
    "Caddy 攞唔到證書？檢查 80 port 開、DNS 已生效",
    "WhatsApp 收唔到？查 Twilio 餘額 / WhatsApp 商戶狀態 / 號碼格式 +852...",
    "Email 收唔到？查 Gmail App Password、2FA 有冇開",
])

cover("總結", "SQLite 先上 · Docker+Caddy 一鍵部署已驗證 OK\n建議上 GitHub Private Repo 方便維護\n重點：資料安全（備份 + PDPO）+ 清走後門/硬編碼\n下一步：買網域 → 開 VPS → 跟呢份 Guide 逐步做")

prs.save("AuroraClinic_Deploy_Guide.pptx")
print("saved AuroraClinic_Deploy_Guide.pptx with", len(prs.slides._sldIdLst), "slides")
