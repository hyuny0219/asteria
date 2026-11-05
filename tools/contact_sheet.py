#!/usr/bin/env python3
"""Review sheets for extracted sprites: battle display size on dark/light/checker
backgrounds, and icons at 48 px. Writes docs/qa/assets_*.png."""
import json
import os

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'docs', 'qa')
os.makedirs(OUT, exist_ok=True)
S = json.load(open(os.path.join(ROOT, 'assets', 'runtime', 'sprites.json'), encoding='utf-8'))


def checker(w, h, s=8):
    im = Image.new('RGB', (w, h), (200, 200, 200))
    d = ImageDraw.Draw(im)
    for y in range(0, h, s):
        for x in range(0, w, s):
            if (x // s + y // s) % 2:
                d.rectangle([x, y, x + s - 1, y + s - 1], fill=(150, 150, 150))
    return im


def sheet(group_names, name, display_scale=0.5):
    items = []
    for g in group_names:
        for k, e in S[g].items():
            items.append((g + ':' + k, e))
    bgs = [(16, 13, 24), (245, 237, 240), None]
    cw = max(int(e['size'][0] * display_scale) for _, e in items) + 24
    ch = max(int(e['size'][1] * display_scale) for _, e in items) + 40
    W, H = cw * len(items), ch * len(bgs)
    out = Image.new('RGB', (W, H), (0, 0, 0))
    d = ImageDraw.Draw(out)
    for r, bg in enumerate(bgs):
        for c, (label, e) in enumerate(items):
            cell = checker(cw, ch) if bg is None else Image.new('RGB', (cw, ch), bg)
            im = Image.open(os.path.join(ROOT, e['file'])).convert('RGBA')
            im = im.resize((max(1, int(im.width * display_scale)), max(1, int(im.height * display_scale))), Image.BILINEAR)
            ox, oy = (cw - im.width) // 2, ch - im.height - 22
            cell.paste(im, (ox, oy), im)
            cd = ImageDraw.Draw(cell)
            if 'pivot' in e:
                px, py = ox + e['pivot'][0] * display_scale, oy + e['pivot'][1] * display_scale
                cd.line([px - 6, py, px + 6, py], fill=(0, 255, 120), width=2)
                cd.line([px, py - 6, px, py + 6], fill=(0, 255, 120), width=2)
                hb = [v * display_scale for v in e['hitbox']]
                cd.rectangle([ox + hb[0], oy + hb[1], ox + hb[0] + hb[2], oy + hb[1] + hb[3]], outline=(0, 160, 255))
            cd.text((4, ch - 18), label, fill=(255, 80, 80))
            out.paste(cell, (c * cw, r * ch))
    out.save(os.path.join(OUT, name))
    print(name, out.size)


def icon_sheet():
    items = list(S['items'].items()) + list(S['skills'].items())
    cell = 64
    cols = 16
    rows = (len(items) + cols - 1) // cols
    out = Image.new('RGB', (cols * cell, rows * cell * 2), (0, 0, 0))
    for half, bg in enumerate([(33, 27, 43), (245, 237, 240)]):
        for i, (k, e) in enumerate(items):
            c = Image.new('RGB', (cell, cell), bg)
            im = Image.open(os.path.join(ROOT, e['file'])).convert('RGBA').resize((48, 48), Image.LANCZOS)
            c.paste(im, (8, 8), im)
            out.paste(c, ((i % cols) * cell, (half * rows + i // cols) * cell))
    out.save(os.path.join(OUT, 'assets_icons_48.png'))
    print('icons', out.size)


if __name__ == '__main__':
    sheet(['monsters'], 'assets_monsters_battle.png')
    sheet(['bosses'], 'assets_bosses_battle.png')
    sheet(['hero'], 'assets_hero_battle.png')
    icon_sheet()
