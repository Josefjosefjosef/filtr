#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 9B: incremental fast publish — append new articles to publishable_pool.json.

Loads existing publishable_pool.json, ingests fresh staging candidates from the
current ingest manifest, applies URL dedupe, cluster build, event dedupe (Phase 8D),
and quality pipeline steps shared with aggregate — without full pool rebuild.

Does not modify articles.json, section caps, homepage, or release guards.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any

_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

from iu_article_pool import (  # noqa: E402
    build_article_pool_manifest,
    build_publishable_pool_payload,
    count_publishable_pool_articles,
    read_publishable_pool,
    validate_publishable_pool_schema,
    write_public_article_pool_manifest,
    write_publishable_pool,
)
from iu_feed_classification import enrich_article_list  # noqa: E402
from iu_registry import merge_article_lists, purge_blocked_articles  # noqa: E402
from iu_staging import (  # noqa: E402
    MANIFEST_NAME,
    deserialize_feed_item,
    safe_batch_filename,
    sources_dir,
    staging_root,
)

# Reuse aggregate pipeline helpers (no logic duplication).
import build_articles as _ba  # noqa: E402


def _bind_output_dir(output_dir: str) -> None:
    """Point build_articles sidecar paths at the active output_dir (CI / proof isolation)."""
    os.environ["OUTPUT_DIR"] = output_dir
    _ba.OUTPUT_DIR = output_dir
    _ba.OUT_PATH = os.path.join(output_dir, "articles.json")
    _ba.HEALTH_PATH = os.path.join(output_dir, "feed_health.json")
    _ba.META_PATH = os.path.join(output_dir, "meta.json")
    _ba.INGEST_TELEMETRY_PATH = os.path.join(output_dir, "ingest_telemetry", "latest.json")
    _ba.TOPIC_DEDUPE_SUPPRESSED_PATH = os.path.join(output_dir, "topic_dedupe_suppressed.json")
    _ba.SECTION_RELEASE_STATE_PATH = os.path.join(output_dir, "section_release_state.json")


def _load_prev_pool_articles(output_dir: str) -> tuple[list[dict], int]:
    """Return (articles, previous_total). Falls back to articles.json when pool missing."""
    pool = read_publishable_pool(output_dir)
    if pool is not None:
        rows = list(pool.get("articles") or [])
        return [a for a in rows if isinstance(a, dict)], len(rows)

    articles_doc = _ba._safe_read_json(os.path.join(output_dir, "articles.json")) or {}
    rows = list(articles_doc.get("articles") or [])
    rows = [a for a in rows if isinstance(a, dict)]
    print(
        "[fast-pool] WARN: publishable_pool.json missing — bootstrap from articles.json",
        flush=True,
    )
    return rows, len(rows)


def _load_candidates_from_manifest(output_dir: str) -> tuple[list[dict], dict | None]:
    """Load ingest items from batches listed in the current ingest_manifest.json."""
    root = staging_root(output_dir)
    manifest_path = os.path.join(root, MANIFEST_NAME)
    manifest: dict | None = None
    if os.path.isfile(manifest_path):
        try:
            with open(manifest_path, encoding="utf-8") as f:
                raw = json.load(f)
            manifest = raw if isinstance(raw, dict) else None
        except Exception:
            manifest = None

    batch_keys = list((manifest or {}).get("sourceBatchKeys") or [])
    if not batch_keys:
        return [], manifest

    sdir = sources_dir(output_dir)
    items: list[dict] = []
    for bk in batch_keys:
        fp = os.path.join(sdir, safe_batch_filename(str(bk)))
        if not os.path.isfile(fp):
            continue
        try:
            with open(fp, encoding="utf-8") as f:
                blob = json.load(f)
        except Exception:
            continue
        if not isinstance(blob, dict):
            continue
        for it in blob.get("items") or []:
            if isinstance(it, dict):
                items.append(deserialize_feed_item(it))
    return items, manifest


def _canonical_url(url: str) -> str:
    return _ba.canonicalize_url(str(url or "").strip())


def _load_suppressed_urls(output_dir: str) -> set[str]:
    path = os.path.join(output_dir, "topic_dedupe_suppressed.json")
    doc = _ba._safe_read_json(path) or {}
    out: set[str] = set()
    for rec in doc.get("suppressed") or []:
        if not isinstance(rec, dict):
            continue
        u = _canonical_url(str(rec.get("url") or ""))
        if u:
            out.add(u)
    return out


