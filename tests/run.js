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
  // nor read the real shared Prep Feed: every device starts with an empty one; feed tests route their own
  await ctx.route('**/pub?*output=csv*', r => r.fulfill({ status: 200, body: 'Event,Date,Time,Printed By,Item,#Labels,Source', contentType: 'text/csv' }));
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

test('Connect: opening the app never grabs the printer (another device may be printing); chip says ready', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  await p.mouse.click(300, 500); await p.waitForTimeout(300);
  eq(await btLog(p), '', 'no connect on open or on a tap');
  eq(await chip(p), 'Printer ready', 'chip');
  await p.click('#pchip'); await p.waitForTimeout(500);
  assert((await btLog(p)).includes('picker'), 'Connect tap opens the list');
  eq(await chip(p), 'Printer: DFJ235305204', 'chip after connect');
  assert(/connected/i.test(await toastText(p)), 'success message should show');
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

test('Connect: Print connects to the remembered printer by itself (no list) and prints', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  await pickItem(p, 'Pico de Gallo');
  await printAndWait(p);
  eq(await btLog(p), 'connect:remembered', 'no list shown');
  eq(formats(await zpl(p)).length, 1, 'one label printed');
  await p.close2();
});

test('Connect: remembered printer never answers -> clear message, next Print opens the list and prints', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true, remembered: 'hang' }, { clock: true });
  await pickItem(p, 'Pico de Gallo');
  await p.click('#printBtn'); await p.waitForTimeout(150);
  if (await p.isVisible('#bcSheet')) await p.click('#bcOk');
  for (let i = 0; i < 20; i++) { await p.clock.fastForward(4000); await p.waitForTimeout(100); }
  assert(/Tap Print again to pick it/.test(await p.textContent('#status')), 'says what to do: ' + await p.textContent('#status'));
  await printAndWait(p);
  assert((await btLog(p)).includes('picker'), 'second Print opens the list');
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

test('Hand-off: after printing, the printer is let go within seconds; the next Print reconnects with no list (owner, 2026-10-23)', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true }, { clock: true });
  await pickItem(p, 'Pico de Gallo');
  await printAndWait(p);
  eq(await chip(p), 'Printer: DFJ235305204', 'connected while printing');
  await p.clock.fastForward(await p.evaluate(() => window.__ypl.HOLD_MS - 1500)); await p.waitForTimeout(100);
  eq(await chip(p), 'Printer: DFJ235305204', 'kept for back-to-back prints');
  await p.clock.fastForward(await p.evaluate(() => window.__ypl.HOLD_MS)); await p.waitForTimeout(200);
  eq(await chip(p), 'Printer ready', 'let go so another device can print');
  assert((await btLog(p)).endsWith('disconnect'), 'disconnected');
  await p.mouse.click(300, 500); await p.waitForTimeout(200);
  assert((await btLog(p)).endsWith('disconnect'), 'a tap does not grab it back');
  await printAndWait(p);
  eq(await btLog(p), 'connect:remembered,disconnect,connect:remembered', 'reconnected on Print, never the list');
  eq(formats(await zpl(p)).length, 2, 'both printed');
  await p.close2();
});

test('Hand-off: printer busy with another device -> Print waits, retries and prints with no extra taps', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true, busy: 1 }, { clock: true });
  await pickItem(p, 'Pico de Gallo');
  await p.click('#printBtn'); await p.waitForTimeout(150);
  if (await p.isVisible('#bcSheet')) await p.click('#bcOk');
  await p.clock.fastForward(8500); await p.waitForTimeout(200);
  assert(/Another device is printing/i.test(await p.textContent('#status')), 'says it is waiting: ' + await p.textContent('#status'));
  await p.clock.fastForward(2500); await p.waitForTimeout(400);
  assert(/Printed/.test(await p.textContent('#status')), 'printed after the other device let go');
  eq(formats(await zpl(p)).length, 1, 'one label printed');
  assert(!(await btLog(p)).includes('picker'), 'no list');
  await p.close2();
});

test('Hand-off: app to background lets go of the printer at once', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  await pickItem(p, 'Pico de Gallo');
  await printAndWait(p);
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  eq(await chip(p), 'Printer ready', 'released');
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(300);
  eq(await chip(p), 'Printer ready', 'coming back does not grab it');
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

test('Labels: Sour Cream (7 days) added; American renamed Sliced American Cheese on its button and in Line Flip Labels (owner, 2026-10-17)', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  const r = await p.evaluate(() => { const { ITEMS, SHELF_DAYS, BATCH } = window.__ypl, sc = ITEMS.find(i => i.id === 'sour-cream'), am = ITEMS.find(i => i.id === 'american');
    return [sc && sc.name, sc && SHELF_DAYS[sc.id], am.name, BATCH.items.includes('Sliced American Cheese'), BATCH.items.includes('American')]; });
  eq(JSON.stringify(r), JSON.stringify(['Sour Cream', 7, 'Sliced American Cheese', true, false]), 'items');
  await p.close2();
});

test('Labels: Corn Dogs button in Proteins with a 7-day shelf life (owner, 2026-10-20)', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  const r = await p.evaluate(() => { const it = window.__ypl.ITEMS.find(i => i.id === 'corn-dogs'); return it && [it.name, it.cat, window.__ypl.SHELF_DAYS[it.id]]; });
  eq(JSON.stringify(r), JSON.stringify(['Corn Dogs', 'proteins', 7]), 'Corn Dogs item');
  await p.close2();
});

