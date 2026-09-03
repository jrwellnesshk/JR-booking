# -*- coding: utf-8 -*-
"""幫 booking-aurora 搵代理公司：伺服器安裝 + 網頁功能測試 — 方案比較 PPT"""
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

ACCENT = RGBColor(0x0F, 0x76, 0x6E)
ACCENT2 = RGBColor(0x10, 0x4B, 0x4A)
DARK = RGBColor(0x1A, 0x2B, 0x2A)
LIGHT = RGBColor(0xF2, 0xF7, 0xF6)
GREY = RGBColor(0x55, 0x5F, 0x5E)
WARN = RGBColor(0xC0, 0x39, 0x2B)
OK = RGBColor(0x1E, 0x8A, 0x4E)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
GOLD = RGBColor(0xC9, 0xA2, 0x6B)
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
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, h)
    shp.fill.solid(); shp.fill.fore_color.rgb = color
    shp.line.fill.background(); shp.shadow.inherit = False
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
    bar = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, Inches(3.05), prs.slide_width, Inches(0.09))
    bar.fill.solid(); bar.fill.fore_color.rgb = ACCENT; bar.line.fill.background(); bar.shadow.inherit=False
    tb, tf = textbox(s, Inches(0.8), Inches(2.0), Inches(11.7), Inches(1.2), MSO_ANCHOR.MIDDLE)
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); r.text = title; _set_font(r, FONT, 38, True, WHITE)
    tb2, tf2 = textbox(s, Inches(0.8), Inches(3.35), Inches(11.7), Inches(1.4), MSO_ANCHOR.TOP)
    p2 = tf2.paragraphs[0]; p2.alignment = PP_ALIGN.CENTER
    r2 = p2.add_run(); r2.text = subtitle; _set_font(r2, FONT, 19, False, RGBColor(0xBF,0xE3,0xDF))
    foot, foot_tf = textbox(s, Inches(0.8), Inches(6.6), Inches(11.7), Inches(0.5))
    pf = foot_tf.paragraphs[0]; pf.alignment = PP_ALIGN.CENTER
    rf = pf.add_run(); rf.text = "booking-aurora（診所預約系統）· 委外方案評估"
    _set_font(rf, FONT, 14, False, RGBColor(0x8F,0xB8,0xB4))
    return s

def header(slide, title, subtitle=None, section=False):
    add_bg(slide, LIGHT)
    band(slide, ACCENT if not section else ACCENT2)
    tb, tf = textbox(slide, Inches(0.6), Inches(0.18), Inches(12.1), Inches(0.85), MSO_ANCHOR.MIDDLE)
    p = tf.paragraphs[0]
    r = p.add_run(); r.text = title; _set_font(r, FONT, 26 if not section else 30, True, WHITE)
    if subtitle:
        stb, stf = textbox(slide, Inches(0.6), Inches(1.25), Inches(12.1), Inches(0.5))
        sp = stf.paragraphs[0]
        sr = sp.add_run(); sr.text = subtitle; _set_font(sr, FONT, 15, False, GREY)

def bullets(slide, items, top=Inches(1.95), size=16, gap=8):
    bb, bf = textbox(slide, Inches(0.7), top, Inches(11.9), Inches(7.5)-top-Inches(0.3))
    first = True
    for item in items:
        code = False; txt = item; color = DARK; bold = False
        if isinstance(item, tuple):
            kind = item[0]
            if kind == 'code': code = True; txt = item[1]
            elif kind == 'ok': color = OK; txt = item[1]
            elif kind == 'warn': color = WARN; txt = item[1]
            elif kind == 'head': bold = True; color = ACCENT2; txt = item[1]
            else: txt = item[1]
        p = bf.paragraphs[0] if first else bf.add_paragraph()
        first = False
        p.space_after = Pt(gap)
        bullet = "▸ " if not (code or bold) else ""
        r = p.add_run(); r.text = bullet + txt
        if code: _set_font(r, MONO, 14, False, ACCENT2)
        else: _set_font(r, FONT, size, bold, color)
    return slide

