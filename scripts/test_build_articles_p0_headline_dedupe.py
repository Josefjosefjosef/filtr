#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P0 headline feedId must win ingest URL dedupe vs vertical rubric syndication."""
from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timezone

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from build_articles import (  # noqa: E402
    _dedupe_ingest_items_by_url_priority,
    _pick_ingest_item_collision_winner,
)

URL = "https://www.novinky.cz/clanek/example-40580986"
DT = datetime(2026, 6, 1, 21, 0, tzinfo=timezone.utc)


def _item(feed_id: str, section: str, url: str = URL) -> dict:
    return {
        "url": url,
        "feedId": feed_id,
        "section": section,
        "dt": DT,
        "title": "Test",
        "media_norm": "novinky",
        "tokens": set(),
    }


class P0HeadlineDedupeTest(unittest.TestCase):
    def test_novinky_domaci_beats_cestovani_same_url(self):
        a = _item("zpr_novinky_domaci", "aktualne")
        b = _item("ces_novinky_cestovani", "cestovani")
        winner = _pick_ingest_item_collision_winner(a, b)
        self.assertEqual(winner["feedId"], "zpr_novinky_domaci")
        deduped = _dedupe_ingest_items_by_url_priority([b, a])
        self.assertEqual(len(deduped), 1)
        self.assertEqual(deduped[0]["feedId"], "zpr_novinky_domaci")

    def test_seznam_domaci_beats_vzd_seznam_same_url(self):
        url = "https://www.seznamzpravy.cz/clanek/example-307570"
        a = _item("zpr_seznam_domaci", "aktualne", url)
        b = _item("vzd_seznam", "vzdelavani", url)
        winner = _pick_ingest_item_collision_winner(a, b)
        self.assertEqual(winner["feedId"], "zpr_seznam_domaci")
        deduped = _dedupe_ingest_items_by_url_priority([b, a])
        self.assertEqual(deduped[0]["feedId"], "zpr_seznam_domaci")

    def test_vertical_only_collision_unchanged(self):
        url = "https://www.novinky.cz/clanek/ekonomika-example"
        a = _item("ces_novinky_cestovani", "cestovani", url)
        b = _item("fin_novinky_ekonomika", "finance", url)
        winner = _pick_ingest_item_collision_winner(a, b)
        self.assertEqual(winner["feedId"], "ces_novinky_cestovani")


if __name__ == "__main__":
    unittest.main()
