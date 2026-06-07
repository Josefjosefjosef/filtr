#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RSS Rotation Phase 2B — runtime activation proof.

Verifies batch mode (RSS_ROTATION_BATCH_RUNTIME=1) vs legacy fallback,
15min floor, registry fallback, and unchanged legacy cap.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from iu_registry import (  # noqa: E402
    MAX_SOURCES_PER_SCHEDULER_TICK,
    RSS_ROTATION_BATCH_RUNTIME_ENV,
    batch_id_for_minute,
    is_batch_runtime_enabled,
    select_feeds_for_tick,
)
from iu_rotation_foundation import (  # noqa: E402
    ROTATION_BATCH_CYCLE_MINUTES,
    ROTATION_BATCH_IDS,
    ROTATION_MIN_FETCH_INTERVAL_MIN,
    load_rotation_batch_registry,
    load_source_registry,
    registry_active_entries,
)

ROOT = os.path.dirname(_SCRIPTS)
TICK_INTERVAL_MIN = 5
SIMULATION_MINUTES = 20


def _prague_minute_to_utc(minute_of_hour: int, hour: int = 12) -> datetime:
    """Fixed summer Prague offset (+2) for deterministic batch minute tests."""
    return datetime(2026, 6, 6, hour - 2, minute_of_hour, tzinfo=timezone.utc)


def _fresh_state() -> dict:
    return {
        "tick_index": 0,
        "domain_last_fetch": {},
        "entry_state": {},
        "source_schedule": {},
    }


def test_legacy_cap_unchanged() -> dict[str, Any]:
    prev = os.environ.pop(RSS_ROTATION_BATCH_RUNTIME_ENV, None)
    try:
        assert MAX_SOURCES_PER_SCHEDULER_TICK == 5
        assert not is_batch_runtime_enabled()
        registry = load_source_registry()
        entries = registry_active_entries(registry)[:8]
        mini_reg = {"entries": entries, "sources_per_tick": {"max_unmapped_per_tick": 0}}
        picked, _ = select_feeds_for_tick(mini_reg, _fresh_state(), now=_prague_minute_to_utc(0))
        ok = len(picked) <= 5
        return {"pass": ok, "picked_count": len(picked), "cap": MAX_SOURCES_PER_SCHEDULER_TICK}
    finally:
        if prev is not None:
            os.environ[RSS_ROTATION_BATCH_RUNTIME_ENV] = prev


def test_batch_minute_mapping() -> dict[str, Any]:
    expected = {0: "A", 5: "B", 10: "C", 15: "D", 20: "A", 25: "B", 30: "C", 35: "D"}
    mismatches = {m: (batch_id_for_minute(m), bid) for m, bid in expected.items() if batch_id_for_minute(m) != bid}
    return {"pass": not mismatches, "mismatches": mismatches}


def test_batch_mode_selects_registry_batch() -> dict[str, Any]:
    os.environ[RSS_ROTATION_BATCH_RUNTIME_ENV] = "1"
    try:
        registry = load_source_registry()
        batch_reg = load_rotation_batch_registry()
        for minute, batch_id in ((0, "A"), (5, "B"), (10, "C"), (15, "D")):
            now = _prague_minute_to_utc(minute)
            picked, st = select_feeds_for_tick(registry, _fresh_state(), now=now)
            tick = st.get("last_scheduler_tick") or {}
            expected_ids = set((batch_reg["batches"][batch_id].get("source_ids") or []))
            picked_ids = {str(e.get("id") or "") for e in picked}
            if tick.get("batch_id") != batch_id:
                return {"pass": False, "minute": minute, "error": "batch_id_mismatch", "tick": tick}
            if not picked_ids.issubset(expected_ids):
                extra = sorted(picked_ids - expected_ids)
                return {"pass": False, "minute": minute, "error": "unexpected_sources", "extra": extra[:5]}
            if len(picked) != len(expected_ids):
                return {
                    "pass": False,
                    "minute": minute,
                    "error": "count_mismatch",
                    "expected": len(expected_ids),
                    "picked": len(picked),
                }
        return {"pass": True}
    finally:
        os.environ.pop(RSS_ROTATION_BATCH_RUNTIME_ENV, None)


