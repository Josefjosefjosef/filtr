#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 3B: article pipeline phase status manifest (additive telemetry).

Separates ingest/aggregate/clean-pool success from release guard blocks and publish
outcomes. Does not alter publish output, release guards, or guard exit codes.

Manifest path: OUTPUT_DIR/staging/article_pipeline_phase_status.json (gitignored).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from typing import Any

from iu_staging import staging_root

PHASE_STATUS_NAME = "article_pipeline_phase_status.json"
SCHEMA_VERSION = 1

# Canonical status tokens (manifest values)
INGEST_OK = "INGEST_OK"
INGEST_FAIL = "INGEST_FAIL"
AGGREGATE_OK = "AGGREGATE_OK"
AGGREGATE_FAIL = "AGGREGATE_FAIL"
CLEAN_POOL_CREATED = "CLEAN_POOL_CREATED"
CLEAN_POOL_MISSING = "CLEAN_POOL_MISSING"
RELEASE_OK = "RELEASE_OK"
RELEASE_BLOCKED = "RELEASE_BLOCKED"
RELEASE_FAIL = "RELEASE_FAIL"
PUBLISH_OK = "PUBLISH_OK"
PUBLISH_SKIPPED = "PUBLISH_SKIPPED"
PUBLISH_FAILED = "PUBLISH_FAILED"

# Derived pipeline_overall_status (Phase 3D-B consumer migration)
PIPELINE_SUCCESS = "PIPELINE_SUCCESS"
INGEST_SUCCESS_RELEASE_BLOCKED = "INGEST_SUCCESS_RELEASE_BLOCKED"
RELEASE_FAILED = "RELEASE_FAILED"
INGEST_FAILED = "INGEST_FAILED"
AGGREGATE_FAILED = "AGGREGATE_FAILED"
SKIPPED_DUPLICATE = "SKIPPED_DUPLICATE"
RUN_CANCELLED = "RUN_CANCELLED"
UNKNOWN_INCOMPLETE = "UNKNOWN_INCOMPLETE"

ALERT_GREEN = "GREEN"
ALERT_YELLOW = "YELLOW"
ALERT_RED = "RED"

STAGING_TELEMETRY_FILES = (
    PHASE_STATUS_NAME,
    "article_pool_manifest.json",
)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _run_context() -> dict[str, str]:
    return {
        "pipelineRunId": str(os.environ.get("GITHUB_RUN_ID") or "local").strip() or "local",
        "commitSha": str(os.environ.get("GITHUB_SHA") or "").strip(),
        "branch": str(os.environ.get("GITHUB_REF_NAME") or os.environ.get("GITHUB_REF") or "local").strip(),
    }


def _default_status() -> dict[str, Any]:
    ctx = _run_context()
    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": _iso_now(),
        "pipelineRunId": ctx["pipelineRunId"],
        "commitSha": ctx["commitSha"],
        "branch": ctx["branch"],
        "ingest_status": None,
        "aggregate_status": None,
        "clean_pool_status": None,
        "release_status": None,
        "publish_status": None,
        "release_blocked_by": None,
        "release_blocked_reason": None,
        "guard_name": None,
        "guard_exit_code": None,
        "clean_pool_count": None,
        "articles_full_count": None,
        "articles_final_count": None,
        "ready_for_release_count": None,
        "was_publish_attempted": False,
        "was_pr_created": False,
    }


def read_phase_status(output_dir: str) -> dict | None:
    path = os.path.join(staging_root(output_dir), PHASE_STATUS_NAME)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def write_phase_status(output_dir: str, status: dict) -> str:
    root = staging_root(output_dir)
    os.makedirs(root, exist_ok=True)
    path = os.path.join(root, PHASE_STATUS_NAME)
    tmp = path + ".tmp"
    status = dict(status)
    status["generatedAt"] = _iso_now()
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(status, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)
    return path


