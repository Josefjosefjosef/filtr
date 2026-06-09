# -*- coding: utf-8 -*-
"""
Phase 10B: targeted section purity fallback guards for publishable pool writer path.

Demotes confirmed mis-tags in hry/kultura/zdravi/sport only.
Does not broad-reclassify; does not touch finance/doprava/cestovani/vzdelavani sources.
"""

from __future__ import annotations

import re
from typing import Any

from iu_feed_classification import (
    _BYDLENI_HAY,
    _BYDLENI_NAME,
    _RE_ARCHIV_HN,
    _RE_BYZNYS_LEADING,
    _RE_EKONOMICKY_DENIK,
    _RE_HEALTH_TITLE,
    _energy_or_infra_not_health_title,
    _finance_title_signals,
    _hay,
    _sport_event_title_signals,
)

# Sections where contamination is fixed (Phase 10B scope).
TARGET_SECTIONS = frozenset({"hry", "kultura", "zdravi", "sport"})

# Never demote articles already correctly placed in these sections.
PROTECTED_SECTIONS = frozenset({"finance", "doprava", "cestovani", "vzdelavani"})

NEWS_SECTION = "aktualne"

# Strong URL signals that always fall back to news when leaking into a vertical feed.
NEWS_FALLBACK_STRONG = frozenset({"krimi", "pocasi", "doprava"})

_BYDLENI_TITLE = re.compile(
    r"\b(bydlení|bydleni|hypoték|hypotek|rekonstruk|interiér|interier|koupeln|"
    r"kuchyn|najem|nájem|pronájem|pronajem|nemovit|realit|dům a zahrada|dum a zahrada)\b",
    re.I,
)
_FINANCE_HOME = re.compile(
    r"\b(hypoték|hypotek|úrok|urok|energi|vytápění|vytapeni|realit|nájem|najem|"
    r"investic|developersk|stavební|stavebni)\b",
    re.I,
)


def _import_ba():
    import build_articles as ba

    return ba


def _article_url(article: dict) -> str:
    url = str(article.get("url") or "").strip()
    if url:
        return url
    src0 = (article.get("sources") or [{}])[0]
    if isinstance(src0, dict):
        return str(src0.get("url") or "").strip()
    return ""


def _current_section(article: dict) -> str:
    ba = _import_ba()
    return ba.stable_section(str(article.get("topic") or article.get("section") or NEWS_SECTION))


def _set_section(article: dict, section: str) -> dict:
    ba = _import_ba()
    sec = ba.stable_section(section)
    out = dict(article)
    out["topic"] = out["section"] = sec
    return out


def _bydleni_signal(title: str, url: str, article: dict) -> bool:
    src0, _, hay = _hay(article)
    if _BYDLENI_NAME.search(src0 + " " + url):
        return True
    if _BYDLENI_HAY.search(hay):
        return True
    return bool(_BYDLENI_TITLE.search(title))


def _bydleni_target(title: str) -> str:
    if _FINANCE_HOME.search(title) or _finance_title_signals(title):
        return "finance"
    return NEWS_SECTION


def _fallback_sport_ekonomicky_denik(title: str, url: str) -> str | None:
    if not _RE_EKONOMICKY_DENIK.search(url):
        return None
    u = url.lower()
    if re.search(
        r"/(sport|fotbal|hokej|tenis|liga|mladifotbal|fight|bojov|zápas|zapas)/",
        u,
        re.I,
    ):
        return None
    if _finance_title_signals(title) or _RE_BYZNYS_LEADING.search(title):
        return "finance"
    if _sport_event_title_signals(title):
        return None
    return NEWS_SECTION


def _fallback_zdravi_fake(title: str, url: str) -> str | None:
    ba = _import_ba()
    _, path = ba._host_path(url)
    path_ok = "/zdravi" in path or "/zdrav" in path
    title_ok = bool(_RE_HEALTH_TITLE.search(title))

    if _RE_ARCHIV_HN.search(url) and not path_ok and not title_ok:
        if _finance_title_signals(title):
            return "finance"
        if _energy_or_infra_not_health_title(title):
            return NEWS_SECTION
        return NEWS_SECTION

    if not path_ok and not title_ok:
        if _finance_title_signals(title) and not _RE_HEALTH_TITLE.search(title):
            return "finance"
        if _energy_or_infra_not_health_title(title):
            return NEWS_SECTION

    return None


def _fallback_strong_url_hry_kultura(current: str, title: str, url: str) -> str | None:
    ba = _import_ba()
    strong = ba._infer_section_strong_explicit_url_signals(url)
    if strong is None:
        return None
    strong = ba.stable_section(strong)
    if strong == current:
        return None

    if strong in NEWS_FALLBACK_STRONG:
        return NEWS_SECTION

    if current == "hry":
        return NEWS_SECTION

    if current == "kultura":
        if strong == "sport" and ba._second_layer_sport_url_high_confidence(url):
            return "sport"
        if strong == "cestovani" and ba._second_layer_path_has_cestovani_segment(
            ba._host_path(url)[1]
        ):
            try:
                from datetime import datetime, timezone

                dt = datetime.now(timezone.utc)
                fin = ba.vertical_purity_final_section("cestovani", title, url, dt)
                if fin == "cestovani":
                    return "cestovani"
            except Exception:
                pass
            return NEWS_SECTION
        if strong == "finance":
            _, path = ba._host_path(url)
            economy = (
                "/ekonomika" in path
                or "/finance" in path
                or "/byznys" in path
                or "/reality" in path
            )
            return "finance" if economy else NEWS_SECTION
        if strong == "zdravi":
            _, path = ba._host_path(url)
            return "zdravi" if ("/zdravi" in path or "/zdrav" in path) else NEWS_SECTION
        return NEWS_SECTION

    return None


def apply_section_purity_fallback(article: dict) -> dict:
    """
    Phase 10B targeted fallback for publishable pool writer path.
    Returns article unchanged when no confirmed mis-tag pattern matches.
    """
    if not isinstance(article, dict):
        return article

    ba = _import_ba()
    current = _current_section(article)
    if current not in TARGET_SECTIONS:
        return article

    title = str(article.get("title") or "")
    url = _article_url(article)
    if ba._second_layer_is_nato_babis_aktualne_title(title):
        return article

    if _bydleni_signal(title, url, article):
        return _set_section(article, _bydleni_target(title))

    if current == "sport":
        target = _fallback_sport_ekonomicky_denik(title, url)
        if target:
            return _set_section(article, target)

    if current == "zdravi":
        target = _fallback_zdravi_fake(title, url)
        if target:
            return _set_section(article, target)

    if current in ("hry", "kultura"):
        target = _fallback_strong_url_hry_kultura(current, title, url)
        if target:
            return _set_section(article, target)

    return article


def apply_section_purity_fallback_list(articles: list) -> list:
    return [apply_section_purity_fallback(a) for a in articles if isinstance(a, dict)]
