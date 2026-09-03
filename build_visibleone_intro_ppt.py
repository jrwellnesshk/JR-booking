# -*- coding: utf-8 -*-
"""Visible One 公司介紹 PPT — 含客戶 logo 圖片牆"""
import os
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

LOGO_DIR = r"C:\Users\DAMIAN~1\AppData\Local\Temp\opencode\vo_logos"

ACCENT = RGBColor(0x0B, 0x5E, 0x50)      # 深翠綠（官網主色）
ACCENT2 = RGBColor(0xFF, 0xAE, 0x00)     # 橙金（官網強調色）
DARK = RGBColor(0x16, 0x2B, 0x2A)
DARK2 = RGBColor(0x0A, 0x3A, 0x33)
LIGHT = RGBColor(0xF4, 0xF9, 0xF8)
GREY = RGBColor(0x5A, 0x6B, 0x69)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
ORANGE = RGBColor(0xFF, 0xAE, 0x00)
GREEN_SOFT = RGBColor(0xDF, 0xEF, 0xEC)
GOLD = RGBColor(0xC9, 0xA2, 0x6B)
FONT = "Microsoft JhengHei"

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


def band(slide, color=ACCENT, h=Inches(1.1), top=0):
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, top, prs.slide_width, h)
    shp.fill.solid()
    shp.fill.fore_color.rgb = color
    shp.line.fill.background()
    shp.shadow.inherit = False
    return shp


def whisker(slide, x, y, w=Inches(0.9), h=Inches(0.06), color=ACCENT2):
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, h)
    shp.fill.solid()
    shp.fill.fore_color.rgb = color
    shp.line.fill.background()
    shp.shadow.inherit = False
    return shp


def textbox(slide, l, t, w, h, anchor=MSO_ANCHOR.TOP):
    tb = slide.shapes.add_textbox(l, t, w, h)
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    return tb, tf


def para(tf, text, size=16, bold=False, color=DARK, align=PP_ALIGN.LEFT,
         space_after=6, first=False, font=FONT):
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    p.alignment = align
    p.space_after = Pt(space_after)
    r = p.add_run()
    r.text = text
    _set_font(r, font, size, bold, color)
    return p


def round_card(slide, x, y, w, h, fill=WHITE, line=ACCENT, line_w=1.25):
    shp = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h)
    shp.fill.solid()
    shp.fill.fore_color.rgb = fill
    shp.line.color.rgb = line
    shp.line.width = Pt(line_w)
    shp.shadow.inherit = False
    return shp


def add_pic_fit(slide, path, cx, cy, max_w, max_h):
    from PIL import Image
    im = Image.open(path)
    w, h = im.size
    ratio_w = max_w / w
    ratio_h = max_h / h
    scale = min(ratio_w, ratio_h)
    pw = int(w * scale)
    ph = int(h * scale)
    left = int(cx - pw / 2)
    top = int(cy - ph / 2)
    slide.shapes.add_picture(path, left, top, pw, ph)


def cover(title, subtitle, tagline):
    s = prs.slides.add_slide(BLANK)
    add_bg(s, DARK2)
    # decorative circles
    c = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(-1.5), Inches(-2), Inches(5), Inches(5))
    c.fill.solid(); c.fill.fore_color.rgb = RGBColor(0x0E, 0x4E, 0x44); c.line.fill.background(); c.shadow.inherit = False
    c2 = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(10.5), Inches(4.5), Inches(5), Inches(5))
    c2.fill.solid(); c2.fill.fore_color.rgb = RGBColor(0x0E, 0x4E, 0x44); c2.line.fill.background(); c2.shadow.inherit = False
    band(s, ACCENT2, Inches(0.1), Inches(3.15))
    tb, tf = textbox(s, Inches(0.8), Inches(2.0), Inches(11.7), Inches(1.1), MSO_ANCHOR.MIDDLE)
    para(tf, title, 44, True, WHITE, PP_ALIGN.CENTER, first=True)
    tb2, tf2 = textbox(s, Inches(0.8), Inches(3.45), Inches(11.7), Inches(0.9), MSO_ANCHOR.MIDDLE)
    para(tf2, subtitle, 20, False, ACCENT2, PP_ALIGN.CENTER, first=True)
    tb3, tf3 = textbox(s, Inches(1.5), Inches(4.6), Inches(10.3), Inches(1.6), MSO_ANCHOR.TOP)
    para(tf3, tagline, 15, False, RGBColor(0xBF, 0xDD, 0xD8), PP_ALIGN.CENTER, space_after=4, first=True)
    foot, foot_tf = textbox(s, Inches(0.8), Inches(6.7), Inches(11.7), Inches(0.5))
    para(foot_tf, "2026 · 公司簡介", 13, False, RGBColor(0x8F, 0xB8, 0xB4), PP_ALIGN.CENTER, first=True)
    return s


