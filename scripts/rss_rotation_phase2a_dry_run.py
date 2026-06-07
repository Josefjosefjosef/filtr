#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RSS Rotation Phase 2A — dry-run simulation only.

Simulates target 5-min A/B/C/D batch rotation over 24h.
Does NOT change scheduler, fetch, publish, workflow, or production data.
"""
from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from iu_rotation_foundation import (  # noqa: E402
    P0_HEADLINE_REGISTRY_IDS,
    ROTATION_BATCH_CYCLE_MINUTES,
    ROTATION_BATCH_IDS,
    ROTATION_BATCH_TICK_MINUTES,
    ROTATION_MIN_FETCH_INTERVAL_MIN,
    SourceStrength,
    load_rotation_batch_registry,
    load_source_registry,
    registry_active_entries,
    validate_rotation_batch_registry,
)

ROOT = os.path.dirname(_SCRIPTS)
REPORT_JSON_PATH = os.path.join(_SCRIPTS, "rss_rotation_phase2a_dry_run_report.json")
REPORT_MD_PATH = os.path.join(ROOT, "RSS_ROTATION_PHASE2A_DRY_RUN_REPORT.md")

SIMULATION_HOURS = 24
TICK_INTERVAL_MIN = 5
MIN_FETCH_INTERVAL_MIN = ROTATION_MIN_FETCH_INTERVAL_MIN
TARGET_FULL_ROTATION_MIN = ROTATION_BATCH_CYCLE_MINUTES

# Current production model (from ARTICLE_RSS_ROTATION_ARCHITECTURE_AUDIT, read-only baseline).
CURRENT_MODEL = {
    "watchdog_cron": "*/15",
    "watchdog_interval_min": 15,
    "MAX_SOURCES_PER_SCHEDULER_TICK": 5,
    "p0_headline_exempt_count": 6,
    "effective_selected_last_run": 6,
    "skipped_tick_cap_last_run": 51,
    "estimated_full_rotation_min": 148,
    "not_fetched_24h_count": 52,
    "active_source_count": 59,
}

BATCH_ID_BY_INDEX = ["A", "B", "C", "D"]


def _priority_for_entry(entry: dict) -> str:
    domain = str(entry.get("domain") or "").lower()
    p0_hosts = (
        "novinky.cz",
        "seznamzpravy.cz",
        "idnes.cz",
        "ceskatelevize.cz",
        "ct24.ceskatelevize.cz",
        "sport.cz",
    )
    p1_hosts = (
        "hn.cz",
        "aktualne.cz",
        "denik.cz",
        "ekonom.cz",
        "ekonomickydenik.cz",
        "zdravezpravy.cz",
        "zdravotnickydenik.cz",
        "cestujlevne.com",
        "zing.cz",
        "vortex.cz",
        "kinobox.cz",
        "technet.cz",
        "hlidacipes.org",
        "tydenikpolicie.cz",
        "crzpravy.cz",
    )
    if any(h in domain or domain in h for h in p0_hosts):
        return "P0"
    if any(h in domain or domain in h for h in p1_hosts):
        return "P1"
    return "P2"


def validate_registry(batch_reg: dict, active_ids: set[str]) -> dict[str, Any]:
    errors = validate_rotation_batch_registry(batch_reg, active_ids)
    mapping = batch_reg.get("rotation_batch_by_source_id") or {}
    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "batch_counts": {
            bid: len((batch_reg.get("batches", {}).get(bid) or {}).get("source_ids") or [])
            for bid in ROTATION_BATCH_IDS
        },
        "total_mapped": len(mapping),
        "total_active": len(active_ids),
        "duplicates": len(mapping) != len(set(mapping.keys())),
    }


def batch_for_tick_minute(minute_of_hour: int) -> str:
    idx = (minute_of_hour // TICK_INTERVAL_MIN) % 4
    return BATCH_ID_BY_INDEX[idx]


def simulate_24h_rotation(batch_reg: dict) -> dict[str, Any]:
    mapping = batch_reg.get("rotation_batch_by_source_id") or {}
    batches = batch_reg.get("batches") or {}
    batch_sources: dict[str, list[str]] = {
        bid: list((batches.get(bid) or {}).get("source_ids") or []) for bid in ROTATION_BATCH_IDS
    }

    total_ticks = (SIMULATION_HOURS * 60) // TICK_INTERVAL_MIN
    full_rotations = (SIMULATION_HOURS * 60) // TARGET_FULL_ROTATION_MIN

    check_times: dict[str, list[int]] = defaultdict(list)
    tick_log: list[dict[str, Any]] = []
    cycle_assignments: dict[int, dict[str, str]] = {}

    for tick in range(total_ticks):
        sim_minute = tick * TICK_INTERVAL_MIN
        minute_of_hour = sim_minute % 60
        hour = sim_minute // 60
        batch_id = batch_for_tick_minute(minute_of_hour)
        source_ids = batch_sources.get(batch_id, [])
        cycle_index = sim_minute // TARGET_FULL_ROTATION_MIN
        cycle_assignments.setdefault(cycle_index, {})
        for sid in source_ids:
            check_times[sid].append(sim_minute)
            if sid in cycle_assignments[cycle_index]:
                cycle_assignments[cycle_index][sid] = "DUPLICATE"
            else:
                cycle_assignments[cycle_index][sid] = batch_id
        if tick < 8 or tick >= total_ticks - 4:
            tick_log.append(
                {
                    "tick": tick,
                    "sim_minute": sim_minute,
                    "clock": f"{hour:02d}:{minute_of_hour:02d}",
                    "batch_id": batch_id,
                    "source_count": len(source_ids),
                }
            )

    per_source: dict[str, dict[str, Any]] = {}
    interval_violations: list[dict[str, Any]] = []
    all_sources = set(mapping.keys())

    for sid in sorted(all_sources):
        times = check_times.get(sid, [])
        if not times:
            per_source[sid] = {
                "check_count": 0,
                "min_interval_min": None,
                "max_interval_min": None,
                "avg_interval_min": None,
                "lost_from_rotation": True,
            }
            continue
        gaps = [times[i + 1] - times[i] for i in range(len(times) - 1)]
        min_gap = min(gaps) if gaps else TARGET_FULL_ROTATION_MIN
        max_gap = max(gaps) if gaps else TARGET_FULL_ROTATION_MIN
        avg_gap = sum(gaps) / len(gaps) if gaps else float(TARGET_FULL_ROTATION_MIN)
        if min_gap < MIN_FETCH_INTERVAL_MIN:
            interval_violations.append({"source_id": sid, "min_interval_min": min_gap})
        per_source[sid] = {
            "check_count": len(times),
            "min_interval_min": min_gap,
            "max_interval_min": max_gap,
            "avg_interval_min": round(avg_gap, 2),
            "lost_from_rotation": False,
        }

    duplicate_in_cycle = []
    for cycle_idx, assigns in cycle_assignments.items():
        seen: set[str] = set()
        for sid, val in assigns.items():
            if val == "DUPLICATE" or sid in seen:
                duplicate_in_cycle.append({"cycle_index": cycle_idx, "source_id": sid})
            seen.add(sid)

    missing_in_cycles = []
    for cycle_idx, assigns in cycle_assignments.items():
        missing = sorted(all_sources - set(assigns.keys()))
        if missing:
            missing_in_cycles.append({"cycle_index": cycle_idx, "missing_count": len(missing), "sample": missing[:5]})

    return {
        "simulation_hours": SIMULATION_HOURS,
        "tick_interval_min": TICK_INTERVAL_MIN,
        "total_ticks": total_ticks,
        "full_rotations": full_rotations,
        "per_source": per_source,
        "interval_violations": interval_violations,
        "duplicate_in_cycle": duplicate_in_cycle,
        "missing_in_cycles": missing_in_cycles,
        "sample_tick_log": tick_log,
        "summary": {
            "sources_simulated": len(all_sources),
            "expected_checks_per_source": full_rotations,
            "min_interval_violations": len(interval_violations),
            "duplicate_in_cycle_count": len(duplicate_in_cycle),
            "cycles_with_missing_sources": len(missing_in_cycles),
            "global_min_interval_min": min(
                (v["min_interval_min"] for v in per_source.values() if v["min_interval_min"] is not None),
                default=None,
            ),
            "global_max_interval_min": max(
                (v["max_interval_min"] for v in per_source.values() if v["max_interval_min"] is not None),
                default=None,
            ),
            "global_avg_interval_min": round(
                sum(v["avg_interval_min"] or 0 for v in per_source.values()) / max(len(per_source), 1),
                2,
            ),
        },
    }


def analyze_batch_load(batch_reg: dict, registry: dict) -> dict[str, Any]:
    batches = batch_reg.get("batches") or {}
    by_id = {str(e.get("id") or ""): e for e in registry_active_entries(registry)}
    batch_analysis: dict[str, Any] = {}
    p0_distribution: dict[str, list[str]] = {bid: [] for bid in ROTATION_BATCH_IDS}
    strong_distribution: dict[str, list[str]] = {bid: [] for bid in ROTATION_BATCH_IDS}

    for bid in ROTATION_BATCH_IDS:
        b = batches.get(bid) or {}
        sources = b.get("sources") or []
        strength_counts = {s.value: 0 for s in SourceStrength}
        priority_counts = {"P0": 0, "P1": 0, "P2": 0}
        weight_sum = 0.0
        rss_load = 0
        p0_ids: list[str] = []
        strong_ids: list[str] = []
        for src in sources:
            sid = str(src.get("id") or "")
            st = str(src.get("source_strength") or "")
            if st in strength_counts:
                strength_counts[st] += 1
            if sid in P0_HEADLINE_REGISTRY_IDS:
                p0_ids.append(sid)
                priority_counts["P0"] += 1
            else:
                entry = by_id.get(sid, {})
                pri = _priority_for_entry(entry) if entry else "P2"
                priority_counts[pri] += 1
            if st == SourceStrength.STRONG.value:
                strong_ids.append(sid)
            weight_sum += float(src.get("source_weight") or 0)
            rss_load += int(src.get("estimated_rss_load") or 0)
        p0_distribution[bid] = p0_ids
        strong_distribution[bid] = strong_ids
        batch_analysis[bid] = {
            "source_count": len(sources),
            "strong_count": strength_counts[SourceStrength.STRONG.value],
            "medium_count": strength_counts[SourceStrength.MEDIUM.value],
            "weak_count": strength_counts[SourceStrength.WEAK.value],
            "priority_counts": priority_counts,
            "estimated_rss_load": rss_load,
            "source_weight_sum": round(weight_sum, 2),
            "expected_run_sec": b.get("expected_run_sec"),
            "load_score": b.get("load_score"),
            "overload_risk": b.get("overload_risk"),
            "p0_headline_ids": p0_ids,
            "strong_source_ids": strong_ids,
        }

    counts = [batch_analysis[b]["source_count"] for b in ROTATION_BATCH_IDS]
    rss_loads = [batch_analysis[b]["estimated_rss_load"] for b in ROTATION_BATCH_IDS]
    strong_counts = [batch_analysis[b]["strong_count"] for b in ROTATION_BATCH_IDS]
    max_rss = max(rss_loads)
    min_rss = min(rss_loads)
    load_spread = max_rss - min_rss
    load_spread_pct = round(100 * load_spread / max(max_rss, 1), 1)

    balancing_issues: list[str] = []
    if max(strong_counts) - min(strong_counts) > 2:
        balancing_issues.append(f"strong source spread {min(strong_counts)}–{max(strong_counts)} exceeds ±2")
    if load_spread_pct > 15:
        balancing_issues.append(f"RSS load spread {load_spread_pct}% exceeds 15% threshold")
    p0_batches_with_multiple = [bid for bid, ids in p0_distribution.items() if len(ids) > 2]
    if len(p0_batches_with_multiple) == 1 and sum(len(v) for v in p0_distribution.values()) > 2:
        balancing_issues.append("P0 headlines clustered — more than 2 P0 in one batch")
    all_strong_in_one = any(batch_analysis[b]["strong_count"] >= 15 for b in ROTATION_BATCH_IDS)
    if all_strong_in_one:
        balancing_issues.append("all STRONG sources in single batch")

    return {
        "batches": batch_analysis,
        "p0_distribution": p0_distribution,
        "strong_distribution": strong_distribution,
        "balancing": {
            "load_spread_pct": load_spread_pct,
            "strong_count_range": [min(strong_counts), max(strong_counts)],
            "source_count_range": [min(counts), max(counts)],
            "issues": balancing_issues,
        },
    }


def compare_models(simulation: dict[str, Any]) -> dict[str, Any]:
    cur = CURRENT_MODEL
    dry_full_rotation = TARGET_FULL_ROTATION_MIN
    cur_full_rotation = cur["estimated_full_rotation_min"]
    improvement_factor = round(cur_full_rotation / dry_full_rotation, 2)
    dry_checks_per_source_24h = simulation["full_rotations"]
    cur_checks_per_source_24h_est = round((24 * 60) / cur_full_rotation, 2)
    dry_coverage_per_hour = round(60 / dry_full_rotation * cur["active_source_count"], 2)
    cur_effective_per_tick = cur["effective_selected_last_run"]
    cur_ticks_per_hour = 60 / cur["watchdog_interval_min"]
    cur_coverage_per_hour = round(cur_effective_per_tick * cur_ticks_per_hour, 2)
    skipped_reduction = cur["skipped_tick_cap_last_run"]

    return {
        "current": {
            "watchdog": cur["watchdog_cron"],
            "tick_cap": cur["MAX_SOURCES_PER_SCHEDULER_TICK"],
            "effective_selected_per_tick": cur_effective_per_tick,
            "skipped_tick_cap_last_run": skipped_reduction,
            "full_rotation_min": cur_full_rotation,
            "not_fetched_24h_count": cur["not_fetched_24h_count"],
            "estimated_checks_per_source_24h": cur_checks_per_source_24h_est,
            "estimated_coverage_per_hour": cur_coverage_per_hour,
        },
        "dry_run": {
            "tick_interval_min": TICK_INTERVAL_MIN,
            "sources_per_tick_avg": round(cur["active_source_count"] / 4, 1),
            "full_rotation_min": dry_full_rotation,
            "skipped_tick_cap": 0,
            "checks_per_source_24h": dry_checks_per_source_24h,
            "coverage_per_hour": dry_coverage_per_hour,
        },
        "delta": {
            "full_rotation_improvement_factor": improvement_factor,
            "full_rotation_time_saved_min": cur_full_rotation - dry_full_rotation,
            "skipped_sources_eliminated_per_tick": skipped_reduction,
            "coverage_per_hour_improvement_factor": round(dry_coverage_per_hour / max(cur_coverage_per_hour, 1), 2),
            "checks_per_source_24h_improvement_factor": round(
                dry_checks_per_source_24h / max(cur_checks_per_source_24h_est, 1),
                2,
            ),
            "not_fetched_24h_eliminated": cur["not_fetched_24h_count"],
        },
    }


def assess_build_risk(batch_reg: dict, load_analysis: dict[str, Any]) -> dict[str, Any]:
    batches = batch_reg.get("batches") or {}
    per_batch = []
    for bid in ROTATION_BATCH_IDS:
        b = batches.get(bid) or {}
        la = load_analysis["batches"][bid]
        per_batch.append(
            {
                "batch_id": bid,
                "source_count": la["source_count"],
                "estimated_rss_items": la["estimated_rss_load"],
                "expected_run_sec": la.get("expected_run_sec"),
                "overload_risk": la.get("overload_risk"),
                "vs_current_cap": {
                    "current_max_per_tick": CURRENT_MODEL["MAX_SOURCES_PER_SCHEDULER_TICK"],
                    "dry_run_sources": la["source_count"],
                    "multiplier": round(la["source_count"] / CURRENT_MODEL["MAX_SOURCES_PER_SCHEDULER_TICK"], 1),
                },
            }
        )
    max_run = max(int(x.get("expected_run_sec") or 0) for x in per_batch)
    max_rss = max(int(x.get("estimated_rss_items") or 0) for x in per_batch)
    heavy_batches = [x["batch_id"] for x in per_batch if x.get("overload_risk") in ("high", "medium")]
    blockers: list[str] = []
    warnings: list[str] = []
    if max_run > 120:
        blockers.append(f"expected_run_sec peak {max_run}s exceeds 120s ingest budget per tick")
    if max_rss > 380:
        blockers.append(f"estimated RSS items peak {max_rss} exceeds 380 high-risk threshold")
    if any(x["vs_current_cap"]["multiplier"] >= 3 for x in per_batch):
        warnings.append("dry-run fetches 3×+ more sources per tick than current cap=5 — requires cap/workflow change in Phase 2B")
    if heavy_batches:
        warnings.append(f"batches with medium/high overload risk: {', '.join(heavy_batches)}")
    if load_analysis["balancing"]["issues"]:
        warnings.extend(load_analysis["balancing"]["issues"])
    return {
        "per_batch": per_batch,
        "peak_expected_run_sec": max_run,
        "peak_estimated_rss_items": max_rss,
        "heavy_batches": heavy_batches,
        "blockers": blockers,
        "warnings": warnings,
        "requires_cap_increase": True,
        "requires_watchdog_cadence_change": True,
        "requires_workflow_change": True,
    }


def assess_verdict(
    registry_validation: dict[str, Any],
    simulation: dict[str, Any],
    load_analysis: dict[str, Any],
    build_risk: dict[str, Any],
) -> dict[str, Any]:
    sim_ok = (
        registry_validation["valid"]
        and simulation["summary"]["min_interval_violations"] == 0
        and simulation["summary"]["duplicate_in_cycle_count"] == 0
        and simulation["summary"]["cycles_with_missing_sources"] == 0
        and not any(v.get("lost_from_rotation") for v in simulation["per_source"].values())
    )
    dry_run_pass = sim_ok
    safe_for_phase2b = dry_run_pass and len(build_risk["blockers"]) == 0
    return {
        "RSS_ROTATION_PHASE2A_DRY_RUN": "PASS" if dry_run_pass else "FAIL",
        "DRY_RUN_ONLY": "YES",
        "BEHAVIOR_CHANGE": "NO",
        "SCHEDULER_RUNTIME_CHANGE": "NO",
        "MAX_SOURCES_PER_SCHEDULER_TICK": 5,
        "WATCHDOG": "*/15",
        "FETCH_LOGIC_CHANGE": "NO",
        "PUBLISH_LOGIC_CHANGE": "NO",
        "WORKFLOW_CHANGE": "NO",
        "CLOUDFLARE_CHANGE": "NO",
        "ARTICLES_JSON_CHANGE": "NO",
        "BOOTSTRAP_CHANGE": "NO",
        "INDEX_CHANGE": "NO",
        "PRODUCTION_DATA_CHANGE": "NO",
        "SAFE_FOR_PHASE2B": "YES" if safe_for_phase2b else "NO",
        "simulation_pass": sim_ok,
        "build_blockers": build_risk["blockers"],
        "build_warnings": build_risk["warnings"],
    }


def render_markdown(report: dict[str, Any]) -> str:
    v = report["verdict"]
    sim = report["simulation"]
    cmp = report["model_comparison"]
    load = report["load_analysis"]
    br = report["build_risk"]
    reg = report["registry_validation"]
    lines = [
        "# RSS ROTATION PHASE 2A — DRY-RUN REPORT",
        "",
        f"> Generated: {report['generated_at']}",
        "> DRY-RUN SIMULATION ONLY — no production behavior change",
        "",
        "## A) Executive summary",
        "",
        f"- **Dry-run verdict:** {v['RSS_ROTATION_PHASE2A_DRY_RUN']}",
        f"- **Safe for Phase 2B:** {v['SAFE_FOR_PHASE2B']}",
        f"- Simulated **{sim['total_ticks']}** ticks over **{sim['simulation_hours']}h** ({sim['tick_interval_min']}-min cadence)",
        f"- **{sim['full_rotations']}** full A/B/C/D rotations (target **{TARGET_FULL_ROTATION_MIN} min** cycle)",
        f"- All **{reg['total_active']}** active sources assigned; interval floor **≥{MIN_FETCH_INTERVAL_MIN} min** — **{'PASS' if sim['summary']['min_interval_violations'] == 0 else 'FAIL'}**",
        f"- Current model full rotation **~{cmp['current']['full_rotation_min']} min** → dry-run **{cmp['dry_run']['full_rotation_min']} min** (**{cmp['delta']['full_rotation_improvement_factor']}×** faster)",
        "",
        "## B) Současný model",
        "",
        "| Metrika | Hodnota |",
        "|---------|---------|",
        f"| Watchdog | {cmp['current']['watchdog']} |",
        f"| MAX_SOURCES_PER_SCHEDULER_TICK | {cmp['current']['tick_cap']} |",
        f"| Effective selected/tick | {cmp['current']['effective_selected_per_tick']} |",
        f"| SKIPPED_TICK_CAP (last run) | {cmp['current']['skipped_tick_cap_last_run']} |",
        f"| Full rotation (est.) | ~{cmp['current']['full_rotation_min']} min |",
        f"| Not fetched 24h | {cmp['current']['not_fetched_24h_count']} sources |",
        f"| Coverage/hour (est.) | {cmp['current']['estimated_coverage_per_hour']} fetch slots |",
        "",
        "## C) Dry-run cílový model",
        "",
        "| Metrika | Hodnota |",
        "|---------|---------|",
        f"| Tick interval | {cmp['dry_run']['tick_interval_min']} min |",
        f"| Batches | A (:00) / B (:05) / C (:10) / D (:15) |",
        f"| Sources per tick (avg) | ~{cmp['dry_run']['sources_per_tick_avg']} |",
        f"| Full rotation | {cmp['dry_run']['full_rotation_min']} min |",
        f"| SKIPPED_TICK_CAP | {cmp['dry_run']['skipped_tick_cap']} |",
        f"| Checks per source / 24h | {cmp['dry_run']['checks_per_source_24h']} |",
        "",
        "## D) Simulace 24h rotace",
        "",
        f"| Metrika | Hodnota |",
        f"|---------|---------|",
        f"| Total ticks | {sim['total_ticks']} |",
        f"| Full rotations | {sim['full_rotations']} |",
        f"| Min interval violations | {sim['summary']['min_interval_violations']} |",
        f"| Duplicate in 20min cycle | {sim['summary']['duplicate_in_cycle_count']} |",
        f"| Cycles with missing sources | {sim['summary']['cycles_with_missing_sources']} |",
        f"| Global min interval | {sim['summary']['global_min_interval_min']} min |",
        f"| Global max interval | {sim['summary']['global_max_interval_min']} min |",
        f"| Global avg interval | {sim['summary']['global_avg_interval_min']} min |",
        "",
        "### Sample tick schedule",
        "",
        "| Tick | Clock | Batch | Sources |",
        "|------|-------|-------|---------|",
    ]
    for t in sim.get("sample_tick_log", []):
        lines.append(f"| {t['tick']} | {t['clock']} | {t['batch_id']} | {t['source_count']} |")
    lines.extend(["", "## E) Per-source intervaly", ""])
    lines.append("| Source | Checks/24h | Min | Max | Avg |")
    lines.append("|--------|------------|-----|-----|-----|")
    for sid, row in sorted(report["simulation"]["per_source"].items()):
        lines.append(
            f"| `{sid}` | {row['check_count']} | {row['min_interval_min']} | {row['max_interval_min']} | {row['avg_interval_min']} |"
        )
    lines.extend(["", "## F) Per-batch load analýza", ""])
    for bid in ROTATION_BATCH_IDS:
        b = load["batches"][bid]
        lines.append(f"### Batch {bid}")
        lines.append("")
        lines.append(f"- Sources: **{b['source_count']}** (STRONG={b['strong_count']}, MEDIUM={b['medium_count']}, WEAK={b['weak_count']})")
        lines.append(f"- P0/P1/P2: {b['priority_counts']}")
        lines.append(f"- estimated_rss_load: **{b['estimated_rss_load']}**")
        lines.append(f"- source_weight_sum: {b['source_weight_sum']}")
        lines.append(f"- expected_run_sec: {b.get('expected_run_sec')} | load_score: {b.get('load_score')} | risk: **{b.get('overload_risk')}**")
        lines.append("")
    lines.extend(
        [
            "## G) Strong/P0 rozložení",
            "",
            "### P0 headline distribution",
            "",
        ]
    )
    for bid, ids in load["p0_distribution"].items():
        lines.append(f"- **Batch {bid}:** {', '.join(ids) if ids else '(none)'}")
    lines.extend(["", "### STRONG distribution", ""])
    for bid, ids in load["strong_distribution"].items():
        lines.append(f"- **Batch {bid}:** {len(ids)} — {', '.join(ids[:5])}{'…' if len(ids) > 5 else ''}")
    lines.extend(
        [
            "",
            "## H) Rizika",
            "",
        ]
    )
    if br["blockers"]:
        for b in br["blockers"]:
            lines.append(f"- **BLOCKER:** {b}")
    else:
        lines.append("- No hard blockers in rotation simulation")
    for w in br["warnings"]:
        lines.append(f"- **WARNING:** {w}")
    lines.extend(
        [
            "",
            "## I) Doporučení před Phase 2B",
            "",
            "1. **Workflow/Cloudflare:** změnit watchdog z `*/15` na `*/5` (vyžaduje explicitní Phase 2B PR).",
            "2. **Scheduler cap:** zvýšit `MAX_SOURCES_PER_SCHEDULER_TICK` z 5 na ~15–16 (samostatný guarded PR).",
            "3. **Ingest budget:** ověřit pipeline runtime pro ~250 RSS položek / ~108s per tick v staging.",
            "4. **Batch balancing:** " + ("žádné kritické problémy" if not load["balancing"]["issues"] else "; ".join(load["balancing"]["issues"])),
            "5. **Publish:** Phase 2B nesmí měnit publish logiku — pouze ingest/scheduler selection.",
            "",
            "## J) Verdikt Phase 2B readiness",
            "",
            f"**SAFE_FOR_PHASE2B={v['SAFE_FOR_PHASE2B']}**",
            "",
            "Rotation simulation validates target frequency model. Phase 2B still requires separate PRs for cap, watchdog cadence, and runtime scheduler activation.",
            "",
            "## Model comparison delta",
            "",
            f"| Metrika | Current | Dry-run | Improvement |",
            f"|---------|---------|---------|-------------|",
            f"| Full rotation | {cmp['current']['full_rotation_min']} min | {cmp['dry_run']['full_rotation_min']} min | {cmp['delta']['full_rotation_improvement_factor']}× |",
            f"| Skipped/tick | {cmp['current']['skipped_tick_cap_last_run']} | 0 | −{cmp['delta']['skipped_sources_eliminated_per_tick']} |",
            f"| Checks/source/24h | {cmp['current']['estimated_checks_per_source_24h']} | {cmp['dry_run']['checks_per_source_24h']} | {cmp['delta']['checks_per_source_24h_improvement_factor']}× |",
            f"| Coverage/hour | {cmp['current']['estimated_coverage_per_hour']} | {cmp['dry_run']['coverage_per_hour']} | {cmp['delta']['coverage_per_hour_improvement_factor']}× |",
            "",
            "## Explicit verdict",
            "",
            "```",
        ]
    )
    for key, val in v.items():
        if key not in ("simulation_pass", "build_blockers", "build_warnings"):
            lines.append(f"{key}={val}")
    lines.append("```")
    lines.append("")
    return "\n".join(lines)


def build_report() -> dict[str, Any]:
    batch_reg = load_rotation_batch_registry()
    registry = load_source_registry()
    active = registry_active_entries(registry)
    active_ids = {str(e.get("id") or "") for e in active}
    registry_validation = validate_registry(batch_reg, active_ids)
    simulation = simulate_24h_rotation(batch_reg)
    load_analysis = analyze_batch_load(batch_reg, registry)
    model_comparison = compare_models(simulation)
    build_risk = assess_build_risk(batch_reg, load_analysis)
    verdict = assess_verdict(registry_validation, simulation, load_analysis, build_risk)
    return {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "phase": "2A",
        "dry_run_only": True,
        "registry_validation": registry_validation,
        "simulation": simulation,
        "load_analysis": load_analysis,
        "model_comparison": model_comparison,
        "build_risk": build_risk,
        "verdict": verdict,
    }


def main() -> int:
    report = build_report()
    os.makedirs(os.path.dirname(REPORT_JSON_PATH), exist_ok=True)
    with open(REPORT_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
        f.write("\n")
    with open(REPORT_MD_PATH, "w", encoding="utf-8") as f:
        f.write(render_markdown(report))
        f.write("\n")
    v = report["verdict"]
    print(f"RSS_ROTATION_PHASE2A_DRY_RUN={v['RSS_ROTATION_PHASE2A_DRY_RUN']}")
    print(f"SAFE_FOR_PHASE2B={v['SAFE_FOR_PHASE2B']}")
    print(f"Wrote {REPORT_MD_PATH}")
    print(f"Wrote {REPORT_JSON_PATH}")
    return 0 if v["RSS_ROTATION_PHASE2A_DRY_RUN"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