def merge_phase_status(output_dir: str, patch: dict) -> dict:
    base = read_phase_status(output_dir) or _default_status()
    merged = dict(base)
    ctx = _run_context()
    if ctx["pipelineRunId"] != "local":
        merged["pipelineRunId"] = ctx["pipelineRunId"]
    if ctx["commitSha"]:
        merged["commitSha"] = ctx["commitSha"]
    if ctx["branch"]:
        merged["branch"] = ctx["branch"]
    for key, value in patch.items():
        if value is not None or key in patch:
            merged[key] = value
    write_phase_status(output_dir, merged)
    return merged


def _counts_from_bundle(bundle: dict | None, pool_manifest: dict | None = None) -> dict[str, int | None]:
    pm = pool_manifest if isinstance(pool_manifest, dict) else {}
    b = bundle if isinstance(bundle, dict) else {}
    articles_full = b.get("articles_full") or []
    articles_final = b.get("articles_final") or []
    full_n = int(pm.get("articles_full_count") or pm.get("total_clean_pool") or len(articles_full))
    final_n = int(pm.get("articles_final_count") or pm.get("ready_for_release_count") or len(articles_final))
    clean_n = int(pm.get("total_clean_pool") or full_n)
    ready_n = int(pm.get("ready_for_release_count") or final_n)
    return {
        "clean_pool_count": clean_n,
        "articles_full_count": full_n,
        "articles_final_count": final_n,
        "ready_for_release_count": ready_n,
    }


def record_ingest_ok(output_dir: str) -> dict:
    return merge_phase_status(
        output_dir,
        {
            "ingest_status": INGEST_OK,
        },
    )


def record_ingest_fail(output_dir: str, reason: str | None = None) -> dict:
    return merge_phase_status(
        output_dir,
        {
            "ingest_status": INGEST_FAIL,
            "release_blocked_reason": reason,
        },
    )


def record_aggregate_ok(
    output_dir: str,
    bundle: dict,
    *,
    pool_manifest: dict | None = None,
) -> dict:
    counts = _counts_from_bundle(bundle, pool_manifest)
    return merge_phase_status(
        output_dir,
        {
            "aggregate_status": AGGREGATE_OK,
            "clean_pool_status": CLEAN_POOL_CREATED,
            **counts,
        },
    )


def record_aggregate_fail(output_dir: str, reason: str | None = None) -> dict:
    return merge_phase_status(
        output_dir,
        {
            "aggregate_status": AGGREGATE_FAIL,
            "clean_pool_status": CLEAN_POOL_MISSING,
            "release_blocked_reason": reason,
        },
    )


def record_publish_attempted(output_dir: str, *, success: bool) -> dict:
    patch: dict[str, Any] = {"was_publish_attempted": True}
    if not success:
        patch["publish_status"] = PUBLISH_FAILED
        patch["release_status"] = RELEASE_FAIL
    return merge_phase_status(output_dir, patch)


def record_release_blocked(
    output_dir: str,
    *,
    guard_name: str,
    guard_exit_code: int = 1,
    reason: str | None = None,
    blocked_by: str = "release_guard",
) -> dict:
    existing = read_phase_status(output_dir) or _default_status()
    patch = {
        "release_status": RELEASE_BLOCKED,
        "publish_status": PUBLISH_SKIPPED,
        "release_blocked_by": blocked_by,
        "release_blocked_reason": reason or f"release guard failed: {guard_name}",
        "guard_name": guard_name,
        "guard_exit_code": int(guard_exit_code),
        "was_publish_attempted": existing.get("was_publish_attempted", False),
    }
    # Preserve ingest/aggregate/pool — do not overwrite OK states
    for key in ("ingest_status", "aggregate_status", "clean_pool_status"):
        if existing.get(key):
            patch[key] = existing[key]
    for key in (
        "clean_pool_count",
        "articles_full_count",
        "articles_final_count",
        "ready_for_release_count",
    ):
        if existing.get(key) is not None:
            patch[key] = existing[key]
    return merge_phase_status(output_dir, patch)


