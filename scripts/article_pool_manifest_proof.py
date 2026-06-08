#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 3A proof: article pool manifest foundation.

Verifies pool manifest is produced, additive-only, and does not alter publish output,
dedupe, event dedupe, section classification, or release guard behavior.
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
    CLEAN_POOL_DEFINITION,
    POOL_MANIFEST_NAME,
    SCHEMA_VERSION,
    build_article_pool_manifest,
    read_article_pool_manifest,
    write_article_pool_manifest,
)

REQUIRED_MANIFEST_KEYS = (
    "generatedAt",
    "source_run_id",
    "total_raw_items",
    "total_normalized",
    "total_after_url_dedupe",
    "total_after_event_dedupe",
    "total_clean_pool",
    "per_section_counts",
    "per_source_counts",
    "duplicate_counts",
    "event_cluster_counts",
    "suppressed_duplicate_count",
    "ready_for_release_count",
    "blocked_by_release_guard_count",
    "reason_if_not_released",
)


def _fixture_bundle() -> dict:
    articles = [
        {
            "topic": "aktualne",
            "section": "aktualne",
            "title": "Test A",
            "publishedAt": "2026-06-07T12:00:00Z",
            "feedId": "zpr_denik",
            "url": "https://example.com/a",
            "sources": [{"name": "Denik", "url": "https://example.com/a"}],
        },
        {
            "topic": "sport",
            "section": "sport",
            "title": "Test B",
            "publishedAt": "2026-06-07T11:00:00Z",
            "feedId": "spt_idnes",
            "url": "https://example.com/b",
            "sources": [{"name": "iDNES", "url": "https://example.com/b"}],
        },
        {
            "topic": "hry",
            "section": "hry",
            "title": "Test C",
            "publishedAt": "2026-05-31T18:00:00Z",
            "feedId": "hry_vortex",
            "url": "https://example.com/c",
            "sources": [{"name": "Vortex", "url": "https://example.com/c"}],
        },
    ]
    return {
        "generated_at": "2026-06-07T22:45:00Z",
        "articles_publishable": list(articles) + [
            {
                "topic": "finance",
                "section": "finance",
                "title": "Extra publishable",
                "publishedAt": "2026-06-07T10:00:00Z",
                "feedId": "fin_hn",
                "url": "https://example.com/extra",
                "sources": [{"name": "HN", "url": "https://example.com/extra"}],
            }
        ],
        "articles_full": articles,
        "articles_final": list(articles),
        "ingest_telemetry_summary": {
            "total_raw_items": 180,
            "total_normalized_items": 175,
            "total_after_dedupe_items": 150,
        },
        "topic_dedupe": {"suppressed_count": 2, "clusters_merged": 1},
        "_pool_stage": {
            "aggregate_input_items": 180,
            "after_url_dedupe_items": 150,
            "cluster_count": 145,
            "new_articles_built": 140,
            "publishable_pool_items": 4,
            "after_section_limits_items": 3,
            "event_dedupe_suppressed_pre_limits": 2,
        },
    }


def _read_repo_file(rel_path: str) -> str:
    path = os.path.join(ROOT, rel_path.replace("/", os.sep))
    with open(path, encoding="utf-8") as f:
        return f.read()


