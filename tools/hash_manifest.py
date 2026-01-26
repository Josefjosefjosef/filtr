#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Hash Manifest - Vytvoření manifestu všech souborů (path + sha256)
Pro "gitless" režim kontroly změn
"""

import os
import sys
import json
import hashlib
from pathlib import Path
from datetime import datetime, timezone


def calculate_file_hash(file_path: Path) -> str:
    """Vypočítá SHA256 hash souboru."""
    sha256 = hashlib.sha256()
    try:
        with open(file_path, 'rb') as f:
            for chunk in iter(lambda: f.read(4096), b''):
                sha256.update(chunk)
        return sha256.hexdigest()
    except (OSError, PermissionError):
        return ""


def create_manifest(repo_root: str, output_path: str = None, exclude_dirs: set = None):
    """
    Vytvoří manifest všech souborů v repo.
    
    Args:
        repo_root: Kořenová složka repo
        output_path: Kam uložit manifest (default: docs/MANIFEST.json)
        exclude_dirs: Složky k vyloučení
    """
    if exclude_dirs is None:
        exclude_dirs = {'.git', 'node_modules', '__pycache__', '.pytest_cache', '.venv', 'venv', '.github'}
    
    repo_path = Path(repo_root)
    
    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "repo_root": str(repo_path),
        "files": {}
    }
    
    file_count = 0
    
    for root, dirs, files in os.walk(repo_path):
        # Vyloučit některé složky
        dirs[:] = [d for d in dirs if d not in exclude_dirs and not d.startswith('.')]
        
        for file in files:
            file_path = Path(root) / file
            
            try:
                relative_path = str(file_path.relative_to(repo_path))
                
                # Přeskočit manifest samotný
                if 'MANIFEST.json' in relative_path:
                    continue
                
                stat = file_path.stat()
                file_hash = calculate_file_hash(file_path)
                
                if file_hash:  # Pouze pokud se podařilo přečíst
                    manifest["files"][relative_path] = {
                        "hash": file_hash,
                        "size": stat.st_size,
                        "modified": datetime.fromtimestamp(stat.st_mtime).isoformat()
                    }
                    file_count += 1
            except (OSError, PermissionError):
                continue
    
    manifest["file_count"] = file_count
    
    # Uložit manifest
    if output_path is None:
        output_path = repo_path / "docs" / "MANIFEST.json"
    else:
        output_path = Path(output_path)
    
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    
    print(f"Manifest created: {output_path}")
    print(f"Files indexed: {file_count}")
    
    return manifest


def compare_manifests(old_path: str, new_path: str):
    """
    Porovná dva manifesty a vypíše rozdíly.
    
    Returns:
        dict s klíči: added, modified, deleted, unchanged
    """
    with open(old_path, 'r', encoding='utf-8') as f:
        old_manifest = json.load(f)
    
    with open(new_path, 'r', encoding='utf-8') as f:
        new_manifest = json.load(f)
    
    old_files = old_manifest.get("files", {})
    new_files = new_manifest.get("files", {})
    
    added = []
    modified = []
    deleted = []
    unchanged = []
    
    # Nové soubory
    for path in new_files:
        if path not in old_files:
            added.append(path)
        elif new_files[path]["hash"] != old_files[path]["hash"]:
            modified.append(path)
        else:
            unchanged.append(path)
    
    # Smazané soubory
    for path in old_files:
        if path not in new_files:
            deleted.append(path)
    
    return {
        "added": added,
        "modified": modified,
        "deleted": deleted,
        "unchanged": len(unchanged)
    }


def main():
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python tools/hash_manifest.py create [repo_root] [output_path]")
        print("  python tools/hash_manifest.py compare <old_manifest> <new_manifest>")
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == "create":
        repo_root = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        output_path = sys.argv[3] if len(sys.argv) > 3 else None
        create_manifest(repo_root, output_path)
    
    elif command == "compare":
        if len(sys.argv) < 4:
            print("Usage: python tools/hash_manifest.py compare <old_manifest> <new_manifest>")
            sys.exit(1)
        
        old_path = sys.argv[2]
        new_path = sys.argv[3]
        
        diff = compare_manifests(old_path, new_path)
        
        print("=== Manifest Comparison ===")
        print(f"Added: {len(diff['added'])}")
        for f in diff['added']:
            print(f"  + {f}")
        
        print(f"\nModified: {len(diff['modified'])}")
        for f in diff['modified']:
            print(f"  ~ {f}")
        
        print(f"\nDeleted: {len(diff['deleted'])}")
        for f in diff['deleted']:
            print(f"  - {f}")
        
        print(f"\nUnchanged: {diff['unchanged']}")
    
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()
