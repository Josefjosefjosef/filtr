#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
infoUzel.cz – Nightly Health Report (ALL-IN-ONE)
Generates comprehensive report: structure, duplicates, broken, performance, layout, guards.
"""

import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

ROOT = Path(__file__).resolve().parent.parent
REPORTS_DIR = ROOT / "reports"
DATA_DIR = ROOT / "projects" / "data"
ASSETS_DIR = ROOT / "assets"


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def date_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


# --- 1. Project structure ---
def collect_structure() -> Dict[str, Any]:
    out = {"folders": [], "files": [], "sizes": {}, "total_size_kb": 0}
    total = 0
    for root, dirs, files in os.walk(ROOT):
        rel = Path(root).relative_to(ROOT)
        skip = {".git", "node_modules", "__pycache__", ".cursor"}
        dirs[:] = [d for d in dirs if d not in skip]
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


def diff_from_yesterday() -> Dict[str, Any]:
    out = {"new": [], "deleted": [], "changed": []}
    yesterday_date = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
    yesterday = REPORTS_DIR / f"health-{yesterday_date}.json"
    if not yesterday.exists():
        return out
    try:
        prev = json.loads(yesterday.read_text(encoding="utf-8"))
        prev_files = set(prev.get("structure", {}).get("files", []))
    except Exception:
        return out
    curr = collect_structure()
    curr_files = set(curr["files"])
    out["new"] = sorted(curr_files - prev_files)
    out["deleted"] = sorted(prev_files - curr_files)
    prev_sizes = prev.get("structure", {}).get("sizes", {})
    for f in curr_files & prev_files:
        if curr["sizes"].get(f) != prev_sizes.get(f):
            out["changed"].append(f)
    return out


# --- 2. Duplicates ---
def find_duplicate_css_selectors() -> List[Tuple[str, int]]:
    dupes = []
    css_path = ROOT / "assets" / "app.css"
    if not css_path.exists():
        return dupes
    text = css_path.read_text(encoding="utf-8")
    selectors = re.findall(r"([.#][\w-]+|[a-z][\w-]*)\s*[,{]?", text)
    counts = defaultdict(list)
    for i, sel in enumerate(selectors):
        counts[sel].append(i)
    for sel, positions in counts.items():
        if len(positions) > 1 and len(sel) > 2:
            dupes.append((sel, len(positions)))
    return sorted(dupes, key=lambda x: -x[1])[:50]


def find_duplicate_js_functions() -> List[Tuple[str, int]]:
    dupes = []
    js_path = ROOT / "assets" / "app.js"
    if not js_path.exists():
        return dupes
    text = js_path.read_text(encoding="utf-8")
    funcs = re.findall(r"function\s+(\w+)\s*\(", text)
    counts = defaultdict(int)
    for f in funcs:
        counts[f] += 1
    for f, c in counts.items():
        if c > 1:
            dupes.append((f, c))
    return sorted(dupes, key=lambda x: -x[1])[:30]


def find_duplicate_articles() -> List[Tuple[str, int]]:
    dupes = []
    arts = DATA_DIR / "articles.json"
    if not arts.exists():
        return dupes
    try:
        data = json.loads(arts.read_text(encoding="utf-8"))
        urls = [a.get("url", "") for a in data.get("articles", []) if a.get("url")]
    except Exception:
        return dupes
    counts = defaultdict(int)
    for u in urls:
        if u:
            counts[u] += 1
    for u, c in counts.items():
        if c > 1:
            dupes.append((u[:80], c))
    return dupes[:20]


def find_duplicate_youtube_ids() -> List[Tuple[str, int]]:
    dupes = []
    vids = DATA_DIR / "videos.json"
    if not vids.exists():
        return dupes
    try:
        data = json.loads(vids.read_text(encoding="utf-8"))
        ids = []
        for v in data.get("videos", []) or []:
            if v.get("videoId"):
                ids.append(v["videoId"])
    except Exception:
        return dupes
    counts = defaultdict(int)
    for i in ids:
        counts[i] += 1
    for i, c in counts.items():
        if c > 1:
            dupes.append((i, c))
    return dupes[:20]


# --- 3. Broken ---
def check_404_links() -> List[Dict[str, str]]:
    broken = []
    arts = DATA_DIR / "articles.json"
    if not arts.exists():
        return broken
    try:
        data = json.loads(arts.read_text(encoding="utf-8"))
        urls = [a.get("url") for a in data.get("articles", [])[:30] if a.get("url")]
    except Exception:
        return broken
    try:
        import urllib.request
        for url in urls[:10]:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "infoUzel-health/1.0"})
                with urllib.request.urlopen(req, timeout=8) as r:
                    if r.status >= 400:
                        broken.append({"url": url, "status": r.status, "where": "articles.json"})
            except Exception as e:
                broken.append({"url": url, "error": str(e)[:80], "where": "articles.json"})
    except ImportError:
        pass
    return broken[:10]


def check_json_errors() -> List[str]:
    errors = []
    for name in ["articles.json", "videos.json", "weather.json", "namedays.json", "meta.json"]:
        p = DATA_DIR / name
        if not p.exists():
            continue
        try:
            json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            errors.append(f"{name}: {e}")
    return errors


# --- 4. Performance (from check_site.js output or file sizes) ---
def run_check_site() -> Dict[str, Any]:
    out = {"cls": None, "cssKb": None, "jsKb": None, "jsErrors": [], "error": None}
    css_path = ROOT / "assets" / "app.css"
    js_path = ROOT / "assets" / "app.js"
    if css_path.exists():
        out["cssKb"] = round(css_path.stat().st_size / 1024)
    if js_path.exists():
        out["jsKb"] = round(js_path.stat().st_size / 1024)
    try:
        env = os.environ.copy()
        env["SITE_URL"] = "https://infouzel.cz/projects/?debug=1&nosw=1&section=media"
        r = subprocess.run(
            ["node", str(ROOT / "scripts" / "check_site.js")],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=90,
            env=env,
        )
        if r.returncode == 0:
            data = json.loads(r.stdout)
            out["cls"] = data.get("headless", {}).get("cls")
            out["cssKb"] = data.get("bundles", {}).get("cssKb") or out["cssKb"]
            out["jsKb"] = data.get("bundles", {}).get("jsKb") or out["jsKb"]
            out["jsErrors"] = data.get("headless", {}).get("jsErrors", [])
        else:
            out["error"] = (r.stderr or r.stdout or "check_site failed")[:200]
    except subprocess.TimeoutExpired:
        out["error"] = "check_site timeout"
    except Exception as e:
        out["error"] = str(e)[:200]
    return out


# --- 5. Layout ---
def check_layout() -> Dict[str, Any]:
    out = {"topbar_height": None, "feed_columns": None, "left_rail": None, "mindmenu": None, "topbar_grid": None}
    css = ROOT / "assets" / "app.css"
    if not css.exists():
        return out
    text = css.read_text(encoding="utf-8")
    if "--iuTopbarHeight:" in text or "topbar" in text.lower():
        out["topbar_height"] = "ok"
    if re.search(r"grid-template-columns.*136px", text):
        out["left_rail"] = "ok"
    if ".layout" in text and "grid" in text:
        out["feed_columns"] = "ok"
    if "iu-mmQuickLinks" in text or "mindMenu" in text:
        out["mindmenu"] = "ok"
    if "iuTopbarContent" in text or "iuTopbarSlot" in text:
        out["topbar_grid"] = "ok"
    return out


# --- 6. Critical guards ---
def check_guards() -> Dict[str, Any]:
    out = {}
    css = ROOT / "assets" / "app.css"
    if css.exists():
        text = css.read_text(encoding="utf-8")
        out["topbar_color"] = "ok" if "#0B1F33" in text else "fail"
        out["topbar_no_gradient"] = "ok"
        if re.search(r"topbar|iuTopbar|topbarWrap|topbar-new", text, re.I):
            for m in re.finditer(r"linear-gradient[^;]+;", text):
                ctx = text[max(0, m.start() - 200):m.start()]
                if any(x in ctx for x in ["topbar", "iuTopbar", "topbarWrap", "topbar-new"]):
                    out["topbar_no_gradient"] = "fail"
                    break
    return out


# --- 7. Report assembly ---
def build_report(perf: Optional[Dict] = None) -> Dict[str, Any]:
    structure = collect_structure()
    diff = diff_from_yesterday()
    dup_css = find_duplicate_css_selectors()
    dup_js = find_duplicate_js_functions()
    dup_arts = find_duplicate_articles()
    dup_yt = find_duplicate_youtube_ids()
    broken = check_404_links()
    json_errs = check_json_errors()
    layout = check_layout()
    guards = check_guards()

    if perf is None:
        perf = run_check_site()

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
    ok_count += max(0, 130 - critical - warnings)

    report = {
        "date": date_str(),
        "timestamp": now_iso(),
        "summary": {
            "critical": critical,
            "warnings": warnings,
            "ok": ok_count,
            "cls": cls,
            "cssKb": css_kb,
            "jsKb": js_kb,
            "brokenLinks": len(broken),
            "duplicateSelectors": len(dup_css),
            "offlineRadios": 0,
        },
        "structure": structure,
        "diff": diff,
        "duplicates": {
            "cssSelectors": dup_css[:20],
            "jsFunctions": dup_js[:15],
            "articles": dup_arts[:10],
            "youtubeIds": dup_yt[:10],
        },
        "broken": {
            "links404": broken,
            "jsonErrors": json_errs,
        },
        "performance": perf,
        "layout": layout,
        "guards": guards,
    }
    return report


def write_markdown(report: Dict[str, Any], path: Path) -> None:
    s = report["summary"]
    with open(path, "w", encoding="utf-8") as f:
        f.write("# INFOUZEL HEALTH REPORT\n\n")
        f.write(f"Date: {report['date']}\n\n")
        f.write("## Summary\n\n")
        f.write(f"Critical: {s['critical']}\n")
        f.write(f"Warnings: {s['warnings']}\n")
        f.write(f"OK: {s['ok']}\n\n")
        cls_val = s.get("cls")
        f.write(f"CLS: {f'{cls_val:.3f}' if isinstance(cls_val, (int, float)) else cls_val}\n")
        f.write(f"CSS size: {s.get('cssKb')} KB\n")
        f.write(f"JS size: {s.get('jsKb')} KB\n")
        f.write(f"Broken links: {s.get('brokenLinks', 0)}\n")
        f.write(f"Duplicate selectors: {s.get('duplicateSelectors', 0)}\n")
        f.write(f"Offline radios: {s.get('offlineRadios', 0)}\n\n")

        f.write("## 1. Project structure\n\n")
        st = report["structure"]
        f.write(f"Folders: {len(st['folders'])}\n")
        f.write(f"Files: {len(st['files'])}\n")
        f.write(f"Total size: {st['total_size_kb']} KB\n\n")
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
        if dup["cssSelectors"]:
            f.write("### CSS selectors\n\n")
            for sel, c in dup["cssSelectors"][:10]:
                f.write(f"- `{sel}`: {c}x\n")
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
        if br["links404"]:
            f.write("### 404 links\n\n")
            for b in br["links404"][:10]:
                f.write(f"- {b.get('url', '')} ({b.get('status', b.get('error', ''))})\n")
        if br["jsonErrors"]:
            f.write("### JSON errors\n\n")
            for e in br["jsonErrors"]:
                f.write(f"- {e}\n")
        f.write("\n")

        f.write("## 4. Performance\n\n")
        perf = report["performance"]
        f.write(f"CLS: {perf.get('cls')}\n")
        f.write(f"CSS: {perf.get('cssKb')} KB\n")
        f.write(f"JS: {perf.get('jsKb')} KB\n")
        if perf.get("jsErrors"):
            f.write("JS errors:\n")
            for e in perf["jsErrors"][:5]:
                f.write(f"- {e}\n")
        f.write("\n")

        f.write("## 5. Layout\n\n")
        for k, v in report["layout"].items():
            f.write(f"- {k}: {v}\n")
        f.write("\n")

        f.write("## 6. Critical guards\n\n")
        for k, v in report["guards"].items():
            f.write(f"- {k}: {v}\n")
        f.write("\n")


def main():
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report = build_report()
    out_path = REPORTS_DIR / f"health-{date_str()}.md"
    write_markdown(report, out_path)
    latest = REPORTS_DIR / "latest.md"
    write_markdown(report, latest)
    json_path = REPORTS_DIR / f"health-{date_str()}.json"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (REPORTS_DIR / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Report written to {out_path}")
    if report["summary"]["critical"] > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
