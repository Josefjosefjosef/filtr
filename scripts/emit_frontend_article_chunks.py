#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Emit section-scoped frontend article chunks from publishable_pool.json.

Read-only derivative of the publishable pool — does not alter pool, RSS, ingest,
dedupe, classification, or articles.json content.

Output: projects/data/article_feed_chunks/manifest.json
        projects/data/article_feed_chunks/{section}/{index:03d}.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_SCRIPTS)
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from iu_article_pool import read_publishable_pool  # noqa: E402
from iu_feed_classification import classify_media_topic_key  # noqa: E402

CHUNK_SIZE = 100
INITIAL_SIZE = 30
BUFFER_MAX = 100
SCHEMA_VERSION = 1
CHUNK_SECTION_KEYS = (
    "feed",
    "zpravy",
    "sport",
    "finance",
    "zdravi",
    "cestovani",
    "hry",
    "kultura",
    "veda",
    "vzdelavani",
)
SKIP_TOPIC_KEYS = frozenset({"tech", "bydleni"})


def _iso_sort_key(article: dict) -> str:
    return str(article.get("publishedAt") or "")


def _media_topic_key(article: dict) -> str:
    cf = article.get("iuFeedClassification")
    if isinstance(cf, dict) and cf.get("v") == 1 and cf.get("mediaTopicKey"):
        mk = str(cf["mediaTopicKey"]).strip().lower()
        if mk:
            return mk
    mk, _, _, _ = classify_media_topic_key(article)
    return str(mk or "zpravy").strip().lower() or "zpravy"


def _atomic_write_json(path: str, payload: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    os.replace(tmp, path)


def _bucket_articles(articles: list[dict]) -> dict[str, list[dict]]:
    buckets: dict[str, list[dict]] = {k: [] for k in CHUNK_SECTION_KEYS}
    feed_all: list[dict] = []
    for raw in articles:
        if not isinstance(raw, dict):
            continue
        mk = _media_topic_key(raw)
        if mk in SKIP_TOPIC_KEYS:
            continue
        feed_all.append(raw)
        if mk in buckets:
            buckets[mk].append(raw)
        elif mk == "zpravy":
            buckets["zpravy"].append(raw)
    feed_all.sort(key=_iso_sort_key, reverse=True)
    buckets["feed"] = feed_all
    for key in CHUNK_SECTION_KEYS:
        if key == "feed":
            continue
        buckets[key].sort(key=_iso_sort_key, reverse=True)
    return buckets


def emit_chunks(output_dir: str) -> dict:
    pool = read_publishable_pool(output_dir)
    if pool is None:
        raise SystemExit(f"ERROR: missing publishable_pool.json in {output_dir}")
    articles = [a for a in (pool.get("articles") or []) if isinstance(a, dict)]
    if not articles:
        raise SystemExit("ERROR: publishable_pool has no articles")

    generated_at = str(pool.get("generatedAt") or "").strip()
    buckets = _bucket_articles(articles)
    chunk_root = os.path.join(output_dir, "article_feed_chunks")
    url_prefix = "article_feed_chunks"
    sections_meta: dict[str, dict] = {}

    for section_key in CHUNK_SECTION_KEYS:
        rows = buckets.get(section_key) or []
        section_dir = os.path.join(chunk_root, section_key)
        os.makedirs(section_dir, exist_ok=True)
        if os.path.isdir(section_dir):
            for fn in os.listdir(section_dir):
                if re.match(r"^(init|\d{3})\.json$", fn):
                    try:
                        os.remove(os.path.join(section_dir, fn))
                    except OSError:
                        pass
        chunk_paths: list[str] = []
        init_rel = f"{url_prefix}/{section_key}/init.json"
        init_rows = rows[:INITIAL_SIZE]
        _atomic_write_json(
            os.path.join(section_dir, "init.json"),
            {
                "schemaVersion": SCHEMA_VERSION,
                "sectionKey": section_key,
                "chunkIndex": -1,
                "chunkSize": INITIAL_SIZE,
                "articleCount": len(init_rows),
                "totalInSection": len(rows),
                "generatedAt": generated_at,
                "poolGeneratedAt": generated_at,
                "articles": init_rows,
            },
        )
        for idx in range(0, len(rows), CHUNK_SIZE):
            chunk_index = idx // CHUNK_SIZE
            chunk_rows = rows[idx : idx + CHUNK_SIZE]
            rel_path = f"{url_prefix}/{section_key}/{chunk_index:03d}.json"
            chunk_paths.append(rel_path)
            payload = {
                "schemaVersion": SCHEMA_VERSION,
                "sectionKey": section_key,
                "chunkIndex": chunk_index,
                "chunkSize": CHUNK_SIZE,
                "articleCount": len(chunk_rows),
                "totalInSection": len(rows),
                "generatedAt": generated_at,
                "poolGeneratedAt": generated_at,
                "articles": chunk_rows,
            }
            _atomic_write_json(os.path.join(section_dir, f"{chunk_index:03d}.json"), payload)
        sections_meta[section_key] = {
            "totalArticles": len(rows),
            "chunkCount": len(chunk_paths),
            "chunkSize": CHUNK_SIZE,
            "initChunk": init_rel,
            "initSize": INITIAL_SIZE,
            "bufferMax": BUFFER_MAX,
            "chunks": chunk_paths,
        }

    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": generated_at,
        "poolGeneratedAt": generated_at,
        "sourcePool": "publishable_pool.json",
        "initialSize": INITIAL_SIZE,
        "bufferMax": BUFFER_MAX,
        "loadMoreSize": CHUNK_SIZE,
        "chunkSize": CHUNK_SIZE,
        "sections": sections_meta,
    }
    manifest_path = os.path.join(chunk_root, "manifest.json")
    _atomic_write_json(manifest_path, manifest)

    return {
        "manifest_path": manifest_path,
        "pool_articles": len(articles),
        "sections": {k: sections_meta[k]["totalArticles"] for k in CHUNK_SECTION_KEYS},
        "chunk_files": sum(sections_meta[k]["chunkCount"] for k in CHUNK_SECTION_KEYS),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Emit frontend article feed chunks from publishable pool")
    parser.add_argument(
        "--output-dir",
        default=os.path.join(_ROOT, "projects", "data"),
        help="Directory containing publishable_pool.json",
    )
    args = parser.parse_args()
    summary = emit_chunks(args.output_dir)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