def header(slide, title, subtitle=None, section=False):
    add_bg(slide, WHITE)
    band(slide, ACCENT if not section else DARK2, Inches(1.0))
    tb, tf = textbox(slide, Inches(0.55), Inches(0.08), Inches(12.2), Inches(0.85), MSO_ANCHOR.MIDDLE)
    para(tf, title, 27 if not section else 30, True, WHITE, first=True)
    if subtitle:
        stb, stf = textbox(slide, Inches(0.55), Inches(1.12), Inches(12.2), Inches(0.5))
        para(stf, subtitle, 14.5, False, GREY, first=True)


def bullets(slide, items, top=Inches(1.75), size=16, gap=8, w=Inches(12.2)):
    bb, bf = textbox(slide, Inches(0.55), top, w, Inches(7.5) - top - Inches(0.3))
    first = True
    for item in items:
        txt = item; color = DARK; bold = False
        if isinstance(item, tuple):
            kind, txt = item[0], item[1]
            if kind == 'head': bold = True; color = ACCENT
            elif kind == 'ok': color = RGBColor(0x1E, 0x8A, 0x4E)
            elif kind == 'warn': color = RGBColor(0xB5, 0x6A, 0x00)
            elif kind == 'accent': color = ACCENT2
        bullet = "▸ " if not bold else ""
        p = bf.paragraphs[0] if first else bf.add_paragraph()
        first = False
        p.space_after = Pt(gap)
        r = p.add_run(); r.text = bullet + txt
        _set_font(r, FONT, size, bold, color)


def stat_card(slide, x, y, w, h, number, label, color=ACCENT):
    round_card(slide, x, y, w, h, fill=GREEN_SOFT, line=ACCENT, line_w=1.0)
    tb, tf = textbox(slide, x + Inches(0.1), y + Inches(0.2), w - Inches(0.2), h * 0.55, MSO_ANCHOR.BOTTOM)
    para(tf, number, 30, True, color, PP_ALIGN.CENTER, first=True)
    tb2, tf2 = textbox(slide, x + Inches(0.1), y + h * 0.6, w - Inches(0.2), h * 0.35, MSO_ANCHOR.TOP)
    para(tf2, label, 12.5, False, GREY, PP_ALIGN.CENTER, first=True)


def logo_grid(slide, names, x0, y0, per_row, box_w, box_h, gap=0.18):
    names = [n for n in names]
    for idx, name in enumerate(names):
        path = os.path.join(LOGO_DIR, name + ".png")
        if not os.path.exists(path):
            continue
        row = idx // per_row
        col = idx % per_row
        cx = int(x0 + col * (box_w + gap) + box_w / 2)
        cy = int(y0 + row * (box_h + gap) + box_h / 2)
        add_pic_fit(slide, path, cx, cy, int(box_w * 0.85), int(box_h * 0.7))


print("COVER")
cover("Visible One",
      "網站設計 · 數碼營銷 · IT 方案公司",
      "2008 年喺香港成立嘅數碼代理商\n由設計、開發到數碼營銷，提供一站式網上解決方案\n服務多間上市公司、大學、醫療機構與國際品牌")

