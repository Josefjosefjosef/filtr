# -*- coding: utf-8 -*-
"""
Backpressure for article pipeline — bounded work per tick, no article loss.

When a tick discovers many new items (0, 5, 50, or 500+), we:
  • persist everything to staging (ingest shards),
  • publish up to a hard cap now (wall-time + item count),
  • enqueue the rest in staging/publish_queue.json for the next cycle(s).

No forecasting of future article volume — only deterministic caps.
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime
from typing import Any

from iu_staging import staging_root


def _json_safe(value: Any) -> Any:
    """Recursively convert non-JSON types (e.g. datetime, set) for queue persistence."""
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(v) for v in value]
    return value

SCHEMA_PUBLISH_QUEUE = 1
QUEUE_NAME = "publish_queue.json"


def _queue_path(output_dir: str) -> str:
    return os.path.join(staging_root(output_dir), QUEUE_NAME)


def _read_queue(output_dir: str) -> dict:
    path = _queue_path(output_dir)
    if not os.path.isfile(path):
        return {"schemaVersion": SCHEMA_PUBLISH_QUEUE, "items": [], "stats": {}}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError("invalid queue")
        data.setdefault("items", [])
        data.setdefault("stats", {})
        return data
    except Exception:
        return {"schemaVersion": SCHEMA_PUBLISH_QUEUE, "items": [], "stats": {}}


def _write_queue(output_dir: str, data: dict) -> None:
    path = _queue_path(output_dir)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    safe = _json_safe(data)
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(safe, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def _canon_url(item: dict) -> str:
    return str(item.get("url") or "").strip()


def tick_max_publish_items() -> int:
    try:
        return max(10, int(os.getenv("IU_TICK_MAX_PUBLISH_ITEMS", "180") or "180"))
    except Exception:
        return 180


def tick_max_publish_seconds() -> float:
    try:
        return max(30.0, float(os.getenv("IU_TICK_MAX_PUBLISH_SEC", "240") or "240"))
    except Exception:
        return 240.0


def queue_depth(output_dir: str) -> int:
    q = _read_queue(output_dir)
    items = q.get("items") or []
    return len(items) if isinstance(items, list) else 0


def enqueue_items(output_dir: str, items: list[dict]) -> int:
    """Append items deduped by URL; returns new queue depth."""
    if not items:
        return queue_depth(output_dir)
    q = _read_queue(output_dir)
    by_url: dict[str, dict] = {}
    for it in q.get("items") or []:
        if isinstance(it, dict):
            u = _canon_url(it)
            if u:
                by_url[u] = it
    added = 0
    for it in items:
        if not isinstance(it, dict):
            continue
        u = _canon_url(it)
        if not u:
            continue
        if u not in by_url:
            added += 1
        by_url[u] = _json_safe(it)
    q["items"] = list(by_url.values())
    stats = q.setdefault("stats", {})
    stats["last_enqueue_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    stats["depth"] = len(q["items"])
    stats["last_added"] = added
    _write_queue(output_dir, q)
    return len(q["items"])


def drain_items(output_dir: str, max_items: int) -> tuple[list[dict], int]:
    """Pop up to max_items from queue (FIFO by enqueued order in list). Returns (items, remaining)."""
    if max_items <= 0:
        return [], queue_depth(output_dir)
    q = _read_queue(output_dir)
    items = [x for x in (q.get("items") or []) if isinstance(x, dict)]
    if not items:
        return [], 0
    take = items[:max_items]
    rest = items[max_items:]
    q["items"] = rest
    stats = q.setdefault("stats", {})
    stats["last_drain_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    stats["last_drained"] = len(take)
    stats["depth"] = len(rest)
    _write_queue(output_dir, q)
    return take, len(rest)


def split_publish_batch(
    output_dir: str,
    fresh_items: list[dict],
    staged_items: list[dict],
) -> tuple[list[dict], dict]:
    """
    Build aggregate input for this tick:
      1) drain queue (bounded),
      2) merge staging + fresh (URL wins: fresher dict),
      3) if still over cap → enqueue tail, return head for publish now.

    Returns (items_for_aggregate_now, meta).
    """
    cap = tick_max_publish_items()
    drained, remain_q = drain_items(output_dir, cap)
    meta: dict[str, Any] = {
        "cap_items": cap,
        "cap_seconds": tick_max_publish_seconds(),
        "drained_from_queue": len(drained),
        "queue_remaining_after_drain": remain_q,
        "enqueued_this_tick": 0,
        "published_now_count": 0,
    }

    by_url: dict[str, dict] = {}
    for it in staged_items or []:
        if isinstance(it, dict):
            u = _canon_url(it)
            if u:
                by_url[u] = it
    for it in drained:
        u = _canon_url(it)
        if u:
            by_url[u] = it
    for it in fresh_items or []:
        if isinstance(it, dict):
            u = _canon_url(it)
            if u:
                by_url[u] = it

    merged = list(by_url.values())
    merged.sort(key=lambda x: str(x.get("dt") or x.get("publishedAt") or ""), reverse=True)

    if len(merged) <= cap:
        meta["published_now_count"] = len(merged)
        return merged, meta

    now_batch = merged[:cap]
    defer = merged[cap:]
    meta["enqueued_this_tick"] = enqueue_items(output_dir, defer)
    meta["published_now_count"] = len(now_batch)
    meta["queue_depth"] = queue_depth(output_dir)
    return now_batch, meta


class PublishTimeBudget:
    """Wall-clock guard so one spike cannot block the pipeline for tens of minutes."""

    def __init__(self) -> None:
        self.start = time.monotonic()
        self.limit_sec = tick_max_publish_seconds()

    def exceeded(self) -> bool:
        return (time.monotonic() - self.start) >= self.limit_sec

    def elapsed_sec(self) -> float:
        return time.monotonic() - self.start
