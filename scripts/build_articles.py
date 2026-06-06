#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import os
import random
import re
import hashlib
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

import feedparser
import requests

# Hardening for Windows Task Scheduler (0x8007010B): force CWD = repo root
BASE = r"C:\projects\filtr"
if os.path.isdir(BASE):
    os.chdir(BASE)
# Run log (append) – Gate B: feed_build.log created
try:
    _log = open("feed_build.log", "a", encoding="utf-8")
    _log.write("\n=== RUN " + str(datetime.now()) + " ===\n")
    _log.close()
except Exception:
    pass

# =========================
# Konfigurace
# =========================

_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

from iu_blocked_sources import iu_is_blocked_pocasicko_source
from iu_registry import (
    SOURCE_BATCH_INTERNAL_GAP_MS_DEFAULT,
    P0_FRESHNESS_SLOT_KEYS,
    P0_HEADLINE_REGISTRY_IDS,
    collapse_feeds_by_url,
    compute_display_score,
    entry_fixed_slot_key,
    is_hard_blocked_url,
    load_registry,
    load_scheduler_state,
    mark_feed_error,
    mark_feeds_fetched,
    merge_article_lists,
    purge_blocked_articles,
    registry_active_entries,
    save_scheduler_state,
    scheduler_cooldown_key,
    select_feeds_for_tick,
    rotation_plan_for_registry,
    set_entries_in_flight,
    clear_entries_in_flight,
)
from iu_article_scheduler import (
    build_pipeline_report,
    build_scheduler_report,
    build_topic_diversity_report,
    emit_reports,
    write_latest_valid_snapshot,
)
from iu_source_diversity import apply_section_display_diversity
from iu_staging import (
    deserialize_youtube_row,
    ensure_staging_dirs,
    load_staging_for_aggregate,
    read_aggregated_checkpoint,
    serialize_youtube_row,
    write_aggregated_checkpoint,
    write_ingest_manifest,
    write_source_staging,
    write_youtube_staging,
)
from ingest_telemetry import build_telemetry_payload, print_compact_audit, section_bucket
from iu_feed_classification import classification_coverage_stats, enrich_article_list
from iu_crawler import (
    GLOBAL_MIN_REQUEST_INTERVAL_SEC as _CRAWLER_MIN_INTERVAL,
    IU_BOT_FROM_HEADER,
    IU_USER_AGENT,
    REQUEST_TIMEOUT_SEC as _CRAWLER_TIMEOUT,
    crawler_request_headers,
    is_rate_limit_response,
    rate_limit_backoff_sec,
    robots_allowed_for_url,
)
from iu_backpressure import (
    PublishTimeBudget,
    queue_depth,
    split_publish_batch,
)
from iu_topic_dedupe import apply_topic_event_dedupe

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # repo root
FEEDS_PATH = os.path.join(ROOT_DIR, "scripts", "feeds.json")
REGISTRY_PATH = os.path.join(ROOT_DIR, "projects", "data", "source_registry.json")
SCHEDULER_STATE_PATH = os.path.join(ROOT_DIR, "projects", "data", "scheduler_state.json")

# ✅ YouTube playlisty – samostatný soubor
FEEDS_YOUTUBE_PATH = os.path.join(ROOT_DIR, "scripts", "feeds_youtube.json")

# ✅ Allowlist pro YouTube zdroje (CZ + svět) – kanály/handly + kategorie + váhy
VIDEOS_ALLOWLIST_PATH = os.path.join(ROOT_DIR, "projects", "data", "videos_allowlist.json")

# ✅ FIX: Output directory - použij env OUTPUT_DIR nebo default filtr/data
OUTPUT_DIR = os.getenv("OUTPUT_DIR", os.path.join(ROOT_DIR, "projects", "data"))
os.makedirs(OUTPUT_DIR, exist_ok=True)

OUT_PATH = os.path.join(OUTPUT_DIR, "articles.json")
HEALTH_PATH = os.path.join(OUTPUT_DIR, "feed_health.json")
BRIEF_PATH = os.path.join(OUTPUT_DIR, "brief.json")
META_PATH = os.path.join(OUTPUT_DIR, "meta.json")
INGEST_TELEMETRY_PATH = os.path.join(OUTPUT_DIR, "ingest_telemetry", "latest.json")
TOPIC_DEDUPE_SUPPRESSED_PATH = os.path.join(OUTPUT_DIR, "topic_dedupe_suppressed.json")

# ✅ Retention storage (sharded by day; append-only with dedup)
ARTICLES_SHARD_DIR = os.path.join(OUTPUT_DIR, "articles")
ARTICLES_INDEX_PATH = os.path.join(ARTICLES_SHARD_DIR, "index.json")
ARTICLES_BOOTSTRAP_PATH = os.path.join(ARTICLES_SHARD_DIR, "bootstrap.json")
BOOTSTRAP_MAX_ARTICLES = 1000
BOOTSTRAP_HARD_CAP = 1100

# ✅ NOVĚ: výstup videí (pro assets/app.js)
VIDEOS_OUT_PATH = os.path.join(OUTPUT_DIR, "videos.json")

USER_AGENT = IU_USER_AGENT
BOT_FROM_HEADER = IU_BOT_FROM_HEADER
REQUEST_TIMEOUT_SEC = _CRAWLER_TIMEOUT

MAX_ITEMS_PER_FEED = 40

# Anti-block + výstupní limity (see iu_crawler.py)
GLOBAL_MIN_REQUEST_INTERVAL_SEC = _CRAWLER_MIN_INTERVAL
MAX_TOPIC_DEDUPE_PER_KEY = 2
MAX_ARTICLES_PER_SOURCE_DISPLAY = 2
NICHE_MAX_FRACTION = 0.38

# Retence denních shardů v projects/data/articles (počet dnů dozadu včetně dneška)
# Safe default: 45 dní (dost historie, ale repo neroste do nekonečna).
try:
    RETENTION_DAYS = int(os.getenv("RETENTION_DAYS", "45") or "45")
except Exception:
    RETENTION_DAYS = 45
if RETENTION_DAYS < 1:
    RETENTION_DAYS = 1

# YouTube videa: kolik nejvýše uložit do videos.json (frontend si vybere čerstvé)
MAX_OUTPUT_VIDEOS = 120

# Jaccard práh pro shlukování "stejného tématu" napříč médii (titulek podobný)
CLUSTER_JACCARD_THRESHOLD = 0.56

