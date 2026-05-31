#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Build YouTube videos pool for infoUzel.cz (no downloads; Atom feed only).

Output: projects/data/videos.json
Input:  projects/data/videos_allowlist.json

Windows usage (recommended):
  py -3 --version
  py -3 scripts\\build_videos.py

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
  VIDEOS_WINDOW_24H cz=<N> en=<N> out_cz=<N> out_en=<N> out_total=<N>
"""

import json
import os
import re
import sys
import time
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse, parse_qs

import requests
import xml.etree.ElementTree as ET

_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)
from iu_blocked_sources import iu_is_blocked_pocasicko_source

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALLOWLIST_PATH = os.path.join(ROOT_DIR, "projects", "data", "videos_allowlist.json")
OUTPUT_DIR = os.getenv("OUTPUT_DIR", os.path.join(ROOT_DIR, "projects", "data"))
OUT_PATH = os.path.join(OUTPUT_DIR, "videos.json")

from iu_crawler import IU_BOT_FROM_HEADER as BOT_FROM_HEADER  # noqa: E402
from iu_crawler import IU_USER_AGENT as USER_AGENT  # noqa: E402
from iu_crawler import REQUEST_TIMEOUT_SEC  # noqa: E402

def _bot_headers():
    return {"User-Agent": USER_AGENT, "From": BOT_FROM_HEADER}

# === EMBEDABILITY FILTER (build-side) ===
# Goal: exclude videos that cannot be embedded ("Video unavailable") or are non-embeddable.
_EMBED_CACHE = {}


def iu_is_embeddable(video_id: str) -> bool:
    try:
        vid = str(video_id or "").strip()
        if not vid:
            return False
        key = ("oembed", vid)
        if key in _EMBED_CACHE:
            return bool(_EMBED_CACHE[key])
        url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={vid}&format=json"
        r = requests.get(url, headers=_bot_headers(), timeout=5)
        ok = bool(r.status_code == 200)
        _EMBED_CACHE[key] = ok
        return ok
    except Exception:
        try:
            _EMBED_CACHE[("oembed", str(video_id or "").strip())] = False
        except Exception:
            pass
        return False


def iu_not_region_blocked(video_id: str) -> bool:
    try:
        vid = str(video_id or "").strip()
        if not vid:
            return False
        key = ("embed", vid)
        if key in _EMBED_CACHE:
            return bool(_EMBED_CACHE[key])
        url = f"https://www.youtube.com/embed/{vid}"
        r = requests.get(url, headers=_bot_headers(), timeout=5)
        ok = bool(r.status_code == 200 and ("Video unavailable" not in (r.text or "")))
        _EMBED_CACHE[key] = ok
        return ok
    except Exception:
        try:
            _EMBED_CACHE[("embed", str(video_id or "").strip())] = False
        except Exception:
            pass
        return False

# === DAILY WINDOW + CZ QUOTA (build-side) ===
# Requirements:
# - Never include videos older than 24h in output.
# - Output up to 25 videos total.
# - Target 12 CZ (if available in last 24h), rest EN up to 25.
VIDEO_WINDOW_HOURS = 24
MAX_VIDEOS_OUT = 25
TARGET_CZ = 12


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

def _feed_url_from_playlist_id(pid: str) -> str:
    pid = (pid or "").strip()
    if not pid:
        return ""
    return f"https://www.youtube.com/feeds/videos.xml?playlist_id={pid}"


def resolve_source_to_feed(url: str) -> dict:
    """
    Allowlist source → Atom feed URL.
    Supports:
    - videos.xml?channel_id=UC...
    - videos.xml?playlist_id=PL...
    - /channel/UC...
    - /@handle  (HTML fetch → UC id)
    - /user/<name> or /c/<name> (HTML fetch → UC id)
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
        # Avoid consent redirect: ucbcb=1 keeps server-side fetch on youtube.com domain.
        page = f"https://www.youtube.com/@{handle}?ucbcb=1"
        try:
            r = requests.get(page, headers=_bot_headers(), timeout=REQUEST_TIMEOUT_SEC)
            if r.status_code != 200:
                print(f"WARN: resolver handle failed status={r.status_code} url={page}")
                return {}
            cid = _extract_uc_channel_id_from_youtube_html(r.text or "")
            if not cid:
                print(f"WARN: resolver handle missing channelId url={page}")
                return {}
            return {"feedUrl": _feed_url_from_channel_id(cid), "channelId": cid, "handle": handle, "type": "channel"}
        except Exception as e:
            print(f"WARN: resolver handle exception url={page} err={e}")
            return {}

    m = re.search(r"/(user|c)/([0-9A-Za-z_.-]+)", path)
    if m:
        kind = m.group(1)
        name = m.group(2)
        page = f"https://www.youtube.com/{kind}/{name}"
        try:
            r = requests.get(page, headers=_bot_headers(), timeout=REQUEST_TIMEOUT_SEC)
            if r.status_code != 200:
                print(f"WARN: resolver {kind} failed status={r.status_code} url={page}")
                return {}
            cid = _extract_uc_channel_id_from_youtube_html(r.text or "")
            if not cid:
                print(f"WARN: resolver {kind} missing channelId url={page}")
                return {}
            return {"feedUrl": _feed_url_from_channel_id(cid), "channelId": cid, kind: name, "type": "channel"}
        except Exception as e:
            print(f"WARN: resolver {kind} exception url={page} err={e}")
            return {}

    # Custom channel URLs like https://www.youtube.com/PolicieCZ (single-segment path).
    # YouTube commonly redirects these, so we resolve via HTML channelId extraction.
    m = re.match(r"^/([0-9A-Za-z_.-]+)$", path)
    if m:
        name = m.group(1)
        if name.lower() not in {"watch", "playlist", "shorts", "feed", "results"}:
            page = f"https://www.youtube.com/{name}"
            try:
                r = requests.get(page, headers=_bot_headers(), timeout=REQUEST_TIMEOUT_SEC)
                if r.status_code != 200:
                    print(f"WARN: resolver custom failed status={r.status_code} url={page}")
                    return {}
                cid = _extract_uc_channel_id_from_youtube_html(r.text or "")
                if not cid:
                    print(f"WARN: resolver custom missing channelId url={page}")
                    return {}
                return {"feedUrl": _feed_url_from_channel_id(cid), "channelId": cid, "custom": name, "type": "channel"}
            except Exception as e:
                print(f"WARN: resolver custom exception url={page} err={e}")
                return {}

    return {}


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

