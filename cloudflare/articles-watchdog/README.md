# infouzel-articles-watchdog

Cloudflare Worker + Cron (every **15 minutes**) that **optionally** dispatches the GitHub Actions workflow **Update articles data** via `workflow_dispatch`.

## Why this exists

GitHub `schedule` triggers for article autorun proved unreliable in this repository. This worker uses **Cloudflare Cron** as the clock and **GitHub Actions only as the execution engine**.

## Architecture

1. **Cron** fires every **15 minutes** (`*/15 * * * *` UTC).
2. Worker fetches public **`generatedAt`** from `FRESHNESS_URL` (default: `articles/index.json` on production).
3. If age **&lt; STALE_AFTER_MINUTES** (default **15**) → **no API call** to GitHub (freshness guard).
4. Worker lists recent runs for **`update-articles.yml`** via GitHub REST API. If any run is **`queued`** or **`in_progress`** → **no dispatch** (running guard / duplicate protection).
5. If data are **stale or timestamp missing** and pipeline is **idle** → `POST .../actions/workflows/update-articles.yml/dispatches` with `ref: main`.

**Loop protection:** the worker does not subscribe to GitHub webhooks; it only reads JSON + Actions API. Completing a workflow does not re-trigger the worker in a loop.

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

- **Classic PAT:** scope **`repo`** (full) or minimal with **Actions: Read and write** on the target repo (GitHub documents workflow dispatch under Actions permissions).
- **Fine-grained:** repository access to `Josefjosefjosef/filtr`, permissions **Actions: Read and write**.

Do **not** embed the token in `wrangler.toml` or the repo.

## Freshness policy

- **Fresh:** `generatedAt` is **newer than** `STALE_AFTER_MINUTES` (default **15** minutes). No dispatch.
- **Stale:** age **≥ 15** minutes → eligible for dispatch if idle.
- **Missing / invalid `generatedAt`:** treated as **stale** (dispatch allowed if idle) so production can self-heal.

Rationale: check every **15** minutes; pipeline run ~50 minutes so only one run at a time (`skip_busy`). Stale threshold matches check interval.

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

After deploy, confirm Cloudflare dashboard → Worker → Triggers shows cron `*/15 * * * *` and scheduled invocations succeed (no `GitHub dispatch failed` in logs).

## Manual smoke test (optional)

With `MANUAL_TRIGGER_SECRET` set:

```bash
curl -sS -X POST "https://<worker-host>/run" \
  -H "Authorization: Bearer <MANUAL_TRIGGER_SECRET>"
```

`GET /health` is unauthenticated and returns `{"ok":true,...}`.

## Remove GitHub-side article cron

The repository should **not** rely on GitHub `schedule` to dispatch **Update articles data**. Dispatch is driven by this worker only (see root workflow comments).

## Failure / fallback

- If **freshness URL** fails: `generatedAt` is `null` → worker may dispatch if idle (heal path) or skip if busy.
- If **GitHub API** errors: the scheduled invocation logs the error; the next cron tick retries.
- If **dispatch** fails: same — next tick retries when stale.

## Development

```bash
cd cloudflare/articles-watchdog
npm ci
npm test
npm run dev
```