def record_release_ok(
    output_dir: str,
    *,
    publish_status: str,
    was_pr_created: bool = False,
) -> dict:
    return merge_phase_status(
        output_dir,
        {
            "release_status": RELEASE_OK,
            "publish_status": publish_status,
            "release_blocked_by": None,
            "release_blocked_reason": None,
            "guard_name": None,
            "guard_exit_code": None,
            "was_pr_created": was_pr_created,
        },
    )


def summary_row(status: dict) -> dict[str, str]:
    def short_ingest(v: str | None) -> str:
        if v == INGEST_OK:
            return "OK"
        if v == INGEST_FAIL:
            return "FAIL"
        return "n/a"

    def short_agg(v: str | None) -> str:
        if v == AGGREGATE_OK:
            return "OK"
        if v == AGGREGATE_FAIL:
            return "FAIL"
        return "n/a"

    def short_pool(v: str | None) -> str:
        if v == CLEAN_POOL_CREATED:
            return "CREATED"
        if v == CLEAN_POOL_MISSING:
            return "MISSING"
        return "n/a"

    def short_release(v: str | None) -> str:
        if v == RELEASE_OK:
            return "OK"
        if v == RELEASE_BLOCKED:
            return "BLOCKED"
        if v == RELEASE_FAIL:
            return "FAIL"
        return "n/a"

    def short_publish(v: str | None) -> str:
        if v == PUBLISH_OK:
            return "OK"
        if v == PUBLISH_SKIPPED:
            return "SKIPPED"
        if v == PUBLISH_FAILED:
            return "FAIL"
        return "n/a"

    return {
        "INGEST": short_ingest(status.get("ingest_status")),
        "AGGREGATE": short_agg(status.get("aggregate_status")),
        "POOL": short_pool(status.get("clean_pool_status")),
        "RELEASE": short_release(status.get("release_status")),
        "PUBLISH": short_publish(status.get("publish_status")),
    }


def artifacts_persisted(status: dict) -> bool:
    """True when ingest+aggregate succeeded and durable artifacts should exist."""
    return (
        status.get("ingest_status") == INGEST_OK
        and status.get("aggregate_status") == AGGREGATE_OK
        and status.get("clean_pool_status") == CLEAN_POOL_CREATED
    )


def _job_by_name(jobs: list[dict] | None, name: str) -> dict | None:
    if not jobs:
        return None
    for job in jobs:
        if isinstance(job, dict) and job.get("name") == name:
            return job
    return None


def _is_legacy_run(jobs: list[dict] | None) -> bool:
    """Pre split-job workflow runs lack article_pipeline_* job names."""
    return _job_by_name(jobs, "article_pipeline_ingest") is None


def _skipped_duplicate_from_jobs(jobs: list[dict] | None) -> bool:
    gate = _job_by_name(jobs, "pipeline_gate")
    ingest = _job_by_name(jobs, "article_pipeline_ingest")
    aggregate = _job_by_name(jobs, "article_pipeline_aggregate")
    if gate is None or ingest is None or aggregate is None:
        return False
    return (
        str(gate.get("conclusion") or "") == "success"
        and str(ingest.get("conclusion") or "") == "skipped"
        and str(aggregate.get("conclusion") or "") == "skipped"
    )


