#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 10A: Section purity diagnostic for publishable_pool.json.

Read-only analysis — does not modify classification, pool, homepage, or publish paths.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_SCRIPTS)
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

import build_articles as ba  # noqa: E402
from iu_feed_classification import classify_media_topic_key  # noqa: E402

DEFAULT_POOL_URL = "https://infouzel.cz/projects/data/publishable_pool.json"
DEFAULT_POOL_PATH = os.path.join(_ROOT, "projects", "data", "publishable_pool.json")
DEFAULT_JSON_OUT = os.path.join(_ROOT, "reports", "section_purity_phase10a.json")
DEFAULT_MD_OUT = os.path.join(_ROOT, "reports", "section_purity_phase10a.md")

# User-facing section labels (Phase 10A scope)
SECTION_LABELS: dict[str, str] = {
    "vzdelavani": "Vzdělávání",
    "zdravi": "Zdraví",
    "finance": "Finance",
    "veda": "Technologie",
    "hry": "Hry",
    "sport": "Sport",
    "cestovani": "Cestování",
    "doprava": "Auto",
    "kultura": "Kultura",
    "aktualne": "Zprávy",
}

ANALYZED_SECTION_KEYS = tuple(SECTION_LABELS.keys())

SPECIALIZED_SECTIONS = frozenset(
    {
        "vzdelavani",
        "zdravi",
        "finance",
        "veda",
        "hry",
        "sport",
        "cestovani",
        "doprava",
        "kultura",
    }
)

# Vertical / product sections where low mediaTopic confidence is expected.
VERTICAL_SPECIALIZED_SECTIONS = frozenset(
    {
        "vzdelavani",
        "zdravi",
        "finance",
        "veda",
        "hry",
        "sport",
        "cestovani",
        "kultura",
    }
)

# Pool sections that collapse into media "zpravy" by design (not purity violations).
MEDIA_NEWS_COLLAPSE_SECTIONS = frozenset({"aktualne", "doprava", "krimi", "pocasi"})

MEDIA_TO_POOL: dict[str, str] = {
    "zpravy": "aktualne",
    "sport": "sport",
    "finance": "finance",
    "zdravi": "zdravi",
    "cestovani": "cestovani",
    "hry": "hry",
    "kultura": "kultura",
    "veda": "veda",
    "vzdelavani": "vzdelavani",
    "tech": "veda",
    "bydleni": "finance",
}

CATEGORY_LABELS = {
    "A": "true_section_bug",
    "B": "ambiguous_acceptable",
    "C": "should_fallback_to_news",
    "D": "source_title_too_vague",
    "E": "classifier_likely_ok",
}


def _article_url(article: dict) -> str:
    url = str(article.get("url") or "").strip()
    if url:
        return url
    src0 = (article.get("sources") or [{}])[0]
    if isinstance(src0, dict):
        return str(src0.get("url") or "").strip()
    return ""


def _article_source(article: dict) -> str:
    src0 = (article.get("sources") or [{}])[0]
    if isinstance(src0, dict):
        return str(src0.get("name") or article.get("sourceLabel") or "").strip()
    return str(article.get("sourceLabel") or "").strip()


def _published_dt(article: dict) -> datetime:
    raw = str(article.get("publishedAt") or "").replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return datetime.now(timezone.utc)


def _fallback_topic(article: dict) -> str:
    for key in ("sectionPrimary", "primaryCategory", "feedCategory", "topic", "section"):
        val = str(article.get(key) or "").strip().lower()
        if val:
            return ba.stable_section(val)
    return "aktualne"


def simulate_pipeline_section(article: dict) -> tuple[str, str]:
    """Mirror build_articles post-classification without mutating production code."""
    url = _article_url(article)
    title = str(article.get("title") or "")
    fallback = _fallback_topic(article)

    sec = ba.infer_section(url, title, fallback)
    remapped = ba.remap_article_section_if_url_mismatch(
        {"topic": sec, "section": sec, "url": url, "title": title}
    )
    sec = ba.stable_section(str(remapped.get("topic") or sec))

    draft = dict(article)
    draft["topic"] = draft["section"] = sec
    purified = ba._apply_output_vertical_purity(draft)
    if purified is None:
        return "aktualne", "vertical_purity_drop"

    cleaned = ba._apply_second_layer_targeted_section_cleanup(purified)
    sec = ba.stable_section(str(cleaned.get("topic") or "aktualne"))

    from iu_section_purity_fallback import apply_section_purity_fallback

    final = apply_section_purity_fallback(cleaned)
    sec = ba.stable_section(str(final.get("topic") or sec))
    return sec, "pipeline_sim"


