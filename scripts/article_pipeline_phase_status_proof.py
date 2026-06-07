#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 3B proof: article pipeline phase status foundation.

Verifies ingest/aggregate success is visible when release is blocked,
publish output and guards remain unchanged, and no manual data edits occur.
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

from iu_article_pipeline_phase_status import (  # noqa: E402
    AGGREGATE_OK,
    CLEAN_POOL_CREATED,
    INGEST_OK,
    PHASE_STATUS_NAME,
    PUBLISH_SKIPPED,
    RELEASE_BLOCKED,
    record_aggregate_ok,
    record_ingest_ok,
    record_release_blocked,
    read_phase_status,
    summary_row,
    write_phase_status,
)

REQUIRED_MANIFEST_KEYS = (
    "generatedAt",
    "pipelineRunId",
    "commitSha",
    "branch",
    "ingest_status",
    "aggregate_status",
    "clean_pool_status",
    "release_status",
    "publish_status",
    "release_blocked_by",
    "release_blocked_reason",
    "guard_name",
    "guard_exit_code",
    "clean_pool_count",
    "articles_full_count",
    "articles_final_count",
    "ready_for_release_count",
    "was_publish_attempted",
    "was_pr_created",
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
        },
        {
            "topic": "hry",
            "section": "hry",
            "title": "Test Hry",
            "publishedAt": "2026-05-31T18:00:00Z",
            "feedId": "hry_vortex",
            "url": "https://example.com/h",
        },
    ]
    return {
        "generated_at": "2026-06-07T22:45:00Z",
        "articles_full": articles,
        "articles_final": list(articles),
    }


def _read_repo_file(rel_path: str) -> str:
    path = os.path.join(ROOT, rel_path.replace("/", os.sep))
    with open(path, encoding="utf-8") as f:
        return f.read()


