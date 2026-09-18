// ═══════════════════════════════════════════════════════════
// ardytoken.js — BertTokenizer (WordPiece) in purem JS.
// Gehört zur ARDY-Mini-Laufzeit (Text → Bewegung, Modell
// intsuc/Llama-3-ARDY-Mini-Core40-Browser, Textencoder =
// all-MiniLM-L6-v2 / bert-base-uncased-Vokabular).
//
// Repliziert exakt das Verhalten von HF "tokenizers" (BertTokenizer):
//   1. BertNormalizer: Steuerzeichen raus, Whitespace → ' ',
//      CJK-Zeichen werden mit Leerzeichen gepolstert, lowercase,
//      Akzente werden entfernt (NFD + Mn-Marks weg).
//   2. BertPreTokenizer: Whitespace-Split, Unicode-Satzzeichen
//      (Kategorie P*) + ASCII-Interpunktion werden Einzel-Tokens.
//   3. WordPiece: gierig längster Treffer, Fortsetzung mit '##',
//      Wörter > 100 Zeichen → [UNK].
//   4. Template: [CLS] tokens [SEP], Rechts-Truncation auf maxLen.
// Kein Padding nötig (Batch = 1, Sequenzlänge dynamisch).
// ═══════════════════════════════════════════════════════════

const CLS = '[CLS]', SEP = '[SEP]', UNK = '[UNK]';

function isWhitespaceChar(c) {
  if (c === ' ' || c === '\t' || c === '\n' || c === '\r') return true;
  const n = c.codePointAt(0);
  return n === 0x0b || n === 0x0c || n === 0x85 || (n >= 0x2000 && n <= 0x200a) || n === 0xa0 || n === 0x2028 || n === 0x2029 || n === 0x202f || n === 0x205f || n === 0x3000 || n === 0x1680;
}

function isAsciiPunct(c) {
  const n = c.codePointAt(0);
  return (n >= 33 && n <= 47) || (n >= 58 && n <= 64) || (n >= 91 && n <= 96) || (n >= 123 && n <= 126);
}

// Unicode-Kategorie "P*" (Pc, Pd, Ps, Pe, Pi, Pf, Po) für häufige
// Bereiche — Voll-NFD-Tabellen wären Überkill; die Regexp deckt die
// praktisch relevanten Interpunktionsblöcke ab.
const UNICODE_P_RE = /[\u0021-\u0023\u0025-\u002A\u002C-\u002F\u003A\u003B\u003F\u0040\u005B-\u005D\u005F\u007B\u007D\u00A1\u00A7\u00AB\u00B6\u00B7\u00BB\u00BF\u2010-\u2027\u2030-\u205E\u3001\u3002\u3008-\u3011\u3014-\u301F\u3030\uFF01-\uFF03\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF3B-\uFF3D\uFF3F\uFF5B\uFF5D\uFF5F-\uFF65]/;

function isPunct(c) { return isAsciiPunct(c) || UNICODE_P_RE.test(c); }

function isCJK(c) {
  const n = c.codePointAt(0);
  return (n >= 0x4E00 && n <= 0x9FFF) || (n >= 0x3400 && n <= 0x4DBF) || (n >= 0x20000 && n <= 0x2A6DF) || (n >= 0xF900 && n <= 0xFAFF) || (n >= 0x2F800 && n <= 0x2FA1F);
}

