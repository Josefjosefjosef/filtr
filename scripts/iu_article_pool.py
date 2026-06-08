#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 3A/6B: clean article pool manifest + publishable pool artifact (read-only telemetry).

The publishable pool is the post-aggregate article list after fetch, normalize, URL/title
clustering, event dedupe, section classification, and quality gates — but before
section/topic/source caps, release CI guards, publish writes, and homepage selection.

Staging manifest: OUTPUT_DIR/staging/article_pool_manifest.json (gitignored).
Public manifest: OUTPUT_DIR/article_pool_manifest.json (telemetry counts at publish).
Public pool: OUTPUT_DIR/publishable_pool.json (full publishable dataset).

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
PUBLIC_POOL_MANIFEST_NAME = "article_pool_manifest.json"
PUBLISHABLE_POOL_NAME = "publishable_pool.json"
SCHEMA_VERSION = 1
PUBLISHABLE_POOL_SCHEMA_VERSION = 1
ARCHITECTURE_VERSION = "7A"
HOMEPAGE_FEED_DATA_SOURCE = "publishable_pool.json"
HOMEPAGE_READONLY_SELECTION = "YES"
UNKNOWN_NOT_EXPORTED = "UNKNOWN_NOT_EXPORTED"

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


def build_publishable_pool_payload(articles: list, *, generated_at: str) -> dict:
    """Build public publishable_pool.json document (Phase 6B)."""
    rows = [a for a in (articles or []) if isinstance(a, dict)]
    per_section = dict(Counter(_section_key(a) for a in rows))
    per_source = dict(Counter(_source_key(a) for a in rows))
    return {
        "generatedAt": generated_at,
        "schemaVersion": PUBLISHABLE_POOL_SCHEMA_VERSION,
        "pipelinePhase": "publishable_pool",
        "articles": rows,
        "counts": {
            "total": len(rows),
            "bySection": per_section,
            "bySource": per_source,
        },
        "stage": {
            "afterNormalize": True,
            "afterUrlDedupe": True,
            "afterEventDedupe": True,
            "afterClassification": True,
            "afterQualityChecks": True,
            "beforeHomepageSelection": True,
            "beforeRailSelection": True,
        },
    }


def write_publishable_pool(output_dir: str, payload: dict) -> str:
    """Persist publishable_pool.json under OUTPUT_DIR. Atomic write."""
    os.makedirs(output_dir, exist_ok=True)
    path = os.path.join(output_dir, PUBLISHABLE_POOL_NAME)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)
    return path


def read_publishable_pool(output_dir: str) -> dict | None:
    path = os.path.join(output_dir, PUBLISHABLE_POOL_NAME)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def write_public_article_pool_manifest(output_dir: str, manifest: dict) -> str:
    """Persist public telemetry manifest at OUTPUT_DIR/article_pool_manifest.json."""
    os.makedirs(output_dir, exist_ok=True)
    path = os.path.join(output_dir, PUBLIC_POOL_MANIFEST_NAME)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)
    return path


