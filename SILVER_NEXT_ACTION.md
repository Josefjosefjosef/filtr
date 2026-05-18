<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor

1. Zkontroluj stav repozitáře a shrň změny v `SILVER_CURSOR_OUTPUT.md`:
   ```powershell
   git status
   ```
   
2. Proveď audit změn v souborech `SILVER_NEXT_ACTION.md` a `SILVER_PROGRESS_LOG.md`:
   ```powershell
   git diff SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md
   ```

3. Pokud se rozhodneš, že změny jsou v pořádku, commitni je:
   ```powershell
   git add SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md
   git commit -m "chore(silver): commit changes in NEXT_ACTION and PROGRESS_LOG"
   ```

4. Zkontroluj poslední commit:
   ```powershell
   git show --name-only -1 --format="%H%n%s"
   ```

### Scope guard
Zajisti, že všechny změny odpovídají předem definovaným podmínkám a že nedochází k regresím.

### STOP podmínky
- Raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode` je zakázáno.
- Kontrolovaný autonomní režim vyžaduje tyto přepínače plus vestavěné limity.

### Povinný výsledek
```
===
1. Zkontroluj stav repozitáře a shrň změny v `SILVER_CURSOR_OUTPUT.md`.
2. Proveď audit změn v souborech `SILVER_NEXT_ACTION.md` a `SILVER_PROGRESS_LOG.md`.
3. Pokud se rozhodneš, že změny jsou v pořádku, commitni je.
4. Zkontroluj poslední commit.
===
```
