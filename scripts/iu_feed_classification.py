# -*- coding: utf-8 -*-
"""
Server-side media hub classification (source of truth for homepage topic chips).

Mirrors assets/app.js iuArticleMatchesMediaTopicKey resolution into a single
canonical mediaTopicKey per article. Frontend MUST prefer iuFeedClassification
when v==1 instead of re-deriving topic membership heuristically.

Deterministic: same input article dict -> same classification.
"""

from __future__ import annotations

import re
from typing import Any, Dict

# Mirror IU_TECH_SOURCES_LIST
_TECH_SOURCES = (
    "Lupa.cz",
    "Root.cz",
    "Živě.cz",
    "MobilMania.cz",
    "CNews.cz",
)

# Vertical topics: not in general "Zprávy" pool (case zpravy in JS)
_ZPRAVY_EXCLUDED = frozenset(
    {
        "sport",
        "finance",
        "zdravi",
        "cestovani",
        "hry",
        "kultura",
        "veda",
        "vzdelavani",
        "tech",
        "bydleni",
    }
)

_BYDLENI_NAME = re.compile(
    r"Deník Bydlení|Novinky Bydlení|Dům a zahrada|Recepty\.cz|Chatař|irozhlas.*životní",
    re.I,
)
_BYDLENI_HAY = re.compile(
    r"bydleni|dumazahrada|recepty|chalupar|zivotni-styl", re.I
)
_TECH_URL = re.compile(r"lupa\.cz|root\.cz|zive\.cz|mobilmania|cnews\.cz", re.I)
_CEST_URL = re.compile(
    r"novinky\.cz/cestovani|denik\.cz/cestovani|kudyznudy|cestovani\.novinky|i\.globus\.cz/cestovani|irozhlas\.cz/cestovani",
    re.I,
)
_CEST_HAY = re.compile(
    r"novinky\s+cestov|deník\s+cestov|denik\s+cestov|irozhlas.*cestov", re.I
)


def _hay(item: Dict[str, Any]) -> Tuple[str, str, str]:
    src0 = ""
    try:
        srcs = item.get("sources")
        if isinstance(srcs, list) and srcs and isinstance(srcs[0], dict):
            src0 = str(srcs[0].get("name") or "").strip()
    except Exception:
        pass
    url = str(item.get("url") or "")
    hay = (src0 + " " + url).lower()
    return src0, url, hay


def _topic_lower(item: Dict[str, Any]) -> str:
    return str(item.get("topic") or item.get("section") or "").strip().lower()


def classify_media_topic_key(item: Dict[str, Any]) -> Tuple[str, str, float]:
    """
    Returns (media_topic_key, reason, confidence in [0,1]).
    media_topic_key is one of: zpravy, sport, finance, zdravi, cestovani, hry,
    kultura, veda, vzdelavani, tech, bydleni
    """
    if not isinstance(item, dict):
        return "zpravy", "invalid_item", 0.0

    t = _topic_lower(item)
    src0, url, hay = _hay(item)
    s = src0.strip()

    # 1) Tech sources / URL (JS case tech)
    for x in _TECH_SOURCES:
        if s == x or s.startswith(x):
            return "tech", "tech_source_list", 0.95
    if _TECH_URL.search(hay):
        return "tech", "tech_url_regex", 0.9

    # 2) Bydlení (JS case bydleni)
    if _BYDLENI_NAME.search(src0 + url) or _BYDLENI_HAY.search(hay):
        return "bydleni", "bydleni_pattern", 0.88

    # 3) Cestování URL / hay (JS case cestovani partial)
    if t == "cestovani":
        return "cestovani", "topic_field", 0.92
    if _CEST_URL.search(hay) or _CEST_HAY.search(hay):
        return "cestovani", "cestovani_url_hay", 0.88

    # 4) Direct topic / section match for verticals (authoritative RSS pipeline)
    if t == "sport":
        return "sport", "topic_field", 0.95
    if t == "finance":
        return "finance", "topic_field", 0.95
    if t == "zdravi":
        return "zdravi", "topic_field", 0.95
    if t == "hry":
        return "hry", "topic_field", 0.95
    if t == "kultura":
        return "kultura", "topic_field", 0.95
    if t == "veda":
        return "veda", "topic_field", 0.95
    if t == "vzdelavani":
        return "vzdelavani", "topic_field", 0.95

    # 5) General news pool (Zprávy chip): aktualne, krimi, doprava, pocasi, empty -> zpravy
    if t in ("", "aktualne", "krimi", "doprava", "pocasi"):
        return "zpravy", "general_news_bucket", 0.85

    # 6) Unknown / legacy topic: safe fallback — do not force into a wrong vertical
    if t not in _ZPRAVY_EXCLUDED:
        return "zpravy", "fallback_non_vertical", 0.55

    # Should not reach if t in excluded set but not handled above
    return "zpravy", "fallback_guard", 0.5


def attach_feed_classification_to_article(article: Dict[str, Any]) -> Dict[str, Any]:
    """Return a new dict with iuFeedClassification attached (does not mutate input)."""
    if not isinstance(article, dict):
        return article
    out = dict(article)
    mk, reason, conf = classify_media_topic_key(out)
    out["iuFeedClassification"] = {
        "v": 1,
        "mediaTopicKey": mk,
        "reason": reason,
        "confidence": round(min(1.0, max(0.0, conf)), 4),
        "railSectionKey": str(out.get("topic") or out.get("section") or "").strip().lower()
        or None,
    }
    return out


def enrich_article_list(articles: list) -> list:
    """Classify each article dict; pass through non-dicts unchanged."""
    out = []
    for a in articles or []:
        if isinstance(a, dict):
            out.append(attach_feed_classification_to_article(a))
        else:
            out.append(a)
    return out
