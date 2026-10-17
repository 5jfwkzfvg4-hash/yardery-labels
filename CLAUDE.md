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
6. `recipes.html` is a copy of the Claude Recipe Book; see README for what differs.
7. **Bump `APP_VERSION`** (near the Recipe Book code in `index.html`) on every change to `index.html` or
   `recipes.html`. Open tablets compare it with the server every 5 minutes and reload when idle; without a
   bump, devices that never close the app keep the old version.
