# InfoUzel — rychlejší vývoj (FAST vs FULL vs PRODUCTION)

## Režimy

| Režim | Příkaz | Účel |
|--------|--------|------|
| **FAST CHECK** | `npm run dev:verify` | Lokální zpětná vazba před PR (scope + rychlé guardy). **Nenahrazuje CI.** |
| **FULL CHECK** | GitHub required checks | `repo-guard`, `layout-guard`, `iu-ads-regression-freeze`, `smoke` na HEAD PR |
| **PRODUCTION CHECK** | Po merge | Pages deploy + produkční guardy / manuální smoke na live |

## PR sledování (bez čekání u terminálu)

```powershell
npm run dev:pr-status
```

Výstup JSON: `CI_PENDING` | `NEEDS_FIX` | `MERGE_READY` | `DRAFT` podle required kontextů.

## Naměřené CI (baseline, main/PR — 2026-10-20)

| Job | Typická délka |
|-----|----------------|
| repo-guard | ~10 s |
| layout-guard | ~1 min 45 s |
| iu-ads-regression-freeze | ~1 min 25 s |
| smoke-gate | ~8 s |
| **smoke** | **~56 min** (kritická cesta) |

Smoke = jeden job se stovkami sekvenčních kroků (`npm ci`, Playwright, `npm run smoke`, stovky guardů).

```powershell
npm run dev:ci-timing 12123
```

## Pracovní postup Cursor / vývojář

1. Izolovaný worktree z `origin/main` (dirty root nechat být).
2. `npm ci` jednou v worktree.
3. `npm run dev:verify` → push → `npm run dev:pr-status`.
4. Během běžícího smoke pokračovat v **nezávislé** práci (jiná větev/worktree).
5. Nemergovat bez zelených required checks; nerestartovat smoke bez selhání.

## CI optimalizace (bezpečné)

- **npm cache** v `smoke.yml` a `layout-guard.yml` (`setup-node` + oba lockfile).
- **Playwright guard suite (parallel pool)** — stejné příkazy jako dříve sekvenční kroky v `smoke.yml`, manifest `scripts/ci/smoke-guard-manifest-v1.json`, runner `scripts/ci/run-smoke-guards-parallel-v1.mjs`, default `IU_SMOKE_GUARD_PARALLEL=4`.
- **Prefetch** `cloudflare/iu-ads` npm jednou před premium visual kroky (bez druhého `npm ci` v kroku).
- Existující **data-only / info-panel / iu-ads** fast paths v `smoke-data-only-scope.mjs` — neměnit význam, jen využívat při úzkém diffu.

Regenerace manifestu po úpravě guard kroků v `smoke.yml`:

```powershell
node scripts/ci/extract-smoke-guard-manifest-v1.mjs
node scripts/ci/smoke-workflow-parallelize-apply-v1.mjs
```

## Co záměrně nezrychlit

- Neskracovat required smoke ani neodstraňovat guardy kvůli času.
- Neobcházet branch protection.
- Nepoužívat výsledek CI ze starého HEAD pro nový HEAD.
