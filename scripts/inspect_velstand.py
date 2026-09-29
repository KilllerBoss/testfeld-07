#!/usr/bin/env python3
# Dissektiert velstand.onnx (Pollen-Original) + feld_export_fp32.onnx (unser Export)
# und vergleicht Format: IR, opset, producer, graph, IO, Metadaten, Node-Ops, Initializer.
import onnx, sys

def dissect(path, full_meta=True):
    m = onnx.load(path)
    g = m.graph
    print('=' * 78)
    print('DATEI :', path)
    print('ir_version', m.ir_version, '| producer', m.producer_name, m.producer_version,
          '| graph', g.name)
    print('opset', [(o.domain or 'ai.onnx', o.version) for o in m.opset_import])
    for vi in list(g.input) + list(g.output):
        t = vi.type.tensor_type
        dims = [d.dim_value if d.HasField('dim_value') else d.dim_param for d in t.shape.dim]
        print(f'  IO  {vi.name:10s} dtype={t.elem_type} dims={dims}')
    print('  metadata_props:', len(m.metadata_props))
    for p in m.metadata_props:
        v = p.value
        if full_meta and len(v) < 300:
            print(f'    {p.key} = {v}')
        else:
            print(f'    {p.key} = <{len(v)} chars> {v[:120]}...' if full_meta else f'    {p.key}')
    print('  nodes:', len(g.node))
    ops = {}
    for n in g.node:
        ops[n.op_type] = ops.get(n.op_type, 0) + 1
    print('  op-counts:', ops)
    print('  node sequence:', ' -> '.join(n.op_type for n in g.node[:24]),
          ('...' if len(g.node) > 24 else ''))
    print('  initializers:', len(g.initializer))
    for init in g.initializer:
        print(f'    {init.name:12s} dtype={init.data_type} dims={list(init.dims)}')
    print('  value_info:', len(g.value_info))

for p in sys.argv[1:]:
    try:
        dissect(p)
    except Exception as e:
        print('FEHLER bei', p, '->', e)