def read_public_article_pool_manifest(output_dir: str) -> dict | None:
    path = os.path.join(output_dir, PUBLIC_POOL_MANIFEST_NAME)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def build_article_pool_manifest(
    bundle: dict,
    *,
    handoff_meta: dict | None = None,
    ingest_manifest: dict | None = None,
    aggregate_input_count: int | None = None,
    pipeline_phase: str = "aggregate",
    articles_json_total: int | None = None,
) -> dict:
    """Build read-only pool manifest from aggregate bundle (no publish side effects)."""
    articles_publishable = list(bundle.get("articles_publishable") or [])
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

    publishable_rows = articles_publishable if articles_publishable else articles_full
    per_section = dict(Counter(_section_key(a) for a in publishable_rows if isinstance(a, dict)))
    per_source = dict(Counter(_source_key(a) for a in publishable_rows if isinstance(a, dict)))

    publishable_count = len(publishable_rows)
    clean_count = publishable_count
    final_count = len(articles_final)
    json_total = int(articles_json_total) if articles_json_total is not None else final_count
    after_limits = int(pool_stage.get("after_section_limits_items") or 0)
    if after_limits <= 0 and articles_full:
        after_limits = len(articles_full)

    url_dedupe_article_loss = UNKNOWN_NOT_EXPORTED
    if new_built and cluster_count and new_built > cluster_count:
        url_dedupe_article_loss = max(0, new_built - cluster_count)

    event_dedupe_loss = (
        int(pool_stage.get("event_dedupe_suppressed_pre_limits") or 0)
        if pool_stage.get("event_dedupe_suppressed_pre_limits") is not None
        else (suppressed if suppressed else UNKNOWN_NOT_EXPORTED)
    )

    section_limits_loss = UNKNOWN_NOT_EXPORTED
    if publishable_count and after_limits >= 0:
        section_limits_loss = max(0, publishable_count - after_limits)

    pool_generated_at = str(bundle.get("generated_at") or _iso_now())
    publishable_minus_articles = max(0, publishable_count - json_total)

    architecture_integrity = {
        "ARCHITECTURE_VERSION": ARCHITECTURE_VERSION,
        "PUBLISHABLE_POOL_TOTAL": publishable_count,
        "ARTICLES_JSON_TOTAL": json_total,
        "PUBLISHABLE_MINUS_ARTICLES": publishable_minus_articles,
        "HOMEPAGE_DATA_SOURCE": HOMEPAGE_FEED_DATA_SOURCE,
        "HOMEPAGE_READONLY_SELECTION": HOMEPAGE_READONLY_SELECTION,
        "PUBLISHABLE_POOL_SCHEMA_VERSION": PUBLISHABLE_POOL_SCHEMA_VERSION,
        "PUBLISHABLE_POOL_GENERATED_AT": pool_generated_at,
    }

    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": str(bundle.get("generated_at") or _iso_now()),
        "source_run_id": run_id,
        "pipeline_phase": pipeline_phase,
        "pool_boundary": "post_event_dedupe_pre_section_limits",
        "clean_article_pool_definition": CLEAN_POOL_DEFINITION,
        "POOL_TOTAL": publishable_count,
        "PUBLISHABLE_POOL_TOTAL": publishable_count,
        "ARTICLES_JSON_TOTAL": json_total,
        "HOMEPAGE_VISIBLE_ESTIMATE": UNKNOWN_NOT_EXPORTED,
        "UNIQUE_ARTICLES_LOST_AFTER_DEDUPE": url_dedupe_article_loss,
        "UNIQUE_ARTICLES_LOST_AFTER_EVENT_DEDUPE": event_dedupe_loss,
        "UNIQUE_ARTICLES_LOST_AFTER_SECTION_LIMITS": section_limits_loss,
        "UNIQUE_ARTICLES_LOST_AFTER_HOMEPAGE_SELECTION_ESTIMATE": UNKNOWN_NOT_EXPORTED,
        "total_raw_items": total_raw,
        "total_normalized": total_normalized,
        "total_after_url_dedupe": after_url or None,
        "total_after_event_dedupe": publishable_count,
        "total_publishable_pool": publishable_count,
        "total_clean_pool": clean_count,
        "articles_publishable_count": publishable_count,
        "articles_full_count": len(articles_full),
        "articles_final_count": final_count,
        "articles_json_count": json_total,
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
        **architecture_integrity,
    }


def count_publishable_pool_articles(pool: dict | None) -> int:
    if not isinstance(pool, dict):
        return 0
    counts = pool.get("counts")
    if isinstance(counts, dict):
        total = counts.get("total")
        if isinstance(total, int):
            return total
    articles = pool.get("articles")
    if isinstance(articles, list):
        return len(articles)
    return 0


def count_articles_json_total(payload: dict | None) -> int:
    if not isinstance(payload, dict):
        return 0
    articles = payload.get("articles")
    if isinstance(articles, list):
        return len(articles)
    return 0


def validate_publishable_pool_schema(pool: dict | None) -> list[str]:
    """Return schema validation errors (empty list = valid)."""
    errors: list[str] = []
    if not isinstance(pool, dict):
        return ["publishable_pool payload is not an object"]
    if pool.get("schemaVersion") != PUBLISHABLE_POOL_SCHEMA_VERSION:
        errors.append(
            f"schemaVersion expected {PUBLISHABLE_POOL_SCHEMA_VERSION}, got {pool.get('schemaVersion')!r}"
        )
    if pool.get("pipelinePhase") != "publishable_pool":
        errors.append(f"pipelinePhase expected publishable_pool, got {pool.get('pipelinePhase')!r}")
    if not str(pool.get("generatedAt") or "").strip():
        errors.append("generatedAt missing")
    articles = pool.get("articles")
    if not isinstance(articles, list):
        errors.append("articles must be an array")
    elif not articles:
        errors.append("articles array is empty")
    stage = pool.get("stage")
    if not isinstance(stage, dict):
        errors.append("stage object missing")
    else:
        for flag in (
            "beforeHomepageSelection",
            "afterEventDedupe",
            "afterClassification",
        ):
            if stage.get(flag) is not True:
                errors.append(f"stage.{flag} must be true")
    return errors


def read_articles_json(output_dir: str) -> dict | None:
    path = os.path.join(output_dir, "articles.json")
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


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
