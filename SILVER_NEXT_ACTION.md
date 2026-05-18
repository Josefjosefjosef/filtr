<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor

1. Zkontroluj stav repozitáře a shrň změny v `SILVER_CURSOR_OUTPUT.md`:
   ```powershell
   git status
   ```

2. Proveď audit změn v souborech:
   ```powershell
   git diff SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   ```

3. Získej krátký stav repozitáře:
   ```powershell
   git status --short
   ```

4. Pokud jsou změny ve whitelistovaných souborech, přidej je do stagingu:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   ```

5. Proveď commit s popisem:
   ```powershell
   git commit -m "chore(silver): sync Silver tracking artifacts after cycle 10 audit"
   ```

6. Zkontroluj, zda je pracovní strom čistý:
   ```powershell
   git status --short
   ```

### Scope guard
Zajišťuji, že všechny kroky jsou v souladu se strategií Silver a neprovádím žádné změny mimo schválené soubory.

### STOP podmínky
- Nepoužívej `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode`.
- Kontroluj, že žádné necommitnuté změny nejsou přítomny před provedením dalších akcí.

### Povinný výsledek
```
===
Zkontrolován stav repozitáře a shrnuty změny v `SILVER_CURSOR_OUTPUT.md`, proveden audit souborů a krátký stav repozitáře. Rozhodnutí: commit (ne restore).
===
```
