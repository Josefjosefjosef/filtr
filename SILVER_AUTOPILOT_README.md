# Silver Autopilot V1 (local only)

Silver Autopilot V1 is a **local development orchestration layer**. It is **not** part of Silver’s browser runtime, does not add backend AI, and does not ship LLM or embedding code to users.

## Purpose

- Glue between **Cursor / CLI**, **GitHub CLI (`gh`)**, **audit / proof scripts**, optional **OpenAI API** (development planning only), and **markdown reports** at the repo root.
- Enforce **safety gates**: dirty git, failing checks, non–scripts-only diffs, `assets/app.js`, UI/CSS/backend paths, and safety counters block risky flows.

## Security limits (V1)

- **No engine merges** without manual policy: verify blocks engine / `assets/app.js` unless you set explicit environment overrides (`SILVER_AUTOPILOT_ALLOW_ASSETS_APP`, `SILVER_AUTOPILOT_ALLOW_ENGINE`) — use only when you intentionally accept that risk.
- **`--auto --max-steps=1`**: at most **one** safe step (status refresh); no merge, no RHC3 refresh, no proof chain.
- **OpenAI**: only with `--ask-model` or **`--full-auto-loop`**, only if `OPENAI_API_KEY` is set in your **environment** (never committed; do not add `.env` to the repo). If the key is missing, those commands print `OPENAI_API_KEY_MISSING`, write a safe fallback into `SILVER_NEXT_ACTION.md`, and **do not throw**.
- **No raw `MaxCycles 0` outer loop**: `-MaxCycles 0` alone **exits immediately** (exit code **1**) with `SILVER_LOOP_SAFETY_STOP reason=maxcycles_zero_requires_allowinfinite_or_autonomousmode`. Add **`-AllowInfinite`** or **`-AutonomousMode`** to enter **controlled autonomous mode**: hard cycle budget (default **512**), optional wall-clock caps, emergency stop file **`SILVER_STOP_AUTOPILOT`**, unexpected dirty-tree guard, repeated `--status` failure / no-progress / same next-action / same-PR-instruction streak breakers, safety-counter regression breaker, and `SILVER_LOOP_SAFETY_STOP` / progress-log `stop_reason` on breaker trips. See `scripts/silver-autonomous-loop-safety-diagnostic.ps1` for env variable names. Each **Node** autopilot command still runs once per invocation.

## Silver Auto-Dev entrypoint (V1)

Single-pass local orchestration: **bounded** `silver-pr-orchestrator-v1` safe queue (`--max=3`), then — when the queue reports `queue_safe_to_continue=YES` and `queue_stop_reason=no_safe_candidate` with **no** merge/sync work in the same run — writes a **deterministic** root `SILVER_NEXT_ACTION.md` (scripts-only / diagnostic task template) so you can paste **from disk into Cursor** without drafting the next ChatGPT prompt. Does **not** call the Cursor API. Never commits runtime `SILVER_*.md`.

```bash
npm run silver-auto
# equivalent:
node scripts/silver-auto-dev.cjs
```

- **Preflight:** strict clean `git status`, branch `main`, `node` + `npm` available, `git diff` / `git diff --cached` for `assets/app.js` must be empty.
- **Queue:** `node scripts/silver-pr-orchestrator-v1.cjs --apply-safe-queue --max=3` (same bounded semantics as the orchestrator; no raw infinite loops).
- **After queue work (merge/sync or multi-cycle stop):** prints a `SILVER_AUTO_DEV_QUEUE_SUMMARY` block and sets `recommended_next_command` to `npm run silver-auto` (re-run; no manual ChatGPT task drafting).
- **Report:** overwrites `scripts/silver-auto-dev-report.json` each run (`mode=SILVER_AUTO_DEV`, queue fields, `next_action_written`, `recommended_next_command`, …).

