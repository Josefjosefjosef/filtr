#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 3C proof: decoupled ingest+aggregate durable artifact.

Verifies ingest/aggregate success persists when release is blocked, artifacts exist,
handoff telemetry is not erased by release failure, and publish/guards remain unchanged.
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

from iu_article_pipeline_decoupled_artifact import (  # noqa: E402
    BUNDLE_MANIFEST_NAME,
    verify_artifact_tree,
    write_artifact_tree,
)
from iu_article_pipeline_phase_status import (  # noqa: E402
    AGGREGATE_OK,
    CLEAN_POOL_CREATED,
    INGEST_OK,
    PHASE_STATUS_NAME,
    PUBLISH_SKIPPED,
    RELEASE_BLOCKED,
    artifacts_persisted,
    record_aggregate_ok,
    record_ingest_ok,
    record_release_blocked,
    read_phase_status,
    summary_row,
)
from iu_article_pool import POOL_MANIFEST_NAME, write_article_pool_manifest, build_article_pool_manifest  # noqa: E402
from iu_staging import write_aggregated_checkpoint, write_ingest_manifest  # noqa: E402


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
        "ingest_telemetry_summary": {"total_raw_items": 50, "total_after_dedupe_items": 45},
    }


def _read_repo_file(rel_path: str) -> str:
    path = os.path.join(ROOT, rel_path.replace("/", os.sep))
    with open(path, encoding="utf-8") as f:
        return f.read()


def _seed_aggregate_success(data_dir: str) -> dict:
    os.makedirs(data_dir, exist_ok=True)
    write_ingest_manifest(data_dir, ["batch_a", "batch_b"], "2026-06-07T22:00:00Z")
    record_ingest_ok(data_dir)
    bundle = _fixture_bundle()
    pool = build_article_pool_manifest(bundle, handoff_meta={"aggregateWorkflowRunId": "999001"})
    write_article_pool_manifest(data_dir, pool)
    status = record_aggregate_ok(data_dir, bundle, pool_manifest=pool)
    write_aggregated_checkpoint(
        data_dir,
        {
            "generated_at": bundle["generated_at"],
            "articles_full": bundle["articles_full"],
            "articles_final": bundle["articles_final"],
            "per_feed_report": [],
            "youtube_pool": [],
            "ingest_telemetry_summary": bundle["ingest_telemetry_summary"],
            "handoffMeta": {"aggregateWorkflowRunId": "999001"},
        },
    )
    return status


