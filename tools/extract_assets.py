#!/usr/bin/env python3
"""Extract runtime sprites from the v3 concept boards.

Originals in assets/source are never modified. Output goes to assets/runtime/.

For every object we record, in assets/runtime/sprites.json:
  sourceFile / sourceRect    rectangle on the original board
  trimOffset                 offset of the trimmed image inside sourceRect
  size                       runtime image size (px) and scale vs source
  pivot                      ground point in runtime px (feet / shadow centre)
  hitbox                     [x, y, w, h] in runtime px, from the opaque body
  alpha                      cleanup parameters and remaining border alpha
  status                     RUNTIME_STATIC_SPRITE (single image, no frames)

Board backgrounds carry a semi-transparent glow haze (alpha 1..63 over
~20% of pixels). We remap alpha so haze goes to 0, keep the connected
body, drop components that bleed in from neighbouring cells (touching the
crop border and not part of the main body) and trim.
"""
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.join(ROOT, 'assets', 'source')
OUT = os.path.join(ROOT, 'assets', 'runtime')

HAZE_LO = 56      # alpha <= HAZE_LO becomes 0
HAZE_HI = 200     # alpha >= HAZE_HI stays opaque-ish (linear in between)


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        h.update(f.read())
    return h.hexdigest()


def clean_alpha(rgba, keep_ratio=0.004, grow=6):
    """Return cleaned RGBA crop plus diagnostics."""
    a = rgba[:, :, 3].astype(np.float32)
    remapped = np.clip((a - HAZE_LO) * 255.0 / (HAZE_HI - HAZE_LO), 0, 255)
    solid = remapped > 96
    lab, n = ndimage.label(solid)
    if n == 0:
        raise RuntimeError('empty crop')
    areas = ndimage.sum(solid, lab, index=np.arange(1, n + 1))
    main = int(np.argmax(areas)) + 1
    h, w = solid.shape
    keep = np.zeros_like(solid)
    dropped = []
    for i in range(1, n + 1):
        comp = lab == i
        area = areas[i - 1]
        if i == main:
            keep |= comp
            continue
        if area < areas[main - 1] * keep_ratio:
            continue
        ys, xs = np.nonzero(comp)
        touches = ys.min() == 0 or xs.min() == 0 or ys.max() == h - 1 or xs.max() == w - 1
        if touches:
            dropped.append(int(area))
            continue
        keep |= comp
    # grow the kept mask so soft anti-aliased edges survive
    zone = ndimage.binary_dilation(keep, iterations=grow)
    out = rgba.copy()
    alpha = np.where(zone, remapped, 0).astype(np.uint8)
    out[:, :, 3] = alpha
    # un-premultiply-safe: zero colour where alpha is 0 to avoid dark halos on resize
    out[alpha == 0, :3] = 0
    return out, keep, dropped


def bleed_rgb(img):
    """Spread edge colours into transparent pixels so bilinear scaling does not
    pull in black (the halo the spec warns about)."""
    arr = np.array(img).astype(np.float32)
    a = arr[:, :, 3] > 0
    if a.all():
        return img
    _, (iy, ix) = ndimage.distance_transform_edt(~a, return_indices=True)
    rgb = arr[:, :, :3][iy, ix]
    arr[:, :, :3] = np.where(a[:, :, None], arr[:, :, :3], rgb)
    return Image.fromarray(arr.astype(np.uint8), 'RGBA')


def trim(rgba, mask, pad=6):
    ys, xs = np.nonzero(rgba[:, :, 3] > 8)
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, rgba.shape[0])
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, rgba.shape[1])
    return rgba[y0:y1, x0:x1], mask[y0:y1, x0:x1], (int(x0), int(y0))


def ground_pivot(mask, flying=False):
    ys, xs = np.nonzero(mask)
    bottom = ys.max()
    if flying:
        # wraith: pivot under the centre of mass, at the lowest body pixel
        return float(xs.mean()), float(bottom)
    band = ys >= bottom - max(4, int(mask.shape[0] * 0.04))
    return float(xs[band].mean()), float(bottom)


def body_box(mask, shrink=0.12):
    ys, xs = np.nonzero(mask)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    w, h = x1 - x0, y1 - y0
    return [float(x0 + w * shrink / 2), float(y0 + h * shrink / 2), float(w * (1 - shrink)), float(h * (1 - shrink))]


def save_webp(img, path, quality=86):
    img.save(path, 'WEBP', quality=quality, method=6)


