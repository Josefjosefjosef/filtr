#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Build YouTube videos pool for infoUzel.cz (no downloads; Atom feed only).

Output: projects/data/videos.json
Input:  projects/data/videos_allowlist.json

Requirements:
- allowlist only (CZ+world; categories+weights; per-source lang)
- freshness-first selection:
  - primary: ageDays <= freshDaysPrimary  -> ceil(maxTotal * freshTargetShare)
  - fallback: ageDays <= freshDaysFallback -> until maxTotal
  - older only if still not enough
- global dedupe by videoId
- maxPerSource and maxTotal limits
- tolerant: resolver/fetch failures are warnings (script must not fail overall)

Token log:
  VIDEOS_FRESHNESS primary14=<N> fallback60=<N> older=<N> total=<N>
"""

import json
import os
import re
import sys
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse

import requests
import xml.etree.ElementTree as ET


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALLOWLIST_PATH = os.path.join(ROOT_DIR, "projects", "data", "videos_allowlist.json")
OUTPUT_DIR = os.getenv("OUTPUT_DIR", os.path.join(ROOT_DIR, "projects", "data"))
OUT_PATH = os.path.join(OUTPUT_DIR, "videos.json")

USER_AGENT = "Mozilla/5.0 (compatible; infoUzelBot/1.0; +https://infouzel.cz)"
REQUEST_TIMEOUT_SEC = 20


def iso_now_z() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _atomic_write_json(path: str, payload) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def youtube_thumb_from_id(vid: str) -> str:
    v = (vid or "").strip()
    if not v:
        return ""
    return f"https://i.ytimg.com/vi/{v}/hqdefault.jpg"


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
        m = re.search(r'channel_id=(UC[0-9A-Za-z_-]{22})', html)
        if m:
            return m.group(1)
        return ""
    except Exception:
        return ""


def _feed_url_from_channel_id(cid: str) -> str:
    cid = (cid or "").strip()
    if not cid:
        return ""
    return f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}"


def resolve_source_to_feed_url(url: str) -> str:
    """
    Allowlist source → Atom feed URL.
    Supports:
    - videos.xml?channel_id=UC...
    - /channel/UC...
    - /@handle  (HTML fetch → UC id)
    """
    raw = (url or "").strip()
    if not raw:
        return ""
    if "youtube.com/feeds/videos.xml" in raw:
        return raw
    try:
        u = urlparse(raw)
    except Exception:
        return ""
    host = (u.netloc or "").lower()
    path = (u.path or "")
    if "youtube.com" not in host:
        return ""

    m = re.search(r"/channel/(UC[0-9A-Za-z_-]{22})", path)
    if m:
        return _feed_url_from_channel_id(m.group(1))

    m = re.search(r"/@([0-9A-Za-z_.-]+)", path)
    if m:
        handle = m.group(1)
        page = f"https://www.youtube.com/@{handle}"
        try:
            r = requests.get(page, headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT_SEC)
            if r.status_code != 200:
                print(f"WARN: resolver handle failed status={r.status_code} url={page}")
                return ""
            cid = _extract_uc_channel_id_from_youtube_html(r.text or "")
            if not cid:
                print(f"WARN: resolver handle missing channelId url={page}")
                return ""
            return _feed_url_from_channel_id(cid)
        except Exception as e:
            print(f"WARN: resolver handle exception url={page} err={e}")
            return ""

    return ""


def read_allowlist(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception as e:
        print(f"ERROR: allowlist read failed: {e}", file=sys.stderr)
        return {}


def _norm_title(title: str) -> str:
    return re.sub(r"\s+", " ", (title or "").strip())


def _title_blocked(title: str, blocklist: list) -> bool:
    try:
        t = (title or "").lower()
        for token in blocklist or []:
            s = str(token or "").strip().lower()
            if not s:
                continue
            if s in t:
                return True
        return False
    except Exception:
        return False


def _parse_atom_feed(xml_text: str) -> tuple[str, list]:
    """
    Returns (feed_title, entries[])
    Each entry: dict(videoId,title,publishedAt,channel)
    """
    if not xml_text:
        return ("", [])
    try:
        root = ET.fromstring(xml_text)
    except Exception:
        return ("", [])

    ns = {
        "atom": "http://www.w3.org/2005/Atom",
        "yt": "http://www.youtube.com/xml/schemas/2015",
        "media": "http://search.yahoo.com/mrss/",
    }

    feed_title = ""
    try:
        t = root.find("atom:title", ns)
        if t is not None and t.text:
            feed_title = t.text.strip()
    except Exception:
        feed_title = ""

    out = []
    for e in root.findall("atom:entry", ns):
        try:
            vid_el = e.find("yt:videoId", ns)
            vid = (vid_el.text or "").strip() if vid_el is not None else ""
            if not vid:
                continue
            title_el = e.find("atom:title", ns)
            title = (title_el.text or "").strip() if title_el is not None else ""
            pub_el = e.find("atom:published", ns)
            published = (pub_el.text or "").strip() if pub_el is not None else ""
            auth_name = ""
            a = e.find("atom:author/atom:name", ns)
            if a is not None and a.text:
                auth_name = a.text.strip()

            dur_sec = None
            d = e.find(".//yt:duration", ns)
            if d is not None:
                try:
                    dur_sec = int(d.attrib.get("seconds") or 0) or None
                except Exception:
                    dur_sec = None

            out.append(
                {
                    "videoId": vid,
                    "title": _norm_title(title),
                    "publishedAt": published,
                    "channel": auth_name,
                    "durationSec": dur_sec,
                }
            )
        except Exception:
            continue
    return (feed_title, out)


def _safe_dt(iso: str):
    try:
        if not iso:
            return None
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return None


def _age_days(iso: str) -> int:
    d = _safe_dt(iso)
    if not d:
        return 999999
    return int((datetime.now(timezone.utc) - d).total_seconds() // 86400)

def _sort_key_published_desc(item: dict):
    # Invalid/missing timestamps go last.
    try:
        dt = _safe_dt(str(item.get("publishedAt") or ""))
        return dt if dt else datetime.fromtimestamp(0, tz=timezone.utc)
    except Exception:
        return datetime.fromtimestamp(0, tz=timezone.utc)


def main() -> int:
    cfg = read_allowlist(ALLOWLIST_PATH)
    if not cfg:
        # never fail the workflow; output empty, but valid schema
        payload = {"generatedAt": iso_now_z(), "videos": []}
        _atomic_write_json(OUT_PATH, payload)
        print("VIDEOS_FRESHNESS primary14=0 fallback60=0 older=0 total=0")
        return 0

    version = int(cfg.get("version") or 1)
    insert_every = int(cfg.get("insertEveryN") or 8)
    max_per_page = int(cfg.get("maxVideosPerPage") or 25)

    fresh_primary = int(cfg.get("freshDaysPrimary") or 14)
    fresh_fallback = int(cfg.get("freshDaysFallback") or 60)
    fresh_target = float(cfg.get("freshTargetShare") or 0.7)

    dedupe_days = int(cfg.get("dedupeDays") or 30)

    lang_target_cz = float(cfg.get("langTargetCz") or 0.5)
    lang_target_en = float(cfg.get("langTargetEn") or 0.5)

    min_gap_source = int(cfg.get("minGapSameSource") or 5)
    max_lang_streak = int(cfg.get("maxSameLangStreak") or 2)
    max_cat_streak = int(cfg.get("maxSameCategoryStreak") or 2)

    max_per_source = int(cfg.get("maxPerSource") or 20)
    max_total = int(cfg.get("maxTotal") or 400)

    title_blocklist = cfg.get("titleBlocklist") if isinstance(cfg.get("titleBlocklist"), list) else []
    dur_min = int(cfg.get("durationMinSec") or 0)
    dur_max = int(cfg.get("durationMaxSec") or 0)

    categories = cfg.get("categories") if isinstance(cfg.get("categories"), list) else []

    # Resolve allowlist sources → feeds
    feed_jobs = []
    cats_out = []
    for cat in categories:
        if not isinstance(cat, dict):
            continue
        cat_name = str(cat.get("name") or "").strip()
        if not cat_name:
            continue
        try:
            weight = int(cat.get("weight") or 1)
        except Exception:
            weight = 1
        sources = cat.get("sources") if isinstance(cat.get("sources"), list) else []
        cats_out.append({"name": cat_name, "weight": weight, "sources": sources})
        for s in sources:
            if not isinstance(s, dict):
                continue
            src_url = str(s.get("url") or "").strip()
            lang = str(s.get("lang") or "").strip().lower()
            if lang not in {"cz", "en"}:
                lang = "en"
            if not src_url:
                continue
            feed_url = resolve_source_to_feed_url(src_url)
            if not feed_url:
                print(f"WARN: resolver unsupported source: {src_url}")
                continue
            feed_jobs.append(
                {
                    "feedUrl": feed_url,
                    "sourceUrl": src_url,
                    "lang": lang,
                    "category": cat_name,
                    "categoryWeight": weight,
                }
            )

    # Fetch + parse
    items = []
    seen = set()
    per_source_count = {}
    for job in feed_jobs:
        feed_url = job["feedUrl"]
        try:
            r = requests.get(feed_url, headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT_SEC)
            if r.status_code != 200:
                print(f"WARN: feed fetch failed status={r.status_code} url={feed_url}")
                continue
            feed_title, entries = _parse_atom_feed(r.text or "")
            channel_name = (feed_title or "").strip()
            channel_name = re.sub(r"^\s*Uploads\s+from\s+", "", channel_name, flags=re.IGNORECASE).strip()
            channel_name = re.sub(r"^\s*Videos\s+from\s+", "", channel_name, flags=re.IGNORECASE).strip()
            if not channel_name:
                channel_name = entries[0].get("channel") if entries else ""
            if not channel_name:
                channel_name = "YouTube"

            for e in entries:
                vid = e.get("videoId") or ""
                if not vid or vid in seen:
                    continue
                title = e.get("title") or ""
                if not title:
                    continue
                if _title_blocked(title, title_blocklist):
                    continue
                dur = e.get("durationSec")
                if isinstance(dur, int) and dur > 0 and dur_min and dur < dur_min:
                    continue
                if isinstance(dur, int) and dur > 0 and dur_max and dur > dur_max:
                    continue
                src_key = job["feedUrl"]
                per_source_count[src_key] = per_source_count.get(src_key, 0) + 1
                if per_source_count[src_key] > max_per_source:
                    continue
                published = e.get("publishedAt") or ""
                items.append(
                    {
                        "videoId": vid,
                        "title": title,
                        "url": f"https://www.youtube.com/watch?v={vid}",
                        "publishedAt": published,
                        "channel": channel_name,
                        "sourceUrl": job["sourceUrl"],
                        "sourceKey": src_key,
                        "lang": job["lang"],
                        "category": job["category"],
                        "categoryWeight": int(job.get("categoryWeight") or 0),
                        "thumb": youtube_thumb_from_id(vid),
                        "durationSec": dur if isinstance(dur, int) else None,
                    }
                )
                seen.add(vid)
        except Exception as e:
            print(f"WARN: feed exception url={feed_url} err={e}")
            continue

    # Strict global ordering (newest first)
    items.sort(key=_sort_key_published_desc, reverse=True)

    # Freshness-first selection for output (pool)
    primary = [it for it in items if _age_days(it.get("publishedAt") or "") <= fresh_primary]
    fallback = [it for it in items if fresh_primary < _age_days(it.get("publishedAt") or "") <= fresh_fallback]
    older = [it for it in items if _age_days(it.get("publishedAt") or "") > fresh_fallback]

    target_primary = int((max_total * fresh_target) + 0.9999)  # ceil
    out = []
    out_seen = set()

    def take(bucket: list, limit: int = None):
        nonlocal out
        for it in bucket:
            if len(out) >= max_total:
                break
            vid = it.get("videoId") or ""
            if not vid or vid in out_seen:
                continue
            if limit is not None and len(out) >= limit:
                break
            out.append(it)
            out_seen.add(vid)

    take(primary, limit=min(max_total, target_primary))
    take(fallback)
    take(older)

    # Ensure final pool is strictly newest-first (DESC).
    out.sort(key=_sort_key_published_desc, reverse=True)

    primary_count = sum(1 for it in out if _age_days(it.get("publishedAt") or "") <= fresh_primary)
    fallback_count = sum(1 for it in out if fresh_primary < _age_days(it.get("publishedAt") or "") <= fresh_fallback)
    older_count = max(0, len(out) - primary_count - fallback_count)

    payload = {
        "generatedAt": iso_now_z(),
        "allowlistVersion": version,
        "sortedBy": "publishedAt_desc",
        "insertEveryN": insert_every,
        "maxVideosPerPage": max_per_page,
        "freshDaysPrimary": fresh_primary,
        "freshDaysFallback": fresh_fallback,
        "freshTargetShare": fresh_target,
        "dedupeDays": dedupe_days,
        "langTargetCz": lang_target_cz,
        "langTargetEn": lang_target_en,
        "minGapSameSource": min_gap_source,
        "maxSameLangStreak": max_lang_streak,
        "maxSameCategoryStreak": max_cat_streak,
        "maxPerSource": max_per_source,
        "maxTotal": max_total,
        "freshness": {
            "primaryDays": fresh_primary,
            "fallbackDays": fresh_fallback,
            "primaryCount": primary_count,
            "fallbackCount": fallback_count,
            "olderCount": older_count,
            "total": len(out),
        },
        "categories": cats_out,
        "videos": out,
    }

    _atomic_write_json(OUT_PATH, payload)
    print(f"VIDEOS_FRESHNESS primary14={primary_count} fallback60={fallback_count} older={older_count} total={len(out)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

