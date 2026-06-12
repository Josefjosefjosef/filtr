#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Guard: slow articles release workflow must prepare automation branch before data
generation, must not checkout another branch after local data changes, and must
clean runtime guard reports before git clean guard.
"""

from __future__ import annotations

import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "update-articles.yml"
RELEASE_JOB = "article_data_release"

RUNTIME_ARTIFACTS = (
    "iu_content_freshness_guard_report.json",
    "iu_active_article_trace_report.json",
    "iu_p0_source_coverage_report.json",
    "iu_production_liveness_report.json",
    "projects/data/robots_cache.json",
)

DATA_STEP_MARKERS = (
    "Load persisted aggregate output for publish",
    "Article pipeline — publish",
)

PREP_BRANCH_MARKERS = (
    "Prepare automation branch",
)

FINAL_STAGING_STEP = "Final release data staging (all generators + guards complete)"

GIT_CLEAN_GUARD_MARKERS = (
    "steps.no_diff.outcome == 'success'",
    "steps.commit_push.outcome == 'success'",
    "steps.commit_push.outcome == 'failure'",
)

FORBIDDEN_IN_COMMIT = (
    re.compile(r"git\s+checkout\s+-B\s+.*AUTOMATION_BRANCH"),
    re.compile(r"git\s+checkout\s+-B\s+.*automation/update-articles-data"),
    re.compile(r"RELEASE_OVERLAY"),
    re.compile(r"iu_release_overlay"),
)


def _release_job_block(content: str) -> str:
    pattern = (
        rf"^  {re.escape(RELEASE_JOB)}:\s*\n"
        r"(.*?)"
        r"^  pipeline_operational_closeout:"
    )
    m = re.search(pattern, content, re.MULTILINE | re.DOTALL)
    return m.group(1) if m else ""


def _step_names(block: str) -> list[str]:
    return re.findall(r"^\s+- name:\s+(.+)$", block, re.MULTILINE)


def _step_block(block: str, name: str) -> str:
    pattern = rf"^\s+- name:\s+{re.escape(name)}\s*\n(.*?)(?=^\s+- name:|\Z)"
    m = re.search(pattern, block, re.MULTILINE | re.DOTALL)
    return m.group(1) if m else ""


def _cleanup_runtime_artifacts(repo_root: Path) -> None:
    for rel in RUNTIME_ARTIFACTS:
        path = repo_root / rel
        if path.is_file():
            path.unlink()


def validate_workflow(path: Path = WORKFLOW) -> list[str]:
    errors: list[str] = []
    if not path.is_file():
        return [f"missing workflow: {path}"]

    content = path.read_text(encoding="utf-8")
    release = _release_job_block(content)
    if not release:
        return [f"missing job block: {RELEASE_JOB}"]

    names = _step_names(release)

    prep_idx = next((i for i, n in enumerate(names) if any(m in n for m in PREP_BRANCH_MARKERS)), -1)
    if prep_idx < 0:
        errors.append("missing step: Prepare automation branch (before data generation)")
        return errors

    first_data_idx = next(
        (i for i, n in enumerate(names) if any(m in n for m in DATA_STEP_MARKERS)),
        len(names),
    )
    if first_data_idx < len(names) and prep_idx > first_data_idx:
        errors.append(
            "Prepare automation branch must run before first data generation step "
            f"(prep={names[prep_idx]!r}, data={names[first_data_idx]!r})"
        )

    commit_block = _step_block(release, "Commit to automation branch and push")
    if not commit_block:
        errors.append("missing step: Commit to automation branch and push")
    else:
        for pat in FORBIDDEN_IN_COMMIT:
            if pat.search(commit_block):
                errors.append(
                    "Commit step must not checkout automation branch or use release overlay after data generation"
                )
                break
        if "git branch --show-current" not in commit_block:
            errors.append("Commit step must verify current branch before staging data")

    cleanup_block = _step_block(release, "Clean release runtime artifacts")
    if not cleanup_block:
        errors.append("missing step: Clean release runtime artifacts (before git clean guard)")
    else:
        for rel in RUNTIME_ARTIFACTS:
            if rel not in cleanup_block:
                errors.append(f"cleanup step must remove runtime artifact: {rel}")

    if "Git clean guard" not in release:
        errors.append("missing step: Git clean guard")
    else:
        cleanup_idx = release.find("Clean release runtime artifacts")
        guard_idx = release.find("Git clean guard")
        if cleanup_idx < 0 or guard_idx < 0 or cleanup_idx > guard_idx:
            errors.append("Clean release runtime artifacts must run before Git clean guard")

    guard_step = _step_block(release, "Release git staging guard")
    if not guard_step:
        errors.append("missing step: Release git staging guard")

    final_staging = _step_block(release, FINAL_STAGING_STEP)
    if not final_staging:
        errors.append(f"missing step: {FINAL_STAGING_STEP}")
    else:
        for rel in (
            "projects/data/videos.json",
            "projects/data/source_rotation_inventory.json",
            "projects/data/pipeline_reports/",
        ):
            if rel not in final_staging:
                errors.append(f"final staging step must git add release path: {rel}")

    commit_idx = release.find("Commit to automation branch and push")
    staging_idx = release.find(FINAL_STAGING_STEP)
    if commit_idx >= 0 and staging_idx >= 0 and staging_idx > commit_idx:
        errors.append("Final release data staging must run before Commit to automation branch and push")

    git_clean_block = _step_block(release, "Git clean guard")
    if git_clean_block:
        if "if: always()" in git_clean_block.split("run:")[0] and "steps.no_diff.outcome" not in git_clean_block:
            errors.append(
                "Git clean guard must not use bare if: always(); "
                "run only after no_diff and release commit path"
            )
        for marker in GIT_CLEAN_GUARD_MARKERS:
            if marker not in release[release.find("Git clean guard") : release.find("Git clean guard") + 800]:
                errors.append(f"Git clean guard missing commit-path gate: {marker}")

    return errors


class ArticlesReleaseRuntimeCleanupTests(unittest.TestCase):
    def test_runtime_artifacts_removed_data_preserved(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            data_dir = repo / "projects" / "data"
            data_dir.mkdir(parents=True)
            articles = data_dir / "articles.json"
            articles.write_text('{"generatedAt":"2026-01-01T00:00:00Z","articles":[]}', encoding="utf-8")
            for rel in RUNTIME_ARTIFACTS:
                path = repo / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("{}", encoding="utf-8")

            _cleanup_runtime_artifacts(repo)

            for rel in RUNTIME_ARTIFACTS:
                self.assertFalse((repo / rel).exists(), msg=rel)
            self.assertTrue(articles.exists())

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

            proc = subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=repo,
                capture_output=True,
                text=True,
                check=False,
            )
            porcelain = proc.stdout.strip()
            self.assertIn("unexpected_dirty.txt", porcelain)
            for rel in RUNTIME_ARTIFACTS:
                self.assertNotIn(rel, porcelain)


def main() -> int:
    errors = validate_workflow()
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ArticlesReleaseRuntimeCleanupTests)
    test_result = unittest.TextTestRunner(verbosity=0).run(suite)
    if not test_result.wasSuccessful():
        print("ARTICLE_RELEASE_CLEANUP_GUARD_PASS=NO", file=sys.stderr)
        return 1

    if errors:
        for e in errors:
            print(f"ARTICLES_RELEASE_GIT_STAGING_GUARD=FAIL {e}", file=sys.stderr)
        print("ARTICLES_RELEASE_GIT_RACE_FIXED=NO")
        print("LOCAL_CHANGES_CHECKOUT_ERROR_GONE=NO")
        print("ARTICLE_RELEASE_CLEANUP_GUARD_PASS=NO")
        return 1

    print("ARTICLES_RELEASE_GIT_STAGING_GUARD=PASS")
    print("ARTICLES_RELEASE_GIT_RACE_FIXED=YES")
    print("LOCAL_CHANGES_CHECKOUT_ERROR_GONE=YES")
    print("ARTICLE_RELEASE_CLEANUP_GUARD_PASS=YES")
    print("RUNTIME_REPORT_GIT_CLEAN_ERROR_GONE=YES")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
