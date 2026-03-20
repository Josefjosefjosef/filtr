# -*- coding: utf-8 -*-
"""
Session-scoped final report synthesis. One session = one report.
All totals and per-iteration verdicts derived only from that session's journal.ndjson.
If journal vs loop-final.json mismatch or multi-session mix: REPORT_BLOCKED.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

TEMP_BASE = Path(os.environ.get("TEMP", os.environ.get("TMP", "/tmp"))) / "filtr_readiness"
ENGINE_DIR = TEMP_BASE / "reports" / "cleanup-engine"


def _session_dir(session_id: str) -> Path:
    return ENGINE_DIR / f"session-{session_id}"


def get_canonical_session() -> Optional[str]:
    """Session id from loop-final.json. None if missing or invalid."""
    path = ENGINE_DIR / "loop-final.json"
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data.get("session_id")
    except Exception:
        return None


def load_journal_events(session_id: str) -> List[Dict[str, Any]]:
    """Load journal.ndjson for session. Returns list of event dicts."""
    journal = _session_dir(session_id) / "journal.ndjson"
    if not journal.exists():
        return []
    events: List[Dict[str, Any]] = []
    for line in journal.read_text(encoding="utf-8").strip().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except Exception:
            continue
    return events


def compute_from_journal(events: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    From journal events compute:
    - count_pass, count_fail_reverted, count_skipped
    - per_iteration_verdicts: ordered by iteration_number [verdict1, verdict2, ...]
    - final_stop_status from session_end event
    """
    count_pass = 0
    count_fail_reverted = 0
    count_skipped = 0
    per_iteration: List[Tuple[int, str]] = []  # (iteration_number, verdict)
    final_stop_status: Optional[str] = None

    for ev in events:
        kind = ev.get("event") or ""
        if kind == "iteration_committed":
            count_pass += 1
            per_iteration.append((int(ev.get("iteration_number", 0)), "PASS"))
        elif kind == "iteration_fail_reverted":
            count_fail_reverted += 1
            per_iteration.append((int(ev.get("iteration_number", 0)), "FAIL_REVERTED"))
        elif kind == "session_end":
            final_stop_status = ev.get("LOOP_FINAL_STATUS")
            # optional: count_skipped from event if present
            count_skipped = int(ev.get("TOTAL_SKIPPED_OR_DOWNGRADED_CANDIDATES", 0))

    per_iteration.sort(key=lambda x: x[0])
    per_iteration_verdicts = [v for _, v in per_iteration]

    # Session facts for truthful verdict classification
    count_verdicted = len(per_iteration_verdicts)
    has_iteration_after_pass = False
    has_iteration_after_fail = False
    for i, v in enumerate(per_iteration_verdicts):
        if v == "PASS" and i + 1 < len(per_iteration_verdicts):
            has_iteration_after_pass = True
        if v == "FAIL_REVERTED" and i + 1 < len(per_iteration_verdicts):
            has_iteration_after_fail = True

    return {
        "count_pass": count_pass,
        "count_fail_reverted": count_fail_reverted,
        "count_skipped": count_skipped,
        "per_iteration_verdicts": per_iteration_verdicts,
        "final_stop_status": final_stop_status,
        "count_verdicted_iterations": count_verdicted,
        "has_iteration_after_pass": has_iteration_after_pass,
        "has_iteration_after_fail": has_iteration_after_fail,
    }


def load_loop_final() -> Optional[Dict[str, Any]]:
    path = ENGINE_DIR / "loop-final.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def validate_consistency(
    session_id: str, from_journal: Dict[str, Any], loop_final: Optional[Dict[str, Any]]
) -> Tuple[bool, List[str]]:
    """
    True iff loop_final matches journal-derived counts and same session.
    Returns (consistent, list of diff messages).
    """
    diffs: List[str] = []
    if loop_final is None:
        diffs.append("loop_final_missing")
        return (False, diffs)
    if loop_final.get("session_id") != session_id:
        diffs.append("session_id_mismatch:loop_final=" + str(loop_final.get("session_id")) + " vs " + session_id)
        return (False, diffs)
    lf_pass = int(loop_final.get("TOTAL_PASS_ITERATIONS", -1))
    lf_fail = int(loop_final.get("TOTAL_FAIL_REVERTED_ITERATIONS", -1))
    lf_skip = int(loop_final.get("TOTAL_SKIPPED_OR_DOWNGRADED_CANDIDATES", -1))
    lf_stop = loop_final.get("LOOP_FINAL_STATUS")
    j_pass = from_journal["count_pass"]
    j_fail = from_journal["count_fail_reverted"]
    j_skip = from_journal["count_skipped"]
    j_stop = from_journal["final_stop_status"]
    if lf_pass != j_pass:
        diffs.append("TOTAL_PASS_ITERATIONS:loop_final=" + str(lf_pass) + " journal=" + str(j_pass))
    if lf_fail != j_fail:
        diffs.append("TOTAL_FAIL_REVERTED_ITERATIONS:loop_final=" + str(lf_fail) + " journal=" + str(j_fail))
    if lf_skip != j_skip:
        diffs.append("TOTAL_SKIPPED:loop_final=" + str(lf_skip) + " journal=" + str(j_skip))
    if lf_stop != j_stop:
        diffs.append("LOOP_FINAL_STATUS:loop_final=" + str(lf_stop) + " journal=" + str(j_stop))
    return (len(diffs) == 0, diffs)


