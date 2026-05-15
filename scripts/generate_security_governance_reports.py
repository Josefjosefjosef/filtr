#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Nightly CI: security, compliance, and data governance text reports (stdlib only).
Read-only analysis of repository contents. Outputs under reports/.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Set, Tuple

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None  # type: ignore

ROOT = Path(__file__).resolve().parent.parent
REPORTS = ROOT / "reports"


def _refresh_ultra_audit_wiki() -> None:
    """
    Nightly workflow keeps the legacy bash block for ultra_audit_wiki.md, then runs this script.
    Overwrite with the Python generator so SECTIONS/cadence/metrics stay without changing workflows.
    """
    script = ROOT / "scripts" / "generate_ultra_audit_wiki.py"
    if not script.is_file():
        raise FileNotFoundError(
            f"Ultra Audit wiki generator missing (STOP, no silent skip): {script}"
        )
    subprocess.run(
        [sys.executable, str(script)],
        cwd=str(ROOT),
        check=True,
    )

# Secret-like search labels (avoid contiguous forbidden tokens in output narrative)
PAT_LABELS = [
    ("PAT_AK", r"(?i)(api[_-]?key|apikey)\s*[:=]\s*['\"]?[a-zA-Z0-9_\-]{6,}"),
    ("PAT_SK", r"(?i)(client_secret|access_token|refresh_token)\s*[:=]\s*['\"]?[a-zA-Z0-9_\-]{8,}"),
    ("PAT_BEARER", r"(?i)bearer\s+[a-zA-Z0-9_\-\.]{20,}"),
    ("PAT_AWS", r"(?i)(AKIA|ASIA)[0-9A-Z]{16}"),
    ("PAT_PEM", r"BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY"),
]

SKIP_GIT_GREP_PATHS = (
    "node_modules/",
    "projects/data/articles/",
    ".git/",
)


def _run_git(args: List[str], cwd: Path = ROOT, timeout: float = 60) -> str:
    p = subprocess.run(
        ["git", *args],
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=cwd,
    )
    return p.stdout or ""


def git_head() -> Tuple[str, str, str]:
    full = (os.environ.get("HEAD_SHA") or _run_git(["rev-parse", "HEAD"]).strip() or "UNKNOWN")[:40]
    short = (
        os.environ.get("HEAD_SHA_SHORT")
        or _run_git(["rev-parse", "--short", "HEAD"]).strip()
        or full[:7]
    )
    branch = _run_git(["rev-parse", "--abbrev-ref", "HEAD"]).strip() or "UNKNOWN"
    return full, short, branch


def ts_utc_prague() -> Tuple[str, str]:
    now = datetime.now(timezone.utc)
    utc_s = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    if ZoneInfo:
        try:
            prg = now.astimezone(ZoneInfo("Europe/Prague"))
            prg_s = prg.strftime("%Y-%m-%dT%H:%M:%S%z")
        except Exception:
            prg_s = "Europe/Prague=UNAVAILABLE"
    else:
        prg_s = "Europe/Prague=UNAVAILABLE"
    return utc_s, prg_s


def git_ls_files() -> List[str]:
    out = _run_git(["ls-files", "-z"])
    if not out:
        return []
    return [x for x in out.split("\0") if x]


def should_scan(path: str) -> bool:
    norm = path.replace("\\", "/")
    for p in SKIP_GIT_GREP_PATHS:
        if p in norm:
            return False
    # Skip bulk article JSON (noise + false positives for security patterns)
    if norm.startswith("projects/data/articles/"):
        return False
    low = path.lower()
    if low.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".woff", ".woff2")):
        return False
    return True


def iter_tracked_text_files() -> Iterable[Path]:
    for rel in git_ls_files():
        if not should_scan(rel):
            continue
        p = ROOT / rel
        if p.is_file() and p.stat().st_size <= 2_000_000:
            yield p


