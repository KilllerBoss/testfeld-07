#!/usr/bin/env python3
"""v2.14.0: Entfernt a1/spot/go2 aus robots.js (ROBOTS + ROBOT_ORDER)."""
import re, sys

P = '/home/z/my-project/app/src/main/assets/www/js/robots.js'
src = open(P, encoding='utf-8').read()
for rid in ['a1', 'spot', 'go2']:
    pat = re.compile(r'  ' + rid + r': \{.*?\n  \},\n', re.S)
    src2 = pat.sub('', src, count=1)
    assert src2 != src, f'Block {rid} nicht gefunden!'
    src = src2

src = src.replace('// ── Die vier Roboter ', '// ── Die drei Roboter (v2.14.0: MicroDuck + G1 + Drohne) ')
old_order = "export const ROBOT_ORDER = ['a1', 'spot', 'g1', 'go2', 'duck', 'x2'];"
new_order = "export const ROBOT_ORDER = ['g1', 'duck', 'x2'];"
assert old_order in src
src = src.replace(old_order, new_order)
open(P, 'w', encoding='utf-8').write(src)
print('OK — a1/spot/go2 entfernt, ROBOT_ORDER = [g1, duck, x2]')