def two_col(slide, left_title, left_items, right_title, right_items, top=Inches(1.95)):
    # left = pros (OK), right = cons (WARN)
    lw = Inches(5.9); rw = Inches(5.9); lx = Inches(0.7); rx = Inches(6.75)
    def col(x, w, ctitle, citems, ccolor):
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, top, w, Inches(4.9))
        card.fill.solid(); card.fill.fore_color.rgb = WHITE
        card.line.color.rgb = ccolor; card.line.width = Pt(1.5); card.shadow.inherit = False
        tb, tf = textbox(slide, x+Inches(0.25), top+Inches(0.15), w-Inches(0.5), Inches(0.5))
        p = tf.paragraphs[0]
        r = p.add_run(); r.text = ctitle; _set_font(r, FONT, 18, True, ccolor)
        bb, bf = textbox(slide, x+Inches(0.25), top+Inches(0.7), w-Inches(0.5), Inches(4.0))
        f = True
        for it in citems:
            pp = bf.paragraphs[0] if f else bf.add_paragraph()
            f = False
            pp.space_after = Pt(7)
            rr = pp.add_run(); rr.text = "• " + it
            _set_font(rr, FONT, 14.5, False, DARK)
    col(lx, lw, left_title, left_items, OK)
    col(rx, rw, right_title, right_items, WARN)
    return slide

def table_slide(slide, headers, rows, top=Inches(1.9), col_w=None):
    n = len(headers)
    width = prs.slide_width - Inches(1.0)
    if col_w is None:
        col_w = [width/n]*n
    rows_n = len(rows)+1
    tbl_h = Inches(0.55)*rows_n
    gtbl = slide.shapes.add_table(rows_n, n, Inches(0.5), top, width, tbl_h)
    table = gtbl.table
    for i, w in enumerate(col_w):
        table.columns[i].width = w
    # header
    for j, htxt in enumerate(headers):
        cell = table.cell(0, j)
        cell.fill.solid(); cell.fill.fore_color.rgb = ACCENT2
        cell.vertical_anchor = MSO_ANCHOR.MIDDLE
        tf = cell.text_frame; tf.word_wrap = True
        p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER if j>0 else PP_ALIGN.LEFT
        r = p.add_run(); r.text = htxt; _set_font(r, FONT, 13.5, True, WHITE)
    for i, row in enumerate(rows, start=1):
        for j, val in enumerate(row):
            cell = table.cell(i, j)
            cell.fill.solid()
            cell.fill.fore_color.rgb = WHITE if i%2 else LIGHT
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            tf = cell.text_frame; tf.word_wrap = True
            p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER if j>0 else PP_ALIGN.LEFT
            r = p.add_run(); r.text = val; _set_font(r, FONT, 12.5, False, DARK)
    return slide

# ---------------- SLIDES ----------------

cover("幫 booking-aurora 搵代理公司",
      "做「伺服器安裝」＋「網頁功能測試」\n邊間公司？幾錢？優點定缺點？一次過比較")

header(prs.slides.add_slide(BLANK), "你嘅項目係咩？", "先搞清楚要搵咩類型嘅公司", section=True)
bullets(prs.slides[-1], [
    ("head", "項目：booking-aurora — 診所預約網站（Node.js + SQLite + Caddy 反向代理）"),
    "已有 Docker / docker-compose / Caddyfile，基本上可以一鍵部署",
    "你需要代理公司幫手兩件事：",
    ("ok", "① 安裝伺服器：買 VPS / 雲端主機、裝 Docker、跑起個網站、綁網域 + HTTPS"),
    ("ok", "② 網頁功能測試：登入、預約、後台、WhatsApp/Email 通知等是否正常"),
    "結論：最啱你嘅係「香港 IT 外判公司」或「雲端平台 + 測試雲」組合",
], top=Inches(2.0))

header(prs.slides.add_slide(BLANK), "4 大方案總覽", "按「交畀人做」到「自己落手」排")
table_slide(prs.slides[-1],
    ["方案", "即係咩", "大概費用", "最啱邊種人"],
    [
        ["A. 香港 IT 外判公司", "一條龍：裝伺服器 + 維護 + 幫手測", "HK$2,000–12,000/月（或 $5k–50k 一次過）", "想慳煩、唔識技術"],
        ["B. 雲端 PaaS 自動部署", "Render / Railway / Fly.io 自己部署", "US$0–25/月（約 HK$0–200）", "有少少技術、想平"],
        ["C. 大廠雲 IaaS", "AWS / GCP / Azure 自己架", "US$10–50/月（約 HK$80–400）", "想完全控制、會 DevOps"],
        ["D. 測試雲平台", "BrowserStack / LambdaTest / Sauce Labs", "US$15–299/月（約 HK$120–2,400）", "想認真做功能/跨瀏覽器測試"],
    ],
    top=Inches(2.0),
    col_w=[Inches(2.9), Inches(4.6), Inches(3.3), Inches(2.6)])

