// Yardery Prep Labels — automatic checks. Run: npm test
// Starts the site locally, simulates the Zebra ZD411 and different devices, and checks every connect
// and print path. Exits non-zero if anything fails, so GitHub marks the run red and emails the owner.
// Set CHROMIUM_PATH to use a specific Chromium build instead of Playwright's own.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const mockPrinter = require('./mock-printer');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const IPAD_SAFARI = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

let browser, BASE;
async function open(opts = {}, { width = 1024, height = 760, clock = false, ua, path: p = '/' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, userAgent: ua });
  await ctx.addInitScript(mockPrinter(opts));
  // never post to the owner's real Google Form from a test; log tests add their own route on top
  await ctx.route('**/formResponse', r => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (clock) await page.clock.install();
  await page.goto(BASE + p);
  await page.waitForTimeout(300);
  page.errors = errors;
  page.close2 = () => ctx.close();
  return page;
}
const chip = p => p.textContent('#pchipTxt');
const btLog = p => p.evaluate(() => window.__bt.log.join(','));
const zpl = p => p.evaluate(() => window.__bt.zpl);
const formats = z => z.split('^XZ').filter(f => f.includes('^XA'));
const toastText = async p => (await p.isVisible('#toast')) ? p.textContent('#toast') : '';
async function pickItem(p, name) { await p.locator('.item .n').filter({ hasText: new RegExp('^' + name + '$') }).first().click(); await p.waitForTimeout(150); }
async function printAndWait(p, re = /Printed/, batches) {
  await p.click('#printBtn');
  await p.waitForTimeout(150);
  if (await p.isVisible('#bcSheet')) {                 // items with a Recipe Book yield ask how many batches
    for (let i = 1; i < (batches || 1); i++) await p.click('#bcPlus');
    await p.click('#bcOk');
  }
  await p.waitForFunction(r => new RegExp(r).test(document.getElementById('status').textContent), re.source, { timeout: 40000 });
}
async function openBook(p) { await p.click('#rbBtn'); await p.waitForTimeout(1200); return p.frames().find(f => /recipes\.html/.test(f.url())); }
const REMEMBERED = { name: 'Maria', setup: true };

/* ================= Connect printer: the button must always work ================= */

test('Connect: remembered printer unreachable, tap after background attempt fails -> list opens, connects', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true, remembered: 'hang' }, { clock: true });
  await p.clock.fastForward(9000); await p.waitForTimeout(200);
  eq(await chip(p), 'Connect printer', 'chip after failed background attempt');
  await p.click('#pchip'); await p.waitForTimeout(500);
  assert((await btLog(p)).includes('picker'), 'printer list should open');
  eq(await chip(p), 'Printer: DFJ235305204', 'chip after connect');
  assert(/connected/i.test(await toastText(p)), 'success message should show');
  await p.close2();
});

test('Connect: tap DURING a background attempt -> list opens immediately (the original bug)', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true, remembered: 'hang' }, { width: 390, height: 844 });
  eq(await chip(p), 'Connecting…', 'background attempt should be running');
  await p.click('#pchip'); await p.waitForTimeout(500);
  assert((await btLog(p)).includes('picker'), 'printer list should open right away');
  eq(await chip(p), 'Printer: DFJ235305204', 'chip after connect');
  await p.close2();
});

test('Connect: browser that cannot remember printers -> list opens, connects', async () => {
  const p = await open({ ...REMEMBERED, getDevices: false }, { width: 390, height: 844 });
  eq(await btLog(p), '', 'nothing should happen on open');
  await p.click('#pchip'); await p.waitForTimeout(500);
  eq(await btLog(p), 'picker,connect:picked', 'list then connect');
  assert(/connected/i.test(await toastText(p)), 'success message should show on a phone');
  await p.close2();
});

