// ═══════════════════════════════════════════════════════════
// ardy.js — ARDY Mini: Text → Bewegung, komplett im Gerät.
// Modell: intsuc/Llama-3-ARDY-Mini-Core40-Browser (HF),
// Basis nvidia/ARDY-Core-RP-20FPS-Horizon40, Textencoder
// all-MiniLM-L6-v2, Motion = cskel27 (27 Gelenke, 20 FPS).
//
// Die Inferenz repliziert 1:1 den Browser-Worker des HF-Spaces
// intsuc/ardy-mini (ddim.ts + session.ts, Revision c6efb9f):
//   • 10 deterministische DDIM-Schritte (eta 0), CFG-Gewicht 2.0
//   • Autoregressive Fenster: 40 Frames generieren, die letzten
//     40 Frames bleiben als rezentrierte History (bis 200 Frames)
//   • Root-Rezentrierung je Fenster (translation_axes 0/2,
//     Y bleibt absolut), Latent-Re-Quantisierung (64 Stufen)
//   • Seedbarer PRNG (FNV-1a-Hash + SplitMix-Mixer + Polar-Methode)
//
// Modell-Dateien (~653 MiB fp16 / ~684 MiB fp32) werden beim
// ersten Einsatz von Hugging Face geladen und im Cache Storage
// (https-only, appassets.androidplatform.net ist secure context)
// dauerhaft gespeichert. onnxruntime-web 1.27.0 kommt vom
// jsDelivr-CDN und wird genauso gecacht.
// ═══════════════════════════════════════════════════════════

import { BertWordPiece } from './ardytoken.js';

export const ARDY_REPO = 'intsuc/Llama-3-ARDY-Mini-Core40-Browser';
export const ARDY_REV = '1c21362effeecec0454bfc0d818661525ae6b387';
const ORT_VERSION = '1.27.0';
const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@' + ORT_VERSION + '/dist';
const CACHE_NAME = 'ardy-models-v1';

const HF_URL = (path) => 'https://huggingface.co/' + ARDY_REPO + '/resolve/' + ARDY_REV + '/' + path;

// ═══════════════════════════════════════════════════════════
// v2.27.0: Modell-Dateien VOM GERÄT (Dateimanager-Import)
// ═══════════════════════════════════════════════════════════
// Der HF-Download funktioniert nicht in jeder WebView (größe/CORS/Netz).
// Deshalb kann der Nutzer die Modell-Dateien per Dateimanager wählen — die
// native Brücke (TrainrobotBridge.ardyPickModel) kopiert sie nach
// filesDir/ardy_import/ und die App dient sie unter /ardymodel/<Name> aus
// dem GLEICHEN sicheren Ursprung aus. fetchModelFile prüft diese Liste
// ZUERST — ARDY Mini läuft damit komplett ohne Hugging Face.
let _imports = null;

/** Import-Liste neu von der nativen Brücke lesen. */
export function refreshArdyImports() {
  try {
    const raw = (typeof window !== 'undefined' && window.TrainrobotBridge &&
      typeof window.TrainrobotBridge.ardyImportList === 'function')
      ? window.TrainrobotBridge.ardyImportList() : '[]';
    const arr = JSON.parse(raw || '[]');
    _imports = Array.isArray(arr) ? arr : [];
  } catch (e) { _imports = []; }
  return _imports;
}

/** Gesamtkilobyte/Anzahl der Import-Dateien (für die Panel-Anzeige). */
export function ardyImportSummary() {
  if (_imports === null) refreshArdyImports();
  let bytes = 0;
  for (const it of _imports) bytes += Number(it.size || 0);
  return { count: _imports.length, mib: Math.round(bytes / 1048576) };
}

/** Basename-Vergleich: passt eine importierte Datei zum angeforderten Pfad? */
function importByName(path) {
  if (_imports === null) refreshArdyImports();
  if (!_imports || !_imports.length) return null;
  const base = String(path).split('/').pop().toLowerCase();
  for (const it of _imports) {
    if (String(it.name || '').toLowerCase() === base) return it;
  }
  return null;
}

// ── Prompt-Presets: die Basis-Animationen (DE-Chip → EN-Prompt) ──
export const BASIS_ANIMS = [
  { label: 'Idle',        prompt: 'a person stands still, relaxed idle pose' },
  { label: 'Gehen',       prompt: 'a person walks forward at a steady pace' },
  { label: 'Laufen',      prompt: 'a person runs forward fast' },
  { label: 'Rückwärts',   prompt: 'a person walks backwards' },
  { label: 'Hüpfen',      prompt: 'a person hops forward on one foot' },
  { label: 'Springen',    prompt: 'a person jumps up and lands on both feet' },
  { label: 'Weitsprung',  prompt: 'a person performs a long jump forward' },
  { label: 'Kicken',      prompt: 'a person kicks a ball forward' },
  { label: 'Tanzen',      prompt: 'a person dances happily to the rhythm' },
  { label: 'Winken',      prompt: 'a person waves their hand in greeting' },
  { label: 'Kniebeugen',  prompt: 'a person does squats, bending the knees up and down' },
  { label: 'Drehen',      prompt: 'a person spins around in a full circle' },
  { label: 'Liegen',      prompt: 'a person lies down on the floor' },
  { label: 'Aufstehen',   prompt: 'a person gets up from the ground to standing' },
  { label: 'Treppen',     prompt: 'a person walks up the stairs' },
  { label: 'Seitwärts',   prompt: 'a person walks sideways' },
];

