# -*- coding: utf-8 -*-
"""截圖加框：黑底 + 圓角 + 金線頂邊（中環老闆級）"""
import os
from PIL import Image, ImageDraw

SRC = 'presentation/shots/ppt'
FR = os.path.join(SRC, 'framed')
os.makedirs(FR, exist_ok=True)

INK = (17, 14, 12)
GOLD = (185, 155, 107)

for f in sorted(os.listdir(SRC)):
    if not f.endswith('.png'):
        continue
    p = os.path.join(SRC, f)
    im = Image.open(p).convert('RGB')
    w, h = im.size
    pad = int(w * 0.022)
    rad = int(w * 0.012)
    cw, ch = w + pad * 2, h + pad * 2
    canvas = Image.new('RGB', (cw, ch), INK)
    # 圓角 mask
    mask = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, w, h], radius=rad, fill=255)
    canvas.paste(im, (pad, pad), mask)
    # 頂部金線（跟圓角）
    ov = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    line_h = max(3, int(w * 0.0012))
    od.rounded_rectangle([pad, pad, pad + w, pad + line_h + rad], radius=rad, fill=GOLD + (255,))
    od.rectangle([pad, pad + line_h, pad + w, pad + line_h + rad], fill=(0, 0, 0, 0))
    canvas = Image.alpha_composite(canvas.convert('RGBA'), ov).convert('RGB')
    canvas.save(os.path.join(FR, f))
    print('framed', f)
