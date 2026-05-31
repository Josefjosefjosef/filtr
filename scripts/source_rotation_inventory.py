#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Build source rotation inventory from registry + feed_health + articles.json (real data).
Run: py -3 scripts/source_rotation_inventory.py
Writes: projects/data/source_rotation_inventory.json
"""
from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from iu_registry import (  # noqa: E402
    FIXED_MINUTE_SLOTS_BY_KEY,
    HARD_DOMAIN_COOLDOWN_MIN,
    MAX_SOURCE_FETCHES_EXCEPTION_KEYS,
    MAX_SOURCE_FETCHES_PER_HOUR,
    MAX_SOURCE_FETCHES_PER_HOUR_EXCEPTION,
    assert_rotation_frequency_limits,
    entry_fixed_slot_key,
    fetches_per_hour_for_key,
    host_from_url,
    load_registry,
    registry_active_entries,
    scheduler_cooldown_key,
    source_priority_for_key,
)

REGISTRY_PATH = os.path.join(ROOT, "projects", "data", "source_registry.json")
FEED_HEALTH_PATH = os.path.join(ROOT, "projects", "data", "feed_health.json")
ARTICLES_PATH = os.path.join(ROOT, "projects", "data", "articles.json")
OUT_PATH = os.path.join(ROOT, "projects", "data", "source_rotation_inventory.json")



def _parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return None


def _recommended_frequency(fph: int) -> str:
    return f"{fph}/hour" if fph else "unslotted"


def main() -> int:
    reg = load_registry(REGISTRY_PATH)
    entries = registry_active_entries(reg)
    url_to_entry = {(e.get("feed_url") or "").strip(): e for e in entries}

    fh = {}
    if os.path.isfile(FEED_HEALTH_PATH):
        with open(FEED_HEALTH_PATH, "r", encoding="utf-8") as f:
            fh = json.load(f)
    feeds_health = (fh.get("feeds") or {}) if isinstance(fh, dict) else {}

    now = datetime.now(timezone.utc)
    day_ago = now - timedelta(days=1)

    host_articles_24h: dict[str, int] = defaultdict(int)
    if os.path.isfile(ARTICLES_PATH):
        with open(ARTICLES_PATH, "r", encoding="utf-8") as f:
            doc = json.load(f)
        for a in doc.get("articles") or []:
            if not isinstance(a, dict):
                continue
            pub = _parse_iso(a.get("publishedAt"))
            if pub is None or pub < day_ago:
                continue
            h = urlparse(a.get("url") or "").netloc.lower()
            if h.startswith("www."):
                h = h[4:]
            host_articles_24h[h] += 1

    by_ck: dict[str, dict] = {}
    for e in entries:
        ck = scheduler_cooldown_key(e) or normalize_domain(e)
        if ck not in by_ck:
            sk = entry_fixed_slot_key(e)
            slots = FIXED_MINUTE_SLOTS_BY_KEY.get(sk or "") if sk else None
            by_ck[ck] = {
                "source": ck,
                "scheduler_key": ck,
                "slot_key": sk,
                "feeds": [],
                "sections": set(),
                "labels": [],
                "display_weight_max": 0.0,
                "fetches_per_hour": len(slots) if slots else 0,
                "slot_minutes": sorted(slots) if slots else [],
                "accepted_last_snapshot": 0,
                "articles_in_bundle_24h": 0,
            }
        row = by_ck[ck]
        row["feeds"].append(
            {
                "id": e.get("id"),
                "label": e.get("label"),
                "feed_url": e.get("feed_url"),
                "section_primary": e.get("section_primary"),
            }
        )
        row["sections"].add(str(e.get("section_primary") or ""))
        row["labels"].append(str(e.get("label") or ""))
        row["display_weight_max"] = max(
            row["display_weight_max"], float(e.get("display_weight") or 0.0)
        )
        url = (e.get("feed_url") or "").strip()
        rep = feeds_health.get(url) if isinstance(feeds_health, dict) else None
        if isinstance(rep, dict):
            row["accepted_last_snapshot"] += int(
                rep.get("accepted") or rep.get("itemsKept") or 0
            )

    host_to_ck: dict[str, set[str]] = defaultdict(set)
    for e in entries:
        h = host_from_url(e.get("feed_url") or "")
        if h.startswith("www."):
            h = h[4:]
        host_to_ck[h].add(scheduler_cooldown_key(e) or "")

    for ck, row in by_ck.items():
        arts = 0
        for h, cks in host_to_ck.items():
            if ck in cks:
                arts += host_articles_24h.get(h, 0)
        row["articles_in_bundle_24h"] = arts
        pri = source_priority_for_key(ck)
        fph = fetches_per_hour_for_key(ck)
        row["priority"] = pri
        row["fetches_per_hour"] = fph
        sk = entry_fixed_slot_key(next(e for e in entries if scheduler_cooldown_key(e) == ck))
        row["slot_minutes"] = sorted(FIXED_MINUTE_SLOTS_BY_KEY.get(sk or ck) or [])
        row["recommended_frequency"] = _recommended_frequency(fph)
        row["estimated_articles_per_day"] = arts * 1  # proxy from 24h bundle count
        row["sections"] = sorted(row["sections"])
        del row["labels"]

    sources = sorted(by_ck.values(), key=lambda x: x["source"])
    plan_rows = []
    for s in sources:
        fph = int(s["fetches_per_hour"])
        plan_rows.append(
            {
                "source": s["source"],
                "priority": s["priority"],
                "fetches_per_hour": fph,
                "slot_minutes": s["slot_minutes"],
                "within_limit": fph
                <= (
                    MAX_SOURCE_FETCHES_PER_HOUR_EXCEPTION
                    if s["source"] in MAX_SOURCE_FETCHES_EXCEPTION_KEYS
                    else MAX_SOURCE_FETCHES_PER_HOUR
                ),
            }
        )

    limit_issues = assert_rotation_frequency_limits()
    if limit_issues:
        print("WARN: slot frequency violations:", limit_issues, file=sys.stderr)

    payload = {
        "generatedAt": now.isoformat().replace("+00:00", "Z"),
        "total_sources": len(sources),
        "total_active_feeds": len(entries),
        "max_fetches_per_source_per_hour": MAX_SOURCE_FETCHES_PER_HOUR,
        "max_fetches_per_source_per_hour_exception": MAX_SOURCE_FETCHES_PER_HOUR_EXCEPTION,
        "exception_keys": sorted(MAX_SOURCE_FETCHES_EXCEPTION_KEYS),
        "hard_cooldown_floor_min": HARD_DOMAIN_COOLDOWN_MIN,
        "rotation_limit_issues": limit_issues,
        "priority_groups": {
            "P0": [s["source"] for s in sources if s["priority"] == "P0"],
            "P1": [s["source"] for s in sources if s["priority"] == "P1"],
            "P2": [s["source"] for s in sources if s["priority"] == "P2"],
        },
        "sources": sources,
        "frequency_plan": plan_rows,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("WROTE", OUT_PATH, "sources=", len(sources))
    return 0


def normalize_domain(e: dict) -> str:
    d = str(e.get("domain") or "").strip().lower()
    if d.startswith("www."):
        d = d[4:]
    return d or "unknown"


if __name__ == "__main__":
    raise SystemExit(main())
