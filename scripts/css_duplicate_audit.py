# -*- coding: utf-8 -*-
"""
AST-based duplicate CSS qualified-rule audit (tinycss2).
Precise line_start from QualifiedRule; line_end via brace match from rule start.
Truthful classification model: duplicate != debt; safe_now only when evidence allows.
"""
from __future__ import annotations

import json
import os
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Tuple

TEMP_BASE = Path(os.environ.get("TEMP", os.environ.get("TMP", "/tmp"))) / "filtr_readiness"
ENGINE_DIR = TEMP_BASE / "reports" / "cleanup-engine"
FAIL_HISTORY_FILE = ENGINE_DIR / "failed_candidates.json"

try:
    import tinycss2
except ImportError:
    tinycss2 = None  # type: ignore

LAYOUT_PROPS = frozenset(
    {
        "width",
        "min-width",
        "max-width",
        "flex",
        "flex-basis",
        "flex-grow",
        "flex-shrink",
        "grid",
        "grid-template",
        "grid-template-columns",
        "grid-template-rows",
        "position",
        "top",
        "right",
        "bottom",
        "left",
        "transform",
        "overflow",
        "overflow-x",
        "overflow-y",
        "display",
        "z-index",
    }
)

RISKY_SELECTOR_MARKERS = (
    "#feed",
    "#topbar",
    "#newslist",
    "#iutopbar",
    ".accordioncol",
    ".layout>",
    "html,",
    " body",
    "#iucenterstage",
    "#newswrap",
)

DEAD_OVERRIDE_POLICY = (
    "not_emitted: cascade-specificity and pseudo-state analysis required; "
    "reserved for future conservative implementation."
)


def normalize_selector_key(raw: str) -> str:
    s = raw.strip()
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"\s*([>+~])\s*", r" \1 ", s)
    return s.strip()


def normalize_decl_map(decls: Dict[str, str]) -> Tuple[Tuple[str, str], ...]:
    items = []
    for k in sorted(decls.keys()):
        v = re.sub(r"\s+", " ", decls[k].strip().lower())
        items.append((k, v))
    return tuple(items)


def find_closing_brace_line(text: str, start_line: int, start_col: int) -> int:
    """
    From (start_line, start_col) at first token of qualified rule prelude,
    scan forward (strings/comments-aware) to the `}` that closes this rule's block.
    Deterministic for standard CSS; reproducible given same file bytes.
    """
    lines = text.split("\n")
    pos = 0
    for ln in range(1, start_line):
        if ln - 1 < len(lines):
            pos += len(lines[ln - 1]) + 1
    pos += max(0, start_col - 1)
    depth = 0
    in_string: str | None = None
    i = pos
    n = len(text)
    cur_line = start_line
    while i < n:
        c = text[i]
        if in_string:
            if c == "\\" and i + 1 < n:
                i += 2
                continue
            if c == in_string:
                in_string = None
            i += 1
            continue
        if c in "\"'":
            in_string = c
            i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            end = text.find("*/", i + 2)
            if end < 0:
                return cur_line
            cur_line += text[i : end + 2].count("\n")
            i = end + 2
            continue
        if c == "\n":
            cur_line += 1
            i += 1
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return cur_line
        i += 1
    return start_line


def parse_declarations(content) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not content:
        return out
    try:
        decls = tinycss2.parse_declaration_list(content, skip_comments=True, skip_whitespace=True)
    except Exception:
        return out
    for node in decls:
        if getattr(node, "type", None) == "declaration":
            try:
                name = node.lower_name
                val = tinycss2.serialize(node.value).strip()
                out[name] = val
            except Exception:
                continue
    return out


