"""GPT package F (icons) → assets/runtime item/skill icons (96x96 webp, transparent).

icons_gear_high.png (6x4): gloves E/L/M, boots E/L/M | ring E/L/M, tome E/L/M |
  bow E/L/M, twin daggers E/L/M | sword E/L/M, necklace M, -, -   → I49..I70
icons_skills_fix.png (6x4): 서리 고리, 후방 도약, 무리 사냥, 화살비 (replace K01/K10/K14/K15),
  talent emblems ×9 (T00..T08: knight, berserker, wizard, warlock, ranger, hunter,
  assassin, trickster, common), rift blessing emblems ×6 (R00..R05: 공격, 방어, 속도,
  회복, 시간, 회피)
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from extract_assets import bleed_rgb, save_webp  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets/source/gpt_f')
OUT = os.path.join(ROOT, 'assets/runtime')
META = os.path.join(OUT, 'sprites.json')
SIZE = 96
GEAR = ['gloves_epic', 'gloves_legendary', 'gloves_mythic', 'boots_epic', 'boots_legendary', 'boots_mythic',
        'ring_epic', 'ring_legendary', 'ring_mythic', 'mage_epic', 'mage_legendary', 'mage_mythic',
        'archer_epic', 'archer_legendary', 'archer_mythic', 'rogue_epic', 'rogue_legendary', 'rogue_mythic',
        'weapon_epic', 'weapon_legendary', 'weapon_mythic', 'necklace_mythic']
SKILL = ['K01', 'K10', 'K14', 'K15', 'T00', 'T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08',
         'R00', 'R01', 'R02', 'R03', 'R04', 'R05']


def icon(board, k, pad=0.04):
    H, W = board.shape[:2]
    cw, ch = W // 6, H // 4
    cell = board[(k // 6) * ch:(k // 6 + 1) * ch, (k % 6) * cw:(k % 6 + 1) * cw].copy()
    a = cell[:, :, 3]
    a[a < 10] = 0
    ys, xs = np.nonzero(a)
    crop = cell[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    h, w = crop.shape[:2]
    side = int(max(w, h) * (1 + 2 * pad))
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(Image.fromarray(crop), ((side - w) // 2, (side - h) // 2))
    return bleed_rgb(sq).resize((SIZE, SIZE), Image.LANCZOS), [int(xs.min()), int(ys.min()), int(w), int(h)]


def main():
    sprites = json.load(open(META))
    gear = np.array(Image.open(os.path.join(SRC, 'icons_gear_high.png')).convert('RGBA'))
    skl = np.array(Image.open(os.path.join(SRC, 'icons_skills_fix.png')).convert('RGBA'))
    for k, name in enumerate(GEAR):
        iid = f'I{49 + k}'
        img, rect = icon(gear, k)
        fn = f'item_{49 + k}.webp'
        save_webp(img, os.path.join(OUT, fn))
        sprites['items'][iid] = {'id': iid, 'name': name, 'file': 'assets/runtime/' + fn, 'size': [SIZE, SIZE], 'cellRect': rect,
                                 'status': 'RUNTIME_ICON', 'source': 'gpt_f/icons_gear_high.png'}
    for k, sid in enumerate(SKILL):
        img, rect = icon(skl, k)
        fn = f'skill_{sid}_f.webp' if sid.startswith('K') else f'skill_{sid}.webp'
        save_webp(img, os.path.join(OUT, fn))
        old = sprites['skills'].get(sid, {})
        sprites['skills'][sid] = {'id': sid, 'name': old.get('name', sid), 'file': 'assets/runtime/' + fn, 'size': [SIZE, SIZE], 'cellRect': rect,
                                  'status': 'RUNTIME_ICON', 'source': 'gpt_f/icons_skills_fix.png'}
    sprites.setdefault('sources', {})['gpt_f/icons_*.png'] = 'GPT package F — high-rarity gear, 4 skill fixes, talent & rift emblems'
    text = json.dumps(sprites, ensure_ascii=False, indent=1)
    open(META, 'w').write(text)
    print('items', len(GEAR), 'skills', len(SKILL))


if __name__ == '__main__':
    main()