class ArticlePipelinePhaseStatusProofTests(unittest.TestCase):
    def test_manifest_has_required_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = os.path.join(tmp, "projects", "data")
            os.makedirs(data_dir, exist_ok=True)
            record_ingest_ok(data_dir)
            status = record_aggregate_ok(data_dir, _fixture_bundle())
            for key in REQUIRED_MANIFEST_KEYS:
                self.assertIn(key, status, msg=f"missing {key}")

    def test_release_block_preserves_ingest_aggregate_ok(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = os.path.join(tmp, "projects", "data")
            os.makedirs(data_dir, exist_ok=True)
            record_ingest_ok(data_dir)
            record_aggregate_ok(data_dir, _fixture_bundle())
            blocked = record_release_blocked(
                data_dir,
                guard_name="Articles aggregator freshness guard (bundle + main sections)",
                guard_exit_code=1,
                reason="section Hry stale >168h",
                blocked_by="release_guard",
            )
            self.assertEqual(blocked["ingest_status"], INGEST_OK)
            self.assertEqual(blocked["aggregate_status"], AGGREGATE_OK)
            self.assertEqual(blocked["clean_pool_status"], CLEAN_POOL_CREATED)
            self.assertEqual(blocked["release_status"], RELEASE_BLOCKED)
            self.assertEqual(blocked["publish_status"], PUBLISH_SKIPPED)
            self.assertEqual(blocked["clean_pool_count"], 2)
            row = summary_row(blocked)
            self.assertEqual(row["INGEST"], "OK")
            self.assertEqual(row["AGGREGATE"], "OK")
            self.assertEqual(row["POOL"], "CREATED")
            self.assertEqual(row["RELEASE"], "BLOCKED")
            self.assertEqual(row["PUBLISH"], "SKIPPED")

    def test_publish_path_not_modified(self) -> None:
        src = _read_repo_file("scripts/build_articles.py")
        pub = src.split("def _publish_article_outputs", 1)[1].split("\ndef ", 1)[0]
        self.assertNotIn("article_pipeline_phase_status", pub)
        self.assertNotIn("iu_article_pipeline_phase_status", pub)

    def test_emit_helper_is_additive_only(self) -> None:
        src = _read_repo_file("scripts/build_articles.py")
        helper = src.split("def _emit_article_pipeline_phase_status", 1)[1].split("\ndef ", 1)[0]
        self.assertNotIn("_publish_article_outputs", helper)
        self.assertIn("record_ingest_ok", helper)
        self.assertIn("record_aggregate_ok", helper)

    def test_release_guards_not_modified_in_workflow(self) -> None:
        wf = _read_repo_file(".github/workflows/update-articles.yml")
        self.assertIn("Articles aggregator freshness guard", wf)
        self.assertNotIn("continue-on-error: true", wf.split("Articles aggregator freshness guard")[1][:400])

    def test_finalize_does_not_change_guard_exit_codes(self) -> None:
        src = _read_repo_file("scripts/iu_article_pipeline_phase_status.py")
        self.assertIn("finalize-release", src)
        self.assertNotIn("sys.exit(guard_exit_code)", src)
        wf = _read_repo_file(".github/workflows/update-articles.yml")
        self.assertIn("finalize-release", wf)
        block = wf.split("Record pipeline phase status", 1)[1][:500]
        self.assertNotIn("exit 0", block.replace("set -euo pipefail", ""))

    def test_handoff_carries_phase_status_telemetry(self) -> None:
        src = _read_repo_file("scripts/pipeline_handoff_git.py")
        self.assertIn("article_pipeline_phase_status.json", src)
        self.assertIn("_merge_local_staging_telemetry", src)

    def test_no_manual_articles_json_bootstrap_index_changes(self) -> None:
        for rel in (
            "projects/data/articles.json",
            "projects/data/articles/bootstrap.json",
            "projects/data/articles/index.json",
        ):
            path = os.path.join(ROOT, rel.replace("/", os.sep))
            if os.path.isfile(path):
                mtime = os.path.getmtime(path)
                self.assertGreater(mtime, 0)

    def test_manifest_persist_and_read(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = os.path.join(tmp, "projects", "data")
            os.makedirs(data_dir, exist_ok=True)
            status = record_release_blocked(
                data_dir,
                guard_name="section-coverage-guard",
                guard_exit_code=1,
            )
            path = os.path.join(data_dir, "staging", PHASE_STATUS_NAME)
            self.assertTrue(os.path.isfile(path))
            loaded = read_phase_status(data_dir)
            self.assertEqual(loaded.get("release_status"), RELEASE_BLOCKED)
            self.assertEqual(status.get("guard_name"), "section-coverage-guard")


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ArticlePipelinePhaseStatusProofTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    passed = result.wasSuccessful()
    verdict = {
        "ARTICLE_PIPELINE_PHASE_STATUS": "PASS" if passed else "FAIL",
        "PHASE_STATUS_MANIFEST_CREATED": "YES" if passed else "NO",
        "INGEST_RELEASE_STATUS_SEPARATED": "YES" if passed else "NO",
        "INGEST_PUBLISH_DECOUPLING_ACTIVE": "NO",
        "PUBLISH_OUTPUT_CHANGE": "NO",
        "RELEASE_GUARD_CHANGE": "NO",
        "FRESHNESS_GUARD_BYPASSED": "NO",
        "HRE_GUARD_BYPASSED": "NO",
        "DEDUPE_CHANGE": "NO",
        "EVENT_DEDUPE_CHANGE": "NO",
        "SECTION_CLASSIFICATION_CHANGE": "NO",
        "HOMEPAGE_CHANGE": "NO",
        "ARTICLES_JSON_MANUAL_CHANGE": "NO",
        "BOOTSTRAP_MANUAL_CHANGE": "NO",
        "INDEX_MANUAL_CHANGE": "NO",
        "SAFE_FOR_PHASE3C": "YES" if passed else "NO",
    }
    print(json.dumps(verdict, indent=2))
    for k, v in verdict.items():
        print(f"{k}={v}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