test('Labels: Dough button in Toppings & Prep with a 5-day shelf life (owner, 2026-10-20)', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  const r = await p.evaluate(() => { const it = window.__ypl.ITEMS.find(i => i.id === 'dough'); return it && [it.name, it.cat, window.__ypl.SHELF_DAYS[it.id]]; });
  eq(JSON.stringify(r), JSON.stringify(['Dough', 'toppings', 5]), 'Dough item');
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

test('Labels: dated custom labels are listed at the bottom until they become buttons; text-only ones aren\'t (owner, 2026-10-21)', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  assert(await p.isHidden('#reqs'), 'no list before any custom label');
  for (const n of ['Diced Celery', 'diced celery']) {
    await p.click('#customTop'); await p.fill('#customName', n); await p.click('#days button[aria-label="4 days"]');
    await printAndWait(p);
  }
  await p.click('#customTop'); await p.click('#cText'); await p.fill('#customName', 'Gluten Free'); await printAndWait(p);
  for (const n of ['Coleslaw', 'Corn Dog', 'Brussel sprouts']) {
    await p.click('#customTop'); await p.click('#cDated'); await p.fill('#customName', n); await p.click('#days button[aria-label="3 days"]'); await printAndWait(p);
  }
  assert(await p.isVisible('#reqs'), 'list shows');
  eq(await p.locator('#reqs li').count(), 1, 'one entry: same name once, no text-only label, no item that has a button');
  assert(/Diced Celery\s*4 days · printed 2 times · last \d+\/\d+ by Maria/.test(await p.textContent('#reqs li[data-k="diced celery"]')), 'name, shelf life, times, who');
  await p.reload(); await p.waitForTimeout(300);
  eq(await p.locator('#reqs li').count(), 1, 'kept after reload');
  eq(p.errors.join(), '', 'no script errors');
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

test('Book: Print prep label prints one label per pan (pans in a batch × Multiply Batch) and stays on the recipe', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  await p.evaluate(PICO_PAN);
  const f = await openBook(p), fl = p.frameLocator('#rbFrame');
  await f.evaluate(() => goTo(recipePageIndex['pico-de-gallo'])); await p.waitForTimeout(300);
  await fl.locator('#batchToggle').click(); await fl.locator('[data-mult="2"]').click(); await p.waitForTimeout(200);
  await fl.locator('[data-lq="1"]').click();
  await fl.locator('a.labelbtn').click();
  await p.waitForSelector('#bcSheet:not([hidden])');
  eq(await p.textContent('#bcN'), '8', '4 pans per batch × Multiply Batch 2');
  eq(await p.textContent('#bcAmt'), '= 480 oz', 'oz from the pan standard');
  await p.click('#bcOk');
  await f.waitForFunction(() => /Printed/.test(document.querySelector('a.labelbtn').textContent), null, { timeout: 30000 });
  eq(formats(await zpl(p)).length, 8, 'label count');
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

const plRows = p => p.locator('#pl tr[data-k]').count();
// pick items for today's list in the picker and confirm: [[section, name], ...]
async function plPickItems(p, picks){
  for(const [sec, name] of picks) await p.click(`#plPick .plchip[data-id="${sec}|${name.toLowerCase()}"]`);
  p.once('dialog', d => d.accept());
  await p.click('#plPickAdd'); await p.waitForTimeout(300);
}
test('Prep List: the labels page reminds the kitchen to pick today\'s items until one is picked', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  assert(await p.isVisible('#pickNag'), 'reminder shows when nothing is picked today');
  await p.click('#pickNagBtn'); await p.waitForTimeout(200);
  assert(await p.isVisible('#pl'), 'its button opens the Prep List');
  assert(/plwarn/.test(await p.getAttribute('#plCount', 'class')), 'the empty list stands out on the Prep List too');
  await plPickItems(p, [['Toppings & Prep', 'Coleslaw']]);
  await p.click('#plClose'); await p.waitForTimeout(200);
  assert(!(await p.isVisible('#pickNag')), 'gone once an item is picked');
  await p.reload(); await p.waitForTimeout(400);
  assert(!(await p.isVisible('#pickNag')), 'stays gone for the rest of the day');
  await p.close2();
});

test('Prep List: starts empty each day; items are picked one by one from every label item; picks can\'t be removed', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  await p.click('#plBtn'); await p.waitForTimeout(200);
  eq(await plRows(p), 0, 'empty before anything is picked');
  assert(/Nothing on today's list yet/.test(await p.textContent('#plCount')), 'empty-list note');
  const want = await p.evaluate(() => window.__ypl.BATCH.items.length + window.__ypl.ITEMS.filter(i => window.__ypl.SHELF_DAYS[i.id] && i.cat !== 'line').length);
  eq(await p.locator('#plPick .plchip').count(), want, 'every label item can be picked');
  assert(await p.isDisabled('#plPickAdd'), 'Add waits for a pick');
  // a tap picks, a second tap before Add skips it (a draft, not the list)
  await p.click('#plPick .plchip[data-id="Toppings & Prep|croutons"]'); await p.click('#plPick .plchip[data-id="Toppings & Prep|croutons"]');
  await plPickItems(p, [['Toppings & Prep', 'Coleslaw'], ['Toppings & Prep', 'Pico de Gallo'], ['Line Flip Labels', 'Pico']]);
  eq(await plRows(p), 3, 'only the picked items');
  eq(await p.locator('#pl tr[data-k="croutons"]').count(), 0, 'a skipped tap isn\'t added');
  eq(await p.locator('#pl tr[data-k="coleslaw"]').count(), 1, 'Toppings Coleslaw only, not the Line Flip row');
  eq(await p.locator('#plPick .plchip[data-id="Toppings & Prep|coleslaw"]').count(), 0, 'a picked item leaves the picker');
  eq(await p.locator('#pl td.st:has-text("Not done")').count(), 3, 'nothing done before any label prints');
  eq(await p.locator('#pl .pltab input[type=checkbox], #pl [data-remove], #pl [data-undo]').count(), 0, 'no check boxes, remove or undo controls');
  assert(!/remove|delete|undo|uncheck/i.test(await p.textContent('#plBody').then(t => t.replace(/can't be removed/g, ''))), 'no remove/undo wording');
  // Pick all for a section
  await p.click('#plPick .plall[data-s="Desserts"]'); p.once('dialog', d => d.accept()); await p.click('#plPickAdd'); await p.waitForTimeout(300);
  eq(await p.locator('#pl tr[data-s="Desserts"]').count(), await p.evaluate(() => window.__ypl.ITEMS.filter(i => i.cat === 'desserts' && window.__ypl.SHELF_DAYS[i.id]).length), 'Pick all');
  // recipe links: the item and its Line Flip row both open Pico de Gallo, over the list
  eq(await p.getAttribute('#pl tr[data-k="pico"] .plr', 'data-recipe'), 'pico-de-gallo', 'Line Flip row links to the recipe');
  await p.click('#pl tr[data-k="pico de gallo"] .plr'); await p.waitForTimeout(1500);
  const f = p.frames().find(x => /recipes\.html/.test(x.url()));
  eq(await f.evaluate(() => document.querySelector('.page h2').textContent), 'Pico de Gallo', 'opens its recipe page');
  assert(await p.isVisible('#rb'), 'book on screen');
  await p.click('#rbClose'); await p.waitForTimeout(200);
  assert(await p.isVisible('#pl') && !(await p.isVisible('#rb')), 'closing the book returns to the list');
  const book = await f.evaluate(() => [...PREP_LABEL_IDS].sort().join());
  eq(await p.evaluate(() => [...window.__ypl.RECIPE_PAGES].sort().join()), book, 'RECIPE_PAGES = the book\'s pages with labels');
  // kept after reload; the next day starts empty
  await p.reload(); await p.waitForTimeout(300); await p.click('#plBtn'); await p.waitForTimeout(200);
  assert(await plRows(p) > 3, 'picks kept after reload');
  await p.evaluate(() => { const k = Object.keys(localStorage).find(x => /^ypl:prepPicks:/.test(x)); localStorage.setItem('ypl:prepPicks:1/1/2020', localStorage.getItem(k)); localStorage.removeItem(k); });
  await p.click('#plClose'); await p.click('#plBtn'); await p.waitForTimeout(200);
  eq(await plRows(p), 0, 'a new day starts empty');
  eq(p.errors.join(), '', 'no script errors');
  await p.close2();
});

test('Prep List: picks are logged for every device; Add without a pick or a name always shows a message', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  const got = [];
  await p.context().route('**/formResponse', r => { got.push(Object.fromEntries(new URLSearchParams(r.request().postData()))); return r.fulfill({ status: 200, body: '' }); });
  await p.evaluate(() => { const L = window.__ypl.LOG; Object.keys(L.fields).forEach((k, i) => { L.fields[k] = 'entry.' + (i + 1); }); });
  await p.click('#plBtn'); await p.waitForTimeout(200);
  await plPickItems(p, [['Sides', 'Black Beans']]);
  await p.waitForTimeout(400);
  const row = got.find(g => g['entry.1'] === 'prep pick');
  assert(row && row['entry.5'] === 'Black Beans' && row['entry.9'] === 'Sides' && row['entry.4'] === 'Maria', 'pick logged with item, section and who');
  assert(/added to today's list/.test(await toastText(p)), 'confirmed on screen');
  // RULE: the Add button never fails silently
  await p.evaluate(() => document.getElementById('plPickAdd').disabled = false);
  await p.click('#plPickAdd'); await p.waitForTimeout(200);
  assert(/Tap the items/.test(await toastText(p)), 'no pick: message');
  await p.evaluate(() => localStorage.removeItem('ypl:name'));
  await p.click('#plPick .plchip[data-id="Sides|cavatappi"]'); await p.click('#plPickAdd'); await p.waitForTimeout(200);
  assert(/Set up your name/.test(await toastText(p)), 'no name: message');
  await p.close2();
});

test('Prep List: done only when a label prints (any screen), showing who and when; each day starts fresh', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  await p.click('#plBtn'); await p.waitForTimeout(200);
  await plPickItems(p, [['Toppings & Prep', 'Coleslaw']]);
  await p.click('#plClose');
  await pickItem(p, 'Coleslaw'); await printAndWait(p);
  await p.click('#plBtn'); await p.waitForTimeout(200);
  const st = await p.textContent('#pl tr[data-k="coleslaw"] td.st');
  assert(/✓ Maria\s*\d{1,2}:\d\d [AP]M/.test(st), 'done by Maria with the time: ' + st);
  assert(/Print again/.test(await p.textContent('#pl tr[data-k="coleslaw"] .plp')), 'can still print more');
  eq((await p.textContent('#plCount')).match(/\d+ of \d+ done/)[0], '1 of 1 done', 'count');
  await p.reload(); await p.waitForTimeout(300); await p.click('#plBtn'); await p.waitForTimeout(200);
  assert(/✓ Maria/.test(await p.textContent('#pl tr[data-k="coleslaw"] td.st')), 'kept after reload');
  // the next day: yesterday's completions don't count (the pick is moved to today to see the row)
  await p.evaluate(() => { const k = Object.keys(localStorage).find(x => /^ypl:prepDone:/.test(x)); localStorage.setItem('ypl:prepDone:1/1/2020', localStorage.getItem(k)); localStorage.removeItem(k); });
  await p.click('#plClose'); await p.click('#plBtn'); await p.waitForTimeout(200);
  eq(await p.textContent('#pl tr[data-k="coleslaw"] td.st'), 'Not done', 'new day starts fresh');
  await p.close2();
});

test('Prep List: Print on a row prints one label with the approved date and stays on the list', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true }, { width: 390, height: 844 });
  await p.click('#plBtn'); await p.waitForTimeout(200);
  await plPickItems(p, [['Toppings & Prep', 'Pico de Gallo'], ['Line Flip Labels', 'Pico']]);
  await p.click('#pl tr[data-k="pico de gallo"] .plp');
  await p.waitForFunction(() => /Printed/.test(document.getElementById('toast').textContent), null, { timeout: 30000 });
  const z = formats(await zpl(p));
  eq(z.length, 1, 'one label');
  assert(/pico de gallo/i.test(z[0]), 'item name on label');
  const ub = await p.evaluate(() => { const y = window.__ypl, d = y.useBy(new Date(), y.SHELF_DAYS['pico-de-gallo']); return (d.getMonth() + 1) + '/' + d.getDate(); });
  assert(z[0].includes(ub), 'approved use-by date ' + ub);
  assert(await p.isVisible('#pl'), 'still on the prep list');
  assert(/done/.test(await p.getAttribute('#pl tr[data-k="pico de gallo"]', 'class')), 'row marked done');
  assert(!(await p.evaluate(() => { const b = document.getElementById('plBody'); return b.scrollWidth > b.clientWidth; })), 'no sideways scroll on a phone');
  eq(p.errors.join(), '', 'no script errors');
  await p.close2();
});

test('Prep List: anyone can add a new item; it goes on today\'s list, stays pickable and is logged; no duplicates', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  const got = [];
  await p.context().route('**/formResponse', r => { got.push(Object.fromEntries(new URLSearchParams(r.request().postData()))); return r.fulfill({ status: 200, body: '' }); });
  await p.evaluate(() => { const L = window.__ypl.LOG; Object.keys(L.fields).forEach((k, i) => { L.fields[k] = 'entry.' + (i + 1); }); });
  p.on('dialog', d => d.accept());
  await p.click('#plBtn'); await p.waitForTimeout(200);
  await p.fill('#plAddName', 'Diced Celery'); await p.selectOption('#plAddSec', 'Sides'); await p.selectOption('#plAddDays', '5');
  await p.click('#plAdd button'); await p.waitForTimeout(400);
  eq(await plRows(p), 1, 'on today\'s list');
  assert(/5 days · added by Maria/.test(await p.textContent('#pl tr[data-k="diced celery"]')), 'shows shelf life and who added it');
  const row = got.find(g => g['entry.1'] === 'prep add');
  assert(row && row['entry.5'] === 'Diced Celery' && row['entry.6'] === '5' && row['entry.9'] === 'Sides' && row['entry.4'] === 'Maria', 'logged for everyone');
  await p.fill('#plAddName', 'coleslaw'); await p.click('#plAdd button'); await p.waitForTimeout(200);
  eq(await plRows(p), 1, 'duplicate refused');
  assert(/already an item/.test(await toastText(p)), 'duplicate explained');
  // the next day: off the list, but still pickable
  await p.evaluate(() => { const k = Object.keys(localStorage).find(x => /^ypl:prepPicks:/.test(x)); localStorage.removeItem(k); });
  await p.reload(); await p.waitForTimeout(300); await p.click('#plBtn'); await p.waitForTimeout(200);
  eq(await plRows(p), 0, 'new day starts empty');
  eq(await p.locator('#plPick .plchip[data-id="Sides|diced celery"]').count(), 1, 'added item stays pickable');
  await p.close2();
});

test('Prep List: shows every device\'s picks, prints and additions from the shared feed', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  const today = await p.evaluate(() => { const d = new Date(); return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear(); });
  const csv = ['Event,Date,Time,Printed By,Item,#Labels,Source', `print,${today},9:05 AM,Caleb,Pickles,1,labels page`,
    `print,${today},8:40 AM,Debo,Pickles,1,Line Flip Labels`, 'print,1/2/2020,7:00 AM,Debo,Croutons,1,labels page',
    'prep add,1/2/2020,7:00 AM,Debo,"Brussels Garnish",4,Sides', `prep pick,${today},7:00 AM,Debo,Pickles,,Toppings & Prep`,
    `prep pick,${today},7:00 AM,Debo,Croutons,,Toppings & Prep`, 'prep pick,1/2/2020,7:00 AM,Debo,Feta,,Line Flip Labels'].join('\n');
  await p.context().route('**/prep-feed.csv*', r => r.fulfill({ status: 200, body: csv, contentType: 'text/csv' }));
  await p.evaluate(() => window.__ypl.setPrepFeed(location.origin + '/prep-feed.csv'));
  await p.click('#plBtn'); await p.waitForTimeout(600);
  eq(await plRows(p), 2, 'today\'s picks from another device');
  assert(/✓ Debo\s*8:40 AM/.test(await p.textContent('#pl tr[data-k="pickles"] td.st')), 'earliest print today wins');
  eq(await p.textContent('#pl tr[data-k="croutons"] td.st'), 'Not done', 'an old day\'s print doesn\'t count');
  eq(await p.locator('#pl tr[data-k="feta"]').count(), 0, 'an old day\'s pick isn\'t on today\'s list');
  eq(await p.textContent('#plPick .plchip[data-id="Sides|brussels garnish"]'), 'Brussels Garnish', 'item added on another device can be picked');
  eq(p.errors.join(), '', 'no script errors');
  await p.close2();
});

