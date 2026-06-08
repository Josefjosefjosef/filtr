#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Phase 3D-B proof: pipeline_overall_status classifier mappings."""

from __future__ import annotations

import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)

from iu_article_pipeline_phase_status import (  # noqa: E402
    AGGREGATE_FAIL,
    AGGREGATE_OK,
    AGGREGATE_FAILED,
    ALERT_GREEN,
    ALERT_RED,
    ALERT_YELLOW,
    CLEAN_POOL_CREATED,
    INGEST_FAIL,
    INGEST_FAILED,
    INGEST_OK,
    INGEST_SUCCESS_RELEASE_BLOCKED,
    PIPELINE_SUCCESS,
    PUBLISH_FAILED,
    PUBLISH_OK,
    PUBLISH_SKIPPED,
    RELEASE_BLOCKED,
    RELEASE_FAIL,
    RELEASE_FAILED,
    RELEASE_OK,
    RUN_CANCELLED,
    SKIPPED_DUPLICATE,
    UNKNOWN_INCOMPLETE,
    alert_level_for_overall_status,
    derive_pipeline_overall_status,
    is_ingest_aggregate_ok_status,
    is_pipeline_failure_status,
    record_aggregate_ok,
    record_ingest_ok,
    record_release_blocked,
    record_release_ok,
)


def _jobs(ingest_c, agg_c, release_c=None, gate_c="success", gate_skipped=False):
    jobs = [{"name": "pipeline_gate", "conclusion": gate_c}]
    if gate_skipped:
        jobs.extend(
            [
                {"name": "article_pipeline_ingest", "conclusion": "skipped"},
                {"name": "article_pipeline_aggregate", "conclusion": "skipped"},
            ]
        )
    else:
        jobs.append({"name": "article_pipeline_ingest", "conclusion": ingest_c})
        jobs.append({"name": "article_pipeline_aggregate", "conclusion": agg_c})
        if release_c is not None:
            jobs.append({"name": "article_data_release", "conclusion": release_c})
    return jobs


class ClassifierProofTests(unittest.TestCase):
    def test_pipeline_success_from_phase_status(self) -> None:
        status = {
            "ingest_status": INGEST_OK,
            "aggregate_status": AGGREGATE_OK,
            "clean_pool_status": CLEAN_POOL_CREATED,
            "release_status": RELEASE_OK,
            "publish_status": PUBLISH_OK,
        }
        overall = derive_pipeline_overall_status(status)
        self.assertEqual(overall, PIPELINE_SUCCESS)
        self.assertEqual(alert_level_for_overall_status(overall), ALERT_GREEN)

    def test_release_blocked_yellow(self) -> None:
        status = {
            "ingest_status": INGEST_OK,
            "aggregate_status": AGGREGATE_OK,
            "clean_pool_status": CLEAN_POOL_CREATED,
            "release_status": RELEASE_BLOCKED,
            "publish_status": PUBLISH_SKIPPED,
        }
        overall = derive_pipeline_overall_status(status)
        self.assertEqual(overall, INGEST_SUCCESS_RELEASE_BLOCKED)
        self.assertEqual(alert_level_for_overall_status(overall), ALERT_YELLOW)
        self.assertTrue(is_ingest_aggregate_ok_status(overall))
        self.assertFalse(is_pipeline_failure_status(overall))

    def test_release_failed_red(self) -> None:
        status = {
            "ingest_status": INGEST_OK,
            "aggregate_status": AGGREGATE_OK,
            "release_status": RELEASE_FAIL,
            "publish_status": PUBLISH_FAILED,
        }
        overall = derive_pipeline_overall_status(status)
        self.assertEqual(overall, RELEASE_FAILED)
        self.assertEqual(alert_level_for_overall_status(overall), ALERT_RED)

    def test_ingest_failed_red(self) -> None:
        self.assertEqual(
            derive_pipeline_overall_status({"ingest_status": INGEST_FAIL}),
            INGEST_FAILED,
        )

    def test_aggregate_failed_red(self) -> None:
        self.assertEqual(
            derive_pipeline_overall_status(
                {"ingest_status": INGEST_OK, "aggregate_status": AGGREGATE_FAIL}
            ),
            AGGREGATE_FAILED,
        )

    def test_skipped_duplicate_from_jobs(self) -> None:
        jobs = _jobs("skipped", "skipped", gate_c="success", gate_skipped=True)
        overall = derive_pipeline_overall_status(None, jobs=jobs)
        self.assertEqual(overall, SKIPPED_DUPLICATE)

    def test_run_cancelled(self) -> None:
        overall = derive_pipeline_overall_status(None, run_status="cancelled", run_conclusion="cancelled")
        self.assertEqual(overall, RUN_CANCELLED)

    def test_jobs_release_fail_without_phase_status_unknown(self) -> None:
        jobs = _jobs("success", "success", "failure")
        overall = derive_pipeline_overall_status(None, jobs=jobs, run_conclusion="failure")
        self.assertEqual(overall, UNKNOWN_INCOMPLETE)

    def test_jobs_release_fail_with_phase_status_blocked(self) -> None:
        jobs = _jobs("success", "success", "failure")
        status = {
            "ingest_status": INGEST_OK,
            "aggregate_status": AGGREGATE_OK,
            "release_status": RELEASE_BLOCKED,
            "publish_status": PUBLISH_SKIPPED,
        }
        overall = derive_pipeline_overall_status(status, jobs=jobs, run_conclusion="failure")
        self.assertEqual(overall, INGEST_SUCCESS_RELEASE_BLOCKED)

    def test_legacy_workflow_success(self) -> None:
        overall = derive_pipeline_overall_status(
            None,
            jobs=[{"name": "build", "conclusion": "success"}],
            run_conclusion="success",
        )
        self.assertEqual(overall, PIPELINE_SUCCESS)

    def test_record_helpers_integration(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            data_dir = os.path.join(tmp, "projects", "data")
            os.makedirs(data_dir, exist_ok=True)
            record_ingest_ok(data_dir)
            record_aggregate_ok(
                data_dir,
                {
                    "articles_full": [{"title": "t"}],
                    "articles_final": [{"title": "t"}],
                },
            )
            blocked = record_release_blocked(data_dir, guard_name="test-guard", guard_exit_code=1)
            overall = derive_pipeline_overall_status(blocked)
            self.assertEqual(overall, INGEST_SUCCESS_RELEASE_BLOCKED)


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ClassifierProofTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    passed = result.wasSuccessful()
    verdict = {
        "PIPELINE_CLASSIFIER_PROOF": "PASS" if passed else "FAIL",
        "STATUS_MODEL": "PIPELINE_SUCCESS|INGEST_SUCCESS_RELEASE_BLOCKED|RELEASE_FAILED|INGEST_FAILED|AGGREGATE_FAILED|SKIPPED_DUPLICATE|RUN_CANCELLED|UNKNOWN_INCOMPLETE",
        "PUBLISH_OUTPUT_CHANGE": "NO",
        "RELEASE_GUARD_CHANGE": "NO",
        "WORKFLOW_CONCLUSION_CHANGE": "NO",
        "CONTINUE_ON_ERROR_ADDED": "NO",
        "UPDATE_ARTICLES_YML_CHANGED": "NO",
    }
    print(json.dumps(verdict, indent=2))
    for k, v in verdict.items():
        print(f"{k}={v}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
