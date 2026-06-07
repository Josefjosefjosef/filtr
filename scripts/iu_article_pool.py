#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 3A: clean article pool manifest (read-only telemetry).

The clean pool is the post-aggregate article list after fetch, normalize, URL/title
clustering, event dedupe, section classification, and quality gates — but before
release CI guards, PR creation, publish writes, and homepage selection.

Manifest path: OUTPUT_DIR/staging/article_pool_manifest.json (gitignored staging tree).
Does not alter articles.json, bootstrap, index, or release guard behavior.
"""

from __future__ import annotations

import json
import os
from collections import Counter
from datetime import datetime, timezone
from typing import Any

from iu_staging import staging_root

POOL_MANIFEST_NAME = "article_pool_manifest.json"
SCHEMA_VERSION = 1

CLEAN_POOL_DEFINITION = (
    "Articles after RSS fetch, normalize, URL dedupe, title clustering, "
    "event-level dedupe, section classification, and quality/relevance checks; "
    "before release guards, PR creation, publish, and homepage selection."
)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _section_key(article: dict) -> str:
    return str(article.get("topic") or article.get("section") or "aktualne").strip() or "aktualne"


def _source_key(article: dict) -> str:
    fid = str(article.get("feedId") or "").strip()
    if fid:
        return fid
    srcs = article.get("sources") or []
    if isinstance(srcs, list) and srcs:
        first = srcs[0] if isinstance(srcs[0], dict) else {}
        return str(first.get("name") or "unknown").strip() or "unknown"
    return "unknown"


def build_article_pool_manifest(
    bundle: dict,
    *,
    handoff_meta: dict | None = None,
    ingest_manifest: dict | None = None,
    aggregate_input_count: int | None = None,
    pipeline_phase: str = "aggregate",
) -> dict:
    """Build read-only pool manifest from aggregate bundle (no publish side effects)."""
    articles_full = list(bundle.get("articles_full") or [])
    articles_final = list(bundle.get("articles_final") or [])
    tel_summary = bundle.get("ingest_telemetry_summary") or {}
    if not isinstance(tel_summary, dict):
        tel_summary = {}
    topic_stats = bundle.get("topic_dedupe") or {}
    if not isinstance(topic_stats, dict):
        topic_stats = {}
    pool_stage = bundle.get("_pool_stage") or {}
    if not isinstance(pool_stage, dict):
        pool_stage = {}

    run_id = ""
    if isinstance(handoff_meta, dict):
        run_id = str(handoff_meta.get("aggregateWorkflowRunId") or "").strip()
    if not run_id and isinstance(ingest_manifest, dict):
        run_id = str(ingest_manifest.get("pipelineRunId") or "").strip()
    if not run_id:
        run_id = str(os.environ.get("GITHUB_RUN_ID") or "local").strip() or "local"

    agg_in = int(
        pool_stage.get("aggregate_input_items")
        or aggregate_input_count
        or tel_summary.get("total_raw_items")
        or 0
    )
    after_url = int(
        pool_stage.get("after_url_dedupe_items")
        or tel_summary.get("total_after_dedupe_items")
        or 0
    )
    cluster_count = int(pool_stage.get("cluster_count") or 0)
    new_built = int(pool_stage.get("new_articles_built") or 0)

    total_raw = int(tel_summary.get("total_raw_items") or agg_in or 0)
    total_normalized = int(tel_summary.get("total_normalized_items") or tel_summary.get("total_parsed_items") or 0)
    if not total_normalized and agg_in:
        total_normalized = agg_in

    url_dedupe_dropped = max(0, agg_in - after_url) if agg_in and after_url else max(0, total_raw - after_url)
    suppressed = int(topic_stats.get("suppressed_count") or 0)
    clusters_merged = int(topic_stats.get("clusters_merged") or 0)

    per_section = dict(Counter(_section_key(a) for a in articles_full if isinstance(a, dict)))
    per_source = dict(Counter(_source_key(a) for a in articles_full if isinstance(a, dict)))

    clean_count = len(articles_full)
    final_count = len(articles_final)

    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": str(bundle.get("generated_at") or _iso_now()),
        "source_run_id": run_id,
        "pipeline_phase": pipeline_phase,
        "pool_boundary": "post_dedupe_pre_release_guards",
        "clean_article_pool_definition": CLEAN_POOL_DEFINITION,
        "total_raw_items": total_raw,
        "total_normalized": total_normalized,
        "total_after_url_dedupe": after_url or None,
        "total_after_event_dedupe": clean_count,
        "total_clean_pool": clean_count,
        "articles_full_count": clean_count,
        "articles_final_count": final_count,
        "cluster_count": cluster_count or None,
        "new_articles_built": new_built or None,
        "per_section_counts": per_section,
        "per_source_counts": per_source,
        "duplicate_counts": {
            "url_dedupe_dropped": url_dedupe_dropped,
            "title_cluster_nonprimary_dropped": max(0, after_url - cluster_count) if after_url and cluster_count else None,
            "event_dedupe_suppressed": suppressed,
        },
        "event_cluster_counts": clusters_merged,
        "suppressed_duplicate_count": suppressed,
        "ready_for_release_count": final_count,
        "blocked_by_release_guard_count": 0,
        "reason_if_not_released": "release_guards_evaluated_in_separate_publish_job",
        "ingest_publish_decoupling_active": False,
        "handoffMeta": handoff_meta if isinstance(handoff_meta, dict) else None,
        "ingest_manifest_ref": {
            "ingestedAt": (ingest_manifest or {}).get("ingestedAt"),
            "sourceBatchKeys": (ingest_manifest or {}).get("sourceBatchKeys"),
            "pipelineRunId": (ingest_manifest or {}).get("pipelineRunId"),
        }
        if isinstance(ingest_manifest, dict)
        else None,
    }


def write_article_pool_manifest(output_dir: str, manifest: dict) -> str:
    """Persist manifest under staging/ (gitignored). Atomic write."""
    root = staging_root(output_dir)
    os.makedirs(root, exist_ok=True)
    path = os.path.join(root, POOL_MANIFEST_NAME)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)
    return path


def read_article_pool_manifest(output_dir: str) -> dict | None:
    path = os.path.join(staging_root(output_dir), POOL_MANIFEST_NAME)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception:
        return None
