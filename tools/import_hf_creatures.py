#!/usr/bin/env python3
"""v19 2막 그림 들여오기: Higgsfield(GPT Image 2.6)로 한 장씩 뽑은 투명 PNG를 런타임 스프라이트로.

  python3 tools/import_hf_creatures.py <raw_dir> <roster.json>

raw_dir 안의 raw_<ID>.png(몬스터·보스, 투명 배경)와 raw_bg_<rXX>.png(배경)를 읽어서
assets/runtime/mon_<ID>.webp · boss_<ID>.webp · bg_<rXX>.webp로 저장하고 sprites.json에 등록합니다.
원본은 assets/source/gpt_v19/에 복사해 둡니다. 크기·발 위치(pivot)·히트박스 계산은 extract_v4b.py와 같은 방식.
"""
import json, os, shutil, sys
import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(__file__))
from extract_assets import bleed_rgb, body_box, ground_pivot, save_webp  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'runtime')
SRC = os.path.join(ROOT, 'assets', 'source', 'gpt_v19')
SPRITES = os.path.join(OUT, 'sprites.json')


def clean_alpha(rgba, keep_ratio=0.02):
    """반투명 잡티 제거: 가장 큰 덩어리 + 그 2% 이상 덩어리만 남김."""
    a = rgba[:, :, 3].astype(np.float32) / 255.0
    solid = a > 0.08
    lab, n = ndimage.label(solid)
    if n == 0:
        raise ValueError('empty image')
    areas = ndimage.sum(solid, lab, range(1, n + 1))
    main = int(np.argmax(areas)) + 1
    keep = np.zeros_like(solid)
    for i in range(1, n + 1):
        if areas[i - 1] >= areas[main - 1] * keep_ratio:
            keep |= lab == i
    zone = ndimage.binary_dilation(keep, iterations=3)
    a = np.where(zone, a, 0)
    a[a < 0.03] = 0
    return a, keep


def creature(path, out_name, target_h, flying, entry):
    rgba = np.array(Image.open(path).convert('RGBA'))
    a, keep = clean_alpha(rgba)
    ys, xs = np.nonzero(a > 0.03)
    pad = 6
    H, W = a.shape
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, H)
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, W)
    out = np.dstack([rgba[:, :, :3], (a * 255).astype(np.uint8)])[y0:y1, x0:x1].copy()
    out[out[:, :, 3] == 0, :3] = 0
    kmask = keep[y0:y1, x0:x1]
    img = Image.fromarray(out, 'RGBA')
    kys = np.nonzero(kmask)[0]
    body_h = kys.max() - kys.min()
    scale = target_h * 2 / body_h
    nw, nh = max(1, round(img.width * scale)), max(1, round(img.height * scale))
    img = bleed_rgb(img).resize((nw, nh), Image.LANCZOS)
    px, py = ground_pivot(kmask, flying)
    save_webp(img, os.path.join(OUT, out_name))
    return {
        **entry, 'displayBodyPx': target_h, 'file': 'assets/runtime/' + out_name, 'sourceRect': [0, 0, W, H],
        'trimOffset': [int(x0), int(y0)], 'size': [nw, nh], 'scale': round(scale, 4),
        'bodyHeightPx': round(body_h * scale, 1), 'pivot': [round(px * scale, 1), round(py * scale, 1)],
        'hitbox': [round(v * scale, 1) for v in body_box(kmask)], 'flying': flying, 'mirrored': False,
        'status': 'RUNTIME_STATIC_SPRITE', 'source': 'higgsfield_gpt_image_2_6',
    }


def background(path, bid, ground_ratio=0.86):
    im = Image.open(path).convert('RGB')
    im = im.resize((1024, round(im.height * 1024 / im.width)), Image.LANCZOS)
    im.save(os.path.join(OUT, f'bg_{bid}.webp'), 'WEBP', quality=82, method=6)
    return {'file': f'assets/runtime/bg_{bid}.webp', 'size': list(im.size), 'groundRatio': ground_ratio,
            'status': 'STATIC_SINGLE_LAYER_BACKGROUND', 'source': f'gpt_v19/bg_{bid}.png'}


def main():
    raw, roster_path = sys.argv[1], sys.argv[2]
    roster = json.load(open(roster_path, encoding='utf-8'))
    sp = json.load(open(SPRITES, encoding='utf-8'))
    os.makedirs(SRC, exist_ok=True)
    done = []
    for mid, name, _reg, px, fly, _d in roster['monsters']:
        f = os.path.join(raw, f'raw_{mid}.png')
        if not os.path.exists(f):
            continue
        shutil.copy(f, os.path.join(SRC, f'{mid}.png'))
        sp['monsters'][mid] = creature(f, f'mon_{mid}.webp', px, fly, {'id': mid, 'name': name})
        done.append(mid)
    for bid, name, _reg, px, _d in roster['bosses']:
        f = os.path.join(raw, f'raw_{bid}.png')
        if not os.path.exists(f):
            continue
        shutil.copy(f, os.path.join(SRC, f'{bid}.png'))
        sp['bosses'][bid] = creature(f, f'boss_{bid}.webp', px, False, {'id': bid, 'name': name})
        done.append(bid)
    for rid, name, _d in roster['regions']:
        f = os.path.join(raw, f'raw_bg_{rid}.png')
        if not os.path.exists(f):
            continue
        shutil.copy(f, os.path.join(SRC, f'bg_{rid}.png'))
        sp['backgrounds'][rid] = background(f, rid)
        done.append(rid)
    sp['sources']['gpt_v19/'] = {'status': 'GENERATED_SINGLE', 'note': 'v19 2막: Higgsfield GPT Image 2.6, 기존 시트를 스타일 참고로 한 장씩 생성 (투명 배경)'}
    json.dump(sp, open(SPRITES, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('imported', len(done), ' '.join(done))


if __name__ == '__main__':
    main()
