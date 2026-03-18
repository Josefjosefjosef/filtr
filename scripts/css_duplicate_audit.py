# -*- coding: utf-8 -*-
"""
AST-based duplicate CSS qualified-rule audit (tinycss2).
Produces real duplicate selector groups vs token-frequency (regex) noise.
"""
from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import tinycss2
    from tinycss2.ast import Declaration
except ImportError:
    tinycss2 = None  # type: ignore
    Declaration = object  # type: ignore

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


def line_for_position(text: str, pos: int) -> int:
    return text.count("\n", 0, max(0, pos)) + 1


def find_selector_line(text: str, selector: str, start: int) -> Tuple[int, int]:
    """Return (line, next_search_start). Best-effort line of rule start."""
    sel = selector.strip()
    if not sel:
        return 0, start
    candidates = [sel[:100], sel.split(",")[0].strip()[:80], sel[:50]]
    for cand in candidates:
        if len(cand) < 3:
            continue
        pos = text.find(cand, start)
        if pos >= 0:
            return line_for_position(text, pos), pos + 1
    return 0, start


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
    search_pos: List[int],
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
            line, search_pos[0] = find_selector_line(text, raw_sel, search_pos[0])
            occurrences.append(
                {
                    "selector_raw": raw_sel,
                    "selector_normalized": normalize_selector_key(raw_sel),
                    "media_context": media_key,
                    "declarations": decls,
                    "line": line,
                }
            )
        elif rt == "at-rule":
            kw = rule.at_keyword
            if isinstance(kw, bytes):
                kw = kw.decode("utf-8", errors="replace")
            kw_l = (kw or "").lower()
            if kw_l in ("charset", "import", "namespace"):
                continue
            if kw_l == "keyframes" or kw_l == "font-face":
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
                walk_rules(nested, media_stack + [f"@media {mq}"], occurrences, text, search_pos)
            elif kw_l in ("supports", "layer"):
                pre = tinycss2.serialize(rule.prelude).strip()[:80]
                walk_rules(nested, media_stack + [f"@{kw_l} {pre}"], occurrences, text, search_pos)
            else:
                walk_rules(nested, media_stack + [f"@{kw_l}"], occurrences, text, search_pos)


def classify_group(occs: List[Dict[str, Any]]) -> str:
    medias = {o["media_context"] for o in occs}
    decl_sigs = [normalize_decl_map(o["declarations"]) for o in occs]
    if len(medias) > 1:
        return "breakpoint_specific"
    if len(set(decl_sigs)) == 1:
        return "identical_duplicate"
    any_layout = any(
        LAYOUT_PROPS.intersection(o["declarations"].keys()) or any(
            LAYOUT_PROPS & set(re.split(r"[\s:]+", v.lower())) for v in o["declarations"].values()
        )
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
            "duplicate_rule_occurrences": 0,
            "groups": [],
            "classification_counts": {},
        }
    text = css_path.read_text(encoding="utf-8")
    try:
        rules = tinycss2.parse_stylesheet(text, skip_comments=True, skip_whitespace=True)
    except Exception as e:
        return {
            "error": str(e),
            "duplicate_selector_groups": 0,
            "duplicate_rule_occurrences": 0,
            "groups": [],
            "classification_counts": {},
        }
    occurrences: List[Dict[str, Any]] = []
    sp = [0]
    walk_rules(rules, [], occurrences, text, sp)

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
        lines = sorted({o["line"] for o in occs if o["line"] > 0})
        dup_groups.append(
            {
                "selector_normalized": norm_key,
                "selector_raw_sample": occs[0]["selector_raw"][:200],
                "count": len(occs),
                "classification": cls,
                "lines": lines[:30],
                "media_contexts": list({o["media_context"] for o in occs}),
                "declarations_identical_across_group": len({normalize_decl_map(o["declarations"]) for o in occs}) == 1,
            }
        )

    dup_groups.sort(key=lambda x: -x["count"])

    return {
        "duplicate_selector_groups": len(dup_groups),
        "duplicate_rule_occurrences_in_groups": total_occ,
        "total_qualified_rules_scanned": len(occurrences),
        "groups_top": dup_groups[:25],
        "classification_counts": dict(class_counts),
    }
