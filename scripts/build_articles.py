#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

import feedparser
import requests
import shutil


# =========================
# Konfigurace
# =========================

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # repo root
FEEDS_PATH = os.path.join(ROOT_DIR, "scripts", "feeds.json")

# ✅ YouTube playlisty – samostatný soubor
FEEDS_YOUTUBE_PATH = os.path.join(ROOT_DIR, "scripts", "feeds_youtube.json")

# ✅ FIX: Output directory - použij env OUTPUT_DIR nebo default filtr/data
OUTPUT_DIR = os.getenv("OUTPUT_DIR", os.path.join(ROOT_DIR, "projects", "data"))
os.makedirs(OUTPUT_DIR, exist_ok=True)

OUT_PATH = os.path.join(OUTPUT_DIR, "articles.json")
HEALTH_PATH = os.path.join(OUTPUT_DIR, "feed_health.json")
BRIEF_PATH = os.path.join(OUTPUT_DIR, "brief.json")
META_PATH = os.path.join(OUTPUT_DIR, "meta.json")
ROOT_DATA_DIR = os.path.join(ROOT_DIR, "data")
os.makedirs(ROOT_DATA_DIR, exist_ok=True)

# ✅ NOVĚ: výstup videí (pro assets/app.js)
VIDEOS_OUT_PATH = os.path.join(OUTPUT_DIR, "videos.json")
ROOT_ARTICLES_PATH = os.path.join(ROOT_DATA_DIR, "articles.json")
ROOT_VIDEOS_PATH = os.path.join(ROOT_DATA_DIR, "videos.json")

USER_AGENT = "Mozilla/5.0 (compatible; infoUzelBot/1.0; +https://infouzel.cz)"
REQUEST_TIMEOUT_SEC = 20

MAX_ITEMS_PER_FEED = 40
MAX_OUTPUT_ARTICLES = 220  # aby web zůstal svižný

# YouTube videa: kolik nejvýše uložit do videos.json (frontend si vybere čerstvé)
MAX_OUTPUT_VIDEOS = 120

# Jaccard práh pro shlukování "stejného tématu" napříč médii (titulek podobný)
CLUSTER_JACCARD_THRESHOLD = 0.56

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

# Pro infer_section – doprava/pocasi apod.
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

# Pořadí sekcí (video NENÍ sekce; je to contentType)
SECTION_ORDER = ["pocasi", "doprava", "aktualne", "krimi", "zdravi", "finance", "sport"]

VALID_SECTIONS = {"pocasi","doprava","aktualne","krimi","finance","sport","zdravi"}


# =========================
# Utility
# =========================

def iso_now_z() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_dt(entry) -> datetime:
    # feedparser vrací published_parsed / updated_parsed (time.struct_time)
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
    # sjednotit "iDNES.cz – Krimi" -> "iDNES.cz"
    for sep in [" – ", " — ", " - "]:
        if sep in name:
            return name.split(sep, 1)[0].strip()
    return name.strip()


def _cz_score(txt: str) -> int:
    good = "ěščřžýáíéůúďťňĚŠČŘŽÝÁÍÉÚŮĎŤŇ"
    bad = "ÄĂĹÂ�"
    return sum(txt.count(ch) for ch in good) - sum(txt.count(ch) for ch in bad)


def fix_cz_mojibake(s: str) -> str:
    if not isinstance(s, str):
        return s
    if not any(bad in s for bad in ("Ă", "Ä", "Ĺ", "Â")):
        return s
    candidates = [s]
    try:
        candidates.append(s.encode("latin1").decode("utf-8"))
    except Exception:
        pass
    try:
        candidates.append(s.encode("cp1250").decode("utf-8"))
    except Exception:
        pass
    best = max(candidates, key=_cz_score)
    return best


