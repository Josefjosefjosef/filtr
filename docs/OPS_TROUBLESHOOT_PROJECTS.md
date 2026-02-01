# OPS – TROUBLESHOOT /projects/

## CÍL
Rychle ověřit, že `/projects/` a `/projects/?debug=1` dostávají aktuální data (`/projects/data/*.json`) bez interference SW nebo cache.

## CHECKLIST
1. **Otevři `/projects/data/articles.json` (např. v prohlížeči nebo přes curl).**
   - HTTP 200? Pokud 404/403, nasazení feedu chybí.  
   - `Content-Type` by měl obsahovat `application/json`.  
   - Výstup začíná `{` a obsahuje `articles` jako pole. Pokud místo toho přijde HTML (`<!doctype` / `<html`), je to 404/redirect strana.
2. **Otevři `/projects/data/videos.json`.**
   - HTTP 200 + `videos` pole. Chybové kódy nebo HTML indikovují chybějící build.
3. **Kontrola `/projects/data/feed_health.json` a `/projects/data/_probe.txt`.**
   - `feed_health.json` by měl být JSON s `feeds` objektem a `updatedAt`.  
   - `_probe.txt` by měl obsahovat `probe-ok ...`; pokud chybí, pipeline neudělala diagnózu.
4. **Na `/projects/?debug=1` sleduj debug panel (`logy` nebo nový FORCE DIAG).**
   - Měly by být vidět statusy `/projects/data` endpointů a head (120 znaků).  
   - Pokud se zobrazí HTML/ERR, je problém v deployi (404, přesměrování, CORS).
5. **Zkontroluj SW/cache:**
   - V `assets/app-crash-shield.js` je SW registrace short-circuitovaná (`return;`). SW tedy nyní ničemu nebrání. Pokud by byl `return` odstraněn, registrace by ovlivnila `/projects/data/*`.
6. **Zkontroluj GitHub Pages workflow (`.github/workflows/pages.yml`).**
   - `Sanity check` potvrzuje, že `assets/`, `data/`, `sw.js` existují. Pokud `data/articles.json` chybí, GH Pages stále povolí push, takže potvrď přítomnost dat tam.

## INTERPRETACE
- HTTP 404/403: backend data chybí/není publikováno → rebuild data pipeline.  
- `Content-Type` `.html`: server vrací HTML (404 nebo přesměrování) místo JSON → pravděpodobně chybějící soubor nebo CORS redirect.  
- `head` začínající `<!doctype`/`<html`: opět 404/stránka; tento text bude viditelný v debug panelu i bez DevTools.  
- `head` prázdný nebo „ERR“: síťová chyba (timeout, CORS, blokace).  
- `/projects/?debug=1` by měl stav ukazovat jasně – pokud se panel neukáže, load se zastavil před spuštěním debug skriptu (např. JS vůbec nebootoval).
