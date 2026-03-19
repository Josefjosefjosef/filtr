# -*- coding: utf-8 -*-
"""
Meta-guards 11, 12, 13-20. Guard 11 = candidate-level redo block. Guard 12 = pre-commit checkpoint consistency.
Guards 17/18 = iteration-level redo and post-commit consistency.
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

GUARD_11_ACTION = "move_candidate_to_skip_risk_or_forensic_block_identical_retry"
GUARD_12_ACTION = "recovery_lock_STOP_AND_REPAIR_STATE"
GUARD_13_ACTION = "contaminated_session_OK_IMMEDIATE_STOP"
GUARD_14_ACTION = "REJECT_REVERT_AND_SPLIT"
GUARD_15_ACTION = "downgrade_NOT_READY_block_next_iteration_claim_conflict_evidence"
GUARD_16_ACTION = "loop_integrity_broken_force_stop"
GUARD_17_ACTION = "move_candidate_to_skip_risk_or_forensic_block_identical_retry"
GUARD_18_ACTION = "recovery_lock_STOP_AND_REPAIR_STATE"
GUARD_19_ACTION = "verdict_downgrade_new_backlog_scan_reselection_guard"
GUARD_20_ACTION = "revert_candidate_to_risk_full_proof_only"


def guard_11_redo_block_candidate_level(
    candidate_id: str,
    previous_failures_same_candidate: List[Dict[str, Any]],
    had_reclassify_or_skip: bool,
) -> Tuple[bool, str | None, Dict[str, Any]]:
    """Block retry of same candidate without reclassify/skip (candidate-level)."""
    evidence: Dict[str, Any] = {}
    if previous_failures_same_candidate and not had_reclassify_or_skip:
        evidence["same_candidate_retry_without_reclassify"] = candidate_id
        return False, GUARD_11_ACTION, evidence
    return True, None, evidence


def guard_12_checkpoint_consistency_pre_commit(
    session_iteration: int,
    last_artifact_iteration: int | None,
    last_valid_checkpoint: int,
    journal_consistent: bool,
) -> Tuple[bool, str | None, Dict[str, Any]]:
    """Pre-commit: session, artifacts, checkpoint, journal agree."""
    evidence: Dict[str, Any] = {}
    if last_artifact_iteration is not None and session_iteration != last_artifact_iteration:
        evidence["session_artifact_iter_mismatch"] = True
        return False, GUARD_12_ACTION, evidence
    if not journal_consistent:
        evidence["journal_inconsistent"] = True
        return False, GUARD_12_ACTION, evidence
    return True, None, evidence


def guard_13_session_isolation(
    session_id: str,
    artifacts: List[Dict[str, Any]],
    journal_entries: List[Dict[str, Any]],
    recovery_session_id: str | None,
) -> Tuple[bool, str | None, Dict[str, Any]]:
    evidence: Dict[str, Any] = {}
    for a in artifacts:
        if a.get("session_id") != session_id:
            evidence["artifact_mismatch"] = a.get("session_id")
            return False, GUARD_13_ACTION, evidence
    for j in journal_entries:
        if j.get("session_id") != session_id:
            evidence["journal_mismatch"] = j.get("session_id")
            return False, GUARD_13_ACTION, evidence
    if recovery_session_id is not None and recovery_session_id != session_id:
        evidence["recovery_session_mismatch"] = recovery_session_id
        return False, GUARD_13_ACTION, evidence
    return True, None, evidence


def guard_14_commit_scope_purity(
    commit_message: str,
    diff_files: List[str],
    declared_scope: str,
) -> Tuple[bool, str | None, Dict[str, Any]]:
    evidence: Dict[str, Any] = {"commit_message": commit_message, "diff_files": diff_files}
    if "fix(guard)" in commit_message or "chore(test)" in commit_message or "chore(docs)" in commit_message:
        if "assets/app.css" in diff_files and "chore(css)" not in commit_message:
            evidence["cleanup_scope_in_guard_commit"] = True
            return False, GUARD_14_ACTION, evidence
    return True, None, evidence


def guard_15_claim_vs_evidence(
    claimed_ready: bool,
    has_complete_raw_proof: bool,
    claimed_continue: bool,
    safe_now: int,
    required_artifact_fields: List[str],
    artifact: Dict[str, Any],
) -> Tuple[bool, str | None, Dict[str, Any]]:
    evidence: Dict[str, Any] = {}
    if claimed_ready and not has_complete_raw_proof:
        evidence["READY_without_raw_proof"] = True
        return False, GUARD_15_ACTION, evidence
    if claimed_continue and safe_now == 0:
        evidence["continue_at_safe_zero"] = True
        return False, GUARD_15_ACTION, evidence
    if claimed_ready:
        for f in required_artifact_fields:
            if artifact.get(f) is None and f not in artifact:
                evidence["missing_field"] = f
                return False, GUARD_15_ACTION, evidence
    return True, None, evidence


def guard_16_self_heal_loop_integrity(
    after_fail_had_revert: bool,
    after_pass_had_checkpoint: bool,
    after_crash_had_recovery_audit: bool,
) -> Tuple[bool, str | None, Dict[str, Any]]:
    evidence: Dict[str, Any] = {}
    if not after_fail_had_revert:
        evidence["fail_without_revert"] = True
        return False, GUARD_16_ACTION, evidence
    if not after_pass_had_checkpoint:
        evidence["pass_without_checkpoint"] = True
        return False, GUARD_16_ACTION, evidence
    if not after_crash_had_recovery_audit:
        evidence["crash_without_recovery_audit"] = True
        return False, GUARD_16_ACTION, evidence
    return True, None, evidence


def guard_17_redo_block(
    candidate_id: str,
    scope: str,
    fail_reason: str,
    previous_failures: List[Dict[str, Any]],
    had_reclassify_or_scope_reduction: bool,
) -> Tuple[bool, str | None, Dict[str, Any]]:
    """Iteration-level: no identical retry without reclassify/scope reduction."""
    evidence: Dict[str, Any] = {}
    for pf in previous_failures:
        if pf.get("candidate_id") == candidate_id and pf.get("fail_reason") == fail_reason and not had_reclassify_or_scope_reduction:
            evidence["identical_retry"] = candidate_id
            return False, GUARD_17_ACTION, evidence
    return True, None, evidence


def guard_18_checkpoint_consistency(
    checkpoint_says_pass: bool,
    commit_exists: bool,
    recovery_point: int | None,
    last_valid_checkpoint: int | None,
) -> Tuple[bool, str | None, Dict[str, Any]]:
    """Post-commit: checkpoint vs git vs recovery agree."""
    evidence: Dict[str, Any] = {}
    if checkpoint_says_pass and not commit_exists:
        evidence["checkpoint_pass_no_commit"] = True
        return False, GUARD_18_ACTION, evidence
    if recovery_point is not None and last_valid_checkpoint is not None and recovery_point != last_valid_checkpoint:
        evidence["recovery_point_mismatch"] = True
        return False, GUARD_18_ACTION, evidence
    return True, None, evidence


def guard_19_autonomy_honesty(
    skip_reason_vague: bool,
    stop_reason_undocumented: bool,
    safe_candidate_exists_but_stop: bool,
) -> Tuple[bool, str | None, Dict[str, Any]]:
    evidence: Dict[str, Any] = {}
    if skip_reason_vague:
        evidence["vague_skip_reason"] = True
        return False, GUARD_19_ACTION, evidence
    if stop_reason_undocumented:
        evidence["stop_reason_not_documented"] = True
        return False, GUARD_19_ACTION, evidence
    if safe_candidate_exists_but_stop:
        evidence["safe_exists_but_stop"] = True
        return False, GUARD_19_ACTION, evidence
    return True, None, evidence


def guard_20_web_safety_envelope(
    basic_proof_green: bool,
    critical_zone_delta_within_tolerance: bool,
) -> Tuple[bool, str | None, Dict[str, Any]]:
    evidence: Dict[str, Any] = {}
    if basic_proof_green and not critical_zone_delta_within_tolerance:
        evidence["critical_zone_out_of_tolerance"] = True
        return False, GUARD_20_ACTION, evidence
    return True, None, evidence
