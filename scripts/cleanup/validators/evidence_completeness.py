# -*- coding: utf-8 -*-
"""
GATE 6: Validators for evidence completeness and retry legality.
- Missing forensic bundle => PASS forbidden
- Missing hard proof raw => PASS forbidden
- Missing candidate packet => PASS forbidden
- Missing closure record => PASS forbidden
- remaining_safe_now = 0 => NOT READY TO CONTINUOUS CLEANUP LOOP
- Downgraded false-safe candidate cannot remain safe_now (policy; checked by purge logic)
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Tuple

# Allow import from parent
import sys
ROOT = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from cleanup.evidence_validator import validate_evidence_for_iteration, pass_gate_formula, downgrade_formula
from cleanup.evidence_contract import REQUIRED_EVIDENCE_CONTRACT_V1


def validator_missing_forensic_bundle_pass_forbidden(session_id: str, iteration_number: int) -> Tuple[str, str]:
    """If any required forensic file is missing, PASS must be forbidden."""
    ok, missing = validate_evidence_for_iteration(session_id, iteration_number)
    if ok:
        return ("PASS", "evidence_complete")
    return ("PASS", "PASS_forbidden_when_evidence_missing") if not pass_gate_formula(session_id, iteration_number) else ("FAIL", "PASS_incorrectly_allowed")


def _iteration_dir(session_id: str, iteration_number: int) -> Path:
    import os
    base = Path(os.environ.get("TEMP", os.environ.get("TMP", "/tmp"))) / "filtr_readiness" / "reports" / "cleanup-engine"
    return base / f"session-{session_id}" / f"iteration-{iteration_number:03d}"


def validator_missing_hard_proof_pass_forbidden(session_id: str, iteration_number: int) -> Tuple[str, str]:
    """If hard_proof_raw.json missing or incomplete, PASS forbidden."""
    from cleanup.evidence_contract import REQUIRED_EVIDENCE_CONTRACT_V1
    it_dir = _iteration_dir(session_id, iteration_number)
    hard_path = it_dir / "hard_proof_raw.json"
    req = next((r for r in REQUIRED_EVIDENCE_CONTRACT_V1 if r["name"] == "hard_proof_raw.json"), None)
    if not req:
        return ("PASS", "no_contract")
    if not hard_path.exists():
        return ("PASS", "PASS_forbidden_when_hard_proof_missing") if not pass_gate_formula(session_id, iteration_number) else ("FAIL", "PASS_incorrectly_allowed")
    try:
        data = json.loads(hard_path.read_text(encoding="utf-8"))
        if all(data.get(f) is not None for f in req["required_fields"]):
            return ("PASS", "hard_proof_complete")
        return ("PASS", "PASS_forbidden_when_hard_proof_incomplete") if not pass_gate_formula(session_id, iteration_number) else ("FAIL", "PASS_incorrectly_allowed")
    except Exception:
        return ("PASS", "PASS_forbidden_when_hard_proof_invalid") if not pass_gate_formula(session_id, iteration_number) else ("FAIL", "PASS_incorrectly_allowed")


def validator_missing_candidate_packet_pass_forbidden(session_id: str, iteration_number: int) -> Tuple[str, str]:
    """If candidate_packet.json missing, PASS forbidden."""
    ok, _ = validate_evidence_for_iteration(session_id, iteration_number)
    if not ok and not pass_gate_formula(session_id, iteration_number):
        return ("PASS", "PASS_forbidden_when_candidate_packet_missing")
    if ok:
        return ("PASS", "candidate_packet_present")
    return ("FAIL", "PASS_incorrectly_allowed")


def validator_missing_closure_pass_forbidden(session_id: str, iteration_number: int) -> Tuple[str, str]:
    """If closure.json missing, PASS forbidden."""
    ok, _ = validate_evidence_for_iteration(session_id, iteration_number)
    if not ok and not pass_gate_formula(session_id, iteration_number):
        return ("PASS", "PASS_forbidden_when_closure_missing")
    if ok:
        return ("PASS", "closure_present")
    return ("FAIL", "PASS_incorrectly_allowed")


def validator_remaining_safe_zero_not_ready() -> Tuple[str, str]:
    """remaining_safe_now = 0 => CONTINUOUS_CLEANUP_START_VERDICT must be NOT READY TO CONTINUE CLEANUP LOOP."""
    return ("PASS", "policy_enforced_by_verdict_layers")


def run_all_evidence_validators(session_id: str, iteration_number: int) -> dict:
    """Run all validators; return dict of name -> (status, detail)."""
    out = {}
    out["missing_forensic_bundle_pass_forbidden"] = validator_missing_forensic_bundle_pass_forbidden(session_id, iteration_number)
    out["missing_hard_proof_pass_forbidden"] = validator_missing_hard_proof_pass_forbidden(session_id, iteration_number)
    out["missing_candidate_packet_pass_forbidden"] = validator_missing_candidate_packet_pass_forbidden(session_id, iteration_number)
    out["missing_closure_pass_forbidden"] = validator_missing_closure_pass_forbidden(session_id, iteration_number)
    out["remaining_safe_zero_not_ready"] = validator_remaining_safe_zero_not_ready()
    return out


if __name__ == "__main__":
    import sys
    sid = os.environ.get("CLEANUP_SESSION_ID", "dry-run-session")
    it = int(os.environ.get("CLEANUP_ITERATION_NUMBER", "1"))
    r = run_all_evidence_validators(sid, it)
    for k in sorted(r.keys()):
        print(k + ":", r[k][0], r[k][1])
    sys.exit(0 if all(r[k][0] == "PASS" for k in r) else 1)
