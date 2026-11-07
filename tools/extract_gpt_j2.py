"""GPT package J2 (Elena 8 key poses redrawn, real alpha, tome glow kept) → hero_pose_mage_<pose>.webp.

assets/source/gpt_j/elena_poses_fix.png: 1536x1024, 4x2 cells (384x512):
idle / step / anticipation / thrust(마법탄) | recovery / hit / cast / victory.
Shared scale: idle solid-body height = 280 px (same as before). Pivot = feet band centre (cut()).
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
SRC = os.path.join(ROOT, 'assets/source/gpt_j/elena_poses_fix.png')
OUT = os.path.join(ROOT, 'assets/runtime')
META = os.path.join(OUT, 'sprites.json')
POSES = ['idle', 'step', 'anticipation', 'thrust', 'recovery', 'hit', 'cast', 'victory']


def main():
    sprites = json.load(open(META))
    board = np.array(Image.open(SRC).convert('RGBA'))
    cuts = [cut(board[(k // 4) * 512:(k // 4 + 1) * 512, (k % 4) * 384:(k % 4 + 1) * 384]) for k in range(8)]
    scale = 280.0 / cuts[0][1]
    for k, (pose, (crop, bh, (px, py), edge)) in enumerate(zip(POSES, cuts)):
        img = Image.fromarray(crop)
        nw, nh = round(img.width * scale), round(img.height * scale)
        img = bleed_rgb(img).resize((nw, nh), Image.LANCZOS)
        fn = f'hero_pose_mage_{pose}.webp'
        save_webp(img, os.path.join(OUT, fn))
        key = f'pose_mage_{pose}'
        e = sprites['hero'].get(key, {})
        e.update({'id': key, 'cls': 'mage', 'pose': pose, 'file': 'assets/runtime/' + fn, 'sourceRect': [(k % 4) * 384, (k // 4) * 512, 384, 512],
                  'size': [nw, nh], 'scale': round(scale, 4), 'bodyHeightPx': round(bh * scale, 1),
                  'pivot': [round(px * scale, 1), round(py * scale, 1)], 'touchesCellEdge': edge,
                  'status': 'RUNTIME_KEY_POSE', 'source': 'gpt_j/elena_poses_fix.png'})
        e.pop('trimOffset', None); e.pop('droppedBleedComponents', None)
        sprites['hero'][key] = e
        print(pose, (nw, nh), e['pivot'], e['bodyHeightPx'], 'EDGE' if any(edge.values()) else '')
    sprites.setdefault('sources', {})['gpt_j/elena_poses_fix.png'] = 'GPT package J2 — Elena 8 key poses (alpha, tome glow kept)'
    text = json.dumps(sprites, ensure_ascii=False, indent=1)
    open(META, 'w').write(text)


if __name__ == '__main__':
    main()
