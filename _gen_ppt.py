#!/usr/bin/env python
# -*- coding: utf-8 -*-
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

TEAL   = RGBColor(0x1B, 0x6E, 0x5A)
TEAL2  = RGBColor(0x2E, 0x8B, 0x6F)
DARK   = RGBColor(0x22, 0x2A, 0x28)
GREY   = RGBColor(0x55, 0x5F, 0x5C)
LIGHT  = RGBColor(0xF2, 0xF7, 0xF5)
WARN   = RGBColor(0xB0, 0x4A, 0x1F)
FONT   = "Microsoft JhengHei"

prs = Presentation()
prs.slide_width  = Inches(13.333)
prs.slide_height = Inches(7.5)
SW, SH = prs.slide_width, prs.slide_height
BLANK = prs.slide_layouts[6]

def slide():
    return prs.slides.add_slide(BLANK)

def box(s, l, t, w, h):
    tb = s.shapes.add_textbox(l, t, w, h)
    tf = tb.text_frame; tf.word_wrap = True
    return tb, tf

def set_run(r, text, size=18, bold=False, color=DARK, font=FONT, italic=False):
    r.text = text
    r.font.size = Pt(size); r.font.bold = bold; r.font.italic = italic
    r.font.color.rgb = color; r.font.name = font
    rPr = r._r.get_or_add_rPr()
    ea = rPr.find('{http://schemas.openxmlformats.org/drawingml/2006/main}ea')
    if ea is None:
        from lxml import etree
        ea = etree.SubElement(rPr, '{http://schemas.openxmlformats.org/drawingml/2006/main}ea')
    ea.set('typeface', font)

def title_bar(s, text, sub=None):
    bar = s.shapes.add_shape(1, 0, 0, SW, Inches(1.15))
    bar.fill.solid(); bar.fill.fore_color.rgb = TEAL; bar.line.fill.background(); bar.shadow.inherit = False
    tb, tf = box(s, Inches(0.5), Inches(0.12), SW-Inches(1.0), Inches(0.95))
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    set_run(tf.paragraphs[0].add_run(), text, size=30, bold=True, color=RGBColor(0xFF,0xFF,0xFF))
    if sub:
        set_run(tf.add_paragraph().add_run(), sub, size=14, color=RGBColor(0xCF,0xE8,0xDF))

def bullets(s, items, top=Inches(1.45), size=18, gap=6):
    tb, tf = box(s, Inches(0.6), top, SW-Inches(1.2), SH-top-Inches(0.4))
    first = True
    for it in items:
        if isinstance(it, tuple):
            text, lvl, *rest = it
            color = rest[0] if rest else DARK
            bold  = rest[1] if len(rest) > 1 else False
        else:
            text, lvl, color, bold = it, 0, DARK, False
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        p.level = lvl; p.space_after = Pt(gap); p.space_before = Pt(2)
        set_run(p.add_run(), ("▪ " if lvl == 0 else "– ") + text, size=size if lvl == 0 else size-2, bold=bold, color=color)
    return tb

def footnote(s, text):
    tb, tf = box(s, Inches(0.6), SH-Inches(0.42), SW-Inches(1.2), Inches(0.35))
    set_run(tf.paragraphs[0].add_run(), text, size=12, color=GREY, italic=True)

def card(s, l, t, w, h, title, lines, fill):
    c = s.shapes.add_shape(1, l, t, w, h); c.fill.solid(); c.fill.fore_color.rgb = fill
    c.line.fill.background(); c.shadow.inherit = False
    tb, tf = box(s, l+Inches(0.15), t+Inches(0.1), w-Inches(0.3), h-Inches(0.2))
    tf.vertical_anchor = MSO_ANCHOR.TOP
    set_run(tf.paragraphs[0].add_run(), title, size=17, bold=True, color=RGBColor(0xFF,0xFF,0xFF))
    for ln in lines:
        p = tf.add_paragraph(); p.space_before = Pt(4)
        set_run(p.add_run(), ln, size=13, color=RGBColor(0xEC,0xF5,0xF2))

