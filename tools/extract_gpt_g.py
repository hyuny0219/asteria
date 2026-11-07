"""GPT package G (battle backgrounds) → assets/runtime/bg_<id>.webp + sprites.json.

groundRatio = where feet stand inside the picture (fraction of height), checked by
eye on the battle screen (tools: qa_immersive captures).
"""
import json
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from extract_assets import save_webp  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets/source/gpt_g')
OUT = os.path.join(ROOT, 'assets/runtime')
META = os.path.join(OUT, 'sprites.json')
BGS = {'vault': ('bg_gold_vault.png', 0.84), 'library': ('bg_book_library.png', 0.84),
       'trial': ('bg_trial_hall.png', 0.86), 'rift': ('bg_rift.png', 0.86)}


def main():
    sprites = json.load(open(META))
    for bid, (fn, ground) in BGS.items():
        im = Image.open(os.path.join(SRC, fn)).convert('RGB').resize((1024, 683), Image.LANCZOS)
        out = f'bg_{bid}.webp'
        save_webp(im, os.path.join(OUT, out), quality=82)
        sprites['backgrounds'][bid] = {'file': 'assets/runtime/' + out, 'size': [1024, 683], 'groundRatio': ground,
                                       'status': 'STATIC_SINGLE_LAYER_BACKGROUND', 'source': 'gpt_g/' + fn}
        print(bid, os.path.getsize(os.path.join(OUT, out)) // 1024, 'KB')
    sprites.setdefault('sources', {})['gpt_g/bg_*.png'] = 'GPT package G — vault / library / trial hall / rift backgrounds'
    text = json.dumps(sprites, ensure_ascii=False, indent=1)
    open(META, 'w').write(text)


if __name__ == '__main__':
    main()
