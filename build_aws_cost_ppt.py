# -*- coding: utf-8 -*-
"""寶天醫館 — AWS 服務費用估算與設定 簡報建構腳本"""
import sys, os
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn

OUT = sys.argv[1] if len(sys.argv) > 1 else 'AWS服務費用估算與設定簡報.pptx'

GREEN_D = RGBColor(0x06, 0x4E, 0x3B)
GREEN   = RGBColor(0x05, 0x96, 0x69)
GREEN_L = RGBColor(0xD1, 0xFA, 0xE5)
GREEN_P = RGBColor(0xA7, 0xF3, 0xD0)
ACCENT  = RGBColor(0x86, 0xEF, 0xAC)
AMBER_D = RGBColor(0x92, 0x5F, 0x00)
AMBER_L = RGBColor(0xFE, 0xF3, 0xC7)
RED     = RGBColor(0xDC, 0x26, 0x26)
RED_L   = RGBColor(0xFE, 0xE2, 0xE2)
BLUE_D  = RGBColor(0x1E, 0x40, 0xAF)
BLUE_L  = RGBColor(0xDB, 0xEA, 0xFE)
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

def footer(slide, tag='寶天醫館 — AWS 服務費用估算與設定'):
    add_text(slide, 0.55, 7.12, 9, 0.3, [(tag, 9, False, GRAY)])
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
    lines = []
    for it in items:
        if isinstance(it, tuple):
            txt, bold, col = it
        else:
            txt, bold, col = it, False, DARK
        lines.append((f'{mark} {txt}', size, bold, col))
    add_text(slide, x, y, w, h, lines, space_after=gap)

def card(slide, x, y, w, h, title, body_items, fill=WHITE, line=LINE, tcolor=GREEN_D, tsize=16, bsize=13):
    add_box(slide, x, y, w, h, fill, line=line, line_w=1.0)
    add_text(slide, x + 0.25, y + 0.16, w - 0.5, 0.42, [(title, tsize, True, tcolor)])
    lines = []
    for it in body_items:
        if isinstance(it, tuple):
            txt, bold, col = it
        else:
            txt, bold, col = it, False, DARK
        lines.append((txt, bsize, bold, col))
    add_text(slide, x + 0.25, y + 0.62, w - 0.5, h - 0.7, lines, space_after=5)

# ============================================================
# Slide 1 — Cover
# ============================================================
s = new_slide()
add_box(s, 0, 0, 13.333, 7.5, GREEN_D)
add_box(s, 0, 5.6, 13.333, 1.9, GREEN)
add_text(s, 1.0, 1.6, 11.3, 1.6, [
    ('AWS 雲端服務估算與設定', 44, True, WHITE),
], align=PP_ALIGN.LEFT)
add_text(s, 1.0, 3.1, 11.3, 0.9, [
    ('寶天醫館智能預約系統', 24, False, ACCENT),
])
add_text(s, 1.0, 5.9, 11.3, 1.2, [
    ('部署全套服務清單　·　每項詳細設定　·　成本估算　·　常用地雷提醒', 15, False, WHITE),
    ('2026 年', 12, False, GREEN_P),
])

# ============================================================
# Slide 2 — 總覽：要用咩服務
# ============================================================
s = title_slide('用咩服務 — 一覽表', subtitle='所有項目＋每月估算成本', tag='總覽')
data = [
    ['AWS 服務', '用途', '每月費用(USD)'],
    ['Amazon EC2', '行 Node.js server.js(全個系統)', '~$18–20'],
    ['Amazon EBS', '伺服機磁碟 + 資料庫備份', '~$3'],
    ['Amazon S3', '上傳圖片/影片/backup 儲存', '~$1'],
    ['Amazon Route 53', '網域名 DNS + 指向', '~$0.90'],
    ['AWS Certificate Manager (ACM)', 'HTTPS 加密憑證', '免費 $0'],
    ['Amazon CloudWatch', '監控 + server log + 警報', '~$1'],
    ['Amazon CloudTrail', '審計記錄(政府項目準備)', '免費 $0'],
    ['Amazon SNS', '警報發送(email)', '免費 $0'],
    [('合計', True, True), '', '~$24–26'],
]
# 因為最後一行要加粗，手動處理
data_ok = data[:-1]
add_table(s, 0.7, 1.35, [3.2, 6.0, 2.4], data_ok, font_size=13, row_h=0.44)
add_box(s, 0.7, 1.35 + len(data_ok) * 0.44, 11.6, 0.52, AMBER_L, line=AMBER_D, line_w=1.0)
add_text(s, 0.9, 1.42 + len(data_ok) * 0.44, 11.2, 0.36, [
    ('合計（每月）≈  USD 24–26／月　＝　約 HK$185–200／月', 15, True, AMBER_D),
], anchor=MSO_ANCHOR.MIDDLE)
add_text(s, 0.7, 6.3, 12.0, 0.6, [
    ('* 初期未有政府要求：KMS 可唔用（慳 $2）；CloudTrail 可後補（都係 $0 但需時間設定）', 11, False, GRAY),
])

