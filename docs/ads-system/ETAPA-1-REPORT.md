# Etapa 1 — report (Infra / R2)

**Datum:** 2026-07-22/23  
**PR:** https://github.com/Josefjosefjosef/filtr/pull/7680  
**Účet Cloudflare:** `577868e9aac9c289e9323100f68fad16`

## Výsledek

Etapa 1 je **produkčně hotová** (D1 + R2 + bindings + signed access + fail-closed flags). Merge PR #7680 čeká na GREEN required Smoke (auto-merge zapnutý).

## Ověření před / po R2 aktivaci

| Kontrola | Výsledek |
|----------|----------|
| `10042` R2 not enabled | Zmizelo po aktivaci R2 |
| Token `CLOUDFLARE_ADS_API_TOKEN` list R2 | OK |
| Správný účet | `577868e9aac9c289e9323100f68fad16` |
| D1 `iu-ads` | OK, migrace včetně `0002` |
| Analytics health | `ok=true`, `storageMode=d1`, no IP/fingerprint/full UA |
| PR #7617 OID | `9be3e372025c0c148a7cdf30a40c6047a28597fe` OPEN, nedotčen |
| `stash@{0}` | `iu-v3-wip-unrelated-cnb` zachován |

## Buckety a oddělení

| Bucket | Binding | Veřejnost |
|--------|---------|-----------|
| `iu-ads-creatives` | `CREATIVES` | Jen přes Worker; žádné r2.dev / public domain |
| `iu-ads-documents` | `DOCUMENTS` | Pouze signed `/v1/objects/get` |

## Deploy proof

- Run SUCCESS: `29962508435` (a následně signing put `29962508435` / follow-ups)
- Health prod:

```json
{
  "ok": true,
  "schemaVersion": "0002",
  "safeMode": true,
  "publicDeliveryEnabled": false,
  "r2": {
    "creativesBound": true,
    "documentsBound": true,
    "ready": true,
    "privateDocumentsPublicUrl": false
  }
}
```

- `/v1/public/ads/delivery` → `{"ads":[],"enabled":false,"safeMode":true}`
- `/v1/objects/get` (invalid/expired) → `access_denied` (HMAC aktivní, ne `signing_not_configured`)
- Veřejný web: žádná reference na ads delivery / reklamní box

## Bezpečnostní kontroly (kód + unit testy)

- MIME / magic-byte / size allowlist (`r2-security.ts`)
- Forbidden: HTML/JS/SVG
- Signed TTL access (`signed-access.ts`)
- `ADS_R2_SIGNING_SECRET` provisionován deploy workflow (bez výpisu hodnoty)

## Flags (zachováno)

- `SAFE_MODE=true`
- `publicDeliveryEnabled=false`
- `adminApiEnabled=false`
- `clientApiEnabled=false`

## Merge stav

- Ostatní required checks: GREEN (layout-guard, repo-guard, actionlint, pr-health-report-audit)
- Smoke: dlouhý / flaky (CLS tablet flake, hang na left-rail) — **auto-merge** nastaven na #7680
- Jediný zbývající krok pro uzavření Etapy 1 v gitu: dokončení/ GREEN Smoke → auto-merge

## Navazující práce

- Etapa 2 PR: https://github.com/Josefjosefjosef/filtr/pull/7684 (`feat/ads-system-etapa-2-auth`) — 44 unit testů PASS lokálně
