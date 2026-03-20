# -*- coding: utf-8 -*-
"""
P0 Inventory determinism proof: 3 runs, full result identity (counts + fingerprints).
No cleanup execution. Outputs raw evidence for GATE 1 and GATE 2.
Run from repo root with: py scripts/cleanup/inventory_determinism_proof.py
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
APP_CSS = ROOT / "assets" / "app.css"


def get_head_sha() -> str:
    r = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, timeout=5)
    return r.stdout.strip() if r.returncode == 0 else "unknown"


def input_fingerprint() -> str:
    if not APP_CSS.exists():
        return "MISSING"
    return hashlib.sha256(APP_CSS.read_bytes()).hexdigest()[:24]


def safe_candidate_fingerprint(safe_groups_top: list) -> str:
    canonical = []
    for g in safe_groups_top or []:
        sel = g.get("selector_normalized") or ""
        occs = g.get("occurrences") or []
        lines = tuple(sorted((o.get("line_start"), o.get("line_end")) for o in occs))
        canonical.append((sel, lines))
    canonical.sort(key=lambda x: (x[0], x[1]))
    return hashlib.sha256(json.dumps(canonical, sort_keys=True).encode()).hexdigest()[:24]


def risk_forensic_fingerprints(brief: list) -> tuple[str, str]:
    risk_selectors = sorted(
        b["selector_normalized"] or ""
        for b in brief
        if b.get("classification") in ("risky_layout_coupled", "intentional_cascade_candidate")
    )
    forensic_selectors = sorted(
        b["selector_normalized"] or "" for b in brief if b.get("classification") == "breakpoint_specific"
    )
    risk_fp = hashlib.sha256(json.dumps(risk_selectors).encode()).hexdigest()[:24]
    forensic_fp = hashlib.sha256(json.dumps(forensic_selectors).encode()).hexdigest()[:24]
    return risk_fp, forensic_fp


def run_one(run_id: int) -> dict:
    sys.path.insert(0, str(ROOT / "scripts"))
    from css_duplicate_audit import audit_css_file  # noqa: E402

    result = audit_css_file(APP_CSS)
    if result.get("error"):
        return {"error": result["error"], "run_id": run_id}
    cc = result.get("classification_counts") or {}
    safe_top = result.get("safe_groups_top") or []
    brief = result.get("duplicate_groups_brief") or []
    flags = result.get("inventory_flags") or {}
    flags_canonical = json.dumps(flags, sort_keys=True)
    risk_fp, forensic_fp = risk_forensic_fingerprints(brief)
    return {
        "run_id": run_id,
        "HEAD_SHA": get_head_sha(),
        "FLAGS": flags_canonical,
        "INPUT_FINGERPRINT": input_fingerprint(),
        "duplicate_selector_groups": result.get("duplicate_selector_groups"),
        "remaining_safe_now": len(safe_top),
        "remaining_risk_now": int(cc.get("risky_layout_coupled", 0)) + int(cc.get("intentional_cascade_candidate", 0)),
        "remaining_forensic_only": int(cc.get("breakpoint_specific", 0)),
        "SAFE_CANDIDATE_COUNT": len(safe_top),
        "SAFE_CANDIDATE_FINGERPRINT": safe_candidate_fingerprint(safe_top),
        "RISK_CANDIDATE_FINGERPRINT": risk_fp,
        "FORENSIC_ONLY_FINGERPRINT": forensic_fp,
    }


def main() -> None:
    runs = []
    for i in (1, 2, 3):
        runs.append(run_one(i))
        if runs[-1].get("error"):
            print("RUN", i, "ERROR", runs[-1]["error"], flush=True)
            sys.exit(1)
    for r in runs:
        print("RUN_ID", r["run_id"], flush=True)
        print("HEAD_SHA", r["HEAD_SHA"], flush=True)
        print("FLAGS", r["FLAGS"], flush=True)
        print("INPUT_FINGERPRINT", r["INPUT_FINGERPRINT"], flush=True)
        print("duplicate_selector_groups", r["duplicate_selector_groups"], flush=True)
        print("remaining_safe_now", r["remaining_safe_now"], flush=True)
        print("remaining_risk_now", r["remaining_risk_now"], flush=True)
        print("remaining_forensic_only", r["remaining_forensic_only"], flush=True)
        print("SAFE_CANDIDATE_COUNT", r["SAFE_CANDIDATE_COUNT"], flush=True)
        print("SAFE_CANDIDATE_FINGERPRINT", r["SAFE_CANDIDATE_FINGERPRINT"], flush=True)
        print("RISK_CANDIDATE_FINGERPRINT", r["RISK_CANDIDATE_FINGERPRINT"], flush=True)
        print("FORENSIC_ONLY_FINGERPRINT", r["FORENSIC_ONLY_FINGERPRINT"], flush=True)
        print("---", flush=True)
    r1, r2, r3 = runs[0], runs[1], runs[2]
    keys = [
        "HEAD_SHA", "FLAGS", "INPUT_FINGERPRINT",
        "duplicate_selector_groups", "remaining_safe_now", "remaining_risk_now", "remaining_forensic_only",
        "SAFE_CANDIDATE_FINGERPRINT", "RISK_CANDIDATE_FINGERPRINT", "FORENSIC_ONLY_FINGERPRINT",
    ]
    # FLAGS stored as canonical JSON string
    eq12 = all(str(r1.get(k)) == str(r2.get(k)) for k in keys)
    eq23 = all(str(r2.get(k)) == str(r3.get(k)) for k in keys)
    eq13 = all(str(r1.get(k)) == str(r3.get(k)) for k in keys)
    print("RUN1_EQ_RUN2", "true" if eq12 else "false", flush=True)
    print("RUN2_EQ_RUN3", "true" if eq23 else "false", flush=True)
    print("RUN1_EQ_RUN3", "true" if eq13 else "false", flush=True)


if __name__ == "__main__":
    main()