# ============ 公司概覽 ============
header(prs.slides.add_slide(BLANK), "公司概覽", "一目了然 · 基本資料", section=True)
add_bg(prs.slides[-1], WHITE)
s = prs.slides[-1]
# stats
stat_card(s, Inches(0.5), Inches(1.7), Inches(2.95), Inches(1.5), "2008", "成立年份")
stat_card(s, Inches(3.75), Inches(1.7), Inches(2.95), Inches(1.5), "18+", "年行業經驗")
stat_card(s, Inches(7.0), Inches(1.7), Inches(2.95), Inches(1.5), "19", "位員工人數")
stat_card(s, Inches(10.25), Inches(1.7), Inches(2.95), Inches(1.5), "6國", "業務分佈（HK/SG 等）")
# info card
round_card(s, Inches(0.5), Inches(3.5), Inches(12.3), Inches(1.65), fill=LIGHT, line=ACCENT, line_w=1.0)
tb, tf = textbox(s, Inches(0.8), Inches(3.68), Inches(11.8), Inches(1.4))
para(tf, "公司資料", 15, True, ACCENT, space_after=6, first=True)
para(tf, "公司名稱：Visible One Limited（晫高科技有限公司）", 14.5, False, DARK, space_after=4)
para(tf, "總部：香港新界葵涌葵興路 29–37 號興明工業大廈 8 字樓 B2 室  ·  於新加坡設有辦公室", 14.5, False, DARK, space_after=4)
para(tf, "電話：(852) 2127 0101  ·  電郵：info@visibleone.com.hk  ·  網站：visibleone.com", 14.5, False, DARK, space_after=4)
bullets(s, [
    ("head", "一句話定位"),
    "香港領先嘅網頁設計與網站開發公司，專注網站、電子商務、本地 SEO 同數碼營銷。",
    ("head", "公司使命"),
    "用數碼營銷方式，幫大小企業喺網上建立品牌、提升銷售同效能。",
], top=Inches(5.35), size=14.5, gap=5)

# ============ 歷史與規模 ============
header(prs.slides.add_slide(BLANK), "發展歷程與規模")
bullets(prs.slides[-1], [
    ("head", "發展歷程"),
    ("ok", "2008 年：喺香港成立，主力網站設計與開發"),
    ("ok", "2015 年：正式註冊為有限責任公司（Visible One Limited）"),
    ("ok", "持續擴充：由香港延伸至新加坡（SG）、馬來西亞（MY）、緬甸（MM）等多個市場"),
    ("ok", "成為多個國際平台嘅認證合作夥伴（HubSpot、Google、Shopify、AWS、Microsoft 等）"),
    ("head", "團隊與規模"),
    "約 19 名員工，設計師、開發者、SEO 專員同內容策劃喺同一屋檐下，項目由簡介到上線無縫過渡。",
    "服務由初創到上市公司；客戶平均與公司合作約 6 年。",
    ("head", "獎項與認證"),
    "獲 TechBehemoths 2025 全球大獎、Google Partner、HubSpot Solution Partner、香港數碼無障礙獎金獎等多項認證。",
], top=Inches(1.75), size=15, gap=9)

