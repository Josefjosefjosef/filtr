# -*- coding: utf-8 -*-
"""
Article scheduler reports + snapshot helpers for resilient pipeline.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
from datetime import datetime, timezone
from typing import Any

from iu_registry import (
    MAX_FETCH_INTERVAL_MIN,
    MIN_FETCH_INTERVAL_MIN,
    compute_entry_sla,
    registry_active_entries,
)

LATEST_VALID_ARTICLES_SNAPSHOT = "latest_valid_articles_snapshot.json"
LATEST_VALID_STAGING_SNAPSHOT = "latest_valid_staging_snapshot.json"
RELEASE_MANIFEST = "release_manifest.json"


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def build_scheduler_report(
    registry: dict,
    state: dict,
    *,
    run_id: str = "",
    main_commit: str = "",
    trigger_source: str = "workflow_dispatch",
    trigger_time: str | None = None,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    entries = registry_active_entries(registry)
    selected_ids = set((state.get("last_scheduler_tick") or {}).get("selected_source_ids") or [])
    skipped = (state.get("last_scheduler_tick") or {}).get("skipped_sources") or []
    source_rows = []
    for e in entries:
        sla = compute_entry_sla(state, e, now)
        source_rows.append(
            {
                "source_id": sla["source_id"],
                "eligible": sla["eligible"],
                "overdue": sla["overdue"],
                "urgent": sla["urgent"],
                "priority_boost": sla["priority_boost"],
                "in_flight": sla["in_flight"],
                "last_checked_at": sla["last_checked_at"],
                "next_allowed_at": sla["next_allowed_at"],
                "must_check_before": sla["must_check_before"],
                "selected": sla["source_id"] in selected_ids,
            }
        )
    skip_reasons = {}
    for row in skipped:
        sid = str(row.get("source_id") or "")
        reason = str(row.get("reason") or "SKIPPED")
        skip_reasons.setdefault(reason, []).append(sid)
    return {
        "report": "ARTICLE_SCHEDULER_REPORT",
        "run_id": run_id,
        "main_commit": main_commit,
        "trigger_source": trigger_source,
        "trigger_time": trigger_time or _iso_now(),
        "scheduler_tick": int(state.get("tick_index") or 0),
        "min_fetch_interval_min": MIN_FETCH_INTERVAL_MIN,
        "max_fetch_interval_min": MAX_FETCH_INTERVAL_MIN,
        "selected_sources": sorted(selected_ids),
        "skipped_sources": skipped,
        "skip_reasons": skip_reasons,
        "source_schedule": source_rows,
    }


def build_pipeline_report(base: dict[str, Any] | None = None) -> dict[str, Any]:
    row = dict(base or {})
    row.setdefault("report", "ARTICLE_PIPELINE_REPORT")
    row.setdefault("final_status", "PASS")
    return row


def build_topic_diversity_report(stats: dict[str, Any] | None = None) -> dict[str, Any]:
    s = stats or {}
    return {
        "report": "ARTICLE_TOPIC_DIVERSITY_REPORT",
        "topic_clustering_started": s.get("topic_clustering_started"),
        "topic_clustering_completed": s.get("topic_clustering_completed"),
        "topic_clusters_total": int(s.get("topic_clusters_total") or 0),
        "topic_duplicate_articles_hidden_or_demoted": int(
            s.get("topic_duplicate_articles_hidden_or_demoted") or 0
        ),
        "topic_cluster_max_visible_violation": int(s.get("topic_cluster_max_visible_violation") or 0),
        "source_diversity_violations": int(s.get("source_diversity_violations") or 0),
        "same_source_adjacent_violations": int(s.get("same_source_adjacent_violations") or 0),
    }


def emit_reports(data_dir: str, reports: list[dict]) -> None:
    out_dir = os.path.join(data_dir, "pipeline_reports")
    os.makedirs(out_dir, exist_ok=True)
    for rep in reports:
        name = str(rep.get("report") or "report").lower() + ".json"
        path = os.path.join(out_dir, name)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(rep, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp, path)
        print(f"[{rep.get('report')}] written {path}", flush=True)


def write_latest_valid_snapshot(data_dir: str, articles_path: str, *, run_id: str = "", status: str = "PASS") -> None:
    """Persist last known-good public bundle for rollback / guard fallback."""
    if not os.path.isfile(articles_path):
        return
    snap_path = os.path.join(data_dir, LATEST_VALID_ARTICLES_SNAPSHOT)
    staging_snap = os.path.join(data_dir, LATEST_VALID_STAGING_SNAPSHOT)
    manifest_path = os.path.join(data_dir, RELEASE_MANIFEST)
    shutil.copy2(articles_path, snap_path)
    cp_path = os.path.join(data_dir, "staging", "aggregated_checkpoint.json")
    if os.path.isfile(cp_path):
        shutil.copy2(cp_path, staging_snap)
    manifest = {
        "updatedAt": _iso_now(),
        "run_id": run_id,
        "publish_status": status,
        "articles_snapshot": LATEST_VALID_ARTICLES_SNAPSHOT,
        "staging_snapshot": LATEST_VALID_STAGING_SNAPSHOT if os.path.isfile(staging_snap) else None,
    }
    tmp = manifest_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, manifest_path)
    print(f"[release_manifest] updated status={status}", flush=True)


def restore_latest_valid_snapshot(data_dir: str, articles_path: str) -> bool:
    snap = os.path.join(data_dir, LATEST_VALID_ARTICLES_SNAPSHOT)
    if not os.path.isfile(snap):
        return False
    shutil.copy2(snap, articles_path)
    print("[latest_valid_articles_snapshot] restored production articles.json", flush=True)
    return True


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if not args:
        print("usage: iu_article_scheduler.py emit-reports <data_dir>", file=sys.stderr)
        return 2
    if args[0] == "emit-reports" and len(args) >= 2:
        data_dir = args[1]
        reports_dir = os.path.join(data_dir, "pipeline_reports")
        reports = []
        for fn in (
            "article_scheduler_report.json",
            "article_pipeline_report.json",
            "article_topic_diversity_report.json",
        ):
            p = os.path.join(reports_dir, fn)
            if os.path.isfile(p):
                with open(p, "r", encoding="utf-8") as f:
                    reports.append(json.load(f))
        emit_reports(data_dir, reports)
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
