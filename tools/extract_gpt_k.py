"""GPT package K (v8 content icons) → assets/runtime/skill_Q00..Q11.webp (96x96, transparent).

assets/source/gpt_k/icons_v8.png: 1536x1024, 4x3 cells (384x341), alpha with a faint colour haze.
Q00 루비 · Q01 사파이어 · Q02 에메랄드 · Q03 토파즈
Q04 자수정 · Q05 달빛 약초 수프 · Q06 야수 고기 구이 · Q07 전사의 만찬
Q08 쐐기 던전 · Q09 원정 파견 · Q10 월드 보스 · Q11 제작소
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(__file__))
from extract_assets import bleed_rgb, save_webp  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets/source/gpt_k/icons_v8.png')
OUT = os.path.join(ROOT, 'assets/runtime')
META = os.path.join(OUT, 'sprites.json')
NAMES = ['jewel_ruby', 'jewel_sapphire', 'jewel_emerald', 'jewel_topaz',
         'jewel_amethyst', 'food_soup', 'food_roast', 'food_feast',
         'emblem_mplus', 'emblem_expedition', 'emblem_worldboss', 'emblem_workshop']
LO, HI = 70, 190   # alpha remap: haze below LO goes, body above HI is solid
ROWS = [0, 310, 634, 1024]   # the medallion tips poke into the row-2 cell, so split on the real gaps


def main():
    sprites = json.load(open(META))
    board = np.array(Image.open(SRC).convert('RGBA'))
    H, W = board.shape[:2]
    cw, ch = W // 4, H // 3
    for k, name in enumerate(NAMES):
        cell = board[ROWS[k // 4]:ROWS[k // 4 + 1], (k % 4) * cw:(k % 4 + 1) * cw].copy()
        a = cell[:, :, 3].astype(np.float32)
        a = np.clip((a - LO) * 255 / (HI - LO), 0, 255)
        solid = a > 128
        # keep the main body plus anything attached (steam wisps, skewer tip); drop stray specks
        lab, n = ndimage.label(ndimage.binary_dilation(solid, iterations=6))
        if n:
            sz = ndimage.sum(solid, lab, range(1, n + 1))
            keep = np.isin(lab, [i + 1 for i in range(n) if sz[i] > 0.03 * sz.max()])
            a[~keep] = 0
        # fill pinholes inside the body so translucent gem facets stay opaque
        filled = ndimage.binary_fill_holes(a > 128)
        a[filled & (a < 255)] = np.maximum(a[filled & (a < 255)], 255 * (ndimage.binary_erosion(filled, iterations=2)[filled & (a < 255)]))
        cell[:, :, 3] = a.astype(np.uint8)
        ys, xs = np.nonzero(a > 20)
        crop = cell[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        h, w = crop.shape[:2]
        side = int(max(w, h) * 1.06)
        sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        sq.paste(Image.fromarray(crop), ((side - w) // 2, (side - h) // 2))
        img = bleed_rgb(sq).resize((96, 96), Image.LANCZOS)
        sid = f'Q{k:02d}'   # K* is taken by the class skill icons
        fn = f'skill_{sid}.webp'
        save_webp(img, os.path.join(OUT, fn))
        sprites['skills'][sid] = {'id': sid, 'name': name, 'file': 'assets/runtime/' + fn, 'size': [96, 96], 'status': 'RUNTIME_ICON', 'source': 'gpt_k/icons_v8.png'}
    sprites.setdefault('sources', {})['gpt_k/icons_v8.png'] = 'GPT package K — v8 jewels / foods / content emblems'
    open(META, 'w').write(json.dumps(sprites, ensure_ascii=False, indent=1))
    print('ok')


if __name__ == '__main__':
    main()