**Cursor adapter run (V1, single cycle, no outer loop):** after the same queue + handoff logic, optionally invoke `scripts/silver-cursor-agent-adapter.ps1` once so the task in `SILVER_NEXT_ACTION.md` is piped to the Cursor CLI and capture is written to `SILVER_CURSOR_OUTPUT.md`. **V1 only allows `max_cycles=1`** (implicit default when omitted with `--run-cursor`; values `>1` stop with `MAX_CYCLES_V1_ONLY_1`). With `--loop --max-cycles=N`, N may be 1 up to the script hard safe limit (see `hard_safe_max_cycles` / `loop_guard_version` in the auto-dev summary). Does not loop without `--loop`; does not merge PRs; does not touch `assets/app.js` or the Silver engine.

```bash
npm run silver-auto -- --run-cursor --max-cycles=1
# equivalent:
node scripts/silver-auto-dev.cjs --run-cursor --max-cycles=1
```

If the adapter script is missing, `pwsh` is unavailable on non-Windows, or `adapter_ready` blocks the adapter, the run **stops safely** (`safe_to_continue=NO`, `cursor_adapter_stop_reason` / `recommended_next_command` in `scripts/silver-auto-dev-report.json`). Fix wiring via `scripts/silver-cursor-agent-adapter-diagnostic.ps1` as documented below.

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
- **Deep product embedded `gates.realistic_mobile` (non-authoritative)**: The standalone corpus JSON (`silver-realistic-mobile-corpus-report.json`) is the **authoritative** realistic-mobile gate for autopilot `PASS_FAIL` / `gate_realistic_mobile`. The sibling report `silver-deep-product-real-ux-v2-report.json` may still show `deep_product_embedded_gate=FAIL` from an older or re-run embedded snapshot. That embedded `FAIL` is labeled as a **stale / non-authoritative hint** in status output; **`PASS_FAIL` stays PASS** when the corpus JSON and authoritative fields are PASS — it is **not** treated as a product defect by autopilot.
- **`--refresh-rhc3`**: runs `silver-real-human-chaos-v3.cjs`, prints top fail clusters, and suggests the next cluster candidate (auto-skipping known harness-heavy clusters when their diagnostic JSON shows harness-only signals).
- **`--ask-model`**: reads `SILVER_STRATEGY.md`, `SILVER_RUN_REPORT.md`, and `git status`; calls OpenAI if the key exists; writes `SILVER_NEXT_ACTION.md`. The prompt includes a **live manifest** of existing `scripts/silver-*` / `audit_silver*` files; model output is checked for UTF-8 mojibake, banned hallucinated paths (`scripts/silver-diagnostic.js`, `scripts/silver-smoke-test-maxcycles-1.js`), and unsafe Windows `cat C:\…` command lines — on failure a **deterministic Czech fallback** task is written instead.
- **`--full-auto-loop` / `--loop-once`**: FULL AUTO LOOP V1 — refreshes `--status`, enforces guards (unexpected dirty paths, `assets/app.js`, nonzero safety counters parsed from `SILVER_RUN_REPORT.md`), picks input from **`SILVER_CURSOR_OUTPUT.md`** (preferred, ≥20 chars) else **`SILVER_RUN_REPORT.md`**, builds a ChatGPT prompt (strategy + input + status + manifest + hard rules), calls OpenAI when `OPENAI_API_KEY` is set, and always targets **`SILVER_NEXT_ACTION.md`** as copy-paste **ÚKOL PRO CURSOR** (header + body UTF-8). The same **quality gate** as `--ask-model` applies; rejected model text is replaced by a deterministic fallback tagged `full-auto-loop-quality-fallback`. **Allowed dirty paths** for this command include `SILVER_PROGRESS_LOG.md` and `scripts/silver-autopilot-loop.ps1` (append-only / local loop edits) in addition to other Silver report files. Without an API key: writes `OPENAI_API_KEY_MISSING` and a STOP fallback (no crash). Prints `=== SILVER_AUTOPILOT_FULL_AUTO_LOOP_RESULT ===` and `=== SILVER_AUTOPILOT_FULL_AUTO_LOOP_V1_RESULT ===`. V1 clamps to **`--max-steps=1`**.

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
| `scripts/silver-autopilot-loop.ps1` | **FULL AUTO LOOP TRIGGER V1** — Windows orchestrator: validates repo path, guards `SILVER_NEXT_ACTION.md`, optional Cursor CLI (`-CursorCommand` with `{TASK_FILE}` / `{OUTPUT_FILE}`), then `node scripts/silver-autopilot.cjs --full-auto-loop --max-steps=1`, then `--status`, colored console summary, beeps, and `SILVER_PROGRESS_LOG.md`. After each cycle, when **`SILVER_CURSOR_OUTPUT.md`** contains a **`# silver-cursor-agent-adapter`** header, appends **`silver_cycle_*`** lines (task digest, byte counts, **`streaming_output_supported`**, timeout/elapsed mirrors) parsed from that file. On **outer exit 124** (wall-clock timeout), **preserves** an existing adapter capture (appends outer stdout/stderr instead of replacing) and appends **`SILVER_TIMEOUT_CLOSEOUT_REMINDER`** so operators read **`SILVER_NEXT_ACTION.md`** / **`SILVER_CURSOR_OUTPUT.md`** before `git restore` / clean. |
| `scripts/silver-autonomous-loop-safety-diagnostic.ps1` | Read-only: prints MaxCycles **0** / autonomous safety policy hints and relevant **environment** variable names (does **not** run an infinite loop). |
| `scripts/silver-cursor-agent-adapter-diagnostic.ps1` | Probes `where.exe cursor`, `cursor --version`, help text, **eight** `cursor agent` headless-style argv variants (`-p` / `--print` / `--output-format` / `--yolo` / `--yes`, 120s each, harmless one-line prompt), plus **stdin marker probes** (`cursor -`, then `cursor agent` with optional tail flags). **First** runs a **WSL Ubuntu** non-interactive pack: `wsl.exe -d Ubuntu -- /home/spedk/.local/bin/agent --version`, `test -x` / `test -d` on the Linux agent path and `/mnt/c/projects/filtr`, then `--print --mode ask --trust --workspace /mnt/c/projects/filtr` with the one-line marker prompt (timeout from `headless_probe_timeout_ms`), git dirtiness allowlist, and writes **`wsl_cursor_agent_print_ask_trust`** into `scripts/silver-cursor-agent-adapter-diagnostic-report.json` (schema **v2**). Prints `=== SILVER_WSL_CURSOR_AGENT_ADAPTER_WIRING_RESULT ===` and exits **1** if that pack’s `adapter_ready` is **NO** (Windows probes still run for context). Ends with `[console]::beep(880, 200)`. |
| `scripts/silver-cursor-agent-adapter.ps1` | Wrapper: reads **v2** diagnostic JSON and prefers **`preferred_headless_argv`** (`cmd.exe` redirect, last argv token = task/prompt text) when that probe returned exit **0** and **stdout** contained `CURSOR_AGENT_STDIN_OK`. Otherwise uses **`preferred_stdin_argv`** when `preferred_invocation_kind=stdin_pipe` (e.g. `type` pipe to `cursor -` or `cursor agent …`). Fallback: `type "<temp>" | "<cursor.cmd>" agent` with optional retry to **`cursor -`**. **`-WslUbuntuAgent`** uses direct **`wsl.exe`**: the task body is written to a **UTF-8 temp file**, then Linux **`/bin/bash -c 'exec …agent… < /mnt/…/payload.md'`** (non-login `-c` only) so **argv and the bash snippet never embed the markdown** (no backtick/`$(…)` expansion of the task). **`SILVER_CURSOR_OUTPUT.md` must not paste the full prompt into logs**: `command_executed` stays a **sanitized summary**, with **`prompt_preview`** (≤300 chars), **`task_chars`**, **`task_lines`**, **`task_bytes_utf8`**, **`task_digest`** / **`task_sha256_prefix`** (UTF-8 SHA-256 hex prefix), **`process_start_utc` / `process_end_utc`**, **`elapsed_ms`**, **`stdout_bytes` / `stderr_bytes`**, **`stdout_nonempty` / `stderr_nonempty`**, **`streaming_output_supported=NO`** (stdout/stderr are read only **after** `WaitForExit`; no live heartbeat), **`last_output_utc=UNAVAILABLE`** in that mode, **`post_timeout_output_interpretation`** (stall vs output heuristic), plus an extra **`SILVER_WSL_ADAPTER_STREAMING_AND_HEARTBEAT`** block clarifying **wall-clock-only** timeouts. **`task_file_used`**, **`wsl_prompt_delivery`**, **`argv_mode`**, **`timeout_seconds`**, and **`task_too_large_for_argv=NO`**. **`-WslUbuntuAgent -Probe -TaskFile scripts/silver-wsl-taskfile-stdin-probe-task.md`** runs the markdown/Czech/backtick regression gate (`czech_backtick_parentheses_probe_pass`). Non-`-Probe` runs require **`wsl_cursor_agent_print_ask_trust.adapter_ready=YES`** in the diagnostic JSON. `-DryRun` / `-Probe` / `-TimeoutSeconds` supported. |
| `scripts/silver-wsl-taskfile-stdin-probe.ps1` | Runs **`silver-cursor-agent-adapter.ps1 -WslUbuntuAgent -Probe -TaskFile scripts/silver-wsl-taskfile-stdin-probe-task.md`** with capture under **`%TEMP%`**, prints `=== SILVER_WSL_TASKFILE_STDIN_PROBE_RESULT ===`, and exits **0** only when adapter + aggregate gates pass (no stderr shell-leak patterns, sentinel absent from `command_executed`). |
| `scripts/silver-wsl-agent-heartbeat-timeout-diagnostics-probe.ps1` | Read-only regression probe: runs the WSL taskfile stdin probe to **`%TEMP%`**, asserts adapter metadata includes **`task_digest`**, **`elapsed_ms`**, **`stdout_bytes` / `stderr_bytes`**, **`streaming_output_supported`**, the **`SILVER_WSL_ADAPTER_STREAMING_AND_HEARTBEAT`** block ( **`last_output_utc=UNAVAILABLE`** when non-streaming ), sanitized **`command_executed`**, no oversized meta lines, **`scripts/silver-autopilot-loop.ps1`** wiring for **`silver_cycle_*`** per-cycle log fields, and **`git diff --name-only HEAD -- assets/app.js`** is empty. Prints `=== SILVER_WSL_AGENT_HEARTBEAT_TIMEOUT_DIAGNOSTICS_PROBE ===`. |
| `scripts/silver-wsl-taskfile-stdin-probe-task.md` | Fixture markdown for the WSL taskfile regression probe (diacritics, parentheses, bullets, inline PowerShell-looking lines, backticks). |