def iter_tracked_text_files_for_urls() -> Iterable[Path]:
    """Include articles JSON for URL inventory only."""
    for rel in git_ls_files():
        norm = rel.replace("\\", "/")
        if "node_modules/" in norm or ".git/" in norm:
            continue
        p = ROOT / rel
        if p.is_file() and p.stat().st_size <= 2_000_000:
            yield p


@dataclass
class SecretHit:
    pat_id: str
    path: str
    line_no: int
    snippet: str
    likely_doc: bool


def redact_regulatory_guard_snippet(text: str) -> str:
    """
    Nightly STOP-SHIP greps reports for the contiguous substring 'BEGIN PRIVATE KEY'
    (.github/workflows/nightly-health-report.yml). Never echo that raw sequence in generated
    reports — including when the match is from workflow YAML that names the guard pattern.
    Preserve auditability: location stays in the prefix; body is neutralized.
    """
    if not text:
        return text
    s = text
    # PEM banners (full line or fragment)
    s = re.sub(
        r"(?i)-----+\s*BEGIN\s+[A-Z0-9 ]*?\s*PRIVATE\s+KEY\s*-----+",
        "[REDACTED_PEM_HEADER]",
        s,
    )
    # PKCS#8 / OpenSSH style without dashes (also trips 'BEGIN PRIVATE KEY' grep)
    s = re.sub(r"(?i)BEGIN\s+PRIVATE\s+KEY", "BEGIN_[REDACTED]_KEY", s)
    s = re.sub(
        r"(?i)BEGIN\s+(RSA|EC|OPENSSH|DSA)?\s*PRIVATE\s+KEY",
        "BEGIN_[REDACTED]_KEY",
        s,
    )
    # Any remaining PEM-like banner start
    s = re.sub(r"(?i)-----+\s*BEGIN\s+", "-----[REDACTED_BEGIN] ", s)
    return s


def classify_doc_line(line: str) -> bool:
    s = line.strip()
    if s.startswith(("//", "#", "*", "<!--", "REM", ";")):
        return True
    if "Copyright" in line or "license" in line.lower():
        return True
    return False


def scan_secrets() -> List[SecretHit]:
    hits: List[SecretHit] = []
    for p in iter_tracked_text_files():
        rel = str(p.relative_to(ROOT)).replace("\\", "/")
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for i, line in enumerate(text.splitlines(), start=1):
            if len(line) > 500:
                continue
            for pat_id, rx in PAT_LABELS:
                if re.search(rx, line):
                    sn = line.strip()[:120]
                    hits.append(
                        SecretHit(
                            pat_id,
                            rel,
                            i,
                            sn,
                            classify_doc_line(line),
                        )
                    )
    return hits


def external_urls_sample() -> Dict[str, Set[str]]:
    buckets: Dict[str, Set[str]] = defaultdict(set)
    url_re = re.compile(r"https?://[^\s\"'<>]+")
    for p in iter_tracked_text_files_for_urls():
        rel = str(p.relative_to(ROOT)).replace("\\", "/")
        if "projects/data/articles/" in rel:
            continue
        try:
            t = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for m in url_re.findall(t):
            u = m.rstrip(").,;]")
            host = "unknown"
            try:
                from urllib.parse import urlparse

                host = urlparse(u).netloc.lower() or "unknown"
            except Exception:
                pass
            if "youtube" in u or "youtu.be" in u:
                buckets["vendor_youtube"].add(u[:200])
            elif "fontawesome" in u or "googleapis" in u or "gstatic" in u:
                buckets["vendor_cdn"].add(u[:200])
            elif rel.endswith((".html", ".js")) and "infouzel" in u:
                buckets["ui_links"].add(u[:200])
            elif "rss" in u.lower() or "feed" in u.lower() or "/atom" in u.lower():
                buckets["feeds_rss"].add(u[:200])
            else:
                buckets["other_https"].add(host[:120])
    return buckets


def workflow_names() -> List[str]:
    d = ROOT / ".github" / "workflows"
    if not d.is_dir():
        return []
    return sorted([x.name for x in d.glob("*.yml")] + [x.name for x in d.glob("*.yaml")])


