# Oprava GitHub Pages deploy - Shrnutí

## Problém

GitHub Pages používalo Jekyll build, který generoval dokumentační web z .md souborů místo SPA aplikace.

## Řešení

### 1. Vytvořen `.nojekyll` soubor (root repa)

**Soubor:** `.nojekyll` (prázdný soubor)

**Účel:** Vypne Jekyll pro GitHub Pages, takže Pages servíruje statické soubory as-is.

### 2. Vytvořen Pages workflow pro statický deploy

**Soubor:** `.github/workflows/pages.yml`

**Obsah:**
- Trigger: push na `main` branch
- Deploy: Statické soubory z rootu repa (žádný Jekyll build)
- Používá: `actions/configure-pages@v5` + `actions/upload-pages-artifact@v3` + `actions/deploy-pages@v4`
- Path: `.` (root repa)

**Klíčové body:**
- ✅ NEPOUŽÍVÁ `actions/jekyll-build-pages@v1`
- ✅ Deployuje root repa as-is
- ✅ Publikuje: `index.html`, `assets/`, `data/`, `sw.js`, atd.

### 3. Struktura repa (ověřeno)

**Root obsahuje:**
- ✅ `index.html` - SPA homepage
- ✅ `assets/` - JS, CSS, obrázky
- ✅ `data/` - JSON soubory (articles.json, videos.json, atd.)
- ✅ `sw.js` - Service Worker
- ✅ `.nojekyll` - Vypne Jekyll
- ✅ `.md` soubory - Dokumentace (zůstávají, ale Jekyll je vypnutý)

**Poznámka:** Existuje také `filtr/` složka s duplikáty - to může být stará struktura, ale nebrání deployu.

## Nastavení GitHub Pages

**Po push do main branchu:**

1. GitHub Actions spustí `pages.yml` workflow
2. Workflow deployuje root repa jako statické soubory
3. Pages servíruje SPA přímo (bez Jekyll build)

**V Settings → Pages:**
- Source: `GitHub Actions` (workflow `pages.yml`)
- Branch: `main` (automaticky)

## Ověření nasazení

Po deploy ověř:

### A) URL test
- `https://<username>.github.io/filtr/` → musí být SPA (index.html), ne dokumentační HTML

### B) Data test
- `https://<username>.github.io/filtr/data/articles.json` → musí být JSON (200 OK), ne HTML

### C) Service Worker test
- `https://<username>.github.io/filtr/sw.js` → musí být dostupný (200 OK)

### D) Assets test
- `https://<username>.github.io/filtr/assets/app.js` → musí být dostupný (200 OK)

## Logy v GitHub Actions

**Po deploy uvidíš v logu:**
```
Upload artifact
  path: .
```

**Nesmíš vidět:**
- "Writing: index.html" (to je Jekyll)
- "Jekyll build" nebo podobné

**Máš vidět:**
- "Upload artifact" s path: "."
- "Deploy to GitHub Pages" úspěšně dokončen

## Troubleshooting

### Pokud /filtr/ stále ukazuje dokumentační HTML:

1. **Zkontroluj, že `.nojekyll` je v rootu repa** (ne ve složce)
2. **Zkontroluj, že Pages workflow běží** (Actions tab → pages.yml)
3. **Zkontroluj, že workflow deployuje root** (`path: .` v upload-pages-artifact)
4. **Zkontroluj Settings → Pages** → Source musí být "GitHub Actions"

### Pokud /filtr/data/articles.json vrací HTML:

1. **Zkontroluj, že `data/articles.json` existuje v rootu repa**
2. **Zkontroluj, že workflow uploaduje root** (`path: .`)
3. **Zkontroluj, že není jiný workflow, který přepisuje výstup**

## Revert změn

Pokud by bylo potřeba vrátit Jekyll:

1. Smaž `.nojekyll` soubor
2. Smaž `.github/workflows/pages.yml`
3. V Settings → Pages změň source na "Deploy from a branch" → `/ (root)`

---

**Datum implementace:** 2026-01-25  
**Verze:** 1.0
