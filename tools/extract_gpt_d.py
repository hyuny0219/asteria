"""GPT package D (boss 4-action boards) → assets/runtime/boss_<id>_<act>.webp.

assets/source/gpt_d/boss_act_<B01..B10|guardian>.png: 1536x1024, 2x2 cells
(768x512), real alpha. Cells: idle / windup (heavy telegraph) / heavy (impact) /
enrage (HP <= 30%). One shared scale per boss, idle frame = current bodyHeightPx.
Uses the same cutter as package C (extract_gpt_c.cut).
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
SRC = os.path.join(ROOT, 'assets/source/gpt_d')
OUT = os.path.join(ROOT, 'assets/runtime')
META = os.path.join(OUT, 'sprites.json')
ACTS = ['idle', 'windup', 'heavy', 'enrage']
IDS = {f'B{i:02d}': f'boss_act_B{i:02d}.png' for i in range(1, 11)}
IDS['TOWER'] = 'boss_act_guardian.png'


def main():
    sprites = json.load(open(META))
    bosses = sprites['bosses']
    for bid, fn in IDS.items():
        board = np.array(Image.open(os.path.join(SRC, fn)).convert('RGBA'))
        H, W = board.shape[:2]
        cw, ch = W // 2, H // 2
        cuts = [cut(board[(k // 2) * ch:(k // 2 + 1) * ch, (k % 2) * cw:(k % 2 + 1) * cw]) for k in range(4)]
        scale = bosses[bid]['bodyHeightPx'] / cuts[0][1]
        frames = {}
        for act, (crop, bh, (px, py), edge) in zip(ACTS, cuts):
            img = Image.fromarray(crop)
            nw, nh = max(1, round(img.width * scale)), max(1, round(img.height * scale))
            img = bleed_rgb(img).resize((nw, nh), Image.LANCZOS)
            out = f'boss_{bid}_{act}.webp'
            save_webp(img, os.path.join(OUT, out))
            frames[act] = {'file': 'assets/runtime/' + out, 'size': [nw, nh], 'pivot': [round(px * scale, 1), round(py * scale, 1)],
                           'bodyHeightPx': round(bh * scale, 1), 'touchesCellEdge': edge}
            if any(edge.values()):
                print('  edge', bid, act, edge)
        bosses[bid]['frames'] = frames
        bosses[bid]['framesSource'] = 'gpt_d/' + fn
        print(bid, bosses[bid]['name'], 'scale', round(scale, 3), [f['size'] for f in frames.values()])
    sprites.setdefault('sources', {})['gpt_d/boss_act_*.png'] = 'GPT package D — boss idle/windup/heavy/enrage'
    text = json.dumps(sprites, ensure_ascii=False, indent=1)
    open(META, 'w').write(text)


if __name__ == '__main__':
    main()