test('Connect: every tap gives visible feedback, even while a user connect is running', async () => {
  const p = await open({ ...REMEMBERED, getDevices: false, picked: 'hang' });
  await p.click('#pchip'); await p.waitForTimeout(300);
  await p.click('#pchip'); await p.waitForTimeout(300);
  assert(/still connecting/i.test(await toastText(p)), 'second tap must say it is still connecting');
  await p.close2();
});

test('Connect: printer never answers -> error shown, next tap starts fresh (not stuck)', async () => {
  const p = await open({ ...REMEMBERED, getDevices: false, picked: 'hang' }, { clock: true });
  await p.click('#pchip'); await p.waitForTimeout(200);
  await p.clock.fastForward(21000); await p.waitForTimeout(300);
  assert(/never answered|connected to someone else/i.test(await toastText(p)), 'timeout reason should show');
  assert(!/Connecting/.test(await chip(p)), 'chip must not stay on Connecting…');
  const picks = (await btLog(p)).split('picker').length;
  await p.click('#pchip'); await p.waitForTimeout(300);
  assert((await btLog(p)).split('picker').length > picks, 'second tap must open the list again');
  await p.close2();
});

test('Connect: person closes the list -> explained, next try shows all devices', async () => {
  const p = await open({ ...REMEMBERED, getDevices: false, cancelFirstPick: true });
  await p.click('#pchip'); await p.waitForTimeout(400);
  assert(/No printer picked/.test(await toastText(p)), 'cancel should be explained');
  await p.click('#pchip'); await p.waitForTimeout(400);
  const reqs = await p.evaluate(() => window.__bt.reqs);
  assert(reqs[0].filters && reqs[0].filters[0].name === 'DFJ235305204', 'first list shows only DFJ235305204');
  assert(reqs[1].acceptAllDevices === true, 'second list shows every device');
  eq(await chip(p), 'Printer: DFJ235305204', 'connected on second try');
  await p.close2();
});

test('Connect: remembered + reachable -> connects by itself on open, no list', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  eq(await chip(p), 'Printer: DFJ235305204', 'auto-connected');
  eq(await btLog(p), 'connect:remembered', 'no list shown');
  await p.close2();
});

test('Connect: Print without tapping Connect, remembered printer unreachable -> still prints', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true, remembered: 'hang' });
  await pickItem(p, 'Pico de Gallo');
  await printAndWait(p);
  eq(formats(await zpl(p)).length, 1, 'one label printed');
  await p.close2();
});

test('Connect: no Bluetooth (iPad Safari) -> Connect opens help, never hangs', async () => {
  const p = await open({ ...REMEMBERED, bluetooth: false }, { ua: IPAD_SAFARI });
  await p.click('#pchip'); await p.waitForTimeout(300);
  assert(await p.isVisible('#helpSheet'), 'help should open');
  assert(/Bluefy/.test(await p.textContent('#helpSheet')), 'help should point to Bluefy');
  await p.close2();
});

/* ================= Sharing the printer ================= */

test('Hand-off: app to background releases printer; back on screen reconnects', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  eq(await chip(p), 'Connect printer', 'released');
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(300);
  eq(await chip(p), 'Printer: DFJ235305204', 'reconnected');
  await p.close2();
});

test('Hand-off: 3 idle minutes releases; a tap takes it back; Disconnect stays off until Connect', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true }, { clock: true });
  await p.waitForTimeout(300);
  await p.clock.fastForward(4 * 60 * 1000); await p.waitForTimeout(200);
  eq(await chip(p), 'Printer free · tap to use', 'released after idle');
  await p.mouse.click(300, 500); await p.waitForTimeout(300);
  eq(await chip(p), 'Printer: DFJ235305204', 'tap takes it back');
  await p.click('#setBtn'); await p.click('#discBtn'); await p.keyboard.press('Escape');
  await p.mouse.click(300, 500); await p.waitForTimeout(300);
  eq(await chip(p), 'Connect printer', 'Disconnect stays off on ordinary taps');
  await p.close2();
});

/* ================= Labels: content, dates, feed ================= */