def walk_rules(
    rules: List[Any],
    media_stack: List[str],
    occurrences: List[Dict[str, Any]],
    text: str,
) -> None:
    if not rules:
        return
    for rule in rules:
        rt = getattr(rule, "type", None)
        if rt == "qualified-rule":
            try:
                raw_sel = tinycss2.serialize(rule.prelude).strip()
            except Exception:
                continue
            if not raw_sel:
                continue
            decls = parse_declarations(rule.content)
            media_key = " / ".join(media_stack) if media_stack else "(top-level)"
            line_start = rule.source_line
            col_start = rule.source_column
            line_end = find_closing_brace_line(text, line_start, col_start)
            occurrences.append(
                {
                    "selector_raw": raw_sel,
                    "selector_normalized": normalize_selector_key(raw_sel),
                    "media_context": media_key,
                    "declarations": decls,
                    "line_start": line_start,
                    "line_end": line_end,
                }
            )
        elif rt == "at-rule":
            kw = rule.at_keyword
            if isinstance(kw, bytes):
                kw = kw.decode("utf-8", errors="replace")
            kw_l = (kw or "").lower()
            if kw_l in ("charset", "import", "namespace"):
                continue
            if kw_l == "keyframes" or kw_l.endswith("keyframes") or kw_l == "font-face":
                continue
            try:
                inner = rule.content
            except Exception:
                continue
            if not inner:
                continue
            try:
                nested = tinycss2.parse_rule_list(inner, skip_comments=True, skip_whitespace=True)
            except Exception:
                continue
            if kw_l == "media":
                mq = tinycss2.serialize(rule.prelude).strip()
                walk_rules(nested, media_stack + [f"@media {mq}"], occurrences, text)
            elif kw_l in ("supports", "layer"):
                pre = tinycss2.serialize(rule.prelude).strip()[:120]
                walk_rules(nested, media_stack + [f"@{kw_l} {pre}"], occurrences, text)
            else:
                walk_rules(nested, media_stack + [f"@{kw_l}"], occurrences, text)


def classify_group(occs: List[Dict[str, Any]]) -> str:
    """Raw syntactic classification (legacy)."""
    medias = {o["media_context"] for o in occs}
    decl_sigs = [normalize_decl_map(o["declarations"]) for o in occs]
    if len(medias) > 1:
        return "breakpoint_specific"
    if len(set(decl_sigs)) == 1:
        return "identical_duplicate"
    any_layout = any(
        LAYOUT_PROPS.intersection(o["declarations"].keys())
        or any(LAYOUT_PROPS & set(re.split(r"[\s:]+", v.lower())) for v in o["declarations"].values())
        for o in occs
    )
    sel_l = occs[0]["selector_normalized"].lower()
    risky_sel = any(m in sel_l for m in RISKY_SELECTOR_MARKERS)
    if risky_sel or any_layout:
        return "risky_layout_coupled"
    return "intentional_cascade_candidate"


def load_fail_history() -> Dict[str, int]:
    """Load fail counts by selector_normalized from cleanup-engine failed_candidates.json and last forensic."""
    out: Dict[str, int] = {}
    if FAIL_HISTORY_FILE.exists():
        try:
            data = json.loads(FAIL_HISTORY_FILE.read_text(encoding="utf-8"))
            by_sel = data.get("by_selector") or data
            if isinstance(by_sel, dict):
                for k, v in by_sel.items():
                    out[k] = int(v) if isinstance(v, (int, float)) else 1
        except Exception:
            pass
    forensic_path = ENGINE_DIR / "cleanup-iteration-forensic.json"
    if forensic_path.exists():
        try:
            foren = json.loads(forensic_path.read_text(encoding="utf-8"))
            sel = (foren.get("candidate_packet") or {}).get("selector_normalized") or (foren.get("selector_normalized"))
            if sel:
                out[sel] = out.get(sel, 0) + 1
        except Exception:
            pass
    return out


def _group_affects_layout_or_cascade(occs: List[Dict[str, Any]]) -> bool:
    any_layout = any(
        LAYOUT_PROPS.intersection(o["declarations"].keys())
        or any(LAYOUT_PROPS & set(re.split(r"[\s:]+", v.lower())) for v in o["declarations"].values())
        for o in occs
    )
    sel_l = occs[0]["selector_normalized"].lower()
    risky_sel = any(m in sel_l for m in RISKY_SELECTOR_MARKERS)
    return bool(risky_sel or any_layout)


