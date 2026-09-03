# -*- coding: utf-8 -*-
"""Visible One vs YSK vs Topone — 詳細價錢 + 服務比較 PPT"""
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
    run.font.name = name; run.font.size = Pt(size)
    run.font.bold = bold; run.font.color.rgb = color
    rPr = run._r.get_or_add_rPr()
    ea = rPr.find('{http://schemas.openxmlformats.org/drawingml/2006/main}ea')
    if ea is None:
        ea = rPr.makeelement('{http://schemas.openxmlformats.org/drawingml/2006/main}ea', {})
        rPr.append(ea)
    ea.set('typeface', name)

def add_bg(slide, color=LIGHT):
    f = slide.background.fill; f.solid(); f.fore_color.rgb = color

def band(slide, color=ACCENT, h=Inches(1.15)):
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, h)
    shp.fill.solid(); shp.fill.fore_color.rgb = color
    shp.line.fill.background(); shp.shadow.inherit = False; return shp

def textbox(slide, l, t, w, h, anchor=MSO_ANCHOR.TOP):
    tb = slide.shapes.add_textbox(l, t, w, h)
    tf = tb.text_frame; tf.word_wrap = True; tf.vertical_anchor = anchor
    return tb, tf

def cover(title, subtitle):
    s = prs.slides.add_slide(BLANK); add_bg(s, DARK)
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
    rf = pf.add_run(); rf.text = "booking-aurora（診所預約系統）· 代理公司深度比較"
    _set_font(rf, FONT, 14, False, RGBColor(0x8F,0xB8,0xB4))
    return s

def header(slide, title, subtitle=None, section=False):
    add_bg(slide, LIGHT); band(slide, ACCENT if not section else ACCENT2)
    tb, tf = textbox(slide, Inches(0.6), Inches(0.18), Inches(12.1), Inches(0.85), MSO_ANCHOR.MIDDLE)
    p = tf.paragraphs[0]; r = p.add_run(); r.text = title
    _set_font(r, FONT, 26 if not section else 30, True, WHITE)
    if subtitle:
        stb, stf = textbox(slide, Inches(0.6), Inches(1.25), Inches(12.1), Inches(0.5))
        sp = stf.paragraphs[0]; sr = sp.add_run(); sr.text = subtitle
        _set_font(sr, FONT, 15, False, GREY)

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
        p = bf.paragraphs[0] if first else bf.add_paragraph(); first = False
        p.space_after = Pt(gap); bullet = "▸ " if not (code or bold) else ""
        r = p.add_run(); r.text = bullet + txt
        if code: _set_font(r, MONO, 14, False, ACCENT2)
        else: _set_font(r, FONT, size, bold, color)

def two_col(slide, left_title, left_items, right_title, right_items, top=Inches(1.95)):
    lw = Inches(5.9); rw = Inches(5.9); lx = Inches(0.7); rx = Inches(6.75)
    def col(x, w, ctitle, citems, ccolor):
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, top, w, Inches(4.9))
        card.fill.solid(); card.fill.fore_color.rgb = WHITE
        card.line.color.rgb = ccolor; card.line.width = Pt(1.5); card.shadow.inherit = False
        tb, tf = textbox(slide, x+Inches(0.25), top+Inches(0.15), w-Inches(0.5), Inches(0.5))
        p = tf.paragraphs[0]; r = p.add_run(); r.text = ctitle; _set_font(r, FONT, 18, True, ccolor)
        bb, bf = textbox(slide, x+Inches(0.25), top+Inches(0.7), w-Inches(0.5), Inches(4.0))
        f = True
        for it in citems:
            pp = bf.paragraphs[0] if f else bf.add_paragraph(); f = False
            pp.space_after = Pt(7); rr = pp.add_run(); rr.text = "• " + it
            _set_font(rr, FONT, 14.5, False, DARK)
    col(lx, lw, left_title, left_items, OK)
    col(rx, rw, right_title, right_items, WARN)

def table_slide(slide, headers, rows, top=Inches(1.9), col_w=None):
    n = len(headers); width = prs.slide_width - Inches(1.0)
    if col_w is None: col_w = [width/n]*n
    rows_n = len(rows)+1; tbl_h = Inches(0.55)*rows_n
    gtbl = slide.shapes.add_table(rows_n, n, Inches(0.5), top, width, tbl_h)
    table = gtbl.table
    for i, w in enumerate(col_w): table.columns[i].width = w
    for j, htxt in enumerate(headers):
        cell = table.cell(0, j); cell.fill.solid(); cell.fill.fore_color.rgb = ACCENT2
        cell.vertical_anchor = MSO_ANCHOR.MIDDLE; tf = cell.text_frame; tf.word_wrap = True
        p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER if j>0 else PP_ALIGN.LEFT
        r = p.add_run(); r.text = htxt; _set_font(r, FONT, 13.5, True, WHITE)
    for i, row in enumerate(rows, start=1):
        for j, val in enumerate(row):
            cell = table.cell(i, j); cell.fill.solid()
            cell.fill.fore_color.rgb = WHITE if i%2 else LIGHT
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE; tf = cell.text_frame; tf.word_wrap = True
            p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER if j>0 else PP_ALIGN.LEFT
            r = p.add_run(); r.text = val; _set_font(r, FONT, 12.5, False, DARK)

# ====================== SLIDES ======================

cover("代理公司深度比較",
      "Visible One · YSK Limited · Topone\n詳盡價錢 + 服務 + 優缺點 · 一次過睇晒")

# ---- 項目需求 ----
header(prs.slides.add_slide(BLANK), "你嘅項目需求", "booking-aurora（診所預約系統）")
bullets(prs.slides[-1], [
    ("head", "系統：Node.js + SQLite + Caddy 反向代理（已有 Docker Compose）"),
    "你已經有完整可部署嘅代碼，需要有人幫手：",
    ("ok", "① 伺服器安裝：開 VPS / 雲端主機、裝 Docker、綁網域 + HTTPS、設定自動備份"),
    ("ok", "② 網頁功能測試：登入、預約、後台、WhatsApp/Email 通知等"),
    ("warn", "診所涉及病人資料（PDPO 私隱條例），資料安全同保密好重要"),
    ("code", "要揀嘅公司類型：有伺服器管理 + 網站維護能力嘅 IT 外判公司"),
], top=Inches(1.9))

