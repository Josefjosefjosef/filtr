# Silver `calendar.read` — locked contract (P0)

**Engine:** `window.iuSilverCalendarEngine`  
**Probe (tests):** `calendarReadProbe(text, { now, events })`  
**Fixed clock in regression:** `2026-03-27T12:00:00` (local)

## Intent split

- **`calendar.create`** — unchanged; runs when `tryParseCalendarRead` returns `null` and existing `hasCalendarIntent` / session applies.
- **`calendar.read`** — deterministic patterns only (`co mám`, `kdy mám`, `kolik mám`, `mám schůzku s`, next-event phrases). Strong create verbs (`ulož`, …) suppress read.

## Query types (P0)

| Type | Example |
|------|---------|
| `agenda_for_day` | „co mám dnes“, „co mám zítra“ |
| `agenda_for_range` | „co mám tento týden“ |
| `next_event` | „co mám jako další“, „kdy mám další událost“ |
| `find_by_title` | „kdy mám zubaře“, „mám schůzku s …“ |
| `count_events` | „kolik mám dnes událostí“ |

## Answer bundle

`readAnswer`: `{ success, type, count, events, message, ambiguity }` — no invented events; empty calendar → empty `events` and fixed copy.

## Retrieval

UI passes `getEventsSnapshot()` from `iuCalendarService.calendarGetEventsSnapshot()` (read-only sorted copy).

## Regression

```bash
npm run silver-read-regression
```
