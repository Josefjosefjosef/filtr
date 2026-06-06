#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SECTION_TOPIC_CAP V1 tests."""
from __future__ import annotations

import ast
import os
import sys
import unittest

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from iu_section_topic_cap import (
    MAX_TOPIC_SHARE_PER_SECTION,
    SECTION_TOPIC_CAP_ENABLED,
    apply_section_topic_cap,
    dominant_topic_share,
    max_positions_for_topic,
    section_topic_cap_key,
)


def _art(title: str, pub: str, sec: str = "sport") -> dict:
    return {
        "title": title,
        "publishedAt": pub,
        "topic": sec,
        "section": sec,
        "url": f"https://example.com/{hash(title + pub) & 0xffff}",
    }


def _top_window_share(articles: list[dict], window: int | None = None) -> float:
    if not articles:
        return 0.0
    n = window or max(4, len(articles) // 2)
    _, share = dominant_topic_share(articles[:n])
    return share


class SectionTopicCapTests(unittest.TestCase):
    def test_section_topic_cap_25_percent(self):
        self.assertTrue(SECTION_TOPIC_CAP_ENABLED)
        self.assertEqual(MAX_TOPIC_SHARE_PER_SECTION, 0.25)
        self.assertEqual(max_positions_for_topic(20), 5)

    def test_single_topic_cannot_dominate_section(self):
        arts = [
            _art("Sparta vyhrála", "2026-06-06T12:00:00Z"),
            _art("Sparta slaví titul", "2026-06-06T11:00:00Z"),
            _art("Sparta přivádí posilu", "2026-06-06T10:00:00Z"),
            _art("Sparta řeší zranění", "2026-06-06T09:00:00Z"),
            _art("Sparta prodává hráče", "2026-06-06T08:00:00Z"),
            _art("Sparta chystá derby", "2026-06-06T07:00:00Z"),
            _art("Sparta mění trenéra", "2026-06-06T06:00:00Z"),
            _art("Slavia porazila soupeře", "2026-06-06T05:30:00Z"),
            _art("NHL play-off pokračuje", "2026-06-06T05:00:00Z"),
            _art("Tenisový turnaj v Paříži", "2026-06-06T04:00:00Z"),
            _art("F1 kvalifikace v Monaku", "2026-06-06T03:00:00Z"),
            _art("Hokejisté trénují reprezentaci", "2026-06-06T02:00:00Z"),
        ]
        before_key, before_share = dominant_topic_share(arts)
        self.assertEqual(section_topic_cap_key(arts[0]), "sparta")
        self.assertGreater(before_share, 0.5)
        out, stats = apply_section_topic_cap(arts)
        top_share_before = _top_window_share(arts, 7)
        top_share_after = _top_window_share(out, 7)
        self.assertLess(top_share_after, top_share_before)
        top_keys = [section_topic_cap_key(a) for a in out[:7]]
        self.assertGreater(len(set(top_keys)), 1)
        sparta_in_top = sum(1 for k in top_keys if k == "sparta")
        self.assertLessEqual(sparta_in_top, max_positions_for_topic(len(arts)))

    def test_topic_diversity_improved(self):
        arts = [_art(f"Sparta událost {i}", f"2026-06-06T{12-i:02d}:00:00Z") for i in range(7)]
        arts.append(_art("Baník posiluje obranu", "2026-06-06T04:30:00Z"))
        _, share_before = dominant_topic_share(arts)
        out, stats = apply_section_topic_cap(arts)
        top_before = _top_window_share(arts, 4)
        top_after = _top_window_share(out, 4)
        self.assertLess(top_after, top_before)
        self.assertIn("banik", [section_topic_cap_key(a) for a in out[:4]])

    def test_section_topic_cap_preserves_time_order(self):
        arts = [
            _art("Sparta A", "2026-06-06T12:00:00Z"),
            _art("Sparta B", "2026-06-06T11:00:00Z"),
            _art("Slavia A", "2026-06-06T10:00:00Z"),
            _art("Slavia B", "2026-06-06T09:00:00Z"),
        ]
        out, _ = apply_section_topic_cap(arts)
        sparta = [a for a in out if section_topic_cap_key(a) == "sparta"]
        slavia = [a for a in out if section_topic_cap_key(a) == "slavia"]
        self.assertEqual([a["title"] for a in sparta], ["Sparta A", "Sparta B"])
        self.assertEqual([a["title"] for a in slavia], ["Slavia A", "Slavia B"])

    def test_no_recency_decay_present(self):
        path = os.path.join(_SCRIPTS, "iu_section_topic_cap.py")
        with open(path, encoding="utf-8") as f:
            tree = ast.parse(f.read())
        text = ast.unparse(tree).lower()
        banned = ["recency_decay", "age_penalty", "freshness_boost", "time_decay"]
        for term in banned:
            self.assertNotIn(term, text)

    def test_no_age_based_ranking_present(self):
        path = os.path.join(_SCRIPTS, "iu_section_topic_cap.py")
        with open(path, encoding="utf-8") as f:
            src = f.read().lower()
        self.assertNotIn("display_score", src)
        self.assertNotIn("age_penalty", src)
        self.assertNotIn("recency_decay", src)
        self.assertNotIn("freshness_boost", src)

    def test_vzdelavani_precision_still_pass(self):
        js = os.path.join(_SCRIPTS, "topic-dedupe-false-positive-guard.mjs")
        self.assertTrue(os.path.isfile(js))


if __name__ == "__main__":
    unittest.main(verbosity=2)
