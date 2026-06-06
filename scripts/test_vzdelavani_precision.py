# -*- coding: utf-8 -*-
"""Vzdělávání precision tests (run: python scripts/test_vzdelavani_precision.py)"""

import os
import sys

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from iu_vzdelavani_relevance import vzdelavani_content_relevant, vzdelavani_section_after_purity
from iu_feed_classification import classify_media_topic_key


def _assert(cond, msg=""):
    if not cond:
        raise AssertionError(msg or "assertion failed")


def _section(title, url, candidate="vzdelavani"):
    return vzdelavani_section_after_purity(title, url, candidate)


def test_scenario_maturity():
    title = "Maturity v Česku: termíny přijímacích zkoušek na gymnáziích"
    url = "https://www.novinky.cz/clanek/skola-maturity-123"
    _assert(_section(title, url) == "vzdelavani", "maturity should stay in vzdelavani")
    _assert(vzdelavani_content_relevant(title, url), "maturity relevance")


def test_scenario_university():
    title = "Univerzita Karlova otevřela nový program pro studenty informatiky"
    url = "https://www.seznamzpravy.cz/clanek/univerzita-program-456"
    _assert(_section(title, url) == "vzdelavani", "university should stay in vzdelavani")


def test_scenario_municipal_fraud_not_edu():
    title = "Obec přišla o čtyři miliony. Podvodníci se vydávali za policisty a bankéře"
    url = "https://www.seznamzpravy.cz/clanek/obec-podvod-vzdelavani-789"
    _assert(_section(title, url) == "aktualne", "fraud article must not stay in vzdelavani")
    _assert(not vzdelavani_content_relevant(title, url), "fraud not relevant")


def test_scenario_ebola_not_edu():
    title = "Pět pacientů se zotavilo z nového druhu eboly"
    url = "https://www.seznamzpravy.cz/clanek/ebola-vzdelavani-111"
    _assert(_section(title, url) == "aktualne", "health article must not stay in vzdelavani")


def test_scenario_foreign_politics_not_edu():
    title = "Írán porazí slabého Trumpa, tvrdí Teherán"
    url = "https://www.seznamzpravy.cz/clanek/iran-trump-vzdelavani-222"
    _assert(_section(title, url) == "aktualne", "foreign politics must not stay in vzdelavani")


def test_scenario_traffic_accident_not_edu():
    title = "Cyklista po střetu s autem zemřel"
    url = "https://www.seznamzpravy.cz/clanek/cyklista-nehoda-vzdelavani-333"
    _assert(_section(title, url) == "aktualne", "traffic accident must not stay in vzdelavani")


def test_false_positive_removal_prod_examples():
    cases = [
        (
            "Obec přišla o čtyři miliony. Podvodníci se vydávali za policisty a bankéře",
            "https://www.seznamzpravy.cz/clanek/obec-podvod-1",
        ),
        (
            "Do Brna přijel vyslanec papeže",
            "https://www.seznamzpravy.cz/clanek/papez-brnо-2",
        ),
        (
            "Pět pacientů se zotavilo z nového druhu eboly",
            "https://www.seznamzpravy.cz/clanek/ebola-3",
        ),
        (
            "V Rakousku u hranic s ČR blesk zapálil věž zámku",
            "https://www.seznamzpravy.cz/clanek/blesk-zamek-4",
        ),
        (
            "Írán porazí slabého Trumpa, tvrdí Teherán",
            "https://www.seznamzpravy.cz/clanek/iran-5",
        ),
        (
            "Cyklista po střetu s autem zemřel",
            "https://www.seznamzpravy.cz/clanek/cyklista-6",
        ),
    ]
    for title, url in cases:
        sec = _section(title, url)
        _assert(sec == "aktualne", f"false positive not removed: {title!r} -> {sec}")
        item = {
            "topic": "vzdelavani",
            "section": "vzdelavani",
            "title": title,
            "url": url,
            "sources": [{"name": "Seznam Zprávy"}],
        }
        mk, reason, _, flags = classify_media_topic_key(item)
        _assert(mk != "vzdelavani", f"classification false positive: {title!r} -> {mk} ({reason}, {flags})")


def test_feed_classification_keeps_real_edu():
    item = {
        "topic": "vzdelavani",
        "section": "vzdelavani",
        "title": "Studenti čekají na výsledky maturity",
        "url": "https://www.novinky.cz/clanek/skola-maturity-vysledky",
        "sources": [{"name": "Novinky"}],
    }
    mk, reason, conf, _ = classify_media_topic_key(item)
    _assert(mk == "vzdelavani", (mk, reason))
    _assert(conf >= 0.5, str(conf))


def main():
    test_scenario_maturity()
    test_scenario_university()
    test_scenario_municipal_fraud_not_edu()
    test_scenario_ebola_not_edu()
    test_scenario_foreign_politics_not_edu()
    test_scenario_traffic_accident_not_edu()
    test_false_positive_removal_prod_examples()
    test_feed_classification_keeps_real_edu()
    print("vzdelavani_precision_test: PASS")
    print("false_positive_removal_test: PASS")


if __name__ == "__main__":
    main()