# ==================== Visible One ====================
header(prs.slides.add_slide(BLANK), "Visible One — 公司概覽", "2008 年成立 · 葵涌 · 50-249 人 · 做咗 18 年", section=True)
bullets(prs.slides[-1], [
    ("head", "公司資料"),
    "地址：葵涌葵興路 29-37 興明工業大廈 8 字樓 B2 室",
    "電話：(852) 2127 0101 / (852) 3616 6069",
    "Email：info@visibleone.com.hk",
    "網站：visibleone.com",
    ("head", "主要服務"),
    "網站開發（WordPress / Laravel / Drupal / React / Shopify / Magento）",
    "DevOps 服務（CI/CD、自動化、雲端遷移）",
    "託管式雲服務（AWS / GCP / Azure）",
    "IT 解決方案（Microsoft 365 / Azure / HubSpot / Staffcop）",
    "SEO / Google Ads / 社交媒體營銷",
    "SSL / 網站託管 / 惡意軟件監控",
], top=Inches(1.9), size=15)

# Visible One 價錢
header(prs.slides.add_slide(BLANK), "Visible One — 詳細價錢", "網站開發 + IT 服務 + DevOps + 託管")
table_slide(prs.slides[-1],
    ["服務", "價錢", "備註"],
    [
        ["網站開發（最低）", "US$5,000+（~HK$39,000+）", "最低項目預算 $5K USD"],
        ["按小時計費", "US$25–50/小時（~HK$195–390）", "所有服務通用"],
        ["按日計費", "US$200–400/日（~HK$1,560–3,120）", "適合短期項目"],
        ["DevOps 服務", "按項目報價", "從規劃到部署全包"],
        ["託管式雲服務", "按項目報價", "SaaS / PaaS / IaaS 全覆蓋"],
        ["IT 解決方案", "按項目報價", "Microsoft 365 / Azure 設定"],
        ["網站維護", "按項目報價", "上線後持續維護"],
        ["SEO / 廣告", "按項目報價", "Google Ads / Meta Ads"],
    ],
    top=Inches(2.0),
    col_w=[Inches(3.8), Inches(4.5), Inches(4.3)])
bullets(prs.slides.add_slide(BLANK), [
    ("head", "Visible One 價錢分析"),
    ("ok", "最低消費 US$5,000 起（約 HK$39,000），係香港中型公司正常價位"),
    ("ok", "按小時 US$25–50，比大廠便宜（Accenture US$200+），中小企合理"),
    ("warn", "全部要「按項目報價」，冇公開月費方案，溝通成本高"),
    ("warn", "DevOps / 雲端 / IT 解決方案全部冇標價，要 submit quotation form 先"),
    ("ok", "18 年歷史 + TechBehemoths 2025 全球大獎，質素有一定保證"),
    ("code", "你個 booking-aurora 估計要 HK$30,000–80,000 一次過開發 + 部署"),
], top=Inches(1.9), size=15)

# Visible One 優缺點
header(prs.slides.add_slide(BLANK), "Visible One — 優點 vs 缺點")
two_col(prs.slides[-1],
    "優點",
    ["18 年歷史，香港本地公司，口碑穩",
     "全棧：WordPress/Laravel/React/Drupal 全做",
     "DevOps + 雲端遷移有經驗（AWS/GCP/Azure）",
     "SEO + 數字營銷一條龍，上線後推廣無憂",
     "葵涌辦公室可以上門傾",
     "多語系網站經驗豐富（中英日韓）",
     "有 TechBehemoths 2025 獎項認證"],
    "缺點",
    ["價錢全部要 quote，冇公開透明方案",
     "最低 US$5,000 起，小預算唔太適合",
     "未見有「伺服器 + 測試」打包月費方案",
     "DevOps 服務偏企業級，診所小站可能大材小用",
     "主打 WordPress/Laravel，Node.js 專長未見明確宣傳"],
    top=Inches(1.9))

# ==================== YSK Limited ====================
header(prs.slides.add_slide(BLANK), "YSK Limited — 公司概覽", "香港開發者外判 · 全遠端 · 月費制", section=True)
bullets(prs.slides[-1], [
    ("head", "公司資料"),
    "全遠端支援（無實體辦公室），香港公司",
    "網站：ysk.hk",
    "合約期：一年起，只限遠端",
    ("head", "主要服務"),
    "開發者外判（月費制，$2,000/月起）",
    "跨平台 APP 開發（React Native，iOS + Android）",
    "企業私有 LLM 全託管（年費 $88,000 起）",
    "雲端遷移 + 網絡安全（AWS / GCP / 零信任）",
    "Web3 區塊鏈開發",
    ("head", "特色"),
    ("ok", "所有計劃包 1 部美國獨立 IP VPS（伺服器免費）"),
    ("ok", "支援 Node.js / React / Python / Python 等全端技術棧"),
    ("ok", "MIT 開源自建伺服器管理工具（YSK Server）"),
], top=Inches(1.9), size=14)

# YSK 價錢
header(prs.slides.add_slide(BLANK), "YSK Limited — 詳細價錢", "月費制 + 伺服器包埋")
table_slide(prs.slides[-1],
    ["計劃", "月費", "遠端支援", "開發配額（網站+iOS+Android）", "伺服器"],
    [
        ["基本", "HK$2,000/月", "每月 5 條技術問題", "合共 5 頁動態頁", "1 部美國 VPS（基礎設定）"],
        ["標準", "HK$6,000/月", "每月 20 條技術問題", "合共 20 頁動態頁", "1 部美國 VPS（進階效能+備份）"],
        ["尊貴", "HK$12,000/月", "每月 50 條技術問題", "合共 50 頁動態頁", "1 部美國 VPS（負載平衡+零信任）"],
        ["企業定制", "書面報價", "自訂 SLA", "無頁數上限", "混合雲（AWS/GCP）"],
    ],
    top=Inches(2.0),
    col_w=[Inches(1.8), Inches(2.2), Inches(3.0), Inches(3.5), Inches(3.1)])
bullets(prs.slides.add_slide(BLANK), [
    ("head", "YSK 價錢分析"),
    ("ok", "HK$2,000/月 已包 VPS + 技術支援，性價比極高"),
    ("ok", "標準 $6,000/月 包 20 條技術問題 + 20 頁開發，對診所夠用"),
    ("warn", "一年合約起，即係最少要畀 HK$24,000（基本）/ $72,000（標準）"),
    ("warn", "全遠端，無實體辦公室，出事冇人上門"),
    ("ok", "所有計劃包 App Store / Google Play 上架"),
    ("ok", "私有 LLM 年費 $88,000 起 — 如果診所想做 AI 問診/排班可以考慮"),
    ("code", "你個 booking-aurora 用標準計劃（$6,000/月）= 每年 $72,000"),
], top=Inches(1.9), size=15)

