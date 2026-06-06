# -*- coding: utf-8 -*-
"""
SECTION_TOPIC_CAP V1 — limit one theme to 25% of a section when other themes exist.

No recency decay, no age scoring, no time-based reranking penalties.
Within each topic bucket order stays publishedAt DESC; cap uses round-robin deferral only.
"""
from __future__ import annotations

import re
import unicodedata
from collections import defaultdict, deque

SECTION_TOPIC_CAP_ENABLED = True
MAX_TOPIC_SHARE_PER_SECTION = 0.25

_CAP_STOPWORDS = frozenset(
    {
        "a",
        "i",
        "v",
        "ve",
        "na",
        "do",
        "z",
        "ze",
        "u",
        "o",
        "od",
        "po",
        "za",
        "pro",
        "se",
        "si",
        "k",
        "ke",
        "s",
        "ze",
        "je",
        "jsou",
        "byl",
        "byla",
        "bylo",
        "bude",
        "budou",
        "jak",
        "kdy",
        "kde",
        "co",
        "kdo",
        "video",
        "foto",
        "online",
        "zive",
        "zivě",
        "aktualne",
        "aktualně",
        "breaking",
        "domaci",
        "domácí",
        "zahranicni",
        "zahraniční",
    }
)


def _fold_title(title: str) -> str:
    t = unicodedata.normalize("NFKD", (title or "").lower())
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    t = re.sub(r"[^\w\s]", " ", t, flags=re.UNICODE)
    return re.sub(r"\s+", " ", t).strip()


def section_topic_cap_key(article: dict) -> str:
    """
    Broad section theme key (entity-ish), wider than duplicate topic_fingerprint.
    Prefer existing topic_key metadata when present.
    """
    meta = str(article.get("topic_key") or article.get("topicKey") or "").strip()
    if meta:
        return meta
    title = _fold_title(str(article.get("title") or ""))
    if not title:
        return str(article.get("url") or article.get("title") or "unknown")
    for word in title.split():
        if len(word) >= 4 and word not in _CAP_STOPWORDS:
            return word
    parts = [w for w in title.split() if w and w not in _CAP_STOPWORDS]
    return parts[0] if parts else title[:24]


def _published_at(article: dict) -> str:
    return str(article.get("publishedAt") or "")


def max_positions_for_topic(section_size: int, share: float = MAX_TOPIC_SHARE_PER_SECTION) -> int:
    if section_size <= 0:
        return 0
    return max(1, int(section_size * share))


def dominant_topic_share(articles: list[dict]) -> tuple[str, float]:
    if not articles:
        return "", 0.0
    counts: dict[str, int] = defaultdict(int)
    for a in articles:
        counts[section_topic_cap_key(a)] += 1
    dom = max(counts.items(), key=lambda kv: (kv[1], kv[0]))
    return dom[0], dom[1] / len(articles)


def apply_section_topic_cap(articles: list[dict]) -> tuple[list[dict], dict]:
    """
    Cap each section theme to 25% when multiple themes exist.
    Round-robin across theme buckets; each bucket pre-sorted publishedAt DESC.
    """
    if not articles or not SECTION_TOPIC_CAP_ENABLED:
        return list(articles), {
            "section_topic_cap_enabled": SECTION_TOPIC_CAP_ENABLED,
            "max_topic_share_per_section": MAX_TOPIC_SHARE_PER_SECTION,
            "dominant_topic_before": "",
            "dominant_topic_share_before": 0.0,
            "dominant_topic_after": "",
            "dominant_topic_share_after": 0.0,
            "topics_capped": 0,
        }

    sorted_arts = sorted(articles, key=_published_at, reverse=True)
    dom_before, share_before = dominant_topic_share(sorted_arts)
    keys = {section_topic_cap_key(a) for a in sorted_arts}
    if len(keys) <= 1:
        dom_after, share_after = dom_before, share_before
        return sorted_arts, {
            "section_topic_cap_enabled": True,
            "max_topic_share_per_section": MAX_TOPIC_SHARE_PER_SECTION,
            "dominant_topic_before": dom_before,
            "dominant_topic_share_before": share_before,
            "dominant_topic_after": dom_after,
            "dominant_topic_share_after": share_after,
            "topics_capped": 0,
        }

    n = len(sorted_arts)
    max_per = max_positions_for_topic(n)
    buckets: dict[str, deque] = defaultdict(deque)
    for a in sorted_arts:
        buckets[section_topic_cap_key(a)].append(a)
    for k in buckets:
        buckets[k] = deque(sorted(buckets[k], key=_published_at, reverse=True))

    out: list[dict] = []
    counts: dict[str, int] = defaultdict(int)
    capped = 0
    while any(buckets[k] for k in buckets):
        progressed = False
        for k in sorted(buckets.keys()):
            if not buckets[k]:
                continue
            if counts[k] >= max_per:
                continue
            out.append(buckets[k].popleft())
            counts[k] += 1
            progressed = True
        if not progressed:
            rest: list[dict] = []
            for k in sorted(buckets.keys()):
                rest.extend(buckets[k])
            rest.sort(key=_published_at, reverse=True)
            capped += len(rest)
            out.extend(rest)
            break

    dom_after, share_after = dominant_topic_share(out)
    return out, {
        "section_topic_cap_enabled": True,
        "max_topic_share_per_section": MAX_TOPIC_SHARE_PER_SECTION,
        "dominant_topic_before": dom_before,
        "dominant_topic_share_before": share_before,
        "dominant_topic_after": dom_after,
        "dominant_topic_share_after": share_after,
        "topics_capped": capped,
        "max_positions_per_topic": max_per,
    }


def apply_articles_section_topic_cap(articles: list[dict], section_key_fn) -> tuple[list[dict], dict]:
    if not articles:
        return [], {"section_topic_cap_enabled": SECTION_TOPIC_CAP_ENABLED}
    by_sec: dict[str, list[dict]] = defaultdict(list)
    for a in articles:
        if isinstance(a, dict):
            by_sec[section_key_fn(a)].append(a)
    merged: list[dict] = []
    agg = {
        "section_topic_cap_enabled": SECTION_TOPIC_CAP_ENABLED,
        "max_topic_share_per_section": MAX_TOPIC_SHARE_PER_SECTION,
        "dominant_topic_before": "",
        "dominant_topic_share_before": 0.0,
        "dominant_topic_after": "",
        "dominant_topic_share_after": 0.0,
        "topics_capped": 0,
    }
    max_share_before = 0.0
    max_share_after = 0.0
    for sec in sorted(by_sec.keys()):
        capped_list, stats = apply_section_topic_cap(by_sec[sec])
        merged.extend(capped_list)
        agg["topics_capped"] += int(stats.get("topics_capped") or 0)
        if float(stats.get("dominant_topic_share_before") or 0) > max_share_before:
            max_share_before = float(stats["dominant_topic_share_before"])
            agg["dominant_topic_before"] = str(stats.get("dominant_topic_before") or "")
        if float(stats.get("dominant_topic_share_after") or 0) > max_share_after:
            max_share_after = float(stats["dominant_topic_share_after"])
            agg["dominant_topic_after"] = str(stats.get("dominant_topic_after") or "")
    agg["dominant_topic_share_before"] = max_share_before
    agg["dominant_topic_share_after"] = max_share_after
    return merged, agg
