// Manager page changes (Clay 2026-10-24) -> every device, at the daily sync.
//   node tools/admin.js apply <form-responses.json>
// <form-responses.json> = the print log's "Form Responses 1" tab as rows (Sheets get_values result, or its "values").
// Each "admin" row carries "admin {op JSON}" in Source (ops: label / remove / user / pin, see MANAGER EDITS in index.html).
// New ops (by their "t") are added to SITE.ops in index.html, so every device replays them; SITE.users is rebuilt from the
// log (one row per device: last name used, last date), and SITE.customs lists every custom label printed so the Manager can
// turn one into a shared label (owner 2026-10-28: name, times printed, last date + who, shelf life used). Batch yields changed by label ops are copied into the Recipe Book's
// BATCH_YIELDS (artifacts/recipe-book.html) so both stay equal. APP_VERSION is bumped when anything changed.
// Prints JSON: {ops: [...human summaries], doc: [...label changes the Google Doc prep list needs], book: [...], usersChanged, customsChanged,
// warn: [...things to raise with the owner: shelf life past the 7-day Food Code limit, a PIN change, changes from a device
// that isn't the owner's]}. Devices read new ops from the feed within minutes anyway; this writes them into the code.
// After a change: sync.js build, npm test, publish both artifacts, sync.js mark, commit, push (CLAUDE.md rule 12).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BOOK = path.join(ROOT, 'artifacts', 'recipe-book.html');
const APP = path.join(ROOT, 'index.html');
const q = s => JSON.stringify(s);
const OWNER_DEVICES = ['2627971f'];                      // Clay's phone; anything else making changes gets flagged
const LONG_OK = ['freezer', 'rubs'];                       // frozen items and dry rubs aren't held to the 7-day limit
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function readSite(app) {
  const m = /^const SITE = (.*);$/m.exec(app);
  if (!m) throw new Error('index.html: missing "const SITE = {...};" line');
  return JSON.parse(m[1]);
}
function writeSite(app, site) { return app.replace(/^const SITE = .*;$/m, () => 'const SITE = ' + JSON.stringify(site) + ';'); }

// the Recipe Book's batch yield for an item, as the app shows it ("≈ " + v when est), or null
function bookYield(book, id) {
  const m = new RegExp('^  ' + reEsc(q(id)) + ': \\{ v: ("(?:[^"\\\\]|\\\\.)*")(, est: true)?', 'm').exec(book);
  return m ? (m[2] ? '≈ ' : '') + JSON.parse(m[1]) : null;
}
function setBookYield(book, id, shown) {
  const start = book.indexOf('const BATCH_YIELDS = {'), end = book.indexOf('\n};', start);
  if (start < 0 || end < 0) throw new Error('recipe-book.html: missing BATCH_YIELDS');
  let block = book.slice(start, end);
  const line = new RegExp('^  ' + reEsc(q(id)) + ': \\{.*$\\n?', 'm');
  if (!shown) {                                            // yield cleared: drop the entry
    block = block.replace(line, '').replace(/,\s*$/, '');
    return book.slice(0, start) + block + book.slice(end);
  }
  const est = /^≈\s*/.test(shown), v = shown.replace(/^≈\s*/, '');
  const head = new RegExp('^(  ' + reEsc(q(id)) + ': \\{ )v: "(?:[^"\\\\]|\\\\.)*"(, est: true)?', 'm');
  if (head.test(block)) block = block.replace(head, (_, a) => a + 'v: ' + q(v) + (est ? ', est: true' : ''));
  else block = block.replace(/\s*$/, '') + ',\n  ' + q(id) + ': { v: ' + q(v) + (est ? ', est: true' : '') + ' }';
  return book.slice(0, start) + block + book.slice(end);
}
function bumpVersion(app, now = new Date()) {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return app.replace(/const APP_VERSION = "([^"]+)"/, (_, cur) => {
    const m = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(cur);
    return 'const APP_VERSION = ' + q(today + '.' + (m && m[1] === today ? +m[2] + 1 : 1));
  });
}