# ---- 方案 A ----
header(prs.slides.add_slide(BLANK), "方案 A：香港 IT 外判公司", "代表：YSK、HKINT、Foundry、LoftyGroup、Visible One")
two_col(prs.slides[-1],
    "優點",
    ["一條龍：裝機 + 綁網域 + HTTPS + 備份全包",
     "月費制有 24/7 支援，出事有人救",
     "唔使自己學 Docker / Linux",
     "YSK 月費 HK$2,000 起已包 1 部美國 VPS",
     "本地溝通、廣東話、明白香港 PDPO 私隱要求"],
    "缺點",
    ["長遠月費係持續開支（合約常一年起）",
     "技術透明度低，源碼/伺服器可能綁死間公司",
     "質素參差，要揀有口碑嘅",
     "功能改動多數要額外收費",
     "診所資料喺第三方手，要簽好保密/存取協議"],
    top=Inches(1.9))
bullets(prs.slides.add_slide(BLANK), [
    ("head", "方案 A 參考價錢"),
    ("ok", "YSK：基本 HK$2,000/月（包 VPS + 5 條技術支援）、標準 $6,000、尊貴 $12,000；企業 AI 全託管 $88,000/年起"),
    ("ok", "HKINT：網頁設計一次過 $4,800–$9,800（包域名+寄存+SSL），客製功能/預約系統另報價"),
    ("ok", "Foundry：標準型 $6,000–15,000、電商 $8,000–20,000、進階客製 $50,000 起"),
    ("warn", "LoftyGroup / Visible One：IT 外判月費制，價錢要 quote，無公開牌價"),
    ("code", "小貼士：問清楚包含「部署 + 測試」，定係只包做網頁、伺服器另計"),
], top=Inches(1.9))

# ---- 方案 B ----
header(prs.slides.add_slide(BLANK), "方案 B：雲端 PaaS 自動部署", "Render / Railway / Fly.io — 自己部署，平到近乎免費")
two_col(prs.slides[-1],
    "優點",
    ["超平：有 Free Tier，正式用 US$5–25/月",
     "Git push 就自動部署，唔使管 Linux",
     "自動 HTTPS、自動重啟、scaling 簡單",
     "自己攞晒源碼同控制權",
     "Railway / Fly.io 亞洲有節點，香港訪客快"],
    "缺點",
    ["要識少少 Docker / 命令行",
     "免費版有休眠/限時，正式要畄錢",
     "DB（SQLite）要掛 volume，否則重啟冇晒資料",
     "出事要自己 Google 排錯，無人 call",
     "WhatsApp/Email 測試仍要自己郁手"],
    top=Inches(1.9))
bullets(prs.slides.add_slide(BLANK), [
    ("head", "方案 B 參考價錢（2026）"),
    ("ok", "Render：個人免費；Web 服務正式 US$7–25/月；Postgres 另計 US$7 起"),
    ("ok", "Railway：HK$0 試用額，之後 US$5/月基礎 + 按用量；小站約 HK$40–160/月"),
    ("ok", "Fly.io：按用量，輕量小站約 US$2–10/月（約 HK$16–80）"),
    ("warn", "合計：伺服器 + DB 大概 HK$60–300/月，遠平過外判月費"),
    ("code", "你個 project 已經有 docker-compose.yml → 基本上直接 upload 就得"),
], top=Inches(1.9))

# ---- 方案 C ----
header(prs.slides.add_slide(BLANK), "方案 C：大廠雲端 IaaS", "AWS / GCP / Azure — 完全自己架，最自由最穩")
two_col(prs.slides[-1],
    "優點",
    ["最穩定、最 scalable，醫療級可用",
     "香港/新加坡有 region，速度快、合規好",
     "計費透明，用幾多畀幾多",
     "CI/CD、監控、備份工具齊全",
     "源碼/資料 100% 自己掌控"],
    "缺點",
    ["設定最複雜，要識 DevOps",
     "一唔覺開錯 service 會貴（要Set budget alert）",
     "無人幫手測試，要自己寫/跑 test",
     "學習曲線高，新手易跌坑",
     "IP/防火牆/HTTPS 全部自己搞"],
    top=Inches(1.9))
bullets(prs.slides.add_slide(BLANK), [
    ("head", "方案 C 參考價錢"),
    ("ok", "AWS Lightsail（最易落手）：HK$40–80/月包 VPS",
     "EC2 彈性計費：小 instance 約 US$10–30/月"),
    ("ok", "GCP / Azure：基本 VM 約 US$15–50/月（約 HK$120–400）"),
    ("warn", "新手唔建議直接上 AWS EC2，先用 Lightsail 或 PaaS（方案 B）"),
], top=Inches(1.9))

