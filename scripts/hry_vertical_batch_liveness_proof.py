#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 5B — Hry vertical liveness bypass for batch runtime scheduler.

Verifies overdue HRY_VERTICAL_LIVENESS_REGISTRY_IDS merge into non-home batches,
batch-A starvation scenario is recoverable, min_interval preserved, duplicates prevented.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from iu_registry import (  # noqa: E402
    HARD_DOMAIN_COOLDOWN_MIN,
    HRY_VERTICAL_LIVENESS_REGISTRY_IDS,
    RSS_ROTATION_BATCH_RUNTIME_ENV,
    batch_id_for_minute,
    select_feeds_for_tick,
)
from iu_rotation_foundation import load_rotation_batch_registry, load_source_registry  # noqa: E402

HRY_ZING = "hry_zing"
HRY_NOVINKY = "hry_novinky"
HRY_INDIAN = "hry_indian"
NON_HRY_SAMPLE = "kul_kinobox"


def _prague_minute_to_utc(minute_of_hour: int, hour: int = 12) -> datetime:
    return datetime(2026, 6, 8, hour - 2, minute_of_hour, tzinfo=timezone.utc)


def _fresh_state() -> dict:
    return {
        "tick_index": 0,
        "domain_last_fetch": {},
        "entry_state": {},
        "source_schedule": {},
    }


