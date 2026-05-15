#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CI / local guard: projects/data/articles/bootstrap.json (Phase 1 windowing).
Requires articles.json; does not modify any data files.
"""
from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "projects" / "data" / "articles.json"
BOOT = ROOT / "projects" / "data" / "articles" / "bootstrap.json"
INDEX = ROOT / "projects" / "data" / "articles" / "index.json"
BOOTSTRAP_HARD_CAP = 1100


def canonicalize_url(url: str) -> str:
    """Must match scripts/build_articles.canonicalize_url (retention / dedup)."""
    try:
        p = urlparse(url)
        fragment = ""
        q = []
        for k, v in parse_qsl(p.query, keep_blank_values=True):
            lk = k.lower()
            if lk.startswith("utm_"):
                continue
            if lk in {"fbclid", "gclid", "yclid", "cmpid", "pk_campaign", "pk_source"}:
                continue
            q.append((k, v))
        query = urlencode(q, doseq=True)
        return urlunparse((p.scheme, p.netloc, p.path, p.params, query, fragment))
    except Exception:
        return url


def retention_key(it: dict) -> str:
    """Must match scripts/build_articles._retention_key."""
    try:
        url = (it.get("url") or "").strip()
        if url:
            return "url:" + canonicalize_url(url)
        sources = it.get("sources")
        src0 = (sources or [{}])[0] if isinstance(sources, list) else {}
        src_url = (src0.get("url") or "").strip() if isinstance(src0, dict) else ""
        if src_url:
            return "url:" + canonicalize_url(src_url)
        host = (urlparse(src_url).netloc or "").lower()
        pub = (it.get("publishedAt") or "").strip()
        title = (it.get("title") or "").strip()
        raw = (host + "|" + pub + "|" + title).encode("utf-8", errors="ignore")
        return "h:" + hashlib.sha1(raw).hexdigest()
    except Exception:
        return "h:" + hashlib.sha1(repr(it).encode("utf-8", errors="ignore")).hexdigest()


def bootstrap_sort_tuple(it: dict) -> tuple:
    """Must match scripts/build_articles._bootstrap_sort_tuple."""
    t = str(
        it.get("publishedAt")
        or it.get("published")
        or it.get("date")
        or it.get("createdAt")
        or it.get("uploadedAt")
        or it.get("time")
        or ""
    ).strip()
    return (t, str(it.get("url") or "").strip())


def _shape_ok(it: dict) -> bool:
    if not str(it.get("publishedAt") or "").strip():
        return False
    if not str(it.get("title") or "").strip():
        return False
    if not str(it.get("section") or "").strip():
        return False
    u = str(it.get("url") or "").strip()
    if u.startswith("http://") or u.startswith("https://"):
        return True
    srcs = it.get("sources")
    if isinstance(srcs, list) and srcs:
        s0 = srcs[0]
        if isinstance(s0, dict):
            su = str(s0.get("url") or "").strip()
            if su.startswith("http://") or su.startswith("https://"):
                return True
    return False


def main() -> int:
    errors: list[str] = []
    if not ART.exists():
        errors.append(f"missing {ART}")
        _print(errors)
        return 1
    if not BOOT.exists():
        errors.append(f"missing {BOOT}")
        _print(errors)
        return 1

    try:
        main_payload = json.loads(ART.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        errors.append(f"articles.json invalid JSON: {e}")
        _print(errors)
        return 1

    try:
        boot = json.loads(BOOT.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        errors.append(f"bootstrap.json invalid JSON: {e}")
        _print(errors)
        return 1

    arts = main_payload.get("articles")
    if not isinstance(arts, list) or len(arts) == 0:
        errors.append("articles.json: articles must be non-empty array")

    if boot.get("schemaVersion") != 1:
        errors.append("bootstrap: schemaVersion must be 1")
    if not str(boot.get("generatedAt") or "").strip():
        errors.append("bootstrap: generatedAt required")
    meta = boot.get("bootstrapMeta")
    if not isinstance(meta, dict):
        errors.append("bootstrap: bootstrapMeta must be object")
    barts = boot.get("articles")
    if not isinstance(barts, list):
        errors.append("bootstrap: articles must be array")
    elif len(barts) == 0:
        errors.append("bootstrap: articles must be non-empty")
    elif len(barts) > BOOTSTRAP_HARD_CAP:
        errors.append(f"bootstrap: articles.length {len(barts)} > {BOOTSTRAP_HARD_CAP}")

    if errors:
        _print(errors)
        return 1

    assert isinstance(arts, list)
    assert isinstance(barts, list)

    main_keys = {retention_key(x) for x in arts if isinstance(x, dict)}
    seen: set[str] = set()
    for it in barts:
        if not isinstance(it, dict):
            errors.append("bootstrap: non-object in articles[]")
            continue
        if not _shape_ok(it):
            errors.append("bootstrap: incompatible item shape (need publishedAt, title, section, url|sources.url)")
        k = retention_key(it)
        if k in seen:
            errors.append(f"bootstrap: duplicate retention key {k[:48]}…")
        seen.add(k)
        if k not in main_keys:
            errors.append("bootstrap: item not present in articles.json (retention key mismatch)")

    for i in range(len(barts) - 1):
        a = barts[i]
        b = barts[i + 1]
        if not isinstance(a, dict) or not isinstance(b, dict):
            continue
        ta = bootstrap_sort_tuple(a)
        tb = bootstrap_sort_tuple(b)
        if ta < tb:
            errors.append("bootstrap: articles[] not sorted descending by time key + url")

    sections_in_main: set[str] = set()
    for it in arts:
        if isinstance(it, dict):
            s = str(it.get("section") or "").strip()
            if s:
                sections_in_main.add(s)

    boot_sec_counts = Counter()
    for it in barts:
        if isinstance(it, dict):
            s = str(it.get("section") or "").strip()
            if s:
                boot_sec_counts[s] += 1

    sec_counts_meta = meta.get("sectionCounts") if isinstance(meta, dict) else None
    if not isinstance(sec_counts_meta, dict):
        errors.append("bootstrapMeta.sectionCounts must be object")
    else:
        for s in sections_in_main:
            if boot_sec_counts.get(s, 0) < 1:
                errors.append(f"bootstrap: missing live coverage for section {s!r} in articles[]")
            n = sec_counts_meta.get(s)
            if not isinstance(n, int) or n < 1:
                errors.append(
                    f"bootstrap: missing sectionCounts entry for {s!r} (bootstrapMeta.sectionCounts)"
                )
            elif boot_sec_counts.get(s, 0) != n:
                errors.append(
                    f"bootstrap: sectionCounts[{s!r}]={n} != actual {boot_sec_counts.get(s, 0)}"
                )

    if isinstance(meta, dict):
        if meta.get("sort") != "publishedAt_desc":
            errors.append("bootstrapMeta.sort must be publishedAt_desc")
        if meta.get("dedup") != "url_canonical_v1":
            errors.append("bootstrapMeta.dedup must be url_canonical_v1")
        if meta.get("articleCount") != len(barts):
            errors.append("bootstrapMeta.articleCount must match len(articles)")

    if len(arts) < len(barts):
        errors.append("articles.json: article count smaller than bootstrap (unexpected truncation)")

    if INDEX.exists():
        try:
            idx = json.loads(INDEX.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            errors.append(f"articles/index.json invalid JSON: {e}")
        else:
            if "generatedAt" not in idx or not isinstance(idx.get("days"), list):
                errors.append("articles/index.json must keep {generatedAt, days[]} shape")

    if errors:
        _print(errors)
        return 1

    print("[validate_articles_bootstrap] OK", len(barts), "items")
    return 0


def _print(errors: list[str]) -> None:
    print("[validate_articles_bootstrap] FAIL", file=sys.stderr)
    for e in errors:
        print(" -", e, file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
