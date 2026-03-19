# -*- coding: utf-8 -*-
"""
One real cleanup iteration: pick identical_duplicate group by group_index, remove second occurrence, verify, commit.
On failure: persist forensic to TEMP, revert, return FAIL_REVERTED.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
APP_CSS = ROOT / "assets" / "app.css"
TEMP_BASE = Path(os.environ.get("TEMP", os.environ.get("TMP", "/tmp"))) / "filtr_readiness"
ENGINE_DIR = TEMP_BASE / "reports" / "cleanup-engine"


def _write_forensic(iteration_number: int, candidate_id: str, selector: str, line_start: int, line_end: int,
    exact_fail_reason: str, revert_proof: str):
    ENGINE_DIR.mkdir(parents=True, exist_ok=True)
    data = {
        "session_id": None,
        "iteration_number": iteration_number,
        "candidate_id": candidate_id,
        "candidate_packet": {"selector_normalized": selector, "line_start": line_start, "line_end": line_end},
        "exact_fail_reason": exact_fail_reason,
        "revert_proof": revert_proof,
        "redo_block_status": "RETRY_ALLOWED_DIFFERENT_SCOPE_OR_SKIP",
        "checkpoint_consistency_status": "reverted",
        "FAILED_CANDIDATE_NEXT_STATUS": "SKIP_TO_RISK_NOW",
    }
    (ENGINE_DIR / "cleanup-iteration-forensic.json").write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def run_one_cleanup_iteration(iteration_number: int = 1, group_index: int = 0) -> str:
    """Returns PASS or FAIL_REVERTED. group_index: 0 = first safe group, 1 = second, ..."""
    sys.path.insert(0, str(ROOT / "scripts"))
    from css_duplicate_audit import audit_css_file

    if not APP_CSS.exists():
        return "FAIL_REVERTED"
    result = audit_css_file(APP_CSS)
    if result.get("error"):
        return "FAIL_REVERTED"
    safe_groups = result.get("safe_groups_top") or []
    if group_index >= len(safe_groups):
        return "FAIL_REVERTED"
    safe_group = safe_groups[group_index]
    selector = safe_group.get("selector_normalized", "")
    candidate_id = "cleanup_candidate_" + str(group_index) + "_" + (selector[:50] or "id")
    occs = safe_group["occurrences"]
    if len(occs) < 2:
        return "FAIL_REVERTED"
    second = occs[1]
    line_start = int(second.get("line_start", 0))
    line_end = int(second.get("line_end", 0))
    if line_start < 1 or line_end < line_start:
        return "FAIL_REVERTED"
    raw = APP_CSS.read_text(encoding="utf-8")
    lines = raw.splitlines()
    newline = "\r\n" if "\r\n" in raw else "\n"
    if line_end > len(lines):
        _write_forensic(iteration_number, candidate_id, selector, line_start, line_end,
            "line_end_out_of_range", "no_edit_done")
        return "FAIL_REVERTED"
    new_lines = lines[: line_start - 1] + lines[line_end:]
    APP_CSS.write_text(newline.join(new_lines) + (newline if new_lines else ""), encoding="utf-8")
    verify = audit_css_file(APP_CSS)
    if verify.get("error"):
        APP_CSS.write_text(raw, encoding="utf-8")
        _write_forensic(iteration_number, candidate_id, selector, line_start, line_end,
            "audit_error_after_edit", "restore_raw_before_edit")
        return "FAIL_REVERTED"
    commit_msg = "chore(css): cleanup iterace " + str(iteration_number)
    try:
        subprocess.run(["git", "add", "assets/app.css"], cwd=ROOT, check=True, capture_output=True, timeout=10)
        subprocess.run(["git", "commit", "-m", commit_msg], cwd=ROOT, check=True, capture_output=True, timeout=10)
    except subprocess.CalledProcessError:
        subprocess.run(["git", "checkout", "--", "assets/app.css"], cwd=ROOT, capture_output=True, timeout=5)
        _write_forensic(iteration_number, candidate_id, selector, line_start, line_end,
            "git_commit_failed", "git_checkout_assets_app_css")
        return "FAIL_REVERTED"
    return "PASS"
