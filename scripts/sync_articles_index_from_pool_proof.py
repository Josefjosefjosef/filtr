#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Proof: sync_articles_index_from_pool keeps index generatedAt aligned with pool."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from iu_article_pool import build_publishable_pool_payload, write_publishable_pool  # noqa: E402
from sync_articles_index_from_pool import sync_articles_index_from_pool  # noqa: E402


class SyncArticlesIndexFromPoolProof(unittest.TestCase):
    def test_sync_aligns_generated_at(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pool_at = "2026-06-15T21:52:37.208406Z"
            stale_at = "2026-06-15T19:24:36.528790Z"
            articles = [
                {"url": "https://example.com/a", "publishedAt": "2026-06-15T20:00:00Z", "title": "A"},
                {"url": "https://example.com/b", "publishedAt": "2026-06-15T19:00:00Z", "title": "B"},
            ]
            write_publishable_pool(tmp, build_publishable_pool_payload(articles, generated_at=pool_at))

            index_dir = os.path.join(tmp, "articles")
            os.makedirs(index_dir, exist_ok=True)
            with open(os.path.join(index_dir, "index.json"), "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "generatedAt": stale_at,
                        "days": [{"date": "2026-06-15", "count": 1}],
                    },
                    f,
                )

            summary = sync_articles_index_from_pool(tmp)
            with open(os.path.join(index_dir, "index.json"), encoding="utf-8") as f:
                index = json.load(f)

            self.assertEqual(summary["generatedAt"], pool_at)
            self.assertEqual(index["generatedAt"], pool_at)
            self.assertEqual(index["poolGeneratedAt"], pool_at)
            self.assertEqual(index["sourcePool"], "publishable_pool.json")
            self.assertTrue(summary["split_brain_fixed"])
            today = next(row for row in index["days"] if row["date"] == "2026-06-15")
            self.assertGreaterEqual(today["count"], 2)


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(SyncArticlesIndexFromPoolProof)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    passed = result.wasSuccessful()
    print("SYNC_ARTICLES_INDEX_FROM_POOL_PROOF=" + ("PASS" if passed else "FAIL"))
    print("SPLIT_BRAIN=" + ("NO" if passed else "YES"))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
