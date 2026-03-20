# -*- coding: utf-8 -*-
"""
AST-based duplicate CSS qualified-rule audit (tinycss2).
Precise line_start from QualifiedRule; line_end via brace match from rule start.
"""
from __future__ import annotations

import os
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Tuple

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


def strict_normalize_decl_map(decls: Dict[str, str]) -> Tuple[Tuple[str, str], ...]:
    """Stricter normalization for discovery expansion: collapse all whitespace in values."""
    items = []
    for k in sorted(decls.keys()):
        v = re.sub(r"\s+", "", decls[k].strip().lower())
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


def _discovery_expand_safe_candidates(
    dup_groups: List[Dict[str, Any]],
    base_safe: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Discovery expansion only: add groups that pass strict evidence (same media, strict identical
    decls, no layout, no risky selector) but were not classified identical_duplicate.
    Does not change classify_group or engine decision logic.
    """
    base_sel = {g["selector_normalized"] for g in base_safe}
    out: List[Dict[str, Any]] = []
    for g in dup_groups:
        if g["selector_normalized"] in base_sel:
            continue
        cls = g.get("classification")
        if cls == "identical_duplicate":
            continue
        decls_list = g.get("_occs_declarations") or []
        medias = g.get("_occs_media") or []
        if len(decls_list) < 2 or len(set(medias)) != 1:
            continue
        strict_sigs = [strict_normalize_decl_map(d) for d in decls_list]
        if len(set(strict_sigs)) != 1:
            continue
        any_layout = any(
            LAYOUT_PROPS.intersection(d.keys())
            or any(LAYOUT_PROPS & set(re.split(r"[\s:]+", v.lower())) for v in d.values())
            for d in decls_list
        )
        if any_layout:
            continue
        sel_l = (g.get("selector_normalized") or "").lower()
        if any(m in sel_l for m in RISKY_SELECTOR_MARKERS):
            continue
        g_copy = {k: v for k, v in g.items() if not k.startswith("_")}
        g_copy["safe_source"] = "discovery_expanded"
        g_copy["safe_classification_reason"] = (
            "strict_identical_declarations_same_media_no_layout_no_risky_selector"
        )
        g_copy["risk_flags"] = []
        g_copy["discovery_evidence"] = {
            "strict_decl_identical": True,
            "single_media_context": True,
            "no_layout_props": True,
            "no_risky_selector": True,
        }
        out.append(g_copy)
    return out[:50]


def _discovery_subgroup_safe_candidates(
    dup_groups: List[Dict[str, Any]],
    base_safe_selectors: set,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Within groups that are NOT whole-group safe, find pair/subgroup level safe candidates:
    occurrences that share same media and strict-identical declarations (exact redundant subset).
    Same safety threshold: no layout, no risky selector. Does not change classify_group.
    Returns (list of synthetic safe groups for safe_groups_top, list of evidence records).
    """
    from collections import defaultdict as dd

    out_groups: List[Dict[str, Any]] = []
    evidence_list: List[Dict[str, Any]] = []
    for g in dup_groups:
        sel = g.get("selector_normalized") or ""
        if sel in base_safe_selectors:
            continue
        cls = g.get("classification")
        if cls == "identical_duplicate":
            continue
        occs_out = g.get("occurrences") or []
        decls_list = g.get("_occs_declarations") or []
        medias_list = g.get("_occs_media") or []
        if len(occs_out) < 2 or len(decls_list) != len(occs_out):
            continue
        sel_l = sel.lower()
        if any(m in sel_l for m in RISKY_SELECTOR_MARKERS):
            continue
        buckets: Dict[Tuple[str, Tuple[Tuple[str, str], ...]], List[Tuple[Dict[str, Any], Dict[str, str]]]] = dd(list)
        for i, occ in enumerate(occs_out):
            if i >= len(decls_list):
                break
            media = medias_list[i] if i < len(medias_list) else ""
            decls = decls_list[i]
            strict_sig = strict_normalize_decl_map(decls)
            key = (media, strict_sig)
            buckets[key].append((occ, decls))
        for key, bucket in sorted(buckets.items(), key=lambda kv: (kv[0][0], kv[0][1], min((o.get("line_start") or 0 for o, _ in kv[1])))):
            if len(bucket) < 2:
                continue
            media_ctx, _ = key
            _, repr_decls = bucket[0]
            any_layout = (
                LAYOUT_PROPS.intersection(repr_decls.keys())
                or any(
                    LAYOUT_PROPS & set(re.split(r"[\s:]+", v.lower()))
                    for v in repr_decls.values()
                )
            )
            if any_layout:
                continue
            occs_sub = [o for o, _ in bucket]
            candidate_kind = "pair" if len(bucket) == 2 else "subgroup"
            parent_group_id = sel[:80].replace(" ", "_")
            cid = f"subgroup_{parent_group_id}_{candidate_kind}_{len(out_groups)}"
            synthetic = {
                "selector_normalized": sel,
                "count": len(occs_sub),
                "classification": "identical_duplicate",
                "declarations_identical_across_group": True,
                "occurrences": occs_sub,
                "safe_source": "subgroup_discovery",
                "candidate_id": cid,
                "parent_group_id": parent_group_id,
                "candidate_kind": candidate_kind,
                "safe_classification_reason": "exact_decl_equivalent_subset_same_media_no_layout_no_risky_selector",
                "risk_flags": [],
                "discovery_evidence": {
                    "strict_decl_identical": True,
                    "same_media_context": True,
                    "no_layout_props": True,
                    "no_risky_selector": True,
                },
            }
            out_groups.append(synthetic)
            evidence_list.append({
                "candidate_id": cid,
                "parent_group_id": parent_group_id,
                "candidate_kind": candidate_kind,
                "selector": sel,
                "reason": "exact_decl_equivalent_subset_same_media_no_layout_no_risky_selector",
                "risk_flags": [],
                "safe_classification_reason": synthetic["safe_classification_reason"],
                "evidence": synthetic["discovery_evidence"],
            })
    return out_groups[:50], evidence_list


RISK_CLASSIFICATIONS = ("risky_layout_coupled", "intentional_cascade_candidate")
FORENSIC_CLASSIFICATIONS = ("breakpoint_specific",)


def _discovery_forensic_triage_wave1(
    dup_groups: List[Dict[str, Any]],
    existing_safe_keys: set,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, int], int, int]:
    """
    Forensic Triage Wave 1: from risk_now and forensic_only groups only, find pair/subgroup
    subsets that pass strict evidence (same media, strict identical decls, no layout, no risky
    selector). Same safety threshold. Labels: previous_bucket, promotion_source=forensic_triage_wave_1.
    Returns (promotions for safe_groups_top, evidence records, rejected_reasons_agg, risk_groups_analyzed, forensic_groups_analyzed).
    """
    from collections import defaultdict as dd

    out_groups: List[Dict[str, Any]] = []
    evidence_list: List[Dict[str, Any]] = []
    rejected: Dict[str, int] = dd(int)
    risk_groups_analyzed = 0
    forensic_groups_analyzed = 0
    for g in dup_groups:
        cls = g.get("classification")
        if cls not in RISK_CLASSIFICATIONS and cls not in FORENSIC_CLASSIFICATIONS:
            continue
        if cls in RISK_CLASSIFICATIONS:
            risk_groups_analyzed += 1
        else:
            forensic_groups_analyzed += 1
        previous_bucket = "risk_now" if cls in RISK_CLASSIFICATIONS else "forensic_only"
        sel = g.get("selector_normalized") or ""
        occs_out = g.get("occurrences") or []
        decls_list = g.get("_occs_declarations") or []
        medias_list = g.get("_occs_media") or []
        if len(occs_out) < 2 or len(decls_list) != len(occs_out):
            rejected["too_few_occurrences"] += 1
            continue
        sel_l = sel.lower()
        if any(m in sel_l for m in RISKY_SELECTOR_MARKERS):
            rejected["risky_selector"] += 1
            continue
        buckets: Dict[Tuple[str, Tuple[Tuple[str, str], ...]], List[Tuple[Dict[str, Any], Dict[str, str]]]] = dd(list)
        for i, occ in enumerate(occs_out):
            if i >= len(decls_list):
                break
            media = medias_list[i] if i < len(medias_list) else ""
            decls = decls_list[i]
            strict_sig = strict_normalize_decl_map(decls)
            key = (media, strict_sig)
            buckets[key].append((occ, decls))
        for key, bucket in sorted(buckets.items(), key=lambda kv: (kv[0][0], kv[0][1], min((o.get("line_start") or 0 for o, _ in kv[1])))):
            if len(bucket) < 2:
                rejected["no_pair_or_subgroup"] += 1
                continue
            _, repr_decls = bucket[0]
            any_layout = (
                LAYOUT_PROPS.intersection(repr_decls.keys())
                or any(
                    LAYOUT_PROPS & set(re.split(r"[\s:]+", v.lower()))
                    for v in repr_decls.values()
                )
            )
            if any_layout:
                rejected["layout_props"] += 1
                continue
            occs_sub = [o for o, _ in bucket]
            dedupe_key = (sel, tuple(sorted((o.get("line_start"), o.get("line_end")) for o in occs_sub)))
            if dedupe_key in existing_safe_keys:
                continue
            existing_safe_keys.add(dedupe_key)
            candidate_kind = "pair" if len(bucket) == 2 else "subgroup"
            parent_group_id = sel[:80].replace(" ", "_")
            cid = f"triage_w1_{previous_bucket}_{parent_group_id}_{candidate_kind}_{len(out_groups)}"
            synthetic = {
                "selector_normalized": sel,
                "count": len(occs_sub),
                "classification": "identical_duplicate",
                "declarations_identical_across_group": True,
                "occurrences": occs_sub,
                "safe_source": "forensic_triage_wave_1",
                "candidate_id": cid,
                "parent_group_id": parent_group_id,
                "candidate_kind": candidate_kind,
                "previous_bucket": previous_bucket,
                "promotion_source": "forensic_triage_wave_1",
                "safe_classification_reason": "exact_decl_equivalent_subset_same_media_no_layout_no_risky_selector",
                "promotion_reason": "forensic_triage_wave_1_strict_evidence",
                "risk_flags": [],
                "discovery_evidence": {
                    "strict_decl_identical": True,
                    "same_media_context": True,
                    "no_layout_props": True,
                    "no_risky_selector": True,
                    "no_state_ambiguity": True,
                    "no_cascade_ambiguity": True,
                },
            }
            out_groups.append(synthetic)
            evidence_list.append({
                "candidate_id": cid,
                "parent_group_id": parent_group_id,
                "previous_bucket": previous_bucket,
                "candidate_kind": candidate_kind,
                "selector": sel,
                "promotion_reason": synthetic["promotion_reason"],
                "risk_flags": [],
                "safe_classification_reason": synthetic["safe_classification_reason"],
                "promotion_source": "forensic_triage_wave_1",
                "evidence": synthetic["discovery_evidence"],
            })
    return out_groups[:50], evidence_list, dict(rejected), risk_groups_analyzed, forensic_groups_analyzed


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
        dup_groups.append(
            {
                "selector_normalized": norm_key,
                "count": len(occs),
                "classification": cls,
                "declarations_identical_across_group": len({normalize_decl_map(o["declarations"]) for o in occs}) == 1,
                "occurrences": occ_out,
                "_occs_declarations": [o["declarations"] for o in occs],
                "_occs_media": [o["media_context"] for o in occs],
            }
        )

    dup_groups.sort(key=lambda x: (-x["count"], x.get("selector_normalized") or ""))
    duplicate_groups_brief = [
        {"selector_normalized": g["selector_normalized"], "classification": g["classification"]}
        for g in dup_groups
    ]
    base_safe_raw = [g for g in dup_groups if g.get("classification") == "identical_duplicate"][:50]
    base_safe = [{k: v for k, v in g.items() if not k.startswith("_")} for g in base_safe_raw]
    base_safe_selectors = {g["selector_normalized"] for g in base_safe_raw}
    expanded_safe = _discovery_expand_safe_candidates(dup_groups, base_safe_raw)
    subgroup_safe, subgroup_evidence = _discovery_subgroup_safe_candidates(dup_groups, base_safe_selectors)
    use_expansion = os.environ.get("DISCOVERY_EXPANSION", "1") != "0"
    use_subgroup = os.environ.get("SUBGROUP_DISCOVERY", "1") != "0"
    inventory_flags = {
        "DISCOVERY_EXPANSION": "1" if use_expansion else "0",
        "SUBGROUP_DISCOVERY": "1" if use_subgroup else "0",
    }
    safe_before_triage = (
        base_safe
        + (expanded_safe if use_expansion else [])
        + (subgroup_safe if use_subgroup else [])
    )
    existing_keys: set = set()
    for gr in safe_before_triage:
        occs = gr.get("occurrences") or []
        k = (gr.get("selector_normalized") or "", tuple(sorted((o.get("line_start"), o.get("line_end")) for o in occs)))
        existing_keys.add(k)
    use_triage = os.environ.get("FORENSIC_TRIAGE_WAVE1", "1") != "0"
    inventory_flags["FORENSIC_TRIAGE_WAVE1"] = "1" if use_triage else "0"
    triage_safe, triage_evidence, triage_rejected, risk_gr, forensic_gr = (
        _discovery_forensic_triage_wave1(dup_groups, existing_keys) if use_triage else ([], [], {}, 0, 0)
    )
    safe_groups_top_raw = safe_before_triage + (triage_safe if use_triage else [])
    safe_groups_top = sorted(
        safe_groups_top_raw,
        key=lambda g: (g.get("selector_normalized") or "", min((o.get("line_start") or 0 for o in (g.get("occurrences") or []))) or 0),
    )

    return {
        "duplicate_selector_groups": len(dup_groups),
        "duplicate_rule_occurrences_in_groups": total_occ,
        "total_qualified_rules_scanned": len(occurrences),
        "groups_top": dup_groups[:25],
        "safe_groups_top": safe_groups_top,
        "discovery_expansion": {
            "enabled": use_expansion,
            "subgroup_enabled": use_subgroup,
            "forensic_triage_wave1_enabled": use_triage,
            "base_safe_count": len(base_safe),
            "expanded_count": len(expanded_safe),
            "subgroup_count": len(subgroup_safe),
            "triage_promotions_count": len(triage_safe) if use_triage else 0,
            "safe_now_before_expansion": len(base_safe),
            "safe_now_after_expansion": len(base_safe)
            + (len(expanded_safe) if use_expansion else 0)
            + (len(subgroup_safe) if use_subgroup else 0)
            + (len(triage_safe) if use_triage else 0),
            "new_candidates": [
                {
                    "candidate_id": "discovery_expanded_" + (g.get("selector_normalized") or "")[:50].replace(" ", "_"),
                    "selector": g.get("selector_normalized"),
                    "reason": "strict_identical_declarations_same_media_no_layout_no_risky_selector",
                    "risk_flags": g.get("risk_flags", []),
                    "safe_classification_reason": g.get("safe_classification_reason", ""),
                }
                for g in expanded_safe
            ],
            "subgroup_new_candidates": subgroup_evidence if use_subgroup else [],
            "forensic_triage_wave1_promotions": triage_evidence if use_triage else [],
            "forensic_triage_wave1_rejected_reasons": triage_rejected if use_triage else {},
            "forensic_triage_risk_groups_analyzed": risk_gr if use_triage else 0,
            "forensic_triage_forensic_groups_analyzed": forensic_gr if use_triage else 0,
        },
        "duplicate_groups_brief": duplicate_groups_brief,
        "classification_counts": dict(class_counts),
        "inventory_flags": inventory_flags,
        "dead_override_candidate_policy": DEAD_OVERRIDE_POLICY,
        "line_range_method": (
            "line_start: tinycss2 QualifiedRule.source_line/column (first prelude token). "
            "line_end: scan from that position, brace-depth in {...}, strings/comments skipped."
        ),
    }
