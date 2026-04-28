#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shared blocklist helpers for ingest/export (infoUzel)."""

from __future__ import annotations

import re
import unicodedata


def iu_norm_ascii_lower(s: str) -> str:
    """Lowercase + strip combining marks (č→c). Collapse whitespace."""
    try:
        t = unicodedata.normalize("NFD", str(s or ""))
        t = "".join(ch for ch in t if unicodedata.category(ch) != "Mn")
        t = t.lower()
        return re.sub(r"\s+", " ", t).strip()
    except Exception:
        return re.sub(r"\s+", " ", str(s or "").lower()).strip()


def iu_is_blocked_pocasicko_source(*parts: str) -> bool:
    """
    Block the specific YouTube brand/channel „Počasíčko“ / pocasicko (any case, any diacritics on letters).
    Does NOT block generic substring „počasí“ / „pocasi“ without the „cko“ tail.
    """
    blob = iu_norm_ascii_lower(" ".join(str(p or "") for p in parts))
    return "pocasicko" in blob
