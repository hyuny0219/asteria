"""GPT package N (mounts + wings) -> assets/runtime/steed_*.webp + sprites.json["steeds"].

Sources in assets/source/gpt_n/ (1536x1024, real alpha). Missing sheets are skipped:
the game draws placeholder shapes for anything without a sprite.

  mounts_1..4.png  4x2, one row per mount = run cycle of 4 frames (no rider)
                   -> mount_<id>_run1..4   {file,w,h, fx,fy (feet centre), sx,sy (saddle seat)}
  ride_<char>.png  4x2, cells 1..7 = base, 1차A, 2차A, 3차A, 1차B, 2차B, 3차B (cell 8 empty)
                   -> ride_<form>_<cls>     {file,w,h, hx,hy (hips = seat contact)}
                      form = base | <branch> | <branch>_t2 | <branch>_t3
  wings_1..2.png   4x2, columns = wings, row 1 = up (spread), row 2 = down
                   -> wing_<id>_up / _down  {file,w,h, ax,ay (back attach point)}
  icons_mount_wing.png 6x4 -> icon_mount_<id>, icon_wing_<id>, icon_steed_<name>

Anchors are fractions of the saved image. The saddle seat is MEASURED per frame:
a hand-checked seed on frame 1 (SEAT below; read off a 20px grid of the source cell and
snapped to the top alpha contour) is template-matched into frames 2..4, so the rider
bobs with the gallop.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from extract_assets import bleed_rgb, save_webp  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets/source/gpt_n')
OUT = os.path.join(ROOT, 'assets/runtime')
META = os.path.join(OUT, 'sprites.json')
MOUNT_H = 220       # runtime height of a mount frame (px)
RIDE_H = 300
WING_H = 260
ICON = 96
PAD = 4

MOUNT_SHEETS = {
    'mounts_1.png': ['horse', 'wolf'],
    'mounts_2.png': ['lizard', 'elk'],
    'mounts_3.png': ['skelhorse', 'griffin'],
    'mounts_4.png': ['unicorn', 'nightmare'],
}
# saddle seat on frame 1, in source-cell pixels (cell 384x512). Measured: grid read +
# top-contour snap (elk: first run under the antlers).
SEAT = {'horse': (200, 226), 'wolf': (210, 207), 'lizard': (185, 278), 'elk': (180, 237)}
WING_SHEETS = {'wings_1.png': ['rose', 'angel', 'bat', 'fairy'], 'wings_2.png': ['phoenix', 'ice', 'star', 'abyss']}
RIDE_SHEETS = {'ride_serin.png': 'warrior', 'ride_elena.png': 'mage', 'ride_lyra.png': 'archer', 'ride_nox.png': 'rogue'}
BRANCHES = {'warrior': ('knight', 'berserker'), 'mage': ('wizard', 'warlock'), 'archer': ('ranger', 'hunter'), 'rogue': ('assassin', 'trickster')}
ICON_ORDER = (['mount_' + m for s in MOUNT_SHEETS.values() for m in s] + ['wing_' + w for s in WING_SHEETS.values() for w in s]
              + ['steed_menu_mount', 'steed_menu_wing', 'steed_food', 'steed_feather', 'steed_ticket_mount', 'steed_ticket_wing'])


def cells(path, cols, rows):
    board = np.array(Image.open(path).convert('RGBA'))
    H, W = board.shape[:2]
    cw, ch = W // cols, H // rows
    out = []
    for r in range(rows):
        for c in range(cols):
            cell = board[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw].copy()
            a = cell[:, :, 3]
            a[a < 8] = 0
            out.append(cell)
    return out, cw, ch


def bbox(a, thr=16):
    ys, xs = np.nonzero(a > thr)
    if len(xs) == 0:
        return None
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def save(arr, name, max_h):
    img = Image.fromarray(arr)
    s = min(1.0, max_h / img.height)
    if s < 1:
        img = bleed_rgb(img).resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
    fn = f'steed_{name}.webp'
    save_webp(img, os.path.join(OUT, fn), quality=86)
    return {'file': 'assets/runtime/' + fn, 'w': img.width, 'h': img.height}


def match(ref, img, x, y, hw=40, hh=22, search=48):
    """offset of the patch ref[y-hh:y+hh, x-hw:x+hw] inside img (SSD over RGBA)."""
    p = ref[y - hh:y + hh, x - hw:x + hw].astype(np.float32)
    best, bo = None, (0, 0)
    H, W = img.shape[:2]
    for dy in range(-search, search + 1, 2):
        for dx in range(-search, search + 1, 2):
            y0, x0 = y - hh + dy, x - hw + dx
            if y0 < 0 or x0 < 0 or y0 + 2 * hh > H or x0 + 2 * hw > W:
                continue
            d = img[y0:y0 + 2 * hh, x0:x0 + 2 * hw].astype(np.float32) - p
            e = float((d * d).sum())
            if best is None or e < best:
                best, bo = e, (dx, dy)
    # refine ±1
    bx, by = bo
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            y0, x0 = y - hh + by + dy, x - hw + bx + dx
            if y0 < 0 or x0 < 0 or y0 + 2 * hh > H or x0 + 2 * hw > W:
                continue
            d = img[y0:y0 + 2 * hh, x0:x0 + 2 * hw].astype(np.float32) - p
            e = float((d * d).sum())
            if e < best:
                best, bo = e, (bx + dx, by + dy)
    return bo


def mounts(out, log):
    for sheet, ids in MOUNT_SHEETS.items():
        path = os.path.join(SRC, sheet)
        if not os.path.exists(path):
            log.append(f'{sheet}: missing -> placeholder for {ids}')
            continue
        cs, cw, ch = cells(path, 4, 2)
        for row, mid in enumerate(ids):
            frames = cs[row * 4:row * 4 + 4]
            boxes = [bbox(f[:, :, 3]) for f in frames]
            x0 = max(min(b[0] for b in boxes) - PAD, 0)
            y0 = max(min(b[1] for b in boxes) - PAD, 0)
            x1 = min(max(b[2] for b in boxes) + PAD, cw)
            y1 = min(max(b[3] for b in boxes) + PAD, ch)
            if mid not in SEAT:
                raise SystemExit(f'{mid}: measure the saddle seat on frame 1 and add it to SEAT')
            sx0, sy0 = SEAT[mid]
            w, h = x1 - x0, y1 - y0
            feet = y1 - PAD   # lowest hoof of the cycle = ground line for every frame
            for i, f in enumerate(frames):
                dx, dy = (0, 0) if i == 0 else match(frames[0], f, sx0, sy0)
                sx, sy = sx0 + dx, sy0 + dy
                m = save(f[y0:y1, x0:x1], f'mount_{mid}_run{i + 1}', MOUNT_H)
                m.update({'fx': round((w / 2) / w, 3), 'fy': round((feet - y0) / h, 3),
                          'sx': round((sx - x0) / w, 3), 'sy': round((sy - y0) / h, 3),
                          'seatFromTop': round(sy / ch, 3), 'source': f'gpt_n/{sheet} row {row + 1}'})
                out[f'mount_{mid}_run{i + 1}'] = m
                log.append(f'mount_{mid}_run{i + 1} {m["w"]}x{m["h"]} seat=({m["sx"]},{m["sy"]}) cellTop%={m["seatFromTop"]}')


def rides(out, log):
    for sheet, cls in RIDE_SHEETS.items():
        path = os.path.join(SRC, sheet)
        if not os.path.exists(path):
            log.append(f'{sheet}: missing -> rider drawn standing on the saddle')
            continue
        cs, cw, ch = cells(path, 4, 2)
        a, b = BRANCHES[cls]
        forms = ['base', a, a + '_t2', a + '_t3', b, b + '_t2', b + '_t3']
        for i, form in enumerate(forms):
            f = cs[i]
            bb = bbox(f[:, :, 3])
            if bb is None:
                continue
            x0, y0 = max(bb[0] - PAD, 0), max(bb[1] - PAD, 0)
            x1, y1 = min(bb[2] + PAD, cw), min(bb[3] + PAD, ch)
            hip_y = 0.60 * ch   # spec: seat contact at 60% from the cell top
            # hips x: alpha-weighted centre of the rows around the seat line
            band = f[int(hip_y) - 12:int(hip_y) + 12, :, 3].astype(np.float32)
            hx = (band.sum(axis=0) * np.arange(cw)).sum() / max(band.sum(), 1)
            m = save(f[y0:y1, x0:x1], f'ride_{form}_{cls}', RIDE_H)
            m.update({'hx': round((hx - x0) / (x1 - x0), 3), 'hy': round((hip_y - y0) / (y1 - y0), 3), 'source': f'gpt_n/{sheet} cell {i + 1}'})
            out[f'ride_{form}_{cls}'] = m


def wings(out, log):
    for sheet, ids in WING_SHEETS.items():
        path = os.path.join(SRC, sheet)
        if not os.path.exists(path):
            log.append(f'{sheet}: missing -> placeholder for {ids}')
            continue
        cs, cw, ch = cells(path, 4, 2)
        for col, wid in enumerate(ids):
            for row, pose in enumerate(('up', 'down')):
                f = cs[row * 4 + col]
                bb = bbox(f[:, :, 3])
                x0, y0 = max(bb[0] - PAD, 0), max(bb[1] - PAD, 0)
                x1, y1 = min(bb[2] + PAD, cw), min(bb[3] + PAD, ch)
                axp, ayp = 0.5 * cw, 0.45 * ch   # spec: attach point at 50% / 45% of the cell
                m = save(f[y0:y1, x0:x1], f'wing_{wid}_{pose}', WING_H)
                m.update({'ax': round((axp - x0) / (x1 - x0), 3), 'ay': round((ayp - y0) / (y1 - y0), 3), 'source': f'gpt_n/{sheet}'})
                out[f'wing_{wid}_{pose}'] = m


def icons(out, log):
    path = os.path.join(SRC, 'icons_mount_wing.png')
    if not os.path.exists(path):
        log.append('icons_mount_wing.png: missing -> placeholder icons')
        return
    cs, cw, ch = cells(path, 6, 4)
    for i, key in enumerate(ICON_ORDER):
        f = cs[i]
        bb = bbox(f[:, :, 3])
        if bb is None:
            continue
        x0, y0, x1, y1 = bb
        side = max(x1 - x0, y1 - y0) + 2 * PAD
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        sq = np.zeros((side, side, 4), np.uint8)
        sx0, sy0 = cx - side // 2, cy - side // 2
        for yy in range(side):
            y = sy0 + yy
            if 0 <= y < ch:
                xa, xb = max(sx0, 0), min(sx0 + side, cw)
                sq[yy, xa - sx0:xb - sx0] = f[y, xa:xb]
        img = bleed_rgb(Image.fromarray(sq)).resize((ICON, ICON), Image.LANCZOS)
        fn = f'icon_{key}.webp'
        save_webp(img, os.path.join(OUT, fn), quality=88)
        out['icon_' + key] = {'file': 'assets/runtime/' + fn, 'w': ICON, 'h': ICON}


def main():
    sprites = json.load(open(META))
    out, log = {}, []
    mounts(out, log)
    rides(out, log)
    wings(out, log)
    icons(out, log)
    sprites['steeds'] = out
    src = sprites.setdefault('sources', {})
    for f in sorted(os.listdir(SRC)) if os.path.isdir(SRC) else []:
        src['gpt_n/' + f] = 'GPT package N'
    json.dump(sprites, open(META, 'w'), ensure_ascii=False, indent=1)
    print('\n'.join(log))


if __name__ == '__main__':
    main()
