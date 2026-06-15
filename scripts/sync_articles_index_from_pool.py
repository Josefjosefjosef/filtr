#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sync articles/index.json freshness metadata from publishable_pool.json.

Fast pool updates publishable_pool + feed chunks without running the slow-path
publish phase that rebuilds retention shards. This script keeps articles/index.json
generatedAt aligned with the pool so prod freshness guards and retention index
consumers do not report split-brain staleness.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_SCRIPTS)
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from iu_article_pool import read_publishable_pool  # noqa: E402


def _parse_day(value: str) -> datetime | None:
    if not value or len(value) < 10:
        return None
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _safe_read_json(path: str) -> dict | None:
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
        return raw if isinstance(raw, dict) else None
    except Exception:
        return None


def _atomic_write_json(path: str, payload: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    os.replace(tmp, path)


def sync_articles_index_from_pool(output_dir: str, retention_days: int = 45) -> dict:
    pool = read_publishable_pool(output_dir)
    if pool is None:
        raise SystemExit(f"ERROR: missing publishable_pool.json in {output_dir}")

    generated_at = str(pool.get("generatedAt") or "").strip()
    if not generated_at:
        raise SystemExit("ERROR: publishable_pool.json missing generatedAt")

    articles = [a for a in (pool.get("articles") or []) if isinstance(a, dict)]
    index_path = os.path.join(output_dir, "articles", "index.json")
    existing = _safe_read_json(index_path) or {}

    prev_days = existing.get("days") if isinstance(existing.get("days"), list) else []
    prev_counts: dict[str, int] = {}
    prev_order: list[str] = []
    for row in prev_days:
        if not isinstance(row, dict):
            continue
        day = str(row.get("date") or "").strip()
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", day):
            continue
        prev_order.append(day)
        try:
            prev_counts[day] = int(row.get("count") or 0)
        except Exception:
            prev_counts[day] = 0

    pool_counts: dict[str, int] = {}
    for article in articles:
        pub = str(article.get("publishedAt") or "").strip()
        if len(pub) < 10:
            continue
        day = pub[:10]
        pool_counts[day] = pool_counts.get(day, 0) + 1

    merged_counts = dict(prev_counts)
    for day, count in pool_counts.items():
        merged_counts[day] = max(merged_counts.get(day, 0), count)

    all_days = set(prev_order) | set(merged_counts.keys())
    ordered_days = sorted(all_days, reverse=True)

    cutoff = datetime.now(timezone.utc).date() - timedelta(days=max(1, retention_days) - 1)
    keep_days: list[str] = []
    for day in ordered_days:
        parsed = _parse_day(day)
        if parsed and parsed.date() >= cutoff:
            keep_days.append(day)

    index_payload = {
        "generatedAt": generated_at,
        "poolGeneratedAt": generated_at,
        "sourcePool": "publishable_pool.json",
        "days": [{"date": day, "count": int(merged_counts.get(day, 0) or 0)} for day in keep_days],
    }
    _atomic_write_json(index_path, index_payload)

    return {
        "index_path": index_path,
        "generatedAt": generated_at,
        "poolGeneratedAt": generated_at,
        "day_count": len(keep_days),
        "pool_articles": len(articles),
        "split_brain_fixed": existing.get("generatedAt") != generated_at,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync articles/index.json from publishable_pool.json")
    parser.add_argument(
        "--output-dir",
        default=os.path.join(_ROOT, "projects", "data"),
        help="Directory containing publishable_pool.json",
    )
    parser.add_argument("--retention-days", type=int, default=int(os.getenv("RETENTION_DAYS", "45") or "45"))
    args = parser.parse_args()
    summary = sync_articles_index_from_pool(args.output_dir, retention_days=args.retention_days)
    print(json.dumps(summary, indent=2))
    print(f"ARTICLES_INDEX_SYNCED=YES generatedAt={summary['generatedAt']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
