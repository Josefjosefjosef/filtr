import pathlib

path = pathlib.Path("c:/projects/filtr/scripts/build_articles.py")
text = path.read_text(encoding="utf-8")
for idx, line in enumerate(text.splitlines(), 1):
    if "articles.append" in line or "article =" in line:
        print(idx, line.strip())
