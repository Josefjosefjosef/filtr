# infouzel-articles-watchdog

Cloudflare Worker + Cron (every **5 minutes**) that **optionally** dispatches GitHub Actions workflows via `workflow_dispatch`.

## Why this exists

GitHub `schedule` triggers for article autorun proved unreliable in this repository. This worker uses **Cloudflare Cron** as the clock and **GitHub Actions only as the execution engine**.

## Architecture (dual dispatch)

1. **Cron** fires every **5 minutes** (`*/5 * * * *` UTC).
2. Worker evaluates **two independent lanes** on each tick:

### Fast lane (publishable_pool)

- **Workflow:** `update-articles-fast-pool.yml`
- **Freshness:** `FAST_FRESHNESS_URL` → `publishable_pool.json` `generatedAt`
- **Stale threshold:** `FAST_STALE_AFTER_MINUTES` (default **15** minutes)
- **Busy check:** only runs of `update-articles-fast-pool.yml` block fast dispatch
- **Purpose:** incremental merge of new quality articles into `publishable_pool.json` (no full aggregate)

### Slow lane (full pipeline)

- **Workflow:** `update-articles.yml`
- **Freshness:** `FRESHNESS_URL` → `articles/index.json` `generatedAt`
- **Stale threshold:** `STALE_AFTER_MINUTES` (default **5** minutes)
- **Busy check:** only runs of `update-articles.yml` block slow dispatch
- **Purpose:** full aggregate, `articles.json`, guards, retention, cleanup

3. Each lane independently: fetch `generatedAt` → list recent runs for **that workflow only** → dispatch if stale/missing and idle.

**Concurrency:** fast and slow paths use **separate** busy guards (per-workflow run lists). A running slow pipeline does **not** block fast publish unless the fast workflow itself is busy.

**Loop protection:** the worker does not subscribe to GitHub webhooks; it only reads JSON + Actions API.

## Telemetry (scheduled logs)

Each tick logs:

- `FAST_DISPATCH_ATTEMPTED`, `FAST_DISPATCHED`, `FAST_SKIPPED_BUSY`, `FAST_SKIPPED_NOT_STALE`, `FAST_STALE_MINUTES`
- `SLOW_DISPATCH_ATTEMPTED`, `SLOW_DISPATCHED`, `SLOW_SKIPPED_BUSY`, `SLOW_STALE_MINUTES`
- `WATCHDOG_DUAL_DISPATCH_STATUS` (`ok` | `partial` | `error`)

`GET /probe` includes `dual_dispatch` with the same fields (dry-run unless `?dispatch=1`).

## Secrets (Cloudflare)

| Name | Purpose |
|------|---------|
| `GITHUB_TOKEN` | PAT or fine-grained token with **`actions:write`** on the repo (to dispatch workflows). |

```bash
cd cloudflare/articles-watchdog
npx wrangler secret put GITHUB_TOKEN
```

Optional:

```bash
npx wrangler secret put MANUAL_TRIGGER_SECRET
```

## GitHub token minimum scope

- **Classic PAT:** scope **`repo`** (full) or minimal with **Actions: Read and write** on the target repo.
- **Fine-grained:** repository access to `Josefjosefjosef/filtr`, permissions **Actions: Read and write**.

Do **not** embed the token in `wrangler.toml` or the repo.

## Freshness policy

- **Fresh:** `generatedAt` is newer than the lane's stale threshold → no dispatch for that lane.
- **Stale:** age ≥ threshold → eligible for dispatch if that workflow is idle.
- **Missing / invalid `generatedAt`:** treated as **stale** (dispatch allowed if idle).

## Deploy / verify (manual checklist)

Worker URL (health): `https://infouzel-articles-watchdog.josef-zmrhal.workers.dev/health`  
Probe (after deploy): `https://infouzel-articles-watchdog.josef-zmrhal.workers.dev/probe`

### GitHub Actions deploy (preferred)

Repo secrets required:

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token (Workers Scripts Edit) |
| `ARTICLES_WATCHDOG_GITHUB_TOKEN` | PAT with **Actions Read and write** on `Josefjosefjosef/filtr` |

Then run workflow **Deploy articles watchdog** (`deploy-articles-watchdog.yml`) on `main`.

### Manual wrangler deploy

```bash
cd cloudflare/articles-watchdog
npm ci
npx wrangler secret put GITHUB_TOKEN   # PAT with Actions: Read and write
npx wrangler deploy
curl -sS "https://infouzel-articles-watchdog.josef-zmrhal.workers.dev/probe"
```

Optional GitHub repo variable (CI guards):

```bash
gh variable set ARTICLES_WATCHDOG_HEALTH_URL --body "https://infouzel-articles-watchdog.josef-zmrhal.workers.dev/health"
# gh variable set REQUIRE_ARTICLES_WATCHDOG --body "true"   # after GITHUB_TOKEN secret verified on worker
```

After deploy, confirm Cloudflare dashboard → Worker → Triggers shows cron `*/5 * * * *` and scheduled invocations succeed.

## Manual smoke test (optional)

With `MANUAL_TRIGGER_SECRET` set:

```bash
curl -sS -X POST "https://<worker-host>/run" \
  -H "Authorization: Bearer <MANUAL_TRIGGER_SECRET>"
```

`GET /health` is unauthenticated and returns `{"ok":true,...}`.

## Remove GitHub-side article cron

The repository should **not** rely on GitHub `schedule` to dispatch article workflows. Dispatch is driven by this worker only.

## Failure / fallback

- If **freshness URL** fails: `generatedAt` is `null` → worker may dispatch if idle (heal path) or skip if busy.
- If **GitHub API** errors: the scheduled invocation logs the error; the next cron tick retries.
- If **dispatch** fails: same — next tick retries when stale.
- If the **Cloudflare cron itself stops firing** (P0-1 incident 2026-06-10): the GitHub-side
  fallback `.github/workflows/articles-watchdog-cron-fallback.yml` calls `GET /probe?dispatch=1`
  on an offset schedule (`2-59/5`). All dispatch decisions still happen inside this worker
  (single decision-maker → at most one fast-pool dispatch per slot). The fallback run goes
  **red** when production `publishable_pool.json` is stale > 60 min (cron liveness alert).
- `[observability] enabled = true` in `wrangler.toml` persists scheduled-event logs in
  Cloudflare → Workers Logs, so missing cron invocations are diagnosable.

## Development

```bash
cd cloudflare/articles-watchdog
npm ci
npm test
npm run dev
```
