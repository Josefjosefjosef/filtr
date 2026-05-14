# Silver Autopilot V1 (local only)

Silver Autopilot V1 is a **local development orchestration layer**. It is **not** part of Silver’s browser runtime, does not add backend AI, and does not ship LLM or embedding code to users.

## Purpose

- Glue between **Cursor / CLI**, **GitHub CLI (`gh`)**, **audit / proof scripts**, optional **OpenAI API** (development planning only), and **markdown reports** at the repo root.
- Enforce **safety gates**: dirty git, failing checks, non–scripts-only diffs, `assets/app.js`, UI/CSS/backend paths, and safety counters block risky flows.

## Security limits (V1)

- **No engine merges** without manual policy: verify blocks engine / `assets/app.js` unless you set explicit environment overrides (`SILVER_AUTOPILOT_ALLOW_ASSETS_APP`, `SILVER_AUTOPILOT_ALLOW_ENGINE`) — use only when you intentionally accept that risk.
- **`--auto --max-steps=1`**: at most **one** safe step (status refresh); no merge, no RHC3 refresh, no proof chain.
- **OpenAI**: only with `--ask-model` or **`--full-auto-loop`**, only if `OPENAI_API_KEY` is set in your **environment** (never committed; do not add `.env` to the repo). If the key is missing, those commands print `OPENAI_API_KEY_MISSING`, write a safe fallback into `SILVER_NEXT_ACTION.md`, and **do not throw**.
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
node scripts/silver-autopilot.cjs --full-auto-loop --max-steps=1
node scripts/silver-autopilot.cjs --loop-once
```

- **`--status`**: prints status and updates `SILVER_RUN_REPORT.md`.
- **`--verify-pr`**: uses `gh pr view` / `gh pr diff --name-only`; prints `READY_TO_MERGE` or `STOP` with a reason.
- **`--merge-pr`**: merges only if verify would return `READY_TO_MERGE`; then `git checkout main` + `git pull --ff-only`, and refreshes the run report.
- **`--post-merge-proof`**: runs the proof script chain from `package.json` / `scripts` (smoke, calendar regression, audits, corpora). **Before** `audit_silver_realistic_mobile_corpus.cjs`, Autopilot runs `git restore` on tracked `scripts/*report.json` only (so that audit does not see dirty tracked report JSON from earlier steps). After the chain, it restores tracked report JSON again and prints `git status --short`. **Any logical STOP** in this command (dirty tree preflight, nonzero step exit, nonzero safety counters, calendar 20k gate, proof-gate failure) updates `SILVER_RUN_REPORT.md` with `post_merge_proof_logical_status=FAIL` / `post_merge_proof_process_exit=1` and **exits the Node process with code 1** so shells and CI cannot treat a proof failure as success.
- **Self-test (forced proof fail)**: on a clean working tree, `IU_SILVER_AUTOPILOT_FORCE_PROOF_FAIL=1` makes `--post-merge-proof` fail immediately with exit **1** (without running smoke/audits). Remove the variable afterward. Example (PowerShell): `$env:IU_SILVER_AUTOPILOT_FORCE_PROOF_FAIL="1"; node scripts/silver-autopilot.cjs --post-merge-proof; echo $LASTEXITCODE; Remove-Item Env:\IU_SILVER_AUTOPILOT_FORCE_PROOF_FAIL` — expect `LASTEXITCODE` **1** and `forced_fail_test_pass=YES` in `=== SILVER_AUTOPILOT_POST_MERGE_PROOF_STRICT_FAIL_RESULT ===`.
- **Proof gate consistency (`realistic_mobile`)**: **`--post-merge-proof`** treats **`audit_silver_realistic_mobile_corpus.cjs` exiting 0 inside the chain** as the primary signal that the standalone realistic-mobile audit passed, cross-checked with `scripts/silver-realistic-mobile-corpus-report.json` (`real_mobile_cases` / derived fail counts). A later script (notably `silver-deep-product-real-ux-v2.cjs`) may **re-run** sibling audits and print `realistic_mobile=FAIL` in its text block or embed `gates.realistic_mobile` from that re-run; that is **not** authoritative for autopilot’s post-merge verdict when the standalone step and corpus JSON agree on PASS. Other JSON reports may still contain **`FAIL` after `git restore`** on tracked `*report.json`. Autopilot prints `=== SILVER_AUTOPILOT_PROOF_GATE_CONSISTENCY_RESULT ===` after `--post-merge-proof` and `--status`. **`--status`** only sees on-disk JSON (no step exit context) and uses the corpus report as a best-effort hint.
- **`--refresh-rhc3`**: runs `silver-real-human-chaos-v3.cjs`, prints top fail clusters, and suggests the next cluster candidate (auto-skipping known harness-heavy clusters when their diagnostic JSON shows harness-only signals).
- **`--ask-model`**: reads `SILVER_STRATEGY.md`, `SILVER_RUN_REPORT.md`, and `git status`; calls OpenAI if the key exists; writes `SILVER_NEXT_ACTION.md`.
- **`--full-auto-loop` / `--loop-once`**: FULL AUTO LOOP V1 — refreshes `--status`, enforces guards (unexpected dirty paths, `assets/app.js`, nonzero safety counters parsed from `SILVER_RUN_REPORT.md`), picks input from **`SILVER_CURSOR_OUTPUT.md`** (preferred, ≥20 chars) else **`SILVER_RUN_REPORT.md`**, builds a ChatGPT prompt (strategy + input + status + hard rules), calls OpenAI when `OPENAI_API_KEY` is set, and always targets **`SILVER_NEXT_ACTION.md`** as copy-paste **ÚKOL PRO CURSOR**. Without an API key: writes `OPENAI_API_KEY_MISSING` and a STOP fallback (no crash). Prints `=== SILVER_AUTOPILOT_FULL_AUTO_LOOP_RESULT ===` and `=== SILVER_AUTOPILOT_FULL_AUTO_LOOP_V1_RESULT ===`. V1 clamps to **`--max-steps=1`**.

## Files

| File | Role |
|------|------|
| `SILVER_STRATEGY.md` | Non-negotiable engineering principles. |
| `SILVER_RUN_REPORT.md` | Last autopilot status snapshot. |
| `SILVER_NEXT_ACTION.md` | Copy-paste next instructions (from model or template). |
| `SILVER_CURSOR_OUTPUT.md` | Optional: paste latest Cursor chat output for `--full-auto-loop` input (preferred over run report). |
| `SILVER_AUTOPILOT_README.md` | This document. |
| `scripts/silver-autopilot.cjs` | Implementation. |