test('Prep List archive: the day\'s picked items, same sections as the screen; done = first print of that day', async () => {
  const arch = require('../tools/prep-archive');
  const p = await open({ ...REMEMBERED, getDevices: true });
  const app = await p.evaluate(() => window.__ypl.PL_SECTIONS.map(s => s.name + ': ' + s.rows.map(r => r.name).join('|')).join('\n'));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  eq(arch.sections(arch.appData(html)).map(s => s.name + ': ' + s.rows.map(r => r.name).join('|')).join('\n'), app, 'archive sections = Prep List sections');
  const H = ['Timestamp', 'Event', 'Date', 'Time', 'Printed By', 'Item(Recipe Book Name)', '#Labels', 'Prep Date', 'Use By Date', 'Source', 'Device'];
  const out = arch.build([H, ['', 'print', '10/17/2026', '4:07 PM', 'Caleb', 'Coleslaw', '1', '', '', 'labels page', ''],
    ['', 'print', '10/17/2026', '1:47 PM', 'Debo', 'Coleslaw', '2', '', '', 'labels page', ''], ['', 'prep add', '10/17/2026', '5:00 PM', 'Debo', 'Diced Celery', '4', '', '', 'Sides', ''],
    ['', 'print', '10/16/2026', '1:00 PM', 'Debo', 'Croutons', '1', '', '', 'labels page', ''], ['', 'prep add', '10/19/2026', '5:00 PM', 'Debo', 'Later Item', '4', '', '', 'Sides', ''],
    ...[['Coleslaw', 'Toppings & Prep'], ['Diced Celery', 'Sides'], ['Croutons', 'Toppings & Prep'], ['Later Item', 'Sides']].map(([i, sec]) => ['', 'prep pick', '10/17/2026', '7:00 AM', 'Debo', i, '', '', '', sec, '']),
    ['', 'prep pick', '10/16/2026', '7:00 AM', 'Debo', 'Pickles', '', '', '', 'Toppings & Prep', '']], '10/17/2026', html);
  assert(/Coleslaw<\/td><td>✓ Debo<\/td><td>1:47 PM<\/td><td>3</.test(out), 'earliest print, labels counted');
  assert(/Diced Celery \(added by Debo\)/.test(out) && !/Later Item/.test(out), 'items added by that day only');
  assert(/Croutons<\/td><td>Not done/.test(out), 'another day\'s print doesn\'t count');
  assert(!/Brownies|Pickles/.test(out), 'only the items picked that day');
  assert(/<b>No items were picked/.test(arch.build([H], '10/17/2026', html)), 'a day with no picks says so');
  // labels printed that day for items not on the list still go on record (owner 2026-10-28); text-only labels don't
  const noPick = arch.build([H, ['', 'print', '10/17/2026', '9:10 AM', 'Cam', 'Pickles', '2', '', '', 'labels page', ''],
    ['', 'print', '10/17/2026', '8:05 AM', 'Caleb', 'Croutons', '1', '', '', 'labels page', ''], ['', 'print', '10/17/2026', '8:30 AM', 'Cam', 'Croutons', '2', '', '', 'labels page', ''],
    ['', 'print', '10/17/2026', '9:00 AM', 'Cam', 'Walk-in door', '1', '', '', 'custom text', '']], '10/17/2026', html);
  assert(/No items were picked for this day\.<\/b> 2 other items had labels printed/.test(noPick), 'summary counts the other items');
  assert(/Labels printed, not on the list<\/h2>.*First printed by.*Croutons<\/td><td>✓ Caleb<\/td><td>8:05 AM<\/td><td>3<.*Pickles<\/td><td>✓ Cam<\/td><td>9:10 AM<\/td><td>2</.test(noPick), 'listed by first print, labels counted');
  assert(!/Walk-in door/.test(noPick), 'text-only labels left out');
  assert(/Labels printed, not on the list[\s\S]*Brownies/.test(arch.build([H, ['', 'prep pick', '10/17/2026', '7:00 AM', 'Debo', 'Coleslaw', '', '', '', 'Toppings & Prep', ''],
    ['', 'print', '10/17/2026', '9:00 AM', 'Debo', 'Brownies', '1', '', '', 'labels page', '']], '10/17/2026', html)), 'off-list prints listed on picked days too');
  await p.close2();
});

