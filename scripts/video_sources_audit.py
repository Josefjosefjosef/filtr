#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Audit yield of official YouTube sources from videos_allowlist.json.

Outputs:
- JSON report (default: projects/data/videos_sources_audit.json)
- Human summary to stdout (including top CZ sources by 24h yield)

Optional:
- Rewrite allowlist to remove unsupported @handle URLs by resolving them to stable
  https://www.youtube.com/channel/UC... URLs.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Tuple
from urllib.parse import urlparse, parse_qs

import requests
import xml.etree.ElementTree as ET


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_ALLOWLIST_PATH = os.path.join(ROOT_DIR, "projects", "data", "videos_allowlist.json")
DEFAULT_OUT_PATH = os.path.join(ROOT_DIR, "projects", "data", "videos_sources_audit.json")

# More browser-like UA than infoUzelBot to avoid 404/blocked HTML responses.
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/121.0.0.0 Safari/537.36"
)

REQUEST_TIMEOUT_SEC = 20
FETCH_TIMEOUT_SEC = 12


def iso_now_z() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _safe_dt(iso: str):
    try:
        if not iso:
            return None
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return None


def _atomic_write_json(path: str, payload) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def read_allowlist(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data if isinstance(data, dict) else {}


def _extract_uc_channel_id_from_youtube_html(html: str) -> str:
    try:
        if not html:
            return ""
        m = re.search(r'"channelId"\s*:\s*"(UC[0-9A-Za-z_-]{22})"', html)
        if m:
            return m.group(1)
        m = re.search(r'"externalId"\s*:\s*"(UC[0-9A-Za-z_-]{22})"', html)
        if m:
            return m.group(1)
        m = re.search(r"channel_id=(UC[0-9A-Za-z_-]{22})", html)
        if m:
            return m.group(1)
        return ""
    except Exception:
        return ""


def _feed_url_from_channel_id(cid: str) -> str:
    cid = (cid or "").strip()
    return f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}" if cid else ""


def _feed_url_from_playlist_id(pid: str) -> str:
    pid = (pid or "").strip()
    return f"https://www.youtube.com/feeds/videos.xml?playlist_id={pid}" if pid else ""


def _resolve_handle_to_channel_id(handle: str) -> Tuple[str, List[dict]]:
    """
    Returns (channel_id, attempts[]).
    Attempts are returned for forensic debugging.
    """
    attempts: List[dict] = []
    h = (handle or "").strip().lstrip("@")
    if not h:
        return ("", attempts)

    # Try a few variants (some locales/redirects behave differently).
    # IMPORTANT: add ucbcb=1 to avoid consent.youtube.com redirects from server-side fetches.
    candidates = [
        f"https://www.youtube.com/@{h}?ucbcb=1",
        f"https://www.youtube.com/@{h}/about?ucbcb=1",
        f"https://www.youtube.com/@{h}/videos?ucbcb=1",
        f"https://www.youtube.com/@{h}?hl=en&ucbcb=1",
    ]

    headers = {
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,cs;q=0.8",
    }

    for url in candidates:
        try:
            r = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT_SEC, allow_redirects=True)
            cid = _extract_uc_channel_id_from_youtube_html(r.text or "")
            attempts.append(
                {
                    "url": url,
                    "status": int(r.status_code),
                    "finalUrl": str(r.url or url),
                    "hasChannelId": bool(cid),
                }
            )
            if r.status_code == 200 and cid:
                return (cid, attempts)
            # Sometimes channelId is present even on non-200 pages (consent pages).
            if cid:
                return (cid, attempts)
        except Exception as e:
            attempts.append({"url": url, "status": 0, "finalUrl": url, "error": str(e)})

    return ("", attempts)


