# -*- coding: utf-8 -*-
"""
One real cleanup iteration: pick first identical_duplicate group, remove second occurrence (by line range), verify, commit.
On any failure: revert and return FAIL_REVERTED.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
APP_CSS = ROOT / "assets" / "app.css"


def run_one_cleanup_iteration() -> str:
    """Returns PASS or FAIL_REVERTED."""
    sys.path.insert(0, str(ROOT / "scripts"))
    from css_duplicate_audit import audit_css_file

    if not APP_CSS.exists():
        return "FAIL_REVERTED"
    result = audit_css_file(APP_CSS)
    if result.get("error"):
        return "FAIL_REVERTED"
    groups_top = result.get("groups_top") or []
    safe_group = None
    for g in groups_top:
        if g.get("classification") == "identical_duplicate" and (g.get("occurrences") or []):
            safe_group = g
            break
    if not safe_group:
        return "FAIL_REVERTED"
    occs = safe_group["occurrences"]
    if len(occs) < 2:
        return "FAIL_REVERTED"
    second = occs[1]
    line_start = int(second.get("line_start", 0))
    line_end = int(second.get("line_end", 0))
    if line_start < 1 or line_end < line_start:
        return "FAIL_REVERTED"
    lines = APP_CSS.read_text(encoding="utf-8").splitlines()
    if line_end > len(lines):
        return "FAIL_REVERTED"
    new_lines = lines[: line_start - 1] + lines[line_end:]
    APP_CSS.write_text("\n".join(new_lines) + ("\n" if lines and not lines[-1].endswith("\n") else ""), encoding="utf-8")
    verify = audit_css_file(APP_CSS)
    if verify.get("error"):
        APP_CSS.write_text("\n".join(lines) + ("\n" if lines and not lines[-1].endswith("\n") else ""), encoding="utf-8")
        return "FAIL_REVERTED"
    try:
        subprocess.run(["git", "add", "assets/app.css"], cwd=ROOT, check=True, capture_output=True, timeout=10)
        subprocess.run(["git", "commit", "-m", "chore(css): cleanup iterace 1"], cwd=ROOT, check=True, capture_output=True, timeout=10)
    except subprocess.CalledProcessError:
        subprocess.run(["git", "checkout", "--", "assets/app.css"], cwd=ROOT, capture_output=True, timeout=5)
        return "FAIL_REVERTED"
    return "PASS"
