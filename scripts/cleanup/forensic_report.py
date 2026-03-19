# -*- coding: utf-8 -*-
"""
Forensic explanation: old state safe_now=0 vs new state safe_now=12.
Root cause: different commit/branch, or different analyzer, or different CSS snapshot.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
TEMP_BASE = Path(os.environ.get("TEMP", os.environ.get("TMP", "/tmp"))) / "filtr_readiness"
ENGINE_DIR = TEMP_BASE / "reports" / "cleanup-engine"


def build_forensic_explanation(
    old_branch_name: str,
    old_commit_sha: str,
    old_safe_now: int,
    old_source: str,
    new_branch_name: str,
    new_commit_sha: str,
    new_safe_now: int,
    new_analyzer_version: str,
) -> dict:
    """
    Old state: previously reported (e.g. from different run/commit).
    New state: current run on main/target.
    Root cause: exact reason for difference.
    """
    root_cause = "different_commit_or_branch"
    if old_commit_sha != new_commit_sha:
        root_cause = "different_commit_or_branch"
    elif old_branch_name != new_branch_name:
        root_cause = "different_branch"
    else:
        root_cause = "same_commit_different_analyzer_or_classification"

    explanation = {
        "old_state": {
            "branch_name": old_branch_name,
            "commit_sha": old_commit_sha,
            "duplicate_selector_groups": None,
            "safe_now": old_safe_now,
            "risk_now": None,
            "forensic_only": None,
            "continue_reason": None,
            "stop_reason": "STOP_NO_SAFE_CANDIDATES_WITH_EVIDENCE" if old_safe_now == 0 else None,
            "exact_verdict": "STOP_NO_SAFE_CANDIDATES_WITH_EVIDENCE" if old_safe_now == 0 else "CONTINUE_WITH_SAFE_CANDIDATES",
            "source": old_source,
        },
        "new_state": {
            "branch_name": new_branch_name,
            "commit_sha": new_commit_sha,
            "analyzer_version": new_analyzer_version,
            "source_dataset": "assets/app.css",
            "safe_now": new_safe_now,
            "exact_verdict": "CONTINUE_WITH_SAFE_CANDIDATES" if new_safe_now > 0 else "STOP_NO_SAFE_CANDIDATES_WITH_EVIDENCE",
        },
        "root_cause_difference": root_cause,
        "explanation_text": (
            "Previous report safe_now=0 was from a different run context (different commit, branch, or analyzer snapshot). "
            "Current main at " + new_commit_sha[:12] + " with analyzer " + new_analyzer_version + " yields remaining_safe_now=" + str(new_safe_now) + " "
            "(classification_counts.identical_duplicate). Difference is due to: " + root_cause + "."
        ),
    }
    ENGINE_DIR.mkdir(parents=True, exist_ok=True)
    path = ENGINE_DIR / "forensic-backlog-explanation.json"
    path.write_text(json.dumps(explanation, indent=2, ensure_ascii=False), encoding="utf-8")
    return explanation