# ===== Slide 1 封面 =====
s = slide()
bg = s.shapes.add_shape(1, 0, 0, SW, SH); bg.fill.solid(); bg.fill.fore_color.rgb = TEAL; bg.line.fill.background(); bg.shadow.inherit = False
tb, tf = box(s, Inches(0.8), Inches(2.0), SW-Inches(1.6), Inches(3.2)); tf.vertical_anchor = MSO_ANCHOR.MIDDLE
set_run(tf.paragraphs[0].add_run(), "寶天醫館預約系統", size=44, bold=True, color=RGBColor(0xFF,0xFF,0xFF))
set_run(tf.add_paragraph().add_run(), "上線部署流程總覽", size=26, color=RGBColor(0xCF,0xE8,0xDF))
set_run(tf.add_paragraph().add_run(), "VPS / AWS Lightsail + Docker + PostgreSQL + 自己網域 + 將來分店", size=17, color=RGBColor(0xA9,0xD6,0xC9))
set_run(tf.add_paragraph().add_run(), "（含 AWS vs VPS 比較 ＋ 系統架構圖）", size=14, color=RGBColor(0xA9,0xD6,0xC9))

# ===== Slide 2 流程一覽 =====
s = slide(); title_bar(s, "成個流程一覽（9 個階段）", "由零到上線，每階段做咩")
bullets(s, [
    ("Phase 0  準備：Git 倉庫、.gitignore、.env.example", 0, DARK, True),
    ("Phase 1  買網域 ＋ 揀主機（VPS / AWS Lightsail）", 0, DARK, True),
    ("Phase 2  伺服器基礎安全（SSH key / 防火牆 / 非 root）", 0, DARK, True),
    ("Phase 3  裝環境（Docker + Node + PostgreSQL）", 0, DARK, True),
    ("Phase 4  HTTPS 免費 SSL（Cloudflare + Caddy）", 0, DARK, True),
    ("Phase 5  由 GitHub 拉代碼跑起", 0, DARK, True),
    ("Phase 6  反向代理 ＋ 網域指向", 0, DARK, True),
    ("Phase 7  資料安全加固（備份 / WAF / 監控）", 0, DARK, True),
    ("Phase 8  CI/CD 自動化（push 自動測試）", 0, DARK, True),
    ("Phase 9  開分店：多租戶（clinic_id）", 0, DARK, True),
])

# ===== Slide 3 AWS vs VPS =====
s = slide(); title_bar(s, "主機點揀：AWS 定 VPS？", "結論：單店用 VPS / Lightsail 就最穩陣")
card(s, Inches(0.5), Inches(1.5), Inches(4.0), Inches(2.7), "普通 VPS", [
    "DigitalOcean / Hetzner / Linode",
    "最簡單最平 ~$5–12/月",
    "Docker 一包搞掂",
    "全控制病情、易搬",
    "★ 推薦（單店最實際）"], TEAL2)
card(s, Inches(4.7), Inches(1.5), Inches(4.0), Inches(2.7), "AWS Lightsail", [
    "AWS 出品嘅「簡易 VPS」",
    "用法同 VPS 一樣易",
    "但係 AWS 牌子",
    "價錢同 VPS 相近",
    "★ 鍾意 AWS 就揀呢個"], TEAL)
card(s, Inches(8.9), Inches(1.5), Inches(4.0), Inches(2.7), "完整 AWS", [
    "EC2 + RDS + CloudFront",
    "最強最大、企業級",
    "但設定多、計費複雜",
    "單店 overkill",
    "⚠️ 開幾間分店先值得"], GREY)
bullets(s, [
    ("點解而家唔使揀全 AWS：將來開分店，數據庫直接升做託管 PostgreSQL（Managed DB / RDS）就得，唔使由頭學 AWS。", 0, TEAL2, True),
    ("純粹鍾意 AWS 個名 → 用 Lightsail（本質就係 VPS），慳返好多麻煩。", 0, DARK, False),
], top=Inches(4.5))
footnote(s, "下面流程圖以「VPS / Lightsail + Docker」為例，AWS 做法類同。")

