"""GPT package L (v10 icons) → assets/runtime/skill_L00..L11.webp (96x96, transparent).

assets/source/gpt_l/icons_v10.png: 1536x1024, 4x3 cells (384x341), alpha with a soft glow haze.
L00 전사 고유 · L01 마법사 고유 · L02 궁수 고유 · L03 도적 고유
L04 공용 고유 · L05 추출 · L06 이식 · L07 보관함
L08 재련 · L09 등급 올리기 · L10 각성 A · L11 각성 B
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
SRC = os.path.join(ROOT, 'assets/source/gpt_l/icons_v10.png')
OUT = os.path.join(ROOT, 'assets/runtime')
META = os.path.join(OUT, 'sprites.json')
NAMES = ['legend_warrior', 'legend_mage', 'legend_archer', 'legend_rogue', 'legend_common', 'extract', 'imprint', 'vault',
         'reforge', 'rarityup', 'awaken_a', 'awaken_b']


def main():
    sprites = json.load(open(META))
    board = np.array(Image.open(SRC).convert('RGBA'))
    H, W = board.shape[:2]
    cw, ch = W // 4, H // 3
    for k, name in enumerate(NAMES):
        cell = board[(k // 4) * ch:(k // 4 + 1) * ch, (k % 4) * cw:(k % 4 + 1) * cw].copy()
        a = cell[:, :, 3].astype(np.float32)
        # drop the faint backdrop haze: remap alpha 60..200 → 0..255, keep the main body
        a = np.clip((a - 60) * 255 / 140, 0, 255)
        solid = a > 128
        lab, n = ndimage.label(ndimage.binary_dilation(solid, iterations=6))
        if n:
            sz = ndimage.sum(solid, lab, range(1, n + 1))
            keep = np.isin(lab, [i + 1 for i in range(n) if sz[i] > 0.03 * sz.max()])
            a[~keep] = 0
        cell[:, :, 3] = a.astype(np.uint8)
        ys, xs = np.nonzero(a > 20)
        crop = cell[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        h, w = crop.shape[:2]
        side = int(max(w, h) * 1.06)
        sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        sq.paste(Image.fromarray(crop), ((side - w) // 2, (side - h) // 2))
        img = bleed_rgb(sq).resize((96, 96), Image.LANCZOS)
        sid = f'L{k:02d}'
        fn = f'skill_{sid}.webp'
        save_webp(img, os.path.join(OUT, fn))
        sprites['skills'][sid] = {'id': sid, 'name': name, 'file': 'assets/runtime/' + fn, 'size': [96, 96], 'status': 'RUNTIME_ICON', 'source': 'gpt_l/icons_v10.png'}
    sprites.setdefault('sources', {})['gpt_l/icons_v10.png'] = 'GPT package L — v10 legend / awaken / forge icons'
    open(META, 'w').write(json.dumps(sprites, ensure_ascii=False, indent=1))
    print('ok')


if __name__ == '__main__':
    main()
