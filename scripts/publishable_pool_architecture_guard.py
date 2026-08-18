#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 7A: publishable pool architecture integrity guard.

Protects the separation between publishable_pool.json (publish data) and homepage
read-only selection. Code/architecture regressions are hard failures; missing or
stale committed data files emit WARN and do not block release.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, os.path.join(ROOT, "scripts"))

from iu_article_pool import (  # noqa: E402
    ARCHITECTURE_VERSION,
    HOMEPAGE_FEED_DATA_SOURCE,
    HOMEPAGE_READONLY_SELECTION,
    PUBLISHABLE_POOL_NAME,
    count_articles_json_total,
    count_publishable_pool_articles,
    read_articles_json,
    read_publishable_pool,
    validate_publishable_pool_schema,
)


def _read_repo_file(rel_path: str) -> str:
    path = os.path.join(ROOT, rel_path.replace("/", os.sep))
    with open(path, encoding="utf-8") as f:
        return f.read()


def check_homepage_source_code() -> list[str]:
    """Hard architecture checks: homepage must read publishable pool, not articles.json."""
    errors: list[str] = []
    app_src = _read_repo_file("assets/app.js")
    feed_path = os.path.join(ROOT, "assets", "iu-app-feed-pipeline-v1.js")
    if os.path.isfile(feed_path):
        with open(feed_path, encoding="utf-8") as f:
            app_src = app_src + "\n" + f.read()
    index_src = _read_repo_file("projects/index.html")

    required_app = (
        "IU_HOMEPAGE_FEED_DATA_FILE",
        "iuHomepageFeedDataUrl",
        "__iuHomepageFeedDataSource",
        "iuUseChunkedArticleLoader",
    )
    for needle in required_app:
        if needle not in app_src:
            errors.append(f"assets/app.js missing homepage feed marker: {needle}")

    if '"publishable_pool.json"' not in app_src and "article_feed_chunks/manifest.json" not in app_src:
        errors.append("assets/app.js must reference publishable_pool.json or article_feed_chunks manifest")

    pair_block = app_src.split("async function __iuFetchArticlesVideosPrimaryPair", 1)
    if len(pair_block) < 2:
        errors.append("assets/app.js missing __iuFetchArticlesVideosPrimaryPair")
    else:
        block = pair_block[1].split("\n  async function ", 1)[0]
        if "iuHomepageFeedDataUrl()" not in block and "iuUseChunkedArticleLoader()" not in block:
            errors.append("primary feed pair must use chunked loader or iuHomepageFeedDataUrl()")
        if 'iuDataUrl("articles.json")' in block:
            errors.append("primary feed pair must not fetch articles.json")

    load_block = app_src.split("async function loadData", 1)
    if len(load_block) >= 2:
        block = load_block[1].split("\n  async function ", 1)[0]
        if "iuHomepageFeedDataUrl()" not in block:
            errors.append("loadData must use iuHomepageFeedDataUrl() for feed fetch")

    if "iuCanonPublishablePoolJsonUrl" not in index_src and "iuCanonChunkManifestUrl" not in index_src:
        errors.append("projects/index.html missing iuCanonPublishablePoolJsonUrl or iuCanonChunkManifestUrl")
    if "__iuHomepageFeedDataSource" not in index_src:
        errors.append("projects/index.html missing __iuHomepageFeedDataSource")

    if re.search(r'iuDataUrl\("articles\.json"\).*__iuFetchArticlesVideosPrimaryPair', app_src, re.S):
        errors.append("articles.json wired into primary feed fetch path")

    if re.search(
        r"fetch\([^)]*publishable_pool\.json[^)]*method\s*:\s*['\"]PUT",
        app_src,
        re.I,
    ):
        errors.append("homepage must not PUT publishable_pool.json")

    return errors