def _ts_ms(iso: str) -> int:
    try:
        dt = _safe_dt(iso)
        if not dt:
            return 0
        return int(dt.timestamp() * 1000)
    except Exception:
        return 0

def _norm_topics(topics) -> list:
    allowed = {"science_tech", "practical", "finance", "interviews", "history", "explainer"}
    if not isinstance(topics, list):
        return []
    out = []
    for t in topics:
        x = str(t or "").strip().lower()
        if not x:
            continue
        if x in allowed:
            out.append(x)
    seen = set()
    uniq = []
    for x in out:
        if x in seen:
            continue
        seen.add(x)
        uniq.append(x)
    return uniq

def _topic_from_category(cat: str) -> str:
    c = str(cat or "").strip().lower()
    # Map existing allowlist categories → required 6 themes.
    m = {
        "science_tech_ai": "science_tech",
        "practical_life_city_travel": "practical",
        "finance_economy": "finance",
        "business_startups": "finance",
        "interviews_people": "interviews",
        "history_culture": "history",
        "transport_infra": "practical",
        "health_psychology": "practical",
        "law_politics_explained": "explainer",
        "smart_fun_short": "explainer",
    }
    return m.get(c) or "explainer"


def _infer_source_key(url: str, resolved: dict) -> str:
    try:
        pid = str(resolved.get("playlistId") or "").strip()
        if pid:
            return f"yt:playlist:{pid}"
        cid = str(resolved.get("channelId") or "").strip()
        if cid:
            return f"yt:channel:{cid}"
    except Exception:
        pass
    return f"yt:url:{(url or '').strip()}"


def _infer_source_title_simple(url: str, resolved: dict) -> str:
    try:
        handle = str(resolved.get("handle") or "").strip()
        if handle:
            return f"@{handle}"
    except Exception:
        pass
    try:
        u = urlparse(url or "")
        p = (u.path or "").strip("/")
        if p:
            return p
    except Exception:
        pass
    return (url or "").strip()