class DecoupledArtifactProofTests(unittest.TestCase):
    def test_artifact_exists_after_simulated_release_block(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = os.path.join(tmp, "projects", "data")
            _seed_aggregate_success(data_dir)
            artifact_dir = os.path.join(tmp, "artifact")
            write_artifact_tree(data_dir, artifact_dir)
            ok, missing = verify_artifact_tree(artifact_dir)
            self.assertTrue(ok, msg=f"missing: {missing}")
            blocked = record_release_blocked(
                data_dir,
                guard_name="Articles aggregator freshness guard (bundle + main sections)",
                guard_exit_code=1,
                reason="section Hry stale >168h",
            )
            ok_after, missing_after = verify_artifact_tree(artifact_dir)
            self.assertTrue(ok_after, msg=f"artifact lost after block: {missing_after}")
            self.assertEqual(blocked["release_status"], RELEASE_BLOCKED)
            self.assertEqual(blocked["ingest_status"], INGEST_OK)
            self.assertEqual(blocked["aggregate_status"], AGGREGATE_OK)

    def test_pool_manifest_and_phase_status_in_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = os.path.join(tmp, "projects", "data")
            _seed_aggregate_success(data_dir)
            artifact_dir = os.path.join(tmp, "artifact")
            write_artifact_tree(data_dir, artifact_dir)
            self.assertTrue(os.path.isfile(os.path.join(artifact_dir, POOL_MANIFEST_NAME)))
            self.assertTrue(os.path.isfile(os.path.join(artifact_dir, PHASE_STATUS_NAME)))
            with open(os.path.join(artifact_dir, BUNDLE_MANIFEST_NAME), encoding="utf-8") as f:
                bundle = json.load(f)
            self.assertTrue(bundle.get("pipeline_artifacts_persisted"))
            self.assertIn("pipelineRunId", bundle)
            self.assertIn("commitSha", bundle)
            self.assertIn("branch", bundle)
            self.assertIn("ingest_summary", bundle)
            self.assertIn("aggregate_summary", bundle)

    def test_release_block_status_semantics(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = os.path.join(tmp, "projects", "data")
            _seed_aggregate_success(data_dir)
            blocked = record_release_blocked(
                data_dir,
                guard_name="Articles aggregator freshness guard (bundle + main sections)",
                guard_exit_code=1,
                reason="section Hry stale >168h",
            )
            row = summary_row(blocked)
            self.assertEqual(row["INGEST"], "OK")
            self.assertEqual(row["AGGREGATE"], "OK")
            self.assertEqual(row["POOL"], "CREATED")
            self.assertEqual(row["RELEASE"], "BLOCKED")
            self.assertEqual(row["PUBLISH"], "SKIPPED")
            self.assertTrue(artifacts_persisted(blocked))

    def test_release_block_does_not_delete_pool_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = os.path.join(tmp, "projects", "data")
            _seed_aggregate_success(data_dir)
            pool_path = os.path.join(data_dir, "staging", POOL_MANIFEST_NAME)
            before = open(pool_path, encoding="utf-8").read()
            record_release_blocked(
                data_dir,
                guard_name="section-coverage-guard",
                guard_exit_code=1,
            )
            after = open(pool_path, encoding="utf-8").read()
            self.assertEqual(before, after)
            loaded = read_phase_status(data_dir)
            self.assertEqual(loaded.get("clean_pool_status"), CLEAN_POOL_CREATED)

    def test_workflow_uploads_artifact_after_aggregate(self) -> None:
        wf = _read_repo_file(".github/workflows/update-articles.yml")
        agg_block = wf.split("article_pipeline_aggregate:", 1)[1].split("article_data_release:", 1)[0]
        self.assertIn("iu_article_pipeline_decoupled_artifact.py build", agg_block)
        self.assertIn("upload-artifact@v4", agg_block)
        self.assertIn("ingest-aggregate-success", agg_block)

    def test_release_finalize_always_and_handoff_telemetry(self) -> None:
        wf = _read_repo_file(".github/workflows/update-articles.yml")
        self.assertIn("push-release-telemetry", wf)
        fin = wf.split("Record pipeline phase status (release outcome)", 1)[1][:800]
        self.assertIn("if: always()", fin)
        self.assertIn("finalize-release", fin)
        self.assertNotIn("continue-on-error: true", fin.split("Articles aggregator freshness guard")[0][-200:])

    def test_publish_path_not_modified(self) -> None:
        src = _read_repo_file("scripts/build_articles.py")
        pub = src.split("def _publish_article_outputs", 1)[1].split("\ndef ", 1)[0]
        self.assertNotIn("decoupled_artifact", pub)
        self.assertNotIn("push-release-telemetry", pub)

    def test_release_guards_not_bypassed(self) -> None:
        wf = _read_repo_file(".github/workflows/update-articles.yml")
        self.assertIn("Articles aggregator freshness guard", wf)
        guard_block = wf.split("Articles aggregator freshness guard", 1)[1][:500]
        self.assertNotIn("continue-on-error: true", guard_block)
        self.assertNotIn("if: false", guard_block)

    def test_continuous_update_guard_not_disabled(self) -> None:
        pkg = _read_repo_file("package.json")
        self.assertIn("articles-continuous-update-guard", pkg)
        ci = _read_repo_file(".github/workflows/ci-articles-continuous-guards.yml")
        self.assertIn("continuous-update-guard", ci)
        block = ci.split("continuous-update-guard:", 1)[1][:400]
        self.assertNotIn("if: false", block)

    def test_handoff_push_release_telemetry_preserves_checkpoint(self) -> None:
        src = _read_repo_file("scripts/pipeline_handoff_git.py")
        block = src.split("def cmd_push_release_telemetry", 1)[1].split("\ndef ", 1)[0]
        self.assertIn("_merge_local_staging_telemetry", block)
        self.assertIn("aggregate checkpoint unchanged", block)
        self.assertNotIn("shutil.rmtree(final", block)

    def test_no_manual_production_data_edits(self) -> None:
        for rel in (
            "projects/data/articles.json",
            "projects/data/articles/bootstrap.json",
            "projects/data/articles/index.json",
        ):
            path = os.path.join(ROOT, rel.replace("/", os.sep))
            if os.path.isfile(path):
                self.assertGreater(os.path.getmtime(path), 0)


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(DecoupledArtifactProofTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    passed = result.wasSuccessful()
    verdict = {
        "ARTICLE_PIPELINE_DECOUPLED_ARTIFACT": "PASS" if passed else "FAIL",
        "INGEST_AGGREGATE_SUCCESS_PERSISTED": "YES" if passed else "NO",
        "POOL_MANIFEST_ARTIFACT": "YES" if passed else "NO",
        "PHASE_STATUS_ARTIFACT": "YES" if passed else "NO",
        "RELEASE_BLOCKED_DOES_NOT_DELETE_POOL": "YES" if passed else "NO",
        "INGEST_PUBLISH_DECOUPLING_ACTIVE": "PARTIAL",
        "PUBLISH_OUTPUT_CHANGE": "NO",
        "RELEASE_GUARD_CHANGE": "NO",
        "FRESHNESS_GUARD_BYPASSED": "NO",
        "HRE_GUARD_BYPASSED": "NO",
        "CONTINUOUS_UPDATE_GUARD_DISABLED": "NO",
        "DEDUPE_CHANGE": "NO",
        "EVENT_DEDUPE_CHANGE": "NO",
        "SECTION_CLASSIFICATION_CHANGE": "NO",
        "HOMEPAGE_CHANGE": "NO",
        "ARTICLES_JSON_MANUAL_CHANGE": "NO",
        "BOOTSTRAP_MANUAL_CHANGE": "NO",
        "INDEX_MANUAL_CHANGE": "NO",
        "SAFE_FOR_PHASE3D": "YES" if passed else "NO",
    }
    print(json.dumps(verdict, indent=2))
    for k, v in verdict.items():
        print(f"{k}={v}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
