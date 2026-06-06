# -*- coding: utf-8 -*-
"""
Global per-source ingest telemetry for build_articles pipeline (audit / loss chain).
Output: projects/data/ingest_telemetry/latest.json (written at publish time only).
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

PRAGUE_TZ = ZoneInfo("Europe/Prague")


TELEMETRY_SCHEMA_VERSION = 2

VERTICAL_BUCKETS = frozenset({"sport", "finance", "zdravi", "cestovani"})
OTHER_VERTICAL = frozenset({"hry", "kultura", "veda", "vzdelavani", "tech", "bydleni"})


def section_bucket(section: str) -> str:
    """Map article/topic to telemetry roll-up buckets."""
    s = (section or "").strip().lower()
    if s in VERTICAL_BUCKETS:
        return s
    if s in OTHER_VERTICAL:
        return "other"
    return "zpravy"


def _iso_max(a: str | None, b: str | None) -> str | None:
    if not a:
        return b
    if not b:
        return a
    try:
        da = datetime.fromisoformat(a.replace("Z", "+00:00"))
        db = datetime.fromisoformat(b.replace("Z", "+00:00"))
        return a if da >= db else b
    except Exception:
        return b


def _registry_by_id(registry: dict) -> dict[str, dict]:
    out: dict[str, dict] = {}
    entries = registry.get("entries") if isinstance(registry, dict) else None
    if not isinstance(entries, list):
        return out
    for e in entries:
        if isinstance(e, dict) and e.get("id"):
            out[str(e["id"]).strip()] = e
    return out


def _fid(it: dict) -> str:
    return str(it.get("feedId") or "").strip() or "_unknown"


def _eligible_release(a: dict) -> bool:
    raw = a.get("iuReleaseAt")
    if not raw:
        return True
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00")) <= datetime.now(timezone.utc)
    except Exception:
        return True


def _prague_day_from_iso(iso: str) -> str | None:
    if not iso or len(str(iso).strip()) < 10:
        return None
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(PRAGUE_TZ).strftime("%Y-%m-%d")
    except Exception:
        return None


def _prague_today_iso(run_time: str | None) -> str:
    if run_time:
        try:
            dt = datetime.fromisoformat(str(run_time).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(PRAGUE_TZ).strftime("%Y-%m-%d")
        except Exception:
            pass
    return datetime.now(timezone.utc).astimezone(PRAGUE_TZ).strftime("%Y-%m-%d")


def _empty_mapped() -> dict[str, int]:
    return {"zpravy": 0, "sport": 0, "finance": 0, "zdravi": 0, "cestovani": 0, "other": 0}


def _empty_drops() -> dict[str, int]:
    return {
        "missing_publishedAt": 0,
        "invalid_publishedAt": 0,
        "parser_drop": 0,
        "section_remap": 0,
        "release_gate": 0,
        "dedupe": 0,
        "other": 0,
    }


def _merge_mapped(dst: dict[str, int], src: dict | None) -> None:
    if not isinstance(src, dict):
        return
    for k, v in src.items():
        kk = str(k)
        if kk in dst:
            try:
                dst[kk] += int(v)
            except Exception:
                pass


def _merge_drops(dst: dict[str, int], src: dict | None) -> None:
    if not isinstance(src, dict):
        return
    for k, v in src.items():
        if k in dst:
            try:
                dst[k] += int(v)
            except Exception:
                pass


def _canonical_source_id_from_report(r: dict, feed_u: str) -> str:
    """
    Must match article item feedId / registry id. Prefer explicit registryId on the feed report,
    then registryGroup[0].id; URL is last-resort fallback (legacy / YouTube-style rows).
    """
    sid = str(r.get("registryId") or "").strip()
    if sid:
        return sid
    rg = r.get("registryGroup")
    if isinstance(rg, list) and rg and isinstance(rg[0], dict):
        sid = str(rg[0].get("id") or "").strip()
    if sid:
        return sid
    return (feed_u or "").strip() or "_unknown"


def build_telemetry_payload(
    *,
    per_feed_report: list[dict],
    deduped_items: list[dict],
    clusters: list[Any],
    new_articles: list[dict],
    final_articles: list[dict],
    registry: dict,
    generated_at: str,
    run_time_utc: str | None = None,
) -> tuple[dict, dict]:
    """Build per-source telemetry + summary. Deterministic ordering."""
    rt = run_time_utc or generated_at
    reg = _registry_by_id(registry)
    today_prague = _prague_today_iso(rt)

    c_ded = Counter(_fid(it) for it in deduped_items)

    clust_drop = Counter()
    clust_win = Counter()
    for c in clusters:
        items = getattr(c, "items", None) or []
        if not items:
            continue
        prim = sorted(items, key=lambda x: x.get("dt"), reverse=True)[0]
        clust_win[_fid(prim)] += 1
        for it in items:
            if it is not prim:
                clust_drop[_fid(it)] += 1

    c_fin = Counter(
        str(a.get("feedId") or "").strip()
        for a in final_articles
        if str(a.get("feedId") or "").strip()
    )
    eligible_fin = Counter()
    release_blocked_fin = Counter()
    for a in final_articles:
        fid = str(a.get("feedId") or "").strip()
        if not fid:
            continue
        if _eligible_release(a):
            eligible_fin[fid] += 1
        else:
            release_blocked_fin[fid] += 1

    newest_written: str | None = None
    for a in final_articles:
        p = str(a.get("publishedAt") or "").strip()
        if len(p) < 10:
            continue
        newest_written = _iso_max(newest_written, p)

    acc: dict[str, dict[str, Any]] = {}

    for r in per_feed_report:
        feed_u = str(r.get("feed") or "")
        sid = _canonical_source_id_from_report(r, feed_u)

        reg_e = reg.get(sid, {})
        label = str(r.get("source") or reg_e.get("label") or sid)
        topic = str(r.get("topic") or reg_e.get("topic") or "aktualne")
        sec_pri = str(reg_e.get("section_primary") or r.get("topic") or "aktualne")

        items_parsed = int(r.get("itemsParsed", 0) or 0)
        accepted = int(r.get("accepted", 0) or 0)
        tel = r.get("iuTelemetry") if isinstance(r.get("iuTelemetry"), dict) else {}
        mapped_in = tel.get("mapped_to_section_count")
        drops_in = tel.get("drop_counts")
        raw_new = int(tel.get("raw_feed_new_item_count", 0) or 0)
        raw_latest = str(tel.get("raw_feed_latest_publishedAt") or "")
        valid_pa = int(tel.get("valid_publishedAt_count", 0) or 0)
        samples = list(tel.get("sample_titles") or [])

        if sid not in acc:
            acc[sid] = {
                "source_id": sid,
                "registry_id": sid,
                "source_label": label,
                "feed_url": feed_u,
                "topic": topic,
                "section_primary": sec_pri,
                "generatedAt": generated_at,
                "run_time_utc": rt,
                "raw_feed_item_count": 0,
                "raw_feed_new_item_count": 0,
                "raw_feed_latest_publishedAt": "",
                "ingested_item_count": 0,
                "parsed_item_count": 0,
                "normalized_item_count": 0,
                "valid_publishedAt_count": 0,
                "mapped_to_section_count": _empty_mapped(),
                "release_eligible_count": 0,
                "written_to_articles_json_count": 0,
                "today_written_to_articles_json_count": 0,
                "newest_written_publishedAt": "",
                "drop_counts": _empty_drops(),
                "sample_titles": [],
                "_sample_acc": [],
            }
        a = acc[sid]
        a["raw_feed_item_count"] += items_parsed
        a["raw_feed_new_item_count"] += raw_new
        a["raw_feed_latest_publishedAt"] = (
            _iso_max(a.get("raw_feed_latest_publishedAt") or None, raw_latest or None) or a["raw_feed_latest_publishedAt"]
        )
        a["ingested_item_count"] += accepted
        a["parsed_item_count"] += accepted
        a["normalized_item_count"] += accepted
        a["valid_publishedAt_count"] += valid_pa
        _merge_mapped(a["mapped_to_section_count"], mapped_in)
        _merge_drops(a["drop_counts"], drops_in)
        for st in samples:
            if isinstance(st, dict):
                a["_sample_acc"].append(st)

    rows: list[dict] = []
    for sid in sorted(acc.keys()):
        row = acc[sid]
        samples_acc = row.pop("_sample_acc", [])
        ing_ct = int(row.get("ingested_item_count", 0) or 0)
        ded_ct = int(c_ded.get(sid, 0) or 0)
        feed_l = str(row.get("feed_url") or "").lower()
        if "youtube.com" in feed_l:
            row["drop_counts"]["dedupe"] = 0
        else:
            row["drop_counts"]["dedupe"] = max(0, ing_ct - ded_ct)
        row["cluster_nonprimary_drop_count"] = int(clust_drop.get(sid, 0) or 0)
        row["cluster_primary_win_count"] = int(clust_win.get(sid, 0) or 0)
        written = int(c_fin.get(sid, 0) or 0)
        elig = int(eligible_fin.get(sid, 0) or 0)
        row["written_to_articles_json_count"] = written
        today_written = 0
        for art in final_articles:
            if str(art.get("feedId") or "").strip() != sid:
                continue
            if _prague_day_from_iso(str(art.get("publishedAt") or "")) == today_prague:
                today_written += 1
        row["today_written_to_articles_json_count"] = today_written
        row["release_eligible_count"] = elig
        row["drop_counts"]["release_gate"] = int(release_blocked_fin.get(sid, 0) or 0)

        nw = ""
        for art in final_articles:
            if str(art.get("feedId") or "").strip() != sid:
                continue
            p = str(art.get("publishedAt") or "").strip()
            if len(p) < 10:
                continue
            nw = _iso_max(nw or None, p) or nw
        row["newest_written_publishedAt"] = nw
        samp = samples_acc[:20]
        seen_t = set()
        uniq = []
        for s in samp:
            t = str(s.get("title") or "")[:200]
            if t in seen_t:
                continue
            seen_t.add(t)
            uniq.append({"title": s.get("title"), "publishedAt": s.get("publishedAt")})
        row["sample_titles"] = uniq[:20]
        rows.append(row)

    written_by_section = defaultdict(int)
    written_by_section.update({"zpravy": 0, "sport": 0, "finance": 0, "zdravi": 0, "cestovani": 0})
    for art in final_articles:
        b = section_bucket(str(art.get("topic") or art.get("section") or ""))
        if b == "other":
            written_by_section["zpravy"] += 1
        elif b in written_by_section:
            written_by_section[b] += 1
        else:
            written_by_section["zpravy"] += 1

    total_raw = sum(int(x.get("raw_feed_item_count", 0) or 0) for x in rows)
    total_ing = sum(int(x.get("ingested_item_count", 0) or 0) for x in rows)
    total_ded = sum(int(c_ded.get(x.get("source_id"), 0) or 0) for x in rows)
    total_written = sum(int(x.get("written_to_articles_json_count", 0) or 0) for x in rows)

    src_new = sum(1 for x in rows if int(x.get("raw_feed_new_item_count", 0) or 0) > 0)

    by_new = sorted(rows, key=lambda x: int(x.get("raw_feed_new_item_count", 0) or 0), reverse=True)
    by_written = sorted(
        rows, key=lambda x: int(x.get("written_to_articles_json_count", 0) or 0), reverse=True
    )
    by_drop = sorted(
        rows,
        key=lambda x: int(x.get("raw_feed_item_count", 0) or 0)
        - int(x.get("written_to_articles_json_count", 0) or 0),
        reverse=True,
    )

    def top_list(arr: list, field: str, n: int = 10) -> list:
        out = []
        for r in arr[:n]:
            out.append({"source_id": r.get("source_id"), "feed_url": r.get("feed_url"), field: r.get(field)})
        return out

    by_raw_minus_w = [
        {
            "source_id": r.get("source_id"),
            "feed_url": r.get("feed_url"),
            "raw_minus_written": int(r.get("raw_feed_item_count", 0) or 0)
            - int(r.get("written_to_articles_json_count", 0) or 0),
        }
        for r in by_drop[:10]
    ]

    summary = {
        "schemaVersion": TELEMETRY_SCHEMA_VERSION,
        "generatedAt": generated_at,
        "run_time_utc": rt,
        "sources_checked": len(rows),
        "sources_with_new_items": src_new,
        "total_raw_items": total_raw,
        "total_parsed_items": total_ing,
        "total_normalized_items": total_ing,
        "total_after_dedupe_items": total_ded,
        "total_written_articles_feed_attributed": total_written,
        "written_by_section": dict(written_by_section),
        "newest_written_publishedAt": newest_written or "",
        "top_sources_by_new_items": top_list(by_new, "raw_feed_new_item_count"),
        "top_sources_by_written_items": top_list(by_written, "written_to_articles_json_count"),
        "top_drop_sources": by_raw_minus_w,
    }

    clean_rows = []
    for row in rows:
        c = dict(row)
        c.pop("cluster_nonprimary_drop_count", None)
        c.pop("cluster_primary_win_count", None)
        clean_rows.append(c)

    detail = {
        "schemaVersion": TELEMETRY_SCHEMA_VERSION,
        "generatedAt": generated_at,
        "run_time_utc": rt,
        "summary": summary,
        "sources": clean_rows,
    }

    return detail, summary


def print_compact_audit(summary: dict) -> None:
    print("=== INGEST TELEMETRY (compact) ===", flush=True)
    print(
        f"sources_with_new_items={summary.get('sources_with_new_items')} "
        f"sources_checked={summary.get('sources_checked')} "
        f"newest_written_publishedAt={summary.get('newest_written_publishedAt')}",
        flush=True,
    )
    print("top10 new_items:", flush=True)
    for row in (summary.get("top_sources_by_new_items") or [])[:10]:
        print(f"  {row.get('source_id')} new={row.get('raw_feed_new_item_count')}", flush=True)
    print("top10 written_items:", flush=True)
    for row in (summary.get("top_sources_by_written_items") or [])[:10]:
        print(f"  {row.get('source_id')} written={row.get('written_to_articles_json_count')}", flush=True)
    print("top10 raw_minus_written:", flush=True)
    for row in (summary.get("top_drop_sources") or [])[:10]:
        print(f"  {row.get('source_id')} drop={row.get('raw_minus_written')}", flush=True)
