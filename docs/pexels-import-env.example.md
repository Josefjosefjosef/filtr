# Pexels Import — Environment Configuration (placeholder)

> **Status:** V1 preparation · skeleton only · **no API key required now**

## Required for future real import (not now)

| Variable | Required now | Description |
|----------|--------------|-------------|
| `PEXELS_API_KEY` | **NO** | Pexels API key from [pexels.com/api](https://www.pexels.com/api/). Set only in operator environment or CI secret store — **never commit to repository**. |

## Guards (always enforced)

| Guard | Value |
|-------|-------|
| `API_KEY_REQUIRED_NOW` | NO |
| `STOP_ON_RATE_LIMIT_REACHED` | YES |
| `STOP_ON_MONTHLY_BUDGET_REACHED` | YES |
| `MAX_REQUESTS_PER_BATCH` | 200 |
| `RATE_LIMIT_BYPASS_ALLOWED` | NO |

## Operator setup (when real import is approved)

1. Obtain API key from Pexels dashboard.
2. Set locally (PowerShell session only):

   ```powershell
   $env:PEXELS_API_KEY = "<your-key-here>"
   ```

3. Or use your platform secret manager (GitHub Actions secret, Cloudflare secret, etc.).
4. Verify key is **not** in git: `git grep PEXELS_API_KEY` must return no matches with actual key values.

## Related files

| File | Purpose |
|------|---------|
| `projects/data/image_gallery/import_state.json` | Import progress registry |
| `docs/pexels-initial-import-queue.json` | Planned import queue |
| `scripts/iu-pexels-import-runner.mjs` | Manual import runner (skeleton) |
| `docs/internal-image-gallery-pexels-import-governance.md` | Full governance |
