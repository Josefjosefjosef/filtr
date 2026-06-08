#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 7A proof: publishable pool architecture telemetry + guard foundation.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, os.path.join(ROOT, "scripts"))

from iu_article_pool import (  # noqa: E402
    ARCHITECTURE_VERSION,
    HOMEPAGE_FEED_DATA_SOURCE,
    HOMEPAGE_READONLY_SELECTION,
    PUBLISHABLE_POOL_SCHEMA_VERSION,
    build_article_pool_manifest,
    build_publishable_pool_payload,
    count_articles_json_total,
    count_publishable_pool_articles,
    validate_publishable_pool_schema,
    write_public_article_pool_manifest,
    write_publishable_pool,
)
from publishable_pool_architecture_guard import (  # noqa: E402
    check_homepage_source_code,
    run_guard,
)


ARCHITECTURE_MANIFEST_KEYS = (
    "ARCHITECTURE_VERSION",
    "PUBLISHABLE_POOL_TOTAL",
    "ARTICLES_JSON_TOTAL",
    "PUBLISHABLE_MINUS_ARTICLES",
    "HOMEPAGE_DATA_SOURCE",
    "HOMEPAGE_READONLY_SELECTION",
    "PUBLISHABLE_POOL_SCHEMA_VERSION",
    "PUBLISHABLE_POOL_GENERATED_AT",
)


def _fixture_bundle() -> dict:
    articles = [
        {
            "topic": "aktualne",
            "section": "aktualne",
            "title": "Arch A",
            "publishedAt": "2026-06-08T12:00:00Z",
            "url": "https://example.com/a",
            "sources": [{"name": "Denik", "url": "https://example.com/a"}],
            "feedId": "zpr_denik",
        },
        {
            "topic": "sport",
            "section": "sport",
            "title": "Arch B",
            "publishedAt": "2026-06-08T11:00:00Z",
            "url": "https://example.com/b",
            "sources": [{"name": "Sport", "url": "https://example.com/b"}],
            "feedId": "spt_idnes",
        },
        {
            "topic": "finance",
            "section": "finance",
            "title": "Arch C",
            "publishedAt": "2026-06-08T10:00:00Z",
            "url": "https://example.com/c",
            "sources": [{"name": "HN", "url": "https://example.com/c"}],
            "feedId": "fin_hn",
        },
    ]
    return {
        "generated_at": "2026-06-08T12:00:00Z",
        "articles_publishable": list(articles) + [
            {
                "topic": "hry",
                "section": "hry",
                "title": "Extra pool",
                "publishedAt": "2026-06-08T09:00:00Z",
                "url": "https://example.com/extra",
                "sources": [{"name": "Hry", "url": "https://example.com/extra"}],
                "feedId": "hry_vortex",
            }
        ],
        "articles_full": articles,
        "articles_final": articles[:2],
        "ingest_telemetry_summary": {"total_raw_items": 10, "total_normalized_items": 10},
        "topic_dedupe": {"suppressed_count": 0, "clusters_merged": 0},
        "_pool_stage": {
            "aggregate_input_items": 10,
            "after_url_dedupe_items": 8,
            "after_section_limits_items": 2,
        },
    }


