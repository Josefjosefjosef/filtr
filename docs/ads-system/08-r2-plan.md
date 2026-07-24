# R2 plan — InfoUzel Ads (Etapa 1)

## Buckets

| Bucket | Binding | Viditelnost | Účel |
|--------|---------|-------------|------|
| `iu-ads-creatives` | `CREATIVES` | Servírování jen přes Worker / později CDN schválených objektů | Bannery, náhledy |
| `iu-ads-documents` | `DOCUMENTS` | Pouze signed Worker URL (`/v1/objects/get`) | Smlouvy, faktury, exporty |
| `iu-ads-backups` | `BACKUPS` | Oddělené oprávnění; committed in `wrangler.toml`; deploy ensures bucket | Šifrované inventory objekty (Etapa 9+) |

## Pravidla

- Soukromé dokumenty **nikdy** trvalá veřejná URL ani public bucket listing.
- Metadata + hash + visibility flags v D1 (`documents` / `creatives` / `object_access_audit`).
- Upload validace: MIME, magic bytes, size, no JS/HTML/SVG executable.
- Creative public delivery až po `approved` (Etapa 4/5).
- Signed access TTL default 300s (`R2_SIGNED_URL_TTL_SECONDS`).

## Token

Preferovaný GitHub secret: `CLOUDFLARE_ADS_API_TOKEN`  
Oprávnění: Account → Workers R2 Storage Edit + D1 Edit + Workers Scripts Edit  
Účet: pouze `577868e9aac9c289e9323100f68fad16`  
Viz `cloudflare/iu-ads/secrets.contract.md`.

## Probe

Workflow: `.github/workflows/probe-iu-ads-r2.yml` (workflow_dispatch) — vypíše jen PASS/FAIL a přítomnost bucketů, nikdy token.
