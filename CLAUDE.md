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
   **Sharing (owner, 2026-10-23):** no device keeps the printer. Print connects by itself (remembered printer, no list),
   prints, and lets go `HOLD_MS` (4 s) after the last print; a busy printer is retried. Never auto-connect on open or on taps.
4. **Label output is fixed:** one `^XA…^XZ` format per label, `^PQ1`, `^XB` on every label but the last,
   `^MN` gap sync, 1"×1" (`^PW203`/`^LL203` at 203 dpi). The owner approved this layout as centered, and (2026-10-24)
   the pan size bottom right when the item has a pan standard. **One label = one pan** (owner, 2026-10-24): no batch question.
5. **Shelf lives** in `SHELF_DAYS` are manager-approved; change them only when the owner says so, and keep
   the Recipe Book (`recipes.html` and the Claude original) in step. Prep day = day 1; Frozen & Thawing
   items: the day it goes in doesn't count.
6. `recipes.html` is **generated** from `artifacts/recipe-book.html` (mirror of the Claude Recipe Book) by
   `node tools/sync.js build`; never edit it by hand. Its in-app differences are in `tools/book-patches.json`.
   After any Recipe Book change, rebuild the PDF copy with `npm run pdf` (writes `Yardery-Recipe-Book.pdf`, served on
   the staff link) and commit it with the change.
7. **Bump `APP_VERSION`** (near the Recipe Book code in `index.html`) on every change to `index.html` or
   `recipes.html`. Open tablets compare it with the server every 5 minutes and reload when idle; without a
   bump, devices that never close the app keep the old version.
8. **Prep list doc stays in step with the label buttons.** Whenever a label button is added, renamed, removed or
   its shelf life changes, update the Google Doc "Yardery Sanford — Line Item Prep List"
   (id `15GWG2fqwkSGYDuniQI_gNhSUw4pXfIPPDSCz6zbedCQ`) in place with the Google Docs connector: same link,
   grids only (section heading + table, no other text), columns Item | Shelf life | Par | On Hand | Prep |
   Initials | Notes (Line Flip Labels table has no Shelf life column), items alphabetical within each section (Line Flip Labels and Frozen & Thawing
   follow the app's order), Item column
   150pt. Never create a new doc. If the Docs connector isn't available, tell the owner the doc still needs the change.
   The in-app Prep List builds itself from the same data.
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
   - The scheduled task "Yardery labels sync" runs the same check once a day (5:55 am Eastern) and fixes drift on its own.
     **Owner rule (2026-10-24): sync only once a day, when the owner asks, or as part of a change he asks for.**
10. **Prep List rules (owner, 2026-10-18; updated 2026-10-21):** the list starts empty every day and anyone picks today's items
    individually from every label item (or adds a new item, which stays pickable for good); nobody can remove a picked item or
    un-check one (no remove/undo/uncheck controls, ever); an item is complete only when a label prints for it, and shows
    who printed it and when (first print of the day). Every item with a Recipe Book page links to it. Each day is archived
    (`tools/prep-archive.js`, Drive folder "Prep List Archive" id `1p7Fg1TkNJGr0crpQgfhFqHjs9PQGkaXY`).
11. **Manager page (owner, 2026-10-24):** the 🔒 button opens a PIN-protected Manager (labels: edit/add/remove any label,
    shelf life, section, note, pan, oz per pan, par, batch yield, Line Flip; users: allow/deny devices; settings: change PIN).
    Cooks can't change labels anywhere else. `SITE.pin` holds only the SHA-256 of `"yardery-manager:" + PIN`, never the PIN.
    Each change saves on that device right away and logs an "admin" row to the print log sheet "Yardery Sanford — Prep Label
    Print Log" (id `1X6J9WJorpDE-PzZTXGPzjBFfw1d_QgGHfqLIWIs2Lc4`, tab "Form Responses 1").
    **Live (owner, 2026-10-24):** every device reads new "admin" rows from the sheet's "Prep Feed" tab (published CSV,
    `PREP_FEED_URL`) every minute and reloads when idle, so changes reach everyone within minutes; the feed's formula must keep
    the "admin" rows. Never put the PIN itself in the repo, a test, a commit or a doc.
12. **On every sync run** (and every change task): read `'Form Responses 1'!A:K` with the Sheets connector, save it to a file,
    run `node tools/admin.js apply <file>`. If it printed any ops or `usersChanged`: `node tools/sync.js build`, `npm test`,
    publish both artifacts, `mark`, commit, push. For each `doc` line update the Google Doc prep list (rule 8); for each
    shelf-life change make the Recipe Book text match (rule 5). Raise every `warn` line with the owner (a shelf life past
    7 days, a change from a device that isn't his, a PIN change); never undo his change yourself. Tell the owner what changed
    (never customer data).
13. **Daily review (owner, 2026-10-24), part of the 5:55 am sync:** full `npm test`; open the staff link's data (labels,
    shelf lives vs the Recipe Book, Line Flip set, pans/yields, Prep Feed rows and formula, users list) and look for anything
    wrong or inconsistent; fix real bugs (with a check, rule 2) and report them; list suggestions but ask before building them.
