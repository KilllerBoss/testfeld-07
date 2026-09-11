// MICRODUCK App-Bridge (in SimActivity beim Boot der 3D-Sim injiziert).
//
// Registriert eine GeminiSource als Input-Source im Controller der
// MicroDuck-Simulation. Protokoll (13D-Interface, wie im Projekt-Contract):
//   setSubgoal({goals:[{cmd:{vx,vy,yaw}, dauer_s, grund}], notify, stimmung})
// Die Goals werden nacheinander abgespielt (~1 s EMA-Interpolation auf den
// Twist); Nutzer-Eingaben (Touch/Gamepad/Tastatur) und Waypoint-Klicks
// haben Vorrang, da die GeminiSource als LETZTE registriert ist.
// Zustandsabfrage: window.__mdGetState() -> JSON-String fuer Kotlin/Gemini.
(function () {
  if (window.__mdBridge) { if (window.AndroidHost) window.AndroidHost.ready('ok'); return; }
  window.__mdBridge = true;
  var clamp = function (v, lo, hi) { v = +v || 0; return v < lo ? lo : (v > hi ? hi : v); };

  function GeminiSource() {
    this.id = 'gemini'; this.connected = true;
    this.command = new Float32Array(3);
    this.axes = { jaw: 0, orbitX: 0, orbitY: 0 };
    this.pressed = {}; this.onAction = function () {};
    this.queue = []; this.until = 0;
  }

  GeminiSource.prototype.isActive = function () {
    return !!window.__mdCurrentGoal && performance.now() < this.until;
  };

  GeminiSource.prototype.setSubgoal = function (json) {
    try {
      var goals = (json && json.goals) || [];
      if (!goals.length) return;
      for (var i = 0; i < goals.length; i++) {
        var g = goals[i], c = g.cmd || {};
        this.queue.push({
          vx: clamp(c.vx, -0.4, 0.4), vy: clamp(c.vy, -0.3, 0.3), wz: clamp(c.yaw, -1.0, 1.0),
          ms: clamp(g.dauer_s, 1, 10) * 1000, grund: String(g.grund || '')
        });
      }
      this.until = performance.now();
      window.__mdLastSubgoal = json;
    } catch (e) { if (window.AndroidHost) window.AndroidHost.error('setSubgoal: ' + e); }
  };

  GeminiSource.prototype.poll = function (dt) {
    var now = performance.now();
    if (now >= this.until && this.queue.length) {
      var g = this.queue.shift();
      this.until = now + g.ms;
      window.__mdCurrentGoal = g;
    }
    var t = window.__mdCurrentGoal;
    var active = t && now < this.until;
    if (!active) {
      var a0 = Math.min(1, dt / 0.5);
      this.command[0] += a0 * (0 - this.command[0]);
      this.command[1] += a0 * (0 - this.command[1]);
      this.command[2] += a0 * (0 - this.command[2]);
      return;
    }
    var a = Math.min(1, dt / 1.0); // ~1 s Interpolation (App-Vertrag)
    this.command[0] += a * (t.vx - this.command[0]);
    this.command[1] += a * (t.vy - this.command[1]);
    this.command[2] += a * (t.wz - this.command[2]);
  };

  window.rl.controller.addSource(new GeminiSource());

  window.__mdGetState = function () {
    try {
      var rl = window.rl, q = rl.data.qpos, v = rl.data.qvel;
      var yaw = Math.atan2(2 * (q[3] * q[6] + q[4] * q[5]), 1 - 2 * (q[5] * q[5] + q[6] * q[6]));
      var cur = window.__mdCurrentGoal;
      var s = window.rl.controller.sources.find(function (x) { return x.id === 'gemini'; });
      return JSON.stringify({
        pos: [q[0], q[1], q[2]].map(function (x) { return +x.toFixed(2); }),
        yaw: +yaw.toFixed(2),
        vel: [v[0], v[1]].map(function (x) { return +x.toFixed(2); }),
        wz: +((v[5] || 0).toFixed(2)),
        cmd: [rl.cmd[0], rl.cmd[1], rl.cmd[2]].map(function (x) { return +x.toFixed(2); }),
        mode: rl.mode, loco: rl.loco, recovery: rl.recovery,
        gemini_goal: cur ? (cur.grund || null) : null,
        gemini_cmd: s ? [+s.command[0].toFixed(2), +s.command[1].toFixed(2), +s.command[2].toFixed(2)] : [0, 0, 0],
        queue_len: s ? s.queue.length : 0
      });
    } catch (e) { return JSON.stringify({ error: String(e) }); }
  };

  if (window.AndroidHost) window.AndroidHost.ready('ok');
})();
