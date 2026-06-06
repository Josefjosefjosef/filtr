# -*- coding: utf-8 -*-
"""
Source + topic display diversity — deterministic reorder within a section.
Does not change section assignment (classification layer stays separate).
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from collections import defaultdict

MAX_SAME_SOURCE_ADJACENT = 2
MAX_TOPIC_CLUSTER_VISIBLE_TOP = 1
TOP_DIVERSITY_WINDOW = 8


def _fold_title(title: str) -> str:
    t = unicodedata.normalize("NFKD", (title or "").lower())
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    t = re.sub(r"[^\w\s]", " ", t, flags=re.UNICODE)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def topic_fingerprint(article: dict) -> str:
    """Deterministic topic cluster key from normalized title core."""
    th = str(article.get("topicHash") or "").strip()
    if th:
        return th
    title = _fold_title(str(article.get("title") or ""))
    toks = [w for w in title.split() if len(w) >= 3][:8]
    core = " ".join(sorted(toks))
    if not core:
        core = str(article.get("url") or article.get("title") or "")
    return hashlib.sha1(core.encode("utf-8")).hexdigest()[:16]


def _source_key(article: dict) -> str:
    src0 = (article.get("sources") or [{}])[0] if isinstance(article.get("sources"), list) else {}
    name = ""
    if isinstance(src0, dict):
        name = str(src0.get("name") or src0.get("url") or "").strip().lower()
    if not name:
        name = str(article.get("feedId") or "unknown").strip().lower()
    return name


def _article_rank(article: dict) -> tuple:
    return (
        str(article.get("publishedAt") or ""),
        str(article.get("title") or ""),
    )


def _interleave_winners(winners: list[dict]) -> tuple[list[dict], int, int]:
    """Greedy pick: prefer different source/topic, max 2 adjacent same source."""
    pool = list(winners)
    out: list[dict] = []
    adj_violations = 0
    source_violations = 0
    while pool:
        picked_idx = None
        for i, cand in enumerate(pool):
            sk = _source_key(cand)
            if not out:
                picked_idx = i
                break
            tail = out[-MAX_SAME_SOURCE_ADJACENT:]
            if len(tail) >= MAX_SAME_SOURCE_ADJACENT and all(_source_key(x) == sk for x in tail):
                continue
            if len(out) < TOP_DIVERSITY_WINDOW:
                fp = topic_fingerprint(cand)
                top_fps = {topic_fingerprint(x) for x in out[:TOP_DIVERSITY_WINDOW]}
                if fp in top_fps:
                    continue
            picked_idx = i
            break
        if picked_idx is None:
            picked_idx = 0
            sk = _source_key(pool[picked_idx])
            if out and len(out) >= MAX_SAME_SOURCE_ADJACENT:
                tail = out[-MAX_SAME_SOURCE_ADJACENT:]
                if all(_source_key(x) == sk for x in tail):
                    adj_violations += 1
                    source_violations += 1
        out.append(pool.pop(picked_idx))
    return out, adj_violations, source_violations


def apply_source_diversity_order(articles: list[dict]) -> tuple[list[dict], dict]:
    """
    Cluster by topic fingerprint, keep best per cluster visible, demote duplicates.
    """
    if not articles:
        return [], {
            "topic_duplicate_articles_hidden_or_demoted": 0,
            "topic_cluster_max_visible_violation": 0,
            "source_diversity_violations": 0,
            "same_source_adjacent_violations": 0,
            "topic_clusters_total": 0,
        }

    by_fp: dict[str, list[dict]] = defaultdict(list)
    for a in articles:
        by_fp[topic_fingerprint(a)].append(a)

    winners: list[dict] = []
    demoted: list[dict] = []
    for _fp, group in by_fp.items():
        group.sort(key=_article_rank, reverse=True)
        winners.append(group[0])
        demoted.extend(group[1:])

    ordered_winners, adj_violations, source_violations = _interleave_winners(winners)
    top_fps = {topic_fingerprint(a) for a in ordered_winners[:TOP_DIVERSITY_WINDOW]}
    topic_violations = max(0, len(top_fps) - MAX_TOPIC_CLUSTER_VISIBLE_TOP) if len(top_fps) > 1 else 0

    out = ordered_winners + demoted
    return out, {
        "topic_duplicate_articles_hidden_or_demoted": len(demoted),
        "topic_cluster_max_visible_violation": topic_violations,
        "source_diversity_violations": source_violations,
        "same_source_adjacent_violations": adj_violations,
        "topic_clusters_total": len(by_fp),
    }


def apply_section_display_diversity(articles: list[dict], section_key_fn) -> tuple[list[dict], dict]:
    """Apply diversity reorder per canonical section; preserve global order merge."""
    if not articles:
        return [], {
            "topic_duplicate_articles_hidden_or_demoted": 0,
            "topic_cluster_max_visible_violation": 0,
            "source_diversity_violations": 0,
            "same_source_adjacent_violations": 0,
            "topic_clusters_total": 0,
        }
    by_sec: dict[str, list[dict]] = defaultdict(list)
    for a in articles:
        if isinstance(a, dict):
            by_sec[section_key_fn(a)].append(a)
    merged: list[dict] = []
    agg = {
        "topic_duplicate_articles_hidden_or_demoted": 0,
        "topic_cluster_max_visible_violation": 0,
        "source_diversity_violations": 0,
        "same_source_adjacent_violations": 0,
        "topic_clusters_total": 0,
    }
    for sec in sorted(by_sec.keys()):
        reordered, stats = apply_source_diversity_order(by_sec[sec])
        merged.extend(reordered)
        for k in agg:
            agg[k] += int(stats.get(k) or 0)
    return merged, agg
