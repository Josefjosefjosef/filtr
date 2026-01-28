from pathlib import Path
path = Path('.gitignore')
text = path.read_text()
marker = '# Generated data files (do not commit)\r\nfiltr/data/**\r\n'
if marker not in text:
    raise SystemExit('marker not found')
replacement = marker + '!filtr/data/articles.json\r\n!filtr/data/videos.json\r\n'
path.write_text(text.replace(marker, replacement, 1))
