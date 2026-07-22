# InfoUzel Ads Worker (`infouzel-ads`)

Oddělená obchodní/admin vrstva reklamního systému.  
**Není** náhradou InfoUzel Analytics.

## Etapa 0

- D1 schéma `migrations/0001_init.sql` (business entities)
- Fail-closed feature flags (`ADS_SAFE_MODE=true`, public/admin/client off)
- `GET /health`
- `GET /v1/public/ads/delivery` → vždy prázdné `ads[]` dokud není bezpečně zapnuto
- Izolační unit testy

## Commands

```powershell
npm ci
npm test
npx wrangler dev
```

Secrets: `secrets.contract.md` (hodnoty nikdy do gitu).
