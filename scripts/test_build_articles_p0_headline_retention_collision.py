#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P0 headline feedId must win retention URL dedupe vs vertical rubric syndication."""
from __future__ import annotations

import os
import sys
import unittest

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from build_articles import (  # noqa: E402
    _dedupe_articles_by_url_global,
    _pick_url_collision_winner,
    apply_per_section_published_retention,
)

NOVINKY_URL = "https://www.novinky.cz/clanek/example-40580986"
SEZNAM_URL = "https://www.seznamzpravy.cz/clanek/example-307570"
CT24_URL = "https://ct24.ceskatelevize.cz/clanek/example-12345"
OTHER_URL = "https://www.example.com/article-a"
OTHER_URL_B = "https://www.example.com/article-b"


def _article(feed_id: str, section: str, url: str, published_at: str = "2026-06-04T12:00:00Z") -> dict:
    return {
        "url": url,
        "feedId": feed_id,
        "topic": section,
        "section": section,
        "publishedAt": published_at,
        "title": "Test headline",
        "sources": [{"name": "Test", "url": url}],
    }


class P0HeadlineRetentionCollisionTest(unittest.TestCase):
    def test_novinky_domaci_beats_cestovani_same_url(self):
        headline = _article("zpr_novinky_domaci", "aktualne", NOVINKY_URL)
        vertical = _article(
            "ces_novinky_cestovani",
            "cestovani",
            NOVINKY_URL,
            published_at="2026-06-05T12:00:00Z",
        )
        winner = _pick_url_collision_winner(vertical, headline)
        self.assertEqual(winner["feedId"], "zpr_novinky_domaci")

    def test_seznam_domaci_beats_vzd_seznam_same_url(self):
        headline = _article("zpr_seznam_domaci", "aktualne", SEZNAM_URL)
        vertical = _article(
            "vzd_seznam",
            "vzdelavani",
            SEZNAM_URL,
            published_at="2026-06-05T12:00:00Z",
        )
        winner = _pick_url_collision_winner(vertical, headline)
        self.assertEqual(winner["feedId"], "zpr_seznam_domaci")

    def test_ct24_domaci_beats_ct24_vertical_same_url(self):
        headline = _article("zpr_ct24_domaci", "aktualne", CT24_URL)
        vertical = _article(
            "ved_ct24_veda",
            "veda",
            CT24_URL,
            published_at="2026-06-05T12:00:00Z",
        )
        winner = _pick_url_collision_winner(vertical, headline)
        self.assertEqual(winner["feedId"], "zpr_ct24_domaci")

    def test_different_urls_unchanged(self):
        a = _article("zpr_novinky_domaci", "aktualne", OTHER_URL)
        b = _article("ces_novinky_cestovani", "cestovani", OTHER_URL_B)
        deduped = _dedupe_articles_by_url_global([a, b])
        self.assertEqual(len(deduped), 2)
        feed_ids = {row["feedId"] for row in deduped}
        self.assertEqual(feed_ids, {"zpr_novinky_domaci", "ces_novinky_cestovani"})

    def test_non_p0_collision_keeps_vertical_priority(self):
        url = "https://www.novinky.cz/clanek/ekonomika-example"
        cestovani = _article("ces_novinky_cestovani", "cestovani", url)
        finance = _article(
            "fin_novinky_ekonomika",
            "finance",
            url,
            published_at="2026-06-05T12:00:00Z",
        )
        winner = _pick_url_collision_winner(finance, cestovani)
        self.assertEqual(winner["feedId"], "ces_novinky_cestovani")

    def test_retention_merge_preserves_headline_feed_id(self):
        prev = [_article("ces_novinky_cestovani", "cestovani", NOVINKY_URL, "2026-05-31T20:36:14Z")]
        capped = [_article("zpr_novinky_domaci", "aktualne", NOVINKY_URL, "2026-06-04T21:17:13Z")]
        merged = apply_per_section_published_retention(prev, capped)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["feedId"], "zpr_novinky_domaci")
        self.assertEqual(merged[0]["publishedAt"], "2026-06-04T21:17:13Z")


if __name__ == "__main__":
    unittest.main()
