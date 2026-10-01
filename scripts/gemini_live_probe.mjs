// gemini_live_probe.mjs — ECHTER API-Call (Key + Modell + JSON-Modus beweisen)
import { buildPrompt, gemBody, gemText, extractJson, applySetup, buildStateSnap } from '../app/src/main/assets/www/js/feld/gemini.js';
import { RewModel } from '../app/src/main/assets/www/js/feld/rewards.js';
import { SchubModel } from '../app/src/main/assets/www/js/feld/schubser.js';
import { GroundModel } from '../app/src/main/assets/www/js/feld/ground.js';
import { PhoneModel } from '../app/src/main/assets/www/js/feld/phone.js';
import { CmdGen } from '../app/src/main/assets/www/js/feld/cmdgen.js';
import { getApiKey } from '../app/src/main/assets/www/js/feld/gemini.js';

const S = {
  mode: 'train', budget: 30, fallMode: 'reset', fallWinS: 6,
  rew: new RewModel(null), schubser: new SchubModel(null),
  ground: new GroundModel(null), phone: new PhoneModel(null), cmdgen: new CmdGen({}),
  task: { obsDim: 61, actDim: 14, level: 1, setLevel() {} },
  trainer: { stage: 1, hyper: { T: 1024, gamma: 0.99, lam: 0.95, clip: 0.2, epochs: 4, mb: 256, lr: 3e-4, cV: 0.5, cE: 0.005 }, tricks: { on: true, autoLr: true, autoRollout: true, autoNoise: true } },
};
const key = getApiKey();
console.log('Key: ' + key.slice(0, 6) + '…' + key.slice(-4));
const wish = 'Die Ente soll schneller drehen lernen und nach einem Sturz weiter üben statt neu zu starten. Schubser moderat an.';
const prompt = buildPrompt(wish, buildStateSnap(S));
const body = gemBody(prompt);
const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=' + encodeURIComponent(key);
const t0 = Date.now();
const res = await fetch(url, { method: 'POST', body });
console.log('HTTP ' + res.status + ' in ' + (Date.now() - t0) + ' ms');
const text = await res.text();
if (res.status !== 200) { console.log('FEHLER:', text.slice(0, 400)); process.exit(1); }
const out = extractJson(gemText(text));
console.log('Antwort-Keys: ' + Object.keys(out).join(', '));
const r = applySetup(out, S);
console.log('Angewandt: ' + r.changes.length + ' Änderungen, übersprungen: ' + r.skipped.length);
for (const c of r.changes) console.log('  • ' + c);
