#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Proof: fast pool workflow cleans known runtime artifacts before git clean guard
without masking unexpected dirty files or dropping committed data paths.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "update-articles-fast-pool.yml"

RUNTIME_ARTIFACTS = (
    "iu_content_freshness_guard_report.json",
    "projects/data/robots_cache.json",
)


def _cleanup_runtime_artifacts(repo_root: Path) -> None:
    for rel in RUNTIME_ARTIFACTS:
        path = repo_root / rel
        if path.is_file():
            path.unlink()


def _git_porcelain(repo_root: Path) -> str:
    proc = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=False,
    )
    return proc.stdout.strip()


class FastPoolCleanGuardProofTests(unittest.TestCase):
    def test_workflow_cleans_runtime_artifacts_before_git_clean_guard(self) -> None:
        content = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("Clean fast pool runtime artifacts", content)
        for rel in RUNTIME_ARTIFACTS:
            self.assertIn(rel, content)
        cleanup_idx = content.find("Clean fast pool runtime artifacts")
        guard_idx = content.find("Git clean guard")
        self.assertGreater(cleanup_idx, -1)
        self.assertGreater(guard_idx, -1)
        self.assertLess(cleanup_idx, guard_idx)

    def test_runtime_artifacts_removed_data_preserved(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            data_dir = repo / "projects" / "data"
            data_dir.mkdir(parents=True)
            pool_path = data_dir / "publishable_pool.json"
            pool_path.write_text('{"articles":[],"counts":{"total":1}}', encoding="utf-8")
            for rel in RUNTIME_ARTIFACTS:
                path = repo / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("{}", encoding="utf-8")

            _cleanup_runtime_artifacts(repo)

            for rel in RUNTIME_ARTIFACTS:
                self.assertFalse((repo / rel).exists(), msg=rel)
            self.assertTrue(pool_path.exists())
            self.assertEqual(pool_path.read_text(encoding="utf-8"), '{"articles":[],"counts":{"total":1}}')

    def test_unexpected_dirty_file_still_detected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            subprocess.run(["git", "init"], cwd=repo, capture_output=True, check=True)
            surprise = repo / "unexpected_dirty.txt"
            surprise.write_text("leak", encoding="utf-8")
            for rel in RUNTIME_ARTIFACTS:
                path = repo / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("{}", encoding="utf-8")

            _cleanup_runtime_artifacts(repo)

            self.assertTrue(surprise.exists())
            porcelain = _git_porcelain(repo)
            self.assertIn("unexpected_dirty.txt", porcelain)
            for rel in RUNTIME_ARTIFACTS:
                self.assertNotIn(rel, porcelain)

    def test_gitignore_blocks_runtime_artifacts(self) -> None:
        gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
        for rel in RUNTIME_ARTIFACTS:
            self.assertIn(rel, gitignore)


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(FastPoolCleanGuardProofTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    passed = result.wasSuccessful()
    verdict = {
        "FAST_POOL_CLEAN_GUARD_PROOF": "PASS" if passed else "FAIL",
        "RUNTIME_ARTIFACT_BLOCKER_GONE": "YES" if passed else "NO",
        "UNEXPECTED_DIRTY_STILL_FAILS": "YES" if passed else "NO",
        "DATA_FILES_PRESERVED": "YES" if passed else "NO",
    }
    print(json.dumps(verdict, indent=2))
    for k, v in verdict.items():
        print(f"{k}={v}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
