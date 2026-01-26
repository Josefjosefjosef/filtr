#!/usr/bin/env python3
import os, shutil, sys

def ensure(p): os.makedirs(p, exist_ok=True)

def rotate_backups(base=None):
    # ✅ FIX: Použij env OUTPUT_DIR nebo default filtr/data
    if base is None:
        base = os.getenv("OUTPUT_DIR", "filtr/data")
    """Zálohuje JSON soubory přímo z data/ (ne z data/current/)"""
    b1 = os.path.join(base, "backup", "1")
    b2 = os.path.join(base, "backup", "2")
    b3 = os.path.join(base, "backup", "3")
    ensure(b1); ensure(b2); ensure(b3)

    # Posun: 3 <- 2 <- 1 <- aktuální data
    if os.path.exists(b2): 
        if os.path.exists(b3): 
            shutil.rmtree(b3)
        shutil.copytree(b2, b3)
        shutil.rmtree(b2)
    if os.path.exists(b1):
        shutil.copytree(b1, b2)
        shutil.rmtree(b1)

    # Zálohuj aktuální JSON soubory z data/ do backup/1
    json_files = ["articles.json", "videos.json", "meta.json", "brief.json", "feed_health.json", "status.json"]
    for fname in json_files:
        src = os.path.join(base, fname)
        if os.path.exists(src):
            dst = os.path.join(b1, fname)
            ensure(os.path.dirname(dst))
            shutil.copy2(src, dst)

def main():
    # ✅ FIX: Použij argument, env OUTPUT_DIR nebo default filtr/data
    base = sys.argv[1] if len(sys.argv) > 1 else os.getenv("OUTPUT_DIR", "filtr/data")
    rotate_backups(base)
    print("BACKUP_OK")

if __name__ == "__main__":
    main()
