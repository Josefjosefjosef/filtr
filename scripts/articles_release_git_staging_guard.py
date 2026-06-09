#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Guard: slow articles release workflow must prepare automation branch before data
generation and must not checkout another branch after local data changes.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "update-articles.yml"
RELEASE_JOB = "article_data_release"

DATA_STEP_MARKERS = (
    "Load persisted aggregate output for publish",
    "Article pipeline — publish",
)

PREP_BRANCH_MARKERS = (
    "Prepare automation branch",
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

    cleanup_markers = (
        "Clean release runtime artifacts",
        "iu_content_freshness_guard_report.json",
        "projects/data/robots_cache.json",
    )
    if not all(m in release for m in cleanup_markers):
        errors.append("missing step: Clean release runtime artifacts (before git clean guard)")

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

    return errors


def main() -> int:
    errors = validate_workflow()
    if errors:
        for e in errors:
            print(f"ARTICLES_RELEASE_GIT_STAGING_GUARD=FAIL {e}", file=sys.stderr)
        print("ARTICLES_RELEASE_GIT_RACE_FIXED=NO")
        print("LOCAL_CHANGES_CHECKOUT_ERROR_GONE=NO")
        return 1
    print("ARTICLES_RELEASE_GIT_STAGING_GUARD=PASS")
    print("ARTICLES_RELEASE_GIT_RACE_FIXED=YES")
    print("LOCAL_CHANGES_CHECKOUT_ERROR_GONE=YES")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