# ============================================================
# Slide 3 — EC2 詳細設定
# ============================================================
s = title_slide('Amazon EC2 — 伺服機', subtitle='揀「一般 Amazon EC2」＋ Linux', tag='服務 1')
add_table(s, 0.7, 1.35, [3.4, 6.0, 2.2], [
    ['設定項目', '建議值', '原因'],
    ['位置/地區', 'ap-east-1(香港)', '資料留港 + 低延遲'],
    ['作業系統', 'Linux', 'Node.js/SQLite 原生支援'],
    ['Instance 類型', 't4g.small', '2vCPU / 2GB RAM，夠診所用量'],
    ['使用模式', 'Always running(730 小時)', '系統 24 小時要接收預約'],
    ['租用類型', '共用(Shared)', '專用主機貴幾倍，未需要'],
    ['磁碟 EBS', '30GB gp3(跟 EC2 揀)', 'SQLite + 程式碼儲存'],
    ['備份 Snapshot', '10GB', '每日自動備份 database'],
], font_size=13, row_h=0.5)

# ============================================================
# Slide 4 — EBS 詳細設定
# ============================================================
s = title_slide('Amazon EBS — 磁碟', subtitle='EC2 隻「C: 碟」', tag='服務 2')
add_table(s, 0.7, 1.35, [3.4, 6.0, 2.2], [
    ['設定項目', '建議值', '原因'],
    ['Volume 類型', 'gp3(通用 SSD)', '預設、性價比最好'],
    ['容量', '30 GB', 'database + 程式碼 + 圖片'],
    ['IOPS', '3000(免費包)', '唔使加錢'],
    ['Throughput', '125 MB/s(免費包)', '唔使加錢'],
    ['快照備份', '10 GB', '$0.05/GB ≈ $0.5/月'],
], font_size=13, row_h=0.5)
add_text(s, 0.7, 4.6, 11.0, 0.9, [
    ('⚠ 快照係漸進式收費：內容冇大變只計差異，唔會日日加乘', 12, True, RED),
    ('⚠ 若部 EC2 重建，EBS 未備份嗰啲檔會冇晒 → 唔該經 S3 備份', 12, False, DARK),
])

# ============================================================
# Slide 5 — S3 詳細設定
# ============================================================
s = title_slide('Amazon S3 — 雲端儲存', subtitle='儲存上傳檔案＋備份(不屬任何一部機)', tag='服務 3')
add_table(s, 0.7, 1.35, [3.4, 6.0, 2.2], [
    ['設定項目', '建議值', '原因'],
    ['Storage class', 'S3 Standard', '成日讀寫，唔使冰川'],
    ['儲存量', '5 GB', 'uploads + backup'],
    ['PUT 請求', '5,000/月', '上傳相/backup'],
    ['GET 請求', '10,000/月', '瀏覽器睇相'],
    ['出站傳輸(Internet)', '5 GB', '唯一收費嗰項'],
    ['入站傳輸', '0', '上傳免費'],
    ['S3 Select', '0', '唔會用 SQL 查 S3'],
], font_size=13, row_h=0.5)
add_text(s, 0.7, 6.15, 11.0, 0.8, [
    ('⚠ 傳輸單位係 TB：5 唔係 5GB！填錯會變成 5TB(~$614/月)', 13, True, RED),
    ('⚠ Region 要同 EC2 一樣，內聯傳輸先免費', 12, False, DARK),
])

# ============================================================
# Slide 6 — Route 53 詳細設定
# ============================================================
s = title_slide('Amazon Route 53 — 網域 DNS', subtitle='網域名 → 指向 EC2', tag='服務 4')
add_table(s, 0.7, 1.35, [3.4, 6.0, 2.2], [
    ['設定項目', '建議值', '原因'],
    ['託管區域(Hosted zones)', '1', '一個網域'],
    ['其他記錄', '0', '唔會超過 1 萬筆'],
    ['標準查詢', '1(百萬次/月)', '診所流量佪餘好大'],
    ['流量流程 / 路由查詢', '0 / 唔開', '初期唔需要'],
    ['DNS 狀態檢查', '唔開', '有 ALB 先考慮'],
    ['Route 53 Resolver / 防火牆', '唔開', 'VPC 專用，唔關你事'],
], font_size=13, row_h=0.5)
add_text(s, 0.7, 5.4, 11.0, 0.9, [
    ('💰 託管區域 $0.50 + 查詢 $0.40 ≈ $0.90/月', 13, True, GREEN_D),
    ('※ 標準查詢欄只收整數，填 1 ＝ 100 萬次', 12, False, GRAY),
])

