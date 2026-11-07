"""GPT package H (Serin 8 key poses, fixed thrust, real alpha) → assets/runtime/serin_<pose>.webp.

assets/source/gpt_h/serin_poses_fix.png + serin_poses_fix_atlas.json (cells 384x512).
One shared scale: idle solid-body height = 280 px (same as before, so sizes don't
change). Pivot: authored x from the atlas, feet row detected from alpha.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from extract_assets import bleed_rgb, save_webp  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets/source/gpt_h')
OUT = os.path.join(ROOT, 'assets/runtime')
META = os.path.join(OUT, 'sprites.json')
BODY = 280.0
PAD = 6


def main():
    sprites = json.load(open(META))
    atlas = json.load(open(os.path.join(SRC, 'serin_poses_fix_atlas.json')))
    board = np.array(Image.open(os.path.join(SRC, 'serin_poses_fix.png')).convert('RGBA'))
    cells = {}
    for fr in atlas['frames']:
        x, y, w, h = fr['rect']
        c = board[y:y + h, x:x + w].copy()
        c[:, :, 3][c[:, :, 3] < 10] = 0
        cells[fr['name']] = (c, fr['pivot'])
    def solid_h(c):
        rows = np.nonzero((c[:, :, 3] > 100).any(axis=1))[0]
        return rows.max() - rows.min() + 1
    scale = BODY / solid_h(cells['idle'][0])
    for name, (c, piv) in cells.items():
        a = c[:, :, 3]
        ys, xs = np.nonzero(a)
        edge = [bool(xs.min() == 0), bool(xs.max() == c.shape[1] - 1), bool(ys.min() == 0), bool(ys.max() == c.shape[0] - 1)]
        x0, x1 = max(xs.min() - PAD, 0), min(xs.max() + PAD + 1, c.shape[1])
        y0, y1 = max(ys.min() - PAD, 0), min(ys.max() + PAD + 1, c.shape[0])
        crop = c[y0:y1, x0:x1]
        s = crop[:, :, 3] > 100
        rows = np.nonzero(s.any(axis=1))[0]
        cols = np.nonzero(s.any(axis=0))[0]
        foot = rows.max()
        img = Image.fromarray(crop)
        nw, nh = round(img.width * scale), round(img.height * scale)
        img = bleed_rgb(img).resize((nw, nh), Image.LANCZOS)
        fn = f'serin_{name}.webp'
        save_webp(img, os.path.join(OUT, fn))
        e = sprites['hero'].get(name, {})
        e.update({'id': name, 'file': 'assets/runtime/' + fn, 'size': [nw, nh], 'scale': round(scale, 4),
                  'trimOffset': [int(x0), int(y0)], 'sourceRect': [0, 0, 384, 512],
                  'pivot': [round((piv[0] - x0) * scale, 1), round(foot * scale, 1)],
                  'bodyHeightPx': round((rows.max() - rows.min() + 1) * scale, 1),
                  'hitbox': [round(cols.min() * scale, 1), round(rows.min() * scale, 1), round((cols.max() - cols.min()) * scale, 1), round((rows.max() - rows.min()) * scale, 1)],
                  'pivotSource': 'gpt_h atlas x + alpha feet', 'source': 'gpt_h/serin_poses_fix.png', 'touchesCellEdge': edge,
                  'status': 'RUNTIME_STATIC_SPRITE'})
        e.pop('pivotAuto', None)
        sprites['hero'][name] = e
        print(name, (nw, nh), e['pivot'], e['bodyHeightPx'], 'edge' if any(edge) else '')
    sprites.setdefault('sources', {})['gpt_h/serin_poses_fix.png'] = 'GPT package H — Serin 8 key poses (thrust fixed, alpha)'
    text = json.dumps(sprites, ensure_ascii=False, indent=1)
    open(META, 'w').write(text)


if __name__ == '__main__':
    main()
