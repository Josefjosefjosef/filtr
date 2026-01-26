# RUČNÍ SPUŠTĚNÍ - JEDNODUCHÝ POSTUP

**Datum:** 2026-01-26  
**Cíl:** Spustit pipeline jedním dvojklikem

---

## NEJRYCHLEJŠÍ ZPŮSOB (DOPORUČENO)

### 1) Dvojklik na `run_infoUzel_pipeline.cmd`

Jednoduše dvojklikněte na soubor `run_infoUzel_pipeline.cmd` v kořeni projektu.

**Co se stane:**
- Ověří Python a pip
- Nainstaluje závislosti (offline z `.wheelhouse` nebo online)
- Spustí pipeline
- Zkontroluje výstupní soubory

**Očekávaný výstup:**
```
=== infoUzel.cz Pipeline ===

Python 3.14.2

pip 24.x.x

Upgrading pip if needed...

Installing dependencies...
=== Installing dependencies ===
Using wheelhouse: C:\infoUzel.cz\.wheelhouse
SUCCESS: Installed from wheelhouse
Verifying feedparser...
OK feedparser 6.0.11
SUCCESS: feedparser verified

Running pipeline...
[INFO] Loaded 24 sources from config/sources.json
...
SUCCESS
```

---

## OFFLINE INSTALACE (JEDNORÁZOVĚ)

Pokud chcete připravit offline instalaci (wheelhouse):

### 1) Spustit download wheels (při stabilním internetu)

```cmd
py tools\deps_wheelhouse.py
```

**Co se stane:**
- Stáhne všechny wheels do `.wheelhouse/`
- Při dalším spuštění pipeline se použijí wheels místo online instalace

### 2) Pak už offline instalace a run jde vždy

Při dalším spuštění `run_infoUzel_pipeline.cmd` se automaticky použije `.wheelhouse` pro instalaci závislostí.

---

## DIAGNOSTIKA

Pokud máte problémy, spusťte diagnostiku:

```cmd
py tools\doctor.py
```

**Výstup zobrazí:**
- Python verzi a umístění
- Nainstalované balíčky (feedparser)
- Test importů
- Existenci výstupních souborů

---

## KDE VZNIKAJÍ DATA

Po úspěšném běhu pipeline vzniknou soubory v:

- **Produkční data:** `filtr/data/prod/`
  - `articles.json` - články
  - `videos.json` - videa
  - `meta.json` - metadata
  - `brief.json` - denní přehled
  - `feed_health.json` - zdraví feedů

- **Canary data:** `filtr/data/next/` (před promováním)

- **Health reporty:** `filtr/data/health/`
  - `health.json` - JSON report
  - `health.md` - Markdown report

- **Releases:** `filtr/data/releases/YYYYMMDD-HHMM/` (snapshots)

---

## ALTERNATIVNÍ POSTUP (MANUÁLNÍ)

Pokud `run_infoUzel_pipeline.cmd` nefunguje, můžete spustit ručně:

### Krok 1: Instalace závislostí

```cmd
py tools\deps_install_offline.py
```

### Krok 2: Spuštění pipeline

```cmd
py scripts\run_articles_pipeline.py
```

---

## POZNÁMKY

**Pokud `py` nefunguje:**
- Zkontrolujte, že máte Python 3.14+ nainstalovaný
- Python launcher (`py`) je součástí standardní instalace Pythonu
- Alternativně použijte `python` nebo `python3`

**Pokud instalace selže:**
- Zkontrolujte internetové připojení (pro online instalaci)
- Nebo spusťte `py tools\deps_wheelhouse.py` pro přípravu offline instalace

**Pokud pipeline selže:**
- Spusťte `py tools\doctor.py` pro diagnostiku
- Zkontrolujte, že `config/sources.json` existuje
- Zkontrolujte logy v konzoli

---

**KONEC INSTRUKCÍ**
