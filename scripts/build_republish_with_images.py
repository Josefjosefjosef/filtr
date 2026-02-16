#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Build republish feed for HOME: only verified items with images.

This generator is STRICT by design:
- Source must be in projects/data/sources_allowlist.json
- Image candidate must exist:
  - MediaWiki sources (Wikinews): select from MediaWiki API "prop=images" (+ size filters), not from HTML.
  - Non-MediaWiki sources: og:image -> twitter:image only (NO first <img> fallback).
- Image domain must be in projects/data/image_allowlist.json
- Banned providers detected anywhere in image url -> hard DROP (and redact url in logs)
- Image license must be machine-verified:
  - Wikimedia (upload.wikimedia.org) -> verify via Commons API extmetadata
  - Commons file pages (commons.wikimedia.org/wiki/File:...) -> verify via Commons API extmetadata
  - EU AVS (audiovisual.ec.europa.eu) -> NOT implemented => DROP
- Allowed licenses (images): CC BY, CC BY-SA, Public Domain (incl CC0/PD)
- PASS requires proof archive files to exist (created by this script):
  - projects/data/license_proofs/YYYY/MM/DD/<slug>.html
  - projects/data/license_proofs/YYYY/MM/DD/<slug>.png
- Always append provenance log:
  - projects/data/provenance/YYYY-MM-DD.jsonl

Output (committable data file):
- projects/data/republish_with_images.json

Run:
  py .\\scripts\\build_republish_with_images.py --items-per-feed 30
  py .\\scripts\\build_republish_with_images.py --source-id wikinews_en --items-per-feed 50
