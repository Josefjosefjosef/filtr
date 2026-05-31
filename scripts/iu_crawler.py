# -*- coding: utf-8 -*-
"""
infoUzel crawler identity, rate-limit policy, robots.txt cache (media-level ethics).
No article-count forecasting — only hard safety caps and compliance checks.
"""
from __future__ import annotations

import os
import re
import time
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import requests

# Canonical bot identity (single source of truth for RSS/video fetch).
IU_USER_AGENT = "infoUzelBot/1.0 (+https://infouzel.cz; contact: Info@infoUzel.cz)"
IU_BOT_FROM_HEADER = "Info@infoUzel.cz"
IU_BOT_HOME_URL = "https://infouzel.cz"

GLOBAL_MIN_REQUEST_INTERVAL_SEC = 2.0
REQUEST_TIMEOUT_SEC = 20

# robots cache TTL (seconds) — avoid hammering /robots.txt
ROBOTS_CACHE_TTL_SEC = 6 * 3600


def crawler_request_headers() -> dict[str, str]:
    return {
        "User-Agent": IU_USER_AGENT,
        "From": IU_BOT_FROM_HEADER,
        "Accept": "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1",
        "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.3",
        "Cache-Control": "no-cache",
    }


def _robots_cache_path(output_dir: str) -> str:
    return os.path.join(output_dir, "robots_cache.json")


def _load_robots_cache(output_dir: str) -> dict:
    path = _robots_cache_path(output_dir)
    if not os.path.isfile(path):
        return {"hosts": {}}
    try:
        import json

        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {"hosts": {}}
    except Exception:
        return {"hosts": {}}


def _save_robots_cache(output_dir: str, data: dict) -> None:
    import json

    os.makedirs(output_dir, exist_ok=True)
    path = _robots_cache_path(output_dir)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def _host_from_url(url: str) -> str:
    try:
        h = (urlparse(url or "").netloc or "").lower()
        if h.startswith("www."):
            h = h[4:]
        return h
    except Exception:
        return ""


def _fetch_robots_txt(host: str, last_req_ts: list | None) -> str | None:
    if not host:
        return None
    robots_url = f"https://{host}/robots.txt"
    try:
        if last_req_ts is not None and last_req_ts:
            elapsed = time.time() - float(last_req_ts[0] or 0)
            need = GLOBAL_MIN_REQUEST_INTERVAL_SEC - elapsed
            if need > 0:
                time.sleep(need + 0.2)
            last_req_ts[0] = time.time()
        else:
            time.sleep(0.5)
        res = requests.get(
            robots_url,
            headers=crawler_request_headers(),
            timeout=REQUEST_TIMEOUT_SEC,
            allow_redirects=True,
        )
        if res.status_code == 200:
            return res.text or ""
    except Exception:
        pass
    return None


def robots_allowed_for_url(
    url: str,
    output_dir: str,
    last_req_ts: list | None = None,
) -> tuple[bool, str]:
    """
    Returns (allowed, reason). On unknown robots (fetch fail), allow fetch (fail-open)
    but reason documents uncertainty — guards verify module exists.
    """
    if os.getenv("IU_IGNORE_ROBOTS", "").strip().lower() in ("1", "true", "yes"):
        return True, "ignore_robots_env"

    host = _host_from_url(url)
    if not host:
        return True, "no_host"

    cache = _load_robots_cache(output_dir)
    hosts = cache.setdefault("hosts", {})
    entry = hosts.get(host) if isinstance(hosts.get(host), dict) else {}
    now = time.time()
    fetched_at = float(entry.get("fetched_at") or 0)
    body = entry.get("body")

    if not body or (now - fetched_at) > ROBOTS_CACHE_TTL_SEC:
        body = _fetch_robots_txt(host, last_req_ts)
        hosts[host] = {
            "fetched_at": now,
            "body": body or "",
            "fetch_ok": bool(body),
        }
        _save_robots_cache(output_dir, cache)

    if body is None or body == "":
        return True, "robots_unavailable_fail_open"

    rp = RobotFileParser()
    rp.set_url(f"https://{host}/robots.txt")
    try:
        rp.parse(body.splitlines())
    except Exception:
        return True, "robots_parse_fail_open"

    if not rp.can_fetch(IU_USER_AGENT, url):
        return False, "disallowed_by_robots"
    return True, "allowed"


def is_rate_limit_response(status_code: int) -> bool:
    return status_code in (403, 429)


def rate_limit_backoff_sec(attempt: int, status_code: int) -> float:
    base = 4.0 if status_code == 429 else 2.5
    return min(120.0, base * (2**attempt))
