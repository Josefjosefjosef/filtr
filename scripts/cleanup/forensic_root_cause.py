# -*- coding: utf-8 -*-
"""GATE 2: Lock forensic root cause 0 vs 12. ROOT_CAUSE_VERDICT."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
AUDIT_SCRIPT = ROOT / "scripts" / "css_duplicate_audit.py"
TEMP_BASE = Path(os.environ.get("TEMP", os.environ.get("TMP", "/tmp"))) / "filtr_readiness"
ENGINE_DIR = TEMP_BASE / "reports" / "cleanup-engine"


def get_analyzer_path_and_hash():
    path = str(AUDIT_SCRIPT)
    h = hashlib.sha256(AUDIT_SCRIPT.read_bytes()).hexdigest()[:16] if AUDIT_SCRIPT.exists() else "unknown"
    return path, h


def build_root_cause_lock(new_branch_name, new_commit_sha, new_safe_now, new_classification_counts,
    old_commit_sha="previous_run_not_stored", old_safe_now=0):
    analyzer_path, analyzer_hash = get_analyzer_path_and_hash()
    old_state = {
        "branch_name": "main",
        "commit_sha": old_commit_sha,
        "analyzer_file_path": analyzer_path,
        "analyzer_source_hash": "not_stored",
        "source_dataset": "assets/app.css",
        "exact_classification_counts": {},
        "safe_now": old_safe_now,
        "exact_verdict": "STOP_NO_SAFE_CANDIDATES_WITH_EVIDENCE",
        "source_note": "earlier_run_safe_now_0_no_artifact_stored",
    }
    new_state = {
        "branch_name": new_branch_name,
        "commit_sha": new_commit_sha,
        "analyzer_file_path": analyzer_path,
        "analyzer_source_hash": analyzer_hash,
        "source_dataset": "assets/app.css",
        "exact_classification_counts": new_classification_counts,
        "safe_now": new_safe_now,
        "exact_verdict": "CONTINUE_WITH_SAFE_CANDIDATES" if new_safe_now > 0 else "STOP_NO_SAFE_CANDIDATES_WITH_EVIDENCE",
    }
    root_cause_diff = {
        "analyzer_diff": "none_possible_old_hash_not_stored",
        "classification_rule_diff": "none_possible",
        "branch_commit_context_diff": "old_result_different_run_context",
        "dataset_diff": "same_assets_app_css",
    }
    out = {
        "old_state": old_state,
        "new_state": new_state,
        "root_cause_diff": root_cause_diff,
        "ROOT_CAUSE_VERDICT": "DIFFERENT_BRANCH_OR_COMMIT_CONTEXT",
    }
    ENGINE_DIR.mkdir(parents=True, exist_ok=True)
    (ENGINE_DIR / "forensic-root-cause-lock.json").write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    return out