def process(entry, board, rect, out_name, target_h=None, target_w=None, flying=False, keep_ratio=0.004, icon=None, mirror=False):
    x, y, w, h = rect
    crop = np.array(board.crop((x, y, x + w, y + h)).convert('RGBA'))
    cleaned, keep, dropped = clean_alpha(crop, keep_ratio=keep_ratio)
    trimmed, kmask, (tx, ty) = trim(cleaned, keep)
    img = Image.fromarray(trimmed, 'RGBA')
    if mirror:
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
        kmask = kmask[:, ::-1]
    mh, mw = kmask.shape
    if icon:
        # square icon canvas, centred, keeps material colours
        side = max(img.width, img.height)
        sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        sq.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
        img = bleed_rgb(sq).resize((icon, icon), Image.LANCZOS)
        scale = icon / side
        save_webp(img, os.path.join(OUT, out_name))
        return {
            **entry, 'file': 'assets/runtime/' + out_name, 'sourceRect': [x, y, w, h],
            'trimOffset': [tx, ty], 'size': [icon, icon], 'scale': round(scale, 4),
            'droppedBleedComponents': dropped, 'status': 'RUNTIME_ICON'
        }
    ys = np.nonzero(kmask)[0]
    body_h = ys.max() - ys.min()
    if target_h:
        scale = target_h / body_h
    elif target_w:
        scale = target_w / img.width
    else:
        scale = 1.0
    nw, nh = max(1, round(img.width * scale)), max(1, round(img.height * scale))
    img = bleed_rgb(img).resize((nw, nh), Image.LANCZOS)
    px, py = ground_pivot(kmask, flying)
    hb = body_box(kmask)
    save_webp(img, os.path.join(OUT, out_name))
    return {
        **entry, 'file': 'assets/runtime/' + out_name, 'sourceRect': [x, y, w, h],
        'trimOffset': [tx, ty], 'size': [nw, nh], 'scale': round(scale, 4),
        'bodyHeightPx': round(body_h * scale, 1),
        'pivot': [round(px * scale, 1), round(py * scale, 1)],
        'hitbox': [round(v * scale, 1) for v in hb],
        'flying': flying, 'mirrored': mirror,
        'droppedBleedComponents': dropped, 'status': 'RUNTIME_STATIC_SPRITE'
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    regions = json.load(open(os.path.join(SRC, 'asset_regions.json')))
    sprites = {'version': 'runtime-1', 'generatedBy': 'tools/extract_assets.py',
               'note': 'Static sprites cut from concept boards. Not frame animations. Pivot = feet (flying: lowest body pixel).',
               'haze': {'lo': HAZE_LO, 'hi': HAZE_HI}, 'sources': {}, 'monsters': {}, 'bosses': {},
               'hero': {}, 'items': {}, 'skills': {}, 'backgrounds': {}, 'portraits': {}}

    def src(name):
        p = os.path.join(SRC, name)
        sprites['sources'][name] = sha(p)
        return Image.open(p)

    # Display body heights come from spec/07 (CSS px). Stored at 2x for DPR 2.
    mon_h = {'M01': 60, 'M02': 85, 'M03': 80, 'M04': 115, 'M05': 110, 'M06': 75}
    board = src('atlases/monsters_6.png')
    for r in regions['monsters']:
        mid = r['id']
        # Checked on the board: all six enemies already face left (toward the hero), no mirroring.
        sprites['monsters'][mid] = process({'id': mid, 'name': r['name'], 'displayBodyPx': mon_h[mid]}, board, r['rect'],
                                           f'mon_{mid}.webp', target_h=mon_h[mid] * 2, flying=(mid == 'M04'))

    boss_h = {'B01': 120, 'B02': 190, 'B03': 185}
    board = src('atlases/bosses_3.png')
    # The review regions in asset_regions.json clip B01's right side and B03's pickaxe.
    # Widened crops; neighbouring bosses that leak in touch the crop edge and are dropped as bleed.
    boss_rect = {'B01': [0, 300, 575, 600], 'B02': [460, 0, 600, 1024], 'B03': [985, 0, 551, 1024]}
    for r in regions['bosses']:
        bid = r['id']
        sprites['bosses'][bid] = process({'id': bid, 'name': r['name'], 'displayBodyPx': boss_h[bid],
                                          'reviewRect': r['rect']}, board, boss_rect[bid],
                                         f'boss_{bid}.webp', target_h=boss_h[bid] * 2, keep_ratio=0.01)

    # Hero poses: 4x2 cells of 384x512. One common scale so the 8 poses stay consistent.
    poses = json.load(open(os.path.join(SRC, 'serin_poses_atlas.json')))
    board = src('character/serin_poses.png')
    HERO_BODY = 140  # CSS px display height (spec 120..150)
    tmp = {}
    for fr in poses['frames']:
        x, y, w, h = fr['rect']
        crop = np.array(board.crop((x, y, x + w, y + h)).convert('RGBA'))
        _, keep, _ = clean_alpha(crop)
        ys = np.nonzero(keep)[0]
        tmp[fr['name']] = ys.max() - ys.min()
    ref = tmp['idle']
    for fr in poses['frames']:
        name = fr['name']
        # scale every pose with the idle body height so poses do not change size
        e = process({'id': name, 'designPivot': fr['pivot']}, board, fr['rect'], f'serin_{name}.webp',
                    target_h=HERO_BODY * 2 * (tmp[name] / ref))
        # Use the authored ground point from motion/atlas.json (cell coords) instead of
        # the automatic one: sword tips and hems reach the floor and skew detection.
        auto = e['pivot']
        e['pivotAuto'] = auto
        e['pivot'] = [round((fr['pivot'][0] - e['trimOffset'][0]) * e['scale'], 1),
                      round((fr['pivot'][1] - e['trimOffset'][1]) * e['scale'], 1)]
        e['pivotSource'] = 'motion/atlas.json'
        sprites['hero'][name] = e

    # Promotions: two full-body figures on one board.
    board = src('atlases/serin_promotions.png')
    for pid, rect in (('knight', [0, 0, 768, 1024]), ('berserker', [768, 0, 768, 1024])):
        sprites['hero']['promo_' + pid] = process({'id': pid}, board, rect, f'serin_{pid}.webp', target_h=HERO_BODY * 2 * 1.08)
        sprites['portraits']['promo_' + pid] = process({'id': pid}, board, rect, f'portrait_{pid}.webp', target_h=640)

    # Item icons: 6x4 grid of 256.
    board = src('atlases/items_24.png')
    for i, name in enumerate(regions['items']):
        cx, cy = (i % 6) * 256, (i // 6) * 256
        sprites['items'][f'I{i:02d}'] = process({'id': f'I{i:02d}', 'name': name}, board, [cx, cy, 256, 256],
                                               f'item_{i:02d}.webp', icon=96, keep_ratio=0.02)
    # Skill icons: 4x2 grid of 384x512.
    board = src('atlases/skills_8.png')
    for i, name in enumerate(regions['skills']):
        cx, cy = (i % 4) * 384, (i // 4) * 512
        sprites['skills'][f'S{i}'] = process({'id': f'S{i}', 'name': name}, board, [cx, cy, 384, 512],
                                            f'skill_{i}.webp', icon=96, keep_ratio=0.002)

    # Backgrounds and key visual: plain resize, no alpha.
    for bg in ('meadow', 'desert', 'mine'):
        im = src(f'backgrounds/{bg}.png').convert('RGB').resize((1024, 683), Image.LANCZOS)
        im.save(os.path.join(OUT, f'bg_{bg}.webp'), 'WEBP', quality=82, method=6)
        sprites['backgrounds'][bg] = {'file': f'assets/runtime/bg_{bg}.webp', 'size': [1024, 683], 'groundRatio': 0.8,
                                      'status': 'STATIC_SINGLE_LAYER_BACKGROUND'}
    im = src('character/cathedral_stage.png').convert('RGB').resize((1024, 683), Image.LANCZOS)
    im.save(os.path.join(OUT, 'bg_cathedral.webp'), 'WEBP', quality=82, method=6)
    sprites['backgrounds']['cathedral'] = {'file': 'assets/runtime/bg_cathedral.webp', 'size': [1024, 683], 'groundRatio': 0.8,
                                           'status': 'STATIC_SINGLE_LAYER_BACKGROUND'}
    kv = src('character/serin_key_visual.png').convert('RGB').resize((720, 1080), Image.LANCZOS)
    kv.save(os.path.join(OUT, 'serin_key_visual.webp'), 'WEBP', quality=84, method=6)
    sprites['portraits']['serin_key'] = {'file': 'assets/runtime/serin_key_visual.webp', 'size': [720, 1080]}
    face = src('character/serin_key_visual.png').convert('RGB').crop((300, 120, 740, 560)).resize((192, 192), Image.LANCZOS)
    face.save(os.path.join(OUT, 'serin_face.webp'), 'WEBP', quality=86, method=6)
    sprites['portraits']['serin_face'] = {'file': 'assets/runtime/serin_face.webp', 'size': [192, 192]}

    with open(os.path.join(OUT, 'sprites.json'), 'w', encoding='utf-8') as f:
        json.dump(sprites, f, ensure_ascii=False, indent=1)
    total = sum(os.path.getsize(os.path.join(OUT, n)) for n in os.listdir(OUT))
    print('runtime files', len(os.listdir(OUT)), 'bytes', total)


if __name__ == '__main__':
    sys.exit(main())
