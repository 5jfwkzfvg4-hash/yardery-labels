# Yardery Prep Labels

Prints 1" x 1" prep labels (item, made date/time, use-by day and date, initials) to the kitchen Zebra printer over Bluetooth.

**Printing link:** https://5jfwkzfvg4-hash.github.io/yardery-labels/

## Use it
- **Android tablet:** open the link in Chrome.
- **iPad:** open the link in the free Bluefy app (Safari/Chrome on iPad can't reach Bluetooth printers).
- Tap **Connect printer**, pick the Zebra, then pick an item and print. The ? button in the app has full steps.

## Change it
Everything lives in `index.html`. Near the top of the `<script>`:
- `LOCATION` – store name and printing link (change for a new store/franchise).
- `ITEMS` – prep items (from the Recipe Book).
- `SHELF_DAYS` – KM-approved shelf life per item (approved 2026-10-14), e.g. `"pico-de-gallo":3`. Keep it matching the Recipe Book.
- `ITEM_NOTES` – extra instruction shown when an item is picked (e.g. Fried Onions 4-hour rule). Prep day counts as day 1; cold-held ready-to-eat food maxes at 7 days (FL Admin. Code 61C-4.010 / FDA Food Code 3-501.17).
- **Prep List** screen (owner rules, 2026-10-18; updated 2026-10-21): the list starts empty every day; anyone picks today's
  items one by one (or a whole section) from every label item, or adds a new item (it goes on today's list and stays
  pickable for good); nobody can remove a picked item or un-check it; an item is done only when a label prints for it (any
  screen), showing who and when. Devices share it through the print log: the Form gets every print, every "prep pick"
  (item + section) and every "prep add", and the sheet's **Prep Feed** tab (today's and yesterday's prints and picks + all
  added items) is read back as published CSV from `PREP_FEED_URL`. `RECIPE_PAGES` (items with a
  Recipe Book page, linked from the list) must equal the book's `PREP_LABEL_IDS`. Each day is archived to Drive folder
  "Prep List Archive" by `tools/prep-archive.js` (`node tools/prep-archive.js <form-responses.json> <M/D/YYYY>`).
- **Custom labels, not buttons yet** (Clay 2026-10-21): every dated custom label printed is listed at the bottom of the
  label page (name, usual shelf life, times printed, last by) until a button with that name exists, so the owner can pick
  which to add for good. Text-only labels aren't listed. Source: this device's prints + the feed's `custom` prints.
- **Recipe Book PDF** (Clay 2026-10-22): `npm run pdf` (`tools/book-pdf.js`) prints every page of `recipes.html` except
  Data Needed into `Yardery-Recipe-Book.pdf` (Letter, contents links work), served at the staff link
  `/Yardery-Recipe-Book.pdf`. Rebuild and commit it after every Recipe Book change.
- **Pans** (Clay 2026-10-23/24): per label item the pan it's stored in, oz per pan, batch yield and par in pans (`STORAGE`,
  `YIELDS`). Each printed label is one pan: printing starts the label count at the pans one batch fills (yield ÷ oz per pan).
  The pan prints bottom right on the label and the log gets "N × pan · oz each = total oz".
- **Manager** (Clay 2026-10-24, 🔒 in the header, PIN): edit/add/remove labels (name, section, shelf life, note, pan, oz, par,
  batch yield, Line Flip), allow/deny devices, change the PIN. Changes apply on that device at once and log an "admin" row
  (Source `admin {op JSON}`); the daily sync's `node tools/admin.js apply <form-responses.json>` adds them to `SITE.ops` in
  `index.html` so every device gets them, rebuilds `SITE.users` and copies yields into the Recipe Book (CLAUDE.md rule 12).
  `SITE.pin` stores only a SHA-256 hash; it keeps cooks out, it is not bank-grade security.
- `YIELDS` – batch yield per item, kept equal to the Recipe Book's `BATCH_YIELDS` by a check.

Bump `APP_VERSION` in `index.html` with every change (including `recipes.html`), then commit to `main`. The link updates in about a minute, and tablets that leave the app open pick it up within about 5 minutes once nobody is using the screen (or right away when the app is reopened).

## Recipe Book
`recipes.html` is a copy of the Recipe Book (original in Claude: https://claude.ai/artifact/6o8JrPZsbJkYeFggZnd58w).
The **Recipes** button opens it over the label page so the printer stays connected; **Print prep label** in a recipe
prints one label right away without leaving the page. Differences from the original: label buttons print in place,
a **Labels** button shows when `recipes.html` is opened on its own, and **Data Needed** is read-only here
(its shared saving only works inside Claude). Those changes live in `tools/book-patches.json`; `recipes.html` is
generated, so never edit it by hand (see below).

## Keeping Claude and the staff link the same
The owner's rule: an edit in either place shows up in the other, every time.
- **In the repo:** `index.html` (label page) and `artifacts/recipe-book.html` (mirror of the Claude Recipe Book) are the
  sources. `recipes.html` and the Prep Labels artifact are made from them by `node tools/sync.js build`.
- **In Claude:** Recipe Book https://claude.ai/artifact/6o8JrPZsbJkYeFggZnd58w and Prep Labels
  https://claude.ai/artifact/MQuRyZNgYr9HPpFo5dL6hb (its page + `recipes.html`).
- `artifacts/published.json` remembers what each artifact held at the last sync, so `node tools/sync.js status`
  can say per artifact: **in sync**, **publish** (the repo changed), **pull** (the artifact was edited in Claude), or
  **conflict** (both changed: merge by hand).
- Repo change: `node tools/sync.js build` → `npm test` → publish `.sync/recipe-book.html` and `.sync/prep-labels.html`
  (+ `recipes.html` from `.sync/`) → `node tools/sync.js mark` → commit and push.
- Edit made in Claude: read both artifacts with the Artifact tool → `node tools/sync.js pull <book> <labels> <labels-recipes>`
  (bumps `APP_VERSION`) → `npm test` → publish whatever `status` still says "publish" → `mark` → commit and push.
- A scheduled task ("Yardery labels sync") does this every hour from 6 AM to 11 PM.

## Automatic checks
`npm install` once, then `npm test` runs every check in `tests/run.js` against a simulated Zebra ZD411:
connecting (including the "Connect printer does nothing" bug of 2026-10-17), sharing the printer between
devices, label content/dates/feed, setup and names, the Recipe Book, layout on phones and tablets, and the
manager log. GitHub runs them on every push and every morning at 6 AM Eastern and emails the owner if any
fail (Actions tab shows the details). Rules for changes are in `CLAUDE.md`.
