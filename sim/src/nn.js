/* Testfeld·07 — Policy-Netz (MLP 2×32 tanh) + robofield-policy-v1
 *
 * Gewichts-Layout (verbindlich, identisch zum Kaggle-Spiegel):
 *   flat = [W1 (32×obs, row-major), b1 (32), W2 (32×32, row-major), b2 (32), W3 (act×32, row-major), b3 (act)]
 *   y = tanh(W·x + b) in jeder Schicht, Ausgang tanh → Skalierung durch Aktionsgrenzen der Env.
 *
 * Policy-Format (verbindlich):
 * {
 *   "format": "robofield-policy-v1",
 *   "robot": "duck | arm | humanoid",
 *   "arch": [obs, 32, 32, act],
 *   "weights": [ [...], [...], ... 6 Tensoren als Zahlen-Arrays ],
 *   "gen": 0, "fit": 0.0, "src": "kaggle | lokal | import"
 * }
 */
(function (global) {
  'use strict';

  var HIDDEN = 32;

  function weightCount(obs, act) {
    return obs * HIDDEN + HIDDEN + HIDDEN * HIDDEN + HIDDEN + act * HIDDEN + act;
  }

  function sliceSizes(obs, act) {
    return [obs * HIDDEN, HIDDEN, HIDDEN * HIDDEN, HIDDEN, act * HIDDEN, act];
  }

  // Aktionen begrenzen pro Roboter (Env kennt die Grenzen ebenfalls)
  var ACT_LIMITS = { duck: 4.0, arm: 1.6, humanoid: 1.0 };

  function forward(flat, obs, nAct) {
    // flat: Float64Array; obs: Float64Array(len obs) → Float64Array(nAct) in [-1,1]
    var o = obs.length;
    var w1 = 0, b1 = o * HIDDEN;
    var w2 = b1 + HIDDEN, b2 = w2 + HIDDEN * HIDDEN;
    var w3 = b2 + HIDDEN, b3 = w3 + nAct * HIDDEN;
    var h1 = new Float64Array(HIDDEN);
    var h2 = new Float64Array(HIDDEN);
    var out = new Float64Array(nAct);
    var i, j, s;
    for (i = 0; i < HIDDEN; i++) {
      s = flat[b1 + i];
      for (j = 0; j < o; j++) s += flat[w1 + i * o + j] * obs[j];
      h1[i] = Math.tanh(s);
    }
    for (i = 0; i < HIDDEN; i++) {
      s = flat[b2 + i];
      for (j = 0; j < HIDDEN; j++) s += flat[w2 + i * HIDDEN + j] * h1[j];
      h2[i] = Math.tanh(s);
    }
    for (i = 0; i < nAct; i++) {
      s = flat[b3 + i];
      for (j = 0; j < HIDDEN; j++) s += flat[w3 + i * HIDDEN + j] * h2[j];
      out[i] = Math.tanh(s);
    }
    return out;
  }

  function genomeToPolicy(flat, robot, gen, fit, src) {
    var arch = ARCHS[robot];
    var sizes = sliceSizes(arch[0], arch[3]);
    var weights = [];
    var off = 0;
    for (var k = 0; k < 6; k++) {
      weights.push(Array.from(flat.slice(off, off + sizes[k])));
      off += sizes[k];
    }
    return {
      format: 'robofield-policy-v1',
      robot: robot,
      arch: arch.slice(),
      weights: weights,
      gen: gen || 0,
      fit: fit || 0.0,
      src: src || 'lokal'
    };
  }

  function policyToGenome(policy) {
    var arr = [];
    for (var k = 0; k < policy.weights.length; k++) {
      var w = policy.weights[k];
      for (var i = 0; i < w.length; i++) arr.push(w[i]);
    }
    return Float64Array.from(arr);
  }

  var ARCHS = {
    duck: [12, HIDDEN, HIDDEN, 2],
    arm: [15, HIDDEN, HIDDEN, 5],
    humanoid: [10, HIDDEN, HIDDEN, 5],
    // MuJoCo-Microduck (obs 61 → 14 Gelenk-Offsets, exakt wie die ONNX-Policies)
    duckmj: [61, HIDDEN, HIDDEN, 14],
    // MuJoCo-Menagerie: WidowX 250 (qerr6+qvel6+ballDir3+grip1 → 6 Ref-Deltas + Grip)
    armmj: [16, HIDDEN, HIDDEN, 7],
    // MuJoCo-Menagerie: ROBOTIS OP3 (projGrav3+qerr20+qvel20+cmd3 → 20 Gelenk-Offsets)
    op3mj: [46, HIDDEN, HIDDEN, 20]
  };

  // Validierung gegen die App-Architektur
  function validatePolicy(policy) {
    function err(m) { return { ok: false, error: m }; }
    if (!policy || typeof policy !== 'object') return err('Kein JSON-Objekt');
    if (policy.format !== 'robofield-policy-v1') return err('format != robofield-policy-v1');
    var arch = ARCHS[policy.robot];
    if (!arch) return err('unbekannter Roboter: ' + policy.robot);
    if (!Array.isArray(policy.arch) || policy.arch.length !== 4) return err('arch muss 4 Einträge haben');
    for (var i = 0; i < 4; i++) if (policy.arch[i] !== arch[i]) return err('arch[' + i + ']=' + policy.arch[i] + ', erwartet ' + arch[i]);
    if (!Array.isArray(policy.weights) || policy.weights.length !== 6) return err('weights muss 6 Tensoren enthalten');
    var sizes = sliceSizes(arch[0], arch[3]);
    var total = 0;
    for (i = 0; i < 6; i++) {
      if (!Array.isArray(policy.weights[i])) return err('weights[' + i + '] ist kein Array');
      if (policy.weights[i].length !== sizes[i]) return err('weights[' + i + '].length=' + policy.weights[i].length + ', erwartet ' + sizes[i]);
      for (var j = 0; j < policy.weights[i].length; j++) {
        var v = policy.weights[i][j];
        if (typeof v !== 'number' || !isFinite(v)) return err('weights[' + i + '][' + j + '] keine endliche Zahl');
      }
      total += sizes[i];
    }
    if (total !== weightCount(arch[0], arch[3])) return err('Gewichtsgesamtzahl falsch');
    return { ok: true, error: null, genome: policyToGenome(policy), count: total };
  }

  // Deterministische Erst-Initialisierung (Xavier-Grenze), für Tests + Factory-Champion
  function initGenome(seed, obs, act) {
    var rng = global.TF07.makeRng(seed);
    var flat = new Float64Array(weightCount(obs, act));
    var sizes = sliceSizes(obs, act);
    var fanPairs = [];
    fanPairs.push([obs, HIDDEN]); fanPairs.push([HIDDEN, 0]);
    fanPairs.push([HIDDEN, HIDDEN]); fanPairs.push([HIDDEN, 0]);
    fanPairs.push([HIDDEN, act]); fanPairs.push([act, 0]);
    var off = 0;
    for (var k = 0; k < 6; k++) {
      var lim = fanPairs[k][1] === 0 ? 0.1 : Math.sqrt(6 / (fanPairs[k][0] + fanPairs[k][1]));
      for (var i = 0; i < sizes[k]; i++) flat[off + i] = rng.uniform(-lim, lim);
      off += sizes[k];
    }
    return flat;
  }

  global.TF07 = global.TF07 || {};
  global.TF07.nn = {
    HIDDEN: HIDDEN,
    ARCHS: ARCHS,
    ACT_LIMITS: ACT_LIMITS,
    weightCount: weightCount,
    sliceSizes: sliceSizes,
    forward: forward,
    initGenome: initGenome,
    genomeToPolicy: genomeToPolicy,
    policyToGenome: policyToGenome,
    validatePolicy: validatePolicy
  };
})(typeof window !== 'undefined' ? window : globalThis);
