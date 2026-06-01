#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P0 freshness overdue picks when pipeline minute misses fixed slot."""
from __future__ import annotations

import unittest
from datetime import datetime, timezone, timedelta

from iu_registry import (
    P0_FRESHNESS_SLOT_KEYS,
    P0_HEADLINE_REGISTRY_IDS,
    entry_fixed_slot_key,
    select_feeds_for_tick,
)


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


class P0FreshnessOverdueTest(unittest.TestCase):
    def test_p0_overdue_when_minute_not_in_slot(self):
        registry = {
            "entries": [
                _entry("nov_main", "https://www.novinky.cz/rss", "novinky.cz", "Novinky.cz"),
                _entry("sport_main", "https://www.sport.cz/rss/", "sport.cz", "Sport.cz"),
            ],
            "sources_per_tick": {"max_unmapped_per_tick": 0},
        }
        state = {"tick_index": 0, "domain_last_fetch": {}, "entry_state": {}}
        # Prague 2026-06-01 08:17 → minute 17 (not in novinky slots {0,15,30,45})
        now = datetime(2026, 6, 1, 6, 17, tzinfo=timezone.utc)  # 08:17 CEST
        picked, _ = select_feeds_for_tick(registry, state, now=now)
        keys = {entry_fixed_slot_key(e) for e in picked}
        self.assertIn("novinky.cz", keys)
        self.assertIn("sport.cz", keys)
        self.assertTrue(keys & P0_FRESHNESS_SLOT_KEYS)

    def test_p0_headline_domaci_even_when_interval_not_due(self):
        registry = {
            "entries": [
                _entry(
                    "zpr_novinky_domaci",
                    "https://www.novinky.cz/rss/domaci",
                    "novinky.cz",
                    "Novinky / Domácí",
                ),
                _entry(
                    "ved_novinky",
                    "https://www.novinky.cz/rss/veda",
                    "novinky.cz",
                    "Novinky / Věda",
                ),
            ],
            "sources_per_tick": {"max_unmapped_per_tick": 0},
        }
        recent = (datetime.now(timezone.utc) - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
        state = {
            "tick_index": 0,
            "domain_last_fetch": {},
            "entry_state": {
                "zpr_novinky_domaci": {"last_fetch_at": recent},
                "ved_novinky": {"last_fetch_at": recent},
            },
        }
        now = datetime(2026, 6, 1, 6, 17, tzinfo=timezone.utc)
        picked, _ = select_feeds_for_tick(registry, state, now=now)
        urls = [e.get("feed_url") for e in picked]
        self.assertIn("https://www.novinky.cz/rss/domaci", urls)
        self.assertNotIn("https://www.novinky.cz/rss/veda", urls)
        self.assertIn("zpr_novinky_domaci", P0_HEADLINE_REGISTRY_IDS)

    def test_p0_skipped_when_recently_fetched(self):
        registry = {
            "entries": [
                _entry("nov_main", "https://www.novinky.cz/rss", "novinky.cz", "Novinky.cz"),
            ],
            "sources_per_tick": {"max_unmapped_per_tick": 0},
        }
        recent = (datetime.now(timezone.utc) - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
        state = {
            "tick_index": 0,
            "domain_last_fetch": {"novinky.cz": recent},
            "entry_state": {"nov_main": {"last_fetch_at": recent}},
        }
        now = datetime(2026, 6, 1, 6, 17, tzinfo=timezone.utc)
        picked, _ = select_feeds_for_tick(registry, state, now=now)
        urls = [e.get("feed_url") for e in picked]
        self.assertNotIn("https://www.novinky.cz/rss", urls)


if __name__ == "__main__":
    unittest.main()
