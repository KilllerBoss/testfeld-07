"""Dissect a Pollen Robotics original microduck ONNX — all structural facts."""
import sys
import onnx

m = onnx.load(sys.argv[1] if len(sys.argv) > 1 else '/home/z/my-project/scripts/pollen_ref/velstand.onnx')
print('== MODEL HEADER ==')
print('ir_version          :', m.ir_version)
print('producer_name       :', repr(m.producer_name))
print('producer_version    :', repr(m.producer_version))
print('model_version       :', m.model_version)
print('doc_string          :', repr(m.doc_string[:200]))
print('domain              :', repr(m.domain))
for o in m.opset_import:
    print('opset               : domain=%r version=%d' % (o.domain, o.version))

print('\n== METADATA_PROPS (%d) ==' % len(m.metadata_props))
for p in m.metadata_props:
    v = p.value
    if len(v) > 300:
        v = v[:300] + '…'
    print('  %-40s = %s' % (p.key, v))

g = m.graph
print('\n== GRAPH ==')
print('name                :', repr(g.name))
print('inputs:')
for i in g.input:
    dims = []
    for d in i.type.tensor_type.shape.dim:
        if d.HasField('dim_param'):
            dims.append(d.dim_param)
        else:
            dims.append(d.dim_value)
    print('  %-20s dtype=%d dims=%s' % (i.name, i.type.tensor_type.elem_type, dims))
print('outputs:')
for o in g.output:
    dims = []
    for d in o.type.tensor_type.shape.dim:
        if d.HasField('dim_param'):
            dims.append(d.dim_param)
        else:
            dims.append(d.dim_value)
    print('  %-20s dtype=%d dims=%s' % (o.name, o.type.tensor_type.elem_type, dims))
print('initializers        : %d' % len(g.initializer))
for init in g.initializer[:8]:
    print('   init %-18s dims=%s dtype=%d' % (init.name, list(init.dims), init.data_type))
if len(g.initializer) > 8:
    print('   … (%d more)' % (len(g.initializer) - 8))

print('\n== NODES (%d) ==' % len(g.node))
from collections import Counter
c = Counter(n.op_type for n in g.node)
print('op histogram        :', dict(c))
for idx, n in enumerate(g.node):
    ins = ','.join(n.input)
    outs = ','.join(n.output)
    attrs = ''
    for a in n.attribute:
        if a.type == onnx.AttributeProto.INT:
            attrs += ' %s=%d' % (a.name, a.i)
        elif a.type == onnx.AttributeProto.FLOAT:
            attrs += ' %s=%.3g' % (a.name, a.f)
        elif a.type == onnx.AttributeProto.INTS:
            attrs += ' %s=%s' % (a.name, list(a.ints))
        elif a.type == onnx.AttributeProto.TENSOR:
            attrs += ' %s=<TENSOR %s>' % (a.name, list(a.t.dims))
        else:
            attrs += ' %s(type=%d)' % (a.name, a.type)
    if idx < 40 or len(g.node) <= 40:
        print('  [%3d] %-14s %-30s -> %-22s%s' % (idx, n.op_type, ins, outs, attrs))

print('\n== VALUE_INFO (non-IO, %d) ==' % (len(g.value_info)))
for vi in g.value_info[:10]:
    dims = []
    if vi.type.tensor_type.HasField('shape'):
        for d in vi.type.tensor_type.shape.dim:
            dims.append(d.dim_param if d.HasField('dim_param') else d.dim_value)
    print('  %-20s dtype=%d dims=%s' % (vi.name, vi.type.tensor_type.elem_type, dims))

print('\n== SPARSE/EXTERNAL/TRAINING ==')
print('training_info       :', len(m.training_info))
print('functions           :', len(m.functions))
print('sparse_initializer  :', len(g.sparse_initializer))
print('quantization_annotation:', len(g.quantization_annotation))
