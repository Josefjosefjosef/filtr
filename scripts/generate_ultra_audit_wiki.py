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
ARTICLES_JSON = REPO_ROOT / "projects" / "data" / "articles.json"
WORKFLOWS_DIR = REPO_ROOT / ".github" / "workflows"


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
        "## ZDROJE – KONFIGURAČNÍ SOUBORY (nalezené v repu)",
    ]
    if not candidates:
        lines.append("- NENÍ IMPLEMENTOVÁNO (nenalezen žádný kandidátní config soubor pro zdroje)")
    else:
        for f in candidates:
            lines.append(f"- `{f}`")
    lines.extend(["", "## RSS ZDROJE ČLÁNKŮ (jmenovitě)"])
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
    lines.extend(["", "## YOUTUBE ZDROJE (jmenovitě)"])
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
            "## DETAILNÍ FORENSIC AUDIT",
            "- Viz příloha `ultra_audit_report.txt`",
            "",
        ]
    )
    body = "\n".join(lines)
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

    md = render_sections_and_sources(src, wfs, st, c)
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
    print(f"WROTE={out}")
    return 0


# CamelCase aliases (spec / audit grep)
groupSourcesBySection = group_sources_by_section
computeSourceStatsLast24h = compute_source_stats_last_24h
resolveFetchCadence = resolve_fetch_cadence

if __name__ == "__main__":
    raise SystemExit(main())
