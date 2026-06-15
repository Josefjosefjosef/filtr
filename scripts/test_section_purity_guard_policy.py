#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Policy tests: section purity guard must not block release under PUBLISH_ALWAYS."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from section_purity_guard import evaluate_section_purity, main  # noqa: E402

GUARD = os.path.join(_SCRIPTS, "section_purity_guard.py")


def _art(title: str, url: str, section: str, source: str = "Test") -> dict:
    return {
        "id": f"id-{hash(url) & 0xffff}",
        "title": title,
        "url": url,
        "topic": section,
        "section": section,
        "source": source,
        "publishedAt": "2026-06-15T10:00:00Z",
    }


def _finance_news_mismatch() -> dict:
    return _art(
        "Domácí zprávy z regionu",
        "https://www.seznamzpravy.cz/clanek/domaci/zpravy-region-123",
        "finance",
        "Seznam Zprávy",
    )


def _run_guard(articles_path: str, *, policy: str = "PUBLISH_ALWAYS") -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["ARTICLES_JSON_PATH"] = articles_path
    env["SECTION_PURITY_POLICY"] = policy
    env.pop("GITHUB_OUTPUT", None)
    env.pop("GITHUB_STEP_SUMMARY", None)
    return subprocess.run(
        [sys.executable, GUARD],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )


class SectionPurityGuardPolicyTests(unittest.TestCase):
    def _pool_with_misclassified(self, bad_count: int, good_count: int) -> list[dict]:
        good = _art("Sportovní přehled", "https://sport.cz/clanek/base", "sport")
        arts = []
        for i in range(good_count):
            row = dict(good)
            row["url"] = f"https://sport.cz/clanek/good-{i}"
            row["id"] = f"good-{i}"
            arts.append(row)
        for i in range(bad_count):
            row = _finance_news_mismatch()
            row["url"] = f"https://www.seznamzpravy.cz/clanek/domaci/zpravy-{i}"
            row["id"] = f"bad-{i}"
            arts.append(row)
        return arts

    def test_one_misclassified_warn_exit_zero(self) -> None:
        arts = self._pool_with_misclassified(1, 999)
        report = evaluate_section_purity(arts)
        self.assertEqual(report["status"], "WARN")
        self.assertEqual(report["severity"], "WARN_ONLY")
        self.assertFalse(report["blocking"])

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "articles.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump({"articles": arts}, handle)
            run = _run_guard(path)
            out = f"{run.stdout}{run.stderr}"
            self.assertEqual(run.returncode, 0, out)
            self.assertIn("SECTION_PURITY_STATUS=WARN", out)
            self.assertIn("SECTION_PURITY_BLOCKING=NO", out)
            self.assertIn("RELEASE_CONTINUES=YES", out)
            self.assertIn("RESULT=PASS_WITH_WARN", out)

    def test_ten_misclassified_warn_only_exit_zero(self) -> None:
        arts = self._pool_with_misclassified(10, 990)
        report = evaluate_section_purity(arts)
        self.assertEqual(report["status"], "WARN")
        self.assertEqual(report["severity"], "WARN_ONLY")

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "articles.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump({"articles": arts}, handle)
            run = _run_guard(path)
            self.assertEqual(run.returncode, 0)
            self.assertIn("SECTION_PURITY_STATUS=WARN", run.stdout)

    def test_eleven_misclassified_incident_warning_exit_zero(self) -> None:
        arts = self._pool_with_misclassified(11, 989)
        report = evaluate_section_purity(arts)
        self.assertEqual(report["status"], "INCIDENT_WARNING")
        self.assertEqual(report["severity"], "INCIDENT_WARNING")

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "articles.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump({"articles": arts}, handle)
            run = _run_guard(path)
            out = f"{run.stdout}{run.stderr}"
            self.assertEqual(run.returncode, 0, out)
            self.assertIn("SECTION_PURITY_STATUS=INCIDENT_WARNING", out)
            self.assertIn("INCIDENT:", out)
            self.assertIn("RELEASE_CONTINUES=YES", out)

    def test_ratio_over_one_percent_incident_warning_exit_zero(self) -> None:
        bad = _finance_news_mismatch()
        good = _art("Sportovní přehled", "https://sport.cz/clanek/1", "sport")
        arts = [good] * 98 + [bad, bad]
        report = evaluate_section_purity(arts, warn_count=100, warn_ratio=0.01)
        self.assertEqual(report["status"], "INCIDENT_WARNING")
        self.assertGreater(report["misclassifiedRatio"], 0.01)

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "articles.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump({"articles": arts}, handle)
            env = os.environ.copy()
            env["ARTICLES_JSON_PATH"] = path
            env["SECTION_PURITY_POLICY"] = "PUBLISH_ALWAYS"
            env["SECTION_PURITY_WARN_COUNT"] = "100"
            run = subprocess.run(
                [sys.executable, GUARD],
                capture_output=True,
                text=True,
                env=env,
                check=False,
            )
            self.assertEqual(run.returncode, 0)
            self.assertIn("SECTION_PURITY_STATUS=INCIDENT_WARNING", run.stdout)

    def test_valid_data_with_one_bad_does_not_fail_main(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "articles.json"
            path.write_text(
                json.dumps({"articles": [_finance_news_mismatch(), _art("Ok", "https://sport.cz/a", "sport")]}),
                encoding="utf-8",
            )
            env = os.environ.copy()
            env["ARTICLES_JSON_PATH"] = str(path)
            env["SECTION_PURITY_POLICY"] = "PUBLISH_ALWAYS"
            code = subprocess.run([sys.executable, GUARD], env=env, check=False).returncode
            self.assertEqual(code, 0)

    def test_technical_error_reported_exit_zero(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "articles.json")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write("{not-json")
            run = _run_guard(path)
            out = f"{run.stdout}{run.stderr}"
            self.assertEqual(run.returncode, 0, out)
            self.assertIn("GUARD_TECHNICAL_ERROR=YES", out)
            self.assertIn("SECTION_PURITY_STATUS=TECHNICAL_ERROR", out)
            self.assertIn("RELEASE_CONTINUES=YES", out)

    def test_strict_mode_still_blocks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "articles.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump({"articles": [_finance_news_mismatch()]}, handle)
            run = _run_guard(path, policy="STRICT")
            out = f"{run.stdout}{run.stderr}"
            self.assertEqual(run.returncode, 1, out)
            self.assertIn("RESULT=FAIL", out)


if __name__ == "__main__":
    unittest.main()
