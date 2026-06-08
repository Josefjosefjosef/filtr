#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 3C: durable ingest+aggregate success artifact (additive telemetry).

Bundles pool manifest, phase status, ingest/aggregate summaries, and run context
into a workflow-uploadable tree. Survives release guard failures independently of
release job outcome. Does not alter publish output or release guards.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from typing import Any

from iu_article_pipeline_phase_status import (
    PHASE_STATUS_NAME,
    read_phase_status,
)
from iu_article_pool import POOL_MANIFEST_NAME, read_article_pool_manifest
from iu_staging import (
    AGG_CHECKPOINT_NAME,
    MANIFEST_NAME,
    read_aggregated_checkpoint,
    staging_root,
)

BUNDLE_MANIFEST_NAME = "ingest_aggregate_success_bundle.json"
SCHEMA_VERSION = 1

ARTIFACT_FILES = (
    POOL_MANIFEST_NAME,
    PHASE_STATUS_NAME,
    "ingest_summary.json",
    "aggregate_summary.json",
    BUNDLE_MANIFEST_NAME,
)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _run_context() -> dict[str, str]:
    return {
        "pipelineRunId": str(os.environ.get("GITHUB_RUN_ID") or "local").strip() or "local",
        "commitSha": str(os.environ.get("GITHUB_SHA") or "").strip(),
        "branch": str(os.environ.get("GITHUB_REF_NAME") or os.environ.get("GITHUB_REF") or "local").strip(),
    }


def _output_dir() -> str:
    return os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        os.environ.get("OUTPUT_DIR", "projects/data"),
    )


def read_ingest_summary(output_dir: str) -> dict[str, Any]:
    path = os.path.join(staging_root(output_dir), MANIFEST_NAME)
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {}
        keys = data.get("sourceBatchKeys") or []
        return {
            "ingestedAt": data.get("ingestedAt"),
            "pipelineRunId": data.get("pipelineRunId"),
            "sourceBatchCount": len(keys) if isinstance(keys, list) else 0,
            "sourceBatchKeys": keys if isinstance(keys, list) else [],
            "schemaVersion": data.get("schemaVersion"),
        }
    except Exception:
        return {}


def read_aggregate_summary(output_dir: str) -> dict[str, Any]:
    cp = read_aggregated_checkpoint(output_dir)
    if not isinstance(cp, dict):
        return {}
    full = cp.get("articles_full") or []
    final = cp.get("articles_final") or []
    out: dict[str, Any] = {
        "generated_at": cp.get("generated_at"),
        "articles_full_count": len(full) if isinstance(full, list) else 0,
        "articles_final_count": len(final) if isinstance(final, list) else 0,
        "handoffMeta": cp.get("handoffMeta"),
        "schemaVersion": cp.get("schemaVersion"),
    }
    its = cp.get("ingest_telemetry_summary")
    if isinstance(its, dict):
        out["ingest_telemetry_summary"] = its
    pfr = cp.get("per_feed_report")
    if isinstance(pfr, list):
        out["per_feed_report_count"] = len(pfr)
    return out


def build_bundle_manifest(
    output_dir: str,
    *,
    artifact_files: list[str] | None = None,
    ingest_summary: dict | None = None,
    aggregate_summary: dict | None = None,
    pipeline_artifacts_persisted: bool = True,
) -> dict[str, Any]:
    ctx = _run_context()
    phase = read_phase_status(output_dir)
    pool = read_article_pool_manifest(output_dir)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": _iso_now(),
        "pipelineRunId": ctx["pipelineRunId"],
        "commitSha": ctx["commitSha"],
        "branch": ctx["branch"],
        "ingest_summary": ingest_summary if ingest_summary is not None else read_ingest_summary(output_dir),
        "aggregate_summary": aggregate_summary if aggregate_summary is not None else read_aggregate_summary(output_dir),
        "article_pool_manifest_present": pool is not None,
        "article_pipeline_phase_status_present": phase is not None,
        "artifact_files": artifact_files or list(ARTIFACT_FILES),
        "pipeline_artifacts_persisted": pipeline_artifacts_persisted,
    }


