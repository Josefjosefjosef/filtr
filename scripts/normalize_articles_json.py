#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import html
import sys
from datetime import datetime, timezone

ALLOWED_SECTIONS = {
    "aktualne",
    "doprava",
    "pocasi",
    "sport",
    "finance",
    "krimi",
    "kultura",
    "celebrity",
    "zahranici",
    "domaci",
    "magazin",
    "veda",
    "technologie",
}

def iso_now_z():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def normalize_article(a: dict) -> dict:
    topic = (a.get("topic") or "").strip()
    section = (a.get("section") or "").strip()

    # pokud section je prázdná, použij topic
    if not section:
        section = topic

    # pokud section není v povolených, nastav section = topic
    if section and section not in ALLOWED_SECTIONS and topic:
        section = topic

    title = a.get("title") or ""
    title = html.unescape(title).strip()

    published_at = (a.get("publishedAt") or "").strip()

    sources = a.get("sources") or []
    norm_sources = []
    for s in sources:
        if not isinstance(s, dict):
            continue
        name = (s.get("name") or "").strip()
        url = (s.get("url") or "").strip()
        if name and url:
            norm_sources.append({"name": name, "url": url})

    out = {
        "topic": topic,
        "section": section,
        "title": title,
        "publishedAt": published_at,
        "sources": norm_sources,
    }

    return out

def main():
    if len(sys.argv) != 2:
        print("Použití: scripts/normalize_articles_json.py data/articles.json", file=sys.stderr)
        sys.exit(2)

    path = sys.argv[1]

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    generated_at = data.get("generatedAt") or data.get("updatedAt") or iso_now_z()
    articles = data.get("articles") or []

    norm_articles = []
    for a in articles:
        if isinstance(a, dict):
            norm_articles.append(normalize_article(a))

    out = {
        "generatedAt": generated_at,
        "articles": norm_articles
    }

    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"OK: normalizováno {len(norm_articles)} článků → {path}")

if __name__ == "__main__":
    main()
