# -*- coding: utf-8 -*-
"""
RSS rotation foundation (Phase 1) — metadata, schema, validation only.

No scheduler selection, fetch, or publish behavior changes.
"""
from __future__ import annotations

import json
import os
from enum import Enum
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROTATION_BATCH_REGISTRY_PATH = os.path.join(ROOT, "projects", "data", "rotation_batch_registry.json")
SOURCE_REGISTRY_PATH = os.path.join(ROOT, "projects", "data", "source_registry.json")

ROTATION_BATCH_IDS: tuple[str, ...] = ("A", "B", "C", "D")
ROTATION_BATCH_TICK_MINUTES: dict[str, int] = {"A": 0, "B": 5, "C": 10, "D": 15}
ROTATION_BATCH_CYCLE_MINUTES = 20
ROTATION_MIN_FETCH_INTERVAL_MIN = 15

P0_HEADLINE_REGISTRY_IDS: frozenset[str] = frozenset(
    {
        "zpr_novinky_domaci",
        "zpr_novinky_zahranicni",
        "zpr_seznam_domaci",
        "zpr_idnes_zpravy",
        "zpr_ct24_domaci",
        "spt_sportcz",
    }
)

STRONG_RUBRIC_IDS: frozenset[str] = frozenset(
    {
        "zpr_ct24_svet",
        "zpr_denik",
        "fin_novinky_ekonomika",
        "fin_sz_byznys",
        "fin_idnes_ekonomika",
        "spt_isport",
        "spt_ctsport",
        "spt_idnes",
        "ved_novinky",
        "vzd_novinky_skola",
        "hry_novinky",
        "ved_ct24_veda",
        "vzd_seznam",
        "zpr_aktualne",
    }
)

PROBLEMATIC_IDS: frozenset[str] = frozenset({"zpr_ctk"})
SLOW_INTERVAL_MIN = 180


class SourceStrength(str, Enum):
    STRONG = "STRONG"
    MEDIUM = "MEDIUM"
    WEAK = "WEAK"


SOURCE_ROTATION_FIELD_DEFAULTS: dict[str, Any] = {
    "batch_id": None,
    "source_weight": None,
    "source_strength": None,
    "estimated_rss_load": None,
    "last_rotation_assignment": None,
}

ROTATION_FOUNDATION_STATE_DEFAULTS: dict[str, Any] = {
    "current_batch_index": None,
    "by_source_id": {},
}


def registry_active_entries(registry: dict) -> list[dict]:
    out: list[dict] = []
    for e in registry.get("entries") or []:
        if not isinstance(e, dict):
            continue
        if e.get("blocked") or e.get("active") is False:
            continue
        url = str(e.get("feed_url") or "").strip()
        if not url:
            continue
        if "hedvabnastezka" in url:
            continue
        eid = str(e.get("id") or "")
        if eid in PROBLEMATIC_IDS:
            continue
        out.append(e)
    return out


def _priority_for_entry(entry: dict) -> str:
    domain = str(entry.get("domain") or "").lower()
    p0_hosts = (
        "novinky.cz",
        "seznamzpravy.cz",
        "idnes.cz",
        "ceskatelevize.cz",
        "ct24.ceskatelevize.cz",
        "sport.cz",
    )
    p1_hosts = (
        "hn.cz",
        "aktualne.cz",
        "denik.cz",
        "ekonom.cz",
        "ekonomickydenik.cz",
        "zdravezpravy.cz",
        "zdravotnickydenik.cz",
        "cestujlevne.com",
        "zing.cz",
        "vortex.cz",
        "kinobox.cz",
        "technet.cz",
        "hlidacipes.org",
        "tydenikpolicie.cz",
        "crzpravy.cz",
    )
    if any(h in domain or domain in h for h in p0_hosts):
        return "P0"
    if any(h in domain or domain in h for h in p1_hosts):
        return "P1"
    return "P2"


