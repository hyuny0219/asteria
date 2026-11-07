"""GPT package J1 (helmet / armor / necklace high-rarity icons) → item_71..78.webp.

assets/source/gpt_j/icons_gear_high2.png (선배 pick; the other take is kept as *_alt.png):
1536x1024, 4x2 cells, real alpha.
row 1: helmet epic / legendary / mythic, armor epic   row 2: armor legendary / mythic, necklace epic / legendary
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from extract_assets import bleed_rgb, save_webp  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets/source/gpt_j/icons_gear_high2.png')
OUT = os.path.join(ROOT, 'assets/runtime')
META = os.path.join(OUT, 'sprites.json')
SIZE = 96
NAMES = ['helmet_epic', 'helmet_legendary', 'helmet_mythic', 'armor_epic',
         'armor_legendary', 'armor_mythic', 'necklace_epic', 'necklace_legendary']


def main():
    sprites = json.load(open(META))
    board = np.array(Image.open(SRC).convert('RGBA'))
    H, W = board.shape[:2]
    cw, ch = W // 4, H // 2
    for k, name in enumerate(NAMES):
        cell = board[(k // 4) * ch:(k // 4 + 1) * ch, (k % 4) * cw:(k % 4 + 1) * cw].copy()
        a = cell[:, :, 3]
        a[a < 10] = 0
        ys, xs = np.nonzero(a)
        crop = cell[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        h, w = crop.shape[:2]
        side = int(max(w, h) * 1.08)
        sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        sq.paste(Image.fromarray(crop), ((side - w) // 2, (side - h) // 2))
        img = bleed_rgb(sq).resize((SIZE, SIZE), Image.LANCZOS)
        iid = f'I{71 + k}'
        fn = f'item_{71 + k}.webp'
        save_webp(img, os.path.join(OUT, fn))
        sprites['items'][iid] = {'id': iid, 'name': name, 'file': 'assets/runtime/' + fn, 'size': [SIZE, SIZE],
                                 'cellRect': [int(xs.min()), int(ys.min()), int(w), int(h)], 'status': 'RUNTIME_ICON', 'source': 'gpt_j/icons_gear_high2.png'}
    sprites.setdefault('sources', {})['gpt_j/icons_gear_high2.png'] = 'GPT package J1 — helmet/armor/necklace epic+ icons'
    text = json.dumps(sprites, ensure_ascii=False, indent=1)
    open(META, 'w').write(text)
    print('ok', len(NAMES))


if __name__ == '__main__':
    main()
