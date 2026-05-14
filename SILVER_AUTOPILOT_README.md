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
| `SILVER_PROGRESS_LOG.md` | Append-only cycle log from `scripts/silver-autopilot-loop.ps1` (timestamps, exits, baselines; no secrets). |
| `scripts/silver-autopilot.cjs` | Implementation. |
| `scripts/silver-autopilot-loop.ps1` | **FULL AUTO LOOP TRIGGER V1** — Windows orchestrator: validates repo path, guards `SILVER_NEXT_ACTION.md`, optional Cursor CLI (`-CursorCommand` with `{TASK_FILE}` / `{OUTPUT_FILE}`), then `node scripts/silver-autopilot.cjs --full-auto-loop --max-steps=1`, then `--status`, colored console summary, beeps, and `SILVER_PROGRESS_LOG.md`. |
| `scripts/silver-cursor-agent-adapter-diagnostic.ps1` | Probes `where.exe cursor`, `cursor --version`, help text, **eight** `cursor agent` headless-style argv variants (`-p` / `--print` / `--output-format` / `--yolo` / `--yes`, 120s each, harmless one-line prompt), plus **stdin marker probes** (`cursor -`, then `cursor agent` with optional tail flags). Writes `scripts/silver-cursor-agent-adapter-diagnostic-report.json` (schema **v2**). |
| `scripts/silver-cursor-agent-adapter.ps1` | Wrapper: reads **v2** diagnostic JSON and prefers **`preferred_headless_argv`** (`cmd.exe` redirect, last argv token = task/prompt text) when that probe returned exit **0** and **stdout** contained `CURSOR_AGENT_STDIN_OK`. Otherwise uses **`preferred_stdin_argv`** when `preferred_invocation_kind=stdin_pipe` (e.g. `type` pipe to `cursor -` or `cursor agent …`). Fallback: `type "<temp>" | "<cursor.cmd>" agent` with optional retry to **`cursor -`**. `-DryRun` / `-Probe` / `-TimeoutSeconds` supported. |

## Full auto loop trigger (PowerShell V1)

Local **outer** loop only (not browser Silver). Default **one** cycle; infinite loop requires **explicit** `-MaxCycles 0`.

```powershell
# Safe dry run (no Cursor, no full-auto-loop; runs `--status`, updates progress log)
powershell -ExecutionPolicy Bypass -File scripts/silver-autopilot-loop.ps1 -DryRun -MaxCycles 1 -NoBeep

# Example real cycle (requires OPENAI_API_KEY in environment for autonomous next-task generation)
powershell -ExecutionPolicy Bypass -File scripts/silver-autopilot-loop.ps1 -MaxCycles 1 -SleepSeconds 5 `
  -CursorCommand "powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -TaskFile {TASK_FILE} -OutputFile {OUTPUT_FILE} -TimeoutSeconds 120"
```

### Cursor agent adapter V1 (Windows)

`cursor agent` does **not** document `--input` / `--output` in current CLI help. On Windows, **`cursor.cmd`** runs `Cursor.exe` with `out/cli.js`; unknown flags may be forwarded to Electron (see diagnostic stderr). **Headless argv** invocations use the same **`cmd.exe /c ""…\cursor.cmd"" agent … 1>stdout 2>stderr`** pattern as diagnostics. **Stdin** invocations use **`cmd.exe /c type "<temp-task>" | "<cursor.cmd>" <argv>…`** (argv from diagnostic, often `agent` with optional flags, or `-` when the CLI requires the pipe-dash entry point). See `scripts/silver-cursor-agent-adapter-diagnostic-report.json` for `preferred_invocation_kind`, `headless_probe_variants`, and `stdin_marker_probe_variants`.

**First safe check (harmless probe, no task file):**

```powershell
powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -Probe -OutputFile SILVER_CURSOR_OUTPUT.md -TimeoutSeconds 120
```

Expect `adapter_probe_pass=YES` in the output header when **stdout** contains `CURSOR_AGENT_STDIN_OK`. Expect `can_run_full_auto_loop_maxcycles_1=YES` only when **both** the probe passes **and** `adapter_ready=YES` in the diagnostic JSON (no fake automation).

```powershell
powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter-diagnostic.ps1
powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -DryRun -TaskFile SILVER_NEXT_ACTION.md -OutputFile SILVER_CURSOR_OUTPUT.md
```

If `adapter_ready` in `scripts/silver-cursor-agent-adapter-diagnostic-report.json` is **NO**, the normal (non-`-Probe`) wrapper exits **2** with a clear STOP message (no fake automation). **`-Probe` bypasses that gate** so you can capture errors even when the JSON says NO.

Parameters:

| Flag | Meaning |
|------|--------|
| `-DryRun` | Skips Cursor and `node … --full-auto-loop`; still runs guards and `--status`. |
| `-MaxCycles` | Default **1**. Use **0** for infinite (only when you intend a long run). |
| `-SleepSeconds` | Pause between cycles (default **5**). |
| `-CursorCommand` | Template; `{TASK_FILE}` → `SILVER_NEXT_ACTION.md`, `{OUTPUT_FILE}` → `SILVER_CURSOR_OUTPUT.md`. If omitted: **DryRun** continues with a warning; **non–DryRun** **STOP** (exit 1). |
| `-NoBeep` | Disable `[console]::beep` PASS/FAIL/COMPLETE signals. |

Guards (non-exhaustive): repo root must be `C:\projects\filtr`; empty `SILVER_NEXT_ACTION.md` **STOP**; substring **`SILVER_DEVELOPMENT_COMPLETE`** ends the loop (exit 0, COMPLETE beep); `assets/app.js` dirty without **`ENGINE_ALLOWED`** in the next-action text **STOP**; engine-style tasks without diagnostics / **`ENGINE_ALLOWED`** **STOP**; nonzero safety counters in `SILVER_RUN_REPORT.md` **STOP**; non–DryRun without **`OPENAI_API_KEY`** **STOP** before `--full-auto-loop` (no fake autonomous run). Cursor non-zero exit or Autopilot non-zero exit **STOP**.
