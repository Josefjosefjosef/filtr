import pathlib

root = pathlib.Path("C:/projects/filtr")

patterns = [
    "projects/data/articles.json",
    "articles.json",
    "\"sources\":",
    "sources[0]",
    "write_text(",
    "json.dump",
    "json.dumps",
]

for pattern in patterns:
    print(f"--- Searching for {pattern}")
    matches = []
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        try:
            text = p.read_text(encoding="utf-8")
        except Exception:
            continue
        if pattern in text:
            print(p.relative_to(root))
            break
    else:
        print("not found")