# ===== Slide 4 系統架構圖 =====
s = slide(); title_bar(s, "系統架構圖（資料點樣流）", "一眼睇晒邊件連邊件")
bullets(s, [
    ("使用者：客人 / 員工 / 醫師 / 管理", 0, DARK, True),
    ("      ↓   HTTPS（加密）", 1, GREY, False),
    ("Cloudflare：DNS ＋ 免費 SSL ＋ WAF ＋ DDoS 防護", 0, TEAL2, True),
    ("      ↓", 1, GREY, False),
    ("伺服器（VPS / Lightsail，跑 Docker）：", 0, DARK, True),
    ("   • Caddy ── 反向代理 ＋ 自動續 SSL", 1, GREY, False),
    ("   • Node.js App ── 你個預約系統（port 4000）", 1, GREY, False),
    ("   • PostgreSQL ── 中央數據庫（客人資料）", 1, GREY, False),
    ("      ↓", 1, GREY, False),
    ("每日自動備份 → 雲端儲存（離地，例如 B2 / S3）", 0, TEAL2, True),
    ("外部服務：Twilio（WhatsApp 通知）＋ Stripe（支付），經 .env key 接駁", 0, DARK, False),
])
footnote(s, "Caddy / App / PostgreSQL 三件包喺 Docker 入面，部署一次寫好處處跑。")

# ===== Slide 5 GitHub =====
s = slide(); title_bar(s, "點解一定要上 GitHub？", "結論：強烈建議，但有一條鐵律")
bullets(s, [
    ("好處：版本歷史、由 GitHub 拉去伺服器、CI 自動測試、多人協作", 0, DARK, False),
    ("⚠️ 鐵律：.env（密碼/私鑰）、database.db（客人資料）絕對唔 commit", 0, WARN, True),
    ("做法：.gitignore 擋咗佢哋；GitHub 只放「代碼」唔放「數據同密碼」", 0, WARN, False),
    ("建議 Private 倉庫（免費），code 唔公開", 0, GREY, False),
])

# ===== Slide 6 Phase 0 =====
s = slide(); title_bar(s, "Phase 0 ｜ 準備代碼倉庫", "先做呢步，之後所有部署靠佢")
bullets(s, [
    ("① git init；GitHub 建 Private 倉庫", 0, DARK, True),
    ("② 加 .gitignore：node_modules/  .env  database.db  *.log", 0, DARK, True),
    ("③ 準備 .env.example（只列 key 名，唔填真值）", 0, DARK, True),
    ("④ git add . → commit → push；去 GitHub 確認 .env 唔喺度", 0, DARK, True),
])

# ===== Slide 7 Phase 1 =====
s = slide(); title_bar(s, "Phase 1 ｜ 買網域 ＋ 揀主機", "自己網域 = 專業 + 易記 + 可搬")
bullets(s, [
    ("買網域（年費 ~USD 10–15）：Cloudflare Registrar / Porkbun / Namecheap", 0, DARK, True),
    ("揀主機（月費 ~$5–12）：VPS 或 AWS Lightsail，OS 揀 Ubuntu 22.04 LTS", 0, DARK, True),
    ("規格：1 vCPU / 1–2 GB RAM 單店够用；開分店再加", 0, GREY, False),
    ("記低：伺服器 IP 同 root 密碼", 0, WARN, False),
])

# ===== Slide 8 Phase 2 =====
s = slide(); title_bar(s, "Phase 2 ｜ 伺服器基礎安全", "資料安全第一步")
bullets(s, [
    ("① SSH key 登入，關咗密碼登入（防暴力破解）", 0, DARK, True),
    ("② 防火牆 ufw，只開 22 / 80 / 443", 0, DARK, True),
    ("③ 新建非 root 用戶（deploy）操作", 0, DARK, True),
    ("④ 開自動保安更新", 0, DARK, True),
    ("⚠️ 做妥已擋走九成自動化攻擊", 0, TEAL2, False),
])

