#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fail if finance/zdravi rows still need URL-based remap (should be 0 after build_articles remap)."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from build_articles import remap_article_section_if_url_mismatch  # noqa: E402


def main() -> int:
    path = ROOT / "projects" / "data" / "articles.json"
    if not path.exists():
        print("[section-purity-guard] SKIP: no articles.json")
        return 0
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = data.get("articles") or []
    bad = 0
    for a in rows:
        if not isinstance(a, dict):
            continue
        b = remap_article_section_if_url_mismatch(a)
        if (b.get("topic") or "") != (a.get("topic") or "") or (b.get("section") or "") != (a.get("section") or ""):
            bad += 1
    if bad:
        print(f"[section-purity-guard] FAIL: {bad} articles still misclassified vs URL rules", file=sys.stderr)
        return 1
    print("[section-purity-guard] OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