test('Labels: every item has an approved shelf life and its name fits in 2 lines', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  const bad = await p.evaluate(() => {
    const { ITEMS, SHELF_DAYS, BATCH, zplLines } = window.__ypl, out = [];
    for (const it of ITEMS) if (!SHELF_DAYS[it.id]) out.push('no shelf life: ' + it.name);
    for (const n of ITEMS.map(i => i.name).concat(BATCH.items)) {
      const t = n.toUpperCase(); let s = t.length > 22 ? 22 : 26;
      while (s > 16 && zplLines(t, s, 191) > 2) s -= 2;
      if (zplLines(t, s, 191) > 2) out.push('too long: ' + n);
    }
    return out;
  });
  eq(bad.length, 0, 'problems: ' + bad.join('; '));
  await p.close2();
});

test('Labels: no Diced Cucumbers label (owner, 2026-10-17: we only slice cucumbers)', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  assert(!(await p.evaluate(() => window.__ypl.ITEMS.some(i => /diced cucumber/i.test(i.name) || window.__ypl.SHELF_DAYS['diced-cucumbers']))), 'label app');
  const f = await openBook(p);
  assert(!(await f.evaluate(() => PREP_LABEL_IDS.has('diced-cucumbers'))), 'Recipe Book label button');
  await p.close2();
});

test('Labels: Brussels Sprouts button in Sides with a 7-day shelf life (owner, 2026-10-17)', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  const r = await p.evaluate(() => { const it = window.__ypl.ITEMS.find(i => i.id === 'brussels-sprouts'); return it && [it.name, it.cat, window.__ypl.SHELF_DAYS[it.id]]; });
  eq(JSON.stringify(r), JSON.stringify(['Brussels Sprouts', 'sides', 7]), 'Brussels Sprouts item');
  await p.close2();
});

test('Labels: every Line Flip Labels item has its own button, with no repeats', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  const r = await p.evaluate(() => {
    const y = window.__ypl, key = n => n.toLowerCase().replace(/ de gallo$/, '');
    const names = y.ITEMS.map(i => key(i.name));
    return { missing: y.BATCH.items.filter(n => !names.includes(key(n))), dupes: names.filter((n, i) => names.indexOf(n) !== i),
      days: Object.fromEntries(y.ITEMS.filter(i => i.cat === 'line').map(i => [i.id, y.SHELF_DAYS[i.id]])) };
  });
  eq(r.missing.join(', '), '', 'Line Flip Labels items without a button');
  eq(r.dupes.join(', '), '', 'repeated buttons');
  // Food Code 3-501.17 (Florida): TCS items 7 days max; parmesan (hard cheese) exempt
  eq(JSON.stringify(r.days), JSON.stringify({ feta: 7, parmesan: 14, 'sliced-tomatoes': 3, american: 7, beef: 4, sausage: 4, pepperoni: 7,
    'sliced-mozzarella': 7, pineapple: 5, 'shredded-mozzarella': 7, 'mix-cheese-blend': 7 }), 'line item shelf lives');
  await p.close2();
});

test('Labels: quantity 3 prints 3 labels fed straight through (^XB on all but last, gap sync, 1x1)', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  await pickItem(p, 'Pico de Gallo'); await p.click('#qPlus'); await p.click('#qPlus');
  await printAndWait(p, /Printed 3/);
  const f = formats(await zpl(p));
  eq(f.length, 3, 'label count');
  eq(f.map(x => x.includes('^XB')).join(), 'true,true,false', '^XB placement');
  assert(f.every(x => /\^MNY/.test(x) && /\^PW203/.test(x) && /\^LL203/.test(x) && /\^PQ1,/.test(x)), 'gap sync, 1x1 size, one copy per format');
  assert(f.every(x => x.includes('^FDBY MARIA^FS')), 'name in capitals');
  await p.close2();
});

