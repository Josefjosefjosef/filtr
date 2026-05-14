# Silver Autopilot V1 (local only)

Silver Autopilot V1 is a **local development orchestration layer**. It is **not** part of Silver’s browser runtime, does not add backend AI, and does not ship LLM or embedding code to users.

## Purpose

- Glue between **Cursor / CLI**, **GitHub CLI (`gh`)**, **audit / proof scripts**, optional **OpenAI API** (development planning only), and **markdown reports** at the repo root.
- Enforce **safety gates**: dirty git, failing checks, non–scripts-only diffs, `assets/app.js`, UI/CSS/backend paths, and safety counters block risky flows.

## Security limits (V1)

- **No engine merges** without manual policy: verify blocks engine / `assets/app.js` unless you set explicit environment overrides (`SILVER_AUTOPILOT_ALLOW_ASSETS_APP`, `SILVER_AUTOPILOT_ALLOW_ENGINE`) — use only when you intentionally accept that risk.
- **`--auto --max-steps=1`**: at most **one** safe step (status refresh); no merge, no RHC3 refresh, no proof chain.
- **OpenAI**: only with `--ask-model`, only if `OPENAI_API_KEY` is set in your **environment** (never committed; do not add `.env` to the repo). If the key is missing, the command prints `OPENAI_API_KEY_MISSING` and exits without throwing.
- **No infinite loops**: each command runs once and exits.

## Commands

```bash
node scripts/silver-autopilot.cjs --status
node scripts/silver-autopilot.cjs --verify-pr=4340
node scripts/silver-autopilot.cjs --merge-pr=4340
node scripts/silver-autopilot.cjs --post-merge-proof
node scripts/silver-autopilot.cjs --refresh-rhc3
node scripts/silver-autopilot.cjs --ask-model
node scripts/silver-autopilot.cjs --auto --max-steps=1
```

- **`--status`**: prints status and updates `SILVER_RUN_REPORT.md`.
- **`--verify-pr`**: uses `gh pr view` / `gh pr diff --name-only`; prints `READY_TO_MERGE` or `STOP` with a reason.
- **`--merge-pr`**: merges only if verify would return `READY_TO_MERGE`; then `git checkout main` + `git pull --ff-only`, and refreshes the run report.
- **`--post-merge-proof`**: runs the proof script chain from `package.json` / `scripts` (smoke, calendar regression, audits, corpora). Validates safety counters and calendar 20k metrics when present, then `git restore` on tracked `scripts/*report.json` files and prints `git status --short`.
- **Proof gate consistency (`realistic_mobile`)**: **`--post-merge-proof`** treats **`audit_silver_realistic_mobile_corpus.cjs` exiting 0 inside the chain** as the primary signal that the standalone realistic-mobile audit passed, cross-checked with `scripts/silver-realistic-mobile-corpus-report.json` (`real_mobile_cases` / derived fail counts). A later script (notably `silver-deep-product-real-ux-v2.cjs`) may **re-run** sibling audits and print `realistic_mobile=FAIL` in its text block or embed `gates.realistic_mobile` from that re-run; that is **not** authoritative for autopilot’s post-merge verdict when the standalone step and corpus JSON agree on PASS. Other JSON reports may still contain **`FAIL` after `git restore`** on tracked `*report.json`. Autopilot prints `=== SILVER_AUTOPILOT_PROOF_GATE_CONSISTENCY_RESULT ===` after `--post-merge-proof` and `--status`. **`--status`** only sees on-disk JSON (no step exit context) and uses the corpus report as a best-effort hint.
- **`--refresh-rhc3`**: runs `silver-real-human-chaos-v3.cjs`, prints top fail clusters, and suggests the next cluster candidate (auto-skipping known harness-heavy clusters when their diagnostic JSON shows harness-only signals).
- **`--ask-model`**: reads `SILVER_STRATEGY.md`, `SILVER_RUN_REPORT.md`, and `git status`; calls OpenAI if the key exists; writes `SILVER_NEXT_ACTION.md`.

## Files

| File | Role |
|------|------|
| `SILVER_STRATEGY.md` | Non-negotiable engineering principles. |
| `SILVER_RUN_REPORT.md` | Last autopilot status snapshot. |
| `SILVER_NEXT_ACTION.md` | Copy-paste next instructions (from model or template). |
| `SILVER_AUTOPILOT_README.md` | This document. |
| `scripts/silver-autopilot.cjs` | Implementation. |