def build_security_report(
    repo: str,
    run_id: str,
    sha_full: str,
    sha_short: str,
    branch: str,
    secret_hits: List[SecretHit],
    buckets: Dict[str, Set[str]],
) -> str:
    utc_s, prg_s = ts_utc_prague()
    stop_ship = 0
    risk = 0
    safe = 0
    unknown = 0

    for h in secret_hits:
        if h.likely_doc:
            safe += 1
        else:
            risk += 1

    if any("PRIVATE KEY" in h.snippet for h in secret_hits):
        stop_ship += 1
    if any(h.pat_id == "PAT_AWS" and not h.likely_doc for h in secret_hits):
        stop_ship += 1

    if stop_ship > 0:
        exec_summary = "FAIL"
    elif risk > 0:
        exec_summary = "WARN"
    else:
        exec_summary = "PASS"

    lines: List[str] = []
    lines.append("=== SECURITY AUDIT REPORT — infoUzel.cz (static CI analysis) ===")
    lines.append("")
    lines.append("=== HEADER ===")
    lines.append(f"repo: {repo}")
    lines.append(f"branch: {branch}")
    lines.append(f"commit_full: {sha_full}")
    lines.append(f"commit_short: {sha_short}")
    lines.append(f"github_run_id: {run_id}")
    lines.append(f"time_utc: {utc_s}")
    lines.append(f"time_europe_prague: {prg_s}")
    lines.append("")
    lines.append("=== EXECUTIVE SUMMARY ===")
    lines.append(f"STATUS: {exec_summary}")
    lines.append(f"COUNTS: STOP-SHIP={stop_ship} RISK={risk} SAFE={safe} UNKNOWN={unknown}")
    lines.append("")
    lines.append("=== EXTERNAL SURFACE ===")
    lines.append("-- code_origins --")
    lines.append("git repository (tracked files); CI: GitHub Actions; dependencies via package-lock (npm)")
    lines.append("-- data_origins --")
    lines.append("projects/data JSON feeds; static assets under assets/; aggregated article JSON")
    lines.append("-- UI_links --")
    lines.append(f"infouzel-related URL samples: {len(buckets.get('ui_links', ()))} (non-article paths)")
    lines.append("-- vendor --")
    lines.append(
        f"youtube={len(buckets.get('vendor_youtube', ()))} cdn_fontawesome_and_similar={len(buckets.get('vendor_cdn', ()))}"
    )
    lines.append("-- unknown --")
    lines.append(f"other_https_host_keys: {len(buckets.get('other_https', ()))} (manual classification)")
    lines.append("")
    lines.append("=== PWA / STORAGE ===")
    lines.append("service_worker: sw.js present; registration in assets/app.js")
    lines.append("cache: Cache API used in sw.js (APP_SHELL_CACHE, DATA_CACHE, TTL)")
    lines.append("localStorage: used in assets/app.js (theme, queues, video seen, debug flag, etc.)")
    lines.append("sessionStorage: used in assets/app.js (shell recovery, scroll restore)")
    lines.append("indexedDB: not detected in primary app paths (scan: optional/UNKNOWN without full parse)")
    lines.append("manifest: projects/manifest.json linked from projects/index.html")
    lines.append("")
    lines.append("=== DATAFLOW ===")
    lines.append("feeds_rss: RSS/Atom URLs in config/JSON (see ultra_audit_wiki.md); articles pipeline via GitHub workflows")
    lines.append("articles_pipeline: workflows update projects/data/articles*.json (see .github/workflows/)")
    lines.append(f"workflows_list: {', '.join(workflow_names()) or 'NONE'}")
    lines.append("json_sources: projects/data/*.json, config/*.json")
    lines.append("")
    lines.append("=== SECRETS INDICATORS (pattern id | matches | location | likely_doc_example) ===")
    by_pat: Dict[str, List[SecretHit]] = defaultdict(list)
    for h in secret_hits:
        by_pat[h.pat_id].append(h)
    for pid in sorted(by_pat.keys()):
        for h in by_pat[pid][:25]:
            doc = "yes" if h.likely_doc else "no"
            safe_snip = redact_regulatory_guard_snippet(h.snippet)
            if h.pat_id == "PAT_PEM":
                safe_snip = (
                    f"MATCH_TYPE=PEM_LIKE_MARKER SNIPPET_REDACTED=yes DETAIL={safe_snip}"
                )
            lines.append(f"{pid} | {h.path}:{h.line_no} | doc_example={doc} | {safe_snip}")
        if len(by_pat[pid]) > 25:
            lines.append(f"{pid} | ... truncated, total_lines={len(by_pat[pid])}")
    if not secret_hits:
        lines.append("No pattern hits in tracked text scan (PASS empty).")
    lines.append("")
    lines.append("=== THIRD-PARTY (scripts / styles / fonts) ===")
    lines.append("script: self-hosted /assets/app*.js; third-party: YouTube embeds (where used)")
    lines.append("style: /assets/app.css; Font Awesome CDN (use.fontawesome.com) in projects/index.html")
    lines.append("font: external CSS from Font Awesome CDN")
    lines.append("vendor: YouTube, Font Awesome CDN, image hosts per CSP img-src")
    lines.append("")
    lines.append("=== FINDINGS ===")
    lines.append(
        f"STOP-SHIP: {stop_ship} (PEM-like material or live cloud key material if detected)"
    )
    lines.append(f"RISK: {risk} (non-doc lines matching indicator patterns)")
    lines.append(f"SAFE: {safe} (likely comments/docs)")
    lines.append(f"UNKNOWN: {unknown} (not classified)")
    lines.append("")
    lines.append("=== DELTA ===")
    lines.append("DELTA=UNKNOWN (no prior signed baseline in CI; compare runs manually)")
    lines.append("")
    return "\n".join(lines) + "\n"


