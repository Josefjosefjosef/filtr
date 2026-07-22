# Secrets contract — InfoUzel Ads (NEVER commit values)

| Secret / var | Where | Etapa | Notes |
|--------------|-------|-------|-------|
| `CLOUDFLARE_ADS_API_TOKEN` | GitHub Actions | 1 | **Preferred** least-privilege ads deploy token |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions | 0/1 | Fallback only if ads token missing |
| `ADS_SESSION_SECRET` | Worker secret | 2 | Admin session HMAC |
| `ADS_CLIENT_SESSION_SECRET` | Worker secret | 7 | Client RO session HMAC |
| `ADS_PASSWORD_PEPPER` | Worker secret | 2 | Password hash pepper |
| `ADS_CODE_PEPPER` | Worker secret | 7 | Client access code hash pepper |
| `ADS_R2_SIGNING_SECRET` | Worker secret | 1 | Short-lived private object access |
| `ADS_BACKUP_ENCRYPTION_KEY` | Worker/CI secret | 9 | Backup encryption |
| Analytics `ADMIN_TOKEN` | Analytics Worker only | — | Must NOT authorize Ads Admin API |

## `CLOUDFLARE_ADS_API_TOKEN` — manuální vytvoření

1. Cloudflare Dashboard → My Profile → API Tokens → Create Token → Create Custom Token
2. Token name: `infouzel-ads-deploy`
3. Permissions (Account):
   - `Account` → `Workers R2 Storage` → `Edit`
   - `Account` → `D1` → `Edit`
   - `Account` → `Workers Scripts` → `Edit`
4. Account Resources: Include → **pouze** účet InfoUzel (`577868e9aac9c289e9323100f68fad16`) — ne All accounts
5. Zone Resources: not needed for this token
6. Client IP Filtering: empty
7. TTL: empty (or org policy)
8. GitHub → repo Settings → Secrets → Actions → New repository secret:
   - Name: `CLOUDFLARE_ADS_API_TOKEN`
   - Value: (token value — never paste into chat/logs/repo)
9. Spusť workflow: **Probe IU Ads R2** (workflow_dispatch), pak **Deploy IU Ads**

This token does **not** replace Analytics deploy secrets.

## Rules

- Do not print secrets to logs, reports, URLs, client JS, fixtures, screenshots.
- Do not reuse Analytics admin token as Ads master token.
- Feature flags in `[vars]` are non-secret; default fail-closed.
- Private documents: Worker `/v1/objects/get` + HMAC only — never permanent public R2 URLs.
