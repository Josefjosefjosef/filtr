#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
infoUzel.cz – Nightly Health Report (ALL-IN-ONE)
Read-only: structure, duplicates, broken, performance, layout, guards.
Input: reports/check_site.json from scripts/check_site.js
Config: config/health_report.json
"""

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None  # type: ignore

ROOT = Path(__file__).resolve().parent.parent
REPORTS_DIR = ROOT / "reports"
CHECK_SITE_JSON = REPORTS_DIR / "check_site.json"
DATA_DIR = ROOT / "projects" / "data"
ASSETS_DIR = ROOT / "assets"
CONFIG_PATH = ROOT / "config" / "health_report.json"
MAX_URLS_PER_CHECK = 25
NETWORK_TIMEOUT = 10


def load_config() -> Dict[str, Any]:
    """Load config/health_report.json. Returns defaults if missing."""
    defaults: Dict[str, Any] = {
        "version": 1,
        "timeouts": {"http_sec": 10, "stream_sec": 5},
        "limits": {"css_kb_warn": 400, "js_kb_warn": 600, "repo_mb_warn": 50, "feed_age_hours_warn": 24},
        "sampling": {"radio_streams_sample": 8, "affiliate_links_sample": 20},
        "critical_workflows_regex": ["^pages\\.yml$", "^update-articles\\.yml$", "^update-weather\\.yml$", "^update-namedays\\.yml$"],
        "report_sections": ["uptime", "feeds", "workflows", "pages_assets", "broken_links", "radios", "affiliates", "performance", "repo_size", "duplicates"],
    }
    if not CONFIG_PATH.exists():
        return defaults
    try:
        cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        return {**defaults, **cfg}
    except (json.JSONDecodeError, OSError):
        return defaults


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get_head_sha() -> Tuple[Optional[str], Optional[str]]:
    """Return (full_sha, short_sha) from env (CI) or git. (None, None) if unavailable."""
    full = os.environ.get("HEAD_SHA")
    short = os.environ.get("HEAD_SHA_SHORT")
    if full and short:
        return (full, short)
    try:
        full = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
            cwd=ROOT,
        ).stdout.strip() or None
        short = (
            subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"],
                capture_output=True,
                text=True,
                timeout=5,
                cwd=ROOT,
            ).stdout.strip()
            or None
        )
        return (full, short)
    except (subprocess.SubprocessError, FileNotFoundError):
        return (None, None)


def date_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


# --- Auto-discovery ---
def discover_feeds() -> Dict[str, Any]:
    """Discover data/*.json feeds: valid JSON, size > 0, timestamp if exists."""
    out: Dict[str, Any] = {"count": 0, "files": [], "errors": []}
    if not DATA_DIR.exists():
        return out
    for p in sorted(DATA_DIR.rglob("*.json")):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            sz = p.stat().st_size
            if sz <= 0:
                continue
            rel = str(p.relative_to(ROOT))
            out["files"].append({"path": rel, "size": sz, "timestamp": data.get("generatedAt") if isinstance(data, dict) else None})
            out["count"] += 1
        except (json.JSONDecodeError, OSError) as e:
            out["errors"].append(f"{p.name}: {str(e)[:50]}")
    return out


def discover_workflows() -> Dict[str, Any]:
    """Discover .github/workflows/*.yml."""
    out: Dict[str, Any] = {"count": 0, "files": []}
    wf_dir = ROOT / ".github" / "workflows"
    if not wf_dir.exists():
        return out
    for p in sorted(wf_dir.glob("*.yml")):
        out["files"].append(p.name)
        out["count"] += 1
    return out


def load_fetch_monitor() -> Dict[str, Any]:
    """Load projects/data/fetch_monitor.json if present."""
    path = DATA_DIR / "fetch_monitor.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def discover_links() -> Dict[str, Any]:
    """Load links from sources.json, pipeline_config.json, fallback projects/index.html."""
    out: Dict[str, Any] = {"count": 0, "sources": []}
    sources_path = ROOT / "config" / "sources.json"
    if sources_path.exists():
        try:
            data = json.loads(sources_path.read_text(encoding="utf-8"))
            srcs = data.get("sources", []) if isinstance(data, dict) else []
            for s in srcs:
                if isinstance(s, dict) and s.get("url"):
                    out["sources"].append(s.get("url", "")[:80])
                    out["count"] += 1
        except (json.JSONDecodeError, OSError):
            pass
    return out


def discover_radios() -> Dict[str, Any]:
    """Discover radio entries from radio_requests.json or app.js RADIO_ITEMS."""
    out: Dict[str, Any] = {"count": 0, "streams": []}
    radio_path = DATA_DIR / "radio_requests.json"
    if radio_path.exists():
        try:
            data = json.loads(radio_path.read_text(encoding="utf-8"))
            radios = data.get("radios", []) if isinstance(data, dict) else []
            for r in radios:
                if isinstance(r, dict) and (r.get("url") or r.get("emailTo")):
                    out["streams"].append(r.get("label", r.get("id", "?")))
                    out["count"] += 1
        except (json.JSONDecodeError, OSError):
            pass
    return out


def load_check_site() -> Optional[Dict[str, Any]]:
    """Load check_site.json. Returns None if missing or invalid."""
    if not CHECK_SITE_JSON.exists():
        return None
    try:
        return json.loads(CHECK_SITE_JSON.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


# --- 1. Project structure ---
def collect_structure() -> Dict[str, Any]:
    out: Dict[str, Any] = {"folders": [], "files": [], "sizes": {}, "total_size_kb": 0}
    total = 0
    skip_dirs = {".git", "node_modules", "__pycache__", ".cursor"}
    for root, dirs, files in os.walk(ROOT):
        rel = Path(root).relative_to(ROOT)
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        if any(p in str(rel) for p in (".git", "node_modules")):
            continue
        for d in dirs:
            out["folders"].append(str(rel / d) if str(rel) != "." else d)
        for f in files:
            fp = Path(root) / f
            try:
                sz = fp.stat().st_size
            except OSError:
                sz = 0
            total += sz
            rel_path = str(rel / f) if str(rel) != "." else f
            out["files"].append(rel_path)
            out["sizes"][rel_path] = sz
    out["total_size_kb"] = round(total / 1024)
    return out


def list_top_level(max_depth: int = 3) -> List[str]:
    """List folders/files with depth limit for report."""
    lines: List[str] = []
    seen: Set[str] = set()

    def collect(p: Path, depth: int, prefix: str) -> None:
        if depth > max_depth:
            return
        try:
            items = sorted(p.iterdir())
        except OSError:
            return
        for item in items:
            if item.name in (".git", "node_modules", "__pycache__", ".cursor"):
                continue
            rel = str(item.relative_to(ROOT))
            if rel in seen:
                continue
            seen.add(rel)
            if item.is_dir():
                lines.append(f"{prefix}{item.name}/")
                collect(item, depth + 1, prefix + "  ")
            else:
                try:
                    sz = item.stat().st_size
                    lines.append(f"{prefix}{item.name} ({sz} B)")
                except OSError:
                    lines.append(f"{prefix}{item.name}")
    collect(ROOT, 0, "")
    return lines[:200]


def diff_from_yesterday() -> Dict[str, Any]:
    out: Dict[str, Any] = {"new": [], "deleted": [], "changed": []}
    yesterday_date = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
    yesterday = REPORTS_DIR / f"health-{yesterday_date}.json"
    if not yesterday.exists():
        return out
    try:
        prev = json.loads(yesterday.read_text(encoding="utf-8"))
        prev_files = set(prev.get("structure", {}).get("files", []))
    except (json.JSONDecodeError, OSError, KeyError):
        return out
    curr = collect_structure()
    curr_files = set(curr["files"])
    out["new"] = sorted(curr_files - prev_files)[:50]
    out["deleted"] = sorted(prev_files - curr_files)[:50]
    prev_sizes = prev.get("structure", {}).get("sizes", {})
    for f in curr_files & prev_files:
        if curr["sizes"].get(f) != prev_sizes.get(f):
            out["changed"].append(f)
    out["changed"] = out["changed"][:50]
    return out


# --- 2. Duplicates ---
def find_css_token_frequency_signals() -> List[Tuple[str, int]]:
    """
    Regex over app.css: counts repeated tokens/idents (e.g. .mindMenu, rgba, display).
    NOT duplicate CSS rule blocks. Top 50 by frequency; len() is often 50 (cap).
    """
    dupes: List[Tuple[str, int]] = []
    css_path = ROOT / "assets" / "app.css"
    if not css_path.exists():
        return dupes
    text = css_path.read_text(encoding="utf-8")
    selectors = re.findall(r"([.#][\w-]+|[a-z][\w-]*)\s*[,{]?", text)
    counts: Dict[str, List[int]] = defaultdict(list)
    for i, sel in enumerate(selectors):
        counts[sel].append(i)
    for sel, positions in counts.items():
        if len(positions) > 1 and len(sel) > 2:
            dupes.append((sel, len(positions)))
    return sorted(dupes, key=lambda x: -x[1])[:50]


def find_duplicate_css_selectors() -> List[Tuple[str, int]]:
    """Backward-compatible alias for find_css_token_frequency_signals()."""
    return find_css_token_frequency_signals()


def find_duplicate_js_functions() -> List[Tuple[str, int]]:
    dupes: List[Tuple[str, int]] = []
    js_path = ROOT / "assets" / "app.js"
    if not js_path.exists():
        return dupes
    text = js_path.read_text(encoding="utf-8")
    funcs = re.findall(r"function\s+(\w+)\s*\(", text)
    counts: Dict[str, int] = defaultdict(int)
    for f in funcs:
        counts[f] += 1
    for f, c in counts.items():
        if c > 1:
            dupes.append((f, c))
    return sorted(dupes, key=lambda x: -x[1])[:30]


def find_duplicate_articles() -> List[Tuple[str, int]]:
    dupes: List[Tuple[str, int]] = []
    arts = DATA_DIR / "articles.json"
    if not arts.exists():
        return dupes
    try:
        data = json.loads(arts.read_text(encoding="utf-8"))
        urls = [a.get("url", "") for a in data.get("articles", []) if a.get("url")]
    except (json.JSONDecodeError, OSError, KeyError):
        return dupes
    counts: Dict[str, int] = defaultdict(int)
    for u in urls:
        if u:
            counts[u] += 1
    for u, c in counts.items():
        if c > 1:
            dupes.append((u[:80], c))
    return dupes[:20]


def find_duplicate_youtube_ids() -> List[Tuple[str, int]]:
    dupes: List[Tuple[str, int]] = []
    vids = DATA_DIR / "videos.json"
    if not vids.exists():
        return dupes
    try:
        data = json.loads(vids.read_text(encoding="utf-8"))
        ids: List[str] = []
        for v in data.get("videos", []) or []:
            if v.get("videoId"):
                ids.append(v["videoId"])
    except (json.JSONDecodeError, OSError, KeyError):
        return dupes
    counts: Dict[str, int] = defaultdict(int)
    for i in ids:
        counts[i] += 1
    for i, c in counts.items():
        if c > 1:
            dupes.append((i, c))
    return dupes[:20]


# Domains that often return 403 to bots; do not count as broken, report as blocked.
BLOCKED_403_DOMAINS = ("irozhlas.cz",)


def _is_blocked_403_domain(url: str) -> bool:
    try:
        from urllib.parse import urlparse
        p = urlparse(url)
        host = (p.hostname or "").lower().replace("www.", "")
        return host in BLOCKED_403_DOMAINS
    except Exception:
        return False


def _is_403_blocked(url: str, code: int) -> bool:
    """True if this HTTP status should be classified as blocked (not broken). Used by check_404_links and self-test."""
    return code == 403 and _is_blocked_403_domain(url)


# Deterministic self-test for 403 classification (only when IU_HEALTH_SELFTEST=1)
if os.environ.get("IU_HEALTH_SELFTEST") == "1":
    url = "https://www.irozhlas.cz/test"
    e = urllib.error.HTTPError(url, 403, "Forbidden", hdrs=None, fp=None)
    broken = 0
    blocked403 = 1 if _is_403_blocked(url, e.code) else 0
    if blocked403 == 0:
        broken = 1
    assert blocked403 == 1 and broken == 0, f"blocked403={blocked403} broken={broken}"
    print("SELFTEST_OK blocked403=1 broken=0")
    sys.exit(0)


# --- 3. Broken ---
def check_404_links() -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Returns (broken, blocked_403). 403 from BLOCKED_403_DOMAINS (e.g. irozhlas.cz) count as blocked, not broken."""
    broken: List[Dict[str, Any]] = []
    blocked: List[Dict[str, Any]] = []
    arts = DATA_DIR / "articles.json"
    if not arts.exists():
        return (broken, blocked)
    try:
        data = json.loads(arts.read_text(encoding="utf-8"))
        urls = [a.get("url") for a in data.get("articles", [])[:MAX_URLS_PER_CHECK] if a.get("url")]
    except (json.JSONDecodeError, OSError, KeyError):
        return (broken, blocked)
    try:
        import urllib.request
        for url in urls[:10]:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "infoUzel-health/1.0"})
                with urllib.request.urlopen(req, timeout=NETWORK_TIMEOUT) as r:
                    if r.status >= 400:
                        if _is_403_blocked(url, r.status):
                            blocked.append({"url": url, "status": 403, "reason": "http_403_blocked", "where": "articles.json"})
                        else:
                            broken.append({"url": url, "status": r.status, "where": "articles.json"})
            except urllib.error.HTTPError as e:
                if _is_403_blocked(url, e.code):
                    blocked.append({"url": url, "status": 403, "reason": "http_403_blocked", "where": "articles.json"})
                else:
                    broken.append({"url": url, "status": getattr(e, "code", None), "error": str(e)[:80], "where": "articles.json"})
            except Exception as e:
                broken.append({"url": url, "error": str(e)[:80], "where": "articles.json"})
    except ImportError:
        pass
    return (broken[:10], blocked)


def check_json_errors() -> List[str]:
    errors: List[str] = []
    for name in ["articles.json", "videos.json", "weather.json", "namedays.json", "meta.json"]:
        p = DATA_DIR / name
        if not p.exists():
            continue
        try:
            json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            errors.append(f"{name}: {e}")
    return errors


# --- 4. Performance (from check_site.json) ---
def get_performance(check: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    out: Dict[str, Any] = {"cls": None, "lcpMs": None, "cssKb": None, "jsKb": None, "jsErrors": [], "error": None}
    css_path = ROOT / "assets" / "app.css"
    js_path = ROOT / "assets" / "app.js"
    if css_path.exists():
        out["cssKb"] = round(css_path.stat().st_size / 1024)
    if js_path.exists():
        out["jsKb"] = round(js_path.stat().st_size / 1024)
    if check:
        out["cls"] = check.get("cls")
        out["lcpMs"] = check.get("lcpMs")
        out["jsErrors"] = check.get("jsErrors", [])
        out["error"] = check.get("error")
        b = check.get("bundle", {})
        if b.get("cssKb") is not None:
            out["cssKb"] = b["cssKb"]
        if b.get("jsKb") is not None:
            out["jsKb"] = b["jsKb"]
    return out


# --- 5. Layout (from check_site.json) ---
def get_layout(check: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "topbarHeight": None,
        "hasLeftRail": False,
        "hasMindMenu": False,
        "hasTopbarGrid": False,
        "hasOverflowX": False,
        "topbarHasGradient": False,
        "topbarBg": None,
    }
    if check:
        layout = check.get("layout", {})
        out.update(layout)
    return out


# --- 6. Critical guards ---
def check_guards(check: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    out: Dict[str, Any] = {"topbar_color": "ok", "topbar_no_gradient": "ok"}
    layout = (check or {}).get("layout", {})
    topbar_bg = layout.get("topbarBg") or ""
    if isinstance(topbar_bg, str):
        topbar_bg_lower = topbar_bg.lower().strip()
        _bg = topbar_bg_lower.replace(" ", "")
        if (
            "#0b1f33" in topbar_bg_lower
            or "rgb(11,31,51)" in _bg
            or "rgb(236,239,243)" in _bg
            or "rgb(236, 239, 243)" in topbar_bg_lower
        ):
            out["topbar_color"] = "ok"
        elif topbar_bg and "0b1f33" not in _bg and "236" not in topbar_bg_lower:
            out["topbar_color"] = "fail"
    # Gradient allowed: do not set topbar_no_gradient to "fail"
    css = ROOT / "assets" / "app.css"
    if css.exists() and out.get("topbar_color") != "ok":
        text = css.read_text(encoding="utf-8")
        if "#0B1F33" not in text and "#0b1f33" not in text:
            out["topbar_color"] = "fail"
    return out


# --- 7. Report assembly ---
def build_report(config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    if config is None:
        config = load_config()
    check = load_check_site()
    structure = collect_structure()
    diff = diff_from_yesterday()
    dup_css = find_css_token_frequency_signals()
    dup_js = find_duplicate_js_functions()
    try:
        from css_duplicate_audit import audit_css_file

        css_real_dup = audit_css_file(ROOT / "assets" / "app.css")
    except Exception as ex:
        css_real_dup = {
            "error": str(ex),
            "duplicate_selector_groups": 0,
            "duplicate_rule_occurrences_in_groups": 0,
            "total_qualified_rules_scanned": 0,
            "groups_top": [],
            "classification_counts": {},
            "debt_verdict_counts": {},
            "debt_occurrence_counts": {},
            "dead_override_candidate_policy": (
                "not_emitted: reserved; conservative specificity/cascade analysis not implemented."
            ),
        }
    dup_arts = find_duplicate_articles()
    dup_yt = find_duplicate_youtube_ids()
    broken, blocked_403 = check_404_links()
    json_errs = check_json_errors()
    feeds = discover_feeds()
    fetch_monitor = load_fetch_monitor()
    workflows = discover_workflows()
    links = discover_links()
    radios = discover_radios()
    perf = get_performance(check)
    layout = get_layout(check)
    guards = check_guards(check)

    critical = 0
    warnings = 0
    ok_count = 0

    if json_errs:
        critical += len(json_errs)
    else:
        ok_count += 1
    if guards.get("topbar_color") == "fail":
        critical += 1
    elif guards.get("topbar_color") == "ok":
        ok_count += 1
    if guards.get("topbar_no_gradient") == "fail":
        critical += 1
    elif guards.get("topbar_no_gradient") == "ok":
        ok_count += 1

    cls = perf.get("cls")
    if cls is not None:
        if cls > 0.1:
            warnings += 1
        else:
            ok_count += 1
    css_kb = perf.get("cssKb") or 0
    if css_kb > 400:
        warnings += 1
    else:
        ok_count += 1
    js_kb = perf.get("jsKb") or 0
    if js_kb > 500:
        warnings += 1
    else:
        ok_count += 1
    if broken:
        warnings += min(len(broken), 5)
    aggregator_alerts = 0
    fm = fetch_monitor or {}
    blocked403_by_host = fm.get("blocked403ByHost") or {}
    robots_by_host = fm.get("robotsDisallowByHost") or {}
    total_by_host = fm.get("totalByHost") or {}
    timeout_by_host = fm.get("timeoutByHost") or {}
    domain_cap_by_host = fm.get("domainCapByHost") or {}
    for host, count in blocked403_by_host.items():
        if count >= 5:
            aggregator_alerts += 1
    for host, total in total_by_host.items():
        if total >= 20:
            disallow = robots_by_host.get(host) or 0
            if total > 0 and (disallow / total) > 0.10:
                aggregator_alerts += 1
    for host, count in timeout_by_host.items():
        if count >= 10:
            aggregator_alerts += 1
    for host, count in domain_cap_by_host.items():
        if count >= 5:
            aggregator_alerts += 1
    warnings += aggregator_alerts
    ok_count += max(0, 130 - critical - warnings)

    dv_counts = (css_real_dup.get("debt_verdict_counts") or {}) if isinstance(css_real_dup, dict) else {}
    do_counts = (css_real_dup.get("debt_occurrence_counts") or {}) if isinstance(css_real_dup, dict) else {}
    report: Dict[str, Any] = {
        "date": date_str(),
        "timestamp": now_iso(),
        "summary": {
            "critical": critical,
            "warnings": warnings,
            "ok": ok_count,
            "cls": cls,
            "lcpMs": perf.get("lcpMs"),
            "cssKb": css_kb,
            "jsKb": js_kb,
            "brokenLinks": len(broken),
            "blocked403": len(blocked_403),
            "duplicateSelectors": len(dup_css),
            "cssTokenFrequencyTypesTop50Count": len(dup_css),
            "realCssDuplicateSelectorGroups": css_real_dup.get("duplicate_selector_groups", 0),
            "realCssDuplicateRuleOccurrencesInGroups": css_real_dup.get(
                "duplicate_rule_occurrences_in_groups", 0
            ),
            "realCssDuplicateGroups": css_real_dup.get("duplicate_selector_groups", 0),
            "realCssDuplicateOccurrences": css_real_dup.get("duplicate_rule_occurrences_in_groups", 0),
            "allowedDuplicateGroups": dv_counts.get("intentional_non_debt", 0),
            "allowedDuplicateOccurrences": do_counts.get("intentional_non_debt", 0),
            "realDebtDuplicateGroups": dv_counts.get("true_debt", 0),
            "realDebtDuplicateOccurrences": do_counts.get("true_debt", 0),
            "riskDuplicateGroups": dv_counts.get("risk_now", 0),
            "riskDuplicateOccurrences": do_counts.get("risk_now", 0),
            "unresolvedDuplicateGroups": dv_counts.get("unresolved_needs_review", 0),
            "unresolvedDuplicateOccurrences": do_counts.get("unresolved_needs_review", 0),
            "debtVerdictCounts": dv_counts,
            "debtOccurrenceCounts": do_counts,
            "offlineRadios": 0,
        },
        "structure": structure,
        "structure_lines": list_top_level(),
        "diff": diff,
        "duplicates": {
            "cssTokenFrequencySignals": dup_css[:20],
            "cssSelectors": dup_css[:20],
            "realCssDuplicateSelectorAudit": css_real_dup,
            "jsFunctions": dup_js[:15],
            "articles": dup_arts[:10],
            "youtubeIds": dup_yt[:10],
        },
        "broken": {
            "links404": broken,
            "blocked403": blocked_403,
            "jsonErrors": json_errs,
        },
        "performance": perf,
        "layout": layout,
        "guards": guards,
        "discovery": {"feeds": feeds["count"], "workflows": workflows["count"], "links": links["count"], "radios": radios["count"]},
        "fetch_monitor": fetch_monitor,
    }
    return report


def _format_report_metadata(report: Dict[str, Any]) -> str:
    """Build proof header: Repo, Branch, Commit SHA, Workflow, Run ID, Run number, Run URL, Generated at UTC/Prague."""
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    workflow = os.environ.get("GITHUB_WORKFLOW", "")
    run_id = os.environ.get("GITHUB_RUN_ID", "")
    run_number = os.environ.get("GITHUB_RUN_NUMBER", "")
    head_full, head_short = get_head_sha()
    sha_str = (f"{head_full} ({head_short})" if head_full and head_short else (head_full or "N/A"))
    lines = [
        "Repo: " + (repo or "N/A"),
        "Branch: main",
        "Commit SHA: " + sha_str,
        "Workflow: " + (workflow or "N/A"),
        "Run ID: " + (run_id or "N/A"),
        "Run number: " + (run_number or "N/A"),
    ]
    if repo and run_id:
        lines.append("Run URL: https://github.com/" + repo + "/actions/runs/" + run_id)
    else:
        lines.append("Run URL: N/A")
    ts_utc = report.get("timestamp") or now_iso()
    try:
        utc_dt = datetime.fromisoformat(ts_utc.replace("Z", "+00:00"))
        if ZoneInfo:
            prague_dt = utc_dt.astimezone(ZoneInfo("Europe/Prague"))
            prague_str = prague_dt.strftime("%Y-%m-%dT%H:%M:%S%z")
        else:
            prague_str = ts_utc
    except Exception:
        prague_str = ts_utc
    lines.append("Generated at UTC: " + ts_utc)
    lines.append("Generated at Europe/Prague: " + prague_str)
    return "\n".join(lines) + "\n\n"


def write_markdown(report: Dict[str, Any], path: Path) -> None:
    s = report["summary"]
    with open(path, "w", encoding="utf-8") as f:
        f.write("# INFOUZEL HEALTH REPORT\n\n")
        f.write(_format_report_metadata(report))
        f.write(f"Date: {report['date']} (UTC) / Local: Europe/Prague\n\n")
        f.write("## Summary\n\n")
        f.write(f"Critical: {s['critical']}\n")
        f.write(f"Warnings: {s['warnings']}\n")
        f.write(f"OK: {s['ok']}\n\n")
        cls_val = s.get("cls")
        f.write(f"CLS: {f'{cls_val:.3f}' if isinstance(cls_val, (int, float)) else (cls_val or 'N/A')}\n")
        lcp = s.get("lcpMs")
        f.write(f"LCP: {f'{lcp}ms' if lcp is not None else 'N/A'}\n")
        f.write(f"CSS size: {s.get('cssKb')} KB\n")
        f.write(f"JS size: {s.get('jsKb')} KB\n")
        f.write(f"Broken links: {s.get('brokenLinks', 0)}\n")
        f.write(f"Blocked (403): {s.get('blocked403', 0)}\n")
        f.write(
            f"CSS token frequency types (top-50 cap, NOT selector blocks): {s.get('cssTokenFrequencyTypesTop50Count', s.get('duplicateSelectors', 0))}\n"
        )
        f.write(
            f"  (legacy JSON key duplicateSelectors = same number — regex token signal only)\n"
        )
        f.write(
            f"Real duplicate selector rule groups (AST/tinycss2): {s.get('realCssDuplicateSelectorGroups', 0)}\n"
        )
        f.write(
            f"Rule occurrences inside those groups: {s.get('realCssDuplicateRuleOccurrencesInGroups', 0)}\n"
        )
        f.write("\n### CSS duplicate debt separation (AST — not regex tokens)\n\n")
        f.write(f"REAL_CSS_DUPLICATE_GROUPS: {s.get('realCssDuplicateGroups', s.get('realCssDuplicateSelectorGroups', 0))}\n")
        f.write(f"REAL_CSS_DUPLICATE_OCCURRENCES: {s.get('realCssDuplicateOccurrences', s.get('realCssDuplicateRuleOccurrencesInGroups', 0))}\n")
        f.write(f"ALLOWED_DUPLICATE_GROUPS: {s.get('allowedDuplicateGroups', 0)}\n")
        f.write(f"ALLOWED_DUPLICATE_OCCURRENCES: {s.get('allowedDuplicateOccurrences', 0)}\n")
        f.write(f"REAL_DEBT_DUPLICATE_GROUPS: {s.get('realDebtDuplicateGroups', 0)}\n")
        f.write(f"REAL_DEBT_DUPLICATE_OCCURRENCES: {s.get('realDebtDuplicateOccurrences', 0)}\n")
        f.write(f"RISK_DUPLICATE_GROUPS: {s.get('riskDuplicateGroups', 0)}\n")
        f.write(f"RISK_DUPLICATE_OCCURRENCES: {s.get('riskDuplicateOccurrences', 0)}\n")
        f.write(f"UNRESOLVED_DUPLICATE_GROUPS: {s.get('unresolvedDuplicateGroups', 0)}\n")
        f.write(f"UNRESOLVED_DUPLICATE_OCCURRENCES: {s.get('unresolvedDuplicateOccurrences', 0)}\n")
        f.write("\n")
        f.write("- **Allowed duplicates** = intentional / expected duplicate rule groups (not treated as technical debt).\n")
        f.write("- **Real debt duplicates** = `debt_verdict: true_debt` (conservative; identical redundant blocks in equivalent scope).\n")
        f.write("- **Risk duplicates** = layout/risk-context groups; not auto-counted as removable debt.\n")
        f.write("- **Unresolved** = needs human review before any debt claim.\n\n")
        f.write(f"Offline radios: {s.get('offlineRadios', 0)}\n\n")
        f.write("### Legend (CSS metrics)\n\n")
        f.write(
            "- **Token frequency** counts repeated regex fragments (e.g. `important`, `rgba`, `.accordionCol`). "
            "High counts do **not** mean duplicate rule blocks.\n"
        )
        f.write(
            "- **Real duplicate groups** = same normalized selector string in **2+ qualified rules** (tinycss2). "
            "**Not every duplicate is CSS debt:** see **debt_verdict** (allowed / real debt / risk / unresolved) above; "
            "**technical_classification** describes the pattern only.\n"
        )
        f.write(
            "- **dead_override_candidate** is **not emitted** in this report: reserved for a future pass that "
            "would require matching specificity, media context, property overlap, and pseudo-state safety; "
            "omitted to avoid false positives.\n"
        )
        f.write("- **Token frequency ≠ duplicate selector blocks.**\n\n")

        f.write("## 1. Project structure\n\n")
        st = report["structure"]
        f.write(f"Folders: {len(st['folders'])}\n")
        f.write(f"Files: {len(st['files'])}\n")
        f.write(f"Total size: {st['total_size_kb']} KB\n\n")
        lines = report.get("structure_lines", [])
        if lines:
            f.write("### Top-level (depth 3)\n\n")
            for line in lines[:80]:
                f.write(f"- {line}\n")
            f.write("\n")
        diff = report["diff"]
        if diff["new"] or diff["deleted"] or diff["changed"]:
            f.write("### Changes from yesterday\n\n")
            for x in diff["new"][:20]:
                f.write(f"- NEW: {x}\n")
            for x in diff["deleted"][:20]:
                f.write(f"- DELETED: {x}\n")
            for x in diff["changed"][:20]:
                f.write(f"- CHANGED: {x}\n")
        f.write("\n")

        f.write("## 2. Duplicates\n\n")
        dup = report["duplicates"]
        audit = dup.get("realCssDuplicateSelectorAudit") or {}
        if audit.get("error"):
            f.write(f"### Real CSS duplicate selector blocks (AST)\n\nError: {audit['error']}\n\n")
        else:
            f.write("### Real CSS duplicate selector blocks (AST, tinycss2)\n\n")
            f.write("REAL_CSS_DUPLICATE_AUDIT_OK=tinycss2\n\n")
            summ = report.get("summary") or {}
            f.write(f"- REAL_CSS_DUPLICATE_GROUPS: {summ.get('realCssDuplicateGroups', audit.get('duplicate_selector_groups', 0))}\n")
            f.write(f"- REAL_CSS_DUPLICATE_OCCURRENCES: {summ.get('realCssDuplicateOccurrences', audit.get('duplicate_rule_occurrences_in_groups', 0))}\n")
            f.write(f"- ALLOWED_DUPLICATE_GROUPS: {summ.get('allowedDuplicateGroups', 0)}\n")
            f.write(f"- ALLOWED_DUPLICATE_OCCURRENCES: {summ.get('allowedDuplicateOccurrences', 0)}\n")
            f.write(f"- REAL_DEBT_DUPLICATE_GROUPS: {summ.get('realDebtDuplicateGroups', 0)}\n")
            f.write(f"- REAL_DEBT_DUPLICATE_OCCURRENCES: {summ.get('realDebtDuplicateOccurrences', 0)}\n")
            f.write(f"- RISK_DUPLICATE_GROUPS: {summ.get('riskDuplicateGroups', 0)}\n")
            f.write(f"- RISK_DUPLICATE_OCCURRENCES: {summ.get('riskDuplicateOccurrences', 0)}\n")
            f.write(f"- UNRESOLVED_DUPLICATE_GROUPS: {summ.get('unresolvedDuplicateGroups', 0)}\n")
            f.write(f"- UNRESOLVED_DUPLICATE_OCCURRENCES: {summ.get('unresolvedDuplicateOccurrences', 0)}\n\n")
            f.write(f"- Duplicate selector groups (total): {audit.get('duplicate_selector_groups', 0)}\n")
            f.write(f"- Occurrences in those groups: {audit.get('duplicate_rule_occurrences_in_groups', 0)}\n")
            f.write(f"- Qualified rules scanned: {audit.get('total_qualified_rules_scanned', 0)}\n")
            lr = audit.get("line_range_method") or ""
            if lr:
                f.write(f"- **Line ranges:** {lr}\n")
            f.write(
                f"- **dead_override_candidate:** {audit.get('dead_override_candidate_policy', 'not emitted (reserved).')}\n"
            )
            cc = audit.get("classification_counts") or {}
            if cc:
                f.write("- By classification: " + ", ".join(f"{k}={v}" for k, v in sorted(cc.items())) + "\n")
            f.write("\n### CSS debt guardrail (AST baseline lock)\n\n")
            try:
                from css_debt_guard import markdown_for_health_report

                f.write(markdown_for_health_report())
            except Exception as ex:
                f.write(f"_CSS debt guard error: {ex}_\n")
            f.write("\n#### Full sample — top duplicate groups (raw selector, lines, media, class)\n\n")
            for gi, g in enumerate((audit.get("groups_top") or [])[:10], start=1):
                norm = g.get("selector_normalized") or ""
                cls_g = g.get("classification") or ""
                cnt = g.get("count", 0)
                dv = g.get("debt_verdict") or ""
                dr = g.get("debt_reason") or ""
                tc = g.get("technical_classification") or cls_g
                f.write(f"##### Group {gi} — **{cnt}x** — `{cls_g}`\n\n")
                f.write("**normalized key (full):**\n\n```\n")
                f.write(norm + "\n```\n\n")
                f.write(f"- technical_classification: `{tc}`\n")
                f.write(f"- debt_verdict: `{dv}`\n")
                f.write(f"- debt_reason: {dr}\n\n")
                for oi, occ in enumerate(g.get("occurrences") or [], start=1):
                    raw = occ.get("selector_raw") or ""
                    f.write(f"**Occurrence {oi}** — line_start={occ.get('line_start')}, line_end={occ.get('line_end')}, "
                            f"media_context=`{occ.get('media_context', '')}`\n\n")
                    f.write("```css\n")
                    f.write(raw + "\n```\n\n")
                    f.write(f"- technical_classification (group): `{tc}`\n\n")
            f.write("\n")
        f.write("### CSS token frequency signals (regex — NOT duplicate rule blocks)\n\n")
        if dup.get("cssTokenFrequencySignals") or dup.get("cssSelectors"):
            for sel, c in (dup.get("cssTokenFrequencySignals") or dup.get("cssSelectors"))[:10]:
                f.write(f"- `{sel}`: {c} regex-hits\n")
        if dup["jsFunctions"]:
            f.write("### JS functions\n\n")
            for fn, c in dup["jsFunctions"][:10]:
                f.write(f"- `{fn}`: {c}x\n")
        if dup["articles"]:
            f.write("### Duplicate articles\n\n")
            for url, c in dup["articles"][:5]:
                f.write(f"- {url}...: {c}x\n")
        if dup["youtubeIds"]:
            f.write("### Duplicate YouTube IDs\n\n")
            for vid, c in dup["youtubeIds"][:5]:
                f.write(f"- {vid}: {c}x\n")
        f.write("\n")

        f.write("## 3. Broken\n\n")
        br = report["broken"]
        if br.get("blocked403"):
            f.write("### Blocked (403)\n\n")
            for b in br["blocked403"][:10]:
                f.write(f"- {b.get('url', '')} (403 blocked, reason={b.get('reason', 'http_403_blocked')})\n")
            f.write("\n")
        if br["links404"]:
            f.write("### 404 links\n\n")
            for b in br["links404"][:10]:
                f.write(f"- {b.get('url', '')} ({b.get('status', b.get('error', ''))})\n")
        if br["jsonErrors"]:
            f.write("### JSON errors\n\n")
            for e in br["jsonErrors"]:
                f.write(f"- {e}\n")
        f.write("\n")

        fm = report.get("fetch_monitor") or {}
        blocked403_by_host = fm.get("blocked403ByHost") or {}
        robots_by_host = fm.get("robotsDisallowByHost") or {}
        total_by_host = fm.get("totalByHost") or {}
        if blocked403_by_host or robots_by_host:
            f.write("## 3b. Fetch monitor (403 / robots)\n\n")
            if blocked403_by_host:
                f.write("### Blocked (403) by host (top 10)\n\n")
                for host, count in sorted(blocked403_by_host.items(), key=lambda x: -x[1])[:10]:
                    f.write(f"- {host}: {count}\n")
                    if count >= 5:
                        f.write(f"  **ALERT: 403_SPIKE host={host} count={count}**\n")
                f.write("\n")
            if total_by_host:
                f.write("### Robots disallow rate by host (top 10)\n\n")
                rates = []
                for host, total in total_by_host.items():
                    if total > 0:
                        disallow = (robots_by_host.get(host) or 0)
                        rate = disallow / total
                        rates.append((host, rate, disallow, total))
                for host, rate, disallow, total in sorted(rates, key=lambda x: -x[1])[:10]:
                    f.write(f"- {host}: {rate:.2%} ({disallow}/{total})\n")
                    if rate > 0.10 and total >= 20:
                        f.write(f"  **ALERT: ROBOTS_DISALLOW_RATE host={host} rate={rate:.2%}**\n")
                f.write("\n")
        f.write("\n")

        f.write("## 4. Performance\n\n")
        perf = report["performance"]
        f.write(f"CLS: {perf.get('cls')}\n")
        f.write(f"LCP: {perf.get('lcpMs')} ms\n")
        f.write(f"CSS: {perf.get('cssKb')} KB\n")
        f.write(f"JS: {perf.get('jsKb')} KB\n")
        if perf.get("jsErrors"):
            f.write("JS errors:\n")
            for e in perf["jsErrors"][:5]:
                f.write(f"- {e}\n")
        if perf.get("error"):
            f.write(f"Note: {perf['error']}\n")
        f.write("\n")

        fm = report.get("fetch_monitor") or {}
        fm_missing = not (DATA_DIR / "fetch_monitor.json").exists()
        blocked403_by_host = fm.get("blocked403ByHost") or {}
        robots_by_host = fm.get("robotsDisallowByHost") or {}
        total_by_host = fm.get("totalByHost") or {}
        timeout_by_host = fm.get("timeoutByHost") or {}
        domain_cap_by_host = fm.get("domainCapByHost") or {}
        f.write("### Aggregator Safety\n\n")
        if fm_missing:
            f.write("fetch_monitor.json missing (values 0).\n\n")
        if blocked403_by_host:
            f.write("Blocked (403) by host (top 10):\n")
            for host, count in sorted(blocked403_by_host.items(), key=lambda x: -x[1])[:10]:
                f.write(f"- {host}: {count}\n")
                if count >= 5:
                    f.write(f"  ALERT: 403_SPIKE host={host} count={count}\n")
            f.write("\n")
        if total_by_host:
            f.write("Robots disallow rate by host (top 10):\n")
            rates = []
            for host, total in total_by_host.items():
                if total > 0:
                    disallow = robots_by_host.get(host) or 0
                    rate = disallow / total
                    rates.append((host, rate, disallow, total))
            for host, rate, disallow, total in sorted(rates, key=lambda x: -x[1])[:10]:
                f.write(f"- {host}: {rate:.2%} ({disallow}/{total})\n")
                if rate > 0.10 and total >= 20:
                    f.write(f"  ALERT: ROBOTS_DISALLOW_RATE host={host} rate={rate:.2%} total={total} disallow={disallow}\n")
            f.write("\n")
        if timeout_by_host:
            f.write("Timeouts by host (top 10):\n")
            for host, count in sorted(timeout_by_host.items(), key=lambda x: -x[1])[:10]:
                f.write(f"- {host}: {count}\n")
                if count >= 10:
                    f.write(f"  ALERT: TIMEOUT_SPIKE host={host} count={count}\n")
            f.write("\n")
        else:
            f.write("Timeouts by host (top 10): 0\n\n")
        if domain_cap_by_host:
            f.write("Domain cap hits by host (top 10):\n")
            for host, count in sorted(domain_cap_by_host.items(), key=lambda x: -x[1])[:10]:
                f.write(f"- {host}: {count}\n")
                if count >= 5:
                    f.write(f"  ALERT: DOMAIN_CAP host={host} count={count}\n")
            f.write("\n")
        else:
            f.write("Domain cap hits by host (top 10): 0\n\n")

        f.write("## 5. Layout\n\n")
        for k, v in report["layout"].items():
            f.write(f"- {k}: {v}\n")
        f.write("\n")

        f.write("## 6. Critical guards\n\n")
        for k, v in report["guards"].items():
            f.write(f"- {k}: {v}\n")
        disc = report.get("discovery", {})
        if disc:
            f.write("\n## 7. Auto-discovery\n\n")
            f.write(f"- Feeds: {disc.get('feeds', 0)}\n")
            f.write(f"- Workflows: {disc.get('workflows', 0)}\n")
            f.write(f"- Links: {disc.get('links', 0)}\n")
            f.write(f"- Radios: {disc.get('radios', 0)}\n")
        f.write("\n")


def run_selftest() -> bool:
    """Validate config, folders, regex. Returns True if OK."""
    errors: List[str] = []
    config = load_config()
    if not isinstance(config.get("version"), (int, float)):
        errors.append("config: version must be number")
    for rx in config.get("critical_workflows_regex", []):
        try:
            re.compile(rx)
        except re.error as e:
            errors.append(f"config: invalid regex {rx!r}: {e}")
    if not ROOT.exists():
        errors.append("ROOT does not exist")
    if not DATA_DIR.exists():
        errors.append("DATA_DIR does not exist")
    if not (ROOT / ".github" / "workflows").exists():
        errors.append(".github/workflows does not exist")
    if not CONFIG_PATH.exists():
        errors.append("config/health_report.json does not exist")
    if errors:
        for e in errors:
            print(f"SELFTEST FAIL: {e}")
        return False
    print("SELFTEST OK: config valid, folders exist, regex valid")
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--selftest", action="store_true", help="Validate config and exit")
    args = parser.parse_args()
    if args.selftest:
        ok = run_selftest()
        raise SystemExit(0 if ok else 1)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report = build_report()
    out_path = REPORTS_DIR / f"health-{date_str()}.md"
    write_markdown(report, out_path)
    latest = REPORTS_DIR / "latest.md"
    write_markdown(report, latest)
    json_path = REPORTS_DIR / f"health-{date_str()}.json"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
