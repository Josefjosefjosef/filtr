# -*- coding: utf-8 -*-
"""
Guards 1-10: foreign commit, clean repo, artifact fields, continue/stop exclusive,
total_remaining consistent, single session, resume checkpoint, no start when safe_zero.
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple


def guard_foreign_commit_in_chain(commit_hashes: List[str], allowed_prefix: str) -> Tuple[bool, str]:
    if not commit_hashes:
        return True, "OK"
    for h in commit_hashes:
        if "chore(css)" in h or ("cleanup" in h.lower() and allowed_prefix not in h):
            return False, "FOREIGN_COMMIT_IN_CHAIN"
    return True, "OK"


def guard_clean_repo(git_status_short: str) -> Tuple[bool, str]:
    if git_status_short and git_status_short.strip():
        return False, "REPO_NOT_CLEAN"
    return True, "OK"


def guard_artifact_has_js_errors(artifact: Dict[str, Any]) -> Tuple[bool, str]:
    if "jsErrors" not in artifact:
        return False, "MISSING_JSERRORS"
    return True, "OK"


def guard_artifact_has_js_errors_length(artifact: Dict[str, Any]) -> Tuple[bool, str]:
    if "jsErrors.length" not in artifact:
        return False, "MISSING_JSERRORS_LENGTH"
    errs = artifact.get("jsErrors")
    if errs is not None and artifact.get("jsErrors.length") != len(errs):
        return False, "JSERRORS_LENGTH_MISMATCH"
    return True, "OK"


def guard_fail_artifact_has_candidate_id(artifact: Dict[str, Any]) -> Tuple[bool, str]:
    if artifact.get("verdict") == "FAIL" and not artifact.get("candidate_id"):
        return False, "FAIL_WITHOUT_CANDIDATE_ID"
    return True, "OK"


def guard_continue_stop_mutually_exclusive(artifact: Dict[str, Any]) -> Tuple[bool, str]:
    c, s = artifact.get("continue_reason"), artifact.get("stop_reason")
    if c is not None and s is not None:
        return False, "CONTINUE_AND_STOP_BOTH_SET"
    return True, "OK"


def guard_total_remaining_consistent(artifacts: List[Dict[str, Any]]) -> Tuple[bool, str]:
    vals = [a.get("total_remaining_count") for a in artifacts if a.get("total_remaining_count") is not None]
    if len(set(vals)) > 1:
        return False, "CONFLICTING_TOTAL_REMAINING_COUNT"
    return True, "OK"


def guard_single_session(artifacts: List[Dict[str, Any]]) -> Tuple[bool, str]:
    ids = [a.get("session_id") for a in artifacts if a.get("session_id")]
    if len(set(ids)) > 1:
        return False, "MIX_SESSION_ID"
    return True, "OK"


def guard_resume_from_valid_checkpoint(last_valid_checkpoint: int, resume_iteration: int) -> Tuple[bool, str]:
    if resume_iteration != last_valid_checkpoint + 1:
        return False, "RESUME_FROM_INVALID_CHECKPOINT"
    return True, "OK"


def guard_no_continuous_cleanup_when_safe_zero(safe_now: int, start_requested: bool) -> Tuple[bool, str]:
    if safe_now == 0 and start_requested:
        return False, "START_CLEANUP_WHEN_SAFE_ZERO"
    return True, "OK"
