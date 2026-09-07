# -*- coding: utf-8 -*-
"""香港明碼實價 網頁/IT 公司對比 — 針對 booking-aurora（診所預約系統）"""
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

ACCENT = RGBColor(0x10, 0x4B, 0x4A)
ACCENT2 = RGBColor(0x0F, 0x76, 0x6E)
DARK = RGBColor(0x1A, 0x2B, 0x2A)
LIGHT = RGBColor(0xF2, 0xF7, 0xF6)
GREY = RGBColor(0x55, 0x5F, 0x5E)
WARN = RGBColor(0xC0, 0x39, 0x2B)
OK = RGBColor(0x1E, 0x8A, 0x4E)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
GOLD = RGBColor(0xC9, 0xA2, 0x6B)
ORANGE = RGBColor(0xFF, 0xAE, 0x00)
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


def band(slide, color=ACCENT, h=Inches(1.1), top=0):
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, top, prs.slide_width, h)
    shp.fill.solid(); shp.fill.fore_color.rgb = color
    shp.line.fill.background(); shp.shadow.inherit = False
    return shp


def textbox(slide, l, t, w, h, anchor=MSO_ANCHOR.TOP):
    tb = slide.shapes.add_textbox(l, t, w, h)
    tf = tb.text_frame; tf.word_wrap = True; tf.vertical_anchor = anchor
    return tb, tf


def para(tf, text, size=16, bold=False, color=DARK, align=PP_ALIGN.LEFT,
         space_after=6, first=False):
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    p.alignment = align; p.space_after = Pt(space_after)
    r = p.add_run(); r.text = text; _set_font(r, FONT, size, bold, color)
    return p


def round_card(slide, x, y, w, h, fill=WHITE, line=ACCENT, line_w=1.25):
    shp = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h)
    shp.fill.solid(); shp.fill.fore_color.rgb = fill
    shp.line.color.rgb = line; shp.line.width = Pt(line_w)
    shp.shadow.inherit = False
    return shp


def cover(title, subtitle, tagline):
    s = prs.slides.add_slide(BLANK); add_bg(s, DARK)
    bar = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, Inches(3.05), prs.slide_width, Inches(0.09))
    bar.fill.solid(); bar.fill.fore_color.rgb = ACCENT2; bar.line.fill.background(); bar.shadow.inherit = False
    tb, tf = textbox(s, Inches(0.8), Inches(2.0), Inches(11.7), Inches(1.2), MSO_ANCHOR.MIDDLE)
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); r.text = title; _set_font(r, FONT, 38, True, WHITE)
    tb2, tf2 = textbox(s, Inches(0.8), Inches(3.35), Inches(11.7), Inches(1.0), MSO_ANCHOR.TOP)
    p2 = tf2.paragraphs[0]; p2.alignment = PP_ALIGN.CENTER
    r2 = p2.add_run(); r2.text = subtitle; _set_font(r2, FONT, 19, False, RGBColor(0xBF, 0xE3, 0xDF))
    tb3, tf3 = textbox(s, Inches(1.5), Inches(4.6), Inches(10.3), Inches(1.5), MSO_ANCHOR.TOP)
    p3 = tf3.paragraphs[0]; p3.alignment = PP_ALIGN.CENTER
    r3 = p3.add_run(); r3.text = tagline; _set_font(r3, FONT, 15, False, RGBColor(0xBF, 0xE3, 0xDF))
    foot, foot_tf = textbox(s, Inches(0.8), Inches(6.6), Inches(11.7), Inches(0.5))
    pf = foot_tf.paragraphs[0]; pf.alignment = PP_ALIGN.CENTER
    rf = pf.add_run(); rf.text = "booking-aurora（診所預約系統）· 明碼實價公司比較"
    _set_font(rf, FONT, 14, False, RGBColor(0x8F, 0xB8, 0xB4))
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
    bb, bf = textbox(slide, Inches(0.7), top, Inches(11.9), Inches(7.5) - top - Inches(0.3))
    first = True
    for item in items:
        txt = item; color = DARK; bold = False
        if isinstance(item, tuple):
            kind, txt = item
            if kind == 'head': bold = True; color = ACCENT2
            elif kind == 'ok': color = OK
            elif kind == 'warn': color = WARN
        bullet = "▸ " if not bold else ""
        p = bf.paragraphs[0] if first else bf.add_paragraph(); first = False
        p.space_after = Pt(gap)
        r = p.add_run(); r.text = bullet + txt
        _set_font(r, FONT, size, bold, color)


