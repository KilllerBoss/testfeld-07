#!/usr/bin/env python3
"""Splice onnxexport.js lines 411-457 (old output assembly) with the new
Pollen-profile assembly. Line-based to avoid invisible-char mismatch."""
import io

P = '/home/z/my-project/app/src/main/assets/www/js/feld/onnxexport.js'
with io.open(P, encoding='utf-8') as f:
    lines = f.readlines()

# Sanity anchors (1-indexed): 411 = "  // Ausgänge immer float32", 457 = return…
a = lines[410].rstrip('\n')
b = lines[456].rstrip('\n')
assert a.strip().startswith('// Ausgänge immer float32'), repr(a)
assert b.strip().startswith('return { bytes: model'), repr(b)

new_block = """  // Ausgänge immer float32 — v3.5.0 heißt der Hauptausgang „actions“
  // (wie bei den Pollen-Originalen; „mu“ verstand ihr Loader nicht).
  nodes.push(node('Cast', ['mu_raw'], [POLL_PROFILE.outName], [attrI('to', DT.FLOAT)]));
  if (opts.valueHead) nodes.push(node('Cast', ['val_raw'], ['val'], [attrI('to', DT.FLOAT)]));

  // v3.5.0: KEINE value_info für Zwischentensoren mehr — das Pollen-Original
  // hat auch keine, und mit FESTEN Dims ([1, D]) ist ORTs Shape-Inferenz
  // vollständig (die alte „Inferred vs Declared“-Sorge galt dynamischen Dims).
  const graph = concatBytes([
    ...nodes.map((n) => bf(1, n)),
    bf(2, utf8(POLL_PROFILE.graph)),
    ...inits.map((t) => bf(5, t)),
    bf(11, valueInfo(POLL_PROFILE.inName, DT.FLOAT, [1, D])),
    bf(12, valueInfo(POLL_PROFILE.outName, DT.FLOAT, [1, A])),
    ...(opts.valueHead ? [bf(12, valueInfo('val', DT.FLOAT, [1, 1]))] : []),
  ]);
  const opset = concatBytes([bf(1, utf8('')), vf(2, POLL_PROFILE.opset)]);
  const model = concatBytes([
    vf(1, POLL_PROFILE.ir),
    bf(2, utf8(POLL_PROFILE.producer)),
    bf(3, utf8(POLL_PROFILE.producerVer)),
    bf(7, graph),
    bf(8, opset),
    ...buildPollenMeta(net, opts.meta || {}).map(([k, v]) => bf(14, metaEntry(k, v))),
  ]);
  return {
    bytes: model, format: fmt, ops: nodes.length, params: net.paramCount(),
    outputs: [POLL_PROFILE.outName].concat(extraOut),
    meta: buildPollenMeta(net, opts.meta || {}),
  };
"""

out = lines[:410] + [l + '\n' for l in new_block.split('\n')] + lines[457:]
with io.open(P, 'w', encoding='utf-8') as f:
    f.writelines(out)
print('OK — gesplittet. Neue Datei:', len(out), 'Zeilen')
