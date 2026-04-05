#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
infoUzel: per-source staging I/O for article pipeline (ingest → aggregate → publish).

Staging lives under OUTPUT_DIR/staging/ (gitignored). Not a second public dataset;
aggregation + publish are the only paths to projects/data/articles.json.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from typing import Any

SCHEMA_SOURCE = 1
SCHEMA_YOUTUBE = 1
SCHEMA_MANIFEST = 1
SCHEMA_AGG_CHECKPOINT = 1

STAGING_SUBDIR = "staging"
SOURCES_SUBDIR = "sources"
MANIFEST_NAME = "ingest_manifest.json"
YOUTUBE_STAGING_NAME = "youtube_pool.json"
AGG_CHECKPOINT_NAME = "aggregated_checkpoint.json"


def staging_root(output_dir: str) -> str:
    return os.path.join(output_dir, STAGING_SUBDIR)


def sources_dir(output_dir: str) -> str:
    return os.path.join(staging_root(output_dir), SOURCES_SUBDIR)


def safe_batch_filename(batch_key: str) -> str:
    """Filesystem-safe name from scheduler batch key (stable, readable when possible)."""
    raw = (batch_key or "").strip() or "unknown"
    safe = re.sub(r"[^a-zA-Z0-9_.@-]+", "_", raw)
    if len(safe) > 180:
        h = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]
        safe = safe[:120] + "_" + h
    return safe + ".json"


def _iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def _parse_iso(s: str | None) -> datetime | None:
    if not s or not isinstance(s, str):
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def serialize_feed_item(item: dict) -> dict:
    """Prepare ingest item dict for JSON (datetime → ISO; token sets → sorted list)."""
    out = dict(item)
    dt = out.get("dt")
    if isinstance(dt, datetime):
        out["dt"] = _iso(dt)
        out["_dt_serialized"] = True
    # build_articles tokenize_title() returns a set; json.dump requires list/str/…
    tok = out.get("tokens")
    if isinstance(tok, set):
        out["tokens"] = sorted(tok)
    return out


def deserialize_feed_item(item: dict) -> dict:
    """Restore dt from staging JSON; token lists → set for in-memory clustering."""
    out = dict(item)
    if out.get("_dt_serialized") and isinstance(out.get("dt"), str):
        p = _parse_iso(out["dt"])
        if p is not None:
            out["dt"] = p
        out.pop("_dt_serialized", None)
    elif isinstance(out.get("dt"), str):
        p = _parse_iso(out["dt"])
        if p is not None:
            out["dt"] = p
    tok = out.get("tokens")
    if isinstance(tok, list):
        out["tokens"] = set(tok)
    return out


def serialize_youtube_row(row: dict) -> dict:
    out = dict(row)
    dt = out.get("_dt")
    if isinstance(dt, datetime):
        out["_dt"] = _iso(dt)
    return out


def deserialize_youtube_row(row: dict) -> dict:
    out = dict(row)
    if isinstance(out.get("_dt"), str):
        p = _parse_iso(out["_dt"])
        if p is not None:
            out["_dt"] = p
    return out


def _atomic_write_json(path: str, payload: Any) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def write_source_staging(
    output_dir: str,
    batch_key: str,
    items: list[dict],
    feed_reports: list[dict],
    ingested_at: str,
) -> str:
    path = os.path.join(sources_dir(output_dir), safe_batch_filename(batch_key))
    payload = {
        "schemaVersion": SCHEMA_SOURCE,
        "sourceBatchKey": batch_key,
        "ingestedAt": ingested_at,
        "items": [serialize_feed_item(x) for x in items],
        "feedReports": feed_reports,
    }
    _atomic_write_json(path, payload)
    return path


def write_youtube_staging(output_dir: str, rows: list[dict], ingested_at: str) -> str:
    path = os.path.join(staging_root(output_dir), YOUTUBE_STAGING_NAME)
    payload = {
        "schemaVersion": SCHEMA_YOUTUBE,
        "ingestedAt": ingested_at,
        "rows": [serialize_youtube_row(r) for r in rows],
    }
    _atomic_write_json(path, payload)
    return path


def write_ingest_manifest(output_dir: str, batch_keys: list[str], ingested_at: str) -> str:
    path = os.path.join(staging_root(output_dir), MANIFEST_NAME)
    payload = {
        "schemaVersion": SCHEMA_MANIFEST,
        "ingestedAt": ingested_at,
        "sourceBatchKeys": sorted(set(batch_keys)),
    }
    pr = (os.environ.get("GITHUB_RUN_ID") or os.environ.get("IU_PIPELINE_RUN_ID") or "").strip()
    if pr:
        payload["pipelineRunId"] = pr
    _atomic_write_json(path, payload)
    return path


def write_aggregated_checkpoint(output_dir: str, payload: dict) -> str:
    path = os.path.join(staging_root(output_dir), AGG_CHECKPOINT_NAME)
    wrap = {"schemaVersion": SCHEMA_AGG_CHECKPOINT, **payload}
    _atomic_write_json(path, wrap)
    return path


def read_aggregated_checkpoint(output_dir: str) -> dict | None:
    path = os.path.join(staging_root(output_dir), AGG_CHECKPOINT_NAME)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def load_staging_for_aggregate(output_dir: str) -> dict[str, Any]:
    """
    Load all per-source staging shards + youtube pool.
    Returns dict: all_items, per_feed_report (flat), youtube_rows, manifest (optional).
    Skips invalid JSON files; one bad shard does not fail the whole load.
    """
    root = staging_root(output_dir)
    sdir = sources_dir(output_dir)
    all_items: list[dict] = []
    per_feed_report: list[dict] = []
    youtube_rows: list[dict] = []

    manifest_path = os.path.join(root, MANIFEST_NAME)
    manifest = None
    if os.path.isfile(manifest_path):
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
        except Exception:
            manifest = None

    if os.path.isdir(sdir):
        for fn in sorted(os.listdir(sdir)):
            if not fn.endswith(".json"):
                continue
            fp = os.path.join(sdir, fn)
            try:
                with open(fp, "r", encoding="utf-8") as f:
                    blob = json.load(f)
            except Exception:
                continue
            if not isinstance(blob, dict):
                continue
            items = blob.get("items") or []
            reps = blob.get("feedReports") or []
            if isinstance(items, list):
                for it in items:
                    if isinstance(it, dict):
                        all_items.append(deserialize_feed_item(it))
            if isinstance(reps, list):
                for r in reps:
                    if isinstance(r, dict):
                        per_feed_report.append(r)

    yt_path = os.path.join(root, YOUTUBE_STAGING_NAME)
    if os.path.isfile(yt_path):
        try:
            with open(yt_path, "r", encoding="utf-8") as f:
                yt_blob = json.load(f)
            rows = (yt_blob or {}).get("rows") if isinstance(yt_blob, dict) else None
            if isinstance(rows, list):
                for r in rows:
                    if isinstance(r, dict):
                        youtube_rows.append(deserialize_youtube_row(r))
        except Exception:
            pass

    return {
        "all_items": all_items,
        "per_feed_report": per_feed_report,
        "youtube_rows": youtube_rows,
        "manifest": manifest,
    }


def ensure_staging_dirs(output_dir: str) -> None:
    os.makedirs(sources_dir(output_dir), exist_ok=True)