def derive_pipeline_overall_status(
    phase_status: dict | None,
    *,
    jobs: list[dict] | None = None,
    run_conclusion: str | None = None,
    run_status: str | None = None,
) -> str:
    """
    Map phase status manifest (+ optional jobs/run metadata) to pipeline_overall_status.

    Priority: phase_status fields > jobs API > legacy workflow conclusion.
    """
    rc = str(run_conclusion or "").lower()
    rs = str(run_status or "").lower()
    if rs == "cancelled" or rc == "cancelled":
        return RUN_CANCELLED

    if _skipped_duplicate_from_jobs(jobs):
        return SKIPPED_DUPLICATE

    if isinstance(phase_status, dict):
        ingest = phase_status.get("ingest_status")
        aggregate = phase_status.get("aggregate_status")
        release = phase_status.get("release_status")
        publish = phase_status.get("publish_status")
        if ingest == INGEST_FAIL:
            return INGEST_FAILED
        if aggregate == AGGREGATE_FAIL:
            return AGGREGATE_FAILED
        if ingest == INGEST_OK and aggregate == AGGREGATE_OK:
            if release == RELEASE_BLOCKED:
                return INGEST_SUCCESS_RELEASE_BLOCKED
            if release == RELEASE_FAIL or publish == PUBLISH_FAILED:
                return RELEASE_FAILED
            if release == RELEASE_OK and publish in (PUBLISH_OK, PUBLISH_SKIPPED, None):
                return PIPELINE_SUCCESS

    if jobs:
        ingest_job = _job_by_name(jobs, "article_pipeline_ingest")
        aggregate_job = _job_by_name(jobs, "article_pipeline_aggregate")
        release_job = _job_by_name(jobs, "article_data_release")
        if ingest_job and str(ingest_job.get("conclusion") or "") == "failure":
            return INGEST_FAILED
        if aggregate_job and str(aggregate_job.get("conclusion") or "") == "failure":
            return AGGREGATE_FAILED
        ingest_ok = ingest_job and str(ingest_job.get("conclusion") or "") == "success"
        aggregate_ok = aggregate_job and str(aggregate_job.get("conclusion") or "") == "success"
        if ingest_ok and aggregate_ok:
            if release_job is None or str(release_job.get("conclusion") or "") == "skipped":
                return UNKNOWN_INCOMPLETE
            rel_c = str(release_job.get("conclusion") or "")
            if rel_c == "success":
                return PIPELINE_SUCCESS
            if rel_c == "failure":
                return UNKNOWN_INCOMPLETE

    if _is_legacy_run(jobs):
        if rc == "success":
            return PIPELINE_SUCCESS
        if rc == "failure":
            return UNKNOWN_INCOMPLETE

    return UNKNOWN_INCOMPLETE


def alert_level_for_overall_status(overall: str) -> str:
    if overall in (PIPELINE_SUCCESS, SKIPPED_DUPLICATE):
        return ALERT_GREEN
    if overall == INGEST_SUCCESS_RELEASE_BLOCKED:
        return ALERT_YELLOW
    return ALERT_RED


def is_ingest_aggregate_ok_status(overall: str) -> bool:
    return overall in (PIPELINE_SUCCESS, INGEST_SUCCESS_RELEASE_BLOCKED)


def is_pipeline_failure_status(overall: str) -> bool:
    return alert_level_for_overall_status(overall) == ALERT_RED


def operational_summary_kv(status: dict, overall: str) -> dict[str, str]:
    """Canonical KEY=VALUE lines for Phase 3D-B-2 workflow closeout."""
    row = summary_row(status)
    alert = alert_level_for_overall_status(overall)
    return {
        "INGEST_STATUS": row["INGEST"],
        "AGGREGATE_STATUS": row["AGGREGATE"],
        "CLEAN_POOL_STATUS": row["POOL"],
        "RELEASE_STATUS": row["RELEASE"],
        "PUBLISH_STATUS": row["PUBLISH"],
        "PIPELINE_OVERALL_STATUS": overall,
        "PIPELINE_ALERT_LEVEL": alert,
    }


def closeout_exit_code_for_overall(overall: str) -> int:
    """GREEN and YELLOW closeout succeed; RED fails the closeout job."""
    if alert_level_for_overall_status(overall) == ALERT_RED:
        return 1
    return 0