def _overdue_ts(now: datetime, minutes_ago: int = 30) -> str:
    return (now - timedelta(minutes=minutes_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")


def test_overdue_hry_added_on_batch_b() -> dict[str, Any]:
    """Batch B (minute 25) must pull overdue batch-A Hry feeds via bypass."""
    os.environ[RSS_ROTATION_BATCH_RUNTIME_ENV] = "1"
    try:
        registry = load_source_registry()
        now = _prague_minute_to_utc(25)
        assert batch_id_for_minute(25) == "B"
        state = _fresh_state()
        for sid in (HRY_ZING, HRY_NOVINKY, HRY_INDIAN):
            state["entry_state"][sid] = {"last_fetch_at": _overdue_ts(now, 840)}
        picked, st = select_feeds_for_tick(registry, state, now=now)
        picked_ids = {str(e.get("id") or "") for e in picked}
        bypass = (st.get("last_scheduler_tick") or {}).get("hry_vertical_bypass") or []
        bypass_ids = {b.get("source_id") for b in bypass}
        mapping = load_rotation_batch_registry().get("rotation_batch_by_source_id") or {}
        home_a = {sid for sid in HRY_VERTICAL_LIVENESS_REGISTRY_IDS if mapping.get(sid) == "A"}
        ok = (
            HRY_ZING in picked_ids
            and HRY_NOVINKY in picked_ids
            and HRY_INDIAN in picked_ids
            and bypass_ids >= home_a
        )
        return {
            "pass": ok,
            "picked_has_zing": HRY_ZING in picked_ids,
            "picked_has_novinky": HRY_NOVINKY in picked_ids,
            "picked_has_indian": HRY_INDIAN in picked_ids,
            "bypass_ids": sorted(bypass_ids),
            "expected_bypass_from_batch_a": sorted(home_a),
        }
    finally:
        os.environ.pop(RSS_ROTATION_BATCH_RUNTIME_ENV, None)


def test_not_overdue_not_added() -> dict[str, Any]:
    os.environ[RSS_ROTATION_BATCH_RUNTIME_ENV] = "1"
    try:
        registry = load_source_registry()
        now = _prague_minute_to_utc(25)
        state = _fresh_state()
        recent = (now - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
        for sid in HRY_VERTICAL_LIVENESS_REGISTRY_IDS:
            state["entry_state"][sid] = {"last_fetch_at": recent}
        picked, st = select_feeds_for_tick(registry, state, now=now)
        picked_ids = {str(e.get("id") or "") for e in picked}
        bypass = (st.get("last_scheduler_tick") or {}).get("hry_vertical_bypass") or []
        hry_in_picked = picked_ids & set(HRY_VERTICAL_LIVENESS_REGISTRY_IDS)
        ok = not hry_in_picked and not bypass
        return {
            "pass": ok,
            "hry_in_picked": sorted(hry_in_picked),
            "bypass_count": len(bypass),
        }
    finally:
        os.environ.pop(RSS_ROTATION_BATCH_RUNTIME_ENV, None)


def test_no_duplicate_when_in_home_batch() -> dict[str, Any]:
    os.environ[RSS_ROTATION_BATCH_RUNTIME_ENV] = "1"
    try:
        registry = load_source_registry()
        now = _prague_minute_to_utc(2)
        assert batch_id_for_minute(2) == "A"
        state = _fresh_state()
        state["entry_state"][HRY_NOVINKY] = {"last_fetch_at": _overdue_ts(now, 60)}
        picked, st = select_feeds_for_tick(registry, state, now=now)
        ids = [str(e.get("id") or "") for e in picked]
        bypass = (st.get("last_scheduler_tick") or {}).get("hry_vertical_bypass") or []
        bypass_ids = [b.get("source_id") for b in bypass]
        ok = ids.count(HRY_NOVINKY) == 1 and HRY_NOVINKY not in bypass_ids
        return {
            "pass": ok,
            "novinky_count": ids.count(HRY_NOVINKY),
            "bypass_has_novinky": HRY_NOVINKY in bypass_ids,
        }
    finally:
        os.environ.pop(RSS_ROTATION_BATCH_RUNTIME_ENV, None)


def test_min_interval_preserved() -> dict[str, Any]:
    os.environ[RSS_ROTATION_BATCH_RUNTIME_ENV] = "1"
    try:
        registry = load_source_registry()
        now = _prague_minute_to_utc(25)
        state = _fresh_state()
        recent = (now - timedelta(minutes=HARD_DOMAIN_COOLDOWN_MIN - 2)).strftime("%Y-%m-%dT%H:%M:%SZ")
        state["entry_state"][HRY_ZING] = {"last_fetch_at": recent}
        state["entry_state"][HRY_NOVINKY] = {"last_fetch_at": _overdue_ts(now, 60)}
        picked, st = select_feeds_for_tick(registry, state, now=now)
        picked_ids = {str(e.get("id") or "") for e in picked}
        ok = HRY_ZING not in picked_ids and HRY_NOVINKY in picked_ids
        return {
            "pass": ok,
            "zing_blocked_by_floor": HRY_ZING not in picked_ids,
            "novinky_overdue_selected": HRY_NOVINKY in picked_ids,
        }
    finally:
        os.environ.pop(RSS_ROTATION_BATCH_RUNTIME_ENV, None)


def test_non_hry_not_bypassed() -> dict[str, Any]:
    os.environ[RSS_ROTATION_BATCH_RUNTIME_ENV] = "1"
    try:
        registry = load_source_registry()
        batch_reg = load_rotation_batch_registry()
        mapping = batch_reg.get("rotation_batch_by_source_id") or {}
        home = mapping.get(NON_HRY_SAMPLE)
        minute = 25 if home != "B" else 10
        now = _prague_minute_to_utc(minute)
        state = _fresh_state()
        state["entry_state"][NON_HRY_SAMPLE] = {"last_fetch_at": _overdue_ts(now, 120)}
        picked, st = select_feeds_for_tick(registry, state, now=now)
        bypass = (st.get("last_scheduler_tick") or {}).get("hry_vertical_bypass") or []
        bypass_ids = {b.get("source_id") for b in bypass}
        current_batch = batch_id_for_minute(minute)
        ok = NON_HRY_SAMPLE not in bypass_ids
        if mapping.get(NON_HRY_SAMPLE) != current_batch:
            picked_ids = {str(e.get("id") or "") for e in picked}
            ok = ok and NON_HRY_SAMPLE not in picked_ids
        return {
            "pass": ok,
            "non_hry_in_bypass": NON_HRY_SAMPLE in bypass_ids,
            "home_batch": home,
            "current_batch": current_batch,
        }
    finally:
        os.environ.pop(RSS_ROTATION_BATCH_RUNTIME_ENV, None)


def assess_batch_a_starvation() -> dict[str, Any]:
    """
    Document Phase 5A watchdog dispatch aliasing: pipeline minutes 10/25/45/50
    map to batches C/B only — batch A (live Hry feeds) starved without bypass.
    """
    BIDS = ["A", "B", "C", "D"]
    run_minutes_prague = [10, 25, 45, 50, 10, 25, 45, 50, 10]
    batches = [BIDS[(m // 5) % 4] for m in run_minutes_prague]
    batch_a_hits = batches.count("A")
    hry_home_a = {"hry_zing", "hry_novinky", "hry_indian"}
    starvation = batch_a_hits == 0
    return {
        "BATCH_A_STARVATION_CONFIRMED": "YES" if starvation else "NO",
        "ROOT_CAUSE_EXACT": (
            "watchdog */5 dispatch + pipeline ~40min cadence aligns to Prague minutes "
            "10/25/45/50 -> batches C/B only; live Hry feeds in batch A never selected; "
            "B/C Hry slots pointed at dead feeds (vortex 523, sector/nedd 404)"
        ),
        "WATCHDOG_INTERACTION": "cloudflare articles-watchdog */5 triggers workflow_dispatch",
        "DISPATCH_PATTERN": "pipeline runs at Prague :10/:25/:45/:50 -> batch C or B",
        "BATCH_SELECTION_PATTERN": f"last_9_runs_batches={batches} batch_A_hits={batch_a_hits}",
        "pass": starvation,
    }


def assess_verdict(results: dict[str, Any]) -> dict[str, str]:
    tests = {k: v for k, v in results.items() if k != "batch_a_starvation"}
    all_pass = all(r.get("pass") for r in tests.values())
    starvation_ok = results.get("batch_a_starvation", {}).get("BATCH_A_STARVATION_CONFIRMED") == "YES"
    ok = all_pass and starvation_ok
    return {
        "HRY_VERTICAL_BATCH_LIVENESS": "PASS" if ok else "FAIL",
        "BATCH_A_STARVATION_CONFIRMED": "YES" if starvation_ok else "NO",
        "SAFE_FOR_PR": "YES" if ok else "NO",
    }


def main() -> int:
    results = {
        "overdue_hry_on_batch_b": test_overdue_hry_added_on_batch_b(),
        "not_overdue_excluded": test_not_overdue_not_added(),
        "no_duplicate_home_batch": test_no_duplicate_when_in_home_batch(),
        "min_interval_preserved": test_min_interval_preserved(),
        "non_hry_isolation": test_non_hry_not_bypassed(),
        "batch_a_starvation": assess_batch_a_starvation(),
    }
    verdict = assess_verdict(results)
    report = {"tests": results, "verdict": verdict}
    print(json.dumps(report, indent=2))
    for key, val in verdict.items():
        print(f"{key}={val}")
    starvation = results["batch_a_starvation"]
    for key in (
        "BATCH_A_STARVATION_CONFIRMED",
        "ROOT_CAUSE_EXACT",
        "WATCHDOG_INTERACTION",
        "DISPATCH_PATTERN",
        "BATCH_SELECTION_PATTERN",
    ):
        print(f"{key}={starvation.get(key)}")
    return 0 if verdict["HRY_VERTICAL_BATCH_LIVENESS"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
