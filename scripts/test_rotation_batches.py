#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""RSS rotation batch registry validation tests (Phase 1 foundation only)."""
from __future__ import annotations

import os
import sys
import unittest

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from iu_registry import MAX_SOURCES_PER_SCHEDULER_TICK, load_scheduler_state, select_feeds_for_tick  # noqa: E402
from iu_rotation_foundation import (  # noqa: E402
    ROTATION_BATCH_IDS,
    ROTATION_MIN_FETCH_INTERVAL_MIN,
    SourceStrength,
    build_rotation_batch_registry,
    classify_source_strength,
    ensure_source_rotation_row,
    load_rotation_batch_registry,
    load_source_registry,
    normalize_scheduler_rotation_schema,
    registry_active_entries,
    validate_rotation_batch_registry,
)
from datetime import datetime, timezone, timedelta


def _entry(eid: str, url: str, domain: str = "example.cz", weight: float = 0.9) -> dict:
    return {
        "id": eid,
        "feed_url": url,
        "domain": domain,
        "label": eid,
        "active": True,
        "blocked": False,
        "interval_min": 40,
        "display_weight": weight,
        "per_domain_cooldown_min": 15,
    }


class RotationBatchRegistryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.registry = load_source_registry()
        cls.active = registry_active_entries(cls.registry)
        cls.active_ids = {str(e.get("id") or "") for e in cls.active}
        cls.batch_reg = load_rotation_batch_registry()

    def test_batch_registry_valid(self):
        errors = validate_rotation_batch_registry(self.batch_reg, self.active_ids)
        self.assertEqual(errors, [], msg="; ".join(errors))

    def test_all_batches_present(self):
        batches = self.batch_reg.get("batches") or {}
        for bid in ROTATION_BATCH_IDS:
            self.assertIn(bid, batches)

    def test_each_source_in_exactly_one_batch(self):
        mapping = self.batch_reg.get("rotation_batch_by_source_id") or {}
        reverse: dict[str, list[str]] = {b: [] for b in ROTATION_BATCH_IDS}
        for sid, bid in mapping.items():
            self.assertIn(bid, ROTATION_BATCH_IDS)
            reverse[bid].append(sid)
        for bid in ROTATION_BATCH_IDS:
            batch_ids = set((self.batch_reg["batches"][bid] or {}).get("source_ids") or [])
            self.assertEqual(set(reverse[bid]), batch_ids)

    def test_no_duplicate_assignments(self):
        mapping = self.batch_reg.get("rotation_batch_by_source_id") or {}
        self.assertEqual(len(mapping), len(set(mapping.keys())))

    def test_all_active_sources_assigned(self):
        mapping = self.batch_reg.get("rotation_batch_by_source_id") or {}
        unassigned = sorted(self.active_ids - set(mapping.keys()))
        self.assertEqual(unassigned, [])

    def test_no_inactive_sources_assigned(self):
        mapping = self.batch_reg.get("rotation_batch_by_source_id") or {}
        extra = sorted(set(mapping.keys()) - self.active_ids)
        self.assertEqual(extra, [])

    def test_batch_balance_near_target(self):
        batches = self.batch_reg.get("batches") or {}
        counts = [len((batches[b].get("source_ids") or [])) for b in ROTATION_BATCH_IDS]
        self.assertEqual(sum(counts), len(self.active_ids))
        self.assertTrue(all(14 <= c <= 16 for c in counts))

    def test_source_strength_enum_values(self):
        meta = self.batch_reg.get("source_metadata_by_id") or {}
        allowed = {s.value for s in SourceStrength}
        for sid, row in meta.items():
            self.assertIn(row.get("source_strength"), allowed, msg=sid)

    def test_min_fetch_interval_floor_15min(self):
        self.assertEqual(ROTATION_MIN_FETCH_INTERVAL_MIN, 15)

    def test_build_rotation_batch_registry_is_deterministic(self):
        a = build_rotation_batch_registry(self.registry)
        b = build_rotation_batch_registry(self.registry)
        self.assertEqual(
            a.get("rotation_batch_by_source_id"),
            b.get("rotation_batch_by_source_id"),
        )


class SchedulerRotationSchemaTests(unittest.TestCase):
    def test_normalize_scheduler_rotation_schema_defaults(self):
        state = normalize_scheduler_rotation_schema({"tick_index": 3})
        rf = state["rotation_foundation"]
        self.assertIn("by_source_id", rf)
        self.assertIsNone(rf.get("current_batch_index"))

    def test_source_rotation_row_schema(self):
        row = ensure_source_rotation_row({})
        for key in ("batch_id", "source_weight", "source_strength", "estimated_rss_load", "last_rotation_assignment"):
            self.assertIn(key, row)

    def test_load_scheduler_state_includes_rotation_foundation(self):
        import tempfile

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as tf:
            tf.write('{"tick_index": 1, "domain_last_fetch": {}, "entry_state": {}, "source_schedule": {}}')
            path = tf.name
        try:
            state = load_scheduler_state(path)
            self.assertIn("rotation_foundation", state)
            self.assertIn("by_source_id", state["rotation_foundation"])
        finally:
            os.unlink(path)


class ProductionBehaviorUnchangedTests(unittest.TestCase):
    def test_max_sources_per_scheduler_tick_unchanged(self):
        self.assertEqual(MAX_SOURCES_PER_SCHEDULER_TICK, 5)

    def test_select_feeds_for_tick_unchanged_with_foundation_state(self):
        now = datetime(2026, 6, 6, 10, 0, tzinfo=timezone.utc)
        entries = [
            _entry("a", "https://www.novinky.cz/rss", "novinky.cz", 1.15),
            _entry("b", "https://www.seznamzpravy.cz/rss", "seznamzpravy.cz", 1.15),
            _entry("c", "https://sport.cz/rss", "sport.cz", 1.1),
        ]
        registry = {"entries": entries, "sources_per_tick": {"max_unmapped_per_tick": 2}}
        base_state = {
            "tick_index": 0,
            "domain_last_fetch": {},
            "entry_state": {},
            "source_schedule": {},
        }
        with_foundation = normalize_scheduler_rotation_schema(dict(base_state))
        picked_base, _ = select_feeds_for_tick(registry, base_state, now=now)
        picked_rf, _ = select_feeds_for_tick(registry, with_foundation, now=now)
        self.assertEqual([e.get("id") for e in picked_base], [e.get("id") for e in picked_rf])

    def test_classify_source_strength_returns_enum(self):
        e = _entry("zpr_novinky_domaci", "https://www.novinky.cz/rss", "novinky.cz", 1.15)
        self.assertEqual(classify_source_strength(e), SourceStrength.STRONG)


if __name__ == "__main__":
    unittest.main()
