# -*- coding: utf-8 -*-
"""
infoUzel: source registry loader, hard domain block, weighted scheduler (2–3 sources/tick).
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse

BLOCKED_HOST_FRAGMENTS = (
    "hedvabnastezka.cz",
    "www.hedvabnastezka.cz",
)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def host_from_url(url: str) -> str:
    try:
        return (urlparse(url or "").netloc or "").lower()
    except Exception:
        return ""


def is_hard_blocked_url(url: str) -> bool:
    h = host_from_url(url)
    if not h:
        return False
    for frag in BLOCKED_HOST_FRAGMENTS:
        if frag in h or h.endswith(frag.lstrip("www.")):
            return True
    if "hedvabnastezka" in h:
        return True
    return False


def is_hard_blocked_host(host: str) -> bool:
    h = (host or "").lower()
    if not h:
        return False
    if "hedvabnastezka" in h:
        return True
    return False


def load_registry(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def registry_active_entries(registry: dict) -> list:
    out = []
    for e in registry.get("entries") or []:
        if not isinstance(e, dict):
            continue
        if e.get("blocked"):
            continue
        if e.get("active") is False:
            continue
        url = (e.get("feed_url") or "").strip()
        if not url:
            continue
        if is_hard_blocked_url(url):
            continue
        out.append(e)
    return out


def load_scheduler_state(path: str) -> dict:
    if not path or not os.path.exists(path):
        return {"tick_index": 0, "domain_last_fetch": {}, "entry_state": {}}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"tick_index": 0, "domain_last_fetch": {}, "entry_state": {}}
        data.setdefault("tick_index", 0)
        data.setdefault("domain_last_fetch", {})
        data.setdefault("entry_state", {})
        return data
    except Exception:
        return {"tick_index": 0, "domain_last_fetch": {}, "entry_state": {}}


def save_scheduler_state(path: str, state: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def _parse_iso(ts: str | None) -> datetime | None:
    if not ts or not isinstance(ts, str):
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return None


def sources_per_tick(tick_index: int, three_frac: float = 0.62) -> int:
    """62 % ticks = 3 sources, 38 % = 2 sources (deterministic)."""
    mod = tick_index % 100
    threshold = int(three_frac * 100 + 0.5)
    return 3 if mod < threshold else 2


def select_feeds_for_tick(
    registry: dict,
    state: dict,
    now: datetime | None = None,
) -> tuple[list[dict], dict]:
    """
    Weighted round-robin + due queue + per-domain cooldown.
    Returns (list of entry dicts to fetch this tick, updated state dict — not yet saved).
    """
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    cfg = registry.get("sources_per_tick") or {}
    three_frac = float(cfg.get("three_source_tick_fraction") or 0.62)

    tick_index = int(state.get("tick_index") or 0) + 1
    state["tick_index"] = tick_index
    state["last_tick_at"] = _iso_now()

    n_pick = sources_per_tick(tick_index, three_frac=three_frac)
    entries = registry_active_entries(registry)
    domain_last = state.setdefault("domain_last_fetch", {})
    entry_state = state.setdefault("entry_state", {})

    candidates = []
    for e in entries:
        eid = str(e.get("id") or "")
        interval = int(e.get("interval_min") or 30)
        interval = max(5, interval)
        st = entry_state.get(eid) if isinstance(entry_state.get(eid), dict) else {}
        last_fetch = _parse_iso(st.get("last_fetch_at") if isinstance(st, dict) else None)
        slot_off = int(e.get("slot_offset_min") or 0) % 40

        if last_fetch is None:
            overdue_sec = 86400.0 * 365 + slot_off * 60.0
        else:
            due_at = last_fetch + timedelta(minutes=interval)
            overdue_sec = (now - due_at).total_seconds()

        if overdue_sec < 0:
            continue

        w = float(e.get("display_weight") or 1.0)
        score = overdue_sec * w
        candidates.append((score, eid, e))

    candidates.sort(key=lambda x: (-x[0], x[1]))

    picked: list[dict] = []
    seen_urls: set[str] = set()

    for _score, eid, e in candidates:
        if len(picked) >= n_pick:
            break
        url = (e.get("feed_url") or "").strip()
        if not url or url in seen_urls:
            continue
        dom = (e.get("domain") or "").strip().lower()
        cooldown = int(e.get("per_domain_cooldown_min") or 15)
        cooldown = max(5, cooldown)

        last_dom = _parse_iso(domain_last.get(dom))
        if last_dom is not None:
            if (now - last_dom).total_seconds() < cooldown * 60:
                continue

        picked.append(e)
        seen_urls.add(url)

    return picked, state


def mark_feeds_fetched(state: dict, entries: list[dict], now: datetime | None = None) -> None:
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    ts = _iso_now()
    domain_last = state.setdefault("domain_last_fetch", {})
    entry_state = state.setdefault("entry_state", {})

    for e in entries:
        eid = str(e.get("id") or "")
        if not eid:
            continue
        dom = (e.get("domain") or "").strip().lower()
        if dom:
            domain_last[dom] = ts
        prev = entry_state.get(eid)
        if not isinstance(prev, dict):
            prev = {}
        prev["last_fetch_at"] = ts
        prev["last_success_at"] = ts
        prev["error_streak"] = 0
        entry_state[eid] = prev


def mark_feed_error(state: dict, entry_id: str) -> None:
    entry_state = state.setdefault("entry_state", {})
    prev = entry_state.get(entry_id)
    if not isinstance(prev, dict):
        prev = {}
    prev["error_streak"] = int(prev.get("error_streak") or 0) + 1
    prev["last_fetch_at"] = _iso_now()
    entry_state[entry_id] = prev


def collapse_feeds_by_url(entries: list[dict]) -> list[tuple[str, list[dict]]]:
    """One HTTP fetch per URL; list of registry entries sharing that URL."""
    by_url: dict[str, list[dict]] = {}
    for e in entries:
        u = (e.get("feed_url") or "").strip()
        if not u:
            continue
        by_url.setdefault(u, []).append(e)
    out = []
    for u, lst in by_url.items():
        out.append((u, lst))
    return out


def purge_blocked_articles(articles: list) -> list:
    out = []
    for a in articles or []:
        if not isinstance(a, dict):
            continue
        url = (a.get("url") or "").strip()
        src0 = (a.get("sources") or [{}])[0] if isinstance(a.get("sources"), list) else {}
        su = (src0.get("url") or "") if isinstance(src0, dict) else ""
        if is_hard_blocked_url(url) or is_hard_blocked_url(su):
            continue
        out.append(a)
    return out


def merge_article_lists(
    previous: list,
    new_items: list,
    max_total: int,
) -> list:
    """Merge by canonical URL; prefer new item when same URL (fresher pipeline)."""
    by_url: dict[str, dict] = {}

    def canon(u: str) -> str:
        u = (u or "").strip()
        return u

    for a in previous or []:
        if not isinstance(a, dict):
            continue
        u = canon(a.get("url") or "")
        if not u:
            continue
        if is_hard_blocked_url(u):
            continue
        by_url[u] = dict(a)

    for a in new_items or []:
        if not isinstance(a, dict):
            continue
        u = canon(a.get("url") or "")
        if not u:
            continue
        if is_hard_blocked_url(u):
            continue
        by_url[u] = dict(a)

    merged = list(by_url.values())
    merged.sort(key=lambda x: str(x.get("publishedAt") or ""), reverse=True)
    return merged[:max_total]


def compute_display_score(
    article: dict,
    now: datetime | None = None,
) -> float:
    """display_score = freshness * source_weight * duplicate_penalty (section_weight=1)."""
    now = now or datetime.now(timezone.utc)
    try:
        pub = datetime.fromisoformat(str(article.get("publishedAt") or "").replace("Z", "+00:00"))
    except Exception:
        pub = now
    age_h = max(0.0, (now - pub.replace(tzinfo=pub.tzinfo or timezone.utc)).total_seconds() / 3600.0)
    freshness = 1.0 / (1.0 + age_h / 6.0)
    sw = float(article.get("sourceDisplayWeight") or article.get("displayWeight") or 1.0)
    dup = float(article.get("duplicatePenalty") or 1.0)
    return max(0.0, freshness * sw * dup)
