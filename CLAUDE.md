# Yardery Prep Labels — rules for anyone changing this repo

The kitchen depends on this page to print legally required date labels. Keep it working.

1. **Run the checks before every push:** `npm test` (needs `npm install` once; set `CHROMIUM_PATH` to use a
   local Chromium). Push only when every check passes. GitHub runs the same checks on every push and
   every morning (`.github/workflows/checks.yml`) and emails the owner when one fails.
2. **Every bug fix gets a check** in `tests/run.js` that fails without the fix. Prove it fails first
   (put the bug back, run, see FAIL), then restore the fix.
3. **Printer controls never fail silently.** Connect printer, Print and setup's Connect must always show a
   result (list opens, toast, or status). A user tap never waits behind a background connection attempt.
   Don't add an early `return` to those handlers without a visible message.
4. **Label output is fixed:** one `^XA…^XZ` format per label, `^PQ1`, `^XB` on every label but the last,
   `^MN` gap sync, 1"×1" (`^PW203`/`^LL203` at 203 dpi). The owner approved this layout as centered.
5. **Shelf lives** in `SHELF_DAYS` are manager-approved; change them only when the owner says so, and keep
   the Recipe Book (`recipes.html` and the Claude original) in step. Prep day = day 1; Frozen & Thawing
   items: the day it goes in doesn't count.
6. `recipes.html` is **generated** from `artifacts/recipe-book.html` (mirror of the Claude Recipe Book) by
   `node tools/sync.js build`; never edit it by hand. Its in-app differences are in `tools/book-patches.json`.
7. **Bump `APP_VERSION`** (near the Recipe Book code in `index.html`) on every change to `index.html` or
   `recipes.html`. Open tablets compare it with the server every 5 minutes and reload when idle; without a
   bump, devices that never close the app keep the old version.
8. **Prep list doc stays in step with the label buttons.** Whenever a label button is added, renamed, removed or
   its shelf life changes, update the Google Doc "Yardery Sanford — Line Item Prep List"
   (id `15GWG2fqwkSGYDuniQI_gNhSUw4pXfIPPDSCz6zbedCQ`) in place with the Google Docs connector: same link,
   grids only (section heading + table, no other text), columns Item | Shelf life | Par | On Hand | Prep |
   Initials | Notes (Line Set table has no Shelf life column), items alphabetical within each section (Line Set and Frozen & Thawing
   follow the app's order), Item column
   150pt. Never create a new doc. If the Docs connector isn't available, tell the owner the doc still needs the change.
   The in-app Prep List builds itself from the same data; par levels live in `PARS` (owner-set only).
9. **The Claude artifacts and the staff link are always identical, both directions (owner rule, 100% of the time).**
   `tools/sync.js` does the work; README "Keeping Claude and the staff link the same" has the exact steps.
   - **Start every task with a sync check:** Artifact read with a path saves the file without loading it into the
     conversation: Recipe Book https://claude.ai/artifact/6o8JrPZsbJkYeFggZnd58w path `index.html`, Prep Labels
     https://claude.ai/artifact/MQuRyZNgYr9HPpFo5dL6hb paths `index.html` and `recipes.html`. (A read with no path is
     needed only right before publishing to that artifact.) Run
     `node tools/sync.js status <book> <labels> <labels-recipes>` and `pull` if anything says "pull".
   - **Change** the label page in `index.html`, the Recipe Book in `artifacts/recipe-book.html`. Then `node tools/sync.js build`,
     `npm test`, publish `.sync/recipe-book.html` to the Recipe Book url (omit capabilities) and `.sync/prep-labels.html` with
     files `{"recipes.html": ".sync/recipes.html"}` to the Prep Labels url, `node tools/sync.js mark`, commit, push.
     The check "Sync: the Claude artifacts were published" fails until that's done.
   - "conflict" = both sides changed: merge by hand, never overwrite either one, and tell the owner.
   - The hourly scheduled task "Yardery labels sync" runs the same check and fixes drift on its own.
