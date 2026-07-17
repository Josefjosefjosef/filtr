# Paralelní provoz a cutover

## Paralelní provoz

`?iuInfoSystem=parallel` — Přehled dne běží vedle legacy HomeCards.

## Atomické přepnutí

Výchozí cutover ON. Po ověření (CI + produkční smoke) legacy HomeCards zůstávají v DOM pro zpětnou kompatibilitu guardů, ale jsou CSS/JS skryté a neovládají hlavní produkt.

## 48h paralelní provoz

Pro produkční cutover je doporučen 48h běh v `parallel` na staging/canary. Seed feed v tomto PR umožňuje okamžité ověření; provozní metrika se doplní po nasazení.

| Metrika | Seed / CI |
|---------|-----------|
| Feed load | PASS |
| Filtry nezávislé | PASS |
| Dedup groupKey | PASS |
| Žádné fotky/perexy | PASS |