/* ================= Batches & yields ================= */

/* ================= Manager (🔒, PIN) ================= */

const crypto = require('crypto');
const PIN = '4321', PIN_HASH = crypto.createHash('sha256').update('yardery-manager:' + PIN).digest('hex');
// a device where the Manager PIN is set (as a saved pin op, like a PIN change waiting for the sync)
const withPin = (more = []) => ({ ...REMEMBERED, getDevices: true, adminOps: [{ op: 'pin', t: 'pin0', hash: PIN_HASH }].concat(more) });
async function openWith(o, viewport) {
  const p = await open(o, viewport);
  if (o.adminOps) { await p.evaluate(ops => localStorage.setItem('ypl:adminOps', JSON.stringify(ops)), o.adminOps); await p.reload(); await p.waitForTimeout(300); }
  return p;
}
async function unlock(p, pin = PIN) { if (!(await p.isVisible('#mg'))) await p.click('#mgBtn'); await p.fill('#mgPin', pin); await p.click('#mgPinIn button[type=submit]'); await p.waitForTimeout(300); }

test('Manager: 🔒 needs the PIN; wrong PINs are refused and 5 lock it for 5 minutes; cooks have no pan/yield editor (owner, 2026-10-24)', async () => {
  const site = await (async () => { const p0 = await open({ ...REMEMBERED, getDevices: true }); const s = await p0.evaluate(() => window.__ypl.SITE.pin); await p0.close2(); return s; })();
  assert(/^[0-9a-f]{64}$/.test(site), 'the owner\'s PIN is set, stored only as a SHA-256 hash');
  const p = await openWith(withPin(), { clock: true });
  await p.click('#setBtn');
  assert(!/Pans|yield/i.test(await p.textContent('#setSheet')), 'no pan/yield editor in ⚙');
  await p.keyboard.press('Escape');
  for (let i = 0; i < 4; i++) { await unlock(p, '0000'); assert(/Wrong PIN/.test(await toastText(p)), 'wrong PIN refused'); await p.click('#mgClose'); }
  await unlock(p, '0000');
  assert(/Too many wrong tries/.test(await p.textContent('#mgBody')) && await p.isDisabled('#mgPin'), 'locked out after 5');
  await p.clock.fastForward(5 * 60 * 1000 + 1000); await p.click('#mgClose'); await unlock(p);
  assert(await p.isVisible('.mgtabs'), 'right PIN opens it');
  await p.clock.fastForward(11 * 60 * 1000); await p.click('[data-tab=users]'); await p.waitForTimeout(100);
  await p.click('#mgClose'); await p.click('#mgBtn'); await p.waitForTimeout(100);
  assert(await p.isVisible('#mgPin'), 'locks itself after 10 idle minutes');
  eq(p.errors.join(), '', 'no script errors');
  await p.close2();
});

