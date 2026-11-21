# Owner deploy — durable CJ growth approval nonce store

**Do not deploy without explicit owner GO (infrastructure approval).**  
**Growth catalog activation is a separate approval and is NOT granted by this deploy.**

## Purpose

Atomic cross-run replay protection for `EXECUTE_GROWTH_ACTIVATION` owner approvals.
Production GitHub Actions must call this Worker; `RUNNER_TEMP` is forbidden as replay authority.

## Cloudflare access (required before inventory/deploy)

Local agent currently reports: **wrangler not logged in**.

Owner machine (interactive):

```text
cd C:\projects\filtr\cloudflare\cj-growth-approval-nonce
npx wrangler login
npx wrangler whoami
```

Or set a scoped API token in the shell (never commit; never paste into chat/audit):

```text
$env:CLOUDFLARE_API_TOKEN = "<Workers Scripts Edit + D1 Edit token>"
npx wrangler whoami
```

Expected account (from existing InfoUzel Workers configs): `577868e9aac9c289e9323100f68fad16`  
Confirm live account id before create.

Read-only inventory after login:

```text
npx wrangler d1 list
npx wrangler deployments list
```

## Create (once, after infrastructure GO)

```text
cd C:\projects\filtr\cloudflare\cj-growth-approval-nonce
npx wrangler d1 create iu-cj-growth-approval
```

Paste the returned `database_id` into `wrangler.toml` (replace placeholder).

```text
npx wrangler d1 migrations apply iu-cj-growth-approval --remote
npx wrangler secret put IU_CJ_GROWTH_NONCE_STORE_TOKEN
npx wrangler deploy
```

Capture Worker URL (no trailing slash), e.g. `https://iu-cj-growth-approval-nonce.<account>.workers.dev`.

## GitHub repository secrets (Actions → Secrets)

| Secret | Purpose |
|---|---|
| `IU_CJ_GROWTH_NONCE_STORE_URL` | Worker base URL |
| `IU_CJ_GROWTH_NONCE_STORE_TOKEN` | Same Bearer as Worker secret (NOT the HMAC) |
| `IU_CJ_GROWTH_OWNER_APPROVAL_HMAC` | Separate cryptographically random HMAC (≥32 bytes) |

```text
gh secret set IU_CJ_GROWTH_NONCE_STORE_URL --repo Josefjosefjosef/filtr
gh secret set IU_CJ_GROWTH_NONCE_STORE_TOKEN --repo Josefjosefjosef/filtr
gh secret set IU_CJ_GROWTH_OWNER_APPROVAL_HMAC --repo Josefjosefjosef/filtr
```

Never commit secret values. Never log full tokens.

Optional stronger scope: GitHub Environment `cj-growth-activation` with required reviewers.

## Lifecycle

`ISSUED` (token mint) → `RESERVED` → `ARMED` → `COMPLETED`  
Terminal: `FAILED` | `STOPPED` | `EXPIRED` | `REVOKED` (no re-arm; new owner approval required).

`COMPLETED` requires verified publication evidence (required CI + data PR merge + Pages + prod generation + content SHA + products verified). Arming alone never completes.

## Retention / rollback

- Retain nonce rows ≥ 90 days.
- Rollback: `npx wrangler delete iu-cj-growth-approval-nonce` + delete GH secrets; D1 drop only as last resort.
- Site/Pages unaffected; EXECUTE fails closed without store.

## Fail-closed

Missing URL/token or Worker/D1 unavailable → `NONCE_STORE_UNAVAILABLE` → `NO_PRODUCTION_WRITE`.