# --- Conservative story clustering (post second-layer; same section + high-confidence only) ---
STORY_CLUSTER_JACCARD_STRONG = 0.34
STORY_CLUSTER_JACCARD_WEAK = 0.25
STORY_CLUSTER_MIN_SHARED_TOKENS_WEAK = 4

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
# Pozor: žádné příliš krátké substringy („trh“ zasahuje do „na trhu“ v nesouvisejících článcích).
KW_FINANCE = {
    "akcie", "burza", "investic", "dluhopis", "úrok", "sazby", "inflace", "zisk", "ztrát", "tržb", "čez",
    "koruna", "kurz", "davos", "fond", "valuace", "prospekt", "ipo", "banka", "bankov", "měnov", "byznys",
    "ekonomika", "ekonomick", "ministerstvo financ", "hypoték", "úvěr", "spořicí", "stavebnictv", "reality",
    "burzovn", "devizov", "účetn",
}
KW_SPORT = {
    "liga", "mistrů", "zápas", "gól", "hokej", "fotbal", "tenis", "biatlon", "olymp", "nhl", "f1", "grand slam",
    "extraliga", "kvalifik", "turnaj", "trenér", "brankář", "střelec", "mma", "ufc", "box", "zápasník",
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
SECTION_ORDER = ["pocasi", "doprava", "aktualne", "krimi", "finance", "sport", "zdravi", "cestovani", "hry", "kultura", "veda", "vzdelavani"]

VALID_SECTIONS = {"pocasi","doprava","aktualne","krimi","finance","sport","zdravi","cestovani","hry","kultura","veda","vzdelavani"}

# Per-sekční retence ve veřejném articles.json (žádný globální „media pool“ / finální globální řez po retenci).
SECTION_RETENTION_CAP_DEFAULT = 12_500
SECTION_RETENTION_CAP_OVERRIDES: dict[str, int] = {
    "aktualne": 30_000,
    "sport": 20_000,
}


def section_retention_cap(canonical_section: str) -> int:
    """Tvrdý strop počtu článků v kanonické sekci po limitech a po sloučení s veřejným předchozím datasetem."""
    s = (canonical_section or "").strip().lower()
    v = SECTION_RETENTION_CAP_OVERRIDES.get(s)
    if v is not None:
        return int(v)
    return int(SECTION_RETENTION_CAP_DEFAULT)


# merge_article_lists(): horní mez jen proti nekonečnému růstu working setu před per-sekčním zpracováním;
# nesmí globálně „useknout“ články dřív než per-sekční retence (žádný finální globální pool cut).
MAX_MERGED_ARTICLES_POOL = 2_000_000


def _section_retention_manifest() -> dict:
    """Metadata ve výstupu — výhradně per-sekční capy (žádný globální maxPool)."""
    caps = {s: section_retention_cap(s) for s in SECTION_ORDER}
    return {
        "model": "per-section-only",
        "defaultCap": SECTION_RETENTION_CAP_DEFAULT,
        "capsByCanonicalSection": caps,
        "overrides": dict(SECTION_RETENTION_CAP_OVERRIDES),
        "canonicalSectionCount": len(SECTION_ORDER),
    }

# Kanonické CZ vertikály — RSS topic v registru musí přesně odpovídat (infer_section se přeskakuje).
FORCED_FEED_TOPICS = frozenset({"hry", "kultura", "veda", "vzdelavani", "cestovani"})

# MODEL_2: vertical purity guard — kandidátní sekce jako dosud, vertikály mohou spadnout do aktualne nebo být vyřazeny.
VERTICAL_PURITY_SECTIONS = frozenset({"vzdelavani", "cestovani", "veda", "kultura", "hry"})
VERTICAL_STALE_MAX_AGE_HOURS = 168
# Cestování: dealové články často >7 dní v RSS; 168h by vyprázdnilo sekci (viz produktové důkazy).
VERTICAL_STALE_MAX_AGE_HOURS_CESTOVANI = 720
EXTREME_ARCHIVE_DAYS_VERTICAL = 365

# Postupné uvolňování do veřejného JSON (per sekce za běh buildu)
SECTION_RELEASE_STATE_PATH = os.path.join(OUTPUT_DIR, "section_release_state.json")
MAX_SECTION_RELEASE_PER_RUN = 15


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


def _safe_read_json(path: str):
    try:
        if not path or not os.path.exists(path):
            return None
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _atomic_write_json(path: str, payload) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def _feed_transport_state_path() -> str:
    return os.path.join(OUTPUT_DIR, "feed_transport_state.json")


def _feed_snapshot_dir() -> str:
    d = os.path.join(OUTPUT_DIR, "feed_snapshots")
    os.makedirs(d, exist_ok=True)
    return d


def _url_fingerprint(url: str) -> str:
    return hashlib.sha256((url or "").encode("utf-8")).hexdigest()


def load_transport_state() -> dict:
    data = _safe_read_json(_feed_transport_state_path())
    if not isinstance(data, dict):
        return {"feeds": {}}
    if "feeds" not in data:
        data["feeds"] = {}
    return data


def save_transport_state(state: dict) -> None:
    _atomic_write_json(_feed_transport_state_path(), state)


def _rate_limit_sleep(last_req_ts: list, stagger_sec: float = 0.0) -> None:
    if stagger_sec > 0:
        time.sleep(stagger_sec)
    now = time.time()
    elapsed = now - last_req_ts[0]
    need = GLOBAL_MIN_REQUEST_INTERVAL_SEC - elapsed
    if need > 0:
        time.sleep(need + random.uniform(0, 0.35))
    last_req_ts[0] = time.time()


def http_fetch_rss_body(url: str, transport: dict, last_req_ts: list) -> tuple:
    """
    Vrací (text, diagnostics, updated_etag, updated_lastmod).
    text je tělo RSS nebo prázdné při fatální chybě.
    """
    diag = {
        "httpStatus": 0,
        "contentType": "",
        "finalUrl": url,
        "bytes": 0,
        "reason": "",
        "bozo": False,
        "bozoException": "",
    }
    fp = _url_fingerprint(url)
    snap_path = os.path.join(_feed_snapshot_dir(), fp + ".xml")
    feeds_map = transport.setdefault("feeds", {})
    entry = feeds_map.get(url) if isinstance(feeds_map.get(url), dict) else {}
    etag = (entry.get("etag") or "").strip()
    last_mod = (entry.get("last_modified") or "").strip()

    def _do_get(use_conditional: bool):
        headers = dict(crawler_request_headers())
        if use_conditional:
            if etag:
                headers["If-None-Match"] = etag
            if last_mod:
                headers["If-Modified-Since"] = last_mod
        stagger = random.uniform(0, 2.2)
        _rate_limit_sleep(last_req_ts, stagger_sec=stagger)
        return requests.get(
            url,
            headers=headers,
            timeout=REQUEST_TIMEOUT_SEC,
            allow_redirects=True,
            stream=False,
        )

    new_etag = etag
    new_lm = last_mod
    backoff = 1.0

    allowed, robots_reason = robots_allowed_for_url(url, OUTPUT_DIR, last_req_ts)
    if not allowed:
        diag["reason"] = robots_reason
        diag["httpStatus"] = 0
        return "", diag, new_etag, new_lm

    for attempt in range(4):
        try:
            response = _do_get(use_conditional=(attempt == 0))
            status_code = response.status_code
            diag["httpStatus"] = status_code
            diag["finalUrl"] = response.url or url
            ct = (response.headers.get("Content-Type") or "").lower()
            diag["contentType"] = ct
            new_etag = (response.headers.get("ETag") or new_etag or "").strip() or new_etag
            new_lm = (response.headers.get("Last-Modified") or new_lm or "").strip() or new_lm

            if status_code == 304:
                if os.path.isfile(snap_path):
                    with open(snap_path, "r", encoding="utf-8", errors="replace") as sf:
                        text = sf.read()
                    diag["bytes"] = len((text or "").encode("utf-8", errors="ignore"))
                    feeds_map[url] = {"etag": new_etag, "last_modified": new_lm}
                    return text, diag, new_etag, new_lm
                response = _do_get(use_conditional=False)
                status_code = response.status_code
                diag["httpStatus"] = status_code
                diag["finalUrl"] = response.url or url
                ct = (response.headers.get("Content-Type") or "").lower()
                diag["contentType"] = ct
                new_etag = (response.headers.get("ETag") or new_etag or "").strip() or new_etag
                new_lm = (response.headers.get("Last-Modified") or new_lm or "").strip() or new_lm

            if status_code >= 400:
                diag["reason"] = f"http_{status_code}"
                if is_rate_limit_response(status_code) and attempt < 3:
                    time.sleep(
                        rate_limit_backoff_sec(attempt, status_code)
                        + random.uniform(0, 0.5)
                    )
                    continue
                if attempt < 3:
                    time.sleep(backoff + random.uniform(0, 0.45))
                    backoff *= 2
                    continue
                return "", diag, new_etag, new_lm

            if status_code != 200:
                diag["reason"] = f"http_{status_code}"
                if is_rate_limit_response(status_code) and attempt < 3:
                    time.sleep(
                        rate_limit_backoff_sec(attempt, status_code)
                        + random.uniform(0, 0.5)
                    )
                    continue
                if attempt < 3:
                    time.sleep(backoff + random.uniform(0, 0.45))
                    backoff *= 2
                    continue
                return "", diag, new_etag, new_lm

            text = response.text or ""
            diag["bytes"] = len(text.encode("utf-8", errors="ignore"))
            try:
                with open(snap_path, "w", encoding="utf-8") as sf:
                    sf.write(text)
            except Exception:
                pass
            feeds_map[url] = {"etag": new_etag, "last_modified": new_lm}
            return text, diag, new_etag, new_lm

        except requests.exceptions.Timeout:
            diag["reason"] = "fetch_timeout"
        except requests.exceptions.RequestException:
            diag["reason"] = "fetch_failed"
        except Exception as e:
            diag["reason"] = "exception"
            diag["bozoException"] = str(e)

        if attempt < 3:
            time.sleep(backoff + random.uniform(0, 0.45))
            backoff *= 2

    return "", diag, new_etag, new_lm


def topic_hash_from_title(title: str) -> str:
    toks = tokenize_title(title or "")
    joined = " ".join(sorted(toks))[:240]
    return hashlib.sha1(joined.encode("utf-8", errors="ignore")).hexdigest()[:16]


def _primary_category_from_cluster_items(items: list) -> str:
    for it in sorted(items, key=lambda x: x["dt"], reverse=True):
        fc = (it.get("feedCategory") or "").strip()
        if fc:
            return fc
    return "aktualne"


def _feed_type_from_cluster_items(items: list) -> str:
    for it in sorted(items, key=lambda x: x["dt"], reverse=True):
        ft = (it.get("feedType") or "").strip()
        if ft:
            return ft
    return "general"


def _pick_stagger_release_urls(unreleased: list, pending: dict, max_n: int) -> list:
    """
    Round-robin výběr nejstarších pending URL napříč feedId (diversity),
    místo sekvenčního řezu jen podle publishedAt (který soustředí jeden zdroj).
    """
    if not unreleased or max_n <= 0:
        return []

    by_fid = defaultdict(list)
    for u in unreleased:
        art = pending.get(u) or {}
        fid = str(art.get("feedId") or "").strip() or "_"
        by_fid[fid].append(u)
    for fid in by_fid:
        by_fid[fid].sort(key=lambda u: str((pending.get(u) or {}).get("publishedAt") or ""))

    fids = sorted(
        by_fid.keys(),
        key=lambda f: str((pending.get(by_fid[f][0]) or {}).get("publishedAt") or "") if by_fid[f] else "",
    )
    picked = []
    while len(picked) < max_n:
        progressed = False
        for fid in fids:
            if len(picked) >= max_n:
                break
            if by_fid[fid]:
                picked.append(by_fid[fid].pop(0))
                progressed = True
        if not progressed:
            break
    return picked


def apply_staggered_section_release(articles: list, generated_at: str) -> list:
    """
    Throttle nových položek pro CZ vertikály: backlog v section_release_state.json,
    max MAX_SECTION_RELEASE_PER_RUN nových URL na sekci za běh.
    publishedAt zůstává z RSS; iuReleaseAt je interní gate (nezaměňovat se zdrojem).
    """
    if not articles:
        return articles

    state_root = _safe_read_json(SECTION_RELEASE_STATE_PATH) or {}
    if not isinstance(state_root, dict):
        state_root = {}
    sec_state_in = state_root.get("sections")
    if not isinstance(sec_state_in, dict):
        sec_state_in = {}

    normal = []
    by_sec = {k: [] for k in FORCED_FEED_TOPICS}
    for a in articles:
        t = str(a.get("topic") or a.get("section") or "").strip().lower()
        if t in FORCED_FEED_TOPICS:
            by_sec[t].append(a)
        else:
            normal.append(a)

    out_vertical = []
    new_sections_state = {}

    try:
        base_dt = datetime.fromisoformat(str(generated_at).replace("Z", "+00:00"))
    except Exception:
        base_dt = datetime.now(timezone.utc)

    for sec in sorted(FORCED_FEED_TOPICS):
        candidates = by_sec.get(sec) or []
        prev = sec_state_in.get(sec)
        if not isinstance(prev, dict):
            prev = {}
        released_list = list(prev.get("released") or [])
        if not isinstance(released_list, list):
            released_list = []
        released_set = set(str(x).strip() for x in released_list if str(x).strip())

        pending_in = prev.get("pending")
        pending = {}
        if isinstance(pending_in, dict):
            pending = dict(pending_in)

        for a in candidates:
            url = canonicalize_url(a.get("url") or "")
            if not url:
                continue
            old = pending.get(url)
            merged = dict(a)
            if isinstance(old, dict) and old.get("iuReleaseAt"):
                merged["iuReleaseAt"] = old["iuReleaseAt"]
            pending[url] = merged

        released_set = {u for u in released_set if u in pending}

        unreleased_urls = [u for u in pending.keys() if u not in released_set]
        today_prague = _prague_today_iso(base_dt)
        auto_today: list[str] = []
        for u in unreleased_urls:
            art0 = pending.get(u) or {}
            if _prague_day_from_iso(str(art0.get("publishedAt") or "")) == today_prague:
                auto_today.append(u)
                released_set.add(u)
        still_unreleased = [u for u in unreleased_urls if u not in auto_today]
        newly = _pick_stagger_release_urls(still_unreleased, pending, MAX_SECTION_RELEASE_PER_RUN)
        for u in newly:
            released_set.add(u)

        new_idx = {u: i for i, u in enumerate(newly)}
        sec_out = []
        # Všechny pending URL patří do articles.json; iuReleaseAt řídí jen UI viditelnost.
        # Dříve unreleased v JSON vůbec nebyly → guardy a sekce viděly 0 dnešních položek.
        unreleased_gate = base_dt + timedelta(days=30)
        for u in sorted(pending.keys(), key=lambda x: str(pending.get(x, {}).get("publishedAt") or ""), reverse=True):
            if u not in pending:
                continue
            art = dict(pending[u])
            if u in new_idx:
                rel_dt = base_dt + timedelta(seconds=new_idx[u])
                art["iuReleaseAt"] = rel_dt.isoformat().replace("+00:00", "Z")
            elif u in released_set:
                if not art.get("iuReleaseAt"):
                    art["iuReleaseAt"] = generated_at
            else:
                if not art.get("iuReleaseAt"):
                    art["iuReleaseAt"] = unreleased_gate.isoformat().replace("+00:00", "Z")
            sec_out.append(art)

        out_vertical.extend(sec_out)
        new_sections_state[sec] = {
            "released": sorted(released_set),
            "pending": pending,
        }

    out_root = dict(state_root)
    out_root["generatedAt"] = generated_at
    out_root["sections"] = new_sections_state
    try:
        _atomic_write_json(SECTION_RELEASE_STATE_PATH, out_root)
    except Exception as e:
        print("WARN: section_release_state write failed:", str(e))

    merged = normal + out_vertical
    merged.sort(key=lambda a: str(a.get("publishedAt") or ""), reverse=True)
    return merged


def apply_topic_and_source_limits(articles: list) -> list:
    """Max N stejného topicHash v rámci primaryCategory; max M článků na zdroj (jméno) v rámci topic/section.
    Klíč (zdroj × topic): stejný RSS zdroj (Novinky, iROZHLAS) nesmí vyčerpat limit v zprávách a zároveň
    vyřadit položky jiných sekcí (hry/kultura/veda/vzdelavani)."""
    if not articles:
        return articles

    out = []
    topic_counts = {}
    source_counts = {}

    for a in articles:
        th = (a.get("topicHash") or "").strip()
        pc = (a.get("primaryCategory") or "aktualne").strip()
        sec = str(a.get("topic") or a.get("section") or "").strip() or "_"
        src0 = (a.get("sources") or [{}])[0] if isinstance(a.get("sources"), list) else {}
        sname = normalize_media_name(str((src0.get("name") if isinstance(src0, dict) else "") or "").strip())
        if not sname:
            sname = "unknown"

        tk = (pc, th) if th else (pc, a.get("url") or a.get("title"))
        if topic_counts.get(tk, 0) >= MAX_TOPIC_DEDUPE_PER_KEY:
            continue
        fid = str(a.get("feedId") or "").strip()
        # CZ vertikály: limit per RSS feed (id), ne per normalizované jméno — jinak sdílí bucket
        # např. „Novinky.cz – Věda“ + „Novinky.cz – Historie“ → stejný display prefix.
        if sec in FORCED_FEED_TOPICS and fid:
            src_key = ("feed:" + fid, sec)
        else:
            src_key = (sname, sec)
        if source_counts.get(src_key, 0) >= MAX_ARTICLES_PER_SOURCE_DISPLAY:
            continue

        topic_counts[tk] = topic_counts.get(tk, 0) + 1
        source_counts[src_key] = source_counts.get(src_key, 0) + 1
        out.append(a)
    return out


def apply_niche_fraction_limit(articles: list) -> list:
    niche = [a for a in articles if str(a.get("feedType") or "") == "niche"]
    rest = [a for a in articles if str(a.get("feedType") or "") != "niche"]
    if not niche or not articles:
        return articles
    max_niche = int(len(articles) * NICHE_MAX_FRACTION + 0.999)
    max_niche = max(1, max_niche)
    if len(niche) <= max_niche:
        return articles
    niche_sorted = sorted(niche, key=lambda x: str(x.get("publishedAt") or ""), reverse=True)[:max_niche]
    merged = rest + niche_sorted
    merged.sort(key=lambda x: str(x.get("publishedAt") or ""), reverse=True)
    return merged


def _retention_section_key(article: dict) -> str:
    """Kanonický klíč sekce pro výstupní retenci (shodné s stable_section / frontend topic)."""
    if not isinstance(article, dict):
        return "aktualne"
    return stable_section(str(article.get("topic") or article.get("section") or "aktualne"))


def _apply_niche_fraction_if_mixed_feedtypes(rows: list) -> list:
    """
    Globální NICHE_MAX_FRACTION je myšlený pro smíšený feed. V sekci, kde jsou jen niche feedy,
    by 38 % řez zničilo celý vertikální pool — v takovém případě nic nedělej.
    """
    if not rows:
        return rows
    types = [str((r.get("feedType") or "") if isinstance(r, dict) else "") for r in rows]
    all_niche = bool(types) and all(t == "niche" for t in types)
    no_niche = not any(t == "niche" for t in types)
    if all_niche or no_niche:
        return rows
    return apply_niche_fraction_limit(rows)


def _vertical_section_priority(article: dict) -> int:
    """Při kolizi stejné URL preferovat vertikální zařazení před aktualne (syndikované rubriky)."""
    if not isinstance(article, dict):
        return 0
    sec = stable_section(str(article.get("topic") or article.get("section") or "aktualne"))
    if sec in FORCED_FEED_TOPICS and str(article.get("feedId") or "").strip():
        return 3
    if sec in FORCED_FEED_TOPICS:
        return 2
    if sec == "aktualne":
        return 0
    return 1


def _p0_headline_article_priority(article: dict) -> int:
    """P0 headline rubric wins retention URL dedupe vs same-URL vertical syndication."""
    if not isinstance(article, dict):
        return 0
    return 1 if str(article.get("feedId") or "").strip() in P0_HEADLINE_REGISTRY_IDS else 0


def _pick_url_collision_winner(a: dict, b: dict) -> dict:
    pha, phb = _p0_headline_article_priority(a), _p0_headline_article_priority(b)
    if pha != phb:
        return a if pha > phb else b
    pa, pb = _vertical_section_priority(a), _vertical_section_priority(b)
    if pa != pb:
        return a if pa > pb else b
    ta = str(a.get("publishedAt") or "")
    tb = str(b.get("publishedAt") or "")
    return a if ta >= tb else b


def _ingest_item_for_priority(it: dict) -> dict:
    """Map staging ingest item to article-shaped dict for vertical URL priority."""
    if not isinstance(it, dict):
        return {}
    dt = it.get("dt")
    pub = dt.isoformat().replace("+00:00", "Z") if hasattr(dt, "isoformat") else ""
    return {
        "topic": it.get("section"),
        "section": it.get("section"),
        "publishedAt": pub,
        "feedId": it.get("feedId"),
        "url": it.get("url"),
    }


def _coerce_ingest_dt(val) -> datetime:
    if isinstance(val, datetime):
        return val
    if val:
        try:
            return datetime.fromisoformat(str(val).replace("Z", "+00:00"))
        except Exception:
            pass
    return datetime.min.replace(tzinfo=timezone.utc)


def _p0_headline_ingest_priority(it: dict) -> int:
    """P0 headline rubric wins URL dedupe vs same-URL vertical syndication from one publisher."""
    if not isinstance(it, dict):
        return 0
    return 1 if str(it.get("feedId") or "").strip() in P0_HEADLINE_REGISTRY_IDS else 0


def _pick_ingest_item_collision_winner(a: dict, b: dict) -> dict:
    pha, phb = _p0_headline_ingest_priority(a), _p0_headline_ingest_priority(b)
    if pha != phb:
        return a if pha > phb else b
    pa = _vertical_section_priority(_ingest_item_for_priority(a))
    pb = _vertical_section_priority(_ingest_item_for_priority(b))
    if pa != pb:
        return a if pa > pb else b
    return a if _coerce_ingest_dt(a.get("dt")) >= _coerce_ingest_dt(b.get("dt")) else b


def _dedupe_ingest_items_by_url_priority(items: list) -> list:
    """Pre-cluster dedupe: same URL from headline + vertical rubric → P0 headline feedId wins."""
    by_url: dict[str, dict] = {}
    orphans: list = []
    for it in items or []:
        if not isinstance(it, dict):
            continue
        u = canonicalize_url((it.get("url") or "").strip())
        if not u:
            orphans.append(it)
            continue
        prev = by_url.get(u)
        by_url[u] = it if prev is None else _pick_ingest_item_collision_winner(prev, it)
    out = list(by_url.values()) + orphans
    out.sort(key=lambda x: _coerce_ingest_dt(x.get("dt")), reverse=True)
    return out


def _dedupe_articles_by_url_global(articles: list) -> list:
    by_url: dict[str, dict] = {}
    for r in articles or []:
        if not isinstance(r, dict):
            continue
        u = canonicalize_url((r.get("url") or "").strip())
        if not u:
            continue
        prev = by_url.get(u)
        by_url[u] = r if prev is None else _pick_url_collision_winner(prev, r)
    out = list(by_url.values())
    out.sort(key=lambda x: str(x.get("publishedAt") or ""), reverse=True)
    return out


def apply_per_section_limits_then_cap(articles: list) -> list:
    """
    Výstup pro articles.json: limity zvlášť v každé kanonické sekci — niche fraction
    a topic/source limity jen uvnitř dané sekce. Poté až per-sekční cap (section_retention_cap),
    dedupe URL v sekci, sloučení všech sekcí a řazení podle publishedAt + dedupe URL napříč sekcemi.
    Žádný globální finální pool cut.
    """
    if not articles:
        return []
    by_sec: dict[str, list] = defaultdict(list)
    for a in articles:
        if not isinstance(a, dict):
            continue
        by_sec[_retention_section_key(a)].append(a)

    out: list = []
    seen_sec: set[str] = set()
    for sec in SECTION_ORDER:
        if sec not in by_sec:
            continue
        seen_sec.add(sec)
        cap = section_retention_cap(sec)
        rows = sorted(by_sec[sec], key=lambda x: str(x.get("publishedAt") or ""), reverse=True)
        rows = apply_topic_and_source_limits(rows)
        rows = _apply_niche_fraction_if_mixed_feedtypes(rows)
        url_seen: set[str] = set()
        deduped: list = []
        for r in rows:
            u = canonicalize_url((r.get("url") or "").strip())
            if not u:
                continue
            if u in url_seen:
                continue
            url_seen.add(u)
            deduped.append(r)
        out.extend(deduped[:cap])

    for sec in sorted(by_sec.keys()):
        if sec in seen_sec:
            continue
        cap = section_retention_cap(sec)
        rows = sorted(by_sec[sec], key=lambda x: str(x.get("publishedAt") or ""), reverse=True)
        rows = apply_topic_and_source_limits(rows)
        rows = _apply_niche_fraction_if_mixed_feedtypes(rows)
        url_seen = set()
        deduped = []
        for r in rows:
            u = canonicalize_url((r.get("url") or "").strip())
            if not u:
                continue
            if u in url_seen:
                continue
            url_seen.add(u)
            deduped.append(r)
        out.extend(deduped[:cap])

    merged = _dedupe_articles_by_url_global(out)
    global _TOPIC_DIVERSITY_LAST_STATS
    merged, div_stats = apply_section_display_diversity(merged, _retention_section_key)
    _TOPIC_DIVERSITY_LAST_STATS = div_stats
    return merged


def apply_per_section_published_retention(prev_public: list, capped_feed: list) -> list:
    """
    Per-section append-only semantics for already shipped URLs (stable canonical URL identity).
    Runs after apply_per_section_limits_then_cap (current curated feed).

    1) Merge previous public articles.json with this run's capped output by URL; capped_feed wins
       on collision (newer pipeline metadata / section).
    2) Bucket by canonical section (_retention_section_key).
    3) Within each section: sort newest first, hard cap section_retention_cap(sec) — trim
       only the oldest tail (same URL cannot appear twice in a section).
    4) Flatten, global sort by publishedAt, URL dedupe — no global pool cut after retention.
    """
    by_url: dict[str, dict] = {}
    for a in prev_public or []:
        if not isinstance(a, dict):
            continue
        u = canonicalize_url((a.get("url") or "").strip())
        if not u or is_hard_blocked_url(u):
            continue
        by_url[u] = dict(a)
    for a in capped_feed or []:
        if not isinstance(a, dict):
            continue
        u = canonicalize_url((a.get("url") or "").strip())
        if not u or is_hard_blocked_url(u):
            continue
        prev = by_url.get(u)
        by_url[u] = dict(a) if prev is None else _pick_url_collision_winner(prev, dict(a))

    by_sec: dict[str, list] = defaultdict(list)
    for _u, a in by_url.items():
        by_sec[_retention_section_key(a)].append(a)

    flat: list = []
    seen_sec: set[str] = set()
    for sec in SECTION_ORDER:
        if sec not in by_sec:
            continue
        seen_sec.add(sec)
        cap = section_retention_cap(sec)
        rows = sorted(
            by_sec[sec], key=lambda x: str(x.get("publishedAt") or ""), reverse=True
        )
        if len(rows) > cap:
            rows = rows[:cap]
        flat.extend(rows)
    for sec in sorted(by_sec.keys()):
        if sec in seen_sec:
            continue
        cap = section_retention_cap(sec)
        rows = sorted(
            by_sec[sec], key=lambda x: str(x.get("publishedAt") or ""), reverse=True
        )
        if len(rows) > cap:
            rows = rows[:cap]
        flat.extend(rows)

    return _dedupe_articles_by_url_global(flat)


def _retention_key(it: dict) -> str:
    """
    Dedup key for retention:
    - primary: canonical URL
    - fallback: sha1(sourceHost + publishedAt + title)
    """
    try:
        url = (it.get("url") or "").strip()
        if url:
            return "url:" + canonicalize_url(url)
        sources = it.get("sources")
        src0 = (sources or [{}])[0] if isinstance(sources, list) else {}
        src_url = (src0.get("url") or "").strip() if isinstance(src0, dict) else ""
        if src_url:
            return "url:" + canonicalize_url(src_url)
        host = (urlparse(src_url).netloc or "").lower()
        pub = (it.get("publishedAt") or "").strip()
        title = (it.get("title") or "").strip()
        raw = (host + "|" + pub + "|" + title).encode("utf-8", errors="ignore")
        return "h:" + hashlib.sha1(raw).hexdigest()
    except Exception:
        return "h:" + hashlib.sha1(repr(it).encode("utf-8", errors="ignore")).hexdigest()


def _bootstrap_time_key(it: dict) -> str:
    """Same temporal fields as runtime feed sort (assets/app.js enriched items)."""
    return str(
        it.get("publishedAt")
        or it.get("published")
        or it.get("date")
        or it.get("createdAt")
        or it.get("uploadedAt")
        or it.get("time")
        or ""
    ).strip()


def _bootstrap_sort_tuple(it: dict) -> tuple:
    return (_bootstrap_time_key(it), str(it.get("url") or "").strip())


def _articles_dict_list(final) -> list:
    return [x for x in (final or []) if isinstance(x, dict)]


def _trim_bootstrap_past_hard_cap(combined: list, hard_cap: int) -> list:
    """Drop oldest items (after global desc sort) only if their section still has ≥2 rows."""
    if len(combined) <= hard_cap:
        return combined
    out = list(combined)
    out.sort(key=_bootstrap_sort_tuple, reverse=True)
    while len(out) > hard_cap:
        cnt = Counter()
        for it in out:
            s = str(it.get("section") or "").strip()
            if s:
                cnt[s] += 1
        victim_idx = None
        for i in range(len(out) - 1, -1, -1):
            it = out[i]
            s = str(it.get("section") or "").strip()
            if not s or cnt.get(s, 0) > 1:
                victim_idx = i
                break
        if victim_idx is None:
            break
        out.pop(victim_idx)
    return out


def _build_bootstrap_entries(final: list) -> list:
    """
    Narrow parallel dataset for future windowing (Phase 1): prefix of articles.json order
    plus mandatory per-section coverage. Dedup = _retention_key (matches retention shards).
    """
    linear = _articles_dict_list(final)
    if not linear:
        return []
    sections_present: set[str] = set()
    for it in linear:
        s = str(it.get("section") or "").strip()
        if s:
            sections_present.add(s)

    prefix_len = min(BOOTSTRAP_MAX_ARTICLES, len(linear))
    extras: list = []
    while prefix_len >= 0:
        prefix = linear[:prefix_len]
        keys = {_retention_key(x) for x in prefix}
        extras = []
        for s in sorted(sections_present):
            if any(str(x.get("section") or "").strip() == s for x in prefix):
                continue
            picked = None
            for it in linear[prefix_len:]:
                if str(it.get("section") or "").strip() != s:
                    continue
                k = _retention_key(it)
                if k in keys:
                    continue
                picked = it
                break
            if picked is None:
                for it in linear:
                    if str(it.get("section") or "").strip() != s:
                        continue
                    k = _retention_key(it)
                    if k in keys:
                        continue
                    picked = it
                    break
            if picked is not None:
                extras.append(picked)
                keys.add(_retention_key(picked))
        if prefix_len + len(extras) <= BOOTSTRAP_HARD_CAP:
            break
        prefix_len -= 1

    combined = linear[: max(0, prefix_len)] + extras
    seen_k: set[str] = set()
    deduped: list = []
    for it in combined:
        k = _retention_key(it)
        if k in seen_k:
            continue
        seen_k.add(k)
        deduped.append(it)
    deduped.sort(key=_bootstrap_sort_tuple, reverse=True)
    deduped = _trim_bootstrap_past_hard_cap(deduped, BOOTSTRAP_HARD_CAP)
    deduped.sort(key=_bootstrap_sort_tuple, reverse=True)
    return deduped


def _emit_bootstrap_json(final: list, generated_at: str) -> None:
    """Write projects/data/articles/bootstrap.json (build-only; frontend unchanged)."""
    try:
        os.makedirs(ARTICLES_SHARD_DIR, exist_ok=True)
        articles = _build_bootstrap_entries(final)
        sec_counts: dict[str, int] = {}
        for it in articles:
            s = str(it.get("section") or "").strip()
            if not s:
                continue
            sec_counts[s] = sec_counts.get(s, 0) + 1
        payload = {
            "schemaVersion": 1,
            "generatedAt": generated_at,
            "articles": articles,
            "bootstrapMeta": {
                "canonicalBuildId": None,
                "articleCount": len(articles),
                "sectionCounts": sec_counts,
                "sort": "publishedAt_desc",
                "dedup": "url_canonical_v1",
            },
        }
        _atomic_write_json(ARTICLES_BOOTSTRAP_PATH, payload)
        print(
            f"=== OUTPUT === wrote {len(articles)} bootstrap items to {ARTICLES_BOOTSTRAP_PATH}",
            flush=True,
        )
    except Exception as e:
        print("WARN: articles bootstrap.json failed:", str(e), flush=True)


def normalize_media_name(name: str) -> str:
    # sjednotit "iDNES.cz – Krimi" / "Novinky / Cestování" -> čistý název média (bez rubriky)
    for sep in [" – ", " — ", " - ", " / "]:
        if sep in name:
            return name.split(sep, 1)[0].strip()
    return name.strip()


# Kanonické zobrazované názvy médií (sourceLabel) — podle domény URL, ne rubriky feedu.
DOMAIN_MEDIA_DISPLAY: dict[str, str] = {
    "seznamzpravy.cz": "Seznam Zprávy",
    "novinky.cz": "Novinky",
    "idnes.cz": "iDNES.cz",
    "servis.idnes.cz": "iDNES.cz",
    "ct24.ceskatelevize.cz": "ČT24",
    "ceskatelevize.cz": "ČT24",
    "sport.ceskatelevize.cz": "ČT sport",
    "aktualne.cz": "Aktuálně",
    "zpravy.aktualne.cz": "Aktuálně",
    "sport.aktualne.cz": "Aktuálně",
    "magazin.aktualne.cz": "Aktuálně",
    "denik.cz": "Deník",
    "sport.cz": "Sport.cz",
    "isport.blesk.cz": "iSport",
    "prozeny.cz": "ProŽeny",
    "forbes.cz": "Forbes",
    "hn.cz": "HN",
    "archiv.hn.cz": "HN",
    "ekonom.cz": "Ekonom (HN)",
}


def _host_from_article_url(url: str) -> str:
    try:
        h = (urlparse(str(url or "").strip()).netloc or "").lower()
        if h.startswith("www."):
            h = h[4:]
        return h
    except Exception:
        return ""


def media_source_display(raw_label: str, url: str = "") -> str:
    """
    Čistý název média pro UI (sourceLabel). Interní rubrika feedu se nepromítá.
    section/topic určuje zařazení článku — ne sourceLabel.
    """
    host = _host_from_article_url(url)
    if host in DOMAIN_MEDIA_DISPLAY:
        return DOMAIN_MEDIA_DISPLAY[host]
    for dom, disp in DOMAIN_MEDIA_DISPLAY.items():
        if host.endswith("." + dom) or host == dom:
            return disp
    norm = normalize_media_name(fix_cz_mojibake(str(raw_label or "")).strip())
    return norm or str(raw_label or "").strip()


def _apply_source_display_to_article(article: dict) -> dict:
    if not isinstance(article, dict):
        return article
    url = str(article.get("url") or "").strip()
    if not url:
        src0 = (article.get("sources") or [{}])[0]
        if isinstance(src0, dict):
            url = str(src0.get("url") or "").strip()
    raw = str(article.get("sourceLabel") or "").strip()
    if not raw:
        src0 = (article.get("sources") or [{}])[0]
        if isinstance(src0, dict):
            raw = str(src0.get("name") or "").strip()
    disp = media_source_display(raw, url)
    if disp:
        article["sourceLabel"] = disp
    srcs = article.get("sources")
    if isinstance(srcs, list):
        for s in srcs:
            if not isinstance(s, dict):
                continue
            s["name"] = media_source_display(str(s.get("name") or raw), str(s.get("url") or url))
    return article


def _apply_source_display_to_articles(articles: list) -> list:
    return [_apply_source_display_to_article(dict(a) if isinstance(a, dict) else a) for a in (articles or [])]


def _prague_tz():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo("Europe/Prague")
    except Exception:
        return timezone.utc


def _prague_today_iso(now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(_prague_tz()).strftime("%Y-%m-%d")


def _prague_day_from_iso(iso: str) -> str | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(_prague_tz()).strftime("%Y-%m-%d")
    except Exception:
        return None


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


def _token_set(value) -> set:
    """Normalize ingest/cluster tokens (set, list, tuple from JSON queue) for Jaccard."""
    if value is None:
        return set()
    if isinstance(value, set):
        return value
    if isinstance(value, (list, tuple)):
        return set(value)
    try:
        return set(value)
    except TypeError:
        return set()


def jaccard(a, b) -> float:
    sa = _token_set(a)
    sb = _token_set(b)
    if not sa or not sb:
        return 0.0
    inter = len(sa & sb)
    uni = len(sa | sb)
    return inter / uni if uni else 0.0


def _host_path(url: str) -> tuple:
    try:
        p = urlparse(url or "")
        return (p.netloc.lower(), p.path.lower())
    except Exception:
        return ("", "")


def _adjust_fallback_topic_for_path(url: str, fallback: str) -> str:
    """
    RSS často označí celý feed jako „finance“, ale položky odkazují na obecné zprávy (/zpravy/…).
    Bez této úpravy infer_section skončí na slepém fallback_topic=finance i pro nerelevantní URL.
    """
    host, path = _host_path(url or "")
    u = (url or "").lower()
    fb = (fallback or "aktualne").strip().lower()
    if fb not in VALID_SECTIONS:
        fb = "aktualne"

    economy_signals = (
        "/ekonomika" in path
        or "/finance" in path
        or "/byznys" in path
        or "byznys.hn.cz" in u
        or "e15.cz" in u
        or "roklen24.cz" in u
        or "patria.cz" in u
        or "mesec.cz" in u
        or "penize.cz" in u
        or "faei.cz" in u
        or "ekonomickydenik" in u
        or "investicni" in u
    )

    if fb == "finance":
        if "mmamag.cz" in host or "fights.cz" in host:
            return "sport"
        if host.startswith("tech.") and host.endswith("hn.cz"):
            return "aktualne"
        if economy_signals:
            return "finance"
        if "/zpravy/" in path or "zpravy-domov" in u or "zpravy-domaci" in u:
            return "aktualne"
        if "/zahranicni/" in path or "/domaci/" in path:
            if "/ekonomika" not in path:
                return "aktualne"
        if "irozhlas.cz" in u and "ekonomika" not in path and "byznys" not in path and "/zpravy" in path:
            return "aktualne"
        if "seznamzpravy.cz" in u and "ekonomika" not in path and "byznys" not in path:
            if "/clanek/zahranicni" in path or "/clanek/domaci" in path:
                return "aktualne"

    if fb == "zdravi":
        if "/zdravi" in path or "zdravi." in host or host.startswith("zdravi."):
            return "zdravi"
        if "/zpravy/" in path or "zpravy-domov" in u:
            return "aktualne"

    return fb


def remap_article_section_if_url_mismatch(a: dict) -> dict:
    """Oprava starých / špatně zařazených řádků ve sdíleném poolu podle URL (bez rozbití nového řazení)."""
    if not isinstance(a, dict):
        return a
    sec = str(a.get("topic") or a.get("section") or "").strip().lower()
    if sec not in ("finance", "zdravi"):
        return a
    u = (a.get("url") or "").strip()
    if not u:
        return a
    new_sec = _adjust_fallback_topic_for_path(u, sec)
    if new_sec == sec:
        return a
    o = dict(a)
    o["topic"] = o["section"] = new_sec
    return o


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

    # CESTOVÁNÍ — nesmí spadnout do Zpráv jen kvůli „zahraniční“ klíčovým slovům
    if "/cestovani" in path or "/cestovan" in path or "cestovani" in host:
        return "cestovani"

    # SPORT (vč. subdomén typu sport.aktualne.cz)
    if host.startswith("sport.") or "/sport" in path or "/fotbal" in path or "/hokej" in path or "/tenis" in path:
        return "sport"
    if "mmamag.cz" in host or "fights.cz" in host or host.startswith("isport."):
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

    # CESTOVÁNÍ (doplňující signály v URL)
    if "travel" in path or "letenk" in path or "pelipeck" in host:
        return "cestovani"

    def contains_kw(kwset: set) -> bool:
        for k in kwset:
            if k in t:
                return True
        return False

    # --- keyword signály v titulku (sport před finance — předejde falešným finance z titulku) ---
    if contains_kw(KW_POCASI):
        return "pocasi"
    if contains_kw(KW_DOPRAVA):
        return "doprava"
    if contains_kw(KW_ZDRAVI):
        return "zdravi"
    if contains_kw(KW_SPORT):
        return "sport"
    if contains_kw(KW_FINANCE):
        return "finance"
    if contains_kw(KW_KRIMI):
        return "krimi"

    fb = (fallback_topic or "aktualne").strip().lower()
    if fb not in VALID_SECTIONS:
        fb = "aktualne"
    fb = _adjust_fallback_topic_for_path(url, fb)
    return fb


def _infer_section_strong_explicit_url_signals(url: str) -> str | None:
    """
    Pouze host/path — žádné klíčové slovo z titulku.
    Slouží jako tvrdý „non-news“ signál pro registry feedy s fallback aktualne (Zprávy).
    Vrací sekci nebo None, pokud URL nenasvědčuje jasné vertikále.
    """
    host, path = _host_path(url or "")
    pl = (path or "").lower()
    u = (url or "").lower()
    h = (host or "").lower()

    if "pocasi" in h or "/pocasi" in pl or "/pocasi-" in pl or pl.startswith("/pocasi"):
        return "pocasi"

    # Doprava: bez holého „/auto“ v cestě (falešné trefy na obecné zprávy, např. D11).
    if "doprava" in h or "/doprava" in pl or "/nehody" in pl or "/nehoda" in pl:
        return "doprava"

    if "/cestovani" in pl or "/cestovan" in pl or "cestovani" in h:
        return "cestovani"

    if h.startswith("sport.") or "/sport" in pl or "/fotbal" in pl or "/hokej" in pl or "/tenis" in pl:
        return "sport"
    if "mmamag.cz" in h or "fights.cz" in h or h.startswith("isport."):
        return "sport"

    if "/ekonomika" in pl or "/finance" in pl or "/byznys" in pl or "/byznys/" in pl or "/reality" in pl:
        return "finance"
    if h.startswith("byznys.") or h.startswith("ekonomika.") or h.startswith("finance."):
        return "finance"

    if "/krimi" in pl or "/crime" in pl:
        return "krimi"

    if "/zdravi" in pl or "/zdrav" in pl or "zdravi" in h:
        return "zdravi"

    if "/veda/" in pl or pl.rstrip("/").endswith("/veda"):
        return "veda"

    if "/kultura/" in pl or pl.rstrip("/").endswith("/kultura"):
        return "kultura"

    if "/skola/" in pl or pl.rstrip("/").endswith("/skola"):
        return "vzdelavani"

    if "/hry/" in pl or pl.rstrip("/").endswith("/hry"):
        return "hry"

    if "travel" in pl or "letenk" in pl or "pelipeck" in h:
        return "cestovani"

    return None


def enforce_news_source_section_truth(url: str, title: str, fallback_topic: str) -> str:
    """
    Pro feedy zařazené jako obecné zpravodajství (registry topic aktualne):
    výchozí sekce = aktualne; přepsání jen při silném explicitním signálu v URL/hostu.
    Ostatní fallback topic = beze změny (finance, zdravi, vynucené vertikály, …).
    """
    fb0 = stable_section((fallback_topic or "aktualne").strip().lower())
    if fb0 != "aktualne":
        return infer_section(url, title, fallback_topic)
    strong = _infer_section_strong_explicit_url_signals(url)
    if strong is not None:
        return strong
    return _adjust_fallback_topic_for_path(url, "aktualne")


def stable_section(section: str) -> str:
    s = (section or "aktualne").strip().lower()
    if s not in VALID_SECTIONS:
        return "aktualne"
    return s


def _purity_haystack(title: str, url: str) -> str:
    return ((url or "") + " " + (title or "")).lower()


def _purity_has_any(hay: str, needles: tuple[str, ...]) -> bool:
    return any(n in hay for n in needles)


def _vzdelavani_edu_positive(title: str, url: str = "") -> bool:
    """Pozitivní signál školy / vzdělávání — rubrika /vzdelavani/ sama o sobě nestačí."""
    from iu_vzdelavani_relevance import vzdelavani_edu_positive

    return vzdelavani_edu_positive(title, url)


def vertical_purity_final_section(
    candidate_section: str,
    title: str,
    url: str,
    dt: datetime,
    now: datetime | None = None,
    trust_forced_feed: bool = False,
) -> str | None:
    """
    MODEL_2: vertikální kandidát (forced nebo infer) projde deterministickým guardem.
    Vrací finální sekci, nebo None = položku neappendovat (extrémní archiv ve vertikále).
    trust_forced_feed: položka z dedikovaného vertikálního RSS (registry topic) — nepadat do aktualne kvůli rubrikové syndikaci.
    """
    sec = stable_section(candidate_section)
    if sec not in VERTICAL_PURITY_SECTIONS:
        return sec

    now = now or datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    age_sec = (now - dt).total_seconds()
    if age_sec > EXTREME_ARCHIVE_DAYS_VERTICAL * 86400:
        return None

    if trust_forced_feed and sec in FORCED_FEED_TOPICS and sec != "vzdelavani":
        return sec

    hay = _purity_haystack(title, url)

    stale_limit_h = (
        VERTICAL_STALE_MAX_AGE_HOURS_CESTOVANI
        if sec == "cestovani"
        else VERTICAL_STALE_MAX_AGE_HOURS
    )
    # vzdelavani: u jasných edu signálů neřežeme jen stářím (jinak sekce spadne na 0 při zdravém obsahu).
    skip_stale_for_edu = sec == "vzdelavani" and _vzdelavani_edu_positive(title, url)
    if not skip_stale_for_edu and age_sec > stale_limit_h * 3600:
        return "aktualne"

    if sec == "vzdelavani":
        from iu_vzdelavani_relevance import vzdelavani_content_relevant

        if not vzdelavani_content_relevant(title, url):
            return "aktualne"
        return sec

    if sec == "cestovani":
        trav_ok = _purity_has_any(
            hay,
            (
                "/cestovani",
                "letenk",
                "dovol",
                "hotel",
                "ubytov",
                "destinac",
                "cestov",
                "letišt",
                "letist",
                "aerolink",
                "etihad",
                "asie",
                "vietnam",
                "thajsk",
                "dubai",
            ),
        )
        bad = _purity_has_any(
            hay,
            (
                "vražd",
                "vrazd",
                "soud",
                "obžal",
                "obzal",
                "polic",
                "nehoda",
                "požár",
                "pozar",
                "vláda",
                "vlada",
                "volb",
                "premiér",
                "premier",
            ),
        )
        if bad and not trav_ok:
            return "aktualne"
        return sec

    if sec == "veda":
        sci_ok = _purity_has_any(
            hay,
            (
                "/veda",
                "výzkum",
                "vyzkum",
                "vědc",
                "vedc",
                "studie",
                "vesmír",
                "vesmir",
                "archeolog",
                "objev",
                "historie",
                "histor",
                "planeta",
                "galax",
                "fosil",
                "přírod",
                "prirod",
            ),
        )
        sport_bad = _purity_has_any(
            hay,
            (
                "mma",
                "ufc",
                "zápas",
                "zapas",
                "liga",
                "trenér",
                "trener",
                "gól",
                "gol",
                "extraliga",
                "fotbal",
                "hokej",
            ),
        )
        if sport_bad and not sci_ok:
            return "aktualne"
        return sec

    if sec == "kultura":
        cul_ok = _purity_has_any(
            hay,
            (
                "/kultura",
                "film",
                "seriál",
                "serial",
                "hudb",
                "divadl",
                "kniha",
                "festival",
                "výstav",
                "vystav",
                "koncert",
                "literatura",
            ),
        )
        bad = _purity_has_any(
            hay,
            (
                "policie",
                "vražd",
                "vrazd",
                "soud",
                "extraliga",
                "fotbal",
                "hokej",
                "mma",
            ),
        )
        if bad and not cul_ok:
            return "aktualne"
        return sec

    if sec == "hry":
        game_ok = _purity_has_any(
            hay,
            (
                "/hry",
                "gaming",
                "gamer",
                "playstation",
                "xbox",
                "nintendo",
                "steam",
                "konzole",
                "videohra",
                "videohry",
                "call of duty",
            ),
        )
        bad = _purity_has_any(
            hay,
            (
                "mma",
                "ufc",
                "extraliga",
                "fotbal",
                "hokej",
                "policie",
                "vražd",
                "vrazd",
                "premiér",
                "premier",
            ),
        )
        if bad and not game_ok:
            return "aktualne"
        return sec

    return sec


def _apply_output_vertical_purity(article: dict) -> dict | None:
    """
    Po merge: stejný MODEL_2 guard na finální záznam.
    Nutné, aby staré sekce u URL přežívajících z předchozího articles.json
    neobcházely ingest guard (merge preferuje nové položky jen když URL přijde v tomto běhu).
    """
    if not isinstance(article, dict):
        return article
    sec = str(article.get("topic") or article.get("section") or "aktualne")
    title = str(article.get("title") or "")
    url = str(article.get("url") or "").strip()
    if not url:
        src0 = (article.get("sources") or [{}])[0]
        if isinstance(src0, dict):
            url = str(src0.get("url") or "").strip()
    try:
        dt = datetime.fromisoformat(str(article.get("publishedAt") or "").replace("Z", "+00:00"))
    except Exception:
        dt = datetime.now(timezone.utc)
    fin = vertical_purity_final_section(
        sec,
        title,
        url,
        dt,
        trust_forced_feed=bool(str(article.get("feedId") or "").strip() and stable_section(sec) in FORCED_FEED_TOPICS),
    )
    if fin is None:
        return None
    fin = stable_section(fin)
    if fin == stable_section(sec):
        return article
    o = dict(article)
    o["topic"] = o["section"] = fin
    return o


# --- Second layer: targeted post-merge section cleanup (MODEL_3) ---
# Runs after first-layer vertical purity. Does not change merge_article_lists contract.
# Uses vertical_purity_final_section(...) as gate for vertical targets so we never override
# intentional first-layer downgrades (tanker-like cases must not be re-promoted via loose URL rules).


def _second_layer_is_nato_babis_aktualne_title(title: str) -> bool:
    """Known prod case: NATO summit + Babiš must stay in aktualne; do not reclassify."""
    t = (title or "").lower()
    if "nato" not in t:
        return False
    if "babiš" not in t and "babis" not in t:
        return False
    return True


def _second_layer_blocks_tanker_style_cestovani_promotion(title: str, url: str) -> bool:
    """
    Intentional first-layer story: tanker + aviation fuel — must NOT be forced into cestovani
    from aktualne/finance by path-like rules (URL may lack /cestovani/).
    """
    hay = _purity_haystack(title, url)
    if "tanker" in hay and ("palivem" in hay or "paliva" in hay or "leteck" in hay or "leteckým" in hay):
        return True
    if "do evropy" in hay and "připluje" in hay and "tanker" in hay:
        return True
    if "do evropy" in hay and "pripluje" in hay and "tanker" in hay:
        return True
    return False


def _second_layer_path_has_cestovani_segment(path: str) -> bool:
    pl = (path or "").lower()
    return "/cestovani/" in pl or pl.rstrip("/").endswith("/cestovani") or "/cestovan" in pl


def _second_layer_sport_url_high_confidence(url: str) -> bool:
    host, path = _host_path(url or "")
    u = (url or "").lower()
    h = (host or "").lower()
    if h.startswith("sport.") or h.startswith("isport."):
        return True
    if "mmamag.cz" in h or "fights.cz" in h:
        return True
    if "isport.blesk.cz" in u:
        return True
    for seg in ("/sport/", "/hokej/", "/fotbal/", "/tenis/", "/mma/", "/golf/"):
        if seg in path.lower():
            return True
    return False


def _second_layer_gaming_url_high_confidence(url: str, title: str) -> bool:
    """Narrow: path /hry/ or known gaming outlet + title hints (no broad keyword net)."""
    host, path = _host_path(url or "")
    pl = path.lower()
    if "/hry/" in pl or pl.rstrip("/").endswith("/hry"):
        return True
    if "indian-tv.cz" in (host or "").lower():
        tl = (title or "").lower()
        if any(
            k in tl
            for k in (
                "xbox",
                "playstation",
                "nintendo",
                "steam",
                "videohra",
                "videohry",
                "gaming",
                "microsoft",
                "konzol",
            )
        ):
            return True
    return False


def _second_layer_path_veda_high_confidence(path: str) -> bool:
    pl = (path or "").lower()
    return "/veda/" in pl or pl.rstrip("/").endswith("/veda")


def _apply_second_layer_targeted_section_cleanup(article: dict) -> dict:
    """
    MODEL_3: high-confidence fixes for prev-only / history leaks only.
    Order: cestovani path → sport URL → hry URL → /veda path. First match wins.
    """
    if not isinstance(article, dict):
        return article
    title = str(article.get("title") or "")
    url = str(article.get("url") or "").strip()
    if not url:
        src0 = (article.get("sources") or [{}])[0]
        if isinstance(src0, dict):
            url = str(src0.get("url") or "").strip()
    if not url:
        return article

    if _second_layer_is_nato_babis_aktualne_title(title):
        return article

    cur = stable_section(str(article.get("topic") or article.get("section") or "aktualne"))
    try:
        dt = datetime.fromisoformat(str(article.get("publishedAt") or "").replace("Z", "+00:00"))
    except Exception:
        dt = datetime.now(timezone.utc)

    host, path = _host_path(url)

    wrong_for_cestovani = cur in frozenset({"aktualne", "finance", "doprava", "krimi"})
    if wrong_for_cestovani and _second_layer_path_has_cestovani_segment(path):
        if not _second_layer_blocks_tanker_style_cestovani_promotion(title, url):
            fin = vertical_purity_final_section("cestovani", title, url, dt)
            if fin == "cestovani":
                o = dict(article)
                o["topic"] = o["section"] = "cestovani"
                return o

    wrong_for_sport = cur in frozenset({"aktualne", "doprava", "krimi"})
    if wrong_for_sport and _second_layer_sport_url_high_confidence(url):
        o = dict(article)
        o["topic"] = o["section"] = "sport"
        return o

    wrong_for_hry = cur in frozenset({"aktualne", "sport", "doprava", "krimi"})
    if wrong_for_hry and _second_layer_gaming_url_high_confidence(url, title):
        fin = vertical_purity_final_section("hry", title, url, dt)
        if fin == "hry":
            o = dict(article)
            o["topic"] = o["section"] = "hry"
            return o

    wrong_for_veda = cur in frozenset({"aktualne", "doprava", "krimi", "sport"})
    if wrong_for_veda and _second_layer_path_veda_high_confidence(path):
        fin = vertical_purity_final_section("veda", title, url, dt)
        if fin == "veda":
            o = dict(article)
            o["topic"] = o["section"] = "veda"
            return o

    return article


_STOPWORDS_CLUSTER_FOLD = None


def _fold_cs_for_cluster(s: str) -> str:
    if not s:
        return ""
    nfd = unicodedata.normalize("NFD", s)
    ascii_like = "".join(c for c in nfd if unicodedata.category(c) != "Mn")
    return ascii_like.lower()


def _stopwords_cluster_fold():
    global _STOPWORDS_CLUSTER_FOLD
    if _STOPWORDS_CLUSTER_FOLD is None:
        _STOPWORDS_CLUSTER_FOLD = frozenset(_fold_cs_for_cluster(w) for w in STOPWORDS_CS)
    return _STOPWORDS_CLUSTER_FOLD


def _tokenize_story_cluster_title(title: str) -> set:
    """Folded tokens for conservative same-story match (independent of ingest cluster tokens)."""
    t = clean_title_basic(title or "")
    t = _fold_cs_for_cluster(t)
    t = re.sub(r"[^0-9a-z]+", " ", t, flags=re.IGNORECASE)
    parts = [p.strip() for p in t.split() if p.strip()]
    sw = _stopwords_cluster_fold()
    out = set()
    for p in parts:
        if len(p) <= 2:
            continue
        if p in sw:
            continue
        out.add(p)
    return out


def _story_pair_high_confidence_topic(t1: str, t2: str) -> bool:
    a = _tokenize_story_cluster_title(t1)
    b = _tokenize_story_cluster_title(t2)
    if not a or not b:
        return False
    sim = jaccard(a, b)
    if sim >= STORY_CLUSTER_JACCARD_STRONG:
        return True
    inter = len(a & b)
    if sim >= STORY_CLUSTER_JACCARD_WEAK and inter >= STORY_CLUSTER_MIN_SHARED_TOKENS_WEAK:
        return True
    return False


def _article_url_canonical(a: dict) -> str:
    u = str(a.get("url") or "").strip()
    if not u:
        src0 = (a.get("sources") or [{}])[0]
        if isinstance(src0, dict):
            u = str(src0.get("url") or "").strip()
    return u


def _pick_story_cluster_winner(group: list) -> dict:
    """Deterministic: displayScore, publishedAt, source weight, title length, URL."""
    if len(group) == 1:
        return group[0]

    def sort_key(ad: dict):
        ds = float(compute_display_score(ad))
        pa = str(ad.get("publishedAt") or "")
        sw = float(ad.get("sourceDisplayWeight") or 1.0)
        title = str(ad.get("title") or "").strip()
        tq = min(200, max(0, len(title)))
        u = _article_url_canonical(ad)
        return (ds, pa, sw, tq, u)

    return max(group, key=sort_key)


_TOPIC_DEDUPE_LAST_STATS: dict = {}
_TOPIC_DIVERSITY_LAST_STATS: dict = {}


def _apply_conservative_topic_clustering(articles: list) -> list:
    """
    Topic/event dedupe V1: same section, different URLs, conservative title match + time window.
    Suppressed duplicates recorded in topic_dedupe_suppressed.json (not in public feed).
    """
    global _TOPIC_DEDUPE_LAST_STATS
    if not articles:
        _TOPIC_DEDUPE_LAST_STATS = {"suppressed_count": 0, "clusters_merged": 0}
        return articles

    def _score(ad: dict) -> tuple:
        ds = float(compute_display_score(ad))
        pa = str(ad.get("publishedAt") or "")
        sw = float(ad.get("sourceDisplayWeight") or 1.0)
        title = str(ad.get("title") or "").strip()
        tq = min(200, max(0, len(title)))
        u = _article_url_canonical(ad)
        return (ds, pa, sw, tq, u)

    visible, suppressed, stats = apply_topic_event_dedupe(
        articles,
        stable_section_fn=stable_section,
        story_match_fn=_story_pair_high_confidence_topic,
        tokenize_fn=_tokenize_story_cluster_title,
        score_fn=_score,
        url_fn=_article_url_canonical,
    )
    _TOPIC_DEDUPE_LAST_STATS = dict(stats)
    try:
        os.makedirs(os.path.dirname(TOPIC_DEDUPE_SUPPRESSED_PATH), exist_ok=True)
        _atomic_write_json(
            TOPIC_DEDUPE_SUPPRESSED_PATH,
            {
                "generatedAt": iso_now_z(),
                "stats": stats,
                "suppressed": suppressed[-500:],
            },
        )
    except Exception as e:
        print("WARN: topic_dedupe_suppressed write failed:", str(e), flush=True)
    return visible


def _parse_day_yyyy_mm_dd(day: str):
    try:
        s = str(day or "").strip()
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", s):
            return None
        return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except Exception:
        return None


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

def youtube_thumb_from_id(vid: str) -> str:
    v = (vid or "").strip()
    if not v:
        return ""
    return f"https://i.ytimg.com/vi/{v}/hqdefault.jpg"


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

    if "category" not in meta:
        meta["category"] = str(meta.get("topic") or "aktualne")
    if "type" not in meta:
        meta["type"] = "general"
    if "id" not in meta:
        meta["id"] = ""
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
            if not meta.get("enabled", True):
                continue
            feed_items.append((url, meta))

    elif isinstance(data, list):
        for item in data:
            if isinstance(item, str):
                url = item.strip()
                if not url:
                    continue
                meta = _meta_from_any(url, {})
                if not meta.get("enabled", True):
                    continue
                feed_items.append((url, meta))
            elif isinstance(item, dict):
                url = (item.get("url") or item.get("feed") or item.get("rss") or "").strip()
                if not url:
                    continue
                meta = _meta_from_any(url, item)
                if not meta.get("enabled", True):
                    continue
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

def _youtube_feed_url_from_channel_id(cid: str) -> str:
    cid = (cid or "").strip()
    if not cid:
        return ""
    return f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}"


def _extract_uc_channel_id_from_youtube_html(html: str) -> str:
    try:
        if not html:
            return ""
        # Common patterns in modern YouTube HTML payloads
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


def resolve_youtube_source_to_feed_url(source_url: str) -> str:
    """
    Resolver allowlist zdrojů → YouTube Atom feed:
    - videos.xml?channel_id=UC... nebo videos.xml?playlist_id=...
    - /channel/UC...
    - /@handle (fetch HTML a najdi UC id)
    """
    try:
        raw = (source_url or "").strip()
        if not raw:
            return ""
        # already a feed url
        if "youtube.com/feeds/videos.xml" in raw:
            return raw

        # normalize
        try:
            u = urlparse(raw)
        except Exception:
            u = urlparse("https://www.youtube.com/")
        host = (u.netloc or "").lower()
        path = (u.path or "").strip()

        if "youtube.com" not in host and "youtu.be" not in host:
            return ""

        # /channel/UC...
        m = re.search(r"/channel/(UC[0-9A-Za-z_-]{22})", path)
        if m:
            return _youtube_feed_url_from_channel_id(m.group(1))

        # /@handle
        m = re.search(r"/@([0-9A-Za-z_.-]+)", path)
        if m:
            handle = m.group(1)
            url = f"https://www.youtube.com/@{handle}"
            try:
                r = requests.get(url, headers={"User-Agent": USER_AGENT, "From": BOT_FROM_HEADER}, timeout=REQUEST_TIMEOUT_SEC)
                if r.status_code != 200:
                    print(f"WARN: allowlist resolver handle failed status={r.status_code} url={url}")
                    return ""
                cid = _extract_uc_channel_id_from_youtube_html(r.text or "")
                if not cid:
                    print(f"WARN: allowlist resolver handle missing channelId url={url}")
                    return ""
                return _youtube_feed_url_from_channel_id(cid)
            except Exception as e:
                print(f"WARN: allowlist resolver handle exception url={url} err={e}")
                return ""

        return ""
    except Exception:
        return ""


def load_videos_allowlist(path: str) -> dict:
    try:
        if not path or not os.path.exists(path):
            return {}
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def load_allowlist_youtube_feeds(path: str) -> tuple[list, dict]:
    """
    Allowlist JSON → list feedů pro loop ve fetch/pipeline.
    Vrací: (feeds, cfg_meta)
    """
    cfg = load_videos_allowlist(path)
    version = int(cfg.get("version") or 1) if isinstance(cfg.get("version"), (int, float, str)) else 1
    fresh_primary = int(cfg.get("freshDaysPrimary") or 14)
    fresh_fallback = int(cfg.get("freshDaysFallback") or 60)
    fresh_target = float(cfg.get("freshTargetShare") or 0.7)
    dedupe_days = int(cfg.get("dedupeDays") or 30)
    max_per_source = int(cfg.get("maxPerSource") or 25)
    max_total = int(cfg.get("maxTotal") or 240)
    if fresh_primary < 1: fresh_primary = 14
    if fresh_fallback < fresh_primary: fresh_fallback = max(60, fresh_primary)
    if fresh_target <= 0 or fresh_target > 1: fresh_target = 0.7
    if dedupe_days < 1: dedupe_days = 30
    if max_per_source < 1: max_per_source = 25
    if max_total < 1: max_total = 240

    cats_in = cfg.get("categories")
    cats_in = cats_in if isinstance(cats_in, list) else []
    feeds = []
    categories_out = []
    for cat in cats_in:
        if not isinstance(cat, dict):
            continue
        name = str(cat.get("name") or "").strip()
        if not name:
            continue
        try:
            weight = int(cat.get("weight") or 1)
        except Exception:
            weight = 1
        sources = cat.get("sources")
        sources = sources if isinstance(sources, list) else []
        categories_out.append({"name": name, "weight": weight, "sources": sources})
        for src in sources:
            s = str(src or "").strip()
            if not s:
                continue
            feed_url = resolve_youtube_source_to_feed_url(s)
            if not feed_url:
                print(f"WARN: allowlist resolver unsupported source: {s}")
                continue
            # meta for YouTube feed items (handled in the main loop)
            meta = {
                "topic": "aktualne",
                "source": "YouTube – allowlist",
                "type": "youtube",
                "channel": s,               # fallback label (handle/url)
                "sourceKey": feed_url,      # for maxPerSource (stable per feed)
                "category": name,
                "categoryWeight": weight,
                "allowlistVersion": version,
            }
            feeds.append((feed_url, meta))

    cfg_meta = {
        "version": version,
        "freshDaysPrimary": fresh_primary,
        "freshDaysFallback": fresh_fallback,
        "freshTargetShare": fresh_target,
        "dedupeDays": dedupe_days,
        "maxPerSource": max_per_source,
        "maxTotal": max_total,
        "categories": categories_out,
    }
    return feeds, cfg_meta


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

        if iu_is_blocked_pocasicko_source(channel, str(item.get("name") or "")):
            continue

        # source do FEED REPORTu
        source = f"YouTube – {channel}".strip()

        qd = dict(parse_qsl(urlparse(url).query, keep_blank_values=True))
        pl = (qd.get("playlist_id") or "").strip()
        yt_canonical = f"yt_playlist_{pl}" if pl else "yt_" + hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]

        meta = {
            "topic": topic,
            "source": source,
            "type": "youtube",
            "channel": channel,   # ✅ čistý název kanálu pro videos.json
            "id": yt_canonical,
            "registryGroup": [{"id": yt_canonical, "label": channel, "feed_url": url}],
        }
        out.append((url, meta))

    return out


