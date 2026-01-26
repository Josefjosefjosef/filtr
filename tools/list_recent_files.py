#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
List Recent Files - Python alternativa pro PowerShell listing
Projde repo a vypíše soubory přidané/změněné za X hodin
"""

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path


def list_recent_files(repo_root: str, hours: int = 24, exclude_dirs: set = None):
    """
    Vypíše soubory změněné za posledních X hodin.
    
    Args:
        repo_root: Kořenová složka repo
        hours: Počet hodin zpět
        exclude_dirs: Složky k vyloučení (např. {'node_modules', '.git'})
    """
    if exclude_dirs is None:
        exclude_dirs = {'.git', 'node_modules', '__pycache__', '.pytest_cache', '.venv', 'venv'}
    
    repo_path = Path(repo_root)
    cutoff_time = datetime.now() - timedelta(hours=hours)
    
    recent_files = []
    
    for root, dirs, files in os.walk(repo_path):
        # Vyloučit některé složky
        dirs[:] = [d for d in dirs if d not in exclude_dirs and not d.startswith('.')]
        
        for file in files:
            file_path = Path(root) / file
            
            try:
                # Získat last write time
                mtime = datetime.fromtimestamp(file_path.stat().st_mtime)
                
                if mtime >= cutoff_time:
                    size = file_path.stat().st_size
                    relative_path = file_path.relative_to(repo_path)
                    recent_files.append({
                        'path': str(relative_path),
                        'size': size,
                        'modified': mtime,
                        'full_path': str(file_path)
                    })
            except (OSError, PermissionError):
                # Přeskočit soubory, ke kterým nemáme přístup
                continue
    
    # Seřadit podle času modifikace (nejnovější první)
    recent_files.sort(key=lambda x: x['modified'], reverse=True)
    
    return recent_files


def main():
    if len(sys.argv) > 1:
        repo_root = sys.argv[1]
    else:
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    hours = int(sys.argv[2]) if len(sys.argv) > 2 else 24
    
    print(f"=== Files modified in last {hours} hours ===")
    print(f"Repo root: {repo_root}\n")
    
    files = list_recent_files(repo_root, hours)
    
    if not files:
        print("No files found.")
        return
    
    print(f"Found {len(files)} files:\n")
    
    for f in files:
        print(f"{f['path']} | Size: {f['size']} bytes | Modified: {f['modified']}")
    
    # Shrnutí podle typu
    print("\n=== Summary by extension ===")
    by_ext = {}
    for f in files:
        ext = Path(f['path']).suffix or '(no extension)'
        by_ext[ext] = by_ext.get(ext, 0) + 1
    
    for ext, count in sorted(by_ext.items(), key=lambda x: x[1], reverse=True):
        print(f"{ext}: {count} files")


if __name__ == "__main__":
    main()
