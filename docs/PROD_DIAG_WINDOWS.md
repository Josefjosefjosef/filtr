# Produkční diagnostika (Windows / PowerShell) — správné stahování JSON (UTF-8)

## Proč tohle existuje

V PowerShellu přesměrování `>` zapisuje text typicky jako UTF-16LE s BOM (začíná bajty `FF FE`), takže pak Python při `read_text(encoding="utf-8")` padá na `UnicodeDecodeError`.
Řešení: používat `curl.exe -o` nebo `Out-File -Encoding utf8`.

---

## 1) Stáhni produkční soubory (UTF-8)

### Varianta A (doporučená): curl.exe s -o
```powershell
mkdir -Force .\agent-tools | Out-Null

curl.exe -s -o .\agent-tools\diag_page_debug.html "https://infouzel.cz/projects/?debug=1"
curl.exe -s -o .\agent-tools\articles_prod.json     "https://infouzel.cz/projects/data/articles.json"
curl.exe -s -o .\agent-tools\videos_prod.json       "https://infouzel.cz/projects/data/videos.json"
```

### Varianta B: Invoke-WebRequest
```powershell
mkdir -Force .\agent-tools | Out-Null

Invoke-WebRequest "https://infouzel.cz/projects/data/articles.json" -OutFile .\agent-tools\articles_prod.json
Invoke-WebRequest "https://infouzel.cz/projects/data/videos.json"   -OutFile .\agent-tools\videos_prod.json
```

### Varianta C: když už chceš přesměrování, tak jedině takhle (UTF-8)
```powershell
mkdir -Force .\agent-tools | Out-Null

curl.exe -s "https://infouzel.cz/projects/data/articles.json" | Out-File -Encoding utf8 .\agent-tools\articles_prod.json
curl.exe -s "https://infouzel.cz/projects/data/videos.json"   | Out-File -Encoding utf8 .\agent-tools\videos_prod.json
```

## 2) Ověř obsah přes Python (bez Unicode chyb)
```powershell
py -c "import json, pathlib; p=pathlib.Path(r'.\agent-tools\articles_prod.json'); d=json.loads(p.read_text(encoding='utf-8')); print('articles', len(d.get('articles', [])))"
py -c "import json, pathlib; p=pathlib.Path(r'.\agent-tools\videos_prod.json');   d=json.loads(p.read_text(encoding='utf-8')); print('videos',   len(d.get('videos', [])))"
```

## 3) Pokud už máš soubor uložený špatně (UTF-16), rychlá detekce a čtení

**Detekce BOM:**  
UTF-16LE obvykle začíná bajty FF FE

**Rychlé načtení jako UTF-16:**
```powershell
py -c "import json, pathlib; p=pathlib.Path(r'.\agent-tools\articles_prod.json'); d=json.loads(p.read_bytes().decode('utf-16')); print('articles', len(d.get('articles', [])))"
```

Poznámka: tohle je jen workaround pro špatně uložený soubor. Správně je stáhnout ho rovnou jako UTF-8 podle bodu 1.
