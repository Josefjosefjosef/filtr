# -*- coding: utf-8 -*-
"""Unit tests for iu_feed_classification (run: python scripts/test_iu_feed_classification.py)"""

import os
import sys

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from iu_feed_classification import attach_feed_classification_to_article, classify_media_topic_key


def _assert(cond, msg=""):
    if not cond:
        raise AssertionError(msg or "assertion failed")


def test_sport_topic():
    a = {"topic": "sport", "section": "sport", "url": "https://sport.example/a", "sources": [{"name": "Test"}]}
    k, _, _, _ = classify_media_topic_key(a)
    _assert(k == "sport", k)


def test_zpravy_general():
    a = {"topic": "aktualne", "section": "aktualne", "url": "https://zpravy.example/", "sources": [{"name": "Novinky"}]}
    k, _, c, _ = classify_media_topic_key(a)
    _assert(k == "zpravy", k)
    _assert(c >= 0.5, str(c))


def test_tech_source():
    a = {"topic": "aktualne", "url": "https://lupa.cz/a", "sources": [{"name": "Lupa.cz"}]}
    k, r, _, _ = classify_media_topic_key(a)
    _assert(k == "tech", (k, r))


def test_finance_topic():
    a = {"topic": "finance", "section": "finance", "url": "https://x.cz", "sources": [{"name": "E15"}]}
    _assert(classify_media_topic_key(a)[0] == "finance")


def test_attach_schema():
    a = {"topic": "sport", "section": "sport", "url": "https://x.cz", "sources": []}
    b = attach_feed_classification_to_article(a)
    _assert("iuFeedClassification" in b)
    _assert(b["iuFeedClassification"]["v"] == 1)
    _assert(b["iuFeedClassification"]["mediaTopicKey"] == "sport")


def test_conflicting_priority_tech_over_general_topic():
    a = {
        "topic": "aktualne",
        "section": "aktualne",
        "url": "https://root.cz/clanek",
        "sources": [{"name": "Root.cz"}],
    }
    _assert(classify_media_topic_key(a)[0] == "tech")


def test_url_sport_overrides_wrong_topic():
    a = {
        "topic": "finance",
        "section": "finance",
        "url": "https://sport.example.cz/fotbal/zapas",
        "sources": [{"name": "SportTest"}],
    }
    k, r, _, flags = classify_media_topic_key(a)
    _assert(k == "sport", (k, r))
    _assert("topic_url_conflict" in flags, str(flags))


def test_hn_archiv_fake_zdravi_energy_to_zpravy():
    a = {
        "topic": "zdravi",
        "section": "zdravi",
        "url": "https://archiv.hn.cz/c1-67863180-stojici-elektrarny-kuba",
        "title": "Stojící elektrárny a tisíce lidí bez příjmu. Kolaps kubánské energetiky",
        "sources": [{"name": "HN"}],
    }
    k, r, _, fl = classify_media_topic_key(a)
    _assert(k == "zpravy", (k, r))
    _assert("guard_hn_archiv_fake_zdravi_zpravy" in fl or "guard_hn" in r, (r, fl))


def test_hn_archiv_fake_zdravi_finance_title():
    a = {
        "topic": "zdravi",
        "section": "zdravi",
        "url": "https://archiv.hn.cz/c1-67864820-zlevnete-orlen",
        "title": "Zlevněte, vyzval Babiš Orlen a MOL. Firmy podle něj zdražily",
        "sources": [{"name": "HN"}],
    }
    k, r, _, _ = classify_media_topic_key(a)
    _assert(k == "finance", (k, r))


def test_ekonomicky_denik_sport_topic_business_to_finance():
    a = {
        "topic": "sport",
        "section": "sport",
        "url": "https://ekonomickydenik.cz/oblibene-vydejni-boxy-v-ohrozeni/",
        "title": "Oblíbené výdejní boxy v ohrožení? Chystá se změna zákona",
        "sources": [{"name": "Ekonomický deník"}],
    }
    k, r, _, _ = classify_media_topic_key(a)
    _assert(k == "finance", (k, r))


def test_byznys_title_overrides_sport_topic():
    a = {
        "topic": "sport",
        "section": "sport",
        "url": "https://crzpravy.cz/celebrity/byznys-strnada-vstupuje/",
        "title": "Byznys Jaroslava Strnada vstupuje do nové éry. Rekordní růst",
        "sources": [{"name": "X"}],
    }
    k, r, _, _ = classify_media_topic_key(a)
    _assert(k == "finance", (k, r))


def test_url_strong_not_overridden_by_quality_guard():
    a = {
        "topic": "zdravi",
        "section": "zdravi",
        "url": "https://ct24.ceskatelevize.cz/clanek/veda/orion-astronauti-371992",
        "title": "Orion míří k Měsíci",
        "sources": [{"name": "ČT24"}],
    }
    k, _, _, _ = classify_media_topic_key(a)
    _assert(k == "veda", k)


def run():
    test_sport_topic()
    test_zpravy_general()
    test_tech_source()
    test_finance_topic()
    test_attach_schema()
    test_conflicting_priority_tech_over_general_topic()
    test_url_sport_overrides_wrong_topic()
    test_hn_archiv_fake_zdravi_energy_to_zpravy()
    test_hn_archiv_fake_zdravi_finance_title()
    test_ekonomicky_denik_sport_topic_business_to_finance()
    test_byznys_title_overrides_sport_topic()
    test_url_strong_not_overridden_by_quality_guard()
    print("PASS iu_feed_classification tests")


if __name__ == "__main__":
    run()
