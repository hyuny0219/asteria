#!/usr/bin/env python3
"""Mage / archer / rogue art from the user's GPT-made v4 handoff boards
(assets/source/handoff_v4/classes/, never modified) plus the GPT-based tier-2/3
boards in assets/source/generated/tier23_<cls>_gpt.png.

The handoff boards carry real alpha with a soft glow haze (like Serin's v3 boards):
alpha is remapped with the same HAZE_LO..HAZE_HI window as tools/extract_assets.py.
The tier-2/3 boards are flat #1c1726; their matte is a Higgsfield background-removal
pass (<name>_alpha.png).

Writes into assets/runtime (same sprite keys as before, so the game code is unchanged):
  hero_cls_<cls>, hero_promo_<branch> (tier 1), hero_promo_<branch>_t2/_t3,
  hero_pose_<cls>_<pose> (8 key poses), face/card/kv_<cls> portraits,
  weapon icons I40–I48 (spellbook / bow / twin daggers × 3 rarities),
  skill icons G00–G23 (8 per class).
Run after tools/extract_assets.py, extract_v4.py, extract_v4b.py, extract_poses_v4.py.
"""
import json
import os
import re
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from extract_assets import HAZE_HI, HAZE_LO, bleed_rgb, save_webp  # noqa: E402
from extract_v4 import BASE_H, BRANCH_H, OUT, META, clean, columns, figure, portraits  # noqa: E402
from extract_poses_v4 import body_metrics, cut_cell  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HV4 = os.path.join(ROOT, 'assets', 'source', 'handoff_v4')
GEN = os.path.join(ROOT, 'assets', 'source', 'generated')
BOARD_BG = np.array([28, 23, 38], dtype=np.float32)    # #1c1726, used behind portraits

CLASSES = {   # our id: (handoff name, tier-1 branches A, B)
    'mage': ('elena', 'wizard', 'warlock'),
    'archer': ('lyra', 'ranger', 'hunter'),
    'rogue': ('nox', 'assassin', 'trickster'),
}
POSE_MAP = {'idle': 'idle', 'step': 'step', 'windup': 'anticipation', 'release': 'thrust',
            'recovery': 'recovery', 'hit': 'hit', 'ultimate': 'cast', 'victory': 'victory'}
WEAPONS = [('I40', '낡은 마도서'), ('I41', '성좌의 마도서'), ('I42', '심연의 마도서'),
           ('I43', '사냥꾼의 활'), ('I44', '은월의 활'), ('I45', '가시나무 장궁'),
           ('I46', '강철 쌍단검'), ('I47', '금장 쌍단검'), ('I48', '적월 쌍단검')]


def load_rgba(path):
    a = np.array(Image.open(path).convert('RGBA'))
    rgb = a[:, :, :3]
    alpha = np.clip((a[:, :, 3].astype(np.float32) - HAZE_LO) / (HAZE_HI - HAZE_LO), 0, 1)
    return rgb, alpha, a[:, :, 3].astype(np.float32) / 255


def composite(rgb, alpha_raw):
    """The board as it looks over the dark game background (for portrait crops)."""
    a = alpha_raw[:, :, None]
    return (rgb.astype(np.float32) * a + BOARD_BG * (1 - a)).astype(np.uint8)


def forms(sprites, cls, hname, ba, bb):
    rgb, matte, raw = load_rgba(os.path.join(HV4, 'classes', f'{hname}_forms.png'))
    cols = columns(matte > 0.5, 3)
    ids = [('cls_' + cls, BASE_H), ('promo_' + ba, BRANCH_H), ('promo_' + bb, BRANCH_H)]
    comp = composite(rgb, raw)
    for (x0, x1), (hid, th) in zip(cols, ids):
        e, (ox, oy, km) = figure(rgb, BOARD_BG, x0, x1, f'hero_{hid}.webp', th, {'id': hid, 'cls': cls, 'source': f'handoff_v4/classes/{hname}_forms.png'}, matte)
        sprites['hero'][hid] = e
        if hid.startswith('promo_'):
            sprites['portraits'][hid] = {'id': hid[6:], 'file': e['file'], 'size': e['size'], 'status': 'RUNTIME_STATIC_SPRITE'}
        else:
            portraits(comp, BOARD_BG, ox, ox + km.shape[1], oy, cls, km, sprites)
    sprites['sources'][f'handoff_v4/classes/{hname}_forms.png'] = {'status': 'HANDOFF_V4_BOARD', 'note': 'GPT: base / branch A / branch B, alpha with glow haze'}


