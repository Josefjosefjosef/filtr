# Etapa 0 — Vstupní audit (baseline)

**Datum auditu:** 2026-07-22  
**Výchozí commit main:** `150f6b7763241768a481b5ba312ab8b380ea9c59`  
**Větev auditu:** `main` (synchronizováno s `origin/main`, working tree čistý)

## Git / GitHub

| Položka | Ověřený stav | Spec vs. realita |
|---------|--------------|------------------|
| Lokální větev | `main` | OK |
| HEAD | `150f6b7763` | Shodné s „main po #7665“ |
| Sync | `main...origin/main` (žádný drift) | OK |
| Working tree | čistý | OK (snapshot na začátku konverzace ukazoval untracked ads-policy soubory — ty už jsou v main přes #7665) |
| Merge/rebase/cherry-pick rozpracovaný | ne | OK |
| Required checks | `repo-guard`, `layout-guard`, `smoke` | OK |
| Branch protection | enforce_admins=true, force push zakázán | OK |
| PR #7665 | MERGED → `150f6b7763` | OK |
| Deploy IU Analytics | run `29905018169` SUCCESS na `150f6b7763` | OK |

## Stash (nesahat)

| Index | Message | Akce reklamního úkolu |
|-------|---------|------------------------|
| `stash@{0}` | `iu-v3-wip-unrelated-cnb` | Zachovat, neaplikovat, nemazat |
| `stash@{1}+` | historické WIP (desítky) | Zachovat, nezasahovat |

## PR #7617 — agregátor (ochrana)

| Položka | Stav |
|---------|------|
| State | OPEN |
| Branch | `docs/iu-info-system-differential-audit-roadmap` |
| HEAD OID | `9be3e372025c0c148a7cdf30a40c6047a28597fe` (beze změny oproti potvrzenému) |
| Commits | 2 |
| Soubory | `.github/workflows/update-info-events.yml`, `docs/info-system-v1/*`, `package.json`, `scripts/iu-info-events-*.mjs` |
| Checks | smoke FAILURE (nesouvisející), layout/repo/pr-health SUCCESS |
| Reklamní zásah | **ZAKÁZÁN** |

## Otevřená PR (souběžná práce — nevstupovat)

7617 (agregátor), 7616 (info events data), 7605 (dependabot), 7576 (articles data), 7343, 7338, 7274, 7270, 6993, 6937.

## InfoUzel Analytics (produkce)

```json
{"ok":true,"service":"infouzel-analytics","mode":"aggregate-only","storageMode":"d1","storesIp":false,"storesFingerprint":false,"storesFullUserAgent":false}
```

URL: `https://infouzel-analytics.josef-zmrhal.workers.dev/health`

## Existující reklamní infrastruktura (mezera)

| Existuje | Neexistuje |
|----------|------------|
| Anonymní `ad_impression` / `ad_click` ingest | Ad serving engine |
| D1 `daily_ads` agregáty | Klienti / objednávky / smlouvy / faktury |
| Admin report Bearer `ADMIN_TOKEN` | Individuální účty + role |
| Privacy / Consent / AntiFraud guard | R2 kreativy / dokumenty |
| `campaign_meta` schéma (nepoužité) | Client Report API / klientské kódy |
| Statická admin stránka statistik | `admin.infouzel.cz`, Public Ad Delivery |

## Cloudflare Workers v repu

1. `infouzel-analytics` (`cloudflare/iu-analytics`) — D1 `iu-analytics`
2. `infouzel-articles-watchdog` — bez D1/R2

**R2:** v repu žádné bindingy.  
**Samostatná reklamní D1:** neexistuje → Etapa 0/1 zakládá `iu-ads`.

## Rozhodnutí z auditu (závazná)

1. Analytics **nepřepisovat** — pouze později rozšířit allowlistované metriky dle potřeby.
2. Obchodní/PII/admin data → **samostatná D1 `iu-ads`** (izolace, blast radius, nezávislé migrace).
3. Nový Worker `infouzel-ads` — Admin / Client / Public Delivery API (fail-closed feature flags).
4. Agregátor PR #7617 a všechny stash **neměnit**.
5. Etapizace 0–9 dle specifikace, každá etapa z čistého main.

## Odchylky od textu specifikace (preferovaná tech. varianta)

| Spec preferuje | Zvoleno | Důvod | Zachované vlastnosti |
|----------------|---------|-------|----------------------|
| Cloudflare Pages admin | GitHub Pages + později samostatný admin origin (DNS) | Aktuální hosting reality = GitHub Pages; DNS `admin.infouzel.cz` vyžaduje manuální zásah | Oddělení UI, auth, noindex |
| Společná D1 možná | Samostatná `iu-ads` | Nejnižší oprávnění, žádná kontaminace anonymní analytiky | Privacy, audit, migrace |
