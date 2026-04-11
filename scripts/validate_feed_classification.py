#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Validate articles.json feed classification (optional CI / local audit).

Exit 0: schema OK, coverage meets threshold, or --skip-missing with no file.
Exit 1: missing classifications, low coverage, or invalid shapes.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load(path: str) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def validate_payload(data: dict[str, Any], min_coverage: float) -> tuple[bool, dict[str, Any]]:
    arts = data.get("articles")
    if not isinstance(arts, list):
        return False, {"error": "articles_not_list"}
    n = len(arts)
    ok = 0
    missing: list[str] = []
    low_conf: list[str] = []
    samples: dict[str, list[str]] = {}
    conflicts = 0
    for i, a in enumerate(arts):
        if not isinstance(a, dict):
            continue
        url = str(a.get("url") or "")[:120]
        cf = a.get("iuFeedClassification")
        if not isinstance(cf, dict) or cf.get("v") != 1:
            missing.append(url or f"idx:{i}")
            continue
        mk = cf.get("mediaTopicKey")
        if not mk:
            missing.append(url or f"idx:{i}")
            continue
        try:
            conf = float(cf.get("confidence") or 0)
        except Exception:
            conf = 0.0
        if conf < 0.5:
            low_conf.append(url or f"idx:{i}")
        ok += 1
        k = str(mk).lower()
        if k not in samples:
            samples[k] = []
        if len(samples[k]) < 3:
            samples[k].append(url)
        gfs = cf.get("guardFlags")
        if isinstance(gfs, list) and "topic_url_conflict" in gfs:
            conflicts += 1

    pct = (100.0 * ok / n) if n else 100.0
    report: dict[str, Any] = {
        "totalArticles": n,
        "withClassification": ok,
        "coveragePct": round(pct, 2),
        "missingCount": len(missing),
        "lowConfidenceCount": len(low_conf),
        "topicUrlConflictFlags": conflicts,
        "samplesByKey": samples,
    }
    if pct + 1e-6 < min_coverage:
        report["failReason"] = "coverage_below_min"
        return False, report
    if missing:
        report["failReason"] = "missing_classification"
        return False, report
    return True, report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--articles",
        default=os.path.join(ROOT, "projects", "data", "articles.json"),
        help="Path to articles.json",
    )
    ap.add_argument("--min-coverage", type=float, default=99.0)
    ap.add_argument(
        "--skip-missing",
        action="store_true",
        help="Exit 0 if file does not exist (for CI without data checkout).",
    )
    args = ap.parse_args()
    path = os.path.abspath(args.articles)
    if not os.path.isfile(path):
        if args.skip_missing:
            print(json.dumps({"status": "SKIP", "path": path}, ensure_ascii=False))
            return 0
        print(json.dumps({"status": "FAIL", "error": "file_not_found", "path": path}, ensure_ascii=False))
        return 1
    data = _load(path)
    if not isinstance(data, dict):
        print(json.dumps({"status": "FAIL", "error": "root_not_object"}, ensure_ascii=False))
        return 1
    ok, report = validate_payload(data, args.min_coverage)
    out = {"status": "PASS" if ok else "FAIL", **report}
    print(json.dumps(out, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
