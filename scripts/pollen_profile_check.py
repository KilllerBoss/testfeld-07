#!/usr/bin/env python3
"""pollen_profile_check.py — Beweis: Feld-Export == Pollen-Original-Format.

Vergleicht feld_export_fp32.onnx (aus der App, via Node gebaut) gegen
velstand.onnx (pollen-robotics/microduck-policies, Original) Feld für Feld:
Header, opset, Graph-Name, IO-Namen/-Shapes/-Dtypes, Metadaten-Schlüssel,
läuft beide durch onnx.checker + onnxruntime.
"""
import sys
import onnx
import onnxruntime as ort

ORIG = '/home/z/my-project/scripts/pollen_ref/velstand.onnx'
OURS = '/home/z/my-project/scripts/pollen_ref/feld_export_fp32.onnx'

pass_n = fail_n = 0
def ok(cond, name, detail=''):
    global pass_n, fail_n
    if cond:
        pass_n += 1
        print('  ✓ ' + name + (' — ' + detail if detail else ''))
    else:
        fail_n += 1
        print('  ✗ ' + name + (' — ' + detail if detail else ''))

o = onnx.load(ORIG)
w = onnx.load(OURS)

print('── 1. onnx.checker (Struktur-Validierung) ──')
ok(onnx.checker.check_model(o, full_check=True) is None, 'Original besteht check_model')
try:
    onnx.checker.check_model(w, full_check=True)
    ok(True, 'Feld-Export besteht check_model (opset 18, feste Dims)')
except Exception as e:
    ok(False, 'Feld-Export besteht check_model', str(e)[:200])

print('── 2. Modell-Header ──')
ok(w.ir_version == o.ir_version, 'ir_version', '%d == %d' % (w.ir_version, o.ir_version))
ok(w.producer_name == o.producer_name, 'producer_name', repr(w.producer_name))
ok(w.producer_version == o.producer_version, 'producer_version', repr(w.producer_version))
ok(len(w.opset_import) == len(o.opset_import) == 1, 'genau 1 opset_import')
ok(w.opset_import[0].domain == o.opset_import[0].domain and w.opset_import[0].version == o.opset_import[0].version,
   'opset', "domain=%r version=%d" % (w.opset_import[0].domain, w.opset_import[0].version))
ok(w.graph.name == o.graph.name, 'graph.name', repr(w.graph.name))

print('── 3. Ein-/Ausgänge (Namen + FESTE Shapes) ──')
def io_sig(vi):
    tt = vi.type.tensor_type
    dims = []
    for d in tt.shape.dim:
        if d.HasField('dim_param'):
            dims.append('dyn:' + d.dim_param)
        else:
            dims.append(d.dim_value)
    return (vi.name, tt.elem_type, dims)
for label, model, D in [('Original', o, 61), ('Feld', w, 61)]:
    i = io_sig(model.graph.input[0])
    out = io_sig(model.graph.output[0])
    ok(i == ('obs', 1, [1, D]), label + ' Input', str(i))
    ok(out[0] == 'actions' and out[1] == 1 and out[2][0] == 1 and out[2][1] == 14,
       label + ' Output', str(out))
ok(len(w.graph.input) == 1 and len(w.graph.output) == 1, 'genau 1 Eingang, 1 Ausgang (wie Original)')
ok(all(not d.HasField('dim_param') for d in w.graph.input[0].type.tensor_type.shape.dim
       for d in w.graph.input[0].type.tensor_type.shape.dim) if False else
   all(not dd.HasField('dim_param') for dd in w.graph.input[0].type.tensor_type.shape.dim),
   'keine dynamischen Dims im Feld-Export')

print('── 4. Metadaten (mjlab get_base_metadata-Schlüssel) ──')
om = {p.key: p.value for p in o.metadata_props}
wm = {p.key: p.value for p in w.metadata_props}
ok(set(wm.keys()) == set(om.keys()), 'Metadaten-Schlüssel identisch',
   'Orig: %d, Feld: %d' % (len(om), len(wm)))
ok(wm.get('joint_names') == om.get('joint_names'), 'joint_names identisch (dieselbe MJCF)',
   wm.get('joint_names', '')[:60] + '…')
ok(wm.get('default_joint_pos') == om.get('default_joint_pos'), 'default_joint_pos identisch',
   wm.get('default_joint_pos', '')[:60] + '…')
ok(wm.get('action_scale') == '1.000', 'action_scale 1.000 wie Original (Skalierung eingebacken)', wm.get('action_scale', '?'))
ok(wm.get('observation_names') == om.get('observation_names'), 'observation_names IDENTISCH mit Original (8 Blöcke)',
   wm.get('observation_names', '')[:80])
ok(wm.get('command_names') == om.get('command_names'), 'command_names IDENTISCH mit Original (twist,head_pose,body_pose)',
   wm.get('command_names', ''))
ok(all('.' in v and len(v.split('.')[1]) == 3 for v in [wm['joint_stiffness'].split(',')[0], wm['joint_damping'].split(',')[0], wm['default_joint_pos'].split(',')[0]]),
   'List-Format %.3f (list_to_csv_str-Konvention)')
ok(wm.get('observation_names') and wm.get('command_names'), 'observation_names/command_names vorhanden',
   wm.get('observation_names', '')[:60] + '…')
ok(len(wm['joint_names'].split(',')) == len(wm['default_joint_pos'].split(',')) == 14, '14 Joints in beiden Listen')

print('── 5. onnxruntime: beide Modelle LAUFEN ──')
so = ort.SessionOptions(); so.log_severity_level = 3
ses_o = ort.InferenceSession(ORIG, so, providers=['CPUExecutionProvider'])
ses_w = ort.InferenceSession(OURS, so, providers=['CPUExecutionProvider'])
import numpy as np
xo = np.zeros((1, 61), dtype=np.float32); xo[0, 3] = 1  # proj gravity -z
ro = ses_o.run(None, {'obs': xo})[0]
ok(ro.shape == (1, 14), 'Original: run → actions [1,14]', str(ro.shape))
xw = np.zeros((1, 61), dtype=np.float32); xw[0, 48] = 0.1  # command: vx = 0,1 m/s
rw = ses_w.run(None, {'obs': xw})[0]
ok(rw.shape == (1, 14), 'Feld: run → actions [1,14]', str(rw.shape))
ok(np.isfinite(rw).all(), 'Feld: Ausgabe endlich')
ok(ses_w.get_inputs()[0].name == 'obs' and ses_w.get_outputs()[0].name == 'actions',
   'Feld: Session-IO-Namen obs/actions (Loader-Konvention)')

print('\nERGEBNIS: %d bestanden · %d fehlgeschlagen' % (pass_n, fail_n))
sys.exit(1 if fail_n else 0)