## Full auto loop trigger (PowerShell V1)

Local **outer** loop only (not browser Silver). Default **one** cycle. **`-MaxCycles 0` is blocked** unless you also pass **`-AllowInfinite`** or **`-AutonomousMode`** (controlled autonomous mode with hard caps and breakers — see Security limits).

```powershell
# Safe dry run (no Cursor, no full-auto-loop; runs `--status`, updates progress log)
powershell -ExecutionPolicy Bypass -File scripts/silver-autopilot-loop.ps1 -DryRun -MaxCycles 1 -NoBeep

# Example real cycle (requires OPENAI_API_KEY in environment for autonomous next-task generation)
powershell -ExecutionPolicy Bypass -File scripts/silver-autopilot-loop.ps1 -MaxCycles 1 -SleepSeconds 5 `
  -CursorCommand "powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -TaskFile {TASK_FILE} -OutputFile {OUTPUT_FILE} -TimeoutSeconds 3400"

# Optional: same contract with WSL Ubuntu `agent` (non-interactive `--print --mode ask --trust --workspace`)
# Legacy `-TimeoutSeconds 120` in -CursorCommand is auto-bumped to **3400** for autonomous/CAP50 product runs (probe stays 120).
powershell -ExecutionPolicy Bypass -File scripts/silver-autopilot-loop.ps1 -MaxCycles 1 -SleepSeconds 5 `
  -CursorCommand "powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -WslUbuntuAgent -TaskFile {TASK_FILE} -OutputFile {OUTPUT_FILE} -TimeoutSeconds 3400"
```

