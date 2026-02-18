#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Weather History auto-collector (build-time only).

Generates/updates:
  projects/data/weather_history_videos.json

Rules:
- No runtime API: build script only.
- Never delete old items.
- Never write empty dataset.
- If API fails or finds 0 new videos -> dataset stays unchanged (exit 0).
- If JSON read/parse fails -> exit 1.
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from typing import Dict, List, Optional

import requests


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES_PATH = os.path.join(ROOT_DIR, "projects", "data", "weather_history_sources.json")
DATASET_PATH = os.path.join(ROOT_DIR, "projects", "data", "weather_history_videos.json")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/121.0.0.0 Safari/537.36"
)

YT_API_BASE = "https://www.googleapis.com/youtube/v3"

MAX_TOTAL_ITEMS = 500
MAX_PAGES_PER_CHANNEL = 30  # playlistItems pages; bounds quota/time
MAX_CANDIDATES_PER_CHANNEL = 400  # pre-filtered by year+keywords from playlist


def _atomic_write_json(path: str, payload) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def _read_json_strict(path: str):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _iso_to_dt(iso: str) -> Optional[datetime]:
    try:
        if not iso:
            return None
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return None


def _valid_yt_id(video_id: str) -> bool:
    v = str(video_id or "").strip()
    return bool(re.match(r"^[0-9A-Za-z_-]{11}$", v))


def _valid_channel_id(channel_id: str) -> bool:
    c = str(channel_id or "").strip()
    return bool(re.match(r"^UC[0-9A-Za-z_-]{22}$", c))


def _kw_match(text: str, keywords: List[str]) -> bool:
    try:
        t = str(text or "").lower()
        if not t:
            return False
        for k in keywords or []:
            s = str(k or "").strip().lower()
            if not s:
                continue
            if s in t:
                return True
        return False
    except Exception:
        return False


def _infer_source(channel_title: str, fallback: str = "YouTube") -> str:
    t = str(channel_title or "").strip()
    if not t:
        return fallback
    tl = t.lower()
    if "bbc" in tl:
        return "BBC"
    if "weather channel" in tl or "the weather channel" in tl:
        return "Weather Channel"
    if "česk" in tl or "cesk" in tl or "čt" in tl or "ct" in tl:
        return "ČT"
    return t


def _parse_yt_duration_iso8601(d: str) -> int:
    """
    Parse ISO 8601 duration like PT13M55S into seconds.
    Returns 0 on failure.
    """
    try:
        s = str(d or "").strip().upper()
        if not s.startswith("PT"):
            return 0
        s = s[2:]
        total = 0
        num = ""
        for ch in s:
            if ch.isdigit():
                num += ch
                continue
            if not num:
                continue
            n = int(num)
            num = ""
            if ch == "H":
                total += n * 3600
            elif ch == "M":
                total += n * 60
            elif ch == "S":
                total += n
        return total if total >= 0 else 0
    except Exception:
        return 0


def _yt_api_get(api_key: str, path: str, params: Dict[str, str]):
    url = f"{YT_API_BASE}/{path.lstrip('/')}"
    p = dict(params or {})
    p["key"] = api_key
    r = requests.get(url, params=p, headers={"User-Agent": USER_AGENT}, timeout=20)
    if r.status_code != 200:
        raise RuntimeError(f"yt_api_http_{r.status_code}: {url}")
    try:
        return r.json()
    except Exception as e:
        raise RuntimeError(f"yt_api_bad_json: {e}") from e


def _get_channel_uploads_playlist(api_key: str, channel_id: str) -> Dict[str, str]:
    data = _yt_api_get(
        api_key,
        "channels",
        {
            "part": "snippet,contentDetails",
            "id": channel_id,
            "maxResults": "1",
        },
    )
    items = data.get("items") if isinstance(data, dict) else None
    items = items if isinstance(items, list) else []
    if not items:
        return {}
    it = items[0] if isinstance(items[0], dict) else {}
    title = ((it.get("snippet") or {}).get("title") or "").strip()
    uploads = (((it.get("contentDetails") or {}).get("relatedPlaylists") or {}).get("uploads") or "").strip()
    if not uploads:
        return {}
    return {"uploadsPlaylistId": uploads, "channelTitle": title}