// Kleines DE→EN-Lexikon für Freitext-Prompts (das Modell ist auf
// Englisch trainiert). Wörter werden ganzzahlig ersetzt, unbekannte
// Eingaben werden unverändert durchgereicht (Englisch funktioniert).
const DE_EN = [
  [/\bperson\b|\bmann\b|\bfrau\b/g, 'person'],
  [/\bgeht\b|\bläuft langsam\b|\bgehe\b/g, 'walks'],
  [/\blaufen\b|\blaufe\b|\brennen\b|\brennt\b|\bsprintet\b/g, 'runs'],
  [/\brückwärts\b/g, 'backwards'],
  [/\bseitwärts\b|\bseitlich\b/g, 'sideways'],
  [/\bhüpft\b|\bhüpfen\b/g, 'hops'],
  [/\bspringt\b|\bspringen\b|\bsprunge\b/g, 'jumps'],
  [/\bweitsprung\b/g, 'long jump'],
  [/\bkickt\b|\bkicken\b|\btritt\b/g, 'kicks'],
  [/\btanzt\b|\btanzen\b/g, 'dances'],
  [/\bwinkt\b|\bwinken\b|\bwinkt zu\b/g, 'waves'],
  [/\bkniebeuge\w*\b/g, 'squats'],
  [/\bdreht sich\b|\bdrehen\b|\bdreht\b/g, 'spins around'],
  [/\bliggt\b|\bliegt\b|\bliegen\b/g, 'lies down'],
  [/\bsteh[t ]?auf\b|\baufstehen\b/g, 'gets up from the ground'],
  [/\btreppe\w*\b/g, 'walks up the stairs'],
  [/\bvorwärts\b|\bgeradeaus\b/g, 'forward'],
  [/\bstill\b|\bsteht\b|\bstehen\b|\bidle\b/g, 'stands still'],
  [/\bschnell\b/g, 'fast'],
  [/\blangsam\b/g, 'slowly'],
  [/\bhappy\b/g, 'happily'],
  [/\bfröhlich\b/g, 'happily'],
  [/\bwütend\b/g, 'angrily'],
  [/\btraurig\b/g, 'sadly'],
  [/\bperson steckt\b/g, 'person'],
];
export function deToEn(prompt) {
  let s = String(prompt || '').trim();
  if (!s) return s;
  for (const [re, en] of DE_EN) s = s.replace(re, en);
  return s;
}

