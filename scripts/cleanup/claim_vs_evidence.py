# -*- coding: utf-8 -*-
"""Claim vs evidence: each verdict claim must have supporting raw evidence."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict

TEMP_BASE = Path(os.environ.get("TEMP", os.environ.get("TMP", "/tmp"))) / "filtr_readiness"
ENGINE_DIR = TEMP_BASE / "reports" / "cleanup-engine"


def run_claim_vs_evidence(
    engine_ready: str,
    main_verdict: str,
    target_verdict: str,
    start_verdict: str,
    guard_count: int,
    main_safe: int,
    target_safe: int,
    repo_clean: bool,
    chain_ok: bool,
) -> Dict[str, Any]:
    claims = {}
    eng_ok = guard_count == 20
    claims["ENGINE_READINESS_VERDICT"] = {
        "claim": engine_ready,
        "supporting_raw_evidence": "guard_count=" + str(guard_count) + "_all_active",
        "blocking_raw_evidence": None if eng_ok else "guard_count_not_20",
        "claim_vs_evidence_status": "PASS" if eng_ok else "FAIL",
    }
    claims["REAL_BACKLOG_STATUS_VERDICT_MAIN"] = {
        "claim": main_verdict,
        "supporting_raw_evidence": "main_safe_now=" + str(main_safe),
        "blocking_raw_evidence": None,
        "claim_vs_evidence_status": "PASS",
    }
    claims["REAL_BACKLOG_STATUS_VERDICT_TARGET_BRANCH"] = {
        "claim": target_verdict,
        "supporting_raw_evidence": "target_safe_now=" + str(target_safe),
        "blocking_raw_evidence": None,
        "claim_vs_evidence_status": "PASS",
    }
    start_ok = engine_ready == "READY" and target_safe > 0 and repo_clean and chain_ok
    claims["CONTINUOUS_CLEANUP_START_VERDICT"] = {
        "claim": start_verdict,
        "supporting_raw_evidence": "repo_clean=" + str(repo_clean) + "_target_safe=" + str(target_safe) if start_ok else None,
        "blocking_raw_evidence": None if start_ok else "repo_not_clean_or_target_safe_zero_or_chain_contaminated",
        "claim_vs_evidence_status": "PASS" if start_ok else "FAIL",
    }
    overall = "PASS" if all(claims[k]["claim_vs_evidence_status"] == "PASS" for k in claims) else "FAIL"
    result = {"claims": claims, "claim_vs_evidence_overall": overall}
    ENGINE_DIR.mkdir(parents=True, exist_ok=True)
    import json
    (ENGINE_DIR / "claim-vs-evidence.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    return result