# ============ 核心服務總覽 ============
header(prs.slides.add_slide(BLANK), "核心服務總覽", "五大範疇 · 一站式網上解決方案")
s = prs.slides[-1]
cols = [
    ("網站設計", "自訂 UI/UX 設計、響應式設計、品牌導向、多語系", ACCENT),
    ("網站開發", "WordPress · Laravel · Drupal · React · ASP.NET · Python", ACCENT),
    ("電子商務", "Shopify · Magento · WooCommerce · BigCommerce · 自訂", ACCENT),
    ("數碼營銷", "SEO · Google Ads · Facebook/社交媒體 · Inbound", ACCENT),
    ("IT 方案", "HubSpot · Azure · Microsoft 365 · Staffcop · 雲端", ACCENT),
    ("創意互動", "360 虛擬導覽 · 影片製作 · 3CX 通訊方案", ACCENT),
]
cw = Inches(3.95); ch = Inches(2.35); gapx = Inches(0.26); gapy = Inches(0.26)
x0 = Inches(0.4); y0 = Inches(1.7)
for i, (t, desc, col) in enumerate(cols):
    r = i // 3; c = i % 3
    x = x0 + c * (cw + gapx); y = y0 + r * (ch + gapy)
    round_card(s, x, y, cw, ch, fill=GREEN_SOFT, line=col, line_w=1.2)
    bar = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, Inches(0.09), ch)
    bar.fill.solid(); bar.fill.fore_color.rgb = ACCENT2; bar.line.fill.background(); bar.shadow.inherit = False
    tb, tf = textbox(s, x + Inches(0.25), y + Inches(0.18), cw - Inches(0.4), Inches(0.5))
    para(tf, t, 18, True, col, first=True)
    tb2, tf2 = textbox(s, x + Inches(0.25), y + Inches(0.78), cw - Inches(0.4), ch - Inches(0.9))
    para(tf2, desc, 14, False, DARK, space_after=4, first=True)

# ============ 服務詳細：網站設計開發 ============
header(prs.slides.add_slide(BLANK), "網站設計 + 開發", "從簡介到上線 · 平台靈活")
s = prs.slides[-1]
two = [
    ("網站設計", [
        "UI / UX 設計：以用戶為本，提升轉換率",
        "響應式設計：手機、平板、桌面全支援",
        "品牌導向：深入了解你嘅品牌與行業",
        "多語系網站經驗豐富（中英日韓等）",
        "設計包埋 SEO 基礎同整合功能",
    ], ACCENT),
    ("網站開發", [
        "WordPress / Laravel / Drupal / Joomla",
        "PHP / ASP.NET / React.js / Python",
        "網絡應用程式與第三方系統整合",
        "內容管理系統（CMS）量身定制",
        "品質保證 + 效能優化 + 持續維護",
    ], ACCENT2),
]
for i, (t, items, col) in enumerate(two):
    x = Inches(0.5) if i == 0 else Inches(6.85)
    w = Inches(5.95); y = Inches(1.7); h = Inches(4.9)
    round_card(s, x, y, w, h, fill=LIGHT, line=col, line_w=1.4)
    tb, tf = textbox(s, x + Inches(0.25), y + Inches(0.15), w - Inches(0.5), Inches(0.5))
    para(tf, t, 18, True, col, first=True)
    bb, bf = textbox(s, x + Inches(0.25), y + Inches(0.7), w - Inches(0.5), h - Inches(0.8))
    for it in items:
        para(bf, "• " + it, 14.5, False, DARK, space_after=7, first=(it == items[0]))

# ============ 電子商務 ============
header(prs.slides.add_slide(BLANK), "電子商務方案", "高轉換率嘅網上商店")
bullets(prs.slides[-1], [
    ("head", "支援平台"),
    "Shopify · Magento · WooCommerce · BigCommerce · OSCommerce · 自訂開發",
    ("head", "做啲咩"),
    ("ok", "一站式嘅購物體驗設計：由響應式網頁到品牌電商"),
    ("ok", "第三方整合：付款、物流（Easyship）、ERP、社交平台串連"),
    ("ok", "會員積分系統、轉介計劃、社交媒體 API 自動更新內容"),
    ("ok", "託管、安全、備份同持續效能優化"),
    ("warn", "案例：Mori Jewellery 自訂 PHP/Laravel 電商網站，含積分、轉介、Instagram 整合同 Easyship 物流"),
], top=Inches(1.75), size=15, gap=9)

