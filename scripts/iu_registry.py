# -*- coding: utf-8 -*-
"""
infoUzel: source registry loader, hard domain block, fixed-slot source-batch scheduler.

Single scheduler path:
  • FIXED_MINUTE_SLOTS_BY_KEY + entry_fixed_slot_key (Europe/Prague minute) = timing source of truth;
  • slot-first: which scheduler_cooldown_key sources are due this minute (Prague wall clock);
  • when a mapped source is due, ALL its registry feeds in that slot run (deterministic order by entry id);
  • scheduler_cooldown_key(e): slot key when mapped (isolates idnes.cz vs idnes.cz/sport), else registry domain;
  • hard source cooldown floor 15 min on scheduler_cooldown_key (max with per_domain_cooldown_min);
  • mapped entries: no per-feed interval gate — slot + source cooldown only;
  • unmapped: per-source batch when any feed in the source is interval-due; cap how many unmapped
    *sources* run per tick via max_unmapped_per_tick (default 2), deterministic key order;
  • HTTP pacing between feeds of the same source is handled in build_articles (small fixed gap);
  • no random score pick, no weighted partial selection, no one-feed-per-source truncation.
"""
from __future__ import annotations

import json
import os
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore[misc, assignment]

try:
    from dateutil import tz as _dateutil_tz
except ImportError:  # pragma: no cover
    _dateutil_tz = None  # type: ignore[misc, assignment]

# Europe/Prague minute-of-hour drives fixed slots (cron aligns to local wall clock).
_SCHED_TZ_NAME = "Europe/Prague"


def _prague_tz():
    """Resolve IANA Europe/Prague without requiring the tzdata package on Windows."""
    if _dateutil_tz is not None:
        tzx = _dateutil_tz.gettz(_SCHED_TZ_NAME)
        if tzx is not None:
            return tzx
    if ZoneInfo is not None:
        try:
            return ZoneInfo(_SCHED_TZ_NAME)
        except Exception:
            pass
    # Last resort: CEST (no DST); minute-of-hour matches summer cron expectations.
    return timezone(timedelta(hours=2))

# Hard floor: same source (scheduler_cooldown_key) must not fetch more often than this between runs.
HARD_DOMAIN_COOLDOWN_MIN = 15

# P0 headline sources: must be fetched every pipeline tick when cooldown allows,
# even if Prague minute ≠ fixed slot (watchdog cadence ~30–45 min misses slot minutes).
P0_FRESHNESS_SLOT_KEYS: frozenset[str] = frozenset(
    {
        "novinky.cz",
        "seznamzpravy.cz",
        "idnes.cz",
        "ceskatelevize.cz",
        "sport.cz",
    }
)

# Primary headline rubrics — must ride P0 overdue tick even when interval_min not elapsed.
P0_HEADLINE_REGISTRY_IDS: frozenset[str] = frozenset(
    {
        "zpr_novinky_domaci",
        "zpr_novinky_zahranicni",
        "zpr_seznam_domaci",
        "zpr_idnes_zpravy",
        "zpr_ct24_domaci",
        "spt_sportcz",
    }
)

# Native finance RSS feeds — production-liveness guard (Finance min 1 / 2h).
# Rubric mirrors (Novinky/iDNES/Seznam ekonomika) are excluded: they often map outside finance.
NATIVE_FINANCE_LIVENESS_FEED_IDS: frozenset[str] = frozenset({"fin_hn", "fin_e15"})
NATIVE_FINANCE_LIVENESS_FEED_ORDER: tuple[str, ...] = ("fin_hn", "fin_e15")

# Native Zdraví RSS feeds — production-liveness guard (Zdraví min 1 / 2h).
NATIVE_ZDRAVI_LIVENESS_FEED_IDS: frozenset[str] = frozenset(
    {"zdr_zdravezpravy", "zdr_zdravotnickydenik"}
)
NATIVE_ZDRAVI_LIVENESS_FEED_ORDER: tuple[str, ...] = ("zdr_zdravezpravy", "zdr_zdravotnickydenik")