def table_slide(slide, headers, rows, top=Inches(1.9), col_w=None, hsize=13.5):
    n = len(headers); width = prs.slide_width - Inches(1.0)
    if col_w is None: col_w = [width / n] * n
    rows_n = len(rows) + 1; tbl_h = Inches(0.5) * rows_n
    if tbl_h > Inches(6.2): tbl_h = Inches(6.2)
    gtbl = slide.shapes.add_table(rows_n, n, Inches(0.5), top, width, tbl_h)
    table = gtbl.table
    for i, w in enumerate(col_w): table.columns[i].width = w
    for j, htxt in enumerate(headers):
        cell = table.cell(0, j); cell.fill.solid(); cell.fill.fore_color.rgb = ACCENT
        cell.vertical_anchor = MSO_ANCHOR.MIDDLE; tf = cell.text_frame; tf.word_wrap = True
        p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER if j > 0 else PP_ALIGN.LEFT
        r = p.add_run(); r.text = htxt; _set_font(r, FONT, hsize, True, WHITE)
    for i, row in enumerate(rows, start=1):
        for j, val in enumerate(row):
            cell = table.cell(i, j); cell.fill.solid()
            cell.fill.fore_color.rgb = WHITE if i % 2 else LIGHT
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE; tf = cell.text_frame; tf.word_wrap = True
            p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER if j > 0 else PP_ALIGN.LEFT
            r = p.add_run(); r.text = val; _set_font(r, FONT, 12, False, DARK)


def two_col(slide, left_title, left_items, right_title, right_items, top=Inches(1.95),
            lt=OK, rt=WARN, h=4.9):
    lw = Inches(5.9); rw = Inches(5.9); lx = Inches(0.7); rx = Inches(6.75)
    def col(x, w, ctitle, citems, ccolor):
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, top, w, Inches(h))
        card.fill.solid(); card.fill.fore_color.rgb = WHITE
        card.line.color.rgb = ccolor; card.line.width = Pt(1.5); card.shadow.inherit = False
        tb, tf = textbox(slide, x + Inches(0.25), top + Inches(0.15), w - Inches(0.5), Inches(0.5))
        p = tf.paragraphs[0]; r = p.add_run(); r.text = ctitle; _set_font(r, FONT, 18, True, ccolor)
        bb, bf = textbox(slide, x + Inches(0.25), top + Inches(0.7), w - Inches(0.5), Inches(h - 0.8))
        f = True
        for it in citems:
            pp = bf.paragraphs[0] if f else bf.add_paragraph(); f = False
            pp.space_after = Pt(7); rr = pp.add_run(); rr.text = "• " + it
            _set_font(rr, FONT, 14, False, DARK)
    col(lx, lw, left_title, left_items, lt)
    col(rx, rw, right_title, right_items, rt)


def firm_card(slide, x, y, w, h, name, tag, price_items, extra="", pcolor=OK):
    round_card(slide, x, y, w, h, fill=WHITE, line=pcolor, line_w=1.5)
    tb, tf = textbox(slide, x + Inches(0.25), y + Inches(0.15), w - Inches(0.5), Inches(0.5))
    p = tf.paragraphs[0]; r = p.add_run(); r.text = name; _set_font(r, FONT, 18, True, pcolor)
    tb2, tf2 = textbox(slide, x + Inches(0.25), y + Inches(0.62), w - Inches(0.5), Inches(0.4))
    p2 = tf2.paragraphs[0]; r2 = p2.add_run(); r2.text = tag; _set_font(r2, FONT, 12.5, False, GREY)
    yy = y + Inches(1.05)
    for price, label in price_items:
        tb3, tf3 = textbox(slide, x + Inches(0.25), yy, w - Inches(0.5), Inches(0.4))
        pr = tf3.add_paragraph(); pr.text = price + "  "; 
        rr = pr.runs[0]; _set_font(rr, FONT, 15, True, pcolor)
        rr2 = pr.add_run(); rr2.text = label; _set_font(rr2, FONT, 12.5, False, DARK)
        yy += Inches(0.42)
    tb4, tf4 = textbox(slide, x + Inches(0.25), yy + Inches(0.05), w - Inches(0.5), h - (yy - y) - Inches(0.15))
    pp = tf4.add_paragraph(); rr3 = pp.add_run(); rr3.text = extra; _set_font(rr3, FONT, 11.5, False, GREY)