# ============ 數碼營銷 ============
header(prs.slides.add_slide(BLANK), "數碼營銷", "SEO + 廣告 + 內容，全方位觸達")
s = prs.slides[-1]
services = [
    ("Organic / Local SEO", "提升自然排名，本地搜索做得多啲生意入舖"),
    ("Google Ads（PPC）", "搜尋、展示廣告，精準投放提升回報"),
    ("Facebook / Meta 廣告", "社交媒體引流同互動"),
    ("Inbound Marketing", "HubSpot 驅動：內容 + 潛在客戶開發 + 客戶維繫"),
    ("Email / 社交媒體", "內容策略同電子郵件營銷，提高轉換率"),
]
x0 = Inches(0.5); y0 = Inches(1.7)
cw = Inches(3.95); ch = Inches(2.15); gapx = Inches(0.26); gapy = Inches(0.26)
for i, (t, d) in enumerate(services):
    r = i // 3; c = i % 3
    x = x0 + c * (cw + gapx); y = y0 + r * (ch + gapy)
    round_card(s, x, y, cw, ch, fill=WHITE, line=ACCENT, line_w=1.2)
    tb, tf = textbox(s, x + Inches(0.2), y + Inches(0.15), cw - Inches(0.4), Inches(0.5))
    para(tf, "◈ " + t, 15.5, True, ACCENT, first=True)
    tb2, tf2 = textbox(s, x + Inches(0.2), y + Inches(0.68), cw - Inches(0.4), ch - Inches(0.8))
    para(tf2, d, 13, False, DARK, first=True)

# ============ IT / 雲端 ============
header(prs.slides.add_slide(BLANK), "IT 方案 + 雲端服務")
bullets(prs.slides[-1], [
    ("head", "IT 解決方案"),
    ("ok", "HubSpot CRM：營銷、銷售、服務、業務操作一站式整合"),
    ("ok", "Microsoft 365 / Azure / Dynamics 365 / Power Platform / Teams"),
    ("ok", "Staffcop：員工電腦活動監控，防止資料外洩"),
    ("ok", "IT 管理：幫你經營對業務關鍵嘅科技基建"),
    ("head", "雲端服務"),
    ("ok", "多重雲端合作夥伴：AWS、Azure、Alibaba Cloud、Google Cloud"),
    ("ok", "雲端備份 / 遷移、DevOps（CI/CD）、雲端安全、託管式雲端顧問"),
    ("ok", "SSL / 網站託管 / 惡意軟件監控"),
    ("head", "通訊與創意"),
    "3CX IP PBX 通訊方案 · 360 虛擬導覽 · 促銷影片製作",
], top=Inches(1.7), size=14.5, gap=7)

# ============ 客戶名單（logo 牆）============
header(prs.slides.add_slide(BLANK), "服務過嘅客戶", "涵蓋上市公司、大學、醫療、零售與國際品牌")
bullets(prs.slides[-1], [
    "我哋好榮幸同以下知名機構同品牌合作 ——",
], top=Inches(1.15), size=14, gap=4)
s = prs.slides[-1]
grid = ["hku","cuhk","cityu","hksyu","hkie","cic","scope","hkqaa","hkci","hkgma","tmdhc","trinity",
        "tamjai","yamato","longchamp","ikea","emperor","mori","sautao","lkkhpg","healthyseed","hom","tutortime","fulbright",
        "hikvision","hashkey","sunnex","utpieces","sunshinelight","goodwell","tannerdewitt","ayp","beame","accolade","extrans","fhki"]
logo_grid(s, grid, x0=int(Inches(0.4)), y0=int(Inches(1.9)),
          per_row=6, box_w=Inches(1.96), box_h=Inches(0.84), gap=Inches(0.06))