def poses(sprites, cls, hname, regions):
    rgb, matte, _ = load_rgba(os.path.join(HV4, 'classes', f'{hname}_poses.png'))
    frames = regions[hname]['frames']
    cut = []
    for f in frames:
        x, y, w, h = f['rect']
        cut.append((f['name'], cut_cell(rgb, matte, x, x + w, y, y + h), (x, x + w, y, y + h)))
    t0, b0 = body_metrics(cut[0][1][1])
    scale = BASE_H / (b0 - t0)          # idle body = base figure height (one scale per class)
    for name, (img, kmask, (ox, oy), dropped), c in cut:
        pose = POSE_MAP[name]
        top, bottom = body_metrics(kmask)
        nw, nh = max(1, round(img.width * scale)), max(1, round(img.height * scale))
        out = bleed_rgb(img).resize((nw, nh), Image.LANCZOS)
        fys, fxs = np.nonzero(kmask)
        body_h = bottom - top
        band = fys >= bottom - max(6, int(body_h * 0.08))
        px, py = float(fxs[band].mean()), float(bottom)
        ys, xs = np.nonzero(kmask)
        fname = f'hero_pose_{cls}_{pose}.webp'
        save_webp(out, os.path.join(OUT, fname))
        sprites['hero'][f'pose_{cls}_{pose}'] = {
            'id': f'pose_{cls}_{pose}', 'cls': cls, 'pose': pose, 'file': 'assets/runtime/' + fname,
            'sourceRect': [c[0], c[2], c[1] - c[0], c[3] - c[2]], 'trimOffset': [int(ox), int(oy)],
            'size': [nw, nh], 'scale': round(scale, 4), 'bodyHeightPx': round(body_h * scale, 1),
            'pivot': [round(px * scale, 1), round(py * scale, 1)],
            'hitbox': [round(float(xs.min()) * scale, 1), round(float(top) * scale, 1), round(float(xs.max() - xs.min()) * scale, 1), round(float(body_h) * scale, 1)],
            'flying': False, 'mirrored': False, 'droppedBleedComponents': dropped, 'status': 'RUNTIME_KEY_POSE',
            'source': f'handoff_v4/classes/{hname}_poses.png',
        }
    sprites['sources'][f'handoff_v4/classes/{hname}_poses.png'] = {'status': 'HANDOFF_V4_BOARD', 'note': 'GPT: 8 key poses 4x2 (pose_regions.js)'}
    print(cls, 'pose scale', round(scale, 3))


def tiers(sprites, cls, ba, bb):
    name = f'tier23_{cls}_gpt'
    rgb = np.array(Image.open(os.path.join(GEN, name + '.png')).convert('RGB'))
    matte = np.array(Image.open(os.path.join(GEN, name + '_alpha.png')).convert('RGBA'))[:, :, 3].astype(np.float32) / 255
    ids = [f'promo_{ba}_t2', f'promo_{ba}_t3', f'promo_{bb}_t2', f'promo_{bb}_t3']
    for (x0, x1), hid in zip(columns(matte > 0.5, 4), ids):
        e, _ = figure(rgb, BOARD_BG, x0, x1, f'hero_{hid}.webp', BRANCH_H, {'id': hid, 'cls': cls, 'tier': int(hid[-1]), 'source': f'generated/{name}.png'}, matte)
        sprites['hero'][hid] = e
        sprites['portraits'][hid] = {'id': hid[6:], 'file': e['file'], 'size': e['size'], 'status': 'RUNTIME_STATIC_SPRITE'}
    sprites['sources'][f'generated/{name}.png'] = {'status': 'GENERATED_BOARD', 'note': 'GPT-based tier-2/3: A t2, A t3, B t2, B t3; matte = Higgsfield background removal'}


