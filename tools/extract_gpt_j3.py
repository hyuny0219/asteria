"""GPT J3-style cycle sheets (walk 4 + basic attack 4) → hero_cyc_<cls>_<walk|atk><1-4>.webp.

assets/source/gpt_j3/<name>_cycle.png: 1536x1024, 4x2 cells (384x512), real alpha, facing right.
row 1 = walk cycle (4), row 2 = basic attack (raise → mid → impact → follow-through).
(elena_cycle_alt.png kept but unused: its row 1 is not a walk cycle.)
Scale: walk frame 1 solid height = 280 px (same as the 8 key poses). Pivot = feet band (cut()).
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from extract_assets import bleed_rgb, save_webp  # noqa: E402
from extract_gpt_c import cut  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets/source/gpt_j3')
OUT = os.path.join(ROOT, 'assets/runtime')
META = os.path.join(OUT, 'sprites.json')
SHEETS = {'warrior': 'serin_cycle.png', 'archer': 'lyra_cycle.png', 'mage': 'elena_cycle.png', 'rogue': 'nox_cycle.png'}


def main():
    sprites = json.load(open(META))
    for cls, fn in SHEETS.items():
        board = np.array(Image.open(os.path.join(SRC, fn)).convert('RGBA'))
        cuts = [cut(board[(k // 4) * 512:(k // 4 + 1) * 512, (k % 4) * 384:(k % 4 + 1) * 384]) for k in range(8)]
        scale = 280.0 / cuts[0][1]
        for k, (crop, bh, (px, py), edge) in enumerate(cuts):
            name = ('walk' if k < 4 else 'atk') + str(k % 4 + 1)
            img = Image.fromarray(crop)
            nw, nh = round(img.width * scale), round(img.height * scale)
            img = bleed_rgb(img).resize((nw, nh), Image.LANCZOS)
            out = f'hero_cyc_{cls}_{name}.webp'
            save_webp(img, os.path.join(OUT, out))
            key = f'cyc_{cls}_{name}'
            sprites['hero'][key] = {'id': key, 'cls': cls, 'pose': name, 'file': 'assets/runtime/' + out, 'size': [nw, nh], 'scale': round(scale, 4),
                                    'bodyHeightPx': round(float(bh * scale), 1), 'pivot': [round(float(px * scale), 1), round(float(py * scale), 1)],
                                    'touchesCellEdge': edge, 'status': 'RUNTIME_CYCLE_FRAME', 'source': 'gpt_j3/' + fn}
            if any(edge.values()):
                print('  edge', cls, name, edge)
        print(cls, 'scale', round(scale, 3))
    sprites.setdefault('sources', {})['gpt_j3/*_cycle.png'] = 'GPT J3 — walk 4 + basic attack 4 frames (Serin, Lyra, Elena, Nox)'
    text = json.dumps(sprites, ensure_ascii=False, indent=1)
    open(META, 'w').write(text)


if __name__ == '__main__':
    main()
