# -*- coding: utf-8 -*-
"""Four verdicts + conditional start. Start READY only if engine READY and target safe_now>0 and no guard block."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict

ROOT = Path(__file__).resolve().parent.parent.parent
TEMP_BASE = Path(os.environ.get("TEMP", os.environ.get("TMP", "/tmp"))) / "filtr_readiness"
ENGINE_DIR = TEMP_BASE / "reports" / "cleanup-engine"
VERDICT_PATH = ENGINE_DIR / "final-verdict-layers.json"


def compute_verdict_layers(
    engine_readiness_ok: bool,
    main_safe_now: int,
    main_stop_reason: str | None,
    main_consistent: bool,
    target_safe_now: int,
    target_stop_reason: str | None,
    target_consistent: bool,
    any_guard_block: bool,
) -> Dict[str, Any]:
    engine_verdict = "READY" if engine_readiness_ok else "NOT READY"
    main_verdict = (
        main_stop_reason or "STOP_NO_SAFE_CANDIDATES_WITH_EVIDENCE"
        if main_safe_now == 0 and main_consistent
        else ("CONTINUE_WITH_SAFE_CANDIDATES" if main_safe_now > 0 else (main_stop_reason or "STOP_NO_SAFE_CANDIDATES_WITH_EVIDENCE"))
    )
    target_verdict = (
        target_stop_reason or "STOP_NO_SAFE_CANDIDATES_WITH_EVIDENCE"
        if target_safe_now == 0 and target_consistent
        else ("CONTINUE_WITH_SAFE_CANDIDATES" if target_safe_now > 0 else (target_stop_reason or "STOP_NO_SAFE_CANDIDATES_WITH_EVIDENCE"))
    )
    if not engine_readiness_ok or any_guard_block or target_safe_now == 0 or not target_consistent:
        start_verdict = "NOT READY TO START CONTINUOUS CLEANUP"
    else:
        start_verdict = "READY FOR CONTINUOUS GUARDED CLEANUP LOOP"
    out = {
        "ENGINE_READINESS_VERDICT": engine_verdict,
        "REAL_BACKLOG_STATUS_VERDICT_MAIN": main_verdict,
        "REAL_BACKLOG_STATUS_VERDICT_TARGET_BRANCH": target_verdict,
        "CONTINUOUS_CLEANUP_START_VERDICT": start_verdict,
        "main_safe_now": main_safe_now,
        "target_safe_now": target_safe_now,
        "any_guard_block": any_guard_block,
    }
    ENGINE_DIR.mkdir(parents=True, exist_ok=True)
    VERDICT_PATH.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    return out