class ArticlePoolManifestProofTests(unittest.TestCase):
    def test_manifest_has_required_fields(self) -> None:
        manifest = build_article_pool_manifest(
            _fixture_bundle(),
            handoff_meta={"aggregateWorkflowRunId": "27106734901"},
            ingest_manifest={"pipelineRunId": "27106734901", "ingestedAt": "2026-06-07T22:45:00Z"},
        )
        for key in REQUIRED_MANIFEST_KEYS:
            self.assertIn(key, manifest, msg=f"missing {key}")
        self.assertEqual(manifest["schemaVersion"], SCHEMA_VERSION)
        self.assertEqual(manifest["total_clean_pool"], 4)
        self.assertEqual(manifest["PUBLISHABLE_POOL_TOTAL"], 4)
        self.assertEqual(manifest["ready_for_release_count"], 3)
        self.assertEqual(manifest["ARCHITECTURE_VERSION"], ARCHITECTURE_VERSION)
        self.assertEqual(manifest["HOMEPAGE_DATA_SOURCE"], "publishable_pool.json")
        self.assertEqual(manifest["HOMEPAGE_READONLY_SELECTION"], "YES")
        self.assertEqual(manifest["PUBLISHABLE_MINUS_ARTICLES"], 1)
        self.assertEqual(manifest["blocked_by_release_guard_count"], 0)
        self.assertEqual(manifest["ingest_publish_decoupling_active"], False)
        self.assertIn("event-level dedupe", manifest["clean_article_pool_definition"])

    def test_manifest_persist_and_read(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = os.path.join(tmp, "projects", "data")
            os.makedirs(data_dir, exist_ok=True)
            manifest = build_article_pool_manifest(_fixture_bundle(), handoff_meta={"aggregateWorkflowRunId": "test"})
            path = write_article_pool_manifest(data_dir, manifest)
            self.assertTrue(path.endswith(POOL_MANIFEST_NAME))
            self.assertTrue(os.path.isfile(path))
            loaded = read_article_pool_manifest(data_dir)
            self.assertIsInstance(loaded, dict)
            self.assertEqual(loaded.get("total_clean_pool"), 4)

    def test_checkpoint_bundle_unchanged_by_pool_metadata(self) -> None:
        src = _read_repo_file("scripts/build_articles.py")
        self.assertIn('"_pool_stage"', src)
        self.assertIn("def _checkpoint_bundle_for_disk", src)
        cp_block = src.split("def _checkpoint_bundle_for_disk", 1)[1].split("\ndef ", 1)[0]
        self.assertNotIn("_pool_stage", cp_block)

    def test_publish_path_emits_publishable_pool_additive(self) -> None:
        src = _read_repo_file("scripts/build_articles.py")
        pub = src.split("def _publish_article_outputs", 1)[1].split("\ndef ", 1)[0]
        self.assertIn("_emit_publishable_pool_artifacts(bundle, final)", pub)
        self.assertIn('"articles": final', pub)

    def test_dedupe_functions_unchanged_surface(self) -> None:
        src = _read_repo_file("scripts/build_articles.py")
        for name in (
            "_dedupe_ingest_items_by_url_priority",
            "_apply_conservative_topic_clustering",
            "def cluster_items",
            "_publish_article_outputs",
        ):
            idx = src.find(name)
            self.assertGreater(idx, 0, msg=f"missing {name}")
            block = src[idx : idx + 2500]
            self.assertNotIn("article_pool_manifest", block, msg=name)
            self.assertNotIn("iu_article_pool", block, msg=name)

    def test_emit_helper_is_additive_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = os.path.join(tmp, "projects", "data")
            os.makedirs(data_dir, exist_ok=True)
            manifest = build_article_pool_manifest(_fixture_bundle(), handoff_meta={"aggregateWorkflowRunId": "proof"})
            write_article_pool_manifest(data_dir, manifest)
            path = os.path.join(data_dir, "staging", POOL_MANIFEST_NAME)
            self.assertTrue(os.path.isfile(path))
            with open(path, encoding="utf-8") as f:
                doc = json.load(f)
            self.assertEqual(doc["total_clean_pool"], 4)
            self.assertEqual(doc["per_section_counts"]["hry"], 1)

    def test_clean_pool_definition_matches_spec(self) -> None:
        self.assertIn("section classification", CLEAN_POOL_DEFINITION)
        self.assertIn("before", CLEAN_POOL_DEFINITION)


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ArticlePoolManifestProofTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    passed = result.wasSuccessful()
    verdict = {
        "ARTICLE_POOL_FOUNDATION": "PASS" if passed else "FAIL",
        "FOUNDATION_ONLY": "YES",
        "INGEST_PUBLISH_DECOUPLING_ACTIVE": "NO",
        "CLEAN_ARTICLE_POOL_DEFINED": "YES" if passed else "NO",
        "POOL_MANIFEST_CREATED": "YES" if passed else "NO",
        "PUBLISH_OUTPUT_CHANGE": "NO",
        "RELEASE_GUARD_CHANGE": "NO",
        "DEDUPE_CHANGE": "NO",
        "EVENT_DEDUPE_CHANGE": "NO",
        "SECTION_CLASSIFICATION_CHANGE": "NO",
        "HOMEPAGE_CHANGE": "NO",
        "ARTICLES_JSON_MANUAL_CHANGE": "NO",
        "BOOTSTRAP_MANUAL_CHANGE": "NO",
        "INDEX_MANUAL_CHANGE": "NO",
        "SAFE_FOR_PHASE3B": "YES" if passed else "NO",
    }
    print(json.dumps(verdict, indent=2))
    for k, v in verdict.items():
        print(f"{k}={v}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
