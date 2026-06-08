#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 3D-B-2 proof: release-blocked semantics — guards unchanged, job-level continue-on-error only.
"""

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
    INGEST_SUCCESS_RELEASE_BLOCKED,
    derive_pipeline_overall_status,
    record_aggregate_ok,
    record_ingest_ok,
    record_release_blocked,
)


def _read_repo_file(rel_path: str) -> str:
    path = os.path.join(ROOT, rel_path.replace("/", os.sep))
    with open(path, encoding="utf-8") as f:
        return f.read()


def _release_job_block(wf: str) -> str:
    start = wf.index("  article_data_release:")
    end = wf.index("\n  pipeline_operational_closeout:", start)
    return wf[start:end]


def _release_job_header(wf: str) -> str:
    block = _release_job_block(wf)
    return block.split("steps:", 1)[0]


def _guard_step_blocks(wf: str) -> list[str]:
    """Step blocks for release guards only (excludes PR/closeout steps)."""
    block = _release_job_block(wf).split("steps:", 1)[1]
    guard_markers = (
        "Articles aggregator freshness guard",
        "Missing source articles guard",
        "Source display clean guard",
        "Source URL consistency guard",
        "Section coverage guard",
        "Source rotation guard",
        "Source frequency guard",
        "Incremental publish guard",
        "Priority source freshness guard",
        "Crawler identity guard",
        "Robots compliance guard",
        "Backpressure guard",
        "Publish continuity guard",
        "Topic dedupe false-positive guard",
        "Duplicate metadata guard",
        "Content freshness guard",
        "Active article trace guard",
        "Production liveness guard",
        "Release freshness gate",
        "P0 source starvation guard",
        "P0 source coverage guard",
        "Same-topic overexposure guard",
        "Aggregator legacy cleanup guard",
        "Dedupe loss guard",
        "Section purity guard",
        "Release conflict marker guard",
        "CZ vertical data guard",
        "CZ vertical flow guard",
    )
    steps = block.split("\n      - name:")
    out: list[str] = []
    for step in steps[1:]:
        head = step.split("\n", 1)[0]
        if any(marker in head for marker in guard_markers):
            out.append(step)
    return out


class ReleaseBlockedSemanticsProofTests(unittest.TestCase):
    def test_release_blocked_maps_to_yellow_overall(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            data_dir = os.path.join(tmp, "projects", "data")
            os.makedirs(data_dir, exist_ok=True)
            record_ingest_ok(data_dir)
            record_aggregate_ok(data_dir, {"articles_full": [{}], "articles_final": [{}]})
            blocked = record_release_blocked(data_dir, guard_name="release-freshness-gate", guard_exit_code=1)
            overall = derive_pipeline_overall_status(blocked)
            self.assertEqual(overall, INGEST_SUCCESS_RELEASE_BLOCKED)

    def test_continue_on_error_only_on_release_job_header(self) -> None:
        wf = _read_repo_file(".github/workflows/update-articles.yml")
        header = _release_job_header(wf)
        self.assertIn("continue-on-error: true", header)
        self.assertEqual(header.count("continue-on-error: true"), 1)

    def test_guards_have_no_continue_on_error(self) -> None:
        wf = _read_repo_file(".github/workflows/update-articles.yml")
        for step in _guard_step_blocks(wf):
            self.assertNotIn(
                "continue-on-error: true",
                step,
                msg=f"guard step must not bypass failures: {step.splitlines()[0]}",
            )

    def test_finalize_release_still_records_blocked_not_bypass(self) -> None:
        src = _read_repo_file("scripts/iu_article_pipeline_phase_status.py")
        self.assertIn("record_release_blocked", src)
        self.assertNotIn("sys.exit(0)", src.split("def cmd_finalize_release", 1)[1].split("def ", 1)[0])

    def test_release_job_still_has_finalize_step(self) -> None:
        wf = _read_repo_file(".github/workflows/update-articles.yml")
        release_block = _release_job_block(wf)
        self.assertIn("finalize-release", release_block)
        self.assertIn("Record pipeline phase status", release_block)

    def test_closeout_job_present(self) -> None:
        wf = _read_repo_file(".github/workflows/update-articles.yml")
        self.assertIn("pipeline_operational_closeout:", wf)
        self.assertIn("if: always()", wf.split("pipeline_operational_closeout:", 1)[1][:300])
        self.assertIn("iu_pipeline_operational_closeout.py run", wf)

    def test_publish_path_unchanged(self) -> None:
        src = _read_repo_file("scripts/build_articles.py")
        pub = src.split("def _publish_article_outputs", 1)[1].split("\ndef ", 1)[0]
        self.assertNotIn("continue-on-error", pub)
        self.assertNotIn("operational_closeout", pub)


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ReleaseBlockedSemanticsProofTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    passed = result.wasSuccessful()
    verdict = {
        "RELEASE_BLOCKED_SEMANTICS_PROOF": "PASS" if passed else "FAIL",
        "RELEASE_GUARD_BEHAVIOR": "JOB_FAILS_GUARD_UNCHANGED" if passed else "UNKNOWN",
        "CONTINUE_ON_ERROR_ADDED": "YES" if passed else "NO",
        "GUARD_BYPASS": "NO" if passed else "CHECK",
        "PUBLISH_OUTPUT_CHANGE": "NO",
    }
    print(json.dumps(verdict, indent=2))
    for k, v in verdict.items():
        print(f"{k}={v}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