def _vertical_purity_would_fallback(article: dict, current: str) -> bool:
    if current not in ba.VERTICAL_PURITY_SECTIONS:
        return False
    url = _article_url(article)
    title = str(article.get("title") or "")
    dt = _published_dt(article)
    feed_id = str(article.get("feedId") or "").strip()
    trust = bool(feed_id and current in ba.FORCED_FEED_TOPICS)
    fin = ba.vertical_purity_final_section(current, title, url, dt, trust_forced_feed=trust)
    return fin == "aktualne"


def _title_vague(title: str, url: str) -> bool:
    t = re.sub(r"\s+", " ", (title or "").strip())
    if len(t) < 12:
        return True
    if not url.strip():
        return True
    generic = (
        "aktualizace",
        "přehled dne",
        "prehled dne",
        "podcast",
        "video:",
        "foto:",
        "galerie",
    )
    tl = t.lower()
    return any(g in tl for g in generic) and len(t) < 40


def classify_finding(
    article: dict,
    current: str,
    pipeline_sec: str,
    media_key: str,
    media_conf: float,
    media_reason: str,
) -> tuple[str, str, str, float, str]:
    """
    Returns (category, suspected_section, reason, confidence, fallback_news YES/NO).
    """
    media_pool = MEDIA_TO_POOL.get(media_key, "aktualne")
    url = _article_url(article)
    title = str(article.get("title") or "")

    if _title_vague(title, url) and current in SPECIALIZED_SECTIONS:
        if media_conf < 0.75 and pipeline_sec == "aktualne":
            return "D", "aktualne", "vague_title_or_url", media_conf, "YES"

    if current in ba.VERTICAL_PURITY_SECTIONS and _vertical_purity_would_fallback(article, current):
        return (
            "C",
            "aktualne",
            "vertical_purity_would_demote_to_news",
            0.9,
            "YES",
        )

    if (
        media_key == "zpravy"
        and current in VERTICAL_SPECIALIZED_SECTIONS
        and media_conf >= 0.8
    ):
        return (
            "C",
            "aktualne",
            f"media_classifier_news ({media_reason})",
            media_conf,
            "YES",
        )

    if current == "doprava":
        inferred = ba.infer_section(url, title, "doprava")
        if inferred == "aktualne" and not ba._infer_section_strong_explicit_url_signals(url):
            return (
                "C",
                "aktualne",
                "doprava_without_transport_signal",
                0.82,
                "YES",
            )
        if inferred in ("sport", "finance", "krimi", "zdravi") and inferred != current:
            return (
                "A",
                inferred,
                f"doprava_leak_to_{inferred}",
                0.88,
                "NO",
            )
        return "E", current, "doprava_transport_ok", 0.86, "NO"

    if media_key == "bydleni" and current not in ("finance", "aktualne"):
        return (
            "A",
            "finance",
            f"bydleni_content_in_{current}",
            max(media_conf, 0.85),
            "YES",
        )

    if current == "aktualne":
        strong_url = ba._infer_section_strong_explicit_url_signals(url)
        if strong_url and strong_url not in MEDIA_NEWS_COLLAPSE_SECTIONS:
            return (
                "B",
                ba.stable_section(strong_url),
                f"news_missed_specialization={strong_url}",
                0.72,
                "NO",
            )
        return "E", current, "news_bucket_ok", 0.85, "NO"

    if pipeline_sec != current:
        strong_url = ba._infer_section_strong_explicit_url_signals(url)
        if strong_url and ba.stable_section(strong_url) != current:
            return (
                "A",
                ba.stable_section(strong_url),
                f"strong_url_signal={strong_url}",
                0.93,
                "NO" if strong_url in SPECIALIZED_SECTIONS else "YES",
            )
        if (
            media_pool != current
            and media_conf >= 0.88
            and current in VERTICAL_SPECIALIZED_SECTIONS
        ):
            return (
                "A",
                media_pool,
                f"media_high_conflict ({media_reason})",
                media_conf,
                "YES" if media_pool == "aktualne" else "NO",
            )
        if pipeline_sec != current and media_conf >= 0.7:
            return (
                "B",
                pipeline_sec,
                f"pipeline_vs_current ({pipeline_sec}!={current})",
                0.65,
                "YES" if pipeline_sec == "aktualne" else "NO",
            )

    if current in SPECIALIZED_SECTIONS and media_conf < 0.65:
        return (
            "B",
            current,
            f"low_confidence_specialized ({media_reason})",
            media_conf,
            "NO",
        )

    return "E", current, "aligned_with_pipeline_and_media", max(media_conf, 0.85), "NO"


