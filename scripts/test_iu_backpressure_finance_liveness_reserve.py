#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Native Finance liveness reserve in publish batch cap trimming."""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
from datetime import datetime, timedelta, timezone

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from iu_backpressure import (  # noqa: E402
    _cap_batch_with_p0_reserves,
    split_publish_batch,
)


def _fresh_dt(minutes_ago: float = 30.0) -> str:
    dt = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    return dt.isoformat().replace("+00:00", "Z")


def _stale_dt() -> str:
    return "2026-01-01T00:00:00Z"


def _finance_item(
    url: str,
    *,
    dt: str | None = None,
    feed_id: str = "fin_hn",
) -> dict:
    return {
        "url": url,
        "dt": dt or _fresh_dt(),
        "feedId": feed_id,
        "topic": "finance",
    }


def _other_items(n: int, *, prefix: str = "other") -> list[dict]:
    rows = []
    for i in range(n):
        rows.append(
            {
                "url": f"https://{prefix}.example/item{i}",
                "dt": f"2026-06-05T12:{i % 60:02d}:00Z",
            }
        )
    return rows


def test_finance_reserve_when_batch_would_omit_fresh_finance():
    fresh = _finance_item("https://hn.cz/fresh-reserve")
    items = _other_items(250) + [fresh]
    batch, meta = _run_split(items)
    urls = [str(x.get("url") or "") for x in batch]
    assert fresh["url"] in urls, f"fresh finance missing from batch meta={meta}"
    assert meta.get("finance_reserved") == 1
    assert len(batch) == 180


def test_cap_helper_prefers_newest_fresh_native_finance():
    older = _finance_item(
        "https://hn.cz/older",
        dt=_fresh_dt(180),
        feed_id="fin_hn",
    )
    newer = _finance_item(
        "https://www.e15.cz/newer",
        dt=_fresh_dt(20),
        feed_id="fin_e15",
    )
    merged = _other_items(250) + [older, newer]
    batch, _, p0_n, zdr_n, fin_n = _cap_batch_with_p0_reserves(merged, 180)
    urls = {str(x.get("url") or "") for x in batch}
    assert fin_n == 1
    assert newer["url"] in urls
    assert p0_n == 0
    assert zdr_n == 0


def _run_split(items: list[dict]) -> tuple[list, dict]:
    tmp = tempfile.mkdtemp()
    try:
        out_dir = os.path.join(tmp, "projects", "data")
        os.makedirs(out_dir, exist_ok=True)
        batch, meta = split_publish_batch(out_dir, [], items)
        return batch, meta
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _run() -> None:
    test_finance_reserve_when_batch_would_omit_fresh_finance()
    test_cap_helper_prefers_newest_fresh_native_finance()
    print("PASS test_iu_backpressure_finance_liveness_reserve")


if __name__ == "__main__":
    _run()
