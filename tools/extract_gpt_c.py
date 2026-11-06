"""GPT package C (monster 4-action boards) → assets/runtime/mon_<id>_<act>.webp.

assets/source/gpt_c/mon_act_NN.png: 1536x1024, 4 cols x 2 rows (384x512 cells),
real alpha. Row 1 = M(2N-1), row 2 = M(2N). Columns: idle / attack / hit / dead.
All four frames of a monster share one scale, chosen so the idle frame is as tall
as the current static sprite (bodyHeightPx, stored at 2x). Pivot = feet (lowest
solid row, centre of its pixels). sprites.json monsters[id] keeps the old static
fields (fallback) and gains `frames`.
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(__file__))
from extract_assets import bleed_rgb, save_webp  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets/source/gpt_c')
OUT = os.path.join(ROOT, 'assets/runtime')
META = os.path.join(OUT, 'sprites.json')
ACTS = ['idle', 'attack', 'hit', 'dead']
PAD = 6


def cut(cell):
    a = cell[:, :, 3].astype(np.float32)
    a[a < 10] = 0
    solid = a > 40
    lab, n = ndimage.label(ndimage.binary_dilation(solid, iterations=4))
    if n > 1:   # drop specks far from the body
        sz = ndimage.sum(solid, lab, range(1, n + 1))
        keep = np.isin(lab, [i + 1 for i in range(n) if sz[i] >= max(40, 0.01 * sz.max())])
        a[~keep] = 0
    cell = cell.copy()
    cell[:, :, 3] = a.astype(np.uint8)
    ys, xs = np.nonzero(a > 0)
    edge = {'left': bool(xs.min() == 0), 'right': bool(xs.max() == cell.shape[1] - 1), 'top': bool(ys.min() == 0), 'bottom': bool(ys.max() == cell.shape[0] - 1)}
    y0, y1 = max(ys.min() - PAD, 0), min(ys.max() + PAD + 1, cell.shape[0])
    x0, x1 = max(xs.min() - PAD, 0), min(xs.max() + PAD + 1, cell.shape[1])
    crop = cell[y0:y1, x0:x1]
    s = crop[:, :, 3] > 100
    rows = np.nonzero(s.any(axis=1))[0]
    body_h = rows.max() - rows.min() + 1
    foot = rows.max()
    band = s[max(foot - max(4, body_h // 20), 0):foot + 1]
    fx = np.nonzero(band.any(axis=0))[0].mean()
    return crop, body_h, (float(fx), float(foot)), edge


def main():
    sprites = json.load(open(META))
    mons = sprites['monsters']
    for n in range(1, 11):
        board = np.array(Image.open(os.path.join(SRC, f'mon_act_{n:02d}.png')).convert('RGBA'))
        H, W = board.shape[:2]
        cw, ch = W // 4, H // 2
        for row in range(2):
            mid = f'M{2 * n - 1 + row:02d}'
            cuts = [cut(board[row * ch:(row + 1) * ch, c * cw:(c + 1) * cw]) for c in range(4)]
            target = mons[mid]['bodyHeightPx']
            scale = target / cuts[0][1]
            frames = {}
            for act, (crop, bh, (px, py), edge) in zip(ACTS, cuts):
                img = Image.fromarray(crop)
                w, h = img.size
                nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
                img = bleed_rgb(img).resize((nw, nh), Image.LANCZOS)
                fn = f'mon_{mid}_{act}.webp'
                save_webp(img, os.path.join(OUT, fn))
                frames[act] = {'file': 'assets/runtime/' + fn, 'size': [nw, nh], 'pivot': [round(px * scale, 1), round(py * scale, 1)],
                               'bodyHeightPx': round(bh * scale, 1), 'touchesCellEdge': edge}
                if any(edge.values()):
                    print('  edge', mid, act, edge)
            mons[mid]['frames'] = frames
            mons[mid]['framesSource'] = f'gpt_c/mon_act_{n:02d}.png row {row + 1}'
            print(mid, mons[mid]['name'], 'scale', round(scale, 3), [f['size'] for f in frames.values()])
    sprites.setdefault('sources', {})['gpt_c/mon_act_*.png'] = 'GPT package C — monster idle/attack/hit/dead'
    text = json.dumps(sprites, ensure_ascii=False, indent=1)
    open(META, 'w').write(text)


if __name__ == '__main__':
    main()
