# -*- coding: utf-8 -*-
"""
AST-based duplicate CSS qualified-rule audit (tinycss2).
Precise line_start from QualifiedRule; line_end via brace match from rule start.
"""
from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Tuple

try:
    import tinycss2
except ImportError:
    tinycss2 = None  # type: ignore

# Debt verdict labels (reporting layer; does not change classify_group / AST logic).
DEBT_VERDICT_INTENTIONAL_NON_DEBT = "intentional_non_debt"
DEBT_VERDICT_TRUE_DEBT = "true_debt"
DEBT_VERDICT_RISK_NOW = "risk_now"
DEBT_VERDICT_UNRESOLVED = "unresolved_needs_review"

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


def risk_zone_hit(selector_normalized: str) -> bool:
    """
    Conservative risk-zone heuristic (aligned with css_debt_guard.risk_zone_hit).
    Used only for debt_verdict layering — does not affect technical classification.
    """
    s = selector_normalized.lower()
    if "topbar" in s or "iutopbar" in s:
        return True
    if "iuleftrail" in s or "accordioncol" in s or "leftnav" in s or "iu-left" in s:
        return True
    if "#feed" in s or "newslist" in s or "iucenterstage" in s or "newswrap" in s:
        return True
    if "mindmenu" in s or "mmquick" in s or "iu-mm" in s:
        return True
    if "overlay" in s or "modal" in s or "fullscreen" in s:
        return True
    if ":hover" in s or ":focus" in s or ":active" in s or ":checked" in s:
        return True
    if "::before" in s or "::after" in s or ":before" in s or ":after" in s:
        return True
    if ".open" in s or ".active" in s or "is-active" in s or "aria-expanded" in s or "data-" in s:
        return True
    return False


def compute_debt_verdict(technical_classification: str, selector_normalized: str, occs: List[Dict[str, Any]]) -> Tuple[str, str]:
    """
    Map technical duplicate classification to a conservative debt verdict for reporting.
    Never auto-claims true_debt when risk heuristics fire on identical_duplicate.
    """
    medias = {o["media_context"] for o in occs}
    multi_media = len(medias) > 1
    rz = risk_zone_hit(selector_normalized)

    if technical_classification == "breakpoint_specific":
        if rz:
            return (
                DEBT_VERDICT_RISK_NOW,
                "Media-scoped duplicate; risk-zone heuristic matches — not auto-counted as removable debt.",
            )
        return (
            DEBT_VERDICT_INTENTIONAL_NON_DEBT,
            "Media-scoped overrides across breakpoints; expected pattern — not treated as technical debt.",
        )

    if technical_classification == "intentional_cascade_candidate":
        if rz:
            return (
                DEBT_VERDICT_RISK_NOW,
                "Declaration variants in risk-sensitive selector context — not auto-counted as removable debt.",
            )
        return (
            DEBT_VERDICT_INTENTIONAL_NON_DEBT,
            "Cascade-style declaration differences in same media — intentional variance — not default debt.",
        )

    if technical_classification == "risky_layout_coupled":
        return (
            DEBT_VERDICT_RISK_NOW,
            "Layout/risk-marker duplicate — requires caution; not auto-counted as removable debt.",
        )

    if technical_classification == "identical_duplicate":
        if multi_media:
            return (
                DEBT_VERDICT_UNRESOLVED,
                "Identical declarations but multiple media stacks in group — needs review before debt claim.",
            )
        if rz:
            return (
                DEBT_VERDICT_UNRESOLVED,
                "Identical redundant blocks in risk zone — review before treating as removable debt.",
            )
        return (
            DEBT_VERDICT_TRUE_DEBT,
            "Repeated identical rule blocks in equivalent scope — conservative true duplicate debt (verify before edit).",
        )

    return (DEBT_VERDICT_UNRESOLVED, "Unmapped technical classification — needs review.")


def classify_group(occs: List[Dict[str, Any]]) -> str:
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


def audit_css_file(css_path: Path) -> Dict[str, Any]:
    if tinycss2 is None:
        return {
            "error": "tinycss2 not installed",
            "duplicate_selector_groups": 0,
            "duplicate_rule_occurrences_in_groups": 0,
            "groups_top": [],
            "duplicate_groups_brief": [],
            "classification_counts": {},
            "debt_verdict_counts": {},
            "debt_occurrence_counts": {},
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
            "duplicate_groups_brief": [],
            "classification_counts": {},
            "debt_verdict_counts": {},
            "debt_occurrence_counts": {},
            "dead_override_candidate_policy": DEAD_OVERRIDE_POLICY,
        }
    occurrences: List[Dict[str, Any]] = []
    walk_rules(rules, [], occurrences, text)

    by_key: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for o in occurrences:
        by_key[o["selector_normalized"]].append(o)

    dup_groups: List[Dict[str, Any]] = []
    class_counts: Dict[str, int] = defaultdict(int)
    total_occ = 0

    for norm_key, occs in by_key.items():
        if len(occs) < 2:
            continue
        cls = classify_group(occs)
        class_counts[cls] += 1
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
        debt_v, debt_reason = compute_debt_verdict(cls, norm_key, occs)
        dup_groups.append(
            {
                "selector_normalized": norm_key,
                "count": len(occs),
                "classification": cls,
                "technical_classification": cls,
                "debt_verdict": debt_v,
                "debt_reason": debt_reason,
                "declarations_identical_across_group": len({normalize_decl_map(o["declarations"]) for o in occs}) == 1,
                "occurrences": occ_out,
            }
        )

    dup_groups.sort(key=lambda x: -x["count"])
    debt_verdict_counts: Dict[str, int] = defaultdict(int)
    debt_occurrence_counts: Dict[str, int] = defaultdict(int)
    for g in dup_groups:
        dv = g.get("debt_verdict") or DEBT_VERDICT_UNRESOLVED
        debt_verdict_counts[dv] += 1
        debt_occurrence_counts[dv] += int(g.get("count") or 0)

    duplicate_groups_brief = []
    for g in dup_groups:
        duplicate_groups_brief.append(
            {
                "selector_normalized": g["selector_normalized"],
                "classification": g["classification"],
                "technical_classification": g["technical_classification"],
                "debt_verdict": g["debt_verdict"],
                "debt_reason": g["debt_reason"],
            }
        )

    return {
        "duplicate_selector_groups": len(dup_groups),
        "duplicate_rule_occurrences_in_groups": total_occ,
        "total_qualified_rules_scanned": len(occurrences),
        "groups_top": dup_groups[:25],
        "duplicate_groups_brief": duplicate_groups_brief,
        "classification_counts": dict(class_counts),
        "debt_verdict_counts": dict(debt_verdict_counts),
        "debt_occurrence_counts": dict(debt_occurrence_counts),
        "dead_override_candidate_policy": DEAD_OVERRIDE_POLICY,
        "line_range_method": (
            "line_start: tinycss2 QualifiedRule.source_line/column (first prelude token). "
            "line_end: scan from that position, brace-depth in {...}, strings/comments skipped."
        ),
    }
