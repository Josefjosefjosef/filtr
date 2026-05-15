# Silver `calendar.create` — locked contract (P0)

**Engine:** `window.iuSilverCalendarEngine.processUserTurn(text, prevDraft, { now })`  
**Fixed clock in regression:** `2026-03-27T12:00:00` (local) — all expected dates/times are relative to this instant.

## Required fields (save-ready)

- **Datum** — `draft.meta.date === "certain"` and ISO in `draft.date`
- **Čas** — `draft.meta.time === "certain"` and `HH:MM` in `draft.time`
- **Název** — `draft.meta.title === "certain"` and non-empty trimmed `draft.title`

## States

- **`READY_TO_SAVE`** — all three required fields certain and non-empty title string.
- **`NEEDS_CLARIFICATION`** — at least one required field missing per `computeMissing()` / draft meta.

## Missing fields

`missingFields` array may contain `"date"`, `"time"`, `"title"` (subset of required).

## Warning UI (draft card view mode)

- Red **value** (`.iuSilverDraftV--warningMissing`) only for **Datum / Čas / Název** when that field is missing **and** `NEEDS_CLARIFICATION`.
- **Poznámka / Místo / Délka** never red solely from “empty optional” in this contract.
- Lead + clarification red only in clarification state (existing classes).

## Title policy

- Matching command/diagnostic tokens uses **folded** (`foldCs`) where applicable; **output title** stays user-shaped through pipeline (no invented titles).
- No aggressive Czech “fixes”; `iuSilverPolishTitleNoun` only applies existing small rules (e.g. known inflections).

## Parser policy

- Strip calendar command tokens including ASCII **`uloz`**, **`ulozit`**, and Unicode-safe boundaries for **`ulož` / `zapiš`** (see `iuSilverStripCommandBoilerplateIterative`).
- iOS/WebKit: warning value cells use **`color` + `-webkit-text-fill-color`** on `.iuSilverDraftV--muted.iuSilverDraftV--warningMissing`.

## Regression runner

```bash
npm run silver-regression
```

Reads `scripts/silver-calendar-create-corpus.json`, fails with exit code 1 on any mismatch.
