# -*- coding: utf-8 -*-
"""寶天醫館 — 營運開支與服務費用分析 簡報建構腳本"""
import sys, os
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn

OUT = sys.argv[1] if len(sys.argv) > 1 else '營運開支分析簡報.pptx'

GREEN_D = RGBColor(0x06, 0x4E, 0x3B)
GREEN   = RGBColor(0x05, 0x96, 0x69)
GREEN_L = RGBColor(0xD1, 0xFA, 0xE5)
GREEN_P = RGBColor(0xA7, 0xF3, 0xD0)
ACCENT  = RGBColor(0x86, 0xEF, 0xAC)
PURPLE  = RGBColor(0x7C, 0x3A, 0xED)
RED     = RGBColor(0xDC, 0x26, 0x26)
DARK    = RGBColor(0x1F, 0x29, 0x37)
GRAY    = RGBColor(0x6B, 0x72, 0x80)
WHITE   = RGBColor(0xFF, 0xFF, 0xFF)
LINE    = RGBColor(0xD1, 0xD5, 0xDB)

FONT = 'Microsoft JhengHei'

prs = Presentation()
prs.slide_width  = Inches(13.333)
prs.slide_height = Inches(7.5)
BLANK = prs.slide_layouts[6]

_num = [0]

def set_run(r, text, size, bold=False, color=DARK, name=FONT):
    r.text = text
    r.font.size = Pt(size)
    r.font.bold = bold
    r.font.color.rgb = color
    r.font.name = name
    rPr = r._r.get_or_add_rPr()
    ea = rPr.find(qn('a:ea'))
    if ea is None:
        ea = rPr.makeelement(qn('a:ea'), {})
        rPr.append(ea)
    ea.set('typeface', name)

def add_text(slide, x, y, w, h, items, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP,
             space_after=6, line_spacing=1.06):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = Inches(0.02)
    tf.margin_top = tf.margin_bottom = Inches(0.01)
    first = True
    for it in items:
        text, size, bold, color = it
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        p.alignment = align
        p.space_after = Pt(space_after)
        p.line_spacing = line_spacing
        r = p.add_run()
        set_run(r, text, size, bold, color)
    return tb

def add_box(slide, x, y, w, h, fill, line=None, shape=MSO_SHAPE.ROUNDED_RECTANGLE, line_w=1.0):
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
    return sp

def new_slide():
    _num[0] += 1
    return prs.slides.add_slide(BLANK)

def footer(slide):
    add_text(slide, 0.55, 7.12, 9, 0.3, [('寶天醫館智能預約系統 — 營運開支與服務費用分析', 9, False, GRAY)])
    add_text(slide, 11.9, 7.12, 0.9, 0.3, [(str(_num[0]), 9, False, GRAY)], align=PP_ALIGN.RIGHT)

