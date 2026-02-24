# P0 Deploy diagnostika – výsledek (24. 2. 2026)

## Gate 0: Safe start ✅
- `main` aktuální, `git status` clean (jen untracked v artifacts/)

## Gate 1: Odkud GitHub Pages staví ✅
```json
"source": { "branch": "main", "path": "/" }
"build_type": "workflow"
```
- **Závěr:** Build jde z rootu větve `main`, ne z `/docs`, ne z `gh-pages`. Žádná záměna větve/složky.

## Gate 2: Obsah deploy artifactu ✅ (HARD PROOF)
- Run: `22363534725` (Merge pull request #595 – cache-bust)
- Artifact: `github-pages` → staženo do `deploy_artifact/`, rozbalený tar
- **Velikost v artifactu:** `deploy_artifact/assets/app.js` = **452 602 B**
- **Lokální repozitář:** `assets/app.js` = **452 602 B**

**Závěr:** Workflow **negeneruje** starý bundle. Artifact obsahuje správný (nový) soubor. Problém **není** v tom, že by pipeline bral jinou větev/složku nebo jiný build.

## Gate 3: Service worker ✅
- V `assets/app-crash-shield.js` je `registerSW()` na začátku **vypnutá** (`return;`), původní kód zakomentovaný.
- Žádná aktivní registrace `sw.js` → SW **nemůže** servírovat starý app.js.

## Gate 4: Build pipeline ✅
- Jediný deploy je `.github/workflows/pages.yml`: checkout → sed (cache-bust v HTML) → `upload-pages-artifact` s `path: "."` → `deploy-pages`.
- Žádný krok nebuildí, neminifikuje ani nekopíruje `app.js` jinde. Do artifactu jde přímo `assets/app.js` z checkoutu.

---

## Závěr diagnostiky

| Co jsme ověřili | Výsledek |
|-----------------|----------|
| Pages source    | main, / ✅ |
| Artifact app.js | 452 602 B ✅ |
| Lokální app.js  | 452 602 B ✅ |
| Service worker  | vypnutý ✅ |
| Jiný build step | žádný ✅ |

**Produkce vrací 450 665 B** i pro URL s cache-bustem (`app.js?v=9dc0c85c`).  
→ Jediné konzistentní vysvětlení: **GitHub Pages (nebo jejich CDN) cachuje podle cesty bez query stringu**, takže ` /assets/app.js` je jedna cache položka a `?v=...` se pro cache klíč ignoruje. Po deployi tedy může být stále servírován starý obsah z cache.

---

## Doporučená oprava (path-based cache bust)

Aby žádná CDN nemohla servírovat starý soubor, je potřeba měnit **cestu souboru**, ne jen query string:

1. V deploy workflow místo přepisování pouze `?v=` v HTML:
   - buď kopírovat `assets/app.js` → `assets/app.${ASSET_VER}.js` a v HTML odkazovat na `app.${ASSET_VER}.js`,
   - nebo ponechat `app.js` a přidat vedle něj např. symlink/kopii s názvem `app.${ASSET_VER}.js` a v HTML používat tento název.

2. Stejně pro `app.css` → `app.${ASSET_VER}.css` (volitelně, pro konzistenci).

3. V `projects/index.html` (a kde jinde se na app.js/app.css odkazuje) zůstanou placeholder hodnoty; workflow je při deployi přepíše na skutečné názvy s `ASSET_VER`, např.:
   - `src="/assets/app.ASSET_VER_PLACEHOLDER.js"` → sed na `app.9dc0c85c.js`.

Tím pádem každý deploy má jinou URL souboru a cache (včetně GitHub Pages / CDN) nemůže vrátit starý bundle.

---

## Povinný výstup (pro předání)

```text
gh api repos/Josefjosefjosef/filtr/pages
→ "source":{"branch":"main","path":"/"}, "build_type":"workflow"

gh run list --workflow "pages.yml" --limit 3
→ 22363534725 (Merge #595), 22363425720, 22363363874

Stažený artifact (run 22363534725):
  C:\projects\filtr\deploy_artifact\assets\app.js
  (Get-Item ...).Length = 452602

Lokální repozitář:
  C:\projects\filtr\assets\app.js
  Length = 452602
```

**Shrnutí:** Pipeline je v pořádku, artifact je správný. Problém je caching na straně GitHub Pages/CDN podle cesty. Řešení: path-based cache bust (`app.ASSET_VER.js` místo `app.js?v=ASSET_VER`).
