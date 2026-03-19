# -*- coding: utf-8 -*-
"""
GATE 5: Redo block and split memory. Persisted candidate state; identical retry forbidden without new scope/evidence.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List

TEMP_BASE = Path(os.environ.get("TEMP", os.environ.get("TMP", "/tmp"))) / "filtr_readiness"
ENGINE_BASE = TEMP_BASE / "reports" / "cleanup-engine"
CANDIDATE_STATE_FILE = ENGINE_BASE / "candidate_state_history.json"


def _hash_of_block(selector: str, line_start: int, line_end: int) -> str:
    return hashlib.sha256(f"{selector}|{line_start}|{line_end}".encode()).hexdigest()[:16]


CANDIDATE_STATE_SCHEMA = {
    "candidate_id": "str",
    "hash_of_block": "str",
    "attempt_count": "int",
    "last_result": "PASS|FAIL_REVERTED",
    "last_failed_guard": "str or null",
    "last_fail_reason": "str or null",
    "identical_retry_blocked": "bool",
    "smaller_scope_exists": "bool",
    "split_parent_if_any": "str or null",
    "current_classification": "str",
    "legal_next_actions": "list of str",
}

REDO_BLOCK_RULES = [
    "candidate that once failed and has no new smaller scope or new evidence must not be run identically again",
    "identical_retry_blocked True => legal_next_actions must not contain allow_cleanup for same scope",
    "attempt_count incremented on each run; last_result updated",
]

SPLIT_RETRY_RULES = [
    "if smaller_scope_exists True, a new candidate (split child) may be created and run",
    "split_parent_if_any links child to parent candidate_id",
]


def load_candidate_state_history() -> Dict[str, List[Dict[str, Any]]]:
    """Load by candidate_id -> list of state records."""
    if not CANDIDATE_STATE_FILE.exists():
        return {}
    try:
        return json.loads(CANDIDATE_STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def append_candidate_state(
    candidate_id: str,
    hash_of_block: str,
    attempt_count: int,
    last_result: str,
    last_failed_guard: str | None,
    last_fail_reason: str | None,
    identical_retry_blocked: bool,
    smaller_scope_exists: bool,
    split_parent_if_any: str | None,
    current_classification: str,
    legal_next_actions: List[str],
) -> None:
    ENGINE_BASE.mkdir(parents=True, exist_ok=True)
    history = load_candidate_state_history()
    record = {
        "candidate_id": candidate_id,
        "hash_of_block": hash_of_block,
        "attempt_count": attempt_count,
        "last_result": last_result,
        "last_failed_guard": last_failed_guard,
        "last_fail_reason": last_fail_reason,
        "identical_retry_blocked": identical_retry_blocked,
        "smaller_scope_exists": smaller_scope_exists,
        "split_parent_if_any": split_parent_if_any,
        "current_classification": current_classification,
        "legal_next_actions": legal_next_actions,
    }
    if candidate_id not in history:
        history[candidate_id] = []
    history[candidate_id].append(record)
    CANDIDATE_STATE_FILE.write_text(json.dumps(history, indent=2, ensure_ascii=False), encoding="utf-8")
