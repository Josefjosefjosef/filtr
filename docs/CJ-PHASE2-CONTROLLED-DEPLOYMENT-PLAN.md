# CJ Affiliate Phase 2 — řízené technické nasazení (bez publikace)

**Referenční auditní balíček (nezávisle ověřen):**

- `cj-phase2-controlled-deployment-ready-FINAL.zip`
- SHA-256: `7f700f9f57f348f448ff3e7af5f67310d482954b5705b9a4be206e81b8a3deda`
- 167 souborů, regresní matice **45/45** z čistého rozbalení

**Publikační brány (musí zůstat až do samostatného rozhodnutí):**

- `PRODUCTION_SIGNING_ENABLED=false` (`scripts/iu-cj-affiliate-phase2-email-ingest-lib.mjs`)
- `ARCHIVE_TRUSTED_PUBLICATION_ADAPTER_ENABLED=false` (`cloudflare/iu-ads/src/affiliate-ad-archive-publication-trust.ts`)
- UI/stav: **BLOCKED – AWAITING TRUSTED ADAPTER**

**Historicky známé CJ identifikátory (ne důkaz produkčního propojení):** Publisher CID `7991692`, Website PID `101883843`.

---

## 0. Porovnání tří stavů (2026-10-18)

| Oblast | A. Pracovní strom | B. FINAL ZIP | C. Produkce |
|--------|-------------------|--------------|-------------|
| Git větev | `fix/cj-affiliate-post12108-runtime-gates`, HEAD `30a26c0…` | N/A (snapshot) | `main` (poslední Deploy IU Ads: 2026-10-12) |
| Archiv affiliate (kód) | Implementace v **necommitovaných** souborech + úpravy `index.ts` / admin | Subset pro testy (bez plného `index.ts` / `wrangler.toml`) | **NEOVĚŘENO** — route `/v1/admin/affiliate-archive` pravděpodobně chybí až do deploye |
| D1 migrace 0025–0027 | Soubory lokálně přítomné | Přítomné | **NEOVĚŘENO** (remote `wrangler d1 migrations list` vyžaduje `CLOUDFLARE_API_TOKEN`) |
| Veřejný web | Lokálně: `index.html` + offers JS (mount `hidden`, `isLocalDevHost`) | Offers assets v ZIP; **bez** `projects/index.html` | `iuAffiliatePhase2Offers` na www **není** (read-only fetch 2026-10-18) |
| ads.infouzel.cz | Lokální worker kód | — | HTTP **200** (read-only HEAD) |
| Regresní matice | **45/45** lokálně | **45/45** z extract | N/A |

**Závěr:** Pracovní strom ≠ FINAL ZIP (ZIP = audit + testy, ne kompletní deploy balík). Produkční baseline D1/archivu bez CF tokenu neověřena.

---

## 1. Git whitelist — fáze 1 (technické nasazení archivu, bez CJ importu / bez veřejných nabídek)

### 1.1 Produkční implementace (Worker `infouzel-ads`)

| Soubor | Účel |
|--------|------|
| `cloudflare/iu-ads/src/index.ts` | Admin routes `/v1/admin/affiliate-archive/*` |
| `cloudflare/iu-ads/src/admin-affiliate-archive.ts` | API seznam, detail, evidence, simulate-test |
| `cloudflare/iu-ads/src/affiliate-ad-archive-lib.ts` | D1 batch, atomické `version_seq` (0027) |
| `cloudflare/iu-ads/src/affiliate-ad-archive-publication-trust.ts` | Trusted adapter **vypnutý** |
| `cloudflare/iu-ads/src/affiliate-ad-archive-zip.ts` | ZIP export (PDF až na vyžádání v exportu) |
| `cloudflare/iu-ads/src/admin-nav.ts` | Nav „Archiv reklam – Affiliate“ |
| `cloudflare/iu-ads/src/admin-ui-script.ts` | Admin UI sekce, důkazy, export |
| `cloudflare/iu-ads/src/admin-pdf-zip.ts` | PDF do ZIP exportu (ne auto při publish) |
| `cloudflare/iu-ads/wrangler.toml` | Beze změny publikačních var (`ADS_PUBLIC_DELIVERY_ENABLED=false`) |

**Nepoužívat v produkci:** `archive-d1-local-test-entry.ts`, `wrangler.local-archive-test.toml`.

### 1.2 Databázové migrace (po pořadí, jednorázově na produkční D1 `iu-ads`)

