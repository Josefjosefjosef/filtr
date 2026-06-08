#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 4C — P0 headline liveness bypass for batch runtime scheduler.

Verifies overdue P0_HEADLINE_REGISTRY_IDS are merged into non-home batches,
min_interval is preserved, duplicates prevented, and non-P0 feeds stay batch-isolated.
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
    P0_HEADLINE_REGISTRY_IDS,
    RSS_ROTATION_BATCH_RUNTIME_ENV,
    batch_id_for_minute,
    select_feeds_for_tick,
)
from iu_rotation_foundation import load_rotation_batch_registry, load_source_registry  # noqa: E402

IDNES_ID = "zpr_idnes_zpravy"
SPORT_ID = "spt_sportcz"
NON_P0_SAMPLE = "fin_hn"


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


def test_overdue_p0_added_on_batch_a() -> dict[str, Any]:
    os.environ[RSS_ROTATION_BATCH_RUNTIME_ENV] = "1"
    try:
        registry = load_source_registry()
        batch_reg = load_rotation_batch_registry()
        now = _prague_minute_to_utc(2)
        assert batch_id_for_minute(2) == "A"
        state = _fresh_state()
        for sid in (IDNES_ID, SPORT_ID):
            state["entry_state"][sid] = {"last_fetch_at": _overdue_ts(now, 840)}
        picked, st = select_feeds_for_tick(registry, state, now=now)
        picked_ids = {str(e.get("id") or "") for e in picked}
        bypass = (st.get("last_scheduler_tick") or {}).get("p0_headline_bypass") or []
        bypass_ids = {b.get("source_id") for b in bypass}
        batch_a_ids = set((batch_reg["batches"]["A"].get("source_ids") or []))
        ok = (
            IDNES_ID in picked_ids
            and SPORT_ID in picked_ids
            and bypass_ids >= {IDNES_ID, SPORT_ID}
            and picked_ids >= batch_a_ids
        )
        return {
            "pass": ok,
            "picked_has_idnes": IDNES_ID in picked_ids,
            "picked_has_sport": SPORT_ID in picked_ids,
            "bypass_ids": sorted(bypass_ids),
        }
    finally:
        os.environ.pop(RSS_ROTATION_BATCH_RUNTIME_ENV, None)


