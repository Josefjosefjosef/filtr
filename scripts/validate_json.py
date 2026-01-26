#!/usr/bin/env python3
import json, sys, os, re
from datetime import datetime

def fail(msg):
    print("VALIDATION_FAIL:", msg)
    sys.exit(2)

def load(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        fail(f"{path}: cannot read/parse JSON: {e}")

def is_url(s: str) -> bool:
    if not isinstance(s, str): return False
    return s.startswith("http://") or s.startswith("https://")

def validate_articles(obj):
    items = obj.get("items") if isinstance(obj, dict) else obj
    if not isinstance(items, list):
        fail("articles: expected list or {items:list}")

    for i, it in enumerate(items[:5000]):
        if not isinstance(it, dict):
            fail(f"articles[{i}]: not object")
        title = it.get("title")
        url = it.get("url") or it.get("link")
        source = it.get("source") or it.get("site") or it.get("feed")
        if not isinstance(title, str) or not title.strip():
            fail(f"articles[{i}]: missing/invalid title")
        if len(title) > 300:
            fail(f"articles[{i}]: title too long")
        if url is not None and not is_url(url):
            fail(f"articles[{i}]: invalid url")
        if source is not None and not isinstance(source, str):
            fail(f"articles[{i}]: invalid source")

def validate_videos(obj):
    items = obj.get("items") if isinstance(obj, dict) else obj
    if not isinstance(items, list):
        fail("videos: expected list or {items:list}")
    for i, it in enumerate(items[:5000]):
        if not isinstance(it, dict):
            fail(f"videos[{i}]: not object")
        title = it.get("title")
        url = it.get("url") or it.get("link")
        if title is not None and (not isinstance(title, str) or len(title) > 300):
            fail(f"videos[{i}]: invalid title")
        if url is not None and not is_url(url):
            fail(f"videos[{i}]: invalid url")

def validate_meta(obj):
    if not isinstance(obj, dict):
        fail("meta: expected object")
    if "version" in obj and not isinstance(obj["version"], str):
        fail("meta.version must be string")

def validate_status(obj):
    if not isinstance(obj, dict):
        fail("status: expected object")
    if "generated_at" in obj and not isinstance(obj["generated_at"], str):
        fail("status.generated_at must be string")

def main():
    if len(sys.argv) < 2:
        fail("Usage: validate_json.py <data_dir>")
    data_dir = sys.argv[1]

    articles_path = os.path.join(data_dir, "articles.json")
    videos_path = os.path.join(data_dir, "videos.json")
    meta_path = os.path.join(data_dir, "meta.json")
    status_path = os.path.join(data_dir, "status.json")

    if not os.path.exists(articles_path):
        fail(f"Missing: {articles_path}")
    if not os.path.exists(videos_path):
        fail(f"Missing: {videos_path}")
    if not os.path.exists(meta_path):
        fail(f"Missing: {meta_path}")

    a = load(articles_path)
    v = load(videos_path)
    m = load(meta_path)

    validate_articles(a)
    validate_videos(v)
    validate_meta(m)
    
    if os.path.exists(status_path):
        s2 = load(status_path)
        validate_status(s2)

    print("VALIDATION_OK")

if __name__ == "__main__":
    main()