def _infer_source_title(src_url: str, handle: str = "", channel_id: str = "") -> str:
    # Best-effort stable title for source meta (no extra network fetch).
    if handle:
        return f"@{handle}"
    if channel_id:
        return channel_id
    try:
        u = urlparse(src_url or "")
        p = (u.path or "").strip("/")
        if p:
            return p
    except Exception:
        pass
    return (src_url or "").strip()


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
    sources_meta = []
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
        # Enrich sources in output with stable metadata.
        enriched_sources = []
        topic = _topic_from_category(cat_name)
        for s in sources:
            if not isinstance(s, dict):
                continue
            src_url = str(s.get("url") or "").strip()
            official = bool(s.get("official") is True)
            if not official:
                # Hard allowlist: only explicitly marked official sources.
                continue
            # Hard URL allowlist format (no search/topic/unknown pages).
            if not (
                re.search(r"^https://www\.youtube\.com/@[0-9A-Za-z_.-]+/?$", src_url)
                or re.search(r"^https://www\.youtube\.com/channel/UC[0-9A-Za-z_-]{22}/?$", src_url)
                or re.search(r"^https://www\.youtube\.com/playlist\?list=[0-9A-Za-z_-]+$", src_url)
            ):
                print(f"WARN: allowlist url not allowed format: {src_url}")
                continue
            default_lang = str(s.get("langDefault") or s.get("defaultLang") or s.get("lang") or "").strip().lower()
            if default_lang not in {"cz", "en", "bilingual"}:
                default_lang = "en"
            region = str(s.get("region") or "").strip().lower()
            if region not in {"cz", "world"}:
                region = "cz" if default_lang == "cz" else "world"
            topics = _norm_topics(s.get("topics")) or [topic]
            assume_cz_subs = bool(s.get("assumeCzSubs") or s.get("assumeCzSubtitles") or s.get("hasCzSubtitlesAssumed"))
            try:
                src_weight = float(s.get("weight") or 1.0)
            except Exception:
                src_weight = 1.0
            try:
                max_per_day = int(s.get("maxPerDay") or 2)
            except Exception:
                max_per_day = 2
            if not src_url:
                continue
            resolved = resolve_source_to_feed(src_url)
            feed_url = str(resolved.get("feedUrl") or "").strip()
            channel_id = str(resolved.get("channelId") or "").strip()
            handle = str(resolved.get("handle") or "").strip()
            if not feed_url:
                print(f"WARN: resolver unsupported source: {src_url}")
                continue
            stype = str(s.get("type") or resolved.get("type") or "channel").strip().lower()
            if stype not in {"channel", "playlist"}:
                stype = "channel"
            source_key = str(s.get("sourceKey") or s.get("source_key") or "").strip() or _infer_source_key(src_url, resolved)
            source_title = str(s.get("title") or "").strip() or _infer_source_title_simple(src_url, resolved)

            meta = {
                "sourceKey": source_key,
                "title": source_title,
                "type": stype,
                "url": src_url,
                "channelId": channel_id,
                "feedUrl": feed_url,
                "region": region,
                "langDefault": default_lang,
                "assumeCzSubs": assume_cz_subs,
                "topics": topics,
                "weight": src_weight,
                "maxPerDay": max_per_day,
                "official": True,
            }
            sources_meta.append(meta)
            enriched_sources.append(meta)
            feed_jobs.append(
                {
                    "feedUrl": feed_url,
                    "sourceUrl": src_url,
                    "sourceKey": source_key,
                    "sourceTitle": source_title,
                    "channelId": channel_id,
                    "region": region,
                    "topics": topics,
                    "weight": src_weight,
                    "maxPerDay": max_per_day,
                    "langDefault": default_lang,
                    "assumeCzSubs": assume_cz_subs,
                    "category": cat_name,
                    "categoryWeight": weight,
                }
            )
        cats_out.append({"name": cat_name, "weight": weight, "sources": enriched_sources})

    # Fetch + parse
    items = []
    seen = set()
    per_source_count = {}
    last_feed_domain = None
    for job in feed_jobs:
        feed_url = job["feedUrl"]
        feed_domain = (urlparse(feed_url).hostname or "").lower()
        if last_feed_domain and feed_domain == last_feed_domain:
            time.sleep(8)
        last_feed_domain = feed_domain
        try:
            r = requests.get(feed_url, headers=_bot_headers(), timeout=REQUEST_TIMEOUT_SEC)
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
                if iu_is_blocked_pocasicko_source(channel_name, title, str(job.get("sourceTitle") or "")):
                    continue
                if _title_blocked(title, title_blocklist):
                    continue
                dur = e.get("durationSec")
                if isinstance(dur, int) and dur > 0 and dur_min and dur < dur_min:
                    continue
                if isinstance(dur, int) and dur > 0 and dur_max and dur > dur_max:
                    continue
                src_key = str(job.get("sourceKey") or job.get("feedUrl") or "").strip() or job["feedUrl"]
                per_source_count[src_key] = per_source_count.get(src_key, 0) + 1
                if per_source_count[src_key] > max_per_source:
                    continue
                published = e.get("publishedAt") or ""
                published_ts = _ts_ms(published)

                default_lang = str(job.get("langDefault") or job.get("defaultLang") or "en").strip().lower()
                assume_cz_subs = bool(job.get("assumeCzSubs"))
                if default_lang == "cz":
                    lang_class = "cz"
                    lang = "cz"
                    has_cz_subs = False
                elif default_lang == "bilingual" or assume_cz_subs:
                    lang_class = "bilingual"
                    lang = "en"
                    has_cz_subs = True
                else:
                    lang_class = "en"
                    lang = "en"
                    has_cz_subs = False
                items.append(
                    {
                        "videoId": vid,
                        "title": title,
                        "url": f"https://www.youtube.com/watch?v={vid}",
                        "publishedAt": published,
                        "publishedAtTs": published_ts,
                        "channel": channel_name,
                        "sourceUrl": job["sourceUrl"],
                        "sourceKey": src_key,
                        "sourceTitle": job.get("sourceTitle") or "",
                        "channelId": job.get("channelId") or "",
                        "region": job.get("region") or "",
                        "topics": job.get("topics") or [],
                        "weight": job.get("weight") or 1.0,
                        "maxPerDay": job.get("maxPerDay") or 2,
                        "lang": lang,
                        "langClass": lang_class,
                        "hasCzSubtitles": has_cz_subs,
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

    # === DAILY MODE: strict 24h window + CZ quota ===
    cutoff = datetime.now(timezone.utc) - timedelta(hours=VIDEO_WINDOW_HOURS)
    pool_24h = []
    for it in items:
        dt = _safe_dt(str(it.get("publishedAt") or ""))
        if not dt:
            continue
        if dt < cutoff:
            continue
        pool_24h.append(it)

    def is_cz(it: dict) -> bool:
        try:
            return str(it.get("lang") or "").strip().lower() in {"cz", "cs"} or str(it.get("region") or "").strip().lower() == "cz"
        except Exception:
            return False

    cz_pool = [it for it in pool_24h if is_cz(it)]
    en_pool = [it for it in pool_24h if not is_cz(it)]

    cz_pool.sort(key=_sort_key_published_desc, reverse=True)
    en_pool.sort(key=_sort_key_published_desc, reverse=True)

    # Filter out non-embeddable / blocked videos, but only for candidates needed to fill output.
    def take_embeddable(pool: list, need: int) -> list:
        out2 = []
        checked = 0
        for it in pool:
            if len(out2) >= need:
                break
            vid = str(it.get("videoId") or "").strip()
            if not vid:
                continue
            checked += 1
            if iu_is_embeddable(vid) and iu_not_region_blocked(vid):
                out2.append(it)
            # Hard limit of checks per pool to keep build time bounded.
            if checked >= 80:
                break
        return out2

    out_cz = take_embeddable(cz_pool, max(0, TARGET_CZ))
    remaining = max(0, MAX_VIDEOS_OUT - len(out_cz))
    out_en = take_embeddable(en_pool, remaining)
    out = out_cz + out_en

    # If we still don't have enough, fill from the rest of 24h pool (newest-first), embeddable only.
    if len(out) < MAX_VIDEOS_OUT:
        try:
            used = set(str(it.get("videoId") or "").strip() for it in out if it.get("videoId"))
            filler = sorted(pool_24h, key=_sort_key_published_desc, reverse=True)
            checked = 0
            for it in filler:
                if len(out) >= MAX_VIDEOS_OUT:
                    break
                vid = str(it.get("videoId") or "").strip()
                if not vid or vid in used:
                    continue
                checked += 1
                if iu_is_embeddable(vid) and iu_not_region_blocked(vid):
                    out.append(it)
                    used.add(vid)
                if checked >= 120:
                    break
        except Exception:
            pass

    # Keep output strictly newest-first (does not change quota counts).
    out.sort(key=_sort_key_published_desc, reverse=True)

    pool_cz_n = len(cz_pool)
    pool_en_n = len(en_pool)
    out_cz_n = sum(1 for it in out if is_cz(it))
    out_en_n = max(0, len(out) - out_cz_n)

    print(
        f"VIDEOS_WINDOW_24H cz={pool_cz_n} en={pool_en_n} out_cz={out_cz_n} out_en={out_en_n} out_total={len(out)}"
    )

    # Keep legacy freshness token (monitoring compatibility).
    primary_count = len(out)
    fallback_count = 0
    older_count = 0

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
        "maxTotal": MAX_VIDEOS_OUT,
        "freshness": {
            "primaryDays": fresh_primary,
            "fallbackDays": fresh_fallback,
            "primaryCount": primary_count,
            "fallbackCount": fallback_count,
            "olderCount": older_count,
            "total": len(out),
        },
        "meta": {
            "windowHours": VIDEO_WINDOW_HOURS,
            "targetCz": TARGET_CZ,
            "outTotal": MAX_VIDEOS_OUT,
        },
        "sourcesMeta": sources_meta,
        "categories": cats_out,
        "videos": out,
    }

    _atomic_write_json(OUT_PATH, payload)
    print(f"VIDEOS_FRESHNESS primary14={primary_count} fallback60={fallback_count} older={older_count} total={len(out)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