def append_operational_closeout_github_summary(status: dict, overall: str) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    kv = operational_summary_kv(status, overall)
    alert = kv["PIPELINE_ALERT_LEVEL"]
    lines = [
        "",
        "## Pipeline operational closeout (Phase 3D-B-2)",
        "",
        f"INGEST_STATUS={kv['INGEST_STATUS']}",
        f"AGGREGATE_STATUS={kv['AGGREGATE_STATUS']}",
        f"CLEAN_POOL_STATUS={kv['CLEAN_POOL_STATUS']}",
        f"RELEASE_STATUS={kv['RELEASE_STATUS']}",
        f"PUBLISH_STATUS={kv['PUBLISH_STATUS']}",
        f"PIPELINE_OVERALL_STATUS={kv['PIPELINE_OVERALL_STATUS']}",
        "",
        "| Field | Value |",
        "| --- | --- |",
        f"| INGEST_STATUS | {kv['INGEST_STATUS']} |",
        f"| AGGREGATE_STATUS | {kv['AGGREGATE_STATUS']} |",
        f"| CLEAN_POOL_STATUS | {kv['CLEAN_POOL_STATUS']} |",
        f"| RELEASE_STATUS | {kv['RELEASE_STATUS']} |",
        f"| PUBLISH_STATUS | {kv['PUBLISH_STATUS']} |",
        f"| PIPELINE_OVERALL_STATUS | {kv['PIPELINE_OVERALL_STATUS']} |",
        f"| PIPELINE_ALERT_LEVEL | {alert} |",
        "",
    ]
    if status.get("release_status") == RELEASE_BLOCKED:
        lines.extend(
            [
                f"Release blocked by: `{status.get('guard_name') or status.get('release_blocked_by') or 'unknown'}`",
                "",
                f"Reason: {status.get('release_blocked_reason') or 'n/a'}",
                "",
                "Ingest and aggregate succeeded; publish was skipped because a release guard failed.",
                "",
            ]
        )
    with open(path, "a", encoding="utf-8") as f:
        f.write("\n".join(lines))


def append_github_summary(status: dict) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    row = summary_row(status)
    persisted = "YES" if artifacts_persisted(status) else "NO"
    lines = [
        "",
        "## Article pipeline — phase status (Phase 3C)",
        "",
        "| Phase | Status |",
        "| --- | --- |",
        f"| INGEST | {row['INGEST']} |",
        f"| AGGREGATE | {row['AGGREGATE']} |",
        f"| POOL | {row['POOL']} |",
        f"| RELEASE | {row['RELEASE']} |",
        f"| PUBLISH | {row['PUBLISH']} |",
        f"| PIPELINE_ARTIFACTS_PERSISTED | {persisted} |",
        "",
    ]
    if status.get("release_status") == RELEASE_BLOCKED:
        lines.extend(
            [
                f"Release blocked by: `{status.get('guard_name') or status.get('release_blocked_by') or 'unknown'}`",
                "",
                f"Reason: {status.get('release_blocked_reason') or 'n/a'}",
                "",
                f"Clean pool count: {status.get('clean_pool_count', 'n/a')} (preserved in git handoff + workflow artifact)",
                "",
                "Ingest/aggregate success is **not lost** when release guards block — see `ingest-aggregate-success` workflow artifact.",
                "",
            ]
        )
    with open(path, "a", encoding="utf-8") as f:
        f.write("\n".join(lines))


def _detect_failed_release_guard(job_name: str = "article_data_release") -> tuple[str, int, str]:
    run_id = str(os.environ.get("GITHUB_RUN_ID") or "").strip()
    repo = str(os.environ.get("GITHUB_REPOSITORY") or "").strip()
    if not run_id or not repo:
        return ("unknown_release_guard", 1, "release_guard_failed")
    cmd = [
        "gh",
        "run",
        "view",
        run_id,
        "--repo",
        repo,
        "--json",
        "jobs",
        "--jq",
        f'.jobs[] | select(.name=="{job_name}") | .steps[] | select(.conclusion=="failure") | .name',
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if r.returncode == 0 and r.stdout.strip():
            first = r.stdout.strip().splitlines()[0].strip()
            if first:
                return (first, 1, f"release guard failed: {first}")
    except Exception:
        pass
    return ("unknown_release_guard", 1, "release_guard_failed")


def _output_dir() -> str:
    return os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        os.environ.get("OUTPUT_DIR", "projects/data"),
    )


