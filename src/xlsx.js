'use strict';
/**
 * Kleine .xlsx-lezer (een .xlsx is een zip met XML-bestanden). Leest alle bladen als rijen met
 * celwaarden: tekst, getallen, true/false en datums (als "YYYY-MM-DD"). Geen formules uitrekenen:
 * Excel bewaart de laatst berekende waarde, die wordt gebruikt.
 */
const { unzipSync, strFromU8 } = require('fflate');

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e.toLowerCase()] ?? m;
  });
}
const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? decode(m[1]) : null;
};
/** Alle tekst binnen <t>-elementen (ook rich text met meerdere <r><t>). */
function textOf(xml) {
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m;
  while ((m = re.exec(xml))) out += m[1] ? decode(m[1]) : '';
  return out;
}
function colIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
/** Excel-serieel datumgetal -> "YYYY-MM-DD" (systeem 1900). */
function excelDate(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Welke stijlen (cellXfs-index) een datumnotatie hebben. */
function dateStyles(stylesXml) {
  const custom = {};
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*>/g)) {
    custom[attr(m[0], 'numFmtId')] = attr(m[0], 'formatCode') || '';
  }
  const isDateFmt = (id) => {
    const n = Number(id);
    if ((n >= 14 && n <= 22) || (n >= 45 && n <= 47)) return true;
    const code = (custom[id] || '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    return /[dmyhs]/i.test(code) && !/^[#0.,%\s]*$/.test(code);
  };
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  const out = [];
  if (xfs) for (const m of xfs[1].matchAll(/<xf\b[^>]*\/?>/g)) out.push(isDateFmt(attr(m[0], 'numFmtId')));
  return out;
}

/**
 * Lees een .xlsx-buffer. Geeft [{ name, rows: [[waarde, ...], ...] }] terug (rij 0 = eerste rij van het blad).
 */
function readXlsx(buffer) {
  let files;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new Error('Dit is geen geldig Excel-bestand (.xlsx).');
  }
  const get = (p) => (files[p] ? strFromU8(files[p]) : null);
  const workbook = get('xl/workbook.xml');
  if (!workbook) throw new Error('Dit is geen geldig Excel-bestand (.xlsx).');

  const shared = [];
  const sst = get('xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));
  const dateStyle = dateStyles(get('xl/styles.xml') || '');

  const rels = {};
  for (const m of (get('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b[^>]*>/g)) {
    rels[attr(m[0], 'Id')] = attr(m[0], 'Target');
  }
  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name');
    const rid = attr(m[0], 'r:id');
    let target = rels[rid] || '';
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const xml = get(target);
    if (!xml) continue;
    const rows = [];
    for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const r = Number(attr(rm[1], 'r')) - 1;
      const row = [];
      for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(cm[1], 'r');
        const type = attr(cm[1], 't');
        const style = Number(attr(cm[1], 's') || 0);
        const inner = cm[2] || '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        let val = null;
        if (type === 's') val = v ? shared[Number(v[1])] ?? '' : '';
        else if (type === 'inlineStr') val = textOf(inner);
        else if (type === 'b') val = v ? v[1] === '1' : null;
        else if (type === 'str' || type === 'e') val = v ? decode(v[1]) : '';
        else if (v) {
          const n = Number(v[1]);
          val = dateStyle[style] && n > 0 ? excelDate(n) : n;
        }
        if (val === '' ) val = null;
        const c = ref ? colIndex(ref) : row.length;
        row[c] = val;
      }
      rows[Number.isInteger(r) && r >= 0 ? r : rows.length] = row;
    }
    // lege gaten opvullen
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    sheets.push({ name, rows });
  }
  return sheets;
}

/** CSV (puntkomma of komma) als één blad. */
function readCsv(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return [{ name: 'CSV', rows: rows.map((r) => r.map((c) => (c.trim() === '' ? null : c.trim()))) }];
}

module.exports = { readXlsx, readCsv };
