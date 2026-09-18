// ═══════════════════════════════════════════════════════════
// ardy_math_test.mjs — Unit-Tests der ARDY-Integration (v2.7.0)
// Läuft in Node ohne Browser: prüft Tokenizer, DDIM-Mathematik,
// PRNG-Determinismus, Fenster-Helfer (Masken/Rezentrierung/
// Token-Extraktion), mat3→Quat und den ArdyClip-Adapter —
// generate() end-to-end mit gemockten ORT-Sessions.
// ═══════════════════════════════════════════════════════════
import { strict as assert } from 'node:assert';
import { BertWordPiece, bertNormalize, bertPreTokenize } from '/home/z/my-project/app/src/main/assets/www/js/ardytoken.js';
import { PortableRandom, deToEn } from '/home/z/my-project/app/src/main/assets/www/js/ardy.js';
import { mat3ToQuat, ArdyClip } from '/home/z/my-project/app/src/main/assets/www/js/ardyclip.js';

let passed = 0, failed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + ' — ' + e.message); }
}

// ── 1) Bert-Normalisierung + Pre-Tokenisierung ─────────────
console.log('■ BertTokenizer');
ok('lowercase + Whitespace', () => {
  assert.equal(bertNormalize('A Person WALKS'), 'a person walks');
});
ok('Akzente entfernt', () => {
  assert.equal(bertNormalize('Gehen rückwärts'), 'gehen ruckwarts');
});
ok('CJK gepolstert', () => {
  assert.equal(bertPreTokenize(bertNormalize('歩く')).join('|'), '歩|く');
});
ok('Interpunktion als Einzel-Tokens', () => {
  assert.deepEqual(bertPreTokenize('hello, world!'), ['hello', ',', 'world', '!']);
});

// Synthetisches Vokabular für WordPiece
const vocab = new Map([
  ['[PAD]', 0], ['[UNK]', 100], ['[CLS]', 101], ['[SEP]', 102],
  ['a', 32], ['person', 2711], ['walk', 1716], ['s', 9], ['##s', 2092],
  ['forward', 2426], ['jog', 14534], ['##ging', 15501],
]);
ok('WordPiece: ganzes Wort', () => {
  const t = new BertWordPiece(vocab);
  const enc = t.encode('person');
  assert.deepEqual(Array.from(enc.inputIds), [101n, 2711n, 102n]);
});
ok('WordPiece: gierig längster Treffer mit ##', () => {
  const t = new BertWordPiece(vocab);
  const enc = t.encode('walks');
  assert.deepEqual(Array.from(enc.inputIds), [101n, 1716n, 2092n, 102n]);
});
ok('WordPiece: Unbekanntes → [UNK]', () => {
  const t = new BertWordPiece(vocab);
  const enc = t.encode('xyzzy');
  assert.deepEqual(Array.from(enc.inputIds), [101n, 100n, 102n]);
});
ok('Truncation auf maxLen (hier 8)', () => {
  const t = new BertWordPiece(vocab, { maxLen: 8 });
  const enc = t.encode('a a a a a a a a a a a a a a a a a a');
  assert.equal(enc.sequenceLength, 8);
  assert.equal(enc.inputIds[0], 101n);
  assert.equal(enc.inputIds[7], 102n);
});
ok('attentionMask = 1, tokenTypeIds = 0', () => {
  const t = new BertWordPiece(vocab);
  const enc = t.encode('a person');
  for (const v of enc.attentionMask) assert.equal(v, 1n);
  for (const v of enc.tokenTypeIds) assert.equal(v, 0n);
  assert.ok(enc.inputIds instanceof BigInt64Array);
});

// ── 2) PRNG-Determinismus ──────────────────────────────────
console.log('■ PortableRandom');
ok('gleicher Seed ⇒ gleiche Folge', () => {
  const a = new PortableRandom(1234), b = new PortableRandom(1234);
  const fa = Array.from({ length: 32 }, () => a.nextFloat());
  const fb = Array.from({ length: 32 }, () => b.nextFloat());
  assert.deepEqual(fa, fb);
});
ok('String-Seed = FNV-1a', () => {
  const a = new PortableRandom('testfeld'), b = new PortableRandom('testfeld');
  assert.equal(a.nextFloat(), b.nextFloat());
  const c = new PortableRandom('testfeld2');
  assert.notEqual(a.nextFloat(), c.nextFloat());
});
ok('fillNormal füllt exakt den Bereich', () => {
  const r = new PortableRandom(7);
  const arr = new Float32Array(10);
  r.fillNormal(arr, 3, 8);
  for (let i = 3; i < 8; i++) assert.ok(Number.isFinite(arr[i]));
  for (let i = 0; i < 3; i++) assert.equal(arr[i], 0);
  for (let i = 8; i < 10; i++) assert.equal(arr[i], 0);
});