# ============ 客戶案例 ============
header(prs.slides.add_slide(BLANK), "精選客戶案例", "上市公司 · 大學 · 國際品牌 · 醫療機構")
s = prs.slides[-1]
cases = [
    ("CTF Services Limited", "為大型企業把投資者關係與永續網站由 Sitecore 遷移至模組化 Laravel CMS，節省授權費並提升效能。"),
    ("SATS HK Limited", "為香港國際機場地勤服務公司開發自訂 Laravel 方案，管理複雜多語系內容並支援未來增長。"),
    ("Mori Jewellery", "自訂 PHP/Laravel 電商網站：積分系統、轉介計劃、Instagram 整合兼 Easyship 物流。"),
    ("Loeb Smith / Remfly", "分別為法律事務所與酒類進口商建立強大嘅內容同產品管理系統。"),
]
box_w = Inches(6.0); box_h = Inches(2.35); gapx = Inches(0.28); gapy = Inches(0.28)
x0 = Inches(0.5); y0 = Inches(1.7)
for i, (t, d) in enumerate(cases):
    r = i // 2; c = i % 2
    x = x0 + c * (box_w + gapx); y = y0 + r * (box_h + gapy)
    round_card(s, x, y, box_w, box_h, fill=LIGHT, line=ACCENT, line_w=1.2)
    whisker(s, x, y, Inches(0.7), Inches(0.07), ACCENT2)
    tb, tf = textbox(s, x + Inches(0.25), y + Inches(0.22), box_w - Inches(0.5), Inches(0.5))
    para(tf, t, 16, True, ACCENT, first=True)
    tb2, tf2 = textbox(s, x + Inches(0.25), y + Inches(0.8), box_w - Inches(0.5), box_h - Inches(0.9))
    para(tf2, d, 13.5, False, DARK, first=True)

# ============ 合作夥伴 ============
header(prs.slides.add_slide(BLANK), "認證合作夥伴", "同全球頂尖平台合作，確保質素")
s = prs.slides[-1]
partners = [
    ("HubSpot", "認證 Solution Provider，驅動 Inbound 營銷、銷售與服務自動化"),
    ("Google", "認證 Partner，精通 Google Ads 同 AdWords，幫你帶嚟回報"),
    ("Shopify", "夥伴代理，最擅長提升你 Shopify 商店嘅表現"),
    ("AWS", "全球策略合作夥伴，提供業界領先嘅雲端服務"),
    ("Microsoft", "企業級 Microsoft 365、Azure、Dynamics 365 等雲端平台"),
    ("Easyship", "物流整合夥伴，慳運輸成本，改善電商出貨體驗"),
]
x0 = Inches(0.5); y0 = Inches(1.7)
cw = Inches(6.0); ch = Inches(1.6); gapx = Inches(0.28); gapy = Inches(0.28)
for i, (t, d) in enumerate(partners):
    r = i // 2; c = i % 2
    x = x0 + c * (cw + gapx); y = y0 + r * (ch + gapy)
    round_card(s, x, y, cw, ch, fill=WHITE, line=ACCENT2, line_w=1.2)
    tb, tf = textbox(s, x + Inches(0.25), y + Inches(0.15), cw - Inches(0.5), Inches(0.45))
    para(tf, t, 16, True, ACCENT, first=True)
    tb2, tf2 = textbox(s, x + Inches(0.25), y + Inches(0.62), cw - Inches(0.5), ch - Inches(0.7))
    para(tf2, d, 12.5, False, DARK, first=True)

