#!/usr/bin/env python3
"""
Generate reports/ultra_audit_wiki.md (Ultra Audit wiki overview).
Read-only: feeds.json, articles.json, .github/workflows (local files only).
Pure helpers have no side effects beyond their return values.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

REPO_ROOT = Path(__file__).resolve().parent.parent
REPORTS_DIR = REPO_ROOT / "reports"
FEEDS_JSON = REPO_ROOT / "scripts" / "feeds.json"
FEEDS_YOUTUBE_JSON = REPO_ROOT / "scripts" / "feeds_youtube.json"
SOURCES_JSON = REPO_ROOT / "config" / "sources.json"
FEED_HEALTH_REL = "projects/data/feed_health.json"
ARTICLES_JSON = REPO_ROOT / "projects" / "data" / "articles.json"
WORKFLOWS_DIR = REPO_ROOT / ".github" / "workflows"
INGEST_WORKFLOW_FILE = "update-articles.yml"


def env_or_git_sha() -> str:
    """Prefer GITHUB_SHA; else current HEAD (nightly security step has no GITHUB_SHA)."""
    sha = (os.environ.get("GITHUB_SHA") or "").strip()
    if sha and sha.lower() != "unknown":
        return sha
    try:
        r = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            check=False,
        )
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    except OSError:
        pass
    return "unknown"


# Display order and labels for feeds.json category -> section heading
SECTION_ORDER = [
    "zpravy",
    "sport",
    "tech",
    "finance",
    "zdravi",
    "bydleni",
    "cestovani",
    "hry",
    "kultura",
    "veda",
    "vzdelavani",
]

SECTION_LABELS: Dict[str, str] = {
    "zpravy": "Zprávy",
    "sport": "Sport",
    "tech": "Technologie",
    "finance": "Finance",
    "zdravi": "Zdraví",
    "bydleni": "Bydlení",
    "cestovani": "Cestování",
    "hry": "Hry",
    "kultura": "Kultura",
    "veda": "Věda",
    "vzdelavani": "Vzdělávání",
}

UNMAPPED_SECTION = "Unmapped"

# Workflow that runs scripts/build_articles.py (source of truth for ingest cadence)
INGEST_WORKFLOW_NAMES = ("update-articles.yml",)


def group_sources_by_section(
    sources: Sequence[Mapping[str, Any]],
) -> Dict[str, List[Mapping[str, Any]]]:
    """Group feed config rows by normalized category (section key). O(n)."""
    out: Dict[str, List[Mapping[str, Any]]] = {}
    for row in sources:
        cat = str(row.get("category") or "").strip().lower()
        if not cat:
            cat = UNMAPPED_SECTION.lower()
        key = cat if cat != UNMAPPED_SECTION.lower() else UNMAPPED_SECTION
        out.setdefault(key, []).append(row)
    return out


def _cron_to_human(cron: str) -> str:
    cron = cron.strip()
    parts = cron.split()
    if len(parts) != 5:
        return cron
    minute, hour, dom, mon, dow = parts
    if (
        minute.startswith("*/")
        and hour == "*"
        and dom == "*"
        and mon == "*"
        and dow == "*"
    ):
        try:
            n = int(minute[2:])
            if n <= 0:
                return cron
            if n == 1:
                return "every minute"
            return f"every {n} minutes"
        except ValueError:
            return cron
    if (
        re.fullmatch(r"\d+", minute or "")
        and hour == "*"
        and dom == "*"
        and mon == "*"
        and dow == "*"
    ):
        try:
            m = int(minute)
            if m == 0:
                return "hourly at minute 0"
            return f"hourly at minute {m}"
        except ValueError:
            pass
    if (
        dom == "*"
        and mon == "*"
        and dow == "*"
        and hour.isdigit()
        and minute.isdigit()
    ):
        return f"daily at {hour.zfill(2)}:{minute.zfill(2)} UTC"
    return cron


def _extract_schedule_crons(workflow_text: str) -> List[str]:
    """First `cron:` under `schedule:` (supports one or more list items)."""
    crons: List[str] = []
    lines = workflow_text.splitlines()
    in_schedule = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("schedule:"):
            in_schedule = True
            continue
        if in_schedule:
            if stripped.startswith(("cron:", "- cron:")):
                m = re.search(r'cron:\s*["\x27]([^"\x27]+)["\x27]', line)
                if m:
                    crons.append(m.group(1).strip())
                continue
            # next top-level key ends schedule block
            if stripped and not stripped.startswith("-") and ":" in stripped:
                if not stripped.startswith("#"):
                    in_schedule = False
    return crons


def load_workflow_texts(workflows_dir: Path) -> List[Tuple[str, str]]:
    """List of (relative_path, text). No network."""
    if not workflows_dir.is_dir():
        return []
    out: List[Tuple[str, str]] = []
    for p in sorted(workflows_dir.glob("*.yml")):
        try:
            out.append((p.name, p.read_text(encoding="utf-8", errors="replace")))
        except OSError:
            continue
    for p in sorted(workflows_dir.glob("*.yaml")):
        try:
            out.append((p.name, p.read_text(encoding="utf-8", errors="replace")))
        except OSError:
            continue
    return out


def resolve_fetch_cadence(
    _source: Mapping[str, Any],
    workflows: Sequence[Tuple[str, str]],
) -> str:
    """
    Map ingest scheduler cron to a human string. Same cadence for all RSS sources
    (single workflow builds articles from feeds.json).
    """
    for name in INGEST_WORKFLOW_NAMES:
        for wname, text in workflows:
            if wname != name:
                continue
            crons = _extract_schedule_crons(text)
            if not crons:
                continue
            return _cron_to_human(crons[0])
    return "unknown (no explicit scheduler mapping found)"


def normalize_url_key(url: str) -> str:
    """Hostname + path: https, strip trailing slash on path, lower host."""
    try:
        raw = (url or "").strip()
        if not raw:
            return ""
        p = urlparse(raw)
        if not p.netloc:
            return raw.lower()
        scheme = "https" if p.scheme in ("http", "https") else p.scheme
        host = (p.netloc or "").lower()
        path = p.path or "/"
        if len(path) > 1 and path.endswith("/"):
            path = path[:-1]
        q: List[Tuple[str, str]] = []
        for k, v in parse_qsl(p.query, keep_blank_values=True):
            lk = k.lower()
            if lk.startswith("utm_"):
                continue
            if lk in {"fbclid", "gclid", "yclid", "cmpid", "pk_campaign", "pk_source"}:
                continue
            q.append((k, v))
        query = urlencode(q, doseq=True)
        return urlunparse((scheme, host, path, "", query, ""))
    except Exception:
        return (url or "").strip().lower()


def _parse_ts(raw: Any) -> Optional[datetime]:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    try:
        t = s.replace("Z", "+00:00")
        dt = datetime.fromisoformat(t)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _in_last_24h(dt: datetime, now: datetime) -> bool:
    start = now - timedelta(hours=24)
    return start < dt <= now


def _article_fetched_in_window(art: Mapping[str, Any], now: datetime) -> bool:
    """Union: RSS time or release pipeline activity in window (no timestamp -> not counted)."""
    pub = _parse_ts(art.get("publishedAt"))
    iur = _parse_ts(art.get("iuReleaseAt")) if art.get("iuReleaseAt") else None
    if pub is not None and _in_last_24h(pub, now):
        return True
    if iur is not None and _in_last_24h(iur, now):
        return True
    return False


def _visibility_ts(art: Mapping[str, Any]) -> Optional[datetime]:
    """Site visibility: iuReleaseAt when present and parseable, else publishedAt."""
    iur = _parse_ts(art.get("iuReleaseAt")) if art.get("iuReleaseAt") else None
    if iur is not None:
        return iur
    return _parse_ts(art.get("publishedAt"))


def _article_published_in_window(art: Mapping[str, Any], now: datetime) -> bool:
    vt = _visibility_ts(art)
    if vt is None:
        return False
    return _in_last_24h(vt, now)


def _article_key(art: Mapping[str, Any]) -> str:
    u = (art.get("url") or "").strip()
    if u:
        return "url:" + normalize_url_key(u)
    fid = str(art.get("feedId") or "").strip()
    return "fid:" + fid + "|" + str(art.get("title") or "")[:120]


def compute_source_stats_last_24h(
    sources: Sequence[Mapping[str, Any]],
    articles: Sequence[Mapping[str, Any]],
    now: Optional[datetime] = None,
) -> Dict[str, Tuple[int, int]]:
    """
    Per feeds.json id: (fetched_24h, published_24h), deduped by article key. O(n).
    """
    now = now or datetime.now(timezone.utc)
    by_fid: Dict[str, List[Mapping[str, Any]]] = {}
    for a in articles:
        fid = str(a.get("feedId") or "").strip()
        if not fid:
            continue
        by_fid.setdefault(fid, []).append(a)

    stats: Dict[str, Tuple[int, int]] = {}
    for src in sources:
        sid = str(src.get("id") or "").strip()
        if not sid:
            continue
        lst = by_fid.get(sid) or []
        fetched_keys: set = set()
        published_keys: set = set()
        for art in lst:
            if _article_fetched_in_window(art, now):
                fetched_keys.add(_article_key(art))
            if _article_published_in_window(art, now):
                published_keys.add(_article_key(art))
        f_count = len(fetched_keys)
        # Published is a subset of “fetched activity” keys (same article keys).
        p_count = len(published_keys & fetched_keys)
        stats[sid] = (f_count, p_count)
    return stats


def _git_show_text(rel_path: str, sha: str) -> Optional[str]:
    try:
        r = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "show", f"{sha}:{rel_path}"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
        )
        if r.returncode != 0 or not (r.stdout or "").strip():
            return None
        return r.stdout
    except (OSError, subprocess.TimeoutExpired):
        return None


def _git_log_feed_health_commits(since_hours: int = 24) -> List[str]:
    """Return commit SHAs touching feed_health.json in the last N hours (read-only git history)."""
    since = (datetime.now(timezone.utc) - timedelta(hours=since_hours)).strftime("%Y-%m-%dT%H:%M:%S")
    try:
        r = subprocess.run(
            [
                "git",
                "-C",
                str(REPO_ROOT),
                "log",
                f"--since={since}",
                "--format=%H",
                "--",
                FEED_HEALTH_REL,
            ],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
        )
        if r.returncode != 0:
            return []
        return [ln.strip() for ln in (r.stdout or "").splitlines() if ln.strip()]
    except (OSError, subprocess.TimeoutExpired):
        return []


def aggregate_feed_health_runtime_24h(
    since_hours: int = 24,
) -> Tuple[Dict[str, Dict[str, Any]], List[str]]:
    """
    Per feed URL (from feed_health.json keys): runs, success, empty, failed, total_articles, label.
    Aggregates across git commits touching projects/data/feed_health.json in the window.
    """
    commits = _git_log_feed_health_commits(since_hours=since_hours)
    agg: Dict[str, Dict[str, Any]] = {}

    def ensure(url: str) -> Dict[str, Any]:
        if url not in agg:
            agg[url] = {
                "label": "",
                "runs": 0,
                "success": 0,
                "empty": 0,
                "failed": 0,
                "total_articles": 0,
            }
        return agg[url]

    for sha in commits:
        raw = _git_show_text(FEED_HEALTH_REL, sha)
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        feeds = data.get("feeds") if isinstance(data, dict) else None
        if not isinstance(feeds, dict):
            continue
        for url, row in feeds.items():
            if not isinstance(row, dict):
                continue
            st = str(row.get("status") or "").strip().upper()
            if st.startswith("SKIP") or "SKIPPED" in st:
                continue
            a = ensure(str(url))
            lbl = str(row.get("source") or "").strip()
            if lbl:
                a["label"] = lbl
            accepted = int(row.get("accepted") or 0)
            kept = int(row.get("itemsKept") or row.get("itemsParsed") or 0)
            a["runs"] += 1
            if st == "OK":
                if accepted > 0 or kept > 0:
                    a["success"] += 1
                    a["total_articles"] += accepted
                else:
                    a["empty"] += 1
            else:
                a["failed"] += 1

    return agg, commits


def classify_pipeline_runs_24h_buckets() -> Tuple[Dict[str, int], Optional[str]]:
    """Bucket update-articles runs (24h) by pipeline_overall_status via phase status classifier."""
    scripts_dir = str(REPO_ROOT / "scripts")
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    from iu_pipeline_run_classifier import classify_pipeline_runs_24h, empty_bucket_counts

    fetch_artifacts = os.environ.get("ULTRA_AUDIT_FETCH_ARTIFACTS", "1").strip().lower() not in (
        "0",
        "false",
        "no",
    )
    try:
        counts, err = classify_pipeline_runs_24h(fetch_artifact=fetch_artifacts)
        return counts, err
    except Exception as exc:  # noqa: BLE001
        return empty_bucket_counts(), f"{type(exc).__name__}: {exc}"


def count_gh_success_runs_24h() -> Optional[int]:
    """Deprecated: legacy success count; kept for selftest compatibility."""
    counts, err = classify_pipeline_runs_24h_buckets()
    if err:
        return None
    return int(counts.get("PIPELINE_SUCCESS", 0))


def load_config_source_urls() -> List[Tuple[str, str, str]]:
    """(url, label, origin) from config/sources.json, scripts/feeds.json, feeds_youtube (playlist→feed URL)."""
    out: List[Tuple[str, str, str]] = []
    seen: set = set()

    def add(url: str, label: str, origin: str) -> None:
        u = (url or "").strip()
        if not u or not u.startswith("http"):
            return
        k = normalize_url_key(u)
        if k in seen:
            return
        seen.add(k)
        out.append((u, label or u, origin))

    if SOURCES_JSON.is_file():
        try:
            data = json.loads(SOURCES_JSON.read_text(encoding="utf-8", errors="replace"))
            for row in data.get("sources") or []:
                if not isinstance(row, dict):
                    continue
                add(
                    str(row.get("url") or ""),
                    str(row.get("name") or row.get("id") or ""),
                    "config/sources.json",
                )
        except (OSError, json.JSONDecodeError):
            pass

    feeds = load_feeds(FEEDS_JSON)
    for row in feeds:
        if not isinstance(row, dict):
            continue
        add(
            str(row.get("url") or ""),
            str(row.get("source") or row.get("id") or ""),
            "scripts/feeds.json",
        )

    if FEEDS_YOUTUBE_JSON.is_file():
        try:
            yt = json.loads(FEEDS_YOUTUBE_JSON.read_text(encoding="utf-8", errors="replace"))
            if isinstance(yt, list):
                for row in yt:
                    if not isinstance(row, dict):
                        continue
                    pid = str(row.get("playlistId") or "").strip()
                    if not pid:
                        continue
                    u = f"https://www.youtube.com/feeds/videos.xml?playlist_id={pid}"
                    ch = str(row.get("channel") or "YouTube")
                    add(u, ch, "scripts/feeds_youtube.json")
        except (OSError, json.JSONDecodeError):
            pass

    return out


def config_urls_not_in_runtime(
    runtime_by_url: Mapping[str, Any],
    config_rows: Sequence[Tuple[str, str, str]],
) -> List[Tuple[str, str, str]]:
    """Config URLs whose normalized key never appeared in feed_health aggregation keys."""
    runtime_keys = {normalize_url_key(u) for u in runtime_by_url.keys()}
    missing: List[Tuple[str, str, str]] = []
    seen_k: set = set()
    for url, label, origin in config_rows:
        k = normalize_url_key(url)
        if k in seen_k:
            continue
        seen_k.add(k)
        if k not in runtime_keys:
            missing.append((url, label, origin))
    return sorted(missing, key=lambda x: (x[2], x[1]))


def _md_cell(s: str, max_len: int = 80) -> str:
    t = (s or "").replace("|", "\\|").replace("\n", " ")
    if len(t) > max_len:
        return t[: max_len - 1] + "…"
    return t


def _runtime_snapshot_json(
    agg: Mapping[str, Dict[str, Any]],
    commit_shas: Sequence[str],
    pipeline_buckets: Optional[Dict[str, int]],
    runtime_error: Optional[str],
    bucket_error: Optional[str] = None,
) -> str:
    """Compact JSON for the mandatory RUNTIME DATA block (truncated)."""
    preview: Dict[str, Any] = {}
    for url, row in list(agg.items())[:8]:
        preview[str(url)[:96]] = dict(row) if isinstance(row, dict) else row
    payload = {
        "commits_in_window": len(commit_shas),
        "feed_count": len(agg),
        "pipeline_runs_24h": pipeline_buckets,
        "pipeline_bucket_error": bucket_error,
        "error": runtime_error,
        "agg_preview": preview,
    }
    try:
        blob = json.dumps(payload, ensure_ascii=False, indent=2)
    except (TypeError, ValueError):
        blob = json.dumps({"error": "runtime_snapshot_serialization_failed"}, indent=2)
    if len(blob) > 500:
        return blob[:499] + "…"
    return blob


def render_runtime_24h_section(
    agg: Mapping[str, Dict[str, Any]],
    commit_shas: Sequence[str],
    pipeline_buckets: Optional[Dict[str, int]],
    now: datetime,
    runtime_error: Optional[str] = None,
    bucket_error: Optional[str] = None,
) -> str:
    snap = _runtime_snapshot_json(agg, commit_shas, pipeline_buckets, runtime_error, bucket_error)
    lines: List[str] = [
        "## RUNTIME AKTIVITA ZA POSLEDNÍCH 24 H (ODVOZENO Z DOSTUPNÝCH DAT)",
        "",
        "### RUNTIME DATA (always)",
        "",
        "```json",
        snap,
        "```",
        "",
    ]
    if runtime_error:
        safe_err = (runtime_error or "").replace("`", "'")
        lines.extend(
            [
                f"> **RUNTIME AGGREGATION ERROR:** `{safe_err}`",
                "",
            ]
        )
    elif not agg:
        lines.extend(
            [
                "> **NO DATA** — V agregaci nejsou žádné feed URL z `feed_health.json` "
                f"(commity v okně: **{len(commit_shas)}**).",
                "",
            ]
        )
    lines.extend(
        [
        "> **Důležité:** Tato sekce **není** kopie konfigurace výše. Popisuje **agregované výsledky**",
        "> z `projects/data/feed_health.json` v čase (Git historie commitů, které tento soubor mění).",
        "> Nejedná se o přesný HTTP request log ani o úplný seznam všech feedů v každém běhu —",
        "> jeden commit = jeden snapshot health reportu po proběhnutím ingestu.",
        "",
        "### Metodika (24h okno)",
        "",
        f"- Okno: posledních **24 h** do `{now.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}` UTC.",
        "- Zdroj dat: **read-only** `git log` / `git show` na `projects/data/feed_health.json`.",
        "- U každého feed URL se počítá: `runs` (výskyty ve snapshotu), `success` (OK + články), `empty` (OK + 0 článků),",
        "  `failed` (jiný stav než OK), `total_articles` součet pole `accepted` přes úspěšné běhy.",
        "- Položky SKIPPED_* se do `runs` nepočítají (nešlo o HTTP ingest).",
        "",
        "### Běhy (odhad)",
        "",
        ],
    )
    lines.append(
        f"- Commity měnící `feed_health.json` v okně (**snapshoty health reportu**): **{len(commit_shas)}**."
    )
    if pipeline_buckets is not None:
        lines.extend(
            [
                f"- `{INGEST_WORKFLOW_FILE}` pipeline běhy (24 h, phase-status classifier):",
                f"  - **PIPELINE_SUCCESS**: **{pipeline_buckets.get('PIPELINE_SUCCESS', 0)}**",
                f"  - **INGEST_SUCCESS_RELEASE_BLOCKED**: **{pipeline_buckets.get('INGEST_SUCCESS_RELEASE_BLOCKED', 0)}** (YELLOW)",
                f"  - **INGEST_FAILED**: **{pipeline_buckets.get('INGEST_FAILED', 0)}**",
                f"  - **AGGREGATE_FAILED**: **{pipeline_buckets.get('AGGREGATE_FAILED', 0)}**",
                f"  - **RELEASE_FAILED**: **{pipeline_buckets.get('RELEASE_FAILED', 0)}**",
                f"  - **SKIPPED_DUPLICATE**: **{pipeline_buckets.get('SKIPPED_DUPLICATE', 0)}**",
                f"  - **RUN_CANCELLED**: **{pipeline_buckets.get('RUN_CANCELLED', 0)}**",
                f"  - **UNKNOWN_INCOMPLETE**: **{pipeline_buckets.get('UNKNOWN_INCOMPLETE', 0)}**",
            ]
        )
        blocked = int(pipeline_buckets.get("INGEST_SUCCESS_RELEASE_BLOCKED", 0))
        success_n = int(pipeline_buckets.get("PIPELINE_SUCCESS", 0))
        if blocked > 0 and success_n == 0:
            lines.append(
                "> **YELLOW:** V okně jsou pouze release-blocked běhy (ingest+aggregate OK, release guard) — prod se nemusí aktualizovat."
            )
    elif bucket_error:
        lines.append(
            f"- Pipeline bucket klasifikace selhala: `{bucket_error}` — použijte commity u `feed_health.json` jako proxy."
        )
    else:
        lines.append(
            f"- Počet pipeline běhů z phase-status classifier nelze ověřit (není k dispozici nebo selhalo). "
            f"Použijte řádek výše (commity u `feed_health.json`) jako konzervativní proxy."
        )
    lines.extend(["", "### Per-source statistika (feed_health / Git, 24h)", ""])

    rows = []
    for url, d in agg.items():
        rows.append(
            (
                float(d.get("total_articles") or 0),
                _md_cell(d.get("label") or "", 40),
                _md_cell(url, 72),
                int(d.get("runs") or 0),
                int(d.get("success") or 0),
                int(d.get("empty") or 0),
                int(d.get("failed") or 0),
                int(d.get("total_articles") or 0),
            )
        )
    rows.sort(key=lambda x: (-x[0], x[2]))

    lines.append(
        "| zdroj (label) | feed URL | runs | success | empty | failed | total_articles |"
    )
    lines.append("| --- | --- | ---: | ---: | ---: | ---: | ---: |")
    for _, lab, url, runs, succ, emp, fail, tot in rows:
        lines.append(f"| {lab} | {url} | {runs} | {succ} | {emp} | {fail} | {tot} |")

    top = sorted(rows, key=lambda x: (-x[0], x[2]))[:10]
    lines.extend(["", "### TOP 10 podle total_articles (stejné okno)", ""])
    lines.append("| # | zdroj (label) | feed URL | total_articles |")
    lines.append("| ---: | --- | --- | ---: |")
    for i, (_, lab, url, _r, _s, _e, _f, tot) in enumerate(top, 1):
        lines.append(f"| {i} | {lab} | {url} | {tot} |")

    empty_or_zero = [x for x in rows if x[7] == 0 and x[3] > 0]
    failed_all = [x for x in rows if x[3] > 0 and x[6] == x[3]]

    lines.extend(
        [
            "",
            "### EMPTY / FAILED (za 24h okno; ne „navždy mrtvé“)",
            "",
            "> Zde jde o **výsledek v tomto 24h okně** podle snapshotů `feed_health`. Feed může být jindy zdravý.",
            "",
        ]
    )
    if empty_or_zero:
        lines.append("**Nulové články (total_articles = 0, ale feed se v okně objevil):**")
        for _, lab, url, runs, succ, emp, fail, _ in sorted(empty_or_zero, key=lambda x: -x[3])[
            :40
        ]:
            lines.append(
                f"- `{lab}` — {url} — runs={runs}, empty={emp}, failed={fail}, success={succ}"
            )
        if len(empty_or_zero) > 40:
            lines.append(f"- … (+{len(empty_or_zero) - 40} dalších)")
    else:
        lines.append("- (žádný takový záznam v agregaci)")
    lines.append("")
    if failed_all:
        lines.append("**Všechny běhy ve window skončily jako failed (`failed == runs`):**")
        for _, lab, url, runs, succ, emp, fail, _ in sorted(failed_all, key=lambda x: -x[3])[:40]:
            lines.append(f"- `{lab}` — {url} — runs={runs}, failed={fail}, empty={emp}, success={succ}")
        if len(failed_all) > 40:
            lines.append(f"- … (+{len(failed_all) - 40} dalších)")
    else:
        lines.append("**failed == runs:** (žádný takový záznam)")
    # Compact JSON for audit / mail (truncated)
    try:
        blob = json.dumps(
            {u: dict(v) for u, v in agg.items()},
            ensure_ascii=False,
            indent=2,
        )
        if len(blob) > 12000:
            blob = blob[:12000] + "\n… (truncated)"
        lines.extend(["", "### Raw runtime agregace (JSON, může být zkráceno)", "", "```json", blob, "```", ""])
    except (TypeError, ValueError):
        pass

    lines.append("")
    return "\n".join(lines)


def render_config_not_seen_section(missing: Sequence[Tuple[str, str, str]]) -> str:
    lines: List[str] = [
        "### Zdroje z configu / feeds souborů — neobjevily se v `feed_health` za 24h",
        "",
        "> URL z `config/sources.json`, `scripts/feeds.json`, `scripts/feeds_youtube.json`, které **nemají**",
        "> v agregaci výše žádný odpovídající klíč feed URL (normalizovaný). Nemusí znamenat chybu —",
        "> scheduler mohl feed v tomto okně nevybrat, nebo se URL liší od klíče v `feed_health`.",
        "",
    ]
    if not missing:
        lines.append("- (všechny sledované URL se v okně v `feed_health` alespoň jednou objevily, nebo seznam je prázdný)")
    else:
        for url, label, origin in missing:
            lines.append(f"- `{label}` — `{url}` — *{origin}*")
    lines.append("")
    return "\n".join(lines)


def load_feeds(path: Path) -> List[Dict[str, Any]]:
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def load_articles(path: Path) -> List[Dict[str, Any]]:
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        arts = data.get("articles") if isinstance(data, dict) else None
        if isinstance(arts, list):
            return [x for x in arts if isinstance(x, dict)]
    except (OSError, json.JSONDecodeError):
        pass
    return []


def git_ls_files_candidates() -> List[str]:
    try:
        r = subprocess.run(
            ["git", "ls-files"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            check=False,
        )
        if r.returncode != 0:
            return []
        pat = re.compile(
            r"(^|/)(sources|feeds|ingest|rss|youtube).*\.json$|"
            r"(^|/)(sources|feeds|ingest|rss|youtube).*\.ya?ml$",
            re.I,
        )
        out = [ln.strip() for ln in r.stdout.splitlines() if ln.strip()]
        return sorted([f for f in out if pat.search(f)])
    except OSError:
        return []


def iter_json_strings(obj: Any, prefix: str = "") -> Iterable[Tuple[str, str]]:
    """Paths as dot-joined keys for scalars (jq-style-ish)."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{prefix}.{k}" if prefix else str(k)
            yield from iter_json_strings(v, p)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            p = f"{prefix}.{i}" if prefix else str(i)
            yield from iter_json_strings(v, p)
    elif isinstance(obj, (str, int, float, bool)) or obj is None:
        yield prefix, str(obj) if obj is not None else ""