# ============================================================
# Slide 7 — ACM 詳細設定
# ============================================================
s = title_slide('AWS Certificate Manager (ACM) — HTTPS', subtitle='加密憑證（全免費）', tag='服務 5')
add_box(s, 0.7, 1.35, 11.9, 1.0, GREEN_L, line=GREEN, line_w=1.0)
add_text(s, 0.95, 1.5, 11.4, 0.7, [
    ('公開憑證 100% 免費 $0 — 自動續期，唔使手動理', 18, True, GREEN_D),
])
add_table(s, 0.7, 2.8, [3.4, 6.0, 2.2], [
    ['設定項目', '做法', '原因'],
    ['喺估價度', '咩都唔使填 / 移除', '免費所以唔會出現收費'],
    ['部署時(Console)', 'Request → DNS 驗證 → Route 53 貼 CNAME → 等 Issued', '完成 HTTPS'],
    ['Exportable 證書', '唔好揀！', '嗰種先收費($600+)'],
], font_size=13, row_h=0.5)
add_text(s, 0.7, 5.5, 11.0, 0.8, [
    ('※ 你用緊 Caddy 會自動整 Let\'s Encrypt 證書，ACM 係準備俾 ALB/CloudFront 用', 12, False, GRAY),
])

# ============================================================
# Slide 8 — CloudWatch 詳細設定
# ============================================================
s = title_slide('Amazon CloudWatch — 監控＋警報', subtitle='機死/CPU爆/磁碟滿 自動通知你', tag='服務 6')
add_table(s, 0.7, 1.35, [3.4, 6.0, 2.2], [
    ['設定項目', '建議值', '原因'],
    ['Metrics(指標)', '10', 'EC2 基本 + 自訂，頭 10 個免費'],
    ['API 請求', '0', '頭 100 萬免費'],
    ['Logs 資料輸入', '1 GB', '收集 server log(5GB 免費額內)'],
    ['Database Insights', '唔開', '你係 SQLite 唔關事'],
    ['Canaries / RUM / Insight', '唔開', '初期唔需要'],
    ['Alarms', '初期 1 個(當機)', '免費額 10 個內'],
], font_size=13, row_h=0.5)
add_text(s, 0.7, 6.1, 11.0, 0.9, [
    ('💰 約 $1/月 — 最值錢嗰項：EC2 死咗立即 Email 通知你', 13, True, GREEN_D),
    ('建議警報：① 伺服器當機(status check) ② CPU>90% ③ 磁碟<20%', 12, False, DARK),
])

# ============================================================
# Slide 9 — CloudTrail / SNS / KMS
# ============================================================
s = title_slide('CloudTrail・SNS・KMS — 輔助服務', subtitle='審計 / 通知 / 加密', tag='服務 7–9')
add_table(s, 0.7, 1.35, [2.6, 5.6, 3.4], [
    ['服務', '設定', '費用'],
    ['CloudTrail(審計)', '1 trail + Management events(量填 1)', '$0'],
    ['  — Data events', '填 0，初期唔需要', '—'],
    ['SNS(通知)', 'Requests:1 ／ EMAIL:0 ／ 其他 0 ／ Data Transfer 0', '$0'],
    ['KMS(加密)', '初期唔用；政府合作先開 2 把 CMK', '$0 或 $2'],
], font_size=12.5, row_h=0.5)
add_text(s, 0.7, 4.9, 11.0, 1.8, [
    ('· CloudTrail：記錄邊個幾時開/關/改咩資源 → 政府審計要用', 13, False, DARK),
    ('· SNS：CloudWatch 警報用嚟發 Email 俾你', 13, False, DARK),
    ('· KMS：想慳就唔加（用 AWS 免費托管金鑰）；政府要求先加 CMK $1/把', 13, False, DARK),
    ('⚠ SNS Data Transfer 都係 TB 單位，填 0', 12, True, RED),
], space_after=28)