# YSK 優缺點
header(prs.slides.add_slide(BLANK), "YSK Limited — 優點 vs 缺點")
two_col(prs.slides[-1],
    "優點",
    ["月費制最透明：$2,000/$6,000/$12,000 清清楚楚",
     "所有計劃包 1 部美國 VPS，唔使另外租伺服器",
     "Node.js / React / Python 全端支援，技術棧最Match",
     "支援私有 LLM（診所可以做 AI 問診）",
     "App Store 上架包埋",
     "MIT 開源工具，技術實力強"],
    "缺點",
    ["只限遠端，冇實體辦公室，溝通可能有時差",
     "一年合約起，唔可以試完唔鍾意就走",
     "5 條/月技術問題（基本）偏少，出事要排隊",
     "冇明確提及「功能測試」服務，要額外問",
     "美國 VPS 託管，香港訪問可能有延遲",
     "公司規模細，長遠穩定性未知"],
    top=Inches(1.9))

# ==================== Topone ====================
header(prs.slides.add_slide(BLANK), "Topone — 公司概覽", "專業 IT 外判 · 香港本地 · 有 SLA 承諾", section=True)
bullets(prs.slides[-1], [
    ("head", "公司資料"),
    "香港本地 IT 外判公司",
    "網站：topone.hk",
    "專注：託管式 IT 服務 / 外判 IT 支援 / 伺服器管理",
    ("head", "主要服務"),
    "IT 支援台（遙距 + 上門）",
    "伺服器管理 + 維護（Windows / NAS / 雲端）",
    "網站維護 + 託管",
    "Microsoft 365 / Azure 管理",
    "網絡安全（EDR / 漏洞掃描 / 防釣魚演練）",
    "雲端備份 + 災難復原",
    "員工入職 / 離職 IT 設定",
    ("head", "特色"),
    ("ok", "明確 SLA：遙距 30 分鐘–2 小時回應，上門 4 小時內"),
    ("ok", "有 2 星期免費試用"),
    ("ok", "簽 1 年送 1 個月 / 免費防毒"),
], top=Inches(1.9), size=14)

# Topone 價錢
header(prs.slides.add_slide(BLANK), "Topone — 詳細價錢", "三個計劃 + 額外服務")
table_slide(prs.slides[-1],
    ["計劃", "月費", "最低消費", "包含服務"],
    [
        ["基本遙距支援", "HK$100/設備/月", "HK$1,000/月", "無限遙距支援 + M365管理 + GLPI 資產管理"],
        ["全面企業託管", "HK$150/設備/月", "HK$2,000/月", "上門支援 + 伺服器(2台) + 備份監控 + Zabbix監控 + 5G路由器借用"],
        ["資訊安全與合規", "更高", "更高端", "EDR + 漏洞掃描 + 釣魚演練 + 災難復原計劃"],
    ],
    top=Inches(2.0),
    col_w=[Inches(2.8), Inches(2.8), Inches(2.5), Inches(5.3)])
bullets(prs.slides.add_slide(BLANK), [
    ("head", "Topone 其他收費"),
    ("ok", "簽 1 年合約：送 1 個月免費 / 或免費防毒軟件 1 年"),
    ("ok", "2 星期免費試用（無綁定）"),
    ("ok", "新電腦部署：HK$800/台（全面計劃免費）"),
    ("ok", "伺服器管理：全面計劃包 2 台，額外另計"),
    ("warn", "按「設備數」計費，唔係按人頭"),
    ("warn", "基本計劃無上門支援、無伺服器管理、無備份監控"),
    ("code", "你個 booking-aurora：全面計劃 $150/設備 × 5 台 = HK$750/月最低"),
], top=Inches(1.9), size=15)

# Topone 優缺點
header(prs.slides.add_slide(BLANK), "Topone — 優點 vs 缺點")
two_col(prs.slides[-1],
    "優點",
    ["SLA 明確：遙距 30 分鐘–2 小時、上門 4 小時內",
     "香港本地公司，可以上門",
     "2 星期免費試用，零風險開始",
     "全面計劃包 2 台伺服器管理 + 備份監控",
     "Zabbix 24/7 監控 + GLPI 資產管理",
     "簽 1 年送 1 個月（性價比提升）"],
    "缺點",
    ["主打 IT 外判（硬件/網絡），唔係專做網站開發",
     "冇提及 DevOps / Docker / Node.js 專長",
     "冇網頁功能測試（QA）服務",
     "按設備計費，設備多會貴",
     "網站維護只係「可選附加」，唔係核心服務"],
    top=Inches(1.9))

# ==================== 三間總比較 ====================
header(prs.slides.add_slide(BLANK), "三間公司總比較", "一目了然")
table_slide(prs.slides[-1],
    ["比較項目", "Visible One", "YSK Limited", "Topone"],
    [
        ["成立年份", "2008（18 年）", "較新", "較新"],
        ["規模", "50-249 人", "小型", "中小型"],
        ["辦公地點", "葵涌（可上門）", "全遠端", "香港本地"],
        ["合約期", "按項目", "1 年起", "3 個月 / 1 年"],
        ["價錢模式", "按項目/小時報價", "月費制（$2,000-$12,000）", "月費制（$100-$150/設備）"],
        ["伺服器管理", "有（雲端遷移）", "包埋（美國 VPS）", "有（全面計劃包 2 台）"],
        ["Node.js 專長", "未明確宣傳", "明確支援", "未明確宣傳"],
        ["網頁功能測試", "未提及", "未提及", "未提及"],
        ["Docker 支援", "有（DevOps）", "有（全端）", "未明確"],
        ["SLA 服務級別", "未公開", "自訂（企業）", "明確承諾"],
        ["私隱/PDPO", "有經驗", "有經驗", "有經驗"],
        ["SEO/推廣", "有", "無", "無"],
    ],
    top=Inches(1.9),
    col_w=[Inches(2.5), Inches(3.4), Inches(3.4), Inches(3.4)])

