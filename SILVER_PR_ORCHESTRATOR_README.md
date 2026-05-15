# Silver PR Orchestrator V1

Scripts-only helper for **ranking the next safe GitHub PR step** using frozen backlog JSON (governance/triage **hints** only) plus live GitHub CLI data. Candidate selection uses an **explicit OPEN PR refresh**: `gh pr list --state open --json number` (sorted ascending), then `gh pr view` / `gh pr diff <PR> --name-only` for each open PR. **MERGED/CLOSED PRs never enter the pool** because they are not returned by the open list. It does **not** modify Silver engine code, UI, CSS, or backend.

## OPEN backlog refresh (triage / diagnostics)

- **Every run** loads `scripts/silver-pr-backlog-governance-v1-report.json` and `scripts/silver-pr-backlog-needs-sync-triage-v1-report.json` for per-PR category hints (`governance_category`, `candidate_category` / triage hints).
- **Candidate pool** = current **OPEN** PR numbers from GitHub only (`open_pr_filter_active=YES`, `open_backlog_refresh=YES`).
- The script scans each OPEN PR (ascending number), evaluates gates, and counts **ultra-safe** PRs (same rules as `--apply-one-safe-pr`: `applyUltraSafeGates` — LOW risk, docs-only or scripts-only, clean checks, no forbidden paths, `allowed_action` is `SYNC_ONLY` or `VERIFY_AND_MERGE_IF_CLEAN`).
- **Report fields:** `total_open_prs` (live open count), `safe_open_candidates` (count passing ultra-safe gates), `recommended_first_safe_candidate` (first such PR number, or `null`), `recommended_first_safe_candidate_state` (e.g. `OPEN`, or empty when none).
- If **no** ultra-safe OPEN PR exists: `allowed_action=no_safe_candidate`, `safe_open_candidates=0`, `recommended_first_safe_candidate=null`, `recommended_first_safe_candidate_state=""`, `safe_to_continue=YES` (dry-run and apply no-op exit). **No** sync, merge, apply, or push in that path.
- If a safe OPEN PR exists: the report focuses on that PR as `candidate_pr` / `recommended_first_safe_candidate` (same number); dry-run still forces `would_merge=NO` and `would_push=NO`.

## Modes

- **`--dry-run` (default path):** Runs the OPEN refresh + safe-pool scan above, then writes `scripts/silver-pr-orchestrator-v1-report.json`. **Only `state=OPEN` pull requests are in the pool**; merged/closed PRs from frozen JSON are ignored for selection. **DRY-RUN never merges, never pushes, never runs `gh pr update-branch`, never checks out the candidate PR branch, and never uses local branch manipulation for scope detection.** No cap15/cap20, raw MaxCycles0, or AutonomousMode loops. Report fields `apply_mode`, `apply_sync_*`, `apply_merge_*`, `apply_post_merge_proof`, `apply_stopped_reason`, and `safe_to_continue` are present for schema stability; in DRY-RUN, `apply_mode` is `NO` and apply actions are `NOT_RUN` / `NO` as appropriate, except `safe_to_continue=YES` when triage completes without a fatal error.