test('Manager: change a label (shelf life, note, pan, yield, par, Line Flip) — applies here at once and is logged for the sync', async () => {
  const p = await openWith(withPin());
  const got = [];
  await p.context().route('**/formResponse', r => { got.push(Object.fromEntries(new URLSearchParams(r.request().postData()))); return r.fulfill({ status: 200, body: '' }); });
  await p.evaluate(() => { const L = window.__ypl.LOG; Object.keys(L.fields).forEach((k, i) => { L.fields[k] = 'entry.' + (i + 1); }); });
  await unlock(p);
  await p.fill('#mgSearch', 'pico de'); await p.waitForTimeout(100);
  await p.click('#mg tr[data-id="pico-de-gallo"] [data-act=edit]');
  const f = '#mg form[data-id="pico-de-gallo"]';
  eq(await p.inputValue(f + ' [name=days]'), '3', 'form shows the current shelf life');
  await p.fill(f + ' [name=name]', ''); await p.click(f + ' button[type=submit]'); await p.waitForTimeout(150);
  assert(/Type the label name/.test(await toastText(p)), 'name required');
  await p.fill(f + ' [name=name]', 'Pico de Gallo'); await p.fill(f + ' [name=days]', '2'); await p.fill(f + ' [name=note]', 'Keep covered.');
  await p.fill(f + ' [name=oz]', '60'); await p.click(f + ' button[type=submit]'); await p.waitForTimeout(150);
  assert(/Pick the pan size too/.test(await toastText(p)), 'oz needs a pan');
  await p.fill(f + ' [name=pan]', '1/3 pan 6"'); await p.fill(f + ' [name=par]', '4'); await p.check(f + ' [name=flip]');
  await p.click(f + ' button[type=submit]'); await p.waitForTimeout(300);
  assert(/2 days · 1\/3 pan 6", 60 oz, par 4 · batch 240 oz · Line Flip/.test(await p.textContent('#mg tr[data-id="pico-de-gallo"]')), 'row updated: ' + await p.textContent('#mg tr[data-id="pico-de-gallo"]'));
  assert(/\d changes? saved\. Every other device gets (it|them) within a few minutes/.test(await p.textContent('#mgBody')), 'says it waits for the sync');
  const row = got.find(g => g['entry.1'] === 'admin');
  const op = row && JSON.parse(row['entry.9'].replace(/^admin /, ''));
  assert(op && op.op === 'label' && op.id === 'pico-de-gallo' && op.days === 2 && op.pan === '1/3 pan 6"' && op.flip === true && op.yield === '240 oz', 'logged: ' + JSON.stringify(row));
  await p.click('#mgClose'); await p.waitForTimeout(1200);
  await pickItem(p, 'Pico de Gallo');
  eq(await p.textContent('#qty'), '4', 'pans per batch after reload');
  assert(/Keep covered/.test(await p.textContent('#shelfNote')) && /2 days/.test(await p.textContent('#shelfNote')), 'new shelf life and note');
  assert(await p.evaluate(() => window.__ypl.BATCH.items.includes('Pico de Gallo')), 'added to Line Flip');
  eq(p.errors.join(), '', 'no script errors');
  await p.close2();
});

test('Manager: add a label and remove one; the label page, Prep List and Line Flip set follow', async () => {
  const p = await openWith(withPin());
  p.on('dialog', d => d.accept());
  await unlock(p);
  await p.click('#mg [data-act=add]');
  const f = '#mg form[data-id=""]';
  await p.fill(f + ' [name=name]', 'Diced Celery'); await p.selectOption(f + ' [name=cat]', 'sides'); await p.fill(f + ' [name=days]', '4');
  await p.click(f + ' button[type=submit]'); await p.waitForTimeout(300);
  await p.fill('#mgSearch', 'feta'); await p.waitForTimeout(100);
  await p.click('#mg tr[data-id="feta"] [data-act=edit]'); await p.click('#mg form[data-id="feta"] [data-act=remove]'); await p.waitForTimeout(300);
  await p.click('#mgClose'); await p.waitForTimeout(1200);
  await pickItem(p, 'Diced Celery');
  assert(/Manager-approved: 4 days/.test(await p.textContent('#shelfNote')), 'new label works with its shelf life');
  eq(await p.locator('.item .n').filter({ hasText: /^Feta$/ }).count(), 0, 'Feta button gone');
  assert(!(await p.evaluate(() => window.__ypl.BATCH.items.includes('Feta'))), 'Feta out of Line Flip');
  await p.click('#plBtn'); await p.waitForTimeout(200);
  eq(await p.locator('#plPick .plchip[data-id="Sides|diced celery"]').count(), 1, 'pickable on the Prep List');
  eq(p.errors.join(), '', 'no script errors');
  await p.close2();
});

test('Manager: users list; turning a device off blocks it; changing the PIN', async () => {
  const p = await openWith(withPin());
  p.on('dialog', d => d.accept());
  await p.evaluate(() => window.__ypl.SITE.users.push({ device: 'abcd1234', name: 'Debo', last: '10/23/2026' }));
  await unlock(p); await p.click('[data-tab=users]'); await p.waitForTimeout(100);
  assert(/Debo/.test(await p.textContent('#mg tr[data-dev="abcd1234"]')) && /This device/.test(await p.textContent('#mgBody')), 'lists users and this device');
  eq(await p.locator('#mg tr .yltag.m + [data-act]').count() + await p.locator('#mg tr:has(.yltag.m) [data-act]').count(), 0, 'no off switch for your own device');
  await p.click('#mg tr[data-dev="abcd1234"] [data-act=deny]'); await p.waitForTimeout(200);
  assert(/Access off/.test(await p.textContent('#mg tr[data-dev="abcd1234"]')), 'Debo off');
  await p.click('[data-tab=settings]');
  await p.fill('#mgPinForm [name=p1]', '12'); await p.click('#mgPinForm button[type=submit]'); await p.waitForTimeout(100);
  assert(/4 to 8 digits/.test(await toastText(p)), 'PIN length checked');
  await p.fill('#mgPinForm [name=p1]', '9876'); await p.fill('#mgPinForm [name=p2]', '9876'); await p.click('#mgPinForm button[type=submit]'); await p.waitForTimeout(300);
  await p.click('#mgLock'); await unlock(p, PIN);
  assert(/Wrong PIN/.test(await toastText(p)), 'old PIN no longer works');
  await unlock(p, '9876'); assert(await p.isVisible('.mgtabs'), 'new PIN works');
  await p.close2();
  // a device that was turned off
  const me = await open({ ...REMEMBERED, getDevices: true });
  const dev = await me.evaluate(() => JSON.parse(localStorage.getItem('ypl:deviceId')).slice(0, 8));
  await me.evaluate(d => localStorage.setItem('ypl:adminOps', JSON.stringify([{ op: 'user', t: 'u1', device: d, name: 'Maria', deny: true }])), dev);
  await me.reload(); await me.waitForTimeout(300);
  assert(await me.isVisible('#blocked'), 'turned-off device sees the block screen');
  await me.close2();
});

test('Manager: every device reads the published Prep Feed (owner, 2026-10-28)', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  let hit = '';
  await p.context().route('**/pub?*output=csv*', r => { hit = r.request().url(); return r.fulfill({ status: 200, body: 'Event,Date,Time,Printed By,Item,#Labels,Source', contentType: 'text/csv' }); });
  await p.evaluate(() => window.__ypl.loadFeed()); await p.waitForTimeout(300);
  assert(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/[^/]+\/pub\?gid=892374626&single=true&output=csv/.test(hit), 'reads the Prep Feed tab as CSV, got ' + hit);
  await p.click('#mgBtn'); await p.waitForTimeout(200);
  eq(p.errors.join(), '', 'no script errors');
  await p.close2();
});

