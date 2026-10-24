// Pan standard and yield changes from the app's Pans & yields screen (Clay 2026-10-23/24) -> the code.
//   node tools/yields.js apply <form-responses.json>
// <form-responses.json> = the print log's "Form Responses 1" tab as rows (Sheets get_values result, or its "values").
// A "pan set" row carries "pan <item id> = <pan> | <oz per pan> | <par pans> | <batch yield>" in Source (an older
// "yield set" row: "yield <item id> = <batch yield>"). A change by someone in YIELD_APPROVERS (index.html) is written into
// STORAGE (index.html), the yield into BATCH_YIELDS (artifacts/recipe-book.html, the Recipe Book) and YIELDS (index.html),
// and APP_VERSION is bumped; anyone else's change is listed for the owner to approve. Rows already handled
// are kept in artifacts/yields-applied.json, so each change is applied or reported once.
// Prints JSON: {applied: [...], suggested: [...]}. After an apply: sync.js build, npm test, publish both artifacts,
// sync.js mark, commit, push (CLAUDE.md rule 11).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BOOK = path.join(ROOT, 'artifacts', 'recipe-book.html');
const APP = path.join(ROOT, 'index.html');
const STATE = path.join(ROOT, 'artifacts', 'yields-applied.json');
const q = s => JSON.stringify(s);

function approvers(app) {
  const m = /const YIELD_APPROVERS = (\[[^\]]*\]);/.exec(app);
  if (!m) throw new Error('index.html: missing YIELD_APPROVERS');
  return JSON.parse(m[1]).map(a => a.toLowerCase());
}

// one Recipe Book entry: replace its value and drop "est" (it was measured), or add the entry
function setBook(book, id, v) {
  const start = book.indexOf('const BATCH_YIELDS = {'), end = book.indexOf('\n};', start);
  if (start < 0 || end < 0) throw new Error('recipe-book.html: missing BATCH_YIELDS');
  let block = book.slice(start, end);
  const line = new RegExp('^(  ' + q(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ': \\{ )v: "(?:[^"\\\\]|\\\\.)*"(, est: true)?', 'm');
  if (line.test(block)) block = block.replace(line, (_, a) => a + 'v: ' + q(v));
  else block = block.replace(/\s*$/, '') + ',\n  ' + q(id) + ': { v: ' + q(v) + ' }';
  return book.slice(0, start) + block + book.slice(end);
}
function setApp(app, id, v) {
  const start = app.indexOf('const YIELDS = {'), end = app.indexOf('\n};', start);
  if (start < 0 || end < 0) throw new Error('index.html: missing YIELDS');
  let block = app.slice(start, end);
  const pair = new RegExp(q(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ': "(?:[^"\\\\]|\\\\.)*"');
  if (pair.test(block)) block = block.replace(pair, q(id) + ': ' + q(v));
  else block = block.replace(/\s*$/, '') + ',\n  ' + q(id) + ': ' + q(v);
  return app.slice(0, start) + block + app.slice(end);
}
function setStorage(app, id, st) {
  const start = app.indexOf('const STORAGE = {'), end = app.indexOf('\n};', start);
  if (start < 0 || end < 0) throw new Error('index.html: missing STORAGE');
  let block = app.slice(start, end);
  const line = '  ' + q(id) + ': { pan: ' + q(st.pan) + ', oz: ' + (+st.oz || 0) + ', par: ' + (+st.par || 0) + ' }';
  const re = new RegExp('^  ' + q(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ': \\{.*\\},?$', 'm');
  const lines = block.split('\n').slice(1).filter(l => l.trim() && !re.test(l)).map(l => l.replace(/,\s*$/, ''));
  lines.push(line);
  return app.slice(0, start) + 'const STORAGE = {\n' + lines.join(',\n') + app.slice(end);
}
function bumpVersion(app, now = new Date()) {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return app.replace(/const APP_VERSION = "([^"]+)"/, (_, cur) => {
    const m = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(cur);
    return 'const APP_VERSION = ' + q(today + '.' + (m && m[1] === today ? +m[2] + 1 : 1)) + '';
  });
}

function apply(rows, files = { BOOK, APP, STATE }) {
  const head = rows[0].map(h => String(h).trim().toLowerCase()), col = re => head.findIndex(h => re.test(h));
  const c = { ts: col(/^timestamp$/), event: col(/^event$/), date: col(/^date$/), time: col(/^time$/), by: col(/^printed\s*by$/), item: col(/^item/), source: col(/^source$/) };
  const done = new Set(fs.existsSync(files.STATE) ? JSON.parse(fs.readFileSync(files.STATE, 'utf8')).seen : []);
  let book = fs.readFileSync(files.BOOK, 'utf8'), app = fs.readFileSync(files.APP, 'utf8');
  const ok = approvers(app), applied = [], suggested = [];
  rows.slice(1).forEach(r => {
    if (r[c.event] !== 'yield set' && r[c.event] !== 'pan set') return;
    const m = /^(yield|pan) (\S+) = (.*)$/.exec(String(r[c.source] || '').trim()); if (!m) return;
    const key = [r[c.ts], r[c.date], r[c.time], r[c.by], m[2], m[3]].join('|');
    if (done.has(key)) return;
    done.add(key);
    const ch = { id: m[2], item: r[c.item], by: r[c.by], date: r[c.date], time: r[c.time] };
    if (m[1] === 'yield') ch.value = m[3].trim();
    else { const f = m[3].split('|').map(x => x.trim()); Object.assign(ch, { pan: f[0], oz: +f[1] || 0, par: +f[2] || 0, value: f.slice(3).join('|').trim() }); }
    if (!ok.includes(String(r[c.by] || '').trim().toLowerCase())) { suggested.push(ch); return; }
    if (ch.pan) app = setStorage(app, ch.id, ch);
    if (ch.value) { book = setBook(book, ch.id, ch.value); app = setApp(app, ch.id, ch.value); }
    applied.push(ch);
  });
  if (applied.length) { fs.writeFileSync(files.BOOK, book); fs.writeFileSync(files.APP, bumpVersion(app)); }
  fs.writeFileSync(files.STATE, JSON.stringify({ seen: [...done] }, null, 1) + '\n');
  return { applied, suggested };
}

module.exports = { apply, setBook, setApp, setStorage, bumpVersion };

if (require.main === module) {
  const [cmd, file] = process.argv.slice(2);
  if (cmd !== 'apply' || !file) { console.error('usage: node tools/yields.js apply <form-responses.json>'); process.exit(2); }
  let rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(rows)) rows = rows.values || (rows.content && rows.content.values) || [];
  console.log(JSON.stringify(apply(rows), null, 1));
}
