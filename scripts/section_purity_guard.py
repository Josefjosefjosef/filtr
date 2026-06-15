#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Section purity guard (finance/zdravi vs URL rules).

PUBLISH_ALWAYS (default): misclassification incidents WARN only — release continues.
STRICT: legacy hard-fail when any misclassified row remains (opt-in only).

Env:
  ARTICLES_JSON_PATH — path to articles.json (default projects/data/articles.json)
  SECTION_PURITY_POLICY — PUBLISH_ALWAYS | STRICT (default PUBLISH_ALWAYS)
  SECTION_PURITY_WARN_COUNT — warn-only ceiling (default 10)
  SECTION_PURITY_WARN_RATIO — warn-only ratio ceiling (default 0.01 = 1%)
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from build_articles import remap_article_section_if_url_mismatch  # noqa: E402

DEFAULT_WARN_COUNT = 10
DEFAULT_WARN_RATIO = 0.01
SECTION_PURITY_POLICY = os.environ.get("SECTION_PURITY_POLICY", "PUBLISH_ALWAYS").strip().upper()


def _articles_path() -> Path:
    env = os.environ.get("ARTICLES_JSON_PATH", "").strip()
    if env:
        return Path(env)
    return ROOT / "projects" / "data" / "articles.json"


def _is_publish_always() -> bool:
    return SECTION_PURITY_POLICY != "STRICT"


def _warn_count_threshold() -> int:
    raw = os.environ.get("SECTION_PURITY_WARN_COUNT", str(DEFAULT_WARN_COUNT)).strip()
    try:
        return max(0, int(raw))
    except ValueError:
        return DEFAULT_WARN_COUNT


def _warn_ratio_threshold() -> float:
    raw = os.environ.get("SECTION_PURITY_WARN_RATIO", str(DEFAULT_WARN_RATIO)).strip()
    try:
        return max(0.0, float(raw))
    except ValueError:
        return DEFAULT_WARN_RATIO


def _rule_label(actual: str, expected: str) -> str:
    return f"remap_article_section_if_url_mismatch({actual}->{expected})"


def evaluate_section_purity(
    articles: list[Any],
    *,
    warn_count: int | None = None,
    warn_ratio: float | None = None,
) -> dict[str, Any]:
    """Return misclassification report for finance/zdravi URL rule checks."""
    rows = [a for a in articles if isinstance(a, dict)]
    total = len(rows)
    misclassified: list[dict[str, Any]] = []

    for a in rows:
        b = remap_article_section_if_url_mismatch(a)
        if (b.get("topic") or "") == (a.get("topic") or "") and (b.get("section") or "") == (a.get("section") or ""):
            continue
        actual = str(a.get("topic") or a.get("section") or "").strip()
        expected = str(b.get("topic") or b.get("section") or "").strip()
        misclassified.append(
            {
                "id": a.get("id") or a.get("articleId") or "",
                "url": a.get("url") or "",
                "title": a.get("title") or "",
                "source": a.get("source") or a.get("sourceName") or "",
                "actualSection": actual,
                "expectedSection": expected,
                "rule": _rule_label(actual, expected),
            }
        )

    count = len(misclassified)
    ratio = (count / total) if total else 0.0
    wc = _warn_count_threshold() if warn_count is None else warn_count
    wr = _warn_ratio_threshold() if warn_ratio is None else warn_ratio

    if count == 0:
        status = "OK"
        severity = "NONE"
    elif count > wc or ratio > wr:
        status = "INCIDENT_WARNING"
        severity = "INCIDENT_WARNING"
    else:
        status = "WARN"
        severity = "WARN_ONLY"

    return {
        "guard": "section-purity",
        "policy": SECTION_PURITY_POLICY,
        "status": status,
        "severity": severity,
        "blocking": False if _is_publish_always() else count > 0,
        "misclassifiedCount": count,
        "totalArticles": total,
        "misclassifiedRatio": round(ratio, 6),
        "warnCountThreshold": wc,
        "warnRatioThreshold": wr,
        "misclassified": misclassified,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }


def _report_path() -> Path:
    base = os.environ.get("RUNNER_TEMP") or os.environ.get("TEMP") or tempfile.gettempdir()
    return Path(base) / "iu_section_purity_guard_report.json"


def _write_report(report: dict[str, Any]) -> Path:
    out = _report_path()
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[section-purity-guard] report={out}")
    return out


def _append_github_output(key: str, value: str | int | float) -> None:
    path = os.environ.get("GITHUB_OUTPUT", "").strip()
    if not path:
        return
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(f"{key}={value}\n")