test('Labels: dates — prep day counts as day 1; frozen/thawing day it goes in does not count', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  const r = await p.evaluate(() => {
    const { useBy } = window.__ypl, d = new Date(2026, 9, 15, 10, 0), f = x => (x.getMonth() + 1) + '/' + x.getDate();
    return [f(useBy(d, 3)), f(useBy(d, 7)), f(useBy(d, 5, true)), f(useBy(d, 90, true))];
  });
  eq(r.join(' '), '10/17 10/21 10/20 1/13', 'use-by dates');
  await p.close2();
});

test('Labels: Line Flip Labels prints all 21 with the same 2-day date', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  await p.click('#batchBtn'); await printAndWait(p, /Printed all/);
  const f = formats(await zpl(p));
  eq(f.length, 21, 'label count');
  eq(new Set(f.map(x => (x.match(/\^FD(\d+\/\d+)\^FS/) || [])[1])).size, 1, 'one use-by date');
  await p.close2();
});

test('Labels: text-only custom label prints with no dates', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  await p.click('#customTop'); await p.click('#cText'); await p.fill('#customName', 'Gluten Free');
  await printAndWait(p);
  const z = await zpl(p);
  assert(z.includes('GLUTEN FREE') && !z.includes('USE BY'), 'text only');
  await p.close2();
});

/* ================= People and setup ================= */

test('Setup: new device asks first name, then printer; skipped printer step returns next time', async () => {
  const p = await open({ getDevices: false });
  assert(await p.isVisible('#onbName'), 'asks for name first');
  await p.fill('#onbNameIn', 'sam'); await p.click('#onbNameNext');
  assert(await p.isVisible('#onbPrinter'), 'then printer step');
  eq(await p.textContent('#onbPrinterName'), 'DFJ235305204', 'shows printer name');
  await p.click('#onbSkip');
  await p.reload(); await p.waitForTimeout(300);
  assert(await p.isVisible('#onbPrinter'), 'printer step again after skipping');
  await p.click('#onbConnect'); await p.waitForSelector('#onbDone:not([hidden])');
  eq(await p.textContent('#onbDoneBy'), 'SAM', 'name in capitals');
  await p.reload(); await p.waitForTimeout(300);
  assert(!(await p.isVisible('#onbSheet')), 'no setup once connected');
  await p.close2();
});

test('Names: typing a different name changes only that label, never the device owner', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  await pickItem(p, 'Pico de Gallo'); await p.fill('#initials', 'Sam');
  await printAndWait(p);
  assert((await zpl(p)).includes('^FDBY SAM^FS'), 'label uses typed name');
  eq(await p.evaluate(() => localStorage.getItem('ypl:name')), '"Maria"', 'device still remembers its owner');
  await p.close2();
});

/* ================= Recipe Book ================= */

test('Book: Print prep label prints the chosen quantity and stays on the recipe', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  const f = await openBook(p), fl = p.frameLocator('#rbFrame');
  await f.evaluate(() => goTo(recipePageIndex['pico-de-gallo'])); await p.waitForTimeout(300);
  await fl.locator('#batchToggle').click(); await fl.locator('[data-mult="2"]').click(); await p.waitForTimeout(200);
  await fl.locator('[data-lq="1"]').click();
  await fl.locator('a.labelbtn').click();
  await p.waitForSelector('#bcSheet:not([hidden])');
  eq(await p.textContent('#bcN'), '2', 'batch count starts at the book\'s Multiply Batch');
  eq(await p.textContent('#bcAmt'), '= 480 oz made', 'amount from the Recipe Book yield');
  await p.click('#bcOk');
  await f.waitForFunction(() => /Printed/.test(document.querySelector('a.labelbtn').textContent), null, { timeout: 30000 });
  eq(formats(await zpl(p)).length, 2, 'label count');
  eq(await f.evaluate(() => document.querySelector('.page h2').textContent), 'Pico de Gallo', 'still on the recipe');
  assert(await p.isVisible('#rb'), 'book still open');
  eq(await f.textContent('.lqty output'), '1', 'quantity back to 1');
  await p.close2();
});