def cmd_finalize_release(args: argparse.Namespace) -> int:
    output_dir = _output_dir()
    job_status = str(args.job_status or os.environ.get("JOB_STATUS") or "").strip().lower()
    data_changed = str(args.data_changed or "").strip().lower() in ("true", "1", "yes")
    pr_number = str(args.pr_number or "").strip()
    guard_name = str(args.guard_name or "").strip()
    guard_exit = int(args.guard_exit_code or 1)

    existing = read_phase_status(output_dir)
    if existing is None:
        # Release-only local run without handoff — seed from checkpoint counts if present
        existing = _default_status()

    if job_status == "failure":
        if guard_name:
            status = record_release_blocked(
                output_dir,
                guard_name=guard_name,
                guard_exit_code=guard_exit,
                reason=args.reason or f"release guard failed: {guard_name}",
            )
        else:
            gname, gcode, greason = _detect_failed_release_guard()
            # Publish step failure vs guard failure
            if existing.get("publish_status") == PUBLISH_FAILED:
                status = merge_phase_status(
                    output_dir,
                    {
                        "release_status": RELEASE_FAIL,
                        "publish_status": PUBLISH_FAILED,
                        "guard_name": gname if gname != "unknown_release_guard" else None,
                        "guard_exit_code": gcode if gname != "unknown_release_guard" else None,
                        "release_blocked_reason": greason,
                    },
                )
            else:
                status = record_release_blocked(
                    output_dir,
                    guard_name=gname,
                    guard_exit_code=gcode,
                    reason=greason,
                )
    elif job_status == "success":
        pub = PUBLISH_OK if data_changed and pr_number else PUBLISH_SKIPPED
        status = record_release_ok(
            output_dir,
            publish_status=pub,
            was_pr_created=bool(pr_number),
        )
    else:
        status = merge_phase_status(output_dir, {})

    path = write_phase_status(output_dir, status)
    append_github_summary(status)
    print(f"[PHASE_STATUS] written {path}", flush=True)
    row = summary_row(status)
    for phase, val in row.items():
        print(f"PHASE_{phase}={val}", flush=True)
    print(f"INGEST_STATUS={row['INGEST']}", flush=True)
    print(f"AGGREGATE_STATUS={row['AGGREGATE']}", flush=True)
    print(f"CLEAN_POOL_STATUS={row['POOL']}", flush=True)
    print(f"RELEASE_STATUS={row['RELEASE']}", flush=True)
    print(f"PUBLISH_STATUS={row['PUBLISH']}", flush=True)
    print(
        f"PIPELINE_ARTIFACTS_PERSISTED={'YES' if artifacts_persisted(status) else 'NO'}",
        flush=True,
    )
    return 0


def cmd_print_summary(args: argparse.Namespace) -> int:
    output_dir = _output_dir()
    status = read_phase_status(output_dir)
    if not status:
        print("PHASE_STATUS_MISSING=YES", flush=True)
        return 1
    print(json.dumps(status, indent=2))
    row = summary_row(status)
    for phase, val in row.items():
        print(f"PHASE_{phase}={val}", flush=True)
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Article pipeline phase status (Phase 3B telemetry)")
    sub = p.add_subparsers(dest="cmd", required=True)
    fin = sub.add_parser("finalize-release", help="Record release/publish outcome without changing guard exit codes")
    fin.add_argument("--job-status", default=os.environ.get("JOB_STATUS", ""))
    fin.add_argument("--data-changed", default="")
    fin.add_argument("--pr-number", default="")
    fin.add_argument("--guard-name", default="")
    fin.add_argument("--guard-exit-code", type=int, default=1)
    fin.add_argument("--reason", default="")
    sub.add_parser("print-summary")
    args = p.parse_args()
    if args.cmd == "finalize-release":
        return cmd_finalize_release(args)
    if args.cmd == "print-summary":
        return cmd_print_summary(args)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