# ===== Slide 9 Phase 3 =====
s = slide(); title_bar(s, "Phase 3 ｜ 裝運行環境", "Docker + Node + PostgreSQL")
bullets(s, [
    ("① 裝 Docker + Docker Compose（app + db 包埋）", 0, DARK, True),
    ("② 裝 PostgreSQL 16（中央庫，啱分店；docker-compose 同起）", 0, DARK, True),
    ("⚠️ 前置改動：現時 app 用 SQLite，上 PostgreSQL 要將 DB 層改為 pg（placeholder $1 等）", 0, WARN, True),
    ("單店想快啲上：可暫用 SQLite，遲啲開分店再轉 PG（到時都要改）", 0, GREY, False),
])

# ===== Slide 10 Phase 4 =====
s = slide(); title_bar(s, "Phase 4 ｜ HTTPS 免費 SSL", "資料安全核心：全程加密")
bullets(s, [
    ("① 網域 DNS 指去 Cloudflare（順便攞免費 WAF / DDoS）", 0, DARK, True),
    ("② Caddy 自動攞 Let's Encrypt 證書、自動續期", 0, DARK, True),
    ("③ 強制 HTTPS ＋ 開 HSTS", 0, DARK, True),
    ("⚠️ 無 HTTPS 瀏覽器標「不安全」，客人唔敢落資料", 0, WARN, False),
])

# ===== Slide 11 Phase 5 =====
s = slide(); title_bar(s, "Phase 5 ｜ 由 GitHub 拉代碼跑起", "部署核心動作")
bullets(s, [
    ("① 伺服器設 deploy key（只讀）git clone 倉庫", 0, DARK, True),
    ("② 伺服器建立真正 .env，填入真密鑰（唔同本機）", 0, DARK, True),
    ("③ docker compose up -d 起動（掛咗自動重起）", 0, DARK, True),
    ("④ 驗證 curl localhost:4000/api/beds/labels 有返回", 0, DARK, True),
    ("⑤ 做 DB migration（建表）＋ seed 示範數據", 0, GREY, False),
    ("⚠️ SESSION_SECRET / JWT_SECRET 要用長亂碼，唔好用預設", 0, WARN, False),
])

# ===== Slide 12 Phase 6 =====
s = slide(); title_bar(s, "Phase 6 ｜ 反向代理 ＋ 網域指向", "全世界經網域入到你個 app")
bullets(s, [
    ("① Cloudflare DNS 加 A 記錄：@ 同 www 指去伺服器 IP", 0, DARK, True),
    ("② Caddy 將 https://網域 轉去 localhost:4000", 0, DARK, True),
    ("③ 驗證四頁經 https 都開到（index / staff / doctor / admin）", 0, DARK, True),
    ("④ 手機＋電腦試，確認無 mixed-content 警告", 0, DARK, False),
    ("🎉 到呢步網站正式上線！", 0, TEAL2, True),
])

# ===== Slide 13 Phase 7 =====
s = slide(); title_bar(s, "Phase 7 ｜ 資料安全加固", "上線唔係終點")
bullets(s, [
    ("① 每日自動備份 database（加密）抄去雲端（B2 / S3）", 0, DARK, True),
    ("② Cloudflare WAF 擋惡意流量（已有 rate limit，加多層）", 0, DARK, True),
    ("③ admin 後台加 IP 限制 / 更強密碼", 0, DARK, True),
    ("④ 定期 npm audit 更新依賴；UptimeRobot 監測死機", 0, DARK, True),
    ("⚠️ 備份唔驗證 = 冇備份；定期試 restore", 0, WARN, False),
])

# ===== Slide 14 Phase 8 =====
s = slide(); title_bar(s, "Phase 8 ｜ CI/CD 自動化", "改 code 唔使驚")
bullets(s, [
    ("① GitHub Actions：push 自動跑 lint ＋ 嗰 10 輪交叉測試", 0, DARK, True),
    ("② 測試過先 deploy（唔會將壞 code 推上線）", 0, DARK, True),
    ("③ 進階：通過自動 deploy 上伺服器（零人手）", 0, DARK, False),
    ("⚠️ CI 用假密鑰 / 測試庫，唔好用真實客人庫", 0, WARN, False),
])