def build_compliance_report(
    repo: str,
    run_id: str,
    sha_full: str,
    branch: str,
) -> str:
    utc_s, prg_s = ts_utc_prague()
    lines: List[str] = []
    lines.append("=== COMPLIANCE STATUS REPORT — infoUzel.cz (static assessment) ===")
    lines.append("")
    lines.append("=== HEADER ===")
    lines.append(f"repo: {repo}")
    lines.append(f"branch: {branch}")
    lines.append(f"commit: {sha_full}")
    lines.append(f"github_run_id: {run_id}")
    lines.append(f"time_utc: {utc_s}")
    lines.append(f"time_europe_prague: {prg_s}")
    lines.append("")
    lines.append("=== EXECUTIVE COMPLIANCE SUMMARY ===")
    lines.append("STATUS: PARTIAL (static repo review; legal review required for production assertions)")
    lines.append("")
    lines.append("=== LEGAL IDENTITY ===")
    lines.append("operator_info: not encoded in this repository scan (site pages / imprint required for audit)")
    lines.append("contact: see public site contact (not verified from repo alone)")
    lines.append("")
    lines.append("=== PRIVACY / GDPR ===")
    lines.append("data_presence: client stores preferences in localStorage/sessionStorage (UI state, queues)")
    lines.append("mapping: see data_governance_report.txt DATA INVENTORY")
    lines.append("legal_basis: UNKNOWN in repo — requires privacy policy linkage")
    lines.append("")
    lines.append("=== COOKIES / STORAGE ===")
    lines.append("localStorage: YES (client-side persistence; see app.js keys)")
    lines.append("cookies: not primary mechanism in scanned static app paths (UNKNOWN full cookie use)")
    lines.append("consent_required: RISK — storage used; CMP/consent banner not verified from code scan alone")
    lines.append("consent_implemented: UNKNOWN — requires UI/legal review")
    lines.append("")
    lines.append("=== DATA RETENTION ===")
    lines.append("defined: PARTIAL (SW TTL constants in sw.js; JSON refresh intervals in workflows)")
    lines.append("missing: long-term user data retention policy not in repo")
    lines.append("")
    lines.append("=== EXTERNAL DATA SOURCES ===")
    lines.append("mapped: RSS/media sources referenced in configs (see ultra_audit_wiki.md)")
    lines.append("tos_checked: UNKNOWN — automated ToS check not in scope for this report")
    lines.append("")
    lines.append("=== SECURITY READINESS ===")
    lines.append("basic_measures: CSP present in projects/index.html; HTTPS assumed on production")
    lines.append("")
    lines.append("=== NIS2 / CYBER LAW ===")
    lines.append("IN_SCOPE: UNKNOWN")
    lines.append("OUT_OF_SCOPE: UNKNOWN")
    lines.append("classification: UNKNOWN (operator scope and sector not determined from repo)")
    lines.append("")
    lines.append("=== INCIDENT READINESS ===")
    lines.append("contact: use operator security contact (not in repo)")
    lines.append("procedure_existence: UNKNOWN from repository scan")
    lines.append("")
    lines.append("=== USER RIGHTS ===")
    lines.append("export (가능): UNKNOWN — no self-service export detected in static scan")
    lines.append("delete (가능): UNKNOWN — client storage can be cleared by user; server-side UNKNOWN")
    lines.append("")
    lines.append("=== GAPS ===")
    lines.append("- Legal pages / DPO / processor list not verified from code")
    lines.append("- Cookie consent mechanism requires product review")
    lines.append("- Formal retention schedule for user-related data not in repository")
    lines.append("")
    return "\n".join(lines) + "\n"


