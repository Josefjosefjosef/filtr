# Silver PR Orchestrator V1

Scripts-only helper for **ranking the next safe GitHub PR step** using frozen backlog JSON plus live `gh` data. It does **not** modify Silver engine code, UI, CSS, or backend.

## Modes

- **`--dry-run` (implemented):** Reads `scripts/silver-pr-backlog-governance-v1-report.json` and `scripts/silver-pr-backlog-needs-sync-triage-v1-report.json`, picks `recommended_first_sync_candidate`, runs `gh pr view`, evaluates hard stop rules, and writes `scripts/silver-pr-orchestrator-v1-report.json`. No merge, push, sync, branch checkout, or CI harness loops.
- **`--apply`:** **Not implemented and must stay disabled** until an explicit V2 design + human gate. Do not wire this to `silver-autopilot.cjs` auto loops, **cap20**, **raw MaxCycles0**, or **AutonomousMode** loops.

## Hard stops (summary)

The orchestrator refuses automation when it would hit high-risk or unknown surfaces, including:

- `assets/app.js` → `STOP_HIGH_RISK`
- `assets/app.css` → `STOP_UNKNOWN`
- `.github/workflows/**` → `STOP_UNKNOWN`
- `mergeStateStatus` / mergeability indicating conflicts or dirty state → `STOP_CONFLICTING`
- Pending checks → `STOP_PENDING`
- Failed checks → `STOP_FAIL`
- Paths outside **only** `docs/**` or **only** `scripts/**` (for the low-risk merge path) → `STOP_UNKNOWN` / engine-surface guard

It **must not** target Silver engine or high-risk product PRs for automated apply. The **first future apply candidate** should remain **low-risk docs-only or scripts-only** PRs that pass checks and are merge-clean after sync.

## Run

```powershell
Set-Location C:\projects\filtr
node scripts/silver-pr-orchestrator-v1.cjs --dry-run
```

## Output

JSON report: `scripts/silver-pr-orchestrator-v1-report.json` (`mode: "DRY_RUN"`, `main_commit`, candidate fields, `allowed_action`, `would_merge` / `would_push`, `safe_to_enable_apply_mode`, `recommended_next_command`).