def clean_title_basic(title: str) -> str:
    t = (title or "").strip()

    for rx in TITLE_PREFIX_STRIP:
        t = re.sub(rx, "", t, flags=re.IGNORECASE)

    t = re.sub(r"\s*(\.\.\.|…)\s*$", "", t)
    t = re.sub(r"\s*\.\s*$", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    t = t.strip("“”\"' ")

    # pokud je to otázka, odstraníme otazník (chceme faktický styl)
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

    # --- host/path signály (přesnější než jen "/sport" v celé URL) ---
    # POČASÍ
    if "pocasi" in host or "/pocasi" in path or "/pocasi-" in path or path.startswith("/pocasi"):
        return "pocasi"

    # DOPRAVA
    if "doprava" in host or "/doprava" in path or "/auto" in path or "/nehody" in path or "/nehoda" in path:
        return "doprava"

    # SPORT (vč. subdomén typu sport.aktualne.cz)
    if host.startswith("sport.") or "/sport" in path or "/fotbal" in path or "/hokej" in path or "/tenis" in path:
        return "sport"

    # FINANCE (vč. byznys/ekonomika/reality)
    if "/ekonomika" in path or "/finance" in path or "/byznys" in path or "/byznys/" in path or "/reality" in path:
        return "finance"
    if host.startswith("byznys.") or host.startswith("ekonomika.") or host.startswith("finance."):
        return "finance"

    # KRIMI
    if "/krimi" in path or "/crime" in path:
        return "krimi"

    # ZDRAVÍ
    if "/zdravi" in path or "/zdrav" in path or "zdravi" in host:
        return "zdravi"

    def contains_kw(kwset: set) -> bool:
        for k in kwset:
            if k in t:
                return True
        return False

    # --- keyword signály v titulku ---
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
    # 2+ zdrojů (články): vytvořit "neutrální" titulek.
    cleaned = [clean_title_basic(x) for x in cluster_titles if x and clean_title_basic(x)]
    if not cleaned:
        return "Nová událost"

    cleaned.sort(key=lambda s: (len(s), s))
    t = cleaned[0]

    t = t.replace("!", "").strip()
    t = re.sub(r"\s*(\.\.\.|…)\s*$", "", t).strip()
    t = re.sub(r"\s*\.\s*$", "", t).strip()

    t = re.sub(
        r"\s*-\s*(idnes|novinky|seznam|rozhlas|ct24|denik|hn|e15|sport\.cz|isport)\s*$",
        "",
        t,
        flags=re.IGNORECASE
    ).strip()

    if not t:
        return "Nová událost"

    return t


def clean_single_source_title(title: str) -> str:
    # 1 zdroj: ponechat „originál“, ale technicky očistit
    return clean_title_basic(title)


def _is_video_entry(entry) -> bool:
    """
    Detekce videa jen z RSS metadat (bez stahování HTML):
      - enclosures/links rel=enclosure type video/*
      - media_content type video/* nebo medium=video
      - YouTube feed (video entries) – u YouTube to typicky není enclosure, takže to řešíme hostem níže
    """
    # enclosures
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

    # links rel=enclosure
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

    # media_content
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

        # youtu.be/<id>
        if host.endswith("youtu.be"):
            vid = (p.path or "").strip("/").strip()
            return vid or ""

        # youtube.com/watch?v=<id>
        if "youtube.com" in host:
            qs = dict(parse_qsl(p.query, keep_blank_values=True))
            v = (qs.get("v") or "").strip()
            if v:
                return v

            # /shorts/<id> nebo /embed/<id>
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


# =========================
# Načtení feeds.json (robustní)
# =========================

def _meta_from_any(url: str, meta_any) -> dict:
    if isinstance(meta_any, dict):
        meta = dict(meta_any)
    else:
        meta = {}

    if "topic" not in meta:
        meta["topic"] = "aktualne"

    if "source" not in meta and "name" not in meta and "title" not in meta:
        try:
            meta["source"] = urlparse(url).netloc or url
        except Exception:
            meta["source"] = url

    return meta


def load_feeds(path: str) -> list:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    feed_items = []

    if isinstance(data, dict):
        for url, meta_any in data.items():
            if not isinstance(url, str) or not url.strip():
                continue
            url = url.strip()
            meta = _meta_from_any(url, meta_any)
            feed_items.append((url, meta))

    elif isinstance(data, list):
        for item in data:
            if isinstance(item, str):
                url = item.strip()
                if not url:
                    continue
                meta = _meta_from_any(url, {})
                feed_items.append((url, meta))
            elif isinstance(item, dict):
                url = (item.get("url") or item.get("feed") or item.get("rss") or "").strip()
                if not url:
                    continue
                meta = _meta_from_any(url, item)
                feed_items.append((url, meta))
            else:
                continue
    else:
        raise ValueError("feeds.json musí být dict nebo list")

    return feed_items


def _youtube_feed_url_from_playlist_id(pid: str) -> str:
    pid = (pid or "").strip()
    if not pid:
        return ""
    return f"https://www.youtube.com/feeds/videos.xml?playlist_id={pid}"


def load_youtube_feeds(path: str) -> list:
    """
    Podporovaný formát feeds_youtube.json:
    [
      { "playlistId": "...", "topic": "aktualne", "channel": "ČT24" },
      { "url": "https://www.youtube.com/feeds/videos.xml?playlist_id=...", "topic": "...", "source": "..." }
    ]
    """
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, list):
        raise ValueError("feeds_youtube.json musí být list")

    out = []
    for item in data:
        if not isinstance(item, dict):
            continue

        pid = (item.get("playlistId") or "").strip()
        url = (item.get("url") or "").strip()
        if not url and pid:
            url = _youtube_feed_url_from_playlist_id(pid)

        if not url:
            continue

        topic = stable_section(item.get("topic") or "aktualne")
        channel = (item.get("channel") or item.get("source") or "").strip()
        if not channel:
            channel = "YouTube"

        # source do FEED REPORTu
        source = f"YouTube – {channel}".strip()

        meta = {
            "topic": topic,
            "source": source,
            "type": "youtube",
            "channel": channel,   # ✅ čistý název kanálu pro videos.json
        }
        out.append((url, meta))

    return out


