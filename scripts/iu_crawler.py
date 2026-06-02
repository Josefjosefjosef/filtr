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


def _robots_request_path(url: str) -> str:
    p = urlparse(url or "").path or "/"
    if not p.startswith("/"):
        p = "/" + p
    return p


def _user_agent_matches(rule: str, agent: str) -> bool:
    r = (rule or "").strip().lower()
    a = (agent or "").strip().lower()
    if not r:
        return False
    if r == "*":
        return True
    return a.startswith(r) or r in a


def _robots_pattern_matches(pattern: str, path: str) -> bool:
    pat = (pattern or "").strip()
    if not pat:
        return False
    end_anchor = pat.endswith("$")
    if end_anchor:
        pat = pat[:-1]
    if pat == "/":
        return True
    if end_anchor:
        return path == pat
    return path.startswith(pat)


def _robots_rules_for_agent(body: str, user_agent: str) -> list[tuple[str, str]]:
    """Collect Allow/Disallow rules for the best-matching User-agent group."""
    rules: list[tuple[str, str]] = []
    active: list[str] = []
    matched_group = False
    for raw in body.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or line.startswith("#"):
            continue
        low = line.lower()
        if low.startswith("user-agent:"):
            ua = line.split(":", 1)[1].strip()
            if not active:
                active = [ua]
            elif _user_agent_matches(ua, user_agent) or ua == "*":
                active.append(ua)
            elif matched_group:
                break
            continue
        if not active:
            continue
        if not any(_user_agent_matches(u, user_agent) or u == "*" for u in active):
            continue
        matched_group = True
        if low.startswith("allow:"):
            rules.append(("allow", line.split(":", 1)[1].strip()))
        elif low.startswith("disallow:"):
            rules.append(("disallow", line.split(":", 1)[1].strip()))
    return rules


def _robots_can_fetch(body: str, user_agent: str, url: str) -> bool:
    """
    Google-order robots evaluation: longest matching Allow/Disallow wins; Allow wins ties.
    Fixes stdlib RobotFileParser missing Allow override (e.g. servis.idnes.cz RSS).
    """
    path = _robots_request_path(url)
    rules = _robots_rules_for_agent(body, user_agent)
    if not rules:
        return True
    best_allow = -1
    best_disallow = -1
    for typ, pattern in rules:
        if not _robots_pattern_matches(pattern, path):
            continue
        plen = len(pattern.rstrip("$") or "/")
        if typ == "allow":
            best_allow = max(best_allow, plen)
        else:
            best_disallow = max(best_disallow, plen)
    if best_allow < 0 and best_disallow < 0:
        return True
    if best_allow >= 0 and best_disallow < 0:
        return True
    if best_disallow >= 0 and best_allow < 0:
        return False
    if best_allow > best_disallow:
        return True
    if best_disallow > best_allow:
        return False
    return True


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

    if not _robots_can_fetch(body, IU_USER_AGENT, url):
        return False, "disallowed_by_robots"
    return True, "allowed"


def is_rate_limit_response(status_code: int) -> bool:
    return status_code in (403, 429)


def rate_limit_backoff_sec(attempt: int, status_code: int) -> float:
    base = 4.0 if status_code == 429 else 2.5
    return min(120.0, base * (2**attempt))