test('Book: Data Needed is read-only outside Claude; book opened alone links to labels', async () => {
  const p = await open({}, { path: '/recipes.html' });
  await p.evaluate(() => goTo(dataNeededPageIndex)); await p.waitForTimeout(300);
  assert(/Read-only here/.test(await p.textContent('#dnStatus')), 'read-only note');
  await p.evaluate(() => goTo(recipePageIndex['brownies']));
  eq(await p.getAttribute('a.labelbtn', 'href'), 'index.html?item=brownies', 'link to label page');
  await p.close2();
});

/* ================= Prep List ================= */

test('Prep List: lists the Line Flip Labels and every labeled item; on-hand counts kept today; Prep = par − on hand', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  await p.click('#plBtn'); await p.waitForTimeout(200);
  const want = await p.evaluate(() => window.__ypl.BATCH.items.length + window.__ypl.ITEMS.filter(i => window.__ypl.SHELF_DAYS[i.id] && i.cat !== 'line').length);
  eq(await p.locator('#pl tr[data-k]').count(), want, 'rows');
  eq(await p.textContent('#pl tr[data-k="pico-de-gallo"] .need'), '—', 'no par yet');
  await p.fill('#pl tr[data-k="pico-de-gallo"] input', '0.5');
  await p.reload(); await p.waitForTimeout(300);
  await p.click('#plBtn'); await p.waitForTimeout(200);
  eq(await p.inputValue('#pl tr[data-k="pico-de-gallo"] input'), '0.5', 'count kept after reload');
  await p.evaluate(() => { window.__ypl.PARS['pico-de-gallo'] = [2, 'qt']; });
  await p.click('#plClose'); await p.click('#plBtn'); await p.waitForTimeout(200);
  eq(await p.textContent('#pl tr[data-k="pico-de-gallo"] .need'), '1.5 qt', 'prep amount');
  await p.fill('#pl tr[data-k="pico-de-gallo"] input', '3');
  eq(await p.textContent('#pl tr[data-k="pico-de-gallo"] .need'), '0 qt', 'over par needs nothing');
  await p.close2();
});

test('Prep List: Print on a row prints one label with the approved date and stays on the list', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true }, { width: 390, height: 844 });
  await p.click('#plBtn'); await p.waitForTimeout(200);
  await p.click('#pl tr[data-k="pico-de-gallo"] .plp');
  await p.waitForSelector('#bcSheet:not([hidden])'); await p.click('#bcOk');
  await p.waitForFunction(() => /Printed/.test(document.getElementById('toast').textContent), null, { timeout: 30000 });
  const z = formats(await zpl(p));
  eq(z.length, 1, 'one label');
  assert(/pico de gallo/i.test(z[0]), 'item name on label');
  const ub = await p.evaluate(() => { const y = window.__ypl, d = y.useBy(new Date(), y.SHELF_DAYS['pico-de-gallo']); return (d.getMonth() + 1) + '/' + d.getDate(); });
  assert(z[0].includes(ub), 'approved use-by date ' + ub);
  assert(await p.isVisible('#pl'), 'still on the prep list');
  assert(/done/.test(await p.getAttribute('#pl tr[data-k="pico-de-gallo"]', 'class')), 'row marked printed');
  assert(!(await p.evaluate(() => { const b = document.getElementById('plBody'); return b.scrollWidth > b.clientWidth; })), 'no sideways scroll on a phone');
  eq(p.errors.join(), '', 'no script errors');
  await p.close2();
});

/* ================= Batches & yields ================= */

