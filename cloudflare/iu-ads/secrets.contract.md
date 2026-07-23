# Secrets contract — InfoUzel Ads (NEVER commit values)

| Secret / var | Where | Etapa | Notes |
|--------------|-------|-------|-------|
| `CLOUDFLARE_ADS_API_TOKEN` | GitHub Actions | 1 | **Preferred** least-privilege ads deploy token |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions | 0/1 | Fallback only if ads token missing |
| `ADS_SESSION_SECRET` | Worker secret | 2 | Admin session cookie HMAC key (wired in `session.ts`); missing → `/v1/admin/*` returns `503 auth_not_configured` |
| `ADS_CLIENT_SESSION_SECRET` | Worker secret | 7 | Client RO session HMAC |
| `ADS_PASSWORD_PEPPER` | Worker secret | 2 | Mixed into PBKDF2 password hashes (`password.ts`); missing → `/v1/admin/*` returns `503 auth_not_configured` |
| `ADS_CODE_PEPPER` | Worker secret | 7 | Client access code hash pepper |
| `ADS_R2_SIGNING_SECRET` | GitHub Actions → Worker secret | 1 | Short-lived private object access; deploy puts via wrangler if GitHub secret set |
| `ADS_BACKUP_ENCRYPTION_KEY` | Worker/CI secret | 9 | Backup encryption |
| `ANALYTICS_ADMIN_TOKEN` | Worker secret (`infouzel-ads`) | 6 | Server-side bearer token this Worker sends to Analytics' `/v1/ads/report`; a value **copied from** (not derived from, not equal to any Ads-side auth secret) Analytics' own `ADMIN_TOKEN`; never sent to or readable by the browser; missing → `503 stats_not_configured` |
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
9. Spusť workflow: **Deploy IU Ads** (workflow_dispatch)

### Pokud deploy hlásí `code: 10042`

Token je v pořádku, ale na Cloudflare účtu **není aktivované R2**:

1. Otevři https://dash.cloudflare.com/ → účet InfoUzel → **R2**
2. Klikni **Activate R2** / Purchase (free tier stačí; může vyžadovat platební metodu i při $0)
3. Ověř, že dashboard umožní „Create bucket“
4. Napiš agentovi „R2 aktivováno“ → znovu **Deploy IU Ads**

This token does **not** replace Analytics deploy secrets.

## Etapa 2 — enabling Admin API (manual, per environment)

`ADS_ADMIN_API_ENABLED` stays `false` in the committed `wrangler.toml` defaults (fail-closed).
To activate the admin surface in a given environment:

1. `npx wrangler secret put ADS_SESSION_SECRET` — paste a high-entropy random value (never commit).
2. `npx wrangler secret put ADS_PASSWORD_PEPPER` — paste a separate high-entropy random value.
3. Set `ADS_ADMIN_API_ENABLED = "true"` via `wrangler secret put` is not applicable for vars; use an
   environment-specific `wrangler.toml` override or `wrangler deploy --var ADS_ADMIN_API_ENABLED:true`
   — never flip the checked-in default.
4. `safeMode` does **not** gate the admin surface — it only gates Public Ad Delivery. Admin API gating is:
   `ADS_ADMIN_API_ENABLED` (feature flag) **and** both secrets present (`auth_not_configured` otherwise).
5. First `main_admin` user must be seeded out-of-band (direct D1 insert with a `password.ts`-generated
   hash) — there is no public self-registration endpoint.
6. Password reset **request** creates a hashed, time-limited token row in `admin_password_resets`, but
   Etapa 2 does not include an email/SMS delivery integration — the raw token is intentionally never
   returned by the API. Wire an actual delivery channel before relying on self-service reset in production.

## Etapa 6 — measurement/reporting (manual, per environment)

`ANALYTICS_ADMIN_REPORT_URL` (a `system_settings` row, not a wrangler var) ships **empty** by
default, so `/v1/admin/stats/*` fails closed with `503 stats_not_configured` until both of the
following are set out-of-band:

1. `npx wrangler secret put ANALYTICS_ADMIN_TOKEN` — paste the **same value** as the Analytics
   Worker's own `ADMIN_TOKEN` secret (that is what Analytics' `/v1/ads/report` checks). Store it
   under this Ads-side name; never reuse `ADS_SESSION_SECRET`/`ADS_PASSWORD_PEPPER`/etc. for it,
   and never let this token double as an Ads Admin API credential.
2. Update the `ANALYTICS_ADMIN_REPORT_URL` row in the `iu-ads` D1 `system_settings` table to the
   Analytics Worker's base URL (e.g. `https://infouzel-analytics.<account>.workers.dev`) — direct
   D1 write, same operational pattern as other `system_settings` tunables (no public write endpoint).

## Rules

- Do not print secrets to logs, reports, URLs, client JS, fixtures, screenshots.
- Do not reuse Analytics admin token as Ads master token.
- Feature flags in `[vars]` are non-secret; default fail-closed.
- Private documents: Worker `/v1/objects/get` + HMAC only — never permanent public R2 URLs.
