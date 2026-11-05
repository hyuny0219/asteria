#!/usr/bin/env python3
"""v4 art: new class figures (mage / archer / rogue + tier-1 branches) and the
gloves/boots/ring + material icon sheet, from the generated boards in
assets/source/generated/ (flat #1c1726 background, never modified).

Run AFTER tools/extract_assets.py (which rewrites sprites.json); this script
merges its entries into assets/runtime/sprites.json.

  python3 tools/extract_v4.py
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(__file__))
from extract_assets import bleed_rgb, body_box, ground_pivot, save_webp  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN = os.path.join(ROOT, 'assets', 'source', 'generated')
OUT = os.path.join(ROOT, 'assets', 'runtime')
META = os.path.join(OUT, 'sprites.json')

HERO_BODY = 140          # same as extract_assets.py: CSS px display height, stored at 2x
BASE_H = HERO_BODY * 2   # 280, Serin idle bodyHeightPx
BRANCH_H = HERO_BODY * 2 * 1.08   # Serin promo figures

CLASSES = {
    'mage': ('mage_board.png', ['wizard', 'warlock']),
    'archer': ('archer_board.png', ['ranger', 'hunter']),
    'rogue': ('rogue_board.png', ['assassin', 'trickster']),
}


def bg_colour(arr):
    """Median of the four 24 px corner patches = the flat board colour."""
    p = 24
    corners = np.concatenate([arr[:p, :p].reshape(-1, 3), arr[:p, -p:].reshape(-1, 3), arr[-p:, :p].reshape(-1, 3), arr[-p:, -p:].reshape(-1, 3)])
    return np.median(corners, axis=0)


def key_out(rgb, bg, lo=14.0, hi=46.0):
    """Alpha from colour distance to the flat background (soft edge between lo..hi)."""
    d = np.sqrt(((rgb.astype(np.float32) - bg) ** 2).sum(axis=2))
    return np.clip((d - lo) / (hi - lo), 0, 1)


def clean(alpha, keep_ratio=0.003, grow=3):
    """Keep the main body plus any sizeable piece (staff tip, bow, floating orb)."""
    solid = alpha > 0.5
    lab, n = ndimage.label(solid)
    if n == 0:
        raise RuntimeError('empty crop')
    areas = ndimage.sum(solid, lab, index=np.arange(1, n + 1))
    main = int(np.argmax(areas)) + 1
    keep = np.zeros_like(solid)
    dropped = []
    for i in range(1, n + 1):
        if i == main or areas[i - 1] >= areas[main - 1] * keep_ratio:
            keep |= lab == i
        else:
            dropped.append(int(areas[i - 1]))
    zone = ndimage.binary_dilation(keep, iterations=grow)
    return np.where(zone, alpha, 0), keep, dropped


def columns(mask, n):
    """Split a board into n figure columns: cut where the fewest figure pixels are,
    searching around each 1/n boundary (capes, bows or staffs may come close)."""
    colsum = mask.sum(axis=0).astype(np.float64)
    W = mask.shape[1]
    win = W // (n * 3)
    cuts = []
    for i in range(1, n):
        c = W * i // n
        lo, hi = c - win, c + win
        seg = np.convolve(colsum[lo:hi], np.ones(9) / 9, mode='same')
        cuts.append(lo + int(np.argmin(seg)))
    edges = [0] + cuts + [W]
    return [(edges[i], edges[i + 1]) for i in range(n)]


def figure(board_rgb, bg, x0, x1, out_name, target_h, entry, matte=None):
    crop = board_rgb[:, x0:x1]
    alpha = matte[:, x0:x1] if matte is not None else key_out(crop, bg)
    alpha, keep, dropped = clean(alpha)
    ys, xs = np.nonzero(alpha > 0.03)
    pad = 6
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, crop.shape[0])
    tx0, tx1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, crop.shape[1])
    rgba = np.dstack([crop, (alpha * 255).astype(np.uint8)])[y0:y1, tx0:tx1].copy()
    kmask = keep[y0:y1, tx0:tx1]
    rgba[rgba[:, :, 3] == 0, :3] = 0
    img = Image.fromarray(rgba, 'RGBA')
    # body height from the head, not from a staff/bow tip above it: the first row
    # whose width is a real fraction of the figure's typical width
    rows = kmask.sum(axis=1)
    filled = rows[rows > 0]
    thr = max(4, np.median(filled) * 0.22)
    top = int(np.nonzero(rows > thr)[0].min())
    bottom = int(np.nonzero(rows > 0)[0].max())
    body_h = bottom - top
    scale = target_h / body_h
    nw, nh = max(1, round(img.width * scale)), max(1, round(img.height * scale))
    img = bleed_rgb(img).resize((nw, nh), Image.LANCZOS)
    # feet centre: mean x of the lowest 8% of the figure (both feet in a wide stance)
    fys, fxs = np.nonzero(kmask)
    band = fys >= bottom - max(6, int(body_h * 0.08))
    px, py = float(fxs[band].mean()), float(bottom)
    hb = body_box(kmask)
    save_webp(img, os.path.join(OUT, out_name))
    return {
        **entry, 'file': 'assets/runtime/' + out_name, 'sourceRect': [x0, 0, x1 - x0, board_rgb.shape[0]],
        'trimOffset': [int(x0 + tx0), int(y0)], 'size': [nw, nh], 'scale': round(scale, 4),
        'bodyHeightPx': round(body_h * scale, 1), 'pivot': [round(px * scale, 1), round(py * scale, 1)],
        'hitbox': [round(v * scale, 1) for v in hb], 'flying': False, 'mirrored': False,
        'droppedBleedComponents': dropped, 'status': 'RUNTIME_STATIC_SPRITE',
    }, (x0 + tx0, y0, kmask)


def portraits(board_rgb, bg, x0, x1, top_y, cls, figure_mask, sprites):
    """Card art (3:4, figure from the head), face (192) and illustration (2:3)."""
    rows = figure_mask.sum(axis=1)
    thr = max(4, np.median(rows[rows > 0]) * 0.22)
    head_top = int(np.nonzero(rows > thr)[0].min())
    bottom = int(np.nonzero(rows > 0)[0].max())
    fh = bottom - head_top
    head_rows = figure_mask[head_top: head_top + int(fh * 0.09)]
    hx = int(np.median(np.nonzero(head_rows)[1])) if head_rows.any() else figure_mask.shape[1] // 2
    gx = x0 + hx
    gy = top_y + head_top
    H, W = board_rgb.shape[:2]
    # only this figure: neighbours' capes/bows outside its column become board colour
    iso = board_rgb.copy()
    iso[:, :max(0, x0 - 4)] = bg.astype(np.uint8)
    iso[:, x1 + 4:] = bg.astype(np.uint8)
    full = Image.fromarray(iso, 'RGB')

    def box(cx, cy0, w, h):
        l = int(min(max(cx - w / 2, 0), W - w))
        t = int(min(max(cy0, 0), H - h))
        return (l, t, int(l + w), int(t + h))

    face_side = fh * 0.17
    f = full.crop(box(gx, gy - face_side * 0.12, face_side, face_side)).resize((192, 192), Image.LANCZOS)
    f.save(os.path.join(OUT, f'face_{cls}.webp'), 'WEBP', quality=86, method=6)
    sprites['portraits'][f'face_{cls}'] = {'file': f'assets/runtime/face_{cls}.webp', 'size': [192, 192]}
    cw = fh * 0.62
    c = full.crop(box(gx, gy - fh * 0.03, cw, cw * 4 / 3)).resize((360, 480), Image.LANCZOS)
    c.save(os.path.join(OUT, f'card_{cls}.webp'), 'WEBP', quality=84, method=6)
    sprites['portraits'][f'card_{cls}'] = {'file': f'assets/runtime/card_{cls}.webp', 'size': [360, 480]}
    kh = min(H, fh * 1.08)
    k = full.crop(box(gx, gy - fh * 0.04, kh * 2 / 3, kh)).resize((720, 1080), Image.LANCZOS)
    k.save(os.path.join(OUT, f'kv_{cls}.webp'), 'WEBP', quality=84, method=6)
    sprites['portraits'][f'kv_{cls}'] = {'file': f'assets/runtime/kv_{cls}.webp', 'size': [720, 1080]}


ICON_NAMES = [
    '철 건틀릿', '금장 건틀릿', '흑장미 건틀릿', '신화 건틀릿',
    '가죽 장화', '금장 장화', '흑장미 장화', '신화 장화',
    '은 반지', '자수정 반지', '장미별 반지', '신화 반지',
    '각성석', '별의 파편', '클래스 전환권', '스킬북',
]


def icons(sprites):
    board = np.array(Image.open(os.path.join(GEN, 'icons_v4.png')).convert('RGB'))
    bg = bg_colour(board)
    mp = os.path.join(GEN, 'icons_v4_alpha.png')
    matte = np.array(Image.open(mp).convert('RGBA'))[:, :, 3].astype(np.float32) / 255 if os.path.exists(mp) else None
    cell = board.shape[0] // 4
    for i, name in enumerate(ICON_NAMES):
        cx, cy = (i % 4) * cell, (i // 4) * cell
        crop = board[cy:cy + cell, cx:cx + cell]
        # the colour key is clean on this sheet; the matte drops the glowing crystal, so only fall back to it
        a0 = key_out(crop, bg)
        if matte is not None and (a0 > 0.5).mean() < 0.02: a0 = matte[cy:cy + cell, cx:cx + cell]
        alpha, keep, dropped = clean(a0, keep_ratio=0.15)
        ys, xs = np.nonzero(alpha > 0.03)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        rgba = np.dstack([crop, (alpha * 255).astype(np.uint8)])[y0:y1, x0:x1].copy()
        rgba[rgba[:, :, 3] == 0, :3] = 0
        img = Image.fromarray(rgba, 'RGBA')
        side = int(max(img.width, img.height) * 1.08)
        sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        sq.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
        sq = bleed_rgb(sq).resize((96, 96), Image.LANCZOS)
        iid = f'I{24 + i}'
        save_webp(sq, os.path.join(OUT, f'item_{24 + i}.webp'))
        sprites['items'][iid] = {'id': iid, 'name': name, 'file': f'assets/runtime/item_{24 + i}.webp', 'sourceRect': [cx, cy, cell, cell],
                                 'trimOffset': [int(cx + x0), int(cy + y0)], 'size': [96, 96], 'scale': round(96 / side, 4),
                                 'droppedBleedComponents': dropped, 'status': 'RUNTIME_ICON', 'source': 'generated/icons_v4.png'}


def main():
    sprites = json.load(open(META))
    for cls, (fname, branches) in CLASSES.items():
        board = np.array(Image.open(os.path.join(GEN, fname)).convert('RGB'))
        bg = bg_colour(board)
        # matte from the background-removal pass (<name>_alpha.png) when present: the
        # colour key alone eats dark leather/cloth that is close to the board colour
        mp = os.path.join(GEN, fname.replace('.png', '_alpha.png'))
        matte = np.array(Image.open(mp).convert('RGBA'))[:, :, 3].astype(np.float32) / 255 if os.path.exists(mp) else None
        mask = (matte if matte is not None else key_out(board, bg)) > 0.5
        cols = columns(mask, 3)
        ids = [('cls_' + cls, BASE_H), ('promo_' + branches[0], BRANCH_H), ('promo_' + branches[1], BRANCH_H)]
        for (x0, x1), (hid, th) in zip(cols, ids):
            e, (ox, oy, km) = figure(board, bg, x0, x1, f'hero_{hid}.webp', th, {'id': hid, 'cls': cls}, matte)
            sprites['hero'][hid] = e
            if hid.startswith('promo_'):
                # branch picker / promotion screens show the transparent full figure
                sprites['portraits'][hid] = {'id': hid[6:], 'file': e['file'], 'size': e['size'], 'status': 'RUNTIME_STATIC_SPRITE'}
            if hid.startswith('cls_'):
                portraits(board, bg, ox, ox + km.shape[1], oy, cls, km, sprites)
        sprites['sources']['generated/' + fname] = {'status': 'GENERATED_BOARD', 'note': 'Higgsfield gpt_image_2_5, flat #1c1726 background'}
    icons(sprites)
    sprites['sources']['generated/icons_v4.png'] = {'status': 'GENERATED_BOARD', 'note': 'Higgsfield gpt_image_2_5, 4x4 icon grid'}
    json.dump(sprites, open(META, 'w'), ensure_ascii=False, indent=1)
    print('ok', [k for k in sprites['hero'] if k.startswith(('cls_', 'promo_'))])


if __name__ == '__main__':
    sys.exit(main())
