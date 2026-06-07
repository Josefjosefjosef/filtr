#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Native Zdraví liveness reserve in publish batch cap trimming."""
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
    tick_max_publish_items,
)


def _fresh_dt(minutes_ago: float = 30.0) -> str:
    dt = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    return dt.isoformat().replace("+00:00", "Z")


def _stale_dt() -> str:
    return "2026-01-01T00:00:00Z"


def _zdravi_item(
    url: str,
    *,
    dt: str | None = None,
    feed_id: str = "zdr_zdravezpravy",
) -> dict:
    return {
        "url": url,
        "dt": dt or _fresh_dt(),
        "feedId": feed_id,
        "topic": "zdravi",
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


def test_zdravi_reserve_when_batch_would_omit_fresh_zdravi():
    fresh = _zdravi_item("https://www.zdravezpravy.cz/fresh-reserve")
    items = _other_items(250) + [fresh]
    batch, meta = _run_split(items)
    urls = [str(x.get("url") or "") for x in batch]
    assert fresh["url"] in urls, f"fresh zdravi missing from batch meta={meta}"
    assert meta.get("zdravi_reserved") == 1
    assert urls.count(fresh["url"]) == 1
    assert len(batch) == tick_max_publish_items()


def test_no_duplicate_when_fresh_zdravi_already_in_small_batch():
    fresh = _zdravi_item("https://www.zdravezpravy.cz/already-in-batch")
    items = [fresh] + _other_items(5)
    batch, meta = _run_split(items)
    urls = [str(x.get("url") or "") for x in batch]
    assert urls.count(fresh["url"]) == 1
    assert len(batch) == len(items)
    assert meta.get("zdravi_reserved") == 0


def test_p0_preserved_alongside_zdravi_reserve():
    fresh = _zdravi_item("https://www.zdravezpravy.cz/with-p0")
    novinky = [
        {"url": f"https://www.novinky.cz/clanek/{i}", "dt": f"2026-06-05T12:{i:02d}:00Z"}
        for i in range(8)
    ]
    items = _other_items(250) + novinky + [fresh]
    batch, meta = _run_split(items)
    nov = [x for x in batch if "novinky.cz" in str(x.get("url") or "")]
    zdr = [x for x in batch if "zdravezpravy.cz" in str(x.get("url") or "")]
    assert len(nov) == 8, f"expected 8 novinky, got {len(nov)} meta={meta}"
    assert len(zdr) == 1
    assert meta.get("p0_reserved", 0) >= 8
    assert meta.get("zdravi_reserved") == 1


def test_determinism():
    fresh = _zdravi_item("https://www.zdravotnickydenik.cz/fresh-deterministic")
    items = _other_items(250, prefix="det") + [fresh]
    batch_a, meta_a = _run_split(items)
    batch_b, meta_b = _run_split(items)
    urls_a = [str(x.get("url") or "") for x in batch_a]
    urls_b = [str(x.get("url") or "") for x in batch_b]
    assert urls_a == urls_b
    assert meta_a == meta_b


def test_no_reserve_without_fresh_zdravi():
    stale = _zdravi_item("https://www.zdravezpravy.cz/stale", dt=_stale_dt())
    items = _other_items(250) + [stale]
    batch, meta = _run_split(items)
    zdr = [x for x in batch if "zdravezpravy.cz" in str(x.get("url") or "")]
    assert meta.get("zdravi_reserved") == 0
    assert len(zdr) == 0


def test_cap_helper_prefers_newest_fresh_native_zdravi():
    older = _zdravi_item(
        "https://www.zdravezpravy.cz/older",
        dt=_fresh_dt(90),
        feed_id="zdr_zdravezpravy",
    )
    newer = _zdravi_item(
        "https://www.zdravotnickydenik.cz/newer",
        dt=_fresh_dt(20),
        feed_id="zdr_zdravotnickydenik",
    )
    merged = _other_items(250) + [older, newer]
    batch, _, p0_n, zdr_n, fin_n, fv_n = _cap_batch_with_p0_reserves(merged, 180)
    urls = {str(x.get("url") or "") for x in batch}
    assert zdr_n == 1
    assert newer["url"] in urls
    assert p0_n == 0
    assert fin_n == 0
    assert fv_n == 0


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
    test_zdravi_reserve_when_batch_would_omit_fresh_zdravi()
    test_no_duplicate_when_fresh_zdravi_already_in_small_batch()
    test_p0_preserved_alongside_zdravi_reserve()
    test_determinism()
    test_no_reserve_without_fresh_zdravi()
    test_cap_helper_prefers_newest_fresh_native_zdravi()
    print("zdravi_reserve_test: PASS")
    print("p0_preserved_test: PASS")
    print("determinism_test: PASS")
    print("no_fresh_zdravi_test: PASS")
    print("PASS test_iu_backpressure_zdravi_liveness_reserve")


if __name__ == "__main__":
    _run()