test('Yields: the label app uses the Recipe Book\'s batch yields', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  const app = await p.evaluate(() => ({ Y: window.__ypl.YIELDS, ids: window.__ypl.ITEMS.map(i => i.id) }));
  const f = await openBook(p);
  const book = await f.evaluate(ids => Object.fromEntries(ids.filter(id => BATCH_YIELDS[id]).map(id => [id, (BATCH_YIELDS[id].est ? '≈ ' : '') + BATCH_YIELDS[id].v])), app.ids);
  eq(JSON.stringify(app.Y), JSON.stringify(book), 'YIELDS match BATCH_YIELDS');
  const am = await p.evaluate(() => { const a = window.__ypl.amountMade; return [a('pico-de-gallo', 2), a('blackened-fish', 2), a('smoked-ribs', 3), a('bama-white-bbq', 2), a('coleslaw', 2), a('fire-marinara', 3)].join(' | '); });
  eq(am, '480 oz | 36–42 pieces × 2 oz | 3 racks | ≈ 340 oz |  | ≈ 19.5 quarts', 'batches × yield');
  await p.close2();
});

test('Batches: Print asks how many batches; the log gets batches and amount made; Cancel prints nothing', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  const got = [];
  await p.context().route('**/formResponse', r => { got.push(Object.fromEntries(new URLSearchParams(r.request().postData()))); return r.fulfill({ status: 200, body: '' }); });
  await pickItem(p, 'Pico de Gallo');
  await p.click('#printBtn'); await p.waitForSelector('#bcSheet:not([hidden])');
  await p.click('#bcCancel'); await p.waitForTimeout(200);
  eq(formats(await zpl(p)).length, 0, 'cancel prints nothing');
  assert(/Not printed/.test(await p.textContent('#status')), 'cancel is explained');
  await printAndWait(p, /Printed/, 2);
  eq(formats(await zpl(p)).length, 1, 'one label');
  await p.waitForTimeout(300);
  // until the form has Batches / Amount Made questions, they ride along in Source
  eq(got.length && got[got.length - 1]['entry.1833039941'], 'labels page · 2 batches · 480 oz', 'source carries batches and amount');
  await p.evaluate(() => { const L = window.__ypl.LOG; L.formUrl = 'https://docs.google.com/forms/d/e/TEST/formResponse'; Object.keys(L.fields).forEach((k, i) => { L.fields[k] = 'entry.' + (i + 1); }); });
  await pickItem(p, 'Croutons'); await printAndWait(p, /Croutons/, 3); await p.waitForTimeout(300);
  const row = got[got.length - 1];
  eq([row['entry.5'], row['entry.9'], row['entry.11'], row['entry.12']].join(' | '), 'Croutons | labels page | 3 | 3 loaves', 'own columns once the form has them');
  await pickItem(p, 'Lettuce'); await p.click('#printBtn'); await p.waitForTimeout(200);
  assert(!(await p.isVisible('#bcSheet')), 'items with no yield are not asked');
  await p.close2();
});

/* ================= Sync with the Claude artifacts (tools/sync.js) ================= */

const sync = require('../tools/sync');
test('Sync: recipes.html is made from the Claude Recipe Book (edit artifacts/recipe-book.html, then node tools/sync.js build)', async () => {
  const book = fs.readFileSync(path.join(ROOT, 'artifacts/recipe-book.html'), 'utf8');
  assert(sync.unwrap(fs.readFileSync(path.join(ROOT, 'recipes.html'), 'utf8')) === sync.bookToCopy(book), 'recipes.html differs from the Recipe Book mirror + tools/book-patches.json');
});

test('Sync: label page and Recipe Book convert both ways without losing anything', async () => {
  const book = sync.unwrap(fs.readFileSync(path.join(ROOT, 'artifacts/recipe-book.html'), 'utf8'));
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert(sync.copyToBook(sync.bookToCopy(book)) === book, 'Recipe Book round trip');
  assert(sync.labelsFromPage(sync.labelsPage(index), index) === index, 'label page round trip');
  assert(/^<title>[^\n]+\n<meta name="claude:viewport-fit-sides"/.test(sync.labelsPage(index)), 'artifact page starts with title + viewport meta');
});

