# Secrets contract — InfoUzel Ads (NEVER commit values)

| Secret / var | Where | Etapa | Notes |
|--------------|-------|-------|-------|
| `CLOUDFLARE_API_TOKEN` | GitHub Actions | 1 | Least privilege: Workers + D1 (+ R2 when ready) |
| `ADS_SESSION_SECRET` | Worker secret | 2 | Admin session HMAC |
| `ADS_CLIENT_SESSION_SECRET` | Worker secret | 7 | Client RO session HMAC |
| `ADS_PASSWORD_PEPPER` | Worker secret | 2 | Password hash pepper |
| `ADS_CODE_PEPPER` | Worker secret | 7 | Client access code hash pepper |
| `ADS_R2_SIGNING_SECRET` | Worker secret | 1/3 | Signed document URLs |
| `ADS_BACKUP_ENCRYPTION_KEY` | Worker/CI secret | 9 | Backup encryption |
| Analytics `ADMIN_TOKEN` | Analytics Worker only | — | Must NOT authorize Ads Admin API |

## Rules

- Do not print secrets to logs, reports, URLs, client JS, fixtures, screenshots.
- Do not reuse Analytics admin token as Ads master token.
- Feature flags in `[vars]` are non-secret; default fail-closed.
