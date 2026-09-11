/* Testfeld·07 — Deterministischer Zufall
 * mulberry32 — MUSS bit-identisch zum Python-Spiegel (kaggle/robofield_common.py) sein.
 * Integer-Ops in 32-Bit, Division durch 2^32 → identische IEEE-Double-Ergebnisse.
 */
(function (global) {
  'use strict';

  function mulberry32(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      t = (t ^ (t >>> 14)) >>> 0;
      return t / 4294967296;
    };
  }

  // Helfer: gleichverteilte Floats, identische Formeln wie im Python-Spiegel.
  function makeRng(seed) {
    var next = mulberry32(seed >>> 0);
    return {
      next: next,
      uniform: function (a, b) { return a + (b - a) * next(); },
      int: function (n) { return Math.floor(next() * n); }
    };
  }

  global.TF07 = global.TF07 || {};
  global.TF07.mulberry32 = mulberry32;
  global.TF07.makeRng = makeRng;
})(typeof window !== 'undefined' ? window : globalThis);
