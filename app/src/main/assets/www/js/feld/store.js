// ═══════════════════════════════════════════════════════════
// feld/store.js — AUTOSAVE · IMPORT · EXPORT
//
// Alles was die Sitzung ausmacht, überlebt hier:
//   Policy (Soft-MoE-Parameter + ObsNorm) · Trainingsstufe ·
//   Hyper · Tricks · Belohnungsmodell (+ Terme) · Konsole ·
//   Laya-Router · Welt/Auswahl
//
// Autosave : localStorage, kompakt (Float32 → base64), dezentral
//            alle 10 s wenn „schmutzig" + bei App-Wechsel
// Export   : .feld.json (Datei-Download)
// Import   : Datei-Picker → apply-Callback
// ═══════════════════════════════════════════════════════════

const KEY = 'feld_autosave_v3';

// ── base64-Kompaktformat ───────────────────────────────────
export function f32ToB64(arr) {
  const u8 = new Uint8Array(Float32Array.from(arr).buffer);
  let s = '';
  const CH = 8192;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}
export function b64ToF32(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return new Float32Array(u8.buffer);
}

/** Policy-Snapshot (net + norm) in kompaktes JSON. */
export function policyToJSON(ppo) {
  const net = ppo.net;
  const o = {
    fmt: 'feld-policy-1',
    obsDim: net.obsDim, actDim: net.actDim, E: net.E,
    H: net.H, RH: net.RH, HL: net.HL, EL: net.EL, SL: net.SL, DH: net.DH,
    NS: net.NS, kPrior: net.kPrior,
    norm: { mean: f32ToB64(ppo.norm.mean), M2: f32ToB64(ppo.norm.M2), count: ppo.norm.count },
    params: {},
  };
  for (const n of net.pNames) o.params[n] = f32ToB64(net[n]);
  return o;
}
export function policyFromJSON(p, SoftMoECtor, RNGCtor) {
  const net = new SoftMoECtor(p.obsDim, p.actDim, new RNGCtor(1), { E: p.E });
  for (const n of net.pNames) {
    if (!p.params[n]) throw new Error('Policy-Feld fehlt: ' + n);
    net[n].set(b64ToF32(p.params[n]));
  }
  const ppo = { net };
  ppo.norm = {
    mean: b64ToF32(p.norm.mean), M2: b64ToF32(p.norm.M2), count: p.norm.count,
  };
  return { net, norm: ppo.norm, obsDim: p.obsDim, actDim: p.actDim };
}

// ── Sitzungs-Blob ──────────────────────────────────────────
export function saveSession(obj) {
  try {
    localStorage.setItem(KEY, JSON.stringify(obj));
    return true;
  } catch (e) {
    console.warn('Autosave fehlgeschlagen', e);
    return false;
  }
}
export function loadSession() {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return null;
    return JSON.parse(s);
  } catch (e) { return null; }
}
export function clearSession() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ok */ }
}

/** Datei-Download (.feld.json). */
export function exportFile(obj, filename) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || ('feld-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ── v3.4.0: BYTES exportieren — Download-Ordner (Android) ──
// Die Android-WebView führt KEINE <a download>-Klicks aus (blob:-URLs
// landen im Nichts) — deshalb schreibt der native Weg über
// TrainrobotBridge.saveFile (MediaStore/Downloads, MainActivity).
// Der Browser-Fallback bleibt für Desktop-Tests.
function u8ToB64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}
/**
 * Rohe Bytes als Datei speichern.
 * @returns {'download'|'browser'} 'download' = im Download-Ordner des Handys.
 * @throws wenn die Brücke da ist, aber das Schreiben fehlschlug.
 */
export function exportBytes(name, u8, mime) {
  const B = (typeof window !== 'undefined') ? window.TrainrobotBridge : null;
  if (B && typeof B.saveFile === 'function') {
    const ok = B.saveFile(name, u8ToB64(u8), mime || 'application/octet-stream');
    if (!ok) throw new Error('Android-Speicherung fehlgeschlagen (Download-Ordner)');
    return 'download';
  }
  const blob = new Blob([u8], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'browser';
}
/** JSON-Objekt als Datei (gleicher Weg wie exportBytes). */
export function exportJSON(name, obj) {
  return exportBytes(name, new TextEncoder().encode(JSON.stringify(obj)), 'application/json');
}

/** Datei-Import (Picker) → Promise<Object>. */
export function importFile() {
  return new Promise((resolve, reject) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) return reject(new Error('Keine Datei gewählt'));
      const r = new FileReader();
      r.onload = () => {
        try { resolve(JSON.parse(String(r.result))); }
        catch (e) { reject(new Error('Kein gültiges JSON')); }
      };
      r.onerror = () => reject(new Error('Lesefehler'));
      r.readAsText(f);
    };
    inp.click();
  });
}
