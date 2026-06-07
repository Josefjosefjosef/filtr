#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate projects/data/rotation_batch_registry.json — run: py -3 scripts/gen_rotation_batches.py"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from iu_rotation_foundation import (  # noqa: E402
    ROTATION_BATCH_REGISTRY_PATH,
    build_rotation_batch_registry,
    load_source_registry,
    validate_rotation_batch_registry,
    registry_active_entries,
)

ROOT = os.path.dirname(_SCRIPTS)


def main() -> int:
    registry = load_source_registry()
    active = registry_active_entries(registry)
    payload = build_rotation_batch_registry(registry)
    payload["generated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    errors = validate_rotation_batch_registry(payload, {str(e.get("id") or "") for e in active})
    if errors:
        for err in errors:
            print(f"gen_rotation_batches FAIL: {err}", file=sys.stderr)
        return 1
    os.makedirs(os.path.dirname(ROTATION_BATCH_REGISTRY_PATH), exist_ok=True)
    tmp = ROTATION_BATCH_REGISTRY_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, ROTATION_BATCH_REGISTRY_PATH)
    counts = {bid: len((payload["batches"].get(bid) or {}).get("source_ids") or []) for bid in "ABCD"}
    print(
        f"rotation_batch_registry written active={payload['total_active_sources']} "
        f"A={counts['A']} B={counts['B']} C={counts['C']} D={counts['D']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
