# -*- coding: utf-8 -*-
"""
True guard map 1-20: unique slots, exact names, purposes, fail conditions, machine actions, entrypoints.
Guards 11 and 12 are distinct from 17 and 18.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

TRUE_GUARD_MAP = [
    {
        "guard_number": 1,
        "exact_guard_name": "foreign_commit_in_chain",
        "exact_purpose": "Reject any commit in chain that is not part of this fix (e.g. chore(css) or unrelated cleanup).",
        "exact_fail_condition": "Commit message or diff indicates foreign scope in chain.",
        "exact_machine_action_on_fail": "REJECT_FOREIGN_COMMIT_IN_CHAIN",
        "code_entrypoint": "scripts.cleanup.guards.guard_foreign_commit_in_chain",
        "active": True,
    },
    {
        "guard_number": 2,
        "exact_guard_name": "clean_repo",
        "exact_purpose": "Reject if working tree or index is dirty.",
        "exact_fail_condition": "git status --short non-empty.",
        "exact_machine_action_on_fail": "REJECT_REPO_NOT_CLEAN",
        "code_entrypoint": "scripts.cleanup.guards.guard_clean_repo",
        "active": True,
    },
    {
        "guard_number": 3,
        "exact_guard_name": "artifact_js_errors",
        "exact_purpose": "Artifact must contain jsErrors field.",
        "exact_fail_condition": "jsErrors key missing in artifact.",
        "exact_machine_action_on_fail": "REJECT_MISSING_JSERRORS",
        "code_entrypoint": "scripts.cleanup.guards.guard_artifact_has_js_errors",
        "active": True,
    },
    {
        "guard_number": 4,
        "exact_guard_name": "artifact_js_errors_length",
        "exact_purpose": "Artifact must contain jsErrors.length consistent with jsErrors.",
        "exact_fail_condition": "jsErrors.length missing or != len(jsErrors).",
        "exact_machine_action_on_fail": "REJECT_MISSING_JSERRORS_LENGTH",
        "code_entrypoint": "scripts.cleanup.guards.guard_artifact_has_js_errors_length",
        "active": True,
    },
    {
        "guard_number": 5,
        "exact_guard_name": "fail_artifact_candidate_id",
        "exact_purpose": "FAIL artifact must have candidate_id.",
        "exact_fail_condition": "verdict==FAIL and candidate_id missing or empty.",
        "exact_machine_action_on_fail": "REJECT_FAIL_WITHOUT_CANDIDATE_ID",
        "code_entrypoint": "scripts.cleanup.guards.guard_fail_artifact_has_candidate_id",
        "active": True,
    },
    {
        "guard_number": 6,
        "exact_guard_name": "continue_stop_mutually_exclusive",
        "exact_purpose": "continue_reason and stop_reason must not both be non-null.",
        "exact_fail_condition": "Both continue_reason and stop_reason set.",
        "exact_machine_action_on_fail": "REJECT_CONTINUE_AND_STOP_BOTH_SET",
        "code_entrypoint": "scripts.cleanup.guards.guard_continue_stop_mutually_exclusive",
        "active": True,
    },
    {
        "guard_number": 7,
        "exact_guard_name": "total_remaining_consistent",
        "exact_purpose": "total_remaining_count must be same across artifacts in session.",
        "exact_fail_condition": "Different total_remaining_count values in artifacts.",
        "exact_machine_action_on_fail": "REJECT_CONFLICTING_TOTAL_REMAINING_COUNT",
        "code_entrypoint": "scripts.cleanup.guards.guard_total_remaining_consistent",
        "active": True,
    },
    {
        "guard_number": 8,
        "exact_guard_name": "single_session",
        "exact_purpose": "All artifacts must share one session_id.",
        "exact_fail_condition": "Multiple session_id values in artifacts.",
        "exact_machine_action_on_fail": "REJECT_MIX_SESSION_ID",
        "code_entrypoint": "scripts.cleanup.guards.guard_single_session",
        "active": True,
    },
    {
        "guard_number": 9,
        "exact_guard_name": "resume_valid_checkpoint",
        "exact_purpose": "Resume must continue from last_valid_checkpoint + 1.",
        "exact_fail_condition": "resume_iteration != last_valid_checkpoint + 1.",
        "exact_machine_action_on_fail": "REJECT_RESUME_FROM_INVALID_CHECKPOINT",
        "code_entrypoint": "scripts.cleanup.guards.guard_resume_from_valid_checkpoint",
        "active": True,
    },
    {
        "guard_number": 10,
        "exact_guard_name": "no_continuous_cleanup_when_safe_zero",
        "exact_purpose": "Do not allow start continuous cleanup when remaining_safe_now == 0.",
        "exact_fail_condition": "Start requested and safe_now == 0.",
        "exact_machine_action_on_fail": "REJECT_START_CLEANUP_WHEN_SAFE_ZERO",
        "code_entrypoint": "scripts.cleanup.guards.guard_no_continuous_cleanup_when_safe_zero",
        "active": True,
    },
    {
        "guard_number": 11,
        "exact_guard_name": "redo_block_candidate_level",
        "exact_purpose": "Block retry of the same candidate without reclassify or scope reduction (candidate-level redo block).",
        "exact_fail_condition": "Same candidate_id retried after FAIL without move to skip/risk/forensic.",
        "exact_machine_action_on_fail": "move_candidate_to_skip_risk_or_forensic_block_identical_retry",
        "code_entrypoint": "scripts.cleanup.meta_guards.guard_11_redo_block_candidate_level",
        "active": True,
    },
    {
        "guard_number": 12,
        "exact_guard_name": "checkpoint_consistency_pre_commit",
        "exact_purpose": "Before accepting commit: checkpoint, journal, session_state must agree on last valid state.",
        "exact_fail_condition": "Pre-commit checkpoint vs journal vs session_state mismatch.",
        "exact_machine_action_on_fail": "recovery_lock_STOP_AND_REPAIR_STATE",
        "code_entrypoint": "scripts.cleanup.meta_guards.guard_12_checkpoint_consistency_pre_commit",
        "active": True,
    },
    {
        "guard_number": 13,
        "exact_guard_name": "session_isolation",
        "exact_purpose": "Single session_id; no foreign artifacts or journal entries; recovery same session.",
        "exact_fail_condition": "Artifact or journal has different session_id; recovery point from other session.",
        "exact_machine_action_on_fail": "contaminated_session_OK_IMMEDIATE_STOP",
        "code_entrypoint": "scripts.cleanup.meta_guards.guard_13_session_isolation",
        "active": True,
    },
    {
        "guard_number": 14,
        "exact_guard_name": "commit_scope_purity",
        "exact_purpose": "Commit message and diff must match declared scope (cleanup vs guard vs test vs docs).",
        "exact_fail_condition": "Diff scope does not match commit message scope.",
        "exact_machine_action_on_fail": "REJECT_REVERT_AND_SPLIT",
        "code_entrypoint": "scripts.cleanup.meta_guards.guard_14_commit_scope_purity",
        "active": True,
    },
    {
        "guard_number": 15,
        "exact_guard_name": "claim_vs_evidence",
        "exact_purpose": "No claim stronger than raw data (READY only with full proof; no continue at safe_now=0).",
        "exact_fail_condition": "Claim contradicts evidence (e.g. READY without proof, continue at safe_zero).",
        "exact_machine_action_on_fail": "downgrade_NOT_READY_block_next_iteration_claim_conflict_evidence",
        "code_entrypoint": "scripts.cleanup.meta_guards.guard_15_claim_vs_evidence",
        "active": True,
    },
    {
        "guard_number": 16,
        "exact_guard_name": "self_heal_loop_integrity",
        "exact_purpose": "FAIL->revert; PASS->checkpoint; crash->recovery audit; no repeat same fail.",
        "exact_fail_condition": "Missing revert after FAIL, or checkpoint after PASS, or recovery audit after crash.",
        "exact_machine_action_on_fail": "loop_integrity_broken_force_stop",
        "code_entrypoint": "scripts.cleanup.meta_guards.guard_16_self_heal_loop_integrity",
        "active": True,
    },
    {
        "guard_number": 17,
        "exact_guard_name": "redo_block_iteration_level",
        "exact_purpose": "Block identical iteration retry (same scope, diff pattern, fail reason) without scope reduction.",
        "exact_fail_condition": "Same iteration retried identically after FAIL without reclassify or scope reduction.",
        "exact_machine_action_on_fail": "move_candidate_to_skip_risk_or_forensic_block_identical_retry",
        "code_entrypoint": "scripts.cleanup.meta_guards.guard_17_redo_block",
        "active": True,
    },
    {
        "guard_number": 18,
        "exact_guard_name": "checkpoint_consistency_post_commit",
        "exact_purpose": "After commit: checkpoint vs git vs recovery point must agree.",
        "exact_fail_condition": "Checkpoint says PASS but commit missing; recovery != last_valid_checkpoint.",
        "exact_machine_action_on_fail": "recovery_lock_STOP_AND_REPAIR_STATE",
        "code_entrypoint": "scripts.cleanup.meta_guards.guard_18_checkpoint_consistency",
        "active": True,
    },
    {
        "guard_number": 19,
        "exact_guard_name": "autonomy_honesty",
        "exact_purpose": "No vague skip/stop; no safe candidate skipped without reason; output must not overclaim data.",
        "exact_fail_condition": "Vague skip_reason, undocumented stop_reason, safe exists but stop without list.",
        "exact_machine_action_on_fail": "verdict_downgrade_new_backlog_scan_reselection_guard",
        "code_entrypoint": "scripts.cleanup.meta_guards.guard_19_autonomy_honesty",
        "active": True,
    },
    {
        "guard_number": 20,
        "exact_guard_name": "web_safety_envelope",
        "exact_purpose": "Critical zones (feed, rails, VIN, etc.) within tolerance of baseline.",
        "exact_fail_condition": "Basic proof green but critical zone delta outside tolerance.",
        "exact_machine_action_on_fail": "revert_candidate_to_risk_full_proof_only",
        "code_entrypoint": "scripts.cleanup.meta_guards.guard_20_web_safety_envelope",
        "active": True,
    },
]


def get_guard_map_version() -> str:
    """Stable version for artifact (e.g. hash of this file)."""
    p = Path(__file__)
    if p.exists():
        return str(hash(p.read_text(encoding="utf-8")) % (10**8))
    return "0"