# ==================== SLIDES ====================

cover("香港「明碼實價」公司比較",
      "網頁設計 · IT 外判 · 網站維護\n針對 booking-aurora（診所預約系統）",
      "有啲公司嘅價錢唔透明，要逐個報價又樣樣計（似 Visible One）\n呢份整理咗香港有「公開價錢 / 月費 / 套餐制」嘅公司\n由建站、部署、維護到長期支援一次睇晒")

header(prs.slides.add_slide(BLANK), "點解要揀「明碼實價」公司？", "避免報價陷阱", section=True)
bullets(prs.slides[-1], [
    ("head", "Visible One 嘅問題"),
    ("warn", "最低 US$5,000（~HK$39,000）起，好似好合理，但要 submit 表格先知實價"),
    ("warn", "網站 / DevOps / 雲端 / IT 方案全部「按項目報價」，冇公開月費方案"),
    ("warn", "服務散件計：域名、寄存、SSL、維護、修改可能樣樣另計"),
    ("head", "明碼實價公司嘅好處"),
    ("ok", "白紙黑字列出套餐價，一開頭就知要俾幾多"),
    ("ok", "標明「無隱藏收費」，風險低好多"),
    ("ok", "月費制容易預算，長期成本一目了然"),
    ("ok", "好多包埋域名 / 寄存 / SSL / 基礎維護，唔使逐項湊"),
], top=Inches(1.9), size=15)

# ====== 一覽表 ======
header(prs.slides.add_slide(BLANK), "明碼實價公司一覽", "網站設計 / 建站套餐（一次過收費）")
table_slide(prs.slides[-1],
    ["公司", "套餐價", "頁數 / 內容", "包含", "適合"],
    [
        ["HKINT", "$4,800 / $6,800 / $9,800", "1-5 / 1-10 / 1-20 頁", "域名+寄存+SSL+電郵+基礎SEO", "中小企官網"],
        ["LeadAdds / 加熱業務", "$3,800 起", "1 頁 / 多頁", "設計+SEO+表單+域名+主機+SSL首年", "最平建站"],
        ["iDeasTime", "$6,000 起", "一頁 / 多頁 / 網店", "1 年雲端 Hosting+SEO+免費修改", "平價建站"],
        ["FlowDigital", "$6,800 / $12,800 / $17,800", "2 / 6 / 10 頁", "後台 CMS+雲端寄存+維護備份", "企業官網"],
        ["INOVA", "$5,980 / $12,500", "1 頁 / 5 頁", "全包+免費主機 1 年", "品牌網站"],
        ["WebKing", "$1,999 – $28,800", "1–18 頁×多語", "WYSIWYG 後台+寄存", "預算彈性"],
        ["Linking IT", "$3,800 / $5,800 / $8,800", "6 / 10 / 15 頁", "寄存+電郵+SEO+Google地圖", "標準官網"],
        ["慎思設計 isualsense", "$4,800 / $9,800 / $29,800+", "1 / 5 / 10+ 頁", "全包+隱藏無收費", "企業/電商"],
    ],
    top=Inches(1.85), col_w=[Inches(2.4), Inches(3.1), Inches(2.6), Inches(3.3), Inches(1.9)])

