#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Native Zdraví feed liveness slot in select_feeds_for_tick."""
from __future__ import annotations

import unittest
from datetime import datetime, timezone, timedelta

from iu_registry import (
    NATIVE_ZDRAVI_LIVENESS_FEED_IDS,
    P0_FRESHNESS_SLOT_KEYS,
    P0_HEADLINE_REGISTRY_IDS,
    entry_fixed_slot_key,
    is_native_zdravi_liveness_feed,
    select_feeds_for_tick,
)


def _entry(
    eid: str,
    url: str,
    domain: str = "",
    label: str = "",
    *,
    topic: str = "aktualne",
    entry_type: str = "rss",
) -> dict:
    return {
        "id": eid,
        "feed_url": url,
        "domain": domain,
        "label": label or eid,
        "active": True,
        "blocked": False,
        "interval_min": 15,
        "per_domain_cooldown_min": 15,
        "topic": topic,
        "entry_type": entry_type,
        "section_primary": topic if topic != "aktualne" else "zpravy",
    }


def _p0_headline_entries() -> list[dict]:
    return [
        _entry(
            "zpr_novinky_domaci",
            "https://www.novinky.cz/rss/domaci",
            "novinky.cz",
            "Novinky / Domácí",
        ),
        _entry(
            "zpr_seznam_domaci",
            "https://www.seznamzpravy.cz/rss/domaci",
            "seznamzpravy.cz",
            "Seznam / Domácí",
        ),
        _entry(
            "zpr_idnes_zpravy",
            "https://servis.idnes.cz/rss.aspx?c=zpravodaj",
            "idnes.cz",
            "iDNES / Zprávy",
        ),
        _entry(
            "zpr_ct24_domaci",
            "https://ct24.ceskatelevize.cz/rss",
            "ct24.ceskatelevize.cz",
            "ČT24 / Domácí",
        ),
        _entry("spt_sportcz", "https://www.sport.cz/rss/", "sport.cz", "Sport.cz", topic="sport"),
    ]


