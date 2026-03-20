#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CSS debt guardrail: AST tinycss2 duplicate audit vs locked baseline.
Hard FAIL: duplicate groups/occurrences rise, risky_layout_coupled rise, CSS size > baseline+budget,
or debt_verdict true_debt / risk_now group counts rise.
Soft WARN: intentional_non_debt or unresolved_needs_review rises; legacy technical-class soft path if no debt baseline.
No token-based duplicateSelectors — only css_duplicate_audit metrics.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

ROOT = Path(__file__).resolve().parent.parent
BASELINE_PATH = Path(__file__).resolve().parent / "css_debt_baseline.json"
APP_CSS = ROOT / "assets" / "app.css"


def risk_zone_hit(selector_normalized: str) -> bool:
    s = selector_normalized.lower()
    if "topbar" in s or "iutopbar" in s:
        return True
    if "iuleftrail" in s or "accordioncol" in s or "leftnav" in s or "iu-left" in s:
        return True
    if "#feed" in s or "newslist" in s or "iucenterstage" in s or "newswrap" in s:
        return True
    if "mindmenu" in s or "mmquick" in s or "iu-mm" in s:
        return True
    if "overlay" in s or "modal" in s or "fullscreen" in s:
        return True
    if ":hover" in s or ":focus" in s or ":active" in s or ":checked" in s:
        return True
    if "::before" in s or "::after" in s or ":before" in s or ":after" in s:
        return True
    if ".open" in s or ".active" in s or "is-active" in s or "aria-expanded" in s or "data-" in s:
        return True
    return False


