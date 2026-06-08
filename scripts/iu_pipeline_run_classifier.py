#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Phase 3D-B: GitHub run classification helpers for Python consumers."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Mapping, Optional, Tuple

from iu_article_pipeline_phase_status import (
    AGGREGATE_FAILED,
    INGEST_FAILED,
    INGEST_SUCCESS_RELEASE_BLOCKED,
    PIPELINE_SUCCESS,
    RELEASE_FAILED,
    RUN_CANCELLED,
    SKIPPED_DUPLICATE,
    UNKNOWN_INCOMPLETE,
    derive_pipeline_overall_status,
)

INGEST_WORKFLOW_FILE = "update-articles.yml"

BUCKET_KEYS = (
    PIPELINE_SUCCESS,
    INGEST_SUCCESS_RELEASE_BLOCKED,
    INGEST_FAILED,
    AGGREGATE_FAILED,
    RELEASE_FAILED,
    SKIPPED_DUPLICATE,
    RUN_CANCELLED,
    UNKNOWN_INCOMPLETE,
)


def empty_bucket_counts() -> Dict[str, int]:
    return {k: 0 for k in BUCKET_KEYS}


def _job_by_name(jobs: List[dict], name: str) -> Optional[dict]:
    for job in jobs:
        if isinstance(job, dict) and job.get("name") == name:
            return job
    return None


def _needs_phase_status_artifact(jobs: List[dict], overall: str) -> bool:
    if overall != UNKNOWN_INCOMPLETE:
        return False
    ingest = _job_by_name(jobs, "article_pipeline_ingest")
    aggregate = _job_by_name(jobs, "article_pipeline_aggregate")
    release = _job_by_name(jobs, "article_data_release")
    return (
        str(ingest.get("conclusion") if ingest else "") == "success"
        and str(aggregate.get("conclusion") if aggregate else "") == "success"
        and str(release.get("conclusion") if release else "") == "failure"
    )


def _fetch_jobs(repo: str, run_id: int | str, timeout: int = 45) -> List[dict]:
    try:
        r = subprocess.run(
            [
                "gh",
                "api",
                f"repos/{repo}/actions/runs/{run_id}/jobs",
                "--paginate",
                "-q",
                ".jobs",
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        if r.returncode != 0 or not (r.stdout or "").strip():
            return []
        data = json.loads(r.stdout)
        return data if isinstance(data, list) else []
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
        return []


def _fetch_phase_status_artifact(repo: str, run_id: int | str, timeout: int = 60) -> Optional[dict]:
    artifact_name = f"pipeline-phase-status-{run_id}"
    tmp = tempfile.mkdtemp(prefix="iu-phase-status-")
    try:
        subprocess.run(
            [
                "gh",
                "run",
                "download",
                str(run_id),
                "--repo",
                repo,
                "--name",
                artifact_name,
                "--dir",
                tmp,
            ],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        direct = os.path.join(tmp, "article_pipeline_phase_status.json")
        if os.path.isfile(direct):
            with open(direct, encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else None
        for root, _dirs, files in os.walk(tmp):
            if "article_pipeline_phase_status.json" in files:
                with open(os.path.join(root, "article_pipeline_phase_status.json"), encoding="utf-8") as f:
                    data = json.load(f)
                return data if isinstance(data, dict) else None
        return None
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
        return None
    finally:
        try:
            for name in os.listdir(tmp):
                p = os.path.join(tmp, name)
                if os.path.isdir(p):
                    for sub in os.listdir(p):
                        os.remove(os.path.join(p, sub))
                    os.rmdir(p)
                else:
                    os.remove(p)
            os.rmdir(tmp)
        except OSError:
            pass


def classify_run_row(
    repo: str,
    run_row: Mapping[str, Any],
    *,
    fetch_artifact: bool = True,
) -> str:
    """Classify one gh run list row into pipeline_overall_status."""
    run_id = run_row.get("databaseId") or run_row.get("id")
    if run_id is None:
        return UNKNOWN_INCOMPLETE
    jobs = _fetch_jobs(repo, run_id)
    phase_status: Optional[dict] = None
    overall = derive_pipeline_overall_status(
        None,
        jobs=jobs,
        run_conclusion=str(run_row.get("conclusion") or ""),
        run_status=str(run_row.get("status") or ""),
    )
    if fetch_artifact and _needs_phase_status_artifact(jobs, overall):
        phase_status = _fetch_phase_status_artifact(repo, run_id)
        if phase_status:
            overall = derive_pipeline_overall_status(
                phase_status,
                jobs=jobs,
                run_conclusion=str(run_row.get("conclusion") or ""),
                run_status=str(run_row.get("status") or ""),
            )
    return overall


def classify_pipeline_runs_24h(
    repo: Optional[str] = None,
    *,
    fetch_artifact: bool = True,
    limit: int = 200,
) -> Tuple[Dict[str, int], Optional[str]]:
    """
    Bucket update-articles runs in the last 24h by pipeline_overall_status.
    Returns (counts, error_message).
    """
    repo = (repo or os.environ.get("GITHUB_REPOSITORY") or "").strip()
    if not repo:
        return empty_bucket_counts(), "GITHUB_REPOSITORY unset"

    try:
        r = subprocess.run(
            [
                "gh",
                "run",
                "list",
                "--repo",
                repo,
                "--workflow",
                INGEST_WORKFLOW_FILE,
                "--limit",
                str(limit),
                "--json",
                "databaseId,conclusion,createdAt,status",
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=90,
        )
        if r.returncode != 0 or not (r.stdout or "").strip():
            return empty_bucket_counts(), "gh run list failed"
        runs = json.loads(r.stdout)
        if not isinstance(runs, list):
            return empty_bucket_counts(), "gh run list invalid json"
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        return empty_bucket_counts(), str(exc)

    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=24)
    counts = empty_bucket_counts()

    for row in runs:
        if not isinstance(row, dict):
            continue
        ca = row.get("createdAt")
        if not ca:
            continue
        try:
            dt = datetime.fromisoformat(str(ca).replace("Z", "+00:00"))
        except ValueError:
            continue
        if dt.astimezone(timezone.utc) <= start:
            continue
        overall = classify_run_row(repo, row, fetch_artifact=fetch_artifact)
        if overall in counts:
            counts[overall] += 1
        else:
            counts[UNKNOWN_INCOMPLETE] += 1

    return counts, None
