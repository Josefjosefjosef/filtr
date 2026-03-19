# CSS debt guardrail (AST baseline lock)

- **Source of truth for duplicate metrics:** `scripts/css_duplicate_audit.py` (tinycss2 AST), not token `duplicateSelectors`.
- **Baseline:** `scripts/css_debt_baseline.json` (groups, occurrences, classification counts, raw `assets/app.css` bytes, risk-zone duplicate fingerprint).
- **Size budget:** +4096 bytes over baseline `app_css_bytes` → HARD FAIL.

## When metrics worsen

1. **HARD FAIL (CI):** duplicate groups ↑, occurrences ↑, `risky_layout_coupled` ↑, or CSS size over budget.
2. **SOFT WARN:** only `breakpoint_specific` / `intentional_cascade_candidate` / `identical_duplicate` ↑, or new duplicate groups in guarded selector zones (topbar, rails, feed, accordion, mindMenu, overlay, pseudo-states, etc.).

## Updating the baseline (intentional debt change)

After an approved CSS change that legitimately moves metrics:

1. Run `python3 scripts/css_debt_guard.py` on the new tree (should PASS at lock point).
2. Regenerate baseline JSON from the same audit state (groups + risk-zone list + byte size). Prefer a small script or manual edit consistent with `css_debt_baseline.json` schema `css_debt_guard_v1`.
3. Commit baseline + any workflow doc updates together with the CSS change (separate PR if policy requires).
