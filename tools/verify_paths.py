#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Verify data layer directories and files
Python only, no PowerShell
"""

import os
import sys
from pathlib import Path
from datetime import datetime


def verify_paths(repo_root: str):
    """Ověří existenci adresářů a souborů data layeru"""
    
    base_dir = Path(repo_root) / "filtr" / "data"
    
    # Adresáře k ověření
    dirs_to_check = [
        "next",
        "prod",
        "lkg",
        "releases",
        "emergency",
        "health"
    ]
    
    # Soubory k ověření
    files_to_check = [
        ("next", "articles.json"),
        ("prod", "articles.json"),
        ("lkg", "articles.json"),
        ("health", "health.json"),
        ("health", "health.md"),
        ("releases", "latest.json")
    ]
    
    print("=== DATA LAYER DIRECTORIES ===")
    for dirname in dirs_to_check:
        dirpath = base_dir / dirname
        exists = dirpath.exists() and dirpath.is_dir()
        print(f"{dirname}/: {'EXISTS' if exists else 'MISSING'}")
    
    print("\n=== DATA LAYER FILES ===")
    for subdir, filename in files_to_check:
        filepath = base_dir / subdir / filename
        
        if filepath.exists() and filepath.is_file():
            stat = filepath.stat()
            size = stat.st_size
            mtime = datetime.fromtimestamp(stat.st_mtime)
            print(f"{subdir}/{filename}:")
            print(f"  Size: {size} bytes")
            print(f"  Modified: {mtime.isoformat()}")
        else:
            print(f"{subdir}/{filename}: MISSING")
    
    # Vypiš všechny soubory v releases/ (pokud existuje)
    releases_dir = base_dir / "releases"
    if releases_dir.exists() and releases_dir.is_dir():
        print("\n=== RELEASES ===")
        release_dirs = sorted([d for d in releases_dir.iterdir() if d.is_dir()], reverse=True)
        if release_dirs:
            print(f"Found {len(release_dirs)} release(s):")
            for release_dir in release_dirs[:10]:  # Max 10 nejnovějších
                print(f"  {release_dir.name}/")
        else:
            print("No releases found")
    
    # Vypiš všechny soubory v health/ (pokud existuje)
    health_dir = base_dir / "health"
    if health_dir.exists() and health_dir.is_dir():
        print("\n=== HEALTH FILES ===")
        health_files = sorted([f for f in health_dir.iterdir() if f.is_file()], reverse=True)
        if health_files:
            for health_file in health_files[:10]:  # Max 10 nejnovějších
                stat = health_file.stat()
                size = stat.st_size
                mtime = datetime.fromtimestamp(stat.st_mtime)
                print(f"  {health_file.name}: {size} bytes, {mtime.isoformat()}")
        else:
            print("No health files found")


def main():
    if len(sys.argv) > 1:
        repo_root = sys.argv[1]
    else:
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    verify_paths(repo_root)


if __name__ == "__main__":
    main()
