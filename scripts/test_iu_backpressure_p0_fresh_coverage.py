#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fresh P0 headline items must be preferred in publish batch (coverage guard contract)."""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
from datetime import datetime, timedelta, timezone

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from iu_backpressure import split_publish_batch  # noqa: E402


def _iso_ago(hours: float) -> str:
    dt = datetime.now(timezone.utc) - timedelta(hours=hours)
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def test_p0_fresh_idnes_preferred_over_stale_when_capped():
    tmp = tempfile.mkdtemp()
    try:
        out_dir = os.path.join(tmp, "projects", "data")
        os.makedirs(out_dir, exist_ok=True)
        items = []
        for i in range(250):
            items.append(
                {
                    "url": f"https://other.example/item{i}",
                    "dt": "2026-01-01T00:00:00Z",
                }
            )
        for i in range(10):
            items.append(
                {
                    "url": f"https://www.idnes.cz/zpravy/stale/{i}",
                    "dt": "2026-01-15T12:00:00Z",
                }
            )
        items.append(
            {
                "url": "https://www.idnes.cz/zpravy/fresh/1",
                "dt": _iso_ago(1.5),
            }
        )
        batch, meta = split_publish_batch(out_dir, [], items)
        urls = {str(x.get("url") or "") for x in batch}
        assert "https://www.idnes.cz/zpravy/fresh/1" in urls, f"fresh idnes missing meta={meta}"
        assert meta.get("p0_reserved", 0) >= 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _run() -> None:
    test_p0_fresh_idnes_preferred_over_stale_when_capped()
    print("PASS test_iu_backpressure_p0_fresh_coverage")


if __name__ == "__main__":
    _run()