def load_baseline(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def audit_current() -> Tuple[Dict[str, Any], int]:
    from css_duplicate_audit import audit_css_file

    d = audit_css_file(APP_CSS)
    if d.get("error"):
        raise RuntimeError(d["error"])
    raw_bytes = APP_CSS.stat().st_size
    return d, raw_bytes


def risk_zone_entries(d: Dict[str, Any]) -> List[Dict[str, str]]:
    out = []
    for g in d.get("duplicate_groups_brief") or []:
        if risk_zone_hit(g["selector_normalized"]):
            out.append(
                {"selector_normalized": g["selector_normalized"], "classification": g["classification"]}
            )
    out.sort(key=lambda x: (x["selector_normalized"], x["classification"]))
    return out


def pair_set(entries: List[Dict[str, str]]) -> Set[Tuple[str, str]]:
    return {(e["selector_normalized"], e["classification"]) for e in entries}


def evaluate_guard(
    baseline: Dict[str, Any], current: Dict[str, Any], raw_bytes: int
) -> Dict[str, Any]:
    """Returns exit_code, markdown lines (no print)."""
    b_g = baseline["duplicate_selector_groups"]
    b_o = baseline["duplicate_rule_occurrences_in_groups"]
    b_c = baseline["classification_counts"]
    b_bytes = baseline["app_css_bytes"]
    budget = int(baseline.get("css_size_guard_budget_bytes", 4096))

    c_g = current["duplicate_selector_groups"]
    c_o = current["duplicate_rule_occurrences_in_groups"]
    c_c = current["classification_counts"]
    b_dv = baseline.get("debt_verdict_counts") or {}
    c_dv = current.get("debt_verdict_counts") or {}
    b_do = baseline.get("debt_occurrence_counts") or {}
    c_do = current.get("debt_occurrence_counts") or {}

    hard_reasons: List[str] = []
    if c_g > b_g:
        hard_reasons.append(f"duplicate_selector_groups {c_g} > baseline {b_g} (+{c_g - b_g})")
    if c_o > b_o:
        hard_reasons.append(f"duplicate_occurrences {c_o} > baseline {b_o} (+{c_o - b_o})")
    if c_c.get("risky_layout_coupled", 0) > b_c.get("risky_layout_coupled", 0):
        hard_reasons.append(
            f"risky_layout_coupled {c_c['risky_layout_coupled']} > baseline {b_c['risky_layout_coupled']}"
        )
    if raw_bytes > b_bytes + budget:
        hard_reasons.append(
            f"app.css bytes {raw_bytes} > baseline {b_bytes} + budget {budget} (max allowed {b_bytes + budget})"
        )
    if b_dv and c_dv:
        if c_dv.get("true_debt", 0) > b_dv.get("true_debt", 0):
            hard_reasons.append(
                f"debt_verdict true_debt groups {c_dv.get('true_debt', 0)} > baseline {b_dv.get('true_debt', 0)}"
            )
        if c_dv.get("risk_now", 0) > b_dv.get("risk_now", 0):
            hard_reasons.append(
                f"debt_verdict risk_now groups {c_dv.get('risk_now', 0)} > baseline {b_dv.get('risk_now', 0)}"
            )

    soft_warns: List[str] = []
    if b_dv and c_dv:
        if c_dv.get("intentional_non_debt", 0) > b_dv.get("intentional_non_debt", 0):
            soft_warns.append(
                f"debt_verdict intentional_non_debt: {c_dv.get('intentional_non_debt', 0)} > baseline "
                f"{b_dv.get('intentional_non_debt', 0)} (allowed / non-debt duplicates — not auto-fail)"
            )
        if c_dv.get("unresolved_needs_review", 0) > b_dv.get("unresolved_needs_review", 0):
            soft_warns.append(
                f"debt_verdict unresolved_needs_review: {c_dv.get('unresolved_needs_review', 0)} > baseline "
                f"{b_dv.get('unresolved_needs_review', 0)}"
            )
    else:
        for k in ("breakpoint_specific", "intentional_cascade_candidate", "identical_duplicate"):
            if c_c.get(k, 0) > b_c.get(k, 0):
                soft_warns.append(
                    f"{k}: {c_c.get(k, 0)} > baseline {b_c.get(k, 0)} (+{c_c.get(k, 0) - b_c.get(k, 0)})"
                )

    base_risk = pair_set(baseline.get("risk_zone_duplicate_groups") or [])
    cur_risk = pair_set(risk_zone_entries(current))
    new_risk = cur_risk - base_risk
    new_risk_list = sorted(new_risk)[:30]

    lines: List[str] = []
    lines.append("| metric | baseline | current | delta |")
    lines.append("|--------|----------|---------|-------|")
    lines.append(f"| duplicate_selector_groups | {b_g} | {c_g} | {c_g - b_g:+d} |")
    lines.append(f"| duplicate_occurrences | {b_o} | {c_o} | {c_o - b_o:+d} |")
    for cls in (
        "risky_layout_coupled",
        "breakpoint_specific",
        "intentional_cascade_candidate",
        "identical_duplicate",
    ):
        bv = b_c.get(cls, 0)
        cv = c_c.get(cls, 0)
        lines.append(f"| {cls} | {bv} | {cv} | {cv - bv:+d} |")
    lines.append("| **debt_verdict (groups)** | — | — | — |")
    for dvk in ("intentional_non_debt", "true_debt", "risk_now", "unresolved_needs_review"):
        bv = b_dv.get(dvk, 0) if b_dv else 0
        cv = c_dv.get(dvk, 0) if c_dv else 0
        lines.append(f"| debt: {dvk} | {bv} | {cv} | {cv - bv:+d} |")
    lines.append("| **debt_verdict (occurrences)** | — | — | — |")
    for dvk in ("intentional_non_debt", "true_debt", "risk_now", "unresolved_needs_review"):
        bv = b_do.get(dvk, 0) if b_do else 0
        cv = c_do.get(dvk, 0) if c_do else 0
        lines.append(f"| debt occ: {dvk} | {bv} | {cv} | {cv - bv:+d} |")
    lines.append(f"| app.css raw bytes | {b_bytes} | {raw_bytes} | {raw_bytes - b_bytes:+d} |")
    lines.append(f"| size budget | +{budget} bytes max | — | — |")
    lines.append("")
    lines.append(f"**NEW_RISK_PATTERN_HITS:** **{len(new_risk)}**")
    if new_risk_list:
        for sel, cl in new_risk_list[:15]:
            lines.append(f"- `{sel[:100]}{'…' if len(sel)>100 else ''}` ({cl})")
        if len(new_risk) > 15:
            lines.append(f"- … +{len(new_risk) - 15} more")
    lines.append("")
    lines.append(
        "**Rules:** HARD FAIL if duplicate groups/occurrences rise, risky_layout_coupled rises, raw CSS > baseline+4KB, "
        "or **debt_verdict true_debt / risk_now** group counts rise. "
        "SOFT WARN if **intentional_non_debt** or **unresolved_needs_review** rises (allowed/non-debt or needs-review — not automatic debt), "
        "or new risk-zone duplicate patterns; legacy soft-warn on technical class counts only if debt_verdict baseline missing."
    )
    lines.append("")

    hard_fail = len(hard_reasons) > 0
    if hard_fail:
        msg = "CSS_DEBT_GUARD_HARD_FAIL: " + "; ".join(hard_reasons)
        if new_risk:
            msg += f" | AND NEW_RISK_PATTERN_HITS={len(new_risk)}"
        lines.insert(0, f"**VERDICT: FAIL** — {msg}\n")
        return {"exit_code": 1, "lines": lines, "github_error": msg}

    if soft_warns:
        w = "CSS_DEBT_SOFT_WARN: " + "; ".join(soft_warns)
        lines.insert(0, f"**VERDICT: PASS (soft warnings)** — {w}\n")
        return {"exit_code": 0, "lines": lines, "github_error": None, "github_warning": w}

    if new_risk:
        w = f"CSS_DEBT_SOFT_WARN: NEW_RISK_PATTERN_HITS={len(new_risk)} (hard metrics OK)"
        lines.insert(0, f"**VERDICT: PASS (soft warnings)** — {w}\n")
        return {"exit_code": 0, "lines": lines, "github_error": None, "github_warning": w}

    lines.insert(0, "**VERDICT: PASS** — at or below baseline; no new risk-zone duplicate groups.\n")
    return {"exit_code": 0, "lines": lines, "github_error": None}


def markdown_for_health_report() -> str:
    if not BASELINE_PATH.exists():
        return "_CSS debt guard: baseline file missing._\n"
    bl = load_baseline(BASELINE_PATH)
    cur, raw_b = audit_current()
    ev = evaluate_guard(bl, cur, raw_b)
    return "\n".join(ev["lines"]) + f"\n\n`CSS_DEBT_GUARD_EXIT={ev['exit_code']}`\n"


def run_guard(
    baseline: Dict[str, Any],
    current: Dict[str, Any],
    raw_bytes: int,
    emit_github: bool,
) -> int:
    ev = evaluate_guard(baseline, current, raw_bytes)
    if emit_github:
        if ev.get("github_error"):
            print(f"::error::{ev['github_error']}")
        elif ev.get("github_warning"):
            print(f"::warning::{ev['github_warning']}")
    elif ev.get("github_error"):
        print(ev["github_error"], file=sys.stderr)
    print("\n".join(ev["lines"]))
    return int(ev["exit_code"])


def selftest() -> int:
    """CASE 1–4 logic proof (no filesystem baseline mutation)."""
    from css_duplicate_audit import audit_css_file

    cur, raw_b = audit_current()
    bl = load_baseline(BASELINE_PATH)
    # CASE 1
    if run_guard(bl, cur, raw_b, emit_github=False) != 0:
        print("SELFTEST_FAIL: CASE1 baseline=current should PASS", file=sys.stderr)
        return 1
    print("SELFTEST_OK CASE1 baseline vs current PASS")

    # CASE 2 hard fail — synthetic baseline stricter
    tight = json.loads(json.dumps(bl))
    tight["duplicate_selector_groups"] = max(0, cur["duplicate_selector_groups"] - 1)
    if run_guard(tight, cur, raw_b, emit_github=False) == 0:
        print("SELFTEST_FAIL: CASE2 should FAIL on groups", file=sys.stderr)
        return 1
    print("SELFTEST_OK CASE2 hard fail on duplicate groups")

    tight2 = json.loads(json.dumps(bl))
    tight2["classification_counts"] = dict(bl["classification_counts"])
    tight2["classification_counts"]["risky_layout_coupled"] = max(
        0, cur["classification_counts"]["risky_layout_coupled"] - 1
    )
    if run_guard(tight2, cur, raw_b, emit_github=False) == 0:
        print("SELFTEST_FAIL: CASE2b should FAIL on risky_layout_coupled", file=sys.stderr)
        return 1
    print("SELFTEST_OK CASE2b hard fail on risky_layout_coupled")

    # CASE 3 soft only — debt_verdict intentional_non_debt rises vs baseline (allowed duplicates), hard metrics unchanged
    loose = json.loads(json.dumps(bl))
    if loose.get("debt_verdict_counts") and cur.get("debt_verdict_counts"):
        loose["debt_verdict_counts"] = dict(loose["debt_verdict_counts"])
        loose["debt_verdict_counts"]["intentional_non_debt"] = cur["debt_verdict_counts"]["intentional_non_debt"] - 1
        if loose.get("debt_occurrence_counts") and cur.get("debt_occurrence_counts"):
            loose["debt_occurrence_counts"] = dict(loose["debt_occurrence_counts"])
            loose["debt_occurrence_counts"]["intentional_non_debt"] = cur["debt_occurrence_counts"][
                "intentional_non_debt"
            ] - 1
        fake_cur = json.loads(json.dumps(cur))
        fake_cur["debt_verdict_counts"] = dict(cur["debt_verdict_counts"])
        fake_cur["debt_verdict_counts"]["intentional_non_debt"] = loose["debt_verdict_counts"][
            "intentional_non_debt"
        ] + 1
        if fake_cur.get("debt_occurrence_counts") and loose.get("debt_occurrence_counts"):
            fake_cur["debt_occurrence_counts"] = dict(cur["debt_occurrence_counts"])
            fake_cur["debt_occurrence_counts"]["intentional_non_debt"] = loose["debt_occurrence_counts"][
                "intentional_non_debt"
            ] + 1
        rc = run_guard(loose, fake_cur, raw_b, emit_github=False)
        if rc != 0:
            print("SELFTEST_FAIL: CASE3 soft-only should PASS exit 0", file=sys.stderr)
            return 1
        print("SELFTEST_OK CASE3 soft warn only PASS exit 0")
    else:
        print("SELFTEST_SKIP CASE3 (no debt_verdict_counts in baseline)")

    # CASE 4 size fail
    tiny = json.loads(json.dumps(bl))
    tiny["app_css_bytes"] = raw_b - 5000
    if run_guard(tiny, cur, raw_b, emit_github=False) == 0:
        print("SELFTEST_FAIL: CASE4 size should FAIL", file=sys.stderr)
        return 1
    print("SELFTEST_OK CASE4 size over budget FAIL")

    print("CSS_DEBT_GUARD_SELFTEST_ALL_OK")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--github-actions", action="store_true", help="Emit ::error:: / ::warning::")
    ap.add_argument("--json-summary", type=Path, help="Write machine-readable summary")
    args = ap.parse_args()
    if args.selftest:
        return selftest()
    if not BASELINE_PATH.exists():
        print(f"Missing {BASELINE_PATH}", file=sys.stderr)
        return 2
    baseline = load_baseline(BASELINE_PATH)
    cur, raw_b = audit_current()
    emit = args.github_actions or bool(os.environ.get("GITHUB_ACTIONS"))
    exit_code = run_guard(baseline, cur, raw_b, emit_github=emit)
    if args.json_summary:
        summary = {
            "exit_code": exit_code,
            "current": {
                "duplicate_selector_groups": cur["duplicate_selector_groups"],
                "duplicate_rule_occurrences_in_groups": cur["duplicate_rule_occurrences_in_groups"],
                "classification_counts": cur["classification_counts"],
                "app_css_bytes": raw_b,
            },
            "baseline": {
                "duplicate_selector_groups": baseline["duplicate_selector_groups"],
                "duplicate_rule_occurrences_in_groups": baseline["duplicate_rule_occurrences_in_groups"],
                "classification_counts": baseline["classification_counts"],
                "app_css_bytes": baseline["app_css_bytes"],
            },
        }
        args.json_summary.parent.mkdir(parents=True, exist_ok=True)
        args.json_summary.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
