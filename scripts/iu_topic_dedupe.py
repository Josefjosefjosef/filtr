# -*- coding: utf-8 -*-
"""
Topic / event dedupe V1 — deterministic, no LLM/embeddings.

Collapses same-event duplicates across media in one section (aktualne, sport, …).
Suppressed articles are not in the public list; winners carry topic_key + alternativeSources.
"""
from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

# Reuse title folding from build_articles at runtime (import inside functions to avoid cycles).

EVENT_WINDOW_HOURS: dict[str, int] = {
    "aktualne": 48,
    "sport": 48,
    "finance": 72,
    "zdravi": 72,
    "cestovani": 96,
    "hry": 72,
    "kultura": 72,
    "veda": 72,
    "vzdelavani": 72,
}
DEFAULT_EVENT_WINDOW_H = 72

FOLLOW_UP_MARKERS = frozenset(
    {
        "reakce",
        "komentar",
        "komentář",
        "analýza",
        "analýza",
        "vyjadření",
        "vyjadreni",
        "dalsi",
        "další",
        "update",
        "shrnutí",
        "shrnuti",
        "video",
        "foto",
        "galerie",
    }
)
OPINION_MARKERS = frozenset({"komentář", "komentar", "názor", "nazor", "analýza", "analýza", "editorial"})


def _parse_pub(article: dict) -> datetime | None:
    raw = str(article.get("publishedAt") or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None


def _event_window_hours(section: str) -> int:
    return int(EVENT_WINDOW_HOURS.get(section, DEFAULT_EVENT_WINDOW_H))


def _hours_apart(a: dict, b: dict) -> float | None:
    pa, pb = _parse_pub(a), _parse_pub(b)
    if pa is None or pb is None:
        return None
    return abs((pa - pb).total_seconds()) / 3600.0


def build_topic_key(article: dict, tokenize_fn) -> str:
    """Stable key from folded title tokens (not URL)."""
    title = str(article.get("title") or "").strip()
    toks = sorted(tokenize_fn(title), key=lambda x: (-len(x), x))
    if not toks:
        sec = str(article.get("topic") or article.get("section") or "")
        return hashlib.sha1(sec.encode("utf-8")).hexdigest()[:12]
    core = " ".join(toks[:8])
    return hashlib.sha1(core.encode("utf-8")).hexdigest()[:16]


def _marker_hit(title: str, markers: frozenset[str]) -> bool:
    t = (title or "").lower()
    return any(m in t for m in markers)


def classify_pair_relation(
    a: dict,
    b: dict,
    section: str,
    story_match_fn,
) -> tuple[str, float]:
    """
    Returns (relation, confidence).
    relation: same_event_duplicate | related_but_distinct | follow_up_update | analysis_or_opinion
    """
    t1 = str(a.get("title") or "")
    t2 = str(b.get("title") or "")
    h = _hours_apart(a, b)
    win = _event_window_hours(section)
    if h is not None and h > win:
        return "related_but_distinct", 0.0

    if _marker_hit(t1, OPINION_MARKERS) != _marker_hit(t2, OPINION_MARKERS):
        return "analysis_or_opinion", 0.55

    if (_marker_hit(t1, FOLLOW_UP_MARKERS) or _marker_hit(t2, FOLLOW_UP_MARKERS)) and story_match_fn(
        t1, t2
    ):
        return "follow_up_update", 0.6

    if story_match_fn(t1, t2):
        return "same_event_duplicate", 0.88

    return "related_but_distinct", 0.0


def pick_primary_article(group: list, score_fn) -> dict:
    if len(group) == 1:
        return group[0]
    return max(group, key=score_fn)


def apply_topic_event_dedupe(
    articles: list[dict],
    *,
    stable_section_fn,
    story_match_fn,
    tokenize_fn,
    score_fn,
    url_fn,
) -> tuple[list[dict], list[dict], dict[str, Any]]:
    """
    Returns (visible_articles, suppressed_records, stats).
    """
    if not articles:
        return [], [], {"suppressed_count": 0, "clusters_merged": 0}

    clean = [a for a in articles if isinstance(a, dict)]
    by_sec: dict[str, list[dict]] = defaultdict(list)
    for a in clean:
        sec = stable_section_fn(str(a.get("topic") or a.get("section") or "aktualne"))
        by_sec[sec].append(a)

    visible: list[dict] = []
    suppressed: list[dict] = []
    clusters_merged = 0

    for _sec, arts in by_sec.items():
        n = len(arts)
        if n == 1:
            w = dict(arts[0])
            w["topic_key"] = build_topic_key(w, tokenize_fn)
            w["duplicate_of"] = None
            w["duplicate_reason"] = None
            w["duplicate_confidence"] = None
            w["selected_primary_reason"] = "single_article"
            visible.append(w)
            continue

        uf = list(range(n))

        def uf_find(x: int) -> int:
            r = x
            while uf[r] != r:
                r = uf[r]
            return r

        def uf_union(x: int, y: int) -> None:
            rx, ry = uf_find(x), uf_find(y)
            if rx != ry:
                uf[rx] = ry

        for i in range(n):
            for j in range(i + 1, n):
                if url_fn(arts[i]) == url_fn(arts[j]):
                    continue
                rel, conf = classify_pair_relation(arts[i], arts[j], _sec, story_match_fn)
                if rel == "same_event_duplicate" and conf >= 0.8:
                    uf_union(i, j)

        clusters: dict[int, list[dict]] = defaultdict(list)
        for i in range(n):
            clusters[uf_find(i)].append(arts[i])

        for grp in clusters.values():
            if len(grp) > 1:
                clusters_merged += 1
            w = dict(pick_primary_article(grp, score_fn))
            topic_key = build_topic_key(w, tokenize_fn)
            w_url = url_fn(w)
            w["topic_key"] = topic_key
            w["duplicate_of"] = None
            w["duplicate_reason"] = None
            w["duplicate_confidence"] = None
            w["selected_primary_reason"] = "freshness_source_weight" if len(grp) > 1 else "single_article"

            alts: list[dict] = []
            for loser in grp:
                if url_fn(loser) == w_url:
                    continue
                rel, conf = classify_pair_relation(loser, w, _sec, story_match_fn)
                rec = {
                    "url": url_fn(loser),
                    "title": str(loser.get("title") or ""),
                    "duplicate_of": w_url,
                    "duplicate_reason": rel if rel == "same_event_duplicate" else "same_event_duplicate",
                    "duplicate_confidence": round(conf if conf else 0.85, 3),
                    "topic_key": topic_key,
                    "section": _sec,
                    "sourceLabel": str(loser.get("sourceLabel") or ""),
                }
                suppressed.append(rec)
                src0 = (loser.get("sources") or [{}])[0]
                if isinstance(src0, dict):
                    alts.append(
                        {
                            "name": str(src0.get("name") or loser.get("sourceLabel") or ""),
                            "url": str(src0.get("url") or url_fn(loser)),
                            "duplicate_reason": rec["duplicate_reason"],
                        }
                    )

            if alts:
                w["alternativeSources"] = alts[:6]
                w["topic_duplicate_count"] = len(alts)
            visible.append(w)

    visible.sort(key=lambda a: str(a.get("publishedAt") or ""), reverse=True)
    stats = {
        "suppressed_count": len(suppressed),
        "clusters_merged": clusters_merged,
        "visible_count": len(visible),
    }
    return visible, suppressed, stats
