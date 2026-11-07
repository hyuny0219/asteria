"""GPT package E (companion 3-action boards) → assets/runtime/pet_<id>_<act>.webp.

assets/source/gpt_e/pets_act_K.png: 1536x1024, 3 cols x 2 rows (512x512 cells),
real alpha, facing right. Row 1 = P(2K-1), row 2 = P(2K). Columns: idle / attack /
happy (victory). Shared scale per pet, idle = current bodyHeightPx.
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
SRC = os.path.join(ROOT, 'assets/source/gpt_e')
OUT = os.path.join(ROOT, 'assets/runtime')
META = os.path.join(OUT, 'sprites.json')
ACTS = ['idle', 'attack', 'happy']


def main():
    sprites = json.load(open(META))
    pets = sprites['pets']
    for k in range(1, 4):
        board = np.array(Image.open(os.path.join(SRC, f'pets_act_{k}.png')).convert('RGBA'))
        H, W = board.shape[:2]
        cw, ch = W // 3, H // 2
        for row in range(2):
            pid = f'P{2 * k - 1 + row:02d}'
            cuts = [cut(board[row * ch:(row + 1) * ch, c * cw:(c + 1) * cw]) for c in range(3)]
            scale = pets[pid]['bodyHeightPx'] / cuts[0][1]
            frames = {}
            for act, (crop, bh, (px, py), edge) in zip(ACTS, cuts):
                img = Image.fromarray(crop)
                nw, nh = max(1, round(img.width * scale)), max(1, round(img.height * scale))
                img = bleed_rgb(img).resize((nw, nh), Image.LANCZOS)
                out = f'pet_{pid}_{act}.webp'
                save_webp(img, os.path.join(OUT, out))
                frames[act] = {'file': 'assets/runtime/' + out, 'size': [nw, nh], 'pivot': [round(px * scale, 1), round(py * scale, 1)],
                               'bodyHeightPx': round(bh * scale, 1), 'touchesCellEdge': edge}
                if any(edge.values()):
                    print('  edge', pid, act, edge)
            pets[pid]['frames'] = frames
            pets[pid]['framesSource'] = f'gpt_e/pets_act_{k}.png row {row + 1}'
            print(pid, pets[pid].get('name'), 'scale', round(scale, 3), [f['size'] for f in frames.values()])
    sprites.setdefault('sources', {})['gpt_e/pets_act_*.png'] = 'GPT package E — companion idle/attack/happy'
    text = json.dumps(sprites, ensure_ascii=False, indent=1)
    open(META, 'w').write(text)


if __name__ == '__main__':
    main()