# ---- 方案 D：測試雲 ----
header(prs.slides.add_slide(BLANK), "方案 D：網頁功能測試雲平台", "專做「網頁功能測試」的三大選擇")
table_slide(prs.slides[-1],
    ["平台", "月費（2026）", "強項", "適合"],
    [
        ["LambdaTest（TestMu AI）", "US$15–299", "最平、並行跑得快、AI 排錯", "細 team / 慳錢首選"],
        ["BrowserStack", "US$19–449", "真機最多、手動測試最順", "要廣覆蓋 + 手測"],
        ["Sauce Labs", "US$39–199", "企業級、CI/合規強", "大公司/受規管"],
    ],
    top=Inches(2.0),
    col_w=[Inches(3.2), Inches(2.6), Inches(4.0), Inches(3.6)])
bullets(prs.slides.add_slide(BLANK), [
    ("head", "測試雲平台點計錢？"),
    ("ok", "主要按「並行 session 數」收，唔係按分鐘：你要幾多條線同時跑測試就幾錢"),
    ("ok", "細 team（~100 測試/週）用 LambdaTest 約 US$175/年（~HK$1,400/年）最抵"),
    ("ok", "SMB 實際年均：LambdaTest ~US$3,264、BrowserStack ~US$5,671、Sauce Labs ~US$11,031"),
    ("warn", "如果你的項目係手動點擊測試為主，BrowserStack Live $39/月（~HK$305）就夠"),
    ("code", "你個 project 已經有 _qa_cross_test.js / Playwright → 可直接接 LambdaTest 跑雲端測試"),
], top=Inches(1.9))

# ---- 費用對比總表 ----
header(prs.slides.add_slide(BLANK), "費用對比總表", "一次過 + 每月開支（HK$ 估算）")
table_slide(prs.slides[-1],
    ["方案", "前期/一次過", "每月經常性", "年支出約"],
    [
        ["A. 香港 IT 外判", "HK$0–50,000", "HK$2,000–12,000", "HK$24,000–144,000"],
        ["B. PaaS 自部署", "HK$0", "HK$60–300", "HK$720–3,600"],
        ["C. 大廠雲 IaaS", "HK$0", "HK$120–400", "HK$1,440–4,800"],
        ["D. 測試雲平台", "HK$0", "HK$120–2,400", "HK$1,400–28,800"],
        ["最佳組合 B+D", "HK$0", "HK$180–2,700", "HK$2,160–32,400"],
    ],
    top=Inches(2.0),
    col_w=[Inches(3.2), Inches(3.0), Inches(3.4), Inches(3.4)])

# ---- 優點缺點總結 ----
header(prs.slides.add_slide(BLANK), "優點 / 缺點 一句總結", "幫你快啲決定")
two_col(prs.slides[-1],
    "最啱你嘅做法",
    ["想完全唔郁手 → 搵 A（外判），但貴 + 綁死",
     "想平 + 有控制權 → B（PaaS）自己部署",
     "認真做功能測試 → 加 D（LambdaTest）",
     "醫療資料敏感 → 揀香港公司/本地雲，簽 NDA",
     "已有 Playwright 測試 → 直接上雲端跑最慳"],
    "要避嘅坑",
    ["外判合約冇寫明「交源碼 + 伺服器權限」",
     "PaaS 免費版 SQLite 無掛 volume 會冇資料",
     "測試雲買太多 parallel session 白畀錢",
     "AWS 無set budget alert 會爆錶",
     "唔好將 .env / 病人 DB 落 Git 或交畀人亂擺"],
    top=Inches(1.9))

# ---- 建議 ----
header(prs.slides.add_slide(BLANK), "我嘅建議（最啱 booking-aurora）", "按你嘅情況落藥")
bullets(prs.slides[-1], [
    ("head", "推薦組合：方案 B（PaaS）+ 方案 D（LambdaTest）"),
    ("ok", "伺服器：用 Railway 或 Render 部署（你已有 docker-compose，半日搞掂）"),
    ("ok", "測試：用 LambdaTest 跑你現有 Playwright 跨瀏覽器測試，年費約 HK$1,400 起"),
    ("ok", "總開支：約 HK$180–500/月，遠平過外判，控制權又喺手"),
    ("warn", "如果你完全唔想郁手 → 搵 YSK / LoftyGroup 做外判，記得合約寫明交源碼 + 權限"),
    ("warn", "診所病人資料敏感：無論搵邊間，都要簽保密協議 + 確認備份/加密"),
    ("code", "下一步：開 Railway 帳號 → import repo → 填 .env → 用 LambdaTest 跑 _qa_cross_test.js"),
])

prs.save("booking-aurora_搵代理公司比較.pptx")
print("saved booking-aurora_搵代理公司比較.pptx with", len(prs.slides._sldIdLst), "slides")