test('Sync: the Claude artifacts were published for this version (README > Keeping Claude and the staff link the same)', async () => {
  const o = sync.outputs(), pub = sync.published();
  const stale = ['book', 'labels', 'labelsRecipes'].filter(k => sync.hash(o[k]) !== pub[k]);
  eq(stale.join(', '), '', 'not yet published to Claude (then run node tools/sync.js mark)');
});

/* ================= Layout ================= */

test('Layout: no sideways scrolling and Print always on screen (phone, tablet)', async () => {
  for (const [w, h] of [[360, 740], [390, 844], [768, 1024], [1024, 700], [1280, 800]]) {
    const p = await open({ ...REMEMBERED, getDevices: true }, { width: w, height: h });
    assert(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `sideways scroll at ${w}px`);
    await pickItem(p, 'Pico de Gallo'); await p.waitForTimeout(300);
    const bb = await p.locator('#printBtn').boundingBox();
    assert(bb && bb.y >= 0 && bb.y + bb.height <= h, `Print off screen at ${w}x${h}`);
    await p.close2();
  }
});

/* ================= Manager log ================= */

test('Log: the live form is connected with all 10 questions', async () => {
  const p = await open({ getDevices: false });
  const L = await p.evaluate(() => window.__ypl.LOG);
  assert(/^https:\/\/docs\.google\.com\/forms\/d\/e\/[\w-]+\/formResponse$/.test(L.formUrl), 'form address: ' + L.formUrl);
  const ids = ['event', 'date', 'time', 'name', 'item', 'labels', 'prep', 'useBy', 'source', 'device'].map(k => L.fields[k]);
  assert(ids.every(v => /^entry\.\d+$/.test(v)), 'every field has an entry id: ' + ids.join());
  eq(new Set(ids).size, 10, 'no two fields share an id');
  await p.close2();
});

test('Log: names and prints are sent to the form; offline prints are kept and sent later', async () => {
  const p = await open({ getDevices: false });
  const got = []; let offline = false;
  await p.context().route('**/formResponse', r => {
    if (offline) return r.abort();
    got.push(Object.fromEntries(new URLSearchParams(r.request().postData())));
    return r.fulfill({ status: 200, body: '' });
  });
  await p.evaluate(() => {
    const L = window.__ypl.LOG; L.formUrl = 'https://docs.google.com/forms/d/e/TEST/formResponse';
    Object.keys(L.fields).forEach((k, i) => { L.fields[k] = 'entry.' + (i + 1); });
  });
  await p.fill('#onbNameIn', 'maria'); await p.click('#onbNameNext'); await p.click('#onbSkip');
  await pickItem(p, 'Coleslaw'); await printAndWait(p);
  offline = true;
  await pickItem(p, 'Croutons'); await printAndWait(p, /Croutons/); await p.waitForTimeout(300);
  offline = false; await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(500);
  eq(got.map(g => g['entry.1'] + ':' + (g['entry.5'] || '')).join(' | '), 'name entered: | print:Coleslaw | print:Croutons', 'log rows');
  assert(got.every(g => /^\d+\/\d+\/\d{4}$/.test(g['entry.2']) && /^\d+:\d\d [AP]M$/.test(g['entry.3'])), 'date and time stamped on the device');
  eq(got[1]['entry.4'] + '|' + got[1]['entry.6'] + '|' + got[1]['entry.9'], 'Maria|1|labels page', 'printed by, # labels, source');
  await p.close2();
});

test('Log: prints made before the form is set up are kept and sent once it is', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  const got = [];
  await p.context().route('**/formResponse', r => { got.push(Object.fromEntries(new URLSearchParams(r.request().postData()))); return r.fulfill({ status: 200, body: '' }); });
  await p.evaluate(() => { window.__ypl.LOG.formUrl = ''; });         // an app version with no form yet
  await pickItem(p, 'Coleslaw'); await printAndWait(p);
  eq(got.length, 0, 'nothing can be sent without a form');
  await p.evaluate(() => {                                            // form gets connected (next app version)
    const L = window.__ypl.LOG; L.formUrl = 'https://docs.google.com/forms/d/e/TEST/formResponse';
    Object.keys(L.fields).forEach((k, i) => { L.fields[k] = 'entry.' + (i + 1); });
    window.dispatchEvent(new Event('online'));
  });
  await p.waitForTimeout(600);
  eq(got.map(g => g['entry.5']).join(), 'Coleslaw', 'the earlier print is delivered');
  await p.close2();
});