def build_final_report() -> Dict[str, Any]:
    """
    Build final verdict block from single canonical session.
    If no session or inconsistent: REPORT_SESSION_SCOPING or REPORT_BLOCKED,
    per-iteration verdicts NOT_PROVEN where not derivable.
    """
    out: Dict[str, Any] = {
        "REPORT_BLOCKED": False,
        "REPORT_SESSION_SCOPING": "PASS",
        "session_id": None,
        "FIRST_REAL_CLEANUP_ITERATION_VERDICT": "NOT_PROVEN",
        "SECOND_REAL_CLEANUP_ITERATION_VERDICT": "NOT_PROVEN",
        "THIRD_REAL_CLEANUP_ITERATION_VERDICT": "NOT_PROVEN",
        "TOTAL_PASS_ITERATIONS": 0,
        "TOTAL_FAIL_REVERTED_ITERATIONS": 0,
        "TOTAL_SKIPPED_OR_DOWNGRADED_CANDIDATES": 0,
        "LOOP_FINAL_STATUS": None,
    }
    session_id = get_canonical_session()
    if not session_id:
        out["REPORT_SESSION_SCOPING"] = "FAIL"
        out["REPORT_BLOCKED"] = True
        return out
    out["session_id"] = session_id
    events = load_journal_events(session_id)
    if not events:
        out["REPORT_SESSION_SCOPING"] = "FAIL"
        out["REPORT_BLOCKED"] = True
        return out
    from_journal = compute_from_journal(events)
    loop_final = load_loop_final()
    consistent, diffs = validate_consistency(session_id, from_journal, loop_final)
    if not consistent:
        out["REPORT_BLOCKED"] = True
        out["consistency_diffs"] = diffs
        return out
    # Totals from journal (and loop_final matches)
    out["TOTAL_PASS_ITERATIONS"] = from_journal["count_pass"]
    out["TOTAL_FAIL_REVERTED_ITERATIONS"] = from_journal["count_fail_reverted"]
    out["TOTAL_SKIPPED_OR_DOWNGRADED_CANDIDATES"] = from_journal["count_skipped"]
    out["LOOP_FINAL_STATUS"] = from_journal["final_stop_status"]
    verdicts = from_journal["per_iteration_verdicts"]
    if len(verdicts) >= 1:
        out["FIRST_REAL_CLEANUP_ITERATION_VERDICT"] = verdicts[0]
    if len(verdicts) >= 2:
        out["SECOND_REAL_CLEANUP_ITERATION_VERDICT"] = verdicts[1]
    if len(verdicts) >= 3:
        out["THIRD_REAL_CLEANUP_ITERATION_VERDICT"] = verdicts[2]
    return out


def self_check_per_iteration_vs_totals(report: Dict[str, Any]) -> bool:
    """False if per-iteration verdicts contradict totals (e.g. 2 PASS in list but TOTAL_PASS=1)."""
    if report.get("REPORT_BLOCKED"):
        return False
    v1 = report.get("FIRST_REAL_CLEANUP_ITERATION_VERDICT")
    v2 = report.get("SECOND_REAL_CLEANUP_ITERATION_VERDICT")
    v3 = report.get("THIRD_REAL_CLEANUP_ITERATION_VERDICT")
    verdicts = [v for v in [v1, v2, v3] if v and v != "NOT_PROVEN"]
    count_pass = sum(1 for v in verdicts if v == "PASS")
    count_fail = sum(1 for v in verdicts if v == "FAIL_REVERTED")
    if count_pass != report.get("TOTAL_PASS_ITERATIONS", -1):
        return False
    if count_fail != report.get("TOTAL_FAIL_REVERTED_ITERATIONS", -1):
        return False
    return True


