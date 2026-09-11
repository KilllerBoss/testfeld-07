/* Testfeld·07 — Robo-Konsole
 * Versteht deutsche Sätze UND das JSON-Protokoll (Fernsteuer-Schnittstelle
 * für Sprachmodelle wie Gemini). Rein logisch — in Node testbar.
 *
 * JSON-Protokoll (Einzelobjekt oder Array von Objekten):
 *   {"cmd":"train","robot":"arm","gens":120}
 *   {"cmd":"robot","id":"humanoid"}
 *   {"cmd":"mode","mode":"manual"}          // manual | policy
 *   {"cmd":"tod","tod":"night"}             // day | sunset | night
 *   {"cmd":"save","name":"mein-champion"}
 *   {"cmd":"load","name":"mein-champion"}
 *   {"cmd":"reset"}  {"cmd":"status"}  {"cmd":"target"}
 *   {"cmd":"export"}   // Champion als Datei/Download
 *   {"cmd":"import","policy":{...robofield-policy-v1...}}
 * Antwort: { actions: [...], replies: ["..."] }  — actions führt app.js aus.
 */
(function (global) {
  'use strict';

  var ROBOT_WORDS = {
    arm: ['arm', 'armbot', 'greifarm', 'greifer', 'arm-bot'],
    humanoid: ['humanoid', 'läufer', 'laeufer', 'walker', 'mensch', 'humanoider'],
    armmj: ['widowx', 'wx250', 'menagerie-arm'],
    op3mj: ['op3', 'robotis', 'menagerie-humanoid']
  };
  var ROBOT_IDS = ['arm', 'armmj', 'humanoid', 'op3mj'];

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[,.;:!?"'`´]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function findRobot(t) {
    for (var id = 0; id < ROBOT_IDS.length; id++) {
      var w = ROBOT_WORDS[ROBOT_IDS[id]];
      for (var k = 0; k < w.length; k++) {
        if (new RegExp('(^| )' + w[k] + '( |$)').test(t)) return ROBOT_IDS[id];
      }
    }
    return null;
  }

  function findNumber(t) {
    var m = t.match(/(\d{1,5})/);
    return m ? parseInt(m[1], 10) : null;
  }

  // Direktiven-Parser; state = {robot, mode, tod} wird nur gelesen.
  function parseGerman(raw, state) {
    var t = norm(raw);
    var actions = [], replies = [];
    function A(a) { actions.push(a); }

    if (/^(hilfe|help|\/?help)\b/.test(t) || t === 'help' || /was kannst du/.test(t)) {
      replies.push(
        'ROBOLAB-KONSOLE — ich verstehe Sätze und JSON. Beispiele:',
        '  „trainiere den armbot 120 generationen"  |  {"cmd":"train","robot":"arm","gens":120}',
        '  „stop"/„stopp" beendet das Training    |  {"cmd":"robot","id":"humanoid"}',
        '  „roboter humanoid", „manuell", „policy"|  {"cmd":"mode","mode":"manual"}',
        '  „tag"/„abend"/„nacht"                  |  {"cmd":"tod","tod":"night"}',
        '  „speichere <name>", „lade <name>"      |  {"cmd":"save","name":"mein-champion"}',
        '  „stehen"/„gehen" (OP3), „greifen"/„loslassen" (Arm)',
        '  „neues ziel", „reset", „status", „engine", „export"',
        '  Policy-Import: Zeile mit komplettem robofield-policy-v1-JSON einfügen.'
      );
      return { actions: actions, replies: replies };
    }
    // Engine/Version („welche Version ist das?") — sichtbare Kennung der APK
    if (/^(engine|engine\??|version|version\??|build|buildinfo|info)\b/.test(t) || /welche version/.test(t)) {
      A({ op: 'engine' }); replies.push('Engine-Info wird ausgegeben …');
      return { actions: actions, replies: replies };
    }

    // Training
    if (/\b(stop|stopp|pause|halt)\b/.test(t) && !/speicher/.test(t)) {
      A({ op: 'trainStop' }); replies.push('Training angehalten.');
      return { actions: actions, replies: replies };
    }
    var gens = findNumber(t);
    if (/\b(trainiere|training|trainiere|starte training|train)\b/.test(t) || (/\btrain/.test(t) && gens)) {
      var robot = findRobot(t) || state.robot;
      var g = gens || 60;
      g = Math.max(1, Math.min(2000, g));
      A({ op: 'train', robot: robot, gens: g });
      replies.push('Training gestartet: ' + robot.toUpperCase() + ', ' + g + ' Generationen, Population 40.');
      return { actions: actions, replies: replies };
    }

    // Roboterwechsel
    if (/\b(roboter|robot|wechsle|wechsel|aktiviere|nimm|zeig)\b/.test(t)) {
      var r2 = findRobot(t);
      if (r2) { A({ op: 'robot', id: r2 }); replies.push('Roboter: ' + r2.toUpperCase() + '.'); return { actions: actions, replies: replies }; }
    }
    var r3 = findRobot(t);
    if (r3 && t.split(' ').length <= 3) { A({ op: 'robot', id: r3 }); replies.push('Roboter: ' + r3.toUpperCase() + '.'); return { actions: actions, replies: replies }; }

    // Humanoid-MJ: stehen / gehen — Arm: greifen / loslassen
    if (/\b(stehen|stand|still)\b/.test(t)) { A({ op: 'hummode', mode: 'stehen' }); replies.push('ROBOTIS OP3: STEHEN.'); return { actions: actions, replies: replies }; }
    if (/\b(gehen|schritte|laufen lassen)\b/.test(t) || /\bgehen\b/.test(t)) { A({ op: 'hummode', mode: 'gehen' }); replies.push('ROBOTIS OP3: GEHEN (quasistatische Firmware-Gait).'); return { actions: actions, replies: replies }; }
    if (/\b(greifen|zugreifen|grab|hebe|heben)\b/.test(t)) { A({ op: 'grip', closed: true }); replies.push('ARMBOT: Greifen (Auto-Aim auf den Ball).'); return { actions: actions, replies: replies }; }
    if (/\b(loslassen|offen lassen|drop)\b/.test(t)) { A({ op: 'grip', closed: false }); replies.push('ARMBOT: Griff offen.'); return { actions: actions, replies: replies }; }

    // Modus
    if (/\b(manuell|manual|handbetrieb|joystick)\b/.test(t)) {
      A({ op: 'mode', mode: 'manual' }); replies.push('Modus: MANUELL. Joystick links, Buttons rechts.');
      return { actions: actions, replies: replies };
    }
    if (/\b(policy|politik|autopilot|ki|champion|policy modus)\b/.test(t)) {
      A({ op: 'mode', mode: 'policy' }); replies.push('Modus: POLICY — der aktuelle Champion fährt.');
      return { actions: actions, replies: replies };
    }

    // Tageszeit
    if (/\b(nacht|nachts|nachts)\b/.test(t) || /\bnight\b/.test(t)) { A({ op: 'tod', tod: 'night' }); replies.push('Tageszeit: Nacht.'); return { actions: actions, replies: replies }; }
    if (/\b(abend|abendrot|abenddämmerung|sunset)\b/.test(t)) { A({ op: 'tod', tod: 'sunset' }); replies.push('Tageszeit: Abendrot.'); return { actions: actions, replies: replies }; }
    if (/\b(tag|tageslicht|morgen|mittag|day|licht)\b/.test(t)) { A({ op: 'tod', tod: 'day' }); replies.push('Tageszeit: Tag.'); return { actions: actions, replies: replies }; }

    // Speichern / Laden
    var mSave = t.match(/\b(speichere?|speichern|save|sichern)\b\s*(.*)$/);
    if (mSave) {
      var name = mSave[2].replace(/\b(als|unter|champion|policy)\b/g, '').trim() || null;
      A({ op: 'save', name: name });
      replies.push('Champion gespeichert' + (name ? ' als „' + name + '".' : '.'));
      return { actions: actions, replies: replies };
    }
    var mLoad = t.match(/\b(lade|laden|load|lädt)\b\s*(.*)$/);
    if (mLoad) {
      var name2 = mLoad[2].replace(/\b(der|die|das|policy|champion|von|aus)\b/g, '').trim() || null;
      A({ op: 'load', name: name2 });
      replies.push(name2 ? 'Lade „' + name2 + '" …' : 'Lade letzten gespeicherten Champion …');
      return { actions: actions, replies: replies };
    }

    // Export / Reset / Ziel / Status
    if (/\b(export|exportiere|download|herunterladen)\b/.test(t)) { A({ op: 'export' }); replies.push('Champion wird exportiert …'); return { actions: actions, replies: replies }; }
    if (/\b(reset|zurücksetzen|zuruecksetzen|neustart|neu starten)\b/.test(t)) { A({ op: 'reset' }); replies.push('Roboter zurückgesetzt.'); return { actions: actions, replies: replies }; }
    if (/\b(ziel|target|neues ziel)\b/.test(t)) { A({ op: 'target' }); replies.push('Neues Ziel platziert.'); return { actions: actions, replies: replies }; }
    if (/\bstatus|wie läuft|wie laeuft|bericht|stand\b/.test(t)) { A({ op: 'status' }); replies.push('Status wird ausgegeben …'); return { actions: actions, replies: replies }; }

    return null; // nicht verstanden
  }

  function parseJsonProtocol(obj) {
    var actions = [], replies = [];
    function bad(msg) { replies.push('Protokollfehler: ' + msg); }
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) {
        var res = parseJsonProtocol(obj[i]);
        actions = actions.concat(res.actions); replies = replies.concat(res.replies);
      }
      return { actions: actions, replies: replies };
    }
    if (!obj || typeof obj !== 'object' || !obj.cmd) { bad('cmd fehlt'); return { actions: actions, replies: replies }; }
    switch (obj.cmd) {
      case 'train':
        if (ROBOT_IDS.indexOf(obj.robot) < 0) { bad('unbekannter robot: ' + obj.robot); break; }
        var g = Math.max(1, Math.min(2000, parseInt(obj.gens, 10) || 60));
        actions.push({ op: 'train', robot: obj.robot, gens: g });
        replies.push('JSON: Training ' + obj.robot + ', ' + g + ' Generationen.');
        break;
      case 'robot':
        if (ROBOT_IDS.indexOf(obj.id) < 0) { bad('unbekannte id: ' + obj.id); break; }
        actions.push({ op: 'robot', id: obj.id });
        replies.push('JSON: Roboter → ' + obj.id + '.');
        break;
      case 'hummode':
        if (['stehen', 'gehen'].indexOf(obj.mode) < 0) { bad('unbekannter modus (stehen|gehen): ' + obj.mode); break; }
        actions.push({ op: 'hummode', mode: obj.mode });
        replies.push('JSON: OP3-Modus → ' + obj.mode + '.');
        break;
      case 'grip':
        actions.push({ op: 'grip', closed: !!obj.closed });
        replies.push('JSON: Greifer ' + (obj.closed ? 'zu.' : 'offen.'));
        break;
      case 'mode':
        if (['manual', 'policy'].indexOf(obj.mode) < 0) { bad('unbekannter mode: ' + obj.mode); break; }
        actions.push({ op: 'mode', mode: obj.mode });
        replies.push('JSON: Modus → ' + obj.mode + '.');
        break;
      case 'tod':
        if (['day', 'sunset', 'night'].indexOf(obj.tod) < 0) { bad('unbekanntes tod: ' + obj.tod); break; }
        actions.push({ op: 'tod', tod: obj.tod });
        replies.push('JSON: Tageszeit → ' + obj.tod + '.');
        break;
      case 'save':
        actions.push({ op: 'save', name: obj.name || null });
        replies.push('JSON: Champion gespeichert' + (obj.name ? ' als „' + obj.name + '".' : '.'));
        break;
      case 'load':
        actions.push({ op: 'load', name: obj.name || null });
        replies.push('JSON: Lade ' + (obj.name ? '„' + obj.name + '"' : 'letzten Champion') + ' …');
        break;
      case 'reset': actions.push({ op: 'reset' }); replies.push('JSON: Reset.'); break;
      case 'status': actions.push({ op: 'status' }); replies.push('JSON: Status folgt.'); break;
      case 'engine': actions.push({ op: 'engine' }); replies.push('JSON: Engine-Info folgt.'); break;
      case 'target': actions.push({ op: 'target' }); replies.push('JSON: Neues Ziel.'); break;
      case 'export': actions.push({ op: 'export' }); replies.push('JSON: Export läuft.'); break;
      case 'import':
        if (!obj.policy || obj.policy.format !== 'robofield-policy-v1') { bad('policy ohne format robofield-policy-v1'); break; }
        actions.push({ op: 'importPolicy', policy: obj.policy });
        replies.push('JSON: Policy importiert (' + obj.policy.robot + ', gen ' + obj.policy.gen + ').');
        break;
      default: bad('unbekanntes cmd: ' + obj.cmd);
    }
    return { actions: actions, replies: replies };
  }

  // Haupteingang: Zeile → Aktionen + Antworten (oder null = unverstanden)
  function handle(raw, state) {
    var s = String(raw || '').trim();
    if (!s) return { actions: [], replies: [] };
    if (s[0] === '{' || s[0] === '[') {
      try {
        var obj = JSON.parse(s);
        return parseJsonProtocol(obj);
      } catch (e) {
        return { actions: [], replies: ['JSON nicht lesbar: ' + e.message] };
      }
    }
    var g = parseGerman(s, state || {});
    if (g) return g;
    return {
      actions: [],
      replies: ['Verstanden: „' + s + '" — damit kann ich nichts anfangen.', 'Tippe „hilfe" für alle Befehle (Deutsch + JSON).']
    };
  }

  global.TF07 = global.TF07 || {};
  global.TF07.console = { handle: handle, parseGerman: parseGerman, parseJsonProtocol: parseJsonProtocol, norm: norm, findRobot: findRobot };
})(typeof window !== 'undefined' ? window : globalThis);