# ==================== 費用對比 ====================
header(prs.slides.add_slide(BLANK), "booking-aurora 部署 + 測試 費用估算", "三間公司實際要畀幾錢？")
table_slide(prs.slides[-1],
    ["項目", "Visible One", "YSK Limited", "Topone"],
    [
        ["伺服器安裝", "US$5,000+ 項目費", "包喺月費入面", "包喺全面計劃"],
        ["每月伺服器費", "另計（雲端託管）", "包喺月費（美國 VPS）", "另計（你自付）"],
        ["每月維護費", "按項目", "$6,000/月（標準）", "$150/設備 × N"],
        ["功能測試", "未提供", "未提供", "未提供"],
        ["第一年總成本", "~HK$50,000–100,000", "HK$72,000（標準）", "HK$9,000–18,000"],
        ["第二年起每年", "~HK$20,000–50,000", "HK$72,000", "HK$9,000–18,000"],
        ["適合程度", "大材小用，偏貴", "最 Match 技術棧", "IT 外判最專業"],
    ],
    top=Inches(2.0),
    col_w=[Inches(2.5), Inches(3.4), Inches(3.4), Inches(3.4)])

# ==================== 建議 ====================
header(prs.slides.add_slide(BLANK), "我嘅建議", "邊間最啱 booking-aurora？")
bullets(prs.slides[-1], [
    ("head", "推薦方案：YSK Limited（標準計劃 $6,000/月）"),
    ("ok", "技術棧最 Match：Node.js / React / Docker 全支援"),
    ("ok", "包埋美國 VPS + 20 條技術支援/月"),
    ("ok", "月費制最透明，唔使估價"),
    ("warn", "備選方案：Visible One（如果想做 SEO + 推廣）"),
    ("warn", "備選方案：Topone（如果只係需要 IT 外判 + 伺服器管理）"),
    ("code", "功能測試三間都冇，建議用 LambdaTest 自動化測試（~HK$120/月）"),
    ("code", "總開支：YSK $6,000 + LambdaTest $120 = HK$6,120/月"),
    ("code", "等於每年 HK$73,440，比自聘工程師（$30,000+/月）平 4 倍"),
], top=Inches(1.9), size=15)

# ---- 行動步驟 ----
header(prs.slides.add_slide(BLANK), "下一步行動", "跟住做啲咩？")
bullets(prs.slides[-1], [
    ("head", "即刻可以做"),
    ("ok", "1. 填 YSK 報價表：ysk.hk → 查詢外判計劃，說明 booking-aurora 需求"),
    ("ok", "2. 填 Visible One 報價表：visibleone.com/quotation → 揀「DevOps 服務」+「網站維護」"),
    ("ok", "3. 試用 Topone：topone.hk → 2 星期免費試用（零風險）"),
    ("warn", "記得問清：Node.js+Docker 有冇經驗？PDPO 點做？源碼歸邊個？出事幾耐回應？"),
    ("code", "4. 同時開 LambdaTest 帳號試用：lambdatest.com → 免費 100 分鐘"),
])

# ==================== 公司背景深度分析 ====================
header(prs.slides.add_slide(BLANK), "Visible One — 背景深度分析", "18 年歷史 · 中型公司 · 全方位")
bullets(prs.slides[-1], [
    ("head", "公司規模與歷史"),
    "成立：2008 年，18 年歷史，係香港老牌網頁設計公司之一",
    "員工人數：50-249 人（中型規模），有設計、開發、SEO、內容團隊",
    "辦公室：葵涌（可上門拜訪）",
    "獲獎：TechBehemoths 2025 全球大獎（香港最佳網頁設計公司）",
    ("head", "技術能力"),
    "全棧：WordPress / Laravel / Drupal / React / Shopify / Magento",
    "DevOps：CI/CD、自動化部署、AWS / GCP / Azure 雲端遷移",
    "多語系：中英日韓網站經驗豐富",
    "SEO：Google Ads / Meta Ads / 社交媒體營銷一條龍",
    ("head", "客戶類型"),
    "律師行、上市公司、餐飲、NGO — 偏中大型企業",
    ("warn", "未見 Node.js / Docker 專長宣傳，技術棧可能唔最 Match"),
], top=Inches(1.9), size=14)

header(prs.slides.add_slide(BLANK), "YSK Limited — 背景深度分析", "新興公司 · 全遠端 · 技術導向")
bullets(prs.slides[-1], [
    ("head", "公司規模與歷史"),
    "較新嘅香港科技公司，主打「開發者外判」",
    "全遠端模式，無實體辦公室",
    "合約：一年起，只限遠端支援",
    ("head", "技術能力"),
    ("ok", "明確支援：Node.js / React / Python / React Native（最 Match 你）"),
    ("ok", "MIT 開源自建工具（YSK Server / 瞬劇魔法師 / gctoac）"),
    ("ok", "私有 LLM 全託管（年費 $88,000 起，AI 問診/排班可考慮）"),
    ("ok", "雲端遷移 + 零信任架構 + Web3 區塊鏈"),
    ("head", "客戶類型"),
    "初創企業、中小企、需要快速 MVP 嘅公司",
    ("warn", "公司較新，長遠穩定性有待觀察"),
    ("warn", "全遠端 = 冇人上門，出事要等"),
], top=Inches(1.9), size=14)

header(prs.slides.add_slide(BLANK), "Topone — 背景深度分析", "IT 外判 · 本地支援 · SLA 承諾")
bullets(prs.slides[-1], [
    ("head", "公司規模與歷史"),
    "香港本地 IT 外判公司，專注託管式 IT 服務",
    "主打中小企（20-50 人公司為主）",
    ("head", "技術能力"),
    ("ok", "伺服器管理：Windows / NAS / 雲端（AWS / Azure）"),
    ("ok", "Microsoft 365 / Azure 管理"),
    ("ok", "網絡安全：EDR / 漏洞掃描 / 防釣魚演練"),
    ("ok", "Zabbix 24/7 硬件監控 + GLPI 資產管理"),
    ("ok", "災難復原（備份 + 還原測試 + 離線備份）"),
    ("head", "客戶類型"),
    "中小企辦公室 IT 外判（20-50 台設備）",
    ("warn", "主打硬件/網絡 IT 外判，唔係專做網站開發"),
    ("warn", "冇提及 Node.js / Docker / DevOps 專長"),
    ("warn", "網站維護只係「可選附加」，唔係核心服務"),
], top=Inches(1.9), size=14)

