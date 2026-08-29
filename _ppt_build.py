# -*- coding: utf-8 -*-
"""寶天醫館 JR 智能預約系統 — 網站詳細介紹 PPT（廣東話 · 中環老闆級）"""
import os
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn
from PIL import Image

FR = 'presentation/shots/ppt/framed'
SRC = 'presentation/shots/ppt'
OUT = 'presentation/寶天醫館智能預約系統-網站詳細介紹.pptx'

# ---------- palette（跟網站 earthy spa） ----------
BG      = RGBColor(0xF8, 0xF3, 0xEA)
INK     = RGBColor(0x3E, 0x2A, 0x1E)
COCOA   = RGBColor(0xA0, 0x68, 0x53)
COCOA_D = RGBColor(0x7A, 0x4E, 0x3C)
SAGE    = RGBColor(0x7E, 0x94, 0x76)
SAGE_D  = RGBColor(0x3E, 0x52, 0x40)
SAGE_L  = RGBColor(0xEE, 0xF2, 0xE7)
CREAM2  = RGBColor(0xF0, 0xE4, 0xD2)
LINE    = RGBColor(0xE2, 0xD2, 0xB8)
MUTED   = RGBColor(0x8A, 0x7A, 0x6A)
WHITE   = RGBColor(0xFF, 0xFF, 0xFF)
GOLD    = RGBColor(0xB9, 0x9B, 0x6B)

FONT = 'Microsoft JhengHei'
SERIF = 'Georgia'

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
BLANK = prs.slide_layouts[6]

# ---------- helpers ----------
def set_run(r, text, size, bold=False, color=INK, name=FONT, italic=False, spacing=None):
    r.text = text
    r.font.size = Pt(size)
    r.font.bold = bold
    r.font.italic = italic
    r.font.color.rgb = color
    r.font.name = name
    rPr = r._r.get_or_add_rPr()
    ea = rPr.find(qn('a:ea'))
    if ea is None:
        ea = rPr.makeelement(qn('a:ea'), {})
        rPr.append(ea)
    ea.set('typeface', name)
    if spacing is not None:
        rPr.set('spc', str(spacing))

def add_text(slide, x, y, w, h, items, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP,
             space_after=4, line_spacing=1.08):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = Inches(0.02)
    tf.margin_top = tf.margin_bottom = Inches(0.01)
    first = True
    for it in items:
        text, size, bold, color = it[0], it[1], it[2], it[3]
        name = it[4] if len(it) > 4 else FONT
        italic = it[5] if len(it) > 5 else False
        spc = it[6] if len(it) > 6 else None
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        p.alignment = align
        p.space_after = Pt(space_after)
        p.line_spacing = line_spacing
        r = p.add_run()
        set_run(r, text, size, bold, color, name, italic, spc)
    return tb

def add_box(slide, x, y, w, h, fill, line=None, shape=MSO_SHAPE.ROUNDED_RECTANGLE, line_w=1.0, radius=0.08):
    sp = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    if fill is None:
        sp.fill.background()
    else:
        sp.fill.solid()
        sp.fill.fore_color.rgb = fill
    if line is None:
        sp.line.fill.background()
    else:
        sp.line.color.rgb = line
        sp.line.width = Pt(line_w)
    sp.shadow.inherit = False
    if shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        try:
            sp.adjustments[0] = radius
        except Exception:
            pass
    return sp

def bg(slide):
    add_box(slide, 0, 0, 13.333, 7.5, BG, shape=MSO_SHAPE.RECTANGLE)
    # 頂部幼金線
    add_box(slide, 0, 0, 13.333, 0.045, GOLD, shape=MSO_SHAPE.RECTANGLE)

PAGE = [0]
def header(slide, eyebrow, title, sub=None):
    add_text(slide, 0.55, 0.32, 9.5, 0.3, [(eyebrow, 12.5, False, COCOA, SERIF, True, 60)])
    add_text(slide, 0.55, 0.58, 10.8, 0.62, [(title, 27, True, INK)])
    add_box(slide, 0.58, 1.28, 0.55, 0.035, COCOA, shape=MSO_SHAPE.RECTANGLE)
    if sub:
        add_text(slide, 1.28, 1.13, 11.2, 0.3, [(sub, 12.5, False, MUTED)])
    # 頁碼 + brand
    PAGE[0] += 1
    add_text(slide, 12.35, 7.06, 0.75, 0.3, [(f'{PAGE[0]:02d}', 11, False, MUTED, SERIF, False)], align=PP_ALIGN.RIGHT)
    add_text(slide, 0.55, 7.06, 5.0, 0.3, [('寶天醫館 JR · 智能預約系統', 9.5, False, MUTED, FONT, False, 40)])

def pic(slide, name, x, y, w=None, h=None):
    p = os.path.join(FR, name)
    iw, ih = Image.open(p).size
    if w is not None:
        h = w * ih / iw
    else:
        w = h * iw / ih
    slide.shapes.add_picture(p, Inches(x), Inches(y), Inches(w), Inches(h))
    return w, h

