#!/usr/bin/env python3
"""8 key poses for mage / archer / rogue (like Serin's serin_poses.png).

Boards: assets/source/generated/poses/<cls>_poses.png (4x2 cells: idle, step,
anticipation, attack, recovery, hit, cast, victory; flat #1c1726, facing right) and
<cls>_poses_alpha.png (Higgsfield background removal of the same board, used as the
matte because the colour key eats dark cloth). Originals are never modified.

One scale per class (from the idle body height = that class's base figure height),
so poses do not change size when they switch. Pivot = feet centre.
Writes assets/runtime/hero_pose_<cls>_<pose>.webp and sprites.json hero entries
'pose_<cls>_<pose>'.  Run after tools/extract_v4.py.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from extract_assets import bleed_rgb, body_box, save_webp  # noqa: E402
from extract_v4 import BASE_H, clean, columns, OUT, META  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POSES_DIR = os.path.join(ROOT, 'assets', 'source', 'generated', 'poses')
POSES = ['idle', 'step', 'anticipation', 'thrust', 'recovery', 'hit', 'cast', 'victory']   # renderer names


def row_cut(mask):
    rows = mask.sum(axis=1).astype(np.float64)
    H = mask.shape[0]
    lo, hi = int(H * 0.4), int(H * 0.6)
    seg = np.convolve(rows[lo:hi], np.ones(9) / 9, mode='same')
    return lo + int(np.argmin(seg))


def body_metrics(kmask):
    rows = kmask.sum(axis=1)
    filled = rows[rows > 0]
    thr = max(4, np.median(filled) * 0.22)
    top = int(np.nonzero(rows > thr)[0].min())
    bottom = int(np.nonzero(rows > 0)[0].max())
    return top, bottom


def cut_cell(rgb, matte, x0, x1, y0, y1):
    crop = rgb[y0:y1, x0:x1]
    alpha, keep, dropped = clean(matte[y0:y1, x0:x1])
    ys, xs = np.nonzero(alpha > 0.03)
    pad = 6
    ty0, ty1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, crop.shape[0])
    tx0, tx1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, crop.shape[1])
    rgba = np.dstack([crop, (alpha * 255).astype(np.uint8)])[ty0:ty1, tx0:tx1].copy()
    rgba[rgba[:, :, 3] == 0, :3] = 0
    kmask = keep[ty0:ty1, tx0:tx1]
    return Image.fromarray(rgba, 'RGBA'), kmask, (x0 + tx0, y0 + ty0), dropped


def main():
    sprites = json.load(open(META))
    for cls in ['mage', 'archer', 'rogue']:
        rgb = np.array(Image.open(os.path.join(POSES_DIR, f'{cls}_poses.png')).convert('RGB'))
        matte = np.array(Image.open(os.path.join(POSES_DIR, f'{cls}_poses_alpha.png')).convert('RGBA'))[:, :, 3].astype(np.float32) / 255
        mask = matte > 0.5
        rc = row_cut(mask)
        cells = []
        for (ry0, ry1) in [(0, rc), (rc, rgb.shape[0])]:
            for (cx0, cx1) in columns(mask[ry0:ry1], 4):
                cells.append((cx0, cx1, ry0, ry1))
        cut = [cut_cell(rgb, matte, *c) for c in cells]
        t0, b0 = body_metrics(cut[0][1])
        scale = BASE_H / (b0 - t0)          # idle body = base figure height
        for name, (img, kmask, (ox, oy), dropped), c in zip(POSES, cut, cells):
            top, bottom = body_metrics(kmask)
            nw, nh = max(1, round(img.width * scale)), max(1, round(img.height * scale))
            out = bleed_rgb(img).resize((nw, nh), Image.LANCZOS)
            fys, fxs = np.nonzero(kmask)
            body_h = bottom - top
            band = fys >= bottom - max(6, int(body_h * 0.08))
            px, py = float(fxs[band].mean()), float(bottom)
            fname = f'hero_pose_{cls}_{name}.webp'
            save_webp(out, os.path.join(OUT, fname))
            sprites['hero'][f'pose_{cls}_{name}'] = {
                'id': f'pose_{cls}_{name}', 'cls': cls, 'pose': name, 'file': 'assets/runtime/' + fname,
                'sourceRect': [c[0], c[2], c[1] - c[0], c[3] - c[2]], 'trimOffset': [int(ox), int(oy)],
                'size': [nw, nh], 'scale': round(scale, 4), 'bodyHeightPx': round(body_h * scale, 1),
                'pivot': [round(px * scale, 1), round(py * scale, 1)], 'hitbox': [round(v * scale, 1) for v in body_box(kmask)],
                'flying': False, 'mirrored': False, 'droppedBleedComponents': dropped, 'status': 'RUNTIME_KEY_POSE',
            }
        sprites['sources'][f'generated/poses/{cls}_poses.png'] = {'status': 'GENERATED_BOARD', 'note': 'Higgsfield gpt_image_2_5, 8 key poses 4x2; matte = Higgsfield background removal'}
        print(cls, 'scale', round(scale, 3), [round(sprites['hero'][f'pose_{cls}_{p}']['bodyHeightPx']) for p in POSES])
    json.dump(sprites, open(META, 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    sys.exit(main())
