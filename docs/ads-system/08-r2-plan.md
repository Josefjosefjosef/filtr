# R2 plan — InfoUzel Ads

## Buckets

| Bucket | Binding | Viditelnost | Účel |
|--------|---------|-------------|------|
| `iu-ads-creatives` | `CREATIVES` | Schválené objekty přes CDN / signed krátkodobé URL | Bannery, náhledy |
| `iu-ads-documents` | `DOCUMENTS` | Pouze signed URL (krátká TTL) | Smlouvy, faktury, exporty, práva |
| `iu-ads-backups` | `BACKUPS` (Etapa 9) | Oddělené oprávnění | Šifrované zálohy |

## Pravidla

- Soukromé dokumenty **nikdy** trvalá veřejná URL.
- Metadata + hash + visibility flags v D1 `documents` / `creatives`.
- Upload: MIME, magic bytes, size, dimensions, no JS/HTML executable, malware scan hooks.
- Creative public delivery až po `approved`.

## Manuální blokátor

Vytvoření R2 bucketů + bindingů vyžaduje Cloudflare účet s R2 oprávněním.  
Etapa 0 připraví wrangler placeholders; Etapa 1 dokončí binding po vytvoření bucketů (minimální manuální krok uživatele, pokud token nestačí).
