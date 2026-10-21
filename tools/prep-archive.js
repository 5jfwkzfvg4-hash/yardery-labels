// Daily Prep List archive: one day's list as it stood at close, from the print log.
//   node tools/prep-archive.js <form-responses.json> <M/D/YYYY>  > archive.html
// <form-responses.json> = the "Form Responses 1" tab as rows (the Sheets get_values result, or just its "values" array).
// Uses the same items, sections and rules as the Prep List screen in index.html: the day's list is the items picked that
// day ("prep pick" rows: item + section), items people added stay pickable, an item is done when its first label printed
// that day (who + time), Line Flip rows by name.
const fs = require('fs');
const path = require('path');

// pull the item data out of index.html, so the archive always matches the app
function appData(indexHtml) {
  // the literal from `start` up to and including the first `keep` characters of `end`
  const grab = (start, end, keep) => {
    const a = indexHtml.indexOf(start); if (a < 0) throw new Error('index.html: missing ' + start);
    return indexHtml.slice(a + start.length, indexHtml.indexOf(end, a) + keep);
  };
  const CATS = eval('(' + grab('const CATS = ', '];', 1) + ')');
  const ITEMS = eval('(' + grab('const ITEMS = ', '].map(', 1) + ')').map(([id, name, cat]) => ({ id, name, cat }));
  const SHELF_DAYS = eval('(' + grab('const SHELF_DAYS = ', '};', 1) + ')');
  const BATCH = eval('(' + grab('const BATCH = ', '] };', 3) + ')');
  return { CATS, ITEMS, SHELF_DAYS, BATCH };
}
const key = n => String(n || '').trim().toLowerCase();

function sections(d) {
  const secs = [{ name: d.BATCH.name, line: true, rows: d.BATCH.items.map(n => ({ key: key(n), name: n, days: d.BATCH.days })) }];
  d.CATS.forEach(c => {
    if (c.id === 'line') return;
    const list = d.ITEMS.filter(i => i.cat === c.id && d.SHELF_DAYS[i.id]);
    if (c.id !== 'freezer') list.sort((a, b) => a.name.localeCompare(b.name));
    if (list.length) secs.push({ name: c.name, rows: list.map(i => ({ key: key(i.name), name: i.name, days: d.SHELF_DAYS[i.id] })) });
  });
  return secs;
}

const mins = t => { const m = /(\d+):(\d+)\s*([AP])/i.exec(t || ''); return m ? (+m[1] % 12 + (/p/i.test(m[3]) ? 12 : 0)) * 60 + +m[2] : 1e9; };
const toDate = s => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s || ''); return m ? new Date(+m[3], m[1] - 1, +m[2]) : null; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function build(rows, day, indexHtml) {
  const head = rows[0].map(h => String(h).trim().toLowerCase()), col = re => head.findIndex(h => re.test(h));
  const c = { event: col(/^event$/), date: col(/^date$/), time: col(/^time$/), by: col(/^printed\s*by$/), item: col(/^item/), labels: col(/^#\s*labels$/), source: col(/^source$/) };
  const ev = rows.slice(1).map(r => ({ event: r[c.event], date: r[c.date], time: r[c.time], by: r[c.by], item: r[c.item], labels: r[c.labels], source: r[c.source] }));
  const dayD = toDate(day), secs = sections(appData(indexHtml)), seen = new Set(secs.flatMap(s => s.rows.map(r => r.key)));
  // items added on or before this day
  ev.filter(e => e.event === 'prep add' && toDate(e.date) && toDate(e.date) <= dayD).forEach(e => {
    const k = key(e.item); if (!k || seen.has(k)) return; seen.add(k);
    let s = secs.find(x => x.name === e.source && !x.line);
    if (!s) { s = secs.find(x => x.name === 'Added items'); if (!s) { s = { name: 'Added items', rows: [] }; secs.push(s); } }
    s.rows.push({ key: k, name: e.item, days: parseInt(e.labels, 10) || 3, added: e.by || '' });
  });
  // that day's list: only the rows picked that day, in the screen's sections and order
  const picks = new Set(ev.filter(e => e.event === 'prep pick' && e.date === day).map(e => e.source + '|' + key(e.item)));
  const list = secs.map(s => Object.assign({}, s, { rows: s.rows.filter(r => picks.has(s.name + '|' + r.key)) })).filter(s => s.rows.length);
  const done = {}, count = {};
  ev.filter(e => e.event === 'print' && e.date === day).forEach(e => {
    const k = key(e.item);
    count[k] = (count[k] || 0) + (parseInt(e.labels, 10) || 1);
    if (!done[k] || mins(e.time) < mins(done[k].time)) done[k] = { by: e.by, time: e.time };
  });
  const n = list.reduce((t, s) => t + s.rows.length, 0), k = list.reduce((t, s) => t + s.rows.filter(r => done[r.key]).length, 0);
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayD.getDay()];
  const title = `Prep List — ${dow} ${day}`;
  return `<html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body style="font-family:Arial">` +
    `<h1>${esc(title)}</h1><p>` + (n ? `<b>${k} of ${n} done.</b> An item is done when its label prints; the first print of the day is shown.` : '<b>No items were picked for this day.</b>') + '</p>' +
    list.map(s => `<h2>${esc(s.name)}</h2><table border="1" cellpadding="4" style="border-collapse:collapse;width:100%">` +
      `<tr><th bgcolor="#2F5233" style="color:#ffffff">Item</th><th bgcolor="#2F5233" style="color:#ffffff">Done by</th><th bgcolor="#2F5233" style="color:#ffffff">Time</th><th bgcolor="#2F5233" style="color:#ffffff">Labels</th></tr>` +
      s.rows.map(r => { const v = done[r.key];
        return `<tr><td>${esc(r.name)}${r.added != null ? ' (added' + (r.added ? ' by ' + esc(r.added) : '') + ')' : ''}</td>` +
          (v ? `<td>✓ ${esc(v.by)}</td><td>${esc(v.time)}</td><td>${count[r.key]}</td>` : '<td>Not done</td><td> </td><td> </td>') + '</tr>'; }).join('') +
      '</table>').join('') + '</body></html>';
}

module.exports = { build, sections, appData };

if (require.main === module) {
  const [file, day] = process.argv.slice(2);
  if (!file || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(day || '')) { console.error('usage: node tools/prep-archive.js <form-responses.json> <M/D/YYYY>'); process.exit(2); }
  let rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(rows)) rows = rows.values || (rows.content && rows.content.values) || [];
  process.stdout.write(build(rows, day, fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')));
}
