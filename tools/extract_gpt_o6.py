"""GPT O6 (진화 스킬 아이콘) → assets/runtime/skill_evo_<branch>_<skillId>_t<n>.webp.

Source: assets/source/gpt_o6/evo_icons_<cls>.png (1536x1024, 8 columns x 4 rows).
  row 1..4 = the class's base skills 1..3 + ultimate (CLASS_SKILLS order)
  col 1..4 = first branch tier 1..4, col 5..8 = second branch tier 1..4
The sheets carry a faint backdrop haze (alpha 1..8, up to ~65 and tinted on the mage sheet), so
alpha is kept only within GLOW px of solid paint (alpha >= SOLID): coloured glows hugging an
icon survive, the backdrop goes. Wide icons (warrior t4 shards, archer winged boots) cross the
nominal cell lines, so alpha components are labelled over the whole sheet and each one goes to
the cell holding its centroid. Each icon is trimmed to its own pixels, centred and fitted into a
96x96 square (same size as the other skill icons), recorded in sprites.json["skills"]. The game picks
these up automatically (src/ui/evo.js → evoSkillIcon); missing sheets are skipped.

Run: python3 tools/extract_gpt_o6.py
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
SRC = os.path.join(ROOT, 'assets/source/gpt_o6')
OUT = os.path.join(ROOT, 'assets/runtime')
META = os.path.join(OUT, 'sprites.json')
SIZE = 96
SOLID = 120
GLOW = 6
PADF = 0.04
# keep in sync with src/data/content.js CLASS_SKILLS / branchesOf
CLASSES = {
    'warrior': (['strike', 'shieldCharge', 'warCry', 'starSlash'], ['knight', 'berserker']),
    'mage': (['m_fireball', 'm_frost', 'm_shield', 'm_meteor'], ['wizard', 'warlock']),
    'archer': (['a_aim', 'a_multi', 'a_leap', 'a_rain'], ['ranger', 'hunter']),
    'rogue': (['r_stab', 'r_poison', 'r_shadow', 'r_blades'], ['assassin', 'trickster']),
}


def main():
    sprites = json.load(open(META))
    n = 0
    for cls, (skills, branches) in CLASSES.items():
        path = os.path.join(SRC, f'evo_icons_{cls}.png')
        if not os.path.exists(path):
            print('skip (missing)', path)
            continue
        board = np.array(Image.open(path).convert('RGBA'))
        H, W = board.shape[:2]
        cw, ch = W // 8, H // 4
        a = board[:, :, 3].astype(np.float32)
        a[a < 10] = 0
        zone = ndimage.binary_dilation(a >= SOLID, iterations=GLOW)
        a[~zone] = 0
        board[:, :, 3] = a.astype(np.uint8)
        board[a == 0, :3] = 0
        lab, nl = ndimage.label(a > 0, structure=np.ones((3, 3)))
        sizes = ndimage.sum(np.ones_like(a), lab, range(1, nl + 1))
        coms = ndimage.center_of_mass(a > 0, lab, range(1, nl + 1))
        owner = np.zeros(nl + 1, np.int16) - 1
        for i in range(nl):
            if sizes[i] < 40:
                continue
            cy, cx = coms[i]
            owner[i + 1] = min(int(cy // ch), 3) * 8 + min(int(cx // cw), 7)
        own = owner[lab]
        for r, sid in enumerate(skills):
            for c in range(8):
                br, tier = branches[c // 4], c % 4 + 1
                m = own == r * 8 + c
                ys, xs = np.nonzero(m)
                if not len(xs):
                    print('empty cell', cls, r + 1, c + 1)
                    continue
                y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
                cell = board[y0:y1, x0:x1].copy()
                cell[~m[y0:y1, x0:x1], 3] = 0
                crop = Image.fromarray(cell)
                if x0 < c * cw - 2 or x1 > (c + 1) * cw + 2 or y0 < r * ch - 2 or y1 > (r + 1) * ch + 2:
                    print('crosses cell line', cls, r + 1, c + 1, (x0 - c * cw, y0 - r * ch, x1 - c * cw, y1 - r * ch))
                inner = round(SIZE * (1 - 2 * PADF))
                s = inner / max(crop.size)
                crop = bleed_rgb(crop).resize((max(1, round(crop.width * s)), max(1, round(crop.height * s))), Image.LANCZOS)
                icon = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
                icon.paste(crop, ((SIZE - crop.width) // 2, (SIZE - crop.height) // 2), crop)
                key = f'skill_evo_{br}_{sid}_t{tier}'
                fn = key + '.webp'
                save_webp(icon, os.path.join(OUT, fn))
                sprites['skills'][key] = {'id': key, 'file': 'assets/runtime/' + fn, 'size': [SIZE, SIZE], 'status': 'RUNTIME_ICON', 'source': f'gpt_o6/evo_icons_{cls}.png r{r + 1}c{c + 1}'}
                n += 1
    sprites.setdefault('sources', {})['gpt_o6'] = 'GPT package O6 (진화 스킬 아이콘)'
    json.dump(sprites, open(META, 'w'), ensure_ascii=False, indent=1)
    print('icons', n)


if __name__ == '__main__':
    main()