header(prs.slides.add_slide(BLANK), "長期維護 / 月費制公司", "網站設計套餐之外，仲有月費支援")
table_slide(prs.slides[-1],
    ["公司", "收費模式", "月費/年費", "包含", "適合"],
    [
        ["YSK Limited", "月費制", "$2,000 / $6,000 / $12,000 每月", "開發+1 部美國 VPS+技術支援+App 上架", "開發+部署一條龍"],
        ["點止網站 itdot", "月費維護", "$298 / $498 / $698 每月", "WordPress 保養+管理", "WordPress 站維護"],
        ["INOVA 包月", "月費設計", "$5,800 – $13,800 / 月", "整個設計+Marketing 部門", "長期設計支援"],
        ["千帆 kevinwebdesign", "年費/月費", "$4,200 起（計劃）、寄存 $360/年", "網站推廣+寄存", "服務業/診所"],
        ["Topone", "按設備月費", "$100–150/設備/月（最低$1,000/月）", "IT 支援+伺服器管理+SLA", "IT 外判"],
    ],
    top=Inches(1.85), col_w=[Inches(2.6), Inches(1.7), Inches(3.1), Inches(3.6), Inches(2.3)])

# ====== 重點公司 ======
header(prs.slides.add_slide(BLANK), "重點公司①：HKINT", "最正路嘅「明碼實價」建站公司", section=False)
firm_card(prs.slides[-1], Inches(0.5), Inches(1.7), Inches(6.0), Inches(5.0), "HKINT",
    "香港網頁設計公司 · 透明收費無隱藏費用",
    [("HK$4,800", "基礎方案 · 1-5 頁全包"), ("HK$6,800", "標準方案 · 1-10 頁 · 加會員登入"),
     ("HK$9,800", "進階方案 · 1-20 頁 · 20 電郵")],
    "全包：域名 + 寄存 + SSL + 基礎 SEO + 中英雙語 + Blog + 社群整合 + WhatsApp 按鈕\n所有權 100% 歸客戶 · 首年免費維護，之後 $200/月起\n預約系統 / 數據庫對接屬客製，需獨立報價",
    pcolor=OK)
firm_card(prs.slides[-1], Inches(6.85), Inches(1.7), Inches(6.0), Inches(5.0), "LeadAdds（加熱業務）",
    "最快平價建站 · $3,800 起 7 日交",
    [("HK$3,800", "建站：7 頁 + 原創設計 + SEO + 表單首年全包"),
     ("HK$1,200/年", "第二年維護：域名+主機+SSL+更新+支援")],
    "第一批客戶最平，速度快（7 日）\nsource code 100% 歸客戶，唔續約都攞得返網站\n主打中小企，適合快速上線",
    pcolor=OK)

header(prs.slides.add_slide(BLANK), "重點公司②：iDeasTime + FlowDigital", "平價建站 + 維護無合約")
firm_card(prs.slides[-1], Inches(0.5), Inches(1.7), Inches(6.0), Inches(5.0), "iDeasTime",
    "HK$6,000 起 · 無合約綁定",
    [("HK$6,000 起", "一頁/多頁/網店 · 1 年免費雲端 Hosting + SEO"),
     ("HK$100/月", "第二年維護：Hosting+SSL+基本支援，可隨時取消")],
    "源碼 100% 歸客戶，唔鎖平台\n一頁式最快 3 日、多頁 7-14 日、網店約 14 日交付\n預約系統 / 文案等超出基礎版會另行報價",
    pcolor=OK)
firm_card(prs.slides[-1], Inches(6.85), Inches(1.7), Inches(6.0), Inches(5.0), "FlowDigital",
    "全透明報價 · 分級套餐",
    [("HK$6,800", "網上起動計劃 · 主頁+2 頁"), ("HK$12,800", "零煩惱計劃 · 主頁+6 頁+維護備份"),
     ("HK$17,800", "進階設計計劃 · 主頁+10 頁+後台")],
    "免費後台系統，隨時改資訊\n專業亞馬遜雲端網頁寄存 + 網頁維護及備份\n需客製化則另報",
    pcolor=OK)