test('Manager: changes reach every other device from the shared feed, once nobody is using it (owner, 2026-10-24)', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true }, { clock: true });
  const op = { op: 'label', t: 'zz-feed1', id: 'crab-cakes', name: 'Crab Cakes', cat: 'protein', days: 1, note: 'From the feed' };
  const deny = { op: 'user', t: 'zz-feed2', device: 'abcd1234', name: 'Someone', deny: true };
  const csv = ['Event,Date,Time,Printed By,Item,#Labels,Source', `admin,1/2/2020,7:00 AM,Clay,Crab Cakes,,"admin ${JSON.stringify(op).replace(/"/g, '""')}"`,
    `admin,1/2/2020,7:01 AM,Clay,access,,"admin ${JSON.stringify(deny).replace(/"/g, '""')}"`, 'admin,1/2/2020,7:02 AM,Clay,x,,admin {not json'].join('\n');
  await p.context().route('**/prep-feed.csv*', r => r.fulfill({ status: 200, body: csv, contentType: 'text/csv' }));
  await p.evaluate(() => { window.__ypl.setPrepFeed(location.origin + '/prep-feed.csv'); window.__mark = 1; });
  await p.mouse.click(5, 300);                                   // someone is using the screen
  await p.evaluate(() => window.__ypl.loadFeed()); await p.waitForTimeout(300);
  eq(await p.evaluate(() => window.__mark), 1, 'no reload while someone is using it');
  eq(await p.evaluate(() => JSON.parse(localStorage.getItem('ypl:feedOps')).map(o => o.t).join()), 'zz-feed1,zz-feed2', 'kept (bad rows skipped)');
  await p.clock.fastForward(30000); await p.waitForTimeout(800);
  eq(await p.evaluate(() => window.__mark), undefined, 'reloaded once idle');
  eq(await p.evaluate(() => window.__ypl.SHELF_DAYS['crab-cakes']), 1, 'the new shelf life is in use');
  // the reloaded page already has them: the next feed read doesn't reload again
  await p.evaluate(() => { window.__ypl.setPrepFeed(location.origin + '/prep-feed.csv'); window.__mark = 2; window.__ypl.loadFeed(); });
  await p.clock.fastForward(30000); await p.waitForTimeout(500);
  eq(await p.evaluate(() => window.__mark), 2, 'no reload loop');
  eq(p.errors.join(), '', 'no script errors');
  await p.close2();
});

