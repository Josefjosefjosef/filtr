#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Phase 10B before/after section purity audit."""

from __future__ import annotations

import json
import os
import sys

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_SCRIPTS)
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from section_purity_diagnostic import analyze_pool, load_pool  # noqa: E402

OUT = os.path.join(_ROOT, "reports", "section_purity_phase10b.json")


def _pick(report: dict) -> dict:
    ss = report.get("section_stats") or {}
    return {
        "SECTION_PURITY_OVERALL_SCORE": report.get("SECTION_PURITY_OVERALL_SCORE"),
        "WORST_SECTION": report.get("WORST_SECTION"),
        "WORST_SECTION_WRONG_RATE": report.get("WORST_SECTION_WRONG_RATE"),
        "SHOULD_FALLBACK_TO_NEWS_COUNT": report.get("SHOULD_FALLBACK_TO_NEWS_COUNT"),
        "TRUE_SECTION_BUG_COUNT": report.get("TRUE_SECTION_BUG_COUNT"),
        "LOW_CONFIDENCE_SPECIALIZED_COUNT": report.get("LOW_CONFIDENCE_SPECIALIZED_COUNT"),
        "kultura_wrong_rate": round((ss.get("kultura") or {}).get("suspected_wrong_section_rate", 0) * 100, 2),
        "hry_wrong_rate": round((ss.get("hry") or {}).get("suspected_wrong_section_rate", 0) * 100, 2),
        "zdravi_wrong_rate": round((ss.get("zdravi") or {}).get("suspected_wrong_section_rate", 0) * 100, 2),
        "sport_wrong_rate": round((ss.get("sport") or {}).get("suspected_wrong_section_rate", 0) * 100, 2),
        "bydleni_misplaced": (report.get("BYDLENI_DIAGNOSTIC") or {}).get(
            "misplaced_in_specialized_sections", 0
        ),
    }


def main() -> int:
    pool = load_pool(
        os.path.join(_ROOT, "projects", "data", "publishable_pool.json"),
        None,
    )
    before = analyze_pool(pool, apply_guard=False)
    after = analyze_pool(pool, apply_guard=True)
    delta = {}
    b = _pick(before)
    a = _pick(after)
    for key in b:
        bv = b[key]
        av = a[key]
        if isinstance(bv, (int, float)) and isinstance(av, (int, float)):
            delta[key] = round(float(av) - float(bv), 2)
        else:
            delta[key] = {"before": bv, "after": av}

    report = {
        "phase": "10B",
        "pool_generatedAt": pool.get("generatedAt"),
        "BEFORE": b,
        "AFTER": a,
        "DELTA": delta,
        "PHASE_10B_STATUS": "HOTOVO" if a["SECTION_PURITY_OVERALL_SCORE"] >= b["SECTION_PURITY_OVERALL_SCORE"] else "NEHOTOVO",
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