test('Log: Line Flip Labels writes one row per item (21 rows)', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  const got = [];
  await p.context().route('**/formResponse', r => { got.push(Object.fromEntries(new URLSearchParams(r.request().postData()))); return r.fulfill({ status: 200, body: '' }); });
  await p.evaluate(() => {
    const L = window.__ypl.LOG; L.formUrl = 'https://docs.google.com/forms/d/e/TEST/formResponse';
    Object.keys(L.fields).forEach((k, i) => { L.fields[k] = 'entry.' + (i + 1); });
  });
  await p.click('#batchBtn'); await printAndWait(p, /Printed all/); await p.waitForTimeout(1500);
  eq(got.length, 21, 'rows');
  eq(new Set(got.map(g => g['entry.5'])).size, 21, 'one row per item');
  assert(got.every(g => g['entry.9'] === 'Line Flip Labels' && g['entry.6'] === '1'), 'source and count');
  await p.close2();
});

/* ================= Updates reach tablets that never close the app (bug of 2026-10-17) ================= */

// Serve a "newer" index.html to the update check only, as GitHub would after a push.
async function newerOnServer(p, v) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/const APP_VERSION = "[^"]+"/, `const APP_VERSION = "${v}"`);
  await p.context().route(/index\.html\?check=/, r => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
}

test('Update: tablet left open picks up a new version once nobody is using it', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true }, { clock: true });
  await newerOnServer(p, '9999-test');
  await p.evaluate(() => window.__ypl.checkForUpdate(false)); await p.waitForTimeout(300);
  assert(!/v=9999-test/.test(p.url()), 'must not reload while someone just used the screen');
  await p.clock.fastForward(95000); await p.waitForTimeout(800);
  assert(/v=9999-test/.test(p.url()), 'should reload to the new version after a minute idle, got ' + p.url());
  await p.close2();
});

test('Update: coming back to the app reloads right away; never loops if the old page comes back', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  await newerOnServer(p, '9999-test');
  await p.evaluate(() => window.__ypl.checkForUpdate(true)); await p.waitForTimeout(1200);
  assert(/v=9999-test/.test(p.url()), 'reopening the app should load the new version');
  // the server still hands back the old page: the next check must explain, not reload again
  const before = p.url();
  await p.evaluate(() => window.__ypl.checkForUpdate(true)); await p.waitForTimeout(800);
  eq(p.url(), before, 'no second reload for the same version');
  assert(/new version is ready/i.test(await toastText(p)), 'tells the person to reopen the app');
  await p.close2();
});

test('Update: the Recipe Book loads the current version, not a cached copy', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  const f = await openBook(p);
  const v = await p.evaluate(() => window.__ypl.APP_VERSION);
  assert(f && f.url().includes('v=' + encodeURIComponent(v)), 'recipes.html should carry the app version, got ' + (f && f.url()));
  await p.close2();
});

/* ================= runner ================= */
(async () => {
  const server = await serve();
  BASE = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const only = process.argv[2];
  let failed = 0;
  for (const t of tests) {
    if (only && !t.name.toLowerCase().includes(only.toLowerCase())) continue;
    const t0 = Date.now();
    try {
      await t.fn();
      console.log(`  PASS  ${t.name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      failed++;
      console.log(`  FAIL  ${t.name}\n        ${e.message.split('\n')[0]}`);
    }
  }
  await browser.close(); server.close();
  console.log(failed ? `\n${failed} check(s) FAILED` : `\nAll ${tests.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