def load_all_feeds() -> list:
    feeds = []
    if os.path.exists(FEEDS_PATH):
        feeds.extend(load_feeds(FEEDS_PATH))

    # YouTube videa se generují samostatně v scripts/build_videos.py.
    # (Zde necháváme pouze RSS články; jinak by build_articles tahal desítky YT feedů.)
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
    headers = crawler_request_headers()

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


def looks_like_xml_or_feed(text: str) -> bool:
    """
    True when the body is RSS/Atom/XML even if Content-Type wrongly says text/html.
    (Časté u CDN / starších serverů — bez toho končíme na not_xml_or_html při validním feedu.)
    """
    if not text:
        return False
    s = text.lstrip("\ufeff\u200b\u200c\u200d").strip()
    if not s:
        return False
    low = s[:240].lower()
    if low.startswith("<?xml"):
        return True
    if low.startswith("<rss"):
        return True
    if low.startswith("<feed"):
        return True
    if low.startswith("<rdf:") or low.startswith("<rdf:rdf"):
        return True
    return False


def is_html_content(text: str, content_type: str) -> bool:
    """
    Detekce HTML místo XML/RSS.
    """
    if not text:
        return False

    if looks_like_xml_or_feed(text):
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


def fetch_feed(url: str, transport: dict = None, last_req_ts: list = None) -> tuple:
    """
    Vrací (feed_dict, diagnostics_dict).
    S transport + last_req_ts: If-Modified-Since / ETag, globální odstup 2 s, snapshoty.
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
        if transport is None or last_req_ts is None:
            status_code, final_url, content_type, text = robust_fetch(url)
            diagnostics["httpStatus"] = status_code
            diagnostics["contentType"] = content_type
            diagnostics["finalUrl"] = final_url
            diagnostics["bytes"] = len((text or "").encode("utf-8", errors="ignore"))

            if status_code == 0:
                diagnostics["reason"] = "fetch_failed"
                return (None, diagnostics)

            if status_code != 200:
                diagnostics["reason"] = f"http_{status_code}"
                return (None, diagnostics)

            if not text:
                diagnostics["reason"] = "empty_content"
                return (None, diagnostics)

            if is_html_content(text, content_type):
                diagnostics["reason"] = "not_xml_or_html"
                return (None, diagnostics)

            feed_dict = feedparser.parse(text)
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

        text, tdiag, _, _ = http_fetch_rss_body(url, transport, last_req_ts)
        diagnostics.update(tdiag)
        if not text:
            if not diagnostics.get("reason"):
                diagnostics["reason"] = "empty_content"
            return (None, diagnostics)

        content_type = diagnostics.get("contentType") or ""
        if is_html_content(text, content_type):
            diagnostics["reason"] = "not_xml_or_html"
            return (None, diagnostics)

        feed_dict = feedparser.parse(text)
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
            self.token_union |= _token_set(item.get("tokens"))

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

        # ARTICLE: unikátní zdroje v clusteru — každá položka musí nést vlastní media_raw
        # (stejná doména po normalize_media_name nesmí sdílet jeden společný label).
        seen = set()
        out = []
        for it in sorted(self.items, key=lambda x: x["dt"], reverse=True):
            key = (it["media_norm"], it["url"])
            if key in seen:
                continue
            seen.add(key)
            out.append({
                "name": it["media_raw"],
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
        "cestovani": "Cestování",
        "finance": "Finance",
        "sport": "Sport",
        "hry": "Hry",
        "kultura": "Kultura / Akce",
        "veda": "Věda & Historie",
        "vzdelavani": "Vzdělávání",
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


def _pipeline_phase() -> str:
    """
    Production CI (update-articles.yml): three separate jobs; durable handoff is the git tree
    pipeline-handoff/ on branch automation/pipeline-handoff (manifest + blobs per commit), not
    ephemeral Actions artifacts. Jobs may run on different runners; phases: ingest | aggregate | publish.
    Default 'all' runs ingest→aggregate→publish in one process (local convenience only).
    """
    p = (os.getenv("IU_ARTICLE_PIPELINE_PHASE") or "all").strip().lower()
    if p in ("ingest", "aggregate", "publish", "all"):
        return p
    return "all"


def _aggregate_pipeline(
    all_items: list,
    per_feed_report: list,
    yt_videos: list,
    registry: dict,
) -> dict:
    """
    Staging / in-memory raw items → merged + limited article lists (no RSS fetch).
    """
    deduped_items = _dedupe_ingest_items_by_url_priority(all_items)

    clusters = cluster_items(deduped_items)

    new_articles = []

    sec_rank = {s: i for i, s in enumerate(SECTION_ORDER)}
    clusters.sort(key=lambda c: (c.published_at(), -sec_rank.get(c.section, 999)), reverse=True)

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

        pcat = _primary_category_from_cluster_items(c.items)
        ftype = _feed_type_from_cluster_items(c.items)
        thash = topic_hash_from_title(title_out)

        primary_item = sorted(c.items, key=lambda x: x["dt"], reverse=True)[0]
        src0 = (sources or [{}])[0]
        candidate = (src0.get("url", "") or "").strip()
        article_url = candidate if candidate.lower().startswith(("http://", "https://")) else ""
        _sl = media_source_display(str(primary_item.get("media_raw") or ""), article_url)
        sources_out = [
            {"name": media_source_display(str(s.get("name") or ""), str(s.get("url") or article_url)), "url": s.get("url")}
            for s in sources
        ]
        article_out = {
            "topic": c.section,
            "section": c.section,
            "contentType": c.content_type,
            "title": fix_cz_mojibake(title_out),
            "publishedAt": published,
            "sources": sources_out,
            "primaryCategory": pcat,
            "topicHash": thash,
            "feedType": ftype,
            "sourceDisplayWeight": float(primary_item.get("sourceDisplayWeight") or 1.0),
            "sectionPrimary": str(primary_item.get("feedCategory") or ""),
            "sourceLabel": _sl,
        }
        _fid = str(primary_item.get("feedId") or "").strip()
        if _fid:
            article_out["feedId"] = _fid
        article_out["url"] = article_url

        new_articles.append(article_out)

    generated_at = iso_now_z()

    prev_payload = _safe_read_json(OUT_PATH) or {}
    prev_list = list(prev_payload.get("articles") or [])
    merged_articles = merge_article_lists(prev_list, new_articles, MAX_MERGED_ARTICLES_POOL)
    merged_articles = purge_blocked_articles(merged_articles)
    merged_articles = [remap_article_section_if_url_mismatch(a) for a in merged_articles]
    merged_articles = [_apply_output_vertical_purity(a) for a in merged_articles]
    merged_articles = [a for a in merged_articles if a is not None]
    merged_articles = [_apply_second_layer_targeted_section_cleanup(a) for a in merged_articles]
    merged_articles = _apply_conservative_topic_clustering(merged_articles)
    for a in merged_articles:
        a["duplicatePenalty"] = float(a.get("duplicatePenalty") or 1.0)
        a["displayScore"] = compute_display_score(a)

    merged_articles.sort(key=lambda a: str(a.get("publishedAt") or ""), reverse=True)
    merged_articles = apply_staggered_section_release(merged_articles, generated_at)
    merged_articles = sorted(merged_articles, key=lambda a: str(a.get("publishedAt") or ""), reverse=True)
    merged_articles = _apply_source_display_to_articles(merged_articles)

    out_articles = apply_per_section_limits_then_cap(merged_articles)
    out_articles = apply_per_section_published_retention(prev_list, out_articles)
    # Retention can re-introduce older same-event URLs from prev public bundle.
    out_articles = _apply_conservative_topic_clustering(out_articles)
    for a in out_articles:
        a["duplicatePenalty"] = float(a.get("duplicatePenalty") or 1.0)
        a["displayScore"] = compute_display_score(a)
    out_articles = _apply_source_display_to_articles(out_articles)
    final = out_articles

    tel_detail, tel_summary = build_telemetry_payload(
        per_feed_report=per_feed_report,
        deduped_items=deduped_items,
        clusters=clusters,
        new_articles=new_articles,
        final_articles=final,
        registry=registry,
        generated_at=generated_at,
    )
    topic_stats = dict(_TOPIC_DEDUPE_LAST_STATS or {})
    if topic_stats:
        tel_summary = dict(tel_summary) if isinstance(tel_summary, dict) else {}
        tel_summary["topic_dedupe"] = topic_stats

    return {
        "generated_at": generated_at,
        "articles_full": out_articles,
        "articles_final": final,
        "per_feed_report": per_feed_report,
        "youtube_pool": yt_videos,
        "registry": registry,
        "ingest_telemetry": tel_detail,
        "ingest_telemetry_summary": tel_summary,
        "topic_dedupe": topic_stats,
    }


def _publish_article_outputs(bundle: dict) -> int:
    """Write public JSON (articles.json, shards, health, meta, brief, videos) from an aggregate bundle."""
    generated_at = bundle["generated_at"]
    out_articles = enrich_article_list(bundle["articles_full"])
    final = enrich_article_list(bundle["articles_final"])
    per_feed_report = bundle["per_feed_report"]
    yt_videos = bundle["youtube_pool"]
    registry = bundle.get("registry") or {}

    # ===== RETENTION (ARTICLES) =====
    try:
        os.makedirs(ARTICLES_SHARD_DIR, exist_ok=True)

        existing_index = _safe_read_json(ARTICLES_INDEX_PATH) or {}
        prev_days = existing_index.get("days") if isinstance(existing_index, dict) else None
        prev_days = prev_days if isinstance(prev_days, list) else []

        prev_counts = {}
        prev_order = []
        for d in prev_days:
            if not isinstance(d, dict):
                continue
            date = str(d.get("date") or "").strip()
            if not date:
                continue
            prev_order.append(date)
            try:
                prev_counts[date] = int(d.get("count") or 0)
            except Exception:
                prev_counts[date] = 0

        days_in_new = set()
        by_day_new = {}
        for it in out_articles:
            pub = str(it.get("publishedAt") or "").strip()
            if len(pub) < 10:
                continue
            day = pub[:10]
            days_in_new.add(day)
            by_day_new.setdefault(day, []).append(it)

        new_counts = dict(prev_counts)
        all_days = set(prev_order)

        for day in sorted(days_in_new):
            all_days.add(day)
            day_path = os.path.join(ARTICLES_SHARD_DIR, f"{day}.json")
            day_payload = _safe_read_json(day_path) or {}

            existing_items = []
            if isinstance(day_payload, dict):
                if isinstance(day_payload.get("items"), list):
                    existing_items = day_payload.get("items")
                elif isinstance(day_payload.get("articles"), list):
                    existing_items = day_payload.get("articles")
            elif isinstance(day_payload, list):
                existing_items = day_payload

            merged = []
            seen = set()
            for src in (by_day_new.get(day) or []) + (existing_items or []):
                if not isinstance(src, dict):
                    continue
                u0 = (src.get("url") or "").strip()
                if is_hard_blocked_url(u0):
                    continue
                k = _retention_key(src)
                if k in seen:
                    continue
                seen.add(k)
                merged.append(src)

            merged.sort(key=lambda a: str(a.get("publishedAt") or ""), reverse=True)
            _atomic_write_json(day_path, {"date": day, "generatedAt": generated_at, "items": merged})
            new_counts[day] = len(merged)

        ordered_days = sorted(all_days, reverse=True)

        cutoff = (datetime.now(timezone.utc).date() - timedelta(days=RETENTION_DAYS - 1))
        keep_days = []
        for d in ordered_days:
            dt_day = _parse_day_yyyy_mm_dd(d)
            if not dt_day:
                continue
            if dt_day.date() >= cutoff:
                keep_days.append(d)

        keep_set = set(keep_days)

        try:
            for fn in os.listdir(ARTICLES_SHARD_DIR):
                if fn == "index.json":
                    continue
                if not re.match(r"^\d{4}-\d{2}-\d{2}\.json$", fn):
                    continue
                day = fn[:-5]
                if day in keep_set:
                    continue
                try:
                    os.remove(os.path.join(ARTICLES_SHARD_DIR, fn))
                except Exception:
                    pass
        except Exception:
            pass

        index_payload = {
            "generatedAt": generated_at,
            "days": [{"date": d, "count": int(new_counts.get(d, 0) or 0)} for d in keep_days],
        }
        _atomic_write_json(ARTICLES_INDEX_PATH, index_payload)
    except Exception as e:
        print("WARN: retention shards failed:", str(e))

    _fcov = classification_coverage_stats(final)
    _fc_req = int(_fcov.get("total") or 0) > 0 and int(_fcov.get("withClassification") or 0) == int(
        _fcov.get("total") or 0
    )
    payload = {
        "generatedAt": generated_at,
        "articles": final,
        "mappingSingleSourceOfTruth": True,
        "homepagePreviewUsesSectionMapper": True,
        "feedClassificationSchemaVersion": 1,
        "feedClassificationSource": "iu_feed_classification.py",
        "feedClassificationCoveragePct": _fcov.get("coveragePct"),
        "feedClassificationRequired": bool(_fc_req),
        "registryVersion": registry.get("version") if isinstance(registry, dict) else None,
        "sectionRetention": _section_retention_manifest(),
    }

    _atomic_write_json(OUT_PATH, payload)
    _emit_bootstrap_json(final, generated_at)

    health_payload = {
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
                "bozo_but_used": bool(r.get("bozo_but_used", False)),
            }
            for r in per_feed_report
        },
    }
    _atomic_write_json(HEALTH_PATH, health_payload)

    try:
        tele = bundle.get("ingest_telemetry")
        if isinstance(tele, dict) and tele.get("schemaVersion"):
            os.makedirs(os.path.dirname(INGEST_TELEMETRY_PATH), exist_ok=True)
            _atomic_write_json(INGEST_TELEMETRY_PATH, tele)
            tsum = bundle.get("ingest_telemetry_summary")
            if isinstance(tsum, dict):
                print_compact_audit(tsum)
    except Exception as e:
        print("WARN: ingest telemetry write failed:", str(e))

    meta_payload = build_meta(generated_at, final)
    _atomic_write_json(META_PATH, meta_payload)

    brief_payload = build_brief(generated_at, final)
    _atomic_write_json(BRIEF_PATH, brief_payload)

    yt_sorted = sorted(
        yt_videos,
        key=lambda v: (v.get("_dt") or datetime.now(timezone.utc), int(v.get("categoryWeight") or 0)),
        reverse=True,
    )

    allow_meta = {}
    allow_cfg = {}

    cfg_version = int(allow_meta.get("version") or (allow_cfg.get("version") if isinstance(allow_cfg, dict) else 1) or 1)
    primary_days = int(allow_meta.get("freshDaysPrimary") or 14)
    fallback_days = int(allow_meta.get("freshDaysFallback") or 60)
    target_share = float(allow_meta.get("freshTargetShare") or 0.7)
    max_per_source = int(allow_meta.get("maxPerSource") or 25)
    max_total = int(allow_meta.get("maxTotal") or 240)
    if primary_days < 1:
        primary_days = 14
    if fallback_days < primary_days:
        fallback_days = max(60, primary_days)
    if target_share <= 0 or target_share > 1:
        target_share = 0.7
    if max_per_source < 1:
        max_per_source = 25
    if max_total < 1:
        max_total = 240

    def _age_days(dt_any) -> int:
        try:
            if isinstance(dt_any, datetime):
                d = dt_any
            else:
                d = datetime.fromisoformat(str(dt_any).replace("Z", "+00:00"))
            return int((datetime.now(timezone.utc) - d).total_seconds() // 86400)
        except Exception:
            return 999999

    seen_vid = set()
    per_source = {}
    primary = []
    fallback = []
    older = []
    for v in yt_sorted:
        vid = (v.get("videoId") or "").strip()
        if not vid or vid in seen_vid:
            continue
        if iu_is_blocked_pocasicko_source(str(v.get("channel") or ""), str(v.get("title") or ""), str(v.get("sourceKey") or "")):
            continue
        src_key = str(v.get("sourceKey") or v.get("channel") or "YouTube")
        if per_source.get(src_key, 0) >= max_per_source:
            continue
        age = _age_days(v.get("_dt") or v.get("publishedAt") or "")
        row = {
            "title": v.get("title") or "",
            "url": v.get("url") or "",
            "videoId": vid,
            "publishedAt": v.get("publishedAt") or "",
            "channel": (v.get("channel") or "YouTube").strip() or "YouTube",
            "category": (v.get("category") or "").strip(),
            "thumb": v.get("thumb") or youtube_thumb_from_id(vid),
        }
        if age <= primary_days:
            primary.append(row)
        elif age <= fallback_days:
            fallback.append(row)
        else:
            older.append(row)

    target_primary = int((max_total * target_share) + 0.9999)
    out_vid = []
    used_sources = {}

    def _take_from(bucket: list, limit: int = None):
        nonlocal out_vid, seen_vid, used_sources
        for row in bucket:
            if limit is not None and len(out_vid) >= limit:
                break
            if len(out_vid) >= max_total:
                break
            vid = (row.get("videoId") or "").strip()
            if not vid or vid in seen_vid:
                continue
            src_key = str(row.get("channel") or "YouTube")
            if used_sources.get(src_key, 0) >= max_per_source:
                continue
            seen_vid.add(vid)
            used_sources[src_key] = used_sources.get(src_key, 0) + 1
            out_vid.append(row)

    _take_from(primary, limit=min(max_total, target_primary))
    _take_from(fallback)
    _take_from(older)

    primary_count = 0
    fallback_count = 0
    older_count = 0
    for row in out_vid:
        age = _age_days(row.get("publishedAt") or "")
        if age <= primary_days:
            primary_count += 1
        elif age <= fallback_days:
            fallback_count += 1
        else:
            older_count += 1

    videos_payload = {
        "generatedAt": generated_at,
        "allowlistVersion": cfg_version,
        "freshTargetShare": target_share,
        "dedupeDays": int(allow_meta.get("dedupeDays") or 30),
        "maxPerSource": max_per_source,
        "maxTotal": max_total,
        "freshness": {
            "primaryDays": primary_days,
            "fallbackDays": fallback_days,
            "primaryCount": primary_count,
            "fallbackCount": fallback_count,
            "olderCount": older_count,
            "total": len(out_vid),
        },
        "categories": allow_meta.get("categories") if isinstance(allow_meta.get("categories"), list) else [],
        "videos": out_vid,
    }

    _atomic_write_json(VIDEOS_OUT_PATH, videos_payload)
    print(f"VIDEOS_FRESHNESS primary14={primary_count} fallback60={fallback_count} older={older_count} total={len(out_vid)}")
    print("=== FEED REPORT ===")
    print(json.dumps(health_payload, ensure_ascii=False, indent=2))
    print(f"=== OUTPUT === wrote {len(final)} items to {OUT_PATH}")
    print(f"=== OUTPUT === wrote {len(out_vid)} videos to {VIDEOS_OUT_PATH}")

    try:
        run_id = str(os.getenv("GITHUB_RUN_ID") or "")
        write_latest_valid_snapshot(OUTPUT_DIR, OUT_PATH, run_id=run_id, status="PASS")
        sched_state = load_scheduler_state(SCHEDULER_STATE_PATH)
        reports = [
            build_scheduler_report(
                registry if isinstance(registry, dict) else {},
                sched_state,
                run_id=run_id,
                main_commit=str(os.getenv("GITHUB_SHA") or "")[:12],
                trigger_source=str(os.getenv("IU_TRIGGER_SOURCE") or "workflow_dispatch"),
            ),
            build_pipeline_report(
                {
                    "run_id": run_id,
                    "publish_completed": True,
                    "publish_status": "PASS",
                    "new_articles_count": len(final),
                    "final_status": "PASS",
                }
            ),
            build_topic_diversity_report(_TOPIC_DIVERSITY_LAST_STATS),
        ]
        emit_reports(OUTPUT_DIR, reports)
    except Exception as e:
        print("WARN: pipeline reports / snapshot failed:", str(e), flush=True)

    return 0


def _handoff_meta_from_staging_manifest(loaded: dict) -> dict:
    """Race-safe linkage: checkpoint ties to ingest snapshot (pipelineRunId) + this workflow run."""
    man = loaded.get("manifest") if isinstance(loaded.get("manifest"), dict) else {}
    pr = str(man.get("pipelineRunId") or os.environ.get("GITHUB_RUN_ID") or "").strip()
    ar = (os.environ.get("GITHUB_RUN_ID") or "").strip() or "local"
    return {
        "stagingSnapshotIngestRunId": pr,
        "aggregateWorkflowRunId": ar,
    }


def _checkpoint_bundle_for_disk(bundle: dict, handoff_meta: dict | None = None) -> dict:
    """JSON-safe aggregate bundle for aggregated_checkpoint.json (youtube _dt as ISO)."""
    yt = bundle.get("youtube_pool") or []
    rows = [serialize_youtube_row(r) for r in yt if isinstance(r, dict)]
    reg = bundle.get("registry")
    rv = reg.get("version") if isinstance(reg, dict) else None
    out = {
        "generated_at": bundle["generated_at"],
        "articles_full": bundle["articles_full"],
        "articles_final": bundle["articles_final"],
        "per_feed_report": bundle["per_feed_report"],
        "youtube_pool": rows,
        "registry_version": rv,
    }
    if bundle.get("ingest_telemetry"):
        out["ingest_telemetry"] = bundle["ingest_telemetry"]
    if bundle.get("ingest_telemetry_summary"):
        out["ingest_telemetry_summary"] = bundle["ingest_telemetry_summary"]
    if handoff_meta:
        out["handoffMeta"] = handoff_meta
    return out


def _bundle_from_checkpoint(cp: dict) -> dict | None:
    """Restore publish bundle from checkpoint + live registry file."""
    if not isinstance(cp, dict):
        return None
    try:
        reg = load_registry(REGISTRY_PATH)
    except Exception:
        reg = {}
    yt_rows = cp.get("youtube_pool") or []
    yt_restored = []
    if isinstance(yt_rows, list):
        for r in yt_rows:
            if isinstance(r, dict):
                yt_restored.append(deserialize_youtube_row(r))
    return {
        "generated_at": cp["generated_at"],
        "articles_full": cp["articles_full"],
        "articles_final": cp["articles_final"],
        "per_feed_report": cp["per_feed_report"],
        "youtube_pool": yt_restored,
        "registry": reg,
        "ingest_telemetry": cp.get("ingest_telemetry"),
        "ingest_telemetry_summary": cp.get("ingest_telemetry_summary"),
    }


def _feed_report_attach_registry(rep: dict, meta: dict) -> None:
    """Attach canonical registry identity for telemetry joins (must match article feedId)."""
    fid = str(meta.get("id") or "").strip()
    if fid:
        rep["registryId"] = fid
    rg = meta.get("registryGroup")
    if isinstance(rg, list) and rg:
        rep["registryGroup"] = rg


def _incremental_publish_with_backpressure(
    fresh_items: list,
    per_feed_report: list,
    yt_videos: list,
    registry: dict,
) -> tuple[int, dict]:
    """
    Bounded publish: drain queue + merge staging, cap items/time, defer remainder safely.
    """
    budget = PublishTimeBudget()
    loaded = load_staging_for_aggregate(OUTPUT_DIR)
    staged = list(loaded.get("all_items") or [])
    aggregate_items, bp_meta = split_publish_batch(OUTPUT_DIR, fresh_items, staged)
    bp_meta["queue_depth_after"] = queue_depth(OUTPUT_DIR)
    bp_meta["publish_elapsed_sec"] = 0.0

    print(
        "[iu-backpressure] "
        f"publish_now={bp_meta.get('published_now_count')} "
        f"enqueued={bp_meta.get('enqueued_this_tick')} "
        f"queue={bp_meta.get('queue_depth_after')} "
        f"drained={bp_meta.get('drained_from_queue')}",
        flush=True,
    )

    if budget.exceeded():
        bp_meta["skipped_reason"] = "time_budget_before_aggregate"
        return 0, bp_meta

    aggregate_reports = list(loaded.get("per_feed_report") or [])
    seen_rep = {str(r.get("feed") or "") for r in aggregate_reports if isinstance(r, dict)}
    for r in per_feed_report or []:
        if isinstance(r, dict):
            fk = str(r.get("feed") or "")
            if fk and fk not in seen_rep:
                aggregate_reports.append(r)
                seen_rep.add(fk)

    bundle = _aggregate_pipeline(
        aggregate_items, aggregate_reports, yt_videos, registry
    )
    bundle["backpressure"] = bp_meta
    hm = _handoff_meta_from_staging_manifest(loaded)
    write_aggregated_checkpoint(OUTPUT_DIR, _checkpoint_bundle_for_disk(bundle, hm))

    if budget.exceeded():
        bp_meta["skipped_reason"] = "time_budget_before_publish"
        return 0, bp_meta

    rc = _publish_article_outputs(bundle)
    bp_meta["publish_elapsed_sec"] = round(budget.elapsed_sec(), 2)
    return rc, bp_meta


# =========================
# Main
# =========================

def main() -> int:
    phase = _pipeline_phase()
    if not os.path.exists(REGISTRY_PATH):
        print(f"ERROR: missing {REGISTRY_PATH}", file=sys.stderr)
        return 2

    registry = load_registry(REGISTRY_PATH)

    if phase == "publish":
        print("[iu-pipeline] phase=publish reads aggregated_checkpoint only; no RSS fetch", flush=True)
        cp = read_aggregated_checkpoint(OUTPUT_DIR)
        if not isinstance(cp, dict) or not cp.get("generated_at"):
            print("ERROR: missing aggregated checkpoint (run aggregate first)", file=sys.stderr)
            return 2
        cp_clean = {k: v for k, v in cp.items() if k != "schemaVersion"}
        bundle = _bundle_from_checkpoint(cp_clean)
        if bundle is None:
            return 2
        return _publish_article_outputs(bundle)

    if phase == "aggregate":
        print("[iu-pipeline] phase=aggregate reads staging only; no RSS fetch", flush=True)
        loaded = load_staging_for_aggregate(OUTPUT_DIR)
        agg_items, bp_meta = split_publish_batch(
            OUTPUT_DIR, [], list(loaded.get("all_items") or [])
        )
        print(
            f"[iu-backpressure] aggregate batch size={len(agg_items)} "
            f"queue={bp_meta.get('queue_depth_after', queue_depth(OUTPUT_DIR))}",
            flush=True,
        )
        bundle = _aggregate_pipeline(
            agg_items,
            loaded["per_feed_report"],
            loaded["youtube_rows"],
            registry,
        )
        bundle["backpressure"] = bp_meta
        hm = _handoff_meta_from_staging_manifest(loaded)
        write_aggregated_checkpoint(OUTPUT_DIR, _checkpoint_bundle_for_disk(bundle, hm))
        return 0

    if phase not in ("ingest", "all"):
        print(f"ERROR: unknown IU_ARTICLE_PIPELINE_PHASE={phase!r}", file=sys.stderr)
        return 2

    print(f"[iu-pipeline] phase={phase} RSS fetch → staging (source rotation)", flush=True)
    sched_state = load_scheduler_state(SCHEDULER_STATE_PATH)
    # Full rebuild: all active feeds (nightly / recovery / manual only — not default prod).
    _full_rebuild = os.getenv("IU_FULL_REBUILD", "").strip().lower() in ("1", "true", "yes")
    _full_feed = _full_rebuild or os.getenv("IU_BUILD_ALL_FEEDS", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    if _full_feed:
        picked = registry_active_entries(registry)
        if _full_rebuild:
            print("[iu-pipeline] IU_FULL_REBUILD: fetching all active registry feeds", flush=True)
        else:
            print("[iu-pipeline] IU_BUILD_ALL_FEEDS: full registry fetch (legacy env)", flush=True)
    else:
        picked, sched_state = select_feeds_for_tick(registry, sched_state)
        run_id = str(os.getenv("GITHUB_RUN_ID") or "local")
        set_entries_in_flight(sched_state, picked, run_id)
        try:
            save_scheduler_state(SCHEDULER_STATE_PATH, sched_state)
        except Exception:
            pass
        n_p0 = sum(
            1
            for fe in picked
            if entry_fixed_slot_key(fe) in P0_FRESHNESS_SLOT_KEYS
        )
        print(
            f"[iu-pipeline] rotation tick: {len(picked)} feeds "
            f"(p0_freshness={n_p0}, slot+overdue+unmapped)",
            flush=True,
        )
    grouped = collapse_feeds_by_url(picked)
    feed_items = []
    for _url, entry_group in grouped:
        fe = entry_group[0]
        meta = {
            "topic": stable_section(str(fe.get("topic") or "aktualne")),
            "source": fe.get("label") or fe.get("id"),
            "category": str(fe.get("section_primary") or "zpravy"),
            "type": str(fe.get("entry_type") or "rss"),
            "id": str(fe.get("id") or ""),
            "displayWeight": float(fe.get("display_weight") or 1.0),
            "registryGroup": entry_group,
        }
        feed_items.append((_url, meta))

    if os.path.exists(FEEDS_YOUTUBE_PATH):
        feed_items.extend(load_youtube_feeds(FEEDS_YOUTUBE_PATH))

    all_items = []
    per_feed_report = []
    items_by_batch = defaultdict(list)
    reports_by_batch = defaultdict(list)

    # ✅ sběr YouTube videí (půjde do data/videos.json)
    yt_videos = []
    transport_state = load_transport_state()
    last_req_ts = [0.0]
    parsed_feed_cache = {}
    try:
        _gap_ms = int(
            os.getenv("IU_SOURCE_BATCH_INTERNAL_GAP_MS", "").strip() or str(SOURCE_BATCH_INTERNAL_GAP_MS_DEFAULT)
        )
    except ValueError:
        _gap_ms = SOURCE_BATCH_INTERNAL_GAP_MS_DEFAULT
    _gap_ms = max(50, min(_gap_ms, 5000))
    _gap_sec = _gap_ms / 1000.0
    last_rss_ck_for_gap = ""

    for feed_url, meta in feed_items:
        rg_meta = meta.get("registryGroup")
        batch_ck = ""
        if isinstance(rg_meta, list) and rg_meta and isinstance(rg_meta[0], dict):
            batch_ck = scheduler_cooldown_key(rg_meta[0]) or ""

        staging_batch_key = batch_ck
        if not staging_batch_key:
            staging_batch_key = "unbatched_" + hashlib.sha256(feed_url.encode("utf-8")).hexdigest()[:24]

        robots_ok, robots_reason = robots_allowed_for_url(
            feed_url, OUTPUT_DIR, last_req_ts
        )
        if not robots_ok:
            rep = {
                "feed": feed_url,
                "source": "",
                "topic": "aktualne",
                "status": "SKIPPED_ROBOTS",
                "reason": robots_reason,
                "httpStatus": 0,
                "contentType": "",
                "finalUrl": feed_url,
                "bytes": 0,
                "itemsParsed": 0,
                "itemsKept": 0,
                "accepted": 0,
            }
            _feed_report_attach_registry(rep, meta)
            per_feed_report.append(rep)
            reports_by_batch[staging_batch_key].append(rep)
            continue

        if is_hard_blocked_url(feed_url):
            rep = {
                "feed": feed_url,
                "source": "",
                "topic": "aktualne",
                "status": "SKIPPED_BLOCKED",
                "reason": "hard_blocked_domain",
                "httpStatus": 0,
                "contentType": "",
                "finalUrl": feed_url,
                "bytes": 0,
                "itemsParsed": 0,
                "itemsKept": 0,
                "accepted": 0,
            }
            _feed_report_attach_registry(rep, meta)
            per_feed_report.append(rep)
            reports_by_batch[staging_batch_key].append(rep)
            continue

        fallback_topic = stable_section(meta.get("topic", "aktualne"))
        source = fix_cz_mojibake(str(meta.get("source") or meta.get("name") or meta.get("title") or feed_url))
        feed_category = str(meta.get("category") or meta.get("topic") or "aktualne")
        feed_type = str(meta.get("type") or "general")
        feed_id = str(meta.get("id") or "")
        src_dw = float(meta.get("displayWeight") or 1.0)

        if meta.get("disabled"):
            rep = {
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
            }
            _feed_report_attach_registry(rep, meta)
            per_feed_report.append(rep)
            reports_by_batch[staging_batch_key].append(rep)
            continue

        if feed_url in parsed_feed_cache:
            d = parsed_feed_cache[feed_url]
            diagnostics = {
                "httpStatus": 200,
                "contentType": "",
                "finalUrl": feed_url,
                "bytes": 0,
                "reason": "shared_fetch_cache",
                "bozo": False,
                "bozoException": "",
            }
        else:
            if batch_ck and last_rss_ck_for_gap and last_rss_ck_for_gap == batch_ck:
                time.sleep(_gap_sec)
            d, diagnostics = fetch_feed(feed_url, transport_state, last_req_ts)
            if batch_ck:
                last_rss_ck_for_gap = batch_ck
            if d is not None:
                parsed_feed_cache[feed_url] = d

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
        _feed_report_attach_registry(report_base, meta)

        # Pokud fetch selhal nebo vrátil HTML
        if d is None:
            reason = diagnostics.get("reason", "unknown")
            status = "BOZO" if reason else "ERROR"
            report_base["status"] = status
            report_base["reason"] = reason
            rg = meta.get("registryGroup")
            if rg:
                for e in rg:
                    mark_feed_error(sched_state, str(e.get("id") or ""))
            per_feed_report.append(report_base)
            reports_by_batch[staging_batch_key].append(report_base)
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
        # If meta channel is just a URL/handle, prefer the feed title (Uploads from X).
        try:
            if is_youtube_feed and ("youtube.com" in channel_name or channel_name.startswith("http")):
                feed_title = fix_cz_mojibake(str(getattr(d, "feed", {}).get("title", "") or "").strip())
                if feed_title:
                    feed_title = re.sub(r"^\s*Uploads\s+from\s+", "", feed_title, flags=re.IGNORECASE).strip()
                    feed_title = re.sub(r"^\s*Videos\s+from\s+", "", feed_title, flags=re.IGNORECASE).strip()
                    if feed_title:
                        channel_name = feed_title
        except Exception:
            pass

        iu_tel = {
            "raw_feed_new_item_count": 0,
            "raw_feed_latest_publishedAt": "",
            "valid_publishedAt_count": 0,
            "mapped_to_section_count": defaultdict(int),
            "drop_counts": {
                "missing_publishedAt": 0,
                "invalid_publishedAt": 0,
                "parser_drop": 0,
                "section_remap": 0,
                "release_gate": 0,
                "dedupe": 0,
                "other": 0,
            },
            "sample_titles": [],
        }

        for entry in entries[:MAX_ITEMS_PER_FEED]:
            link = canonicalize_url(getattr(entry, "link", "") or "")
            title = fix_cz_mojibake(getattr(entry, "title", "") or "")
            dt = parse_dt(entry)
            has_rss_dt = bool(
                getattr(entry, "published_parsed", None) or getattr(entry, "updated_parsed", None)
            )

            if link and title:
                iso_edge = dt.isoformat().replace("+00:00", "Z")
                cur = iu_tel["raw_feed_latest_publishedAt"]
                if not cur or iso_edge > cur:
                    iu_tel["raw_feed_latest_publishedAt"] = iso_edge
                if not is_youtube_feed:
                    iu_tel["raw_feed_new_item_count"] += 1

            if not link or not title:
                iu_tel["drop_counts"]["parser_drop"] += 1
                continue
            if is_hard_blocked_url(link):
                iu_tel["drop_counts"]["parser_drop"] += 1
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

                t_yt = fix_cz_mojibake(clean_title_basic(title))
                ch_yt = channel_name or "YouTube"
                meta_src_yt = (meta.get("source") or "") if isinstance(meta, dict) else ""
                if iu_is_blocked_pocasicko_source(ch_yt, t_yt, str(meta_src_yt)):
                    continue

                yt_videos.append({
                    "title": t_yt,
                    "url": link,
                    "videoId": vid,
                    "publishedAt": dt.isoformat().replace("+00:00", "Z"),
                    "section": section,
                    "channel": channel_name or "YouTube",
                    "category": (meta.get("category") or "") if isinstance(meta, dict) else "",
                    "categoryWeight": (meta.get("categoryWeight") or 0) if isinstance(meta, dict) else 0,
                    "sourceKey": (meta.get("sourceKey") or channel_name or "YouTube") if isinstance(meta, dict) else (channel_name or "YouTube"),
                    "allowlistVersion": (meta.get("allowlistVersion") or 1) if isinstance(meta, dict) else 1,
                    "thumb": youtube_thumb_from_id(vid),
                    "_dt": dt,  # interně pro řazení
                })
                accepted += 1
                continue

            # contentType detekce: video jen z RSS metadat (mimo YouTube)
            is_video = _is_video_entry(entry)
            content_type = "video" if is_video else "article"

            if has_rss_dt:
                iu_tel["valid_publishedAt_count"] += 1
            else:
                iu_tel["drop_counts"]["missing_publishedAt"] += 1

            if fallback_topic in FORCED_FEED_TOPICS:
                section = fallback_topic
            else:
                section = enforce_news_source_section_truth(link, title, fallback_topic=fallback_topic)
            section = stable_section(section)

            purity_sec = vertical_purity_final_section(
                section,
                title,
                link,
                dt,
                trust_forced_feed=(fallback_topic in FORCED_FEED_TOPICS),
            )
            if purity_sec is None:
                iu_tel["drop_counts"]["section_remap"] += 1
                continue
            section = stable_section(purity_sec)

            item = {
                "section": section,
                "contentType": content_type,
                "title": fix_cz_mojibake(title),
                "url": link,
                "dt": dt,
                "media_raw": media_raw,
                "media_norm": media_norm,
                "tokens": tokenize_title(title),
                "feedCategory": feed_category,
                "feedType": feed_type,
                "feedId": feed_id,
                "sourceDisplayWeight": src_dw,
                "sourceBatchKey": staging_batch_key,
            }
            _bk = section_bucket(section)
            iu_tel["mapped_to_section_count"][_bk] += 1
            if len(iu_tel["sample_titles"]) < 8:
                iu_tel["sample_titles"].append(
                    {
                        "title": fix_cz_mojibake(title),
                        "publishedAt": dt.isoformat().replace("+00:00", "Z"),
                    }
                )
            all_items.append(item)
            items_by_batch[staging_batch_key].append(item)
            accepted += 1

        report_base["itemsKept"] = accepted
        report_base["accepted"] = accepted
        report_base["iuTelemetry"] = {
            "raw_feed_new_item_count": int(iu_tel["raw_feed_new_item_count"]),
            "raw_feed_latest_publishedAt": str(iu_tel["raw_feed_latest_publishedAt"]),
            "valid_publishedAt_count": int(iu_tel["valid_publishedAt_count"]),
            "mapped_to_section_count": {k: int(v) for k, v in iu_tel["mapped_to_section_count"].items()},
            "drop_counts": {k: int(v) for k, v in iu_tel["drop_counts"].items()},
            "sample_titles": list(iu_tel["sample_titles"])[:8],
        }

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

        rg = meta.get("registryGroup")
        if rg and not is_youtube_feed:
            mark_feeds_fetched(sched_state, rg)

        per_feed_report.append(report_base)
        reports_by_batch[staging_batch_key].append(report_base)

    ingested_at = iso_now_z()
    ensure_staging_dirs(OUTPUT_DIR)
    all_batch_keys = sorted(set(items_by_batch.keys()) | set(reports_by_batch.keys()))
    for bk in all_batch_keys:
        write_source_staging(
            OUTPUT_DIR,
            bk,
            list(items_by_batch.get(bk, [])),
            list(reports_by_batch.get(bk, [])),
            ingested_at,
        )
    write_youtube_staging(OUTPUT_DIR, yt_videos, ingested_at)
    write_ingest_manifest(OUTPUT_DIR, all_batch_keys, ingested_at)

    try:
        save_transport_state(transport_state)
    except Exception:
        pass

    try:
        if not _full_feed:
            clear_entries_in_flight(sched_state, picked)
        save_scheduler_state(SCHEDULER_STATE_PATH, sched_state)
        rep = build_scheduler_report(
            registry,
            sched_state,
            run_id=str(os.getenv("GITHUB_RUN_ID") or ""),
            main_commit=str(os.getenv("GITHUB_SHA") or "")[:12],
        )
        emit_reports(OUTPUT_DIR, [rep])
    except Exception as e:
        print("WARN: scheduler_state write failed:", str(e))

    if phase == "ingest":
        _incr_pub = os.getenv("IU_INCREMENTAL_PUBLISH", "").strip().lower() in (
            "1",
            "true",
            "yes",
        )
        if _incr_pub and all_items:
            print(
                f"[iu-pipeline] incremental publish: {len(all_items)} new ingest items",
                flush=True,
            )
            rc, bp_meta = _incremental_publish_with_backpressure(
                all_items, per_feed_report, yt_videos, registry
            )
            print(
                f"[iu-pipeline] incremental publish done rc={rc} "
                f"elapsed_sec={bp_meta.get('publish_elapsed_sec')}",
                flush=True,
            )
            return rc
        if _incr_pub and queue_depth(OUTPUT_DIR) > 0:
            print(
                f"[iu-pipeline] incremental publish: drain queue only "
                f"depth={queue_depth(OUTPUT_DIR)}",
                flush=True,
            )
            rc, _ = _incremental_publish_with_backpressure(
                [], per_feed_report, yt_videos, registry
            )
            return rc
        return 0

    loaded = load_staging_for_aggregate(OUTPUT_DIR)
    staged_items = list(loaded.get("all_items") or [])
    # Prefer in-memory items from this run (same URL wins over older shard).
    by_url_staged: dict[str, dict] = {}
    for it in staged_items:
        if isinstance(it, dict):
            u = str(it.get("url") or "").strip()
            if u:
                by_url_staged[u] = it
    for it in all_items:
        if isinstance(it, dict):
            u = str(it.get("url") or "").strip()
            if u:
                by_url_staged[u] = it
    aggregate_items = list(by_url_staged.values())
    aggregate_reports = list(loaded.get("per_feed_report") or [])
    seen_rep = {str(r.get("feed") or "") for r in aggregate_reports if isinstance(r, dict)}
    for r in per_feed_report or []:
        if isinstance(r, dict):
            fk = str(r.get("feed") or "")
            if fk and fk not in seen_rep:
                aggregate_reports.append(r)
                seen_rep.add(fk)
    bundle = _aggregate_pipeline(aggregate_items, aggregate_reports, yt_videos, registry)
    hm = _handoff_meta_from_staging_manifest(loaded)
    write_aggregated_checkpoint(OUTPUT_DIR, _checkpoint_bundle_for_disk(bundle, hm))
    return _publish_article_outputs(bundle)


def _legacy_main_removed_placeholder():
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

        pcat = _primary_category_from_cluster_items(c.items)
        ftype = _feed_type_from_cluster_items(c.items)
        thash = topic_hash_from_title(title_out)

        primary_item = sorted(c.items, key=lambda x: x["dt"], reverse=True)[0]
        src0 = (sources or [{}])[0]
        candidate = (src0.get("url", "") or "").strip()
        article_url = candidate if candidate.lower().startswith(("http://", "https://")) else ""
        _sl = media_source_display(str(primary_item.get("media_raw") or ""), article_url)
        sources_out = [
            {"name": media_source_display(str(s.get("name") or ""), str(s.get("url") or article_url)), "url": s.get("url")}
            for s in sources
        ]
        article_out = {
            "topic": c.section,
            "section": c.section,
            "contentType": c.content_type,
            "title": fix_cz_mojibake(title_out),
            "publishedAt": published,
            "sources": sources_out,
            "primaryCategory": pcat,
            "topicHash": thash,
            "feedType": ftype,
            "sourceDisplayWeight": float(primary_item.get("sourceDisplayWeight") or 1.0),
            "sectionPrimary": str(primary_item.get("feedCategory") or ""),
            "sourceLabel": _sl,
        }
        _fid = str(primary_item.get("feedId") or "").strip()
        if _fid:
            article_out["feedId"] = _fid
        article_out["url"] = article_url

        out_articles.append(article_out)

    # Timestamp shared by all outputs in this run
    generated_at = iso_now_z()

    prev_payload = _safe_read_json(OUT_PATH) or {}
    prev_list = list(prev_payload.get("articles") or [])
    merged_articles = merge_article_lists(prev_list, out_articles, MAX_MERGED_ARTICLES_POOL)
    merged_articles = purge_blocked_articles(merged_articles)
    merged_articles = [remap_article_section_if_url_mismatch(a) for a in merged_articles]
    merged_articles = [_apply_output_vertical_purity(a) for a in merged_articles]
    merged_articles = [a for a in merged_articles if a is not None]
    merged_articles = [_apply_second_layer_targeted_section_cleanup(a) for a in merged_articles]
    merged_articles = _apply_conservative_topic_clustering(merged_articles)
    for a in merged_articles:
        a["duplicatePenalty"] = float(a.get("duplicatePenalty") or 1.0)
        a["displayScore"] = compute_display_score(a)

    merged_articles.sort(key=lambda a: str(a.get("publishedAt") or ""), reverse=True)
    merged_articles = apply_staggered_section_release(merged_articles, generated_at)
    merged_articles = sorted(merged_articles, key=lambda a: str(a.get("publishedAt") or ""), reverse=True)
    merged_articles = _apply_source_display_to_articles(merged_articles)

    out_articles = apply_per_section_limits_then_cap(merged_articles)
    out_articles = apply_per_section_published_retention(prev_list, out_articles)
    out_articles = _apply_conservative_topic_clustering(out_articles)
    for a in out_articles:
        a["duplicatePenalty"] = float(a.get("duplicatePenalty") or 1.0)
        a["displayScore"] = compute_display_score(a)
    out_articles = _apply_source_display_to_articles(out_articles)
    # Drip (releaseAt v budoucnu) schová většinu článků v UI — nesmí blokovat čerstvý feed; čas publikace zůstává v publishedAt.
    out_articles = enrich_article_list(out_articles)

    try:
        save_transport_state(transport_state)
    except Exception:
        pass

    try:
        save_scheduler_state(SCHEDULER_STATE_PATH, sched_state)
    except Exception as e:
        print("WARN: scheduler_state write failed:", str(e))

    # ===== RETENTION (ARTICLES) =====
    # Store ALL articles by day under projects/data/articles/YYYY-MM-DD.json (+ index.json).
    # Keep legacy projects/data/articles.json as a fast, limited payload for initial page load.
    try:
        os.makedirs(ARTICLES_SHARD_DIR, exist_ok=True)

        existing_index = _safe_read_json(ARTICLES_INDEX_PATH) or {}
        prev_days = existing_index.get("days") if isinstance(existing_index, dict) else None
        prev_days = prev_days if isinstance(prev_days, list) else []

        prev_counts = {}
        prev_order = []
        for d in prev_days:
            if not isinstance(d, dict):
                continue
            date = str(d.get("date") or "").strip()
            if not date:
                continue
            prev_order.append(date)
            try:
                prev_counts[date] = int(d.get("count") or 0)
            except Exception:
                prev_counts[date] = 0

        days_in_new = set()
        by_day_new = {}
        for it in out_articles:
            pub = str(it.get("publishedAt") or "").strip()
            if len(pub) < 10:
                continue
            day = pub[:10]
            days_in_new.add(day)
            by_day_new.setdefault(day, []).append(it)

        # Update only days that appear in new output; keep other shard files untouched.
        new_counts = dict(prev_counts)
        all_days = set(prev_order)

        for day in sorted(days_in_new):
            all_days.add(day)
            day_path = os.path.join(ARTICLES_SHARD_DIR, f"{day}.json")
            day_payload = _safe_read_json(day_path) or {}

            existing_items = []
            if isinstance(day_payload, dict):
                if isinstance(day_payload.get("items"), list):
                    existing_items = day_payload.get("items")
                elif isinstance(day_payload.get("articles"), list):
                    existing_items = day_payload.get("articles")
            elif isinstance(day_payload, list):
                existing_items = day_payload

            merged = []
            seen = set()
            for src in (by_day_new.get(day) or []) + (existing_items or []):
                if not isinstance(src, dict):
                    continue
                u0 = (src.get("url") or "").strip()
                if is_hard_blocked_url(u0):
                    continue
                k = _retention_key(src)
                if k in seen:
                    continue
                seen.add(k)
                merged.append(src)

            merged.sort(key=lambda a: str(a.get("publishedAt") or ""), reverse=True)
            _atomic_write_json(day_path, {"date": day, "generatedAt": generated_at, "items": merged})
            new_counts[day] = len(merged)

        # Write/refresh index (append-only)
        ordered_days = sorted(all_days, reverse=True)

        # Retention: keep only last N days (including today, UTC).
        cutoff = (datetime.now(timezone.utc).date() - timedelta(days=RETENTION_DAYS - 1))
        keep_days = []
        for d in ordered_days:
            dt_day = _parse_day_yyyy_mm_dd(d)
            if not dt_day:
                continue
            if dt_day.date() >= cutoff:
                keep_days.append(d)

        keep_set = set(keep_days)

        # Delete old shard files not in keep_set.
        try:
            for fn in os.listdir(ARTICLES_SHARD_DIR):
                if fn == "index.json":
                    continue
                if not re.match(r"^\d{4}-\d{2}-\d{2}\.json$", fn):
                    continue
                day = fn[:-5]
                if day in keep_set:
                    continue
                try:
                    os.remove(os.path.join(ARTICLES_SHARD_DIR, fn))
                except Exception:
                    pass
        except Exception:
            pass

        index_payload = {
            "generatedAt": generated_at,
            "days": [{"date": d, "count": int(new_counts.get(d, 0) or 0)} for d in keep_days],
        }
        _atomic_write_json(ARTICLES_INDEX_PATH, index_payload)
    except Exception as e:
        # Retention must never break the main output.
        print("WARN: retention shards failed:", str(e))

    # ===== FAST OUTPUT (ARTICLES) =====
    final = out_articles

    _fcov = classification_coverage_stats(final)
    _fc_req = int(_fcov.get("total") or 0) > 0 and int(_fcov.get("withClassification") or 0) == int(
        _fcov.get("total") or 0
    )
    payload = {
        "generatedAt": generated_at,
        "articles": final,
        "mappingSingleSourceOfTruth": True,
        "homepagePreviewUsesSectionMapper": True,
        "feedClassificationSchemaVersion": 1,
        "feedClassificationSource": "iu_feed_classification.py",
        "feedClassificationCoveragePct": _fcov.get("coveragePct"),
        "feedClassificationRequired": bool(_fc_req),
        "registryVersion": registry.get("version") if isinstance(registry, dict) else None,
        "sectionRetention": _section_retention_manifest(),
    }

    # articles.json
    _atomic_write_json(OUT_PATH, payload)
    _emit_bootstrap_json(final, generated_at)

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
    _atomic_write_json(HEALTH_PATH, health_payload)

    # meta.json
    meta_payload = build_meta(generated_at, final)
    _atomic_write_json(META_PATH, meta_payload)

    # brief.json
    brief_payload = build_brief(generated_at, final)
    _atomic_write_json(BRIEF_PATH, brief_payload)

    # ✅ videos.json (YouTube allowlist / legacy)
    # dedup podle videoId + maxPerSource + maxTotal + freshness-first
    yt_sorted = sorted(
        yt_videos,
        key=lambda v: (v.get("_dt") or datetime.now(timezone.utc), int(v.get("categoryWeight") or 0)),
        reverse=True
    )

    # NOTE: YouTube allowlist videos are generated in scripts/build_videos.py.
    # build_articles.py may still see legacy YouTube playlist feeds (feeds_youtube.json).
    # Keep this section robust even when allowlist meta isn't present.
    allow_meta = {}
    allow_cfg = {}

    cfg_version = int(allow_meta.get("version") or (allow_cfg.get("version") if isinstance(allow_cfg, dict) else 1) or 1)
    primary_days = int(allow_meta.get("freshDaysPrimary") or 14)
    fallback_days = int(allow_meta.get("freshDaysFallback") or 60)
    target_share = float(allow_meta.get("freshTargetShare") or 0.7)
    max_per_source = int(allow_meta.get("maxPerSource") or 25)
    max_total = int(allow_meta.get("maxTotal") or 240)
    if primary_days < 1: primary_days = 14
    if fallback_days < primary_days: fallback_days = max(60, primary_days)
    if target_share <= 0 or target_share > 1: target_share = 0.7
    if max_per_source < 1: max_per_source = 25
    if max_total < 1: max_total = 240

    def _age_days(dt_any) -> int:
        try:
            if isinstance(dt_any, datetime):
                d = dt_any
            else:
                d = datetime.fromisoformat(str(dt_any).replace("Z", "+00:00"))
            return int((datetime.now(timezone.utc) - d).total_seconds() // 86400)
        except Exception:
            return 999999

    seen_vid = set()
    per_source = {}
    primary = []
    fallback = []
    older = []
    for v in yt_sorted:
        vid = (v.get("videoId") or "").strip()
        if not vid or vid in seen_vid:
            continue
        if iu_is_blocked_pocasicko_source(str(v.get("channel") or ""), str(v.get("title") or ""), str(v.get("sourceKey") or "")):
            continue
        src_key = str(v.get("sourceKey") or v.get("channel") or "YouTube")
        if per_source.get(src_key, 0) >= max_per_source:
            continue
        age = _age_days(v.get("_dt") or v.get("publishedAt") or "")
        row = {
            "title": v.get("title") or "",
            "url": v.get("url") or "",
            "videoId": vid,
            "publishedAt": v.get("publishedAt") or "",
            "channel": (v.get("channel") or "YouTube").strip() or "YouTube",
            "category": (v.get("category") or "").strip(),
            "thumb": v.get("thumb") or youtube_thumb_from_id(vid),
        }
        if age <= primary_days:
            primary.append(row)
        elif age <= fallback_days:
            fallback.append(row)
        else:
            older.append(row)
        # mark for global/per-source limits at the end of selection (not here)

    target_primary = int((max_total * target_share) + 0.9999)  # ceil
    out_vid = []
    used_sources = {}
    def _take_from(bucket: list, limit: int = None):
        nonlocal out_vid, seen_vid, used_sources
        for row in bucket:
            if limit is not None and len(out_vid) >= limit:
                break
            if len(out_vid) >= max_total:
                break
            vid = (row.get("videoId") or "").strip()
            if not vid or vid in seen_vid:
                continue
            src_key = str(row.get("channel") or "YouTube")
            if used_sources.get(src_key, 0) >= max_per_source:
                continue
            seen_vid.add(vid)
            used_sources[src_key] = used_sources.get(src_key, 0) + 1
            out_vid.append(row)

    # Fill primary first to reach the target share, then fallback, then older.
    _take_from(primary, limit=min(max_total, target_primary))
    _take_from(fallback)
    _take_from(older)

    primary_count = 0
    fallback_count = 0
    older_count = 0
    for row in out_vid:
        age = _age_days(row.get("publishedAt") or "")
        if age <= primary_days:
            primary_count += 1
        elif age <= fallback_days:
            fallback_count += 1
        else:
            older_count += 1

    videos_payload = {
        "generatedAt": generated_at,
        "allowlistVersion": cfg_version,
        "freshTargetShare": target_share,
        "dedupeDays": int(allow_meta.get("dedupeDays") or 30),
        "maxPerSource": max_per_source,
        "maxTotal": max_total,
        "freshness": {
            "primaryDays": primary_days,
            "fallbackDays": fallback_days,
            "primaryCount": primary_count,
            "fallbackCount": fallback_count,
            "olderCount": older_count,
            "total": len(out_vid),
        },
        "categories": allow_meta.get("categories") if isinstance(allow_meta.get("categories"), list) else [],
        "videos": out_vid,
    }

    _atomic_write_json(VIDEOS_OUT_PATH, videos_payload)
    print(f"VIDEOS_FRESHNESS primary14={primary_count} fallback60={fallback_count} older={older_count} total={len(out_vid)}")
    print("=== FEED REPORT ===")
    print(json.dumps(health_payload, ensure_ascii=False, indent=2))
    print(f"=== OUTPUT === wrote {len(final)} items to {OUT_PATH}")
    print(f"=== OUTPUT === wrote {len(out_vid)} videos to {VIDEOS_OUT_PATH}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