def compute_truthful_classification(
    raw_classification: str,
    occs: List[Dict[str, Any]],
    selector_normalized: str,
    fail_history_count: int,
) -> Dict[str, Any]:
    """
    GATE 3: Truthful classification. Returns classification, debt_status, actionability,
    risk_level, last_runtime_result, allowed_next_action.
    """
    # IDENTICAL_DUPLICATE: NOT automatically safe
    if raw_classification == "identical_duplicate":
        if fail_history_count > 0:
            return {
                "classification": "historically_failed_candidate",
                "debt_status": "debt",
                "actionability": "blocked_by_fail_history",
                "risk_level": "high",
                "last_runtime_result": "FAIL_REVERTED",
                "allowed_next_action": "cleanup_engine_must_ignore",
            }
        if _group_affects_layout_or_cascade(occs):
            return {
                "classification": "true_debt_risk_now",
                "debt_status": "debt",
                "actionability": "actionable_risk",
                "risk_level": "high",
                "last_runtime_result": None,
                "allowed_next_action": "cleanup_engine_must_ignore",
            }
        return {
            "classification": "true_debt_safe_now",
            "debt_status": "debt",
            "actionability": "actionable_safe",
            "risk_level": "low",
            "last_runtime_result": None,
            "allowed_next_action": "allow_cleanup",
        }
    if raw_classification == "breakpoint_specific":
        return {
            "classification": "intentional_duplicate_non_debt",
            "debt_status": "non_debt",
            "actionability": "non_actionable",
            "risk_level": "none",
            "last_runtime_result": None,
            "allowed_next_action": "cleanup_engine_must_ignore",
        }
    if raw_classification == "intentional_cascade_candidate":
        return {
            "classification": "intentional_duplicate_non_debt",
            "debt_status": "non_debt",
            "actionability": "non_actionable",
            "risk_level": "none",
            "last_runtime_result": None,
            "allowed_next_action": "cleanup_engine_must_ignore",
        }
    if raw_classification == "risky_layout_coupled":
        return {
            "classification": "true_debt_risk_now",
            "debt_status": "debt",
            "actionability": "actionable_risk",
            "risk_level": "high",
            "last_runtime_result": None,
            "allowed_next_action": "cleanup_engine_must_ignore",
        }
    return {
        "classification": "accepted_non_actionable",
        "debt_status": "non_debt",
        "actionability": "non_actionable",
        "risk_level": "none",
        "last_runtime_result": None,
        "allowed_next_action": "cleanup_engine_must_ignore",
    }


