#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Weather History Auto-Collector (YouTube RSS/Atom + oEmbed) — no API key.

Goal:
- Fetch allowlisted YouTube RSS feeds (Atom).
- Filter "retro" weather videos by keywords + year threshold.
- Verify embedability via oEmbed (practical, no YouTube Data API).
- Merge into projects/data/weather_history_videos.json safely:
  - never delete existing items (only trim to max_total_items deterministically)
  - never write empty dataset
  - on any failure / zero results: do NOT change dataset
"""

from __future__ import annotations

import json
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode

import requests
import xml.etree.ElementTree as ET


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES_PATH = os.path.join(ROOT_DIR, "projects", "data", "weather_history_sources.json")
DATASET_PATH = os.path.join(ROOT_DIR, "projects", "data", "weather_history_videos.json")

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/121.0.0.0 Safari/537.36"
)

RSS_TIMEOUT_SEC = 10
OEMBED_TIMEOUT_SEC = 5
MAX_OEMBED_WORKERS = 3


def _eprint(msg: str) -> None:
    print(msg, file=sys.stderr)


def _load_json(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("JSON root must be object")
    return data


def _atomic_write_json(path: str, payload: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def _safe_fetch_text(url: str, timeout_sec: int) -> Optional[str]:
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=timeout_sec)
        if r.status_code != 200:
            print(f"WARN: rss_fetch_failed status={r.status_code} url={url}")
            return None
        return r.text or ""
    except Exception as e:
        print(f"WARN: rss_fetch_exception url={url} err={e}")
        return None


def _parse_year_from_iso(iso: str) -> Optional[int]:
    try:
        if not iso:
            return None
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        return int(dt.year)
    except Exception:
        return None


def _parse_atom(xml_text: str) -> List[Dict[str, Any]]:
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

    out: List[Dict[str, Any]] = []
    for e in root.findall("atom:entry", ns):
        try:
            vid_el = e.find("yt:videoId", ns)
            vid = (vid_el.text or "").strip() if vid_el is not None else ""
            if not vid:
                continue

            title_el = e.find("atom:title", ns)
            title = (title_el.text or "").strip() if title_el is not None else ""
            if not title:
                continue

            pub_el = e.find("atom:published", ns)
            if pub_el is None:
                pub_el = e.find("atom:updated", ns)
            pub = (pub_el.text or "").strip() if pub_el is not None else ""
            year = _parse_year_from_iso(pub)
            if year is None:
                continue

            out.append({"id": vid, "title": title, "year": year})
        except Exception:
            continue

    return out


def _kw_any(title: str, any_list: List[str]) -> bool:
    t = str(title or "").lower()
    for k in any_list or []:
        kk = str(k or "").strip().lower()
        if kk and kk in t:
            return True
    return False


def _kw_none(title: str, none_list: List[str]) -> bool:
    t = str(title or "").lower()
    for k in none_list or []:
        kk = str(k or "").strip().lower()
        if kk and kk in t:
            return True
    return False


_OEMBED_LOCK = threading.Lock()
_OEMBED_CACHE: Dict[str, bool] = {}


def _oembed_embeddable(video_id: str) -> bool:
    vid = str(video_id or "").strip()
    if not vid:
        return False

    with _OEMBED_LOCK:
        if vid in _OEMBED_CACHE:
            return bool(_OEMBED_CACHE[vid])

    try:
        qs = urlencode(
            {"url": f"https://www.youtube.com/watch?v={vid}", "format": "json"},
            doseq=False,
            safe=":/?=&",
        )
        url = f"https://www.youtube.com/oembed?{qs}"
        r = requests.get(url, headers={"User-Agent": UA}, timeout=OEMBED_TIMEOUT_SEC)
        if r.status_code != 200:
            with _OEMBED_LOCK:
                _OEMBED_CACHE[vid] = False
            return False
        data = r.json()
        html = str(data.get("html") or "")
        ok = ("<iframe" in html.lower())
        with _OEMBED_LOCK:
            _OEMBED_CACHE[vid] = bool(ok)
        return bool(ok)
    except Exception:
        with _OEMBED_LOCK:
            _OEMBED_CACHE[vid] = False
        return False


def _normalize_existing_items(items: Any) -> Tuple[List[Dict[str, Any]], set]:
    out: List[Dict[str, Any]] = []
    ids = set()
    if not isinstance(items, list):
        return (out, ids)
    for it in items:
        if not isinstance(it, dict):
            continue
        vid = str(it.get("id") or "").strip()
        if not vid:
            continue
        if vid in ids:
            continue
        ids.add(vid)
        out.append(it)
    return (out, ids)


def _sort_key_year_then_id(it: Dict[str, Any]) -> Tuple[int, str]:
    try:
        y = int(it.get("year") or 9999)
    except Exception:
        y = 9999
    return (y, str(it.get("id") or ""))


def main() -> int:
    # Load sources allowlist (strict)
    try:
        cfg = _load_json(SOURCES_PATH)
    except Exception as e:
        _eprint(f"ERROR: sources_json_error err={e}")
        return 1

    sources = cfg.get("sources")
    if not isinstance(sources, list):
        _eprint("ERROR: sources must be array")
        return 1

    keywords_any = cfg.get("keywords_any") if isinstance(cfg.get("keywords_any"), list) else []
    keywords_none = cfg.get("keywords_none") if isinstance(cfg.get("keywords_none"), list) else []
    try:
        year_max = int(cfg.get("year_max") or 0) or 2012
    except Exception:
        year_max = 2012
    try:
        max_add = int(cfg.get("max_add_per_run") or 10)
    except Exception:
        max_add = 10
    try:
        max_total = int(cfg.get("max_total_items") or 500)
    except Exception:
        max_total = 500

    max_add = max(0, min(50, max_add))
    max_total = max(1, min(500, max_total))

    sources_total = len(sources)
    sources_ok = 0
    rss_items_seen = 0

    raw_candidates: List[Dict[str, Any]] = []

    for src in sources:
        try:
            if not isinstance(src, dict):
                continue
            name = str(src.get("name") or "").strip()
            rss = str(src.get("rss") or "").strip()
            label = str(src.get("sourceLabel") or "").strip() or name or "YouTube"
            if not rss:
                print(f"WARN: source_missing_rss name={name}")
                continue

            xml_text = _safe_fetch_text(rss, RSS_TIMEOUT_SEC)
            if not xml_text:
                continue

            entries = _parse_atom(xml_text)
            sources_ok += 1
            rss_items_seen += len(entries)

            for e in entries:
                try:
                    vid = str(e.get("id") or "").strip()
                    title = str(e.get("title") or "").strip()
                    year = int(e.get("year") or 0)
                    if not vid or not title or not year:
                        continue
                    if year > year_max:
                        continue
                    if keywords_any and (not _kw_any(title, keywords_any)):
                        continue
                    if keywords_none and _kw_none(title, keywords_none):
                        continue
                    raw_candidates.append(
                        {
                            "id": vid,
                            "year": year,
                            "title": title,
                            "source": label,
                        }
                    )
                except Exception:
                    continue
        except Exception as e:
            print(f"WARN: source_exception err={e}")
            continue

    candidates_after_keyword = len(raw_candidates)

    # Always print required counters (even on NO UPDATE).
    def print_counters(embeddable_ok: int, added_count: int, total_after: int) -> None:
        print(f"sources_total={sources_total}")
        print(f"sources_ok={sources_ok}")
        print(f"rss_items_seen={rss_items_seen}")
        print(f"candidates_after_keyword={candidates_after_keyword}")
        print(f"embeddable_ok={embeddable_ok}")
        print(f"added_count={added_count}")
        print(f"total_after={total_after}")

    # FAIL-SAFE: no RSS items -> do nothing
    if rss_items_seen == 0:
        print_counters(embeddable_ok=0, added_count=0, total_after=0)
        print("NO UPDATE")
        return 0

    # Load existing dataset (strict JSON if exists)
    dataset: Dict[str, Any]
    if os.path.exists(DATASET_PATH):
        try:
            dataset = _load_json(DATASET_PATH)
        except Exception as e:
            _eprint(f"ERROR: dataset_json_error err={e}")
            return 1
    else:
        dataset = {"version": 1, "title": "Návrat do historie počasí", "items": []}

    existing_items, existing_ids = _normalize_existing_items(dataset.get("items"))

    # Deterministic candidate ordering.
    raw_candidates.sort(key=lambda x: (int(x.get("year") or 9999), str(x.get("id") or "")))

    # Cap checks to keep CI stable.
    max_checks = max(0, min(200, max_add * 20 if max_add else 0))
    candidates_to_check = raw_candidates[:max_checks]

    embeddable_ok = 0
    embeddable_candidates: List[Dict[str, Any]] = []

    with ThreadPoolExecutor(max_workers=MAX_OEMBED_WORKERS) as ex:
        fut_map = {ex.submit(_oembed_embeddable, c["id"]): c for c in candidates_to_check}
        for fut in as_completed(fut_map):
            c = fut_map[fut]
            ok = False
            try:
                ok = bool(fut.result())
            except Exception:
                ok = False
            if ok:
                embeddable_ok += 1
                embeddable_candidates.append(c)

    # FAIL-SAFE: no embeddable videos -> do nothing
    if embeddable_ok == 0:
        print_counters(embeddable_ok=0, added_count=0, total_after=len(existing_items))
        print("NO UPDATE")
        return 0

    # Deterministic ordering for additions.
    embeddable_candidates.sort(key=lambda x: (int(x.get("year") or 9999), str(x.get("id") or "")))

    added: List[Dict[str, Any]] = []
    for c in embeddable_candidates:
        if len(added) >= max_add:
            break
        vid = str(c.get("id") or "").strip()
        if not vid or vid in existing_ids:
            continue
        item = {
            "id": vid,
            "year": int(c.get("year") or 0),
            "source": str(c.get("source") or "").strip() or "YouTube",
            "title": str(c.get("title") or "").strip(),
            "note": "Archivní předpověď počasí (auto).",
        }
        added.append(item)
        existing_ids.add(vid)

    added_count = len(added)
    if added_count == 0:
        print_counters(embeddable_ok=embeddable_ok, added_count=0, total_after=len(existing_items))
        print("NO UPDATE")
        return 0

    merged = list(existing_items) + added
    merged.sort(key=_sort_key_year_then_id)
    if len(merged) > max_total:
        merged = merged[-max_total:]

    total_after = len(merged)
    if total_after <= 0:
        _eprint("ERROR: would_write_empty_dataset")
        return 1

    payload = {
        "version": int(dataset.get("version") or 1),
        "title": str(dataset.get("title") or "Návrat do historie počasí"),
        "items": merged,
    }

    # Validate uniqueness (belt-and-suspenders).
    seen = set()
    for it in payload["items"]:
        vid = str((it or {}).get("id") or "").strip()
        if not vid or vid in seen:
            _eprint("ERROR: duplicate_or_missing_id_after_merge")
            return 1
        seen.add(vid)

    _atomic_write_json(DATASET_PATH, payload)

    print_counters(embeddable_ok=embeddable_ok, added_count=added_count, total_after=total_after)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Weather History Auto-Collector (build-time only).

Goal:
- Update projects/data/weather_history_videos.json by ADDING retro YouTube items.
- Never delete existing items.
- Never produce an empty dataset.
- No runtime API (build script only).

Inputs:
- projects/data/weather_history_sources.json
  { "channels":[...], "keywords":[...], "year_max": 2010 }

Env:
- YOUTUBE_API_KEY (optional but recommended). If missing, script will NOT modify dataset.
"""

