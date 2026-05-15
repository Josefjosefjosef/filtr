# Silver PR Orchestrator V1

Scripts-only helper for **ranking the next safe GitHub PR step** using frozen backlog JSON plus live `gh` data. It does **not** modify Silver engine code, UI, CSS, or backend.

## Modes

- **`--dry-run` (implemented):** Reads `scripts/silver-pr-backlog-governance-v1-report.json` and `scripts/silver-pr-backlog-needs-sync-triage-v1-report.json`, picks `recommended_first_sync_candidate`, runs `gh pr view` (JSON) and `gh pr diff <PR> --name-only` for file scope, evaluates hard stop rules, and writes `scripts/silver-pr-orchestrator-v1-report.json`. **DRY-RUN never merges, never pushes, never runs `gh pr sync`, never checks out the candidate PR branch, and never uses local branch manipulation for scope detection.** No cap15/cap20, raw MaxCycles0, or AutonomousMode loops.
- **`--apply`:** **Not implemented.** Do not wire this to `silver-autopilot.cjs` auto loops, **cap20**, **raw MaxCycles0**, or **AutonomousMode** loops until an explicit V2 design + human gate.

## Worktree hygiene

- The repository worktree must be **fully clean** (`git status --porcelain` empty) **before** starting DRY-RUN. If it is not, the script stops immediately (no PR branch checkout, no merge, no push) and writes a report with `blocked_reason=WORKTREE_NOT_CLEAN`.
- After a successful run, `git_status_clean_after` is **YES** if the worktree is empty **or** the only detected change is this orchestrator’s own output file `scripts/silver-pr-orchestrator-v1-report.json`. Any other modification forces `safe_to_enable_apply_mode=NO`.

## Errors and reporting

- **Every** external command uses an internal `runCommand()` helper; failures do not crash without a report.
- On any fatal error, the script writes (or overwrites) `scripts/silver-pr-orchestrator-v1-report.json` with `error=YES`, `error_stage`, `error_message`, `allowed_action=STOP_FAIL`, `would_merge=NO`, `would_push=NO`, `safe_to_enable_apply_mode=NO`, then attempts `git checkout main` (best effort) and exits with a non-zero code.

## DRY-RUN semantics

- **`would_merge` and `would_push` are always `NO` in `--dry-run`**, even when `allowed_action` is `SYNC_ONLY`. The report may still recommend a human-run command (e.g. `gh pr sync <n>`), but it does **not** claim the orchestrator would push or merge in this mode.
- **`safe_to_enable_apply_mode=YES`** (when present) refers only to a **future**, separate APPLY task after explicit human approval — not to automatic execution in this script.

## Branch isolation

- DRY-RUN uses **GitHub CLI data only** (`gh pr view`, `gh pr diff --name-only`). It does **not** check out the candidate PR branch, `git merge`, `git reset`, `git push`, or `gh pr sync`, and it does not alter `main` beyond an error-path best-effort `git checkout main`.

## Hard stops (summary)

The orchestrator refuses automation when it would hit high-risk or unknown surfaces, including:

- `assets/app.js` → `STOP_HIGH_RISK`
- `assets/app.css` → `STOP_UNKNOWN`
- `.github/workflows/**` → `STOP_UNKNOWN`
- `mergeStateStatus` / mergeability indicating conflicts or dirty state → `STOP_CONFLICTING`
- Pending checks → `STOP_PENDING`
- Failed checks → `STOP_FAIL`
- Paths outside **only** `docs/**` or **only** `scripts/**` (for the low-risk merge path) → `STOP_UNKNOWN` / engine-surface guard

It **must not** target Silver engine or high-risk product PRs for automated apply. The **first future APPLY candidate** should be only a **low-risk** `docs/**` or `scripts/**` PR, after checks pass and merge state is acceptable, and only under a **separate** APPLY task — never implied by this DRY-RUN alone.

## Run

```powershell
Set-Location C:\projects\filtr
node scripts/silver-pr-orchestrator-v1.cjs --dry-run
```

## Output

JSON report: `scripts/silver-pr-orchestrator-v1-report.json` — includes `mode: "DRY_RUN"`, `main_commit`, candidate fields, `allowed_action`, `would_merge` / `would_push` (always `NO` in DRY-RUN), `safe_to_enable_apply_mode`, `git_status_clean_before` / `git_status_clean_after`, `error` / `error_stage` / `error_message` on failure, `branch_isolation_gh_only`, `dry_run_no_push_merge`, and `recommended_next_command`.