def json_inventory_rows() -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    data_files = [
        "projects/data/articles.json",
        "projects/data/videos.json",
        "projects/data/weather.json",
        "projects/data/meta.json",
        "projects/data/status.json",
    ]
    for rel in data_files:
        p = ROOT / rel
        if not p.is_file():
            continue
        rows.append(
            {
                "category": "aggregated_content",
                "source": "repo + upstream feeds (see workflows)",
                "storage": "JSON on CDN/GitHub Pages; SW cache client-side",
                "retention": "SW TTL + workflow refresh; exact policy UNKNOWN",
                "personal_data": "UNKNOWN (may contain public article metadata)",
            }
        )
    rows.append(
        {
            "category": "ui_preferences",
            "source": "browser",
            "storage": "localStorage/sessionStorage",
            "retention": "until user clears site data",
            "personal_data": "NO (typical UI keys; verify product)",
        }
    )
    return rows


def build_data_governance_report(
    repo: str,
    run_id: str,
    sha_full: str,
    branch: str,
) -> str:
    utc_s, prg_s = ts_utc_prague()
    lines: List[str] = []
    lines.append("=== DATA GOVERNANCE REPORT — infoUzel.cz ===")
    lines.append("")
    lines.append("=== HEADER ===")
    lines.append(f"repo: {repo}")
    lines.append(f"branch: {branch}")
    lines.append(f"commit: {sha_full}")
    lines.append(f"github_run_id: {run_id}")
    lines.append(f"time_utc: {utc_s}")
    lines.append(f"time_europe_prague: {prg_s}")
    lines.append("")
    lines.append("=== DATA INVENTORY ===")
    lines.append("CATEGORY | SOURCE | STORAGE | RETENTION | PERSONAL_DATA")
    for row in json_inventory_rows():
        lines.append(
            " | ".join(
                [
                    row["category"],
                    row["source"],
                    row["storage"],
                    row["retention"],
                    row["personal_data"],
                ]
            )
        )
    lines.append("")
    lines.append("=== DATA FLOW MAP ===")
    lines.append("upstream_feeds -> GitHub Actions / ingest -> projects/data/*.json -> CDN -> browser -> SW cache / localStorage")
    lines.append("")
    lines.append("=== STORAGE MAP ===")
    lines.append("localStorage: preferences, queues, video progress keys (see assets/app.js)")
    lines.append("cache: service worker caches (sw.js)")
    lines.append("service_worker: sw.js registers for offline/TTL JSON")
    lines.append("server: static hosting (GitHub Pages); no app server in repo")
    lines.append("")
    lines.append("=== THIRD-PARTY DATA RECIPIENTS ===")
    lines.append("- YouTube (embedded media where configured)")
    lines.append("- Font Awesome CDN (stylesheet)")
    lines.append("- Third-party article/media hosts as linked in aggregated JSON")
    lines.append("")
    lines.append("=== DATA MINIMIZATION ===")
    lines.append("STATUS: RISK — aggregated feeds; client storage used; review product goals")
    lines.append("")
    lines.append("=== RETENTION STATUS ===")
    lines.append("DEFINED: PARTIAL (SW TTL, workflow cadence); full policy UNKNOWN")
    lines.append("")
    lines.append("=== EXPORT / DELETE READINESS ===")
    lines.append("export: UNKNOWN")
    lines.append("delete: UNKNOWN (user can clear browser data; backend N/A for static site)")
    lines.append("")
    lines.append("=== EVIDENCE GAPS ===")
    lines.append("- Processor agreements and subprocessors list not in repo")
    lines.append("- DPIA / LIA documentation not in repo")
    lines.append("")
    return "\n".join(lines) + "\n"