import json
import os
import re
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES_PATH = os.path.join(ROOT_DIR, "projects", "data", "weather_history_sources.json")
DATASET_PATH = os.path.join(ROOT_DIR, "projects", "data", "weather_history_videos.json")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/121.0.0.0 Safari/537.36"
)
TIMEOUT_SEC = 20

MAX_ITEMS = 500
MAX_DURATION_SEC = 15 * 60


def _fatal(msg: str) -> int:
    print(f"ERROR: {msg}", file=sys.stderr)
    return 1


def _read_json_strict(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _atomic_write_json(path: str, payload: Any) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", str(s or "").strip())


def _contains_keyword(title: str, desc: str, keywords: List[str]) -> bool:
    try:
        hay = (str(title or "") + "\n" + str(desc or "")).lower()
        for k in keywords:
            kk = str(k or "").strip().lower()
            if kk and kk in hay:
                return True
        return False
    except Exception:
        return False


def _safe_year(published_at: str) -> Optional[int]:
    try:
        if not published_at:
            return None
        dt = datetime.fromisoformat(str(published_at).replace("Z", "+00:00")).astimezone(timezone.utc)
        return int(dt.year)
    except Exception:
        return None


def _parse_iso8601_duration_to_sec(dur: str) -> Optional[int]:
    """
    YouTube API returns ISO 8601 durations like: PT1H2M3S, PT12M, PT45S.
    """
    try:
        s = str(dur or "").strip().upper()
        if not s.startswith("PT"):
            return None
        s = s[2:]
        h = m = sec = 0
        mm = re.search(r"(\d+)H", s)
        if mm:
            h = int(mm.group(1))
        mm = re.search(r"(\d+)M", s)
        if mm:
            m = int(mm.group(1))
        mm = re.search(r"(\d+)S", s)
        if mm:
            sec = int(mm.group(1))
        return h * 3600 + m * 60 + sec
    except Exception:
        return None


def _source_label(channel_title: str, video_title: str) -> str:
    ct = (channel_title or "").lower()
    vt = (video_title or "").lower()
    if "bbc" in ct or "bbc" in vt:
        return "BBC"
    if "weather channel" in ct or "weather channel" in vt:
        return "Weather Channel"
    if "čt" in vt or "česká televize" in vt or "ceska televize" in vt:
        return "ČT"
    x = _norm(channel_title)
    if x:
        return x[:60]
    return "YouTube"


def _youtube_get(url: str, params: Dict[str, str], api_key: str) -> Dict[str, Any]:
    p = dict(params or {})
    p["key"] = api_key
    r = requests.get(url, params=p, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT_SEC)
    if r.status_code != 200:
        raise RuntimeError(f"http {r.status_code}: {r.text[:200]}")
    return r.json()


def _collect_search_ids(
    api_key: str,
    channel_id: str,
    published_before_iso: str,
    pages_max: int,
) -> List[str]:
    ids: List[str] = []
    page_token = ""
    for _ in range(max(1, pages_max)):
        params = {
            "part": "snippet",
            "type": "video",
            "channelId": channel_id,
            "maxResults": "50",
            "order": "date",
            "publishedBefore": published_before_iso,
        }
        if page_token:
            params["pageToken"] = page_token
        data = _youtube_get("https://www.googleapis.com/youtube/v3/search", params, api_key)
        items = data.get("items") if isinstance(data, dict) else None
        if not isinstance(items, list) or not items:
            break
        for it in items:
            try:
                vid = it.get("id", {}).get("videoId")
                vid = str(vid or "").strip()
                if vid and vid not in ids:
                    ids.append(vid)
            except Exception:
                continue
        page_token = str(data.get("nextPageToken") or "").strip()
        if not page_token:
            break
    return ids


def _collect_video_details(api_key: str, video_ids: List[str]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    ids = [str(x or "").strip() for x in (video_ids or []) if str(x or "").strip()]
    # API allows up to 50 IDs per request
    for i in range(0, len(ids), 50):
        chunk = ids[i : i + 50]
        data = _youtube_get(
            "https://www.googleapis.com/youtube/v3/videos",
            {
                "part": "snippet,contentDetails,status",
                "id": ",".join(chunk),
                "maxResults": "50",
            },
            api_key,
        )
        items = data.get("items") if isinstance(data, dict) else None
        if not isinstance(items, list):
            continue
        for it in items:
            if isinstance(it, dict):
                out.append(it)
    return out


def _is_embeddable_build_gate(video_id: str) -> bool:
    """
    Additional build-side check (no runtime API):
    - oEmbed must succeed (status 200)
    - /embed must not contain "Video unavailable"
    """
    vid = str(video_id or "").strip()
    if not vid:
        return False
    try:
        o = requests.get(
            f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={vid}&format=json",
            headers={"User-Agent": USER_AGENT},
            timeout=5,
        )
        if o.status_code != 200:
            return False
    except Exception:
        return False
    try:
        e = requests.get(
            f"https://www.youtube.com/embed/{vid}",
            headers={"User-Agent": USER_AGENT},
            timeout=5,
        )
        if e.status_code != 200:
            return False
        if "Video unavailable" in (e.text or ""):
            return False
    except Exception:
        return False
    return True


def _load_sources() -> Tuple[List[str], List[str], int]:
    data = _read_json_strict(SOURCES_PATH)
    if not isinstance(data, dict):
        raise ValueError("sources json must be an object")
    channels = data.get("channels")
    keywords = data.get("keywords")
    year_max = data.get("year_max")
    if not isinstance(channels, list) or not all(isinstance(x, str) and x.strip() for x in channels):
        raise ValueError("sources.channels must be a non-empty array of strings")
    if not isinstance(keywords, list) or not all(isinstance(x, str) and x.strip() for x in keywords):
        raise ValueError("sources.keywords must be a non-empty array of strings")
    try:
        y = int(year_max)
    except Exception as e:
        raise ValueError(f"sources.year_max must be int: {e}")
    return ([c.strip() for c in channels], [k.strip() for k in keywords], y)


def _load_dataset_strict() -> Dict[str, Any]:
    data = _read_json_strict(DATASET_PATH)
    if not isinstance(data, dict):
        raise ValueError("dataset json must be an object")
    if "items" not in data or not isinstance(data.get("items"), list):
        raise ValueError("dataset.items must be an array")
    if len(data.get("items") or []) < 1:
        raise ValueError("dataset.items must not be empty")
    return data


def _merge_items(existing: List[Dict[str, Any]], new_items: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], int]:
    by_id: Dict[str, Dict[str, Any]] = {}
    for it in existing or []:
        try:
            vid = str(it.get("id") or "").strip()
            if not vid:
                continue
            if vid not in by_id:
                by_id[vid] = it
        except Exception:
            continue

    added = 0
    for it in new_items or []:
        vid = str(it.get("id") or "").strip()
        if not vid:
            continue
        if vid in by_id:
            continue
        by_id[vid] = it
        added += 1

    merged = list(by_id.values())

    def key(x: Dict[str, Any]):
        try:
            y = x.get("year")
            yy = int(y) if isinstance(y, int) or (isinstance(y, str) and y.strip().isdigit()) else 9999
        except Exception:
            yy = 9999
        vid = str(x.get("id") or "")
        return (yy, vid)

    merged.sort(key=key)
    if len(merged) > MAX_ITEMS:
        merged = merged[:MAX_ITEMS]
    return (merged, added)


def main() -> int:
    try:
        channels, keywords, year_max = _load_sources()
    except Exception as e:
        return _fatal(f"weather_history_sources.json invalid: {e}")

    try:
        dataset = _load_dataset_strict()
    except Exception as e:
        return _fatal(f"weather_history_videos.json invalid: {e}")

    api_key = str(os.getenv("YOUTUBE_API_KEY") or "").strip()
    if not api_key:
        print("SKIP: YOUTUBE_API_KEY missing; dataset unchanged")
        return 0

    published_before = f"{year_max + 1:04d}-01-01T00:00:00Z"

    collected: List[Dict[str, Any]] = []
    any_api_error = False

    for cid in channels:
        try:
            # Search is bounded to keep action runtime safe.
            ids = _collect_search_ids(api_key, cid, published_before_iso=published_before, pages_max=6)
            if not ids:
                continue
            details = _collect_video_details(api_key, ids)
            for v in details:
                try:
                    vid = str(v.get("id") or "").strip()
                    if not vid:
                        continue

                    status = v.get("status") if isinstance(v.get("status"), dict) else {}
                    if status.get("embeddable") is not True:
                        continue

                    snippet = v.get("snippet") if isinstance(v.get("snippet"), dict) else {}
                    published_at = str(snippet.get("publishedAt") or "").strip()
                    year = _safe_year(published_at)
                    if year is None or year > year_max:
                        continue

                    title = _norm(snippet.get("title") or "")
                    desc = _norm(snippet.get("description") or "")
                    if not title:
                        continue
                    if not _contains_keyword(title, desc, keywords):
                        continue

                    cd = v.get("contentDetails") if isinstance(v.get("contentDetails"), dict) else {}
                    dur_sec = _parse_iso8601_duration_to_sec(cd.get("duration") or "")
                    if dur_sec is None or dur_sec <= 0 or dur_sec > MAX_DURATION_SEC:
                        continue

                    rr = cd.get("regionRestriction") if isinstance(cd.get("regionRestriction"), dict) else None
                    if rr and (rr.get("blocked") or rr.get("allowed")):
                        continue

                    # Extra build-side embeddability gate (catches some API false-positives).
                    if not _is_embeddable_build_gate(vid):
                        continue

                    channel_title = _norm(snippet.get("channelTitle") or "")
                    collected.append(
                        {
                            "id": vid,
                            "year": int(year),
                            "source": _source_label(channel_title, title),
                            "title": title[:180],
                            "note": "Archivní předpověď",
                        }
                    )
                except Exception:
                    continue
        except Exception as e:
            any_api_error = True
            print(f"WARN: API failed for channel={cid} err={e}", file=sys.stderr)

    if any_api_error:
        print("WARN: API errors detected; dataset unchanged")
        return 0

    # Deduplicate within collected
    seen_new = set()
    collected2: List[Dict[str, Any]] = []
    for it in collected:
        vid = str(it.get("id") or "").strip()
        if not vid or vid in seen_new:
            continue
        seen_new.add(vid)
        collected2.append(it)

    existing_items = dataset.get("items") if isinstance(dataset.get("items"), list) else []
    merged, added = _merge_items(existing_items, collected2)

    if added <= 0:
        print("OK: no new videos; dataset unchanged")
        return 0

    if len(merged) < 1:
        return _fatal("refusing to write empty dataset")

    dataset_out = dict(dataset)
    dataset_out["items"] = merged
    dataset_out["updatedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    _atomic_write_json(DATASET_PATH, dataset_out)
    print(f"OK: added={added} total={len(merged)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

