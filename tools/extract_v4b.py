#!/usr/bin/env python3
"""v4 art, part 2: monsters M07–M20, bosses B04–B10 + tower guardian, region
backgrounds 4–10 + tower, tier-2/3 hero figures and the 6×6 skill/rune icon sheet,
from assets/source/generated/ (never modified).

Alpha = max(colour key against the flat board colour, background-removal matte
<board>_alpha.png when present): the key keeps glows/smoke the matte drops, the
matte keeps dark leather/armour the key eats.

Run after tools/extract_assets.py and tools/extract_v4.py:
  python3 tools/extract_v4b.py
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(__file__))
from extract_assets import bleed_rgb, body_box, ground_pivot, save_webp  # noqa: E402
from extract_v4 import BRANCH_H, bg_colour, clean, columns, figure, key_out  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN = os.path.join(ROOT, 'assets', 'source', 'generated')
OUT = os.path.join(ROOT, 'assets', 'runtime')
META = os.path.join(OUT, 'sprites.json')

# (id, name, display body px, flying) per grid cell, row-major
MON_A = [('M07', '독거미', 62, False), ('M08', '트렌트', 112, False), ('M09', '설인', 106, False),
         ('M10', '서리 마녀', 104, True), ('M11', '화염 정령', 104, True), ('M12', '샐러맨더', 58, False)]
MON_B = [('M13', '머맨', 108, False), ('M14', '심해어', 74, False), ('M15', '스켈레톤 기사', 112, False), ('M16', '망령', 104, True),
         ('M17', '그리폰', 96, False), ('M18', '타락 천사병', 112, True), ('M19', '공허의 촉수', 104, False), ('M20', '그림자 마수', 76, False)]
BOSS_A = [('B04', '여왕 거미 아라크네', 150), ('B05', '프로스트 웜', 190), ('B06', '이프리트', 190), ('B07', '크라켄', 180)]
BOSS_B = [('B08', '데스나이트 군주', 190), ('B09', '타락한 대천사', 190), ('B10', '심연의 군주', 190), ('TOWER', '탑 수호자', 190)]
BGS = {'forest': 0.77, 'glacier': 0.79, 'volcano': 0.80, 'abyssal': 0.83, 'castle': 0.81, 'sky': 0.82, 'void': 0.86, 'tower': 0.88}
TIERS = {
    'warrior': ('knight', 'berserker'), 'mage': ('wizard', 'warlock'),
    'archer': ('ranger', 'hunter'), 'rogue': ('assassin', 'trickster'),
}
SKILL_GRID = [
    'm_fireball', 'm_frost', 'm_shield', 'm_chain', 'm_curse', 'm_blizzard',
    'm_drain', 'm_meteor', 'a_aim', 'a_multi', 'a_leap', 'a_pierce',
    'a_beast', 'a_snipe', 'a_pack', 'a_rain', 'r_stab', 'r_poison',
    'r_shadow', 'r_execute', 'r_smoke', 'r_shadowstrike', 'r_illusion', 'r_blades',
    'rune_lifesteal', 'rune_combo', 'rune_ward', 'rune_midas', 'rune_focus', 'rune_gale',
    'rune_bulwark', 'rune_charge', 'w_judgement', 'w_whirl', 'emblem_tower', 'emblem_raid',
]


def load(name):
    rgb = np.array(Image.open(os.path.join(GEN, name + '.png')).convert('RGB'))
    mp = os.path.join(GEN, name + '_alpha.png')
    matte = np.array(Image.open(mp).convert('RGBA'))[:, :, 3].astype(np.float32) / 255 if os.path.exists(mp) else None
    return rgb, matte


def alpha_for(rgb, matte, bg):
    a = key_out(rgb, bg, lo=16.0, hi=52.0)
    return np.maximum(a, matte) if matte is not None else a


HOLE_FILL_NEEDS_MATTE = False   # extract_v5 turns this on


def creature_alpha(crop, matte_crop):
    """The boards are very flat (corner std < 1), so a tight key against the cell's own
    corner colour keeps dark bodies (shadow beast, wraith) and soft smoke; interior
    holes where shading matches the board colour are filled."""
    bg = bg_colour(crop)
    a = key_out(crop, bg, lo=5.0, hi=20.0)
    if matte_crop is not None:
        a = np.maximum(a, matte_crop)
    solid = ndimage.binary_fill_holes(a > 0.5)
    if HOLE_FILL_NEEDS_MATTE and matte_crop is not None:
        # only fill interior holes that the background-removal matte also calls subject
        # (keeps real gaps such as the space between a wing and a tail see-through)
        solid = solid & ((a > 0.5) | (matte_crop > 0.25))
    return np.where(solid, np.maximum(a, 0.98), a)


def own_components(alpha, cell, keep_ratio=0.02, grow=3):
    """Pieces whose centre lies inside the grid cell belong to this creature, even when
    a wing or tail crosses the cell line; pieces of the neighbours are dropped."""
    cx0, cy0, cx1, cy1 = cell
    solid = alpha > 0.5
    lab, n = ndimage.label(solid)
    if n == 0:
        raise RuntimeError('empty crop')
    idx = np.arange(1, n + 1)
    areas = ndimage.sum(solid, lab, index=idx)
    cents = ndimage.center_of_mass(solid, lab, idx)
    mine = [i for i, (cy, cx) in zip(idx, cents) if cx0 <= cx < cx1 and cy0 <= cy < cy1]
    if not mine:
        raise RuntimeError('no component in cell')
    main = max(mine, key=lambda i: areas[i - 1])
    keep = np.zeros_like(solid)
    dropped = []
    for i in idx:
        if i in mine and areas[i - 1] >= areas[main - 1] * keep_ratio:
            keep |= lab == i
        elif i in mine:
            dropped.append(int(areas[i - 1]))
    zone = ndimage.binary_dilation(keep, iterations=grow)
    return np.where(zone, alpha, 0), keep, dropped


def creature(rgb, matte, rect, out_name, target_h, flying, entry):
    cx, cy, cw, ch = rect
    H, W = rgb.shape[:2]
    mx, my = int(cw * 0.25), int(ch * 0.2)            # look past the cell line for wings/tails
    x, y = max(0, cx - mx), max(0, cy - my)
    w, h = min(W, cx + cw + mx) - x, min(H, cy + ch + my) - y
    crop = rgb[y:y + h, x:x + w]
    alpha = creature_alpha(crop, matte[y:y + h, x:x + w] if matte is not None else None)
    a, keep, dropped = own_components(alpha, (cx - x, cy - y, cx - x + cw, cy - y + ch))
    ys, xs = np.nonzero(a > 0.03)
    pad = 6
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, h)
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, w)
    rgba = np.dstack([crop, (a * 255).astype(np.uint8)])[y0:y1, x0:x1].copy()
    kmask = keep[y0:y1, x0:x1]
    rgba[rgba[:, :, 3] == 0, :3] = 0
    edge = {'left': bool(xs.min() <= 2), 'right': bool(xs.max() >= w - 3), 'top': bool(ys.min() <= 2), 'bottom': bool(ys.max() >= h - 3)}
    img = Image.fromarray(rgba, 'RGBA')
    kys = np.nonzero(kmask)[0]
    body_h = kys.max() - kys.min()
    scale = target_h * 2 / body_h
    nw, nh = max(1, round(img.width * scale)), max(1, round(img.height * scale))
    img = bleed_rgb(img).resize((nw, nh), Image.LANCZOS)
    px, py = ground_pivot(kmask, flying)
    save_webp(img, os.path.join(OUT, out_name))
    return {
        **entry, 'displayBodyPx': target_h, 'file': 'assets/runtime/' + out_name, 'sourceRect': [x, y, w, h],
        'trimOffset': [int(x + x0), int(y + y0)], 'size': [nw, nh], 'scale': round(scale, 4),
        'bodyHeightPx': round(body_h * scale, 1), 'pivot': [round(px * scale, 1), round(py * scale, 1)],
        'hitbox': [round(v * scale, 1) for v in body_box(kmask)], 'flying': flying, 'mirrored': False,
        'touchesCellEdge': edge, 'droppedBleedComponents': dropped, 'status': 'RUNTIME_STATIC_SPRITE',
        'source': 'generated',
    }


def grid_rects(shape, cols, rows):
    H, W = shape[:2]
    cw, ch = W // cols, H // rows
    return [(c * cw, r * ch, cw, ch) for r in range(rows) for c in range(cols)]


def monsters(sprites):
    for board, (cols, rows), table in (('monsters_a', (3, 2), MON_A), ('monsters_b', (4, 2), MON_B)):
        rgb, matte = load(board)
        for (mid, name, hpx, fly), rect in zip(table, grid_rects(rgb.shape, cols, rows)):
            sprites['monsters'][mid] = creature(rgb, matte, rect, f'mon_{mid}.webp', hpx, fly, {'id': mid, 'name': name})
        sprites['sources'][f'generated/{board}.png'] = {'status': 'GENERATED_BOARD', 'note': f'{cols}x{rows} monsters, alpha = key ∪ bg-removal matte'}


def bosses(sprites):
    for board, table in (('bosses_a', BOSS_A), ('bosses_b', BOSS_B)):
        rgb, matte = load(board)
        for (bid, name, hpx), rect in zip(table, grid_rects(rgb.shape, 2, 2)):
            out = f'boss_{bid}.webp' if bid != 'TOWER' else 'boss_tower.webp'
            sprites['bosses'][bid] = creature(rgb, matte, rect, out, hpx, False, {'id': bid, 'name': name})
        sprites['sources'][f'generated/{board}.png'] = {'status': 'GENERATED_BOARD', 'note': '2x2 bosses'}


def backgrounds(sprites):
    for bid, gr in BGS.items():
        im = Image.open(os.path.join(GEN, f'bg_{bid}.png')).convert('RGB')
        im = im.resize((1024, round(im.height * 1024 / im.width)), Image.LANCZOS)
        im.save(os.path.join(OUT, f'bg_{bid}.webp'), 'WEBP', quality=82, method=6)
        sprites['backgrounds'][bid] = {'file': f'assets/runtime/bg_{bid}.webp', 'size': list(im.size), 'groundRatio': gr, 'status': 'STATIC_SINGLE_LAYER_BACKGROUND', 'source': f'generated/bg_{bid}.png'}


def tiers(sprites):
    for cls, (a, b) in TIERS.items():
        name = f'tier23_{cls}'
        rgb, matte = load(name)
        bg = bg_colour(rgb)
        mask = (np.maximum(key_out(rgb, bg), matte) if matte is not None else key_out(rgb, bg)) > 0.5
        full_alpha = np.maximum(key_out(rgb, bg), matte) if matte is not None else None
        ids = [f'promo_{a}_t2', f'promo_{a}_t3', f'promo_{b}_t2', f'promo_{b}_t3']
        for (x0, x1), hid in zip(columns(mask, 4), ids):
            e, _ = figure(rgb, bg, x0, x1, f'hero_{hid}.webp', BRANCH_H, {'id': hid, 'cls': cls, 'tier': int(hid[-1])}, full_alpha)
            sprites['hero'][hid] = e
            sprites['portraits'][hid] = {'id': hid[6:], 'file': e['file'], 'size': e['size'], 'status': 'RUNTIME_STATIC_SPRITE'}
        sprites['sources'][f'generated/{name}.png'] = {'status': 'GENERATED_BOARD', 'note': 'tier-2/3 figures: A t2, A t3, B t2, B t3'}


def skill_icons(sprites):
    rgb = np.array(Image.open(os.path.join(GEN, 'skills_v4.png')).convert('RGB'))
    H, W = rgb.shape[:2]
    bg = bg_colour(rgb)
    # square icons on the flat board: find each icon's opaque box inside its cell
    for i, sid in enumerate(SKILL_GRID):
        cx, cy = (i % 6) * W // 6, (i // 6) * H // 6
        cell = rgb[cy:cy + H // 6, cx:cx + W // 6]
        m = key_out(cell, bg) > 0.5
        rows = np.nonzero(m.mean(axis=1) > 0.5)[0]
        cols = np.nonzero(m.mean(axis=0) > 0.5)[0]
        y0, y1, x0, x1 = rows.min(), rows.max() + 1, cols.min(), cols.max() + 1
        ins = 3   # drop the anti-aliased rim
        icon = Image.fromarray(cell[y0 + ins:y1 - ins, x0 + ins:x1 - ins]).resize((96, 96), Image.LANCZOS)
        iid = 'K' + str(i).zfill(2)
        icon.save(os.path.join(OUT, f'skill_{iid}.webp'), 'WEBP', quality=86, method=6)
        sprites['skills'][iid] = {'id': iid, 'name': sid, 'file': f'assets/runtime/skill_{iid}.webp', 'sourceRect': [int(cx + x0), int(cy + y0), int(x1 - x0), int(y1 - y0)], 'size': [96, 96], 'status': 'RUNTIME_ICON', 'source': 'generated/skills_v4.png'}
    sprites['sources']['generated/skills_v4.png'] = {'status': 'GENERATED_BOARD', 'note': '6x6 skill / rune / emblem icons'}


def main():
    sprites = json.load(open(META))
    monsters(sprites)
    bosses(sprites)
    backgrounds(sprites)
    tiers(sprites)
    skill_icons(sprites)
    json.dump(sprites, open(META, 'w'), ensure_ascii=False, indent=1)
    edges = {k: v['touchesCellEdge'] for k, v in {**sprites['monsters'], **sprites['bosses']}.items() if 'touchesCellEdge' in v and any(v['touchesCellEdge'].values())}
    print('ok; creatures touching their cell edge:', edges)


if __name__ == '__main__':
    sys.exit(main())
