"""GPT J4: walk 4 + basic attack 4 frames for the 16 tier-2/3 promoted forms.

assets/source/gpt_j4/<branch>_t<2|3>_cycle.png (1536x1024, 4x2 cells 384x512, facing right).
Most sheets have real alpha; a few came on a light/grey gradient instead. For those,
the background is estimated per cell (large blur of the border-connected smooth area)
and removed by colour distance + flood from the cell edges.
Scale per sheet: walk frame 1 solid height = 280 px (same as the A02 key poses).
→ sprites.json hero.cyc_<branch>_t<tier>_<walk1..4|atk1..4>
"""
import glob
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(__file__))
from extract_assets import bleed_rgb, save_webp  # noqa: E402
from extract_gpt_c import cut  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets/source/gpt_j4')
OUT = os.path.join(ROOT, 'assets/runtime')
META = os.path.join(OUT, 'sprites.json')


def matte(cell):
    """cell: RGBA uint8 (no useful alpha) → alpha from background estimate."""
    rgb = cell[:, :, :3].astype(np.float32)
    H, W = rgb.shape[:2]
    # background guess: blur of the image with a mask that grows from the edges
    lum = rgb.mean(axis=2)
    detail = ndimage.gaussian_filter(np.abs(lum - ndimage.gaussian_filter(lum, 1.5)), 2)
    smooth = detail < 2.2
    lab, n = ndimage.label(smooth)
    edge_ids = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bgmask = np.isin(lab, list(edge_ids))
    bg = np.zeros_like(rgb)
    w = ndimage.gaussian_filter(bgmask.astype(np.float32), 25) + 1e-4
    for c in range(3):
        bg[:, :, c] = ndimage.gaussian_filter(rgb[:, :, c] * bgmask, 25) / w
    d = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    # enclosed pockets (inside a drawn bow) get no blur estimate: also test against the
    # cell's typical background colour, and keep the pixel as background if it matches
    med = np.median(rgb[bgmask], axis=0) if bgmask.any() else rgb[0, 0]
    d = np.minimum(d, np.sqrt(((rgb - med) ** 2).sum(axis=2)) * 1.15)
    fg = d > 28
    fg = ndimage.binary_closing(fg, iterations=2)
    # fill only small holes (fur / lace gaps); big enclosed areas (inside a drawn bow) stay background
    holes = ndimage.binary_fill_holes(fg) & ~fg
    hl, hn = ndimage.label(holes)
    if hn:
        hs = ndimage.sum(holes, hl, range(1, hn + 1))
        fg |= np.isin(hl, [i + 1 for i in range(hn) if hs[i] < 0.004 * H * W])
    lab, n = ndimage.label(fg)
    if n:
        sz = ndimage.sum(fg, lab, range(1, n + 1))
        fg = np.isin(lab, [i + 1 for i in range(n) if sz[i] > 0.02 * sz.max()])
    core = ndimage.binary_erosion(fg, iterations=1)
    a = np.clip((d - 18) / 30, 0, 1)
    a = np.where(core, 1.0, np.where(fg, a, 0.0))
    a = ndimage.gaussian_filter(a, 0.5) * fg
    # un-mix the light background from soft edge pixels (no white fringe)
    aa = np.clip(a, 0.05, 1)[:, :, None]
    rgb2 = np.clip((rgb - (1 - aa) * bg) / aa, 0, 255)
    out = cell.copy()
    out[:, :, :3] = np.where(a[:, :, None] > 0.98, rgb, rgb2).astype(np.uint8)
    # smooth, light, grey pockets left inside the figure (painted backdrop inside a drawn bow) → clear
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    pocket = (detail < 2.5) & (lum > 150) & ((mx - mn) < 26) & (a > 0)
    pl, pn = ndimage.label(pocket)
    if pn:
        ps = ndimage.sum(pocket, pl, range(1, pn + 1))
        clear = ndimage.binary_dilation(np.isin(pl, [i + 1 for i in range(pn) if ps[i] > 300]), iterations=2)
        a = np.where(clear, 0.0, a)
    orig = cell[:, :, 3].astype(np.float32) / 255
    if (orig < 0.98).mean() > 0.05:      # sheet already had partial alpha: never add opacity
        a = np.minimum(a, orig)
    out[:, :, 3] = (a * 255).astype(np.uint8)
    return out


def main():
    sprites = json.load(open(META))
    for path in sorted(glob.glob(os.path.join(SRC, '*_cycle.png'))):
        name = os.path.basename(path)[:-len('_cycle.png')]      # e.g. knight_t2
        board = np.array(Image.open(path).convert('RGBA'))
        no_alpha = (board[:, :, 3] < 10).mean() < 0.55
        cells = []
        for k in range(8):
            c = board[(k // 4) * 512:(k // 4 + 1) * 512, (k % 4) * 384:(k % 4 + 1) * 384]
            cells.append(matte(c) if no_alpha else c)
        cuts = [cut(c) for c in cells]
        scale = 280.0 / cuts[0][1]
        for k, (crop, bh, (px, py), edge) in enumerate(cuts):
            pose = ('walk' if k < 4 else 'atk') + str(k % 4 + 1)
            img = Image.fromarray(crop)
            nw, nh = round(img.width * scale), round(img.height * scale)
            img = bleed_rgb(img).resize((nw, nh), Image.LANCZOS)
            fn = f'hero_cyc_{name}_{pose}.webp'
            save_webp(img, os.path.join(OUT, fn))
            key = f'cyc_{name}_{pose}'
            sprites['hero'][key] = {'id': key, 'pose': pose, 'file': 'assets/runtime/' + fn, 'size': [nw, nh], 'scale': round(scale, 4),
                                    'bodyHeightPx': round(float(bh * scale), 1), 'pivot': [round(float(px * scale), 1), round(float(py * scale), 1)],
                                    'touchesCellEdge': edge, 'status': 'RUNTIME_CYCLE_FRAME', 'source': 'gpt_j4/' + os.path.basename(path),
                                    'matte': 'estimated' if no_alpha else 'alpha'}
        print(name, 'matte' if no_alpha else 'alpha', round(scale, 3))
    sprites.setdefault('sources', {})['gpt_j4/*_cycle.png'] = 'GPT J4 — walk 4 + attack 4 frames for 16 tier-2/3 forms'
    text = json.dumps(sprites, ensure_ascii=False, indent=1)
    open(META, 'w').write(text)


if __name__ == '__main__':
    main()
