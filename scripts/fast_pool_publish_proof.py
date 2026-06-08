#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 9B proof: incremental fast pool publish append semantics.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)

from iu_article_pool import (  # noqa: E402
    build_publishable_pool_payload,
    count_publishable_pool_articles,
    write_publishable_pool,
)
from iu_staging import (  # noqa: E402
    deserialize_feed_item,
    ensure_staging_dirs,
    write_ingest_manifest,
    write_source_staging,
)
from iu_fast_pool_publish import run_fast_pool_publish  # noqa: E402


def _base_article(url: str, title: str, section: str = "aktualne") -> dict:
    return {
        "topic": section,
        "section": section,
        "contentType": "article",
        "title": title,
        "publishedAt": "2026-06-09T10:00:00Z",
        "url": url,
        "sources": [{"name": "Test", "url": url}],
        "feedId": "zpr_denik",
        "primaryCategory": "zpravy",
        "feedType": "rss",
        "topicHash": "abc",
        "sourceDisplayWeight": 1.0,
        "sectionPrimary": "zpravy",
        "sourceLabel": "Test",
    }


def _ingest_item(url: str, title: str, section: str = "aktualne") -> dict:
    dt = datetime(2026, 6, 9, 12, 0, tzinfo=timezone.utc)
    return deserialize_feed_item(
        {
            "url": url,
            "title": title,
            "section": section,
            "contentType": "article",
            "media_raw": "Test Source",
            "media_norm": "test source",
            "tokens": sorted(title.lower().split()),
            "dt": dt.isoformat().replace("+00:00", "Z"),
            "feedId": "zpr_denik",
            "feedCategory": "zpravy",
            "sourceDisplayWeight": 1.0,
        }
    )


class FastPoolPublishProofTests(unittest.TestCase):
    def test_append_increases_pool_without_duplicate_url(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = os.path.join(tmp, "projects", "data")
            os.makedirs(data_dir, exist_ok=True)
            prev = [
                _base_article("https://example.com/existing", "Existing story"),
            ]
            write_publishable_pool(
                data_dir,
                build_publishable_pool_payload(prev, generated_at="2026-06-09T09:00:00Z"),
            )
            ensure_staging_dirs(data_dir)
            batch_key = "zpr_denik"
            write_source_staging(
                data_dir,
                batch_key,
                [_ingest_item("https://example.com/new-fast", "Brand new headline today")],
                [],
                "2026-06-09T12:00:00Z",
            )
            write_ingest_manifest(data_dir, [batch_key], "2026-06-09T12:00:00Z")

            rc, meta = run_fast_pool_publish(data_dir)
            self.assertEqual(rc, 0, msg=str(meta))
            self.assertEqual(meta["prev_pool_total"], 1)
            self.assertEqual(meta["new_articles_published"], 1)
            self.assertEqual(meta["publishable_pool_total"], 2)

            pool_path = os.path.join(data_dir, "publishable_pool.json")
            with open(pool_path, encoding="utf-8") as f:
                pool = json.load(f)
            self.assertEqual(count_publishable_pool_articles(pool), 2)
            urls = {a["url"] for a in pool.get("articles") or []}
            self.assertIn("https://example.com/new-fast", urls)
            self.assertIn("https://example.com/existing", urls)

    def test_duplicate_url_not_re_appended(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = os.path.join(tmp, "projects", "data")
            os.makedirs(data_dir, exist_ok=True)
            url = "https://example.com/existing"
            write_publishable_pool(
                data_dir,
                build_publishable_pool_payload(
                    [_base_article(url, "Existing")],
                    generated_at="2026-06-09T09:00:00Z",
                ),
            )
            ensure_staging_dirs(data_dir)
            write_source_staging(
                data_dir,
                "zpr_denik",
                [_ingest_item(url, "Same URL different title")],
                [],
                "2026-06-09T12:00:00Z",
            )
            write_ingest_manifest(data_dir, ["zpr_denik"], "2026-06-09T12:00:00Z")

            rc, meta = run_fast_pool_publish(data_dir)
            self.assertEqual(rc, 0)
            self.assertEqual(meta.get("skipped_reason"), "no_new_candidates")
            self.assertEqual(meta["new_articles_published"], 0)
            self.assertEqual(meta["publishable_pool_total"], 1)


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(FastPoolPublishProofTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    passed = result.wasSuccessful()
    verdict = {
        "FAST_PUBLISH_SAFE": "YES" if passed else "NO",
        "FAST_POOL_PUBLISH_PROOF": "PASS" if passed else "FAIL",
        "DUPLICATE_REGRESSION": "NO" if passed else "YES",
        "PUBLISHABLE_POOL_APPEND": "YES" if passed else "NO",
    }
    print(json.dumps(verdict, indent=2))
    for k, v in verdict.items():
        print(f"{k}={v}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