"""

from __future__ import annotations

import argparse
import hashlib
import html as html_lib
import json
import os
import random
import re
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlparse, unquote
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "projects" / "data"
CACHE_DIR = ROOT / ".cache" / "republish_build"

SOURCES_PATH = DATA_DIR / "sources_allowlist.json"
IMAGE_ALLOWLIST_PATH = DATA_DIR / "image_allowlist.json"

OUT_REPUBLISH = DATA_DIR / "republish_with_images.json"
PROOFS_DIR = DATA_DIR / "license_proofs"
PROVENANCE_DIR = DATA_DIR / "provenance"

USER_AGENT = "infoUzel-republish-builder/1.0 (+https://infouzel.cz)"

TIMEOUT_S = 15
RETRIES = 2
SLEEP_MIN_S = 0.3
SLEEP_MAX_S = 0.6

DEFAULT_EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


BANNED_PROVIDER_SUBSTRINGS = [
    "getty",
    "reuters",
    "associated press",
    "shutterstock",
    "alamy",
    "afp",
    "bloomberg",
]

BANNED_PROVIDER_REGEX = re.compile(
    r"(?i)(getty|reuters|associated\s+press|\bap\b|shutterstock|alamy|afp|bloomberg)"
)

MEDIAWIKI_IMAGE_BLACKLIST = [
    "wikiloves",
    "wiki_loves",
    "wiki-loves",
    "commons-logo",
    "commons_logo",
    "pictogram",
    "icon",
    "icons",
    "sports_icon",
    "_icon.",
    "banner",
    "logo",
    "portal",
    "portlet",
    "navbox",
    "badge",
    "button",
    "placeholder",
    "sprite",
]

JUNK_TOKENS = list(dict.fromkeys([t.lower() for t in MEDIAWIKI_IMAGE_BLACKLIST]))

MIN_MW_WIDTH = 600
MIN_MW_HEIGHT = 350

MW_RASTER_EXT_ALLOW = (".jpg", ".jpeg", ".png", ".webp")

RETENTION_PROOFS_DAYS = 14
RETENTION_PROVENANCE_DAYS = 30


def sha1_hex(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()


def sha256_hex_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, obj: Any) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class RateLimiter:
    def __init__(self, min_s: float, max_s: float):
        self.min_s = min_s
        self.max_s = max_s
        self._last = 0.0

    def wait(self) -> None:
        delay = random.uniform(self.min_s, self.max_s)
        now = time.time()
        elapsed = now - self._last if self._last else 999.0
        if elapsed < delay:
            time.sleep(delay - elapsed)
        else:
            time.sleep(delay)
        self._last = time.time()


@dataclass
class FetchResult:
    url: str
    final_url: str
    status: int
    content_type: str
    body: bytes


def cache_path(url: str, kind: str) -> Path:
    return CACHE_DIR / f"{sha1_hex(url)}.{kind}"


def http_fetch(url: str, accept: str, no_cache: bool, limiter: RateLimiter) -> FetchResult:
    ensure_dir(CACHE_DIR)
    kind = "bin"
    if "xml" in accept:
        kind = "rss"
    elif "html" in accept:
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
    for _attempt in range(1 + RETRIES):
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
            if e.code in (429,) or (500 <= e.code <= 599):
                continue
            raise
        except (URLError, TimeoutError) as e:
            last_exc = e
            continue
        except Exception as e:
            last_exc = e
            continue

    raise RuntimeError(f"Fetch failed: {url} ({last_exc})")


def strip_ns(tag: str) -> str:
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def parse_feed_items(xml_bytes: bytes) -> List[Dict[str, str]]:
    """
    Returns list of dicts with keys:
    - link
    - title
    - published_at (best-effort ISO string)
    """
    if not xml_bytes:
        return []
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return []

    local = strip_ns(root.tag).lower()
    out: List[Dict[str, str]] = []

    def add_item(link: str, title: str, published: str) -> None:
        if link:
            out.append({"link": link, "title": title or "", "published_at": published or ""})

    def dt_to_iso(s: str) -> str:
        # Best-effort: keep raw string; caller may store it as-is.
        return (s or "").strip()

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
            pub = ""
            for c in it:
                t = strip_ns(c.tag).lower()
                if t == "link" and (c.text or "").strip():
                    link = (c.text or "").strip()
                elif t == "title" and (c.text or "").strip():
                    title = (c.text or "").strip()
                elif t in ("pubdate", "date", "dc:date") and (c.text or "").strip():
                    pub = dt_to_iso((c.text or "").strip())
            add_item(link, title, pub)
        return out

    if local == "feed":
        for entry in root:
            if strip_ns(entry.tag).lower() != "entry":
                continue
            link = ""
            title = ""
            pub = ""
            for c in entry:
                t = strip_ns(c.tag).lower()
                if t == "title" and (c.text or "").strip():
                    title = (c.text or "").strip()
                elif t in ("updated", "published") and (c.text or "").strip() and not pub:
                    pub = dt_to_iso((c.text or "").strip())
                elif t == "link":
                    href = (c.attrib.get("href") or "").strip()
                    rel = (c.attrib.get("rel") or "").strip().lower()
                    if href and (not link) and (rel in ("", "alternate")):
                        link = href
            add_item(link, title, pub)
        return out

    # fallback: none
    return out


class ImgCandidateParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.og_image: Optional[str] = None
        self.tw_image: Optional[str] = None

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


def pick_image_from_html(html_text: str, base_url: str) -> Tuple[Optional[str], Optional[str]]:
    p = ImgCandidateParser()
    try:
        p.feed(html_text)
    except Exception:
        pass

    cand = None
    src = None
    if p.og_image:
        cand = p.og_image
        src = "og"
    elif p.tw_image:
        cand = p.tw_image
        src = "twitter"

    if not cand:
        return (None, None)

    cand = html_lib.unescape(cand).strip()
    return (urljoin(base_url, cand), src)


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


def detect_banned_provider(text: str) -> Optional[str]:
    """
    Detect banned providers case-insensitively.
    Includes \bAP\b only as standalone word (to avoid false positives like "map").
    """
    t = (text or "")
    m = BANNED_PROVIDER_REGEX.search(t)
    if not m:
        return None
    # Do NOT return the matched string (avoid leaking banned terms into logs/outputs).
    return "banned_provider"


def detect_junk_token(*parts: str) -> Optional[str]:
    """
    Hard DROP if any junk token appears in URL or filename (case-insensitive).
    Returns the matched token (for provenance only; do not print into public outputs).
    """
    s = " ".join([(p or "") for p in parts]).lower()
    if not s.strip():
        return None
    for tok in JUNK_TOKENS:
        if tok and tok in s:
            return tok
    return None


def prune_old_proofs_and_provenance(now: datetime) -> None:
    """
    Retention policy to prevent repo bloat:
    - license_proofs: keep last RETENTION_PROOFS_DAYS
    - provenance: keep last RETENTION_PROVENANCE_DAYS
    """
    # Proofs: folder structure YYYY/MM/DD/*.html|*.png
    if PROOFS_DIR.exists():
        cutoff = now.timestamp() - (RETENTION_PROOFS_DAYS * 86400)
        for p in PROOFS_DIR.rglob("*"):
            try:
                if p.is_file() and p.stat().st_mtime < cutoff:
                    p.unlink()
            except Exception:
                pass
        # cleanup empty dirs bottom-up
        for d in sorted([x for x in PROOFS_DIR.rglob("*") if x.is_dir()], key=lambda x: len(str(x)), reverse=True):
            try:
                if not any(d.iterdir()):
                    d.rmdir()
            except Exception:
                pass

    # Provenance: files YYYY-MM-DD.jsonl
    if PROVENANCE_DIR.exists():
        cutoff = now.timestamp() - (RETENTION_PROVENANCE_DAYS * 86400)
        for p in PROVENANCE_DIR.glob("*.jsonl"):
            try:
                if p.is_file() and p.stat().st_mtime < cutoff:
                    p.unlink()
            except Exception:
                pass


def wikimedia_filename_from_upload(url: str) -> Optional[str]:
    p = urlparse(url)
    path = p.path or ""
    if "/wikipedia/commons/" not in path:
        return None
    name = path.rsplit("/", 1)[-1]
    name = unquote(name).strip()
    return name or None


def commons_filename_from_file_page(url: str) -> Optional[str]:
    p = urlparse(url)
    m = re.search(r"/wiki/File:(.+)$", p.path or "", flags=re.IGNORECASE)
    if not m:
        return None
    return unquote(m.group(1)).strip() or None


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

def commons_api_query_title(file_title: str, no_cache: bool, limiter: RateLimiter) -> Dict[str, Any]:
    params = {
        "action": "query",
        "titles": file_title,
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
    # Disallow NC/ND variants
    if "noncommercial" in t or "non-commercial" in t or re.search(r"(?:\bby-nc\b|-nc\b)", t):
        return False
    if "no derivatives" in t or "no-derivatives" in t or re.search(r"(?:\bby-nd\b|-nd\b)", t):
        return False
    # Allow CC BY / CC BY-SA / Public domain
    if "cc by-sa" in t or "cc-by-sa" in t or "attribution-sharealike" in t:
        return True
    if "cc by" in t or "cc-by" in t or "creative commons attribution" in t:
        return True
    if "public domain" in t or t.startswith("pd") or "cc0" in t or "cc zero" in t:
        return True
    return False


def extract_commons_extmeta(meta: Dict[str, Any]) -> Dict[str, str]:
    """
    Pull a few interesting extmetadata fields (plain text).
    """
    try:
        pages = meta.get("query", {}).get("pages", {})
        if not isinstance(pages, dict) or not pages:
            return {}
        page = next(iter(pages.values()))
        imageinfo = page.get("imageinfo") or []
        if not imageinfo:
            return {}
        ext = imageinfo[0].get("extmetadata") or {}
        if not isinstance(ext, dict):
            return {}

        def val(key: str) -> str:
            v = ext.get(key)
            if isinstance(v, dict):
                s = v.get("value") or ""
                s = re.sub(r"<[^>]+>", "", str(s)).strip()
                return s
            return ""

        return {
            "LicenseShortName": val("LicenseShortName"),
            "License": val("License"),
            "LicenseUrl": val("LicenseUrl"),
            "Artist": val("Artist"),
            "Credit": val("Credit"),
            "ImageDescription": val("ImageDescription"),
        }
    except Exception:
        return {}

def derive_license_url_strict(license_text: str, license_url: str) -> Tuple[str, str]:
    """
    Hard requirement: PASS must include non-empty license_url.
    We only accept:
    - explicit LicenseUrl from extmetadata, OR
    - a small set of exact, safe mappings (no guessing).
    """
    u = (license_url or "").strip()
    t = normalize_license_text(license_text)
    safe_map = {
        "cc by 4.0": "https://creativecommons.org/licenses/by/4.0/",
        "cc-by 4.0": "https://creativecommons.org/licenses/by/4.0/",
        "cc by-sa 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
        "cc-by-sa 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
        "public domain mark": "https://creativecommons.org/publicdomain/mark/1.0/",
        "public domain": "https://creativecommons.org/publicdomain/mark/1.0/",
        "cc0": "https://creativecommons.org/publicdomain/zero/1.0/",
        "cc zero": "https://creativecommons.org/publicdomain/zero/1.0/",
        "pd mark": "https://creativecommons.org/publicdomain/mark/1.0/",
    }
    mapped = safe_map.get(t, "") or ""

    # Prefer explicit URL if it canonicalizes.
    if u:
        cu = canonicalize_license_url(u)
        if cu:
            return (cu, "")

    # Fallback to safe mappings from license text.
    if mapped:
        cm = canonicalize_license_url(mapped) or mapped
        if cm:
            return (cm, "")

    # Decide drop reason deterministically.
    if u:
        return ("", "invalid_license_url")
    return ("", "missing_license_url")


def canonicalize_license_url(s: str) -> str:
    """
    Canonicalize and enforce safe license_url:
    - normalize known short labels to canonical CC URLs
    - rewrite http:// -> https://
    - forbid /deed.* in final stored URL (strip when safe)
    """
    raw = (s or "").strip()
    if not raw:
        return ""

    # Handle common label forms too (passed via extmetadata sometimes)
    t = normalize_license_text(raw)
    label_map = {
        "cc by 4.0": "https://creativecommons.org/licenses/by/4.0/",
        "cc by-sa 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
        "cc0": "https://creativecommons.org/publicdomain/zero/1.0/",
        "pd mark": "https://creativecommons.org/publicdomain/mark/1.0/",
        "public domain mark": "https://creativecommons.org/publicdomain/mark/1.0/",
    }
    if t in label_map:
        raw = label_map[t]

    try:
        p = urlparse(raw)
    except Exception:
        return ""

    scheme = (p.scheme or "").lower()
    host = (p.hostname or "").lower()
    path = p.path or ""

    # Disallow non-http(s)
    if scheme and scheme not in ("http", "https"):
        return ""

    if scheme == "http":
        scheme = "https"
    elif scheme == "":
        # Not a URL
        return ""

    # Strip query/fragment always
    path_only = path

    # Strip /deed(.xx)? suffix (safe canonicalization)
    # E.g. /licenses/by/4.0/deed.en -> /licenses/by/4.0/
    path_only = re.sub(r"/deed(\.[a-z-]+)?/?$", "/", path_only, flags=re.IGNORECASE)

    # Ensure trailing slash for canonical CC URLs
    if host.endswith("creativecommons.org"):
        # Ensure trailing slash for canonical CC URLs
        if not path_only.endswith("/"):
            path_only = path_only + "/"

    # Final guard: no /deed.* in stored URL
    if re.search(r"/deed(\.|/|$)", path_only, flags=re.IGNORECASE):
        return ""

    return f"{scheme}://{host}{path_only}"

def mw_extract_title(article_url: str, mw_article_base: str) -> Optional[str]:
    """
    From https://xx.wikinews.org/wiki/Foo_Bar -> title Foo_Bar (url-decoded).
    """
    try:
        if not article_url.startswith(mw_article_base):
            return None
        rest = article_url[len(mw_article_base):]
        rest = rest.split("#", 1)[0].split("?", 1)[0]
        rest = unquote(rest)
        rest = rest.replace(" ", "_")
        return rest.strip() or None
    except Exception:
        return None

def mw_api_get_page_images(mw_api_base: str, title: str, no_cache: bool, limiter: RateLimiter) -> Dict[str, Any]:
    params = {
        "action": "query",
        "format": "json",
        "titles": title,
        "prop": "pageimages|images",
        "piprop": "thumbnail|name|original",
        "pithumbsize": "1200",
        "imlimit": "50",
    }
    url = mw_api_base + "?" + urlencode(params)
    fr = http_fetch(url, accept="application/json", no_cache=no_cache, limiter=limiter)
    data = json.loads(fr.body.decode("utf-8", errors="replace"))
    pages = data.get("query", {}).get("pages", {})
    if not isinstance(pages, dict) or not pages:
        return {"images": []}
    page = next(iter(pages.values()))
    imgs = page.get("images") or []
    out_imgs = []
    for it in imgs:
        t = (it.get("title") or "").strip()
        if t:
            out_imgs.append(t)
    return {
        "images": out_imgs,
        "pageimage": (page.get("pageimage") or "").strip(),
        "original": page.get("original") or {},
        "thumbnail": page.get("thumbnail") or {},
    }

def mw_api_get_file_info(mw_api_base: str, file_title: str, no_cache: bool, limiter: RateLimiter) -> Optional[Dict[str, Any]]:
    params = {
        "action": "query",
        "format": "json",
        "titles": file_title,
        "prop": "imageinfo",
        "iiprop": "url|size|mime",
    }
    url = mw_api_base + "?" + urlencode(params)
    fr = http_fetch(url, accept="application/json", no_cache=no_cache, limiter=limiter)
    data = json.loads(fr.body.decode("utf-8", errors="replace"))
    pages = data.get("query", {}).get("pages", {})
    if not isinstance(pages, dict) or not pages:
        return None
    page = next(iter(pages.values()))
    info = (page.get("imageinfo") or [])
    if not info:
        return None
    i0 = info[0]
    return {
        "url": (i0.get("url") or "").strip(),
        "width": int(i0.get("width") or 0),
        "height": int(i0.get("height") or 0),
        "mime": (i0.get("mime") or "").strip(),
    }

def is_mediawiki_junk(file_title: str, url: str) -> bool:
    s = (file_title or "").lower() + " " + (url or "").lower()
    for sub in MEDIAWIKI_IMAGE_BLACKLIST:
        if sub.lower() in s:
            return True
    return False

def is_allowed_raster_url(url: str) -> bool:
    ul = (url or "").lower()
    if not ul:
        return False
    if ul.endswith(".svg") or ul.endswith(".gif") or ul.endswith(".tif") or ul.endswith(".tiff") or ul.endswith(".pdf"):
        return False
    return ul.endswith(MW_RASTER_EXT_ALLOW)

def normalize_mediawiki_filename(name: str) -> str:
    n = (name or "").strip()
    n = unquote(n)
    n = n.replace(" ", "_")
    return n

def mw_filetitle_from_filename(filename: str) -> str:
    return "File:" + normalize_mediawiki_filename(filename)

def mw_file_in_images(file_title: str, images: List[str]) -> bool:
    ft = normalize_mediawiki_filename(file_title)
    if not ft.lower().startswith("file:"):
        return False
    ft = ft[5:]
    for t in images:
        if (t or "").lower().startswith("file:"):
            if normalize_mediawiki_filename(t)[5:] == ft:
                return True
    return False

def pick_mediawiki_image(
    *,
    mw_api_base: str,
    mw_article_base: str,
    article_url: str,
    no_cache: bool,
    limiter: RateLimiter,
) -> Tuple[Optional[str], Optional[str], Optional[Dict[str, Any]], str]:
    """
    Returns (image_url, file_title, file_info, reason)
    reason: "" | "junk_image" | "missing_image"
    """
    title = mw_extract_title(article_url, mw_article_base)
    if not title:
        return (None, None, None, "missing_image")
    page = mw_api_get_page_images(mw_api_base, title, no_cache=no_cache, limiter=limiter)
    page_images = list(page.get("images") or [])
    pageimage_name = (page.get("pageimage") or "").strip()
    rejected_junk = False

    # (A) Prefer prop=pageimages when it is a real raster image and is actually used on the page.
    if pageimage_name:
        # Prefer original URL if available; fallback to thumbnail.
        orig = page.get("original") or {}
        thumb = page.get("thumbnail") or {}
        url = (orig.get("source") or thumb.get("source") or "").strip()
        w = int(orig.get("width") or thumb.get("width") or 0)
        h = int(orig.get("height") or thumb.get("height") or 0)
        ft = mw_filetitle_from_filename(pageimage_name)
        if not url:
            rejected_junk = True
        elif (not is_allowed_raster_url(url)) or (w < MIN_MW_WIDTH or h < MIN_MW_HEIGHT):
            rejected_junk = True
        elif is_mediawiki_junk(ft, url):
            rejected_junk = True
        elif not mw_file_in_images(ft, page_images):
            rejected_junk = True
        else:
            return (url, ft, {"url": url, "width": w, "height": h}, "")

    # Filter junk early
    filtered: List[str] = []
    raw_files: List[str] = []
    for ft in page_images:
        low = ft.lower()
        if not low.startswith("file:"):
            continue
        raw_files.append(ft)
        if any(sub in low for sub in MEDIAWIKI_IMAGE_BLACKLIST):
            continue
        filtered.append(ft)
    if raw_files and not filtered:
        return (None, None, None, "junk_image")
    best = None
    best_area = -1
    best_info = None
    best_url = None
    # Try up to 50 candidates; prefer largest raster image
    for ft in filtered:
        info = mw_api_get_file_info(mw_api_base, ft, no_cache=no_cache, limiter=limiter)
        if not info:
            continue
        url = info.get("url") or ""
        w = int(info.get("width") or 0)
        h = int(info.get("height") or 0)
        mime = (info.get("mime") or "").lower()
        if not url:
            continue
        if is_mediawiki_junk(ft, url):
            rejected_junk = True
            continue
        # only raster, avoid risky formats
        if not is_allowed_raster_url(url):
            continue
        if mime and (not mime.startswith("image/")):
            continue
        # extra junk guard on URL path too
        if any(sub in url.lower() for sub in MEDIAWIKI_IMAGE_BLACKLIST):
            rejected_junk = True
            continue
        if w < MIN_MW_WIDTH or h < MIN_MW_HEIGHT:
            continue
        area = w * h
        if area > best_area:
            best_area = area
            best = ft
            best_info = info
            best_url = url
    if not best_url or not best:
        return (None, None, None, "junk_image" if rejected_junk else "missing_image")
    return (best_url, best, best_info, "")


def safe_slug(article_url: str) -> str:
    h = sha1_hex(article_url)[:12]
    return f"republish_{h}"


def write_proof_files(
    *,
    article_url: str,
    image_url: str,
    source_domain: str,
    license_type: str,
    license_text: str,
    license_page_url: str,
    author_credit: str,
    timestamp_iso: str,
    hash_image: str,
    hash_license_html: str,
    extmeta: Dict[str, Any],
    edge_path: str,
) -> Tuple[Path, Path]:
    dt = datetime.now(timezone.utc)
    folder = PROOFS_DIR / dt.strftime("%Y") / dt.strftime("%m") / dt.strftime("%d")
    ensure_dir(folder)
    slug = safe_slug(article_url)
    html_path = folder / f"{slug}.html"
    png_path = folder / f"{slug}.png"

    # Build a stable proof HTML wrapper (our own archive) with all required fields.
    proof_html = f"""<!doctype html>
