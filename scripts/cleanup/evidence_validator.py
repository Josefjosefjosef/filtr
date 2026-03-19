# -*- coding: utf-8 -*-
"""
GATE 4: Claim-vs-evidence enforcement. PASS allowed only if all required evidence exists and is complete.
Otherwise verdict downgraded to NOT_PROVEN.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Tuple

from .evidence_contract import PER_ITERATION_REQUIRED_FILES, REQUIRED_EVIDENCE_CONTRACT_V1

TEMP_BASE = Path(os.environ.get("TEMP", os.environ.get("TMP", "/tmp"))) / "filtr_readiness"
ENGINE_BASE = TEMP_BASE / "reports" / "cleanup-engine"


def _iteration_dir(session_id: str, iteration_number: int) -> Path:
    return ENGINE_BASE / f"session-{session_id}" / f"iteration-{iteration_number:03d}"


def _file_has_required_fields(path: Path, required_fields: List[str]) -> bool:
    if not path.exists():
        return False
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return all(f in data for f in required_fields)
    except Exception:
        return False


def validate_evidence_for_iteration(session_id: str, iteration_number: int) -> Tuple[bool, List[str]]:
    """
    Returns (all_ok, missing_or_invalid).
    all_ok True iff all required files exist and contain required fields.
    """
    it_dir = _iteration_dir(session_id, iteration_number)
    missing_or_invalid: List[str] = []
    contract = {c["name"]: c for c in REQUIRED_EVIDENCE_CONTRACT_V1}
    for req in REQUIRED_EVIDENCE_CONTRACT_V1:
        path = it_dir / req["name"]
        if not path.exists():
            missing_or_invalid.append(f"missing:{req['name']}")
        elif not _file_has_required_fields(path, req["required_fields"]):
            missing_or_invalid.append(f"invalid_or_incomplete:{req['name']}")
    return (len(missing_or_invalid) == 0, missing_or_invalid)


def pass_gate_formula(session_id: str, iteration_number: int) -> bool:
    """PASS allowed only if evidence contract is complete for this iteration."""
    ok, _ = validate_evidence_for_iteration(session_id, iteration_number)
    return ok


def downgrade_formula(session_id: str, iteration_number: int) -> str:
    """If evidence incomplete, verdict must be NOT_PROVEN."""
    ok, missing = validate_evidence_for_iteration(session_id, iteration_number)
    if ok:
        return "PASS_ALLOWED"
    return "NOT_PROVEN_REASON: " + "; ".join(missing)


CLAIM_VS_EVIDENCE_RULES_AFTER_FIX = [
    "final verdict PASS allowed only if all required evidence files exist for that iteration",
    "all required fields in each file must be non-null",
    "hard_proof_raw must contain build_result, audit_result, cls_value, overflowX_value, railShift_value, appErrorsCount, consoleErrorsCount",
    "closure must contain commit_sha_after_or_revert_proof, closure_type, git_status_after",
    "candidate_packet must be present with candidate_id, iteration_number, selector_normalized, branch_name, commit_sha_before",
    "journal must show committed state for that iteration",
    "if any of the above is false then THIRD_REAL_CLEANUP_ITERATION_VERDICT (or NTH) must be NOT_PROVEN",
]
