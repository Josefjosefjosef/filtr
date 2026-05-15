# Silver PR Orchestrator V1

Scripts-only helper for **ranking the next safe GitHub PR step** using frozen backlog JSON plus live `gh` data. It does **not** modify Silver engine code, UI, CSS, or backend.

## Modes

- **`--dry-run` (default path):** Reads `scripts/silver-pr-backlog-governance-v1-report.json` and `scripts/silver-pr-backlog-needs-sync-triage-v1-report.json`, picks `recommended_first_sync_candidate`, runs `gh pr view` (JSON) and `gh pr diff <PR> --name-only` for file scope, evaluates hard stop rules, and writes `scripts/silver-pr-orchestrator-v1-report.json`. **DRY-RUN never merges, never pushes, never runs `gh pr sync` / `gh pr update-branch`, never checks out the candidate PR branch, and never uses local branch manipulation for scope detection.** No cap15/cap20, raw MaxCycles0, or AutonomousMode loops. Report fields `apply_mode`, `apply_sync_*`, `apply_merge_*`, `apply_post_merge_proof`, `apply_stopped_reason`, and `safe_to_continue` are present for schema stability; in DRY-RUN, `apply_mode` is `NO` and apply actions are `NOT_RUN` / `NO` as appropriate.

- **`--apply-one-safe-pr` (explicit, off by default):** A **single** ultra-safe orchestration run (at most one PR). Proceeds only when the worktree is clean, the triage candidate exists, `risk_level=LOW`, changed paths are **only** `docs/**` **or** **only** `scripts/**` (same rule as DRY-RUN), there is no `assets/app.js`, `assets/app.css`, or `.github/workflows/**`, checks are not failed/pending, mergeability is not conflicting/dirty, and `allowed_action` is exactly **`SYNC_ONLY`** or **`VERIFY_AND_MERGE_IF_CLEAN`**. Otherwise it exits **0** with `apply_mode=YES`, `apply_stopped_reason=no_safe_candidate`, `apply_merge_attempted=NO`, and `safe_to_continue=YES` (safe stop). It does **not** run cap15/cap20, raw MaxCycles0, or AutonomousMode loops; it does **not** queue multiple PRs.

  - **`SYNC_ONLY`:** Runs `gh pr update-branch <N>`, polls until GitHub checks have no pending items, reloads the PR and file list, re-evaluates, and **stops safely** if `allowed_action` is not `VERIFY_AND_MERGE_IF_CLEAN` afterward (`post_sync_not_merge_ready`, `safe_to_continue=YES`).
  - **`VERIFY_AND_MERGE_IF_CLEAN`:** Re-verifies scope, checks, and `mergeStateStatus=CLEAN`, then runs `gh pr merge <N> --squash --delete-branch`, then `git checkout main` and `git pull --ff-only`, then post-merge proof: `node scripts/silver-pr-orchestrator-v1.cjs --dry-run`, `node scripts/silver-autopilot.cjs --status`, and `npm run smoke`. On proof failure the report records `apply_post_merge_proof=FAIL` and `safe_to_continue=NO`.

- **`--apply`:** Still **forbidden** (legacy flag). Do not wire orchestrator apply to `silver-autopilot.cjs` auto loops, **cap20**, **raw MaxCycles0**, or **AutonomousMode** until an explicit broader design + human gate.

## Worktree hygiene

- The repository worktree must be **fully clean** (`git status --porcelain` empty) **before** starting DRY-RUN or APPLY. If it is not, the script stops immediately (writes a report, `blocked_reason=WORKTREE_NOT_CLEAN`, exit non-zero for this fatal path).
- After a successful run, `git_status_clean_after` is **YES** if the worktree is empty **or** the only detected change is this orchestrator’s own output file `scripts/silver-pr-orchestrator-v1-report.json`. Any other modification forces `safe_to_enable_apply_mode=NO` in DRY-RUN.

## Errors and reporting

- **Every** external command uses an internal `runCommand()` helper; failures do not crash without a report.
- On any fatal error, the script writes (or overwrites) `scripts/silver-pr-orchestrator-v1-report.json` with `error=YES`, `error_stage`, `error_message`, `allowed_action=STOP_FAIL`, `would_merge=NO`, `would_push=NO`, `safe_to_enable_apply_mode=NO`, then attempts `git checkout main` (best effort) and exits with a non-zero code.

