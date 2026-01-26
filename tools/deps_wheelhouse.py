#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Download wheels do .wheelhouse pro offline instalaci
"""

import os
import sys
import subprocess
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent
WHEELHOUSE_DIR = ROOT_DIR / ".wheelhouse"
REQUIREMENTS_FILE = ROOT_DIR / "scripts" / "requirements.txt"

def main():
    print("=== Downloading wheels to .wheelhouse ===")
    
    # Vytvoření .wheelhouse adresáře
    WHEELHOUSE_DIR.mkdir(exist_ok=True)
    print(f"Wheelhouse: {WHEELHOUSE_DIR}")
    
    if not REQUIREMENTS_FILE.exists():
        print(f"ERROR: {REQUIREMENTS_FILE} not found", file=sys.stderr)
        return 1
    
    print(f"Requirements: {REQUIREMENTS_FILE}")
    
    # Download wheels
    cmd = [
        sys.executable, "-m", "pip", "download",
        "-r", str(REQUIREMENTS_FILE),
        "-d", str(WHEELHOUSE_DIR),
        "--retries", "20",
        "--timeout", "60"
    ]
    
    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=ROOT_DIR)
    
    if result.returncode == 0:
        wheel_count = len(list(WHEELHOUSE_DIR.glob("*.whl")))
        print(f"SUCCESS: Downloaded {wheel_count} wheels to .wheelhouse")
        return 0
    else:
        print("ERROR: Download failed", file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