### Cursor agent adapter V1 (Windows)

`cursor agent` does **not** document `--input` / `--output` in current CLI help. On Windows, **`cursor.cmd`** runs `Cursor.exe` with `out/cli.js`; unknown flags may be forwarded to Electron (see diagnostic stderr). **Headless argv** invocations use the same **`cmd.exe /c ""…\cursor.cmd"" agent … 1>stdout 2>stderr`** pattern as diagnostics. **Stdin** invocations use **`cmd.exe /c type "<temp-task>" | "<cursor.cmd>" <argv>…`** (argv from diagnostic, often `agent` with optional flags, or `-` when the CLI requires the pipe-dash entry point). See `scripts/silver-cursor-agent-adapter-diagnostic-report.json` for `preferred_invocation_kind`, `headless_probe_variants`, and `stdin_marker_probe_variants`.

**First safe check (harmless probe, no task file):**

```powershell
powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -Probe -OutputFile SILVER_CURSOR_OUTPUT.md -TimeoutSeconds 120
```

**WSL Ubuntu Cursor Agent (non-interactive; task via UTF-8 temp file + bash redirect):**

```powershell
powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -WslUbuntuAgent -Probe -OutputFile SILVER_CURSOR_OUTPUT.md -TimeoutSeconds 120
```

