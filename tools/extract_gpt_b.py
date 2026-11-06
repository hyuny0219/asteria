"""GPT package B (projectiles + hit effects) → assets/runtime/fx_<name>.webp.

Source: assets/source/gpt_b/fx_projectiles.png (1536x1024, 4x3 cells, real alpha).
Each cell is trimmed to its alpha box (+pad), scaled so the long side <= MAX,
and recorded in sprites.json["fx"] with its anchor:
  tip  = projectiles: the leading point (rightmost / lowest for the arrow rain)
  c    = hit effects: alpha-weighted centre
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from extract_assets import bleed_rgb, save_webp  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets/source/gpt_b/fx_projectiles.png')
OUT = os.path.join(ROOT, 'assets/runtime')
META = os.path.join(OUT, 'sprites.json')
MAX = 256
PAD = 4
CELLS = [
    ('bolt', 'tip'), ('hex', 'tip'), ('arrow', 'tip'), ('arrow_glow', 'tip'),
    ('dagger', 'tip'), ('card', 'c'), ('meteor', 'tip'), ('rain', 'down'),
    ('hit', 'c'), ('hit_magic', 'c'), ('hit_poison', 'c'), ('crit', 'c'),
]


def main():
    board = Image.open(SRC).convert('RGBA')
    W, H = board.size
    cw, ch = W // 4, H // 3
    sprites = json.load(open(META))
    fx = {}
    for i, (name, anchor) in enumerate(CELLS):
        cx, cy = (i % 4) * cw, (i // 4) * ch
        cell = np.array(board.crop((cx, cy, cx + cw, cy + ch)))
        a = cell[:, :, 3].astype(np.float32)
        a[a < 8] = 0
        cell[:, :, 3] = a.astype(np.uint8)
        ys, xs = np.nonzero(a > 0)
        x0, x1 = max(xs.min() - PAD, 0), min(xs.max() + PAD + 1, cw)
        y0, y1 = max(ys.min() - PAD, 0), min(ys.max() + PAD + 1, ch)
        crop = cell[y0:y1, x0:x1]
        ca = crop[:, :, 3].astype(np.float32)
        h, w = ca.shape
        if anchor == 'tip':
            # leading point: rightmost column with solid alpha, its weighted row
            solid = ca > 128
            cols = np.nonzero(solid.any(axis=0))[0]
            tx = cols.max()
            rows = np.nonzero(solid[:, max(tx - 6, 0):tx + 1].any(axis=1))[0]
            ax, ay = tx / w, rows.mean() / h
        elif anchor == 'down':
            solid = ca > 128
            rows = np.nonzero(solid.any(axis=1))[0]
            ax, ay = 0.5, rows.max() / h
        else:
            tot = ca.sum()
            yy, xx = np.mgrid[0:h, 0:w]
            ax, ay = (xx * ca).sum() / tot / w, (yy * ca).sum() / tot / h
        img = Image.fromarray(crop)
        s = min(1.0, MAX / max(w, h))
        if s < 1:
            img = bleed_rgb(img).resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
        fn = f'fx_{name}.webp'
        save_webp(img, os.path.join(OUT, fn), quality=88)
        fx[name] = {'file': 'assets/runtime/' + fn, 'w': img.width, 'h': img.height, 'ax': round(float(ax), 3), 'ay': round(float(ay), 3)}
        print(name, img.size, fx[name]['ax'], fx[name]['ay'])
    sprites['fx'] = fx
    sprites.setdefault('sources', {})['gpt_b/fx_projectiles.png'] = 'GPT package B'
    json.dump(sprites, open(META, 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