# Product limit: max scheduler visits per source per hour (exception keys capped at 5).
MAX_SOURCE_FETCHES_PER_HOUR = 4
MAX_SOURCE_FETCHES_PER_HOUR_EXCEPTION = 5
MAX_SOURCE_FETCHES_EXCEPTION_KEYS: frozenset[str] = frozenset()

# Default small gap between HTTP fetches inside one source batch (build_articles); override via IU_SOURCE_BATCH_INTERNAL_GAP_MS.
SOURCE_BATCH_INTERNAL_GAP_MS_DEFAULT = 400

# Priority tiers (source-level rotation; sections assigned after fetch).
SOURCE_PRIORITY_BY_KEY: dict[str, str] = {
    "seznamzpravy.cz": "P0",
    "novinky.cz": "P0",
    "idnes.cz": "P0",
    "idnes.cz/sport": "P0",
    "aktualne.cz": "P0",
    "denik.cz": "P0",
    "ceskatelevize.cz": "P0",
    "sport.ceskatelevize.cz": "P0",
    "sport.cz": "P0",
    "isport.cz": "P0",
    "e15.cz": "P1",
    "penize.cz": "P1",
    "hn.cz": "P1",
    "ekonom.cz": "P1",
    "ekonomickydenik.cz": "P1",
    "zdravezpravy.cz": "P1",
    "zdravotnickydenik.cz": "P1",
    "cestujlevne.cz": "P1",
    "zing.cz": "P1",
    "vortex.cz": "P1",
    "kinobox.cz": "P1",
    "technet.cz": "P1",
    "hlidacipes.org": "P1",
    "tydenikpolicie.cz": "P1",
    "crzpravy.cz": "P1",
}

# Fixed minute-of-hour slots (0–59) per scheduler key; keys match host or logical source id (e.g. idnes.cz/sport).
# Every active registry source must map to a key here (no section-based rotation).
FIXED_MINUTE_SLOTS_BY_KEY: dict[str, frozenset[int]] = {
    # Zprávy / main
    "seznamzpravy.cz": frozenset({0, 15, 30, 45}),
    "novinky.cz": frozenset({0, 15, 30, 45}),
    "idnes.cz": frozenset({5, 20, 35, 50}),
    "aktualne.cz": frozenset({5, 20, 35, 50}),
    "denik.cz": frozenset({10, 25, 40, 55}),
    # ČTK + ČT24 main RSS: reuse same 4×/h grid as idnes.cz / aktualne.cz (5,20,35,50)
    "ceskenoviny.cz": frozenset({5, 20, 35, 50}),
    "ceskatelevize.cz": frozenset({5, 20, 35, 50}),
    "hlidacipes.org": frozenset({20, 50}),
    "tydenikpolicie.cz": frozenset({25, 55}),
    # Sport
    "sport.cz": frozenset({0, 15, 30, 45}),
    "isport.cz": frozenset({5, 20, 35, 50}),
    "sport.ceskatelevize.cz": frozenset({5, 20, 35, 50}),
    "idnes.cz/sport": frozenset({10, 25, 40, 55}),
    # Finance
    "penize.cz": frozenset({0, 15, 30, 45}),
    "mesec.cz": frozenset({5, 20, 35, 50}),
    "e15.cz": frozenset({10, 25, 40, 55}),
    "patria.cz": frozenset({20, 50}),
    "ekonomickydenik.cz": frozenset({25, 55}),
    # Zdraví
    "zdravezpravy.cz": frozenset({0, 15, 30, 45}),
    # Cestování
    "cestujlevne.cz": frozenset({15, 45}),
    "pelipecky.cz": frozenset({30}),
    "travelbible.cz": frozenset({30}),
    "poznatsvet.cz": frozenset({45}),
    # Hry
    "zing.cz": frozenset({10, 40}),
    "vortex.cz": frozenset({25, 55}),
    "games.cz": frozenset({20, 50}),
    # Kultura
    "kinobox.cz": frozenset({20, 50}),
    # Věda & historie
    "technet.cz": frozenset({20, 50}),
    "osel.cz": frozenset({30}),
    "vtm.cz": frozenset({40}),
    "100plus1.cz": frozenset({45}),
    # Vzdělávání
    "flowee.cz": frozenset({30}),
    "scio.cz": frozenset({45}),
    "seduo.cz": frozenset({50}),
    # P1 — previously interval-only (2×/h)
    "hn.cz": frozenset({8, 38}),
    "ekonom.cz": frozenset({12, 42}),
    "zdravotnickydenik.cz": frozenset({3, 33}),
    "crzpravy.cz": frozenset({6, 36}),
    "epenize.eu": frozenset({14, 44}),
    "faei.cz": frozenset({16, 46}),
    # P2 — specialized / slower (1×/h, staggered minutes)
    "betterlife.cz": frozenset({7}),
    "ceska-justice.cz": frozenset({17}),
    "indian-tv.cz": frozenset({9}),
    "kverulant.org": frozenset({19}),
    "mmamag.cz": frozenset({21}),
    "nedd.cz": frozenset({23}),
    "nespechej.cz": frozenset({27}),
    "plnezdravi.cz": frozenset({29}),
    "prozeny.cz": frozenset({31}),
    "sector.sk": frozenset({37}),
    "svetcestovatele.cz": frozenset({39}),
    "tenisportal.cz": frozenset({41}),
    "vipzivot.cz": frozenset({43}),
    "vlasta.cz": frozenset({47}),
    "vtelce.cz": frozenset({51}),
    "zdrave.cz": frozenset({53}),
    "poznatsvet.cz": frozenset({55}),
    "osel.cz": frozenset({57}),
    "100plus1.cz": frozenset({59}),
    "games.cz": frozenset({58}),
    "idnes.cz/hry": frozenset({11}),
    "mesec.cz": frozenset({13}),
    "patria.cz": frozenset({18}),
}

