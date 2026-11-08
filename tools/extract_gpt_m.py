"""GPT package M (skill grade frames) -> assets/runtime/frame_sg_<grade>.webp + sprites.json["gradeFrames"].

Source: assets/source/gpt_m/skill_grade_frames.png (1536x1024, 3x2 cells of 512, real alpha).
  row 1: rare (silver-blue), epic (amethyst), legendary (gold)
  row 2: mythic (rose), grade-up emblem, (empty)
Common skills have no frame.

Each frame is cropped to its outer alpha box (square), and the transparent hole in the
middle is measured (the largest see-through region around the centre) so the UI can lay
the frame over a skill icon with the hole matching the icon:
  inner = {l, t, r, b} fractions of the saved frame.
The emblem is cropped to its alpha box and saved as frame_sg_up.webp.
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
SRC = os.path.join(ROOT, 'assets/source/gpt_m/skill_grade_frames.png')
OUT = os.path.join(ROOT, 'assets/runtime')
META = os.path.join(OUT, 'sprites.json')
SIZE = 160      # runtime frame size (px); shown at 44..64 css px, 2x dpr
EMBLEM = 128
CELLS = ['rare', 'epic', 'legendary', 'mythic', 'up', None]
LO, HI = 56, 200   # backdrop haze remap (extract_assets.HAZE_LO/HI)


def main():
    board = np.array(Image.open(SRC).convert('RGBA'))
    sprites = json.load(open(META))
    res = {}
    for i, key in enumerate(CELLS):
        if key is None:
            continue
        c, r = i % 3, i // 3
        cell = board[r * 512:(r + 1) * 512, c * 512:(c + 1) * 512].copy()
        a = np.clip((cell[:, :, 3].astype(np.float32) - LO) * 255 / (HI - LO), 0, 255).astype(np.uint8)
        cell[:, :, 3] = a
        cell[a == 0, :3] = 0
        ys, xs = np.nonzero(a > 40)
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        if key == 'up':
            crop = cell[y0:y1, x0:x1]
            img = bleed_rgb(Image.fromarray(crop))
            s = EMBLEM / max(img.size)
            img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
            save_webp(img, os.path.join(OUT, 'frame_sg_up.webp'), quality=88)
            res['up'] = {'file': 'assets/runtime/frame_sg_up.webp', 'w': img.width, 'h': img.height}
            print('up', img.size)
            continue
        # square crop around the frame centre
        side = max(x1 - x0, y1 - y0)
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        sx0, sy0 = cx - side // 2, cy - side // 2
        sq = np.zeros((side, side, 4), np.uint8)
        for yy in range(side):
            y = sy0 + yy
            if 0 <= y < 512:
                xa, xb = max(sx0, 0), min(sx0 + side, 512)
                sq[yy, xa - sx0:xb - sx0] = cell[y, xa:xb]
        # hole = see-through component containing the centre; its box, shrunk by the
        # inner bevel so the frame bar overlaps the icon edge by a hair
        clear = sq[:, :, 3] < 40
        lab, _ = ndimage.label(clear)
        hole = lab == lab[side // 2, side // 2]
        hy, hx = np.nonzero(hole)
        l, t, rr, b = hx.min() / side, hy.min() / side, (hx.max() + 1) / side, (hy.max() + 1) / side
        img = bleed_rgb(Image.fromarray(sq)).resize((SIZE, SIZE), Image.LANCZOS)
        fn = f'frame_sg_{key}.webp'
        save_webp(img, os.path.join(OUT, fn), quality=90)
        res[key] = {'file': 'assets/runtime/' + fn, 'w': SIZE, 'h': SIZE,
                    'inner': {'l': round(l, 3), 't': round(t, 3), 'r': round(rr, 3), 'b': round(b, 3)}}
        print(key, res[key]['inner'])
    sprites['gradeFrames'] = res
    sprites.setdefault('sources', {})['gpt_m/skill_grade_frames.png'] = 'GPT package M'
    json.dump(sprites, open(META, 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