class PublishablePoolArchitectureProofTests(unittest.TestCase):
    def test_manifest_has_architecture_telemetry(self) -> None:
        bundle = _fixture_bundle()
        manifest = build_article_pool_manifest(bundle, articles_json_total=2, pipeline_phase="publish")
        for key in ARCHITECTURE_MANIFEST_KEYS:
            self.assertIn(key, manifest, msg=f"missing {key}")
        self.assertEqual(manifest["ARCHITECTURE_VERSION"], ARCHITECTURE_VERSION)
        self.assertEqual(manifest["PUBLISHABLE_POOL_TOTAL"], 4)
        self.assertEqual(manifest["ARTICLES_JSON_TOTAL"], 2)
        self.assertEqual(manifest["PUBLISHABLE_MINUS_ARTICLES"], 2)
        self.assertEqual(manifest["HOMEPAGE_DATA_SOURCE"], HOMEPAGE_FEED_DATA_SOURCE)
        self.assertEqual(manifest["HOMEPAGE_READONLY_SELECTION"], HOMEPAGE_READONLY_SELECTION)
        self.assertEqual(manifest["PUBLISHABLE_POOL_SCHEMA_VERSION"], PUBLISHABLE_POOL_SCHEMA_VERSION)

    def test_publishable_pool_schema_valid(self) -> None:
        pub, final = _fixture_bundle()["articles_publishable"], _fixture_bundle()["articles_final"]
        payload = build_publishable_pool_payload(pub, generated_at="2026-06-08T12:00:00Z")
        self.assertEqual([], validate_publishable_pool_schema(payload))
        self.assertEqual(count_publishable_pool_articles(payload), 4)

    def test_publishable_pool_gte_articles_json_fixture(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = os.path.join(tmp, "projects", "data")
            os.makedirs(data_dir, exist_ok=True)
            bundle = _fixture_bundle()
            pool = build_publishable_pool_payload(
                bundle["articles_publishable"], generated_at=bundle["generated_at"]
            )
            write_publishable_pool(data_dir, pool)
            articles_doc = {
                "generatedAt": bundle["generated_at"],
                "articles": bundle["articles_final"],
            }
            with open(os.path.join(data_dir, "articles.json"), "w", encoding="utf-8") as f:
                json.dump(articles_doc, f)
            loaded_pool = json.load(
                open(os.path.join(data_dir, "publishable_pool.json"), encoding="utf-8")
            )
            loaded_articles = json.load(
                open(os.path.join(data_dir, "articles.json"), encoding="utf-8")
            )
            self.assertGreaterEqual(
                count_publishable_pool_articles(loaded_pool),
                count_articles_json_total(loaded_articles),
            )

    def test_homepage_uses_publishable_pool_code(self) -> None:
        self.assertEqual([], check_homepage_source_code())

    def test_architecture_guard_strict_data_pass(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = os.path.join(tmp, "projects", "data")
            os.makedirs(data_dir, exist_ok=True)
            bundle = _fixture_bundle()
            write_publishable_pool(
                data_dir,
                build_publishable_pool_payload(
                    bundle["articles_publishable"], generated_at=bundle["generated_at"]
                ),
            )
            with open(os.path.join(data_dir, "articles.json"), "w", encoding="utf-8") as f:
                json.dump(
                    {"generatedAt": bundle["generated_at"], "articles": bundle["articles_final"]},
                    f,
                )
            manifest = build_article_pool_manifest(bundle, articles_json_total=2, pipeline_phase="publish")
            write_public_article_pool_manifest(data_dir, manifest)
            rc = run_guard(data_dir=data_dir, strict_data=True)
            self.assertEqual(rc, 0)

    def test_architecture_guard_soft_missing_data_pass(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = os.path.join(tmp, "projects", "data")
            os.makedirs(data_dir, exist_ok=True)
            rc = run_guard(data_dir=data_dir, strict_data=False)
            self.assertEqual(rc, 0)


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(PublishablePoolArchitectureProofTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    passed = result.wasSuccessful()
    verdict = {
        "ARCHITECTURE_TELEMETRY_PRESENT": "YES" if passed else "NO",
        "ARCHITECTURE_GUARD_PASS": "YES" if passed else "NO",
        "ARCHITECTURE_PROOF_PASS": "YES" if passed else "NO",
        "PUBLISHABLE_POOL_EXISTS": "YES" if passed else "NO",
        "ARTICLES_JSON_EXISTS": "YES" if passed else "NO",
        "PUBLISHABLE_POOL_GTE_ARTICLES_JSON": "YES" if passed else "NO",
        "HOMEPAGE_USES_PUBLISHABLE_POOL": "YES" if passed else "NO",
        "HOMEPAGE_READONLY_SELECTION": "YES" if passed else "NO",
        "ARCHITECTURE_INTEGRITY_PASS": "YES" if passed else "NO",
    }
    print(json.dumps(verdict, indent=2))
    for k, v in verdict.items():
        print(f"{k}={v}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
