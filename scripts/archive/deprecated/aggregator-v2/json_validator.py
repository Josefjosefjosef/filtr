#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
JSON Schema Validator pro articles.json, videos.json, meta.json, health.json
"""

import json
import sys
from typing import Dict, Any, List, Optional
from datetime import datetime


class JSONValidator:
    """Validátor JSON struktury podle schémat."""
    
    @staticmethod
    def validate_articles(data: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """
        Validace articles.json.
        Returns: (is_valid, error_message)
        """
        # Povinné klíče
        if not isinstance(data, dict):
            return (False, "Root must be object")
        
        if "generatedAt" not in data:
            return (False, "Missing 'generatedAt'")
        
        if "articles" not in data:
            return (False, "Missing 'articles'")
        
        if not isinstance(data["articles"], list):
            return (False, "'articles' must be array")
        
        # Validace generatedAt (ISO format)
        try:
            datetime.fromisoformat(data["generatedAt"].replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return (False, f"Invalid 'generatedAt' format: {data.get('generatedAt')}")
        
        # Validace každého článku
        for i, article in enumerate(data["articles"]):
            if not isinstance(article, dict):
                return (False, f"Article[{i}] must be object")
            
            # Povinná pole
            required = ["topic", "section", "contentType", "title", "publishedAt", "sources"]
            for field in required:
                if field not in article:
                    return (False, f"Article[{i}] missing '{field}'")
            
            # Typy
            if not isinstance(article["sources"], list):
                return (False, f"Article[{i}].sources must be array")
            
            if len(article["sources"]) == 0:
                return (False, f"Article[{i}].sources must not be empty")
            
            # Validace source
            for j, source in enumerate(article["sources"]):
                if not isinstance(source, dict):
                    return (False, f"Article[{i}].sources[{j}] must be object")
                
                if "name" not in source or "url" not in source:
                    return (False, f"Article[{i}].sources[{j}] missing 'name' or 'url'")
            
            # Validace publishedAt
            try:
                datetime.fromisoformat(article["publishedAt"].replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                return (False, f"Article[{i}].publishedAt invalid format")
        
        return (True, None)
    
    @staticmethod
    def validate_videos(data: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """
        Validace videos.json.
        Returns: (is_valid, error_message)
        """
        if not isinstance(data, dict):
            return (False, "Root must be object")
        
        if "generatedAt" not in data:
            return (False, "Missing 'generatedAt'")
        
        if "videos" not in data:
            return (False, "Missing 'videos'")
        
        if not isinstance(data["videos"], list):
            return (False, "'videos' must be array")
        
        # Validace generatedAt
        try:
            datetime.fromisoformat(data["generatedAt"].replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return (False, f"Invalid 'generatedAt' format: {data.get('generatedAt')}")
        
        # Validace každého videa
        for i, video in enumerate(data["videos"]):
            if not isinstance(video, dict):
                return (False, f"Video[{i}] must be object")
            
            required = ["title", "url", "videoId", "publishedAt", "section", "channel"]
            for field in required:
                if field not in video:
                    return (False, f"Video[{i}] missing '{field}'")
            
            # Validace videoId (YouTube: 11 znaků)
            vid = video.get("videoId", "")
            if not vid or len(vid) != 11:
                return (False, f"Video[{i}].videoId must be 11 characters")
            
            # Validace publishedAt
            try:
                datetime.fromisoformat(video["publishedAt"].replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                return (False, f"Video[{i}].publishedAt invalid format")
        
        return (True, None)
    
    @staticmethod
    def validate_meta(data: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """Validace meta.json."""
        if not isinstance(data, dict):
            return (False, "Root must be object")
        
        if "generatedAt" not in data:
            return (False, "Missing 'generatedAt'")
        
        if "totals" not in data:
            return (False, "Missing 'totals'")
        
        if not isinstance(data["totals"], dict):
            return (False, "'totals' must be object")
        
        return (True, None)
    
    @staticmethod
    def validate_health(data: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """Validace health.json."""
        if not isinstance(data, dict):
            return (False, "Root must be object")
        
        if "updatedAt" not in data:
            return (False, "Missing 'updatedAt'")
        
        if "feeds" not in data:
            return (False, "Missing 'feeds'")
        
        return (True, None)
    
    @staticmethod
    def validate_file(filename: str, data: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """
        Validace podle názvu souboru.
        Returns: (is_valid, error_message)
        """
        if filename == "articles.json":
            return JSONValidator.validate_articles(data)
        elif filename == "videos.json":
            return JSONValidator.validate_videos(data)
        elif filename == "meta.json":
            return JSONValidator.validate_meta(data)
        elif filename == "feed_health.json" or filename == "health.json":
            return JSONValidator.validate_health(data)
        else:
            return (True, None)  # Neznámý soubor → OK (nevalidujeme)
    
    @staticmethod
    def sanitize_text(text: str) -> str:
        """
        Sanitizace textu:
        - Trim whitespace
        - Odstranění neviditelných znaků (BOM, zero-width)
        """
        if not isinstance(text, str):
            return ""
        
        # Odstranění BOM
        if text.startswith("\ufeff"):
            text = text[1:]
        
        # Odstranění zero-width znaků
        text = text.replace("\u200b", "").replace("\u200c", "").replace("\u200d", "")
        
        # Trim
        text = text.strip()
        
        return text
    
    @staticmethod
    def sanitize_article(article: Dict[str, Any]) -> Dict[str, Any]:
        """Sanitizace článku."""
        if "title" in article:
            article["title"] = JSONValidator.sanitize_text(article["title"])
        
        if "sources" in article:
            for source in article.get("sources", []):
                if "name" in source:
                    source["name"] = JSONValidator.sanitize_text(source["name"])
                if "url" in source:
                    source["url"] = JSONValidator.sanitize_text(source["url"])
        
        return article
    
    @staticmethod
    def sanitize_video(video: Dict[str, Any]) -> Dict[str, Any]:
        """Sanitizace videa."""
        if "title" in video:
            video["title"] = JSONValidator.sanitize_text(video["title"])
        
        if "channel" in video:
            video["channel"] = JSONValidator.sanitize_text(video["channel"])
        
        return video