header(prs.slides.add_slide(BLANK), "重點公司③：INOVA + WebKing", "包月設計 / 平價套餐")
firm_card(prs.slides[-1], Inches(0.5), Inches(1.7), Inches(6.0), Inches(5.0), "INOVA",
    "網站 + 包月設計服務",
    [("HK$5,980", "一頁式品牌網站 · 全包"), ("HK$12,500", "標準方案 · 5 頁"),
     ("HK$5,800/月起", "包月設計：騁請整個設計+Marketing 部門")],
    "免費主機 1 年 · 雙語 · 響應式\n包月制適合需要長期設計支援嘅品牌\n網店需個別報價",
    pcolor=OK)
firm_card(prs.slides[-1], Inches(6.85), Inches(1.7), Inches(6.0), Inches(5.0), "WebKing",
    "價錢分級最闊 · 由平到高",
    [("HK$1,999", "A 套餐 · 一頁式 3 格"), ("HK$3,980", "B 套餐 · 一頁式 6 格"),
     ("HK$5,800 / $8,800 / $12,800 / $28,800", "C-F 套餐 · 多頁或多語系")],
    "WYSIWYG 超簡易後台管理\n一頁式到 18 頁 × 3 語言都有標價\nWhatsApp 查詢另享優惠",
    pcolor=OK)

# ====== 系統/部署類（booking-aurora最相關）======
header(prs.slides.add_slide(BLANK), "網站設計 vs 系統開發", "分清兩類，揀啱先慳到錢", section=True)
two_col(prs.slides[-1],
    "網站設計公司（明碼實價）",
    ["打正「明碼實價」：建站/網店套餐、月費維護",
     "技術主導：WordPress / Shopify / 模板建站",
     "啱啲：企業官網、品牌宣傳、內容網站",
     "包埋：域名、寄存、SSL、基礎 SEO、後台",
     "⚠️ 預約系統 / 會員 / 資料庫通常要「另報價」",
     "⚠️ 好多唔熟 Node.js / Docker / 自訂開發"],
    "系統開發 + 部署公司（通常要報價）",
    ["做全端開發、API、資料庫、伺服器部署",
     "啱 booking-aurora：Node.js + SQLite + Docker",
     "有月費制 / 外判制：如 YSK $2,000/月起",
     "IT 外判：如 Topone 按設備計，包伺服器+SLA",
     "⚠️ 網站設計套餐未必涵蓋自訂系統開發",
     "⚠️ 系統公司通常唔會公開一口價套餐"],
    top=Inches(1.95), h=5.0)

header(prs.slides.add_slide(BLANK), "booking-aurora 最Match：YSK + Topone", "系統開發/部署/伺服器", section=True)
bullets(prs.slides[-1], [
    ("head", "YSK Limited（月費制 · 最透明嘅開發公司）"),
    ("ok", "$2,000 / $6,000 / $12,000 每月 · 價錢白紙黑字"),
    ("ok", "所有計劃包 1 部美國 VPS（伺服器免費）+ 技術支援"),
    ("ok", "Node.js / React / Python 全端支援 —— 最 match booking-aurora（Node.js）"),
    ("ok", "App Store / Google Play 上架包埋"),
    ("ok", "滿一年可拎返成套源碼"),
    ("warn", "一年合約起 · 只限遠端（無實體辦公室）"),
    ("head", "Topone（IT 外判 · 有 SLA）"),
    ("ok", "HK$100–150/設備/月（最低 $1,000/月）· 伺服器管理包 2 台"),
    ("ok", "明確 SLA：遙距 30 分–2 小時、上門 4 小時內"),
    ("ok", "2 星期免費試用 · 簽 1 年送 1 個月"),
    ("warn", "按設備數計費，基本計劃無伺服器管理"),
], top=Inches(1.85), size=14.5, gap=6)