1. `migrations/0025_affiliate_ad_archive.sql`
2. `migrations/0026_affiliate_ad_archive_idempotency.sql`
3. `migrations/0027_affiliate_ad_archive_version_seq.sql`

### 1.3 Testy a CI podpora (commitovat s PR, ne deploy artefakt)

| Soubor | Účel |
|--------|------|
| `cloudflare/iu-ads/test/affiliate-ad-archive.test.ts` | Vitest archiv |
| `cloudflare/iu-ads/test/affiliate-ad-archive-publication-trust.test.ts` | Vitest brány |
| `cloudflare/iu-ads/test/helpers/d1-sqlite-shim.ts` | Test helper |
| `cloudflare/iu-ads/test/helpers/apply-iu-ads-migrations.ts` | Migrace v testech |
| `cloudflare/iu-ads/vitest.archive.config.ts` | Izolovaný vitest config |
| `scripts/iu-cj-affiliate-phase2-central-offer-regression-matrix-v29-1-selftest.mjs` + transitivní `scripts/` dle matice | Offline 45/45 |
| `scripts/iu-cj-affiliate-phase2-final-integration-selftest.mjs` | Integrační řetězec |
| `scripts/iu-cj-affiliate-phase2-affiliate-archive-publication-negative-selftest.mjs` | Negativní publikace |
| `scripts/iu-cj-affiliate-phase2-affiliate-archive-*-wrangler-d1-selftest.mjs` | Lokální D1 Wrangler |
| `scripts/iu-cj-affiliate-phase2-controlled-deployment-ready-audit-pack.mjs` | Audit ZIP + extract gate |

### 1.4 Dokumentace

- `docs/CJ-PHASE2-CONTROLLED-DEPLOYMENT-PLAN.md` (tento soubor)
- `docs/affiliate-system/phase2-retention-and-storage-v1.md`

### 1.5 Oddělený volitelný PR (až po rozhodnutí — **ne nutné pro fázi 1**)

Náhled kupónů/produktů pouze localhost; produkce dnes bez mountu:

- `projects/index.html` (hidden `#iuAffiliatePhase2Offers`)
- `assets/iu-affiliate-phase2-offers-v1.js` / `.css` / `cj-phase2-preview-autohotarek.json`
- `assets/iu-affiliate-catalog.js` (volání `iuAffiliatePhase2OffersRender` — no-op mimo localhost)

**Doporučení:** Fáze 1 deploy **Worker + D1 migrace + admin archiv**; web preview **vynechat** z prvního merge, dokud není explicitní GO.

### 1.6 Záměrně mimo fázi 1 (jiné úkoly / živé integrace)

- `cloudflare/cj-email-ingest-d1-worker/**`
- `.github/workflows/cj-affiliate-email-ingest.yml`
- FORPSI IMAP skripty (`scripts/iu-cj-affiliate-phase2-forpsi-*`, `scripts/iu-forpsi-*`)
- `scripts/iu-cj-affiliate-phase1-*` (kromě sdílené lib, pokud CI vyžaduje)
- `tmp-rpc-neg-*.sqlite`, `**/.wrangler/**`, `.dev.vars`

### 1.7 Bezpečná izolace commitu (bez mazání ostatní práce)

1. Zůstat na větvi nebo `fix/cj-phase2-tech-deploy-archive` z aktuálního HEAD.
2. **`git add` pouze cesty z §1.1–1.4** (explicitní seznam, ne `git add .`).
3. Necommitovat `projects/index.html` / offers assets, pokud fáze 1 = jen admin archiv.
4. Ostatní untracked/modified soubory **nechat** v pracovním stromu.
5. Před PR: `git diff --cached --name-only` vs whitelist; STOP-SHIP dle `.cursor/rules/iu-after-merge-verify-diff-split.mdc`.

---

## 2. Secrets a oprávnění (bez hodnot)

### 2.1 Fáze 1 — technické nasazení archivu

| Secret / var | Kde | Nutné? |
|--------------|-----|--------|
| `CLOUDFLARE_ADS_API_TOKEN` | GitHub Actions | Ano (deploy Worker + D1 apply v CI) |
| `ADS_SESSION_SECRET`, `ADS_PASSWORD_PEPPER` | Worker | Již pro admin (existující ads.infouzel.cz) |
| `ADS_ADMIN_API_ENABLED` | var (mimo repo default) | Již zapnuto v produkci pokud admin funguje |
| Ostatní z `cloudflare/iu-ads/secrets.contract.md` | Worker/CI | Beze změny pro archiv |