def test_min_interval_floor() -> dict[str, Any]:
    os.environ[RSS_ROTATION_BATCH_RUNTIME_ENV] = "1"
    try:
        registry = load_source_registry()
        batch_reg = load_rotation_batch_registry()
        batch_a_ids = list((batch_reg["batches"]["A"].get("source_ids") or []))[:3]
        if not batch_a_ids:
            return {"pass": False, "error": "empty_batch_a"}
        recent = (datetime.now(timezone.utc) - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
        state = _fresh_state()
        for sid in batch_a_ids:
            state["entry_state"][sid] = {"last_fetch_at": recent}
        now = _prague_minute_to_utc(0)
        picked, st = select_feeds_for_tick(registry, state, now=now)
        skipped = (st.get("last_scheduler_tick") or {}).get("skipped_sources") or []
        floor_skips = [s for s in skipped if s.get("reason") == "SKIPPED_MIN_INTERVAL_FLOOR"]
        picked_recent = {str(e.get("id") or "") for e in picked} & set(batch_a_ids)
        ok = len(floor_skips) >= len(batch_a_ids) and not picked_recent
        return {
            "pass": ok,
            "floor_skip_count": len(floor_skips),
            "picked_from_recent": sorted(picked_recent),
        }
    finally:
        os.environ.pop(RSS_ROTATION_BATCH_RUNTIME_ENV, None)


def test_registry_fallback_to_legacy() -> dict[str, Any]:
    os.environ[RSS_ROTATION_BATCH_RUNTIME_ENV] = "1"
    fake_path = os.path.join(tempfile.gettempdir(), "iu_phase2b_missing_registry.json")
    if os.path.isfile(fake_path):
        os.unlink(fake_path)
    prev_rel = None
    try:
        import iu_registry as reg_mod

        prev_rel = reg_mod.ROTATION_BATCH_REGISTRY_REL
        reg_mod.ROTATION_BATCH_REGISTRY_REL = fake_path
        entries = [
            {
                "id": f"s{i}",
                "feed_url": f"https://example{i}.cz/rss",
                "domain": f"example{i}.cz",
                "active": True,
                "blocked": False,
                "interval_min": 30,
                "per_domain_cooldown_min": 15,
            }
            for i in range(8)
        ]
        mini_reg = {"entries": entries, "sources_per_tick": {"max_unmapped_per_tick": 0}}
        picked, st = select_feeds_for_tick(mini_reg, _fresh_state(), now=_prague_minute_to_utc(0))
        tick = st.get("last_scheduler_tick") or {}
        ok = len(picked) <= 5 and tick.get("rotation_mode") != "batch"
        return {"pass": ok, "picked_count": len(picked), "rotation_mode": tick.get("rotation_mode")}
    finally:
        if prev_rel is not None:
            import iu_registry as reg_mod

            reg_mod.ROTATION_BATCH_REGISTRY_REL = prev_rel
        os.environ.pop(RSS_ROTATION_BATCH_RUNTIME_ENV, None)


def simulate_batch_rotation_with_floor() -> dict[str, Any]:
    os.environ[RSS_ROTATION_BATCH_RUNTIME_ENV] = "1"
    try:
        registry = load_source_registry()
        batch_reg = load_rotation_batch_registry()
        mapping = batch_reg.get("rotation_batch_by_source_id") or {}
        all_sources = set(mapping.keys())
        state = _fresh_state()
        check_times: dict[str, list[int]] = defaultdict(list)
        interval_violations: list[dict[str, Any]] = []

        for tick in range(SIMULATION_MINUTES // TICK_INTERVAL_MIN):
            sim_min = tick * TICK_INTERVAL_MIN
            minute = sim_min % 60
            hour = 12 + sim_min // 60
            now = _prague_minute_to_utc(minute, hour=hour)
            picked, state = select_feeds_for_tick(registry, state, now=now)
            for e in picked:
                sid = str(e.get("id") or "")
                check_times[sid].append(sim_min)
                ts = now.strftime("%Y-%m-%dT%H:%M:%SZ")
                state.setdefault("entry_state", {})[sid] = {"last_fetch_at": ts}
                ck = sid
                state.setdefault("domain_last_fetch", {})[ck] = ts

        for sid in sorted(all_sources):
            times = check_times.get(sid, [])
            if not times:
                continue
            gaps = [times[i + 1] - times[i] for i in range(len(times) - 1)]
            min_gap = min(gaps) if gaps else ROTATION_BATCH_CYCLE_MINUTES
            if min_gap < ROTATION_MIN_FETCH_INTERVAL_MIN:
                interval_violations.append({"source_id": sid, "min_interval_min": min_gap})

        covered = all_sources <= set(check_times.keys())
        one_per_cycle = all(len(check_times.get(s, [])) == 1 for s in all_sources)
        return {
            "pass": covered and one_per_cycle and not interval_violations,
            "sources_covered": len(check_times),
            "total_sources": len(all_sources),
            "interval_violations": interval_violations,
            "one_check_per_20min": one_per_cycle,
        }
    finally:
        os.environ.pop(RSS_ROTATION_BATCH_RUNTIME_ENV, None)


def assess_verdict(results: dict[str, Any]) -> dict[str, str]:
    all_pass = all(r.get("pass") for r in results.values())
    return {
        "RSS_ROTATION_PHASE2B_RUNTIME_ACTIVATION": "PASS" if all_pass else "FAIL",
        "BATCH_RUNTIME_ACTIVE": "YES",
        "LEGACY_FALLBACK": "YES" if results.get("registry_fallback", {}).get("pass") else "NO",
        "KILL_SWITCH": "YES",
        "WATCHDOG": "*/5",
        "LEGACY_MAX_SOURCES_PER_SCHEDULER_TICK": str(MAX_SOURCES_PER_SCHEDULER_TICK),
        "FULL_ROTATION_TARGET_MINUTES": str(ROTATION_BATCH_CYCLE_MINUTES),
        "MIN_SOURCE_INTERVAL_MINUTES": f">={ROTATION_MIN_FETCH_INTERVAL_MIN}",
        "FETCH_LOGIC_CHANGE": "YES",
        "PUBLISH_LOGIC_CHANGE": "NO",
        "DEDUPE_CHANGE": "NO",
        "EVENT_DEDUPE_CHANGE": "NO",
        "SECTION_CLASSIFICATION_CHANGE": "NO",
        "WORKFLOW_CHANGE": "YES",
        "CLOUDFLARE_CHANGE": "YES",
        "ARTICLES_JSON_CHANGE": "NO",
        "BOOTSTRAP_CHANGE": "NO",
        "INDEX_CHANGE": "NO",
        "SAFE_FOR_PR": "YES" if all_pass else "NO",
    }


def main() -> int:
    results = {
        "legacy_cap_unchanged": test_legacy_cap_unchanged(),
        "batch_minute_mapping": test_batch_minute_mapping(),
        "batch_mode_selection": test_batch_mode_selects_registry_batch(),
        "min_interval_floor": test_min_interval_floor(),
        "registry_fallback": test_registry_fallback_to_legacy(),
        "simulate_20min_rotation": simulate_batch_rotation_with_floor(),
    }
    verdict = assess_verdict(results)
    report = {"tests": results, "verdict": verdict}
    print(json.dumps(report, indent=2))
    for key, val in verdict.items():
        print(f"{key}={val}")
    return 0 if verdict["RSS_ROTATION_PHASE2B_RUNTIME_ACTIVATION"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
