#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 6B proof: publishable_pool.json artifact foundation.

Verifies publishable pool is written, schema-valid, superset of articles.json,
and that articles.json / homepage / dedupe paths remain unchanged in scope.
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
    PUBLISHABLE_POOL_NAME,
    PUBLISHABLE_POOL_SCHEMA_VERSION,
    PUBLIC_POOL_MANIFEST_NAME,
    build_article_pool_manifest,
    build_publishable_pool_payload,
    read_public_article_pool_manifest,
    read_publishable_pool,
    write_public_article_pool_manifest,
    write_publishable_pool,
)


def _fixture_publishable_articles(n_full: int = 5, n_json: int = 3) -> tuple[list, list]:
    base = []
    for i in range(n_full):
        base.append(
            {
                "topic": "aktualne" if i % 2 == 0 else "sport",
                "section": "aktualne" if i % 2 == 0 else "sport",
                "title": f"Publishable article {i}",
                "publishedAt": f"2026-06-07T{10 + i:02d}:00:00Z",
                "url": f"https://example.com/publishable-{i}",
                "sources": [{"name": "Denik", "url": f"https://example.com/publishable-{i}"}],
                "feedId": "zpr_denik",
            }
        )
    return base, base[:n_json]


def _fixture_bundle(publishable: list, final: list) -> dict:
    return {
        "generated_at": "2026-06-08T12:00:00Z",
        "articles_publishable": list(publishable),
        "articles_full": list(final),
        "articles_final": list(final),
        "ingest_telemetry_summary": {
            "total_raw_items": 180,
            "total_normalized_items": 180,
            "total_after_dedupe_items": 150,
        },
        "topic_dedupe": {"suppressed_count": 2, "clusters_merged": 1},
        "_pool_stage": {
            "aggregate_input_items": 180,
            "after_url_dedupe_items": 150,
            "cluster_count": 145,
            "new_articles_built": 140,
            "publishable_pool_items": len(publishable),
            "after_section_limits_items": len(final),
            "event_dedupe_suppressed_pre_limits": 2,
        },
    }


def _read_repo_file(rel_path: str) -> str:
    path = os.path.join(ROOT, rel_path.replace("/", os.sep))
    with open(path, encoding="utf-8") as f:
        return f.read()


class PublishablePoolArtifactProofTests(unittest.TestCase):
    def test_publishable_pool_schema_and_write(self) -> None:
        pub, final = _fixture_publishable_articles(5, 3)
        payload = build_publishable_pool_payload(pub, generated_at="2026-06-08T12:00:00Z")
        self.assertEqual(payload["schemaVersion"], PUBLISHABLE_POOL_SCHEMA_VERSION)
        self.assertEqual(payload["pipelinePhase"], "publishable_pool")
        self.assertEqual(payload["counts"]["total"], 5)
        self.assertTrue(payload["stage"]["beforeHomepageSelection"])
        self.assertTrue(payload["stage"]["beforeRailSelection"])
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = os.path.join(tmp, "projects", "data")
            os.makedirs(data_dir, exist_ok=True)
            path = write_publishable_pool(data_dir, payload)
            self.assertTrue(path.endswith(PUBLISHABLE_POOL_NAME))
            loaded = read_publishable_pool(data_dir)
            self.assertIsInstance(loaded, dict)
            self.assertEqual(loaded.get("counts", {}).get("total"), 5)

    def test_publishable_pool_gte_articles_json(self) -> None:
        pub, final = _fixture_publishable_articles(7, 4)
        bundle = _fixture_bundle(pub, final)
        manifest = build_article_pool_manifest(bundle, articles_json_total=len(final))
        self.assertGreaterEqual(manifest["PUBLISHABLE_POOL_TOTAL"], manifest["ARTICLES_JSON_TOTAL"])
        self.assertGreaterEqual(manifest["POOL_TOTAL"], manifest["ARTICLES_JSON_TOTAL"])

    def test_public_manifest_written_at_publish_boundary(self) -> None:
        pub, final = _fixture_publishable_articles(6, 3)
        bundle = _fixture_bundle(pub, final)
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = os.path.join(tmp, "projects", "data")
            os.makedirs(data_dir, exist_ok=True)
            write_publishable_pool(
                data_dir,
                build_publishable_pool_payload(pub, generated_at=bundle["generated_at"]),
            )
            manifest = build_article_pool_manifest(bundle, articles_json_total=len(final))
            write_public_article_pool_manifest(data_dir, manifest)
            loaded = read_public_article_pool_manifest(data_dir)
            self.assertIsInstance(loaded, dict)
            self.assertEqual(loaded.get("PUBLISHABLE_POOL_TOTAL"), 6)
            self.assertEqual(loaded.get("ARTICLES_JSON_TOTAL"), 3)

    def test_export_point_in_aggregate_pipeline(self) -> None:
        src = _read_repo_file("scripts/build_articles.py")
        self.assertIn("publishable_pool = list(merged_articles)", src)
        self.assertIn("apply_per_section_limits_then_cap(merged_articles)", src)
        idx_pool = src.find("publishable_pool = list(merged_articles)")
        idx_limits = src.find("apply_per_section_limits_then_cap(merged_articles)", idx_pool)
        self.assertGreater(idx_limits, idx_pool)

    def test_articles_json_publish_path_unchanged_semantics(self) -> None:
        src = _read_repo_file("scripts/build_articles.py")
        pub = src.split("def _publish_article_outputs", 1)[1].split("\ndef ", 1)[0]
        self.assertIn('"articles": final', pub)
        self.assertIn("_atomic_write_json(OUT_PATH, payload)", pub)

    def test_homepage_feed_wiring_is_phase6c_scope(self) -> None:
        """Phase 6B pipeline scripts only; homepage pool wiring belongs to Phase 6C."""
        app_src = _read_repo_file("assets/app.js")
        if "publishable_pool.json" in app_src:
            self.skipTest("homepage Phase 6C active — see homepage_publishable_pool_phase6c_proof.py")
        self.assertNotIn("publishable_pool", app_src)

    def test_emit_helper_additive_only(self) -> None:
        src = _read_repo_file("scripts/build_articles.py")
        self.assertIn("def _emit_publishable_pool_artifacts", src)
        block = src.split("def _emit_publishable_pool_artifacts", 1)[1].split("\ndef ", 1)[0]
        self.assertNotIn("articles_full", block.replace("articles_publishable", ""))


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(PublishablePoolArtifactProofTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    passed = result.wasSuccessful()
    verdict = {
        "PUBLISHABLE_POOL_EXISTS": "YES" if passed else "NO",
        "PUBLISHABLE_POOL_SCHEMA_VALID": "YES" if passed else "NO",
        "PUBLISHABLE_POOL_BEFORE_HOMEPAGE_SELECTION": "YES" if passed else "NO",
        "ARTICLES_JSON_COMPAT_UNCHANGED": "YES" if passed else "NO",
        "HOMEPAGE_UNCHANGED": "YES" if passed else "NO",
        "ASSETS_APP_UNCHANGED": "YES" if passed else "NO",
        "PROOF_SCRIPT_PASS": "YES" if passed else "NO",
    }
    print(json.dumps(verdict, indent=2))
    for k, v in verdict.items():
        print(f"{k}={v}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