def write_artifact_tree(output_dir: str, dest_dir: str) -> dict[str, Any]:
    """Copy telemetry + summaries into dest_dir for workflow upload-artifact."""
    staging = staging_root(output_dir)
    os.makedirs(dest_dir, exist_ok=True)
    copied: list[str] = []

    for name in (POOL_MANIFEST_NAME, PHASE_STATUS_NAME):
        src = os.path.join(staging, name)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(dest_dir, name))
            copied.append(name)

    ingest_summary = read_ingest_summary(output_dir)
    aggregate_summary = read_aggregate_summary(output_dir)
    for fname, payload in (
        ("ingest_summary.json", ingest_summary),
        ("aggregate_summary.json", aggregate_summary),
    ):
        path = os.path.join(dest_dir, fname)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
            f.write("\n")
        copied.append(fname)

    bundle = build_bundle_manifest(
        output_dir,
        artifact_files=copied + [BUNDLE_MANIFEST_NAME],
        ingest_summary=ingest_summary,
        aggregate_summary=aggregate_summary,
        pipeline_artifacts_persisted=True,
    )
    bundle_path = os.path.join(dest_dir, BUNDLE_MANIFEST_NAME)
    with open(bundle_path, "w", encoding="utf-8") as f:
        json.dump(bundle, f, ensure_ascii=False, indent=2)
        f.write("\n")
    copied.append(BUNDLE_MANIFEST_NAME)

    return bundle


def verify_artifact_tree(dest_dir: str) -> tuple[bool, list[str]]:
    """Return (ok, missing_files)."""
    missing: list[str] = []
    for name in ARTIFACT_FILES:
        if not os.path.isfile(os.path.join(dest_dir, name)):
            missing.append(name)
    return (len(missing) == 0, missing)


def cmd_build(args: argparse.Namespace) -> int:
    output_dir = args.output_dir or _output_dir()
    dest = args.dest
    if not dest:
        print("ERROR: --dest required", file=sys.stderr)
        return 2
    bundle = write_artifact_tree(output_dir, dest)
    ok, missing = verify_artifact_tree(dest)
    print(f"[DECOUPLED_ARTIFACT] written {dest}", flush=True)
    print(f"INGEST_AGGREGATE_SUCCESS_PERSISTED={'YES' if ok else 'NO'}", flush=True)
    print(f"POOL_MANIFEST_ARTIFACT={'YES' if POOL_MANIFEST_NAME not in missing else 'NO'}", flush=True)
    print(f"PHASE_STATUS_ARTIFACT={'YES' if PHASE_STATUS_NAME not in missing else 'NO'}", flush=True)
    print(f"PIPELINE_ARTIFACTS_PERSISTED={'YES' if ok else 'NO'}", flush=True)
    print(f"pipelineRunId={bundle.get('pipelineRunId')}", flush=True)
    return 0 if ok else 1


def cmd_verify(args: argparse.Namespace) -> int:
    ok, missing = verify_artifact_tree(args.dest)
    if ok:
        print("DECOUPLED_ARTIFACT_VERIFY=PASS", flush=True)
        return 0
    print("DECOUPLED_ARTIFACT_VERIFY=FAIL missing=" + ",".join(missing), flush=True)
    return 1


def main() -> int:
    p = argparse.ArgumentParser(description="Phase 3C ingest+aggregate durable artifact")
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="Build artifact tree for upload-artifact")
    b.add_argument("--dest", required=True, help="Destination directory for artifact files")
    b.add_argument("--output-dir", default="", help="projects/data root (default OUTPUT_DIR env)")
    v = sub.add_parser("verify", help="Verify artifact tree completeness")
    v.add_argument("--dest", required=True)
    args = p.parse_args()
    if args.cmd == "build":
        return cmd_build(args)
    if args.cmd == "verify":
        return cmd_verify(args)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
