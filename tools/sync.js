// Keeps the staff link (this repo on GitHub Pages) and the Claude artifacts identical, both directions.
//
// Sources of truth in the repo:
//   index.html                  the label page (staff link)
//   artifacts/recipe-book.html  mirror of the Claude Recipe Book (ARTIFACTS.book)
// Made from them, never edited by hand:
//   recipes.html                the Recipe Book copy in the staff link = book + tools/book-patches.json
//   the Prep Labels artifact    (ARTIFACTS.labels) = index.html from <title> to </body>, plus recipes.html
// artifacts/published.json holds a hash of what each artifact held at the last sync, so `status` can tell
// which side changed: the artifact (pull it into the repo) or the repo (publish it), or both (conflict).
//
//   node tools/sync.js build                       regenerate recipes.html; write the publish files to .sync/
//   node tools/sync.js status <book> <labels> <labels-recipes>   compare artifact reads (Artifact tool saves)
//   node tools/sync.js pull   <book> <labels> <labels-recipes>   bring artifact edits into the repo, then build
//   node tools/sync.js mark                        record the repo's current output as published
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const P = f => path.join(ROOT, f);
const ARTIFACTS = {
  book: 'https://claude.ai/artifact/6o8JrPZsbJkYeFggZnd58w',     // Recipe Book (original, with shared Data Needed)
  labels: 'https://claude.ai/artifact/MQuRyZNgYr9HPpFo5dL6hb'    // Prep Labels copy, with recipes.html as a file
};
const VIEWPORT_META = '<meta name="claude:viewport-fit-sides" content="cover">';
const PATCHES = JSON.parse(fs.readFileSync(P('tools/book-patches.json'), 'utf8'));

const norm = s => String(s).replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';
const hash = s => crypto.createHash('sha256').update(norm(s)).digest('hex').slice(0, 16);
const read = f => fs.readFileSync(P(f), 'utf8');

// The Artifact tool saves a page inside a small document skeleton; take the page back out of it.
function unwrap(s) {
  s = String(s);
  if (/^<!doctype html><html><head><meta charset=utf8>/i.test(s) && s.includes('<body>\n') && s.includes('</body></html>'))
    s = s.slice(s.indexOf('<body>\n') + 7, s.lastIndexOf('</body></html>'));
  return norm(s);
}

function replaceOnce(s, from, to, what) {
  const n = s.split(from).length - 1;
  if (n !== 1) throw new Error(`book patch "${what}" matched ${n} times; update tools/book-patches.json by hand`);
  return s.replace(from, () => to);
}
const block = (anchor, lines) => [anchor].concat(lines).join('\n') + '\n';
function bookToCopy(book) {
  return PATCHES.reduce((s, p) => replaceOnce(s, block(p.anchor, p.original), block(p.anchor, p.copy), p.why), norm(book));
}
function copyToBook(copy) {
  return PATCHES.slice().reverse().reduce((s, p) => replaceOnce(s, block(p.anchor, p.copy), block(p.anchor, p.original), p.why), norm(copy));
}

// index.html <-> Prep Labels artifact page (from the <title> line up to </body>, with Claude's viewport meta)
function bodyRange(index) {
  const a = index.indexOf('\n<title>') + 1, b = index.lastIndexOf('\n</body>') + 1;
  if (a < 1 || b < 1) throw new Error('index.html has no <title> ... </body> lines');
  return [a, b];
}
function labelsPage(index) {
  const [a, b] = bodyRange(index), lines = index.slice(a, b).split('\n');
  lines.splice(1, 0, VIEWPORT_META);
  return norm(lines.join('\n'));
}
function labelsFromPage(page, index) {
  const [a, b] = bodyRange(index);
  const body = norm(page).split('\n').filter(l => l !== VIEWPORT_META).join('\n');
  return index.slice(0, a) + body + index.slice(b);
}

function bumpVersion(index) {
  const d = new Date(), today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return index.replace(/const APP_VERSION = "([^"]+)";/, (m, v) => {
    const k = v.startsWith(today + '.') ? +v.split('.').pop() + 1 : 1;
    return `const APP_VERSION = "${today}.${k}";`;
  });
}

