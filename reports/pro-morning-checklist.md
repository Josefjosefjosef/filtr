# Pro morning checklist (autopilot)

Generated: 2026-02-10

## PR status

- PR #7 (runner standard): https://github.com/Josefjosefjosef/filtr/pull/7  
  Checks: guard pass — https://github.com/Josefjosefjosef/filtr/actions/runs/21848854091/job/63050797200

- PR #8 (CLS weather lock): https://github.com/Josefjosefjosef/filtr/pull/8  
  Checks: guard pass — https://github.com/Josefjosefjosef/filtr/actions/runs/21848245440/job/63048962297

- PR #9 (feed flicker): https://github.com/Josefjosefjosef/filtr/pull/9  
  Checks: guard pass — https://github.com/Josefjosefjosef/filtr/actions/runs/21849109813/job/63051546250

## Top 5 CSS reservations / min-heights

From `assets/app.css`:

1) `.iuDailyPanel` — `min-height: 140px` (daily panel reserve)  
   `assets/app.css` L614–L626

2) `.mindMenu-scroll-wrapper` — `min-height: 68px` (right column wrapper reserve)  
   `assets/app.css` L1336–L1346

3) `.iuDailyPanel [hidden]` — `display: none !important` (avoid layout gap)  
   `assets/app.css` L628–L630

4) `#rightColumn` (layout wrapper)  
   `assets/app.css` L124–L149

5) `.accordionCol .accContent` — `overflow` + transitions (accordion behavior; can affect layout)  
   `assets/app.css` L1440–L1445

## JS DOM mutation hotspots (feed + right column)

From `assets/app.js`:

- `renderSectionsBar()` — previously cleared via `innerHTML=""`, now should prefer atomic replacement  
  `assets/app.js` L1093–L1106 (see PR #9)

- `renderFeed(target, items)` — uses `replaceChildren(...)` for atomic updates (good baseline)  
  `assets/app.js` L1226–L1322

- Weather / nameday toggles (`hidden = true/false`) — can still affect layout if containers lack fixed heights  
  `assets/app.js` L3310–L3426

## Next 3 suggested steps (audit-only)

1) Run `?debug=1` and capture CLS sources (PerformanceObserver) on a cold reload.
2) If right column still jumps: add conservative height reservation for any remaining dynamic modules (CSS only).
3) If feed still flickers: ensure there are no other "clear then append" patterns in `assets/app.js` beyond sections bar.

