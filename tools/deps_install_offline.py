#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Offline instalace závislostí z .wheelhouse, fallback na online
"""

import os
import sys
import subprocess
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent
WHEELHOUSE_DIR = ROOT_DIR / ".wheelhouse"
REQUIREMENTS_FILE = ROOT_DIR / "scripts" / "requirements.txt"

def main():
    print("=== Installing dependencies ===")
    
    if not REQUIREMENTS_FILE.exists():
        print(f"ERROR: {REQUIREMENTS_FILE} not found", file=sys.stderr)
        return 1
    
    # Zkusit offline instalaci z .wheelhouse
    if WHEELHOUSE_DIR.exists() and any(WHEELHOUSE_DIR.glob("*.whl")):
        print(f"Using wheelhouse: {WHEELHOUSE_DIR}")
        cmd = [
            sys.executable, "-m", "pip", "install",
            "--no-index",
            "--find-links", str(WHEELHOUSE_DIR),
            "-r", str(REQUIREMENTS_FILE)
        ]
        print(f"Running: {' '.join(cmd)}")
        result = subprocess.run(cmd, cwd=ROOT_DIR)
        
        if result.returncode == 0:
            print("SUCCESS: Installed from wheelhouse")
        else:
            print("WARNING: Wheelhouse install failed, trying online...", file=sys.stderr)
            # Fallback na online
            cmd = [
                sys.executable, "-m", "pip", "install",
                "--retries", "20",
                "--timeout", "60",
                "-r", str(REQUIREMENTS_FILE)
            ]
            print(f"Running: {' '.join(cmd)}")
            result = subprocess.run(cmd, cwd=ROOT_DIR)
            if result.returncode != 0:
                print("ERROR: Online install failed", file=sys.stderr)
                return 1
            print("SUCCESS: Installed from online")
    else:
        print("Wheelhouse not found or empty, using online install...")
        cmd = [
            sys.executable, "-m", "pip", "install",
            "--retries", "20",
            "--timeout", "60",
            "-r", str(REQUIREMENTS_FILE)
        ]
        print(f"Running: {' '.join(cmd)}")
        result = subprocess.run(cmd, cwd=ROOT_DIR)
        if result.returncode != 0:
            print("ERROR: Online install failed", file=sys.stderr)
            return 1
        print("SUCCESS: Installed from online")
    
    # Ověření feedparser
    print("Verifying feedparser...")
    result = subprocess.run(
        [sys.executable, "-c", "import feedparser; print('OK feedparser', feedparser.__version__)"],
        cwd=ROOT_DIR
    )
    if result.returncode == 0:
        print("SUCCESS: feedparser verified")
        return 0
    else:
        print("ERROR: feedparser import failed", file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
