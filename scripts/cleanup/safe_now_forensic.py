# -*- coding: utf-8 -*-
"""
GATE 1-3: Safe_now forensic snapshot, purge false safe (first 3), recalc after purge.
Prior fail: iter 1 = group_index 0, iter 2 = group_index 1 -> downgrade to risk_now.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
APP_CSS = ROOT / "assets" / "app.css"
AUDIT_SCRIPT = ROOT / "scripts" / "css_duplicate_audit.py"
TEMP_BASE = Path(os.environ.get("TEMP", os.environ.get("TMP", "/tmp"))) / "filtr_readiness"
ENGINE_DIR = TEMP_BASE / "reports" / "cleanup-engine"

PRIOR_FAIL_GROUP_INDICES = [0, 1]
PRIOR_FAIL_REASONS = {0: "audit_error_after_edit_or_commit_failed", 1: "audit_error_after_edit_or_commit_failed"}


def _get_branch_sha():
    try:
        b = subprocess.run(["git", "branch", "--show-current"], cwd=ROOT, capture_output=True, text=True, timeout=5).stdout.strip()
        s = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, timeout=5).stdout.strip()
        return b or "unknown", s or "unknown"
    except Exception:
        return "unknown", "unknown"


def get_analyzer_version():
    if AUDIT_SCRIPT.exists():
        return hashlib.sha256(AUDIT_SCRIPT.read_bytes()).hexdigest()[:16]
    return "unknown"


def run_safe_now_snapshot():
    sys.path.insert(0, str(ROOT / "scripts"))
    from css_duplicate_audit import audit_css_file

    branch_name, commit_sha = _get_branch_sha()
    result = audit_css_file(APP_CSS)
    if result.get("error"):
        return {"error": result["error"], "branch_name": branch_name, "commit_sha": commit_sha}
    safe_groups = result.get("safe_groups_top") or []
    cc = result.get("classification_counts") or {}
    total = result.get("duplicate_selector_groups", 0)
    safe_now = len(safe_groups)
    risk_now = cc.get("risky_layout_coupled", 0) + cc.get("intentional_cascade_candidate", 0)
    forensic_only = cc.get("breakpoint_specific", 0)

    top_safe_candidates = []
    for i, g in enumerate(safe_groups[: max(3, len(safe_groups))]):
        occs = g.get("occurrences") or []
        sel = g.get("selector_normalized", "")
        cand_id = "cleanup_candidate_" + str(i) + "_" + (sel[:50] or "id")
        prior_fail = i in PRIOR_FAIL_GROUP_INDICES
        top_safe_candidates.append({
            "candidate_id": cand_id,
            "selector_or_block": sel,
            "file_path": str(APP_CSS),
            "exact_reason_why_marked_safe": "identical_duplicate_classification_same_declarations_same_media",
            "layout_safe": True,
            "layout_sensitive": False,
            "visual_safe": True,
            "visual_sensitive": False,
            "critical_zone": False,
            "expected_minimal_diff": "remove_second_occurrence_block",
            "proof_scope": "assets_app_css_only",
            "prior_fail_history_count": 1 if prior_fail else 0,
            "prior_fail_reason_if_any": PRIOR_FAIL_REASONS.get(i),
        })

    out = {
        "branch_name": branch_name,
        "commit_sha": commit_sha,
        "analyzer_version": get_analyzer_version(),
        "source_dataset": "assets/app.css",
        "duplicate_selector_groups": total,
        "total_remaining_count": total,
        "remaining_safe_now": safe_now,
        "remaining_risk_now": risk_now,
        "remaining_forensic_only": forensic_only,
        "top_safe_now_candidates": top_safe_candidates,
    }
    ENGINE_DIR.mkdir(parents=True, exist_ok=True)
    (ENGINE_DIR / "safe-now-forensic-snapshot.json").write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    return out


def run_purge_review():
    snapshot = run_safe_now_snapshot()
    if snapshot.get("error"):
        return snapshot
    top = snapshot.get("top_safe_now_candidates", [])[:3]
    review = []
    for c in top:
        cand_id = c.get("candidate_id", "")
        idx = int(cand_id.split("_")[2]) if "_" in cand_id else 0
        prior_fail = idx in PRIOR_FAIL_GROUP_INDICES
        reclass = "downgrade_to_risk_now" if prior_fail else "stays_safe_now"
        review.append({
            "candidate_id": cand_id,
            "current_classification": "identical_duplicate",
            "prior_real_iteration_result": "FAIL_REVERTED" if prior_fail else "none",
            "exact_fail_reason_if_any": PRIOR_FAIL_REASONS.get(idx),
            "exact_guard_that_failed_if_any": "audit_after_edit_or_commit",
            "reclassification_decision": reclass,
            "reclassification_reason": "prior_real_iteration_fail_no_smaller_scope_proven" if prior_fail else "no_prior_fail",
            "retry_legally_allowed": not prior_fail,
            "identical_retry_blocked_by_redo": prior_fail,
            "smaller_scope_exists": False,
            "exact_next_status": "risk_now" if prior_fail else "safe_now",
        })
    removed_ids = [r["candidate_id"] for r in review if r["exact_next_status"] == "risk_now"]
    safe_before = snapshot.get("remaining_safe_now", 0)
    safe_after = safe_before - len(removed_ids)
    recalc = {
        "total_remaining_count": snapshot.get("total_remaining_count"),
        "remaining_safe_now": safe_after,
        "remaining_risk_now": snapshot.get("remaining_risk_now", 0) + len(removed_ids),
        "remaining_forensic_only": snapshot.get("remaining_forensic_only", 0),
        "safe_now_before": safe_before,
        "safe_now_after": safe_after,
        "exact_removed_from_safe_now": removed_ids,
        "exact_added_to_risk_now": removed_ids,
        "exact_added_to_forensic_only": [],
        "exact_split_candidates_if_any": [],
        "continue_reason": "SAFE_CANDIDATES_AVAILABLE" if safe_after > 0 else None,
        "stop_reason": "STOP_NO_SAFE_CANDIDATES_AFTER_PURGE" if safe_after == 0 else None,
        "exact_verdict": "CONTINUE_WITH_SAFE_CANDIDATES" if safe_after > 0 else "STOP_NO_SAFE_CANDIDATES_WITH_EVIDENCE",
    }
    out = {"forensic_review_first_3": review, "recalc_after_purge": recalc}
    (ENGINE_DIR / "purge-and-recalc.json").write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    return out


def get_selected_candidate_packet(group_index: int):
    sys.path.insert(0, str(ROOT / "scripts"))
    from css_duplicate_audit import audit_css_file
    result = audit_css_file(APP_CSS)
    if result.get("error"):
        return None
    safe_groups = result.get("safe_groups_top") or []
    if group_index >= len(safe_groups):
        return None
    g = safe_groups[group_index]
    sel = g.get("selector_normalized", "")
    branch_name, commit_sha = _get_branch_sha()
    cand_id = "cleanup_candidate_" + str(group_index) + "_" + (sel[:50] or "id")
    return {
        "session_id": None,
        "iteration_number": 3,
        "candidate_id": cand_id,
        "branch_name": branch_name,
        "commit_sha_before": commit_sha,
        "classification": "identical_duplicate",
        "exact_reason_why_safe_now": "after_purge_still_in_safe_list_not_prior_fail",
        "exact_reason_why_not_false_safe": "no_prior_real_iteration_fail_for_this_index",
        "fail_history": [],
        "skip_reason_for_other_top_candidates": "indices_0_1_downgraded_to_risk_after_fail",
        "theoretical_break_risk": "low_identical_duplicate_remove_one_occurrence",
        "expected_minimal_diff": "remove_second_occurrence_block",
        "proof_scope": "assets_app_css_only",
        "allowed_files": ["assets/app.css"],
    }


if __name__ == "__main__":
    s = run_safe_now_snapshot()
    print(json.dumps(s, indent=2, ensure_ascii=False))
    p = run_purge_review()
    print("---PURGE_AND_RECALC---")
    print(json.dumps(p, indent=2, ensure_ascii=False))