def estimate_rss_items(entry: dict) -> int:
    eid = str(entry.get("id") or "")
    interval = int(entry.get("interval_min") or 90)
    if eid in P0_HEADLINE_REGISTRY_IDS or eid in STRONG_RUBRIC_IDS:
        return 30
    if interval <= 25:
        return 28
    if interval <= 40:
        return 20
    if interval <= 90:
        return 10
    return 5


def classify_source_strength(entry: dict) -> SourceStrength:
    eid = str(entry.get("id") or "")
    if not entry.get("active", True) or eid in PROBLEMATIC_IDS:
        return SourceStrength.WEAK
    if eid in P0_HEADLINE_REGISTRY_IDS:
        return SourceStrength.STRONG
    weight = float(entry.get("display_weight") or 0)
    interval = int(entry.get("interval_min") or 90)
    if weight >= 1.1 or eid in STRONG_RUBRIC_IDS:
        return SourceStrength.STRONG
    if weight >= 0.85 or interval <= 40 or _priority_for_entry(entry) == "P1":
        return SourceStrength.MEDIUM
    return SourceStrength.WEAK


def assign_rotation_batches(active_entries: list[dict]) -> list[dict]:
    """Greedy A/B/C/D assignment — metadata only (mirrors architecture audit)."""
    anchors = [
        ["zpr_seznam_domaci"],
        ["zpr_novinky_domaci", "zpr_novinky_zahranicni"],
        ["zpr_idnes_zpravy", "spt_isport"],
        ["zpr_ct24_domaci", "spt_sportcz"],
    ]
    batches = [
        {"id": "A", "tick_minute": 0, "sources": [], "strong_ids": []},
        {"id": "B", "tick_minute": 5, "sources": [], "strong_ids": []},
        {"id": "C", "tick_minute": 10, "sources": [], "strong_ids": []},
        {"id": "D", "tick_minute": 15, "sources": [], "strong_ids": []},
    ]
    by_id = {str(e.get("id") or ""): e for e in active_entries}
    assigned: set[str] = set()

    for i, batch in enumerate(batches):
        for sid in anchors[i]:
            entry = by_id.get(sid)
            if entry and sid not in assigned:
                batch["sources"].append(entry)
                assigned.add(sid)
                if classify_source_strength(entry) == SourceStrength.STRONG:
                    batch["strong_ids"].append(sid)

    remaining = []
    for e in active_entries:
        eid = str(e.get("id") or "")
        if eid in assigned:
            continue
        remaining.append(
            {
                **e,
                "load_score": estimate_rss_items(e) * float(e.get("display_weight") or 0),
                "strength": classify_source_strength(e),
            }
        )
    remaining.sort(key=lambda x: x["load_score"], reverse=True)

    def batch_load(batch: dict) -> float:
        return sum(estimate_rss_items(e) * float(e.get("display_weight") or 0) for e in batch["sources"])

    def add_to_best_batch(entry: dict) -> None:
        sorted_batches = sorted(
            batches,
            key=lambda b: (batch_load(b), len(b["sources"])),
        )
        target = sorted_batches[0]
        target["sources"].append(entry)
        eid = str(entry.get("id") or "")
        if classify_source_strength(entry) == SourceStrength.STRONG:
            target["strong_ids"].append(eid)
        assigned.add(eid)

    for tier in (SourceStrength.STRONG, SourceStrength.MEDIUM, SourceStrength.WEAK):
        for e in remaining:
            if e["strength"] == tier:
                add_to_best_batch(e)

    target_counts = [16, 16, 15, 15]
    for i, batch in enumerate(batches):
        while len(batch["sources"]) > target_counts[i]:
            moved = batch["sources"].pop()
            if not moved:
                break
            lightest = min(batches, key=lambda b: (batch_load(b), len(b["sources"])))
            if lightest["id"] != batch["id"]:
                lightest["sources"].append(moved)
            else:
                break

    out: list[dict] = []
    for batch in batches:
        sources = batch["sources"]
        rss_est = sum(estimate_rss_items(e) for e in sources)
        load_score = sum(estimate_rss_items(e) * float(e.get("display_weight") or 0) for e in sources)
        run_sec_est = sum(2 + ((estimate_rss_items(e) + 9) // 10) * 2 + (3 if int(e.get("interval_min") or 90) >= 90 else 0) for e in sources)
        strong_ids = [str(e.get("id") or "") for e in sources if classify_source_strength(e) == SourceStrength.STRONG]
        overload = (
            "high"
            if rss_est > 380 or run_sec_est > 120 or len(strong_ids) > 5
            else "medium"
            if rss_est > 300 or run_sec_est > 90
            else "low"
        )
        out.append(
            {
                "batch_id": batch["id"],
                "tick_minute": batch["tick_minute"],
                "source_count": len(sources),
                "source_ids": sorted(str(e.get("id") or "") for e in sources),
                "sources": [
                    {
                        "id": str(e.get("id") or ""),
                        "label": str(e.get("label") or ""),
                        "section": str(e.get("section_primary") or ""),
                        "source_strength": classify_source_strength(e).value,
                        "source_weight": float(e.get("display_weight") or 0),
                        "estimated_rss_load": estimate_rss_items(e),
                    }
                    for e in sources
                ],
                "expected_rss_items": rss_est,
                "load_score": round(load_score, 1),
                "expected_run_sec": run_sec_est,
                "strong_source_count": len(strong_ids),
                "strong_source_ids": strong_ids,
                "overload_risk": overload,
            }
        )
    return out


def build_rotation_batch_registry(registry: dict | None = None) -> dict:
    registry = registry or load_source_registry()
    active = registry_active_entries(registry)
    batches = assign_rotation_batches(active)
    rotation_batch_by_source_id: dict[str, str] = {}
    source_metadata_by_id: dict[str, dict] = {}
    for batch in batches:
        bid = batch["batch_id"]
        for src in batch["sources"]:
            sid = str(src["id"])
            rotation_batch_by_source_id[sid] = bid
            source_metadata_by_id[sid] = {
                "batch_id": bid,
                "source_weight": src["source_weight"],
                "source_strength": src["source_strength"],
                "estimated_rss_load": src["estimated_rss_load"],
                "last_rotation_assignment": None,
            }
    return {
        "version": "1.0.0",
        "foundation_only": True,
        "batch_cycle_minutes": ROTATION_BATCH_CYCLE_MINUTES,
        "min_fetch_interval_min": ROTATION_MIN_FETCH_INTERVAL_MIN,
        "total_active_sources": len(active),
        "batches": {b["batch_id"]: b for b in batches},
        "rotation_batch_by_source_id": rotation_batch_by_source_id,
        "source_metadata_by_id": source_metadata_by_id,
    }


def load_source_registry(path: str | None = None) -> dict:
    p = path or SOURCE_REGISTRY_PATH
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def load_rotation_batch_registry(path: str | None = None) -> dict:
    p = path or ROTATION_BATCH_REGISTRY_PATH
    if not os.path.exists(p):
        return build_rotation_batch_registry()
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def get_rotation_batch_by_source_id(registry: dict | None = None) -> dict[str, str]:
    data = registry or load_rotation_batch_registry()
    mapping = data.get("rotation_batch_by_source_id") or {}
    return {str(k): str(v) for k, v in mapping.items()}


def ensure_source_rotation_row(row: dict | None) -> dict:
    out = dict(row or {})
    for key, default in SOURCE_ROTATION_FIELD_DEFAULTS.items():
        out.setdefault(key, default if not isinstance(default, dict) else dict(default))
    return out


def normalize_scheduler_rotation_schema(state: dict) -> dict:
    """Additive scheduler state schema — no selection side effects."""
    if not isinstance(state, dict):
        state = {}
    state.setdefault("tick_index", 0)
    state.setdefault("domain_last_fetch", {})
    state.setdefault("entry_state", {})
    state.setdefault("source_schedule", {})
    rf = state.setdefault("rotation_foundation", {})
    if not isinstance(rf, dict):
        rf = {}
        state["rotation_foundation"] = rf
    for key, default in ROTATION_FOUNDATION_STATE_DEFAULTS.items():
        rf.setdefault(key, default if not isinstance(default, dict) else dict(default))
    by_source = rf.get("by_source_id")
    if not isinstance(by_source, dict):
        by_source = {}
        rf["by_source_id"] = by_source
    sched = state.get("source_schedule")
    if isinstance(sched, dict):
        for eid, row in sched.items():
            if not isinstance(row, dict):
                continue
            bucket = by_source.setdefault(str(eid), ensure_source_rotation_row({}))
            if not isinstance(bucket, dict):
                bucket = ensure_source_rotation_row({})
                by_source[str(eid)] = bucket
            ensure_source_rotation_row(bucket)
    return state


def validate_rotation_batch_registry(
    registry_data: dict,
    active_source_ids: set[str] | None = None,
) -> list[str]:
    errors: list[str] = []
    batches = registry_data.get("batches")
    if not isinstance(batches, dict):
        return ["batches must be an object"]
    for bid in ROTATION_BATCH_IDS:
        if bid not in batches:
            errors.append(f"missing batch {bid}")
    mapping = registry_data.get("rotation_batch_by_source_id") or {}
    if not isinstance(mapping, dict):
        return errors + ["rotation_batch_by_source_id must be an object"]
    seen: dict[str, str] = {}
    duplicates: set[str] = set()
    for sid, bid in mapping.items():
        sid_s = str(sid)
        bid_s = str(bid)
        if bid_s not in ROTATION_BATCH_IDS:
            errors.append(f"source {sid_s} has invalid batch_id {bid_s}")
        if sid_s in seen:
            duplicates.add(sid_s)
        seen[sid_s] = bid_s
    if duplicates:
        errors.append(f"duplicate source assignments: {', '.join(sorted(duplicates))}")
    batch_members: dict[str, list[str]] = {b: [] for b in ROTATION_BATCH_IDS}
    for sid, bid in mapping.items():
        batch_members.setdefault(str(bid), []).append(str(sid))
    for bid in ROTATION_BATCH_IDS:
        batch_obj = batches.get(bid) or {}
        listed = batch_obj.get("source_ids") or []
        mapped = batch_members.get(bid, [])
        if sorted(listed) != sorted(mapped):
            errors.append(f"batch {bid} source_ids mismatch with mapping")
    if active_source_ids is not None:
        unassigned = sorted(active_source_ids - set(mapping.keys()))
        if unassigned:
            errors.append(f"unassigned active sources: {', '.join(unassigned)}")
        extra = sorted(set(mapping.keys()) - active_source_ids)
        if extra:
            errors.append(f"assigned inactive/unknown sources: {', '.join(extra)}")
    meta = registry_data.get("source_metadata_by_id") or {}
    for sid, row in meta.items():
        if not isinstance(row, dict):
            errors.append(f"metadata for {sid} must be object")
            continue
        strength = row.get("source_strength")
        if strength and strength not in {s.value for s in SourceStrength}:
            errors.append(f"invalid source_strength for {sid}: {strength}")
    return errors


def summarize_rotation_foundation(registry_data: dict | None = None) -> dict:
    data = registry_data or load_rotation_batch_registry()
    mapping = data.get("rotation_batch_by_source_id") or {}
    meta = data.get("source_metadata_by_id") or {}
    batches = data.get("batches") or {}
    strength_counts = {s.value: 0 for s in SourceStrength}
    for row in meta.values():
        if isinstance(row, dict):
            st = str(row.get("source_strength") or "")
            if st in strength_counts:
                strength_counts[st] += 1
    batch_counts = {bid: len((batches.get(bid) or {}).get("source_ids") or []) for bid in ROTATION_BATCH_IDS}
    return {
        "total_sources": len(mapping),
        "batch_counts": batch_counts,
        "strong_sources": strength_counts[SourceStrength.STRONG.value],
        "medium_sources": strength_counts[SourceStrength.MEDIUM.value],
        "weak_sources": strength_counts[SourceStrength.WEAK.value],
        "unassigned_sources": [],
        "duplicate_sources": [],
    }
