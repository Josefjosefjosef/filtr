#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Weather History — auto collector (YouTube RSS/Atom + oEmbed) + legal-safe auto SEO.

Hard requirements:
- No YouTube Data API (no keys), no runtime API; build-time only.
- RSS sources must be real (provided in projects/data/weather_history_sources.json).
- Fail-safe: if anything fails OR nothing new to add -> dataset is NOT modified.
- Dataset never becomes empty.
- Max 500 items (deterministic trim).
- Every NEW item gets a deterministic, template-based SEO block (no Wikipedia text).

Dataset file (single allowed output):
  projects/data/weather_history_videos.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode

import requests

_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)
from iu_blocked_sources import iu_is_blocked_pocasicko_source
import xml.etree.ElementTree as ET


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES_PATH = os.path.join(ROOT_DIR, "projects", "data", "weather_history_sources.json")
DATASET_PATH = os.path.join(ROOT_DIR, "projects", "data", "weather_history_videos.json")

# Bootstrap item required by the spec (only used when dataset is missing).
BOOTSTRAP_ITEM = {
    "id": "5LDEmWXINg0",
    "year": 1992,
    "source": "BBC",
    "title": "BBC1 Weather – 27 September 1992",
    "note": "Archivní televizní předpověď počasí.",
    "seo": {
        "h2": "Počasí v roce 1992 – jak se předpovídalo a co bylo jiné než dnes",
        "intro": "Dnešní archivní video ukazuje, jak se předpověď počasí prezentovala v době před moderními radarovými vrstvami a běžně dostupnými modely v mobilu.",
        "body": (
            "V devadesátých letech se televizní počasí opíralo o jednodušší grafiku a menší množství veřejně dostupných dat. "
            "Přesto už tehdy meteorologové vysvětlovali tlakové útvary, fronty a základní trend vývoje. "
            "Dnes máme satelitní snímky, radar srážek v reálném čase a numerické modely s hodinovým krokem. "
            "Při srovnání „tehdy vs. dnes“ si všímejte hlavně toho, jak se změnila grafika map, tempo vysvětlování a důraz na varování před extrémy "
            "(bouřky, vítr, náledí). Tato sekce každý den vybírá jiné historické video, aby bylo možné sledovat vývoj meteorologie i mediální prezentace počasí "
            "napříč roky a dekádami."
        ),
        "bullets": [
            "Grafika map a symboly počasí se výrazně změnily.",
            "Dnešní předpověď používá radar, satelity a numerické modely.",
            "Varování před extrémy je dnes rychlejší a přesnější.",
        ],
        "closing": "Zítra tu najdete další historickou předpověď – vraťte se a porovnejte další rok.",
    },
}

UA = "infoUzelBot/1.0 (+https://infouzel.cz/projects/bot/)"
BOT_FROM_HEADER = "admin@infouzel.cz"

MAX_OEMBED_WORKERS = 3  # hard cap


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


def _clamp_int(x: Any, lo: int, hi: int, default: int) -> int:
    try:
        v = int(x)
        if v < lo:
            return lo
        if v > hi:
            return hi
        return v
    except Exception:
        return default


def _safe_fetch_text(url: str, timeout_sec: int) -> Optional[str]:
    try:
        r = requests.get(url, headers={"User-Agent": UA, "From": BOT_FROM_HEADER}, timeout=timeout_sec)
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


def _oembed_embeddable(video_id: str, timeout_sec: int) -> bool:
    vid = str(video_id or "").strip()
    if not vid:
        return False

    with _OEMBED_LOCK:
        if vid in _OEMBED_CACHE:
            return bool(_OEMBED_CACHE[vid])

    try:
        qs = urlencode({"url": f"https://www.youtube.com/watch?v={vid}", "format": "json"})
        url = f"https://www.youtube.com/oembed?{qs}"
        r = requests.get(url, headers={"User-Agent": UA, "From": BOT_FROM_HEADER}, timeout=timeout_sec)
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


def _weather_history_item_blocked(it: Dict[str, Any]) -> bool:
    if not isinstance(it, dict):
        return False
    parts: List[str] = [
        str(it.get("source") or ""),
        str(it.get("title") or ""),
        str(it.get("note") or ""),
    ]
    seo = it.get("seo")
    if isinstance(seo, dict):
        for k in ("h2", "intro", "body", "closing"):
            parts.append(str(seo.get(k) or ""))
        bl = seo.get("bullets")
        if isinstance(bl, list):
            parts.extend(str(x) for x in bl)
    return iu_is_blocked_pocasicko_source(*parts)


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
        if _weather_history_item_blocked(it):
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