# ==================== 長遠規劃分析 ====================
header(prs.slides.add_slide(BLANK), "長遠規劃：診所預約系統嘅發展路線", "而家 → 1 年 → 3 年 → 5 年", section=True)
bullets(prs.slides[-1], [
    ("head", "第一階段（0-6 個月）：上線穩定"),
    ("ok", "目標：網站穩定運行、資料安全、有基本維護支援"),
    ("ok", "需要：伺服器安裝 + 功能測試 + 每月維護"),
    ("ok", "預算：HK$3,000–8,000/月"),
    ("head", "第二階段（6-18 個月）：功能擴展"),
    ("ok", "目標：加 WhatsApp 通知、支付系統、會員系統"),
    ("ok", "需要：持續開發 + API 整合 + SEO"),
    ("ok", "預算：HK$5,000–15,000/月"),
    ("head", "第三階段（18-36 個月）：規模擴大"),
    ("ok", "目標：多間分店、病人增長、系統要自動擴展"),
    ("ok", "需要：雲端架構升級 + 監控 + 數據分析"),
    ("ok", "預算：HK$10,000–30,000/月"),
    ("head", "第四階段（3-5 年）：AI 升級"),
    ("ok", "目標：AI 問診/排班、病人資料分析"),
    ("ok", "需要：私有 LLM + 大數據 + 合規"),
    ("ok", "預算：HK$20,000–80,000/月"),
], top=Inches(1.9), size=14)

header(prs.slides.add_slide(BLANK), "長遠分析：邊間最適合？", "按階段推薦 + 風險評估")
bullets(prs.slides[-1], [
    ("head", "長遠最佳選擇：YSK Limited"),
    ("ok", "第一階段（上線）：YSK 標準 $6,000/月 — 技術棧最 Match、包 VPS"),
    ("ok", "第二階段（擴展）：YSK 維持 — 20 條技術支援/月 + 持續開發"),
    ("ok", "第三階段（規模）：YSK 尊貴 $12,000/月 或 升級企業定制"),
    ("ok", "第四階段（AI）：YSK 私有 LLM 年費 $88,000 起 — 唔使換公司"),
    ("warn", "風險：YSK 公司較新，長遠穩定性有待觀察"),
    ("warn", "備選：Visible One（如果想要老牌公司安全感）"),
    ("warn", "備選：Topone（如果只係需要 IT 外判）"),
], top=Inches(1.9), size=15)

header(prs.slides.add_slide(BLANK), "長遠風險分析", "每個方案嘅長遠風險")
two_col(prs.slides[-1],
    "YSK 長遠風險",
    ["公司較新，5-10 年後仲喺唔喺？",
     "全遠端，無實體辦公室，出事要等",
     "一年合約起，唔可以隨時走",
     "50 條/月技術問題（尊貴）可能唔夠",
     "美國 VPS 託管，香港訪問有延遲"],
    "Visible One 長遠風險",
    ["價錢唔透明，長遠成本難預算",
     "18 年歷史，穩定性最高",
     "技術棧偏 WordPress/Laravel，Node.js 專長未知",
     "50-249 人，長遠團隊穩定",
     "可以 SEO + 推廣一條龍"],
    top=Inches(1.9))

header(prs.slides.add_slide(BLANK), "長遠成本對比（5 年總開支）", "邊個最平？")
table_slide(prs.slides[-1],
    ["年份", "Visible One", "YSK Limited", "Topone + LambdaTest"],
    [
        ["第 1 年", "~HK$80,000", "HK$72,000", "~HK$21,000"],
        ["第 2 年", "~HK$40,000", "HK$72,000", "~HK$21,000"],
        ["第 3 年", "~HK$40,000", "HK$72,000", "~HK$21,000"],
        ["第 4 年", "~HK$40,000", "HK$72,000", "~HK$21,000"],
        ["第 5 年", "~HK$40,000", "HK$72,000", "~HK$21,000"],
        ["5 年總計", "~HK$240,000", "HK$360,000", "~HK$105,000"],
    ],
    top=Inches(2.0),
    col_w=[Inches(2.5), Inches(3.4), Inches(3.4), Inches(3.4)])
bullets(prs.slides.add_slide(BLANK), [
    ("head", "5 年總成本分析"),
    ("ok", "Topone + LambdaTest 最平：5 年 ~HK$105,000"),
    ("ok", "Visible One 中間：5 年 ~HK$240,000（但技術棧可能唔最 Match）"),
    ("warn", "YSK 最貴：5 年 HK$360,000（但技術棧最 Match + 包 VPS）"),
    ("warn", "但！YSK 包埋 VPS + 技術支援 + 開發配額，值唔值要計"),
    ("code", "如果 Topone 可以處理 Node.js + Docker → 最平最穩"),
    ("code", "如果唔得 → YSK 雖然貴，但技術最穩、長遠最安全"),
], top=Inches(1.9), size=15)

header(prs.slides.add_slide(BLANK), "最終建議：長遠嚟睇", "邊個最適合 booking-aurora？")
bullets(prs.slides[-1], [
    ("head", "如果技術棧 Match（Topone 有 Node.js 經驗）"),
    ("ok", "首選：Topone + LambdaTest — 最平（$750+$120=$870/月）、本地支援、有 SLA"),
    ("ok", "5 年總成本最低，風險可控"),
    ("head", "如果技術棧唔 Match（Topone 冇 Node.js 經驗）"),
    ("ok", "首選：YSK Limited — 技術最穩、包 VPS、長遠可以升級到 AI"),
    ("ok", "雖然貴，但唔使換公司、唔使重新評估"),
    ("head", "如果想要老牌公司安全感"),
    ("ok", "首選：Visible One — 18 年歷史、全棧技術、可以做 SEO 推廣"),
    ("ok", "但價錢唔透明、技術棧可能唔最 Match"),
    ("warn", "行動：三間都填報價表、問清 Node.js + Docker 有冇經驗、再決定"),
    ("warn", "最重要：源碼同伺服器權限 100% 歸你、簽 NDA、PDPO 合規"),
], top=Inches(1.9), size=14)

# ==================== 俾老細睇：公司背景 + 案例 + ROI ====================

# ---- 目錄 ----
header(prs.slides.add_slide(BLANK), "目錄（俾老細）", "本報告涵蓋", section=True)
bullets(prs.slides[-1], [
    "① Visible One／YSK／Topone 三間公司詳細背景",
    "② 三間公司實際案例＋客戶評價",
    "③ 價格詳細對比（第一年總成本／年費用／5年總成本）",
    "④ 服務範圍完整對比表",
    "⑤ 長遠規劃（0-6個月／1年／3年／5年路線圖）",
    "⑥ 6大評估準則（技術匹配／成本／穩定性／私隱／擴展／售後）逐項評分",
    "⑦ 最終推薦＋決策時間線",
], top=Inches(2.0))

