# -*- coding: utf-8 -*-
"""
Run: fixture (minimal), real backlog main + target, guard map check, claim vs evidence, verdict.
Conditional start: if all pass and target_safe_now>0, optionally run 1 cleanup iteration (see GATE 8).
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))


def main() -> None:
    from scripts.cleanup.guard_map import TRUE_GUARD_MAP
    from scripts.cleanup.real_backlog_proof import run_real_backlog_proof
    from scripts.cleanup.verdict_layers import compute_verdict_layers
    from scripts.cleanup.claim_vs_evidence import run_claim_vs_evidence
    from scripts.cleanup.forensic_report import build_forensic_explanation
    from scripts.cleanup.forensic_root_cause import build_root_cause_lock

    main_proof = run_real_backlog_proof(target_mode="main", output_key="real-backlog-main.json")
    target_proof = run_real_backlog_proof(target_mode="target_branch", output_key="real-backlog-target.json")
    build_root_cause_lock(
        new_branch_name=main_proof["branch_name"],
        new_commit_sha=main_proof["commit_sha"],
        new_safe_now=main_proof["remaining_safe_now"],
        new_classification_counts=main_proof.get("classification_counts") or {},
    )
    build_forensic_explanation(
        old_branch_name="main",
        old_commit_sha="previous",
        old_safe_now=0,
        old_source="earlier_run_reported_safe_now_0",
        new_branch_name=main_proof["branch_name"],
        new_commit_sha=main_proof["commit_sha"],
        new_safe_now=main_proof["remaining_safe_now"],
        new_analyzer_version=main_proof["analyzer_version"],
    )
    guard_count = len(TRUE_GUARD_MAP)
    any_guard_block = guard_count != 20
    try:
        st = subprocess.run(["git", "status", "--short"], cwd=ROOT, capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:
        st = "?"
    try:
        log = subprocess.run(["git", "log", "--oneline", "main..HEAD"], cwd=ROOT, capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:
        log = ""
    repo_clean = not bool(st)
    chain_ok = bool(log and "chore(css)" not in log)
    layers = compute_verdict_layers(
        engine_readiness_ok=(guard_count == 20),
        main_safe_now=int(main_proof.get("remaining_safe_now", 0)),
        main_stop_reason=main_proof.get("stop_reason"),
        main_consistent=main_proof.get("real_backlog_consistent", False),
        target_safe_now=int(target_proof.get("remaining_safe_now", 0)),
        target_stop_reason=target_proof.get("stop_reason"),
        target_consistent=target_proof.get("real_backlog_consistent", False),
        any_guard_block=any_guard_block,
        repo_clean=repo_clean,
    )
    run_claim_vs_evidence(
        engine_ready=layers["ENGINE_READINESS_VERDICT"],
        main_verdict=layers["REAL_BACKLOG_STATUS_VERDICT_MAIN"],
        target_verdict=layers["REAL_BACKLOG_STATUS_VERDICT_TARGET_BRANCH"],
        start_verdict=layers["CONTINUOUS_CLEANUP_START_VERDICT"],
        guard_count=guard_count,
        main_safe=int(main_proof.get("remaining_safe_now", 0)),
        target_safe=int(target_proof.get("remaining_safe_now", 0)),
        repo_clean=repo_clean,
        chain_ok=chain_ok,
    )
    print("ENGINE_READINESS_VERDICT: " + layers["ENGINE_READINESS_VERDICT"])
    print("REAL_BACKLOG_STATUS_VERDICT_MAIN: " + layers["REAL_BACKLOG_STATUS_VERDICT_MAIN"])
    print("REAL_BACKLOG_STATUS_VERDICT_TARGET_BRANCH: " + layers["REAL_BACKLOG_STATUS_VERDICT_TARGET_BRANCH"])
    print("CONTINUOUS_CLEANUP_START_VERDICT: " + layers["CONTINUOUS_CLEANUP_START_VERDICT"])
    first_cleanup = "NOT_RUN"
    second_cleanup = "NOT_RUN"
    if layers["CONTINUOUS_CLEANUP_START_VERDICT"] == "READY FOR CONTINUOUS GUARDED CLEANUP LOOP" and int(target_proof.get("remaining_safe_now", 0)) > 0 and repo_clean:
        from scripts.cleanup.cleanup_one_step import run_one_cleanup_iteration
        first_cleanup = run_one_cleanup_iteration(iteration_number=1, group_index=0)
    if first_cleanup == "FAIL_REVERTED":
        try:
            st2 = subprocess.run(["git", "status", "--short"], cwd=ROOT, capture_output=True, text=True, timeout=5).stdout.strip()
        except Exception:
            st2 = "?"
        if not st2 and layers["CONTINUOUS_CLEANUP_START_VERDICT"] == "READY FOR CONTINUOUS GUARDED CLEANUP LOOP" and int(target_proof.get("remaining_safe_now", 0)) > 1:
            from scripts.cleanup.cleanup_one_step import run_one_cleanup_iteration
            second_cleanup = run_one_cleanup_iteration(iteration_number=2, group_index=1)
    print("FIRST_REAL_CLEANUP_ITERATION_VERDICT: " + first_cleanup)
    print("SECOND_REAL_CLEANUP_ITERATION_VERDICT: " + second_cleanup)


if __name__ == "__main__":
    main()
