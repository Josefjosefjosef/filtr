#!/usr/bin/env python3
"""
One-shot: remove hard-blocked domains (hedvabnastezka) from committed article JSON.
Uses same rules as scripts/iu_registry.py purge_blocked_articles.
"""
from __future__ import annotations

import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

from scripts.iu_registry import purge_blocked_articles  # noqa: E402

DATA = os.path.join(ROOT, "projects", "data")
ARTICLES_JSON = os.path.join(DATA, "articles.json")
SHARD_DIR = os.path.join(DATA, "articles")


def _write(path: str, obj) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def main() -> int:
    n_files = 0
    if os.path.isfile(ARTICLES_JSON):
        with open(ARTICLES_JSON, "r", encoding="utf-8") as f:
            payload = json.load(f)
        arts = payload.get("articles")
        if isinstance(arts, list):
            before = len(arts)
            payload["articles"] = purge_blocked_articles(arts)
            after = len(payload["articles"])
            _write(ARTICLES_JSON, payload)
            print(f"articles.json: {before} -> {after}")
            n_files += 1

    if os.path.isdir(SHARD_DIR):
        for name in sorted(os.listdir(SHARD_DIR)):
            if not name.endswith(".json"):
                continue
            path = os.path.join(SHARD_DIR, name)
            with open(path, "r", encoding="utf-8") as f:
                payload = json.load(f)
            items = payload.get("items")
            if not isinstance(items, list):
                items = payload.get("articles")
            if not isinstance(items, list):
                continue
            before = len(items)
            items2 = purge_blocked_articles(items)
            after = len(items2)
            if "items" in payload:
                payload["items"] = items2
            elif "articles" in payload:
                payload["articles"] = items2
            _write(path, payload)
            if before != after:
                print(f"{name}: {before} -> {after}")
            n_files += 1

    print(f"PURGE_FILES_TOUCHED={n_files}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
