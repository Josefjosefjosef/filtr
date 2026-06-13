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
from iu_fast_pool_publish import (  # noqa: E402
    analyze_pool_shrink,
    evaluate_pool_shrink_guard,
    run_fast_pool_publish,
)


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


class FastPoolShrinkGuardProofTests(unittest.TestCase):
    def test_legitimate_shrink_with_suppressed_url_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = os.path.join(tmp, "projects", "data")
            os.makedirs(data_dir, exist_ok=True)
            removed_url = "https://example.com/removed-by-dedupe"
            prev = [
                _base_article(removed_url, "Old duplicate story"),
                _base_article("https://example.com/keep", "Keep me"),
            ]
            merged = [_base_article("https://example.com/keep", "Keep me")]
            suppressed_path = os.path.join(data_dir, "topic_dedupe_suppressed.json")
            with open(suppressed_path, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "generatedAt": "2026-06-09T12:00:00Z",
                        "suppressed": [{"url": removed_url, "reason": "event_dedupe"}],
                    },
                    f,
                )

            meta = analyze_pool_shrink(
                prev,
                merged,
                {removed_url, "https://example.com/keep"},
                set(),
                data_dir,
            )
            ok, reason = evaluate_pool_shrink_guard(2, 1, meta)
            self.assertTrue(ok, msg=reason)
            self.assertEqual(meta["unexplained_removed_count"], 0)
            self.assertEqual(meta["legitimate_removed_count"], 1)

    def test_unexplained_shrink_fails_guard(self) -> None:
        prev = [
            _base_article("https://example.com/a", "A"),
            _base_article("https://example.com/b", "B"),
        ]
        merged = [_base_article("https://example.com/a", "A")]
        meta = analyze_pool_shrink(
            prev,
            merged,
            {"https://example.com/a", "https://example.com/b"},
            set(),
            os.path.join(tempfile.gettempdir(), "nonexistent"),
        )
        ok, reason = evaluate_pool_shrink_guard(2, 1, meta)
        self.assertFalse(ok)
        self.assertGreater(meta["unexplained_removed_count"], 0)
        self.assertIn("unexplained_removed_count", reason)

    def test_balanced_pipeline_revalidation_shrink_passes(self) -> None:
        removed_urls = [f"https://example.com/stale-{i}" for i in range(4)]
        added_urls = [f"https://example.com/fresh-{i}" for i in range(3)]
        prev = [_base_article(u, f"Stale {i}") for i, u in enumerate(removed_urls)]
        prev.extend(
            [
                _base_article("https://example.com/stable-1", "Stable 1"),
                _base_article("https://example.com/stable-2", "Stable 2"),
            ]
        )
        merged = [_base_article(u, f"Fresh {i}") for i, u in enumerate(added_urls)]
        merged.extend(
            [
                _base_article("https://example.com/stable-1", "Stable 1"),
                _base_article("https://example.com/stable-2", "Stable 2"),
            ]
        )
        prev_url_set = {a["url"] for a in prev}
        meta = analyze_pool_shrink(
            prev,
            merged,
            prev_url_set,
            set(added_urls),
            os.path.join(tempfile.gettempdir(), "nonexistent"),
        )
        ok, reason = evaluate_pool_shrink_guard(6, 5, meta)
        self.assertTrue(ok, msg=reason)
        self.assertEqual(meta["unexplained_removed_count"], 0)
        self.assertEqual(meta["removed_count"], 4)


def main() -> int:
    suite = unittest.TestSuite()
    suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(FastPoolPublishProofTests))
    suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(FastPoolShrinkGuardProofTests))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    passed = result.wasSuccessful()
    verdict = {
        "FAST_PUBLISH_SAFE": "YES" if passed else "NO",
        "FAST_POOL_PUBLISH_PROOF": "PASS" if passed else "FAIL",
        "FAST_POOL_SHRINK_GUARD_PROOF": "PASS" if passed else "FAIL",
        "DUPLICATE_REGRESSION": "NO" if passed else "YES",
        "PUBLISHABLE_POOL_APPEND": "YES" if passed else "NO",
    }
    print(json.dumps(verdict, indent=2))
    for k, v in verdict.items():
        print(f"{k}={v}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
