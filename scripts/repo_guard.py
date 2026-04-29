#!/usr/bin/env python3
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

CRITICAL_UNIQUES = {
    "assets/app.js": "Canonical SPA bundle",
    "assets/app.css": "Canonical SPA stylesheet",
    "sw.js": "Production service worker",
    "projects/index.html": "Authoritative SPA entrypoint",
}


def find_paths(pattern: str):
    return sorted(ROOT.rglob(pattern))


def require_unique(metric: str, pattern: str, description: str, allow_root_landing=False):
    matches = find_paths(pattern)
    if not matches:
        return [f"Missing {description} ({pattern})"]
    if len(matches) > 1:
        if allow_root_landing and pattern == "index.html":
            return []
        return [f"Found {len(matches)} copies of {description}: {', '.join(str(p) for p in matches)}"]
    return []


def validate_json(path: Path, key: str):
    errors = []
    if not path.exists():
        errors.append(f"{path} missing")
        return errors
    if path.stat().st_size == 0:
        errors.append(f"{path} is empty")
        return errors
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        errors.append(f"{path} is not valid JSON: {exc}")
        return errors
    if "generatedAt" not in payload:
        errors.append(f"{path} lacks generatedAt")
    value = payload.get(key)
    if not isinstance(value, list):
        errors.append(f"{path}:{key} is not an array")
    return errors


def check_cache_bust(index_path: Path):
    data = index_path.read_text(encoding="utf-8")
    issues = []
    if 'app.css?v=' not in data:
        issues.append("projects/index.html lacks cache-bust on app.css")
    if 'app.js?v=' not in data:
        issues.append("projects/index.html lacks cache-bust on app.js")
    return issues


def check_blocked_hedvabnastezka():
    """Hard ban on real leaks: active registry feed_url + shipped article URLs.

    assets/app.js is NOT scanned: the substring appears only in client-side
    blocklist / deny / purge helpers (iuIsHardBlocked*, purity), not as an active source.
    """
    needle = "hedvabnastezka"
    issues = []
    reg = ROOT / "projects" / "data" / "source_registry.json"
    if reg.exists():
        try:
            payload = json.loads(reg.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            issues.append(f"{reg} invalid JSON: {exc}")
        else:
            for e in payload.get("entries") or []:
                if not isinstance(e, dict):
                    continue
                if e.get("blocked") or e.get("active") is False:
                    continue
                u = str(e.get("feed_url") or "").lower()
                if needle in u:
                    issues.append(f"source_registry.json has active entry with {needle}: {e.get('id')}")
    art = ROOT / "projects" / "data" / "articles.json"
    if art.exists():
        try:
            payload = json.loads(art.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
        else:
            for row in payload.get("articles") or []:
                if not isinstance(row, dict):
                    continue
                u = str(row.get("url") or "").lower()
                if needle in u:
                    issues.append("articles.json contains article url with hedvabnastezka")
                    break
                for s in row.get("sources") or []:
                    if isinstance(s, dict) and needle in str(s.get("url") or "").lower():
                        issues.append("articles.json contains source url with hedvabnastezka")
                        break
    return issues


def check_fetch_paths(app_js: Path):
    text = app_js.read_text(encoding="utf-8")
    issues = []
    if '"/data/' in text or "\"/data/" in text:
        issues.append("assets/app.js references /data/ instead of /projects/data/")
    if '"/filtr/data/' in text or "\"/filtr/data/" in text:
        issues.append("assets/app.js references /filtr/data/ instead of /projects/data/")
    return issues


def check_weather_inline_video_autopause(app_js: Path):
    """Regression: Počasí YouTube preview must teardown when leaving the section (assets/app.js)."""
    issues = []
    if not app_js.exists():
        return issues
    t = app_js.read_text(encoding="utf-8")
    if "function stopWeatherInlineVideo" not in t:
        issues.append(
            "assets/app.js must define stopWeatherInlineVideo(reason) for Počasí inline video cleanup"
        )
    if "window.stopWeatherInlineVideo" not in t:
        issues.append("assets/app.js must expose stopWeatherInlineVideo on window for diagnostics/tests")
    if "stopWeatherInlineVideo(" not in t:
        issues.append("assets/app.js must call stopWeatherInlineVideo when leaving non–Počasí section")
    if 'stopWeatherInlineVideo("applySection_non_weather")' not in t:
        issues.append(
            "assets/app.js must invoke stopWeatherInlineVideo from applySectionFromURL (applySection_non_weather)"
        )
    if "iuWeatherHistoryPlayerHost" not in t:
        issues.append(
            "assets/app.js stopWeatherInlineVideo must target iuWeatherHistoryPlayerHost (Počasí embed host)"
        )
    return issues


def check_section_feed_header(app_js: Path, index_html: Path):
    """Regresní guard: feed #dataUpdatedAt nesmí používat globální dataset generatedAt ani starý text."""
    issues = []
    if app_js.exists():
        t = app_js.read_text(encoding="utf-8")
        if "Poslední aktualizace dat" in t:
            issues.append(
                "assets/app.js must not contain legacy label 'Poslední aktualizace dat' (use section-derived header)"
            )
        if "iuMaxPublishedMsFromItems" not in t or "iuUpdateSectionDataUpdatedAtEl" not in t:
            issues.append(
                "assets/app.js must define iuMaxPublishedMsFromItems + iuUpdateSectionDataUpdatedAtEl for feed header"
            )
    if index_html.exists():
        ix = index_html.read_text(encoding="utf-8")
        if 'id="dataUpdatedAt"' in ix and "Poslední aktualizace sekce" not in ix:
            issues.append("projects/index.html #dataUpdatedAt must use section-level placeholder (Poslední aktualizace sekce)")
    return issues


def main():
    issues = []

    for pattern, description in CRITICAL_UNIQUES.items():
        issues += require_unique(pattern, pattern, description)
    # allow landing index.html to coexist
    if not find_paths("projects/index.html"):
        issues.append("projects/index.html missing")

    projects_index = ROOT / "projects" / "index.html"
    if projects_index.exists():
        issues += check_cache_bust(projects_index)

    app_js = ROOT / "assets" / "app.js"
    if app_js.exists():
        issues += check_fetch_paths(app_js)

    issues += check_weather_inline_video_autopause(app_js)

    issues += check_section_feed_header(app_js, projects_index)

    issues += check_blocked_hedvabnastezka()

    data_dir = ROOT / "projects" / "data"
    issues += validate_json(data_dir / "articles.json", "articles")
    issues += validate_json(data_dir / "videos.json", "videos")

    if issues:
        print("Repo guard: FAIL")
        for issue in issues:
            print(f" - {issue}")
        sys.exit(1)
    print("Repo guard: OK")


if __name__ == "__main__":
    main()
