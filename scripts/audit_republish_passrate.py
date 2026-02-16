#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Audit tool: measure how many RSS items would pass strict republish filter.

Rules (strict):
- missing image => DROP
- prefer og:image, then twitter:image, then first <img>
- image domain must be in IMAGE_ALLOWLIST
- banned providers (Getty/Reuters/AP/Shutterstock/Alamy...) => DROP
- image license must be machine-verified; if not verifiable => DROP

Outputs:
- projects/data/republish_audit_summary.json
- projects/data/republish_audit_items.jsonl
- projects/data/republish_audit_report.md

This script is measurement-only. It does NOT modify production pipeline.
"""

from __future__ import annotations

import argparse
import hashlib
import html as html_lib
import json
import os
import random
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse, unquote, urlencode
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "projects" / "data"
CACHE_DIR = ROOT / ".cache" / "republish_audit"

SOURCES_PATH = DATA_DIR / "sources_allowlist.json"
IMAGE_ALLOWLIST_PATH = DATA_DIR / "image_allowlist.json"

OUT_SUMMARY = DATA_DIR / "republish_audit_summary.json"
OUT_ITEMS = DATA_DIR / "republish_audit_items.jsonl"
OUT_REPORT = DATA_DIR / "republish_audit_report.md"

USER_AGENT = "infoUzel-audit/1.0 (+https://infouzel.cz)"

TIMEOUT_S = 15
RETRIES = 2  # in addition to first attempt
SLEEP_MIN_S = 0.3
SLEEP_MAX_S = 0.6


BANNED_PROVIDER_SUBSTRINGS = [
    "getty", "gettyimages",
    "reuters",
    "apimages", "associatedpress", "associated-press",
    "shutterstock",
    "alamy",
    "imago-images", "imago image", "imagoimage",
]


def sha1_hex(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, obj: Any) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def cache_path(url: str, kind: str) -> Path:
    # kind examples: rss, html, api
    return CACHE_DIR / f"{sha1_hex(url)}.{kind}"


@dataclass
class FetchResult:
    url: str
    final_url: str
    status: int
    content_type: str
    body: bytes


class RateLimiter:
    def __init__(self, min_s: float, max_s: float):
        self.min_s = min_s
        self.max_s = max_s
        self._last = 0.0

    def wait(self) -> None:
        # Random sleep between requests (global).
        delay = random.uniform(self.min_s, self.max_s)
        now = time.time()
        # Ensure spacing even if caller loops quickly
        elapsed = now - self._last if self._last else 999.0
        if elapsed < delay:
            time.sleep(delay - elapsed)
        else:
            time.sleep(delay)
        self._last = time.time()


def http_fetch(url: str, accept: str, no_cache: bool, limiter: RateLimiter) -> FetchResult:
    ensure_dir(CACHE_DIR)
    kind = "bin"
    if accept.startswith("application/rss") or "xml" in accept:
        kind = "rss"
    elif accept.startswith("text/html"):
        kind = "html"
    elif "json" in accept:
        kind = "api"

    cpath = cache_path(url, kind)
    if (not no_cache) and cpath.exists():
        raw = cpath.read_bytes()
        meta_path = cpath.with_suffix(cpath.suffix + ".meta.json")
        meta = {}
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                meta = {}
        return FetchResult(
            url=url,
            final_url=meta.get("final_url", url),
            status=int(meta.get("status", 200)),
            content_type=str(meta.get("content_type", "")),
            body=raw,
        )

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": accept,
        "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.3",
        "Cache-Control": "no-cache",
    }

    last_exc: Optional[Exception] = None
    attempts = 1 + RETRIES
    for i in range(attempts):
        limiter.wait()
        try:
            req = Request(url, headers=headers, method="GET")
            with urlopen(req, timeout=TIMEOUT_S) as resp:
                status = getattr(resp, "status", 200) or 200
                final_url = resp.geturl() or url
                content_type = resp.headers.get("Content-Type", "") or ""
                body = resp.read() or b""
                fr = FetchResult(url=url, final_url=final_url, status=status, content_type=content_type, body=body)
                if not no_cache:
                    cpath.write_bytes(body)
                    cpath.with_suffix(cpath.suffix + ".meta.json").write_text(
                        json.dumps(
                            {
                                "url": url,
                                "final_url": final_url,
                                "status": status,
                                "content_type": content_type,
                                "fetched_at": now_iso(),
                            },
                            ensure_ascii=False,
                            indent=2,
                        )
                        + "\n",
                        encoding="utf-8",
                    )
                return fr
        except HTTPError as e:
            last_exc = e
            # Retry only for rate limit / server errors
            if e.code in (429,) or (500 <= e.code <= 599):
                continue
            raise
        except (URLError, TimeoutError) as e:
            last_exc = e
            continue
        except Exception as e:
            last_exc = e
            continue

    raise RuntimeError(f"Fetch failed after {attempts} attempts: {url} ({last_exc})")


def strip_ns(tag: str) -> str:
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def parse_feed_items(xml_bytes: bytes) -> List[Dict[str, str]]:
    """
    Returns list of dicts with keys:
    - link
    - title
    """
    if not xml_bytes:
        return []
    # Decode with fallback (ElementTree needs str or bytes; bytes ok but encoding must be declared)
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        # Non-XML content (often HTML consent pages / blocks) => treat as parse failure.
        return []

    local = strip_ns(root.tag).lower()

    items: List[Dict[str, str]] = []

    if local == "rss":
        channel = None
        for ch in root:
            if strip_ns(ch.tag).lower() == "channel":
                channel = ch
                break
        if channel is None:
            return []
        for it in channel:
            if strip_ns(it.tag).lower() != "item":
                continue
            link = ""
            title = ""
            for c in it:
                t = strip_ns(c.tag).lower()
                if t == "link" and (c.text or "").strip():
                    link = (c.text or "").strip()
                if t == "title" and (c.text or "").strip():
                    title = (c.text or "").strip()
            if link:
                items.append({"link": link, "title": title})
        return items

    # Atom or others: <feed><entry>...
    if local == "feed":
        for entry in root:
            if strip_ns(entry.tag).lower() != "entry":
                continue
            link = ""
            title = ""
            for c in entry:
                t = strip_ns(c.tag).lower()
                if t == "title" and (c.text or "").strip():
                    title = (c.text or "").strip()
                if t == "link":
                    href = c.attrib.get("href", "").strip()
                    rel = (c.attrib.get("rel", "") or "").strip().lower()
                    if href and (not link) and (rel in ("", "alternate")):
                        link = href
            if link:
                items.append({"link": link, "title": title})
        return items

    # Fallback: try find any <item> elements
    for elem in root.iter():
        if strip_ns(elem.tag).lower() == "item":
            link = ""
            title = ""
            for c in elem:
                t = strip_ns(c.tag).lower()
                if t == "link" and (c.text or "").strip():
                    link = (c.text or "").strip()
                if t == "title" and (c.text or "").strip():
                    title = (c.text or "").strip()
            if link:
                items.append({"link": link, "title": title})
    return items


class ImgCandidateParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.og_image: Optional[str] = None
        self.tw_image: Optional[str] = None
        self.first_img: Optional[str] = None

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        tag_l = tag.lower()
        attrs_d = {k.lower(): (v or "") for k, v in attrs}

        if tag_l == "meta":
            prop = (attrs_d.get("property") or "").strip().lower()
            name = (attrs_d.get("name") or "").strip().lower()
            content = (attrs_d.get("content") or "").strip()
            if not content:
                return
            if prop in ("og:image", "og:image:url") and self.og_image is None:
                self.og_image = content
            if name == "twitter:image" and self.tw_image is None:
                self.tw_image = content

        if tag_l == "img" and self.first_img is None:
            src = (attrs_d.get("src") or "").strip()
            if not src:
                return
            if src.startswith("data:"):
                return
            self.first_img = src


def pick_image_from_html(html_text: str, base_url: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Returns (image_url, source) where source is one of: og, twitter, img
    """
    p = ImgCandidateParser()
    try:
        p.feed(html_text)
    except Exception:
        # best-effort: HTMLParser can choke on very broken markup
        pass

    cand = None
    src = None
    if p.og_image:
        cand = p.og_image
        src = "og"
    elif p.tw_image:
        cand = p.tw_image
        src = "twitter"
    elif p.first_img:
        cand = p.first_img
        src = "img"

    if not cand:
        return (None, None)

    cand = html_lib.unescape(cand).strip()
    full = urljoin(base_url, cand)
    return (full, src)


