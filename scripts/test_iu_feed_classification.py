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
    k, _, _ = classify_media_topic_key(a)
    _assert(k == "sport", k)


def test_zpravy_general():
    a = {"topic": "aktualne", "section": "aktualne", "url": "https://zpravy.example/", "sources": [{"name": "Novinky"}]}
    k, _, c = classify_media_topic_key(a)
    _assert(k == "zpravy", k)
    _assert(c >= 0.5, str(c))


def test_tech_source():
    a = {"topic": "aktualne", "url": "https://lupa.cz/a", "sources": [{"name": "Lupa.cz"}]}
    k, r, _ = classify_media_topic_key(a)
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


def run():
    test_sport_topic()
    test_zpravy_general()
    test_tech_source()
    test_finance_topic()
    test_attach_schema()
    test_conflicting_priority_tech_over_general_topic()
    print("PASS iu_feed_classification tests")


if __name__ == "__main__":
    run()