def audit_css_file(css_path: Path) -> Dict[str, Any]:
    empty_summaries = {
        "summary_true_debt_safe_now": 0,
        "summary_true_debt_risk_now": 0,
        "summary_forensic_only": 0,
        "summary_intentional_duplicate_non_debt": 0,
        "summary_historically_failed_candidate": 0,
        "summary_accepted_non_actionable": 0,
    }
    if tinycss2 is None:
        return {
            "error": "tinycss2 not installed",
            "duplicate_selector_groups": 0,
            "duplicate_rule_occurrences_in_groups": 0,
            "groups_top": [],
            "safe_groups_top": [],
            "duplicate_groups_brief": [],
            "classification_counts": {},
            **empty_summaries,
            "dead_override_candidate_policy": DEAD_OVERRIDE_POLICY,
        }
    text = css_path.read_text(encoding="utf-8")
    try:
        rules = tinycss2.parse_stylesheet(text, skip_comments=True, skip_whitespace=True)
    except Exception as e:
        return {
            "error": str(e),
            "duplicate_selector_groups": 0,
            "duplicate_rule_occurrences_in_groups": 0,
            "groups_top": [],
            "safe_groups_top": [],
            "duplicate_groups_brief": [],
            "classification_counts": {},
            **empty_summaries,
            "dead_override_candidate_policy": DEAD_OVERRIDE_POLICY,
        }
    occurrences: List[Dict[str, Any]] = []
    walk_rules(rules, [], occurrences, text)

    by_key: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for o in occurrences:
        by_key[o["selector_normalized"]].append(o)

    fail_history = load_fail_history()
    dup_groups = []
    class_counts: Dict[str, int] = defaultdict(int)
    summary_true_debt_safe_now = 0
    summary_true_debt_risk_now = 0
    summary_forensic_only = 0
    summary_intentional_duplicate_non_debt = 0
    summary_historically_failed_candidate = 0
    summary_accepted_non_actionable = 0
    total_occ = 0

    for norm_key, occs in by_key.items():
        if len(occs) < 2:
            continue
        raw_cls = classify_group(occs)
        class_counts[raw_cls] += 1
        total_occ += len(occs)
        occ_out = []
        for o in occs:
            occ_out.append(
                {
                    "selector_raw": o["selector_raw"],
                    "line_start": o["line_start"],
                    "line_end": o["line_end"],
                    "media_context": o["media_context"],
                }
            )
        fail_count = fail_history.get(norm_key, 0)
        truthful = compute_truthful_classification(raw_cls, occs, norm_key, fail_count)
        classification = truthful["classification"]
        if classification == "true_debt_safe_now":
            summary_true_debt_safe_now += 1
        elif classification == "true_debt_risk_now":
            summary_true_debt_risk_now += 1
        elif classification == "forensic_only":
            summary_forensic_only += 1
        elif classification == "intentional_duplicate_non_debt":
            summary_intentional_duplicate_non_debt += 1
        elif classification == "historically_failed_candidate":
            summary_historically_failed_candidate += 1
        else:
            summary_accepted_non_actionable += 1
        dup_groups.append({
            "selector_normalized": norm_key,
            "count": len(occs),
            "raw_classification": raw_cls,
            "classification": classification,
            "debt_status": truthful["debt_status"],
            "actionability": truthful["actionability"],
            "risk_level": truthful["risk_level"],
            "fail_history_count": fail_count,
            "last_runtime_result": truthful["last_runtime_result"],
            "allowed_next_action": truthful["allowed_next_action"],
            "declarations_identical_across_group": len({normalize_decl_map(o["declarations"]) for o in occs}) == 1,
            "occurrences": occ_out,
        })

    dup_groups.sort(key=lambda x: -x["count"])
    duplicate_groups_brief = [
        {"selector_normalized": g["selector_normalized"], "classification": g["classification"], "raw_classification": g["raw_classification"]}
        for g in dup_groups
    ]
    safe_groups_top = [g for g in dup_groups if g.get("classification") == "true_debt_safe_now"][:25]

    return {
        "duplicate_selector_groups": len(dup_groups),
        "duplicate_rule_occurrences_in_groups": total_occ,
        "total_qualified_rules_scanned": len(occurrences),
        "groups_top": dup_groups[:25],
        "safe_groups_top": safe_groups_top,
        "duplicate_groups_brief": duplicate_groups_brief,
        "classification_counts": dict(class_counts),
        "summary_true_debt_safe_now": summary_true_debt_safe_now,
        "summary_true_debt_risk_now": summary_true_debt_risk_now,
        "summary_forensic_only": summary_forensic_only,
        "summary_intentional_duplicate_non_debt": summary_intentional_duplicate_non_debt,
        "summary_historically_failed_candidate": summary_historically_failed_candidate,
        "summary_accepted_non_actionable": summary_accepted_non_actionable,
        "dead_override_candidate_policy": DEAD_OVERRIDE_POLICY,
        "line_range_method": (
            "line_start: tinycss2 QualifiedRule.source_line/column (first prelude token). "
            "line_end: scan from that position, brace-depth in {...}, strings/comments skipped."
        ),
    }
