#!/usr/bin/env python3
"""GPT packages O3 / O4 / O5 (run AFTER extract_gpt_n.py, which rewrites sprites.json["steeds"]).

O3: walk 4 + basic attack 4 frames for the redrawn 3차 and new 4차 forms (16 sheets).

Sources (never modified): assets/source/gpt_o/<branch>_t<3|4>_cycle.png — 1536x1024 RGBA, real
alpha, 4x2 (top: walk1..4, bottom: atk1..4; atk3 = impact, as in J4).
Same cutting as O1/O2 (tools/extract_gpt_o.py: adaptive grid, component ownership, haze
removal), and the same scale rule as the O1/O2 key poses — body height of walk1 = BASE_H and the
feet pivot at the pelvis column (extract_gpt_a01.metrics) — so cycle frames and poses line up.
Replaces hero.cyc_<branch>_t3_* (old J4 tier-3 design) and adds hero.cyc_<branch>_t4_*.

O4: ride_t34_a.png (세린 row 1, 엘레나 row 2) / ride_t34_b.png (리라 row 1, 녹스 row 2), 4x2:
per row = <branchA>_t3, <branchB>_t3, <branchA>_t4, <branchB>_t4, seated pose as GPT N3.
Same alpha remap / cleanup, scale and anchor convention as extract_gpt_n.rides (hips = seat
contact, read on a 20px grid at 2x of every cell and checked by overlay; one point per row).
→ steeds.ride_<branch>_t3_<cls> (replaces the N3 tier-3 cells) and steeds.ride_<branch>_t4_<cls>.

O5: icons_o5.png 4x3 (384x341) → assets/runtime/icon_<key>.webp (128px), sprites.json["uiIcons"].
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from extract_assets import bleed_rgb, save_webp  # noqa: E402
from extract_v4 import BASE_H, OUT, META  # noqa: E402
from extract_gpt_a01 import metrics  # noqa: E402
from extract_gpt_o import BRANCHES, SRC, cell_layers, pad, split_sheet  # noqa: E402
from extract_gpt_n import PAD, RIDE_H, bbox, dehaze, save  # noqa: E402

FRAMES = ['walk1', 'walk2', 'walk3', 'walk4', 'atk1', 'atk2', 'atk3', 'atk4']


RIDE_ROWS = {'ride_t34_a.png': [('warrior', 'knight', 'berserker'), ('mage', 'wizard', 'warlock')],
             'ride_t34_b.png': [('archer', 'ranger', 'hunter'), ('rogue', 'assassin', 'trickster')]}
# hips (seat contact under the buttocks, rear end of the thigh's lower contour) in cell px
RIDE_HIP = {'ride_t34_a.png': [(225, 305), (225, 305)], 'ride_t34_b.png': [(225, 310), (225, 310)]}
ICONS = ['oath_warrior_a', 'oath_warrior_b', 'oath_mage_a', 'oath_mage_b', 'oath_archer_a', 'oath_archer_b',
         'oath_rogue_a', 'oath_rogue_b', 'tier4_emblem', 'tier4_trial', 'slot6_key', 'oath_swap']
ICON_PX = 128


def rides(sprites):
    st = sprites['steeds']
    for sheet, rows in RIDE_ROWS.items():
        path = os.path.join(SRC, sheet)
        if not os.path.exists(path):
            print('skip (missing)', sheet)
            continue
        board = np.array(Image.open(path).convert('RGBA'))
        ch, cw = 512, 384
        k = RIDE_H / (0.75 * ch)
        for r, (cls, ba, bb_) in enumerate(rows):
            hx, hy = RIDE_HIP[sheet][r]
            for c, form in enumerate([f'{ba}_t3', f'{bb_}_t3', f'{ba}_t4', f'{bb_}_t4']):
                cell = board[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw].copy()
                cell[cell[:, :, 3] < 8, 3] = 0
                f = dehaze(cell, sheet)
                bx = bbox(f[:, :, 3])
                if bx is None:
                    continue
                x0, y0 = max(bx[0] - PAD, 0), max(bx[1] - PAD, 0)
                x1, y1 = min(bx[2] + PAD, cw), min(bx[3] + PAD, ch)
                m = save(f[y0:y1, x0:x1], f'ride_{form}_{cls}', RIDE_H, scale=k)
                m.update({'hx': round((hx - x0) / (x1 - x0), 3), 'hy': round((hy - y0) / (y1 - y0), 3),
                          'hipFromTop': round(hy / ch, 3), 'cellH': round(ch * k, 1), 'source': f'gpt_o/{sheet} row {r + 1} cell {c + 1}'})
                st[f'ride_{form}_{cls}'] = m
                print(f'ride_{form}_{cls} {m["w"]}x{m["h"]} hip=({m["hx"]},{m["hy"]})')
        sprites['sources'][f'gpt_o/{sheet}'] = {'status': 'GPT_O4_RIDE', 'note': '3차·4차 seated rider poses (O4)'}


def icons(sprites):
    path = os.path.join(SRC, 'icons_o5.png')
    if not os.path.exists(path):
        print('skip (missing) icons_o5.png')
        return
    board = np.array(Image.open(path).convert('RGBA'))
    H, W = board.shape[:2]
    cw, ch = W // 4, H // 3
    ui = sprites.setdefault('uiIcons', {})
    for i, key in enumerate(ICONS):
        r, c = divmod(i, 4)
        cell = board[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw].copy()
        cell[cell[:, :, 3] < 8, 3] = 0
        f = dehaze(cell, 'default')
        bx = bbox(f[:, :, 3])
        if bx is None:
            continue
        x0, y0, x1, y1 = bx
        side = max(x1 - x0, y1 - y0) + 2 * PAD
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        sq = np.zeros((side, side, 4), np.uint8)
        sx0, sy0 = cx - side // 2, cy - side // 2
        for yy in range(side):
            y = sy0 + yy
            if 0 <= y < ch:
                xa, xb = max(sx0, 0), min(sx0 + side, cw)
                sq[yy, xa - sx0:xb - sx0] = f[y, xa:xb]
        img = bleed_rgb(Image.fromarray(sq)).resize((ICON_PX, ICON_PX), Image.LANCZOS)
        fn = f'icon_{key}.webp'
        save_webp(img, os.path.join(OUT, fn), quality=88)
        ui[key] = {'file': 'assets/runtime/' + fn, 'w': ICON_PX, 'h': ICON_PX, 'source': f'gpt_o/icons_o5.png cell {i + 1}'}
    sprites['sources']['gpt_o/icons_o5.png'] = {'status': 'GPT_O5_ICONS', 'note': '서약 8 + 초월 문장·시련·6번 칸·서약 바꾸기'}
    print('icons', len(ui))


def main():
    sprites = json.load(open(META))
    hero = sprites['hero']
    for branch in BRANCHES:
        for tier in (3, 4):
            fn_src = f'{branch}_t{tier}_cycle.png'
            path = os.path.join(SRC, fn_src)
            if not os.path.exists(path):
                print('skip (missing)', fn_src)
                continue
            board = np.array(Image.open(path).convert('RGBA'))
            rects = split_sheet(board[:, :, 3])
            cells = cell_layers(board, rects)
            t0, b0, _ = metrics(cells[0][1])
            scale = BASE_H / (b0 - t0)
            hs, piv = [], []
            for pose, (crop, body, rect) in zip(FRAMES, cells):
                crop, body = pad(crop, body)
                top, bottom, px = metrics(body)
                # walk/attack frames: the feet are always the lowest solid row (a long lunge puts the
                # back foot far from the pelvis column, where metrics() looks), so ground on that
                rows = np.nonzero((body).any(axis=1))[0]
                bottom = int(rows.max())
                img = bleed_rgb(Image.fromarray(crop, 'RGBA'))
                nw, nh = max(1, round(img.width * scale)), max(1, round(img.height * scale))
                out = img.resize((nw, nh), Image.LANCZOS)
                key = f'cyc_{branch}_t{tier}_{pose}'
                fn = f'hero_{key}.webp'
                save_webp(out, os.path.join(OUT, fn))
                hero[key] = {
                    'id': key, 'pose': pose, 'file': 'assets/runtime/' + fn, 'size': [nw, nh], 'scale': round(scale, 4),
                    'bodyHeightPx': round((bottom - top) * scale, 1), 'pivot': [round(px * scale, 1), round(bottom * scale, 1)],
                    'sourceRect': list(rect), 'status': 'RUNTIME_CYCLE_FRAME', 'source': 'gpt_o/' + fn_src, 'matte': 'alpha',
                }
                hs.append(round((bottom - top) * scale))
                piv.append(round(px * scale))
            sprites['sources'][f'gpt_o/{fn_src}'] = {'status': 'GPT_O3_CYCLE', 'note': f'{tier}차 walk 4 + attack 4 (O3), real alpha'}
            print(f'{branch:10s} t{tier} dehaze {cell_layers.dehazed:6d} scale {scale:.3f} heights {hs} pivotX {piv}')
    rides(sprites)
    icons(sprites)
    json.dump(sprites, open(META, 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    sys.exit(main())
