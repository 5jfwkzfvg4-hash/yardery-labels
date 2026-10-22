// Recipe Book as one PDF (Clay 2026-10-22): every page of recipes.html, one per sheet, Letter size, with working
// table-of-contents links. Opens, saves, prints and forwards on any phone, tablet or computer.
//   node tools/book-pdf.js            -> Yardery-Recipe-Book.pdf (served on the staff link next to index.html)
// Run it after every Recipe Book change (after `node tools/sync.js build`). Needs `npm install`; set CHROMIUM_PATH
// to use a local Chromium. The Data Needed page (a live fill-in checklist) and on-screen buttons are left out.
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'Yardery-Recipe-Book.pdf');

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 816, height: 1056 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + path.join(ROOT, 'recipes.html'));
  await page.waitForFunction(() => typeof PAGES === 'object' && typeof renderPage === 'function');
  await page.waitForTimeout(500);

  const n = await page.evaluate(() => {
    const stage = document.getElementById('stage'), skip = new Set(['dataneeded']);
    const parts = [];
    PAGES.forEach((p, i) => {
      if (skip.has(p.type)) return;
      renderPage(i);
      parts.push('<section class="pdfpage" id="p' + i + '">' + stage.innerHTML + '</section>');
    });
    stage.innerHTML = parts.join('');
    // in-book links ("go to page") become PDF links; links to a skipped page become plain text
    stage.querySelectorAll('[data-goto]').forEach(el => {
      const t = el.getAttribute('data-goto'); if (!document.getElementById('p' + t)) return;
      if (el.tagName === 'BUTTON') {             // a button becomes a link with the same look
        const a = document.createElement('a'); a.href = '#p' + t;
        [...el.attributes].forEach(x => { if (!/^(data-goto|type|tabindex|role)$/.test(x.name)) a.setAttribute(x.name, x.value); });
        a.innerHTML = el.innerHTML; el.replaceWith(a);
      } else {                                   // a heading or row keeps its tag (and its styles); its contents become the link
        const a = document.createElement('a'); a.href = '#p' + t; a.className = 'pdflink';
        while (el.firstChild) a.appendChild(el.firstChild); el.appendChild(a);
      }
    });
    const css = document.createElement('style');
    css.textContent = `
      html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
      body > *:not(.app):not(style):not(script), .topbar, .searchrow, .catrow, .bottomnav, .upd-card, .startbtn, .dn-cover-btn, .dn-banner,
        .labelbtn, .batchpop, .toast, .scrim, [hidden] { display: none !important; }
      .app, .stage-wrap, .stage { position: static !important; height: auto !important; overflow: visible !important;
        transform: none !important; opacity: 1 !important; display: block !important; }
      .pdfpage { break-after: page; } .pdfpage:last-child { break-after: auto; }
      .page { min-height: 0 !important; }
      .page.cover { min-height: 9.5in !important; }
      .page-foot { break-before: avoid; break-inside: avoid; padding: 8px 12px 0 !important; }
      a { color: inherit; text-decoration: none; }
      a.pdflink { display: flex; width: 100%; align-items: inherit; justify-content: inherit; gap: inherit; }
      h1, h2, h3, h4 { break-after: avoid; } li, tr { break-inside: avoid; }`;
    document.head.appendChild(css);
    return parts.length;
  });
  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    path: OUT, format: 'Letter', printBackground: true, margin: { top: '0.4in', bottom: '0.5in', left: '0.4in', right: '0.4in' },
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    // the book's own page numbers (the ones the Contents uses) print on each page; the footer only dates the copy
    footerTemplate: '<div style="font:9px Arial;color:#666;width:100%;text-align:center">The Yardery Recipe Book · printed ' +
      new Date().toLocaleDateString('en-US') + '</div>'
  });
  await browser.close();
  if (errors.length) { console.error('page errors:\n' + errors.join('\n')); process.exit(1); }
  console.log(`wrote ${path.relative(ROOT, OUT)} (${n} book pages)`);
})().catch(e => { console.error(e); process.exit(1); });