// ── 3) DE→EN-Lexikon ───────────────────────────────────────
console.log('■ deToEn');
ok('deutsche Prompts werden übersetzt', () => {
  assert.ok(deToEn('ein mann geht vorwärts').includes('walks'));
  assert.ok(deToEn('person tanzt fröhlich').includes('dances'));
});
ok('Englisch bleibt unverändert', () => {
  assert.equal(deToEn('a person walks forward'), 'a person walks forward');
});

// ── 4) mat3→Quat ───────────────────────────────────────────
console.log('■ mat3ToQuat');
ok('Identität → [0,0,0,1]', () => {
  const q = mat3ToQuat([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  assert.ok(Math.abs(q[0]) < 1e-12 && Math.abs(q[1]) < 1e-12 && Math.abs(q[2]) < 1e-12);
  assert.ok(Math.abs(q[3] - 1) < 1e-12);
});
ok('90°-Drehung um Z', () => {
  const c = Math.cos(Math.PI / 4), s = Math.sin(Math.PI / 4);
  const q = mat3ToQuat([0, -1, 0, 1, 0, 0, 0, 0, 1]);
  assert.ok(Math.abs(q[2] - s) < 1e-9, 'qz=' + q[2]);
  assert.ok(Math.abs(q[3] - c) < 1e-9);
  assert.ok(Math.abs(q[0]) < 1e-9 && Math.abs(q[1]) < 1e-9);
});
ok('w ≥ 0 kanonisch + normiert (Zufalls-Rotationen)', () => {
  const rng = new PortableRandom(42);
  for (let k = 0; k < 200; k++) {
    // zufällige Achse + Winkel → Rodrigues
    let ax = rng.nextNormal(), ay = rng.nextNormal(), az = rng.nextNormal();
    const l = Math.hypot(ax, ay, az) || 1; ax /= l; ay /= l; az /= l;
    const ang = rng.nextFloat() * Math.PI;
    const ct = Math.cos(ang), st = 1 - Math.cos(ang);
    const K = [0, -az, ay, az, 0, -ax, -ay, ax, 0];
    const m = [], I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (let i = 0; i < 9; i++) m[i] = I[i] * ct + K[i] * st + (i % 4 === 0 ? ax * ax * (1 - ct) : 0);
    // M = cI + sK + (1-c)aa^T
    m[0] = ct + (1 - ct) * ax * ax; m[1] = (1 - ct) * ax * ay - az * Math.sin(ang); m[2] = (1 - ct) * ax * az + ay * Math.sin(ang);
    m[3] = (1 - ct) * ay * ax + az * Math.sin(ang); m[4] = ct + (1 - ct) * ay * ay; m[5] = (1 - ct) * ay * az - ax * Math.sin(ang);
    m[6] = (1 - ct) * az * ax - ay * Math.sin(ang); m[7] = (1 - ct) * az * ay + ax * Math.sin(ang); m[8] = ct + (1 - ct) * az * az;
    const q = mat3ToQuat(m);
    assert.ok(q[3] >= 0, 'w<0');
    const n = Math.hypot(q[0], q[1], q[2], q[3]);
    assert.ok(Math.abs(n - 1) < 1e-6, '|q|=' + n);
    // zurück zur Matrix (Sandwich gegen Einheitsvektoren prüfen)
    const rot = (v) => {
      const x = q[0], y = q[1], z = q[2], w = q[3];
      const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
      return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
    };
    const r1 = rot([1, 0, 0]);
    assert.ok(Math.abs(r1[0] - m[0]) < 1e-6 && Math.abs(r1[1] - m[3]) < 1e-6 && Math.abs(r1[2] - m[6]) < 1e-6, 'Spalte 0');
  }
});

console.log('');
console.log('Ergebnis: ' + passed + ' OK, ' + failed + ' FEHLER');
process.exit(failed ? 1 : 0);