def _safe_text(s: Any, max_len: int) -> str:
    try:
        t = str(s or "").strip()
        t = re.sub(r"\s+", " ", t)
        if len(t) > max_len:
            t = t[: max_len - 1].rstrip() + "…"
        return t
    except Exception:
        return ""


def _decade_label(year: int) -> str:
    try:
        d = (int(year) // 10) * 10
        return f"{d}s"
    except Exception:
        return "minulosti"


def gen_seo(item: Dict[str, Any]) -> Dict[str, Any]:
    year = int(item.get("year") or 0) or 0
    source = _safe_text(item.get("source") or "YouTube", 60) or "YouTube"
    title = _safe_text(item.get("title") or "Historická předpověď počasí", 140) or "Historická předpověď počasí"

    decade = (year // 10) * 10 if year else 0
    decade_txt = _decade_label(year) if year else "minulosti"

    if decade and decade <= 1960:
        era = "raného televizního vysílání"
        era2 = "jednodušší studiové mapy a ruční práce se symboly"
    elif decade and decade <= 1980:
        era = "éry studiových map"
        era2 = "magnetické symboly, přehledná grafika a stručné vysvětlování"
    elif decade and decade <= 1990:
        era = "přelomu analogové a počítačové grafiky"
        era2 = "postupný nástup počítačových map a konzistentnějších vrstev"
    elif decade and decade <= 2000:
        era = "nástupu internetu pro veřejnost"
        era2 = "radarové a satelitní produkty se staly dostupnějšími"
    else:
        era = "modernějšího období"
        era2 = "kombinace televizní grafiky a online dat"

    h2 = (
        f"Počasí v roce {year} – historická předpověď ({source}) a srovnání s dneškem"
        if year
        else f"Historické předpovědi počasí – archiv počasí ({source})"
    )

    intro = (
        f"Tento archivní záznam ({title}) připomíná, jak se předpověď počasí vysvětlovala v {era}. "
        "Vedle nostalgie je to i praktické srovnání: co se změnilo v datech, mapách, přesnosti a ve varování před extrémy."
    )

    # Core topic blocks (own wording, no Wikipedia text). Keep deterministic and long enough.
    blocks: List[str] = []
    blocks.append(
        "Historie meteorologie v ČR má silnou tradici měření i interpretace počasí. "
        "Základní pojmy (tlaková výše a níže, fronty, proudění) jsou stejné dnes i v historických předpovědích počasí, "
        "mění se však kvalita vstupních dat, hustota stanic a rychlost aktualizací."
    )
    blocks.append(
        "Klementinum v Praze je často zmiňované jako symbol dlouhodobých pozorování – měření se zde tradičně uvádí od roku 1775. "
        "Smysl dlouhých řad není v jedné hodnotě, ale v kontextu: umožňují srovnávat typické průběhy a extrémy napříč dekádami."
    )
    blocks.append(
        "Vývoj grafiky map počasí je vidět na první pohled. "
        f"V období {decade_txt} bývala grafika {era2}. "
        "Dnes mapy často navazují na numerické modely a přidávají vrstvy jako srážky, vítr, teplotu nebo výstrahy."
    )
    blocks.append(
        "Satelity a radary zásadně proměnily praxi. Satelitní snímky dávají přehled o oblačnosti a frontálních systémech, "
        "radar poskytuje informace o srážkách v reálném čase. "
        "Díky tomu je možné lépe sledovat rychlé jevy, jako jsou bouřky nebo přívalové srážky."
    )
    blocks.append(
        "Extrémní počasí (bouře, povodně, vichřice, mrazy, vlny veder) je téma, které v předpovědích nikdy nezmizelo. "
        "Rozdíl je v tom, jak rychle se informace šíří a jak přesně lze rizika regionálně upřesnit. "
        "Moderní výstrahy jsou detailnější a častěji aktualizované, ale i historické záznamy ukazují, co bylo pro lidi důležité."
    )
    blocks.append(
        "Nejchladnější zimy se v paměti často připomínají jako období dlouhých mrazů a sněhových epizod. "
        "Bez ohledu na konkrétní roky platí, že dlouhá měření pomáhají odlišit výjimečnou epizodu od běžné variability. "
        "Archiv počasí tak slouží i jako „časová osa“ toho, jak se o zimě a mrazech mluvilo v různých obdobích."
    )
    blocks.append(
        "Tato stránka staví na jednoduchém principu: historické předpovědi počasí vybíráme automaticky a deterministicky, "
        "aby stejný den znamenal stejné video a současně se obsah v čase obměňoval. "
        "Vedle videa se vždy objeví i doprovodný text, který shrnuje kontext a klíčová témata (meteorologie ČR, rosničky, archiv počasí)."
    )
    blocks.append(
        "Rosničky a televizní počasí jsou součástí kulturní paměti. "
        "Když dnes porovnáváme historické předpovědi s aktuálními mapami, nejde jen o design, ale i o způsob vysvětlování: "
        "tempo, regionální členění a důraz na praktické dopady."
    )

    body = "\n\n".join(blocks)

    # Ensure body length target 2500–6000 chars by deterministic padding with safe, non-duplicated phrasing.
    if len(body) < 2500:
        pad = (
            "Tip pro sledování: všímejte si, jak se v různých dekádách mění slovník (fronta, tlak, oblačnost), "
            "jaké symboly se používají na mapě a jak se popisuje nejistota. "
            "Právě tato kombinace videa a vlastního vysvětlujícího textu dělá z archivu počasí užitečný zdroj i mimo dnešní předpověď."
        )
        while len(body) < 2500:
            body = body + "\n\n" + pad
    if len(body) > 6000:
        body = body[:5995].rstrip() + "…"

    bullets = [
        "Historické předpovědi počasí ukazují vývoj grafiky map a komunikace.",
        "Moderní meteorologie stojí na radaru, satelitech a numerických modelech.",
        "Dlouhá měření (např. Klementinum) dávají kontext pro extrémy i běžné dny.",
    ]

    closing = (
        "Zítra tu bude další archiv počasí: jiné video, jiná dekáda a další srovnání „tehdy vs. dnes“."
    )

    return {"h2": h2, "intro": intro, "body": body, "bullets": bullets, "closing": closing}


def _ensure_item_seo(it: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(it, dict):
        return {}
    seo = it.get("seo")
    if isinstance(seo, dict) and seo.get("h2") and seo.get("body"):
        return it
    it["seo"] = gen_seo(it)
    return it


def _dataset_skeleton() -> Dict[str, Any]:
    return {"version": 1, "title": "Návrat do historie počasí", "items": [BOOTSTRAP_ITEM]}


def run_backfill_seo_only() -> int:
    # Only used manually for seeding; CI workflow does NOT use this mode.
    if not os.path.exists(DATASET_PATH):
        _atomic_write_json(DATASET_PATH, _dataset_skeleton())
        print("backfill_seo_only=created_dataset")
        return 0
    try:
        dataset = _load_json(DATASET_PATH)
    except Exception as e:
        _eprint(f"ERROR: dataset_json_error err={e}")
        return 1
    items, _ = _normalize_existing_items(dataset.get("items"))
    if not items:
        items = [BOOTSTRAP_ITEM]
    out = []
    for it in items:
        out.append(_ensure_item_seo(it))
    out.sort(key=_sort_key_year_then_id)
    payload = {
        "version": int(dataset.get("version") or 1),
        "title": str(dataset.get("title") or "Návrat do historie počasí"),
        "items": out,
    }
    _atomic_write_json(DATASET_PATH, payload)
    print(f"backfill_seo_only=ok items={len(out)}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backfill-seo", action="store_true", help="Seed/fill missing seo blocks (manual use).")
    args = ap.parse_args()

    if args.backfill_seo:
        return run_backfill_seo_only()

    # Load sources allowlist (strict).
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

    year_max = _clamp_int(cfg.get("year_max"), 1900, 2100, 2012)
    max_add = _clamp_int(cfg.get("max_add_per_run"), 0, 50, 10)
    max_total = _clamp_int(cfg.get("max_total_items"), 1, 500, 500)
    timeout_sec = _clamp_int(cfg.get("timeout_seconds"), 3, 20, 12)

    sources_total = len(sources)
    sources_ok = 0
    rss_items_seen = 0

    raw_candidates: List[Dict[str, Any]] = []
    seen_ids_run = set()

    for src in sources:
        try:
            if not isinstance(src, dict):
                continue
            rss = str(src.get("rss") or "").strip()
            label = str(src.get("sourceLabel") or "").strip() or str(src.get("name") or "").strip() or "YouTube"
            if not rss:
                continue
            xml_text = _safe_fetch_text(rss, timeout_sec)
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
                    if vid in seen_ids_run:
                        continue
                    if year > year_max:
                        continue
                    if keywords_any and (not _kw_any(title, keywords_any)):
                        continue
                    if keywords_none and _kw_none(title, keywords_none):
                        continue
                    if iu_is_blocked_pocasicko_source(label, title):
                        continue
                    seen_ids_run.add(vid)
                    raw_candidates.append({"id": vid, "year": year, "title": title, "source": label})
                except Exception:
                    continue
        except Exception as e:
            print(f"WARN: source_exception err={e}")
            continue

    candidates_after_filters = len(raw_candidates)

    def print_counters(embeddable_ok: int, added_count: int, total_after: int) -> None:
        print(f"sources_total={sources_total}")
        print(f"sources_ok={sources_ok}")
        print(f"rss_items_seen={rss_items_seen}")
        print(f"candidates_after_filters={candidates_after_filters}")
        print(f"embeddable_ok={embeddable_ok}")
        print(f"added_count={added_count}")
        print(f"total_after={total_after}")

    # FAIL-SAFE: if all RSS failed/parsed to 0 -> do nothing (exit 0).
    if rss_items_seen == 0:
        print_counters(embeddable_ok=0, added_count=0, total_after=0)
        print("NO UPDATE")
        return 0

    # Load existing dataset (strict JSON if exists).
    if os.path.exists(DATASET_PATH):
        try:
            dataset = _load_json(DATASET_PATH)
        except Exception as e:
            _eprint(f"ERROR: dataset_json_error err={e}")
            return 1
    else:
        dataset = _dataset_skeleton()

    existing_items, existing_ids = _normalize_existing_items(dataset.get("items"))
    if not existing_items:
        existing_items = [BOOTSTRAP_ITEM]
        existing_ids = {BOOTSTRAP_ITEM["id"]}

    # Deterministic ordering for candidate checks and additions.
    raw_candidates.sort(key=lambda x: (int(x.get("year") or 9999), str(x.get("id") or "")))

    # Bound work to keep CI stable.
    max_checks = min(len(raw_candidates), max(0, max_add * 20))
    to_check = raw_candidates[:max_checks]

    embeddable_ok = 0
    embeddable_candidates: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=MAX_OEMBED_WORKERS) as ex:
        fut_map = {ex.submit(_oembed_embeddable, c["id"], timeout_sec): c for c in to_check}
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

    # FAIL-SAFE: if nothing embeddable -> do nothing.
    if embeddable_ok == 0:
        print_counters(embeddable_ok=0, added_count=0, total_after=len(existing_items))
        print("NO UPDATE")
        return 0

    embeddable_candidates.sort(key=lambda x: (int(x.get("year") or 9999), str(x.get("id") or "")))

    added: List[Dict[str, Any]] = []
    for c in embeddable_candidates:
        if len(added) >= max_add:
            break
        if iu_is_blocked_pocasicko_source(str(c.get("source") or ""), str(c.get("title") or "")):
            continue
        vid = str(c.get("id") or "").strip()
        if not vid or vid in existing_ids:
            continue
        item = {
            "id": vid,
            "year": int(c.get("year") or 0),
            "source": _safe_text(c.get("source") or "YouTube", 60) or "YouTube",
            "title": _safe_text(c.get("title") or "", 180),
            "note": "Archivní předpověď počasí (auto).",
        }
        item["seo"] = gen_seo(item)
        added.append(item)
        existing_ids.add(vid)

    added_count = len(added)
    if added_count == 0:
        print_counters(embeddable_ok=embeddable_ok, added_count=0, total_after=len(existing_items))
        print("NO UPDATE")
        return 0

    merged = list(existing_items) + added

    # Ensure every item has SEO (for compatibility with runtime task 4).
    merged2: List[Dict[str, Any]] = []
    for it in merged:
        if not isinstance(it, dict):
            continue
        merged2.append(_ensure_item_seo(it))

    merged2.sort(key=_sort_key_year_then_id)
    if len(merged2) > max_total:
        merged2 = merged2[-max_total:]

    total_after = len(merged2)
    if total_after <= 0:
        _eprint("ERROR: would_write_empty_dataset")
        return 1

    # Validate uniqueness after merge.
    seen = set()
    for it in merged2:
        vid = str((it or {}).get("id") or "").strip()
        if not vid or vid in seen:
            _eprint("ERROR: duplicate_or_missing_id_after_merge")
            return 1
        seen.add(vid)

    payload = {
        "version": int(dataset.get("version") or 1),
        "title": str(dataset.get("title") or "Návrat do historie počasí"),
        "items": merged2,
    }

    _atomic_write_json(DATASET_PATH, payload)
    print_counters(embeddable_ok=embeddable_ok, added_count=added_count, total_after=total_after)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