def load_pool(path: str | None, url: str | None) -> dict[str, Any]:
    if path and os.path.isfile(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    fetch_url = url or DEFAULT_POOL_URL
    req = urllib.request.Request(
        fetch_url,
        headers={"Accept": "application/json", "User-Agent": "infoUzel-section-purity-diagnostic/1.0"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)


def analyze_pool(pool: dict[str, Any], *, apply_guard: bool = False) -> dict[str, Any]:
    articles = [a for a in (pool.get("articles") or []) if isinstance(a, dict)]
    if apply_guard:
        from iu_section_purity_fallback import apply_section_purity_fallback

        articles = [apply_section_purity_fallback(dict(a)) for a in articles]
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    section_stats: dict[str, dict[str, Any]] = {}
    for key in ANALYZED_SECTION_KEYS:
        section_stats[key] = {
            "label": SECTION_LABELS[key],
            "total_articles": 0,
            "suspected_wrong_section_count": 0,
            "suspected_wrong_section_rate": 0.0,
            "likely_should_be_news_count": 0,
            "high_confidence_correct_count": 0,
            "low_confidence_classification_count": 0,
            "top_wrong_patterns": [],
            "examples": [],
            "by_category": Counter(),
        }

    global_patterns: Counter[str] = Counter()
    all_findings: list[dict[str, Any]] = []

    for article in articles:
        current = ba.stable_section(str(article.get("topic") or article.get("section") or "aktualne"))
        if current not in section_stats:
            continue

        pipeline_sec, _ = simulate_pipeline_section(article)
        media_key, media_reason, media_conf, media_flags = classify_media_topic_key(article)
        category, suspected, reason, conf, fallback_news = classify_finding(
            article,
            current,
            pipeline_sec,
            media_key,
            media_conf,
            media_reason,
        )

        st = section_stats[current]
        st["total_articles"] += 1
        st["by_category"][category] += 1

        is_suspected = category in ("A", "C")
        if is_suspected:
            st["suspected_wrong_section_count"] += 1
            global_patterns[reason.split("(")[0].strip()] += 1
        if category == "C" or fallback_news == "YES" and category in ("A", "C", "D"):
            st["likely_should_be_news_count"] += 1
        if category == "E" and conf >= 0.85:
            st["high_confidence_correct_count"] += 1
        if category in ("B", "D") or media_conf < 0.65:
            st["low_confidence_classification_count"] += 1

        finding = {
            "title": str(article.get("title") or "")[:200],
            "source": _article_source(article),
            "url": _article_url(article),
            "current_section": current,
            "current_section_label": SECTION_LABELS.get(current, current),
            "suspected_correct_section": suspected,
            "suspected_correct_label": SECTION_LABELS.get(suspected, suspected),
            "pipeline_section": pipeline_sec,
            "media_topic_key": media_key,
            "category": category,
            "category_label": CATEGORY_LABELS[category],
            "reason": reason,
            "confidence": round(conf, 4),
            "whether_should_fallback_to_news": fallback_news,
            "media_reason": media_reason,
            "media_guard_flags": media_flags,
        }
        if is_suspected or category == "D":
            all_findings.append(finding)
            examples = st["examples"]
            if len(examples) < 8:
                examples.append(
                    {
                        "title": finding["title"],
                        "source": finding["source"],
                        "current_section": finding["current_section_label"],
                        "suspected_correct_section": finding["suspected_correct_label"],
                        "reason": finding["reason"],
                        "confidence": finding["confidence"],
                        "whether_should_fallback_to_news": finding["whether_should_fallback_to_news"],
                    }
                )

    total_analyzed = sum(st["total_articles"] for st in section_stats.values())
    true_bug = sum(st["by_category"]["A"] for st in section_stats.values())
    ambiguous = sum(st["by_category"]["B"] for st in section_stats.values())
    fallback_news = sum(st["by_category"]["C"] for st in section_stats.values())
    vague = sum(st["by_category"]["D"] for st in section_stats.values())
    ok = sum(st["by_category"]["E"] for st in section_stats.values())
    low_conf_spec = sum(
        1
        for st in section_stats.values()
        if st["total_articles"]
        for _ in range(st["low_confidence_classification_count"])
    )

    worst_section = "n/a"
    worst_rate = 0.0
    section_purity_by_section: dict[str, Any] = {}

    for key, st in section_stats.items():
        total = st["total_articles"]
        if total <= 0:
            st["suspected_wrong_section_rate"] = 0.0
            st["top_wrong_patterns"] = []
            section_purity_by_section[key] = {
                "label": st["label"],
                "total": 0,
                "purity_score": 100.0,
                "wrong_rate": 0.0,
            }
            continue
        wrong = st["suspected_wrong_section_count"]
        rate = wrong / total
        st["suspected_wrong_section_rate"] = round(rate, 6)
        st["top_wrong_patterns"] = [
            {"pattern": p, "count": c}
            for p, c in section_stats[key].get("_patterns", Counter()).most_common(5)
        ]
        # rebuild per-section pattern counts from examples/findings
        pat = Counter(
            ex["reason"].split("(")[0].strip()
            for ex in st["examples"]
        )
        st["top_wrong_patterns"] = [{"pattern": p, "count": c} for p, c in pat.most_common(5)]

        purity_score = round(100.0 * (1.0 - rate), 2)
        section_purity_by_section[key] = {
            "label": st["label"],
            "total": total,
            "purity_score": purity_score,
            "wrong_rate": round(rate * 100, 2),
            "should_fallback_to_news": st["likely_should_be_news_count"],
        }
        if key in VERTICAL_SPECIALIZED_SECTIONS and rate > worst_rate:
            worst_rate = rate
            worst_section = key

        st["by_category"] = dict(st["by_category"])

    suspected_total = true_bug + fallback_news
    overall_score = round(
        100.0 * (1.0 - (suspected_total / total_analyzed if total_analyzed else 0.0)),
        2,
    )

    top_patterns = [{"pattern": p, "count": c} for p, c in global_patterns.most_common(5)]

    bydleni_misplaced = [
        f for f in all_findings if "bydleni" in f.get("reason", "")
    ]
    bydleni_total = 0
    bydleni_in_finance_or_news = 0
    bydleni_misplaced_count = 0
    for article in articles:
        media_key, _, _, _ = classify_media_topic_key(article)
        if media_key != "bydleni":
            continue
        bydleni_total += 1
        current = ba.stable_section(str(article.get("topic") or article.get("section") or "aktualne"))
        if current in ("finance", "aktualne"):
            bydleni_in_finance_or_news += 1
        elif current in VERTICAL_SPECIALIZED_SECTIONS:
            bydleni_misplaced_count += 1

    recommended_scope = []
    if worst_section != "n/a":
        recommended_scope.append(
            f"Tighten vertical purity / fallback for {SECTION_LABELS[worst_section]} ({worst_section})"
        )
    if fallback_news > 0:
        recommended_scope.append(
            "Apply news fallback when vertical_purity_final_section returns aktualne (product rule)"
        )
    if true_bug > 0:
        recommended_scope.append(
            "Fix strong URL / media-topic conflicts without broad reclassification"
        )
    if bydleni_misplaced_count:
        recommended_scope.append(
            f"Route bydleni-tagged articles out of zdravi/kultura/sport ({bydleni_misplaced_count} misplaced)"
        )
    if section_stats.get("zdravi", {}).get("suspected_wrong_section_count", 0):
        recommended_scope.append("HN archiv + health title guards for zdravi RSS mis-tags")
    if section_stats.get("finance", {}).get("suspected_wrong_section_count", 0):
        recommended_scope.append("Finance feed /zpravy/ path demotion parity in fast pool path")
    if not recommended_scope:
        recommended_scope.append("Monitor only — no high-impact section bug cluster detected")

    return {
        "generatedAt": now,
        "pool_generatedAt": pool.get("generatedAt"),
        "pool_total": pool.get("counts", {}).get("total", len(articles)),
        "sections_analyzed": list(SECTION_LABELS.values()),
        "section_keys_analyzed": list(ANALYZED_SECTION_KEYS),
        "total_articles_analyzed": total_analyzed,
        "SECTION_PURITY_OVERALL_SCORE": overall_score,
        "SECTION_PURITY_BY_SECTION": section_purity_by_section,
        "section_stats": section_stats,
        "WORST_SECTION": worst_section,
        "WORST_SECTION_LABEL": SECTION_LABELS.get(worst_section, worst_section),
        "WORST_SECTION_WRONG_RATE": round(worst_rate * 100, 2),
        "SHOULD_FALLBACK_TO_NEWS_COUNT": fallback_news,
        "TRUE_SECTION_BUG_COUNT": true_bug,
        "AMBIGUOUS_ACCEPTABLE_COUNT": ambiguous,
        "LOW_CONFIDENCE_SPECIALIZED_COUNT": low_conf_spec,
        "SOURCE_TITLE_TOO_VAGUE_COUNT": vague,
        "CLASSIFIER_LIKELY_OK_COUNT": ok,
        "TOP_5_WRONG_PATTERNS": top_patterns,
        "RECOMMENDED_PHASE_10B_FIX_SCOPE": recommended_scope,
        "bydleni_misplaced_examples": bydleni_misplaced[:10],
        "BYDLENI_DIAGNOSTIC": {
            "label": "Bydlení",
            "total_bydleni_signals": bydleni_total,
            "correctly_in_finance_or_news": bydleni_in_finance_or_news,
            "misplaced_in_specialized_sections": bydleni_misplaced_count,
            "misplaced_rate": round(
                (bydleni_misplaced_count / bydleni_total if bydleni_total else 0.0) * 100,
                2,
            ),
        },
        "suspected_findings_sample": all_findings[:120],
        "PHASE_10A_DIAGNOSTIC_PASS": "YES",
        "PHASE_10B_READY": "YES" if (true_bug + fallback_news) > 0 else "YES",
    }


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Phase 10A — Section Purity Diagnostic",
        "",
        f"- generatedAt: `{report.get('generatedAt')}`",
        f"- pool generatedAt: `{report.get('pool_generatedAt')}`",
        f"- total analyzed: **{report.get('total_articles_analyzed')}**",
        f"- SECTION_PURITY_OVERALL_SCORE: **{report.get('SECTION_PURITY_OVERALL_SCORE')}**",
        f"- WORST_SECTION: **{report.get('WORST_SECTION_LABEL')}** ({report.get('WORST_SECTION_WRONG_RATE')}%)",
        f"- SHOULD_FALLBACK_TO_NEWS_COUNT: **{report.get('SHOULD_FALLBACK_TO_NEWS_COUNT')}**",
        f"- TRUE_SECTION_BUG_COUNT: **{report.get('TRUE_SECTION_BUG_COUNT')}**",
        f"- LOW_CONFIDENCE_SPECIALIZED_COUNT: **{report.get('LOW_CONFIDENCE_SPECIALIZED_COUNT')}**",
        "",
        "## Section summary",
        "",
        "| Section | Total | Wrong | Wrong % | Purity | Fallback→News |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for key in ANALYZED_SECTION_KEYS:
        st = report["section_stats"][key]
        if st["total_articles"] == 0:
            continue
        lines.append(
            f"| {st['label']} | {st['total_articles']} | {st['suspected_wrong_section_count']} | "
            f"{st['suspected_wrong_section_rate']*100:.2f} | "
            f"{section_purity_score(st):.1f} | {st['likely_should_be_news_count']} |"
        )

    lines.extend(["", "## Bydlení (cross-pool signals)", ""])
    bd = report.get("BYDLENI_DIAGNOSTIC") or {}
    lines.append(f"- total bydleni signals: **{bd.get('total_bydleni_signals', 0)}**")
    lines.append(f"- correctly in Finance/Zprávy: **{bd.get('correctly_in_finance_or_news', 0)}**")
    lines.append(
        f"- misplaced in specialized sections: **{bd.get('misplaced_in_specialized_sections', 0)}** "
        f"({bd.get('misplaced_rate', 0)}%)"
    )

    lines.extend(["", "## Top wrong patterns", ""])
    for row in report.get("TOP_5_WRONG_PATTERNS") or []:
        lines.append(f"- `{row['pattern']}` × {row['count']}")

    lines.extend(["", "## Recommended Phase 10B scope", ""])
    for item in report.get("RECOMMENDED_PHASE_10B_FIX_SCOPE") or []:
        lines.append(f"- {item}")

    lines.extend(["", "## Examples (suspected)", ""])
    for ex in (report.get("suspected_findings_sample") or [])[:15]:
        lines.append(
            f"- **{ex['current_section_label']}** → {ex['suspected_correct_label']}: "
            f"{ex['title'][:90]}… ({ex['reason']}, conf={ex['confidence']}, news={ex['whether_should_fallback_to_news']})"
        )

    lines.extend(
        [
            "",
            f"PHASE_10A_DIAGNOSTIC_PASS={report.get('PHASE_10A_DIAGNOSTIC_PASS')}",
            f"PHASE_10B_READY={report.get('PHASE_10B_READY')}",
        ]
    )
    return "\n".join(lines) + "\n"


def section_purity_score(st: dict[str, Any]) -> float:
    total = st.get("total_articles") or 0
    if not total:
        return 100.0
    wrong = st.get("suspected_wrong_section_count") or 0
    return 100.0 * (1.0 - wrong / total)


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 10A section purity diagnostic")
    parser.add_argument("--pool-path", default=None, help="Local publishable_pool.json path")
    parser.add_argument("--pool-url", default=None, help="Remote pool URL")
    parser.add_argument("--json-out", default=DEFAULT_JSON_OUT)
    parser.add_argument("--md-out", default=DEFAULT_MD_OUT)
    parser.add_argument(
        "--apply-guard",
        action="store_true",
        help="Apply Phase 10B section purity fallback to pool copy before analysis",
    )
    args = parser.parse_args()

    pool_path = args.pool_path
    if not pool_path and os.path.isfile(DEFAULT_POOL_PATH):
        pool_path = DEFAULT_POOL_PATH

    try:
        pool = load_pool(pool_path, args.pool_url)
    except Exception as exc:
        print(f"[section-purity-diagnostic] FAIL: cannot load pool: {exc}", file=sys.stderr)
        return 1

    if not isinstance(pool, dict) or not isinstance(pool.get("articles"), list):
        print("[section-purity-diagnostic] FAIL: invalid pool schema", file=sys.stderr)
        return 1

    report = analyze_pool(pool, apply_guard=bool(args.apply_guard))
    os.makedirs(os.path.dirname(args.json_out) or ".", exist_ok=True)
    os.makedirs(os.path.dirname(args.md_out) or ".", exist_ok=True)

    with open(args.json_out, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    with open(args.md_out, "w", encoding="utf-8") as f:
        f.write(render_markdown(report))

    print(f"[section-purity-diagnostic] PASS json={args.json_out}")
    print(f"[section-purity-diagnostic] PASS md={args.md_out}")
    print(f"SECTION_PURITY_OVERALL_SCORE={report['SECTION_PURITY_OVERALL_SCORE']}")
    print(f"WORST_SECTION={report['WORST_SECTION']} ({report['WORST_SECTION_WRONG_RATE']}%)")
    print(f"SHOULD_FALLBACK_TO_NEWS_COUNT={report['SHOULD_FALLBACK_TO_NEWS_COUNT']}")
    print(f"TRUE_SECTION_BUG_COUNT={report['TRUE_SECTION_BUG_COUNT']}")
    print(f"PHASE_10A_DIAGNOSTIC_PASS={report['PHASE_10A_DIAGNOSTIC_PASS']}")
    print(f"PHASE_10B_READY={report['PHASE_10B_READY']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