test('Manager: Custom labels tab lists custom food labels people printed; "Make it a label" adds one for everyone (owner, 2026-10-28)', async () => {
  const p = await openWith(withPin());
  // printing a custom food label is remembered on the device (text-only labels aren't)
  await p.click('#customTop'); await p.click('#cDated'); await p.fill('#customName', 'Lemon Bars'); await p.click('#days button[aria-label="4 days"]'); await printAndWait(p);
  await p.click('#customTop'); await p.click('#cText'); await p.fill('#customName', 'Walk-in Door'); await printAndWait(p);
  await p.evaluate(() => { const l = JSON.parse(localStorage.getItem('ypl:customPrints') || '[]');
    l.push({ name: 'Coleslaw', date: '10/20/2026', by: 'Cam', days: 3 }, { name: 'Ranch Bottle', date: '10/21/2026', by: 'Debo', days: 7 }, { name: 'ranch bottle', date: '10/22/2026', by: 'Clay', days: 7 });
    localStorage.setItem('ypl:customPrints', JSON.stringify(l)); });
  await unlock(p);
  const want = await p.evaluate(() => { const have = new Set(window.__ypl.ITEMS.map(i => i.name.toLowerCase()));
    return new Set((window.__ypl.SITE.customs || []).map(c => c.name.toLowerCase()).concat(['lemon bars', 'ranch bottle']).filter(n => !have.has(n))).size; });
  assert(new RegExp('Custom labels \\(' + want + '\\)').test(await p.textContent('#mgBody .mgtabs')), 'tab shows how many (' + want + '): ' + await p.textContent('#mgBody .mgtabs'));
  await p.click('#mgBody [data-tab="customs"]'); await p.waitForTimeout(150);
  const txt = await p.textContent('#mgBody');
  assert(/Lemon Bars\s*Printed 1 time · last \d+\/\d+\/\d{4} by Maria · 4-day shelf life/.test(txt), 'shows times, last print, who, shelf life: ' + txt.slice(0, 400));
  assert(/ranch bottle\s*Printed \d+ times · last/i.test(txt) && (txt.match(/ranch bottle/gi) || []).length === 1, 'same name counted together, once');
  assert(!/Coleslaw|Walk-in Door/.test(txt), 'existing labels and text-only labels left out');
  await p.click('#mgBody tr[data-custom="lemon bars"] [data-act="make"]'); await p.waitForTimeout(150);
  eq(await p.inputValue('#mgBody form[data-custom="lemon bars"] [name=name]'), 'Lemon Bars', 'name filled in');
  eq(await p.inputValue('#mgBody form[data-custom="lemon bars"] [name=days]'), '4', 'shelf life filled in');
  await p.fill('#mgBody form[data-custom="lemon bars"] [name=name]', 'Lemon Bar');
  await p.selectOption('#mgBody form[data-custom="lemon bars"] [name=cat]', 'desserts');
  await p.click('#mgBody form[data-custom="lemon bars"] button[type=submit]'); await p.waitForTimeout(300);
  assert(/Added Lemon Bar/.test(await toastText(p)), 'saved');
  assert(!/Lemon Bars/.test(await p.textContent('#mgBody')), 'leaves the custom list once it is a label');
  const op = await p.evaluate(() => JSON.parse(localStorage.getItem('ypl:adminOps')).find(o => o.op === 'label'));
  eq([op.name, op.cat, op.days].join('|'), 'Lemon Bar|desserts|4', 'a shared label op, like any Manager add');
  await p.click('#mgClose'); await p.waitForTimeout(800);
  assert(await p.locator('.item .n', { hasText: /^Lemon Bar$/ }).count() > 0, 'cooks get the button');
  eq(p.errors.join(), '', 'no script errors');
  await p.close2();
});

