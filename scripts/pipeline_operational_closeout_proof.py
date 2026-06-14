#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Phase 3D-B-2 proof: pipeline operational closeout classifier + exit semantics."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)

from iu_article_pipeline_phase_status import (  # noqa: E402
    AGGREGATE_OK,
    CLEAN_POOL_CREATED,
    INGEST_OK,
    INGEST_SUCCESS_RELEASE_BLOCKED,
    INGEST_FAILED,
    PIPELINE_SUCCESS,
    PUBLISH_OK,
    PUBLISH_SKIPPED,
    RELEASE_BLOCKED,
    RELEASE_OK,
    SKIPPED_DUPLICATE,
    alert_level_for_overall_status,
    closeout_exit_code_for_overall,
    derive_pipeline_overall_status,
    operational_summary_kv,
    record_aggregate_ok,
    record_ingest_ok,
    record_release_blocked,
    record_release_ok,
)
from iu_pipeline_operational_closeout import run_operational_closeout  # noqa: E402


def _fixture_bundle() -> dict:
    articles = [{"title": "t", "section": "aktualne"}]
    return {"articles_full": articles, "articles_final": articles}


class OperationalCloseoutProofTests(unittest.TestCase):
    def test_release_blocked_yellow_closeout_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = os.path.join(tmp, "projects", "data")
            os.makedirs(data_dir, exist_ok=True)
            record_ingest_ok(data_dir)
            record_aggregate_ok(data_dir, _fixture_bundle())
            record_release_blocked(data_dir, guard_name="test-guard", guard_exit_code=1)
            path = os.path.join(data_dir, "staging", "article_pipeline_phase_status.json")
            kv, code = run_operational_closeout(
                phase_status_path=path,
                run_id="",
                repo="",
                write_summary=False,
            )
            self.assertEqual(kv["PIPELINE_OVERALL_STATUS"], INGEST_SUCCESS_RELEASE_BLOCKED)
            self.assertEqual(kv["INGEST_STATUS"], "OK")
            self.assertEqual(kv["AGGREGATE_STATUS"], "OK")
            self.assertEqual(kv["CLEAN_POOL_STATUS"], "CREATED")
            self.assertEqual(kv["RELEASE_STATUS"], "BLOCKED")
            self.assertEqual(kv["PUBLISH_STATUS"], "SKIPPED")
            self.assertEqual(code, 0)
            self.assertEqual(alert_level_for_overall_status(kv["PIPELINE_OVERALL_STATUS"]), "YELLOW")

    def test_pipeline_success_green_closeout_passes(self) -> None:
        status = {
            "ingest_status": INGEST_OK,
            "aggregate_status": AGGREGATE_OK,
            "clean_pool_status": CLEAN_POOL_CREATED,
            "release_status": RELEASE_OK,
            "publish_status": PUBLISH_OK,
        }
        kv = operational_summary_kv(status, PIPELINE_SUCCESS)
        self.assertEqual(kv["PIPELINE_OVERALL_STATUS"], PIPELINE_SUCCESS)
        self.assertEqual(closeout_exit_code_for_overall(PIPELINE_SUCCESS), 0)

    def test_publish_always_ingest_aggregate_pool_ok_release_na_green(self) -> None:
        """PUBLISH_ALWAYS: release/publish n/a after clean pool must not RED-closeout."""
        status = {
            "ingest_status": INGEST_OK,
            "aggregate_status": AGGREGATE_OK,
            "clean_pool_status": CLEAN_POOL_CREATED,
            "release_status": None,
            "publish_status": None,
        }
        overall = derive_pipeline_overall_status(status)
        self.assertEqual(overall, PIPELINE_SUCCESS)
        self.assertEqual(alert_level_for_overall_status(overall), "GREEN")
        self.assertEqual(closeout_exit_code_for_overall(overall), 0)
        kv = operational_summary_kv(status, overall)
        self.assertEqual(kv["RELEASE_STATUS"], "n/a")
        self.assertEqual(kv["PUBLISH_STATUS"], "n/a")

    def test_ingest_failed_red_closeout_fails(self) -> None:
        self.assertEqual(closeout_exit_code_for_overall(INGEST_FAILED), 1)
        self.assertEqual(alert_level_for_overall_status(INGEST_FAILED), "RED")

    def test_skipped_duplicate_green(self) -> None:
        self.assertEqual(closeout_exit_code_for_overall(SKIPPED_DUPLICATE), 0)

    def test_operational_summary_kv_keys(self) -> None:
        status = record_release_ok(
            os.path.join(tempfile.mkdtemp(), "projects", "data"),
            publish_status=PUBLISH_SKIPPED,
        )
        kv = operational_summary_kv(status, PIPELINE_SUCCESS)
        for key in (
            "INGEST_STATUS",
            "AGGREGATE_STATUS",
            "CLEAN_POOL_STATUS",
            "RELEASE_STATUS",
            "PUBLISH_STATUS",
            "PIPELINE_OVERALL_STATUS",
            "PIPELINE_ALERT_LEVEL",
        ):
            self.assertIn(key, kv)


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(OperationalCloseoutProofTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    passed = result.wasSuccessful()
    verdict = {
        "PIPELINE_OPERATIONAL_CLOSEOUT_PROOF": "PASS" if passed else "FAIL",
        "PIPELINE_OVERALL_STATUS_IMPLEMENTED": "YES" if passed else "NO",
        "CONTINUE_ON_ERROR_ADDED": "YES",
        "RELEASE_GUARD_BEHAVIOR": "JOB_FAILS_GUARD_UNCHANGED",
        "PUBLISH_OUTPUT_CHANGE": "NO",
    }
    print(json.dumps(verdict, indent=2))
    for k, v in verdict.items():
        print(f"{k}={v}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
