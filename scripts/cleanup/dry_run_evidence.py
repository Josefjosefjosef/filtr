# -*- coding: utf-8 -*-
"""
GATE 7: Evidence-only dry run. Creates full persisted evidence bundle in %TEMP%.
Does not modify CSS. Does not create cleanup commit.
Proves that next real iteration cannot end as PASS without evidence.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
TEMP_BASE = Path(os.environ.get("TEMP", os.environ.get("TMP", "/tmp"))) / "filtr_readiness"
ENGINE_BASE = TEMP_BASE / "reports" / "cleanup-engine"


def _get_branch_sha() -> tuple:
    try:
        b = subprocess.run(["git", "branch", "--show-current"], cwd=ROOT, capture_output=True, text=True, timeout=5).stdout.strip()
        s = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, timeout=5).stdout.strip()
        return (b or "unknown", s or "unknown")
    except Exception:
        return ("unknown", "unknown")


def run_dry_run(session_id: str = "dry-run-session", iteration_number: int = 1) -> dict:
    """Create full evidence bundle for one synthetic iteration. Returns result dict."""
    import sys
    if str(ROOT / "scripts") not in sys.path:
        sys.path.insert(0, str(ROOT / "scripts"))
    from cleanup.evidence_persistence import write_iteration_evidence_bundle
    from cleanup.evidence_validator import validate_evidence_for_iteration, pass_gate_formula

    branch_name, commit_sha = _get_branch_sha()
    candidate_packet = {
        "session_id": session_id,
        "iteration_number": iteration_number,
        "candidate_id": "dry_run_candidate_0",
        "selector_normalized": "dry-run-selector",
        "branch_name": branch_name,
        "commit_sha_before": commit_sha,
        "classification": "dry_run",
        "allowed_next_action": "dry_run_only",
    }
    pre_check = {"verdict": "PASS", "dry_run": True}
    diff_isolation = {"verdict": "PASS", "dry_run": True, "no_css_modified": True}
    proof_scope = {"verdict": "PASS", "scope": "assets_app_css_only", "dry_run": True}
    guard_chain = {
        "guard_count": 20,
        "all_passed": True,
        "blocking_guard_if_any": None,
        "dry_run": True,
    }
    hard_proof_raw = {
        "build_result": "PASS",
        "audit_result": "PASS",
        "cls_value": 0,
        "overflowX_value": False,
        "railShift_value": 0,
        "appErrorsCount": 0,
        "consoleErrorsCount": 0,
        "dry_run": True,
    }
    metric_delta = {"verdict": "PASS", "dry_run": True}
    closure = {
        "commit_sha_after_or_revert_proof": "dry_run_no_commit",
        "closure_type": "dry_run",
        "git_status_after": "unchanged",
        "dry_run": True,
    }
    redo_block = {
        "candidate_id": "dry_run_candidate_0",
        "attempt_count": 0,
        "last_result": "dry_run",
        "identical_retry_blocked": False,
        "legal_next_actions": ["dry_run_only"],
        "dry_run": True,
    }
    checkpoint = {
        "iteration_number": iteration_number,
        "checkpoint_at": "dry_run",
        "state": "evidence_bundle_complete",
        "dry_run": True,
    }
    final_forensic_record = {
        "session_id": session_id,
        "iteration_number": iteration_number,
        "candidate_id": "dry_run_candidate_0",
        "final_verdict": "DRY_RUN_COMPLETE",
        "closure_proof": "no_css_change_no_commit",
        "dry_run": True,
    }

    created = write_iteration_evidence_bundle(
        session_id=session_id,
        iteration_number=iteration_number,
        candidate_packet=candidate_packet,
        pre_check=pre_check,
        diff_isolation=diff_isolation,
        proof_scope=proof_scope,
        guard_chain=guard_chain,
        hard_proof_raw=hard_proof_raw,
        metric_delta=metric_delta,
        closure=closure,
        redo_block=redo_block,
        checkpoint=checkpoint,
        final_forensic_record=final_forensic_record,
        dry_run=True,
    )
    all_ok, missing = validate_evidence_for_iteration(session_id, iteration_number)
    pass_allowed = pass_gate_formula(session_id, iteration_number)

    return {
        "session_id": session_id,
        "dry_run_mode": True,
        "created_files_full_list": [str(p) for p in created],
        "all_required_files_present": all_ok,
        "missing_files_if_any": missing,
        "validator_result": "PASS" if all_ok else "FAIL",
        "claim_vs_evidence_result": "PASS_allowed" if pass_allowed else "NOT_PROVEN",
        "final_dry_run_verdict": "DRY_RUN_COMPLETE_EVIDENCE_BUNDLE_OK" if all_ok else "DRY_RUN_INCOMPLETE",
    }


if __name__ == "__main__":
    import json
    import sys
    sys.path.insert(0, str(ROOT / "scripts"))
    r = run_dry_run()
    print(json.dumps(r, indent=2, ensure_ascii=False))
    sys.exit(0 if r.get("all_required_files_present") else 1)
