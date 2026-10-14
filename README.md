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
- `SHELF_DAYS` – manager-approved shelf life per item, e.g. `"pico-de-gallo": 3`. Prep day counts as day 1; cold-held ready-to-eat food maxes at 7 days (FL Admin. Code 61C-4.010 / FDA Food Code 3-501.17).

Commit to `main` and the link updates in about a minute.