def test_not_overdue_not_added() -> dict[str, Any]:
    os.environ[RSS_ROTATION_BATCH_RUNTIME_ENV] = "1"
    try:
        registry = load_source_registry()
        now = _prague_minute_to_utc(2)
        state = _fresh_state()
        recent = (now - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
        for sid in (IDNES_ID, SPORT_ID):
            state["entry_state"][sid] = {"last_fetch_at": recent}
        picked, st = select_feeds_for_tick(registry, state, now=now)
        picked_ids = {str(e.get("id") or "") for e in picked}
        bypass = (st.get("last_scheduler_tick") or {}).get("p0_headline_bypass") or []
        ok = IDNES_ID not in picked_ids and SPORT_ID not in picked_ids and not bypass
        return {
            "pass": ok,
            "picked_has_idnes": IDNES_ID in picked_ids,
            "picked_has_sport": SPORT_ID in picked_ids,
            "bypass_count": len(bypass),
        }
    finally:
        os.environ.pop(RSS_ROTATION_BATCH_RUNTIME_ENV, None)


def test_no_duplicate_when_in_home_batch() -> dict[str, Any]:
    os.environ[RSS_ROTATION_BATCH_RUNTIME_ENV] = "1"
    try:
        registry = load_source_registry()
        now = _prague_minute_to_utc(10)
        assert batch_id_for_minute(10) == "C"
        state = _fresh_state()
        state["entry_state"][IDNES_ID] = {"last_fetch_at": _overdue_ts(now, 60)}
        picked, st = select_feeds_for_tick(registry, state, now=now)
        ids = [str(e.get("id") or "") for e in picked]
        bypass = (st.get("last_scheduler_tick") or {}).get("p0_headline_bypass") or []
        bypass_ids = [b.get("source_id") for b in bypass]
        ok = ids.count(IDNES_ID) == 1 and IDNES_ID not in bypass_ids
        return {
            "pass": ok,
            "idnes_count": ids.count(IDNES_ID),
            "bypass_has_idnes": IDNES_ID in bypass_ids,
        }
    finally:
        os.environ.pop(RSS_ROTATION_BATCH_RUNTIME_ENV, None)


def test_min_interval_preserved() -> dict[str, Any]:
    os.environ[RSS_ROTATION_BATCH_RUNTIME_ENV] = "1"
    try:
        registry = load_source_registry()
        now = _prague_minute_to_utc(2)
        state = _fresh_state()
        recent = (now - timedelta(minutes=HARD_DOMAIN_COOLDOWN_MIN - 2)).strftime("%Y-%m-%dT%H:%M:%SZ")
        state["entry_state"][IDNES_ID] = {"last_fetch_at": recent}
        state["entry_state"][SPORT_ID] = {"last_fetch_at": _overdue_ts(now, 60)}
        picked, st = select_feeds_for_tick(registry, state, now=now)
        picked_ids = {str(e.get("id") or "") for e in picked}
        ok = IDNES_ID not in picked_ids and SPORT_ID in picked_ids
        return {
            "pass": ok,
            "idnes_blocked_by_floor": IDNES_ID not in picked_ids,
            "sport_overdue_selected": SPORT_ID in picked_ids,
        }
    finally:
        os.environ.pop(RSS_ROTATION_BATCH_RUNTIME_ENV, None)


def test_non_p0_not_bypassed() -> dict[str, Any]:
    os.environ[RSS_ROTATION_BATCH_RUNTIME_ENV] = "1"
    try:
        registry = load_source_registry()
        batch_reg = load_rotation_batch_registry()
        mapping = batch_reg.get("rotation_batch_by_source_id") or {}
        home = mapping.get(NON_P0_SAMPLE)
        if home == "A":
            minute = 5
        else:
            minute = 2
        now = _prague_minute_to_utc(minute)
        state = _fresh_state()
        state["entry_state"][NON_P0_SAMPLE] = {"last_fetch_at": _overdue_ts(now, 120)}
        picked, st = select_feeds_for_tick(registry, state, now=now)
        picked_ids = {str(e.get("id") or "") for e in picked}
        bypass = (st.get("last_scheduler_tick") or {}).get("p0_headline_bypass") or []
        bypass_ids = {b.get("source_id") for b in bypass}
        current_batch = batch_id_for_minute(minute)
        ok = NON_P0_SAMPLE not in bypass_ids
        if mapping.get(NON_P0_SAMPLE) != current_batch:
            ok = ok and NON_P0_SAMPLE not in picked_ids
        return {
            "pass": ok,
            "non_p0_in_picked": NON_P0_SAMPLE in picked_ids,
            "non_p0_in_bypass": NON_P0_SAMPLE in bypass_ids,
            "home_batch": home,
            "current_batch": current_batch,
        }
    finally:
        os.environ.pop(RSS_ROTATION_BATCH_RUNTIME_ENV, None)


def assess_verdict(results: dict[str, Any]) -> dict[str, str]:
    all_pass = all(r.get("pass") for r in results.values())
    return {
        "P0_HEADLINE_BATCH_LIVENESS": "PASS" if all_pass else "FAIL",
        "SAFE_FOR_PR": "YES" if all_pass else "NO",
    }


def main() -> int:
    results = {
        "overdue_p0_on_batch_a": test_overdue_p0_added_on_batch_a(),
        "not_overdue_excluded": test_not_overdue_not_added(),
        "no_duplicate_home_batch": test_no_duplicate_when_in_home_batch(),
        "min_interval_preserved": test_min_interval_preserved(),
        "non_p0_isolation": test_non_p0_not_bypassed(),
    }
    verdict = assess_verdict(results)
    report = {"tests": results, "verdict": verdict}
    print(json.dumps(report, indent=2))
    for key, val in verdict.items():
        print(f"{key}={val}")
    return 0 if verdict["P0_HEADLINE_BATCH_LIVENESS"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
