"""GPT package I (stage maps) → assets/runtime/map_<region>.webp + sprites.json["maps"].

Road polylines: hand-traced (assets/source/gpt_i/paths_traced.json, % of the
image) then snapped to the bright road band (paths_snapped.json, 121 points,
bottom → top). Nodes 1..10 sit at 5%..88% of the road's length, the boss near its end (kept >= 11% from the top).
"""
import json
import math
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from extract_assets import save_webp  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets/source/gpt_i')
OUT = os.path.join(ROOT, 'assets/runtime')
META = os.path.join(OUT, 'sprites.json')


def at(pts, f):
    seg = [math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    t = f * sum(seg)
    for i, s in enumerate(seg):
        if t <= s and s > 0:
            q = t / s
            return [round(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * q, 1), round(pts[i][1] + (pts[i + 1][1] - pts[i][1]) * q, 1)], i
        t -= s
    return list(pts[-1]), len(pts) - 1


def main():
    paths = json.load(open(os.path.join(SRC, 'paths_snapped.json')))
    sprites = json.load(open(META))
    maps = {}
    for region, pts in paths.items():
        im = Image.open(os.path.join(SRC, f'map_{region}.png')).convert('RGB').resize((640, 960), Image.LANCZOS)
        fn = f'map_{region}.webp'
        save_webp(im, os.path.join(OUT, fn), quality=80)
        # boss: as close to the gate as possible while its badge stays inside the map (y >= 11%)
        fb = 1.0
        while fb > 0.9 and at(pts, fb)[0][1] < 11:
            fb -= 0.005
        fr = [0.05 + 0.83 * i / 9 for i in range(10)] + [fb]
        nodes, idx = zip(*[at(pts, f) for f in fr])
        path = pts[::3] + ([pts[-1]] if (len(pts) - 1) % 3 else [])
        maps[region] = {'file': 'assets/runtime/' + fn, 'nodes': list(nodes), 'path': path, 'nodeIdx': [round(i / 3) for i in idx]}
        print(region, os.path.getsize(os.path.join(OUT, fn)) // 1024, 'KB')
    sprites['maps'] = maps
    sprites.setdefault('sources', {})['gpt_i/map_*.png'] = 'GPT package I'
    json.dump(sprites, open(META, 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