def check_data_artifacts(data_dir: str, *, strict_data: bool) -> tuple[list[str], list[str]]:
    """Return (hard_errors, warnings). Data issues are warnings unless strict_data."""
    hard: list[str] = []
    warn: list[str] = []

    pool_path = os.path.join(data_dir, PUBLISHABLE_POOL_NAME)
    articles_path = os.path.join(data_dir, "articles.json")

    pool = read_publishable_pool(data_dir)
    articles = read_articles_json(data_dir)

    if not os.path.isfile(pool_path):
        warn.append(f"missing {PUBLISHABLE_POOL_NAME} (data not in repo checkout — OK for release guard)")
    if not os.path.isfile(articles_path):
        warn.append("missing articles.json (data not in repo checkout — OK for release guard)")

    if pool is None and os.path.isfile(pool_path):
        msg = f"{PUBLISHABLE_POOL_NAME} exists but is not readable JSON"
        (hard if strict_data else warn).append(msg)

    if articles is None and os.path.isfile(articles_path):
        msg = "articles.json exists but is not readable JSON"
        (hard if strict_data else warn).append(msg)

    if pool is not None:
        schema_errors = validate_publishable_pool_schema(pool)
        for err in schema_errors:
            msg = f"publishable_pool schema: {err}"
            (hard if strict_data else warn).append(msg)

    if pool is not None and articles is not None:
        pool_total = count_publishable_pool_articles(pool)
        articles_total = count_articles_json_total(articles)
        if pool_total < articles_total:
            msg = (
                f"PUBLISHABLE_POOL_TOTAL ({pool_total}) < ARTICLES_JSON_TOTAL ({articles_total})"
            )
            (hard if strict_data else warn).append(msg)

    manifest_path = os.path.join(data_dir, "article_pool_manifest.json")
    if os.path.isfile(manifest_path):
        try:
            with open(manifest_path, encoding="utf-8") as f:
                manifest = json.load(f)
            if isinstance(manifest, dict):
                for key in (
                    "ARCHITECTURE_VERSION",
                    "HOMEPAGE_DATA_SOURCE",
                    "HOMEPAGE_READONLY_SELECTION",
                ):
                    if key not in manifest:
                        warn.append(f"article_pool_manifest missing {key}")
                if manifest.get("HOMEPAGE_DATA_SOURCE") not in (
                    HOMEPAGE_FEED_DATA_SOURCE,
                    None,
                ):
                    msg = (
                        "article_pool_manifest HOMEPAGE_DATA_SOURCE="
                        f"{manifest.get('HOMEPAGE_DATA_SOURCE')!r}"
                    )
                    (hard if strict_data else warn).append(msg)
        except Exception as exc:
            warn.append(f"article_pool_manifest unreadable: {exc}")

    return hard, warn


def run_guard(*, data_dir: str, strict_data: bool) -> int:
    code_errors = check_homepage_source_code()
    data_hard, data_warn = check_data_artifacts(data_dir, strict_data=strict_data)

    all_hard = code_errors + data_hard
    status = "PASS"
    if all_hard:
        status = "FAIL"
    elif data_warn:
        status = "WARN"

    print(f"ARCHITECTURE_VERSION={ARCHITECTURE_VERSION}")
    print(f"HOMEPAGE_DATA_SOURCE={HOMEPAGE_FEED_DATA_SOURCE}")
    print(f"HOMEPAGE_READONLY_SELECTION={HOMEPAGE_READONLY_SELECTION}")
    print(f"ARCHITECTURE_GUARD_STATUS={status}")

    if code_errors:
        print("ARCHITECTURE_CODE_ERRORS:")
        for err in code_errors:
            print(f" - {err}")

    if data_hard:
        print("ARCHITECTURE_DATA_ERRORS:")
        for err in data_hard:
            print(f" - {err}")

    if data_warn:
        print("ARCHITECTURE_DATA_WARNINGS:")
        for err in data_warn:
            print(f" - {err}")

    if all_hard:
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 7A publishable pool architecture guard")
    parser.add_argument(
        "--data-dir",
        default=os.path.join(ROOT, "projects", "data"),
        help="Data directory (default: projects/data)",
    )
    parser.add_argument(
        "--strict-data",
        action="store_true",
        help="Treat missing/invalid data artifacts as hard failures (proof/local audit)",
    )
    args = parser.parse_args()
    return run_guard(data_dir=args.data_dir, strict_data=args.strict_data)


if __name__ == "__main__":
    raise SystemExit(main())