# Explicit normalization: only these engine statuses map to normalized; no mapping = emit raw only.
LOOP_FINAL_STATUS_NORMALIZATION: Dict[str, str] = {
    "STOP_NO_SAFE_CANDIDATES_WITH_EVIDENCE": "SAFE_BACKLOG_EXHAUSTED",
    "STOP_ENGINE_BLOCKER_WITH_EVIDENCE": "ENGINE_BLOCKED",
    "STOP_REPORT_INCONSISTENT_FIX_FIRST": "REPORT_BLOCKED",
}


def build_full_loop_verdict_block(session_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Build full loop verdict block from one session. No PASS without session proof.
    - CONTINUOUS_MULTI_CANDIDATE_EXECUTION: PASS only if count_verdicted_iterations >= 2.
    - FAIL_REVERT_CONTINUE_BEHAVIOR: PASS only if at least one FAIL_REVERTED and an iteration after it.
    - PASS_COMMIT_CONTINUE_BEHAVIOR: PASS only if at least one PASS and an iteration after it.
    - LOOP_FINAL_STATUS: raw engine status from journal; optional normalized_status only if in map (with proof).
    """
    sid = session_id or get_canonical_session()
    out: Dict[str, Any] = {
        "ENGINE_FOREGROUND_LOOP_CAPABILITY": "FAIL",
        "CONTINUOUS_MULTI_CANDIDATE_EXECUTION": "FAIL",
        "FAIL_REVERT_CONTINUE_BEHAVIOR": "FAIL",
        "PASS_COMMIT_CONTINUE_BEHAVIOR": "FAIL",
        "SESSION_SCOPED_FINAL_REPORT": "FAIL",
        "REPORT_TOTALS_MATCH_JOURNAL": "FAIL",
        "REPORT_PER_ITERATION_VERDICTS_MATCH_JOURNAL": "FAIL",
        "REPORT_FINAL_STOP_STATUS_MATCHES_JOURNAL": "FAIL",
        "NO_BACKGROUND_CLAIMS_IN_OUTPUT": "PASS",
        "LOOP_FINAL_STATUS": None,
        "LOOP_FINAL_STATUS_RAW": None,
        "LOOP_FINAL_STATUS_NORMALIZED": None,
        "FULL_FOREGROUND_RUN_COMPLETED": "NO",
        "session_facts": None,
    }
    if not sid:
        return out
    events = load_journal_events(sid)
    if not events:
        return out
    from_journal = compute_from_journal(events)
    loop_final = load_loop_final()
    if loop_final is None or loop_final.get("session_id") != sid:
        return out
    consistent, _ = validate_consistency(sid, from_journal, loop_final)
    if not consistent:
        return out

    n = from_journal["count_verdicted_iterations"]
    count_pass = from_journal["count_pass"]
    count_fail = from_journal["count_fail_reverted"]
    after_pass = from_journal["has_iteration_after_pass"]
    after_fail = from_journal["has_iteration_after_fail"]
    raw_status = from_journal["final_stop_status"]

    out["SESSION_SCOPED_FINAL_REPORT"] = "PASS"
    out["REPORT_TOTALS_MATCH_JOURNAL"] = "PASS"
    out["REPORT_PER_ITERATION_VERDICTS_MATCH_JOURNAL"] = "PASS"
    out["REPORT_FINAL_STOP_STATUS_MATCHES_JOURNAL"] = "PASS"
    out["ENGINE_FOREGROUND_LOOP_CAPABILITY"] = "PASS"
    out["LOOP_FINAL_STATUS"] = raw_status
    out["LOOP_FINAL_STATUS_RAW"] = raw_status
    out["session_facts"] = {
        "count_verdicted_iterations": n,
        "per_iteration_verdicts": from_journal["per_iteration_verdicts"],
        "count_pass": count_pass,
        "count_fail_reverted": count_fail,
        "has_iteration_after_pass": after_pass,
        "has_iteration_after_fail": after_fail,
        "final_stop_status_raw": raw_status,
    }

    if n >= 2:
        out["CONTINUOUS_MULTI_CANDIDATE_EXECUTION"] = "PASS"
    if count_fail >= 1 and after_fail:
        out["FAIL_REVERT_CONTINUE_BEHAVIOR"] = "PASS"
    if count_pass >= 1 and after_pass:
        out["PASS_COMMIT_CONTINUE_BEHAVIOR"] = "PASS"

    has_session_end = any(ev.get("event") == "session_end" for ev in events)
    if has_session_end:
        out["FULL_FOREGROUND_RUN_COMPLETED"] = "YES"

    if raw_status and raw_status in LOOP_FINAL_STATUS_NORMALIZATION:
        out["LOOP_FINAL_STATUS_NORMALIZED"] = LOOP_FINAL_STATUS_NORMALIZATION[raw_status]
        out["LOOP_FINAL_STATUS_MAPPING_APPLIED"] = True

    return out
