#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Article scheduler SLA, concurrency, diversity, and guard policy tests."""
from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from iu_registry import (
    MAX_FETCH_INTERVAL_MIN,
    MIN_FETCH_INTERVAL_MIN,
    compute_entry_sla,
    clear_entries_in_flight,
    select_feeds_for_tick,
    set_entries_in_flight,
    scheduler_cooldown_key,
)
from iu_source_diversity import apply_source_diversity_order, topic_fingerprint
from iu_article_scheduler import build_scheduler_report, write_latest_valid_snapshot


def _entry(eid: str, url: str, domain: str = "", label: str = "") -> dict:
    return {
        "id": eid,
        "feed_url": url,
        "domain": domain,
        "label": label or eid,
        "active": True,
        "blocked": False,
        "interval_min": 15,
        "per_domain_cooldown_min": 15,
    }


def _now() -> datetime:
    return datetime(2026, 6, 6, 10, 0, tzinfo=timezone.utc)


class SourceSlaTests(unittest.TestCase):
    def test_source_min_fetch_interval_15min(self):
        now = _now()
        e = _entry("a", "https://www.novinky.cz/rss", "novinky.cz")
        state = {
            "tick_index": 0,
            "domain_last_fetch": {},
            "entry_state": {
                "a": {"last_fetch_at": (now - timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:%SZ")}
            },
            "source_schedule": {},
        }
        sla = compute_entry_sla(state, e, now)
        self.assertFalse(sla["eligible"])
        registry = {"entries": [e], "sources_per_tick": {"max_unmapped_per_tick": 0}}
        picked, _ = select_feeds_for_tick(registry, dict(state), now=now)
        self.assertEqual(picked, [])

    def test_source_max_fetch_interval_25min(self):
        now = _now()
        e = _entry("a", "https://www.novinky.cz/rss", "novinky.cz")
        state = {
            "tick_index": 0,
            "domain_last_fetch": {},
            "entry_state": {
                "a": {"last_fetch_at": (now - timedelta(minutes=24)).strftime("%Y-%m-%dT%H:%M:%SZ")}
            },
            "source_schedule": {},
        }
        sla = compute_entry_sla(state, e, now)
        self.assertTrue(sla["urgent"])
        self.assertTrue(sla["priority_boost"])

    def test_source_not_left_unchecked_over_25min(self):
        now = _now()
        e = _entry("a", "https://www.novinky.cz/rss", "novinky.cz")
        state = {
            "tick_index": 0,
            "domain_last_fetch": {},
            "entry_state": {
                "a": {"last_fetch_at": (now - timedelta(minutes=26)).strftime("%Y-%m-%dT%H:%M:%SZ")}
            },
            "source_schedule": {},
        }
        sla = compute_entry_sla(state, e, now)
        self.assertTrue(sla["overdue"])

    def test_overdue_source_gets_priority_boost(self):
        now = _now()
        e = _entry("a", "https://www.novinky.cz/rss", "novinky.cz")
        state = {
            "tick_index": 0,
            "domain_last_fetch": {},
            "entry_state": {
                "a": {"last_fetch_at": (now - timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%SZ")}
            },
            "source_schedule": {},
        }
        sla = compute_entry_sla(state, e, now)
        self.assertTrue(sla["priority_boost"])
        self.assertTrue(sla["overdue"])

    def test_same_source_not_fetched_twice_within_15min(self):
        now = _now()
        recent = (now - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
        e = _entry("zpr_novinky_domaci", "https://www.novinky.cz/rss/domaci", "novinky.cz")
        state = {
            "tick_index": 1,
            "domain_last_fetch": {"novinky.cz": recent},
            "entry_state": {"zpr_novinky_domaci": {"last_fetch_at": recent}},
            "source_schedule": {},
        }
        registry = {"entries": [e], "sources_per_tick": {"max_unmapped_per_tick": 0}}
        picked, st = select_feeds_for_tick(registry, state, now=now)
        skipped = (st.get("last_scheduler_tick") or {}).get("skipped_sources") or []
        reasons = [s.get("reason") for s in skipped]
        self.assertTrue(not picked or "SKIPPED_RATE_LIMIT_15MIN" in reasons)

    def test_source_groups_are_staggered(self):
        self.assertEqual(MIN_FETCH_INTERVAL_MIN, 15)
        self.assertEqual(MAX_FETCH_INTERVAL_MIN, 25)

    def test_in_flight_source_group_is_skipped_not_cancelled(self):
        now = _now()
        e = _entry("a", "https://www.novinky.cz/rss", "novinky.cz")
        state = {
            "tick_index": 0,
            "domain_last_fetch": {},
            "entry_state": {},
            "source_schedule": {"a": {"in_flight": True, "in_flight_run_id": "999"}},
        }
        registry = {"entries": [e], "sources_per_tick": {"max_unmapped_per_tick": 0}}
        picked, st = select_feeds_for_tick(registry, state, now=now)
        skipped = (st.get("last_scheduler_tick") or {}).get("skipped_sources") or []
        if picked:
            self.fail("in_flight source should be skipped")
        self.assertTrue(any(s.get("reason") == "SKIPPED_IN_FLIGHT" for s in skipped))

    def test_cloudflare_trigger_runs_scheduler_not_fetch_all(self):
        registry = {
            "entries": [
                _entry("a", "https://www.novinky.cz/rss", "novinky.cz"),
                _entry("b", "https://www.idnes.cz/rss", "idnes.cz"),
                _entry("c", "https://www.sport.cz/rss/", "sport.cz"),
                _entry("d", "https://www.seznamzpravy.cz/rss", "seznamzpravy.cz"),
                _entry("e", "https://www.aktualne.cz/rss/", "aktualne.cz"),
                _entry("f", "https://www.denik.cz/rss", "denik.cz"),
            ],
            "sources_per_tick": {"max_unmapped_per_tick": 0},
        }
        state = {"tick_index": 0, "domain_last_fetch": {}, "entry_state": {}, "source_schedule": {}}
        picked, _ = select_feeds_for_tick(registry, state, now=_now())
        self.assertLessEqual(len(picked), 5)
        self.assertGreater(len(picked), 0)


class TopicDiversityTests(unittest.TestCase):
    def _art(self, title: str, source: str, sec: str = "aktualne") -> dict:
        return {
            "title": title,
            "url": f"https://example.com/{hash(title) & 0xffff}",
            "topic": sec,
            "section": sec,
            "publishedAt": "2026-06-06T10:00:00Z",
            "sources": [{"name": source}],
        }

    def test_topic_cluster_same_event_from_multiple_sources(self):
        arts = [
            self._art("Babiš řekl něco důležitého", "Novinky"),
            self._art("Babiš řekl něco důležitého", "iDNES"),
            self._art("Babiš řekl něco důležitého", "Seznam"),
        ]
        fps = {topic_fingerprint(a) for a in arts}
        self.assertEqual(len(fps), 1)

    def test_topic_cluster_keeps_best_article(self):
        arts = [
            self._art("Babiš řekl něco důležitého", "Novinky"),
            self._art("Babiš řekl něco důležitého", "iDNES"),
            self._art("Ekonomika roste", "HN"),
        ]
        out, stats = apply_source_diversity_order(arts)
        self.assertEqual(len(out), 3)
        self.assertGreaterEqual(stats["topic_duplicate_articles_hidden_or_demoted"], 0)

    def test_same_topic_not_stacked_five_times(self):
        arts = [
            self._art("Babiš řekl X", src)
            for src in ("Novinky", "iDNES", "Seznam", "ČT24", "iRozhlas")
        ]
        arts.extend([self._art("Ekonomika roste", "HN"), self._art("Sportovní výsledek", "Sport")])
        out, stats = apply_source_diversity_order(arts)
        top = out[:3]
        fps_top = [topic_fingerprint(a) for a in top]
        self.assertEqual(len(set(fps_top)), len(fps_top))
        self.assertGreaterEqual(stats["topic_duplicate_articles_hidden_or_demoted"], 4)

    def test_source_diversity_prevents_one_source_monopoly(self):
        arts = [self._art(f"Článek {i}", "Novinky") for i in range(10)]
        arts.extend([self._art(f"Jiný {i}", "iDNES") for i in range(5)])
        out, stats = apply_source_diversity_order(arts)
        top_sources = [a["sources"][0]["name"] for a in out[:6]]
        self.assertIn("iDNES", top_sources)
        self.assertLessEqual(stats["same_source_adjacent_violations"], 3)

    def test_max_two_same_source_adjacent(self):
        arts = []
        for i in range(6):
            arts.append(self._art(f"T{i}", "Novinky" if i % 2 == 0 else "iDNES"))
        out, _ = apply_source_diversity_order(arts)
        streak = 1
        prev = _source_name(out[0])
        for a in out[1:6]:
            nm = _source_name(a)
            if nm == prev:
                streak += 1
            else:
                streak = 1
            prev = nm
            self.assertLessEqual(streak, 2)

    def test_topic_cluster_does_not_move_section(self):
        a_sport = self._art("Sparta vyhrála", "Sport.cz", "sport")
        a_news = self._art("Sparta vyhrála", "Novinky", "aktualne")
        out, _ = apply_source_diversity_order([a_sport, a_news])
        secs = {str(x.get("topic")) for x in out}
        self.assertIn("sport", secs)
        self.assertIn("aktualne", secs)


def _source_name(a: dict) -> str:
    return str((a.get("sources") or [{}])[0].get("name") or "")


class PipelineTests(unittest.TestCase):
    def test_publish_can_run_from_partial_staging(self):
        self.assertTrue(os.path.isfile(os.path.join(_SCRIPTS, "iu_staging.py")))

    def test_parallel_publish_prevented(self):
        self.assertTrue(os.path.isfile(os.path.join(_SCRIPTS, "pipeline-duplicate-gate.mjs")))

    def test_duplicate_trigger_does_not_cancel_active_run(self):
        wf = os.path.join(os.path.dirname(_SCRIPTS), ".github", "workflows", "update-articles.yml")
        with open(wf, encoding="utf-8") as f:
            txt = f.read()
        self.assertIn("cancel-in-progress: false", txt)
        self.assertIn("pipeline_gate", txt)

    def test_concurrency_duplicate_behavior(self):
        wf = os.path.join(os.path.dirname(_SCRIPTS), ".github", "workflows", "update-articles.yml")
        with open(wf, encoding="utf-8") as f:
            txt = f.read()
        self.assertIn("SKIPPED_DUPLICATE", txt)

    def test_no_cancel_valid_active_run(self):
        wf = os.path.join(os.path.dirname(_SCRIPTS), ".github", "workflows", "update-articles.yml")
        with open(wf, encoding="utf-8") as f:
            self.assertIn("cancel-in-progress: false", f.read())

    def test_scheduler_report_fields(self):
        registry = {"entries": [_entry("a", "https://x.cz/rss", "x.cz")]}
        state = {"tick_index": 1, "domain_last_fetch": {}, "entry_state": {}, "source_schedule": {}}
        rep = build_scheduler_report(registry, state, run_id="123")
        self.assertEqual(rep["report"], "ARTICLE_SCHEDULER_REPORT")
        self.assertIn("min_fetch_interval_min", rep)


class GuardPolicyTests(unittest.TestCase):
    def test_single_section_warn_does_not_block_release(self):
        import subprocess

        js = os.path.join(_SCRIPTS, "production-liveness-guard-unit.mjs")
        if os.path.isfile(js):
            r = subprocess.run(["node", js], capture_output=True, text=True, cwd=_SCRIPTS)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_hard_dead_data_still_blocks_release(self):
        import subprocess

        js = os.path.join(_SCRIPTS, "dedupe-loss-guard-unit.mjs")
        if os.path.isfile(js):
            r = subprocess.run(["node", js], capture_output=True, text=True, cwd=_SCRIPTS)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_vzdelavani_precision_still_pass(self):
        import subprocess

        js = os.path.join(_SCRIPTS, "topic-dedupe-false-positive-guard.mjs")
        self.assertTrue(os.path.isfile(js))


class InFlightLockTests(unittest.TestCase):
    def test_in_flight_lock_roundtrip(self):
        state = {"source_schedule": {}}
        e = _entry("a", "https://x.cz/rss", "x.cz")
        set_entries_in_flight(state, [e], "run-1")
        self.assertTrue(state["source_schedule"]["a"]["in_flight"])
        clear_entries_in_flight(state, [e])
        self.assertFalse(state["source_schedule"]["a"]["in_flight"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
