#!/usr/bin/env python3
"""v5 art: 6 companions (pets_6.png, 3×2, facing right) and 16 content emblems
(icons_v5.png, 4×4) from assets/source/generated/ (never modified).
Run after tools/extract_v4b.py:  python3 tools/extract_v5.py
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from extract_v4b import GEN, OUT, META, creature, grid_rects, load  # noqa: E402

PETS = [('P01', '별여우', 56, False), ('P02', '불씨 새끼용', 52, True), ('P03', '서리 올빼미', 50, True),
        ('P04', '숲정령 사슴', 60, False), ('P05', '그림자 고양이', 48, False), ('P06', '빛의 정령', 50, True)]
ICONS = ['talents', 'rebirth', 'rift', 'blessing', 'codexMonster', 'codexItem', 'achievement', 'title',
         'pass', 'craft', 'petEgg', 'petFood', 'curse', 'relic', 'essence', 'crown']


def main():
    import extract_v4b
    extract_v4b.HOLE_FILL_NEEDS_MATTE = True
    sprites = json.load(open(META))
    sprites.setdefault('pets', {})
    rgb, matte = load('pets_6')
    for (pid, name, h, fly), rect in zip(PETS, grid_rects(rgb.shape, 3, 2)):
        e = creature(rgb, matte, rect, f'pet_{pid}.webp', h, fly, {'id': pid, 'name': name})
        e['source'] = 'generated/pets_6.png'
        sprites['pets'][pid] = e
    sprites['sources']['generated/pets_6.png'] = {'status': 'GENERATED_BOARD', 'note': '6 companions, face right'}
    # emblems: square painted icons, crop each cell with a small inset (no keying)
    arr = np.array(Image.open(os.path.join(GEN, 'icons_v5.png')).convert('RGB'))
    H, W = arr.shape[:2]
    cw, ch = W // 4, H // 4
    for i, key in enumerate(ICONS):
        r, c = divmod(i, 4)
        cell = arr[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw]
        # find the icon's bright box inside the cell (board gaps are near-black)
        lum = cell.mean(axis=2)
        ys, xs = np.nonzero(lum > 40)
        y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
        side = max(y1 - y0, x1 - x0)
        cy, cx = (y0 + y1) // 2, (x0 + x1) // 2
        half = side // 2
        y0, x0 = max(0, cy - half), max(0, cx - half)
        icon = Image.fromarray(cell[y0:y0 + side, x0:x0 + side]).resize((96, 96), Image.LANCZOS)
        iid = f'V{i:02d}'
        icon.save(os.path.join(OUT, f'skill_{iid}.webp'), 'WEBP', quality=86, method=6)
        sprites['skills'][iid] = {'id': iid, 'name': key, 'file': f'assets/runtime/skill_{iid}.webp', 'sourceRect': [int(c * cw + x0), int(r * ch + y0), int(side), int(side)],
                                  'size': [96, 96], 'status': 'RUNTIME_ICON', 'source': 'generated/icons_v5.png'}
    sprites['sources']['generated/icons_v5.png'] = {'status': 'GENERATED_BOARD', 'note': '4x4 content emblems (V00–V15)'}
    json.dump(sprites, open(META, 'w'), ensure_ascii=False, indent=1)
    print('pets', len(PETS), 'icons', len(ICONS))


if __name__ == '__main__':
    main()
