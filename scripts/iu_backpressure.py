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
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

from iu_registry import (
    NATIVE_ZDRAVI_LIVENESS_FEED_IDS,
    NATIVE_ZDRAVI_LIVENESS_FEED_ORDER,
    P0_FRESHNESS_SLOT_KEYS,
)
from iu_staging import deserialize_feed_item, staging_root

# Max fresh native Zdraví items reserved per publish batch (production-liveness 2h contract).
NATIVE_ZDRAVI_LIVENESS_RESERVE = 1


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


def _item_sort_dt(item: dict) -> str:
    return str(item.get("dt") or item.get("publishedAt") or "")


def _p0_slot_key_from_item(item: dict) -> str | None:
    """Map ingest item URL → P0 scheduler slot key (headline sources)."""
    url = (_canon_url(item) or "").lower()
    if not url:
        return None
    try:
        host = (urlparse(url).netloc or "").lower()
    except Exception:
        host = ""
    if host.startswith("www."):
        host = host[4:]
    if "novinky.cz" in host or "novinky.cz" in url:
        return "novinky.cz"
    if "seznamzpravy.cz" in host or "seznamzpravy.cz" in url:
        return "seznamzpravy.cz"
    if "isport.idnes.cz" in url:
        return None
    if "idnes.cz" in host or "servis.idnes.cz" in host or "idnes.cz" in url:
        if "c=sport" in url or "c%3dsport" in url:
            return "idnes.cz/sport"
        return "idnes.cz"
    if "ct24.ceskatelevize.cz" in host or "ct24.ceskatelevize.cz" in url:
        return "ceskatelevize.cz"
    if host == "sport.ceskatelevize.cz":
        return "sport.ceskatelevize.cz"
    if host == "sport.cz" or (host.endswith("sport.cz") and "isport" not in host):
        return "sport.cz"
    return None


def _p0_reserve_per_slot() -> int:
    try:
        return max(3, int(os.getenv("IU_P0_AGGREGATE_RESERVE", "15") or "15"))
    except ValueError:
        return 15


def _liveness_fresh_hours() -> float:
    try:
        return max(1.0, float(os.getenv("IU_LIVENESS_FRESH_HOURS", "2") or "2"))
    except ValueError:
        return 2.0


def _item_published_dt(item: dict) -> datetime | None:
    raw = _item_sort_dt(item)
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _is_fresh_liveness_item(item: dict) -> bool:
    dt = _item_published_dt(item)
    if dt is None:
        return False
    cutoff = datetime.now(timezone.utc) - timedelta(hours=_liveness_fresh_hours())
    return dt >= cutoff


def _native_zdravi_feed_id_from_item(item: dict) -> str | None:
    fid = str(item.get("feedId") or "").strip()
    if fid in NATIVE_ZDRAVI_LIVENESS_FEED_IDS:
        return fid
    url = (_canon_url(item) or "").lower()
    if not url:
        return None
    try:
        host = (urlparse(url).netloc or "").lower()
    except Exception:
        host = ""
    if host.startswith("www."):
        host = host[4:]
    if "zdravezpravy.cz" in host:
        return "zdr_zdravezpravy"
    if "zdravotnickydenik.cz" in host:
        return "zdr_zdravotnickydenik"
    return None


def _is_native_zdravi_liveness_item(item: dict) -> bool:
    return _native_zdravi_feed_id_from_item(item) is not None


def _native_zdravi_feed_rank(feed_id: str | None) -> int:
    if not feed_id:
        return len(NATIVE_ZDRAVI_LIVENESS_FEED_ORDER)
    try:
        return NATIVE_ZDRAVI_LIVENESS_FEED_ORDER.index(feed_id)
    except ValueError:
        return len(NATIVE_ZDRAVI_LIVENESS_FEED_ORDER)