// what each artifact should hold now, from the repo
function outputs() {
  const recipes = bookToCopy(read('artifacts/recipe-book.html'));
  return { book: norm(read('artifacts/recipe-book.html')), labels: labelsPage(read('index.html')), labelsRecipes: recipes };
}
function build() {
  const o = outputs();
  fs.writeFileSync(P('recipes.html'), o.labelsRecipes);
  fs.mkdirSync(P('.sync'), { recursive: true });
  fs.writeFileSync(P('.sync/recipe-book.html'), o.book);
  fs.writeFileSync(P('.sync/prep-labels.html'), o.labels);
  fs.writeFileSync(P('.sync/recipes.html'), o.labelsRecipes);
  return o;
}
const published = () => JSON.parse(fs.readFileSync(P('artifacts/published.json'), 'utf8'));
function mark() {
  const o = outputs();
  fs.writeFileSync(P('artifacts/published.json'), JSON.stringify({ book: hash(o.book), labels: hash(o.labels), labelsRecipes: hash(o.labelsRecipes) }, null, 2) + '\n');
}
function status(live) {
  const o = outputs(), last = published(), res = {};
  for (const k of ['book', 'labels', 'labelsRecipes']) {
    const L = hash(live[k]), R = hash(o[k]), B = last[k];
    res[k] = L === R ? 'in sync' : L === B ? 'publish' : R === B ? 'pull' : 'conflict';
  }
  return res;
}
function pull(live) {
  const st = status(live);
  if (Object.values(st).includes('conflict')) throw new Error('both sides changed: ' + JSON.stringify(st) + ' — merge by hand');
  if (st.book === 'pull' && st.labelsRecipes === 'pull' && hash(copyToBook(live.labelsRecipes)) !== hash(live.book))
    throw new Error('the Recipe Book and the Prep Labels copy of it were both edited differently — merge by hand');
  if (st.book === 'pull') fs.writeFileSync(P('artifacts/recipe-book.html'), norm(live.book));
  else if (st.labelsRecipes === 'pull') fs.writeFileSync(P('artifacts/recipe-book.html'), copyToBook(live.labelsRecipes));
  let index = read('index.html');
  if (st.labels === 'pull') index = labelsFromPage(live.labels, index);
  if (st.labels === 'pull' || st.book === 'pull' || st.labelsRecipes === 'pull') fs.writeFileSync(P('index.html'), bumpVersion(index));
  build();
  // the artifacts now hold what was just pulled; whatever the repo makes that differs from it is to publish
  fs.writeFileSync(P('artifacts/published.json'), JSON.stringify({ book: hash(live.book), labels: hash(live.labels), labelsRecipes: hash(live.labelsRecipes) }, null, 2) + '\n');
  return status(live);
}

module.exports = { ARTIFACTS, unwrap, bookToCopy, copyToBook, labelsPage, labelsFromPage, outputs, published, hash, status, bumpVersion };

if (require.main === module) {
  const [cmd, ...files] = process.argv.slice(2);
  const live = () => {
    if (files.length !== 3) throw new Error('give the three saved artifact reads: <book> <labels> <labels-recipes>');
    const [book, labels, labelsRecipes] = files.map(f => unwrap(fs.readFileSync(f, 'utf8')));
    return { book, labels, labelsRecipes };
  };
  try {
    if (cmd === 'build') { build(); console.log('built recipes.html and .sync/ (recipe-book.html, prep-labels.html, recipes.html)'); }
    else if (cmd === 'status') console.log(JSON.stringify(status(live())));
    else if (cmd === 'pull') console.log(JSON.stringify(pull(live())));
    else if (cmd === 'mark') { mark(); console.log('artifacts/published.json updated'); }
    else { console.log('usage: node tools/sync.js build | status <book> <labels> <labels-recipes> | pull <...same> | mark'); process.exit(2); }
  } catch (e) { console.error('sync: ' + e.message); process.exit(1); }
}
