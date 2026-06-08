# -*- coding: utf-8 -*-
"""
Topic / event dedupe V1 — deterministic, no LLM/embeddings.

Collapses same-event duplicates across media in one section (aktualne, sport, …).
Suppressed articles are not in the public list; winners carry topic_key + alternativeSources.

Phase 8D: false-positive guards (low slug / replay / recurring template).
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Callable
from urllib.parse import unquote, urlparse

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

LOW_SLUG_JACCARD_BLOCK = 0.20

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


def _fold_ascii_lower(s: str) -> str:
    if not s:
        return ""
    nfd = unicodedata.normalize("NFD", s)
    ascii_like = "".join(c for c in nfd if unicodedata.category(c) != "Mn")
    return ascii_like.lower()


def _slug_tokens(url: str) -> set[str]:
    path = urlparse(url or "").path.lower()
    slug = path.rstrip("/").split("/")[-1]
    slug = re.sub(r"\.(html|htm|php|aspx)$", "", slug, flags=re.I)
    slug = re.sub(r"^\d+-", "", slug)
    slug = unquote(slug).replace("-", " ").replace("_", " ")
    return {w for w in slug.split() if len(w) >= 4 and not w.isdigit()}


def slug_jaccard(url_a: str, url_b: str) -> float:
    a = _slug_tokens(url_a)
    b = _slug_tokens(url_b)
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


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


def _title_fold(title: str) -> str:
    return _fold_ascii_lower(title or "")


def _replay_guard_distinct_events(t1: str, t2: str, u1: str, u2: str) -> bool:
    """Phase 8D FIX 2: hard-block known false-positive replay pairs."""
    f1 = _title_fold(t1)
    f2 = _title_fold(t2)
    s1 = _title_fold(" ".join(_slug_tokens(u1)))
    s2 = _title_fold(" ".join(_slug_tokens(u2)))

    sudan_markers = ("sudan", "trziste", "trzisti", "marketplace")
    rjazan_markers = ("rjazan", "rjazani", "ryazan", "riazan")

    def _hits(hay: str, markers: tuple[str, ...]) -> bool:
        return any(m in hay for m in markers)

    sudan_a = _hits(f1, sudan_markers) or _hits(s1, sudan_markers)
    sudan_b = _hits(f2, sudan_markers) or _hits(s2, sudan_markers)
    rjazan_a = _hits(f1, rjazan_markers) or _hits(s1, rjazan_markers)
    rjazan_b = _hits(f2, rjazan_markers) or _hits(s2, rjazan_markers)
    if (sudan_a and rjazan_b) or (sudan_b and rjazan_a):
        return True

    iran_markers = ("iran", "iransky", "iranske", "iransk")
    iran_a = _hits(f1, iran_markers) or _hits(s1, iran_markers)
    iran_b = _hits(f2, iran_markers) or _hits(s2, iran_markers)
    if iran_a and iran_b:
        terminal_a = "terminal" in f1 or "terminal" in s1 or "ropn" in f1
        terminal_b = "terminal" in f2 or "terminal" in s2 or "ropn" in f2
        attack_a = any(
            m in f1 or m in s1 for m in ("zautocil", "zautocily", "primiri", "primier", "primere")
        )
        attack_b = any(
            m in f2 or m in s2 for m in ("zautocil", "zautocily", "primiri", "primier", "primere")
        )
        if terminal_a != terminal_b and (terminal_a or terminal_b) and (attack_a or attack_b):
            return True
        if slug_jaccard(u1, u2) < LOW_SLUG_JACCARD_BLOCK and (terminal_a or attack_a) and (terminal_b or attack_b):
            return True

    return False


def _recurring_template_title(title: str) -> str | None:
    t = _title_fold(title)
    if re.search(r"souhrn|zasadni udalosti|prehled dne", t):
        return "recap"
    if re.search(r"bitcoin|krypto|ethereum|etf", t):
        return "crypto"
    if re.search(r"danov|danove|priznani|formular|danit krypt", t):
        return "tax"
    if re.search(r"maximalni ceny benzinu|benzinu a nafty|natankovat|financni trhy", t):
        return "market"
    return None


def _recurring_template_distinct(t1: str, t2: str) -> bool:
    """Phase 8D FIX 3: do not merge template articles with different date/year/event."""
    k1 = _recurring_template_title(t1)
    k2 = _recurring_template_title(t2)
    if not k1 or not k2:
        return False

    if k1 == "tax" and k2 == "crypto":
        return True
    if k1 == "crypto" and k2 == "tax":
        return True

    years1 = set(re.findall(r"202[0-9]", t1))
    years2 = set(re.findall(r"202[0-9]", t2))
    if years1 and years2 and years1 != years2:
        return True

    dates1 = set(re.findall(r"\d{1,2}\.\s*\d{1,2}\.", t1))
    dates2 = set(re.findall(r"\d{1,2}\.\s*\d{1,2}\.", t2))
    if dates1 and dates2 and dates1 != dates2:
        return True

    if k1 == k2 == "recap":
        days1 = set(re.findall(r"pondeli|utery|streda|ctvrtek|patek|sobota|nedele", _title_fold(t1)))
        days2 = set(re.findall(r"pondeli|utery|streda|ctvrtek|patek|sobota|nedele", _title_fold(t2)))
        if days1 and days2 and days1 != days2:
            return True

    if k1 == k2 == "market":
        if dates1 and dates2 and dates1 != dates2:
            return True
        months1 = set(re.findall(r"ledna|unora|brezna|dubna|kvetna|cervna|cervence|srpna|zari|rijna|listopadu|prosince", _title_fold(t1)))
        months2 = set(re.findall(r"ledna|unora|brezna|dubna|kvetna|cervna|cervence|srpna|zari|rijna|listopadu|prosince", _title_fold(t2)))
        if months1 and months2 and months1 != months2:
            return True

    return False


def pair_blocks_event_merge(
    a: dict,
    b: dict,
    *,
    story_match_fn: Callable[[str, str], bool],
    url_fn: Callable[[dict], str],
) -> tuple[bool, str]:
    """Return (blocked, reason) for Phase 8D merge guards."""
    t1 = str(a.get("title") or "")
    t2 = str(b.get("title") or "")
    u1 = url_fn(a)
    u2 = url_fn(b)
    sm = story_match_fn(t1, t2)
    sj = slug_jaccard(u1, u2)

    if not sm and sj < LOW_SLUG_JACCARD_BLOCK:
        return True, "low_slug_no_story_match"

    if _replay_guard_distinct_events(t1, t2, u1, u2):
        return True, "replay_guard"

    if _recurring_template_distinct(t1, t2):
        return True, "recurring_template"

    return False, ""


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
        return [], [], {
            "suppressed_count": 0,
            "clusters_merged": 0,
            "event_dedupe_low_slug_skip": 0,
            "event_dedupe_replay_guard_skip": 0,
            "event_dedupe_recurring_template_skip": 0,
        }

    clean = [a for a in articles if isinstance(a, dict)]
    by_sec: dict[str, list[dict]] = defaultdict(list)
    for a in clean:
        sec = stable_section_fn(str(a.get("topic") or a.get("section") or "aktualne"))
        by_sec[sec].append(a)

    visible: list[dict] = []
    suppressed: list[dict] = []
    clusters_merged = 0
    low_slug_skip = 0
    replay_guard_skip = 0
    recurring_template_skip = 0

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
                if rel != "same_event_duplicate" or conf < 0.8:
                    continue
                blocked, reason = pair_blocks_event_merge(
                    arts[i], arts[j], story_match_fn=story_match_fn, url_fn=url_fn
                )
                if blocked:
                    if reason == "low_slug_no_story_match":
                        low_slug_skip += 1
                    elif reason == "replay_guard":
                        replay_guard_skip += 1
                    elif reason == "recurring_template":
                        recurring_template_skip += 1
                    continue
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
                blocked, _ = pair_blocks_event_merge(
                    loser, w, story_match_fn=story_match_fn, url_fn=url_fn
                )
                if blocked:
                    lo = dict(loser)
                    lo["topic_key"] = build_topic_key(lo, tokenize_fn)
                    lo["duplicate_of"] = None
                    lo["duplicate_reason"] = None
                    lo["duplicate_confidence"] = None
                    lo["selected_primary_reason"] = "event_dedupe_distinct_preserved"
                    visible.append(lo)
                    continue
                if rel != "same_event_duplicate":
                    continue
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
        "event_dedupe_low_slug_skip": low_slug_skip,
        "event_dedupe_replay_guard_skip": replay_guard_skip,
        "event_dedupe_recurring_template_skip": recurring_template_skip,
    }
    return visible, suppressed, stats
