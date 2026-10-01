// put_gemini_secret.cjs — GEMINI_API_KEY als Actions-Repo-Secret setzen
// (libsodium sealed box, GitHub REST: PUT /repos/{owner}/{repo}/actions/secrets/NAME)
const nacl = require('tweetnacl');
const naclUtil = require('tweetnacl-util');
const sealedbox = require('tweetnacl-sealedbox-js');

const TOKEN = process.env.TOKEN;
const KEY = process.env.GK;
if (!TOKEN || !KEY) { console.error('TOKEN/GK fehlt'); process.exit(1); }

const REPO = 'KilllerBoss/testfeld-07';
const NAME = 'GEMINI_API_KEY';

(async () => {
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/public-key`, {
    headers: { Authorization: `token ${TOKEN}`, Accept: 'application/vnd.github+json' },
  });
  if (!r.ok) { console.error('public-key: HTTP', r.status); process.exit(1); }
  const { key_id, key } = await r.json();
  const sealed = sealedbox.seal(naclUtil.decodeUTF8(KEY), naclUtil.decodeBase64(key));
  const encrypted_value = naclUtil.encodeBase64(sealed);
  const pr = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/${NAME}`, {
    method: 'PUT',
    headers: { Authorization: `token ${TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ encrypted_value, key_id }),
  });
  console.log('PUT Secret: HTTP', pr.status, pr.status === 201 || pr.status === 204 ? 'OK' : await pr.text());
})();
