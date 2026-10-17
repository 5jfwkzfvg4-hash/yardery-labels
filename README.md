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
- `PARS` – par level per item for the **Prep List** screen, e.g. `"pico-de-gallo": [2, "qt"]` (Line Set items use their name). Owner-set only. Staff count On Hand; Prep = par − on hand; each row prints its label. Counts stay on that device for the day.
- `YIELDS` – batch yield per item, copied from the Recipe Book's `BATCH_YIELDS` (a check keeps them equal). Printing an item with a yield asks how many batches were made; the log records batches and batches × yield. Until the Google Form has "Batches" and "Amount Made" questions (`LOG.fields.batches` / `made`), they are added to the Source column.

Bump `APP_VERSION` in `index.html` with every change (including `recipes.html`), then commit to `main`. The link updates in about a minute, and tablets that leave the app open pick it up within about 5 minutes once nobody is using the screen (or right away when the app is reopened).

## Recipe Book
`recipes.html` is a copy of the Recipe Book (original in Claude: https://claude.ai/artifact/6o8JrPZsbJkYeFggZnd58w).
The **Recipes** button opens it over the label page so the printer stays connected; **Print prep label** in a recipe
prints one label right away without leaving the page. Differences from the original: label buttons print in place,
a **Labels** button shows when `recipes.html` is opened on its own, and **Data Needed** is read-only here
(its shared saving only works inside Claude). When the original Recipe Book changes, re-copy it into
`recipes.html` and re-apply those three changes.

## Automatic checks
`npm install` once, then `npm test` runs every check in `tests/run.js` against a simulated Zebra ZD411:
connecting (including the "Connect printer does nothing" bug of 2026-10-17), sharing the printer between
devices, label content/dates/feed, setup and names, the Recipe Book, layout on phones and tablets, and the
manager log. GitHub runs them on every push and every morning at 6 AM Eastern and emails the owner if any
fail (Actions tab shows the details). Rules for changes are in `CLAUDE.md`.
