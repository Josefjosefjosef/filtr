# -*- coding: utf-8 -*-
"""
GATE 1: Required evidence contract. PASS verdict forbidden if any required file is missing.
All paths under %TEMP%\\filtr_readiness\\reports\\cleanup-engine\\session-<id>\\iteration-NNN\\
"""
from __future__ import annotations

REQUIRED_EVIDENCE_CONTRACT_V1 = [
    {
        "name": "final_forensic_record.json",
        "producer": "evidence_persistence.final_forensic_record",
        "when_created": "after_closure_and_checkpoint",
        "required_fields": ["session_id", "iteration_number", "candidate_id", "final_verdict", "closure_proof"],
        "fail_if_missing": True,
    },
    {
        "name": "candidate_packet.json",
        "producer": "cleanup_one_step / evidence_persistence",
        "when_created": "before_pre_check",
        "required_fields": ["candidate_id", "iteration_number", "selector_normalized", "branch_name", "commit_sha_before"],
        "fail_if_missing": True,
    },
    {
        "name": "guard_chain.json",
        "producer": "evidence_persistence.guard_chain",
        "when_created": "after_pre_check_before_hard_proof",
        "required_fields": ["guard_count", "all_passed", "blocking_guard_if_any"],
        "fail_if_missing": True,
    },
    {
        "name": "hard_proof_raw.json",
        "producer": "evidence_persistence.hard_proof",
        "when_created": "after_guard_chain",
        "required_fields": ["build_result", "audit_result", "cls_value", "overflowX_value", "railShift_value", "appErrorsCount", "consoleErrorsCount"],
        "fail_if_missing": True,
    },
    {
        "name": "closure.json",
        "producer": "evidence_persistence.closure",
        "when_created": "after_metric_delta",
        "required_fields": ["commit_sha_after_or_revert_proof", "closure_type", "git_status_after"],
        "fail_if_missing": True,
    },
    {
        "name": "redo_block.json",
        "producer": "evidence_persistence.redo_block",
        "when_created": "after_closure",
        "required_fields": ["candidate_id", "attempt_count", "last_result", "identical_retry_blocked", "legal_next_actions"],
        "fail_if_missing": True,
    },
    {
        "name": "checkpoint.json",
        "producer": "evidence_persistence.checkpoint",
        "when_created": "after_redo_block",
        "required_fields": ["iteration_number", "checkpoint_at", "state"],
        "fail_if_missing": True,
    },
]

PER_ITERATION_REQUIRED_FILES = [
    "candidate_packet.json",
    "pre_check.json",
    "diff_isolation.json",
    "proof_scope.json",
    "guard_chain.json",
    "hard_proof_raw.json",
    "metric_delta.json",
    "closure.json",
    "redo_block.json",
    "checkpoint.json",
    "final_forensic_record.json",
]
