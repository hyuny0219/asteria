#!/usr/bin/env python3
"""GPT package O1/O2: 3차 다시 그리기 + 4차 초월, 8 key poses per form (16 sheets).

Sources (never modified): assets/source/gpt_o/poses_<branch>_t<3|4>.png — 1536x1024 RGBA with
real alpha, a loose 4x2 grid (idle, step, windup, contact, recovery, hit, skill, victory).
Unlike A02 the figures do not stay inside the 384x512 cells (staffs, capes and floating parts —
knight shards, assassin daggers, trickster masks, ranger light arrows — cross the lines), so:
  1. split the sheet at the emptiest column / row near each nominal cell line (adaptive grid);
  2. label alpha components over the whole sheet and give each one to the cell holding its
     centroid (floating parts stay with their figure even when they poke past the line);
     a component that spans two cells (figures touching) is cut at the adaptive line;
  3. drop specks (< 30 px) and alpha below ALPHA_FLOOR, keep soft edges.
Scale per sheet from the idle body (largest component) height = BASE_H, feet pivot from
the body only (tools/extract_gpt_a01.metrics). Same runtime keys as A02 for tier 3
(replaces hero_pose_promo_<branch>_t3_*), new keys for tier 4.
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(__file__))
from extract_assets import bleed_rgb, body_box, save_webp  # noqa: E402
from extract_v4 import BASE_H, OUT, META  # noqa: E402
from extract_gpt_a01 import ALPHA_FLOOR, metrics  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'source', 'gpt_o')
BRANCHES = ['knight', 'berserker', 'wizard', 'warlock', 'ranger', 'hunter', 'assassin', 'trickster']
POSES = ['idle', 'step', 'anticipation', 'thrust', 'recovery', 'hit', 'cast', 'victory']
PORTRAIT_H = 640
SEARCH = 90           # px either side of a nominal cell line


def valley(proj, centre):
    lo, hi = centre - SEARCH, centre + SEARCH
    seg = proj[lo:hi]
    m = seg.min()
    idx = np.nonzero(seg == m)[0]
    return int(lo + idx[np.argmin(np.abs(idx + lo - centre))])


def split_sheet(a):
    """Adaptive cell rects [(x0,y0,x1,y1)] * 8 in pose order."""
    H, W = a.shape
    ysplit = valley((a > 32).sum(axis=1), H // 2)
    rects = []
    for (r0, r1) in ((0, ysplit), (ysplit, H)):
        colp = (a[r0:r1] > 32).sum(axis=0)
        xs = [0] + [valley(colp, c) for c in (W // 4, W // 2, 3 * W // 4)] + [W]
        rects += [(xs[i], r0, xs[i + 1], r1) for i in range(4)]
    return rects


HAZE_ALPHA = 0.5      # semi-transparent ...
HAZE_SAT = 0.22       # ... and nearly grey ...
HAZE_GAP = 4          # ... and more than this many px away from solid paint = baked background haze


def dehaze(board, a):
    """wizard_t3 / trickster_t4 came with a pale fog baked in at alpha 0.13..0.5 around the figure.
    Coloured spell light (gold rings, cyan sparks) is saturated and survives."""
    rgb = board[:, :, :3].astype(np.float32) / 255
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    near = ndimage.binary_dilation(a >= 0.8, iterations=HAZE_GAP)
    haze = (a > 0) & (a < HAZE_ALPHA) & (sat < HAZE_SAT) & ~near
    a[haze] = 0
    return int(haze.sum())


def cell_layers(board, rects):
    a = board[:, :, 3].astype(np.float32) / 255
    a[a < ALPHA_FLOOR] = 0
    cell_layers.dehazed = dehaze(board, a)
    lab, n = ndimage.label(a > 0, structure=np.ones((3, 3)))
    objs = ndimage.find_objects(lab)
    sizes = ndimage.sum(np.ones_like(a), lab, range(1, n + 1))
    coms = ndimage.center_of_mass(a > 0, lab, range(1, n + 1))
    owner = np.full(lab.shape, -1, np.int16)
    for i in range(n):
        if sizes[i] < 30:
            continue
        cy, cx = coms[i]
        cell = next(k for k, (x0, y0, x1, y1) in enumerate(rects) if x0 <= cx < x1 and y0 <= cy < y1)
        sl = objs[i]
        m = lab[sl] == i + 1
        sub = owner[sl]
        sub[m] = cell
    # a component spanning two figures: pixels outside the owner's rect go to the rect they are in
    # (only if that rect has a body of its own, i.e. figures touching), else stay with the owner
    out = []
    yy, xx = np.mgrid[0:a.shape[0], 0:a.shape[1]]
    for k, (x0, y0, x1, y1) in enumerate(rects):
        inside = (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)
        mine = owner == k
        # pixels of my components that lie deep in another cell's rect are cut away when they
        # touch that cell's own pixels (touching figures)
        other = (owner >= 0) & (owner != k) & inside
        mine_out = mine & ~inside
        if mine_out.any():
            for j, (u0, v0, u1, v1) in enumerate(rects):
                if j == k:
                    continue
                r = mine_out & (xx >= u0) & (xx < u1) & (yy >= v0) & (yy < v1)
                if r.any() and ((owner == j) & ndimage.binary_dilation(r, iterations=3)).any():
                    mine &= ~r
        mask = mine | (inside & (owner == -1) & (a > 0) & False)
        del other
        cell = board.copy()
        alpha = (a * 255).astype(np.uint8)
        alpha[~mask] = 0
        cell[:, :, 3] = alpha
        cell[alpha == 0, :3] = 0
        ys, xs_ = np.nonzero(alpha)
        y0b, y1b, x0b, x1b = ys.min(), ys.max() + 1, xs_.min(), xs_.max() + 1
        crop = cell[y0b:y1b, x0b:x1b]
        # body = largest component inside this crop
        l2, n2 = ndimage.label(crop[:, :, 3] > 128)
        if n2:
            s2 = ndimage.sum(np.ones(l2.shape), l2, range(1, n2 + 1))
            body = l2 == (int(np.argmax(s2)) + 1)
        else:
            body = crop[:, :, 3] > 0
        out.append((crop, body, (int(x0b), int(y0b), int(x1b - x0b), int(y1b - y0b))))
    return out


def pad(crop, body, p=4):
    c = np.pad(crop, ((p, p), (p, p), (0, 0)))
    b = np.pad(body, ((p, p), (p, p)))
    return c, b


def main():
    sprites = json.load(open(META))
    hero, portraits = sprites['hero'], sprites['portraits']
    report = []
    for branch in BRANCHES:
        for tier in (3, 4):
            fname_src = f'poses_{branch}_t{tier}.png'
            path = os.path.join(SRC, fname_src)
            if not os.path.exists(path):
                print('skip (missing)', fname_src)
                continue
            board = np.array(Image.open(path).convert('RGBA'))
            rects = split_sheet(board[:, :, 3])
            cells = cell_layers(board, rects)
            t0, b0, _ = metrics(cells[0][1])
            scale = BASE_H / (b0 - t0)
            heights = []
            for name, (crop, body, rect) in zip(POSES, cells):
                crop, body = pad(crop, body)
                top, bottom, px = metrics(body)
                img = bleed_rgb(Image.fromarray(crop, 'RGBA'))
                nw, nh = max(1, round(img.width * scale)), max(1, round(img.height * scale))
                out = img.resize((nw, nh), Image.LANCZOS)
                key = f'pose_promo_{branch}_t{tier}_{name}'
                fn = f'hero_{key}.webp'
                save_webp(out, os.path.join(OUT, fn))
                entry = {
                    'id': key, 'branch': branch, 'tier': tier, 'pose': name, 'form': f'{branch}_t{tier}',
                    'file': 'assets/runtime/' + fn, 'source': f'gpt_o/{fname_src}',
                    'sourceRect': list(rect), 'size': [nw, nh], 'scale': round(scale, 4),
                    'bodyHeightPx': round((bottom - top) * scale, 1),
                    'pivot': [round(px * scale, 1), round(bottom * scale, 1)],
                    'hitbox': [round(v * scale, 1) for v in body_box(body)],
                    'flying': False, 'mirrored': False, 'status': 'RUNTIME_KEY_POSE',
                }
                hero[key] = entry
                heights.append(round(entry['bodyHeightPx']))
                if name == 'idle':
                    hero[f'promo_{branch}_t{tier}'] = dict(entry, id=f'promo_{branch}_t{tier}', cls=hero.get(f'promo_{branch}_t3', {}).get('cls'), status='RUNTIME_STATIC_SPRITE')
                    ps = PORTRAIT_H / (b0 - t0)
                    pw, ph = max(1, round(img.width * ps)), max(1, round(img.height * ps))
                    pname = f'portrait_promo_{branch}_t{tier}.webp'
                    save_webp(img.resize((pw, ph), Image.LANCZOS), os.path.join(OUT, pname))
                    portraits[f'promo_{branch}_t{tier}'] = {
                        'id': f'{branch}_t{tier}', 'file': 'assets/runtime/' + pname, 'source': f'gpt_o/{fname_src}',
                        'sourceRect': list(rect), 'size': [pw, ph], 'scale': round(ps, 4),
                        'pivot': [round(px * ps, 1), round(bottom * ps, 1)], 'status': 'RUNTIME_PORTRAIT',
                    }
            sprites['sources'][f'gpt_o/{fname_src}'] = {'status': 'GPT_O_POSE_SHEET', 'note': f'{tier}차 8 key poses (O{tier - 2}), real alpha, adaptive grid + component ownership'}
            report.append((branch, tier, round(scale, 3), heights, [r[0] for r in rects[:4]], rects[4][1]))
            print(f'{branch:10s} t{tier} dehaze {cell_layers.dehazed:6d} scale {scale:.3f} heights {heights} xsplits {[r[0] for r in rects[1:4]]} ysplit {rects[4][1]}')
    json.dump(sprites, open(META, 'w'), ensure_ascii=False, indent=1)
    print('done', len(report))


if __name__ == '__main__':
    sys.exit(main())