def title_slide(title, subtitle=None, tag=None):
    s = new_slide()
    add_box(s, 0, 0, 13.333, 0.14, GREEN)
    add_box(s, 0, 0.14, 13.333, 0.95, GREEN_D)
    add_text(s, 0.55, 0.22, 12.2, 0.8, [(title, 27, True, WHITE)], anchor=MSO_ANCHOR.MIDDLE)
    if tag:
        add_box(s, 0.55, 1.06, 1.35, 0.34, ACCENT, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        add_text(s, 0.55, 1.08, 1.35, 0.3, [(tag, 11, True, GREEN_D)], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    if subtitle:
        add_text(s, 2.05, 1.06, 10.7, 0.34, [(subtitle, 13, False, ACCENT)], anchor=MSO_ANCHOR.MIDDLE)
    footer(s)
    return s

def add_table(slide, x, y, col_widths, data, header_fill=GREEN_D, header_color=WHITE,
              alt_fill=GREEN_L, font_size=12, row_h=0.42, col_align=None, header_font_size=None):
    rows, cols = len(data), len(data[0])
    total_w = sum(col_widths)
    gt = slide.shapes.add_table(rows, cols, Inches(x), Inches(y),
                                Inches(total_w), Inches(row_h * rows)).table
    for i, cw in enumerate(col_widths):
        gt.columns[i].width = Inches(cw)
    for r_i, row in enumerate(data):
        gt.rows[r_i].height = Inches(row_h)
        for c_i, val in enumerate(row):
            cell = gt.cell(r_i, c_i)
            cell.fill.solid()
            if r_i == 0:
                cell.fill.fore_color.rgb = header_fill
                color, bold = header_color, True
                fs = header_font_size or font_size
            else:
                cell.fill.fore_color.rgb = alt_fill if (r_i % 2 == 0) else WHITE
                color, bold = DARK, False
                fs = font_size
            cell.margin_left = Inches(0.08)
            cell.margin_right = Inches(0.08)
            cell.margin_top = Inches(0.02)
            cell.margin_bottom = Inches(0.02)
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            tf = cell.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            if col_align and col_align[c_i]:
                p.alignment = col_align[c_i]
            r = p.add_run()
            set_run(r, str(val), fs, bold, color)
    return gt

def bullets(slide, x, y, w, h, items, size=15, gap=8, mark='•'):
    """items: list of (text, bold, color) or str"""
    lines = []
    for it in items:
        if isinstance(it, tuple):
            txt, bold, col = it
        else:
            txt, bold, col = it, False, DARK
        lines.append((f'{mark} {txt}', size, bold, col))
    add_text(slide, x, y, w, h, lines, space_after=gap)

def label_value(slide, x, y, w, label, value, lsize=13, vsize=16, vcolor=GREEN_D, valign=MSO_ANCHOR.MIDDLE):
    add_text(slide, x, y, w, 0.35, [(label, lsize, True, GRAY)], anchor=valign)
    add_text(slide, x, y + 0.34, w, 0.45, [(value, vsize, True, vcolor)], anchor=valign)

def card(slide, x, y, w, h, title, body_items, fill=WHITE, line=LINE, tcolor=GREEN_D, tsize=16, bsize=13):
    add_box(slide, x, y, w, h, fill, line=line, line_w=1.0)
    add_text(slide, x + 0.25, y + 0.18, w - 0.5, 0.45, [(title, tsize, True, tcolor)])
    lines = []
    for it in body_items:
        if isinstance(it, tuple):
            txt, bold, col = it
        else:
            txt, bold, col = it, False, DARK
        lines.append((f'• {txt}', bsize, bold, col))
    add_text(slide, x + 0.25, y + 0.7, w - 0.5, h - 0.85, lines, space_after=7)

# ============================================================ S1 封面
s = new_slide()
add_box(s, 0, 0, 13.333, 7.5, GREEN_D)
add_box(s, 0, 0, 13.333, 0.16, GREEN)
add_text(s, 0.8, 1.0, 11.7, 0.5, [('寶天醫館智能預約系統', 20, True, ACCENT)])
add_text(s, 0.8, 1.7, 11.7, 1.6, [('營運開支與服務費用分析', 44, True, WHITE), ('', 6, False, WHITE)],
         space_after=4)
add_text(s, 0.8, 3.3, 11.7, 1.3, [
    ('涵蓋三大範疇：通訊渠道（ClickSend SMS・WhatsApp・Email）', 16, False, GREEN_P),
    ('伺服器部署（AWS EC2・Linode）・開發工具（OpenCode・Deevid AI）', 16, False, GREEN_P),
], space_after=8)
add_box(s, 0.8, 4.9, 11.7, 0.9, GREEN, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, 0.8, 4.98, 11.7, 0.75, [
    ('所有金額均以 美金（USD）＋ 港幣（HKD）列出', 16, True, WHITE),
    ('參考匯率：1 USD ≈ 7.84 HKD（Deevid 官方換算）', 13, False, GREEN_P),
], space_after=4, anchor=MSO_ANCHOR.MIDDLE)
add_text(s, 0.8, 6.2, 11.7, 0.4, [('適用系統版本：booking-demo 預約系統', 13, False, GREEN_P)])
add_text(s, 0.8, 6.9, 11.7, 0.4, [('2026 年度', 12, False, ACCENT)])

# ============================================================ S2 目錄
s = title_slide('目錄', tag='總覽')
items = [
    ('01', '通訊渠道', 'ClickSend SMS ・ WhatsApp ・ Email — 用途與收費', GREEN),
    ('02', '伺服器', 'AWS EC2 ・ Linode — 部署選項與月費比較', GREEN),
    ('03', '開發工具', 'OpenCode（AI 編碼代理）・ Deevid AI（影片製作）', PURPLE),
    ('04', '總結', '每月開支總表 ＋ 建議組合（美金＋港幣）', RED),
]
for i, (no, t, d, col) in enumerate(items):
    y = 1.5 + i * 1.32
    add_box(s, 0.55, y, 12.2, 1.12, WHITE, line=LINE, line_w=1.0)
    add_box(s, 0.85, y + 0.22, 0.85, 0.68, col, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(s, 0.85, y + 0.22, 0.85, 0.68, [(no, 20, True, WHITE)], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    add_text(s, 1.95, y + 0.12, 10.5, 0.5, [(t, 19, True, DARK)])
    add_text(s, 1.95, y + 0.62, 10.5, 0.4, [(d, 13, False, GRAY)])

# ============================================================ S3 通訊渠道總覽
s = title_slide('通訊渠道總覽', subtitle='三條渠道分工：WhatsApp 主力 → SMS 後備 → Email 文件', tag='通訊渠道')
card(s, 0.55, 1.55, 4.0, 2.6, '① WhatsApp（主力）',
     [('最重要通知渠道，優先發送', True, GREEN_D),
      ('病人可自行選擇「想收 WhatsApp」', False, DARK),
      ('24 小時內回覆病人免費', False, DARK)])
card(s, 4.67, 1.55, 4.0, 2.6, '② SMS（後備）',
     [('WhatsApp 失敗／關閉時自動接上', True, GREEN_D),
      ('冇裝 WhatsApp 嘅病人一樣收得到', False, DARK),
      ('香港號碼自動補 852', False, DARK)])
card(s, 8.79, 1.55, 4.0, 2.6, '③ Email（確認／文件）',
     [('驗證碼、預約確認、通知副本', True, GREEN_D),
      ('低成本，寄件人可用診所域名', False, DARK),
      ('低用量基本免費', False, DARK)])
add_box(s, 0.55, 4.55, 12.2, 1.9, GREEN_L, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, 0.85, 4.75, 11.6, 1.5, [
    ('發送次序（系統已內置）', 15, True, GREEN_D),
    ('通知產生時 → 先試 WhatsApp → 唔成功自動轉 SMS → 兩者都唔得先記錄失敗', 14, False, DARK),
    ('Email 獨立處理：預約確認同驗證碼會同時以 Email 發出', 14, False, DARK),
], space_after=8)

# ============================================================ S4 ClickSend 用途
s = title_slide('ClickSend — SMS 用途', subtitle='系統依家嘅 SMS 供應商（.env 設 SMS_PROVIDER=clicksend）', tag='通訊渠道')
bullets(s, 0.55, 1.55, 12.2, 2.2, [
    ('系統所有 SMS 都經 ClickSend API 發出', True, GREEN_D),
    ('預約確認／取消／更改、到診提醒（當日／前 1·3·7 日）', False, DARK),
    ('節氣、節日、天氣提醒（每日 08:00 自動排程）', False, DARK),
    ('後台「通知管理」可手動測試發送', False, DARK),
], size=15, gap=10)
card(s, 0.55, 4.0, 6.0, 2.6, '特點',
     [('預付 Credit，用幾多扣幾多，冇月費', True, GREEN_D),
      ('Sender ID：PoTinClinic（最多 11 字元）', False, DARK),
      ('香港 8 位號碼自動加 +852', False, DARK)])
card(s, 6.75, 4.0, 6.0, 2.6, '香港需知',
     [('香港「短訊發送人登記制度」要實名登記', True, RED),
      ('向 ClickSend 提交商業登記／診所證明', False, DARK),
      ('批核前 SMS 較易被視為可疑短訊', False, DARK)])

# ============================================================ S5 ClickSend 收費
s = title_slide('ClickSend — SMS 收費', subtitle='美金 ＋ 港幣', tag='通訊渠道')
add_box(s, 0.55, 1.55, 12.2, 2.4, GREEN_D, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, 0.9, 1.75, 11.5, 2.0, [
    ('香港 SMS 收費：約 HK$0.4 – 0.7 / 條', 26, True, WHITE),
    ('（即約 US$0.05 – 0.09 / 條）', 15, False, ACCENT),
    ('冇月費、冇固定成本；預先購買 Credit，用幾多扣幾多', 14, False, GREEN_P),
], space_after=8)
add_text(s, 0.55, 4.3, 12.2, 0.4, [('每月開支估算（後備使用量）', 16, True, DARK)])
add_table(s, 0.55, 4.75, [4.0, 4.1, 4.1],
          [['每月後備 SMS 數量', '每條成本', '每月約計'],
           ['100 條', 'HK$0.4–0.7', 'HK$40–70（US$5–9）'],
           ['200 條', 'HK$0.4–0.7', 'HK$80–140（US$10–18）'],
           ['500 條', 'HK$0.4–0.7', 'HK$200–350（US$26–45）']],
          font_size=14, row_h=0.5, col_align=[PP_ALIGN.CENTER, PP_ALIGN.CENTER, PP_ALIGN.CENTER])

# ============================================================ S6 WhatsApp 用途與收費
s = title_slide('WhatsApp — 用途與收費', subtitle='建議用 360dialog（官方 WhatsApp Business API）', tag='通訊渠道')
card(s, 0.55, 1.55, 6.0, 2.7, '用途',
     [('主力通知渠道：確認、提醒、回覆', True, GREEN_D),
      ('「24 小時窗口」內回覆病人 → 免費', False, DARK),
      ('逾時提醒要預先審批嘅模板（Utility 類較平）', False, DARK)])
card(s, 6.75, 1.55, 6.0, 2.7, '收費結構',
     [('平台費：360dialog 按計劃（約 HK$250／年）', True, GREEN_D),
      ('訊息費：Meta 官方價，香港約 HK$0.3–0.8／條', False, DARK),
      ('（即約 US$0.04–0.10／條）', False, GRAY)])
add_box(s, 0.55, 4.6, 12.2, 2.0, GREEN_L, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, 0.85, 4.8, 11.6, 1.6, [
    ('每月估算（假設 1,000 條通知）', 15, True, GREEN_D),
    ('1,000 × HK$0.3–0.4 ≈ HK$300–400（US$38–51）＋ 平台費攤分約 HK$21／月', 14, False, DARK),
    ('如果大部分喺 24 小時內回覆，可大幅慳費', 13, False, GRAY),
], space_after=8)

# ============================================================ S7 Email 用途與收費
s = title_slide('Email — 用途與收費', subtitle='系統依家用 Gmail SMTP；正式建議用 Brevo', tag='通訊渠道')
card(s, 0.55, 1.55, 6.0, 2.7, '用途',
     [('忘記密碼 → 驗證碼電郵', True, GREEN_D),
      ('預約確認郵件、通知副本', False, DARK),
      ('寄件人顯示診所名稱（寶天醫館）', False, DARK)])
card(s, 6.75, 1.55, 6.0, 2.7, '方案對比',
     [('Brevo（建議）：免費版 300 封／日，可用診所域名', True, GREEN_D),
      ('Gmail SMTP（現用）：免費 500 封／日', False, DARK),
      ('兩者低用量都係 $0 月費', False, DARK)])
add_box(s, 0.55, 4.55, 12.2, 2.0, GREEN_L, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, 0.85, 4.75, 11.6, 1.6, [
    ('收費總結', 15, True, GREEN_D),
    ('每日上限內 100% 免費 — Email 渠道每月 HK$0（US$0）', 15, True, DARK),
    ('超過上限先要升級（Brevo 付費版約 HK$90／月起）', 13, False, GRAY),
], space_after=8)

# ============================================================ S8 通訊渠道月費總結
s = title_slide('通訊渠道 — 每月開支總結', subtitle='美金 ＋ 港幣', tag='通訊渠道')
add_table(s, 0.55, 1.6, [3.0, 2.2, 3.5, 3.5],
          [['渠道', '固定月費', '每條費用', '每月約計'],
           ['ClickSend SMS', 'US$0', 'HK$0.4–0.7／條', 'HK$80–140（US$10–18）'],
           ['WhatsApp（360dialog）', '平台費攤分約 HK$21', 'HK$0.3–0.8／條', 'HK$300–400（US$38–51）'],
           ['Email（Brevo／Gmail）', 'US$0', 'US$0', 'HK$0（US$0）'],
           ['合計', '', '', '約 HK$400–600（US$51–77）／月']],
          font_size=14, row_h=0.55,
          col_align=[PP_ALIGN.LEFT, PP_ALIGN.CENTER, PP_ALIGN.CENTER, PP_ALIGN.CENTER])
add_text(s, 0.55, 4.9, 12.2, 0.4, [('備註', 15, True, DARK)])
bullets(s, 0.55, 5.35, 12.2, 1.6, [
    ('WhatsApp 24 小時內回覆免費，善用可再減', False, DARK),
    ('SMS 只係後備，正常 WhatsApp 成功就唔會出', False, DARK),
    ('Email 用量低，長期 $0', False, DARK),
], size=13, gap=6)

# ============================================================ S9 伺服器總覽
s = title_slide('伺服器部署 — 選項總覽', subtitle='Node.js + SQLite 輕量系統，入門配置已夠用', tag='伺服器')
card(s, 0.55, 1.55, 6.0, 3.0, 'AWS EC2',
     [('最大雲服務商，功能全面', True, GREEN_D),
      ('有 12 個月 Free Tier（$0 試用）', False, DARK),
      ('設定較多概念（安全群組、EIP 等）', False, DARK),
      ('入門月費：約 US$7.5（HK$59）起', False, GRAY)])
card(s, 6.75, 1.55, 6.0, 3.0, 'Linode（Akamai Connected Cloud）',
     [('平價 VPS，香港有節點', True, GREEN_D),
      ('定價簡單，面板易用', False, DARK),
      ('入門月費：US$5（HK$39）起', False, GRAY),
      ('適合診所級系統', False, DARK)])
add_box(s, 0.55, 4.95, 12.2, 1.65, GREEN_L, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, 0.85, 5.15, 11.6, 1.3, [
    ('兩個選擇都係「按月租用」，含作業系統、SSD、流量', 14, False, DARK),
    ('診所系統需求細：一部 $5 Linode 或 Free Tier 後嘅 t3.micro 已可穩定運行', 14, True, GREEN_D),
], space_after=8)

# ============================================================ S10 AWS 用途
s = title_slide('AWS EC2 — 用途', subtitle='Amazon Web Services 嘅虛擬伺服器', tag='伺服器')
bullets(s, 0.55, 1.55, 12.2, 2.3, [
    ('將 booking-demo 系統部署上雲，24 小時可連線（port 4000）', True, GREEN_D),
    ('病人隨時預約、後台隨時管理，唔使自己開電腦', False, DARK),
    ('可加自動備份（SQLite 資料庫）、HTTPS 證書、網域', False, DARK),
    ('Free Tier：t2.micro／t3.micro 首 12 個月每月 750 小時免費', False, DARK),
], size=15, gap=10)
card(s, 0.55, 4.0, 6.0, 2.6, '適合邊個',
     [('想用「行業標準」、之後會升級', True, GREEN_D),
      ('想 12 個月免費用 Free Tier', False, DARK),
      ('不介意設定較複雜', False, DARK)])
card(s, 6.75, 4.0, 6.0, 2.6, '要知道',
     [('功能多但概念多，初次設定要啲時間', True, RED),
      ('靜態 IP（EIP）同流量另計', False, DARK),
      ('Free Tier 完結後會開始收費，記得預算', False, DARK)])

# ============================================================ S11 AWS 收費
s = title_slide('AWS EC2 — 收費', subtitle='美金 ＋ 港幣（約數，以官方價為準）', tag='伺服器')
add_table(s, 0.55, 1.6, [3.6, 3.0, 3.0, 2.6],
          [['機型', '規格', '月費（約）USD', '月費（約）HKD'],
           ['t2.micro / t3.micro', '1 vCPU · 1 GB', 'Free Tier 12 個月 → $0', 'HK$0'],
           ['t3.micro（免稅期後）', '1 vCPU · 1 GB', '約 US$7.5', '約 HK$59'],
           ['t3.small', '1 vCPU · 2 GB', '約 US$15', '約 HK$118']],
          font_size=14, row_h=0.6,
          col_align=[PP_ALIGN.LEFT, PP_ALIGN.LEFT, PP_ALIGN.CENTER, PP_ALIGN.CENTER])
bullets(s, 0.55, 4.5, 12.2, 1.4, [
    ('靜態 IP（Elastic IP）：使用中約 US$3.6／月（HK$28）', False, DARK),
    ('流量同備份睇用量另計；香港區為 ap-east-1', False, DARK),
    ('用緊 Free Tier 時實際月費 = US$0（HK$0）', True, GREEN_D),
], size=14, gap=8)

# ============================================================ S12 Linode 用途
s = title_slide('Linode — 用途', subtitle='現為 Akamai Connected Cloud，平價 VPS', tag='伺服器')
bullets(s, 0.55, 1.55, 12.2, 2.3, [
    ('同 AWS 一樣部署整個 booking-demo 系統（Node.js + SQLite）', True, GREEN_D),
    ('香港有數據中心節點，病人連線快', False, DARK),
    ('官方面板一撳部署 Linux（Ubuntu）＋ 即開即用', False, DARK),
    ('可按小時計費；可加購自動 Backups 備份', False, DARK),
], size=15, gap=10)
card(s, 0.55, 4.0, 6.0, 2.6, '適合邊個',
     [('診所／中小企預算有限', True, GREEN_D),
      ('想簡單、快上手', False, DARK),
      ('$5 入門機已夠用', False, DARK)])
card(s, 6.75, 4.0, 6.0, 2.6, '要知道',
     [('冇 Free Tier（但本身月費已經平）', True, RED),
      ('記憶體同流量要按用量揀', False, DARK),
      ('遷移去其他供應商都容易', False, DARK)])

# ============================================================ S13 Linode 收費
s = title_slide('Linode — 收費', subtitle='美金 ＋ 港幣', tag='伺服器')
add_table(s, 0.55, 1.6, [3.6, 3.4, 2.6, 2.6],
          [['計劃', '規格', '月費 USD', '月費 HKD'],
           ['Nanode 1GB', '1 vCPU · 1 GB · 25 GB SSD', 'US$5', '約 HK$39'],
           ['Shared 2GB', '1 vCPU · 2 GB · 50 GB SSD', 'US$10', '約 HK$78'],
           ['Shared 4GB', '2 vCPU · 4 GB · 80 GB SSD', 'US$20', '約 HK$157']],
          font_size=14, row_h=0.6,
          col_align=[PP_ALIGN.LEFT, PP_ALIGN.LEFT, PP_ALIGN.CENTER, PP_ALIGN.CENTER])
add_box(s, 0.55, 4.6, 12.2, 1.5, GREEN_L, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, 0.85, 4.8, 11.6, 1.1, [
    ('推薦：Nanode 1GB（US$5／HK$39）已足夠運行本系統', 16, True, GREEN_D),
    ('診所系統屬輕量負載，$5–10 計劃最啱', 13, False, GRAY),
], space_after=8)

# ============================================================ S14 AWS vs Linode
s = title_slide('AWS vs Linode — 比較', subtitle='入門方案對比', tag='伺服器')
add_table(s, 0.55, 1.6, [3.0, 4.6, 4.6],
          [['項目', 'AWS EC2', 'Linode'],
           ['入門月費', '約 US$7.5（HK$59）＊', 'US$5（HK$39）'],
           ['設定難度', '高（概念較多）', '低（簡單易用）'],
           ['香港節點', '有（ap-east-1）', '有'],
           ['Free Tier', '有（12 個月）', '無'],
           ['適合', '大規模／企業', '診所／中小企'],
           ['＊免稅期內可用 Free Tier 首 12 個月 $0', '', '']],
          font_size=14, row_h=0.55,
          col_align=[PP_ALIGN.LEFT, PP_ALIGN.LEFT, PP_ALIGN.LEFT])
add_box(s, 0.55, 5.3, 12.2, 1.4, GREEN_D, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, 0.85, 5.45, 11.6, 1.1, [
    ('建議：初期用 Linode US$5（HK$39）／月，慳錢易管理', 16, True, WHITE),
    ('日後需求增大再考慮遷移 AWS Free Tier 或升級機型', 13, False, ACCENT),
], space_after=6)

# ============================================================ S15 開發工具總覽
s = title_slide('開發工具 — 總覽', subtitle='日常營運／製作內容嘅輔助工具', tag='開發工具')
card(s, 0.55, 1.55, 6.0, 3.2, 'OpenCode（AI 編碼代理）',
     [('開源工具，軟體本身完全免費', True, GREEN_D),
      ('用自然語言叫 AI 寫／改程式碼', False, DARK),
      ('要自動用模型就加 OpenCode Go 訂閱', False, DARK),
      ('月費：US$10（HK$78）', False, GRAY)])
card(s, 6.75, 1.55, 6.0, 3.2, 'Deevid AI（製作影片）',
     [('AI 製作宣傳／介紹影片', True, PURPLE),
      ('兩個方案：專業版 US$35／優化版 US$159', False, DARK),
      ('用點數計：15 秒片約 60 點、10 秒片約 20 點', False, DARK),
      ('月費：US$35（HK$274.54）起', False, GRAY)])
add_box(s, 0.55, 5.15, 12.2, 1.5, GREEN_L, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, 0.85, 5.35, 11.6, 1.1, [
    ('兩者都係「輔助工具」，可以獨立使用、隨時開停', 14, False, DARK),
    ('OpenCode 幫你維修／改功能；Deevid 幫你出宣傳片', 14, True, GREEN_D),
], space_after=8)

# ============================================================ S16 OpenCode 軟體
s = title_slide('OpenCode — 軟體本身', subtitle='開源 AI 編碼代理', tag='開發工具')
add_box(s, 0.55, 1.55, 12.2, 2.3, GREEN_D, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, 0.9, 1.75, 11.5, 1.9, [
    ('軟體本身：完全免費下載及使用', 30, True, WHITE),
    ('（開源 AI 編碼代理 — 喺你部電腦上直接執行）', 16, False, ACCENT),
], space_after=8)
card(s, 0.55, 4.2, 6.0, 2.5, '用途',
     [('用日常語言叫 AI 寫程式碼', True, GREEN_D),
      ('整個預約系統、改功能、查 bug 都係佢做', False, DARK),
      ('可以睇成「識寫 code 嘅助手」', False, DARK)])
card(s, 6.75, 4.2, 6.0, 2.5, '收費',
     [('下載同使用：HK$0（US$0）', True, GREEN_D),
      ('唔訂閱都用到基本功能', False, DARK),
      ('要暢順用模型先考慮 OpenCode Go', False, DARK)])

# ============================================================ S17 OpenCode Go 訂閱
s = title_slide('OpenCode Go — 訂閱方案', subtitle='美金 ＋ 港幣', tag='開發工具')
add_table(s, 0.55, 1.6, [4.0, 4.1, 4.1],
          [['項目', '收費 USD', '收費 HKD'],
           ['首月優惠', 'US$5', '約 HK$39'],
           ['常態月費', 'US$10／月', '約 HK$78／月'],
           ['包含額度上限', '每月最多 US$60 用量', '約 HK$470']],
          font_size=15, row_h=0.6,
          col_align=[PP_ALIGN.LEFT, PP_ALIGN.CENTER, PP_ALIGN.CENTER])
add_text(s, 0.55, 4.5, 12.2, 0.5, [('額度限制（訂閱包含）', 15, True, DARK)])
bullets(s, 0.55, 5.0, 12.2, 1.6, [
    ('每 5 小時最多用 US$12（HK$94）', True, GREEN_D),
    ('每週最多用 US$30（HK$235）', True, GREEN_D),
    ('每月最多用 US$60（HK$470）', True, GREEN_D),
], size=14, gap=8)

# ============================================================ S18 OpenCode Go 額度詳解
s = title_slide('OpenCode Go — 額度詳解', subtitle='US$10／月 買到最多 US$60 用量', tag='開發工具')
add_table(s, 0.55, 1.6, [4.0, 3.0, 3.0, 2.2],
          [['限制', '額度 USD', '額度 HKD', '說明'],
           ['5 小時用量上限', 'US$12', '約 HK$94', '短期高強度使用'],
           ['每週用量上限', 'US$30', '約 HK$235', '一週內總用量'],
           ['每月用量上限', 'US$60', '約 HK$470', '一個月內總用量']],
          font_size=14, row_h=0.6,
          col_align=[PP_ALIGN.LEFT, PP_ALIGN.CENTER, PP_ALIGN.CENTER, PP_ALIGN.CENTER])
add_box(s, 0.55, 4.6, 12.2, 2.0, GREEN_L, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, 0.85, 4.8, 11.6, 1.6, [
    ('點解抵：', 15, True, GREEN_D),
    ('每月付 US$10（HK$78），就能用到最多 US$60（HK$470）價值嘅 AI 模型用量', 15, False, DARK),
    ('支援 DeepSeek、Kimi、GLM 等多款模型 — 可自由切換', 14, True, GREEN_D),
], space_after=8)

# ============================================================ S19 Deevid 專業版
s = title_slide('Deevid AI — 專業版', subtitle='AI 製作宣傳影片', tag='開發工具')
add_box(s, 0.55, 1.55, 12.2, 2.2, PURPLE, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, 0.9, 1.72, 11.5, 1.9, [
    ('專業版：US$35／月（HK$274.54）', 28, True, WHITE),
    ('每月包含 600 點數', 16, False, ACCENT),
], space_after=8)
card(s, 0.55, 4.1, 6.0, 2.5, '用量（官方估算）',
     [('一條 15 秒影片：約用 60 點', True, GREEN_D),
      ('一條 10 秒影片：約用 20 點', False, DARK),
      ('600 點 ≈ 10 條 15 秒 或 30 條 10 秒', False, DARK)])
card(s, 6.75, 4.1, 6.0, 2.5, '適合',
     [('每月出幾條診所介紹／服務宣傳片', True, GREEN_D),
      ('唔夠點可以等下個月或買額外點數', False, DARK),
      ('CP 值高，普通診所夠用', False, DARK)])

# ============================================================ S20 Deevid 優化版
s = title_slide('Deevid AI — 優化版', subtitle='大量製作時嘅升級方案', tag='開發工具')
add_box(s, 0.55, 1.55, 12.2, 2.2, PURPLE, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, 0.9, 1.72, 11.5, 1.9, [
    ('優化版：US$159／月（HK$1,247）', 28, True, WHITE),
    ('每月包含 3,000 點數', 16, False, ACCENT),
], space_after=8)
card(s, 0.55, 4.1, 6.0, 2.5, '用量',
     [('3,000 點 ≈ 50 條 15 秒 或 150 條 10 秒', True, GREEN_D),
      ('即專業版嘅 5 倍量', False, DARK),
      ('適合每日更新內容', False, DARK)])
card(s, 6.75, 4.1, 6.0, 2.5, '適合',
     [('多平台（IG／YouTube／網頁）大量宣傳', True, PURPLE),
      ('每月出一批廣告素材', False, DARK),
      ('預算充足嘅診所', False, DARK)])

# ============================================================ S21 Deevid 點數計算
s = title_slide('Deevid AI — 點數用量計算', subtitle='美金 ＋ 港幣', tag='開發工具')
add_table(s, 0.55, 1.6, [2.6, 3.4, 1.9, 2.2, 2.2],
          [['版本', '月費', '點數／月', '15 秒片（60 點）', '10 秒片（20 點）'],
           ['專業版', 'US$35（HK$274.54）', '600', '10 條', '30 條'],
           ['優化版', 'US$159（HK$1,247）', '3,000', '50 條', '150 條']],
          font_size=13, row_h=0.6,
          col_align=[PP_ALIGN.LEFT, PP_ALIGN.CENTER, PP_ALIGN.CENTER, PP_ALIGN.CENTER, PP_ALIGN.CENTER])
add_box(s, 0.55, 4.5, 12.2, 2.1, GREEN_L, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, 0.85, 4.7, 11.6, 1.7, [
    ('實例估算', 15, True, GREEN_D),
    ('診所每月 2 條 15 秒（120 點）＋ 5 條 10 秒（100 點）= 共 220 點', 14, False, DARK),
    ('→ 專業版 600 點綽綽有餘，仲剩 380 點', 14, True, GREEN_D),
    ('（匯率：US$35 = HK$274.54、US$159 = HK$1,247，官方換算）', 12, False, GRAY),
], space_after=8)

# ============================================================ S22 每月開支總結
s = title_slide('每月開支 — 總結', subtitle='全套方案：美金 ＋ 港幣', tag='總結')
add_table(s, 0.55, 1.6, [3.2, 4.2, 2.3, 2.5],
          [['項目', '建議方案', '月費 USD', '月費 HKD'],
           ['伺服器', 'Linode Nanode 1GB', 'US$5', '約 HK$39'],
           ['SMS', 'ClickSend（後備使用）', '約 US$10–18', '約 HK$80–140'],
           ['WhatsApp', '360dialog', '約 US$38–51', '約 HK$300–400'],
           ['Email', 'Brevo 免費版', 'US$0', 'HK$0'],
           ['OpenCode Go', '訂閱（常態）', 'US$10', '約 HK$78'],
           ['Deevid AI', '專業版', 'US$35', 'HK$274.54'],
           ['合計', '', '約 US$98–119', '約 HK$772–932']],
          font_size=13, row_h=0.52,
          col_align=[PP_ALIGN.LEFT, PP_ALIGN.LEFT, PP_ALIGN.CENTER, PP_ALIGN.CENTER])
add_text(s, 0.55, 5.0, 12.2, 0.4, [('慳錢版本（唔訂 Deevid 專業版）', 15, True, DARK)])
add_text(s, 0.55, 5.45, 12.2, 0.5, [
    ('約 US$63–84／月（約 HK$497–658／月）', 18, True, GREEN_D),
])

# ============================================================ S23 建議組合與備註
s = title_slide('建議組合與備註', subtitle='點部署最慳又穩定', tag='總結')
bullets(s, 0.55, 1.55, 12.2, 2.6, [
    ('伺服器：Linode US$5／月（HK$39）— 初期最抵', True, GREEN_D),
    ('通訊：WhatsApp（360dialog）主力 ＋ ClickSend SMS 後備 ＋ Brevo Email 免費', False, DARK),
    ('開發：OpenCode 軟體免費，加 US$10／月（HK$78）OpenCode Go 暢順用模型', False, DARK),
    ('影片：Deevid 專業版 US$35／月（HK$274.54），量多先升優化版', False, DARK),
], size=15, gap=10)
add_box(s, 0.55, 4.35, 12.2, 2.3, GREEN_D, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, 0.85, 4.55, 11.6, 1.9, [
    ('備註', 15, True, ACCENT),
    ('匯率：1 USD ≈ 7.84 HKD（Deevid 官方換算）；其餘用 7.84 約數', 13, False, GREEN_P),
    ('所有價錢為約數，實際以各供應商官方網站為準', 13, False, GREEN_P),
    ('WhatsApp 24 小時內回覆免費，建議流程以慳費', 13, False, GREEN_P),
    ('OpenCode 軟體完全免費，訂閱先要錢；Deevid 可按月開停', 13, False, GREEN_P),
], space_after=8)

prs.save(OUT)
print('SAVED:', OUT, 'slides =', len(prs.slides._sldIdLst))
