#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fix sources.json - přidá legal_mode="rss_only" ke všem zdrojům, pokud chybí
Deterministicky, bez změny ostatních polí
"""

import json
import os
import sys
from pathlib import Path


def fix_sources_legal_mode(sources_path: str) -> tuple:
    """
    Načte sources.json, přidá legal_mode ke všem zdrojům, pokud chybí.
    
    Returns:
        (total_count, fixed_count, all_have_legal_mode)
    """
    # Načtení
    with open(sources_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    if not isinstance(data, dict) or "sources" not in data:
        raise ValueError("sources.json must have 'sources' array")
    
    sources = data["sources"]
    total_count = len(sources)
    fixed_count = 0
    
    # Projít všechny zdroje
    for source in sources:
        if not isinstance(source, dict):
            continue
        
        # Pokud chybí legal_mode, přidat
        if "legal_mode" not in source:
            source["legal_mode"] = "rss_only"
            fixed_count += 1
    
    # Ověření, že všechny mají legal_mode
    all_have_legal_mode = all(
        isinstance(s, dict) and "legal_mode" in s
        for s in sources
    )
    
    # Uložení (pretty-printed)
    with open(sources_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    return (total_count, fixed_count, all_have_legal_mode)


def main():
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sources_path = os.path.join(repo_root, "config", "sources.json")
    
    if not os.path.exists(sources_path):
        print(f"ERROR: {sources_path} not found", file=sys.stderr)
        sys.exit(1)
    
    try:
        total, fixed, all_have = fix_sources_legal_mode(sources_path)
        
        print(f"=== FIX SOURCES LEGAL_MODE ===")
        print(f"Total sources: {total}")
        print(f"Fixed (legal_mode added): {fixed}")
        print(f"All have legal_mode: {all_have}")
        
        if all_have:
            print("SUCCESS: All sources have legal_mode")
            return 0
        else:
            print("ERROR: Some sources still missing legal_mode", file=sys.stderr)
            return 1
    
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
