# Public Contacts Report

## Verdict: PASS (with documented exceptions)

## Public UI (`/projects/`)

| Location | Contact | Status |
|----------|---------|--------|
| Info Center → Provozovatel | info@infouzel.cz | ✅ |
| Info Center → Ochrana soukromí | info@infouzel.cz | ✅ |
| Provozovatel card | Media Uzel s.r.o., IČ 29482241, C 447292, účet 294822412/5500 | ✅ |
| DIČ / plátce DPH | Not displayed | ✅ |

## Out of Scope (documented, not changed)

| Location | Contact | Status |
|----------|---------|--------|
| `bot/index.html` | admin@infouzel.cz | NEEDS REVIEW — separate bot page |
| `projects/bot/index.html` | admin@infouzel.cz | NEEDS REVIEW |
| `scripts/update-weather-namedays.js` | admin@ (SMTP From) | Internal CI, not public UI |
| `scripts/build_weather_history.py` | admin@ | Internal |
| `scripts/articles-missing-source-articles-guard.mjs` | admin@ | Internal |

## Company Data Consistency

Required public operator block present in Info Center contact section:

- Media Uzel s.r.o.
- Kněžická 96, 190 12 Praha 9
- IČ: 29482241
- Spisová značka: C 447292
- Bankovní účet: 294822412/5500
- E-mail: info@infouzel.cz

## Recommendation

Future PR: unify `/bot/` contact to info@infouzel.cz if bot page remains public.