def grid_icons(path, cols, rows, ids, kind, sprites, size=96, tile=False):
    """Freeform glowing icons on an alpha board → square 96 px icons."""
    rgb, matte, raw = load_rgba(path)
    H, W = matte.shape
    cw, ch = W // cols, H // rows
    for i, (iid, label) in enumerate(ids):
        cx, cy = (i % cols) * cw, (i // cols) * ch
        crop = rgb[cy:cy + ch, cx:cx + cw]
        a = raw[cy:cy + ch, cx:cx + cw] if tile else matte[cy:cy + ch, cx:cx + cw]
        if tile:
            # skill icons: keep the glow; composite onto a dark square tile like the K/S icons
            alpha, keep, dropped = clean(matte[cy:cy + ch, cx:cx + cw], keep_ratio=0.02, grow=30)
            ys, xs = np.nonzero(alpha > 0.03)
            m = 0.10
            side = int(max(ys.max() - ys.min(), xs.max() - xs.min()) * (1 + 2 * m))
            ccy, ccx = (ys.min() + ys.max()) // 2, (xs.min() + xs.max()) // 2
            y0, x0 = int(ccy - side / 2), int(ccx - side / 2)
            tile_rgb = np.zeros((side, side, 3), np.float32) + np.array([22, 17, 30], np.float32)
            for yy in range(side):
                sy = y0 + yy
                if sy < 0 or sy >= ch: continue
                xa, xb = max(0, x0), min(cw, x0 + side)
                if xa >= xb: continue
                seg_a = a[sy, xa:xb][:, None]
                seg = crop[sy, xa:xb].astype(np.float32)
                tile_rgb[yy, xa - x0:xb - x0] = seg * seg_a + tile_rgb[yy, xa - x0:xb - x0] * (1 - seg_a)
            img = Image.fromarray(tile_rgb.clip(0, 255).astype(np.uint8), 'RGB').resize((size, size), Image.LANCZOS)
            fname = f'skill_{iid}.webp'
            img.save(os.path.join(OUT, fname), 'WEBP', quality=86, method=6)
        else:
            alpha, keep, dropped = clean(a, keep_ratio=0.15)
            ys, xs = np.nonzero(alpha > 0.03)
            y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
            rgba = np.dstack([crop, (alpha * 255).astype(np.uint8)])[y0:y1, x0:x1].copy()
            rgba[rgba[:, :, 3] == 0, :3] = 0
            im = Image.fromarray(rgba, 'RGBA')
            side = int(max(im.width, im.height) * 1.08)
            sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
            sq.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
            img = bleed_rgb(sq).resize((size, size), Image.LANCZOS)
            fname = f'item_{iid[1:]}.webp'
            save_webp(img, os.path.join(OUT, fname))
        sprites[kind][iid] = {'id': iid, 'name': label, 'file': 'assets/runtime/' + fname, 'sourceRect': [cx, cy, cw, ch], 'size': [size, size],
                              'status': 'RUNTIME_ICON', 'source': os.path.relpath(path, os.path.join(ROOT, 'assets', 'source'))}


SKILL_ICONS = {   # handoff skill index → our skill (best visual fit; our names are kept)
    'elena': ['m_fireball', 'm_meteor', 'm_blizzard', None, 'm_chain', 'm_drain', 'm_shield', 'm_curse'],
    'lyra': ['a_pierce', 'a_multi', None, 'a_snipe', 'a_aim', 'a_beast', None, None],
    'nox': ['r_shadowstrike', 'r_poison', 'r_shadow', 'r_blades', 'r_execute', 'r_illusion', 'r_smoke', 'r_stab'],
}


def main():
    sprites = json.load(open(META))
    js = open(os.path.join(HV4, 'design', 'pose_regions.js'), encoding='utf-8').read()
    regions = json.loads(re.search(r'ASTERIA_POSES\s*=\s*(\{.*\})\s*;?\s*$', js, re.S).group(1))
    for cls, (hname, ba, bb) in CLASSES.items():
        forms(sprites, cls, hname, ba, bb)
        poses(sprites, cls, hname, regions)
        tiers(sprites, cls, ba, bb)
    grid_icons(os.path.join(HV4, 'classes', 'class_weapons_9.png'), 3, 3, WEAPONS, 'items', sprites)
    mapping = {}
    for n, (hname) in enumerate(['elena', 'lyra', 'nox']):
        ids = [(f'G{str(n * 8 + i).zfill(2)}', SKILL_ICONS[hname][i] or f'{hname}_{i}') for i in range(8)]
        grid_icons(os.path.join(HV4, 'classes', f'{hname}_skills.png'), 4, 2, ids, 'skills', sprites, tile=True)
        for (iid, sk) in ids:
            if not sk.startswith(hname): mapping[sk] = iid
    json.dump(sprites, open(META, 'w'), ensure_ascii=False, indent=1)
    json.dump(mapping, open(os.path.join(OUT, 'skill_icon_map_gpt.json'), 'w'), indent=1)
    print('ok', mapping)


if __name__ == '__main__':
    sys.exit(main())