def _append_step_summary(report: dict[str, Any]) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY", "").strip()
    if not path:
        return
    count = report["misclassifiedCount"]
    if count == 0:
        return
    lines = [
        "## Section purity guard",
        "",
        f"- **Status:** `{report['status']}`",
        f"- **Misclassified:** {count} / {report['totalArticles']} "
        f"({report['misclassifiedRatio'] * 100:.3f}%)",
        f"- **Blocking:** NO (PUBLISH_ALWAYS)",
        "",
    ]
    for row in report["misclassified"][:10]:
        lines.append(
            f"- `{row.get('actualSection')}` -> `{row.get('expectedSection')}`: "
            f"{row.get('title', '')[:80]}"
        )
    with open(path, "a", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


def _emit_status_outputs(report: dict[str, Any], *, technical_error: bool = False) -> None:
    status = "TECHNICAL_ERROR" if technical_error else report["status"]
    blocking = "NO" if _is_publish_always() or technical_error else ("YES" if report["misclassifiedCount"] else "NO")
    print(f"SECTION_PURITY_STATUS={status}")
    print(f"SECTION_PURITY_MISCLASSIFIED_COUNT={report.get('misclassifiedCount', 0)}")
    print(f"SECTION_PURITY_BLOCKING={blocking}")
    if technical_error:
        print("GUARD_TECHNICAL_ERROR=YES")
        print("RELEASE_CONTINUES=YES")
    else:
        print(f"SECTION_PURITY_SEVERITY={report.get('severity', 'NONE')}")
        print(f"RELEASE_CONTINUES={'YES' if blocking == 'NO' else 'NO'}")
    _append_github_output("section_purity_status", status)
    _append_github_output("section_purity_misclassified_count", report.get("misclassifiedCount", 0))
    _append_github_output("section_purity_blocking", blocking)


def main() -> int:
    path = _articles_path()
    publish_always = _is_publish_always()

    if not path.exists():
        print("[section-purity-guard] SKIP: no articles.json")
        print("SECTION_PURITY_STATUS=SKIP")
        print("SECTION_PURITY_MISCLASSIFIED_COUNT=0")
        print("SECTION_PURITY_BLOCKING=NO")
        print("RELEASE_CONTINUES=YES")
        _append_github_output("section_purity_status", "SKIP")
        _append_github_output("section_purity_misclassified_count", 0)
        _append_github_output("section_purity_blocking", "NO")
        return 0

    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"[section-purity-guard] GUARD_TECHNICAL_ERROR: cannot load {path}: {exc}", file=sys.stderr)
        print(f"::warning file=scripts/section_purity_guard.py::section purity guard technical error: {exc}")
        empty = {
            "guard": "section-purity",
            "policy": SECTION_PURITY_POLICY,
            "status": "TECHNICAL_ERROR",
            "severity": "TECHNICAL_ERROR",
            "blocking": False,
            "misclassifiedCount": 0,
            "totalArticles": 0,
            "misclassifiedRatio": 0.0,
            "misclassified": [],
            "technicalError": str(exc),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        }
        _write_report(empty)
        _emit_status_outputs(empty, technical_error=True)
        return 0

    rows = data.get("articles") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        print("[section-purity-guard] GUARD_TECHNICAL_ERROR: invalid articles schema", file=sys.stderr)
        print("::warning file=scripts/section_purity_guard.py::section purity guard invalid articles schema")
        empty = {
            "guard": "section-purity",
            "policy": SECTION_PURITY_POLICY,
            "status": "TECHNICAL_ERROR",
            "severity": "TECHNICAL_ERROR",
            "blocking": False,
            "misclassifiedCount": 0,
            "totalArticles": 0,
            "misclassifiedRatio": 0.0,
            "misclassified": [],
            "technicalError": "invalid articles schema",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        }
        _write_report(empty)
        _emit_status_outputs(empty, technical_error=True)
        return 0

    report = evaluate_section_purity(rows)
    _write_report(report)
    _append_step_summary(report)
    _emit_status_outputs(report)

    count = report["misclassifiedCount"]
    if count == 0:
        print("[section-purity-guard] OK")
        return 0

    msg = f"{count} articles still misclassified vs URL rules"
    for row in report["misclassified"][:5]:
        print(
            f"[section-purity-guard] misclassified id={row.get('id') or 'N/A'} "
            f"actual={row.get('actualSection')} expected={row.get('expectedSection')} "
            f"url={row.get('url')}",
            file=sys.stderr,
        )
        print(f"::warning file=scripts/section_purity_guard.py::{row.get('rule')}: {row.get('url')}")

    if report["severity"] == "INCIDENT_WARNING":
        print(f"[section-purity-guard] INCIDENT: {msg}", file=sys.stderr)
    else:
        print(f"[section-purity-guard] WARN: {msg}", file=sys.stderr)

    if publish_always:
        print(
            "[section-purity-guard] RESULT=PASS_WITH_WARN "
            "(publish-always incident logged, release continues)"
        )
        return 0

    print(f"[section-purity-guard] FAIL: {msg}", file=sys.stderr)
    print("[section-purity-guard] RESULT=FAIL")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