def _playlist_candidates(
    api_key: str,
    uploads_playlist_id: str,
    keywords: List[str],
    year_max: int,
) -> List[Dict[str, str]]:
    out = []
    page_token = ""
    pages = 0

    while pages < MAX_PAGES_PER_CHANNEL and len(out) < MAX_CANDIDATES_PER_CHANNEL:
        pages += 1
        params = {
            "part": "snippet,contentDetails",
            "playlistId": uploads_playlist_id,
            "maxResults": "50",
        }
        if page_token:
            params["pageToken"] = page_token
        data = _yt_api_get(api_key, "playlistItems", params)

        items = data.get("items") if isinstance(data, dict) else None
        items = items if isinstance(items, list) else []

        for it in items:
            if not isinstance(it, dict):
                continue
            sn = it.get("snippet") if isinstance(it.get("snippet"), dict) else {}
            cd = it.get("contentDetails") if isinstance(it.get("contentDetails"), dict) else {}
            vid = (cd.get("videoId") or "").strip()
            if not _valid_yt_id(vid):
                continue
            title = (sn.get("title") or "").strip()
            published_at = (sn.get("publishedAt") or cd.get("videoPublishedAt") or "").strip()
            dt = _iso_to_dt(published_at)
            if not dt:
                continue
            year = dt.year
            if year > year_max:
                continue
            if not _kw_match(title, keywords):
                continue
            out.append({"id": vid, "title": title, "publishedAt": published_at})
            if len(out) >= MAX_CANDIDATES_PER_CHANNEL:
                break

        page_token = str(data.get("nextPageToken") or "").strip()
        if not page_token:
            break

    return out


def _videos_details(
    api_key: str,
    video_ids: List[str],
) -> Dict[str, dict]:
    ids = [str(x or "").strip() for x in (video_ids or []) if _valid_yt_id(x)]
    uniq = []
    seen = set()
    for v in ids:
        if v in seen:
            continue
        seen.add(v)
        uniq.append(v)

    out: Dict[str, dict] = {}
    for i in range(0, len(uniq), 50):
        chunk = uniq[i : i + 50]
        data = _yt_api_get(
            api_key,
            "videos",
            {
                "part": "snippet,contentDetails,status",
                "id": ",".join(chunk),
                "maxResults": "50",
            },
        )
        items = data.get("items") if isinstance(data, dict) else None
        items = items if isinstance(items, list) else []
        for it in items:
            if not isinstance(it, dict):
                continue
            vid = str(it.get("id") or "").strip()
            if not _valid_yt_id(vid):
                continue
            out[vid] = it
    return out


def _is_region_ok_for_cz(video_obj: dict) -> bool:
    try:
        cd = video_obj.get("contentDetails") if isinstance(video_obj.get("contentDetails"), dict) else {}
        rr = cd.get("regionRestriction") if isinstance(cd.get("regionRestriction"), dict) else {}
        blocked = rr.get("blocked") if isinstance(rr.get("blocked"), list) else []
        allowed = rr.get("allowed") if isinstance(rr.get("allowed"), list) else []
        blocked = [str(x or "").strip().upper() for x in blocked if str(x or "").strip()]
        allowed = [str(x or "").strip().upper() for x in allowed if str(x or "").strip()]
        if "CZ" in blocked:
            return False
        if allowed and "CZ" not in allowed:
            return False
        return True
    except Exception:
        return True


