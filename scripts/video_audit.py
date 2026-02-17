#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Forensic audit for projects/data/videos.json.

Usage:
  python scripts/video_audit.py projects/data/videos.json
  python scripts/video_audit.py projects/data/videos.json --rev <git-rev>
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from typing import Any, Dict, List, Tuple


def _load_json_from_path(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _load_json_from_git(rev: str, path: str) -> Any:
    # git expects forward slashes even on Windows
    spec = f"{rev}:{path.replace('\\', '/')}"
    raw = subprocess.check_output(["git", "show", spec], stderr=subprocess.STDOUT)
    txt = raw.decode("utf-8", errors="replace")
    return json.loads(txt)


def _items_from_json(d: Any) -> List[Dict[str, Any]]:
    if isinstance(d, list):
        return [x for x in d if isinstance(x, dict)]
    if isinstance(d, dict):
        for k in ("videos", "items"):
            v = d.get(k)
            if isinstance(v, list):
                return [x for x in v if isinstance(x, dict)]
    return []


def _get(x: Dict[str, Any], *keys: str) -> str:
    for k in keys:
        v = x.get(k)
        if v is None:
            continue
        s = str(v).strip()
        if s:
            return s
    return ""


YTID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def _ytid(x: Dict[str, Any]) -> str:
    cand = _get(x, "videoId", "id")
    return cand if YTID_RE.match(cand) else ""


def _is_cs_like(x: Dict[str, Any]) -> bool:
    # Heuristic requested by task: look for CS/CZ hints across a few fields.
    lang = _get(x, "language", "lang", "langClass")
    title = _get(x, "title")
    channel = _get(x, "channelTitle", "channel", "sourceTitle")
    hay = f"{lang} {title} {channel}".lower()
    return ("cs" in hay) or ("czech" in hay) or ("česk" in hay) or ("cesk" in hay) or ("čt" in hay)


def _count_by(items: List[Dict[str, Any]], key: str) -> Counter:
    c = Counter()
    for x in items:
        c[_get(x, key) or "(missing)"] += 1
    return c


def _top(counter: Counter, n: int = 12) -> List[Tuple[str, int]]:
    return counter.most_common(n)


def main() -> int:
    # Windows consoles can be cp1250/cp1252; avoid crashing on emoji/diacritics.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # py3.7+
    except Exception:
        pass
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # py3.7+
    except Exception:
        pass

    ap = argparse.ArgumentParser()
    ap.add_argument("path", help="Path to videos.json (usually projects/data/videos.json)")
    ap.add_argument("--rev", default="", help="Optional git rev to load path from (uses git show)")
    args = ap.parse_args()

    try:
        data = _load_json_from_git(args.rev, args.path) if args.rev else _load_json_from_path(args.path)
    except Exception as e:
        print("ERROR: load_json_failed", str(e), file=sys.stderr)
        return 2

    items = _items_from_json(data)
    print("VIDEOS_JSON_TOTAL", len(items))

    ids = [_ytid(x) for x in items]
    missing_id = sum(1 for i in ids if not i)
    dup = len([i for i in ids if i]) - len(set([i for i in ids if i]))
    print("VIDEOS_JSON_MISSING_ID", missing_id)
    print("VIDEOS_JSON_DUPLICATE_ID", dup)

    lang = _count_by(items, "lang")
    lang_class = _count_by(items, "langClass")
    region = _count_by(items, "region")
    topic0 = Counter((_get(x, "topic") or (x.get("topics")[0] if isinstance(x.get("topics"), list) and x.get("topics") else "") or "(missing)") for x in items)
    has_thumb = sum(1 for x in items if _get(x, "thumb"))

    cz_exact = sum(1 for x in items if _get(x, "lang").lower() in ("cz", "cs") or _get(x, "region").lower() == "cz")
    cz_like = sum(1 for x in items if _is_cs_like(x))
    print("VIDEOS_JSON_CZ_EXACT", cz_exact)
    print("VIDEOS_JSON_CS_LIKE", cz_like)
    print("VIDEOS_JSON_WITH_THUMB", has_thumb)

    print("TOP_LANG", _top(lang))
    print("TOP_LANGCLASS", _top(lang_class))
    print("TOP_REGION", _top(region))
    print("TOP_TOPIC0", _top(topic0))

    cs_items = [x for x in items if _is_cs_like(x)]
    print("SAMPLE_CS_IDS_TITLES:")
    for x in cs_items[:20]:
        print("-", _ytid(x) or "(noid)", (_get(x, "title")[:90] or "(notitle)"))

    cz_items = [x for x in items if _get(x, "lang").lower() in ("cz", "cs") or _get(x, "region").lower() == "cz"]
    print("SAMPLE_CZ_EXACT_IDS_TITLES:")
    for x in cz_items[:20]:
        print("-", _ytid(x) or "(noid)", (_get(x, "title")[:90] or "(notitle)"))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

