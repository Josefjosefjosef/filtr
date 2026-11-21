# Owner deploy — durable CJ growth approval nonce store

**Do not deploy without explicit owner GO.**

## Purpose

Atomic cross-run replay protection for `EXECUTE_GROWTH_ACTIVATION` owner approvals.
Production GitHub Actions must call this Worker; `RUNNER_TEMP` is forbidden as replay authority.

## Create (once)

```text
cd cloudflare/cj-growth-approval-nonce
npx wrangler d1 create iu-cj-growth-approval
```

Paste the returned `database_id` into `wrangler.toml`.

```text
npx wrangler d1 migrations apply iu-cj-growth-approval --remote
npx wrangler secret put IU_CJ_GROWTH_NONCE_STORE_TOKEN
npx wrangler deploy
```

## GitHub repository secrets (Actions → Secrets)

| Secret | Purpose |
|---|---|
| `IU_CJ_GROWTH_NONCE_STORE_URL` | Worker base URL (no trailing slash), e.g. `https://iu-cj-growth-approval-nonce.<account>.workers.dev` |
| `IU_CJ_GROWTH_NONCE_STORE_TOKEN` | Same Bearer token as Worker secret |
| `IU_CJ_GROWTH_OWNER_APPROVAL_HMAC` | Owner HMAC for minting/verifying approval tokens (≥32 random bytes, base64/hex) |

Never commit secret values. Never log full tokens.

## Retention

Rows in `cj_growth_approval_nonces` are audit records. Prefer retain ≥ 90 days; purge only expired `COMPLETED`/`FAILED`/`REVOKED`/`EXPIRED` older than policy via controlled SQL (owner-only).

## Recovery after FAILED arm

Nonce stays consumed (`RESERVED`→`FAILED`). Owner must mint a **new** approval token (new nonce). Replaying the old workflow/token is denied (`OWNER_APPROVAL_REPLAY`).

## Fail-closed

If URL/token missing or Worker/D1 unavailable → `NONCE_STORE_UNAVAILABLE` → `NO_PRODUCTION_WRITE`. No local JSON fallback on Actions.
