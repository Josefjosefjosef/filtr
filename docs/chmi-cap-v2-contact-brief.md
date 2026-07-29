# Kontaktní podklad pro ČHMÚ (NEODESÍLAT bez výslovného pokynu)

## Služba
- Název: InfoUzel.cz
- Účel: agregace a zobrazení oficiálních výstrah ČHMÚ uživatelům v rámci Přehledu dne / Počasí
- Provozovatel kontakt: info@infouzel.cz

## Zamýšlený endpoint
- Open data CAP adresář (metadata Geoportál CZ-00020699-CHMI-vystrahy):
  https://opendata.chmi.cz/meteorology/weather/alerts/cap/
- Licence dle metadat: CC BY 4.0
- Veřejná stránka pro uživatele: https://vystrahy-cr.chmi.cz/

## Technické chování (plán po potvrzení)
- Server-only synchronizace (žádné stahování CAP z prohlížečů návštěvníků)
- Interval: konzervativně 5–30 min (interní default; neprohlašujeme jako schválený limit ČHMÚ)
- Conditional GET na jednotlivé XML (ETag / Last-Modified); 304 bez reparse
- User-Agent: InfoUzel-CHMI-Sync/1.0 (+https://infouzel.cz/; contact: info@infouzel.cz)
- Backoff + respektování Retry-After
- Bez procházení celého archivu v každém cyklu
- Bez scrapingu HTML mapy / detailů webu ČHMÚ

## Otázky na ČHMÚ
1. Jaký kanonický způsob discovery aktuálního bulletinu doporučujete (bez HTML directory listingu jako API)?
2. Existuje current-only snapshot URL?
3. Jaký rate limit / doporučená frekvence?
4. Potvrzení CISORP valueName v geocode?

## Stav InfoUzel
- Nový CAP v2 parser běží zatím jen ve shadow/fixture režimu (feature flag off).
- Produkční frekvence stávajícího info-events jobu zatím nezvyšujeme.