def resolve_source_to_feed(url: str) -> dict:
    """
    Allowlist source → Atom feed URL (more tolerant + handle attempts exposed).
    Supports:
    - videos.xml?channel_id=UC...
    - videos.xml?playlist_id=PL...
    - /channel/UC...
    - /@handle  (HTML fetch → UC id)
    - /user/<name> or /c/<name> (HTML fetch → UC id)  [best-effort only]
    - /playlist?list=PL... or any URL with ?list=PL... (playlist feed)
    """
    raw = (url or "").strip()
    if not raw:
        return {}

    if "youtube.com/feeds/videos.xml" in raw:
        m = re.search(r"channel_id=(UC[0-9A-Za-z_-]{22})", raw)
        cid = m.group(1) if m else ""
        m2 = re.search(r"playlist_id=([0-9A-Za-z_-]+)", raw)
        pid = m2.group(1) if m2 else ""
        if pid:
            return {"feedUrl": raw, "playlistId": pid, "type": "playlist"}
        return {"feedUrl": raw, "channelId": cid, "type": "channel"}

    try:
        u = urlparse(raw)
    except Exception:
        return {}

    host = (u.netloc or "").lower()
    path = (u.path or "")
    if "youtube.com" not in host:
        return {}

    # Playlist feed (URL with list=...)
    try:
        pid = (parse_qs(u.query or "").get("list") or [""])[0]
        if pid and re.match(r"^[0-9A-Za-z_-]+$", pid):
            return {"feedUrl": _feed_url_from_playlist_id(pid), "playlistId": pid, "type": "playlist"}
    except Exception:
        pass

    m = re.search(r"/channel/(UC[0-9A-Za-z_-]{22})", path)
    if m:
        cid = m.group(1)
        return {"feedUrl": _feed_url_from_channel_id(cid), "channelId": cid, "type": "channel"}

    m = re.search(r"/@([0-9A-Za-z_.-]+)", path)
    if m:
        handle = m.group(1)
        cid, attempts = _resolve_handle_to_channel_id(handle)
        if not cid:
            return {"type": "handle", "handle": handle, "attempts": attempts}
        return {"feedUrl": _feed_url_from_channel_id(cid), "channelId": cid, "handle": handle, "type": "channel", "attempts": attempts}

    # NOTE: user/c/custom are intentionally not rewritten by default; they are rare in allowlist now.
    return {}


def _parse_atom_feed(xml_text: str) -> List[dict]:
    if not xml_text:
        return []
    try:
        root = ET.fromstring(xml_text)
    except Exception:
        return []

    ns = {
        "atom": "http://www.w3.org/2005/Atom",
        "yt": "http://www.youtube.com/xml/schemas/2015",
    }

    out: List[dict] = []
    for e in root.findall("atom:entry", ns):
        try:
            vid_el = e.find("yt:videoId", ns)
            vid = (vid_el.text or "").strip() if vid_el is not None else ""
            pub_el = e.find("atom:published", ns)
            published = (pub_el.text or "").strip() if pub_el is not None else ""
            title_el = e.find("atom:title", ns)
            title = (title_el.text or "").strip() if title_el is not None else ""
            if not vid or not published:
                continue
            out.append({"videoId": vid, "publishedAt": published, "title": title})
        except Exception:
            continue
    return out


def _is_official_source(s: Any) -> bool:
    try:
        return bool(isinstance(s, dict) and s.get("official") is True)
    except Exception:
        return False


def _iter_official_sources(cfg: dict) -> List[dict]:
    cats = cfg.get("categories") if isinstance(cfg.get("categories"), list) else []
    out: List[dict] = []
    for cat in cats:
        if not isinstance(cat, dict):
            continue
        cat_name = str(cat.get("name") or "").strip()
        sources = cat.get("sources") if isinstance(cat.get("sources"), list) else []
        for s in sources:
            if not _is_official_source(s):
                continue
            out.append(
                {
                    "category": cat_name,
                    "sourceKey": str(s.get("sourceKey") or "").strip(),
                    "title": str(s.get("title") or "").strip(),
                    "url": str(s.get("url") or "").strip(),
                    "type": str(s.get("type") or "").strip().lower() or "channel",
                    "region": str(s.get("region") or "").strip().lower(),
                    "langDefault": str(s.get("langDefault") or s.get("defaultLang") or s.get("lang") or "").strip().lower(),
                }
            )
    return out


def _classify_lang(src: dict) -> str:
    ld = (src.get("langDefault") or "").strip().lower()
    if ld in {"cz", "cs"}:
        return "cz"
    # Keep bilingual as en for quota purposes; it is not guaranteed CZ audio.
    return "en"