# Host / domain aliases → canonical scheduler key in FIXED_MINUTE_SLOTS_BY_KEY
_HOST_ALIASES_TO_SLOT_KEY: dict[str, str] = {
    "cestujlevne.com": "cestujlevne.cz",
    "vtm.zive.cz": "vtm.cz",
    "isport.blesk.cz": "isport.cz",
}

BLOCKED_HOST_FRAGMENTS = (
    "hedvabnastezka.cz",
    "www.hedvabnastezka.cz",
)

# CZ vertikály — Fáze 1 rotace: jeden výběr mezi hry/kultura/věda/vzdělávání, jen ze slotovaných feedů
# (stejná priorita jako dřív, ale bez obcházení pevných minut).
VERTICAL_TOPICS = frozenset({"hry", "kultura", "veda", "vzdelavani"})
VERTICAL_TOPIC_ORDER = ("hry", "kultura", "veda", "vzdelavani")


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def host_from_url(url: str) -> str:
    try:
        return (urlparse(url or "").netloc or "").lower()
    except Exception:
        return ""


def normalize_registry_domain(dom: str) -> str:
    d = (dom or "").strip().lower()
    if d.startswith("www."):
        d = d[4:]
    return d


def _scheduler_now_local(now: datetime) -> datetime:
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(_prague_tz())


def cooldown_domain_key(e: dict) -> str:
    """Single key per site for domain_last_fetch; prefer registry domain for stable state keys."""
    d = normalize_registry_domain(str(e.get("domain") or ""))
    if d:
        return d
    u = (e.get("feed_url") or "").strip()
    h = host_from_url(u)
    if h.startswith("www."):
        h = h[4:]
    return h


def scheduler_cooldown_key(e: dict) -> str:
    """
    Cooldown bucket for fetch spacing: fixed slot key when mapped (e.g. idnes.cz vs idnes.cz/sport),
    else same as cooldown_domain_key. Used in select_feeds_for_tick and mark_feeds_fetched.
    """
    sk = entry_fixed_slot_key(e)
    if sk:
        return sk
    return cooldown_domain_key(e) or ""


