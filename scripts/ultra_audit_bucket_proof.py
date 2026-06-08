#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Phase 3D-B proof: ultra_audit wiki pipeline bucket model."""

from __future__ import annotations

import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)

from generate_ultra_audit_wiki import (  # noqa: E402
    _runtime_snapshot_json,
    render_runtime_24h_section,
)
from iu_pipeline_run_classifier import BUCKET_KEYS, empty_bucket_counts  # noqa: E402


class UltraAuditBucketProofTests(unittest.TestCase):
    def test_empty_bucket_keys(self) -> None:
        counts = empty_bucket_counts()
        for key in BUCKET_KEYS:
            self.assertIn(key, counts)
            self.assertEqual(counts[key], 0)

    def test_runtime_snapshot_includes_buckets(self) -> None:
        buckets = empty_bucket_counts()
        buckets["PIPELINE_SUCCESS"] = 2
        buckets["INGEST_SUCCESS_RELEASE_BLOCKED"] = 1
        snap = _runtime_snapshot_json({}, [], buckets, None)
        data = json.loads(snap.replace("…", "") if snap.endswith("…") else snap)
        self.assertEqual(data["pipeline_runs_24h"]["PIPELINE_SUCCESS"], 2)
        self.assertEqual(data["pipeline_runs_24h"]["INGEST_SUCCESS_RELEASE_BLOCKED"], 1)
        self.assertNotIn("gh_success_runs_24h", data)

    def test_render_lists_bucket_lines(self) -> None:
        from datetime import datetime, timezone

        buckets = empty_bucket_counts()
        buckets["INGEST_SUCCESS_RELEASE_BLOCKED"] = 3
        text = render_runtime_24h_section({}, [], buckets, datetime.now(timezone.utc))
        self.assertIn("INGEST_SUCCESS_RELEASE_BLOCKED", text)
        self.assertIn("PIPELINE_SUCCESS", text)
        self.assertIn("YELLOW", text)


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(UltraAuditBucketProofTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    passed = result.wasSuccessful()
    print(f"ULTRA_AUDIT_BUCKET_PROOF={'PASS' if passed else 'FAIL'}")
    print("WORKFLOW_CONCLUSION_CHANGE=NO")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