def host_of(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except Exception:
        return ""


def is_allowed_domain(host: str, allowed: List[str]) -> bool:
    host = (host or "").lower()
    for d in allowed:
        d = d.lower()
        if host == d:
            return True
        if host.endswith("." + d):
            return True
    return False


def detect_banned_provider(image_url: str) -> Optional[str]:
    u = (image_url or "").lower()
    for s in BANNED_PROVIDER_SUBSTRINGS:
        if s in u:
            return s
    return None


def wikimedia_filename_from_upload(url: str) -> Optional[str]:
    """
    Best-effort mapping:
    - upload.wikimedia.org/wikipedia/commons/.../<FileName>
    """
    p = urlparse(url)
    path = p.path or ""
    if "/wikipedia/commons/" not in path:
        return None
    name = path.rsplit("/", 1)[-1]
    name = unquote(name)
    name = name.strip()
    if not name:
        return None
    return name


def commons_filename_from_file_page(url: str) -> Optional[str]:
    """
    commons.wikimedia.org/wiki/File:Name
    """
    p = urlparse(url)
    path = p.path or ""
    m = re.search(r"/wiki/File:(.+)$", path, flags=re.IGNORECASE)
    if not m:
        return None
    name = unquote(m.group(1)).strip()
    if not name:
        return None
    return name


def commons_api_query(filename: str, no_cache: bool, limiter: RateLimiter) -> Dict[str, Any]:
    params = {
        "action": "query",
        "titles": f"File:{filename}",
        "prop": "imageinfo",
        "iiprop": "extmetadata",
        "format": "json",
    }
    url = "https://commons.wikimedia.org/w/api.php?" + urlencode(params)
    fr = http_fetch(url, accept="application/json", no_cache=no_cache, limiter=limiter)
    try:
        return json.loads(fr.body.decode("utf-8", errors="replace"))
    except Exception:
        return {}


def normalize_license_text(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"\s+", " ", s)
    return s


def is_license_allowed(license_text: str) -> bool:
    t = normalize_license_text(license_text)
    if not t:
        return False

    # Hard disallow if NC/ND variants are present
    if "noncommercial" in t or "non-commercial" in t or re.search(r"(?:\bcc\b.*\bby\b.*-nc\b|\bby-nc\b|-nc\b)", t):
        return False
    if "no derivatives" in t or "no-derivatives" in t or re.search(r"(?:\bcc\b.*\bby\b.*-nd\b|\bby-nd\b|-nd\b)", t):
        return False

    # CC BY / CC BY-SA
    if "cc by-sa" in t or "cc-by-sa" in t or "attribution-sharealike" in t:
        return True
    if "cc by" in t or "cc-by" in t or "creative commons attribution" in t:
        return True

    # Public domain variants (incl. CC0)
    if "public domain" in t or t.startswith("pd") or "cc0" in t or "cc zero" in t:
        return True

    return False


def extract_commons_license(meta: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    """
    Returns (license_short, license_url) if present.
    """
    try:
        pages = meta.get("query", {}).get("pages", {})
        if not isinstance(pages, dict) or not pages:
            return (None, None)
        page = next(iter(pages.values()))
        imageinfo = (page.get("imageinfo") or [])
        if not imageinfo:
            return (None, None)
        ext = imageinfo[0].get("extmetadata") or {}
        if not isinstance(ext, dict):
            return (None, None)
        lic = None
        lic_url = None

        for key in ("LicenseShortName", "License"):
            if key in ext and isinstance(ext[key], dict):
                lic = ext[key].get("value") or lic
        if "LicenseUrl" in ext and isinstance(ext["LicenseUrl"], dict):
            lic_url = ext["LicenseUrl"].get("value") or lic_url
        if lic:
            lic = re.sub(r"<[^>]+>", "", str(lic)).strip()
        if lic_url:
            lic_url = re.sub(r"<[^>]+>", "", str(lic_url)).strip()
        return (lic or None, lic_url or None)
    except Exception:
        return (None, None)


def audit_article(
    source_id: str,
    rss_url: str,
    article_url: str,
    title: str,
    image_allowed_domains: List[str],
    no_cache: bool,
    limiter: RateLimiter,
) -> Dict[str, Any]:
    """
    Returns result dict for JSONL.
    """
    base = {
        "source_id": source_id,
        "rss_url": rss_url,
        "article_url": article_url,
        "title": title,
        "image_url": "",
        "image_domain": "",
        "image_pick": "",
        "result": "FAIL",
        "reason": "",
        "license_short": "",
        "license_url": "",
    }

    # Fetch article HTML
    try:
        fr = http_fetch(article_url, accept="text/html,*/*;q=0.8", no_cache=no_cache, limiter=limiter)
    except Exception:
        base["reason"] = "article_fetch_failed"
        return base

    html_text = fr.body.decode("utf-8", errors="replace")
    img_url, img_pick = pick_image_from_html(html_text, fr.final_url or article_url)
    if not img_url:
        base["reason"] = "missing_image"
        return base

    base["image_pick"] = img_pick or ""

    banned_hit = detect_banned_provider(img_url)
    if banned_hit:
        # Hard drop + redact image URL from audit log (gate: no banned provider strings in JSONL).
        base["reason"] = "banned_provider_detected"
        base["banned_signal"] = banned_hit
        return base

    base["image_url"] = img_url

    img_host = host_of(img_url)
    base["image_domain"] = img_host
    if not is_allowed_domain(img_host, image_allowed_domains):
        base["reason"] = "image_domain_not_allowlisted"
        return base

    # License verification (strict: if not machine-verifiable -> drop)
    if img_host == "audiovisual.ec.europa.eu":
        base["reason"] = "eu_avs_not_implemented"
        return base

    # Wikimedia: upload.wikimedia.org or commons.wikimedia.org
    filename = None
    if img_host == "upload.wikimedia.org":
        filename = wikimedia_filename_from_upload(img_url)
    elif img_host == "commons.wikimedia.org":
        filename = commons_filename_from_file_page(img_url)

    if not filename:
        base["reason"] = "image_license_unknown"
        return base

    meta = commons_api_query(filename, no_cache=no_cache, limiter=limiter)
    lic_short, lic_url = extract_commons_license(meta)

    if not lic_short:
        base["reason"] = "image_license_unknown"
        return base

    base["license_short"] = lic_short
    base["license_url"] = lic_url or ""

    if not is_license_allowed(lic_short):
        base["reason"] = "image_license_not_allowed"
        return base

    base["result"] = "PASS"
    base["reason"] = ""
    return base


def build_report(summary: Dict[str, Any], items: List[Dict[str, Any]]) -> str:
    lines: List[str] = []
    lines.append("# Republish audit report")
    lines.append("")
    lines.append(f"- generated_at: `{summary.get('generated_at')}`")
    lines.append(f"- items_per_feed: `{summary.get('limits', {}).get('items_per_feed')}`")
    lines.append("")

    totals = summary.get("totals", {})
    lines.append("## Totals")
    lines.append("")
    lines.append(f"- feeds: **{totals.get('feeds', 0)}**")
    lines.append(f"- items: **{totals.get('items', 0)}**")
    lines.append(f"- pass: **{totals.get('pass', 0)}**")
    lines.append(f"- fail: **{totals.get('fail', 0)}**")
    lines.append(f"- pass_rate: **{totals.get('pass_rate', 0)}**")
    lines.append("")

    lines.append("## By source")
    lines.append("")
    lines.append("| source | items | pass | fail | pass_rate | top_fail_reasons |")
    lines.append("|---|---:|---:|---:|---:|---|")
    for s in summary.get("by_source", []):
        tfr = s.get("top_fail_reasons", {}) or {}
        tfr_s = ", ".join([f"{k}={v}" for k, v in sorted(tfr.items(), key=lambda kv: (-kv[1], kv[0]))[:5]])
        lines.append(
            f"| {s.get('id')} | {s.get('items')} | {s.get('pass')} | {s.get('fail')} | {s.get('pass_rate')} | {tfr_s} |"
        )
    lines.append("")

    # Overall fail reasons
    overall: Dict[str, int] = {}
    for it in items:
        if it.get("result") != "PASS":
            r = it.get("reason") or "unknown"
            overall[r] = overall.get(r, 0) + 1
    lines.append("## Top drop reasons (overall)")
    lines.append("")
    for k, v in sorted(overall.items(), key=lambda kv: (-kv[1], kv[0]))[:20]:
        lines.append(f"- **{k}**: {v}")
    lines.append("")

    # PASS examples
    pass_items = [it for it in items if it.get("result") == "PASS"]
    lines.append("## PASS examples (up to 10)")
    lines.append("")
    for it in pass_items[:10]:
        lic = (it.get("license_short") or "").strip()
        lic_url = (it.get("license_url") or "").strip()
        lic_part = lic
        if lic_url:
            lic_part = f"{lic} ({lic_url})"
        lines.append(f"- article: {it.get('article_url')}")
        lines.append(f"  - image: {it.get('image_url')}")
        lines.append(f"  - license: {lic_part or '—'}")
    if not pass_items:
        lines.append("- (none)")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--items-per-feed", type=int, default=30)
    ap.add_argument("--source-id", type=str, default="")
    ap.add_argument("--no-cache", action="store_true")
    args = ap.parse_args()

    if not SOURCES_PATH.exists():
        raise SystemExit(f"Missing config: {SOURCES_PATH}")
    if not IMAGE_ALLOWLIST_PATH.exists():
        raise SystemExit(f"Missing config: {IMAGE_ALLOWLIST_PATH}")

    sources_cfg = read_json(SOURCES_PATH)
    image_cfg = read_json(IMAGE_ALLOWLIST_PATH)

    sources = sources_cfg.get("sources") or []
    allowed_domains = image_cfg.get("allowed_domains") or []
    if not isinstance(allowed_domains, list):
        raise SystemExit("image_allowlist.json: allowed_domains must be an array")

    if args.source_id:
        sources = [s for s in sources if s.get("id") == args.source_id]
        if not sources:
            raise SystemExit(f"Unknown --source-id: {args.source_id}")

    limiter = RateLimiter(SLEEP_MIN_S, SLEEP_MAX_S)

    all_items: List[Dict[str, Any]] = []
    by_source: List[Dict[str, Any]] = []

    for src in sources:
        sid = str(src.get("id") or "").strip()
        sname = str(src.get("name") or "").strip()
        rss_list = src.get("rss") or []
        if not sid or not rss_list:
            continue

        src_results: List[Dict[str, Any]] = []

        for rss_url in rss_list:
            try:
                fr = http_fetch(str(rss_url), accept="application/rss+xml,application/xml;q=0.9,*/*;q=0.5", no_cache=bool(args.no_cache), limiter=limiter)
            except Exception:
                # If a feed fetch fails, record a synthetic fail line for visibility
                src_results.append(
                    {
                        "source_id": sid,
                        "rss_url": str(rss_url),
                        "article_url": "",
                        "title": "",
                        "image_url": "",
                        "image_domain": "",
                        "image_pick": "",
                        "result": "FAIL",
                        "reason": "rss_fetch_failed",
                        "license_short": "",
                        "license_url": "",
                    }
                )
                continue

            feed_items = parse_feed_items(fr.body)
            if not feed_items:
                # Some feeds may return HTML consent pages or blocked responses; keep visibility.
                src_results.append(
                    {
                        "source_id": sid,
                        "rss_url": str(rss_url),
                        "article_url": "",
                        "title": "",
                        "image_url": "",
                        "image_domain": "",
                        "image_pick": "",
                        "result": "FAIL",
                        "reason": "rss_parse_failed",
                        "license_short": "",
                        "license_url": "",
                    }
                )
                continue
            for it in feed_items[: max(0, int(args.items_per_feed))]:
                article_url = (it.get("link") or "").strip()
                title = (it.get("title") or "").strip()
                if not article_url:
                    continue
                res = audit_article(
                    source_id=sid,
                    rss_url=str(rss_url),
                    article_url=article_url,
                    title=title,
                    image_allowed_domains=list(allowed_domains),
                    no_cache=bool(args.no_cache),
                    limiter=limiter,
                )
                src_results.append(res)

        # Aggregate per source
        items_n = len([r for r in src_results if r.get("article_url")])
        pass_n = len([r for r in src_results if r.get("result") == "PASS"])
        fail_n = len([r for r in src_results if r.get("result") != "PASS" and r.get("article_url")])
        pass_rate = (pass_n / items_n) if items_n else 0.0
        reasons: Dict[str, int] = {}
        for r in src_results:
            if r.get("result") == "PASS":
                continue
            reason = r.get("reason") or "unknown"
            if r.get("article_url"):
                reasons[reason] = reasons.get(reason, 0) + 1

        by_source.append(
            {
                "id": sid,
                "name": sname,
                "items": items_n,
                "pass": pass_n,
                "fail": fail_n,
                "pass_rate": round(pass_rate, 3),
                "top_fail_reasons": dict(sorted(reasons.items(), key=lambda kv: (-kv[1], kv[0]))[:10]),
            }
        )

        all_items.extend(src_results)

    # Only count real items (article_url present)
    real_items = [it for it in all_items if it.get("article_url")]
    total_items = len(real_items)
    total_pass = len([it for it in real_items if it.get("result") == "PASS"])
    total_fail = total_items - total_pass
    totals = {
        "feeds": len(sources),
        "items": total_items,
        "pass": total_pass,
        "fail": total_fail,
        "pass_rate": round((total_pass / total_items) if total_items else 0.0, 4),
    }

    summary = {
        "generated_at": now_iso(),
        "limits": {"items_per_feed": int(args.items_per_feed)},
        "totals": totals,
        "by_source": sorted(by_source, key=lambda s: (-s.get("pass_rate", 0), s.get("id", ""))),
    }

    # Write outputs
    ensure_dir(DATA_DIR)
    write_json(OUT_SUMMARY, summary)

    with OUT_ITEMS.open("w", encoding="utf-8") as f:
        for it in real_items:
            # Keep JSONL stable; include required fields + a few extra for audit/reporting.
            out = {
                "source_id": it.get("source_id", ""),
                "article_url": it.get("article_url", ""),
                "image_url": it.get("image_url", ""),
                "image_domain": it.get("image_domain", ""),
                "result": it.get("result", "FAIL"),
                "reason": it.get("reason", ""),
                "license_short": it.get("license_short", ""),
                "license_url": it.get("license_url", ""),
            }
            f.write(json.dumps(out, ensure_ascii=False) + "\n")

    report_md = build_report(summary, real_items)
    OUT_REPORT.write_text(report_md, encoding="utf-8")

    # Console table (quick glance)
    print("source_id\titems\tpass\tfail\tpass_rate")
    for s in summary["by_source"]:
        print(f"{s['id']}\t{s['items']}\t{s['pass']}\t{s['fail']}\t{s['pass_rate']}")
    print("")
    print(f"TOTAL\t{totals['items']}\t{totals['pass']}\t{totals['fail']}\t{totals['pass_rate']}")
    print(f"Outputs: {OUT_SUMMARY} | {OUT_ITEMS} | {OUT_REPORT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