class ZdraviNativeFeedLivenessTest(unittest.TestCase):
    def test_no_duplicate_when_zdr_zdravezpravy_already_selected(self):
        registry = {
            "entries": [
                _entry(
                    "zdr_zdravezpravy",
                    "https://www.zdravezpravy.cz/feed/",
                    "zdravezpravy.cz",
                    "ZdravéZprávy",
                    topic="zdravi",
                ),
            ],
            "sources_per_tick": {"max_unmapped_per_tick": 0},
        }
        state = {"tick_index": 0, "domain_last_fetch": {}, "entry_state": {}}
        # Prague minute 0 → zdravezpravy.cz slot {0, 15, 30, 45}
        now = datetime(2026, 6, 5, 8, 0, tzinfo=timezone.utc)
        picked, _ = select_feeds_for_tick(registry, state, now=now)
        ids = [e.get("id") for e in picked]
        self.assertEqual(ids.count("zdr_zdravezpravy"), 1)

    def test_adds_native_zdravi_when_no_zdravi_feed_and_minute_off_slot(self):
        registry = {
            "entries": [
                _entry(
                    "zdr_zdravezpravy",
                    "https://www.zdravezpravy.cz/feed/",
                    "zdravezpravy.cz",
                    "ZdravéZprávy",
                    topic="zdravi",
                ),
                _entry(
                    "zdr_zdravotnickydenik",
                    "https://www.zdravotnickydenik.cz/feed/",
                    "zdravotnickydenik.cz",
                    "Zdravotnický deník",
                    topic="zdravi",
                ),
            ],
            "sources_per_tick": {"max_unmapped_per_tick": 0},
        }
        state = {"tick_index": 0, "domain_last_fetch": {}, "entry_state": {}}
        # Prague minute 17 — not in zdravezpravy {0,15,30,45} nor zdravotnickydenik {3,33}
        now = datetime(2026, 6, 5, 8, 17, tzinfo=timezone.utc)
        picked, _ = select_feeds_for_tick(registry, state, now=now)
        ids = {e.get("id") for e in picked}
        self.assertTrue(ids & NATIVE_ZDRAVI_LIVENESS_FEED_IDS)
        self.assertIn("zdr_zdravezpravy", ids)

    def test_zdr_zdravotnickydenik_when_zdr_zdravezpravy_on_cooldown(self):
        registry = {
            "entries": [
                _entry(
                    "zdr_zdravezpravy",
                    "https://www.zdravezpravy.cz/feed/",
                    "zdravezpravy.cz",
                    "ZdravéZprávy",
                    topic="zdravi",
                ),
                _entry(
                    "zdr_zdravotnickydenik",
                    "https://www.zdravotnickydenik.cz/feed/",
                    "zdravotnickydenik.cz",
                    "Zdravotnický deník",
                    topic="zdravi",
                ),
            ],
            "sources_per_tick": {"max_unmapped_per_tick": 0},
        }
        recent = (datetime.now(timezone.utc) - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
        state = {
            "tick_index": 0,
            "domain_last_fetch": {"zdravezpravy.cz": recent},
            "entry_state": {"zdr_zdravezpravy": {"last_fetch_at": recent}},
        }
        now = datetime(2026, 6, 5, 8, 17, tzinfo=timezone.utc)
        picked, _ = select_feeds_for_tick(registry, state, now=now)
        ids = {e.get("id") for e in picked}
        self.assertNotIn("zdr_zdravezpravy", ids)
        self.assertIn("zdr_zdravotnickydenik", ids)

    def test_rubric_zdravi_mirror_does_not_satisfy_liveness(self):
        registry = {
            "entries": [
                _entry(
                    "zdr_prozeny_zdravi",
                    "https://www.prozeny.cz/rss/zdravi",
                    "prozeny.cz",
                    "ProŽeny / Zdraví",
                    topic="zdravi",
                    entry_type="rubric",
                ),
                _entry(
                    "zdr_zdravezpravy",
                    "https://www.zdravezpravy.cz/feed/",
                    "zdravezpravy.cz",
                    "ZdravéZprávy",
                    topic="zdravi",
                ),
            ],
            "sources_per_tick": {"max_unmapped_per_tick": 0},
        }
        state = {"tick_index": 0, "domain_last_fetch": {}, "entry_state": {}}
        now = datetime(2026, 6, 5, 8, 17, tzinfo=timezone.utc)
        picked, _ = select_feeds_for_tick(registry, state, now=now)
        ids = {e.get("id") for e in picked}
        self.assertIn("zdr_zdravezpravy", ids)
        self.assertTrue(is_native_zdravi_liveness_feed({"id": "zdr_zdravezpravy", "topic": "zdravi"}))
        self.assertFalse(
            is_native_zdravi_liveness_feed(
                {"id": "zdr_prozeny_zdravi", "topic": "zdravi", "entry_type": "rubric"}
            )
        )

    def test_p0_headline_feeds_preserved_with_zdravi_liveness(self):
        registry = {
            "entries": _p0_headline_entries()
            + [
                _entry(
                    "zdr_zdravezpravy",
                    "https://www.zdravezpravy.cz/feed/",
                    "zdravezpravy.cz",
                    "ZdravéZprávy",
                    topic="zdravi",
                ),
            ],
            "sources_per_tick": {"max_unmapped_per_tick": 0},
        }
        state = {"tick_index": 0, "domain_last_fetch": {}, "entry_state": {}}
        now = datetime(2026, 6, 5, 8, 17, tzinfo=timezone.utc)
        picked, _ = select_feeds_for_tick(registry, state, now=now)
        ids = {e.get("id") for e in picked}
        for hid in ("zpr_novinky_domaci", "zpr_seznam_domaci", "zpr_idnes_zpravy", "zpr_ct24_domaci", "spt_sportcz"):
            self.assertIn(hid, ids, f"missing P0 headline {hid}")
        self.assertIn("zdr_zdravezpravy", ids)
        keys = {entry_fixed_slot_key(e) for e in picked if e.get("id") in P0_HEADLINE_REGISTRY_IDS}
        self.assertTrue(keys & P0_FRESHNESS_SLOT_KEYS)

    def test_zdravi_liveness_slot_adds_at_most_one_native_feed(self):
        registry = {
            "entries": [
                _entry(
                    "zdr_zdravezpravy",
                    "https://www.zdravezpravy.cz/feed/",
                    "zdravezpravy.cz",
                    "ZdravéZprávy",
                    topic="zdravi",
                ),
                _entry(
                    "zdr_zdravotnickydenik",
                    "https://www.zdravotnickydenik.cz/feed/",
                    "zdravotnickydenik.cz",
                    "Zdravotnický deník",
                    topic="zdravi",
                ),
            ],
            "sources_per_tick": {"max_unmapped_per_tick": 0},
        }
        state = {"tick_index": 0, "domain_last_fetch": {}, "entry_state": {}}
        now = datetime(2026, 6, 5, 8, 17, tzinfo=timezone.utc)
        picked, _ = select_feeds_for_tick(registry, state, now=now)
        native_count = sum(1 for e in picked if is_native_zdravi_liveness_feed(e))
        self.assertEqual(native_count, 1)

    def test_deterministic_selection_for_same_tick(self):
        registry = {
            "entries": _p0_headline_entries()
            + [
                _entry(
                    "zdr_zdravezpravy",
                    "https://www.zdravezpravy.cz/feed/",
                    "zdravezpravy.cz",
                    "ZdravéZprávy",
                    topic="zdravi",
                ),
                _entry(
                    "zdr_zdravotnickydenik",
                    "https://www.zdravotnickydenik.cz/feed/",
                    "zdravotnickydenik.cz",
                    "Zdravotnický deník",
                    topic="zdravi",
                ),
            ],
            "sources_per_tick": {"max_unmapped_per_tick": 0},
        }
        now = datetime(2026, 6, 5, 8, 45, tzinfo=timezone.utc)
        state_a = {"tick_index": 0, "domain_last_fetch": {}, "entry_state": {}}
        state_b = {"tick_index": 0, "domain_last_fetch": {}, "entry_state": {}}
        picked_a, _ = select_feeds_for_tick(registry, state_a, now=now)
        picked_b, _ = select_feeds_for_tick(registry, state_b, now=now)
        urls_a = [e.get("feed_url") for e in picked_a]
        urls_b = [e.get("feed_url") for e in picked_b]
        self.assertEqual(urls_a, urls_b)


if __name__ == "__main__":
    unittest.main()
