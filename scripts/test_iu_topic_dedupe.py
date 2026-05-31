#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Unit tests for conservative topic/event dedupe (false-positive protection)."""
from __future__ import annotations

import os
import sys

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from iu_topic_dedupe import classify_pair_relation  # noqa: E402


def _always_match(_t1: str, _t2: str) -> bool:
    return True


def _never_match(_t1: str, _t2: str) -> bool:
    return False


def _art(title: str, pub: str = "2026-06-01T10:00:00Z") -> dict:
    return {"title": title, "publishedAt": pub, "url": f"https://example.com/{hash(title)}"}


def test_same_event_duplicate():
    a = _art("Prezident jednal s premiérem o vládě")
    b = _art("Prezident se sešel s premiérem", "2026-06-01T10:30:00Z")
    rel, conf = classify_pair_relation(a, b, "aktualne", lambda t1, t2: True)
    assert rel == "same_event_duplicate", rel
    assert conf >= 0.8


def test_follow_up_not_merged_as_duplicate():
    a = _art("Prezident jednal s premiérem")
    b = _art("Reakce premiéra na schůzku s prezidentem", "2026-06-01T11:00:00Z")
    rel, _ = classify_pair_relation(a, b, "aktualne", _always_match)
    assert rel in ("follow_up_update", "analysis_or_opinion", "related_but_distinct")


def test_different_political_cases():
    a = _art("Soud s politikem kvůli korupci v Praze")
    b = _art("Ministr financí představil rozpočet na příští rok")
    rel, conf = classify_pair_relation(a, b, "aktualne", _never_match)
    assert rel == "related_but_distinct"
    assert conf < 0.5


def test_different_sport_matches():
    a = _art("Sparta vyhrála nad Slavií 2:1 v derby")
    b = _art("Plzeň porazila Ostravu v ligovém kole", "2026-06-01T12:00:00Z")
    rel, _ = classify_pair_relation(a, b, "sport", _never_match)
    assert rel == "related_but_distinct"


def test_outside_time_window():
    a = _art("Hlavní událost dne v regionu", "2026-06-01T08:00:00Z")
    b = _art("Hlavní událost dne v regionu později", "2026-06-05T08:00:00Z")
    rel, _ = classify_pair_relation(a, b, "aktualne", _always_match)
    assert rel == "related_but_distinct"


def main() -> int:
    test_same_event_duplicate()
    test_follow_up_not_merged_as_duplicate()
    test_different_political_cases()
    test_different_sport_matches()
    test_outside_time_window()
    print("test_iu_topic_dedupe: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