// ═══════════════════════════════════════════════════════════
// Portable Zufallsquelle — exakter Port der Worker-Implementierung
// (FNV-1a-Seed, SplitMix-artiger Counter-Mixer, Marsaglia-Polar
// mit Spare-Wert). Gleicher Seed ⇒ gleiche Bewegung.
// ═══════════════════════════════════════════════════════════
function hashSeed(seed) {
  if (typeof seed === 'number') return Math.trunc(seed) >>> 0;
  const bytes = new TextEncoder().encode(String(seed));
  let h = 2166136261;
  for (const b of bytes) { h ^= b; h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export class PortableRandom {
  constructor(seed) { this.seed = hashSeed(seed); this._state = this.seed; this._spare = undefined; }
  nextUint32() {
    this._state = (this._state + 1831565813) >>> 0;
    let e = this._state;
    e = Math.imul(e ^ (e >>> 15), e | 1);
    e ^= e + Math.imul(e ^ (e >>> 7), e | 61);
    return (e ^ (e >>> 14)) >>> 0;
  }
  nextFloat() { return (this.nextUint32() + 1) / 4294967297; }
  nextNormal() {
    if (this._spare !== undefined) { const v = this._spare; this._spare = undefined; return v; }
    let u = 0, v = 0, s = 0;
    do { u = 2 * this.nextFloat() - 1; v = 2 * this.nextFloat() - 1; s = u * u + v * v; }
    while (s <= 2 ** -52 || s >= 1);
    const r = Math.sqrt(-2 * Math.log(s) / s);
    this._spare = v * r;
    return u * r;
  }
  fillNormal(arr, from = 0, to = arr.length) {
    for (let i = from; i < to; i++) arr[i] = Math.fround(this.nextNormal());
  }
}

// ── DDIM (deterministisch, eta = 0) — exakter Port ──
export function ddimStep(timesteps, acp, acpPrev, r) {
  if (r < 0 || r >= timesteps.length) throw new RangeError('DDIM-Schritt außerhalb');
  const t = timesteps[r];
  const alpha = acp[t], alphaPrev = acpPrev[t];
  if (!(alpha > 0 && alpha <= 1) || !(alphaPrev > 0 && alphaPrev <= 1)) throw new RangeError('Ungültiger DDIM-Alpha bei t=' + t);
  return { timestep: t, alpha, alphaPrevious: alphaPrev };
}
export function ddimUpdate(x, predX0, step, from, to) {
  const a = Math.sqrt(step.alpha);
  const o = Math.sqrt(1 / step.alpha - 1); // sqrt_recipm1
  const s = Math.sqrt(step.alphaPrevious);
  const c = Math.sqrt(1 - step.alphaPrevious);
  for (let n = from; n < to; n++) {
    const p = predX0[n];
    const eps = o === 0 ? 0 : (x[n] / a - p) / o;
    x[n] = Math.fround(p * s + eps * c);
  }
}
export function roundHalfEven(x) {
  if (!Number.isFinite(x)) return x;
  const f = Math.floor(x), frac = x - f;
  if (frac < 0.5) return f;
  if (frac > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

// ═══════════════════════════════════════════════════════════
// Fenster-Helfer — exakte Ports der Worker-Funktionen
// (va/ya/#s/Sa/za/ba). dims = manifest.dimensions.
// ═══════════════════════════════════════════════════════════
function countHistory(history, dims) {
  if (!history) return 0;
  if (history.length % dims.hybrid_dim !== 0) throw new RangeError('History-Länge nicht durch hybrid_dim teilbar');
  const tokens = history.length / dims.hybrid_dim;
  if (tokens > dims.history_tokens) throw new RangeError('History darf max. ' + dims.history_tokens + ' Tokens umfassen');
  return tokens;
}

/** ya — Fenster-x aufbauen: History vorn, Einheits-Gauß in Generation-Slots. */
export function buildWindow(dims, rng, history) {
  const histTokens = countHistory(history, dims);
  const histFrames = histTokens * dims.num_frames_per_token;
  const genTokens = dims.generation_tokens;
  const genFrames = dims.generation_frames;
  const offset = histTokens;
  if (offset + genTokens > dims.max_tokens) throw new RangeError('History und Generation passen nicht ins AR-Fenster');
  const x = new Float32Array(dims.max_tokens * dims.hybrid_dim);
  if (history) x.set(history);
  rng.fillNormal(x, offset * dims.hybrid_dim, (offset + genTokens) * dims.hybrid_dim);
  const historyMask = new Float32Array(dims.max_frames);
  const generationMask = new Float32Array(dims.max_frames);
  const historyTokenMask = new Float32Array(dims.max_tokens);
  const generationTokenMask = new Float32Array(dims.max_tokens);
  historyMask.fill(1, 0, histFrames);
  generationMask.fill(1, histFrames, histFrames + genFrames);
  historyTokenMask.fill(1, 0, histTokens);
  generationTokenMask.fill(1, offset, offset + genTokens);
  return {
    x, historyMask, generationMask, historyTokenMask, generationTokenMask,
    historyFrames: histFrames, generationFrames: genFrames,
    historyTokens: histTokens, generationTokens: genTokens,
    generationTokenOffset: offset,
  };
}

/**
 * #s — Fenster-Vorbereitung aus dem Session-Zustand: letzte ≤10 Tokens
 * als History, Root-X/Z um den LETZTEN Frame rezentriert (Y bleibt auf
 * der absoluten Höhe), firstHeading = Blick des ERSTEN History-Frames.
 */
export function prepareWindow(dims, recenter, state, historyFrames) {
  const nfpt = dims.num_frames_per_token;
  const haveTokens = Math.min(Math.floor(state.frameCount / nfpt), Math.floor(state.tokens.length / dims.hybrid_dim));
  const a = Math.min(dims.history_tokens, Math.floor(historyFrames / nfpt), haveTokens);
  if (a === 0) {
    if (haveTokens > 0) {
      const lastFrame = haveTokens * nfpt - 1;
      const ti = Math.floor(lastFrame / nfpt), fo = lastFrame % nfpt;
      const base = ti * dims.hybrid_dim + fo * dims.root_features_per_frame;
      const un = (i) => state.tokens[base + i] * recenter.root_std[i] + recenter.root_mean[i];
      const piX = recenter.position_indices[0], piZ = recenter.position_indices[2];
      const hd = recenter.heading_indices[0], hf = recenter.heading_indices[1];
      return {
        history: null, historyTokens: 0, historyFrames: 0,
        windowStartFrame: state.frameCount,
        globalTranslation: new Float32Array([un(piX), state.translation[1], un(piZ)]),
        firstHeadingAngle: Math.atan2(un(hf), un(hd)),
      };
    }
    return {
      history: null, historyTokens: 0, historyFrames: 0,
      windowStartFrame: state.frameCount,
      globalTranslation: new Float32Array(state.translation),
      firstHeadingAngle: state.heading,
    };
  }
  const from = haveTokens - a;
  const hist = state.tokens.slice(from * dims.hybrid_dim, haveTokens * dims.hybrid_dim);
  const at = (frame, comp) => Math.floor(frame / nfpt) * dims.hybrid_dim + (frame % nfpt) * dims.root_features_per_frame + comp;
  const un = (frame, comp) => hist[at(frame, comp)] * recenter.root_std[comp] + recenter.root_mean[comp];
  const histFrames = a * nfpt;
  const last = histFrames - 1;
  const piX = recenter.position_indices[0], piY = recenter.position_indices[1], piZ = recenter.position_indices[2];
  const hd = recenter.heading_indices[0], hf = recenter.heading_indices[1];
  const ax = un(last, piX), az = un(last, piZ);
  for (let f = 0; f < histFrames; f++) {
    for (const [comp, anchor] of [[piX, ax], [piY, state.translation[1]], [piZ, az]]) {
      const v = un(f, comp) - anchor;
      hist[at(f, comp)] = Math.fround((v - recenter.root_mean[comp]) / recenter.root_std[comp]);
    }
  }
  return {
    history: hist, historyTokens: a, historyFrames: histFrames,
    windowStartFrame: state.frameCount - histFrames,
    globalTranslation: new Float32Array([ax, state.translation[1], az]),
    firstHeadingAngle: Math.atan2(un(0, hf), un(0, hd)),
  };
}

/**
 * Sa — denisiertes Fenster rezentrieren (X/Z um den letzten Frame,
 * Y unverändert), Latent-Tokens RE-QUANTISIEREN (64-Stufen-Gitter),
 * akkumulierte Welt-Translation zurückgeben.
 */
export function recenterWindow(h, m, dims, recenter, quant, globalTranslation, genOffset) {
  const s = dims.hybrid_dim, c = dims.nframe_root_dim;
  const l = dims.root_features_per_frame, u = dims.num_frames_per_token;
  const d = m * u; // gültige Frames im Fenster
  const piX = recenter.position_indices[0], piY = recenter.position_indices[1], piZ = recenter.position_indices[2];
  const hd = recenter.heading_indices[0], hf = recenter.heading_indices[1];
  const at = (frame, comp) => Math.floor(frame / u) * s + (frame % u) * l + comp;
  const un = (frame, comp) => h[at(frame, comp)] * recenter.root_std[comp] + recenter.root_mean[comp];
  const last = d - 1;
  const ax = un(last, piX), az = un(last, piZ);
  for (let f = 0; f < d; f++) {
    for (const [comp, anchor] of [[piX, ax], [piZ, az]]) {
      const v = un(f, comp) - anchor;
      h[at(f, comp)] = Math.fround((v - recenter.root_mean[comp]) / recenter.root_std[comp]);
    }
  }
  if (quant && quant.mean && quant.std && quant.levels) {
    for (let tok = 0; tok < m; tok++) {
      const base = tok * s;
      for (let r = 0; r < dims.latent_dim; r++) {
        const idx = base + c + r;
        const a = h[idx] * quant.std[r] + quant.mean[r];
        const half = Math.floor(quant.levels[r] / 2);
        const q = roundHalfEven(Math.max(-1, Math.min(1, a)) * half) / half;
        h[idx] = Math.fround((q - quant.mean[r]) / quant.std[r]);
      }
    }
  }
  const S = genOffset * u;
  return {
    globalTranslation: new Float32Array([
      Math.fround(globalTranslation[0] + ax),
      Math.fround(globalTranslation[1] + 0),
      Math.fround(globalTranslation[2] + az),
    ]),
    firstHeadingAngle: Math.atan2(un(S, hf), un(S, hd)),
  };
}

/** ba — Pad-Maske für den Decoder (1 für Frames < m·nfpt). */
export function padMask(dims, validTokens) {
  const mask = new Float32Array(dims.max_frames);
  mask.fill(1, 0, validTokens * dims.num_frames_per_token);
  return mask;
}

/**
 * za — Hybrid-Tokens der GENERIERTEN Frames extrahieren: Root-Features
 * kommen aus der DEKODIERTEN normalisierten Motion (Erdung!), die
 * Latent-Tokens aus dem denoisierten Fenster.
 */
export function extractGeneratedTokens(motion, h, historyFrames, genOffset, count, dims) {
  const out = new Float32Array(count * dims.hybrid_dim);
  for (let k = 0; k < count; k++) {
    const tokBase = k * dims.hybrid_dim;
    const srcTokBase = (genOffset + k) * dims.hybrid_dim;
    for (let f = 0; f < dims.num_frames_per_token; f++) {
      const frame = historyFrames + k * dims.num_frames_per_token + f;
      const outBase = tokBase + f * dims.root_features_per_frame;
      const srcBase = frame * dims.motion_dim;
      out.set(motion.subarray(srcBase, srcBase + dims.root_features_per_frame), outBase);
    }
    out.set(h.subarray(srcTokBase + dims.nframe_root_dim, srcTokBase + dims.hybrid_dim), tokBase + dims.nframe_root_dim);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════
// Laden: HF-Download mit Fortschritt, Cache Storage, Gunzip
// (DecompressionStream), onnxruntime-web vom CDN.
// ═══════════════════════════════════════════════════════════
async function gunzip(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream fehlt (WebView zu alt)');
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function cacheGet(key) {
  try {
    if (typeof caches === 'undefined') return null;
    const c = await caches.open(CACHE_NAME);
    const r = await c.match(key);
    return r ? new Uint8Array(await r.arrayBuffer()) : null;
  } catch (e) { return null; }
}
async function cachePut(key, bytes) {
  try {
    if (typeof caches === 'undefined') return;
    const c = await caches.open(CACHE_NAME);
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await c.put(key, new Response(body, { headers: { 'content-type': 'application/octet-stream' } }));
  } catch (e) { /* Cache voll/privat — nur langsamer, kein Fehler */ }
}

/** Datei laden: Import (Dateimanager) → Cache → HF-Download (mit Fortschritt) → entpackt cachen. */
async function fetchModelFile(path, { onProgress, signal, label } = {}) {
  // v2.27.0: 1) vom Gerät importierte Datei (Dateimanager) — kein HF nötig.
  // Die Datei liegt als Kopie im App-Ordner und wird same-origin ausgeliefert;
  // sie wird NICHT zusätzlich in den Cache Storage dupliziert (Platz sparen).
  const imp = importByName(path);
  if (imp) {
    try {
      const res = await fetch('/ardymodel/' + encodeURIComponent(imp.name), { signal });
      if (res.ok) {
        const total = Number(res.headers.get('content-length') || imp.size || 0);
        let data;
        if (res.body && total > 0) {
          const reader = res.body.getReader();
          const parts = [];
          let got = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            parts.push(value); got += value.length;
            onProgress && onProgress({ stage: 'import ' + (label || path), completed: got, total, cached: true });
          }
          data = new Uint8Array(got);
          let off = 0;
          for (const p of parts) { data.set(p, off); off += p.length; }
        } else {
          data = new Uint8Array(await res.arrayBuffer());
          onProgress && onProgress({ stage: 'import ' + (label || path), completed: 1, total: 1, cached: true });
        }
        const out = path.endsWith('.gz') ? await gunzip(data) : data;
        onProgress && onProgress({ stage: label || path, completed: 1, total: 1, cached: true });
        return out;
      }
    } catch (e) { /* Import unlesbar → unten Cache/HF versuchen */ }
  }
  const url = HF_URL(path);
  const cached = await cacheGet(url);
  if (cached) {
    onProgress && onProgress({ stage: label || path, completed: 1, total: 1, cached: true });
    return cached;
  }
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('HF-Download fehlgeschlagen (' + res.status + '): ' + path);
  const total = Number(res.headers.get('content-length') || 0);
  let data;
  if (res.body && total > 0) {
    const reader = res.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      onProgress && onProgress({ stage: label || path, completed: got, total, cached: false });
    }
    data = new Uint8Array(got);
    let off = 0;
    for (const p of parts) { data.set(p, off); off += p.length; }
  } else {
    data = new Uint8Array(await res.arrayBuffer());
    onProgress && onProgress({ stage: label || path, completed: 1, total: 1, cached: false });
  }
  // .gz-Dateien entpacken; entpacktes Ergebnis cachen (schnellere Loads)
  const isGz = path.endsWith('.gz');
  const out = isGz ? await gunzip(data) : data;
  await cachePut(url, out);
  return out;
}

let _ortPromise = null;
/** onnxruntime-web vom CDN laden (gecacht) → ort-Modul. */
async function loadOrt(onProgress, signal) {
  if (!_ortPromise) {
    _ortPromise = (async () => {
      const ortUrl = await blobUrlFor(ORT_BASE + '/ort.min.mjs', onProgress, signal);
      const ort = await import(/* webpackIgnore: true */ ortUrl);
      // jsep-WASM (WebGPU + CPU) ebenfalls cachen und als Blob-URL melden
      const wasmMjsUrl = await blobUrlFor(ORT_BASE + '/ort-wasm-simd-threaded.jsep.mjs', onProgress, signal);
      const wasmBinUrl = await blobUrlFor(ORT_BASE + '/ort-wasm-simd-threaded.jsep.wasm', onProgress, signal);
      ort.env.wasm.wasmPaths = { mjs: wasmMjsUrl, wasm: wasmBinUrl };
      ort.env.wasm.numThreads = 1; // ohne COOP/COEP keine SharedArrayBuffers
      return ort;
    })();
    _ortPromise.catch(() => { _ortPromise = null; });
  }
  return _ortPromise;
}
async function blobUrlFor(url, onProgress, signal) {
  let bytes = await cacheGet(url);
  if (!bytes) {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error('Download fehlgeschlagen: ' + url);
    const total = Number(res.headers.get('content-length') || 0);
    if (res.body && total > 0) {
      const reader = res.body.getReader();
      const parts = []; let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value); got += value.length;
        onProgress && onProgress({ stage: 'onnxruntime-web', completed: got, total });
      }
      bytes = new Uint8Array(got);
      let off = 0;
      for (const p of parts) { bytes.set(p, off); off += p.length; }
    } else {
      bytes = new Uint8Array(await res.arrayBuffer());
    }
    await cachePut(url, bytes);
  }
  return URL.createObjectURL(new Blob([bytes], { type: url.endsWith('.mjs') ? 'text/javascript' : 'application/wasm' }));
}

// ── WebGPU-Fähigkeit erkennen (fp16 benötigt shader-f16) ──
export async function ardyCapabilities() {
  const out = { webgpu: false, shaderF16: false, adapter: null };
  try {
    if (typeof navigator !== 'undefined' && navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        out.webgpu = true;
        out.shaderF16 = !!(adapter.features && adapter.features.has && adapter.features.has('shader-f16'));
        out.adapter = adapter;
      }
    }
  } catch (e) { /* kein WebGPU */ }
  return out;
}

// ═══════════════════════════════════════════════════════════
// ArdyRuntime — Sessions + Generierung
// ═══════════════════════════════════════════════════════════
export class ArdyRuntime {
  constructor(manifest, tokenizer, sessions, epName) {
    this.manifest = manifest;
    this.tokenizer = tokenizer;
    this.sessions = sessions;   // {textEncoder, denoiser, decoder}
    this.epName = epName;       // 'webgpu' | 'wasm'
    this.dims = manifest.dimensions;
    this.recenter = manifest.recenter;
    this.quant = manifest.latent_quantization;
  }

  get jointNames() { return this.manifest.skeleton.joint_names.slice(); }
  get parents() { return this.manifest.skeleton.parents.slice(); }
  get fps() { return this.dims.fps; }

  /** Text → [1,1,2048] textConditions. */
  async _encodeText(prompt, signal) {
    const enc = this.tokenizer.encode(prompt);
    const g = this.manifest.graphs.text_encoder.inputs;
    const out = await this.sessions.textEncoder.run({
      [g.inputIds]: new OrtTensor('int64', enc.inputIds, [1, enc.sequenceLength]),
      [g.attentionMask]: new OrtTensor('int64', enc.attentionMask, [1, enc.sequenceLength]),
      [g.tokenTypeIds]: new OrtTensor('int64', enc.tokenTypeIds, [1, enc.sequenceLength]),
    });
    const t = out[this.manifest.graphs.text_encoder.outputs.textConditions];
    if (!t || !(t.data instanceof Float32Array)) throw new Error('Text-Encoder lieferte textConditions nicht');
    return t;
  }

  /** Ein Denoise-Fenster: 10 DDIM-Schritte in-place auf win.x. */
  async _denoiseWindow(win, textCond, cfgWeight, firstHeadingAngle, onProgress, signal, stepBase, stepTotal) {
    const dims = this.dims;
    const g = this.manifest.graphs.denoiser.inputs;
    const timestepBuf = new BigInt64Array(1);
    const feeds = {
      [g.cfgWeight]: new OrtTensor('float32', Float32Array.of(Math.fround(cfgWeight)), [1]),
      [g.x]: new OrtTensor('float32', win.x, [1, dims.max_tokens, dims.hybrid_dim]),
      [g.historyLength]: new OrtTensor('int64', BigInt64Array.of(BigInt(win.historyFrames)), [1]),
      [g.generationLength]: new OrtTensor('int64', BigInt64Array.of(BigInt(win.generationFrames)), [1]),
      [g.historyMask]: new OrtTensor('float32', win.historyMask, [1, dims.max_frames]),
      [g.generationMask]: new OrtTensor('float32', win.generationMask, [1, dims.max_frames]),
      [g.historyTokenMask]: new OrtTensor('float32', win.historyTokenMask, [1, dims.max_tokens]),
      [g.generationTokenMask]: new OrtTensor('float32', win.generationTokenMask, [1, dims.max_tokens]),
      [g.textConditions]: textCond,
      [g.timestep]: new OrtTensor('int64', timestepBuf, [1]),
      [g.firstHeadingAngle]: new OrtTensor('float32', Float32Array.of(Math.fround(firstHeadingAngle)), [1]),
    };
    const d = this.manifest.diffusion;
    const outName = this.manifest.graphs.denoiser.outputs.predX0;
    for (let r = 0; r < d.timesteps.length; r++) {
      if (signal && signal.aborted) throw new DOMException('Generation abgebrochen', 'AbortError');
      const step = ddimStep(d.timesteps, d.alphas_cumprod, d.alphas_cumprod_prev, r);
      timestepBuf[0] = BigInt(step.timestep);
      const res = await this.sessions.denoiser.run(feeds);
      const pred = res[outName];
      if (!pred || !(pred.data instanceof Float32Array)) throw new Error('Denoiser lieferte predX0 nicht');
      const p = win.generationTokenOffset * dims.hybrid_dim;
      const m = (win.generationTokenOffset + win.generationTokens) * dims.hybrid_dim;
      ddimUpdate(win.x, pred.data, step, p, m);
      onProgress && onProgress({ stage: 'denoising', completed: stepBase + r + 1, total: stepTotal });
    }
  }

  /** Hybrid-Tokens decodieren → Motion-Ausgaben. */
  async _decode(h, validTokens, globalTranslation, signal) {
    const dims = this.dims;
    const g = this.manifest.graphs.decoder.inputs;
    const res = await this.sessions.decoder.run({
      [g.hybridTokens]: new OrtTensor('float32', h, [1, dims.max_tokens, dims.hybrid_dim]),
      [g.motionPadMask]: new OrtTensor('float32', padMask(dims, validTokens), [1, dims.max_frames]),
      [g.globalTranslation]: new OrtTensor('float32', globalTranslation, [1, 3]),
    });
    const o = this.manifest.graphs.decoder.outputs;
    const L = dims.max_frames, J = dims.num_joints;
    const grab = (name, expect, FloatType) => {
      const t = res[o[name]];
      if (!t) throw new Error('Decoder lieferte ' + name + ' nicht');
      const data = t.data instanceof FloatType ? t.data : new FloatType(t.data);
      if (data.length < expect) throw new Error('Decoder-Ausgabe ' + name + ' zu kurz');
      return data;
    };
    return {
      motion: grab('normalizedMotion', L * dims.motion_dim, Float32Array),
      joints: grab('posedJoints', L * J * 3, Float32Array),
      localRotations: grab('localRotations', L * J * 9, Float32Array),
      globalRotations: grab('globalRotations', L * J * 9, Float32Array),
      rootPositions: grab('rootPositions', L * 3, Float32Array),
      footContacts: res[o.footContacts] ? res[o.footContacts].data : null,
      globalRootHeading: grab('globalRootHeading', L * 2, Float32Array),
    };
  }

  /**
   * Bewegung generieren.
   * @param opts { prompt, seconds, cfgWeight, seed, onProgress, signal }
   * @returns { fps, frameCount, prompt, seed, joints (N·27·3), jointNames,
   *            parents, globalRotations (N·27·9), localRotations,
   *            rootPositions (N·3), footContacts (N·4) }
   */
  async generate(opts = {}) {
    const prompt = String(opts.prompt || '').trim();
    if (!prompt) throw new Error('Prompt ist leer');
    const dims = this.dims;
    const gen = this.manifest.generation;
    // Dauer auf ganze Tokens (4 Frames) runden; max 200 Frames
    const seconds = opts.seconds !== undefined ? opts.seconds : 5;
    let durationFrames = Math.round(seconds * dims.fps / dims.num_frames_per_token) * dims.num_frames_per_token;
    durationFrames = Math.max(gen.min_frames, Math.min(gen.max_frames, durationFrames));
    const cfgWeight = opts.cfgWeight !== undefined && Number.isFinite(opts.cfgWeight) ? Math.min(100, Math.max(0, opts.cfgWeight)) : gen.default_cfg_weight;
    const historyFrames = opts.historyFrames !== undefined ? opts.historyFrames : dims.history_frames;
    const rng = new PortableRandom(opts.seed !== undefined ? opts.seed : (Math.random() * 4294967296) >>> 0);

    const onProgress = opts.onProgress;
    onProgress && onProgress({ stage: 'encoding-text', completed: 0, total: 1 });
    let textCond = await this._encodeText(prompt, opts.signal);
    onProgress && onProgress({ stage: 'encoding-text', completed: 1, total: 1 });
    // v2.26.0: LIVE-STEERUNG — opts.getLivePrompt() wird an JEDEM
    // Fensteranfang befragt; ein geänderter Prompt wird sofort neu
    // kodiert (nur der Text-Anteil, History/Seed bleiben) — so lässt
    // sich die Bewegung WÄHREND der Generierung umlenken.
    let curPrompt = prompt;

    // Session-Zustand (wie Ba-Klasse im Worker)
    const state = { tokens: new Float32Array(0), frameCount: 0, translation: [0, 0, 0], heading: 0 };
    const windows = Math.ceil(durationFrames / dims.generation_frames);
    const out = {
      prompt, seed: rng.seed, fps: dims.fps,
      jointNames: this.jointNames, parents: this.parents,
      joints: new Float32Array(durationFrames * dims.num_joints * 3),
      globalRotations: new Float32Array(durationFrames * dims.num_joints * 9),
      localRotations: new Float32Array(durationFrames * dims.num_joints * 9),
      rootPositions: new Float32Array(durationFrames * 3),
      footContacts: new Float32Array(durationFrames * 4),
    };
    const stepTotal = windows * this.manifest.diffusion.timesteps.length;
    let written = 0;
    for (let w = 0; w < windows; w++) {
      if (opts.signal && opts.signal.aborted) throw new DOMException('Generation abgebrochen', 'AbortError');
      if (w > 0 && typeof opts.getLivePrompt === 'function') {
        const lp = String(opts.getLivePrompt() || '').trim();
        if (lp && lp !== curPrompt) {
          curPrompt = lp;
          onProgress && onProgress({ stage: 'encoding-text', completed: 0, total: 1 });
          textCond = await this._encodeText(lp, opts.signal);
          onProgress && onProgress({ stage: 'encoding-text', completed: 1, total: 1 });
        }
      }
      const win0 = prepareWindow(dims, this.recenter, state, historyFrames);
      const win = buildWindow(dims, rng, win0.history);
      await this._denoiseWindow(win, textCond, cfgWeight, win0.firstHeadingAngle, onProgress, opts.signal, w * this.manifest.diffusion.timesteps.length, stepTotal);
      const m = win.historyTokens + win.generationTokens;
      const h = new Float32Array(dims.max_tokens * dims.hybrid_dim);
      h.set(win.x.subarray(0, m * dims.hybrid_dim));
      const rec = recenterWindow(h, m, dims, this.recenter, this.quant, win0.globalTranslation, win.generationTokenOffset);
      onProgress && onProgress({ stage: 'decoding', completed: w, total: windows });
      const dec = await this._decode(h, m, rec.globalTranslation, opts.signal);
      const x = Math.min(dims.generation_frames, durationFrames - written);
      const S = win.historyFrames;
      const C = Math.ceil(x / dims.num_frames_per_token);
      const genTokens = extractGeneratedTokens(dec.motion, h, S, win.generationTokenOffset, C, dims);
      const merged = new Float32Array(state.tokens.length + genTokens.length);
      merged.set(state.tokens); merged.set(genTokens, state.tokens.length);
      state.tokens = merged;
      // Ausgabe-Frames [S, S+x) → Gesamtpuffer
      const J = dims.num_joints;
      out.joints.set(dec.joints.subarray(S * J * 3, (S + x) * J * 3), written * J * 3);
      out.globalRotations.set(dec.globalRotations.subarray(S * J * 9, (S + x) * J * 9), written * J * 9);
      out.localRotations.set(dec.localRotations.subarray(S * J * 9, (S + x) * J * 9), written * J * 9);
      out.rootPositions.set(dec.rootPositions.subarray(S * 3, (S + x) * 3), written * 3);
      if (dec.footContacts) {
        for (let f = 0; f < x; f++) {
          for (let k = 0; k < 4; k++) out.footContacts[(written + f) * 4 + k] = Number(dec.footContacts[(S + f) * 4 + k]) || 0;
        }
      }
      state.frameCount += x;
      written += x;
      onProgress && onProgress({ stage: 'decoding', completed: w + 1, total: windows, frame: written });
    }
    out.frameCount = written;
    out.duration = written / dims.fps;
    out.promptsLive = curPrompt !== prompt ? curPrompt : undefined; // v2.26.0: tatsächlich verwendeter Live-Prompt
    return out;
  }

  async dispose() {
    for (const k of Object.keys(this.sessions)) {
      try { await this.sessions[k].release(); } catch (e) { /* egal */ }
    }
    this.sessions = null;
  }
}

// OrtTensor wird lazy referenziert (loadOrt liefert das Modul erst später)
let OrtTensor = null;
export function setOrtTensorClass(cls) { OrtTensor = cls; }

// ═══════════════════════════════════════════════════════════
// Einstieg: Runtime laden (Manifest → Precision → Dateien →
// Tokenizer → Sessions). Wird von main.js benutzt.
// ═══════════════════════════════════════════════════════════
let _runtimePromise = null;

export function ardyCachedInfo() {
  // grober Stand: Cache vorhanden? (Details erst beim Laden)
  return _runtimePromise ? 'geladen' : null;
}

/**
 * Runtime laden (einmalig pro App-Lauf; danach gecacht).
 * @param opts { onProgress, signal }
 * onProgress: { stage, completed, total, message }
 *   stage ∈ 'ort' | 'manifest' | 'tokenizer' | 'text_encoder'
 *         | 'denoiser' | 'decoder' | 'encoding-text' | 'denoising' | 'decoding'
 */
export async function loadArdyRuntime(opts = {}) {
  if (_runtimePromise) return _runtimePromise;
  _runtimePromise = (async () => {
    const onProgress = opts.onProgress;
    // 1) WebGPU-Fähigkeit → fp16 (shader-f16) sonst fp32
    const caps = await ardyCapabilities();
    const precision = caps.webgpu && caps.shaderF16 ? 'fp16' : 'fp32';
    const epName = caps.webgpu ? 'webgpu' : 'wasm';
    // 2) ORT (CDN, gecacht) — vor den großen Modellen, damit Fehler früh kommen
    onProgress && onProgress({ stage: 'ort', completed: 0, total: 1 });
    const ort = await loadOrt((p) => onProgress && onProgress({ stage: 'ort', completed: p.completed, total: p.total || 1, message: p.stage }));
    setOrtTensorClass(ort.Tensor);
    onProgress && onProgress({ stage: 'ort', completed: 1, total: 1 });
    // 3) Manifest
    const manifestBytes = await fetchModelFile(precision + '/model.json.gz', { onProgress: (p) => onProgress && onProgress({ stage: 'manifest', completed: 1, total: 1 }), signal: opts.signal });
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
    // 4) Tokenizer
    const tokBytes = await fetchModelFile(precision + '/tokenizer/tokenizer.json.gz', { onProgress, signal: opts.signal });
    const tokenizer = await BertWordPiece.fromTokenizerJson(JSON.parse(new TextDecoder().decode(tokBytes)));
    // 5) Sessions (webgpu mit wasm-Fallback innerhalb von ORT)
    const sessionOpts = {
      executionProviders: caps.webgpu ? ['webgpu', 'wasm'] : ['wasm'],
    };
    const sessions = {};
    for (const graph of ['text_encoder', 'denoiser', 'decoder']) {
      const bytes = await fetchModelFile(precision + '/' + graph + '.onnx.gz', { onProgress, signal: opts.signal });
      onProgress && onProgress({ stage: graph, completed: 1, total: 1, message: 'Session erstellen …' });
      sessions[graph] = await ort.InferenceSession.create(bytes, sessionOpts);
    }
    return new ArdyRuntime(manifest, tokenizer, sessions, epName);
  })();
  try {
    return await _runtimePromise;
  } catch (e) {
    _runtimePromise = null;
    throw e;
  }
}

/** Alle gecachten ARDY-Dateien löschen (Speicherplatz). */
export async function clearArdyCache() {
  try {
    if (typeof caches !== 'undefined') await caches.delete(CACHE_NAME);
  } catch (e) { /* egal */ }
}