function apply(rows, files = { BOOK, APP }) {
  const head = rows[0].map(h => String(h).trim().toLowerCase()), col = re => head.findIndex(h => re.test(h));
  const c = { event: col(/^event$/), date: col(/^date$/), by: col(/^printed\s*by$/), item: col(/^item/), source: col(/^source$/), device: col(/^device$/),
    labels: col(/^#\s*labels$/), prep: col(/^prep\s*date$/), useBy: col(/^use[-\s]*by/) };
  let app = fs.readFileSync(files.APP, 'utf8'), book = fs.readFileSync(files.BOOK, 'utf8');
  const site = readSite(app), seen = new Set(site.ops.map(o => o.t)), out = { ops: [], doc: [], book: [], usersChanged: false, customsChanged: false, warn: [] };
  // users: one per device, the last name it used
  const users = new Map();
  rows.slice(1).forEach(r => {
    const dev = String(r[c.device] || '').trim(), name = String(r[c.by] || '').trim();
    if (!/^[0-9a-z-]{4,12}$/i.test(dev) || !name || name === '(no name)') return;
    users.set(dev, { device: dev, name, last: String(r[c.date] || '').trim() });
  });
  const list = [...users.values()].sort((a, b) => a.name.localeCompare(b.name) || a.device.localeCompare(b.device));
  if (JSON.stringify(list) !== JSON.stringify(site.users || [])) { site.users = list; out.usersChanged = true; }
  // custom labels (food with dates; text-only labels aren't food): one per name, the latest print's spelling and shelf life
  const day = s => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s || '')); return m ? Date.UTC(+m[3], m[1] - 1, +m[2]) : null; };
  const customs = new Map();
  rows.slice(1).forEach(r => {
    if (r[c.event] !== 'print' || !/^custom(?! text)/i.test(String(r[c.source] || '').trim())) return;
    const name = String(r[c.item] || '').replace(/\s+/g, ' ').trim(), k = name.toLowerCase(); if (!name) return;
    const a = day(r[c.prep]), b = day(r[c.useBy]), days = a != null && b != null && b >= a ? Math.round((b - a) / 864e5) + 1 : 0;
    const prev = customs.get(k) || { n: 0 };
    customs.set(k, { name, n: prev.n + 1, last: String(r[c.date] || '').trim(), by: String(r[c.by] || '').trim(), days: days || prev.days || 0 });
  });
  const clist = [...customs.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  if (JSON.stringify(clist) !== JSON.stringify(site.customs || [])) { site.customs = clist; out.customsChanged = true; }
  // ops
  rows.slice(1).forEach(r => {
    if (r[c.event] !== 'admin') return;
    const m = /^admin (\{.*\})$/.exec(String(r[c.source] || '').trim()); if (!m) return;
    let op; try { op = JSON.parse(m[1]); } catch (e) { return; }
    if (!op || !op.t || seen.has(op.t) || !['label', 'remove', 'user', 'pin'].includes(op.op)) return;
    seen.add(op.t); site.ops.push(op);
    const who = String(r[c.by] || '').trim(), dev = String(r[c.device] || '').trim();
    if (!OWNER_DEVICES.includes(dev)) out.warn.push(`${op.op} change by ${who || 'no name'} from device ${dev || 'unknown'} (not the owner's phone): confirm with the owner`);
    if (op.op === 'label' && +op.days > 7 && !LONG_OK.includes(op.cat)) out.warn.push(`${op.name}: ${op.days} days. Cold-held ready-to-eat food is limited to 7 days (FDA Food Code 3-501.17, Florida) unless exempt: confirm`);
    if (op.op === 'pin') out.warn.push('The Manager PIN was changed: confirm the owner did it');
    if (op.op === 'label') {
      out.ops.push(`${who}: ${op.name} (${op.cat}, ${op.days} days${op.pan ? ', ' + op.pan + (op.oz ? ' ' + op.oz + ' oz' : '') + (op.par ? ' par ' + op.par : '') : ''}${op.yield ? ', batch ' + op.yield : ''}${op.flip ? ', Line Flip' : ''})`);
      out.doc.push(`${op.name}: ${op.days} days (${op.cat})${op.flip ? ', in Line Flip' : ''}`);
      const cur = bookYield(book, op.id);
      if ((op.yield || null) !== cur && (op.yield || cur)) { book = setBookYield(book, op.id, op.yield || ''); out.book.push(`${op.name}: batch yield ${op.yield || 'cleared'}`); }
    } else if (op.op === 'remove') { out.ops.push(`${who}: removed label ${op.id}`); out.doc.push(`remove ${op.id}`); }
    else if (op.op === 'user') out.ops.push(`${who}: access ${op.deny ? 'off' : 'on'} for ${op.name || ''} (device ${op.device})`);
    else out.ops.push(`${who}: changed the Manager PIN`);
  });
  if (out.ops.length || out.usersChanged || out.customsChanged) {
    app = bumpVersion(writeSite(app, site));
    fs.writeFileSync(files.APP, app);
    if (out.book.length) fs.writeFileSync(files.BOOK, book);
  }
  return out;
}

module.exports = { apply, readSite, writeSite, bookYield, setBookYield, bumpVersion };

if (require.main === module) {
  const [cmd, file] = process.argv.slice(2);
  if (cmd !== 'apply' || !file) { console.error('usage: node tools/admin.js apply <form-responses.json>'); process.exit(2); }
  let rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(rows)) rows = rows.values || (rows.content && rows.content.values) || [];
  console.log(JSON.stringify(apply(rows), null, 1));
}
