#!/usr/bin/env python3
"""GPT package A02: 8 key poses for every tier-2 / tier-3 promoted form (16 sheets).

Sources (never modified): assets/source/gpt_a02/poses_<id>.png — 1536x1024 RGBA with real
alpha, 4x2 cells of 384x512 (idle, step, windup, contact, recovery, hit, skill, victory)
plus atlas.json. Same rules as A01 (tools/extract_gpt_a01.py): plain alpha compositing,
one scale per sheet from the idle body height, feet pivot near the pelvis column.

These are new 2·3차 designs: the idle cell becomes that form's reference look, so it
also replaces the old generated single figure `promo_<branch>_t<tier>` (hero entry and
the promotion-screen portrait). Old generated tier23_* boards stay in assets/source.

Writes assets/runtime/hero_pose_promo_<branch>_t<tier>_<pose>.webp,
assets/runtime/portrait_promo_<branch>_t<tier>.webp and sprites.json entries.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from extract_assets import bleed_rgb, body_box, save_webp  # noqa: E402
from extract_v4 import BASE_H, OUT, META  # noqa: E402
from extract_gpt_a01 import ALPHA_FLOOR, NAMES, largest_component_mask, metrics  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'source', 'gpt_a02')
# atlas id -> (branch id in src/data/content.js BRANCHES, tier). Checked against names[1]/[2].
FORMS = {
    'paladin': ('knight', 2), 'crusader': ('knight', 3),
    'warlord': ('berserker', 2), 'bloodlord': ('berserker', 3),
    'archmage': ('wizard', 2), 'elementalmaster': ('wizard', 3),
    'necromancer': ('warlock', 2), 'lichlord': ('warlock', 3),
    'sniper': ('ranger', 2), 'hawkeye': ('ranger', 3),
    'beastmaster': ('hunter', 2), 'wildking': ('hunter', 3),
    'nightblade': ('assassin', 2), 'shadow': ('assassin', 3),
    'phantom': ('trickster', 2), 'fateweaver': ('trickster', 3),
}
PORTRAIT_H = 640       # promotion screens: same body height as the tier-1 portraits


def clean_cell(board, rect):
    from scipy import ndimage  # noqa: WPS433
    x, y, w, h = rect
    cell = board[y:y + h, x:x + w].copy()
    a = cell[:, :, 3].astype(np.float32) / 255
    a[a < ALPHA_FLOOR] = 0
    solid = largest_component_mask(a > 0.5)
    near = ndimage.binary_dilation(solid, iterations=6)
    a[~near] = 0
    cell[:, :, 3] = (a * 255).astype(np.uint8)
    cell[cell[:, :, 3] == 0, :3] = 0
    return cell, solid


def trim(cell, pad=4):
    ys, xs = np.nonzero(cell[:, :, 3] > 0)
    ty0, ty1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, cell.shape[0])
    tx0, tx1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, cell.shape[1])
    return ty0, ty1, tx0, tx1


def main():
    atlas = json.load(open(os.path.join(SRC, 'atlas.json')))
    sprites = json.load(open(META))
    hero, portraits = sprites['hero'], sprites['portraits']
    done = []
    for asset in atlas['assets']:
        if asset['id'] not in FORMS:
            print('skip (unknown id)', asset['id'])
            continue
        branch, tier = FORMS[asset['id']]
        path = os.path.join(SRC, asset['file'])
        if not os.path.exists(path):
            print('skip (missing)', asset['file'])
            continue
        board = np.array(Image.open(path).convert('RGBA'))
        cells = [(fr,) + clean_cell(board, fr['rect']) for fr in asset['frames']]
        t0, b0, _ = metrics(cells[0][2])
        scale = BASE_H / (b0 - t0)
        heights = []
        for fr, cell, solid in cells:
            top, bottom, px = metrics(solid)
            ty0, ty1, tx0, tx1 = trim(cell)
            img = bleed_rgb(Image.fromarray(cell[ty0:ty1, tx0:tx1], 'RGBA'))
            nw, nh = max(1, round(img.width * scale)), max(1, round(img.height * scale))
            out = img.resize((nw, nh), Image.LANCZOS)
            name = NAMES[fr['name']]
            key = f'pose_promo_{branch}_t{tier}_{name}'
            fname = f'hero_{key}.webp'
            save_webp(out, os.path.join(OUT, fname))
            entry = {
                'id': key, 'branch': branch, 'tier': tier, 'pose': name, 'form': asset['id'],
                'file': 'assets/runtime/' + fname, 'source': f'gpt_a02/{asset["file"]}',
                'sourceRect': fr['rect'], 'trimOffset': [int(fr['rect'][0] + tx0), int(fr['rect'][1] + ty0)],
                'size': [nw, nh], 'scale': round(scale, 4), 'bodyHeightPx': round((bottom - top) * scale, 1),
                'pivot': [round((px - tx0) * scale, 1), round((bottom - ty0) * scale, 1)],
                'suggestedPivot': fr.get('suggestedPivot'),
                'hitbox': [round(v * scale, 1) for v in body_box(solid[ty0:ty1, tx0:tx1])],
                'flying': False, 'mirrored': False, 'status': 'RUNTIME_KEY_POSE',
            }
            hero[key] = entry
            heights.append(round(entry['bodyHeightPx']))
            if name == 'idle':
                # the idle cell is this form's reference look: single figure + promotion portrait
                hero[f'promo_{branch}_t{tier}'] = dict(entry, id=f'promo_{branch}_t{tier}', cls=hero.get(f'promo_{branch}_t{tier}', {}).get('cls'), status='RUNTIME_STATIC_SPRITE')
                ps = PORTRAIT_H / (b0 - t0)
                pw, ph = max(1, round(img.width * ps)), max(1, round(img.height * ps))
                pimg = img.resize((pw, ph), Image.LANCZOS)
                pname = f'portrait_promo_{branch}_t{tier}.webp'
                save_webp(pimg, os.path.join(OUT, pname))
                portraits[f'promo_{branch}_t{tier}'] = {
                    'id': f'{branch}_t{tier}', 'file': 'assets/runtime/' + pname, 'source': f'gpt_a02/{asset["file"]}',
                    'sourceRect': fr['rect'], 'size': [pw, ph], 'scale': round(ps, 4),
                    'pivot': [round((px - tx0) * ps, 1), round((bottom - ty0) * ps, 1)], 'status': 'RUNTIME_PORTRAIT',
                }
        sprites['sources'][f'gpt_a02/{asset["file"]}'] = {'status': 'GPT_A02_POSE_SHEET', 'note': '2·3차 8 key poses, real alpha (no colour key)'}
        done.append(asset['id'])
        print(f'{asset["id"]:16s} {branch}_t{tier} scale {scale:.3f} {heights}')
    json.dump(sprites, open(META, 'w'), ensure_ascii=False, indent=1)
    print('done', len(done), done)


if __name__ == '__main__':
    sys.exit(main())
