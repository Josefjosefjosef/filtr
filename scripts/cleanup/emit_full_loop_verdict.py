# -*- coding: utf-8 -*-
"""
Emit full loop verdict block from one session only. Evidence-based; no PASS without session proof.
LOOP_FINAL_STATUS = raw engine status from journal. Optional normalization with explicit mapping proof.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

from scripts.cleanup.final_report_synthesis import (
    ENGINE_DIR,
    LOOP_FINAL_STATUS_NORMALIZATION,
    build_full_loop_verdict_block,
    get_canonical_session,
    load_journal_events,
    compute_from_journal,
)


def main() -> None:
    session_id = get_canonical_session()
    if not session_id:
        print("session_id: NOT_FOUND")
        print("REPORT_BLOCKED: no canonical session")
        sys.exit(1)
    events = load_journal_events(session_id)
    if not events:
        print("session_id:", session_id)
        print("REPORT_BLOCKED: empty journal")
        sys.exit(1)
    from_journal = compute_from_journal(events)
    block = build_full_loop_verdict_block(session_id)

    # GATE 1 — session facts proof
    print("--- session facts proof ---")
    print("session_id:", session_id)
    print("count_verdicted_iterations:", from_journal["count_verdicted_iterations"])
    print("ordered_verdict_list:", json.dumps(from_journal["per_iteration_verdicts"]))
    print("count_pass:", from_journal["count_pass"])
    print("count_fail_reverted:", from_journal["count_fail_reverted"])
    print("has_iteration_after_pass:", from_journal["has_iteration_after_pass"])
    print("has_iteration_after_fail:", from_journal["has_iteration_after_fail"])
    print("final_stop_status_raw:", from_journal["final_stop_status"])

    # GATE 2 — classification proof
    print("--- classification proof ---")
    n = from_journal["count_verdicted_iterations"]
    print("CONTINUOUS_MULTI_CANDIDATE_EXECUTION: PASS only if count_verdicted_iterations >= 2; actual:", n, "=>", "PASS" if n >= 2 else "FAIL")
    print("FAIL_REVERT_CONTINUE_BEHAVIOR: PASS only if count_fail_reverted >= 1 and has_iteration_after_fail; actual:", from_journal["count_fail_reverted"], from_journal["has_iteration_after_fail"], "=>", block["FAIL_REVERT_CONTINUE_BEHAVIOR"])
    print("PASS_COMMIT_CONTINUE_BEHAVIOR: PASS only if count_pass >= 1 and has_iteration_after_pass; actual:", from_journal["count_pass"], from_journal["has_iteration_after_pass"], "=>", block["PASS_COMMIT_CONTINUE_BEHAVIOR"])

    # Engine status / normalized proof
    print("--- engine status proof ---")
    raw = block.get("LOOP_FINAL_STATUS_RAW") or block.get("LOOP_FINAL_STATUS")
    print("engine_status:", raw)
    if raw and raw in LOOP_FINAL_STATUS_NORMALIZATION:
        print("normalized_status:", LOOP_FINAL_STATUS_NORMALIZATION[raw])
        print("mapping_rule_applied: true")
    else:
        print("normalized_status: (none)")
        print("mapping_rule_applied: false")

    # Final verdict block (exact format)
    print("--- final verdict block ---")
    print("ENGINE_FOREGROUND_LOOP_CAPABILITY:", block.get("ENGINE_FOREGROUND_LOOP_CAPABILITY", "FAIL"))
    print("CONTINUOUS_MULTI_CANDIDATE_EXECUTION:", block.get("CONTINUOUS_MULTI_CANDIDATE_EXECUTION", "FAIL"))
    print("FAIL_REVERT_CONTINUE_BEHAVIOR:", block.get("FAIL_REVERT_CONTINUE_BEHAVIOR", "FAIL"))
    print("PASS_COMMIT_CONTINUE_BEHAVIOR:", block.get("PASS_COMMIT_CONTINUE_BEHAVIOR", "FAIL"))
    print("SESSION_SCOPED_FINAL_REPORT:", block.get("SESSION_SCOPED_FINAL_REPORT", "FAIL"))
    print("REPORT_TOTALS_MATCH_JOURNAL:", block.get("REPORT_TOTALS_MATCH_JOURNAL", "FAIL"))
    print("REPORT_PER_ITERATION_VERDICTS_MATCH_JOURNAL:", block.get("REPORT_PER_ITERATION_VERDICTS_MATCH_JOURNAL", "FAIL"))
    print("REPORT_FINAL_STOP_STATUS_MATCHES_JOURNAL:", block.get("REPORT_FINAL_STOP_STATUS_MATCHES_JOURNAL", "FAIL"))
    print("NO_BACKGROUND_CLAIMS_IN_OUTPUT:", block.get("NO_BACKGROUND_CLAIMS_IN_OUTPUT", "PASS"))
    # Emit raw engine status as LOOP_FINAL_STATUS (truthful)
    print("LOOP_FINAL_STATUS:", raw or "NOT_PROVEN")
    print("FULL_FOREGROUND_RUN_COMPLETED:", block.get("FULL_FOREGROUND_RUN_COMPLETED", "NO"))


if __name__ == "__main__":
    main()