Sanitized plan (real run writes `%TEMP%\…payload.md` and passes only its `/mnt/c/…` path inside a short `bash -c` one-liner — **never** the markdown body):

```text
wsl.exe -d Ubuntu -- /bin/bash -c 'exec /home/spedk/.local/bin/agent --print --mode ask --trust --workspace /mnt/c/projects/filtr <"/mnt/c/Users/…/AppData/Local/Temp/silver-wsl-agent-payload-….md"'
```

Expect `adapter_probe_pass=YES` in the output header when **stdout** contains `CURSOR_AGENT_STDIN_OK`. Expect `can_run_full_auto_loop_maxcycles_1=YES` only when **both** the probe passes **and** the matching diagnostic gate is **YES** (`adapter_ready` for Windows path, or `wsl_cursor_agent_print_ask_trust.adapter_ready` for `-WslUbuntuAgent`).

**WSL taskfile markdown regression (Czech / backticks / parentheses fixture, capture under `%TEMP%`):**

```powershell
powershell -ExecutionPolicy Bypass -File scripts/silver-wsl-taskfile-stdin-probe.ps1
powershell -ExecutionPolicy Bypass -File scripts/silver-wsl-agent-heartbeat-timeout-diagnostics-probe.ps1
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter-diagnostic.ps1
powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -DryRun -TaskFile SILVER_NEXT_ACTION.md -OutputFile SILVER_CURSOR_OUTPUT.md
```

If `adapter_ready` in `scripts/silver-cursor-agent-adapter-diagnostic-report.json` is **NO**, the normal (non-`-Probe`) wrapper exits **2** with a clear STOP message (no fake automation). **`-Probe` bypasses that gate** so you can capture errors even when the JSON says NO.

Parameters:

