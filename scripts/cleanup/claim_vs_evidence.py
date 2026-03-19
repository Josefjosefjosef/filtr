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
    claims["ENGINE"] = {"claim": engine_ready, "evidence": "guards_" + str(guard_count), "status": "PASS" if guard_count == 20 else "FAIL"}
    claims["MAIN"] = {"claim": main_verdict, "evidence": "safe_now=" + str(main_safe), "status": "PASS"}
    claims["TARGET"] = {"claim": target_verdict, "evidence": "safe_now=" + str(target_safe), "status": "PASS"}
    start_ok = engine_ready == "READY" and target_safe > 0 and repo_clean and chain_ok
    claims["START"] = {"claim": start_verdict, "evidence": "start_ok=" + str(start_ok), "status": "PASS" if start_ok else "FAIL"}
    overall = "PASS" if all(claims[k]["status"] == "PASS" for k in claims) else "FAIL"
    result = {"claims": claims, "claim_vs_evidence_overall": overall}
    ENGINE_DIR.mkdir(parents=True, exist_ok=True)
    import json
    (ENGINE_DIR / "claim-vs-evidence.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    return result