# ============ 客戶評價 ============
header(prs.slides.add_slide(BLANK), "客戶點睇我哋", "真實客戶評價（節錄）")
s = prs.slides[-1]
quotes = [
    ("「佢哋好有耐心，答我哋每一條問題，幫我哋解決所有難題。」", "Alex Hung · Tutor Time 資訊科技經理"),
    ("「Visible One 表現專業，遇到問題總有解決方案。」", "Dani Chen · HOM 顧問"),
    ("「佢哋絕對信得過，團隊專業、幫到手、反應快又識答。」", "Joe Chau · HKGGA"),
    ("「佢哋肯花時間喺我哋有限資源內搵解決方法，設身處地幫我哋。」", "Hon Chow · Sunnex Products"),
    ("「即刻上門、仔細評估、俾建議跟住報價，回覆快，交貨冇延誤。」", "Dan Kashtanov · 3D Mart"),
    ("「同佢哋合作對建立我哋無可比擬嘅網上形象至關重要，大大提升流量同互動。」", "Ava · spacio.sg 市場經理"),
]
x0 = Inches(0.5); y0 = Inches(1.7)
cw = Inches(6.0); ch = Inches(1.75); gapx = Inches(0.28); gapy = Inches(0.22)
for i, (q, who) in enumerate(quotes):
    r = i // 2; c = i % 2
    x = x0 + c * (cw + gapx); y = y0 + r * (ch + gapy)
    round_card(s, x, y, cw, ch, fill=LIGHT, line=ACCENT, line_w=1.2)
    qm = s.shapes.add_shape(MSO_SHAPE.OVAL, x + Inches(0.18), y + Inches(0.15), Inches(0.42), Inches(0.42))
    qm.fill.solid(); qm.fill.fore_color.rgb = ACCENT2; qm.line.fill.background(); qm.shadow.inherit = False
    qm_tf = qm.text_frame; qm_tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    qp = qm_tf.paragraphs[0]; qp.alignment = PP_ALIGN.CENTER
    qr = qp.add_run(); qr.text = "“"; _set_font(qr, FONT, 18, True, WHITE)
    tb, tf = textbox(s, x + Inches(0.75), y + Inches(0.18), cw - Inches(1.0), Inches(1.0))
    para(tf, q, 12.5, False, DARK, first=True)
    tb2, tf2 = textbox(s, x + Inches(0.75), y + ch - Inches(0.5), cw - Inches(1.0), Inches(0.4))
    para(tf2, "— " + who, 11.5, True, ACCENT, first=True)

# ============ 結尾 / 聯絡 ============
s = prs.slides.add_slide(BLANK)
add_bg(s, DARK2)
band(s, ACCENT2, Inches(0.1), Inches(3.15))
tb, tf = textbox(s, Inches(0.8), Inches(2.2), Inches(11.7), Inches(0.9), MSO_ANCHOR.MIDDLE)
para(tf, "Let’s make it VISIBLE.", 40, True, WHITE, PP_ALIGN.CENTER, first=True)
tb2, tf2 = textbox(s, Inches(1.5), Inches(3.5), Inches(10.3), Inches(0.8), MSO_ANCHOR.MIDDLE)
para(tf2, "需要網站、電商定數碼營銷？搵我哋傾下你嘅項目。", 17, False, ACCENT2, PP_ALIGN.CENTER, first=True)
tb3, tf3 = textbox(s, Inches(2.0), Inches(4.5), Inches(9.3), Inches(1.8))
para(tf3, "地址：香港新界葵涌葵興路 29–37 號興明工業大廈 8 字樓 B2 室", 14.5, False, RGBColor(0xE0, 0xF0, 0xEC), PP_ALIGN.CENTER, space_after=8, first=True)
para(tf3, "電話：(852) 2127 0101　·　電郵：info@visibleone.com.hk", 14.5, False, RGBColor(0xE0, 0xF0, 0xEC), PP_ALIGN.CENTER, space_after=8)
para(tf3, "網站：visibleone.com　·　Instagram：@visibleonehk　·　Facebook/LinkedIn：@VisibleOneHK", 14.5, False, RGBColor(0xE0, 0xF0, 0xEC), PP_ALIGN.CENTER, space_after=8)
foot, foot_tf = textbox(s, Inches(0.8), Inches(6.75), Inches(11.7), Inches(0.5))
para(foot_tf, "資料來源：visibleone.com 官方網站及公開資料 · 圖片為各品牌商標，只作簡介用途", 11, False, RGBColor(0x8F, 0xB8, 0xB4), PP_ALIGN.CENTER, first=True)

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "VisibleOne_公司簡介.pptx")
prs.save(out)
print("SAVED:", out, "slides:", len(prs.slides._sldIdLst))