# ===== Slide 15 Phase 9 =====
s = slide(); title_bar(s, "Phase 9 ｜ 開分店：多租戶", "而家 plan 好，遲啲唔使重写")
bullets(s, [
    ("核心：加 clinic_id 落各表（bookings / users / settings / medical_records）", 0, DARK, True),
    ("每間分店一個 subdomain：shop2.網域（或後台切換）", 0, DARK, True),
    ("PostgreSQL 中央庫，按 clinic_id 隔離各分店資料", 0, DARK, True),
    ("因為 Phase 3 用 PostgreSQL，到時只加欄位唔使換數據庫", 0, TEAL2, False),
    ("⚠️ 呢步係重構，開第 2 間店之前做，唔使急", 0, WARN, False),
])

# ===== Slide 16 三個要求 =====
s = slide(); title_bar(s, "你三個要求，點樣滿足", "逐一對齊")
bullets(s, [
    ("🔒 資料安全：HTTPS 加密 ＋ Cloudflare WAF ＋ 每日離地備份 ＋ .env 唔落 Git ＋ 防火牆", 0, TEAL2, False),
    ("🌐 自己網域：Cloudflare 買/管 DNS，Caddy 自動 SSL，幾個鐘搞掂", 0, TEAL2, False),
    ("🏬 開分店：而家 plan 多租戶（clinic_id ＋ PostgreSQL），遲啲零煩惱", 0, TEAL2, False),
])

# ===== Slide 17 陷阱 =====
s = slide(); title_bar(s, "上線前 Checklist", "逐項打勾")
bullets(s, [
    ("☐ .env / database.db 冇落 GitHub", 0, DARK, False),
    ("☐ SESSION_SECRET / JWT_SECRET 係長亂碼", 0, DARK, False),
    ("☐ 生產 .env 無 CAPTCHA_TEST_BYPASS（防驗證碼後門）", 0, DARK, False),
    ("☐ 防火牆只開 22/80/443，密碼登入已關", 0, DARK, False),
    ("☐ 全站 HTTPS，無 mixed-content", 0, DARK, False),
    ("☐ 備份有做 ＋ 試過 restore", 0, DARK, False),
    ("☐ Twilio / Stripe 真 key 設好，測試通知＋支付成功", 0, DARK, False),
    ("☐ 四頁經 https 都開到；10 輪測試綠", 0, DARK, False),
])

# ===== Slide 18 總結 =====
s = slide()
bg = s.shapes.add_shape(1, 0, 0, SW, SH); bg.fill.solid(); bg.fill.fore_color.rgb = TEAL; bg.line.fill.background(); bg.shadow.inherit = False
tb, tf = box(s, Inches(0.8), Inches(2.0), SW-Inches(1.6), Inches(3.4)); tf.vertical_anchor = MSO_ANCHOR.MIDDLE
set_run(tf.paragraphs[0].add_run(), "總結", size=40, bold=True, color=RGBColor(0xFF,0xFF,0xFF))
for line in ["✅ 主機：VPS 或 AWS Lightsail（單店最穩陣，唔使全 AWS）",
             "✅ 棧：Docker + Node + PostgreSQL + Cloudflare",
             "✅ 九個 Phase 逐步做，第一次約一個下午",
             "✅ 分店多租戶而家 plan 定，將來零煩惱"]:
    p = tf.add_paragraph(); p.space_before = Pt(10)
    set_run(p.add_run(), line, size=20, color=RGBColor(0xCF,0xE8,0xDF))
p = tf.add_paragraph(); p.space_before = Pt(20)
set_run(p.add_run(), "下一步：我幫你備好實體部署檔（Docker / Caddy / CI）＋ SQLite→PG 改動", size=16, color=RGBColor(0xA9,0xD6,0xC9), italic=True)

prs.save("AuroraClinic_Deploy_Flow.pptx")
print("SAVED AuroraClinic_Deploy_Flow.pptx, slides =", len(prs.slides._sldIdLst))