# ==================== 每間公司詳細背景 ====================
header(prs.slides.add_slide(BLANK), "① Visible One — 詳細背景", "老牌公司 · 大型 · 全方位", section=True)
bullets(prs.slides[-1], [
    ("head", "基本資料"),
    "母公司：晫高科技（Visible One Limited）",
    "成立：2008年（18年歷史）· 員工人數：LinkedIn 顯示約19-100人",
    "總部：葵涌成美工業大廈8樓B2室（3個香港辦公室）· 另有新加坡分部",
    "團隊分布：香港＋新加坡＋緬甸／泰國／越南／寮國／菲律賓（6國）",
    "證書／獎項：TechBehemoths 2025 全球大獎（香港最佳網頁設計），2026年再獲同一獎項",
    ("head", "客戶名單（公開）"),
    "周大福創建、屯門地區康健中心（醫療）、新翔SATS（香港國際機場）、Mori Jewellery、寰發洋酒、Loeb Smith、壹森健康醫療（Life Young）、TMDHC",
    "其他參考客戶：Rolex Utpices、譚仔、HKU、中大、英皇珠寶、富昌金融、李錦記集團、政府部門",
    ("head", "醫療／診所相關經驗"),
    ("ok", "屯門地區康健中心（TMDHC）：基層醫療網站＋會員登記＋活動註冊＋API整合"),
    ("ok", "壹森健康醫療：健康中心網站＋預約服務＋線上商品＋線上交易"),
    ("ok", "對你做診所預約網站高度相關，有醫療項目實績"),
], top=Inches(1.9), size=13)

header(prs.slides.add_slide(BLANK), "① YSK Limited — 詳細背景", "新銳公司 · 全遠端 · 技術導向", section=True)
bullets(prs.slides[-1], [
    ("head", "基本資料"),
    "公司名稱：YSK Limited（YSK股份有限公司）",
    "成立：2019年4月15日（公司註冊編號 0586836）",
    "註冊地址：尖沙咀科學館道1號康宏廣場6樓01室；旺角另有辦公室",
    "模式：全遠端（remote tech team）· 合約一年起",
    "定位：企業數碼轉型＋開發者外判＋私有LLM＋雲端安全＋Web3",
    ("head", "自家產品（技術實力證明）"),
    "SalonEase / SoulMD Hub（SaaS平台，100+商戶使用）",
    "YSK Server（MIT開源伺服器管理工具）、瞬劇魔法師、Grok CLI Gateway（MIT開源）",
    "GitHub：github.com/yanshekki",
    ("head", "案例（因NDA保密，用匿名描述）"),
    ("ok", "本地貨運公司：React＋Node.js 內部ERP＋司機APP → 減80%行政時間、無紙化"),
    ("ok", "大型生活百貨：程式碼優化＋MySQL重構＋AWS遷移 → 載入快300%、促銷零當機"),
    ("ok", "跨國加密支付平台：多鏈EVM整合＋Solidity合約 → 通過頂級資安審計、處理千萬級交易"),
    ("ok", "跨國律師樓：私有LLM全託管（NDA資料不出境）→ 合約審閱減70%"),
    ("warn", "注意：以上為「技術描述」，因NDA無法核實客戶名稱"),
], top=Inches(1.9), size=13)

header(prs.slides.add_slide(BLANK), "① Topone — 詳細背景", "IT外判老字號 · 香港本地 · SLA明確", section=True)
bullets(prs.slides[-1], [
    ("head", "基本資料"),
    "公司名稱：Topone Information Technology Limited",
    "成立：2005年（21年歷史，資歷最深）· 員工人數：約7人（LinkedIn）",
    "總部：上環德輔道西246號東慈商業中心16樓1606室（2個香港辦公室）",
    "定位：香港中小企的「延伸IT部門」，做託管式IT服務／外判IT支援",
    "模式：月費制＋按設備報價，有免費試用",
    ("head", "客戶／案例"),
    "英國跨國企業亞洲部署（香港＋日韓泰星5地）、專業服務公司全託管、製造業備份強化、SBS 2008現代化遷移、大學（Oxford HK）、註冊店舖等",
    ("head", "客戶真實心聲"),
    "「問題往往在用戶察覺前已解決」— 多個客戶強調「quiet and predictable」",
    "「TopOne與我們建立6年關係，會繼續合作」— Regal World Transport",
    "「這是我哋第一百次轉IT公司，終於搵到間好嘅」— Greka China",
    ("warn", "客戶多為辦公室IT／網絡／備份，唔係網站開發／Node.js／Docker"),
], top=Inches(1.9), size=13)

# ==================== 6大評估準則評分 ====================
header(prs.slides.add_slide(BLANK), "⑤ 長遠規劃路線圖", "診所預約系統由而家到5年", section=True)
table_slide(prs.slides[-1],
    ["階段", "時間", "目標", "需要服務", "預算/月"],
    [
        ["上線", "0-6個月", "網站穩定運行＋資料安全", "伺服器安裝＋功能測試＋維護", "HK$3,000-8,000"],
        ["擴展", "6-18個月", "WhatsApp通知＋支付＋會員", "持續開發＋API整合＋SEO", "HK$5,000-15,000"],
        ["規模化", "18-36個月", "多分店＋病人增長＋自動擴展", "雲端架構升級＋監控＋數據分析", "HK$10,000-30,000"],
        ["AI升級", "3-5年", "AI問診／排班＋病人分析", "私有LLM＋大數據＋合規", "HK$20,000-80,000"],
    ],
    top=Inches(2.0),
    col_w=[Inches(1.6), Inches(1.9), Inches(3.6), Inches(3.7), Inches(2.6)])

header(prs.slides.add_slide(BLANK), "⑥ 6大評估準則 — 逐項評分", "滿分5分，越啱你越高分")
table_slide(prs.slides[-1],
    ["評估準則", "Visible One", "YSK Limited", "Topone"],
    [
        ["技術匹配（Node.js/Docker）", "2.5／5", "5／5", "2／5"],
        ["成本（越平越高）", "3／5", "3／5", "5／5"],
        ["穩定性（歷史＋規模）", "5／5", "3／5", "4／5"],
        ["私隱合規（PDPO經驗）", "4／5", "4／5", "4／5"],
        ["擴展性（長遠功能）", "5／5", "5／5", "3／5"],
        ["售後（SLA／支援）", "3／5", "3／5", "5／5"],
        ["總分（/30）", "22.5", "23", "23"],
    ],
    top=Inches(2.0),
    col_w=[Inches(3.6), Inches(3.2), Inches(3.2), Inches(3.2)])