def _slot_key_from_host_or_dom_registry(host: str, dom: str) -> str | None:
    """Host/domain → canonical FIXED_MINUTE_SLOTS_BY_KEY key (single lookup path, aliases first)."""
    if host in _HOST_ALIASES_TO_SLOT_KEY:
        return _HOST_ALIASES_TO_SLOT_KEY[host]
    if dom in _HOST_ALIASES_TO_SLOT_KEY:
        return _HOST_ALIASES_TO_SLOT_KEY[dom]
    if host in FIXED_MINUTE_SLOTS_BY_KEY:
        return host
    if dom in FIXED_MINUTE_SLOTS_BY_KEY:
        return dom
    return None


def entry_fixed_slot_key(e: dict) -> str | None:
    """
    Map registry entry to FIXED_MINUTE_SLOTS_BY_KEY or None (interval-only fallback).
    idnes.cz paths get distinct keys where the product schedule requires it.
    """
    url = (e.get("feed_url") or "").strip().lower()
    dom = normalize_registry_domain(str(e.get("domain") or ""))
    host = host_from_url(url)
    if host.startswith("www."):
        host = host[4:]

    if "servis.idnes.cz" in url or host.endswith("idnes.cz"):
        if "c=sport" in url or "c%3dsport" in url:
            return "idnes.cz/sport"
        if "c=hry" in url or "c%3dhry" in url:
            return "idnes.cz/hry"
        if "c=technet" in url or "c%3dtechnet" in url:
            return "technet.cz"
        return "idnes.cz"

    # ČT: ct24.ceskatelevize.cz RSS + legacy www path /ct24/rss share the same fixed grid.
    if host == "sport.ceskatelevize.cz":
        return "sport.ceskatelevize.cz"
    if host == "ct24.ceskatelevize.cz":
        return "ceskatelevize.cz"
    if host == "ceskatelevize.cz":
        if "/ct24/rss" in url:
            return "ceskatelevize.cz"
        return None

    return _slot_key_from_host_or_dom_registry(host, dom)


def minute_eligible_for_fixed_slots(e: dict, minute: int) -> bool:
    """Fixed-slot keys: only when Prague local minute matches; unmapped → all minutes (fallback)."""
    sk = entry_fixed_slot_key(e)
    if sk is None:
        return True
    mins = FIXED_MINUTE_SLOTS_BY_KEY.get(sk)
    if mins is None:
        return True
    return int(minute) % 60 in mins


def is_fixed_slot_mapped(e: dict) -> bool:
    sk = entry_fixed_slot_key(e)
    if sk is None:
        return False
    return sk in FIXED_MINUTE_SLOTS_BY_KEY


def source_priority_for_key(scheduler_key: str) -> str:
    """P0 = news/sport hubs; P1 = medium; P2 = niche/slow."""
    k = (scheduler_key or "").strip().lower()
    if k in SOURCE_PRIORITY_BY_KEY:
        return SOURCE_PRIORITY_BY_KEY[k]
    return "P2"


def fetches_per_hour_for_key(scheduler_key: str) -> int:
    mins = FIXED_MINUTE_SLOTS_BY_KEY.get((scheduler_key or "").strip().lower())
    return len(mins) if mins else 0


def rotation_plan_for_registry(registry: dict) -> dict:
    """Deterministic rotation summary from registry + slot table (for guards / inventory)."""
    keys: dict[str, dict] = {}
    for e in registry_active_entries(registry):
        ck = scheduler_cooldown_key(e) or cooldown_domain_key(e)
        if not ck or ck in keys:
            continue
        sk = entry_fixed_slot_key(e)
        fph = fetches_per_hour_for_key(ck)
        pri = source_priority_for_key(ck)
        keys[ck] = {
            "source": ck,
            "priority": pri,
            "fetches_per_hour": fph,
            "slot_minutes": sorted(FIXED_MINUTE_SLOTS_BY_KEY.get(sk or ck) or ()),
            "recommended_frequency": f"{fph}/hour" if fph else "unslotted",
        }
    rows = sorted(keys.values(), key=lambda x: x["source"])
    return {
        "total_sources": len(rows),
        "max_fetches_per_source_per_hour": MAX_SOURCE_FETCHES_PER_HOUR,
        "sources": rows,
    }


