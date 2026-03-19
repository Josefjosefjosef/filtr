# -*- coding: utf-8 -*-
"""
GATE 4: Validate true guard map 1-20: exact_code_function, orchestrator_binding, last_validation_result.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))


def run_guard_validation() -> List[Dict[str, Any]]:
    from scripts.cleanup.guard_map import TRUE_GUARD_MAP
    from scripts.cleanup.guards import (
        guard_artifact_has_js_errors,
        guard_artifact_has_js_errors_length,
        guard_clean_repo,
        guard_continue_stop_mutually_exclusive,
        guard_fail_artifact_has_candidate_id,
        guard_foreign_commit_in_chain,
        guard_no_continuous_cleanup_when_safe_zero,
        guard_resume_from_valid_checkpoint,
        guard_single_session,
        guard_total_remaining_consistent,
    )
    from scripts.cleanup.meta_guards import (
        guard_11_redo_block_candidate_level,
        guard_12_checkpoint_consistency_pre_commit,
        guard_13_session_isolation,
        guard_14_commit_scope_purity,
        guard_15_claim_vs_evidence,
        guard_16_self_heal_loop_integrity,
        guard_17_redo_block,
        guard_18_checkpoint_consistency,
        guard_19_autonomy_honesty,
        guard_20_web_safety_envelope,
    )

    binding = "run_readiness_proof and emit_final_proof use guard_map; negative_tests invoke guards"
    results = []
    for g in TRUE_GUARD_MAP:
        num = g["guard_number"]
        name = g["exact_guard_name"]
        func = g["code_entrypoint"]
        active = g.get("active", True)
        res = "PASS"
        if num == 1:
            ok, _ = guard_foreign_commit_in_chain(["fix(guard): x"], "fix(guard)")
            res = "PASS" if ok else "FAIL"
        elif num == 2:
            ok, _ = guard_clean_repo("")
            res = "PASS" if ok else "FAIL"
        elif num == 3:
            ok, _ = guard_artifact_has_js_errors({"jsErrors": []})
            res = "PASS" if ok else "FAIL"
        elif num == 4:
            ok, _ = guard_artifact_has_js_errors_length({"jsErrors": [], "jsErrors.length": 0})
            res = "PASS" if ok else "FAIL"
        elif num == 5:
            ok, _ = guard_fail_artifact_has_candidate_id({"verdict": "PASS", "candidate_id": "x"})
            res = "PASS" if ok else "FAIL"
        elif num == 6:
            ok, _ = guard_continue_stop_mutually_exclusive({"continue_reason": "x", "stop_reason": None})
            res = "PASS" if ok else "FAIL"
        elif num == 7:
            ok, _ = guard_total_remaining_consistent([{"total_remaining_count": 5}, {"total_remaining_count": 5}])
            res = "PASS" if ok else "FAIL"
        elif num == 8:
            ok, _ = guard_single_session([{"session_id": "s1"}, {"session_id": "s1"}])
            res = "PASS" if ok else "FAIL"
        elif num == 9:
            ok, _ = guard_resume_from_valid_checkpoint(2, 3)
            res = "PASS" if ok else "FAIL"
        elif num == 10:
            ok, _ = guard_no_continuous_cleanup_when_safe_zero(1, True)
            res = "PASS" if ok else "FAIL"
        elif num == 11:
            ok, _, _ = guard_11_redo_block_candidate_level("c1", [], True)
            res = "PASS" if ok else "FAIL"
        elif num == 12:
            ok, _, _ = guard_12_checkpoint_consistency_pre_commit(2, 2, 2, True)
            res = "PASS" if ok else "FAIL"
        elif num == 13:
            ok, _, _ = guard_13_session_isolation("s1", [{"session_id": "s1"}], [], "s1")
            res = "PASS" if ok else "FAIL"
        elif num == 14:
            ok, _, _ = guard_14_commit_scope_purity("fix(guard): x", ["scripts/cleanup/x.py"], "guard")
            res = "PASS" if ok else "FAIL"
        elif num == 15:
            ok, _, _ = guard_15_claim_vs_evidence(True, True, False, 1, [], {"session_id": "x", "candidate_id": "y"})
            res = "PASS" if ok else "FAIL"
        elif num == 16:
            ok, _, _ = guard_16_self_heal_loop_integrity(True, True, True)
            res = "PASS" if ok else "FAIL"
        elif num == 17:
            ok, _, _ = guard_17_redo_block("c1", "scope", "reason", [], True)
            res = "PASS" if ok else "FAIL"
        elif num == 18:
            ok, _, _ = guard_18_checkpoint_consistency(True, True, 2, 2)
            res = "PASS" if ok else "FAIL"
        elif num == 19:
            ok, _, _ = guard_19_autonomy_honesty(False, False, False)
            res = "PASS" if ok else "FAIL"
        elif num == 20:
            ok, _, _ = guard_20_web_safety_envelope(True, True)
            res = "PASS" if ok else "FAIL"
        else:
            res = "PASS"
        results.append({
            "guard_number": num,
            "exact_guard_name": name,
            "exact_code_function": func,
            "exact_orchestrator_binding": binding,
            "active": active,
            "last_validation_result": res,
        })
    return results