header(prs.slides.add_slide(BLANK), "⑥ 評分明細解說", "點解咁樣打分")
bullets(prs.slides[-1], [
    ("head", "技術匹配（Node.js／Docker）"),
    ("ok", "YSK 明確支援 Node.js／React／Docker，5分"),
    ("warn", "Visible One 主攻 WordPress/Laravel/Drupal，Node.js未明確宣傳，2.5分"),
    ("warn", "Topone 主攻Windows伺服器／M365，無Node.js專長，2分"),
    ("head", "成本"),
    ("ok", "Topone＋自建測試最平，5分"),
    ("head", "穩定性"),
    ("ok", "Visible One 18年＋50-249人，5分；Topone 21年，4分；YSK新，3分"),
    ("head", "私隱合規"),
    ("warn", "三間均有醫療／大企業經驗，各4分；但診所必須另簽NDA"),
    ("head", "擴展性"),
    ("ok", "YSK 有私有LLM（AI升級路）、Visible One 有全套營銷，各5分"),
    ("head", "售後／SLA"),
    ("ok", "Topone 明確SLA（30分鐘-2小時回應），5分"),
    ("head", "總結：三間總分相近（22.5-23），關鍵在「技術匹配＋長遠路線」"),
], top=Inches(1.9), size=14)

# ==================== 成本 + ROI ====================
header(prs.slides.add_slide(BLANK), "⑦ 5年累計成本比較（表）", "總擁有成本（TCO）", section=True)
table_slide(prs.slides[-1],
    ["年份", "Visible One", "YSK（標準）", "Topone(5台)+測試"],
    [
        ["第1年", "~HK$80,000", "HK$72,000", "~HK$21,000"],
        ["第2年", "~HK$40,000", "HK$72,000", "~HK$21,000"],
        ["第3年", "~HK$40,000", "HK$72,000", "~HK$21,000"],
        ["第4年", "~HK$40,000", "HK$72,000", "~HK$21,000"],
        ["第5年", "~HK$40,000", "HK$72,000", "~HK$21,000"],
        ["5年總計", "~HK$240,000", "HK$360,000", "~HK$105,000"],
    ],
    top=Inches(2.0),
    col_w=[Inches(2.6), Inches(3.4), Inches(3.4), Inches(3.4)])
bullets(prs.slides.add_slide(BLANK), [
    ("head", "ROI 分析 —— 點解要投資呢個系統？"),
    ("ok", "假設：診所靠電話／人手預約，每月流失 20 個病人（每個值 HK$800 初診）＝ 每月損失 HK$16,000"),
    ("ok", "網上預約系統：減少流失 50%＝每月多賺 HK$8,000"),
    ("ok", "＋WhatsApp提醒：減少「No-show」（失約）30%，每場空檔值錢"),
    ("ok", "＋自動化行政：護士慳 5 小時/週（時薪 HK$120×4週×5h＝HK$2,400/月）"),
    ("head", "所以每月收益約 HK$10,000-15,000 vs 成本 $870-$6,000"),
    ("ok", "Topone（$870/月）ROI ≈ 11-17倍 · YSK（$6,000/月）ROI ≈ 1.7-2.5倍"),
    ("warn", "即係話：就算揀最貴嘅 YSK，系統都能自己「回本」，所以成本唔應該係唯一考慮"),
    ("code", "真正決定因素係：邊間能最穩地支援你「長遠技術路線」"),
], top=Inches(1.9), size=14)

# ==================== 最終決策 ====================
header(prs.slides.add_slide(BLANK), "最終推薦 —— 俾老細嘅結論", "結合背景＋評分＋成本＋ROI")
bullets(prs.slides[-1], [
    ("head", "最適合 booking-aurora（診所預約）嘅係：YSK Limited"),
    ("ok", "原因1：技術棧最Match（Node.js／React／Docker）→ 部署最順、Bug最快fix"),
    ("ok", "原因2：包美國VPS＋20條技術支援/月 → 伺服器＋維護一齊搞掂"),
    ("ok", "原因3：有私有LLM業務（年費$88,000起）→ 診所長遠做AI問診／智能排班唔使換公司"),
    ("ok", "原因4：有醫療級NDA保密經驗（律師樓／醫療案例）→ 病人資料安全"),
    ("warn", "次要考量：公司較新（2019），需留意合約寫明「源碼＋伺服器權限全歸你」"),
    ("head", "備選：如果老細重視「老字號＋一條龍營銷」→ 揀Visible One（18年，有醫療案例）"),
    ("head", "備選：如果只係想「最平＋本地IT支援」→ 揀Topone（21年，SLA明確）"),
], top=Inches(1.9), size=14)

header(prs.slides.add_slide(BLANK), "決策時間線 —— 老細落決定用", "跟住做，7日內搞掂")
bullets(prs.slides[-1], [
    ("head", "第1-2日：索取報價"),
    ("ok", "YSK：ysk.hk 填表（講明Node.js＋Docker＋診所預約）"),
    ("ok", "Visible One：visibleone.com/quotation 揀「網站維護＋DevOps」"),
    ("ok", "Topone：topone.hk 申請2星期免費試用"),
    ("head", "第3-4日：篩選（問5條關鍵問題）"),
    ("ok", "① 你哋有冇做過 Node.js＋Docker 項目？（要睇實例）"),
    ("ok", "② 病人資料點樣加密備份＋離站存放？（PDPO）"),
    ("ok", "③ 源碼同伺服器管理權限係咪100%歸我？"),
    ("ok", "④ 出事幾耐回應？有冇SLA寫明？"),
    ("ok", "⑤ 長遠做AI／多分店，你哋支援到邊一步？"),
    ("head", "第5-6日：比價＋計5年總成本"),
    ("head", "第7日：簽約（記得寫入：源碼歸屬＋SLA＋NDA＋數據所有者）"),
], top=Inches(1.9), size=14)

