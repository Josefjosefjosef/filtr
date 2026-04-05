#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_articles_v2.py - Profesionální verze s data layer, fetch engine, validací
END-TO-END pipeline: sources → fetch → normalize/dedupe → validate → write(next) → promote(prod) → update(lkg) → health

NOTE: Production CI uses scripts/build_articles.py (source ingest → staging → aggregate → publish).
This file is legacy / experimental; do not wire it into workflows alongside build_articles.py.
"""

import json
import os
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

import feedparser

# Nové komponenty
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from data_layer import DataLayer
from fetch_engine import FetchEngine
from json_validator import JSONValidator
from health_reporter import HealthReporter

# =========================
# Konfigurace
# =========================

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES_PATH = os.path.join(ROOT_DIR, "config", "sources.json")
CONFIG_PATH = os.path.join(ROOT_DIR, "config", "pipeline_config.json")

# Data layer
DATA_BASE_DIR = os.path.join(ROOT_DIR, "filtr", "data")
data_layer = DataLayer(DATA_BASE_DIR)

# Fetch engine
fetch_engine = FetchEngine()

# Validator
validator = JSONValidator()

# Health reporter
health_reporter = HealthReporter(Path(DATA_BASE_DIR) / "health")

# Načtení konfigurace
def load_config():
    """Načte pipeline_config.json"""
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {
        "health_gate": {"min_articles": 50, "min_videos": 10, "min_sources_ok": 5},
        "limits": {"max_items_per_feed": 40, "max_output_articles": 220, "max_output_videos": 120},
        "clustering": {"jaccard_threshold": 0.56},
        "releases": {"retention_count": 30}
    }

config = load_config()

# Limity z konfigurace
MAX_ITEMS_PER_FEED = config["limits"]["max_items_per_feed"]
MAX_OUTPUT_ARTICLES = config["limits"]["max_output_articles"]
MAX_OUTPUT_VIDEOS = config["limits"]["max_output_videos"]
CLUSTER_JACCARD_THRESHOLD = config["clustering"]["jaccard_threshold"]
MAX_PER_DOMAIN_PER_RUN = 60

# Health gate prahy
MIN_ARTICLES = config["health_gate"]["min_articles"]
MIN_VIDEOS = config["health_gate"]["min_videos"]
MIN_SOURCES_OK = config["health_gate"]["min_sources_ok"]

STOPWORDS_CS = {
    "a","i","v","ve","na","do","z","ze","u","o","od","po","za","pro","se","si","k","ke","s","by","aby","že",
    "jsou","je","byl","byla","bylo","budou","bude","může","mohou","mohl","mohla","mohlo",
    "jak","kdy","kde","co","kdo","který","která","které","kterou","kterým","kterými",
    "ani","ne","není","bez","pod","nad","před","přes","mezi","dál","více","méně","už","teď","dnes",
}

TITLE_PREFIX_STRIP = [
    r"^\s*ANAL[YÝ]ZA\s*:\s*",
    r"^\s*RECENZE\s*:\s*",
    r"^\s*FOTO\s*:\s*",
    r"^\s*VIDEO\s*:\s*",
    r"^\s*ONLINE\s*:\s*",
    r"^\s*LM\s+ONLINE\s*:\s*",
    r"^\s*ŽIV[EĚ]\s*:\s*",
    r"^\s*PODCAST\s*:\s*",
]

KW_DOPRAVA = {
    "dálnice","dálnici","d1","d2","d3","d5","d8","d10","d11",
    "nehoda","havarie","srážka","karambol","kolona","uzavřela","uzavřená","uzavírka","objížďka",
    "kamion","dodávka","metro","tramvaj","autobus","vlak","železnic","kolejiště","letadlo","letiště",
    "etcs","správa železnic","tunel","most","přejezd","řidič","řidička",
}

KW_POCASI = {
    "počasí","mráz","mrzne","ledovka","námraza","sníh","sněžení","blizard","vítr","bouře","výstraha",
    "teplot","stupň","předpověď","chmu","meteorolog","tání","náledí",
}

KW_FINANCE = {
    "akcie","burza","invest","dluhopis","úrok","sazby","inflace","zisk","ztrát","tržb","čez","koruna","kurz",
    "davos","fond","valuace","prospekt","ipo","bank","měna","trh","byznys","ekonom","reality","stavebnictv",
    "jackpot","sportka","loterie",
}

KW_SPORT = {
    "liga","mistrů","zápas","gól","hokej","fotbal","tenis","biatlon","olymp","nhl","f1","grand slam",
    "extraliga","kvalifik","turnaj","trenér","brankář","střelec",
}

KW_KRIMI = {
    "policie","soud","obvin","trest","vězení","zavražd","vražd","pobod","střelb","přestřelk","únos","drogy","kokain",
    "krádež","loupež","podvod","útok","napadl","znásiln","střelba","pachatel","obžal",
}

KW_ZDRAVI = {
    "zdraví","zdravi","lékař","lekar","doktor","nemoc","nemocn","chirurg","operac","kloub","očkov","vakc",
    "epidemi","chřipk","chripk","covid","nádor","rakovin","psych","terapi","rehabilit","prevence","ambul",
    "nemocnic","pacient","ordinac","lék","lek",
}

SECTION_ORDER = ["pocasi", "doprava", "aktualne", "krimi", "zdravi", "finance", "sport"]
VALID_SECTIONS = {"pocasi","doprava","aktualne","krimi","finance","sport","zdravi"}


# =========================
# Utility funkce
# =========================

def iso_now_z() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def parse_dt(entry) -> datetime:
    t = None
    if getattr(entry, "published_parsed", None):
        t = entry.published_parsed
    elif getattr(entry, "updated_parsed", None):
        t = entry.updated_parsed
    if t:
        return datetime.fromtimestamp(time.mktime(t), tz=timezone.utc)
    return datetime.now(timezone.utc)

def canonicalize_url(url: str) -> str:
    try:
        p = urlparse(url)
        fragment = ""
        q = []
        for k, v in parse_qsl(p.query, keep_blank_values=True):
            lk = k.lower()
            if lk.startswith("utm_"):
                continue
            if lk in {"fbclid", "gclid", "yclid", "cmpid", "pk_campaign", "pk_source"}:
                continue
            q.append((k, v))
        query = urlencode(q, doseq=True)
        return urlunparse((p.scheme, p.netloc, p.path, p.params, query, fragment))
    except Exception:
        return url

def normalize_media_name(name: str) -> str:
    for sep in [" – ", " — ", " - "]:
        if sep in name:
            return name.split(sep, 1)[0].strip()
    return name.strip()

def clean_title_basic(title: str) -> str:
    t = (title or "").strip()
    for rx in TITLE_PREFIX_STRIP:
        t = re.sub(rx, "", t, flags=re.IGNORECASE)
    t = re.sub(r"\s*(\.\.\.|…)\s*$", "", t)
    t = re.sub(r"\s*\.\s*$", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    t = t.strip("' \"")
    t = re.sub(r"\?\s*$", "", t).strip()
    return t

def tokenize_title(title: str) -> set:
    t = clean_title_basic(title).lower()
    t = re.sub(r"[^0-9a-zá-ž]+", " ", t, flags=re.IGNORECASE)
    parts = [p.strip() for p in t.split() if p.strip()]
    tokens = set()
    for p in parts:
        if p in STOPWORDS_CS:
            continue
        if len(p) <= 2:
            continue
        tokens.add(p)
    return tokens

def jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    uni = len(a | b)
    return inter / uni if uni else 0.0

def _host_path(url: str) -> tuple:
    try:
        p = urlparse(url or "")
        return (p.netloc.lower(), p.path.lower())
    except Exception:
        return ("", "")

def infer_section(url: str, title: str, fallback_topic: str) -> str:
    t = (title or "").lower()
    host, path = _host_path(url)
    
    if "pocasi" in host or "/pocasi" in path or "/pocasi-" in path or path.startswith("/pocasi"):
        return "pocasi"
    if "doprava" in host or "/doprava" in path or "/auto" in path or "/nehody" in path or "/nehoda" in path:
        return "doprava"
    if host.startswith("sport.") or "/sport" in path or "/fotbal" in path or "/hokej" in path or "/tenis" in path:
        return "sport"
    if "/ekonomika" in path or "/finance" in path or "/byznys" in path or "/byznys/" in path or "/reality" in path:
        return "finance"
    if host.startswith("byznys.") or host.startswith("ekonomika.") or host.startswith("finance."):
        return "finance"
    if "/krimi" in path or "/crime" in path:
        return "krimi"
    if "/zdravi" in path or "/zdrav" in path or "zdravi" in host:
        return "zdravi"
    
    def contains_kw(kwset: set) -> bool:
        for k in kwset:
            if k in t:
                return True
        return False
    
    if contains_kw(KW_POCASI):
        return "pocasi"
    if contains_kw(KW_DOPRAVA):
        return "doprava"
    if contains_kw(KW_ZDRAVI):
        return "zdravi"
    if contains_kw(KW_FINANCE):
        return "finance"
    if contains_kw(KW_SPORT):
        return "sport"
    if contains_kw(KW_KRIMI):
        return "krimi"
    
    fb = (fallback_topic or "aktualne").strip().lower()
    if fb not in VALID_SECTIONS:
        fb = "aktualne"
    return fb

def stable_section(section: str) -> str:
    s = (section or "aktualne").strip().lower()
    if s not in VALID_SECTIONS:
        return "aktualne"
    return s

def choose_neutral_title(cluster_titles: list, section: str) -> str:
    cleaned = [clean_title_basic(x) for x in cluster_titles if x and clean_title_basic(x)]
    if not cleaned:
        return "Nová událost"
    cleaned.sort(key=lambda s: (len(s), s))
    t = cleaned[0]
    t = t.replace("!", "").strip()
    t = re.sub(r"\s*(\.\.\.|…)\s*$", "", t).strip()
    t = re.sub(r"\s*\.\s*$", "", t).strip()
    t = re.sub(r"\s*-\s*(idnes|novinky|seznam|rozhlas|ct24|denik|hn|e15|sport\.cz|isport)\s*$", "", t, flags=re.IGNORECASE).strip()
    if not t:
        return "Nová událost"
    return t

def clean_single_source_title(title: str) -> str:
    return clean_title_basic(title)

def _is_video_entry(entry) -> bool:
    try:
        enc = getattr(entry, "enclosures", None)
        if enc and isinstance(enc, list):
            for e in enc:
                if not isinstance(e, dict):
                    continue
                typ = (e.get("type") or "").lower()
                if typ.startswith("video/"):
                    return True
    except Exception:
        pass
    try:
        links = getattr(entry, "links", None)
        if links and isinstance(links, list):
            for l in links:
                if not isinstance(l, dict):
                    continue
                rel = (l.get("rel") or "").lower()
                typ = (l.get("type") or "").lower()
                if rel == "enclosure" and typ.startswith("video/"):
                    return True
    except Exception:
        pass
    try:
        mc = getattr(entry, "media_content", None)
        if mc and isinstance(mc, list):
            for obj in mc:
                if not isinstance(obj, dict):
                    continue
                typ = (obj.get("type") or "").lower()
                medium = (obj.get("medium") or "").lower()
                if medium == "video" or typ.startswith("video/"):
                    return True
    except Exception:
        pass
    return False

def _ensure_video_prefix(title: str) -> str:
    t = clean_title_basic(title)
    if not t:
        return "VIDEO: —"
    if re.match(r"^\s*video\s*:\s*", t, flags=re.IGNORECASE):
        t2 = re.sub(r"^\s*video\s*:\s*", "", t, flags=re.IGNORECASE).strip()
        return f"VIDEO: {t2}" if t2 else "VIDEO: —"
    return f"VIDEO: {t}"

def youtube_video_id_from_url(url: str) -> str:
    u = (url or "").strip()
    if not u:
        return ""
    try:
        p = urlparse(u)
        host = (p.netloc or "").lower()
        if host.endswith("youtu.be"):
            vid = (p.path or "").strip("/").strip()
            return vid or ""
        if "youtube.com" in host:
            qs = dict(parse_qsl(p.query, keep_blank_values=True))
            v = (qs.get("v") or "").strip()
            if v:
                return v
            parts = [x for x in (p.path or "").split("/") if x]
            if "shorts" in parts:
                i = parts.index("shorts")
                if i + 1 < len(parts):
                    return (parts[i + 1] or "").strip()
            if "embed" in parts:
                i = parts.index("embed")
                if i + 1 < len(parts):
                    return (parts[i + 1] or "").strip()
        return ""
    except Exception:
        return ""

def _section_label(section: str) -> str:
    m = {
        "pocasi": "Počasí",
        "doprava": "Doprava",
        "aktualne": "Aktuálně",
        "krimi": "Krimi",
        "zdravi": "Zdraví",
        "finance": "Finance",
        "sport": "Sport",
    }
    return m.get(section, section)

def build_meta(generated_at: str, articles: list) -> dict:
    by_section = {s: 0 for s in SECTION_ORDER}
    videos = 0
    for a in articles:
        sec = stable_section(a.get("section"))
        if sec in by_section:
            by_section[sec] += 1
        else:
            by_section[sec] = by_section.get(sec, 0) + 1
        if (a.get("contentType") or "article") == "video":
            videos += 1
    return {
        "generatedAt": generated_at,
        "totals": {
            "items": len(articles),
            "videos": videos,
            "articles": max(0, len(articles) - videos),
        },
        "bySection": by_section,
    }

def build_brief(generated_at: str, articles: list) -> dict:
    by_section = {s: [] for s in SECTION_ORDER}
    for a in articles:
        sec = stable_section(a.get("section"))
        if sec not in by_section:
            by_section[sec] = []
        by_section[sec].append(a)
    
    daily_brief = []
    for sec in SECTION_ORDER:
        items = by_section.get(sec, [])
        if not items:
            continue
        src_names = []
        seen = set()
        for it in items:
            for s in (it.get("sources") or []):
                n = normalize_media_name(str(s.get("name") or "").strip())
                if not n:
                    continue
                if n in seen:
                    continue
                seen.add(n)
                src_names.append(n)
                if len(src_names) >= 8:
                    break
            if len(src_names) >= 8:
                break
        daily_brief.append({
            "section": sec,
            "label": _section_label(sec),
            "count": len(items),
            "sources": src_names
        })
    
    featured_today = []
    ranked = sorted(daily_brief, key=lambda x: x.get("count", 0), reverse=True)[:3]
    for r in ranked:
        featured_today.append({
            "section": r["section"],
            "label": r["label"],
            "summary": f"V sekci {r['label']} přibylo {r['count']} položek.",
            "sources": r.get("sources", [])
        })
    
    return {
        "generatedAt": generated_at,
        "featured_today": featured_today,
        "daily_brief": daily_brief
    }


# =========================
# Clustering
# =========================

class Cluster:
    def __init__(self, section: str, content_type: str):
        self.section = section
        self.content_type = content_type
        self.items = []
        self.token_union = set()
    
    def add(self, item: dict):
        self.items.append(item)
        if self.content_type == "article":
            self.token_union |= item["tokens"]
    
    def published_at(self) -> datetime:
        return max((it["dt"] for it in self.items), default=datetime.now(timezone.utc))
    
    def titles(self) -> list:
        return [it["title"] for it in self.items if it.get("title")]
    
    def sources_unique(self) -> list:
        if self.content_type == "video":
            it = sorted(self.items, key=lambda x: x["dt"], reverse=True)[0]
            return [{"name": it["media_raw"], "url": it["url"]}]
        
        seen = set()
        out = []
        display_by_norm = {}
        for it in self.items:
            normn = it["media_norm"]
            raw = it["media_raw"]
            if normn not in display_by_norm or len(raw) < len(display_by_norm[normn]):
                display_by_norm[normn] = raw
        
        for it in sorted(self.items, key=lambda x: x["dt"], reverse=True):
            key = (it["media_norm"], it["url"])
            if key in seen:
                continue
            seen.add(key)
            out.append({
                "name": display_by_norm.get(it["media_norm"], it["media_norm"]),
                "url": it["url"]
            })
        
        out2 = []
        seen2 = set()
        for s in out:
            key2 = (normalize_media_name(s["name"]), s["url"])
            if key2 in seen2:
                continue
            seen2.add(key2)
            out2.append(s)
        return out2
    
    def unique_media_count(self) -> int:
        return len(set(it["media_norm"] for it in self.items))

def cluster_items(items: list) -> list:
    clusters = []
    for it in items:
        if it.get("contentType") == "video":
            c = Cluster(section=it["section"], content_type="video")
            c.add(it)
            clusters.append(c)
            continue
        placed = False
        for c in clusters:
            if c.content_type != "article":
                continue
            if c.section != it["section"]:
                continue
            sim = jaccard(c.token_union, it["tokens"])
            if sim >= CLUSTER_JACCARD_THRESHOLD:
                c.add(it)
                placed = True
                break
        if not placed:
            c = Cluster(section=it["section"], content_type="article")
            c.add(it)
            clusters.append(c)
    return clusters


# =========================
# Načtení zdrojů ze Source Registry
# =========================

def load_sources(path: str) -> list:
    """Načtení zdrojů z config/sources.json"""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    if not isinstance(data, dict) or "sources" not in data:
        raise ValueError("sources.json must have 'sources' array")
    
    sources = []
    for src in data["sources"]:
        if not src.get("enabled", True):
            continue
        sources.append(src)
    
    return sources


# =========================
# Main
# =========================

def main() -> int:
    start_time = time.time()
    
    if not os.path.exists(SOURCES_PATH):
        print(f"ERROR: missing {SOURCES_PATH}", file=sys.stderr)
        return 2
    
    # Načtení zdrojů
    sources = load_sources(SOURCES_PATH)
    print(f"[INFO] Loaded {len(sources)} sources from {SOURCES_PATH}", file=sys.stderr)
    
    all_items = []
    yt_videos = []
    per_feed_report = []
    sources_ok = []
    sources_fail = []
    sources_quarantined = []
    all_diagnostics = []
    domain_count = defaultdict(int)
    
    # Fetch všech zdrojů
    for source in sources:
        source_id = source["id"]
        source_type = source.get("type", "articles")
        source_name = source.get("name", source_id)
        fallback_topic = stable_section(source.get("topic", "aktualne"))
        legal_mode = source.get("legal_mode", "rss_only")
        
        # URL
        url = source.get("url", "")
        if source_type == "videos" and "playlistId" in source:
            url = f"https://www.youtube.com/feeds/videos.xml?playlist_id={source['playlistId']}"
        
        if not url:
            print(f"[WARN] Source {source_id} has no URL, skipping", file=sys.stderr)
            continue
        
        host = (urlparse(url).hostname or "").lower()
        if host.startswith("www."):
            host = host[4:]
        if domain_count[host] >= MAX_PER_DOMAIN_PER_RUN:
            all_diagnostics.append({
                "host": host, "reason": "domain_cap", "ts": datetime.now(timezone.utc).isoformat(),
                "url": url, "source_id": source_id,
            })
            print(f"[SKIP] {source_id}: domain_cap (max {MAX_PER_DOMAIN_PER_RUN} per domain)", file=sys.stderr)
            continue
        domain_count[host] += 1
        
        # Fetch s retry (pouze RSS metadata, ne scrapování)
        policy = source.get("policy", {})
        feed_dict, diagnostics = fetch_engine.fetch_with_retry(
            url=url,
            source_id=source_id,
            timeout_ms=policy.get("timeout_ms", 20000),
            max_retries=policy.get("max_retries", 3),
            backoff_base_ms=policy.get("backoff_base_ms", 1000)
        )
        all_diagnostics.append(diagnostics)
        
        # Tracking stavu
        if diagnostics.get("quarantined"):
            sources_quarantined.append(source_id)
            print(f"[QUARANTINED] {source_id}", file=sys.stderr)
            continue
        elif feed_dict:
            sources_ok.append(source_id)
        else:
            sources_fail.append(source_id)
            print(f"[FAIL] {source_id}: {diagnostics.get('reason', 'unknown')}", file=sys.stderr)
            continue
        
        # Parsování entries
        entries = getattr(feed_dict, "entries", []) or []
        accepted = 0
        
        # Detekce YouTube feedu
        is_youtube_feed = False
        try:
            host = (urlparse(url).netloc or "").lower()
            is_youtube_feed = ("youtube.com" in host) or ("www.youtube.com" in host) or ("youtube" in host)
        except Exception:
            pass
        
        channel_name = source.get("channel", "").strip()
        if is_youtube_feed and not channel_name:
            channel_name = source_name
        
        # Zpracování entries
        for entry in entries[:MAX_ITEMS_PER_FEED]:
            link = canonicalize_url(getattr(entry, "link", "") or "")
            title = getattr(entry, "title", "") or ""
            dt = parse_dt(entry)
            
            if not link or not title:
                continue
            
            media_raw = source_name.strip()
            media_norm = normalize_media_name(media_raw)
            
            # YouTube položky → videos.json
            if is_youtube_feed:
                vid = youtube_video_id_from_url(link)
                if not vid:
                    continue
                section = infer_section(link, title, fallback_topic=fallback_topic)
                section = stable_section(section)
                yt_videos.append({
                    "title": clean_title_basic(title),
                    "url": link,
                    "videoId": vid,
                    "publishedAt": dt.isoformat().replace("+00:00", "Z"),
                    "section": section,
                    "channel": channel_name or "YouTube",
                    "_dt": dt,
                })
                accepted += 1
                continue
            
            # Články (nebo video z RSS metadat)
            is_video = _is_video_entry(entry)
            content_type = "video" if is_video else "article"
            
            section = infer_section(link, title, fallback_topic=fallback_topic)
            section = stable_section(section)
            
            item = {
                "section": section,
                "contentType": content_type,
                "title": title,
                "url": link,
                "dt": dt,
                "media_raw": media_raw,
                "media_norm": media_norm,
                "tokens": tokenize_title(title),
            }
            all_items.append(item)
            accepted += 1
        
        # Report
        per_feed_report.append({
            "feed": url,
            "source": source_name,
            "topic": fallback_topic,
            "httpStatus": diagnostics.get("httpStatus", 0),
            "contentType": diagnostics.get("contentType", ""),
            "finalUrl": diagnostics.get("finalUrl", url),
            "bytes": diagnostics.get("bytes", 0),
            "reason": diagnostics.get("reason", ""),
            "bozo": diagnostics.get("bozo", False),
            "bozoException": diagnostics.get("bozoException", ""),
            "itemsParsed": len(entries),
            "itemsKept": accepted,
            "accepted": accepted,
            "status": "OK" if accepted > 0 else "ERROR",
        })
    
    print(f"[INFO] Processed {len(sources_ok)} OK, {len(sources_fail)} FAIL, {len(sources_quarantined)} QUARANTINED", file=sys.stderr)
    
    # Fetch monitor (403 / robots disallow by host)
    blocked403_by_host = defaultdict(int)
    robots_disallow_by_host = defaultdict(int)
    total_by_host = defaultdict(int)
    for d in all_diagnostics:
        h = d.get("host") or ""
        if not h:
            continue
        total_by_host[h] += 1
        r = d.get("reason") or ""
        if r == "http_403_blocked":
            blocked403_by_host[h] += 1
        elif r == "robots_disallow":
            robots_disallow_by_host[h] += 1
    monitor_dir = os.path.join(ROOT_DIR, "projects", "data")
    os.makedirs(monitor_dir, exist_ok=True)
    monitor_path = os.path.join(monitor_dir, "fetch_monitor.json")
    with open(monitor_path, "w", encoding="utf-8") as f:
        json.dump({
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "window": "run",
            "blocked403ByHost": dict(blocked403_by_host),
            "robotsDisallowByHost": dict(robots_disallow_by_host),
            "totalByHost": dict(total_by_host),
        }, f, ensure_ascii=False, indent=2)
    print(f"[INFO] Wrote {monitor_path}", file=sys.stderr)
    
    # Dedup článků
    seen_pre = set()
    deduped_items = []
    for it in sorted(all_items, key=lambda x: (x["dt"], x["url"]), reverse=True):  # Determinismus: sekundární sort key
        key = (it["media_norm"], it["url"])
        if key in seen_pre:
            continue
        seen_pre.add(key)
        deduped_items.append(it)
    
    # Clustering
    clusters = cluster_items(deduped_items)
    
    # Ranking (deterministické)
    sec_rank = {s: i for i, s in enumerate(SECTION_ORDER)}
    clusters.sort(key=lambda c: (c.published_at(), -sec_rank.get(c.section, 999), c.items[0]["url"] if c.items else ""), reverse=True)
    
    # Generování výstupních článků
    out_articles = []
    for c in clusters:
        sources = c.sources_unique()
        published = c.published_at().isoformat().replace("+00:00", "Z")
        
        if c.content_type == "video":
            t = sorted(c.items, key=lambda x: x["dt"], reverse=True)[0]["title"]
            title_out = _ensure_video_prefix(t)
        else:
            if c.unique_media_count() == 1:
                t = sorted(c.items, key=lambda x: x["dt"], reverse=True)[0]["title"]
                title_out = clean_single_source_title(t)
            else:
                title_out = choose_neutral_title(c.titles(), section=c.section)
        
        article_out = {
            "topic": c.section,
            "section": c.section,
            "contentType": c.content_type,
            "title": title_out,
            "publishedAt": published,
            "sources": sources
        }
        out_articles.append(article_out)
    
    # Finální limit
    out_articles = sorted(out_articles, key=lambda a: (a["publishedAt"], a.get("url", "")), reverse=True)
    final_articles = out_articles[:MAX_OUTPUT_ARTICLES]
    
    # Videa dedup a limit
    yt_sorted = sorted(yt_videos, key=lambda v: (v.get("_dt") or datetime.now(timezone.utc), v.get("url", "")), reverse=True)
    seen_vid = set()
    out_vid = []
    for v in yt_sorted:
        vid = (v.get("videoId") or "").strip()
        if not vid or vid in seen_vid:
            continue
        seen_vid.add(vid)
        out_vid.append({
            "title": v.get("title") or "",
            "url": v.get("url") or "",
            "videoId": vid,
            "publishedAt": v.get("publishedAt") or "",
            "section": stable_section(v.get("section") or "aktualne"),
            "channel": (v.get("channel") or "YouTube").strip() or "YouTube",
        })
        if len(out_vid) >= MAX_OUTPUT_VIDEOS:
            break
    
    generated_at = iso_now_z()
    
    # Sanitizace
    for article in final_articles:
        validator.sanitize_article(article)
    for video in out_vid:
        validator.sanitize_video(video)
    
    # Payloady
    articles_payload = {
        "generatedAt": generated_at,
        "articles": final_articles
    }
    
    videos_payload = {
        "generatedAt": generated_at,
        "videos": out_vid
    }
    
    meta_payload = build_meta(generated_at, final_articles)
    brief_payload = build_brief(generated_at, final_articles)
    
    # Feed health (kompatibilita)
    feed_health_payload = {
        "updatedAt": generated_at,
        "feeds": {
            r["feed"]: {
                "topic": r.get("topic", "aktualne"),
                "source": r.get("source", ""),
                "accepted": int(r.get("accepted", 0) or 0),
                "status": r.get("status", "OK"),
                "itemsParsed": int(r.get("itemsParsed", 0) or 0),
                "itemsKept": int(r.get("itemsKept", 0) or 0),
                "httpStatus": int(r.get("httpStatus", 0) or 0),
                "contentType": r.get("contentType", ""),
                "finalUrl": r.get("finalUrl", r["feed"]),
                "bytes": int(r.get("bytes", 0) or 0),
                "reason": r.get("reason", ""),
                "bozo": bool(r.get("bozo", False)),
                "bozoException": r.get("bozoException", ""),
            } for r in per_feed_report
        }
    }
    
    # Zápis do next/
    print(f"[INFO] Writing to next/...", file=sys.stderr)
    data_layer.write_next("articles.json", articles_payload)
    data_layer.write_next("videos.json", videos_payload)
    data_layer.write_next("meta.json", meta_payload)
    data_layer.write_next("brief.json", brief_payload)
    data_layer.write_next("feed_health.json", feed_health_payload)
    
    # Validace
    def validate_file(filename: str, data: dict) -> bool:
        is_valid, error = validator.validate_file(filename, data)
        if not is_valid:
            print(f"VALIDATION ERROR [{filename}]: {error}", file=sys.stderr)
        return is_valid
    
    print(f"[INFO] Validating...", file=sys.stderr)
    articles_valid = validate_file("articles.json", articles_payload)
    videos_valid = validate_file("videos.json", videos_payload)
    meta_valid = validate_file("meta.json", meta_payload)
    
    # Health gate
    articles_count = len(final_articles)
    videos_count = len(out_vid)
    sources_ok_count = len(sources_ok)
    
    health_gate_pass = (
        articles_count >= MIN_ARTICLES and
        videos_count >= MIN_VIDEOS and
        sources_ok_count >= MIN_SOURCES_OK
    )
    
    canary_pass = articles_valid and videos_valid and meta_valid and health_gate_pass
    
    if not health_gate_pass:
        print(f"[HEALTH GATE] FAIL: articles={articles_count} (min {MIN_ARTICLES}), videos={videos_count} (min {MIN_VIDEOS}), sources_ok={sources_ok_count} (min {MIN_SOURCES_OK})", file=sys.stderr)
    
    # Promování next/ → prod/
    if canary_pass:
        print(f"[INFO] Canary PASS, promoting to prod...", file=sys.stderr)
        success = data_layer.promote_next_to_prod(
            ["articles.json", "videos.json", "meta.json", "brief.json", "feed_health.json"],
            validator=validate_file
        )
        if not success:
            print("ERROR: promote_next_to_prod failed", file=sys.stderr)
            return 1
        print(f"[SUCCESS] Promoted to prod", file=sys.stderr)
    else:
        print(f"[WARNING] Canary FAIL, not promoting (keeping prod unchanged)", file=sys.stderr)
        data_layer.rollback_to_lkg(["articles.json", "videos.json", "meta.json", "brief.json", "feed_health.json"])
    
    # Health report
    duration = time.time() - start_time
    canary_reason = ""
    if not canary_pass:
        reasons = []
        if not articles_valid:
            reasons.append("articles validation failed")
        if not videos_valid:
            reasons.append("videos validation failed")
        if not meta_valid:
            reasons.append("meta validation failed")
        if not health_gate_pass:
            reasons.append("health gate failed")
        canary_reason = "; ".join(reasons)
    
    health_report = health_reporter.generate_report(
        timestamp=generated_at,
        items_count=articles_count,
        videos_count=videos_count,
        sources_ok=sources_ok,
        sources_fail=sources_fail,
        sources_quarantined=sources_quarantined,
        duration_seconds=duration,
        pipeline_version="2.0.0",
        canary_pass=canary_pass,
        canary_reason=canary_reason
    )
    health_reporter.save_report(health_report, format="json")
    health_reporter.save_report(health_report, format="md")
    
    # Emergency bundle
    data_layer.create_emergency_bundle(final_articles, out_vid)
    
    # Latest release pointer
    latest_release = data_layer.get_latest_release_path("articles.json")
    if latest_release:
        latest_dir = latest_release.parent
        latest_path = data_layer.releases_dir / "latest.json"
        with open(latest_path, "w", encoding="utf-8") as f:
            json.dump({"release": latest_dir.name, "generatedAt": generated_at}, f, ensure_ascii=False, indent=2)
    
    print(f"=== SUCCESS ===")
    print(f"Articles: {articles_count} (min: {MIN_ARTICLES})")
    print(f"Videos: {videos_count} (min: {MIN_VIDEOS})")
    print(f"Sources OK: {sources_ok_count} (min: {MIN_SOURCES_OK})")
    print(f"Canary: {'PASS' if canary_pass else 'FAIL'}")
    print(f"Duration: {duration:.2f}s")
    
    return 0 if canary_pass else 1


if __name__ == "__main__":
    raise SystemExit(main())