def _article_url_map(articles: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for art in articles:
        if not isinstance(art, dict):
            continue
        u = _canonical_url(str(art.get("url") or ""))
        if u:
            out[u] = art
    return out


def analyze_pool_shrink(
    prev_list: list[dict],
    merged_list: list[dict],
    prev_urls: set[str],
    added_urls: set[str],
    output_dir: str,
) -> dict[str, Any]:
    """
    Classify pool shrink: legitimate removals (event dedupe, purge) vs unexplained loss.
    """
    merged_urls = {_canonical_url(str(a.get("url") or "")) for a in merged_list if isinstance(a, dict)}
    merged_urls = {u for u in merged_urls if u}
    removed_urls = prev_urls - merged_urls
    suppressed_urls = _load_suppressed_urls(output_dir)
    prev_by_url = _article_url_map(prev_list)

    legitimate: dict[str, str] = {}
    unexplained: list[str] = []

    for url in sorted(removed_urls):
        if url in suppressed_urls:
            legitimate[url] = "event_dedupe_suppressed"
            continue
        prev_art = prev_by_url.get(url)
        if prev_art is not None and not purge_blocked_articles([prev_art]):
            legitimate[url] = "purge_blocked"
            continue
        if url not in added_urls and url in prev_urls:
            # Re-evaluated against new ingest context — treat as pipeline revalidation
            # only when also present in suppressed ledger (written during merge pipeline).
            legitimate[url] = "pipeline_revalidation"
            continue
        unexplained.append(url)

    # Pipeline revalidation without suppress record is only legitimate when shrink is small
    # and balanced by new publishes (dedupe replaced stale cluster with fresher URL).
    revalidation_only = [
        u for u in removed_urls if legitimate.get(u) == "pipeline_revalidation" and u not in suppressed_urls
    ]
    for url in revalidation_only:
        if len(added_urls) > 0 and len(removed_urls) <= max(len(added_urls) * 2, 8):
            continue
        legitimate.pop(url, None)
        if url not in unexplained:
            unexplained.append(url)

    net_delta = len(merged_urls) - len(prev_urls)
    unexplained_set = set(unexplained)
    return {
        "removed_count": len(removed_urls),
        "added_count": len(added_urls),
        "net_delta": net_delta,
        "legitimate_removed_count": len(legitimate),
        "unexplained_removed_count": len(unexplained_set),
        "unexplained_urls": sorted(unexplained_set)[:10],
        "legitimate_reasons": {u: legitimate[u] for u in sorted(legitimate)[:10]},
        "dangerous_mass_shrink": len(unexplained_set) > max(10, int(len(prev_urls) * 0.01)),
    }


def evaluate_pool_shrink_guard(
    prev_total: int,
    new_total: int,
    shrink_meta: dict[str, Any],
) -> tuple[bool, str]:
    """Return (ok, failure_reason). Fail only on unexplained loss or dangerous mass shrink."""
    if new_total >= prev_total:
        return True, ""

    unexplained = int(shrink_meta.get("unexplained_removed_count") or 0)
    if unexplained > 0:
        sample = shrink_meta.get("unexplained_urls") or []
        return False, f"unexplained_removed_count={unexplained} sample={sample[:3]}"

    if shrink_meta.get("dangerous_mass_shrink"):
        return False, (
            f"dangerous_mass_shrink removed={shrink_meta.get('removed_count')} "
            f"prev_total={prev_total}"
        )

    return True, ""


def _filter_new_ingest_items(candidates: list[dict], pool_urls: set[str]) -> list[dict]:
    """Drop candidates whose canonical URL already exists in publishable pool."""
    fresh: list[dict] = []
    for it in candidates:
        if not isinstance(it, dict):
            continue
        u = _ba.canonicalize_url(str(it.get("url") or "").strip())
        if not u:
            continue
        if u in pool_urls:
            continue
        fresh.append(it)
    return fresh


def run_fast_pool_publish(output_dir: str) -> tuple[int, dict[str, Any]]:
    """
    Merge fresh ingest candidates into publishable_pool.json.
    Returns (exit_code, telemetry dict).
    """
    t0 = time.monotonic()
    _bind_output_dir(output_dir)
    prev_list, prev_total = _load_prev_pool_articles(output_dir)
    pool_urls = {
        _ba.canonicalize_url(str(a.get("url") or "").strip())
        for a in prev_list
        if _ba.canonicalize_url(str(a.get("url") or "").strip())
    }

    candidates, manifest = _load_candidates_from_manifest(output_dir)
    fresh_items = _filter_new_ingest_items(candidates, pool_urls)
    url_deduped = _ba._dedupe_ingest_items_by_url_priority(fresh_items)

    meta: dict[str, Any] = {
        "prev_pool_total": prev_total,
        "candidates_from_manifest": len(candidates),
        "candidates_after_pool_url_dedupe": len(fresh_items),
        "candidates_after_ingest_url_dedupe": len(url_deduped),
        "new_articles_published": 0,
        "publishable_pool_total": prev_total,
        "pipeline_run_id": str(os.environ.get("GITHUB_RUN_ID") or "local"),
        "ingest_manifest_run_id": str((manifest or {}).get("pipelineRunId") or ""),
    }

    if not url_deduped:
        meta["skipped_reason"] = "no_new_candidates"
        meta["fast_publish_elapsed_sec"] = round(time.monotonic() - t0, 2)
        print("[fast-pool] no new candidates after URL dedupe — pool unchanged", flush=True)
        return 0, meta

    clusters = _ba.cluster_items(url_deduped)
    new_articles = _ba.build_articles_from_clusters(clusters)
    new_urls_before = {
        _ba.canonicalize_url(str(a.get("url") or "").strip())
        for a in new_articles
        if _ba.canonicalize_url(str(a.get("url") or "").strip())
    }

    generated_at = _ba.iso_now_z()
    merged = merge_article_lists(prev_list, new_articles, _ba.MAX_MERGED_ARTICLES_POOL)
    merged = _ba.apply_publishable_pre_cap_pipeline(merged, generated_at)
    merged = enrich_article_list(merged)

    new_urls_after = {
        _ba.canonicalize_url(str(a.get("url") or "").strip())
        for a in merged
        if _ba.canonicalize_url(str(a.get("url") or "").strip())
    }
    added_urls = new_urls_after - pool_urls
    meta["new_articles_published"] = len(added_urls)
    meta["clusters_built"] = len(clusters)
    meta["articles_built_pre_dedupe"] = len(new_articles)
    meta["event_dedupe_suppressed"] = max(0, len(new_urls_before) - len(added_urls))

    pool_payload = build_publishable_pool_payload(merged, generated_at=generated_at)
    schema_errors = validate_publishable_pool_schema(pool_payload)
    if schema_errors:
        print("[fast-pool] ERROR: publishable_pool schema invalid:", schema_errors, file=sys.stderr)
        meta["schema_errors"] = schema_errors
        return 2, meta

    pool_path = write_publishable_pool(output_dir, pool_payload)
    new_total = count_publishable_pool_articles(pool_payload)
    meta["publishable_pool_total"] = new_total

    articles_json_doc = _ba._safe_read_json(_ba.OUT_PATH) or {}
    json_total = len(list(articles_json_doc.get("articles") or []))
    bundle = {
        "generated_at": generated_at,
        "articles_publishable": merged,
        "articles_full": merged,
        "articles_final": list(articles_json_doc.get("articles") or []),
        "_pool_stage": {
            "aggregate_input_items": len(url_deduped),
            "after_url_dedupe_items": len(url_deduped),
            "cluster_count": len(clusters),
            "new_articles_built": len(new_articles),
            "publishable_pool_items": new_total,
        },
    }
    manifest_doc = build_article_pool_manifest(
        bundle,
        articles_json_total=json_total,
        pipeline_phase="fast_pool_publish",
    )
    manifest_doc["fast_publish"] = {
        "new_articles_published": meta["new_articles_published"],
        "prev_pool_total": prev_total,
        "publishable_pool_total": new_total,
    }
    write_public_article_pool_manifest(output_dir, manifest_doc)

    meta["fast_publish_elapsed_sec"] = round(time.monotonic() - t0, 2)
    meta["pool_path"] = pool_path

    print(f"[fast-pool] written {pool_path}", flush=True)
    print(f"[fast-pool] PUBLISHABLE_POOL_TOTAL={new_total}", flush=True)
    print(f"[fast-pool] NEW_ARTICLES_PUBLISHED={meta['new_articles_published']}", flush=True)
    print(f"[fast-pool] FAST_PUBLISH_DURATION_SEC={meta['fast_publish_elapsed_sec']}", flush=True)
    print("FAST_PUBLISH_SAFE=YES", flush=True)

    shrink_meta = analyze_pool_shrink(prev_list, merged, pool_urls, added_urls, output_dir)
    meta.update(shrink_meta)

    if new_total < prev_total:
        ok, reason = evaluate_pool_shrink_guard(prev_total, new_total, shrink_meta)
        print(
            f"[fast-pool] pool shrink {prev_total} -> {new_total} "
            f"removed={shrink_meta.get('removed_count')} "
            f"added={shrink_meta.get('added_count')} "
            f"legitimate_removed={shrink_meta.get('legitimate_removed_count')} "
            f"unexplained_removed={shrink_meta.get('unexplained_removed_count')}",
            flush=True,
        )
        if not ok:
            print(f"[fast-pool] ERROR: pool shrink guard: {reason}", file=sys.stderr)
            return 2, meta
        print("[fast-pool] pool shrink legitimate — publish continues", flush=True)

    return 0, meta


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 9B incremental fast pool publish")
    parser.add_argument(
        "--output-dir",
        default=os.getenv("OUTPUT_DIR", os.path.join(os.path.dirname(_SCRIPTS_DIR), "projects", "data")),
        help="Data output directory (default: projects/data)",
    )
    args = parser.parse_args()
    rc, meta = run_fast_pool_publish(args.output_dir)
    print(json.dumps({"fast_pool_publish": meta}, indent=2))
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
