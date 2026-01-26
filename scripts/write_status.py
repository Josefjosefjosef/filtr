#!/usr/bin/env python3
import json, os, sys
from datetime import datetime, timezone

def count_items(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            obj = json.load(f)
        if isinstance(obj, dict) and isinstance(obj.get("items"), list):
            return len(obj["items"])
        if isinstance(obj, list):
            return len(obj)
    except Exception:
        return None
    return None

def main():
    # ✅ FIX: Použij argument, env OUTPUT_DIR nebo default filtr/data
    data_dir = sys.argv[1] if len(sys.argv) > 1 else os.getenv("OUTPUT_DIR", "filtr/data")
    articles_path = os.path.join(data_dir, "articles.json")
    videos_path = os.path.join(data_dir, "videos.json")
    
    a = count_items(articles_path) if os.path.exists(articles_path) else None
    v = count_items(videos_path) if os.path.exists(videos_path) else None

    status = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "articles_count": a,
        "videos_count": v
    }
    status_path = os.path.join(data_dir, "status.json")
    os.makedirs(os.path.dirname(status_path), exist_ok=True)
    with open(status_path, "w", encoding="utf-8") as f:
        json.dump(status, f, ensure_ascii=False, indent=2)
    print("STATUS_OK")

if __name__ == "__main__":
    main()