# 光譜擴闊：唔止「大牌子」 — 專做診所/平價/雲端SaaS
header(prs.slides.add_slide(BLANK), "擴闊選擇：市場上仲有咩？", "除咗 Visible One／YSK／Topone，仲有三類更相關", section=True)
bullets(prs.slides[-1], [
    ("head", "你而家已經有 booking-aurora（Node.js 客製預約系統）"),
    ("warn", "所以揀公司之前要先決定："),
    ("ok", "路線 A：保留你套系統 → 搵公司「部署＋維護」（頭先見嘅公司）"),
    ("ok", "路線 B：改用現成診所 SaaS 平台 → 零開發、超平，但放棄你套客製系統"),
    ("head", "今次擴闊睇埋："),
    "① 專做診所／醫療網站＋預約嘅公司（HK Web Design、iDeasTime、HKINT）",
    "② 現成診所管理 SaaS（BW System、Scribo、ClinicX、Medicloud）",
    "③ 平價網站公司（LeadAdds、千帆）",
], top=Inches(1.9), size=15)

# 路線 A：診所網站公司
header(prs.slides.add_slide(BLANK), "① 專做診所／醫療網站＋預約嘅公司", "路線A：接手你套系統或由零做")
table_slide(prs.slides[-1],
    ["公司", "價錢", "特點", "適合你？"],
    [
        ["HK Web Design", "需報價", "預約＋病歷＋會員系統、醫療SEO、WhatsApp CTA、懂醫務廣告合規", "高（專做診所）"],
        ["iDeasTime", "HK$6,000起（一次過）", "診所方案、AI工作流、7-14日交付、源碼100%歸你、保養$100/月", "高"],
        ["HKINT", "HK$4,800起", "進階方案內建預約報名＋自動確認電郵、源碼歸你、無隱藏費", "高"],
        ["Adaptive", "需報價", "23年經驗、ERP/醫療行業管理系統", "中"],
        ["GTS", "需報價", "HMS/HIS醫院級系統、AI輔助、專做高端", "低（診所可能過大）"],
    ],
    top=Inches(2.0),
    col_w=[Inches(2.6), Inches(3.0), Inches(5.4), Inches(2.4)])

# 路線 B：診所 SaaS
header(prs.slides.add_slide(BLANK), "② 現成診所管理 SaaS 平台", "路線B：零開發、超平，但放棄客製系統")
table_slide(prs.slides[-1],
    ["平台", "月費", "特點", "風險"],
    [
        ["BW System", "HK$799 起", "診所AI管理、智能預約、QR碼、AI客服", "要遷移資料、非客製"],
        ["Scribo Clinic", "HK$650（年付$625）", "預約＋收費＋庫存、最多6用戶", "要遷移資料"],
        ["Medicloud（中醫）", "HK$500（首3月免費）", "AI中醫系統、預約＋病歷＋處方", "限中醫"],
        ["ClinicX", "年費制（需詢價）", "雲端、WhatsApp提示、開放API", "要詢價"],
        ["域加科技 醫健約", "需詢價", "已合作過百間香港醫療機構、小程式＋微信＋跨境", "平台代運營"],
        ["ebixPRO", "HK$228起", "預約系統、多渠道通知、14日免費試用", "一般預約"],
        ["Fletrix", "HK$3,000-5,000起", "AI排班、會員積分、多渠道預約", "力度較大"],
    ],
    top=Inches(2.0),
    col_w=[Inches(2.6), Inches(2.8), Inches(4.4), Inches(3.4)])

# 路線 C：平價網站
header(prs.slides.add_slide(BLANK), "③ 平價網站公司", "純做網站，預約可能要加購")
bullets(prs.slides[-1], [
    ("head", "如果只係需要一個靚官網（預約用返你套系統/外鏈）"),
    ("ok", "LeadAdds：HK$3,800起，7日交付，第二年維護$1,200/年，源碼100%歸你"),
    ("ok", "千帆網頁設計：HK$4,200起，有「醫務診所推廣計劃」（含WhatsApp即時預約、醫生資歷展示）"),
    ("warn", "注意：佢哋多數「Link走」你個客製系統，或者用基本表單，唔係真正嘅預約後台"),
    ("head", "如果只係平面+前端，而我想保留 booking-aurora 後台"),
    ("ok", "可以：千帆／LeadAdds 做前台網頁 → 你套 Node.js 系統做預約後台 → 兩者整合"),
    ("warn", "但咁樣通常要額外畀「整合費」，可能要問清楚"),
], top=Inches(1.9), size=15)

# 三條路比較
header(prs.slides.add_slide(BLANK), "三條路點揀？（俾老細）", "以你而家已有 booking-aurora 為前提")
table_slide(prs.slides[-1],
    ["考量", "路線A：用返套系統+部署公司", "路線B：改用診所SaaS", "路線C：平價網站+整合"],
    [
        ["時間", "快（你已有系統）", "最快（即開即用）", "中"],
        ["成本", "中（HK$3,000-12,000/月）", "低（HK$228-799/月）", "低（HK$3,800起）+整合費"],
        ["客製度", "高（你套系統）", "低（用平台功能）", "中（前台+後台整合）"],
        ["資料主權", "100%歸你", "存喺平台", "視乎整合"],
        ["長遠AI", "可升級（YSK等）", "視乎平台（醫健約有）", "不保證"],
        ["私隱PDPO", "可控制", "靠平台", "可控制"],
        ["最適合", "重視客製＋長遠發展", "想最快最平上線", "只想靚官網"],
    ],
    top=Inches(2.0),
    col_w=[Inches(2.2), Inches(3.8), Inches(3.8), Inches(3.8)])

header(prs.slides.add_slide(BLANK), "最終建議 — 成個市場一覽", "唔止大牌子，揀啱你定位")
bullets(prs.slides[-1], [
    ("head", "如果你要最省心＋最快上線 + 成本最平（老闆最關心）"),
    ("ok", "▶ 考慮診所 SaaS：BW System（$799/月）或 Scribo（$650/月），零開發、包伺服器＋維護＋測試"),
    ("head", "如果你重視控制權＋已有嘅 booking-aurora 系統"),
    ("ok", "▶ 路線 A：YSK（技術最Match）／ HK Web Design（專做診所）／ iDeasTime（平價+源碼歸你）"),
    ("head", "如果你想一步到位：靚官網＋預約＋推廣一條龍"),
    ("ok", "▶ 千帆「醫務診所推廣計劃」或 HK Web Design（含醫療SEO）"),
    ("warn", "最划算做法：前台網站（千帆/LeadAdds 平價）＋ 你套 Node.js 後台（部署＋測試）＋ 診所SaaS補位"),
    ("code", "總之：唔使一定揀「大牌子」，有好多專做診所嘅又平又貼地選項"),
], top=Inches(1.9), size=15)

prs.save("booking-aurora_公司比較_FINAL.pptx")
print("saved FINAL with", len(prs.slides._sldIdLst), "slides")