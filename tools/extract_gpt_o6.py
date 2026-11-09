"""GPT O6 (진화 스킬 아이콘) → assets/runtime/skill_evo_<branch>_<skillId>_t<n>.webp.

Source: assets/source/gpt_o6/evo_icons_<cls>.png (1536x1024, 8 columns x 4 rows).
  row 1..4 = the class's base skills 1..3 + ultimate (CLASS_SKILLS order)
  col 1..4 = first branch tier 1..4, col 5..8 = second branch tier 1..4
Each cell is trimmed to its alpha box, fitted into a 96x96 square (same size as the other
skill icons) and recorded in sprites.json["skills"] under the runtime key. The game picks
these up automatically (src/ui/evo.js → evoSkillIcon); missing sheets are skipped.

Run: python3 tools/extract_gpt_o6.py
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from extract_assets import bleed_rgb, save_webp  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets/source/gpt_o6')
OUT = os.path.join(ROOT, 'assets/runtime')
META = os.path.join(OUT, 'sprites.json')
SIZE = 96
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
        board = Image.open(path).convert('RGBA')
        W, H = board.size
        cw, ch = W // 8, H // 4
        for r, sid in enumerate(skills):
            for c in range(8):
                br, tier = branches[c // 4], c % 4 + 1
                cell = np.array(board.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)))
                a = cell[:, :, 3]
                ys, xs = np.nonzero(a > 16)
                if not len(xs):
                    print('empty cell', cls, r + 1, c + 1)
                    continue
                crop = Image.fromarray(cell[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
                s = SIZE / max(crop.size)
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
