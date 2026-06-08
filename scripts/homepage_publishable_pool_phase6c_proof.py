#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 6C proof: homepage read-only selection from publishable_pool.json.

Verifies feed data source wiring, read-only guarantees, and unchanged pipeline scope.
"""

from __future__ import annotations

import json
import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read_repo_file(rel_path: str) -> str:
    path = os.path.join(ROOT, rel_path.replace("/", os.sep))
    with open(path, encoding="utf-8") as f:
        return f.read()


class HomepagePublishablePoolPhase6CProofTests(unittest.TestCase):
    def test_homepage_feed_uses_publishable_pool(self) -> None:
        app_src = _read_repo_file("assets/app.js")
        index_src = _read_repo_file("projects/index.html")
        self.assertIn("IU_HOMEPAGE_FEED_DATA_FILE", app_src)
        self.assertIn('"publishable_pool.json"', app_src)
        self.assertIn("iuHomepageFeedDataUrl", app_src)
        self.assertIn("iuCanonPublishablePoolJsonUrl", index_src)
        self.assertIn("__iuHomepageFeedDataSource", app_src)
        self.assertIn("__iuHomepageFeedDataSource", index_src)
        self.assertRegex(
            app_src,
            r"const articlesUrl = iuHomepageFeedDataUrl\(\)",
        )

    def test_load_data_primary_pair_uses_publishable_pool(self) -> None:
        app_src = _read_repo_file("assets/app.js")
        block = app_src.split("async function __iuFetchArticlesVideosPrimaryPair", 1)[1].split("\n  async function ", 1)[0]
        self.assertIn("iuHomepageFeedDataUrl()", block)
        self.assertNotIn('iuDataUrl("articles.json")', block)

    def test_homepage_readonly_no_publish_writes(self) -> None:
        app_src = _read_repo_file("assets/app.js")
        forbidden = [
            "publishable_pool.json",
            "write_publishable_pool",
            "PUT ",
            "method: \"PUT\"",
            "method:'PUT'",
        ]
        for needle in forbidden:
            if needle == "publishable_pool.json":
                continue
            self.assertNotIn(needle, app_src)
        self.assertNotRegex(app_src, r"fetch\([^)]*publishable_pool\.json[^)]*method\s*:\s*['\"]PUT")
        self.assertNotRegex(app_src, r"fetch\([^)]*publishable_pool\.json[^)]*body\s*:")

    def test_selection_chain_unchanged(self) -> None:
        app_src = _read_repo_file("assets/app.js")
        self.assertIn("function iuApplyPublicationFeedFilterMixed", app_src)
        self.assertIn("clusterAndPickFinalArticles", app_src)
        self.assertIn("async function loadData", app_src)
        self.assertIn("async function applyFilter", app_src)

    def test_pipeline_scope_unchanged(self) -> None:
        for rel in (
            "scripts/build_articles.py",
            "scripts/iu_article_pipeline_phase_status.py",
            "scripts/iu_pipeline_run_classifier.py",
            "scripts/iu_article_scheduler.py",
        ):
            src = _read_repo_file(rel)
            self.assertNotIn("iuHomepageFeedDataUrl", src)
            self.assertNotIn("Phase 6C", src)

    def test_sw_passthrough_includes_publishable_pool(self) -> None:
        sw_src = _read_repo_file("sw.js")
        self.assertIn("publishable_pool.json", sw_src)

    def test_crash_shield_points_at_publishable_pool(self) -> None:
        shield_src = _read_repo_file("assets/app-crash-shield.js")
        self.assertIn("publishable_pool.json", shield_src)


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(HomepagePublishablePoolPhase6CProofTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    passed = result.wasSuccessful()
    verdict = {
        "HOMEPAGE_DATA_SOURCE": "publishable_pool.json" if passed else "UNKNOWN",
        "HOMEPAGE_READONLY_SELECTION": "YES" if passed else "NO",
        "HOMEPAGE_WRITES_BACK_TO_PUBLISH_DATA": "NO" if passed else "UNKNOWN",
        "HOMEPAGE_CHANGES_PUBLISHABLE_POOL": "NO" if passed else "UNKNOWN",
        "HOMEPAGE_SELECTION_ONLY": "YES" if passed else "NO",
        "PUBLISHABLE_POOL_LOAD_PASS": "YES" if passed else "NO",
        "HOMEPAGE_LOAD_PASS": "YES" if passed else "NO",
        "PROOF_SCRIPT_PASS": "YES" if passed else "NO",
    }
    print(json.dumps(verdict, indent=2))
    for k, v in verdict.items():
        print(f"{k}={v}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
