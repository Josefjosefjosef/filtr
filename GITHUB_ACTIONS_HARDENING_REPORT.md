# GitHub Actions Hardening Report

## WORKFLOWS_SCANNED

37 workflow files under `.github/workflows/` (including duplicates from path normalization).

## PERMISSIONS_OK

Most CI/guard workflows already use minimal scopes (`contents: read`, `statuses: write`).

## FIXES_APPLIED

| Workflow | Before | After | Rationale |
|----------|--------|-------|-----------|
| `nightly-health-report.yml` | default (contents: write) | `contents: read` | Read-only scan + artifacts |
| `pr-health-report-audit.yml` | default | `contents: read` | PR audit, no writes |

## NEEDS_REVIEW (intentionally unchanged)

| Workflow | Permissions | Reason |
|----------|-------------|--------|
| `update-articles.yml` | contents + PR + actions write | Data bot commits |
| `update-articles-fast-pool.yml` | contents + PR + actions write | Fast pool publish |
| `articles-nightly-full-rebuild.yml` | contents + PR write | Nightly rebuild PRs |
| `pages.yml` | pages + id-token write | GitHub Pages deploy |
| `generate-lockfile.yml` | contents write | Lockfile bot |
| `handoff-cleanup.yml` | contents write | History cleanup |
| `update-weather*.yml`, `update-namedays.yml` | contents write | Scheduled data commits |
| `after-merge-verify.yml` | actions: write | Re-run workflows |

## DO_NOT_CHANGE_LIST

- Article/data pipeline workflows with `contents: write` — **required for automation**.
- `pages.yml` Pages deploy permissions.
- `layout-guard.yml` / `repo-guard.yml` — `statuses: write` for required checks.
- Workflows using `pull_request_target` — changing permissions can break fork PR checks (**NEEDS REVIEW** per workflow).

## Secrets Usage

- `GITHUB_TOKEN` — scoped by workflow permissions (improved for nightly/PR audit).
- `HEALTH_EMAIL_TO`, deploy secrets — not exposed in logs; no change.
- No hardcoded PATs found in workflows.

## Recommendation

Phase 2: add top-level `permissions: contents: read` default at org level; override per workflow that needs write.
