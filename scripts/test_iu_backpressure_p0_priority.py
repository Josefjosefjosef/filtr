#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P0 headline items must survive aggregate cap trimming in split_publish_batch."""
from __future__ import annotations

import os
import shutil
import sys
import tempfile

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from iu_backpressure import split_publish_batch  # noqa: E402


def test_p0_novinky_survives_global_cap():
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
        for i in range(8):
            items.append(
                {
                    "url": f"https://www.novinky.cz/clanek/{i}",
                    "dt": f"2026-06-02T12:{i:02d}:00Z",
                }
            )
        batch, meta = split_publish_batch(out_dir, [], items)
        nov = [x for x in batch if "novinky.cz" in str(x.get("url") or "")]
        assert len(nov) == 8, f"expected 8 novinky items in batch, got {len(nov)} meta={meta}"
        assert meta.get("p0_reserved", 0) >= 8
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _run() -> None:
    test_p0_novinky_survives_global_cap()
    print("PASS test_iu_backpressure_p0_priority")


if __name__ == "__main__":
    _run()
