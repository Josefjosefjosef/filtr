#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Robustní Fetch Engine s retry, circuit breaker, karanténou
"""

import os
import time
import random
import sys
import urllib.robotparser
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, Tuple
from urllib.parse import urlparse, urljoin

import requests
import feedparser

# Domains that often return 403 to bots; report as http_403_blocked in diagnostics
BLOCKED_403_DOMAINS = ("irozhlas.cz",)


class CircuitBreaker:
    """
    Circuit breaker pro zdroje:
    - Po X consecutive failures → karanténa na N minut
    - Při success → re-enable
    """
    
    def __init__(self, failure_threshold: int = 3, cooldown_minutes: int = 30):
        self.failure_threshold = failure_threshold
        self.cooldown_minutes = cooldown_minutes
        self._state: Dict[str, Dict[str, Any]] = {}  # source_id -> {failures, quarantined_until}
    
    def is_quarantined(self, source_id: str) -> bool:
        """Zkontroluje, zda je zdroj v karanténě."""
        if source_id not in self._state:
            return False
        
        state = self._state[source_id]
        if not state.get("quarantined_until"):
            return False
        
        until = state["quarantined_until"]
        if datetime.now(timezone.utc) < until:
            return True
        
        # Karanténa vypršela
        state["quarantined_until"] = None
        state["failures"] = 0
        return False
    
    def record_success(self, source_id: str):
        """Zaznamená úspěch → reset failures."""
        if source_id not in self._state:
            self._state[source_id] = {"failures": 0, "quarantined_until": None}
        else:
            self._state[source_id]["failures"] = 0
            self._state[source_id]["quarantined_until"] = None
    
    def record_failure(self, source_id: str):
        """Zaznamená neúspěch → možná karanténa."""
        if source_id not in self._state:
            self._state[source_id] = {"failures": 0, "quarantined_until": None}
        
        state = self._state[source_id]
        state["failures"] = state.get("failures", 0) + 1
        
        if state["failures"] >= self.failure_threshold:
            # Přepnout do karantény
            state["quarantined_until"] = datetime.now(timezone.utc) + timedelta(
                minutes=self.cooldown_minutes
            )
            print(f"[CIRCUIT] Source {source_id} quarantined for {self.cooldown_minutes} minutes", 
                  file=sys.stderr)
    
    def get_state(self, source_id: str) -> Dict[str, Any]:
        """Vrací stav zdroje."""
        return self._state.get(source_id, {"failures": 0, "quarantined_until": None})


class FetchEngine:
    """
    Robustní fetch engine s:
    - Timeout (tvrdý)
    - Retry s exponenciálním backoff + jitter
    - Rozlišení: 429 retry, 5xx retry, 4xx většinou non-retry (kromě 429)
    - Log každého pokusu
    - Limit paralelismu (aby nebyl rate-limit)
    """
    
    def __init__(self, user_agent: str = "infoUzelBot/1.0 (+https://infouzel.cz/projects/bot/)"):
        self.user_agent = user_agent
        self.circuit_breaker = CircuitBreaker()
        self._robots_cache: Dict[str, Tuple[float, Optional[urllib.robotparser.RobotFileParser]]] = {}
        self._robots_ttl_sec = 6 * 60 * 60  # 6 hours

    def _host_key(self, url: str) -> str:
        """Hostname lower, without www."""
        try:
            p = urlparse(url)
            host = (p.hostname or "").lower()
            if host.startswith("www."):
                host = host[4:]
            return host
        except Exception:
            return ""

    def _robots_url(self, url: str) -> str:
        """Robots.txt URL from request URL origin (keeps scheme and port)."""
        try:
            return urljoin(url, "/robots.txt")
        except Exception:
            return ""

    def _get_robotparser(self, url: str) -> Optional[urllib.robotparser.RobotFileParser]:
        host = self._host_key(url)
        if not host:
            return None
        now = time.time()
        if host in self._robots_cache:
            cached_at, rp = self._robots_cache[host]
            if now - cached_at < self._robots_ttl_sec and rp is not None:
                return rp
            if now - cached_at < self._robots_ttl_sec and rp is None:
                return None  # cached failure → allow
        try:
            import urllib.request
            robots_url = self._robots_url(url)
            if not robots_url:
                return None
            req = urllib.request.Request(
                robots_url,
                headers={"User-Agent": self.user_agent, "From": "admin@infouzel.cz"},
            )
            with urllib.request.urlopen(req, timeout=5) as r:
                rp = urllib.robotparser.RobotFileParser()
                rp.parse(r.read().decode("utf-8", errors="replace").splitlines())
                self._robots_cache[host] = (now, rp)
                return rp
        except Exception:
            self._robots_cache[host] = (now, None)
            return None

    def _can_fetch(self, url: str) -> bool:
        if not self._host_key(url):
            return True
        rp = self._get_robotparser(url)
        if rp is None:
            # strict proof mode: deny when robots unavailable (deterministic proof)
            if os.environ.get("IU_ROBOTS_STRICT_PROOF") == "1":
                return False
            return True  # production: default allow on failure
        try:
            return rp.can_fetch(self.user_agent, url)
        except Exception:
            if os.environ.get("IU_ROBOTS_STRICT_PROOF") == "1":
                return False
            return True

    def fetch_with_retry(self, url: str, source_id: str, 
                       timeout_ms: int = 20000,
                       max_retries: int = 3,
                       backoff_base_ms: int = 1000) -> Tuple[Optional[Any], Dict[str, Any]]:
        """
        Fetch s retry mechanismem.
        
        Returns:
            (feed_dict, diagnostics_dict)
        """
        host = self._host_key(url)
        ts = datetime.now(timezone.utc).isoformat()
        diagnostics = {
            "url": url,
            "source_id": source_id,
            "host": host,
            "ts": ts,
            "httpStatus": 0,
            "contentType": "",
            "finalUrl": url,
            "bytes": 0,
            "reason": "",
            "bozo": False,
            "bozoException": "",
            "attempts": 0,
            "quarantined": False,
        }
        
        # 1) Kontrola karantény
        if self.circuit_breaker.is_quarantined(source_id):
            diagnostics["reason"] = "quarantined"
            diagnostics["quarantined"] = True
            return (None, diagnostics)
        
        # 2) robots.txt – pokud disallow → skip (žádný request, ne error)
        if not self._can_fetch(url):
            diagnostics["reason"] = "robots_disallow"
            diagnostics["skipped"] = True
            return (None, diagnostics)
        
        # 3) Retry loop
        for attempt in range(max_retries):
            diagnostics["attempts"] = attempt + 1
            
            try:
                # Fetch
                status_code, final_url, content_type, raw_bytes = self._robust_fetch(
                    url, timeout_ms
                )
                
                diagnostics["httpStatus"] = status_code
                diagnostics["contentType"] = content_type
                diagnostics["finalUrl"] = final_url
                diagnostics["bytes"] = len(raw_bytes) if raw_bytes else 0
                
                # Success
                if status_code == 200:
                    diagnostics["reason"] = "ok"
                    # Parse
                    feed_dict, parse_diag = self._parse_feed(raw_bytes, content_type)
                    diagnostics.update(parse_diag)
                    if not feed_dict:
                        diagnostics["reason"] = parse_diag.get("reason", "parse_failed")
                    
                    if feed_dict:
                        self.circuit_breaker.record_success(source_id)
                        return (feed_dict, diagnostics)
                    else:
                        self.circuit_breaker.record_failure(source_id)
                        return (None, diagnostics)
                
                # 429 (rate limit) → retry s backoff
                elif status_code == 429:
                    if attempt < max_retries - 1:
                        wait_ms = backoff_base_ms * (2 ** attempt) + random.randint(0, 500)
                        time.sleep(wait_ms / 1000.0)
                        continue
                    else:
                        diagnostics["reason"] = "http_429"
                        self.circuit_breaker.record_failure(source_id)
                        return (None, diagnostics)
                
                # 5xx (server error) → retry
                elif status_code >= 500:
                    if attempt < max_retries - 1:
                        wait_ms = backoff_base_ms * (2 ** attempt) + random.randint(0, 500)
                        time.sleep(wait_ms / 1000.0)
                        continue
                    else:
                        diagnostics["reason"] = "http_other"
                        self.circuit_breaker.record_failure(source_id)
                        return (None, diagnostics)
                
                # 4xx (kromě 429) → non-retry
                else:
                    if status_code == 403:
                        diagnostics["reason"] = "http_403_blocked" if host in BLOCKED_403_DOMAINS else "http_403"
                    else:
                        diagnostics["reason"] = "http_other"
                    self.circuit_breaker.record_failure(source_id)
                    return (None, diagnostics)
            
            except requests.exceptions.Timeout:
                if attempt < max_retries - 1:
                    wait_ms = backoff_base_ms * (2 ** attempt) + random.randint(0, 500)
                    time.sleep(wait_ms / 1000.0)
                    continue
                else:
                    diagnostics["reason"] = "timeout"
                    self.circuit_breaker.record_failure(source_id)
                    return (None, diagnostics)
            
            except Exception as e:
                if attempt < max_retries - 1:
                    wait_ms = backoff_base_ms * (2 ** attempt) + random.randint(0, 500)
                    time.sleep(wait_ms / 1000.0)
                    continue
                else:
                    diagnostics["reason"] = "http_other"
                    diagnostics["bozoException"] = str(e)
                    self.circuit_breaker.record_failure(source_id)
                    return (None, diagnostics)
        
        # Max retries reached
        diagnostics["reason"] = "http_other"
        self.circuit_breaker.record_failure(source_id)
        return (None, diagnostics)
    
    def _robust_fetch(self, url: str, timeout_ms: int) -> Tuple[int, str, str, bytes]:
        """
        Základní HTTP fetch. Timeout hard-cap 5s.
        Returns: (status_code, final_url, content_type, raw_bytes)
        """
        headers = {
            "User-Agent": self.user_agent,
            "From": "admin@infouzel.cz",
            "Accept": "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1",
            "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.3",
            "Cache-Control": "no-cache",
        }
        timeout_sec = min(5.0, timeout_ms / 1000.0)
        response = requests.get(
            url,
            headers=headers,
            timeout=timeout_sec,
            allow_redirects=True,
            stream=False
        )
        
        return (
            response.status_code,
            response.url,
            response.headers.get("Content-Type", "").lower(),
            response.content
        )
    
    def _parse_feed(self, raw_bytes: bytes, content_type: str) -> Tuple[Optional[Any], Dict[str, Any]]:
        """
        Parsování feedu s encoding fallback.
        Returns: (feed_dict, diagnostics)
        """
        diagnostics = {
            "bozo": False,
            "bozoException": "",
            "reason": "",
        }
        
        # Decode
        text = self._decode_with_fallback(raw_bytes)
        if not text:
            diagnostics["reason"] = "empty_content"
            return (None, diagnostics)
        
        # Detekce HTML místo XML
        if self._is_html_content(text, content_type):
            diagnostics["reason"] = "not_xml_or_html"
            return (None, diagnostics)
        
        # Parse
        feed_dict = feedparser.parse(text)
        
        bozo = bool(getattr(feed_dict, "bozo", False))
        diagnostics["bozo"] = bozo
        
        if bozo:
            try:
                bozo_exc = getattr(feed_dict, "bozo_exception", None)
                if bozo_exc:
                    diagnostics["bozoException"] = str(bozo_exc)
            except Exception:
                pass
        
        return (feed_dict, diagnostics)
    
    def _decode_with_fallback(self, raw_bytes: bytes) -> str:
        """Encoding fallback: utf-8 → cp1250 → latin-1"""
        if not raw_bytes:
            return ""
        
        for encoding in ["utf-8", "cp1250", "latin-1"]:
            try:
                return raw_bytes.decode(encoding)
            except (UnicodeDecodeError, LookupError):
                continue
        
        return raw_bytes.decode("latin-1", errors="replace")
    
    def _looks_like_xml_or_feed(self, text: str) -> bool:
        """RSS/Atom/XML body even when Content-Type is mislabeled as HTML."""
        if not text:
            return False
        s = text.lstrip("\ufeff\u200b\u200c\u200d").strip()
        if not s:
            return False
        low = s[:240].lower()
        if low.startswith("<?xml"):
            return True
        if low.startswith("<rss"):
            return True
        if low.startswith("<feed"):
            return True
        if low.startswith("<rdf:") or low.startswith("<rdf:rdf"):
            return True
        return False

    def _is_html_content(self, text: str, content_type: str) -> bool:
        """Detekce HTML místo XML."""
        if not text:
            return False

        if self._looks_like_xml_or_feed(text):
            return False

        text_lower = text.strip().lower()
        
        if "text/html" in content_type:
            return True
        
        if text_lower.startswith("<!doctype html") or text_lower.startswith("<html"):
            return True
        
        if text_lower.startswith("<!") and "html" in text_lower[:100]:
            return True
        
        return False
