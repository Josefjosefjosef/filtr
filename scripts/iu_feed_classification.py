# -*- coding: utf-8 -*-
"""
Server-side media hub classification (source of truth for homepage topic chips).

Layers (order):
1) Strong URL/host signals (sport/finance/zdravi/cestovani/…) — same family as build_articles infer_section
2) Tech / bydlení source + URL heuristics (mirror frontend)
3) RSS topic/section field (ingest truth)
4) General news bucket -> zpravy
5) Vertical quality guards (topic/feed errors vs title/domain — deterministic)

Deterministic: same input -> same output.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Optional
from urllib.parse import urlparse

# Mirror IU_TECH_SOURCES_LIST (assets/app.js)
_TECH_SOURCES = (
    "Lupa.cz",
    "Root.cz",
    "Živě.cz",
    "MobilMania.cz",
    "CNews.cz",
)

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

# Quality guards — audited mis-tagged RSS verticals (HN archiv, Ekonomický deník, …)
_RE_ARCHIV_HN = re.compile(r"archiv\.hn\.cz|archiv\.hn\.", re.I)
_RE_EKONOMICKY_DENIK = re.compile(r"ekonomickydenik\.cz", re.I)
_RE_BYZNYS_LEADING = re.compile(r"^\s*Byznys\b", re.I)
_RE_HEALTH_TITLE = re.compile(
    r"\b(nemoc|nemocnic|lékař|lekars|pacient|zdraví|zdravi|očkov|covid|onkolog|operac|chorob|léč|lecba|vakcín|antibiot|psychiatr|rehabilit|epidemi|ambulanc|lék\s)",
    re.I,
)


def _hay(item: Dict[str, Any]) -> tuple[str, str, str]:
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


def _title_str(item: Dict[str, Any]) -> str:
    return str(item.get("title") or "")


def _host_path(url: str) -> tuple[str, str]:
    try:
        p = urlparse(url)
        h = (p.netloc or "").lower()
        path = (p.path or "").lower()
        return h, path
    except Exception:
        return "", ""


def _finance_title_signals(title: str) -> bool:
    tl = title.lower()
    needles = (
        "byznys ",
        " byznys",
        " akcie",
        "burz",
        "investic",
        "hypoték",
        "inflace",
        " orlen",
        " mol ",
        "stellantis",
        " ekonomik",
        "financ",
        "výdejní box",
        "čerpacích stanic",
        "ministerstvo financ",
        "úrok",
        "reality ",
        " zisk ",
        "ztrát",
    )
    if _RE_BYZNYS_LEADING.search(title):
        return True
    return any(x in tl for x in needles)


def _energy_or_infra_not_health_title(title: str) -> bool:
    tl = title.lower()
    needles = (
        "energetick",
        "elektřin",
        "elektrár",
        "superdálnic",
        "veřejné osvětlení",
        "verejne osvetleni",
        "doktorand",
        " do vědy",
        " do vedy",
        "stojící elektr",
        "kubánsk",
    )
    return any(x in tl for x in needles)


def _sport_event_title_signals(title: str) -> bool:
    tl = title.lower()
    return bool(
        re.search(
            r"\b(liga|zápas|zapas|hokej|fotbal|sparta|slavia|gól|gol|nhl|extraliga|olympi|"
            r"tenis|mistrov|trenér|trener|basket|mma|ufc|bundesliga|premier league)\b",
            tl,
            re.I,
        )
    )


def infer_strong_media_vertical_from_url(url: str) -> Optional[str]:
    """
    Host/path-only vertical hint (aligned with build_articles infer_section / strong URL signals).
    Returns canonical mediaTopicKey or None.
    """
    if not url or not url.strip():
        return None
    h, path = _host_path(url)
    pl = path
    if "pocasi" in h or "/pocasi" in pl or pl.startswith("/pocasi"):
        return None
    if "doprava" in h or "/doprava" in pl or "/nehody" in pl:
        return None
    # HN archiv: slug often encodes section (byznys, …) without /byznys/ path prefix
    if "archiv.hn.cz" in h or (h.endswith("hn.cz") and "archiv" in url.lower()):
        if re.search(r"(byznys|ekonomika|ekonomicky-postoj)", pl, re.I):
            return "finance"
    if "/cestovani" in pl or "/cestovan" in pl or "cestovani" in h:
        return "cestovani"
    if h.startswith("sport.") or "/sport" in pl or "/fotbal" in pl or "/hokej" in pl or "/tenis" in pl:
        return "sport"
    if "mmamag.cz" in h or "fights.cz" in h or h.startswith("isport."):
        return "sport"
    if "/ekonomika" in pl or "/finance" in pl or "/byznys" in pl or "/reality" in pl:
        return "finance"
    if h.startswith("byznys.") or h.startswith("ekonomika.") or h.startswith("finance."):
        return "finance"
    if "/zdravi" in pl or "/zdrav" in pl or "zdravi" in h:
        return "zdravi"
    if "/veda/" in pl or pl.rstrip("/").endswith("/veda"):
        return "veda"
    if "/kultura/" in pl or pl.rstrip("/").endswith("/kultura"):
        return "kultura"
    if "/skola/" in pl or pl.rstrip("/").endswith("/skola"):
        return "vzdelavani"
    if "/hry/" in pl or pl.rstrip("/").endswith("/hry"):
        return "hry"
    if "travel" in pl or "letenk" in pl or "pelipeck" in h:
        return "cestovani"
    return None


def _classify_media_topic_key_inner(item: Dict[str, Any]) -> tuple[str, str, float, list[str]]:
    """
    Returns (media_topic_key, reason, confidence, guard_flags).
    """
    flags: list[str] = []
    if not isinstance(item, dict):
        return "zpravy", "invalid_item", 0.0, ["invalid"]

    t = _topic_lower(item)
    src0, url, hay = _hay(item)
    s = src0.strip()

    url_vert = infer_strong_media_vertical_from_url(url)
    if url_vert is not None:
        if t and t in _ZPRAVY_EXCLUDED and t != url_vert:
            flags.append("topic_url_conflict")
            # URL strong wins over mismatched topic (e.g. wrong RSS category)
            mk = url_vert
            return mk, "url_strong_overrides_topic", 0.92, flags
        return url_vert, "url_strong_vertical", 0.94, flags

    for x in _TECH_SOURCES:
        if s == x or s.startswith(x):
            return "tech", "tech_source_list", 0.95, flags
    if _TECH_URL.search(hay):
        return "tech", "tech_url_regex", 0.9, flags

    if _BYDLENI_NAME.search(src0 + url) or _BYDLENI_HAY.search(hay):
        return "bydleni", "bydleni_pattern", 0.88, flags

    if t == "cestovani":
        return "cestovani", "topic_field", 0.92, flags
    if _CEST_URL.search(hay) or _CEST_HAY.search(hay):
        return "cestovani", "cestovani_url_hay", 0.88, flags

    if t == "sport":
        return "sport", "topic_field", 0.95, flags
    if t == "finance":
        return "finance", "topic_field", 0.95, flags
    if t == "zdravi":
        return "zdravi", "topic_field", 0.95, flags
    if t == "hry":
        return "hry", "topic_field", 0.95, flags
    if t == "kultura":
        return "kultura", "topic_field", 0.95, flags
    if t == "veda":
        return "veda", "topic_field", 0.95, flags
    if t == "vzdelavani":
        return "vzdelavani", "topic_field", 0.95, flags

    if t in ("", "aktualne", "krimi", "doprava", "pocasi"):
        return "zpravy", "general_news_bucket", 0.85, flags

    if t not in _ZPRAVY_EXCLUDED:
        flags.append("low_confidence_fallback")
        return "zpravy", "fallback_non_vertical", 0.55, flags

    return "zpravy", "fallback_guard", 0.5, flags


def apply_vertical_quality_guards(
    item: Dict[str, Any],
    mk: str,
    reason: str,
    conf: float,
    flags: list[str],
) -> tuple[str, str, float, list[str]]:
    """
    Post-pass: demote obvious RSS/topic mis-tags (audited: HN archiv zdravi, Ekonomický deník sport, …).
    Does not override url_strong_* or dedicated source/url truth layers.
    """
    fl = list(flags)
    title = _title_str(item)
    url = str(item.get("url") or "")
    h, path = _host_path(url)

    if mk == "vzdelavani":
        from iu_vzdelavani_relevance import vzdelavani_content_relevant

        if not vzdelavani_content_relevant(title, url):
            fl.append("guard_vzdelavani_not_relevant")
            return "zpravy", "guard_vzdelavani_precision", 0.88, fl

    if reason in (
        "url_strong_vertical",
        "url_strong_overrides_topic",
        "tech_source_list",
        "tech_url_regex",
        "bydleni_pattern",
        "cestovani_url_hay",
    ):
        return mk, reason, conf, fl

    # Ekonomický deník: business domain — RSS "sport" is often wrong; require sport-like URL path
    if mk == "sport" and _RE_EKONOMICKY_DENIK.search(url):
        if not re.search(
            r"/(sport|fotbal|hokej|tenis|liga|mladifotbal|fight|bojov|zápas|zapas)/",
            url,
            re.I,
        ):
            if _finance_title_signals(title) or _RE_BYZNYS_LEADING.search(title):
                fl.append("guard_ekonomicky_denik_sport_to_finance")
                return "finance", "guard_domain_topic_sport_mismatch", 0.9, fl
            fl.append("guard_ekonomicky_denik_sport_to_zpravy")
            return "zpravy", "guard_domain_topic_sport_mismatch", 0.82, fl

    # Global: sport from RSS but title is clearly business/finance and not a sports event
    if mk == "sport" and reason == "topic_field":
        if _RE_BYZNYS_LEADING.search(title) or (
            _finance_title_signals(title) and not _sport_event_title_signals(title)
        ):
            fl.append("guard_business_title_overrides_sport_topic")
            return "finance", "guard_title_finance_over_sport_topic", 0.88, fl

    # HN archiv: RSS "zdravi" is frequently wrong — path/title must support health
    if mk == "zdravi" and _RE_ARCHIV_HN.search(url) and reason == "topic_field":
        path_ok = "/zdravi" in path or "/zdrav" in path
        title_ok = bool(_RE_HEALTH_TITLE.search(title))
        if not path_ok and not title_ok:
            if _finance_title_signals(title):
                fl.append("guard_hn_archiv_fake_zdravi_finance")
                return "finance", "guard_hn_zdravi_to_finance", 0.86, fl
            if _energy_or_infra_not_health_title(title):
                fl.append("guard_hn_archiv_fake_zdravi_zpravy")
                return "zpravy", "guard_hn_zdravi_to_zpravy", 0.8, fl

    return mk, reason, conf, fl


def classify_media_topic_key(item: Dict[str, Any]) -> tuple[str, str, float, list[str]]:
    mk, reason, conf, flags = _classify_media_topic_key_inner(item)
    return apply_vertical_quality_guards(item, mk, reason, conf, flags)


def attach_feed_classification_to_article(article: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(article, dict):
        return article
    out = dict(article)
    mk, reason, conf, guard_flags = classify_media_topic_key(out)
    out["iuFeedClassification"] = {
        "v": 1,
        "mediaTopicKey": mk,
        "reason": reason,
        "confidence": round(min(1.0, max(0.0, conf)), 4),
        "railSectionKey": str(out.get("topic") or out.get("section") or "").strip().lower()
        or None,
        "guardFlags": guard_flags,
    }
    return out


def enrich_article_list(articles: list) -> list:
    out = []
    for a in articles or []:
        if isinstance(a, dict):
            out.append(attach_feed_classification_to_article(a))
        else:
            out.append(a)
    return out


def classification_coverage_stats(articles: list) -> dict[str, Any]:
    n = len(articles or [])
    ok = 0
    for a in articles or []:
        if not isinstance(a, dict):
            continue
        cf = a.get("iuFeedClassification")
        if isinstance(cf, dict) and cf.get("v") == 1 and cf.get("mediaTopicKey"):
            ok += 1
    pct = (100.0 * ok / n) if n else 100.0
    return {"total": n, "withClassification": ok, "coveragePct": round(pct, 2)}