def assert_rotation_frequency_limits() -> list[str]:
    """Return human-readable violations (empty = OK)."""
    issues: list[str] = []
    for key, mins in FIXED_MINUTE_SLOTS_BY_KEY.items():
        n = len(mins)
        cap = (
            MAX_SOURCE_FETCHES_PER_HOUR_EXCEPTION
            if key in MAX_SOURCE_FETCHES_EXCEPTION_KEYS
            else MAX_SOURCE_FETCHES_PER_HOUR
        )
        if n > cap:
            issues.append(f"{key}: {n} slots/h > cap {cap}")
    return issues


def is_hard_blocked_url(url: str) -> bool:
    h = host_from_url(url)
    if not h:
        return False
    for frag in BLOCKED_HOST_FRAGMENTS:
        if frag in h or h.endswith(frag.lstrip("www.")):
            return True
    if "hedvabnastezka" in h:
        return True
    return False


def is_hard_blocked_host(host: str) -> bool:
    h = (host or "").lower()
    if not h:
        return False
    if "hedvabnastezka" in h:
        return True
    return False


def load_registry(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def registry_active_entries(registry: dict) -> list:
    out = []
    for e in registry.get("entries") or []:
        if not isinstance(e, dict):
            continue
        if e.get("blocked"):
            continue
        if e.get("active") is False:
            continue
        url = (e.get("feed_url") or "").strip()
        if not url:
            continue
        if is_hard_blocked_url(url):
            continue
        out.append(e)
    return out


def load_scheduler_state(path: str) -> dict:
    if not path or not os.path.exists(path):
        return {"tick_index": 0, "domain_last_fetch": {}, "entry_state": {}}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"tick_index": 0, "domain_last_fetch": {}, "entry_state": {}}
        data.setdefault("tick_index", 0)
        data.setdefault("domain_last_fetch", {})
        data.setdefault("entry_state", {})
        return data
    except Exception:
        return {"tick_index": 0, "domain_last_fetch": {}, "entry_state": {}}


