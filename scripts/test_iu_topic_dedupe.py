#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Unit tests for conservative topic/event dedupe (false-positive protection)."""
from __future__ import annotations

import os
import sys

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from iu_topic_dedupe import (  # noqa: E402
    _recurring_template_distinct,
    _replay_guard_distinct_events,
    apply_topic_event_dedupe,
    classify_pair_relation,
    pair_blocks_event_merge,
    slug_jaccard,
)


def _always_match(_t1: str, _t2: str) -> bool:
    return True


def _never_match(_t1: str, _t2: str) -> bool:
    return False


def _weak_match(t1: str, t2: str) -> bool:
    """Simulate weak token overlap without true same-event."""
    shared = {"utok", "iran", "drone", "usa"}
    a = set(t1.lower().split()) & shared
    b = set(t2.lower().split()) & shared
    return len(a) >= 2 and len(b) >= 2 and a == b


def _art(title: str, pub: str = "2026-06-01T10:00:00Z", url: str | None = None) -> dict:
    u = url or f"https://example.com/{abs(hash(title))}"
    return {"title": title, "publishedAt": pub, "url": u, "topic": "aktualne", "section": "aktualne"}


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


def test_fix1_low_slug_no_story_match_blocks_merge():
    a = _art(
        "Při dronovém útoku na tržiště v Súdánu zahynulo pět lidí",
        url="https://news.example/a/sudan-trziste-dron",
    )
    b = _art(
        "Čtyři lidé zahynuli při ukrajinském útoku v Rjazani",
        url="https://news.example/b/rjazan-ukrajina-utok",
    )
    blocked, reason = pair_blocks_event_merge(a, b, story_match_fn=_never_match, url_fn=lambda x: x["url"])
    assert blocked is True
    assert reason == "low_slug_no_story_match"


def test_fix2_replay_guard_sudan_rjazan():
    assert _replay_guard_distinct_events(
        "Při dronovém útoku na tržiště v Súdánu zahynulo pět lidí",
        "Čtyři lidé zahynuli při ukrajinském útoku v Rjazani",
        "https://a/sudan-trziste",
        "https://b/rjazan-utok",
    )


def test_fix2_replay_guard_iran_terminals():
    assert _replay_guard_distinct_events(
        "Americké síly vyřadily z provozu dva íránské ropné terminály",
        "USA opět zaútočily na Írán. Příměří zůstává stále v nedohlednu",
        "https://a/iran-terminaly-ropne-a",
        "https://b/iran-primeri-utok-usa",
    )


def test_fix3_recurring_tax_vs_crypto():
    assert _recurring_template_distinct(
        "Daňové přiznání 2026: Návod, jak vyplnit formulář",
        "Zdanění bitcoinu 2026: Kdy a jak danit kryptoměny",
    )


def test_fix3_recurring_recap_different_days():
    assert _recurring_template_distinct(
        "SOUHRN: Zásadní události pondělí 11. května",
        "SOUHRN: Zásadní události úterý 12. května",
    )


def test_apply_dedupe_keeps_distinct_low_slug_pairs():
    articles = [
        _art(
            "Při dronovém útoku na tržiště v Súdánu zahynulo pět lidí",
            url="https://news/a/sudan-trziste-dron-2026",
        ),
        _art(
            "Čtyři lidé zahynuli při ukrajinském útoku v Rjazani",
            url="https://news/b/rjazan-ukrajina-utok-2026",
        ),
        _art(
            "Americké síly vyřadily z provozu dva íránské ropné terminály",
            url="https://news/c/iran-terminaly-ropne",
        ),
        _art(
            "USA opět zaútočily na Írán. Příměří zůstává stále v nedohlednu",
            url="https://news/d/iran-primeri-usa-utok",
        ),
    ]
    visible, suppressed, stats = apply_topic_event_dedupe(
        articles,
        stable_section_fn=lambda s: s,
        story_match_fn=_weak_match,
        tokenize_fn=lambda t: set(t.lower().split()),
        score_fn=lambda a: str(a.get("publishedAt") or ""),
        url_fn=lambda a: a["url"],
    )
    assert len(visible) == 4
    assert len(suppressed) == 0
    assert stats["event_dedupe_low_slug_skip"] >= 0


def test_slug_jaccard_low_for_distinct_urls():
    j = slug_jaccard(
        "https://www.penize.cz/doprava/benzin-pondeli-kvetna",
        "https://www.penize.cz/finance/dane-priznani-2026",
    )
    assert j < 0.20


def test_true_duplicate_low_slug_still_merges_with_story_match():
    articles = [
        _art(
            "Sparta porazila Slavii 2:1 v derby",
            url="https://sport/a/sparta-slavia-2-1-derby",
        ),
        _art(
            "Sparta vyhrála nad Slavií 2:1",
            url="https://sport/b/slavia-sparta-vysledek",
        ),
    ]
    visible, suppressed, _stats = apply_topic_event_dedupe(
        articles,
        stable_section_fn=lambda s: s,
        story_match_fn=_always_match,
        tokenize_fn=lambda t: set(t.lower().split()),
        score_fn=lambda a: str(a.get("publishedAt") or ""),
        url_fn=lambda a: a["url"],
    )
    assert len(visible) == 1
    assert len(suppressed) == 1


def main() -> int:
    test_same_event_duplicate()
    test_follow_up_not_merged_as_duplicate()
    test_different_political_cases()
    test_different_sport_matches()
    test_outside_time_window()
    test_fix1_low_slug_no_story_match_blocks_merge()
    test_fix2_replay_guard_sudan_rjazan()
    test_fix2_replay_guard_iran_terminals()
    test_fix3_recurring_tax_vs_crypto()
    test_fix3_recurring_recap_different_days()
    test_apply_dedupe_keeps_distinct_low_slug_pairs()
    test_slug_jaccard_low_for_distinct_urls()
    test_true_duplicate_low_slug_still_merges_with_story_match()
    print("test_iu_topic_dedupe: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