def load_all_feeds() -> list:
    feeds = []
    if os.path.exists(FEEDS_PATH):
        feeds.extend(load_feeds(FEEDS_PATH))

    # ✅ přidáme YouTube playlisty
    if os.path.exists(FEEDS_YOUTUBE_PATH):
        feeds.extend(load_youtube_feeds(FEEDS_YOUTUBE_PATH))

    return feeds


# =========================
# Stahování a parsování RSS
# =========================

def robust_fetch(url: str) -> tuple:
    """
    Robustní fetch RSS feedu s hlavičkami, timeoutem, redirecty, encoding fallback.
    Vrací: (status_code, final_url, content_type, text)
    """
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1",
        "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.3",
        "Cache-Control": "no-cache",
    }
    
    try:
        response = requests.get(
            url,
            headers=headers,
            timeout=REQUEST_TIMEOUT_SEC,
            allow_redirects=True,
            stream=False
        )
        status_code = response.status_code
        final_url = response.url
        content_type = response.headers.get("Content-Type", "").lower()
        encoding = response.encoding or response.apparent_encoding or "utf-8"
        response.encoding = encoding
        text = response.text
        
        return (status_code, final_url, content_type, text)
    except requests.exceptions.Timeout:
        return (0, url, "", b"")
    except requests.exceptions.RequestException as e:
        return (0, url, "", b"")
    except Exception:
        return (0, url, "", b"")


def decode_with_fallback(raw_bytes: bytes) -> str:
    """
    Encoding fallback: utf-8 -> cp1250 -> latin-1
    """
    if not raw_bytes:
        return ""
    
    # 1) utf-8 (nejčastější)
    try:
        return raw_bytes.decode("utf-8")
    except (UnicodeDecodeError, LookupError):
        pass
    
    # 2) cp1250 (české feedy)
    try:
        return raw_bytes.decode("cp1250")
    except (UnicodeDecodeError, LookupError):
        pass
    
    # 3) latin-1 (nikdy nefailuje, ale může být špatně)
    return raw_bytes.decode("latin-1", errors="replace")


def is_html_content(text: str, content_type: str) -> bool:
    """
    Detekce HTML místo XML/RSS.
    """
    if not text:
        return False
    
    text_lower = text.strip().lower()
    
    # content-type kontrola
    if "text/html" in content_type:
        return True
    
    # začátek dokumentu
    if text_lower.startswith("<!doctype html") or text_lower.startswith("<html"):
        return True
    
    # další HTML signály
    if text_lower.startswith("<!") and "html" in text_lower[:100]:
        return True
    
    return False