def save_scheduler_state(path: str, state: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def _parse_iso(ts: str | None) -> datetime | None:
    if not ts or not isinstance(ts, str):
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return None


def is_native_finance_liveness_feed(e: dict) -> bool:
    """True for allowlisted native finance RSS feeds (not rubric mirrors on news sites)."""
    eid = str(e.get("id") or "")
    if eid in NATIVE_FINANCE_LIVENESS_FEED_IDS:
        return True
    if str(e.get("topic") or "").lower() != "finance":
        return False
    if str(e.get("entry_type") or "").lower() == "rubric":
        return False
    if e.get("native") is True and e.get("reliable") is True:
        return True
    return False


def is_native_zdravi_liveness_feed(e: dict) -> bool:
    """True for allowlisted native Zdraví RSS feeds (not rubric mirrors on news sites)."""
    eid = str(e.get("id") or "")
    if eid in NATIVE_ZDRAVI_LIVENESS_FEED_IDS:
        return True
    if str(e.get("topic") or "").lower() != "zdravi":
        return False
    if str(e.get("entry_type") or "").lower() == "rubric":
        return False
    if e.get("native") is True and e.get("reliable") is True:
        return True
    return False


def sources_per_tick(tick_index: int, three_frac: float = 0.62) -> int:
    """Legacy helper (unused by fixed-slot scheduler); kept for tooling compatibility."""
    mod = tick_index % 100
    threshold = int(three_frac * 100 + 0.5)
    return 3 if mod < threshold else 2


def select_feeds_for_tick(
    registry: dict,
    state: dict,
    now: datetime | None = None,
) -> tuple[list[dict], dict]:
    """
    Source-level slot scheduler (Prague minute):
    • Mapped: collect due scheduler_cooldown_key groups (minute in FIXED slots, cooldown ok);
      return every feed in each due group, sorted by registry entry id.
    • Unmapped: groups whose cooldown is ok and at least one feed is interval-due; take up to
      max_unmapped_per_tick *sources* (sorted keys), each source contributes all its feeds.
    """
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    local = _scheduler_now_local(now)
    minute = int(local.minute)

    tick_index = int(state.get("tick_index") or 0) + 1
    state["tick_index"] = tick_index
    state["last_tick_at"] = _iso_now()

    cfg = registry.get("sources_per_tick") or {}
    max_unmapped = int(cfg.get("max_unmapped_per_tick") or 2)

    entries = registry_active_entries(registry)
    domain_last = state.setdefault("domain_last_fetch", {})
    entry_state = state.setdefault("entry_state", {})

    def _effective_cooldown_min(e: dict) -> int:
        c = int(e.get("per_domain_cooldown_min") or HARD_DOMAIN_COOLDOWN_MIN)
        return max(HARD_DOMAIN_COOLDOWN_MIN, max(5, c))

    def _cooldown_ok(cool_key: str, eff_min: int) -> bool:
        if not cool_key:
            return True
        last = _parse_iso(domain_last.get(cool_key))
        if last is None:
            return True
        return (now - last).total_seconds() >= eff_min * 60

    def _p0_headline_entry_cooldown_ok(e: dict, eff_min: int) -> bool:
        """
        P0 headline registry feeds use per-entry last_fetch_at, not shared domain bucket.
        Prevents finance/vertical rubric fetches on the same domain (e.g. fin_sz_byznys)
        from blocking zpr_seznam_domaci headline ingest.
        """
        eid = str(e.get("id") or "")
        st = entry_state.get(eid) if isinstance(entry_state.get(eid), dict) else {}
        last = _parse_iso(st.get("last_fetch_at") if isinstance(st, dict) else None)
        if last is None:
            return True
        floor_min = max(HARD_DOMAIN_COOLDOWN_MIN, eff_min)
        return (now - last).total_seconds() >= floor_min * 60

    def _interval_due(e: dict) -> bool:
        eid = str(e.get("id") or "")
        interval = max(5, int(e.get("interval_min") or 30))
        st = entry_state.get(eid) if isinstance(entry_state.get(eid), dict) else {}
        last_fetch = _parse_iso(st.get("last_fetch_at") if isinstance(st, dict) else None)
        if last_fetch is None:
            return True
        return (now - last_fetch).total_seconds() >= interval * 60

    seen_urls: set[str] = set()

    # --- 1) Fixed-slot mapped: minute ∈ slots; full batch per scheduler_cooldown_key (sorted entry ids) ---
    by_ck: dict[str, list[dict]] = defaultdict(list)
    for e in entries:
        if not is_fixed_slot_mapped(e):
            continue
        sk = entry_fixed_slot_key(e)
        if sk is None:
            continue
        mins = FIXED_MINUTE_SLOTS_BY_KEY.get(sk)
        if mins is None or minute not in mins:
            continue
        u = (e.get("feed_url") or "").strip()
        if not u:
            continue
        ck = scheduler_cooldown_key(e)
        eff = _effective_cooldown_min(e)
        if not ck:
            continue
        if not _cooldown_ok(ck, eff):
            continue
        by_ck[ck].append(e)

    fixed_picks: list[dict] = []
    for ck in sorted(by_ck.keys()):
        group = sorted(by_ck[ck], key=lambda x: str(x.get("id") or ""))
        for w in group:
            u = (w.get("feed_url") or "").strip()
            if u and u not in seen_urls:
                fixed_picks.append(w)
                seen_urls.add(u)

    # --- 1b) P0 freshness: slot minute mismatch must not skip headline sources (pipeline ≠ wall clock slots) ---
    p0_overdue_picks: list[dict] = []
    for e in entries:
        if not is_fixed_slot_mapped(e):
            continue
        eid = str(e.get("id") or "")
        if eid not in P0_HEADLINE_REGISTRY_IDS:
            continue
        sk = entry_fixed_slot_key(e)
        if sk not in P0_FRESHNESS_SLOT_KEYS:
            continue
        u = (e.get("feed_url") or "").strip()
        if not u or u in seen_urls:
            continue
        ck = scheduler_cooldown_key(e)
        if not ck:
            continue
        eff = _effective_cooldown_min(e)
        if not _p0_headline_entry_cooldown_ok(e, eff):
            continue
        p0_overdue_picks.append(e)
        seen_urls.add(u)

    for e in entries:
        if not is_fixed_slot_mapped(e):
            continue
        eid = str(e.get("id") or "")
        if eid in P0_HEADLINE_REGISTRY_IDS:
            continue
        sk = entry_fixed_slot_key(e)
        if sk not in P0_FRESHNESS_SLOT_KEYS:
            continue
        u = (e.get("feed_url") or "").strip()
        if not u or u in seen_urls:
            continue
        ck = scheduler_cooldown_key(e)
        if not ck:
            continue
        eff = _effective_cooldown_min(e)
        if not _cooldown_ok(ck, eff):
            continue
        if not _interval_due(e):
            continue
        p0_overdue_picks.append(e)
        seen_urls.add(u)

    # --- 2) Unmapped: cooldown per source; source runs if any feed is interval-due; cap = max unmapped *sources* ---
    by_um: dict[str, list[dict]] = defaultdict(list)
    for e in entries:
        if is_fixed_slot_mapped(e):
            continue
        u = (e.get("feed_url") or "").strip()
        if not u:
            continue
        ck = scheduler_cooldown_key(e) or cooldown_domain_key(e)
        if not ck:
            continue
        eff = _effective_cooldown_min(e)
        if not _cooldown_ok(ck, eff):
            continue
        by_um[ck].append(e)

    unmapped_picks: list[dict] = []
    due_um_keys = [
        ck
        for ck in sorted(by_um.keys())
        if any(_interval_due(e) for e in by_um[ck])
    ]
    # --- 1c) Finance liveness: ≥1 native finance feed per tick (production-liveness contract) ---
    pre_finance = fixed_picks + p0_overdue_picks
    finance_liveness_picks: list[dict] = []
    if not any(is_native_finance_liveness_feed(e) for e in pre_finance):
        by_id = {str(e.get("id") or ""): e for e in entries}
        finance_candidates: list[dict] = []
        for fid in NATIVE_FINANCE_LIVENESS_FEED_ORDER:
            e = by_id.get(fid)
            if e is not None:
                finance_candidates.append(e)
        for e in sorted(entries, key=lambda x: str(x.get("id") or "")):
            if is_native_finance_liveness_feed(e) and e not in finance_candidates:
                finance_candidates.append(e)
        for e in finance_candidates:
            u = (e.get("feed_url") or "").strip()
            if not u or u in seen_urls:
                continue
            ck = scheduler_cooldown_key(e)
            if not ck:
                continue
            eff = _effective_cooldown_min(e)
            if not _cooldown_ok(ck, eff):
                continue
            finance_liveness_picks.append(e)
            seen_urls.add(u)
            break

    # --- 1d) Zdraví liveness: both native Zdraví feeds per tick when missing (production-liveness contract) ---
    pre_zdravi = pre_finance + finance_liveness_picks
    zdravi_liveness_picks: list[dict] = []
    pre_zdravi_native_ids = {
        str(e.get("id") or "") for e in pre_zdravi if is_native_zdravi_liveness_feed(e)
    }
    by_id = {str(e.get("id") or ""): e for e in entries}
    zdravi_candidates: list[dict] = []
    for fid in NATIVE_ZDRAVI_LIVENESS_FEED_ORDER:
        e = by_id.get(fid)
        if e is not None:
            zdravi_candidates.append(e)
    for e in sorted(entries, key=lambda x: str(x.get("id") or "")):
        if is_native_zdravi_liveness_feed(e) and e not in zdravi_candidates:
            zdravi_candidates.append(e)
    for e in zdravi_candidates:
        eid = str(e.get("id") or "")
        if eid in pre_zdravi_native_ids:
            continue
        u = (e.get("feed_url") or "").strip()
        if not u or u in seen_urls:
            continue
        ck = scheduler_cooldown_key(e)
        if not ck:
            continue
        eff = _effective_cooldown_min(e)
        if not _cooldown_ok(ck, eff):
            continue
        zdravi_liveness_picks.append(e)
        seen_urls.add(u)

    for ck in due_um_keys[: max(0, max_unmapped)]:
        group = sorted(by_um[ck], key=lambda x: str(x.get("id") or ""))
        for w in group:
            u = (w.get("feed_url") or "").strip()
            if u and u not in seen_urls:
                unmapped_picks.append(w)
                seen_urls.add(u)

    picked = pre_finance + finance_liveness_picks + zdravi_liveness_picks + unmapped_picks
    return picked, state


def mark_feeds_fetched(state: dict, entries: list[dict], now: datetime | None = None) -> None:
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    ts = _iso_now()
    domain_last = state.setdefault("domain_last_fetch", {})
    entry_state = state.setdefault("entry_state", {})

    for e in entries:
        eid = str(e.get("id") or "")
        if not eid:
            continue
        ck = scheduler_cooldown_key(e)
        if ck:
            domain_last[ck] = ts
        prev = entry_state.get(eid)
        if not isinstance(prev, dict):
            prev = {}
        prev["last_fetch_at"] = ts
        prev["last_success_at"] = ts
        prev["error_streak"] = 0
        entry_state[eid] = prev


def mark_feed_error(state: dict, entry_id: str) -> None:
    entry_state = state.setdefault("entry_state", {})
    prev = entry_state.get(entry_id)
    if not isinstance(prev, dict):
        prev = {}
    prev["error_streak"] = int(prev.get("error_streak") or 0) + 1
    prev["last_fetch_at"] = _iso_now()
    entry_state[entry_id] = prev


def collapse_feeds_by_url(entries: list[dict]) -> list[tuple[str, list[dict]]]:
    """One HTTP fetch per URL; list of registry entries sharing that URL."""
    by_url: dict[str, list[dict]] = {}
    for e in entries:
        u = (e.get("feed_url") or "").strip()
        if not u:
            continue
        by_url.setdefault(u, []).append(e)
    out = []
    for u, lst in by_url.items():
        out.append((u, lst))
    return out


def purge_blocked_articles(articles: list) -> list:
    out = []
    for a in articles or []:
        if not isinstance(a, dict):
            continue
        url = (a.get("url") or "").strip()
        src0 = (a.get("sources") or [{}])[0] if isinstance(a.get("sources"), list) else {}
        su = (src0.get("url") or "") if isinstance(src0, dict) else ""
        if is_hard_blocked_url(url) or is_hard_blocked_url(su):
            continue
        out.append(a)
    return out


def merge_article_lists(
    previous: list,
    new_items: list,
    max_total: int,
) -> list:
    """Merge by canonical URL; prefer new item when same URL (fresher pipeline)."""
    by_url: dict[str, dict] = {}

    def canon(u: str) -> str:
        u = (u or "").strip()
        return u

    for a in previous or []:
        if not isinstance(a, dict):
            continue
        u = canon(a.get("url") or "")
        if not u:
            continue
        if is_hard_blocked_url(u):
            continue
        by_url[u] = dict(a)

    for a in new_items or []:
        if not isinstance(a, dict):
            continue
        u = canon(a.get("url") or "")
        if not u:
            continue
        if is_hard_blocked_url(u):
            continue
        by_url[u] = dict(a)

    merged = list(by_url.values())
    merged.sort(key=lambda x: str(x.get("publishedAt") or ""), reverse=True)
    return merged[:max_total]


def compute_display_score(
    article: dict,
    now: datetime | None = None,
) -> float:
    """display_score = freshness * source_weight * duplicate_penalty (section_weight=1)."""
    now = now or datetime.now(timezone.utc)
    try:
        pub = datetime.fromisoformat(str(article.get("publishedAt") or "").replace("Z", "+00:00"))
    except Exception:
        pub = now
    age_h = max(0.0, (now - pub.replace(tzinfo=pub.tzinfo or timezone.utc)).total_seconds() / 3600.0)
    freshness = 1.0 / (1.0 + age_h / 6.0)
    sw = float(article.get("sourceDisplayWeight") or article.get("displayWeight") or 1.0)
    dup = float(article.get("duplicatePenalty") or 1.0)
    return max(0.0, freshness * sw * dup)