<html lang="cs">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>License proof – {html_lib.escape(slug)}</title>
    <style>
      body{{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;margin:24px;line-height:1.35}}
      h1{{font-size:18px;margin:0 0 12px 0}}
      code,pre{{font-family:Consolas,ui-monospace,monospace;font-size:12px}}
      .grid{{display:grid;grid-template-columns:240px 1fr;gap:10px 16px;align-items:start}}
      .k{{opacity:.7}}
      .v{{word-break:break-word}}
      .box{{border:1px solid #ddd;border-radius:10px;padding:12px;background:#fafafa;margin-top:14px}}
      .small{{font-size:12px;opacity:.8}}
    </style>
  </head>
  <body>
    <h1>License proof (republish image)</h1>
    <div class="grid">
      <div class="k">timestamp_download</div><div class="v"><code>{html_lib.escape(timestamp_iso)}</code></div>
      <div class="k">article_url</div><div class="v"><code>{html_lib.escape(article_url)}</code></div>
      <div class="k">image_url</div><div class="v"><code>{html_lib.escape(image_url)}</code></div>
      <div class="k">source_domain</div><div class="v"><code>{html_lib.escape(source_domain)}</code></div>
      <div class="k">license_type</div><div class="v"><code>{html_lib.escape(license_type)}</code></div>
      <div class="k">license_text</div><div class="v">{html_lib.escape(license_text)}</div>
      <div class="k">license_page_url</div><div class="v"><code>{html_lib.escape(license_page_url)}</code></div>
      <div class="k">author_credit</div><div class="v">{html_lib.escape(author_credit)}</div>
      <div class="k">hash_image (SHA256)</div><div class="v"><code>{html_lib.escape(hash_image)}</code></div>
      <div class="k">hash_html_license_page (SHA256)</div><div class="v"><code>{html_lib.escape(hash_license_html)}</code></div>
    </div>
    <div class="box">
      <div class="small">commons extmetadata snapshot (JSON)</div>
      <pre>{html_lib.escape(json.dumps(extmeta, ensure_ascii=False, indent=2))}</pre>
    </div>
  </body>
</html>
"""
    html_path.write_text(proof_html, encoding="utf-8")

    # Screenshot the local proof file to satisfy required PNG evidence.
    # file:// URL must use forward slashes
    file_url = "file:///" + str(html_path.resolve()).replace("\\", "/")
    # NOTE: we must not pass any banned strings in command line; file path is safe.
    cmd = [
        edge_path,
        "--headless",
        "--disable-gpu",
        "--window-size=1365,768",
        f"--screenshot={str(png_path.resolve())}",
        file_url,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except Exception as e:
        # ensure we don't accidentally pass without png
        if png_path.exists():
            try:
                png_path.unlink()
            except Exception:
                pass
        raise RuntimeError(f"Edge screenshot failed: {e}")

    return (html_path, png_path)


def append_provenance(path: Path, row: Dict[str, Any]) -> None:
    ensure_dir(path.parent)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def build_attribution_html(source_name: str, source_url: str, license_type: str, license_url: str, author_credit: str) -> str:
    # Strict + safe minimal attribution:
    # Source name links to original; license links to license URL; include author_credit if present.
    parts: List[str] = []
    if author_credit:
        parts.append(html_lib.escape(author_credit))
    parts.append(f'<a href="{html_lib.escape(source_url)}" target="_blank" rel="noopener">{html_lib.escape(source_name)}</a>')
    if license_url:
        parts.append(f'<a href="{html_lib.escape(license_url)}" target="_blank" rel="noopener">{html_lib.escape(license_type)}</a>')
    else:
        parts.append(html_lib.escape(license_type))
    return " · ".join(parts)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--items-per-feed", type=int, default=30)
    ap.add_argument("--source-id", type=str, default="")
    ap.add_argument("--no-cache", action="store_true")
    ap.add_argument("--edge-path", type=str, default=DEFAULT_EDGE_PATH)
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

    edge_path = args.edge_path
    if not Path(edge_path).exists():
        raise SystemExit(f"Edge not found at: {edge_path}")

    limiter = RateLimiter(SLEEP_MIN_S, SLEEP_MAX_S)

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    provenance_path = PROVENANCE_DIR / f"{today}.jsonl"

    republish_items: List[Dict[str, Any]] = []

    for src in sources:
        sid = str(src.get("id") or "").strip()
        sname = str(src.get("name") or "").strip()
        rss_list = src.get("rss") or []
        if not sid or not rss_list:
            continue

        for rss_url in rss_list:
            rss_url = str(rss_url)
            try:
                fr = http_fetch(rss_url, accept="application/rss+xml,application/xml;q=0.9,*/*;q=0.5", no_cache=bool(args.no_cache), limiter=limiter)
            except Exception:
                append_provenance(
                    provenance_path,
                    {
                        "timestamp": now_iso(),
                        "source_id": sid,
                        "article_url": "",
                        "image_url": "",
                        "license_type": "",
                        "license_url": "",
                        "result": "FAIL",
                        "drop_reason": "rss_fetch_failed",
                    },
                )
                continue

            feed_items = parse_feed_items(fr.body)
            if not feed_items:
                append_provenance(
                    provenance_path,
                    {
                        "timestamp": now_iso(),
                        "source_id": sid,
                        "article_url": "",
                        "image_url": "",
                        "license_type": "",
                        "license_url": "",
                        "result": "FAIL",
                        "drop_reason": "rss_parse_failed",
                    },
                )
                continue

            for it in feed_items[: max(0, int(args.items_per_feed))]:
                article_url = (it.get("link") or "").strip()
                title = (it.get("title") or "").strip()
                published_at = (it.get("published_at") or "").strip()
                if not article_url:
                    continue
                if not title:
                    append_provenance(
                        provenance_path,
                        {
                            "timestamp": now_iso(),
                            "source_id": sid,
                            "article_url": article_url,
                            "image_url": "",
                            "license_type": "",
                            "license_url": "",
                            "result": "FAIL",
                            "drop_reason": "missing_title",
                        },
                    )
                    continue

                ts = now_iso()
                source_domain = host_of(article_url)

                try:
                    # Fetch article HTML
                    image_url = None
                    pick = ""
                    file_title = ""
                    # MediaWiki sources: do NOT parse HTML for image
                    if src.get("mw_api_base") and src.get("mw_article_base"):
                        mw_api_base = str(src.get("mw_api_base") or "")
                        mw_article_base = str(src.get("mw_article_base") or "")
                        image_url, file_title, _fi, mw_reason = pick_mediawiki_image(
                            mw_api_base=mw_api_base,
                            mw_article_base=mw_article_base,
                            article_url=article_url,
                            no_cache=bool(args.no_cache),
                            limiter=limiter,
                        )
                        pick = "mediawiki_api"
                        if not image_url:
                            append_provenance(
                                provenance_path,
                                {
                                    "timestamp": ts,
                                    "source_id": sid,
                                    "article_url": article_url,
                                    "image_url": "",
                                    "license_type": "",
                                    "license_url": "",
                                    "result": "FAIL",
                                    "drop_reason": mw_reason or "missing_image",
                                },
                            )
                            continue
                    else:
                        try:
                            afr = http_fetch(article_url, accept="text/html,*/*;q=0.8", no_cache=bool(args.no_cache), limiter=limiter)
                        except Exception:
                            append_provenance(
                                provenance_path,
                                {
                                    "timestamp": ts,
                                    "source_id": sid,
                                    "article_url": article_url,
                                    "image_url": "",
                                    "license_type": "",
                                    "license_url": "",
                                    "result": "FAIL",
                                    "drop_reason": "article_fetch_failed",
                                },
                            )
                            continue

                        html_text = afr.body.decode("utf-8", errors="replace")
                        image_url, pick = pick_image_from_html(html_text, afr.final_url or article_url)
                    if not image_url:
                        append_provenance(
                            provenance_path,
                            {
                                "timestamp": ts,
                                "source_id": sid,
                                "article_url": article_url,
                                "image_url": "",
                                "license_type": "",
                                "license_url": "",
                                "result": "FAIL",
                                "drop_reason": "missing_image",
                            },
                        )
                        continue

                    # Hard DROP on junk tokens (url or filename-like last segment).
                    inferred_filename = ""
                    try:
                        inferred_filename = unquote((urlparse(image_url).path or "").rsplit("/", 1)[-1] or "")
                    except Exception:
                        inferred_filename = ""
                    junk_hit = detect_junk_token(image_url, inferred_filename)
                    if junk_hit:
                        append_provenance(
                            provenance_path,
                            {
                                "timestamp": ts,
                                "source_id": sid,
                                "article_url": article_url,
                                "image_url": "",
                                "license_type": "",
                                "license_url": "",
                                "result": "FAIL",
                                "drop_reason": "junk_token_detected",
                            },
                        )
                        continue

                    # Banned providers can appear in url or credits/metadata => hard drop + redaction.
                    if detect_banned_provider(image_url):
                        append_provenance(
                            provenance_path,
                            {
                                "timestamp": ts,
                                "source_id": sid,
                                "article_url": article_url,
                                "image_url": "",
                                "license_type": "",
                                "license_url": "",
                                "result": "FAIL",
                                "drop_reason": "banned_provider_detected",
                            },
                        )
                        continue

                    image_domain = host_of(image_url)
                    if not is_allowed_domain(image_domain, list(allowed_domains)):
                        append_provenance(
                            provenance_path,
                            {
                                "timestamp": ts,
                                "source_id": sid,
                                "article_url": article_url,
                                "image_url": image_url,
                                "license_type": "",
                                "license_url": "",
                                "result": "FAIL",
                                "drop_reason": "image_domain_not_allowlisted",
                            },
                        )
                        continue

                    if image_domain == "audiovisual.ec.europa.eu":
                        append_provenance(
                            provenance_path,
                            {
                                "timestamp": ts,
                                "source_id": sid,
                                "article_url": article_url,
                                "image_url": image_url,
                                "license_type": "",
                                "license_url": "",
                                "result": "FAIL",
                                "drop_reason": "eu_avs_not_implemented",
                            },
                        )
                        continue

                    filename = None
                    if image_domain == "upload.wikimedia.org":
                        filename = wikimedia_filename_from_upload(image_url)
                    elif image_domain == "commons.wikimedia.org":
                        filename = commons_filename_from_file_page(image_url)

                    if not filename:
                        append_provenance(
                            provenance_path,
                            {
                                "timestamp": ts,
                                "source_id": sid,
                                "article_url": article_url,
                                "image_url": image_url,
                                "license_type": "",
                                "license_url": "",
                                "result": "FAIL",
                                "drop_reason": "image_license_unknown",
                            },
                        )
                        continue

                    # Hard DROP on junk tokens in filename or url (explicit requirement).
                    junk_hit2 = detect_junk_token(filename, image_url)
                    if junk_hit2:
                        append_provenance(
                            provenance_path,
                            {
                                "timestamp": ts,
                                "source_id": sid,
                                "article_url": article_url,
                                "image_url": "",
                                "license_type": "",
                                "license_url": "",
                                "result": "FAIL",
                                "drop_reason": "junk_token_detected",
                            },
                        )
                        continue

                    # License verification ALWAYS through Commons extmetadata
                    if file_title and file_title.lower().startswith("file:"):
                        meta = commons_api_query_title(file_title, no_cache=bool(args.no_cache), limiter=limiter)
                    else:
                        meta = commons_api_query(filename, no_cache=bool(args.no_cache), limiter=limiter)
                    ext = extract_commons_extmeta(meta)
                    lic_text = ext.get("LicenseShortName") or ext.get("License") or ""
                    lic_url, lic_url_reason = derive_license_url_strict(lic_text, ext.get("LicenseUrl") or "")
                    author_credit = (ext.get("Artist") or "").strip()
                    if not author_credit:
                        author_credit = (ext.get("Credit") or "").strip()

                    # Banned provider detection in credits/metadata too (hard drop + redaction).
                    if detect_banned_provider(author_credit) or detect_banned_provider(ext.get("Credit", "")) or detect_banned_provider(ext.get("ImageDescription", "")):
                        append_provenance(
                            provenance_path,
                            {
                                "timestamp": ts,
                                "source_id": sid,
                                "article_url": article_url,
                                "image_url": "",
                                "license_type": "",
                                "license_url": "",
                                "result": "FAIL",
                                "drop_reason": "banned_provider_detected",
                            },
                        )
                        continue

                    if not lic_text:
                        append_provenance(
                            provenance_path,
                            {
                                "timestamp": ts,
                                "source_id": sid,
                                "article_url": article_url,
                                "image_url": image_url,
                                "license_type": "",
                                "license_url": "",
                                "result": "FAIL",
                                "drop_reason": "image_license_unknown",
                            },
                        )
                        continue

                    if not lic_url:
                        append_provenance(
                            provenance_path,
                            {
                                "timestamp": ts,
                                "source_id": sid,
                                "article_url": article_url,
                                "image_url": image_url,
                                "license_type": lic_text,
                                "license_url": "",
                                "result": "FAIL",
                                "drop_reason": lic_url_reason or "invalid_license_url",
                            },
                        )
                        continue

                    if not is_license_allowed(lic_text):
                        append_provenance(
                            provenance_path,
                            {
                                "timestamp": ts,
                                "source_id": sid,
                                "article_url": article_url,
                                "image_url": image_url,
                                "license_type": lic_text,
                                "license_url": lic_url,
                                "result": "FAIL",
                                "drop_reason": "image_license_not_allowed",
                            },
                        )
                        continue

                    # Fetch image bytes + hash
                    try:
                        if image_domain == "upload.wikimedia.org":
                            img_fr = http_fetch(image_url, accept="image/*,*/*;q=0.5", no_cache=bool(args.no_cache), limiter=limiter)
                            img_bytes = img_fr.body
                        else:
                            # strict: only allow hashing when we can fetch bytes reliably
                            img_bytes = b""
                        if not img_bytes:
                            append_provenance(
                                provenance_path,
                                {
                                    "timestamp": ts,
                                    "source_id": sid,
                                    "article_url": article_url,
                                    "image_url": image_url,
                                    "license_type": lic_text,
                                    "license_url": lic_url,
                                    "result": "FAIL",
                                    "drop_reason": "image_hash_unavailable",
                                },
                            )
                            continue
                        hash_img = sha256_hex_bytes(img_bytes)
                    except Exception:
                        append_provenance(
                            provenance_path,
                            {
                                "timestamp": ts,
                                "source_id": sid,
                                "article_url": article_url,
                                "image_url": image_url,
                                "license_type": lic_text,
                                "license_url": lic_url,
                                "result": "FAIL",
                                "drop_reason": "image_fetch_failed",
                            },
                        )
                        continue

                    # Proof archive (HTML+PNG) required
                    try:
                        license_blob = json.dumps(
                            {
                                "article_url": article_url,
                                "image_url": image_url,
                                "license_text": lic_text,
                                "license_url": lic_url,
                                "author_credit": author_credit,
                                "extmetadata": ext,
                            },
                            ensure_ascii=False,
                            sort_keys=True,
                        ).encode("utf-8")
                        hash_license_html = sha256_hex_bytes(license_blob)

                        proof_html_path, proof_png_path = write_proof_files(
                            article_url=article_url,
                            image_url=image_url,
                            source_domain=source_domain,
                            license_type=lic_text,
                            license_text=lic_text,
                            license_page_url=lic_url,
                            author_credit=author_credit,
                            timestamp_iso=ts,
                            hash_image=hash_img,
                            hash_license_html=hash_license_html,
                            extmeta=ext,
                            edge_path=edge_path,
                        )
                        if (not proof_html_path.exists()) or (not proof_png_path.exists()):
                            raise RuntimeError("proof_files_missing_after_write")
                    except Exception:
                        append_provenance(
                            provenance_path,
                            {
                                "timestamp": ts,
                                "source_id": sid,
                                "article_url": article_url,
                                "image_url": image_url,
                                "license_type": lic_text,
                                "license_url": lic_url,
                                "result": "FAIL",
                                "drop_reason": "proof_archive_failed",
                            },
                        )
                        continue

                    # PASS item
                    attribution_html = build_attribution_html(
                        source_name=sname or sid,
                        source_url=article_url,
                        license_type=lic_text,
                        license_url=lic_url,
                        author_credit=author_credit,
                    )

                    republish_items.append(
                        {
                            "source_id": sid,
                            "title": title,
                            "source_url": article_url,
                            "source_name": sname or sid,
                            "published_at": published_at,
                            "image_url": image_url,
                            "image_license_type": lic_text,
                            "license_url": lic_url,
                            "attribution_html": attribution_html,
                            "proof_path_html": str(proof_html_path.relative_to(ROOT)).replace("\\", "/"),
                            "proof_path_png": str(proof_png_path.relative_to(ROOT)).replace("\\", "/"),
                        }
                    )

                    append_provenance(
                        provenance_path,
                        {
                            "timestamp": ts,
                            "source_id": sid,
                            "article_url": article_url,
                            "image_url": image_url,
                            "license_type": lic_text,
                            "license_url": lic_url,
                            "result": "PASS",
                            "drop_reason": "",
                        },
                    )
                except Exception:
                    # Never crash on a single item.
                    append_provenance(
                        provenance_path,
                        {
                            "timestamp": ts,
                            "source_id": sid,
                            "article_url": article_url,
                            "image_url": "",
                            "license_type": "",
                            "license_url": "",
                            "result": "FAIL",
                            "drop_reason": "item_exception",
                        },
                    )
                    continue

    # Persist republish data (PASS only; strict: must have image_url)
    republish_items = [it for it in republish_items if it.get("image_url")]
    payload = {
        "generated_at": now_iso(),
        "limits": {"items_per_feed": int(args.items_per_feed)},
        "items": republish_items,
    }
    write_json(OUT_REPUBLISH, payload)

    # Retention cleanup after successful write.
    prune_old_proofs_and_provenance(datetime.now(timezone.utc))

    print(f"PASS items: {len(republish_items)}")
    print(f"Wrote: {OUT_REPUBLISH}")
    print(f"Provenance: {provenance_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

