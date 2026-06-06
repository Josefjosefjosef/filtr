# -*- coding: utf-8 -*-
"""
Deterministic Vzdělávání relevance — precision over recall.

RSS rubric /vzdelavani/ alone is NOT education content. When uncertain, reject.
"""

from __future__ import annotations

_EDU_POSITIVE_TITLE = (
    "mateřsk",
    "matersk",
    "základní škol",
    "zakladni skol",
    "střední škol",
    "stredni skol",
    "vysoká škol",
    "vysoka skol",
    "univerzit",
    "student",
    "studentk",
    "studenti",
    "učitel",
    "ucitel",
    "učitelk",
    "profesor",
    "profesoř",
    "profesork",
    "přijímac",
    "prijima",
    "přijímačk",
    "prijimack",
    "maturit",
    "matur",
    "výuka",
    "vyuka",
    "studium",
    "stipendi",
    "rekvalifik",
    " rekvalif",
    "vzdělávací kurz",
    "vzdelavaci kurz",
    " v kurzu ",
    " školstv",
    " skolst",
    "vzdělávací polit",
    "vzdelavaci polit",
    "edukační technolog",
    "edukacni technolog",
    "vzdělávací projekt",
    "vzdelavaci projekt",
    "metodick",
    "desegreg",
    "školn",
    "skoln",
    " škol",
    " skol",
    " školy",
    " skoly",
    " škola",
    " skola",
    "gymnázi",
    "gymnazi",
    "odborná škol",
    "odborna skol",
)

_EDU_NEGATIVE = (
    "podvod",
    "podvodní",
    "podvodni",
    "policist",
    "bankéř",
    "banker",
    "bankéře",
    "papež",
    "papeze",
    "vyslanec pape",
    "pacient",
    "ebol",
    "nemoc",
    "nemocnic",
    "zotavil",
    "zotavilo",
    "zdravot",
    "blesk zapál",
    "blesk zapal",
    "požár",
    "pozar",
    "zámek",
    "zamek",
    "trump",
    " írán",
    " iran",
    " íránu",
    " írán ",
    "cyklist",
    "nehoda",
    "střet s aut",
    "stret s aut",
    " zemřel",
    " zemrel",
    "vražd",
    "vrazd",
    "obžal",
    "obzal",
    "krimi",
    "kriminal",
    "dopravní nehod",
    "dopravni nehod",
    "válk",
    "valk",
    "armád",
    "armad",
    "tanker",
    "nato",
    "konflikt",
    "sankc",
    "premiér",
    "premier",
    "volb",
    "zahranič",
    "zahranic",
)

_EDU_ONLY_HOST_FRAGMENTS = (
    "nespechej.cz",
    "betterlife.cz",
)


def _haystack(title: str, url: str = "") -> str:
    return ((title or "") + " " + (url or "")).lower()


def _has_any(hay: str, needles: tuple[str, ...]) -> bool:
    return any(n in hay for n in needles)


def vzdelavani_edu_positive(title: str, url: str = "") -> bool:
    """Strong education content signal in title, or dedicated edu URL path/host."""
    tl = (title or "").lower()
    if _has_any(tl, _EDU_POSITIVE_TITLE):
        return True
    ul = (url or "").lower()
    if "/skola/" in ul or ul.rstrip("/").endswith("/skola"):
        return True
    if any(h in ul for h in _EDU_ONLY_HOST_FRAGMENTS):
        return True
    return False


def vzdelavani_edu_negative(title: str, url: str = "") -> bool:
    """Clear non-education signal — always blocks Vzdělávání."""
    return _has_any(_haystack(title, url), _EDU_NEGATIVE)


def vzdelavani_content_relevant(title: str, url: str = "") -> bool:
    """
    Precision-first gate. Rubric URL /vzdelavani/ without edu title → not relevant.
    """
    if vzdelavani_edu_negative(title, url):
        return False
    return vzdelavani_edu_positive(title, url)


def vzdelavani_section_after_purity(title: str, url: str, candidate_section: str = "vzdelavani") -> str:
    """Mirror build_articles vertical purity outcome for Vzdělávání (precision-first)."""
    sec = (candidate_section or "aktualne").strip().lower()
    if sec != "vzdelavani":
        return sec
    if not vzdelavani_content_relevant(title, url):
        return "aktualne"
    return "vzdelavani"
