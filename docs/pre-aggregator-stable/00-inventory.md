# Inventář otevřených PR — Variant C (2026-07-17)

**Pre-stabilization production SHA:** `1e47ac46d93147035730314716641f71b330fffd`  
**Audit time (UTC):** 2026-07-17T05:25:00Z  
**Verdict:** Skupina **A je prázdná** → stabilizace smí pokračovat.

## Metodika

- A — musí být dokončeno před stabilizací (blokuje baseline / produkční shodu / PWA / kritické regresní rizika)
- B — může počkat až po stabilizaci (data bot, deferred product fixes)
- C — zastaralé, duplicitní nebo nahrazené (zavřít bez merge)

## Skupina A — musí před stabilizací

*(prázdné)*

Poslední kritická položka `#7529` (PWA offline v4) je MERGED jako `1e47ac46…` a produkčně ověřena (Pages `29552693903`, `app.1e47ac46.js`, SW v4).

## Skupina B — po stabilizaci

| PR | Title | Mergeable | Důvod B |
|----|-------|-----------|---------|
| #7551 | chore(data): update articles data | MERGEABLE | Data Bot automation — nesmí blokovat UI freeze |
| #7550 | chore(data): fast publish publishable pool | MERGEABLE | Data Bot automation |
| #7343 | fix: stabilize mobile/tablet tasks filter button height | CONFLICTING | Deferred product UI; konflikt s main |
| #7338 | fix: auto-scroll PC left-rail opened section to header start | CONFLICTING | Deferred product UI |
| #7274 | fix: remove wrong email placeholder from custom buttons form | MERGEABLE | Low-risk deferred UX |
| #7270 | fix: show statni svatek label for state holidays in welcome meta | CONFLICTING | Deferred product UI |
| #6993 | fix: guard against disabled article publication workflows | MERGEABLE | Pipeline guard — po agregátorové baseline |
| #6937 | fix: defer AI YouTube embed src on mobile/tablet (Error 153) | CONFLICTING | Deferred embed policy |

## Skupina C — uzavřeno před stabilizací (výběr z Variant C cleanup)

Zavřeno jako stale/duplicitní/nahrazené mimo jiné: `#5162`, `#5155`, `#5142`, `#5034`, `#4872`, `#4870`, `#4868`, `#4865`, `#4700`, `#4511` (+ dřívější vlny stale PR z Variant C triage).

## Gate

```
GROUP_A_OPEN=0
STABILIZATION_ENTRY_ALLOWED=YES
```
