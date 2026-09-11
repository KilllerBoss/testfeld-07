/* Testfeld·07 — UI-Schicht: DOM-Verdrahtung (Joystick, Chips, Buttons,
 * Konsolen-Drawer, Trainings-Panel, Farb-Dots, Boot-Log).
 * Kein Framework — direkt, klein, offline. app.js ruft TF.ui.* auf.
 */
(function (global) {
  'use strict';
  var TF = global.TF07 = global.TF07 || {};

  var el = function (id) { return document.getElementById(id); };
  var app = null;

  var BTN_DEFS = {
    duck: [
      { id: 'target', label: 'ZIEL', fn: function () { app.newTarget(); } },
      { id: 'rays', label: 'STRAHLEN', fn: function () { app.toggleRays(); } },
      { id: 'reset', label: 'RESET', fn: function () { app.resetRobot(); } }
    ],
    arm: [
      { id: 'grip', label: 'GREIFER', fn: function () { app.toggleGrip(); } },
      { id: 'target', label: 'BALL', fn: function () { app.newTarget(); } },
      { id: 'reset', label: 'RESET', fn: function () { app.resetRobot(); } }
    ],
    humanoid: [
      { id: 'target', label: 'ZIEL', fn: function () { app.newTarget(); } },
      { id: 'halt', label: 'HALT', fn: function () { app.haltHumanoid(); } },
      { id: 'reset', label: 'RESET', fn: function () { app.resetRobot(); } }
    ]
  };

  function chip(parent, label, on, fn) {
    var b = document.createElement('button');
    b.className = 'chip' + (on ? ' on' : '');
    b.textContent = label;
    b.addEventListener('click', fn);
    parent.appendChild(b);
    return b;
  }

  function init(a) {
    app = a;
    buildTopbar();
    buildBtnStack();
    buildColorDots();
    initJoystick();
    initConsole();
    initTrainingPanel();
    initFileImport();
    window.addEventListener('resize', function () { app.resize(); });
  }

  function buildTopbar() {
    var rc = el('robotChips');
    rc.innerHTML = '';
    ['duck', 'arm', 'humanoid'].forEach(function (r) {
      chip(rc, r.toUpperCase(), app.state.robot === r, function () {
        app.setRobot(r); buildTopbar(); buildBtnStack();
      });
    });
    var mc = el('modeChips');
    mc.innerHTML = '';
    chip(mc, 'MANUELL', app.state.mode === 'manual', function () {
      app.setMode('manual'); buildTopbar();
    });
    chip(mc, 'POLICY', app.state.mode === 'policy', function () {
      app.setMode('policy'); buildTopbar();
    });
    var tod = el('todBtn');
    tod.textContent = { day: 'TAG', sunset: 'ABEND', night: 'NACHT' }[app.state.tod];
    tod.onclick = function () {
      var order = ['day', 'sunset', 'night'];
      var next = order[(order.indexOf(app.state.tod) + 1) % 3];
      app.setTod(next);
      buildTopbar();
    };
    var tb = el('trainBtn');
    tb.textContent = app.state.training.active ? 'TRAIN ▮▮' : 'TRAIN ▶';
    tb.classList.toggle('warn', app.state.training.active);
    tb.onclick = function () {
      if (app.state.training.active) app.stopTraining();
      else app.quickTrain();
      buildTopbar();
    };
    el('consoleBtn').onclick = function () {
      var c = el('console');
      c.classList.toggle('hidden');
      if (!c.classList.contains('hidden')) el('conInput').focus();
    };
  }

  function buildBtnStack() {
    var st = el('btnStack');
    st.innerHTML = '';
    (BTN_DEFS[app.state.robot] || []).forEach(function (d) {
      var b = document.createElement('button');
      b.className = 'cbtn';
      b.id = 'btn-' + d.id;
      b.textContent = d.label;
      b.addEventListener('click', d.fn);
      st.appendChild(b);
    });
  }

  function buildColorDots() {
    var cd = el('colorDots');
    cd.innerHTML = '';
    app.COLOR_CHOICES.forEach(function (c, i) {
      var d = document.createElement('button');
      d.className = 'dot' + (app.state.colorIdx === i ? ' on' : '');
      d.style.background = c.css;
      d.onclick = function () {
        app.setColorIdx(i);
        buildColorDots();
      };
      cd.appendChild(d);
    });
  }

  /* ---------- Joystick ---------- */
  function initJoystick() {
    var zone = el('joyZone'), base = el('joyBase'), knob = el('joyKnob');
    var R = 56, active = false, pid = -1;
    function setKnob(dx, dy) {
      knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    }
    function upd(e) {
      var r = base.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var dx = e.clientX - cx, dy = e.clientY - cy;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len > R) { dx = dx / len * R; dy = dy / len * R; }
      setKnob(dx, dy);
      app.joystick.x = dx / R; app.joystick.y = -dy / R;
    }
    zone.addEventListener('pointerdown', function (e) {
      active = true; pid = e.pointerId;
      zone.setPointerCapture(pid);
      upd(e); e.preventDefault();
    });
    zone.addEventListener('pointermove', function (e) {
      if (active && e.pointerId === pid) upd(e);
    });
    function end(e) {
      if (e.pointerId !== pid) return;
      active = false; pid = -1;
      setKnob(0, 0);
      app.joystick.x = 0; app.joystick.y = 0;
    }
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  /* ---------- Konsole ---------- */
  function logLine(text, cls) {
    var log = el('conLog');
    var d = document.createElement('div');
    d.className = 'ln' + (cls ? ' ' + cls : '');
    d.textContent = text;
    log.appendChild(d);
    while (log.children.length > 200) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  function submitLine() {
    var inp = el('conInput');
    var s = inp.value.trim();
    if (!s) return;
    inp.value = '';
    logLine('› ' + s, 'in');
    app.handleConsole(s);
  }

  function initConsole() {
    el('conForm').addEventListener('submit', function (e) {
      e.preventDefault();
      submitLine();
    });
    el('geminiBtn').addEventListener('click', function () {
      var inp = el('conInput');
      var q = inp.value.trim();
      if (!q) { logLine('GEMINI: zuerst eine Aufgabe in das Eingabefeld tippen, dann GEMINI drücken.', 'sys'); return; }
      inp.value = '';
      app.askGemini(q);
    });
  }

  /* ---------- Trainings-Panel ---------- */
  function initTrainingPanel() {
    el('trainStop').onclick = function () { app.stopTraining(); buildTopbar(); };
  }

  var chartCtx = null;
  function updateTraining(t) {
    el('trainPanel').classList.toggle('hidden', !t.active && t.history.length === 0);
    el('trainStats').textContent =
      'GEN ' + t.gen + '/' + t.gens +
      '  BEST ' + (t.bestFit === null ? '—' : t.bestFit.toFixed(1)) +
      '  AVG ' + (t.avgFit === null ? '—' : t.avgFit.toFixed(1)) +
      '  CHAMP ' + (t.champFit === null ? '—' : t.champFit.toFixed(1));
    var cv = el('trainChart');
    if (!chartCtx) chartCtx = cv.getContext('2d');
    var ctx = chartCtx, W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    if (t.history.length < 2) return;
    var his = t.history, n = his.length;
    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < n; i++) { lo = Math.min(lo, his[i].avg, his[i].best); hi = Math.max(hi, his[i].best, his[i].avg); }
    if (hi - lo < 1e-6) { hi = lo + 1; }
    function plot(key, style) {
      ctx.strokeStyle = style;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (var i = 0; i < n; i++) {
        var x = i / (n - 1) * (W - 6) + 3;
        var y = H - 4 - (his[i][key] - lo) / (hi - lo) * (H - 10);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    plot('avg', 'rgba(255,255,255,0.45)');
    plot('best', '#ff7a2f');
  }

  /* ---------- Datei-Import ---------- */
  function initFileImport() {
    el('fileImport').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { app.importPolicyText(String(rd.result), f.name); };
      rd.readAsText(f);
      e.target.value = '';
    });
  }
  function openImport() { el('fileImport').click(); }

  /* ---------- Boot-Log ---------- */
  function bootSequence(lines, done) {
    var veil = el('bootVeil'), pre = el('bootLog');
    veil.classList.remove('gone');
    var i = 0;
    function next() {
      if (i < lines.length) {
        pre.textContent += lines[i++] + '\n';
        global.setTimeout(next, 130);
      } else {
        global.setTimeout(function () {
          veil.classList.add('gone');
          if (done) done();
        }, 420);
      }
    }
    next();
  }

  function status(text) { el('statusLine').textContent = text; }

  TF.ui = {
    init: init,
    logLine: logLine,
    buildTopbar: buildTopbar,
    buildBtnStack: buildBtnStack,
    updateTraining: updateTraining,
    openImport: openImport,
    bootSequence: bootSequence,
    status: status
  };
})(typeof window !== 'undefined' ? window : globalThis);
