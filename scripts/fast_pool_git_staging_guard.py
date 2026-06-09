#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Guard: fast pool workflow must prepare automation branch before data generation,
must not checkout another branch after local data changes, and must verify that
Pages closeout waits for this run's publishable_pool.generatedAt on main (race fix).
"""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "update-articles-fast-pool.yml"

DATA_STEP_MARKERS = (
    "Regenerate source rotation inventory",
    "Article pipeline — ingest",
    "Fast pool merge",
)

PREP_BRANCH_MARKERS = (
    "Prepare automation branch",
)

FORBIDDEN_IN_COMMIT = (
    re.compile(r"git\s+checkout\s+-B\s+.*AUTOMATION_BRANCH"),
    re.compile(r"git\s+checkout\s+-B\s+.*automation/update-articles-fast-pool"),
)

RACE_FIX_WAIT_MARKERS = (
    "fetch_main_pool_at",
    "EXPECTED_POOL_AT",
    "DOUBLE_CYCLE_RACE_AVOIDED=YES",
    "ensure_open_pr",
)


def _step_names(content: str) -> list[str]:
    return re.findall(r"^\s+- name:\s+(.+)$", content, re.MULTILINE)


def _step_block(content: str, name: str) -> str:
    pattern = rf"^\s+- name:\s+{re.escape(name)}\s*\n(.*?)(?=^\s+- name:|\Z)"
    m = re.search(pattern, content, re.MULTILINE | re.DOTALL)
    return m.group(1) if m else ""


def validate_workflow(path: Path = WORKFLOW) -> list[str]:
    errors: list[str] = []
    if not path.is_file():
        return [f"missing workflow: {path}"]

    content = path.read_text(encoding="utf-8")
    names = _step_names(content)

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

    commit_block = _step_block(content, "Commit to automation branch and push")
    if not commit_block:
        errors.append("missing step: Commit to automation branch and push")
    else:
        for pat in FORBIDDEN_IN_COMMIT:
            if pat.search(commit_block):
                errors.append(
                    "Commit step must not git checkout automation branch after data generation"
                )
                break
        if "pushed_sha=" not in commit_block:
            errors.append("Commit step must emit pushed_sha output for merge race guard")

    auto_merge_block = _step_block(content, "Enable auto-merge when data-only")
    if not auto_merge_block:
        errors.append("missing step: Enable auto-merge when data-only")
    else:
        if "headRefOid" not in auto_merge_block:
            errors.append("Enable auto-merge must verify PR headRefOid matches pushed_sha")
        if "--disable-auto" not in auto_merge_block:
            errors.append("Enable auto-merge must reset auto-merge with --disable-auto before arming")

    wait_block = _step_block(content, "Wait for merge then dispatch Pages")
    if not wait_block:
        errors.append("missing step: Wait for merge then dispatch Pages")
    else:
        for marker in RACE_FIX_WAIT_MARKERS:
            if marker not in wait_block:
                errors.append(f"Wait for merge step missing race-fix marker: {marker}")
        if "mergedAt // empty" in wait_block:
            errors.append("Wait for merge must not close on mergedAt alone (stale merge race)")

    cleanup_markers = (
        "Clean fast pool runtime artifacts",
        "iu_content_freshness_guard_report.json",
        "projects/data/robots_cache.json",
    )
    if not all(m in content for m in cleanup_markers):
        errors.append("missing step: Clean fast pool runtime artifacts (before git clean guard)")

    if "Git clean guard" not in content:
        errors.append("missing step: Git clean guard")
    else:
        cleanup_idx = content.find("Clean fast pool runtime artifacts")
        guard_idx = content.find("Git clean guard")
        if cleanup_idx < 0 or guard_idx < 0 or cleanup_idx > guard_idx:
            errors.append("Clean fast pool runtime artifacts must run before Git clean guard")

    return errors


def main() -> int:
    errors = validate_workflow()
    if errors:
        for e in errors:
            print(f"FAST_POOL_GIT_STAGING_GUARD=FAIL {e}", file=sys.stderr)
        print("FAST_POOL_GIT_RACE_FIXED=NO")
        print("DOUBLE_CYCLE_RACE_FIXED=NO")
        return 1
    print("FAST_POOL_GIT_STAGING_GUARD=PASS")
    print("FAST_POOL_GIT_RACE_FIXED=YES")
    print("DOUBLE_CYCLE_RACE_FIXED=YES")
    print("LOCAL_CHANGES_CHECKOUT_ERROR_GONE=YES")
    return 0


class FastPoolGitStagingGuardTests(unittest.TestCase):
    def test_validate_passes_on_repo_workflow(self) -> None:
        errors = validate_workflow()
        self.assertEqual(errors, [])


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "test":
        raise SystemExit(unittest.main(argv=[sys.argv[0]]))
    raise SystemExit(main())
