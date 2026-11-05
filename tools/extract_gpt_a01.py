#!/usr/bin/env python3
"""GPT package A01: 8 key poses for each tier-1 promoted form.

Sources (never modified): assets/source/gpt_a01/poses_<id>.png — 1536x1024 RGBA with
real alpha, 4x2 cells of 384x512, order idle, step, windup, contact, recovery, hit,
skill, victory — plus atlas.json (rects, suggested pivots).

Following the package notes:
- plain alpha compositing, no colour key (faint alpha <= 32 residue is cleared);
- ONE scale per sheet, from the idle visible body height = that class's base-form
  body height, so poses never change size when they switch;
- feet pivot measured from the shoes near the pelvis column (weapons / effects that
  hang below the feet are ignored), horizontal pivot at the pelvis.

A missing sheet (e.g. poses_wizard1.png, truncated upload) is skipped: drop the file
in and rerun this script, nothing else changes.
Writes assets/runtime/hero_pose_promo_<branch>_<pose>.webp and sprites.json hero entries
'pose_promo_<branch>_<pose>'.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from extract_assets import bleed_rgb, body_box, save_webp  # noqa: E402
from extract_v4 import BASE_H, OUT, META  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'source', 'gpt_a01')
NAMES = {'idle': 'idle', 'step': 'step', 'windup': 'anticipation', 'contact': 'thrust',
         'recovery': 'recovery', 'hit': 'hit', 'skill': 'cast', 'victory': 'victory'}
ALPHA_FLOOR = 33 / 255          # residue below this is cleared (package QA: alpha 1..32 specks)


def largest_component_mask(mask):
    """Keep components that are reasonably large (drops floating specks)."""
    from scipy import ndimage  # noqa: WPS433
    lab, n = ndimage.label(mask)
    if n == 0:
        return mask
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    keep = np.zeros(n + 1, bool)
    big = sizes.max()
    for i, s in enumerate(sizes, start=1):
        if s >= max(40, big * 0.004):
            keep[i] = True
    return keep[lab]


def metrics(solid):
    rows = solid.sum(axis=1)
    filled = rows[rows > 0]
    thr = max(4, np.median(filled) * 0.22)
    top = int(np.nonzero(rows > thr)[0].min())
    bottom_any = int(np.nonzero(rows > 0)[0].max())
    h = bottom_any - top
    # pelvis column: mean x of the band 52..62% down the body
    y0, y1 = top + int(h * 0.52), top + int(h * 0.62)
    ys, xs = np.nonzero(solid[y0:y1])
    px = float(np.median(xs)) if len(xs) else solid.shape[1] / 2
    # feet: lowest row with solid pixels within 0.28*h of the pelvis column
    win = int(h * 0.28)
    lo, hi = max(0, int(px) - win), min(solid.shape[1], int(px) + win)
    bottom = bottom_any
    for y in range(bottom_any, top, -1):
        if solid[y, lo:hi].sum() >= 3:
            bottom = y
            break
    return top, bottom, px


def main():
    atlas = json.load(open(os.path.join(SRC, 'atlas.json')))
    sprites = json.load(open(META))
    hero = sprites['hero']
    done = []
    for asset in atlas['assets']:
        path = os.path.join(SRC, asset['file'])
        branch = asset['id'].rstrip('0123456789')
        if not os.path.exists(path):
            print('skip (missing)', asset['file'])
            continue
        board = np.array(Image.open(path).convert('RGBA'))
        cells = []
        for fr in asset['frames']:
            x, y, w, h = fr['rect']
            cell = board[y:y + h, x:x + w].copy()
            a = cell[:, :, 3].astype(np.float32) / 255
            a[a < ALPHA_FLOOR] = 0
            solid = largest_component_mask(a > 0.5)
            # drop alpha outside the kept components' neighbourhood (specks)
            from scipy import ndimage  # noqa: WPS433
            near = ndimage.binary_dilation(solid, iterations=6)
            a[~near] = 0
            cell[:, :, 3] = (a * 255).astype(np.uint8)
            cell[cell[:, :, 3] == 0, :3] = 0
            cells.append((fr, cell, solid))
        t0, b0, _ = metrics(cells[0][2])
        scale = BASE_H / (b0 - t0)
        for fr, cell, solid in cells:
            top, bottom, px = metrics(solid)
            ys, xs = np.nonzero(cell[:, :, 3] > 0)
            pad = 4
            ty0, ty1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, cell.shape[0])
            tx0, tx1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, cell.shape[1])
            img = Image.fromarray(cell[ty0:ty1, tx0:tx1], 'RGBA')
            nw, nh = max(1, round(img.width * scale)), max(1, round(img.height * scale))
            out = bleed_rgb(img).resize((nw, nh), Image.LANCZOS)
            name = NAMES[fr['name']]
            fname = f'hero_pose_promo_{branch}_{name}.webp'
            save_webp(out, os.path.join(OUT, fname))
            hero[f'pose_promo_{branch}_{name}'] = {
                'id': f'pose_promo_{branch}_{name}', 'branch': branch, 'tier': 1, 'pose': name,
                'file': 'assets/runtime/' + fname, 'source': f'gpt_a01/{asset["file"]}',
                'sourceRect': fr['rect'], 'trimOffset': [int(fr['rect'][0] + tx0), int(fr['rect'][1] + ty0)],
                'size': [nw, nh], 'scale': round(scale, 4), 'bodyHeightPx': round((bottom - top) * scale, 1),
                'pivot': [round((px - tx0) * scale, 1), round((bottom - ty0) * scale, 1)],
                'suggestedPivot': fr.get('suggestedPivot'),
                'hitbox': [round(v * scale, 1) for v in body_box(solid[ty0:ty1, tx0:tx1])],
                'flying': False, 'mirrored': False, 'status': 'RUNTIME_KEY_POSE',
            }
        sprites['sources'][f'gpt_a01/{asset["file"]}'] = {'status': 'GPT_A01_POSE_SHEET', 'note': '8 key poses, real alpha (no colour key)'}
        done.append(branch)
        print(branch, 'scale', round(scale, 3), [round(hero[f'pose_promo_{branch}_{n}']['bodyHeightPx']) for n in NAMES.values()])
    json.dump(sprites, open(META, 'w'), ensure_ascii=False, indent=1)
    print('done', done)


if __name__ == '__main__':
    sys.exit(main())