## DRY-RUN semantics

- **`would_merge` and `would_push` are always `NO` in `--dry-run`**, even when `allowed_action` is `SYNC_ONLY`. The report may still recommend a human-run command (e.g. `gh pr sync <n>`), but it does **not** claim the orchestrator would push or merge in this mode.
- **`safe_to_enable_apply_mode=YES`** (when present) refers only to a **future** gated apply path — not to automatic execution unless you pass `--apply-one-safe-pr` explicitly.

## Branch isolation

- DRY-RUN uses **GitHub CLI data only** (`gh pr view`, `gh pr diff --name-only`). It does **not** check out the candidate PR branch, `git merge`, `git reset`, `git push`, or `gh pr sync` / `gh pr update-branch`, and it does not alter `main` beyond an error-path best-effort `git checkout main`.

## Hard stops (summary)

The orchestrator refuses automation when it would hit high-risk or unknown surfaces, including:

- `assets/app.js` → `STOP_HIGH_RISK`
- `assets/app.css` → `STOP_UNKNOWN`
- `.github/workflows/**` → `STOP_UNKNOWN`
- `mergeStateStatus` / mergeability indicating conflicts or dirty state → `STOP_CONFLICTING`
- Pending checks → `STOP_PENDING`
- Failed checks → `STOP_FAIL`
- Paths outside **only** `docs/**` or **only** `scripts/**` (for the low-risk merge path) → `STOP_UNKNOWN` / engine-surface guard

### `mergeStateStatus` edge cases

GitHub can return `mergeStateStatus=UNKNOWN` while `mergeable=MERGEABLE`. For a **low-risk** candidate (`docs/**` or `scripts/**` only), **clean checks** (no pending/fail), and a **sync backlog hint** (`governance_category=NEEDS_REBASE_OR_SYNC` and/or triage `SYNC_SAFE_LOW_RISK`), the orchestrator maps this to **`SYNC_ONLY`** with `blocked_reason=merge_state_unknown_sync_first` (DRY-RUN still forces `would_merge` / `would_push` to `NO`; the recommended command remains `gh pr sync` for a human).

GitHub can also return **`mergeStateStatus=UNKNOWN` and `mergeable=UNKNOWN`**. For an **ultra-safe** sync-only classification, the orchestrator requires **all** of: `governance_category=NEEDS_REBASE_OR_SYNC`, triage `SYNC_SAFE_LOW_RISK`, changed paths **only** under `docs/**` or **only** under `scripts/**`, `paths_n > 0`, no pending/failed checks, and no earlier hard-stop (conflict, draft, `assets/app.js`, `assets/app.css`, workflows). Then it maps to **`SYNC_ONLY`** with `blocked_reason=branch_behind_base_sync_first`. This is **classification / human sync recommendation only** in DRY-RUN — DRY-RUN keeps `would_merge=NO` and `would_push=NO`; it does **not** run `gh pr sync` or `gh pr update-branch`.

When the decision is still **`STOP_UNKNOWN`**, `blocked_reason` appends a compact diagnostic after `unclassified_paths_or_merge_state;` (`merge_state`, `mergeable`, path counts, check counters, governance/triage categories).

It **must not** target Silver engine or high-risk product PRs for automated apply. **`--apply-one-safe-pr`** is limited to the gates above and **one** PR per invocation.

## Run

```powershell
Set-Location C:\projects\filtr
node scripts/silver-pr-orchestrator-v1.cjs --dry-run
node scripts/silver-pr-orchestrator-v1.cjs --apply-one-safe-pr
```

## Output

JSON report: `scripts/silver-pr-orchestrator-v1-report.json` — includes `mode` (`DRY_RUN` or `APPLY_ONE_SAFE_PR`), `main_commit`, candidate fields, `allowed_action`, `would_merge` / `would_push` (always `NO` in DRY-RUN), `safe_to_enable_apply_mode`, `git_status_clean_before` / `git_status_clean_after`, `error` / `error_stage` / `error_message` on failure, `branch_isolation_gh_only`, `dry_run_no_push_merge`, and `recommended_next_command`.

**Apply mode** additionally sets: `apply_mode`, `apply_candidate_pr`, `apply_sync_attempted`, `apply_sync_result`, `apply_merge_attempted`, `apply_merge_result`, `apply_post_merge_proof`, `apply_stopped_reason`, `safe_to_continue`.
