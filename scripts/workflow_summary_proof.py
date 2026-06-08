#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Phase 3D-B-2 proof: GitHub Actions operational closeout summary format."""

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
    INGEST_SUCCESS_RELEASE_BLOCKED,
    append_operational_closeout_github_summary,
    operational_summary_kv,
    record_aggregate_ok,
    record_ingest_ok,
    record_release_blocked,
)


def _read_repo_file(rel_path: str) -> str:
    path = os.path.join(ROOT, rel_path.replace("/", os.sep))
    with open(path, encoding="utf-8") as f:
        return f.read()


class WorkflowSummaryProofTests(unittest.TestCase):
    def test_summary_kv_example_format(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            data_dir = os.path.join(tmp, "projects", "data")
            os.makedirs(data_dir, exist_ok=True)
            record_ingest_ok(data_dir)
            record_aggregate_ok(data_dir, {"articles_full": [{}, {}], "articles_final": [{}, {}]})
            blocked = record_release_blocked(data_dir, guard_name="freshness-guard", guard_exit_code=1)
            kv = operational_summary_kv(blocked, INGEST_SUCCESS_RELEASE_BLOCKED)
            self.assertEqual(kv["INGEST_STATUS"], "OK")
            self.assertEqual(kv["AGGREGATE_STATUS"], "OK")
            self.assertEqual(kv["CLEAN_POOL_STATUS"], "CREATED")
            self.assertEqual(kv["RELEASE_STATUS"], "BLOCKED")
            self.assertEqual(kv["PUBLISH_STATUS"], "SKIPPED")
            self.assertEqual(kv["PIPELINE_OVERALL_STATUS"], "INGEST_SUCCESS_RELEASE_BLOCKED")

    def test_github_summary_writes_required_fields(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            summary_path = os.path.join(tmp, "summary.md")
            os.environ["GITHUB_STEP_SUMMARY"] = summary_path
            try:
                status = {
                    "ingest_status": "INGEST_OK",
                    "aggregate_status": "AGGREGATE_OK",
                    "clean_pool_status": "CLEAN_POOL_CREATED",
                    "release_status": "RELEASE_BLOCKED",
                    "publish_status": "PUBLISH_SKIPPED",
                }
                append_operational_closeout_github_summary(status, INGEST_SUCCESS_RELEASE_BLOCKED)
                text = open(summary_path, encoding="utf-8").read()
                for token in (
                    "INGEST_STATUS=OK",
                    "AGGREGATE_STATUS=OK",
                    "CLEAN_POOL_STATUS=CREATED",
                    "RELEASE_STATUS=BLOCKED",
                    "PUBLISH_STATUS=SKIPPED",
                    "PIPELINE_OVERALL_STATUS=INGEST_SUCCESS_RELEASE_BLOCKED",
                    "PIPELINE_ALERT_LEVEL | YELLOW",
                ):
                    self.assertIn(token, text, msg=f"missing {token}")
            finally:
                os.environ.pop("GITHUB_STEP_SUMMARY", None)

    def test_workflow_closeout_step_invokes_helper(self) -> None:
        wf = _read_repo_file(".github/workflows/update-articles.yml")
        block = wf.split("pipeline_operational_closeout:", 1)[1]
        self.assertIn("iu_pipeline_operational_closeout.py run", block)
        self.assertIn("PHASE_STATUS_PATH", block)
        self.assertIn("pipeline-phase-status-${{ github.run_id }}", block)

    def test_green_yellow_red_tokens_documented(self) -> None:
        src = _read_repo_file("scripts/iu_article_pipeline_phase_status.py")
        self.assertIn("PIPELINE_SUCCESS", src)
        self.assertIn("INGEST_SUCCESS_RELEASE_BLOCKED", src)
        self.assertIn("INGEST_FAILED", src)


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(WorkflowSummaryProofTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    passed = result.wasSuccessful()
    verdict = {
        "WORKFLOW_SUMMARY_PROOF": "PASS" if passed else "FAIL",
        "WORKFLOW_SUMMARY_IMPLEMENTED": "YES" if passed else "NO",
        "GREEN_STATES": "PIPELINE_SUCCESS,SKIPPED_DUPLICATE",
        "YELLOW_STATES": "INGEST_SUCCESS_RELEASE_BLOCKED",
        "RED_STATES": "INGEST_FAILED,AGGREGATE_FAILED,RELEASE_FAILED,RUN_CANCELLED,UNKNOWN_INCOMPLETE",
    }
    print(json.dumps(verdict, indent=2))
    for k, v in verdict.items():
        print(f"{k}={v}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