def fetch_feed(url: str) -> tuple:
    """
    Nová fetch_feed: vrací (feed_dict, diagnostics_dict)
    diagnostics obsahuje: httpStatus, contentType, finalUrl, bytes, reason, bozo, bozoException
    """
    diagnostics = {
        "httpStatus": 0,
        "contentType": "",
        "finalUrl": url,
        "bytes": 0,
        "reason": "",
        "bozo": False,
        "bozoException": "",
    }
    
    try:
        status_code, final_url, content_type, text = robust_fetch(url)
        diagnostics["httpStatus"] = status_code
        diagnostics["contentType"] = content_type
        diagnostics["finalUrl"] = final_url
        diagnostics["bytes"] = len(text.encode("utf-8", errors="ignore"))

        if status_code == 0:
            diagnostics["reason"] = "fetch_failed"
            return (None, diagnostics)

        if status_code != 200:
            diagnostics["reason"] = f"http_{status_code}"
            return (None, diagnostics)

        if not text:
            diagnostics["reason"] = "empty_content"
            return (None, diagnostics)
        
        if not text:
            diagnostics["reason"] = "empty_content"
            return (None, diagnostics)
        
        # Detekce HTML místo XML
        if is_html_content(text, content_type):
            diagnostics["reason"] = "not_xml_or_html"
            return (None, diagnostics)
        
        # Parsování feedparserem
        feed_dict = feedparser.parse(text)
        
        # Bozo informace
        bozo = bool(getattr(feed_dict, "bozo", False))
        diagnostics["bozo"] = bozo
        
        if bozo:
            try:
                bozo_exc = getattr(feed_dict, "bozo_exception", None)
                if bozo_exc:
                    diagnostics["bozoException"] = str(bozo_exc)
            except Exception:
                pass
        
        return (feed_dict, diagnostics)
        
    except Exception as e:
        diagnostics["reason"] = "exception"
        diagnostics["bozoException"] = str(e)
        return (None, diagnostics)


# =========================
# Clustering
# =========================

class Cluster:
    def __init__(self, section: str, content_type: str):
        self.section = section
        self.content_type = content_type  # "article" | "video"
        self.items = []  # dict(...)
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
        # VIDEO: vždy jen 1 zdroj (nejnovější položka)
        if self.content_type == "video":
            it = sorted(self.items, key=lambda x: x["dt"], reverse=True)[0]
            return [{
                "name": it["media_raw"],
                "url": it["url"]
            }]

        # ARTICLE: unikátní zdroje v clusteru
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
        # VIDEO: nikdy neslučovat => vždy nový cluster
        if it.get("contentType") == "video":
            c = Cluster(section=it["section"], content_type="video")
            c.add(it)
            clusters.append(c)
            continue

        # ARTICLE: slučování dle Jaccard podobnosti, jen v rámci stejné sekce
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
# Brief / Meta
# =========================

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
# Main
# =========================