**Nové secrets pro fázi 1 nejsou povinné.**

### 2.2 Až živý CJ import (samostatné GO)

| Secret | Účel |
|--------|------|
| `IU_CJ_PAT` | CJ API Bearer |
| `IU_CJ_PUBLISHER_CID` | `7991692` |
| `IU_CJ_WEBSITE_PID` | `101883843` |
| `IU_CJ_CJ_API_ENABLED`, `IU_CJ_CJ_API_HTTP_EXECUTE` | Org/repo approval flags (viz `scripts/iu-cj-affiliate-phase2-secrets-template.json`) |

Postup uložení (bez zadávání v chatu): GitHub → Settings → Secrets → přidat jména; ověřit formát PAT přes `node scripts/iu-cj-affiliate-phase1-check-pat-format.mjs` (ne tiskne token).

### 2.3 Až FORPSI e-mail ingest

`IU_FORPSI_IMAP_USER`, `IU_FORPSI_IMAP_PASSWORD`, `IU_FORPSI_IMAP_CONNECT_APPROVED`, worker `IU_CJ_D1_WORKER_INGEST_TOKEN`, atd. — viz `scripts/iu-cj-affiliate-phase2-secrets-template.json`.

### 2.4 Až skutečné publikování

Trusted adapter + `PRODUCTION_SIGNING_ENABLED=true` + smluvní brány — **explicitně mimo tento plán**.

---

## 3. Datový tok — stav ověření

| Část | Implementováno | Offline | Lokální D1 | Produkčně | Poznámka |
|------|----------------|---------|------------|-----------|----------|
| CJ API / feedy | Skripty v repo | Ano (mock/fixtures) | Částečně | **Nepropojeno** | Bez live API v tomto úkolu |
| Normalizace / registr v29.2 | Ano | Matice 45/45 | Wrangler matice (volitelně) | **Neověřeno** | |
| Kontrola oprávnění (kupón/feed/foto) | `coupon-eligibility`, banner permission | Selftesty | — | **Ne** | Chybí důkaz = blok publikace |
| Publikační brána v15 | `PRODUCTION_SIGNING_ENABLED=false` | Ano | — | **Blokováno** | |
| Archiv affiliate | Worker + D1 | Vitest 14/14 | Wrangler 7+12 scénářů OK | **Ne nasazeno** | |
| Veřejné zobrazení kupónů/produktů | Preview JS | Localhost guard | — | **Vypnuto** | |
| FORPSI → ingest | Worker staging | Offline selftesty | — | **Ne** | |

---

## 4. D1 — migrace a rollback

### Předmigrační kontrola

- Export / snapshot produkční D1 `iu-ads` (Cloudflare dashboard nebo schválený runbook).
- `wrangler d1 migrations list DB --remote` — seznam applied (vyžaduje token).
- Ověřit, že 0025–0026 nejsou duplicitně applied.

### Aplikace (až po GO)

```powershell
cd cloudflare\iu-ads
npx wrangler d1 migrations apply DB --remote
```

### Po migraci

- `SELECT version_seq, record_id FROM affiliate_ad_archive_records LIMIT 5`
- Duplicity `(record_id, version_no)`: `HAVING COUNT(*) > 1` → prázdný výsledek

### Selhání / rollback

- Před prvním produkčním zápisem archivu: obnova DB ze zálohy.
- Po produkčních datech s 0027: **ne** downgrade sloupce — obnova ze snapshotu.

---

## 5. GitHub CI — required checks (`main`)

Strict: **repo-guard**, **layout-guard**, **smoke**, **iu-ads-regression-freeze**.

Obcházet zakázáno. PR musí projít všemi čtyřmi před merge.

---

## 6. Nasazovací postup (20 kroků, pořadí dle závislostí)