def audit_sources(allowlist_path: str) -> dict:
    cfg = read_allowlist(allowlist_path)
    sources = _iter_official_sources(cfg)

    now = datetime.now(timezone.utc)
    cutoff_24 = now - timedelta(hours=24)
    cutoff_48 = now - timedelta(hours=48)

    def audit_one(src: dict) -> dict:
        url = src.get("url") or ""
        res = resolve_source_to_feed(url)
        feed_url = str(res.get("feedUrl") or "").strip()
        channel_id = str(res.get("channelId") or "").strip()
        playlist_id = str(res.get("playlistId") or "").strip()
        attempts = res.get("attempts") if isinstance(res.get("attempts"), list) else []

        record = {
            **src,
            "langClass": _classify_lang(src),
            "resolved": {
                "feedUrl": feed_url or None,
                "channelId": channel_id or None,
                "playlistId": playlist_id or None,
                "attempts": attempts,
            },
            "status": "OK",
            "count_24h": 0,
            "count_48h": 0,
            "top_published": [],
            "suggestedUrl": None,
        }

        if "/@" in url:
            record["suggestedUrl"] = f"https://www.youtube.com/channel/{channel_id}" if channel_id else None

        if not feed_url:
            record["status"] = "resolver_fail"
            return record

        try:
            r = requests.get(feed_url, headers={"User-Agent": BROWSER_UA}, timeout=FETCH_TIMEOUT_SEC)
            if r.status_code != 200:
                record["status"] = "fetch_fail"
                record["fetchStatus"] = int(r.status_code)
                return record
            entries = _parse_atom_feed(r.text or "")
            # newest first
            entries.sort(key=lambda x: x.get("publishedAt") or "", reverse=True)
            record["top_published"] = [e.get("publishedAt") for e in entries[:3] if e.get("publishedAt")]

            c24 = 0
            c48 = 0
            for e in entries:
                dt = _safe_dt(str(e.get("publishedAt") or ""))
                if not dt:
                    continue
                if dt >= cutoff_48:
                    c48 += 1
                if dt >= cutoff_24:
                    c24 += 1
            record["count_24h"] = c24
            record["count_48h"] = c48
            return record
        except Exception as e:
            record["status"] = "fetch_fail"
            record["fetchError"] = str(e)
            return record

    # Run in parallel to keep runtime reasonable.
    results: List[dict] = []
    max_workers = min(12, max(4, (os.cpu_count() or 8)))
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futs = [ex.submit(audit_one, src) for src in sources]
        for fut in as_completed(futs):
            try:
                results.append(fut.result())
            except Exception as e:
                results.append({"status": "fetch_fail", "fetchError": str(e)})

    # Totals for quick gate
    cz = [r for r in results if r.get("langClass") == "cz" and r.get("status") == "OK"]
    en = [r for r in results if r.get("langClass") == "en" and r.get("status") == "OK"]
    cz_total_24 = sum(int(r.get("count_24h") or 0) for r in cz)
    en_total_24 = sum(int(r.get("count_24h") or 0) for r in en)

    return {
        "generatedAt": iso_now_z(),
        "allowlistPath": os.path.relpath(allowlist_path, ROOT_DIR).replace("\\", "/"),
        "sourcesTotal": len(results),
        "sourcesOk": sum(1 for r in results if r.get("status") == "OK"),
        "sourcesResolverFail": sum(1 for r in results if r.get("status") == "resolver_fail"),
        "sourcesFetchFail": sum(1 for r in results if r.get("status") == "fetch_fail"),
        "cz_24h_total": cz_total_24,
        "en_24h_total": en_total_24,
        "cz_24h_enough_for_12": bool(cz_total_24 >= 12),
        "results": results,
    }


def resolve_handles_only_for_rewrite(allowlist_path: str) -> dict:
    """
    Fast pass: resolve only handle URLs (no feed fetch), used to rewrite allowlist safely.
    """
    cfg = read_allowlist(allowlist_path)
    sources = _iter_official_sources(cfg)
    results: List[dict] = []

    handle_sources = [s for s in sources if "/@" in str(s.get("url") or "")]
    max_workers = min(10, max(4, (os.cpu_count() or 8)))

    def one(src: dict) -> dict:
        url = src.get("url") or ""
        res = resolve_source_to_feed(url)
        channel_id = str(res.get("channelId") or "").strip()
        attempts = res.get("attempts") if isinstance(res.get("attempts"), list) else []
        suggested = f"https://www.youtube.com/channel/{channel_id}" if channel_id else None
        return {
            **src,
            "langClass": _classify_lang(src),
            "resolved": {
                "channelId": channel_id or None,
                "attempts": attempts,
            },
            "status": "OK" if channel_id else "resolver_fail",
            "suggestedUrl": suggested,
        }

    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futs = [ex.submit(one, src) for src in handle_sources]
        for fut in as_completed(futs):
            try:
                results.append(fut.result())
            except Exception as e:
                results.append({"status": "resolver_fail", "error": str(e)})

    return {
        "generatedAt": iso_now_z(),
        "allowlistPath": os.path.relpath(allowlist_path, ROOT_DIR).replace("\\", "/"),
        "mode": "resolve_handles_only",
        "sourcesTotal": len(results),
        "sourcesOk": sum(1 for r in results if r.get("status") == "OK"),
        "sourcesResolverFail": sum(1 for r in results if r.get("status") == "resolver_fail"),
        "results": results,
    }


