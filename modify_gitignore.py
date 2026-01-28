from pathlib import Path
path = Path('.gitignore')
text = path.read_text()
marker = '# Generated data files (do not commit)\nfiltr/data/**\n'
if marker not in text:
    raise SystemExit('marker not found')
replacement = marker + '!filtr/data/articles.json\n!filtr/data/videos.json\n'
path.write_text(text.replace(marker, replacement, 1))