# ============================================================
# Slide 10 — 總成本＋部署藍圖
# ============================================================
s = title_slide('總成本 ＋ 部署步驟', subtitle='每月約 USD 24–26（HK$185–200）', tag='總結')
add_box(s, 0.7, 1.3, 5.9, 5.0, GREEN_D)
add_text(s, 1.0, 1.7, 5.3, 2.0, [
    ('每月成本拆解', 20, True, ACCENT),
    ('EC2 t4g.small　HK 區', 15, False, WHITE),
    ('EBS 30GB gp3 + 快照', 15, False, WHITE),
    ('S3（儲存＋出站）', 15, False, WHITE),
], space_after=12)
add_text(s, 5.9, 1.7, 0.8, 2.0, [
    ('≈$18–20', 14, True, ACCENT),
    ('≈$3', 14, True, ACCENT),
    ('≈$1', 14, True, ACCENT),
])
add_text(s, 1.0, 5.3, 5.3, 0.9, [
    ('Route 53/CloudWatch/其他', 15, False, WHITE),
], space_after=8)
add_text(s, 5.9, 5.3, 1.2, 0.9, [
    ('≈$2–3', 14, True, ACCENT),
])
add_box(s, 6.9, 1.3, 5.8, 5.0, WHITE, line=LINE, line_w=1.0)
add_text(s, 7.2, 1.5, 5.2, 0.5, [('部署步驟(Step-by-step)', 18, True, GREEN_D)])
steps = [
    ('1.', '開 EC2（t4g.small / Linux / 香港）＋ EBS 30GB'),
    ('2.', '安裝 Node.js → 跑你個 server.js（PM2）'),
    ('3.', '開 S3 bucket → 程式上傳圖片自動存過去'),
    ('4.', '註冊網域 → Route 53 Hosted zone'),
    ('5.', '開 ACM 免費證書 → 綁 HTTPS'),
    ('6.', '開 CloudWatch log + 當機警報'),
    ('7.', '每日備份 database → S3'),
]
yy = 2.05
for no, txt in steps:
    add_text(s, 7.2, yy, 0.45, 0.4, [(no, 14, True, GREEN)])
    add_text(s, 7.75, yy, 4.8, 0.4, [(txt, 13, False, DARK)])
    yy += 0.62

# ============================================================
# Slide 11 — 地雷提醒
# ============================================================
s = title_slide('常見地雷 — 記得避開', subtitle='填錯隨時貴 30 倍', tag='警告')
rows = [
    ['地雷', '後果', '點避'],
    ['揀咗 Windows Server 版', 'license 貴幾百/月', '一定揀普通 Amazon EC2 + Linux'],
    ['揀咗專用主機(Dedicated)', '一部 $400+/月', '揀共用(Shared)'],
    ['Data Transfer 填咗 GB 當做', '5 變 5TB ≈ $614/月', '單位係 TB，診所填 0'],
    ['揀咗 Exportable ACM 證書', '$600+/證書', '揀標準免費公開證書'],
    ['開 Route 53 Resolver/防火牆', '多咗帳單又冇用', '全部關'],
    ['加 ALB / NAT / WAF', '每項 $16–32/月', '初期全部唔要'],
]
add_table(s, 0.7, 1.35, [3.0, 4.0, 4.6], rows, font_size=12, row_h=0.6)

# ============================================================
# Slide 12 — 政府合作注意事項
# ============================================================
s = title_slide('後續：將來同政府合作', subtitle='唔使而家就揀貴套餐', tag='前瞻')
add_table(s, 0.7, 1.35, [4.6, 7.0], [
    ['項目', '準備'],
    ['資料留港', 'Region 揀 ap-east-1，數據不出港'],
    ['加密', 'EBS/S3 開加密(EBS 加密＋S3 預設加密)，政府要求先加 KMS CMK'],
    ['審計', '開 CloudTrail(免費) 記錄登入/改動'],
    ['存取控制', 'IAM 最小權限 + 密碼政策(你 repo 已有)'],
    ['備份', '每日 db 備份去 S3 + 快照'],
    ['專用主機？', '合約明文要求先用，唔好預先俾貴錢'],
], font_size=12, row_h=0.55, col_align=[PP_ALIGN.LEFT, PP_ALIGN.LEFT])
add_text(s, 0.7, 5.3, 12.0, 0.8, [
    ('重點：政府合作講緊嘅係「安全、審計、留港、備份」— 呢啲共用 EC2 全部做到，', 14, True, GREEN_D),
    ('唔使為咗「政府」而而家就租專用主機。', 14, True, GREEN_D),
])

# ============================================================
# Slide 13 — 成本總結
# ============================================================
s = new_slide()
add_box(s, 0, 0, 13.333, 7.5, GREEN_D)
add_text(s, 1.0, 2.0, 11.3, 1.2, [('每月約 USD 24–26', 60, True, ACCENT)], align=PP_ALIGN.CENTER)
add_text(s, 1.0, 3.6, 11.3, 1.0, [('= 約 HK$185–200／月', 26, True, WHITE)], align=PP_ALIGN.CENTER)
add_text(s, 1.0, 4.9, 11.3, 0.8, [
    ('全套：EC2 + EBS + S3 + Route 53 + ACM + CloudWatch + SNS(CloudTrail 都係$0)', 14, False, GREEN_P),
], align=PP_ALIGN.CENTER)

prs.save(OUT)
print('Saved:', os.path.abspath(OUT))