- **`--apply-one-safe-pr` (explicit, off by default):** A **single** ultra-safe orchestration run (at most one PR). Proceeds when the worktree is clean **or** dirty **only** from this script’s own `scripts/silver-pr-orchestrator-v1-report.json` (auto-`git restore` before the gate); any other dirty path aborts like DRY-RUN. **Candidate selection uses the same live OPEN PR pool and scan as `--dry-run`:** the first OPEN PR that passes `applyUltraSafeGates` is the apply target (frozen `recommended_first_sync_candidate` is **not** used for selection). If no OPEN PR passes the gates, the script exits **0** with `apply_stopped_reason=no_safe_candidate`, `apply_candidate_pr=null`, `apply_sync_attempted=NO`, `apply_merge_attempted=NO`, `safe_to_continue=YES`, and `allowed_action=no_safe_candidate`. If the first safe PR closes between scan and apply, evaluation yields `STOP_CLOSED_OR_MERGED` / `pr_not_open` and apply exits **0** with `apply_stopped_reason=no_safe_candidate` (or `pr_not_open` as appropriate). **Immediately before** `gh pr update-branch` or `gh pr merge`, the script re-fetches `state`; if the PR is not `OPEN`, it exits **0** with `apply_stopped_reason=pr_not_open`, `apply_sync_attempted=NO` / `apply_merge_attempted=NO` as appropriate, and `safe_to_continue=YES`. It does **not** run cap15/cap20, raw MaxCycles0, or AutonomousMode loops; it does **not** queue multiple PRs.

  - **`SYNC_ONLY`:** After an **OPEN** re-check, runs `gh pr update-branch <N>`, polls until GitHub checks have no pending items (or stops with `pr_not_open` if the PR closes), reloads the PR and file list, re-evaluates, and **stops safely** if `allowed_action` is not `VERIFY_AND_MERGE_IF_CLEAN` afterward (`post_sync_not_merge_ready`, `safe_to_continue=YES`).
  - **`VERIFY_AND_MERGE_IF_CLEAN`:** Re-verifies scope, checks, `mergeStateStatus=CLEAN`, and **OPEN** state, then runs `gh pr merge <N> --squash --delete-branch`, then `git checkout main` and `git pull --ff-only`, then post-merge proof: `node scripts/silver-pr-orchestrator-v1.cjs --dry-run`, `node scripts/silver-autopilot.cjs --status`, and `npm run smoke`. On proof failure the report records `apply_post_merge_proof=FAIL` and `safe_to_continue=NO`.

- **`--apply`:** Still **forbidden** (legacy flag). Do not wire orchestrator apply to `silver-autopilot.cjs` auto loops, **cap20**, **raw MaxCycles0**, or **AutonomousMode** until an explicit broader design + human gate.

## Worktree hygiene

- The repository worktree must be **fully clean** (`git status --porcelain` empty) **before** starting **DRY-RUN**. If it is not, the script stops immediately (writes a report, `blocked_reason=WORKTREE_NOT_CLEAN`, exit non-zero for this fatal path).
- **`--apply-one-safe-pr` pre-gate:** If the worktree is dirty **only** because of the orchestrator’s own tracked output `scripts/silver-pr-orchestrator-v1-report.json` (for example after a prior `--dry-run`), the script runs `git restore scripts/silver-pr-orchestrator-v1-report.json` and continues. If **any** other path is dirty, it stops with `WORKTREE_NOT_CLEAN` (same fatal path as DRY-RUN).
- After a successful run, `git_status_clean_after` is **YES** if the worktree is empty **or** the only detected change is this orchestrator’s own output file `scripts/silver-pr-orchestrator-v1-report.json`. Any other modification forces `safe_to_enable_apply_mode=NO` in DRY-RUN.

## Errors and reporting

- **Every** external command uses an internal `runCommand()` helper; failures do not crash without a report.
- On any fatal error, the script writes (or overwrites) `scripts/silver-pr-orchestrator-v1-report.json` with `error=YES`, `error_stage`, `error_message`, `allowed_action=STOP_FAIL`, `would_merge=NO`, `would_push=NO`, `safe_to_enable_apply_mode=NO`, then attempts `git checkout main` (best effort) and exits with a non-zero code.

## DRY-RUN semantics

- **`would_merge` and `would_push` are always `NO` in `--dry-run`**, even when `allowed_action` is `SYNC_ONLY`. The report may still recommend a human-run command (e.g. `gh pr update-branch <n>`), but it does **not** claim the orchestrator would push or merge in this mode.
- **`safe_to_enable_apply_mode=YES`** (when present) refers only to a **future** gated apply path — not to automatic execution unless you pass `--apply-one-safe-pr` explicitly.

## Branch isolation

- DRY-RUN uses **GitHub CLI data only** (`gh pr view`, `gh pr diff --name-only`). It does **not** check out the candidate PR branch, `git merge`, `git reset`, `git push`, or `gh pr update-branch`, and it does not alter `main` beyond an error-path best-effort `git checkout main`.

## Hard stops (summary)

The orchestrator refuses automation when it would hit high-risk or unknown surfaces, including:

- `assets/app.js` → `STOP_HIGH_RISK`
- `assets/app.css` → `STOP_UNKNOWN`
- `.github/workflows/**` → `STOP_UNKNOWN`
- `mergeStateStatus` / mergeability indicating conflicts or dirty state → `STOP_CONFLICTING`
- Pending checks → `STOP_PENDING`
- Failed checks → `STOP_FAIL`
- **`state` not `OPEN` (e.g. `MERGED`, `CLOSED`)** → `STOP_CLOSED_OR_MERGED` / `pr_not_open` (never `SYNC_ONLY`, never merge in apply)
- Paths outside **only** `docs/**` or **only** `scripts/**` (for the low-risk merge path) → `STOP_UNKNOWN` / engine-surface guard

### `mergeStateStatus` edge cases

GitHub can return `mergeStateStatus=UNKNOWN` while `mergeable=MERGEABLE`. For a **low-risk** candidate (`docs/**` or `scripts/**` only), **clean checks** (no pending/fail), and a **sync backlog hint** (`governance_category=NEEDS_REBASE_OR_SYNC` and/or triage `SYNC_SAFE_LOW_RISK`), the orchestrator maps this to **`SYNC_ONLY`** with `blocked_reason=merge_state_unknown_sync_first` (DRY-RUN still forces `would_merge` / `would_push` to `NO`; the recommended command is `gh pr update-branch <n>` for a human).

GitHub can also return **`mergeStateStatus=UNKNOWN` and `mergeable=UNKNOWN`**. For an **ultra-safe** sync-only classification, the orchestrator requires **all** of: `governance_category=NEEDS_REBASE_OR_SYNC`, triage `SYNC_SAFE_LOW_RISK`, changed paths **only** under `docs/**` or **only** under `scripts/**`, `paths_n > 0`, no pending/failed checks, and no earlier hard-stop (conflict, draft, `assets/app.js`, `assets/app.css`, workflows). Then it maps to **`SYNC_ONLY`** with `blocked_reason=branch_behind_base_sync_first`. This is **classification / human sync recommendation only** in DRY-RUN — DRY-RUN keeps `would_merge=NO` and `would_push=NO`; it does **not** run `gh pr update-branch`.

When the decision is still **`STOP_UNKNOWN`**, `blocked_reason` appends a compact diagnostic after `unclassified_paths_or_merge_state;` (`merge_state`, `mergeable`, path counts, check counters, governance/triage categories).

It **must not** target Silver engine or high-risk product PRs for automated apply. **`--apply-one-safe-pr`** is limited to the gates above and **one** PR per invocation.

## Run

```powershell
Set-Location C:\projects\filtr
node scripts/silver-pr-orchestrator-v1.cjs --dry-run
node scripts/silver-pr-orchestrator-v1.cjs --apply-one-safe-pr
```

## Output

JSON report: `scripts/silver-pr-orchestrator-v1-report.json` — includes `mode` (`DRY_RUN` or `APPLY_ONE_SAFE_PR`), `main_commit`, **OPEN pool** fields (`total_open_prs`, `safe_open_candidates`, `recommended_first_safe_candidate`, `recommended_first_safe_candidate_state`, `open_backlog_refresh`, `open_pr_filter_active`), candidate fields (`candidate_pr`, `candidate_state`, …), `allowed_action` (including `no_safe_candidate` when the OPEN pool has no ultra-safe PR), `would_merge` / `would_push` (always `NO` in DRY-RUN), `safe_to_enable_apply_mode`, `git_status_clean_before` / `git_status_clean_after`, `error` / `error_stage` / `error_message` on failure, `branch_isolation_gh_only`, `dry_run_no_push_merge`, `recommended_next_command`, and `safe_to_continue` (dry-run sets `YES` when the run finishes without a fatal worktree/gh error).

**Apply mode** additionally sets: `apply_mode`, `apply_candidate_pr`, `apply_candidate_state`, `apply_sync_attempted`, `apply_sync_result`, `apply_merge_attempted`, `apply_merge_result`, `apply_post_merge_proof`, `apply_stopped_reason`, `safe_to_continue`.