| Flag | Meaning |
|------|--------|
| `-DryRun` | Skips Cursor and `node … --full-auto-loop`; still runs guards and `--status`. |
| `-MaxCycles` | Default **1**. Value **0** alone **STOP** (exit **1**). With **`-AllowInfinite`** or **`-AutonomousMode`**, **0** enables **controlled autonomous mode** (hard cycle cap, wall clocks, dirty/stop/streak breakers). |
| `-AllowInfinite` / `-AutonomousMode` | Required together with `-MaxCycles 0` to opt in to autonomous orchestration (same safety stack for both switches). |
| `-MaxAutonomousHardCycles` | Override hard iteration ceiling ( **0** = use env `SILVER_AUTONOMOUS_HARD_MAX_CYCLES` or default **512**). |
| `-SameNextActionStopAfter` | Streak limit for identical `SILVER_NEXT_ACTION.md` body (default **5**). |
| `-NoProgressStopAfter` | Streak limit for unchanged **real** `core_engine_progress` (from `SILVER_RUN_REPORT.md` when present, else loop baselines). Values containing **`baseline_pending_precise_measurement`** are **not** a dynamic heartbeat: the autonomous no-progress streak **does not advance** (console: `SILVER_NO_PROGRESS_CHECK_SKIPPED …`). `SILVER_RUN_REPORT.md` gets a `core_engine_progress=` line from `writeRunReport` **only** when a non-placeholder measured value is supplied (never a fake static bump). Regression probe (read-only): `powershell -ExecutionPolicy Bypass -File scripts/silver-autonomous-no-progress-baseline-probe.ps1`. |
| `-RepeatedFailureStopAfter` | Consecutive non-zero `node … --status` exits (default **3**). |
| `-PrLoopStopAfter` | Consecutive cycles with the same detected PR id in next-action text (default **4**). |
| `-MaxCycleWallSeconds` | Per-cycle wall budget in autonomous mode (**0** = env `SILVER_AUTONOMOUS_MAX_CYCLE_WALL_SECONDS` or **7200**; **-1** disables). |
| `-TotalWallSeconds` | Total autonomous wall budget (**0** = env `SILVER_AUTONOMOUS_MAX_TOTAL_WALL_SECONDS` or **86400**; **-1** disables). |
| `-SleepSeconds` | Pause between cycles (default **5**). |
| `-CursorCommand` | Template; `{TASK_FILE}` → `SILVER_NEXT_ACTION.md`, `{OUTPUT_FILE}` → `SILVER_CURSOR_OUTPUT.md`. If omitted: **DryRun** continues with a warning; **non–DryRun** **STOP** (exit 1). Autonomous/CAP50: **`effective_timeout_seconds=3400`** (legacy **120** in the template is bumped; adapter logs `effective_timeout_seconds`). |
| `-Cap50TimeoutUtf8SelfTest` | Orchestration selftest: timeout bump **120→3400**, UTF-8 handoff probes, preflight cleanup, dirty guard (no real CAP50 run). |
| `-NoBeep` | Disable `[console]::beep` PASS/FAIL/COMPLETE signals. |

Guards (non-exhaustive): repo root must be `C:\projects\filtr`; empty `SILVER_NEXT_ACTION.md` **STOP**; substring **`SILVER_DEVELOPMENT_COMPLETE`** ends the loop (exit 0, COMPLETE beep); `assets/app.js` dirty without **`ENGINE_ALLOWED`** in the next-action text **STOP**; engine-style tasks without diagnostics / **`ENGINE_ALLOWED`** **STOP**; nonzero safety counters in `SILVER_RUN_REPORT.md` **STOP**; non–DryRun without **`OPENAI_API_KEY`** **STOP** before `--full-auto-loop` (no fake autonomous run). Cursor non-zero exit or Autopilot non-zero exit **STOP**. After a successful `--full-auto-loop` write, **`SILVER_NEXT_ACTION.md` is scanned** for mojibake / banned hallucinated script paths / unsafe `cat C:\` command patterns — mismatch **STOP** (`next_action_quality_post_guard`). **Autonomous mode** (`-MaxCycles 0` + `-AllowInfinite` / `-AutonomousMode`) additionally enforces **hard cycle budget**, **`SILVER_STOP_AUTOPILOT`**, **unexpected dirty paths** (aligned with `--full-auto-loop` allowlist), **stuck/time** caps, **streak** and **safety regression** breakers; every autonomous breaker prints **`SILVER_LOOP_SAFETY_STOP reason=…`**.