def build_weather_history(api_key: str, cfg: dict, existing: dict) -> dict:
    channels = cfg.get("channels") if isinstance(cfg.get("channels"), list) else []
    keywords = cfg.get("keywords") if isinstance(cfg.get("keywords"), list) else []
    try:
        year_max = int(cfg.get("year_max") or 2010)
    except Exception:
        year_max = 2010

    existing_items = existing.get("items") if isinstance(existing, dict) else None
    existing_items = existing_items if isinstance(existing_items, list) else []
    existing_by_id: Dict[str, dict] = {}
    for it in existing_items:
        if not isinstance(it, dict):
            continue
        vid = str(it.get("id") or "").strip()
        if not vid:
            continue
        if vid not in existing_by_id:
            existing_by_id[vid] = it

    new_items: List[dict] = []

    # Collect candidates per channel
    for raw_c in channels:
        cid = str(raw_c or "").strip()
        if not cid:
            continue
        if not _valid_channel_id(cid):
            print(f"WARN: invalid channel id: {cid}")
            continue

        ch = _get_channel_uploads_playlist(api_key, cid)
        upl = str(ch.get("uploadsPlaylistId") or "").strip()
        ch_title = str(ch.get("channelTitle") or "").strip()
        if not upl:
            print(f"WARN: missing uploads playlist for channel: {cid}")
            continue

        candidates = _playlist_candidates(api_key, upl, keywords, year_max)
        if not candidates:
            continue

        cand_ids = [c["id"] for c in candidates if c.get("id")]
        details = _videos_details(api_key, cand_ids)

        for c in candidates:
            vid = str(c.get("id") or "").strip()
            if not _valid_yt_id(vid):
                continue
            if vid in existing_by_id:
                continue
            vobj = details.get(vid)
            if not isinstance(vobj, dict):
                continue

            sn = vobj.get("snippet") if isinstance(vobj.get("snippet"), dict) else {}
            st = vobj.get("status") if isinstance(vobj.get("status"), dict) else {}
            cd = vobj.get("contentDetails") if isinstance(vobj.get("contentDetails"), dict) else {}

            # Published year gate
            published_at = str(sn.get("publishedAt") or c.get("publishedAt") or "").strip()
            dt = _iso_to_dt(published_at)
            if not dt:
                continue
            year = dt.year
            if year > year_max:
                continue

            # Keyword gate (title + description)
            title = str(sn.get("title") or c.get("title") or "").strip()
            desc = str(sn.get("description") or "").strip()
            if not (_kw_match(title, keywords) or _kw_match(desc, keywords)):
                continue

            # Embeddable + public
            if st.get("embeddable") is not True:
                continue
            if str(st.get("privacyStatus") or "").strip().lower() != "public":
                continue

            # Region gate (CZ)
            if not _is_region_ok_for_cz(vobj):
                continue

            # Duration gate (< 15 min)
            dur_sec = _parse_yt_duration_iso8601(str(cd.get("duration") or ""))
            if dur_sec <= 0:
                continue
            if dur_sec >= 15 * 60:
                continue

            source = _infer_source(ch_title, fallback="YouTube")
            new_items.append(
                {
                    "id": vid,
                    "year": year,
                    "source": source,
                    "title": title if title else f"{source} Weather {year}",
                    "note": "Archivní předpověď",
                }
            )

    if not new_items:
        # no update
        return {}

    merged_by_id = dict(existing_by_id)
    for it in new_items:
        vid = str(it.get("id") or "").strip()
        if not vid:
            continue
        if vid in merged_by_id:
            continue
        merged_by_id[vid] = it

    merged_items = list(merged_by_id.values())

    def _sort_key(it: dict):
        try:
            y = int(it.get("year") or 0)
        except Exception:
            y = 0
        return (
            y,
            str(it.get("source") or ""),
            str(it.get("title") or ""),
            str(it.get("id") or ""),
        )

    merged_items.sort(key=_sort_key)

    if len(merged_items) > MAX_TOTAL_ITEMS:
        merged_items = merged_items[:MAX_TOTAL_ITEMS]

    # Never write empty dataset
    if not merged_items:
        raise RuntimeError("refusing to write empty dataset")

    out = {
        "version": int(existing.get("version") or 1) if isinstance(existing, dict) else 1,
        "title": str(existing.get("title") or "Návrat do historie počasí") if isinstance(existing, dict) else "Návrat do historie počasí",
        "items": merged_items,
    }
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-key", default="", help="YouTube Data API key (or env YOUTUBE_API_KEY)")
    args = ap.parse_args()

    api_key = (str(args.api_key or "").strip() or str(os.getenv("YOUTUBE_API_KEY") or "").strip())
    if not api_key:
        print("WARN: missing YOUTUBE_API_KEY; skipping update (dataset unchanged)")
        return 0

    # strict JSON reads
    try:
        cfg = _read_json_strict(SOURCES_PATH)
    except Exception as e:
        print(f"ERROR: sources JSON error: {e}", file=sys.stderr)
        return 1

    try:
        existing = _read_json_strict(DATASET_PATH)
    except Exception as e:
        print(f"ERROR: dataset JSON error: {e}", file=sys.stderr)
        return 1

    try:
        out = build_weather_history(api_key, cfg, existing)
        if not out:
            print("OK: no new videos found; dataset unchanged")
            return 0
        _atomic_write_json(DATASET_PATH, out)
        print(f"OK: updated dataset items={len(out.get('items') or [])}")
        return 0
    except Exception as e:
        # Safety gate: do not modify dataset on API failure. (We only write at the end.)
        print(f"WARN: collector failed; dataset unchanged: {e}")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())

