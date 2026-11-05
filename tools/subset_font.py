#!/usr/bin/env python3
"""Build a WOFF2 subset of Noto Sans KR (OFL) for the game.

Input: the handoff TTF (not committed, 10 MB). Output: assets/runtime/fonts/.
Glyphs: ASCII, Latin-1 punctuation, arrows/symbols used by the UI, and the
2,350 KS X 1001 Hangul syllables, plus any character found in src/ and data/.
"""
import glob
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
src = sys.argv[1]
chars = set(chr(c) for c in range(0x20, 0x7F))
chars |= set('·•…→←↑↓×÷±≤≥%‰°℃①②③④⑤ⅠⅡⅢⅣⅤⅥ“”‘’「」『』《》〈〉–—★☆♪')
for b1 in range(0xB0, 0xC9):
    for b2 in range(0xA1, 0xFF):
        try:
            chars.add(bytes([b1, b2]).decode('euc-kr'))
        except UnicodeDecodeError:
            pass
for f in glob.glob(os.path.join(ROOT, 'src', '**', '*.*'), recursive=True) + glob.glob(os.path.join(ROOT, 'data', '*.json')) + [os.path.join(ROOT, 'index.html')]:
    if os.path.isfile(f):
        chars |= set(open(f, encoding='utf-8', errors='ignore').read())
chars = {c for c in chars if ord(c) >= 0x20}
os.makedirs(os.path.join(ROOT, 'assets', 'runtime', 'fonts'), exist_ok=True)
font = TTFont(src)
axes = [a.axisTag for a in font['fvar'].axes] if 'fvar' in font else []
print('variable axes', axes, 'glyph chars', len(chars))
for weight, name in ((400, 'regular'), (700, 'bold')):
    f = TTFont(src)
    if axes:
        from fontTools.varLib import instancer
        f = instancer.instantiateVariableFont(f, {'wght': weight})
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(text=''.join(sorted(chars)))
    sub.subset(f)
    out = os.path.join(ROOT, 'assets', 'runtime', 'fonts', f'NotoSansKR-{name}.woff2')
    f.flavor = 'woff2'
    f.save(out)
    print(out, os.path.getsize(out))
