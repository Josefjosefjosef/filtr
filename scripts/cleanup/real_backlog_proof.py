# -*- coding: utf-8 -*-
"""Real backlog proof: branch, commit_sha, analyzer_version, counts, verdict."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
APP_CSS = ROOT / "assets" / "app.css"
AUDIT_SCRIPT = ROOT / "scripts" / "css_duplicate_audit.py"
TEMP_BASE = Path(os.environ.get("TEMP", os.environ.get("TMP", "/tmp"))) / "filtr_readiness"
ENGINE_DIR = TEMP_BASE / "reports" / "cleanup-engine"


def get_analyzer_version() -> str:
    if AUDIT_SCRIPT.exists():
        return hashlib.sha256(AUDIT_SCRIPT.read_bytes()).hexdigest()[:16]
    return "unknown"


def _safe_now_from_inventory(result: dict) -> int:
    """Canonical remaining_safe_now = len(safe_groups_top). Unified with cleanup engine and safe_now_forensic."""
    return len(result.get("safe_groups_top") or [])


def _risk_now(cc: dict) -> int:
    return int(cc.get("risky_layout_coupled", 0) + cc.get("intentional_cascade_candidate", 0))


def _forensic_only(cc: dict) -> int:
    return int(cc.get("breakpoint_specific", 0))


def _get_branch_and_sha(cwd: Path) -> tuple[str, str]:
    b, s = "", ""
    try:
        b = subprocess.run(["git", "branch", "--show-current"], cwd=cwd, capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:
        pass
    try:
        s = subprocess.run(["git", "rev-parse", "HEAD"], cwd=cwd, capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:
        pass
    return b or "unknown", s or "unknown"


def run_real_backlog_proof(target_mode: str = "main", output_key: str = "real-backlog-main.json") -> dict:
    sys.path.insert(0, str(ROOT / "scripts"))
    from css_duplicate_audit import audit_css_file

    branch, sha = _get_branch_and_sha(ROOT)
    out_base = {
        "branch_name": branch,
        "commit_sha": sha,
        "analyzer_version": get_analyzer_version(),
        "source_dataset": "assets/app.css",
        "session_independent": True,
        "duplicate_selector_groups": 0,
        "total_remaining_count": 0,
        "remaining_safe_now": 0,
        "remaining_risk_now": 0,
        "remaining_forensic_only": 0,
        "continue_reason": None,
        "stop_reason": None,
        "exact_verdict": "STOP_NO_SAFE_CANDIDATES_WITH_EVIDENCE",
        "real_backlog_consistent": False,
    }
    css_path = APP_CSS
    if target_mode == "main" and branch != "main":
        try:
            raw = subprocess.run(
                ["git", "show", "main:assets/app.css"],
                cwd=ROOT,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=30,
            )
            if raw.returncode == 0 and raw.stdout:
                css_path = TEMP_BASE / "main_app.css"
                css_path.parent.mkdir(parents=True, exist_ok=True)
                css_path.write_text(raw.stdout, encoding="utf-8")
                sha = subprocess.run(["git", "rev-parse", "main"], cwd=ROOT, capture_output=True, text=True, timeout=5).stdout.strip() or "unknown"
                branch = "main"
                out_base["branch_name"] = branch
                out_base["commit_sha"] = sha
        except Exception:
            pass
    elif target_mode == "target_branch":
        branch, sha = _get_branch_and_sha(ROOT)
        out_base["branch_name"] = branch
        out_base["commit_sha"] = sha
    out_base["analyzer_version"] = get_analyzer_version()
    if not css_path.exists():
        out_base["stop_reason"] = "APP_CSS_MISSING"
        ENGINE_DIR.mkdir(parents=True, exist_ok=True)
        (ENGINE_DIR / output_key).write_text(json.dumps(out_base, indent=2, ensure_ascii=False), encoding="utf-8")
        return out_base
    result = audit_css_file(css_path)
    if result.get("error"):
        out_base["stop_reason"] = "AUDIT_ERROR"
        ENGINE_DIR.mkdir(parents=True, exist_ok=True)
        (ENGINE_DIR / output_key).write_text(json.dumps(out_base, indent=2, ensure_ascii=False), encoding="utf-8")
        return out_base
    total = int(result.get("duplicate_selector_groups", 0))
    cc = result.get("classification_counts") or {}
    safe = _safe_now_from_inventory(result)
    risk, forensic = _risk_now(cc), _forensic_only(cc)
    consistent = (int(cc.get("identical_duplicate", 0)) + risk + forensic) == total or total == 0
    out_base["duplicate_selector_groups"] = total
    out_base["total_remaining_count"] = total
    out_base["remaining_safe_now"] = safe
    out_base["remaining_risk_now"] = risk
    out_base["remaining_forensic_only"] = forensic
    out_base["real_backlog_consistent"] = consistent
    out_base["classification_counts"] = cc
    if safe == 0:
        out_base["stop_reason"] = "STOP_NO_SAFE_CANDIDATES_WITH_EVIDENCE"
        out_base["exact_verdict"] = "STOP_NO_SAFE_CANDIDATES_WITH_EVIDENCE"
    else:
        out_base["continue_reason"] = "SAFE_CANDIDATES_AVAILABLE"
        out_base["exact_verdict"] = "CONTINUE_WITH_SAFE_CANDIDATES"
    ENGINE_DIR.mkdir(parents=True, exist_ok=True)
    (ENGINE_DIR / output_key).write_text(json.dumps(out_base, indent=2, ensure_ascii=False), encoding="utf-8")
    return out_base


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "main"
    run_real_backlog_proof(target_mode=mode, output_key="real-backlog-main.json" if mode == "main" else "real-backlog-target.json")
