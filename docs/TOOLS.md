# NÁSTROJE PRO DIAGNOSTIKU A KONTROLU ZMĚN

**Datum:** 2026-01-25  
**Účel:** Nástroje pro kontrolu změn bez závislosti na git

---

## 1) LIST RECENT FILES

**Soubor:** `tools/list_recent_files.py`

**Účel:** Vypíše soubory změněné za posledních X hodin (Python alternativa pro PowerShell).

**Použití:**
```bash
# Výchozí: posledních 24 hodin
python tools/list_recent_files.py

# Vlastní počet hodin
python tools/list_recent_files.py . 48

# Vlastní repo root
python tools/list_recent_files.py c:\infoUzel.cz 12
```

**Výstup:**
```
=== Files modified in last 24 hours ===
Repo root: c:\infoUzel.cz

Found 12 files:

config/sources.json | Size: 10929 bytes | Modified: 2026-01-25 18:55:19
scripts/data_layer.py | Size: 8535 bytes | Modified: 2026-01-25 18:55:59
...
```

---

## 2) HASH MANIFEST

**Soubor:** `tools/hash_manifest.py`

**Účel:** Vytvoří manifest všech souborů (path + SHA256 hash) pro "gitless" režim kontroly změn.

### 2.1 Vytvoření manifestu

```bash
# Výchozí: vytvoří docs/MANIFEST.json
python tools/hash_manifest.py create

# Vlastní repo root a output
python tools/hash_manifest.py create c:\infoUzel.cz docs/MANIFEST.json
```

**Výstup:** `docs/MANIFEST.json`
```json
{
  "created_at": "2026-01-25T19:00:00Z",
  "repo_root": "c:\\infoUzel.cz",
  "file_count": 150,
  "files": {
    "config/sources.json": {
      "hash": "abc123...",
      "size": 10929,
      "modified": "2026-01-25T18:55:19"
    },
    ...
  }
}
```

### 2.2 Porovnání manifestů

```bash
python tools/hash_manifest.py compare docs/MANIFEST.old.json docs/MANIFEST.new.json
```

**Výstup:**
```
=== Manifest Comparison ===
Added: 5
  + config/sources.json
  + scripts/data_layer.py
  ...

Modified: 2
  ~ scripts/build_articles.py
  ...

Deleted: 0

Unchanged: 143
```

### 2.3 Workflow použití

**Před změnami:**
```bash
python tools/hash_manifest.py create . docs/MANIFEST.before.json
```

**Po změnách:**
```bash
python tools/hash_manifest.py create . docs/MANIFEST.after.json
python tools/hash_manifest.py compare docs/MANIFEST.before.json docs/MANIFEST.after.json
```

---

## 3) PROBLÉM S POWERSHELL

### 3.1 Příčina ArgumentException

**Chyba:** `Get-ChildItem Env:` způsobuje `ArgumentException`

**Příčina:**
- PowerShell environment variables mohou mít duplicitní klíče (neobvyklé, ale možné)
- Příkaz `Get-ChildItem Env:` se pokouší vytvořit kolekci, která neumožňuje duplicity
- Alternativně: problém s PowerShell verzí nebo konfigurací

**Řešení:**
- Použít Python nástroje (`list_recent_files.py`, `hash_manifest.py`)
- Nebo PowerShell alternativu bez `Get-ChildItem Env:`

### 3.2 PowerShell alternativa (pokud je potřeba)

```powershell
# Místo Get-ChildItem Env: použít:
$env:VARIABLE_NAME

# Nebo procházet soubory bez Env:
Get-ChildItem -Path . -Recurse -File | Where-Object { $_.LastWriteTime -gt (Get-Date).AddHours(-24) }
```

---

## 4) GITLESS REŽIM

### 4.1 Kdy použít

- Git není v PATH
- Potřeba kontroly změn bez gitu
- Ověření, že soubory nebyly změněny

### 4.2 Workflow

1. **Před změnami:** Vytvořit manifest
   ```bash
   python tools/hash_manifest.py create . docs/MANIFEST.before.json
   ```

2. **Proveď změny**

3. **Po změnách:** Vytvořit nový manifest a porovnat
   ```bash
   python tools/hash_manifest.py create . docs/MANIFEST.after.json
   python tools/hash_manifest.py compare docs/MANIFEST.before.json docs/MANIFEST.after.json
   ```

### 4.3 Ověření UI neměnnosti

```bash
# Před změnami
python tools/hash_manifest.py create . docs/MANIFEST.ui-before.json

# Po změnách
python tools/hash_manifest.py create . docs/MANIFEST.ui-after.json

# Porovnání (měly by být změny jen v non-UI souborech)
python tools/hash_manifest.py compare docs/MANIFEST.ui-before.json docs/MANIFEST.ui-after.json
```

**Očekávaný výsledek:** Žádné změny v:
- `filtr/index.html`
- `filtr/assets/app.js` (nebo jen minimální změny)
- CSS souborech

---

## 5) PŘÍKLADY POUŽITÍ

### Seznam souborů změněných dnes
```bash
python tools/list_recent_files.py . 24
```

### Vytvoření manifestu před refaktory
```bash
python tools/hash_manifest.py create . docs/MANIFEST.pre-refactor.json
```

### Kontrola změn po refaktory
```bash
python tools/hash_manifest.py create . docs/MANIFEST.post-refactor.json
python tools/hash_manifest.py compare docs/MANIFEST.pre-refactor.json docs/MANIFEST.post-refactor.json
```

---

**KONEC DOKUMENTACE**
