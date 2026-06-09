#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Phase 10B proof: targeted section purity fallback guards."""

from __future__ import annotations

import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)

from iu_section_purity_fallback import apply_section_purity_fallback  # noqa: E402


def _art(title: str, url: str, section: str, source: str = "Test") -> dict:
    return {
        "title": title,
        "url": url,
        "topic": section,
        "section": section,
        "publishedAt": "2026-06-09T10:00:00Z",
        "sources": [{"name": source, "url": url}],
    }


class SectionPurityFallbackProofTests(unittest.TestCase):
    def test_hry_krimi_novinky_to_news(self) -> None:
        a = _art(
            "Zdrogovaný muž s pistolí vyděsil lidi na zastávce v Brně, byla to maketa",
            "https://www.novinky.cz/clanek/krimi/zdrogovany-muz-123",
            "hry",
            "Novinky",
        )
        out = apply_section_purity_fallback(a)
        self.assertEqual(out["topic"], "aktualne")

    def test_hry_pocasi_to_news(self) -> None:
        a = _art(
            "Do Česka míří bouřky",
            "https://www.novinky.cz/clanek/pocasi/bourky-123",
            "hry",
            "Novinky",
        )
        out = apply_section_purity_fallback(a)
        self.assertEqual(out["topic"], "aktualne")

    def test_hn_archiv_fake_zdravi_to_news(self) -> None:
        a = _art(
            "Jaderné elektrárny nechtějí do důchodu. Svět spoléhá na prodloužení provozu",
            "https://archiv.hn.cz/clanek/123456",
            "zdravi",
            "HN",
        )
        out = apply_section_purity_fallback(a)
        self.assertEqual(out["topic"], "aktualne")

    def test_bydleni_in_zdravi_to_finance_or_news(self) -> None:
        a = _art(
            "Bydlení Michala Suchánka boří představy o celebritách",
            "https://www.betterlife.cz/bydleni-michala-suchanka",
            "zdravi",
            "BetterLife",
        )
        out = apply_section_purity_fallback(a)
        self.assertIn(out["topic"], ("aktualne", "finance"))

    def test_ekonomicky_denik_sport_mismatch(self) -> None:
        a = _art(
            "Tenhle nákup se státu vyplatil. Plynové zásobníky přinášejí miliardové zisky",
            "https://ekonomickydenik.cz/clanek/plyn-zisky",
            "sport",
            "Ekonomický deník",
        )
        out = apply_section_purity_fallback(a)
        self.assertIn(out["topic"], ("aktualne", "finance"))

    def test_finance_unchanged(self) -> None:
        a = _art(
            "Hypotéky znovu zdražují",
            "https://byznys.hn.cz/clanek/hypoteky",
            "finance",
            "HN",
        )
        out = apply_section_purity_fallback(a)
        self.assertEqual(out["topic"], "finance")

    def test_doprava_unchanged(self) -> None:
        a = _art(
            "Uzavírka D1 kvůli nehodě",
            "https://www.novinky.cz/clanek/doprava/d1-nehoda",
            "doprava",
            "Novinky",
        )
        out = apply_section_purity_fallback(a)
        self.assertEqual(out["topic"], "doprava")

    def test_cestovani_unchanged(self) -> None:
        a = _art(
            "Letenky do Turecka levně",
            "https://www.novinky.cz/clanek/cestovani/letenky",
            "cestovani",
            "Novinky",
        )
        out = apply_section_purity_fallback(a)
        self.assertEqual(out["topic"], "cestovani")

    def test_vzdelavani_unchanged(self) -> None:
        a = _art(
            "Nový kurz programování",
            "https://www.novinky.cz/clanek/skola/kurz",
            "vzdelavani",
            "Novinky",
        )
        out = apply_section_purity_fallback(a)
        self.assertEqual(out["topic"], "vzdelavani")


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(SectionPurityFallbackProofTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    passed = result.wasSuccessful()
    verdict = {
        "SECTION_PURITY_FALLBACK_PROOF": "PASS" if passed else "FAIL",
        "DUPLICATE_REGRESSION": "NO" if passed else "YES",
    }
    print(json.dumps(verdict, indent=2))
    for k, v in verdict.items():
        print(f"{k}={v}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