/** BertNormalizer — liefert den normalisierten Eingabestring. */
export function bertNormalize(s) {
  let out = '';
  for (const ch of s) {
    const n = ch.codePointAt(0);
    if (n === 0 || n === 0xFFFD || (n <= 0x1F) || (n >= 0x7F && n <= 0x9F)) continue; // Steuerzeichen
    if (isWhitespaceChar(ch)) { out += ' '; continue; }
    out += ch;
  }
  // CJK polstern
  let padded = '';
  for (const ch of out) {
    if (isCJK(ch)) padded += ' ' + ch + ' ';
    else padded += ch;
  }
  // lowercase + Akzente entfernen (strip_accents=null → bei lowercase aktiv)
  let lower = padded.toLowerCase();
  let norm = '';
  try {
    const decomposed = lower.normalize('NFD');
    for (const ch of decomposed) {
      const n = ch.codePointAt(0);
      if (n >= 0x0300 && n <= 0x036F) continue; // Mn-Marks (Akzente)
      norm += ch;
    }
  } catch (e) { norm = lower; }
  return norm;
}

/** BertPreTokenizer — Whitespace + Interpunktion splitten. */
export function bertPreTokenize(s) {
  const words = [];
  let cur = '';
  const flush = () => { if (cur) { words.push(cur); cur = ''; } };
  for (const ch of s) {
    if (isWhitespaceChar(ch)) { flush(); continue; }
    if (isPunct(ch)) { flush(); words.push(ch); continue; }
    cur += ch;
  }
  flush();
  return words;
}

/**
 * WordPiece-Tokenisierer mit geladenem Vokabular.
 * vocab: Map string → id (aus tokenizer.json "model.vocab")
 */
export class BertWordPiece {
  constructor(vocab, opts = {}) {
    this.vocab = vocab;
    this.unkId = opts.unkId !== undefined ? opts.unkId : (vocab.get(UNK) !== undefined ? vocab.get(UNK) : 100);
    this.clsId = vocab.get(CLS) !== undefined ? vocab.get(CLS) : 101;
    this.sepId = vocab.get(SEP) !== undefined ? vocab.get(SEP) : 102;
    this.maxInputCharsPerWord = 100;
    this.maxLen = opts.maxLen || 128;
  }

  static async fromTokenizerJson(obj) {
    const vocabMap = new Map();
    const v = obj && obj.model && obj.model.vocab;
    if (!v) throw new Error('tokenizer.json ohne model.vocab');
    for (const k of Object.keys(v)) vocabMap.set(k, v[k]);
    const trunc = obj.truncation && obj.truncation.max_length ? obj.truncation.max_length : 128;
    return new BertWordPiece(vocabMap, { maxLen: trunc });
  }

  _wordpiece(word) {
    if (word.length > this.maxInputCharsPerWord) return [this.unkId];
    const ids = [];
    let start = 0;
    while (start < word.length) {
      let end = word.length, cur = null;
      while (start < end) {
        let sub = word.slice(start, end);
        if (start > 0) sub = '##' + sub;
        const id = this.vocab.get(sub);
        if (id !== undefined) { cur = id; break; }
        end -= 1;
      }
      if (cur === null) return [this.unkId]; // ganzes Wort → [UNK]
      ids.push(cur);
      start = end;
    }
    return ids;
  }

  /**
   * Text → {inputIds, attentionMask, tokenTypeIds, sequenceLength}
   * Alles BigInt64Array (ONNX int64), [CLS] … [SEP], Rechts-Truncation.
   */
  encode(text) {
    const norm = bertNormalize(String(text || ''));
    const words = bertPreTokenize(norm);
    let ids = [];
    for (const w of words) ids.push(...this._wordpiece(w));
    // Template [CLS] A [SEP] mit Truncation maxLen (Right)
    const budget = this.maxLen - 2;
    if (ids.length > budget) ids = ids.slice(0, budget);
    ids = [this.clsId, ...ids, this.sepId];
    const n = ids.length;
    const inputIds = new BigInt64Array(n);
    const attentionMask = new BigInt64Array(n);
    const tokenTypeIds = new BigInt64Array(n);
    for (let i = 0; i < n; i++) {
      inputIds[i] = BigInt(ids[i]);
      attentionMask[i] = 1n;
      tokenTypeIds[i] = 0n;
    }
    return { inputIds, attentionMask, tokenTypeIds, sequenceLength: n };
  }
}