# ====== 總比較 ======
header(prs.slides.add_slide(BLANK), "總比較：Visible One vs 明碼實價公司", "針對 booking-aurora")
table_slide(prs.slides[-1],
    ["公司", "價錢透明度", "最低消費", "伺服器/部署", "技術 Match", "合約"],
    [
        ["Visible One", "✗ 逐個報價", "US$5,000（~$39K）", "有（雲端/DevOps）", "WordPress/Laravel 為主", "按項目"],
        ["YSK Limited", "✓ 月費制", "$2,000/月", "包 1 部 VPS", "Node.js/React/Python ✓", "1 年"],
        ["HKINT", "✓ 套餐", "$4,800", "寄存包埋", "WordPress/自家CMS", "一次性"],
        ["LeadAdds", "✓ 套餐", "$3,800", "主機包首年", "模板/WordPress", "一次性"],
        ["iDeasTime", "✓ 套餐", "$6,000", "1 年雲端 Hosting", "一般響應式", "一次性"],
        ["Topone", "✓ 按設備", "$1,000/月", "伺服器管理", "IT 基建(非開發)", "1 年"],
    ],
    top=Inches(1.85), col_w=[Inches(2.0), Inches(2.2), Inches(2.3), Inches(2.4), Inches(2.7), Inches(1.7)])

# ====== 推薦 ======
header(prs.slides.add_slide(BLANK), "建議打法", "點樣最慳又穩陣")
bullets(prs.slides[-1], [
    ("head", "如果圖開發 + 部署一條龍（推薦）"),
    ("ok", "YSK 標準計劃 $6,000/月：Node.js 全端 + 1 部 VPS + 技術支援 + App 上架，最 match booking-aurora"),
    ("ok", "一年約 HK$72,000，含伺服器，性價比高，源碼最後歸你"),
    ("head", "如果只是想簡單建站 + 自己搞部署"),
    ("ok", "HKINT $4,800–9,800 或 iDeasTime $6,000：一次過平價網站，伺服器部署自己跟住 README-DEPLOY.md 做"),
    ("warn", "但要自己搞 Docker / Caddy / 備份，要啲技術"),
    ("head", "如果驚無人維護 + 想有人跟"),
    ("ok", "Topone $1,000–750/月：IT 外判 + 2 台伺服器管理 + SLA，出事有人上門"),
    ("head", "總結"),
    ("ok", "網站設計類（$3,800–9,800）明碼實價，但唔含自訂預約系統開發"),
    ("ok", "系統開發/部署類：YSK 月費最透明、Topone SLA 最穩，兩者都比 Visible One 明碼"),
    ("warn", "全部仍然建議簽約前要明確確認：源碼歸屬、修改次數、續費價、伺服器位置"),
], top=Inches(1.8), size=14.5, gap=6)

# 結尾
s = prs.slides.add_slide(BLANK); add_bg(s, DARK)
band(s, ACCENT2, Inches(0.09), Inches(3.15))
tb, tf = textbox(s, Inches(0.8), Inches(2.2), Inches(11.7), Inches(0.9), MSO_ANCHOR.MIDDLE)
p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
r = p.add_run(); r.text = "記住：平價建站 ≠ 包埋系統開發"; _set_font(r, FONT, 32, True, WHITE)
tb2, tf2 = textbox(s, Inches(1.5), Inches(3.5), Inches(10.3), Inches(1.2), MSO_ANCHOR.TOP)
p2 = tf2.paragraphs[0]; p2.alignment = PP_ALIGN.CENTER
r2 = p2.add_run()
r2.text = ("揀公司之前，先用另一張表諗清楚：你係要「建站形象」定「系統開發部署」？\n"
           "明碼實價嘅公司好多，但要間「識做 booking-aurora（Node.js/Docker）」嘅先啱使。")
_set_font(r2, FONT, 15, False, RGBColor(0xBF, 0xE3, 0xDF))
tb3, tf3 = textbox(s, Inches(2.0), Inches(5.2), Inches(9.3), Inches(1.4))
p3 = tf3.paragraphs[0]; p3.alignment = PP_ALIGN.CENTER
r3 = p3.add_run()
r3.text = "資料來源：各公司官方網站公開價格（HKINT、LeadAdds、iDeasTime、FlowDigital、INOVA、WebKing、YSK、Topone 等）\n資料截至 2026 年 · 實際以官方最新報價為準"
_set_font(r3, FONT, 12, False, RGBColor(0x8F, 0xB8, 0xB4))

out = r"C:\Users\Damian Fung\OneDrive\Desktop\JP\booking-aurora\香港明碼實價公司比較.pptx"
prs.save(out)
print("SAVED:", out, "slides:", len(prs.slides._sldIdLst))
