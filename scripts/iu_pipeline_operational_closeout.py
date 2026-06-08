#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 3D-B-2: workflow operational closeout.

Reads article_pipeline_phase_status.json, classifies pipeline_overall_status via
Phase 3D-B consumer migration helpers, and emits GitHub Actions summary lines.

Does not alter release guards, publish output, or guard exit codes.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess

from iu_article_pipeline_phase_status import (
    SKIPPED_DUPLICATE,
    _default_status,
    append_operational_closeout_github_summary,
    closeout_exit_code_for_overall,
    derive_pipeline_overall_status,
    operational_summary_kv,
    read_phase_status,
)

PHASE_STATUS_ENV = "PHASE_STATUS_PATH"
OUTPUT_DIR_ENV = "OUTPUT_DIR"


def _output_dir() -> str:
    return os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        os.environ.get(OUTPUT_DIR_ENV, "projects/data"),
    )


def _load_phase_status_file(path: str) -> dict | None:
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _resolve_phase_status(explicit_path: str | None = None) -> dict | None:
    if explicit_path:
        loaded = _load_phase_status_file(explicit_path)
        if loaded:
            return loaded
    env_path = str(os.environ.get(PHASE_STATUS_ENV) or "").strip()
    if env_path:
        loaded = _load_phase_status_file(env_path)
        if loaded:
            return loaded
    return read_phase_status(_output_dir())


def _fetch_run_metadata(run_id: str, repo: str) -> tuple[str, str, list[dict]]:
    run_conclusion = ""
    run_status = ""
    jobs: list[dict] = []
    if not run_id or not repo:
        return run_conclusion, run_status, jobs
    try:
        r = subprocess.run(
            [
                "gh",
                "run",
                "view",
                run_id,
                "--repo",
                repo,
                "--json",
                "conclusion,status,jobs",
            ],
            capture_output=True,
            text=True,
            timeout=45,
        )
        if r.returncode == 0 and r.stdout.strip():
            data = json.loads(r.stdout)
            if isinstance(data, dict):
                run_conclusion = str(data.get("conclusion") or "")
                run_status = str(data.get("status") or "")
                raw_jobs = data.get("jobs")
                if isinstance(raw_jobs, list):
                    jobs = [j for j in raw_jobs if isinstance(j, dict)]
    except Exception:
        pass
    return run_conclusion, run_status, jobs


def _status_for_closeout(phase_status: dict | None, jobs: list[dict], run_conclusion: str, run_status: str) -> dict:
    return phase_status if isinstance(phase_status, dict) else _default_status()


def run_operational_closeout(
    *,
    phase_status_path: str | None = None,
    run_id: str | None = None,
    repo: str | None = None,
    write_summary: bool = True,
) -> tuple[dict[str, str], int]:
    run_id = str(run_id or os.environ.get("GITHUB_RUN_ID") or "").strip()
    repo = str(repo or os.environ.get("GITHUB_REPOSITORY") or "").strip()
    phase_status = _resolve_phase_status(phase_status_path)
    run_conclusion, run_status, jobs = _fetch_run_metadata(run_id, repo)
    overall = derive_pipeline_overall_status(
        phase_status,
        jobs=jobs or None,
        run_conclusion=run_conclusion,
        run_status=run_status,
    )
    status = _status_for_closeout(phase_status, jobs, run_conclusion, run_status)
    if overall == SKIPPED_DUPLICATE and not phase_status:
        status = _default_status()
    kv = operational_summary_kv(status, overall)
    if write_summary:
        append_operational_closeout_github_summary(status, overall)
    exit_code = closeout_exit_code_for_overall(overall)
    return kv, exit_code


def cmd_run(args: argparse.Namespace) -> int:
    kv, exit_code = run_operational_closeout(
        phase_status_path=args.phase_status_path or None,
        run_id=args.run_id or None,
        repo=args.repo or None,
        write_summary=not args.no_summary,
    )
    for key, value in kv.items():
        print(f"{key}={value}", flush=True)
    print(f"PIPELINE_OPERATIONAL_CLOSEOUT={'PASS' if exit_code == 0 else 'FAIL'}", flush=True)
    return exit_code


def main() -> int:
    p = argparse.ArgumentParser(description="Pipeline operational closeout (Phase 3D-B-2)")
    sub = p.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run", help="Classify run and emit operational summary")
    run.add_argument("--phase-status-path", default=os.environ.get(PHASE_STATUS_ENV, ""))
    run.add_argument("--run-id", default=os.environ.get("GITHUB_RUN_ID", ""))
    run.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", ""))
    run.add_argument("--no-summary", action="store_true")
    args = p.parse_args()
    if args.cmd == "run":
        return cmd_run(args)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