1. **Git whitelist** — sestavit staged diff pouze z §1.1–1.4.
2. **Lokální ověření** — příkazy v §7 (PASS povinné).
3. **Kontrola Secrets** — jména v GitHub/CF dashboardu, hodnoty netisknout.
4. **Kontrola migrací** — soubory 0025–0027 v PR; remote stav až s tokenem.
5. **Kontrola produkce** — ads HTTP, web bez phase2 mountu, admin dostupnost.
6. **GO/NO-GO meeting** — vlastník rozhodne o commit/push (mimo tento doc).
7. **Commit** — konvenční prefix `fix:` nebo `chore:`.
8. **Push** + PR proti `main`.
9. **Required checks** — 4/4 green.
10. **Merge** — ruční (bez auto-merge obcházejícího ochranu).
11. **After-merge verify** — PR-only diff, STOP-SHIP guard.
12. **Záloha D1** — před migrací.
13. **Migrace D1** — 0025 → 0026 → 0027 (skip already applied).
14. **Deploy Worker** — workflow Deploy IU Ads.
15. **Smoke/health** — repo smoke + ads admin login.
16. **Brány** — simulate-test publish → `BLOCKED – AWAITING TRUSTED ADAPTER`; žádný veřejný kupón.
17. **Web** — PC/mobil/tablet/PWA: stávající affiliate tlačítka beze změny (pokud nebyl web PR).
18. **Archiv admin** — seznam, detail, „Zobrazit důkazy zveřejnění“, ZIP export.
19. **Absence veřejných nabídek** — grep produkční HTML/JS.
20. **Závěrečný report** — důkazy JSON + checklist §8.

### Rollback

- Worker: redeploy předchozí verze z GitHub releases / předchozí merge revert.
- D1: obnova ze zálohy pokud migrace selhala nebo data poškozena.
- Web (pokud nasazen): revert commit s `index.html`/offers.

---

## 7. Povinné lokální důkazy před PR

```powershell
node scripts\iu-cj-affiliate-phase2-central-offer-regression-matrix-v29-1-selftest.mjs
node scripts\iu-cj-affiliate-phase2-affiliate-archive-publication-negative-selftest.mjs
node scripts\iu-cj-affiliate-phase2-final-integration-selftest.mjs
node scripts\iu-cj-affiliate-phase2-affiliate-archive-concurrent-version-wrangler-d1-selftest.mjs
node scripts\iu-cj-affiliate-phase2-affiliate-archive-wrangler-d1-selftest.mjs
cd cloudflare\iu-ads
npx vitest run --config vitest.archive.config.ts
```

Audit balíček (volitelně před externím auditem):

```powershell
node scripts\iu-cj-affiliate-phase2-controlled-deployment-ready-audit-pack.mjs
```

---

## 8. Go / No-Go

### Fáze 1 — Technické nasazení (admin archiv + D1, **bez** publikace / **bez** CJ live)

**GO pro zahájení procesu (commit → PR → merge → deploy)** pokud:

- [ ] Whitelist diff schválen; web preview **vyloučen** nebo explicitně schválen s localhost guardem
- [ ] Všechny příkazy §7 PASS
- [ ] Produkční D1 baseline zálohována a migrace plánována
- [ ] Brány zůstávají vypnuté (§ úvod)
- [ ] CI 4/4 po merge

**NO-GO** pokud: jakýkoli test FAIL, neplánované soubory v PR (`assets/` mimo schválený preview, `projects/index.html` bez review), hrozba zapnutí importu/publikace.

### Fáze 2 — Publikování affiliate nabídek

**NO-GO** do implementace trusted production adapteru a samostatného Go/No-Go.

---

## 9. Zbývající blokátory (2026-10-18)

1. **Git:** Většina archivní implementace je **necommitovaná** (untracked); HEAD větev obsahuje jen starší CJ skripty vs `origin/main`.
2. **Produkce D1:** Stav migrací 0025–0027 **NEOVĚŘENO** bez `CLOUDFLARE_API_TOKEN`.
3. **PR scope:** Rozhodnout, zda fáze 1 **vynechá** webové soubory (`index.html`, offers JS).
4. **Integrační selftest:** Krok `affiliate_archive_d1` / `archive_wrangler_d1` může být označen „skipped“ — spoléhat na samostatné vitest + wrangler selftesty (§7).
5. **Commit/push/deploy:** Záměrně neprovedeno v přípravném úkolu — čeká na výslovný souhlas.

---

## 10. Ochrana webu (checklist po deployi)

- Existující affiliate tlačítka, sloty, `rel="sponsored noopener"`, feed „Vybrané služby“, PWA, CSP/TT, CLS guardy — beze změny chování.
- Žádné visitor tracking / cookies pro reklamu.
- Admin archiv oddělen od placené reklamy; PDF jen v exportu ZIP.