test('Manager tool: the sync lists every custom food label from the print log (name, count, last print, shelf life)', async () => {
  const admin = require('../tools/admin');
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ypl-'));
  const files = { BOOK: path.join(tmp, 'book.html'), APP: path.join(tmp, 'index.html') };
  fs.copyFileSync(path.join(ROOT, 'artifacts', 'recipe-book.html'), files.BOOK); fs.copyFileSync(path.join(ROOT, 'index.html'), files.APP);
  const H = ['Timestamp', 'Event', 'Date', 'Time', 'Printed By', 'Item(Recipe Book Name)', '#Labels', 'Prep Date', 'Use By Date', 'Source', 'Device'];
  const rows = [H, ['', 'print', '10/20/2026', '9:00 AM', 'Debo', 'Ranch Bottle', '1', '10/20/2026 9:00 AM', '10/26/2026', 'custom', 'd1'],
    ['', 'print', '10/22/2026', '9:00 AM', 'Clay', 'ranch bottle', '1', '10/22/2026 9:00 AM', '10/28/2026', 'custom', 'd2'],
    ['', 'print', '10/22/2026', '9:30 AM', 'Cam', 'Frozen Mango', '1', '10/22/2026 9:30 AM', '1/19/2027', 'custom', 'd3'],
    ['', 'print', '10/22/2026', '9:40 AM', 'Cam', 'Walk-in Door', '1', '', '', 'custom text', 'd3'],
    ['', 'print', '10/22/2026', '9:50 AM', 'Cam', 'Coleslaw', '1', '10/22/2026 9:50 AM', '10/24/2026', 'labels page', 'd3']];
  const r = admin.apply(rows, files);
  assert(r.customsChanged, 'reported');
  eq(JSON.stringify(admin.readSite(fs.readFileSync(files.APP, 'utf8')).customs),
    JSON.stringify([{ name: 'ranch bottle', n: 2, last: '10/22/2026', by: 'Clay', days: 7 }, { name: 'Frozen Mango', n: 1, last: '10/22/2026', by: 'Cam', days: 90 }]), 'customs');
  assert(!admin.apply(rows, files).customsChanged, 'nothing twice');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('Manager tool: the sync adds new ops for every device, rebuilds users, keeps the Recipe Book yields equal; each op once', async () => {
  const admin = require('../tools/admin');
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ypl-'));
  const files = { BOOK: path.join(tmp, 'book.html'), APP: path.join(tmp, 'index.html') };
  fs.copyFileSync(path.join(ROOT, 'artifacts', 'recipe-book.html'), files.BOOK); fs.copyFileSync(path.join(ROOT, 'index.html'), files.APP);
  const H = ['Timestamp', 'Event', 'Date', 'Time', 'Printed By', 'Item(Recipe Book Name)', '#Labels', 'Prep Date', 'Use By Date', 'Source', 'Device'];
  const op1 = { op: 'label', t: 'a1', id: 'pico-de-gallo', name: 'Pico de Gallo', cat: 'toppings', days: 3, note: '', pan: '1/3 pan 6"', oz: 60, par: 4, yield: '250 oz', flip: false };
  const op2 = { op: 'label', t: 'a2', id: 'diced-celery', name: 'Diced Celery', cat: 'sides', days: 4, note: '', pan: '', oz: 0, par: 0, yield: '', flip: false };
  const rows = [H, ['', 'print', '10/23/2026', '9:00 AM', 'Debo', 'Coleslaw', '1', '', '', 'labels page', '100a4311'],
    ['', 'print', '10/24/2026', '9:00 AM', 'Deborah', 'Coleslaw', '1', '', '', 'labels page', '100a4311'],
    ['', 'admin', '10/24/2026', '9:05 AM', 'Clay', 'Changed Pico de Gallo', '', '', '', 'admin ' + JSON.stringify(op1), '2627971f'],
    ['', 'admin', '10/24/2026', '9:06 AM', 'Clay', 'Added Diced Celery', '', '', '', 'admin ' + JSON.stringify(op2), '2627971f'],
    ['', 'admin', '10/24/2026', '9:07 AM', 'Clay', 'bad', '', '', '', 'admin {not json', '2627971f']];
  const r = admin.apply(rows, files);
  eq(r.ops.length, 2, 'two ops');
  eq(r.warn.length, 0, 'nothing to flag');
  const site = admin.readSite(fs.readFileSync(files.APP, 'utf8'));
  eq(site.ops.map(o => o.t).slice(-2).join(), 'a1,a2', 'ops added');
  eq(site.users.map(u => u.device + ':' + u.name).join(), '2627971f:Clay,100a4311:Deborah', 'one user per device, last name used');
  eq(admin.bookYield(fs.readFileSync(files.BOOK, 'utf8'), 'pico-de-gallo'), '250 oz', 'book yield follows');
  assert(/const APP_VERSION = "\d{4}-\d{2}-\d{2}\.\d+"/.test(fs.readFileSync(files.APP, 'utf8')) && fs.readFileSync(files.APP, 'utf8') !== fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), 'version bumped');
  const again = admin.apply(rows, files);
  eq(again.ops.length + (again.usersChanged ? 1 : 0), 0, 'nothing twice');
  const op3 = { op: 'label', t: 'a3', id: 'coleslaw', name: 'Coleslaw', cat: 'sides', days: 10 };
  const w = admin.apply(rows.concat([['', 'admin', '10/24/2026', '9:08 AM', 'Cam', 'x', '', '', '', 'admin ' + JSON.stringify(op3), 'e5a226a6']]), files).warn.join('\n');
  assert(/from device e5a226a6 \(not the owner's phone\)/.test(w) && /Coleslaw: 10 days.*7 days/.test(w), 'flags a non-owner device and a shelf life past 7 days: ' + w);
  // the app replays them
  const p = await open({ ...REMEMBERED, getDevices: true });
  const ok = await p.evaluate(src => { const m = /^const SITE = (.*);$/m.exec(src); return !!JSON.parse(m[1]).ops.length; }, fs.readFileSync(files.APP, 'utf8'));
  assert(ok, 'SITE line readable');
  await p.close2();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('Yields: the label app uses the Recipe Book\'s batch yields', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  const app = await p.evaluate(() => ({ Y: window.__ypl.YIELDS, ids: window.__ypl.ITEMS.map(i => i.id) }));
  const f = await openBook(p);
  const book = await f.evaluate(ids => Object.fromEntries(ids.filter(id => BATCH_YIELDS[id]).map(id => [id, (BATCH_YIELDS[id].est ? '≈ ' : '') + BATCH_YIELDS[id].v])), app.ids);
  const sorted = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
  eq(sorted(app.Y), sorted(book), 'YIELDS match BATCH_YIELDS');
  const am = await p.evaluate(() => { const a = window.__ypl.amountMade; return [a('pico-de-gallo', 2), a('blackened-fish', 2), a('smoked-ribs', 3), a('bama-white-bbq', 2), a('coleslaw', 2), a('fire-marinara', 3)].join(' | '); });
  eq(am, '480 oz | 36–42 pieces × 2 oz | 3 racks | ≈ 340 oz |  | ≈ 19.5 quarts', 'batches × yield');
  await p.close2();
});

const PICO_PAN = () => window.__ypl.STORAGE['pico-de-gallo'] = { pan: '1/3 pan 6"', oz: 60, par: 4 };
test('Pans: each label is one pan; Print starts at the pans one batch fills; the pan prints on the label and goes in the log (owner, 2026-10-24)', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  const got = [];
  await p.context().route('**/formResponse', r => { got.push(Object.fromEntries(new URLSearchParams(r.request().postData()))); return r.fulfill({ status: 200, body: '' }); });
  await p.evaluate(PICO_PAN);
  await pickItem(p, 'Pico de Gallo');
  eq(await p.textContent('#qty'), '4', '240 oz batch ÷ 60 oz per pan = 4 labels');
  assert(/One label per pan: 1\/3 pan 6", 60 oz each\. One batch \(240 oz\) fills 4 pans\. Par: 4 pans\./.test(await p.textContent('#panNote')), 'standard shown: ' + await p.textContent('#panNote'));
  assert(/1\/3 PAN 6"/.test(await p.textContent('#lI')), 'pan on the preview');
  await p.click('#qMinus');
  await p.click('#printBtn'); await p.waitForTimeout(150);
  assert(!(await p.isVisible('#bcSheet')), 'no batch question');
  await p.waitForFunction(() => /Printed/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
  const z = formats(await zpl(p));
  eq(z.length, 3, 'one label per pan');
  assert(z.every(f => /\^FB\d+,1,0,R\^FD1\/3 PAN 6"\^FS/.test(f) && /\^FDBY MARIA\^FS/.test(f)), 'pan bottom right, name bottom left');
  await p.waitForTimeout(300);
  eq(got.length && got[got.length - 1]['entry.1833039941'], 'labels page · 3 × 1/3 pan 6" · 60 oz each = 180 oz', 'log carries pans and amount');
  // an item with no pan standard prints as before, no question, no pan line
  await pickItem(p, 'Lettuce'); eq(await p.textContent('#qty'), '1', 'starts at 1');
  assert(await p.isHidden('#panNote'), 'no pan note');
  await printAndWait(p, /Printed/);
  assert(!/,R\^FD/.test(formats(await zpl(p)).pop()), 'no pan line');
  eq(p.errors.join(), '', 'no script errors');
  await p.close2();
});

test('Pans: Prep List and Recipe Book print one label per pan, starting at one batch; Cancel prints nothing', async () => {
  const p = await open({ ...REMEMBERED, getDevices: true });
  await p.evaluate(PICO_PAN);
  await p.click('#plBtn'); await p.waitForTimeout(200);
  await plPickItems(p, [['Toppings & Prep', 'Pico de Gallo']]);
  await p.click('#pl tr[data-k="pico de gallo"] .plp'); await p.waitForSelector('#bcSheet:not([hidden])');
  eq(await p.textContent('#bcN'), '4', 'starts at the pans in one batch');
  assert(/= 240 oz/.test(await p.textContent('#bcAmt')) && /Print 4 labels/.test(await p.textContent('#bcOk')), 'shows oz and label count');
  await p.click('#bcCancel'); await p.waitForTimeout(200);
  eq(formats(await zpl(p)).length, 0, 'cancel prints nothing');
  await p.click('#pl tr[data-k="pico de gallo"] .plp'); await p.waitForSelector('#bcSheet:not([hidden])'); await p.click('#bcPlus'); await p.click('#bcOk');
  await p.waitForFunction(() => /Printed/.test(document.getElementById('toast').textContent), null, { timeout: 30000 });
  eq(formats(await zpl(p)).length, 5, 'five pans, five labels');
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
    } catch (e) { if (process.env.DEBUG) console.log(e.stack);
      failed++;
      console.log(`  FAIL  ${t.name}\n        ${e.message.split('\n')[0]}`);
    }
  }
  await browser.close(); server.close();
  console.log(failed ? `\n${failed} check(s) FAILED` : `\nAll ${tests.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