def _pick_native_zdravi_liveness_reserve(merged: list[dict]) -> dict | None:
    """Newest fresh native Zdraví item for liveness reserve (max 1)."""
    candidates: list[dict] = []
    for it in merged:
        if not _is_native_zdravi_liveness_item(it):
            continue
        if not _is_fresh_liveness_item(it):
            continue
        candidates.append(it)
    if not candidates:
        return None
    candidates.sort(
        key=lambda it: (
            _item_sort_dt(it),
            -_native_zdravi_feed_rank(_native_zdravi_feed_id_from_item(it)),
        ),
        reverse=True,
    )
    return candidates[0]


def _batch_has_fresh_native_zdravi(batch: list[dict]) -> bool:
    return any(
        _is_native_zdravi_liveness_item(it) and _is_fresh_liveness_item(it) for it in batch
    )


def _cap_batch_with_p0_reserves(
    merged: list[dict], cap: int
) -> tuple[list[dict], list[dict], int, int]:
    """
    Guarantee newest items per P0 headline slot survive global cap trimming.
    Reserve one fresh native Zdraví item when eligible (production-liveness contract).
    Returns (now_batch, defer, p0_reserved_count, zdravi_reserved_count).
    """
    if len(merged) <= cap:
        return merged, [], 0, 0

    reserve_n = _p0_reserve_per_slot()
    by_slot: dict[str, list[dict]] = {}
    non_p0: list[dict] = []
    for it in merged:
        sk = _p0_slot_key_from_item(it)
        if sk and sk in P0_FRESHNESS_SLOT_KEYS:
            by_slot.setdefault(sk, []).append(it)
        else:
            non_p0.append(it)

    reserved: list[dict] = []
    reserved_urls: set[str] = set()
    p0_reserved_count = 0
    for sk in sorted(by_slot.keys()):
        rows = sorted(by_slot[sk], key=_item_sort_dt, reverse=True)
        for it in rows[:reserve_n]:
            u = _canon_url(it)
            if u and u in reserved_urls:
                continue
            if u:
                reserved_urls.add(u)
            reserved.append(it)
            p0_reserved_count += 1

    zdravi_reserved_count = 0
    zdravi_pick = _pick_native_zdravi_liveness_reserve(merged)
    if zdravi_pick is not None and not _batch_has_fresh_native_zdravi(reserved):
        u = _canon_url(zdravi_pick)
        if u and u not in reserved_urls:
            reserved.append(zdravi_pick)
            reserved_urls.add(u)
            zdravi_reserved_count = NATIVE_ZDRAVI_LIVENESS_RESERVE

    non_p0.sort(key=_item_sort_dt, reverse=True)
    now_batch: list[dict] = []
    seen: set[str] = set()
    for it in reserved:
        u = _canon_url(it)
        if u and u in seen:
            continue
        if u:
            seen.add(u)
        now_batch.append(it)

    for it in non_p0:
        if len(now_batch) >= cap:
            break
        u = _canon_url(it)
        if u and u in seen:
            continue
        if u:
            seen.add(u)
        now_batch.append(it)

    if len(now_batch) < cap:
        for it in sorted(merged, key=_item_sort_dt, reverse=True):
            if len(now_batch) >= cap:
                break
            u = _canon_url(it)
            if u and u in seen:
                continue
            if u:
                seen.add(u)
            now_batch.append(it)

    defer: list[dict] = []
    batch_urls = {_canon_url(x) for x in now_batch if _canon_url(x)}
    for it in merged:
        u = _canon_url(it)
        if u and u in batch_urls:
            continue
        defer.append(it)

    return now_batch, defer, p0_reserved_count, zdravi_reserved_count


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
    take = [deserialize_feed_item(x) for x in items[:max_items]]
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
    merged.sort(key=_item_sort_dt, reverse=True)

    if len(merged) <= cap:
        meta["published_now_count"] = len(merged)
        meta["p0_reserved"] = 0
        meta["zdravi_reserved"] = 0
        return merged, meta

    now_batch, defer, p0_reserved, zdravi_reserved = _cap_batch_with_p0_reserves(merged, cap)
    meta["p0_reserved"] = p0_reserved
    meta["zdravi_reserved"] = zdravi_reserved
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
