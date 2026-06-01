#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Data Layer - Robustní správa dat s next/prod/lkg/releases/emergency
"""

import os
import sys
import json
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, Callable


class DataLayer:
    """
    Správa datových vrstev:
    - next/     : canary výstupy (testování před promováním)
    - prod/     : produkční výstupy (co web načítá)
    - lkg/      : last known good (záloha pro rollback)
    - releases/ : immutable snapshots (YYYYMMDD-HHMM)
    - emergency/: minimální nouzový bundle
    - health/   : health reporty
    """
    
    def __init__(self, base_dir: str):
        self.base_dir = Path(base_dir)
        self.next_dir = self.base_dir / "next"
        self.prod_dir = self.base_dir / "prod"
        self.lkg_dir = self.base_dir / "lkg"
        self.releases_dir = self.base_dir / "releases"
        self.emergency_dir = self.base_dir / "emergency"
        self.health_dir = self.base_dir / "health"
        
        # Vytvoření adresářů
        for d in [self.next_dir, self.prod_dir, self.lkg_dir, self.releases_dir, 
                  self.emergency_dir, self.health_dir]:
            d.mkdir(parents=True, exist_ok=True)
    
    def write_next(self, filename: str, data: Dict[str, Any]) -> str:
        """
        Zápis do next/ (canary).
        Vrací cestu k souboru.
        """
        path = self.next_dir / filename
        return self._atomic_write(path, data)
    
    def promote_next_to_prod(self, filenames: list[str], 
                            validator: Optional[Callable[[str, Dict[str, Any]], bool]] = None) -> bool:
        """
        Promování next/ → prod/ (atomicky).
        Pokud validator selže, prod/ se NESMÍ změnit.
        
        Returns:
            True pokud úspěch, False pokud selhalo
        """
        try:
            # 1) Validace next/ souborů
            if validator:
                for filename in filenames:
                    next_path = self.next_dir / filename
                    if not next_path.exists():
                        return False
                    with open(next_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    if not validator(filename, data):
                        return False
            
            # 2) Backup prod/ → lkg/ (před přepsáním)
            self._backup_prod_to_lkg(filenames)
            
            # 3) Atomické kopírování next/ → prod/
            for filename in filenames:
                next_path = self.next_dir / filename
                prod_path = self.prod_dir / filename
                
                # Atomický write: temp → prod
                with tempfile.NamedTemporaryFile(
                    mode='w', encoding='utf-8', 
                    dir=prod_path.parent, 
                    delete=False,
                    suffix='.json'
                ) as tmp:
                    with open(next_path, 'r', encoding='utf-8') as src:
                        shutil.copyfileobj(src, tmp)
                    tmp_path = tmp.name
                
                # Rename (atomický na většině FS)
                shutil.move(tmp_path, prod_path)
            
            # 4) Vytvoření release snapshotu
            self._create_release_snapshot(filenames)
            
            return True
            
        except Exception as e:
            print(f"ERROR: promote_next_to_prod failed: {e}", file=sys.stderr)
            # Prod/ zůstává nezměněn (lkg/ je backup)
            return False
    
    def rollback_to_lkg(self, filenames: list[str]) -> bool:
        """
        Rollback prod/ ← lkg/ (pokud next/ selhal).
        """
        try:
            for filename in filenames:
                lkg_path = self.lkg_dir / filename
                prod_path = self.prod_dir / filename
                
                if not lkg_path.exists():
                    continue  # LKG neexistuje, přeskočit
                
                # Atomický write
                with tempfile.NamedTemporaryFile(
                    mode='w', encoding='utf-8',
                    dir=prod_path.parent,
                    delete=False,
                    suffix='.json'
                ) as tmp:
                    with open(lkg_path, 'r', encoding='utf-8') as src:
                        shutil.copyfileobj(src, tmp)
                    tmp_path = tmp.name
                
                shutil.move(tmp_path, prod_path)
            
            return True
            
        except Exception as e:
            print(f"ERROR: rollback_to_lkg failed: {e}", file=sys.stderr)
            return False
    
    def create_emergency_bundle(self, articles: list[Dict], videos: list[Dict]) -> bool:
        """
        Vytvoření minimálního nouzového bundle (top 30 článků + top 20 videí).
        """
        try:
            emergency_articles = {
                "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "articles": articles[:30]  # Top 30
            }
            
            emergency_videos = {
                "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "videos": videos[:20]  # Top 20
            }
            
            self._atomic_write(self.emergency_dir / "articles.json", emergency_articles)
            self._atomic_write(self.emergency_dir / "videos.json", emergency_videos)
            
            return True
            
        except Exception as e:
            print(f"ERROR: create_emergency_bundle failed: {e}", file=sys.stderr)
            return False
    
    def _atomic_write(self, path: Path, data: Dict[str, Any]) -> str:
        """
        Atomický zápis JSON (write to temp, then rename).
        """
        dirname = path.parent
        dirname.mkdir(parents=True, exist_ok=True)
        
        with tempfile.NamedTemporaryFile(
            mode='w', encoding='utf-8',
            dir=dirname,
            delete=False,
            suffix='.json'
        ) as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            tmp_path = f.name
        
        # Rename (atomický)
        shutil.move(tmp_path, path)
        return str(path)
    
    def _backup_prod_to_lkg(self, filenames: list[str]):
        """
        Backup prod/ → lkg/ (před promováním).
        """
        for filename in filenames:
            prod_path = self.prod_dir / filename
            lkg_path = self.lkg_dir / filename
            
            if prod_path.exists():
                shutil.copy2(prod_path, lkg_path)
    
    def _create_release_snapshot(self, filenames: list[str]):
        """
        Vytvoření immutable release snapshotu (YYYYMMDD-HHMM).
        """
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
        release_dir = self.releases_dir / timestamp
        release_dir.mkdir(parents=True, exist_ok=True)
        
        for filename in filenames:
            prod_path = self.prod_dir / filename
            if prod_path.exists():
                shutil.copy2(prod_path, release_dir / filename)
        
        # Cleanup starých releases (zachovat posledních 30)
        self._cleanup_old_releases(keep=30)
    
    def _cleanup_old_releases(self, keep: int = 30):
        """
        Odstranění starých releases (zachovat posledních N).
        """
        releases = sorted(self.releases_dir.iterdir(), key=lambda p: p.name, reverse=True)
        for old_release in releases[keep:]:
            shutil.rmtree(old_release, ignore_errors=True)
    
    def get_prod_path(self, filename: str) -> Path:
        """Vrací cestu k produkčnímu souboru."""
        return self.prod_dir / filename
    
    def get_lkg_path(self, filename: str) -> Path:
        """Vrací cestu k LKG souboru."""
        return self.lkg_dir / filename
    
    def get_emergency_path(self, filename: str) -> Path:
        """Vrací cestu k emergency souboru."""
        return self.emergency_dir / filename
    
    def get_latest_release_path(self, filename: str) -> Optional[Path]:
        """Vrací cestu k nejnovějšímu release souboru."""
        releases = sorted(self.releases_dir.iterdir(), key=lambda p: p.name, reverse=True)
        if releases:
            path = releases[0] / filename
            if path.exists():
                return path
        return None
