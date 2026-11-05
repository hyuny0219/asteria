#!/usr/bin/env python3
"""Review sheets for v4 runtime art (docs/qa/assets_*_v4.png): sprites on a mid-grey
checker with the pivot (red) and ground line, at display size ×1 (stored ÷2)."""
import json, os
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = json.load(open(os.path.join(ROOT, 'assets/runtime/sprites.json')))
QA = os.path.join(ROOT, 'docs/qa')
try: FONT = ImageFont.truetype(os.path.join(ROOT, 'assets/runtime/fonts/NotoSansKR-bold.woff2'), 14)
except Exception: FONT = ImageFont.load_default()

def checker(w, h, s=12):
    im = Image.new('RGB', (w, h), (70, 64, 80)); d = ImageDraw.Draw(im)
    for y in range(0, h, s):
        for x in range(0, w, s):
            if (x // s + y // s) % 2: d.rectangle([x, y, x + s - 1, y + s - 1], fill=(92, 86, 104))
    return im

def sheet(entries, out, cell=(240, 260), cols=5, half=True):
    rows = (len(entries) + cols - 1) // cols
    im = checker(cell[0] * cols, cell[1] * rows); d = ImageDraw.Draw(im)
    for i, (k, e) in enumerate(entries):
        cx, cy = (i % cols) * cell[0], (i // cols) * cell[1]
        sp = Image.open(os.path.join(ROOT, e['file'])).convert('RGBA')
        f = 0.5 if half else 1
        if 'pivot' not in e:
            sp.thumbnail((cell[0] - 20, cell[1] - 40)); f = 1
        sw, sh = max(1, int(sp.width * f)), max(1, int(sp.height * f))
        sp = sp.resize((sw, sh), Image.LANCZOS)
        if sh > cell[1] - 30 or sw > cell[0] - 10:
            r = min((cell[1] - 30) / sh, (cell[0] - 10) / sw); sp = sp.resize((int(sw * r), int(sh * r))); f *= r
        gy = cy + cell[1] - 24
        if 'pivot' in e:
            ox = cx + cell[0] // 2 - int(e['pivot'][0] * f); oy = gy - int(e['pivot'][1] * f)
        else:
            ox, oy = cx + (cell[0] - sp.width) // 2, cy + 8
        im.paste(sp, (ox, oy), sp)
        if 'pivot' in e:
            d.line([cx + 6, gy, cx + cell[0] - 6, gy], fill=(216, 182, 117))
            d.ellipse([cx + cell[0] // 2 - 3, gy - 3, cx + cell[0] // 2 + 3, gy + 3], fill=(230, 40, 60))
        d.text((cx + 6, cy + cell[1] - 20), f"{k} {e.get('name', '')}"[:22], fill=(245, 237, 240), font=FONT)
    im.save(os.path.join(QA, out))

new_m = [(k, v) for k, v in S['monsters'].items() if int(k[1:]) >= 7]
sheet(new_m, 'assets_monsters_v4.png', cols=5)
new_b = [(k, v) for k, v in S['bosses'].items() if k == 'TOWER' or int(k[1:]) >= 4]
sheet(new_b, 'assets_bosses_v4.png', cell=(300, 320), cols=4)
tiers = [(k, v) for k, v in S['hero'].items() if k.endswith(('_t2', '_t3'))]
sheet(tiers, 'assets_tiers_v4.png', cell=(200, 340), cols=8)
sk = [(k, v) for k, v in S['skills'].items() if k.startswith('K')]
sheet(sk, 'assets_skills_v4.png', cell=(120, 130), cols=9, half=False)
bgs = [(k, {k2: v2 for k2, v2 in v.items() if k2 != 'pivot'}) for k, v in S['backgrounds'].items() if k not in ('meadow', 'desert', 'mine', 'cathedral')]
# backgrounds with their ground ratio line
cw, ch = 512, 342
im = Image.new('RGB', (cw * 2, ch * 4), (0, 0, 0)); d = ImageDraw.Draw(im)
for i, (k, v) in enumerate(bgs):
    b = Image.open(os.path.join(ROOT, v['file'])).convert('RGB').resize((cw, ch))
    x, y = (i % 2) * cw, (i // 2) * ch
    im.paste(b, (x, y)); gy = y + int(ch * v['groundRatio'])
    d.line([x, gy, x + cw, gy], fill=(255, 220, 60), width=2); d.text((x + 6, y + 6), f"{k} ground {v['groundRatio']}", fill=(255, 255, 255), font=FONT)
im.save(os.path.join(QA, 'assets_bgs_v4.png'))
print('sheets written')