def rewrite_allowlist_handles(path: str, audit: dict) -> dict:
    """
    Rewrites allowlist in place: /@handle URLs -> /channel/UC...
    Returns rewrite report.
    """
    cfg = read_allowlist(path)
    cats = cfg.get("categories") if isinstance(cfg.get("categories"), list) else []

    # Build mapping from (url) -> suggestedUrl where available
    mapping: Dict[str, str] = {}
    unresolved: List[str] = []
    for r in audit.get("results") if isinstance(audit.get("results"), list) else []:
        try:
            u = str(r.get("url") or "").strip()
            sug = r.get("suggestedUrl")
            if "/@" in u:
                if isinstance(sug, str) and sug.strip():
                    mapping[u] = sug.strip()
                else:
                    unresolved.append(u)
        except Exception:
            continue

    changed: List[dict] = []
    before_handles = 0
    after_handles = 0

    for cat in cats:
        if not isinstance(cat, dict):
            continue
        sources = cat.get("sources") if isinstance(cat.get("sources"), list) else []
        for s in sources:
            if not _is_official_source(s):
                continue
            u = str(s.get("url") or "").strip()
            if "/@" in u:
                before_handles += 1
                new_u = mapping.get(u) or ""
                if new_u:
                    s["url"] = new_u
                    # stabilize type to channel when using channel URL
                    try:
                        if "/channel/UC" in new_u:
                            s["type"] = "channel"
                    except Exception:
                        pass
                    changed.append({"title": str(s.get("title") or ""), "before": u, "after": new_u})
                else:
                    after_handles += 1

    # Count remaining handle URLs
    def _count_handles() -> int:
        n = 0
        for cat in cats:
            if not isinstance(cat, dict):
                continue
            sources = cat.get("sources") if isinstance(cat.get("sources"), list) else []
            for s in sources:
                if not _is_official_source(s):
                    continue
                if "/@" in str(s.get("url") or ""):
                    n += 1
        return n

    remaining = _count_handles()

    if changed:
        _atomic_write_json(path, cfg)

    return {
        "allowlistPath": os.path.relpath(path, ROOT_DIR).replace("\\", "/"),
        "handlesBefore": before_handles,
        "handlesChanged": len(changed),
        "handlesRemaining": remaining,
        "changed": changed,
        "unresolved": unresolved[:50],
    }


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    ap = argparse.ArgumentParser()
    ap.add_argument("--allowlist", default=DEFAULT_ALLOWLIST_PATH, help="Path to videos_allowlist.json")
    ap.add_argument("--out", default=DEFAULT_OUT_PATH, help="Path to output JSON report")
    ap.add_argument("--rewrite-allowlist", action="store_true", help="Rewrite @handle URLs to stable channel URLs")
    ap.add_argument("--rewrite-only", action="store_true", help="Only resolve handles for rewrite (skip full feed fetch)")
    args = ap.parse_args()

    audit = resolve_handles_only_for_rewrite(args.allowlist) if args.rewrite_only else audit_sources(args.allowlist)
    _atomic_write_json(args.out, audit)

    # Human summary
    results = audit.get("results") if isinstance(audit.get("results"), list) else []
    ok = [r for r in results if r.get("status") == "OK"]
    cz_ok = [r for r in ok if r.get("langClass") == "cz"]
    cz_ok.sort(key=lambda r: int(r.get("count_24h") or 0), reverse=True)

    print("AUDIT_OUT", os.path.relpath(args.out, ROOT_DIR).replace("\\", "/"))
    print("SOURCES_TOTAL", audit.get("sourcesTotal"))
    print("SOURCES_OK", audit.get("sourcesOk"))
    print("SOURCES_RESOLVER_FAIL", audit.get("sourcesResolverFail"))
    print("SOURCES_FETCH_FAIL", audit.get("sourcesFetchFail"))
    if args.rewrite_only:
        print("MODE", "rewrite-only (no feed fetch)")
    else:
        print("CZ_24H_TOTAL", audit.get("cz_24h_total"))
        print("EN_24H_TOTAL", audit.get("en_24h_total"))
        print("CZ_24H_TOTAL_GE_12", "ANO" if audit.get("cz_24h_enough_for_12") else "NE")

    if not args.rewrite_only:
        print("\nTOP_CZ_SOURCES_BY_24H:")
        for r in cz_ok[:20]:
            name = r.get("title") or r.get("sourceKey") or "(unnamed)"
            u = r.get("url") or ""
            c24 = int(r.get("count_24h") or 0)
            c48 = int(r.get("count_48h") or 0)
            top = ", ".join([x for x in (r.get("top_published") or []) if x]) or "-"
            print(f"- {c24:>2} /24h | {c48:>2} /48h | {name} | {u} | top: {top}")

    if args.rewrite_allowlist:
        rep = rewrite_allowlist_handles(args.allowlist, audit)
        print("\nALLOWLIST_REWRITE")
        print("HANDLES_BEFORE", rep.get("handlesBefore"))
        print("HANDLES_CHANGED", rep.get("handlesChanged"))
        print("HANDLES_REMAINING", rep.get("handlesRemaining"))
        print("CHANGED_SOURCES_SAMPLE:")
        for x in (rep.get("changed") or [])[:30]:
            print("-", x.get("title") or "", "|", x.get("before"), "->", x.get("after"))
        if rep.get("unresolved"):
            print("UNRESOLVED_HANDLES_SAMPLE:")
            for u in rep.get("unresolved")[:30]:
                print("-", u)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

