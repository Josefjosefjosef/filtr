# Internal Admin/Client API bootstrap (public delivery stays OFF)

This runbook enables **Admin API** and/or **Client API** without enabling public ad delivery.

Committed `wrangler.toml` defaults remain:

- `ADS_SAFE_MODE = "true"`
- `ADS_PUBLIC_DELIVERY_ENABLED = "false"`
- `ADS_ADMIN_API_ENABLED = "false"`
- `ADS_CLIENT_API_ENABLED = "false"`

## Prerequisites (GitHub Actions secrets — values never in git/chat)

Create these repository secrets if missing (Settings → Secrets → Actions):

| Secret | Purpose |
|--------|---------|
| `ADS_SESSION_SECRET` | Admin session HMAC |
| `ADS_PASSWORD_PEPPER` | Password hash pepper |
| `ADS_CLIENT_SESSION_SECRET` | Client session HMAC (≠ admin) |
| `ADS_CODE_PEPPER` | Access-code hash pepper |
| `ADS_BACKUP_ENCRYPTION_KEY` | Optional encrypted backups |

Deploy workflow puts them via `wrangler secret put` when present (`SECRET_PUT=…=OK` / `SKIPPED_MISSING_GITHUB_SECRET`).

## Enable Admin + Client APIs (runtime vars only)

1. GitHub → Actions → **Deploy IU Ads** → Run workflow
2. Set:
   - `enable_admin_api` = **true**
   - `enable_client_api` = **true**
3. Confirm health JSON after deploy:
   - `safeMode=true`
   - `publicDeliveryEnabled=false`
   - `adminApiEnabled=true`
   - `clientApiEnabled=true`
4. Confirm public delivery still empty: `GET /v1/public/ads/delivery` → `ads:[]`

## Seed first `main_admin` (no self-registration)

```powershell
cd cloudflare/iu-ads
$env:ADS_PASSWORD_PEPPER = '<same pepper as Worker secret>'
node .\scripts\iu-ads-hash-password.mjs
# paste password when prompted; stdout prints ONLY pbkdf2$… hash
```

Then insert via D1 (replace placeholders; never commit the hash/password):

```sql
INSERT INTO admin_users (user_id, email, password_hash, display_name, is_active, force_password_change, created_at, updated_at)
VALUES ('usr_main_1', 'admin@example.com', '<HASH>', 'Main Admin', 1, 0, datetime('now'), datetime('now'));
INSERT INTO admin_user_roles (user_id, role_code, assigned_at, assigned_by)
VALUES ('usr_main_1', 'main_admin', datetime('now'), 'bootstrap');
```

Use `npx wrangler d1 execute iu-ads --remote --command "…"`.

## Single blocker if secrets missing

**MANUAL_STEP:** Create GitHub Actions secrets `ADS_SESSION_SECRET` + `ADS_PASSWORD_PEPPER` (+ client secrets if enabling Client API), seed first `main_admin` via the hash script + D1 insert above, then re-run **Deploy IU Ads** with `enable_admin_api` / `enable_client_api` true.
