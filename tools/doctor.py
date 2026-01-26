from pathlib import Path
from datetime import datetime

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "filtr" / "data"
PROD_DIR = DATA_DIR / "prod"
HEALTH_DIR = DATA_DIR / "health"

REQUIRED_FILES = [
    PROD_DIR / "articles.json",
    HEALTH_DIR / "health.json",
]

def _fmt_mtime(p: Path) -> str:
    ts = p.stat().st_mtime
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")

def main() -> int:
    print(f"ROOT_DIR:   {ROOT_DIR}")
    print(f"DATA_DIR:   {DATA_DIR}")
    print()

    ok = True
    for f in REQUIRED_FILES:
        if not f.exists():
            print(f"NEEXISTUJE: {f}")
            ok = False
        else:
            size = f.stat().st_size
            mtime = _fmt_mtime(f)
            print(f"OK:         {f} | {size} bytes | {mtime}")

    return 0 if ok else 1

if __name__ == "__main__":
    raise SystemExit(main())