def chip(slide, x, y, w, h, text, fill, tcolor, size=11, bold=True, line=None):
    add_box(slide, x, y, w, h, fill, line=line, radius=0.5)
    add_text(slide, x, y, w, h, [(text, size, bold, tcolor)], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

def bullets(slide, x, y, w, items, gap=0.52, size=12.5, dot_color=COCOA, tcolor=INK, bold_first=False):
    yy = y
    for it in items:
        add_box(slide, x, yy + 0.075, 0.09, 0.09, dot_color, shape=MSO_SHAPE.OVAL)
        if isinstance(it, tuple):
            head, body = it
            tb = slide.shapes.add_textbox(Inches(x + 0.22), Inches(yy - 0.04), Inches(w - 0.22), Inches(gap + 0.3))
            tf = tb.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            p.line_spacing = 1.12
            set_run(p.add_run(), head, size + 0.5, True, tcolor)
            p2 = tf.add_paragraph()
            p2.line_spacing = 1.1
            set_run(p2.add_run(), body, size - 1.5, False, MUTED)
        else:
            add_text(slide, x + 0.22, yy - 0.04, w - 0.22, gap + 0.2, [(it, size, False, tcolor)], line_spacing=1.12)
        yy += gap

def num_card(slide, x, y, w, h, num, title, body, accent=COCOA):
    add_box(slide, x, y, w, h, WHITE, line=LINE, radius=0.09)
    add_box(slide, x, y, 0.07, h, accent, shape=MSO_SHAPE.RECTANGLE)
    add_text(slide, x + 0.22, y + 0.13, w - 0.4, 0.4, [(num, 17, True, accent, SERIF)])
    add_text(slide, x + 0.22, y + 0.52, w - 0.4, 0.35, [(title, 13.5, True, INK)])
    add_text(slide, x + 0.22, y + 0.9, w - 0.4, h - 1.0, [(body, 10.5, False, MUTED)], line_spacing=1.15)

# ================================================================
# S1 封面
# ================================================================
s = prs.slides.add_slide(BLANK)
add_box(s, 0, 0, 13.333, 7.5, BG, shape=MSO_SHAPE.RECTANGLE)
# 全 bleed hero
hw = 13.333
hh = hw * Image.open(os.path.join(SRC, '01-hero.png')).size[1] / Image.open(os.path.join(SRC, '01-hero.png')).size[0]
s.shapes.add_picture(os.path.join(SRC, '01-hero.png'), Inches(0), Inches(0), Inches(hw), Inches(hw * 2000 / 3200))
# 底部深色帶
add_box(s, 0, 4.55, 13.333, 2.95, INK, shape=MSO_SHAPE.RECTANGLE)
add_box(s, 0, 4.52, 13.333, 0.04, GOLD, shape=MSO_SHAPE.RECTANGLE)
add_text(s, 0.9, 4.85, 8.5, 0.35, [('POTIN JR  ·  NATURAL HEALING  ·  CENTRAL, HONG KONG', 13, False, GOLD, SERIF, True, 80)])
add_text(s, 0.9, 5.22, 10.5, 1.0, [('寶天醫館 JR 智能預約系統', 40, True, RGBColor(0xF5, 0xEC, 0xDD))])
add_text(s, 0.9, 6.12, 10.8, 0.45, [('網站詳細介紹 — 由訪客第一步，到職員、醫師、管理員嘅最後一步，一個系統搞掂', 15, False, RGBColor(0xD8, 0xC9, 0xB4))])
add_text(s, 10.4, 5.3, 2.4, 0.9, [('2026', 30, True, GOLD, SERIF)], align=PP_ALIGN.RIGHT)
add_text(s, 10.4, 6.0, 2.4, 0.4, [('系統簡介 · 廣東話版', 11.5, False, RGBColor(0xD8, 0xC9, 0xB4))], align=PP_ALIGN.RIGHT)

# ================================================================
# S2 目錄
# ================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
header(s, 'AGENDA', '今日同你行勻成個系統', '六個章節 · 由門面行到入後廚')
toc = [
    ('01', '官網門面', '品牌美學 × 服務內容 × 訪客初體驗', COCOA),
    ('02', '會員體驗', '預約精靈 × 病歷 × 會籍 × 家庭帳戶', SAGE),
    ('03', '內部營運', '職員櫃檯 × 醫師工作檯', COCOA),
    ('04', '管理員後台', '14 個模組 · 全院一屏管晒', SAGE),
    ('05', '通知 × 安全', 'WhatsApp 通知王國 × 銀行級防護', COCOA),
    ('06', '技術總覽', '架構 × API × 部署要點', SAGE),
]
for i, (n, t, d, c) in enumerate(toc):
    xx = 0.55 + (i % 3) * 4.15
    yy = 1.75 + (i // 3) * 2.5
    num_card(s, xx, yy, 3.85, 2.2, n, t, d, accent=c)
s.shapes.add_picture(os.path.join(FR, '01-hero.png'), Inches(0), Inches(0), Inches(0), Inches(0)) if False else None

# ================================================================
# S3 系統鳥瞰
# ================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
header(s, 'OVERVIEW', '一個系統 · 四個版面 · 各有各嘅舞台', '同一個資料庫，四種角色，各睇各嘅嘢')
roles = [
    ('index.html', '訪客 × 會員', '官網 + 會員 Dashboard：預約、病歴、會籍、討論區一站式', COCOA),
    ('staff.html', '櫃檯職員', '全院預約流轉、家庭子帳戶開戶、病歴記錄', SAGE),
    ('doctor.html', '醫師', '淨係睇到自己嘅預約（伺服器強制），專心做治療', COCOA),
    ('admin.html', '管理員', '14 個模組：預約、用戶、收入、病歴、通知、官網內容', SAGE),
]
yy = 1.72
for f_, t, d, c in roles:
    add_box(s, 0.55, yy, 6.6, 1.12, WHITE, line=LINE, radius=0.12)
    add_box(s, 0.55, yy, 0.07, 1.12, c, shape=MSO_SHAPE.RECTANGLE)
    add_text(s, 0.82, yy + 0.12, 3.2, 0.35, [(t, 14.5, True, INK)])
    add_text(s, 0.82, yy + 0.55, 6.2, 0.5, [(f'{f_}  —  {d}', 10.5, False, MUTED)])
    yy += 1.28
stats = [('200+', 'API 端點'), ('43', '資料庫表'), ('8', '會員模組'), ('14', '後台模組')]
for i, (n, t) in enumerate(stats):
    xx = 7.5 + (i % 2) * 2.75
    y2 = 1.72 + (i // 2) * 1.5
    add_box(s, xx, y2, 2.55, 1.3, WHITE, line=LINE, radius=0.12)
    add_text(s, xx, y2 + 0.14, 2.55, 0.6, [(n, 26, True, COCOA, SERIF)], align=PP_ALIGN.CENTER)
    add_text(s, xx, y2 + 0.82, 2.55, 0.35, [(t, 11.5, False, MUTED)], align=PP_ALIGN.CENTER)
add_text(s, 7.5, 4.95, 5.3, 0.35, [('技術底盤', 13, True, INK)])
techs = ['Node.js 22', 'Express 5', 'SQLite', 'Vue 3', 'Tailwind CSS', 'Stripe', 'Twilio WhatsApp', 'node-cron', 'svg-captcha', 'bcrypt']
xx, y2 = 7.5, 5.35
for t in techs:
    w = 0.32 + len(t) * 0.085
    if xx + w > 12.85:
        xx = 7.5
        y2 += 0.52
    chip(s, xx, y2, w, 0.4, t, CREAM2, COCOA_D, size=10.5)
    xx += w + 0.14

# ================================================================
# S4 第一章 官網門面
# ================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
header(s, 'CHAPTER 01 · 官網門面', '開個網站，已經係一次 spa 級體驗', '訪客第一眼，就感受到中環高端定位')
pw, ph = pic(s, '01-hero.png', 5.35, 1.62, w=7.45)
bullets(s, 0.55, 1.85, 4.6, [
    ('動態波浪主視覺', 'VANTA.WAVES 互動背景，一入場已經「活」嘅'),
    ('逐屏電影感導航', 'scroll-snap 一版一景，行網站好似揭雜誌'),
    ('2026 earthy spa 設計系統', '暖奶油 × 霧粉棕 × 鼠尾草綠，全站統一色調'),
    ('襯線標題 × 浮雕紋飾', 'Noto Serif TC 標題，配印章品牌標記，貴氣但唔俗'),
], gap=1.05)

# ================================================================
# S5 服務同團隊
# ================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
header(s, 'CHAPTER 01 · 官網門面', '服務菜單 × 醫師團隊，一屏讀晒', '內容全部可以喺後台隨時改，唔使搵程式員')
pic(s, '02-services.png', 0.55, 1.7, w=6.1)
pic(s, '04-doctors.png', 6.85, 1.7, w=6.1)
add_text(s, 0.55, 5.62, 6.0, 0.35, [('六大服務 · 菜單式編排', 12.5, True, COCOA_D)])
add_text(s, 6.85, 5.62, 6.0, 0.35, [('醫師團隊 · 專科介紹', 12.5, True, SAGE_D)])
svcs = ['針灸療法', '中藥內科調理', '手法治療', '體質養生', '小兒推拿', '節氣養生']
xx = 0.55
for t in svcs:
    w = 0.4 + len(t) * 0.16
    chip(s, xx, 6.08, w, 0.42, t, CREAM2, COCOA_D, size=11)
    xx += w + 0.16
add_text(s, 0.55, 6.62, 12.2, 0.45, [('另有：成功案例、客戶評價（審核制）、中醫短片、討論區入口 — 全部由後台「官網內容」模組即時更新', 11, False, MUTED)])

# ================================================================
# S6 會員登入
# ================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
header(s, 'CHAPTER 01 · 官網門面', '一個登入位，三種角色各自入閘', '客戶、醫師、職員 — 同一個門口，唔同鑰匙')
pic(s, '05-login.png', 0.55, 1.7, w=6.6)
bullets(s, 7.5, 1.9, 5.3, [
    ('三角色切換', '客戶 / 醫師 / 員工 tab 一撳即轉，介面自動對應'),
    ('圖形驗證碼', '5 位字符、5 分鐘有效、單次使用，可點擊重整'),
    ('自助重設密碼', '電郵或 WhatsApp 收驗證碼，唔使打嚟求人'),
    ('開戶要經職員', '新會員由診所人手核實開戶 — 防濕開戶口，管控第一關'),
], gap=1.05)

# ================================================================
# S7 訪客初體驗
# ================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
header(s, 'CHAPTER 01 · 官網門面', '訪客都約得 — 初體驗零摩擦', '唔使開戶，填三個位就約到，先試後買')
pic(s, '06-guest-modal.png', 0.55, 1.7, w=6.6)
steps = [('1', '填基本資料', '中英文名 + 8 位電話，30 秒搞掂'),
         ('2', '揀日子時段', '即時睇到邊啲時段仲有位'),
         ('3', '確認預約', 'WhatsApp + 電郵雙通知確認'),
         ('4', '到診體驗', '一小時初體驗 $380，滿意先開戶升級')]
yy = 1.85
for n, t, d in steps:
    add_box(s, 7.5, yy, 5.3, 0.92, WHITE, line=LINE, radius=0.14)
    add_box(s, 7.68, yy + 0.23, 0.46, 0.46, COCOA, shape=MSO_SHAPE.OVAL)
    add_text(s, 7.68, yy + 0.23, 0.46, 0.46, [(n, 15, True, WHITE, SERIF)], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    add_text(s, 8.32, yy + 0.1, 4.3, 0.35, [(t, 13, True, INK)])
    add_text(s, 8.32, yy + 0.47, 4.35, 0.35, [(d, 10.5, False, MUTED)])
    yy += 1.06
add_box(s, 7.5, yy + 0.02, 5.3, 0.62, SAGE_L, radius=0.16)
add_text(s, 7.72, yy + 0.02, 5.0, 0.62, [('後端鎖死：訪客只可以約「初體驗」— 防濫用機制內建', 10.5, True, SAGE_D)], anchor=MSO_ANCHOR.MIDDLE)

# ================================================================
# S8 會員 Dashboard
# ================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
header(s, 'CHAPTER 02 · 會員體驗', '登入之後，八個模組任你行', '由預約到病歴到討論區，會員所有嘢都喺呢度')
pic(s, '10-member-booking.png', 4.85, 1.62, w=8.0)
mods = [('預約服務', '四步精靈 + 即時時段'), ('我的預約', '狀態追蹤 · 取消 · 列印'),
        ('我的病歴', '相片對比 · 音頻 · AI 分析'), ('會員中心', '會籍 · 升級 · 家庭帳戶'),
        ('設定', '資料 · 頭像 · 通知偏好'), ('醫療分流', 'AI 症狀分類建議'),
        ('意見箱', '直接同職員對話'), ('中醫討論區', '發帖交流養生心得')]
yy = 1.75
for i, (t, d) in enumerate(mods):
    xx = 0.55 + (i % 2) * 2.12
    if i % 2 == 0 and i > 0:
        yy += 0.92
    add_box(s, xx, yy, 2.0, 0.8, WHITE, line=LINE, radius=0.14)
    add_text(s, xx + 0.14, yy + 0.08, 1.8, 0.3, [(t, 11.5, True, COCOA_D)])
    add_text(s, xx + 0.14, yy + 0.4, 1.8, 0.35, [(d, 8.5, False, MUTED)])

# ================================================================
# S9 四步預約精靈
# ================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
header(s, 'CHAPTER 02 · 會員體驗', '四步預約精靈，背後係一堆智能規則', '客戶覺得簡單，係因為複雜嘢系統做咗')
wizard = [('STEP 1', '揀服務', '會籍唔夠級嘅服務會鎖住，升級即刻解鎖'),
          ('STEP 2', '揀時間', '30 分鐘一格，即時顯示可用時段'),
          ('STEP 3', '填資料', '自動帶返會員資料，唔使重新填'),
          ('STEP 4', '確認', 'WhatsApp + 電郵即時確認')]
for i, (n, t, d) in enumerate(wizard):
    xx = 0.55 + i * 3.13
    add_box(s, xx, 1.75, 2.9, 2.0, WHITE, line=LINE, radius=0.1)
    add_box(s, xx, 1.75, 2.9, 0.09, COCOA if i % 2 == 0 else SAGE, shape=MSO_SHAPE.RECTANGLE)
    add_text(s, xx + 0.22, 1.98, 2.5, 0.3, [(n, 11, True, COCOA if i % 2 == 0 else SAGE_D, SERIF)])
    add_text(s, xx + 0.22, 2.3, 2.5, 0.4, [(t, 17, True, INK)])
    add_text(s, xx + 0.22, 2.78, 2.5, 0.8, [(d, 10.5, False, MUTED)], line_spacing=1.15)
    if i < 3:
        add_text(s, xx + 2.9, 2.5, 0.25, 0.4, [('→', 16, True, LINE)])
rules = [('重疊 ≤ 15 分鐘', '同一醫師前後預約最多重疊 15 分鐘，執症有位轉身'),
         ('床位全院共享', '推拿床／針灸床容量即時檢查，唔會超賣'),
         ('醫師獨立時段', '每位醫師自己嘅當值表，請假即時封鎖'),
         ('假期自動封鎖', '公眾假期、紅字日、閉診日、特別時段全部計埋')]
for i, (t, d) in enumerate(rules):
    xx = 0.55 + i * 3.13
    add_box(s, xx, 4.15, 2.9, 1.75, SAGE_L if i % 2 == 0 else CREAM2, radius=0.1)
    add_text(s, xx + 0.22, 4.38, 2.5, 0.4, [('✓ ' + t, 12.5, True, SAGE_D if i % 2 == 0 else COCOA_D)])
    add_text(s, xx + 0.22, 4.85, 2.5, 0.95, [(d, 10, False, INK)], line_spacing=1.18)
add_text(s, 0.55, 6.15, 12.2, 0.4, [('仲有：開放月份管制、營業時間 10:00–19:00、過往日期擋單 — 想約嘅日子唔啱規則，系統直接唔俾過。', 11, False, MUTED)])

# ================================================================
# S10 我的預約 × 病歴
# ================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
header(s, 'CHAPTER 02 · 會員體驗', '我的預約 × 電子病歴，透明度十足', '客戶自己睇得晒，唔使打嚟問')
pic(s, '11-member-mybookings.png', 0.55, 1.7, w=6.1)
pic(s, '12-member-medical.png', 6.85, 1.7, w=6.1)
add_text(s, 0.55, 5.65, 6.0, 0.35, [('我的預約', 12.5, True, COCOA_D)])
add_text(s, 0.55, 6.0, 6.1, 0.6, [('狀態標籤一目了然、可以自行取消、支援列印 — 每次更改都有 WhatsApp 通知', 10.5, False, MUTED)])
add_text(s, 6.85, 5.65, 6.0, 0.35, [('我的病歴', 12.5, True, SAGE_D)])
add_text(s, 6.85, 6.0, 6.1, 0.6, [('療程相片今次對比上次、醫師音頻記錄、下載病歴摘要、仲有 AI 分析', 10.5, False, MUTED)])

# ================================================================
# S11 會員制度
# ================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
header(s, 'CHAPTER 02 · 會員體驗', '三級會籍，升級全自動', 'Stripe 付款 → webhook 驗證 → 即刻開通，零人手')
tiers = [
    ('一般會員', '$0', '免費登記', ['初體驗一小時 $380', '個人資料管理', '其餘服務升級解鎖'], CREAM2, INK),
    ('高級會員', '$8,800', '全服務通行', ['針灸 $250 · 手法 $500', '優先時段 + 案例庫', '全部服務即約'], COCOA, WHITE),
    ('家庭會員', '$16,800', '一人升級 · 全家受惠', ['高級全部功能', '家庭帳戶 + 子帳戶', '18 歲以下保險覆蓋'], SAGE_D, WHITE),
]
for i, (t, p, tag, feats, c, tc) in enumerate(tiers):
    xx = 0.55 + i * 4.15
    dark = c in (COCOA, SAGE_D)
    add_box(s, xx, 1.75, 3.85, 3.6, c, line=None if dark else LINE, radius=0.08)
    add_text(s, xx + 0.28, 2.0, 3.3, 0.4, [(t, 16, True, tc)])
    add_text(s, xx + 0.28, 2.42, 3.3, 0.6, [(p, 27, True, tc if dark else COCOA_D, SERIF)])
    add_text(s, xx + 0.28, 3.1, 3.3, 0.35, [(tag, 11, True, GOLD if dark else COCOA)])
    yy = 3.55
    for f_ in feats:
        add_box(s, xx + 0.3, yy + 0.06, 0.08, 0.08, GOLD if dark else COCOA, shape=MSO_SHAPE.OVAL)
        add_text(s, xx + 0.5, yy - 0.05, 3.15, 0.4, [(f_, 10.5, False, tc)])
        yy += 0.42
add_box(s, 0.55, 5.65, 12.25, 0.85, WHITE, line=LINE, radius=0.12)
add_text(s, 0.85, 5.65, 11.8, 0.85, [('付款流程：會員中心撳「升級」→ Stripe Checkout 安全付款（HKD）→ 官方簽名 webhook 驗證 → 會籍 30 日自動生效；職員亦可代客電話收款開通。', 11.5, False, INK)], anchor=MSO_ANCHOR.MIDDLE)

# ================================================================
# S12 家庭帳戶
# ================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
header(s, 'CHAPTER 02 · 會員體驗', '家庭帳戶 — 細路仔預約都管到妥妥當當', '18 歲以下子帳戶由職員代開，家長全程 WhatsApp 收料')
pic(s, '21-staff-subaccount.png', 0.55, 1.7, w=6.6)
flow = [('職員代開', 'staff.html 填子女姓名＋出生日期，系統自動生成帳號'),
        ('暫時密碼', '自動產生 BT＋6 位數字，首次登入強制改密'),
        ('WhatsApp 直送', '登入資料自動發畀家長；失敗即彈大字俾職員抄低'),
        ('隨時重設', '一撳重設暫時密碼，重新發送，唔怕唔記得')]
yy = 1.85
for t, d in flow:
    add_box(s, 7.5, yy, 5.3, 0.92, WHITE, line=LINE, radius=0.14)
    add_box(s, 7.5, yy, 0.07, 0.92, SAGE, shape=MSO_SHAPE.RECTANGLE)
    add_text(s, 7.75, yy + 0.1, 4.9, 0.35, [(t, 13, True, INK)])
    add_text(s, 7.75, yy + 0.47, 4.95, 0.4, [(d, 10, False, MUTED)])
    yy += 1.06
add_box(s, 7.5, yy + 0.02, 5.3, 0.62, CREAM2, radius=0.16)
add_text(s, 7.72, yy + 0.02, 5.0, 0.62, [('權限矩陣：<18歲 戶主可管理＋看病歷；≥18歲 只可睇「預約成功」', 10.5, True, COCOA_D)], anchor=MSO_ANCHOR.MIDDLE)

# ================================================================
# S13 醫療分流 AI
# ================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
header(s, 'CHAPTER 02 · 會員體驗', '醫療分流 — 客戶唔知約邊樣？AI 幫手', '答幾條問題，系統建議最適合嘅服務，一鍵直入預約')
pic(s, '15-member-triage.png', 5.35, 1.62, w=7.45)
bullets(s, 0.55, 1.95, 4.6, [
    ('症狀分類（雙語）', '頭痛肩頸、失眠腸胃… 揀大類就開始'),
    ('問答式問卷', '逐題計分，唔係一次過彈 20 條嚇死人'),
    ('評分建議', '按總分建議服務＋緊急程度，危急個案會提示求醫'),
    ('一鍵預約', '建議完直接跳入預約精靈，無縫接軌'),
    ('防濫用', '寫入限制 30 次／15 分鐘，session 全程記錄'),
], gap=0.92)

# ================================================================
# S14 內部營運
# ================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
header(s, 'CHAPTER 03 · 內部營運', '職員同醫師，各有一張工作檯', '同一套介面語言，權限就由伺服器把關')
pic(s, '20-staff-dashboard.png', 0.55, 1.7, w=6.1)
pic(s, '30-doctor-dashboard.png', 6.85, 1.7, w=6.1)
add_text(s, 0.55, 5.65, 6.0, 0.35, [('職員版 · staff.html', 12.5, True, COCOA_D)])
add_text(s, 0.55, 6.0, 6.1, 0.6, [('睇到全院預約、獨有家庭子帳戶管理面板、狀態流轉＋病歴管理', 10.5, False, MUTED)])
add_text(s, 6.85, 5.65, 6.0, 0.35, [('醫師版 · doctor.html', 12.5, True, SAGE_D)])
add_text(s, 6.85, 6.0, 6.1, 0.6, [('淨係見到自己嘅預約（API 層強制過濾），介面一致零重新學習', 10.5, False, MUTED)])

# ================================================================
# S15 職員日常
# ================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
header(s, 'CHAPTER 03 · 內部營運', '一張預約單嘅一生，職員全程跟到足', '由確認到完成，八種狀態一撳即轉')
pic(s, '20-staff-dashboard.png', 0.55, 1.7, w=6.9)
states = ['已確認', '已到訪', '治療中', '配藥中', '已完成']
xx = 7.75
for i, t in enumerate(states):
    chip(s, xx, 1.95, 0.88, 0.44, t, COCOA if i == 0 else (SAGE if i == len(states) - 1 else CREAM2), WHITE if i in (0, len(states) - 1) else COCOA_D, size=10)
    if i < len(states) - 1:
        add_text(s, xx + 0.88, 1.95, 0.2, 0.44, [('→', 11, True, MUTED)], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    xx += 1.06
bullets(s, 7.75, 2.75, 5.1, [
    ('例外處理', '未到場、已取消、記錄遲到（自動計分鐘數）、還原確認'),
    ('病歴管理', '主訴／診斷／處方／療程相片／音頻記錄，一次過入晒'),
    ('今日儀表板', '今日預約、已完成、待診人數、本週統計一目了然'),
    ('遲到統計', '客戶遲到歷史全記錄，管理員後台睇到晒'),
], gap=0.98)
add_box(s, 0.55, 6.15, 6.9, 0.62, CREAM2, radius=0.14)
add_text(s, 0.8, 6.15, 6.5, 0.62, [('狀態一改，客戶 WhatsApp 即刻收到 — 唔使打電話逐個通知', 10.5, True, COCOA_D)], anchor=MSO_ANCHOR.MIDDLE)

# ================================================================
# S16 管理員後台
# ================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
header(s, 'CHAPTER 04 · 管理員後台', '14 個模組，全院營運一屏管晒', '由預約到收入到官網內容，全部自己嚟')
pic(s, '41-admin-dashboard.png', 0.55, 1.7, w=6.6)
admin_mods = ['儀表板', '預約管理', '初體驗記錄', '收入報表', '用戶管理', '家庭帳戶',
              '病歴記錄', '時段管理', '診所設定', '系統設定', '審計日誌', '意見箱管理',
              '通知管理', '官網內容']
for i, t in enumerate(admin_mods):
    xx = 7.5 + (i % 3) * 1.82
    yy = 1.82 + (i // 3) * 0.86
    add_box(s, xx, yy, 1.7, 0.74, WHITE, line=LINE, radius=0.14)
    add_text(s, xx, yy, 1.7, 0.74, [(t, 10.5, True, COCOA_D)], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
add_box(s, 7.5, 6.05, 5.32, 0.62, SAGE_L, radius=0.14)
add_text(s, 7.72, 6.05, 5.0, 0.62, [('破壞性操作全部要管理員密碼二次驗證', 10.5, True, SAGE_D)], anchor=MSO_ANCHOR.MIDDLE)

# ================================================================
# S17 後台亮點
# ================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
header(s, 'CHAPTER 04 · 管理員後台', '預約、用戶、家庭樹 — 管理三寶', '資料睇得到，改嘢有關卡')
pic(s, '42-admin-bookings.png', 0.55, 1.7, w=6.1)
pic(s, '45-admin-users.png', 6.85, 1.7, w=6.1)
add_text(s, 0.55, 5.62, 6.0, 0.35, [('預約管理 × 初體驗記錄', 12.5, True, COCOA_D)])
add_text(s, 0.55, 5.97, 6.1, 0.75, [('全院預約狀態流轉、批量清除要二次驗證；訪客初體驗全部追蹤到，方便跟進升級', 10.5, False, MUTED)], space_after=2)
add_text(s, 6.85, 5.62, 6.0, 0.35, [('用戶管理 × 家庭帳戶樹', 12.5, True, SAGE_D)])
add_text(s, 6.85, 5.97, 6.1, 0.75, [('代客開戶、重設密碼（強制下次改密）、刪除要二次驗證、遲到統計跟人走；家庭樹狀結構一眼睇晒戶主子帳戶', 10.5, False, MUTED)])

# ================================================================
# S18 收入報表
# ================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
header(s, 'CHAPTER 04 · 管理員後台', '收入報表 — 數字唔會呃人', '日／月／年三個視角，Excel 一嘅入晒數')
pic(s, '44-admin-income.png', 0.55, 1.7, w=6.9)
bullets(s, 7.75, 1.95, 5.1, [
    ('三維報表', '按日、按月、按年，仲可以指定日期即刻查'),
    ('真檔案實測', '2026/08/20 日報 24 張收據 HK$12,000，一次過入晒'),
    ('訂閱收入拆分', '會籍訂閱同服務收入分開計，睇清楚錢喺邊度嚟'),
    ('收入趨勢圖', '柱狀圖一眼見到高低峰'),
    ('調整項管理', '退款、雜項調整全部有記錄，數目對得返'),
], gap=0.92)

# ================================================================
# S18b Excel 匯入實錄
# ================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
header(s, 'CHAPTER 04 · 管理員後台', 'Excel 匯入實錄 — 真收據真數據', '醫館原本用 Excel 記數？上載就自動入庫，唔使逐筆剷')
pic(s, '44b-admin-income-records.png', 0.55, 1.7, w=6.9)
bullets(s, 7.75, 1.9, 5.1, [
    ('兩種格式都食', '每日收入細列表（逐張收據）＋每月收入總覽表（逐日合計）'),
    ('支付方式保留', '現金、Payme、八達通、信用卡 — 每張收據獨立成行'),
    ('自動去重', '同一日／月匯過會擋，刪舊紀錄先可以再入，防計重數'),
    ('匯入紀錄可稽', '最近 500 筆列晒出嚟，單筆可刪，隨時重匯'),
    ('即時反映', '上載完收入報表即刻更新，趨勢圖同步跳'),
], gap=0.95)
add_box(s, 7.75, 6.35, 5.1, 0.62, SAGE_L, radius=0.14)
add_text(s, 7.98, 6.35, 4.7, 0.62, [('示範檔案：daily income.xlsx ＋ monthly income.xlsx', 10.5, True, SAGE_D)], anchor=MSO_ANCHOR.MIDDLE)

# ================================================================
# S19 通知中心
# ================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
header(s, 'CHAPTER 05 · 通知 × 安全', '通知王國 — WhatsApp 行先', '客戶喺 WhatsApp 度收到嘢，先至會真係睇')
pic(s, '50-admin-notifications.png', 5.35, 1.62, w=7.45)
bullets(s, 0.55, 1.9, 4.6, [
    ('WhatsApp 主渠道', '預約確認／更改／取消、提醒、子帳戶資料、停診通知'),
    ('三 provider 隨時切', 'Twilio / 360dialog / Android Gateway，環境變數一轉即換'),
    ('電郵輔助', 'Gmail SMTP，管理員後台一鍵開關'),
    ('每日 08:00 自動跑', '節氣養生訊息、節日祝賀、天氣提醒（天文台 API）、預約提醒'),
    ('發送記錄稽核', '每封通知有 log，邊個收過咩一目了然'),
], gap=0.95)

# ================================================================
# S20 官網 CMS
# ================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
header(s, 'CHAPTER 04 · 管理員後台', '官網內容自己改，行銷唔使等人', '公告、影片、評價、討論區 — 後台直出前台')
pic(s, '51-admin-sitecontent.png', 0.55, 1.7, w=6.9)
tabs = [('公告', '診所最新消息即時上架'), ('影片', '上傳檔案或 YouTube 連結'),
        ('社交', 'FB / IG / YT / WhatsApp / 微信'), ('動態文字', '標語口號想改就改'),
        ('評價審核', '客戶評分先審後登，質素有得控'), ('討論區管理', '不當內容一鍵處理')]
yy = 1.85
for t, d in tabs:
    add_box(s, 7.75, yy, 5.1, 0.68, WHITE, line=LINE, radius=0.16)
    add_box(s, 7.75, yy, 0.06, 0.68, GOLD, shape=MSO_SHAPE.RECTANGLE)
    add_text(s, 7.98, yy, 1.35, 0.68, [(t, 12, True, COCOA_D)], anchor=MSO_ANCHOR.MIDDLE)
    add_text(s, 9.35, yy, 3.4, 0.68, [(d, 10, False, MUTED)], anchor=MSO_ANCHOR.MIDDLE)
    yy += 0.8

# ================================================================
# S21 安全架構
# ================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
header(s, 'CHAPTER 05 · 通知 × 安全', '安全規格，銀行級咁做', '病歴係最私隱嘅嘢，我哋當佢係錢咁守')
secs = [
    ('bcrypt 密碼雜湊', '舊密碼登入時自動升級加密'),
    ('自製 HS256 JWT', '登出黑名單＋全裝置登出，即時封禁'),
    ('圖形驗證碼', 'cookie 綁定、單次有效、限錯 5 次'),
    ('多層速率限制', '登入 20／15min，驗證碼 10／15min'),
    ('帳戶＋IP 鎖定', '5 次錯鎖 10 分鐘，防惡意鎖死客戶'),
    ('管理員二次驗證', '刪戶口、清預約要再入密碼'),
    ('靜態檔案白名單', '.env／資料庫／源碼封鎖，唔會俾人下載'),
    ('Stripe webhook 簽名', '官方簽名驗證，假通知開通唔會過'),
    ('病歴檔案雙重驗證', 'JWT＋session＋擁有權三重檢查先俾睇相'),
]
for i, (t, d) in enumerate(secs):
    xx = 0.55 + (i % 3) * 4.15
    yy = 1.75 + (i // 3) * 1.55
    add_box(s, xx, yy, 3.85, 1.35, WHITE, line=LINE, radius=0.1)
    add_box(s, xx, yy, 0.07, 1.35, SAGE if i % 2 else COCOA, shape=MSO_SHAPE.RECTANGLE)
    add_text(s, xx + 0.24, yy + 0.14, 3.5, 0.35, [('✓ ' + t, 12.5, True, INK)])
    add_text(s, xx + 0.24, yy + 0.55, 3.5, 0.7, [(d, 10, False, MUTED)], line_spacing=1.12)
add_text(s, 0.55, 6.55, 12.2, 0.4, [('仲有：CORS 白名單、檔案上傳格式白名單、路徑穿越檢查、可疑密碼重設活動監察 — 層層都有閘。', 11, False, MUTED)])

# ================================================================
# S22 技術總覽
# ================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
header(s, 'CHAPTER 06 · 技術總覽', '技術架構 — 簡單、慳錢、夠硬淨', '唔使雲端大台，一部機一個檔案就跑得起')
layers = [
    ('前端', 'Vue 3 + Tailwind CSS + VANTA 動效（CDN＋本地 fallback）', CREAM2, COCOA_D),
    ('API 層', 'Express 5 · 130+ 端點 · 11 個路由模組 · JWT 驗證中介層', SAGE_L, SAGE_D),
    ('資料層', 'SQLite · 39 張表 · 備份＝複製一個檔案', CREAM2, COCOA_D),
    ('服務層', 'WhatsApp ×3 provider · Gmail SMTP · Stripe · node-cron 排程 · 天文台 API', SAGE_L, SAGE_D),
]
yy = 1.8
for t, d, c, tc in layers:
    add_box(s, 0.55, yy, 7.0, 1.05, c, radius=0.1)
    add_text(s, 0.85, yy + 0.12, 1.6, 0.4, [(t, 13.5, True, tc)])
    add_text(s, 0.85, yy + 0.52, 6.5, 0.45, [(d, 10.5, False, INK)])
    yy += 1.22
add_box(s, 7.95, 1.8, 4.85, 4.75, WHITE, line=LINE, radius=0.08)
add_text(s, 8.25, 2.02, 4.3, 0.4, [('部署要點', 15, True, INK)])
add_box(s, 8.25, 2.5, 0.5, 0.035, COCOA, shape=MSO_SHAPE.RECTANGLE)
dep = [('SESSION_SECRET 必設', '唔設嘅話一重啟全部登入失效'),
       ('NODE_ENV=production', 'session cookie 自動加 secure（配 HTTPS）'),
       ('備份策略', '每日複製 database.db 一個檔案搞掂'),
       ('CORS 白名單', 'ALLOWED_ORIGINS 設定正式網域'),
       ('供應商建議', '正式環境：360dialog WABA＋Brevo SMTP')]
yy = 2.72
for t, d in dep:
    add_box(s, 8.25, yy + 0.06, 0.08, 0.08, COCOA, shape=MSO_SHAPE.OVAL)
    add_text(s, 8.45, yy - 0.05, 4.2, 0.35, [(t, 11.5, True, INK)])
    add_text(s, 8.45, yy + 0.28, 4.2, 0.4, [(d, 9.5, False, MUTED)])
    yy += 0.76

# ================================================================
# S23 總結
# ================================================================
s = prs.slides.add_slide(BLANK)
bg(s)
add_box(s, 0, 0, 13.333, 7.5, INK, shape=MSO_SHAPE.RECTANGLE)
add_box(s, 0, 0, 13.333, 0.05, GOLD, shape=MSO_SHAPE.RECTANGLE)
add_text(s, 0.9, 0.75, 10.0, 0.35, [('SUMMARY', 13, False, GOLD, SERIF, True, 80)])
add_text(s, 0.9, 1.1, 11.5, 0.8, [('一個網站，由頭帶到落尾', 32, True, RGBColor(0xF5, 0xEC, 0xDD))])
finals = [
    ('門面夠貴氣', 'earthy spa 設計＋動態波浪，中環定位由第一屏開始'),
    ('客戶自己搞掂', '訪客初體驗→四步預約→自助管理，慳櫃檯人手'),
    ('營運有板有眼', '八種狀態流轉＋遲到統計＋病歴記錄，跟單跟到足'),
    ('錢銀清清楚楚', 'Stripe 自動開通＋三維收入報表＋Excel 匯入'),
    ('安全唔使憂', 'JWT／bcrypt／驗證碼／二次驗證，病歴級防護'),
]
yy = 2.15
for i, (t, d) in enumerate(finals):
    xx = 0.9 + (i % 2) * 6.1
    if i % 2 == 0 and i > 0:
        yy += 1.32
    add_box(s, xx, yy, 5.85, 1.15, RGBColor(0x4A, 0x35, 0x27), radius=0.12)
    add_box(s, xx, yy, 0.06, 1.15, GOLD, shape=MSO_SHAPE.RECTANGLE)
    add_text(s, xx + 0.25, yy + 0.12, 5.4, 0.4, [(f'{i+1}.  {t}', 14.5, True, RGBColor(0xF0, 0xE4, 0xD2))])
    add_text(s, xx + 0.25, yy + 0.55, 5.5, 0.5, [(d, 10.5, False, RGBColor(0xC9, 0xB8, 0xA2))])
add_text(s, 0.9, 6.35, 11.5, 0.5, [('寶天醫館 JR · 智能預約系統 — 由第一次點入網站，到完成治療最後一步，全部喺同一個系統入面搞掂。', 13.5, False, GOLD)])
add_text(s, 10.6, 6.95, 2.2, 0.35, [('2026 · 完', 11, False, RGBColor(0xC9, 0xB8, 0xA2), SERIF)], align=PP_ALIGN.RIGHT)

prs.save(OUT)
print('SAVED', OUT, '| slides:', len(prs.slides.__iter__.__self__._sldIdLst))