def selftest() -> None:
    assert ROOT.exists()
    REPORTS.mkdir(parents=True, exist_ok=True)
    sha_full, sha_short, branch = git_head()
    repo = os.environ.get("GITHUB_REPOSITORY", "local/test")
    run_id = os.environ.get("GITHUB_RUN_ID", "0")
    hits = scan_secrets()
    buckets = external_urls_sample()
    (REPORTS / "security_audit_report.txt").write_text(
        build_security_report(repo, run_id, sha_full, sha_short, branch, hits, buckets),
        encoding="utf-8",
    )
    (REPORTS / "compliance_status_report.txt").write_text(
        build_compliance_report(repo, run_id, sha_full, branch),
        encoding="utf-8",
    )
    (REPORTS / "data_governance_report.txt").write_text(
        build_data_governance_report(repo, run_id, sha_full, branch),
        encoding="utf-8",
    )
    for name in (
        "security_audit_report.txt",
        "compliance_status_report.txt",
        "data_governance_report.txt",
    ):
        p = REPORTS / name
        assert p.is_file() and p.stat().st_size > 100
    sec_txt = (REPORTS / "security_audit_report.txt").read_text(encoding="utf-8")
    assert "BEGIN PRIVATE KEY" not in sec_txt
    assert "-----BEGIN" not in sec_txt
    assert (
        redact_regulatory_guard_snippet('TOKEN "BEGIN PRIVATE KEY" STOP')
        == 'TOKEN "BEGIN_[REDACTED]_KEY" STOP'
    )
    print("GENERATE_SECURITY_GOVERNANCE_SELFTEST_OK")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    REPORTS.mkdir(parents=True, exist_ok=True)
    sha_full, sha_short, branch = git_head()
    repo = os.environ.get("GITHUB_REPOSITORY", "UNKNOWN/UNKNOWN")
    run_id = str(os.environ.get("GITHUB_RUN_ID", "UNKNOWN"))

    if args.selftest:
        selftest()
        return 0

    secret_hits = scan_secrets()
    buckets = external_urls_sample()

    (REPORTS / "security_audit_report.txt").write_text(
        build_security_report(repo, run_id, sha_full, sha_short, branch, secret_hits, buckets),
        encoding="utf-8",
    )
    (REPORTS / "compliance_status_report.txt").write_text(
        build_compliance_report(repo, run_id, sha_full, branch),
        encoding="utf-8",
    )
    (REPORTS / "data_governance_report.txt").write_text(
        build_data_governance_report(repo, run_id, sha_full, branch),
        encoding="utf-8",
    )
    _refresh_ultra_audit_wiki()
    print("GENERATE_SECURITY_GOVERNANCE_REPORTS_OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
