#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Guard: blocked Počasíčko / pocasicko (normalized) must not appear in exported public datasets."""

from __future__ import annotations

import json
import os
import sys

_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)
from iu_blocked_sources import iu_is_blocked_pocasicko_source

ROOT = os.path.dirname(_SCRIPTS_DIR)
DATA = os.path.join(ROOT, "projects", "data")


def _article_blob(it: object) -> str:
    if not isinstance(it, dict):
        return ""
    keys = (
        "title",
        "url",
        "section",
        "media_raw",
        "media_norm",
        "source",
        "sourceDisplay",
        "sourceKey",
        "channel",
        "contentType",
    )
    parts = [str(it.get(k) or "") for k in keys if k in it]
    return " ".join(parts)


def _video_blob(it: object) -> str:
    if not isinstance(it, dict):
        return ""
    keys = ("title", "channel", "url", "sourceKey", "sourceTitle")
    return " ".join(str(it.get(k) or "") for k in keys if k in it)


def _weather_blob(it: object) -> str:
    if not isinstance(it, dict):
        return ""
    keys = ("source", "title", "note", "id")
    blob = " ".join(str(it.get(k) or "") for k in keys)
    seo = it.get("seo")
    if isinstance(seo, dict):
        for k in ("h2", "intro", "body", "closing"):
            blob += " " + str(seo.get(k) or "")
        bul = seo.get("bullets")
        if isinstance(bul, list):
            blob += " " + " ".join(str(x) for x in bul)
    return blob


def main() -> int:
    bad: list[str] = []

    ap = os.path.join(DATA, "articles.json")
    if os.path.isfile(ap):
        with open(ap, "r", encoding="utf-8") as f:
            root = json.load(f)
        arts = root.get("articles") if isinstance(root, dict) else None
        if isinstance(arts, list):
            for i, it in enumerate(arts):
                if iu_is_blocked_pocasicko_source(_article_blob(it)):
                    bad.append(f"articles.json[{i}]")

    shard_dir = os.path.join(DATA, "articles")
    idxp = os.path.join(shard_dir, "index.json")
    files: list[str] = []
    if os.path.isfile(idxp):
        with open(idxp, "r", encoding="utf-8") as f:
            idx = json.load(f)
        days = idx.get("days") if isinstance(idx, dict) else None
        if isinstance(days, list):
            for day in days:
                files.append(os.path.join(shard_dir, f"{day}.json"))
    if not files and os.path.isdir(shard_dir):
        for name in os.listdir(shard_dir):
            if name.endswith(".json") and name != "index.json":
                files.append(os.path.join(shard_dir, name))

    for fp in files:
        if not os.path.isfile(fp):
            continue
        with open(fp, "r", encoding="utf-8") as f:
            sh = json.load(f)
        lst = sh.get("articles") if isinstance(sh, dict) else sh
        if not isinstance(lst, list):
            continue
        for i, it in enumerate(lst):
            if iu_is_blocked_pocasicko_source(_article_blob(it)):
                bad.append(f"{os.path.basename(fp)}[{i}]")

    vp = os.path.join(DATA, "videos.json")
    if os.path.isfile(vp):
        with open(vp, "r", encoding="utf-8") as f:
            vroot = json.load(f)
        vids = vroot.get("videos") if isinstance(vroot, dict) else None
        if isinstance(vids, list):
            for i, it in enumerate(vids):
                if iu_is_blocked_pocasicko_source(_video_blob(it)):
                    bad.append(f"videos.json[{i}]")

    wh = os.path.join(DATA, "weather_history_videos.json")
    if os.path.isfile(wh):
        with open(wh, "r", encoding="utf-8") as f:
            wroot = json.load(f)
        witems = wroot.get("items") if isinstance(wroot, dict) else None
        if isinstance(witems, list):
            for i, it in enumerate(witems):
                if iu_is_blocked_pocasicko_source(_weather_blob(it)):
                    bad.append(f"weather_history_videos.json[{i}]")

    if bad:
        print("FAIL pocasicko_guard hits:")
        for line in bad[:50]:
            print(line)
        if len(bad) > 50:
            print(f"... and {len(bad) - 50} more")
        return 1
    print("OK pocasicko_guard")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
