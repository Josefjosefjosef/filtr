#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generator for projects/data/source_registry.json — run: py -3 scripts/gen_source_registry.py

2026-07: current media sources removed from the active registry.
The universal article engine remains. Add future sources via dedicated
connector/config PRs (and update config/removed_media_deny_list.json guards).
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "projects", "data", "source_registry.json")

# Intentionally empty — no current media feeds are active.
ENTRIES = []


def main():
    payload = {
        "version": "3.0.0",
        "tick_interval_min": 2,
        "sources_per_tick": {
            "min": 0,
            "max": 0,
            "three_source_tick_fraction": 0,
        },
        "note": (
            "Active media feed registry cleared 2026-07. "
            "Universal article engine retained; no current media sources. "
            "See config/removed_media_deny_list.json and AUDIT_MEDIA_AGGREGATION_REMOVAL.md."
        ),
        "entries": ENTRIES,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("WROTE", OUT, "entries=", len(ENTRIES))


if __name__ == "__main__":
    main()
