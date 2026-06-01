#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Regression: jaccard/cluster_items must accept set vs list tokens (publish_queue JSON)."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from build_articles import cluster_items, jaccard  # noqa: E402


def test_jaccard_set_and_list():
    assert jaccard({"a", "b"}, ["b", "c"]) > 0.0


def test_jaccard_list_and_list():
    assert jaccard(["a", "b"], ["b", "c"]) > 0.0


def test_jaccard_tuple_and_set():
    assert jaccard(("a", "b"), {"b", "c"}) > 0.0


def test_jaccard_none_safe():
    assert jaccard(None, ["b"]) == 0.0
    assert jaccard(["a"], None) == 0.0


def test_cluster_items_set_vs_list_tokens_no_crash():
    dt = datetime(2026, 6, 2, 8, 0, tzinfo=timezone.utc)
    base = {
        "section": "aktualne",
        "contentType": "article",
        "dt": dt,
        "title": "Prezident jednal s premiérem o vládě",
        "url": "https://example.com/a",
        "media_raw": "Novinky",
        "media_norm": "novinky",
    }
    a = {**base, "tokens": {"prezident", "jednal", "premier", "vlade"}}
    b = {
        **base,
        "title": "Prezident se sešel s premiérem",
        "url": "https://example.com/b",
        "tokens": ["prezident", "sesel", "premier", "vlade"],
    }
    clusters = cluster_items([a, b])
    assert len(clusters) >= 1


def _run() -> None:
    test_jaccard_set_and_list()
    test_jaccard_list_and_list()
    test_jaccard_tuple_and_set()
    test_jaccard_none_safe()
    test_cluster_items_set_vs_list_tokens_no_crash()
    print("PASS test_build_articles_jaccard")


if __name__ == "__main__":
    _run()