def extract_rss_lines(candidates: Sequence[str]) -> List[str]:
    lines: List[str] = []
    url_re = re.compile(r"^https?://", re.I)
    rss_re = re.compile(r"rss|feed|xml|atom", re.I)
    for rel in candidates:
        path = REPO_ROOT / rel
        if not path.is_file():
            continue
        if rel.lower().endswith(".json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
            except (OSError, json.JSONDecodeError):
                continue
            for jp, val in iter_json_strings(data):
                if not url_re.match(val) or not rss_re.search(val):
                    continue
                lines.append(f"- {val} — {rel} ({jp})")
            continue
        try:
            txt = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for m in re.finditer(r'https?://[^"\'\s)]+', txt):
            val = m.group(0)
            if rss_re.search(val):
                lines.append(f"- {val} — {rel} (<yaml-grep>)")
    return sorted(set(lines))


def extract_youtube_lines(candidates: Sequence[str]) -> List[str]:
    lines: List[str] = []
    url_re = re.compile(r"^https?://", re.I)
    yt_re = re.compile(r"youtube\.com|youtu\.be", re.I)
    for rel in candidates:
        path = REPO_ROOT / rel
        if not path.is_file():
            continue
        if rel.lower().endswith(".json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
            except (OSError, json.JSONDecodeError):
                continue
            for jp, val in iter_json_strings(data):
                if not url_re.match(val) or not yt_re.search(val):
                    continue
                lines.append(f"- {val} — {rel} ({jp})")
            continue
        try:
            txt = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for m in re.finditer(r'https?://[^"\'\s)]+', txt):
            val = m.group(0)
            if yt_re.search(val):
                lines.append(f"- {val} — {rel} (<yaml-grep>)")
    return sorted(set(lines))


def section_heading_key(cat: str) -> Tuple[int, str]:
    c = cat.lower()
    try:
        idx = SECTION_ORDER.index(c)
    except ValueError:
        idx = 500
    label = SECTION_LABELS.get(c, cat)
    return idx, label


def render_sections_and_sources(
    feeds: Sequence[Mapping[str, Any]],
    workflow_texts: Sequence[Tuple[str, str]],
    stats: Mapping[str, Tuple[int, int]],
    cadence: str,
) -> str:
    grouped = group_sources_by_section(feeds)
    keys = list(grouped.keys())

    def sort_key(k: str) -> Tuple[int, str]:
        if k == UNMAPPED_SECTION:
            return (900, k)
        sk = section_heading_key(k)
        return (sk[0], sk[1])

    keys.sort(key=sort_key)
    lines: List[str] = [
        "## SECTIONS AND SOURCES",
        "",
    ]
    if not feeds:
        lines.extend(
            [
                "> **Poznámka:** `scripts/feeds.json` je prázdný nebo neobsahuje položky. Kanonický seznam aktivních feedů "
                "pro pipeline je obvykle v `projects/data/source_registry.json` (tento blok enumeruje jen `feeds.json`).",
                "",
            ]
        )
    for sec in keys:
        sk = section_heading_key(sec) if sec != UNMAPPED_SECTION else (900, UNMAPPED_SECTION)
        title = sk[1]
        lines.append(f"### {title}")
        rows = sorted(grouped[sec], key=lambda r: str(r.get("source") or r.get("id") or ""))
        for row in rows:
            name = str(row.get("source") or row.get("id") or "unknown")
            url = str(row.get("url") or "").strip() or "unknown"
            sid = str(row.get("id") or "").strip()
            f24, p24 = stats.get(sid, (0, 0))
            lines.append(f"- {name}")
            lines.append(f"  - url: {url}")
            lines.append(f"  - fetch cadence: {cadence}")
            lines.append(f"  - last 24h fetched: {f24}")
            lines.append(f"  - last 24h published: {p24}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def run_guards(
    markdown: str,
    feeds: Sequence[Mapping[str, Any]],
    stats: Mapping[str, Tuple[int, int]],
) -> None:
    """Hard-fail on format / metric / coverage."""
    if "## KONFIGURAČNÍ ZDROJE" not in markdown:
        sys.exit("GUARD_FAIL: missing KONFIGURAČNÍ ZDROJE heading")
    if "### RUNTIME DATA (always)" not in markdown:
        sys.exit("GUARD_FAIL: missing RUNTIME DATA (always) block")
    if "## RUNTIME AKTIVITA ZA POSLEDNÍCH 24 H" not in markdown:
        sys.exit("GUARD_FAIL: missing RUNTIME AKTIVITA heading")
    if "## SECTIONS AND SOURCES" not in markdown:
        sys.exit("GUARD_FAIL: missing SECTIONS AND SOURCES heading")
    if markdown.count("  - url:") != len(feeds):
        sys.exit("GUARD_FAIL: url line count != feeds count")
    for row in feeds:
        sid = str(row.get("id") or "").strip()
        name = str(row.get("source") or "")
        url = str(row.get("url") or "").strip()
        if sid and name and f"- {name}" not in markdown:
            sys.exit(f"GUARD_FAIL: source not in output: {sid} {name}")
        if url and url not in markdown:
            sys.exit(f"GUARD_FAIL: feed url not in output: {sid}")
    for sid, (f24, p24) in stats.items():
        if f24 < p24:
            sys.exit(f"GUARD_FAIL: fetched < published for {sid}: {f24} < {p24}")


def build_report() -> str:
    candidates = git_ls_files_candidates()
    feeds = load_feeds(FEEDS_JSON)
    workflow_texts = load_workflow_texts(WORKFLOWS_DIR)
    cadence = resolve_fetch_cadence({}, workflow_texts)
    articles = load_articles(ARTICLES_JSON)
    now = datetime.now(timezone.utc)
    stats = compute_source_stats_last_24h(feeds, articles, now=now)

    runtime_error: Optional[str] = None
    try:
        agg, fh_commits = aggregate_feed_health_runtime_24h(since_hours=24)
    except Exception as exc:  # noqa: BLE001 — report must still render; never silent fail
        agg, fh_commits = {}, []
        runtime_error = f"{type(exc).__name__}: {exc}"
    gh_buckets, bucket_err = classify_pipeline_runs_24h_buckets()
    config_rows = load_config_source_urls()
    missing_urls = config_urls_not_in_runtime(agg, config_rows)

    repo = os.environ.get("GITHUB_REPOSITORY", "unknown/repo")
    sha = env_or_git_sha()
    run_id = os.environ.get("GITHUB_RUN_ID", "unknown")
    utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    lines: List[str] = [
        "# infoUzel.cz – Ultra Audit (Wiki přehled)",
        "",
        "## META",
        f"- Repo: {repo}",
        f"- SHA: {sha}",
        f"- Run: {run_id}",
        f"- UTC: {utc}",
        "",
        "## KONFIGURAČNÍ ZDROJE (NEZNAMENÁ RUNTIME AKTIVITU)",
        "",
        "> **Tato část** popisuje **konfiguraci v repozitáři** (RSS/YouTube URL, soubory). ",
        "> **Neříká**, kolikrát byl feed v posledních 24 h skutečně stažen v pipeline — to je až sekce **RUNTIME** níže.",
        "",
        "### Explicitní konfigurační soubory (reference)",
        "",
    ]
    if SOURCES_JSON.is_file():
        lines.append(f"- `{SOURCES_JSON.relative_to(REPO_ROOT).as_posix()}`")
    else:
        lines.append("- `config/sources.json` — (soubor v aktuálním checkoutu nenalezen)")
    if FEEDS_JSON.is_file():
        lines.append(f"- `{FEEDS_JSON.relative_to(REPO_ROOT).as_posix()}`")
    if FEEDS_YOUTUBE_JSON.is_file():
        lines.append(f"- `{FEEDS_YOUTUBE_JSON.relative_to(REPO_ROOT).as_posix()}`")
    lines.extend(["", "### Další kandidátní soubory (`git ls-files`, RSS/YouTube pattern)", ""])
    if not candidates:
        lines.append("- NENÍ IMPLEMENTOVÁNO (nenalezen žádný kandidátní config soubor pro zdroje)")
    else:
        for f in candidates:
            lines.append(f"- `{f}`")
    lines.extend(["", "### RSS ZDROJE ČLÁNKŮ (výtažky z configů výše)", ""])
    if not candidates:
        lines.append("- NENÍ IMPLEMENTOVÁNO")
    else:
        rss = extract_rss_lines(candidates)
        if rss:
            lines.extend(rss)
        else:
            lines.append(
                "- NENÍ IMPLEMENTOVÁNO (nenalezeny RSS URL v kandidátních config souborech)"
            )
    lines.extend(["", "### YOUTUBE ZDROJE (výtažky z configů výše)", ""])
    if not candidates:
        lines.append("- NENÍ IMPLEMENTOVÁNO")
    else:
        yt = extract_youtube_lines(candidates)
        if yt:
            lines.extend(yt)
        else:
            lines.append(
                "- NENÍ IMPLEMENTOVÁNO (nenalezeny YouTube URL v kandidátních config souborech)"
            )
    lines.extend(
        [
            "",
            render_sections_and_sources(feeds, workflow_texts, stats, cadence).strip(),
            "",
            render_runtime_24h_section(
                agg, fh_commits, gh_buckets, now, runtime_error=runtime_error, bucket_error=bucket_err
            ).strip(),
            "",
            render_config_not_seen_section(missing_urls).strip(),
            "",
            "## KRÁTKÝ ZÁVĚR",
            "",
            "- **Konfigurace** nahoře = co je v repu; **runtime** = co vyplynulo z agregace `feed_health.json` v Git historii za 24 h.",
            "- **Není to** přesný HTTP log; je to **nejlepší read-only odhad** z dostupných health snapshotů.",
            "- **Neviděné URL** v `feed_health` nemusí znamenat výpadek — scheduler může feed v okně nevybrat, nebo se URL liší od klíče ve snapshotu.",
            "",
            "## DETAILNÍ FORENSIC AUDIT",
            "- Viz příloha `ultra_audit_report.txt`",
            "",
        ]
    )
    body = "\n".join(lines)
    dbg = (os.environ.get("ULTRA_AUDIT_WIKI_DEBUG") or "").strip().lower()
    if dbg in ("1", "true", "yes", "y"):
        runtime_data = {
            "commits_in_window": len(fh_commits),
            "feed_count": len(agg),
            "pipeline_runs_24h": gh_buckets,
            "pipeline_bucket_error": bucket_err,
            "error": runtime_error,
        }
        print("RUNTIME DATA:", json.dumps(runtime_data, ensure_ascii=False), file=sys.stderr)
    run_guards(body, feeds, stats)
    return body


def selftest() -> int:
    src = [
        {"id": "a", "source": "S1", "category": "zpravy", "url": "https://x.example/rss"},
        {"id": "b", "source": "S2", "category": "sport", "url": "https://y.example/rss"},
    ]
    grouped = group_sources_by_section(src)
    assert "zpravy" in grouped and len(grouped["zpravy"]) == 1

    wfs = [("update-articles.yml", "on:\n  schedule:\n    - cron: \"*/11 * * * *\"\n")]
    c = resolve_fetch_cadence({}, wfs)
    assert "11" in c and "minute" in c.lower()

    now = datetime(2026, 4, 3, 12, 0, 0, tzinfo=timezone.utc)
    arts = [
        {
            "feedId": "a",
            "url": "https://site.test/a1",
            "publishedAt": "2026-04-03T11:00:00Z",
        },
        {
            "feedId": "a",
            "url": "https://site.test/a2",
            "publishedAt": "2026-04-01T11:00:00Z",
            "iuReleaseAt": "2026-04-03T11:30:00Z",
        },
    ]
    st = compute_source_stats_last_24h(src, arts, now=now)
    assert st["a"][0] >= st["a"][1]

    md = (
        "## KONFIGURAČNÍ ZDROJE (selftest stub)\n\n"
        "## RUNTIME AKTIVITA ZA POSLEDNÍCH 24 H (selftest stub)\n\n"
        "### RUNTIME DATA (always)\n\n```json\n{}\n```\n\n"
        + render_sections_and_sources(src, wfs, st, c)
    )
    run_guards(md, src, st)
    print("SELFTEST_OK")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        return selftest()

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    out = REPORTS_DIR / "ultra_audit_wiki.md"
    body = build_report()
    out.write_text(body, encoding="utf-8")
    if "### RUNTIME DATA (always)" not in body:
        sys.exit("INTERNAL_FAIL: RUNTIME DATA block missing after build_report")
    print(f"WROTE={out}")
    return 0


# CamelCase aliases (spec / audit grep)
groupSourcesBySection = group_sources_by_section
computeSourceStatsLast24h = compute_source_stats_last_24h
resolveFetchCadence = resolve_fetch_cadence

if __name__ == "__main__":
    raise SystemExit(main())