def main() -> int:
    if not os.path.exists(FEEDS_PATH):
        print(f"ERROR: missing {FEEDS_PATH}", file=sys.stderr)
        return 2

    feed_items = load_all_feeds()

    all_items = []
    per_feed_report = []

    # ✅ sběr YouTube videí (půjde do data/videos.json)
    yt_videos = []

    for feed_url, meta in feed_items:
        fallback_topic = stable_section(meta.get("topic", "aktualne"))
        source = fix_cz_mojibake(str(meta.get("source") or meta.get("name") or meta.get("title") or feed_url))
        if meta.get("disabled"):
            per_feed_report.append({
                "feed": feed_url,
                "source": source,
                "topic": fallback_topic,
                "status": "SKIPPED_DISABLED",
                "reason": "disabled",
                "httpStatus": 0,
                "contentType": "",
                "finalUrl": feed_url,
                "bytes": 0,
                "itemsParsed": 0,
                "itemsKept": 0,
                "accepted": 0,
            })
            continue

        # Nový robustní fetch
        d, diagnostics = fetch_feed(feed_url)
        
        # Základní report data
        report_base = {
            "feed": feed_url,
            "source": source,
            "topic": fallback_topic,
            "httpStatus": diagnostics.get("httpStatus", 0),
            "contentType": diagnostics.get("contentType", ""),
            "finalUrl": diagnostics.get("finalUrl", feed_url),
            "bytes": diagnostics.get("bytes", 0),
            "reason": diagnostics.get("reason", ""),
            "bozo": diagnostics.get("bozo", False),
            "bozoException": diagnostics.get("bozoException", ""),
            "itemsParsed": 0,
            "itemsKept": 0,
            "accepted": 0,
            "status": "OK",
            "bozo_but_used": False,
        }
        
        # Pokud fetch selhal nebo vrátil HTML
        if d is None:
            reason = diagnostics.get("reason", "unknown")
            status = "BOZO" if reason else "ERROR"
            report_base["status"] = status
            report_base["reason"] = reason
            per_feed_report.append(report_base)
            continue
        
        entries = getattr(d, "entries", []) or []
        items_parsed = len(entries)
        report_base["itemsParsed"] = items_parsed
        
        accepted = 0
        bozo = diagnostics.get("bozo", False)

        # ✅ je to YouTube feed?
        host = ""
        try:
            host = (urlparse(feed_url).netloc or "").lower()
        except Exception:
            host = ""

        is_youtube_feed = ("youtube.com" in host) or ("www.youtube.com" in host) or ("youtube" in host)

        channel_name = fix_cz_mojibake((meta.get("channel") or "").strip() if isinstance(meta, dict) else "")
        if not channel_name:
            # fallback: když není channel v meta, vytáhneme z "YouTube – X"
            m = re.match(r"^\s*YouTube\s*[–-]\s*(.+?)\s*$", str(source), flags=re.IGNORECASE)
            channel_name = (m.group(1).strip() if m else "YouTube")

        for entry in entries[:MAX_ITEMS_PER_FEED]:
            link = canonicalize_url(getattr(entry, "link", "") or "")
            title = fix_cz_mojibake(getattr(entry, "title", "") or "")
            dt = parse_dt(entry)

            if not link or not title:
                continue

            media_raw = fix_cz_mojibake(str(source).strip())
            media_norm = normalize_media_name(media_raw)

            # ✅ YouTube položky: ukládáme výhradně do videos.json (ne do articles.json)
            if is_youtube_feed:
                vid = youtube_video_id_from_url(link)
                if not vid:
                    continue

                section = infer_section(link, title, fallback_topic=fallback_topic)
                section = stable_section(section)

                yt_videos.append({
                    "title": fix_cz_mojibake(clean_title_basic(title)),
                    "url": link,
                    "videoId": vid,
                    "publishedAt": dt.isoformat().replace("+00:00", "Z"),
                    "section": section,
                    "channel": channel_name or "YouTube",
                    "_dt": dt,  # interně pro řazení
                })
                accepted += 1
                continue

            # contentType detekce: video jen z RSS metadat (mimo YouTube)
            is_video = _is_video_entry(entry)
            content_type = "video" if is_video else "article"

            section = infer_section(link, title, fallback_topic=fallback_topic)
            section = stable_section(section)

            item = {
                "section": section,
                "contentType": content_type,
                "title": fix_cz_mojibake(title),
                "url": link,
                "dt": dt,
                "media_raw": media_raw,
                "media_norm": media_norm,
                "tokens": tokenize_title(title),
            }
            all_items.append(item)
            accepted += 1

        report_base["itemsKept"] = accepted
        report_base["accepted"] = accepted
        
        # Status logika
        if bozo and accepted == 0:
            report_base["status"] = "BOZO"
            # Přidáme přesnější důvod do reason, pokud není už nastaven
            if not report_base.get("reason") or report_base["reason"] == "":
                bozo_exc = diagnostics.get("bozoException", "")
                if bozo_exc:
                    report_base["reason"] = f"bozo_parse_error: {bozo_exc[:100]}"
                else:
                    report_base["reason"] = "bozo_parse_error"
        elif bozo and accepted > 0:
            report_base["status"] = "OK"
            report_base["bozo_but_used"] = True
        else:
            report_base["status"] = "OK"
        
        per_feed_report.append(report_base)

    # dedup v rámci jednoho média + URL (ARTICLES)
    seen_pre = set()
    deduped_items = []
    for it in sorted(all_items, key=lambda x: x["dt"], reverse=True):
        key = (it["media_norm"], it["url"])
        if key in seen_pre:
            continue
        seen_pre.add(key)
        deduped_items.append(it)

    clusters = cluster_items(deduped_items)

    out_articles = []

    sec_rank = {s: i for i, s in enumerate(SECTION_ORDER)}
    clusters.sort(key=lambda c: (c.published_at(), -sec_rank.get(c.section, 999)), reverse=True)

    for c in clusters:
        sources = c.sources_unique()
        published = c.published_at().isoformat().replace("+00:00", "Z")

        # TITLE pravidla
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
            "topic": c.section,          # topic = section (stabilně)
            "section": c.section,
            "contentType": c.content_type,
                "title": fix_cz_mojibake(title_out),
            "publishedAt": published,
            "sources": sources
        }

        out_articles.append(article_out)

    # ===== FINÁLNÍ LIMIT (ARTICLES) =====
    out_articles = sorted(out_articles, key=lambda a: a["publishedAt"], reverse=True)
    final = out_articles[:MAX_OUTPUT_ARTICLES]

    generated_at = iso_now_z()

    payload = {
        "generatedAt": generated_at,
        "articles": final
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)

    # articles.json
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    shutil.copy(OUT_PATH, ROOT_ARTICLES_PATH)

    # feed_health.json (zachováváme kompatibilitu, ale přidáváme nové klíče)
    health_payload = {
        "updatedAt": generated_at,
        "feeds": {
            r["feed"]: {
                "topic": r.get("topic", "aktualne"),
                "source": r.get("source", ""),
                "accepted": int(r.get("accepted", 0) or 0),
                "status": r.get("status", "OK"),
                # Nové diagnostické klíče
                "itemsParsed": int(r.get("itemsParsed", 0) or 0),
                "itemsKept": int(r.get("itemsKept", 0) or 0),
                "httpStatus": int(r.get("httpStatus", 0) or 0),
                "contentType": r.get("contentType", ""),
                "finalUrl": r.get("finalUrl", r["feed"]),
                "bytes": int(r.get("bytes", 0) or 0),
                "reason": r.get("reason", ""),
                "bozo": bool(r.get("bozo", False)),
                "bozoException": r.get("bozoException", ""),
                "bozo_but_used": bool(r.get("bozo_but_used", False)),
            } for r in per_feed_report
        }
    }
    with open(HEALTH_PATH, "w", encoding="utf-8") as f:
        json.dump(health_payload, f, ensure_ascii=False, indent=2)

    # meta.json
    meta_payload = build_meta(generated_at, final)
    with open(META_PATH, "w", encoding="utf-8") as f:
        json.dump(meta_payload, f, ensure_ascii=False, indent=2)

    # brief.json
    brief_payload = build_brief(generated_at, final)
    with open(BRIEF_PATH, "w", encoding="utf-8") as f:
        json.dump(brief_payload, f, ensure_ascii=False, indent=2)

    # ✅ videos.json (jen YouTube playlisty)
    # dedup podle videoId, řazení od nejnovějších
    yt_sorted = sorted(
        yt_videos,
        key=lambda v: v.get("_dt") or datetime.now(timezone.utc),
        reverse=True
    )
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

    videos_payload = {
        "generatedAt": generated_at,
        "videos": out_vid
    }

    os.makedirs(os.path.dirname(VIDEOS_OUT_PATH), exist_ok=True)
    with open(VIDEOS_OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(videos_payload, f, ensure_ascii=False, indent=2)
    shutil.copy(VIDEOS_OUT_PATH, ROOT_VIDEOS_PATH)

    print("=== FEED REPORT ===")
    print(json.dumps(health_payload, ensure_ascii=False, indent=2))
    print(f"=== OUTPUT === wrote {len(final)} items to {OUT_PATH}")
    print(f"=== OUTPUT === wrote {len(out_vid)} videos to {VIDEOS_OUT_PATH}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
