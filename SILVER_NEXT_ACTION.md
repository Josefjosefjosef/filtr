<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

### Úkol pro Cursor

1. Zkontroluj stav repozitáře a shrň změny v `SILVER_CURSOR_OUTPUT.md`:
   ```powershell
   git status
   ```

2. Přidej změny do commitu:
   ```powershell
   git add SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   ```

3. Vytvoř commit se zprávou:
   ```powershell
   git commit -m "Zahrnutí změn v SILVER_NEXT_ACTION.md, SILVER_PROGRESS_LOG.md a SILVER_RUN_REPORT.md"
   ```

4. Proveď push na `origin/main`:
   ```powershell
   git push origin main
   ```

=== 
### Scope guard
Zajisti, že jsi přihlášený do GitHubu a máš správné přihlašovací údaje pro HTTPS nebo SSH.

### STOP podmínky
- Raw `-MaxCycles 0` bez `-AllowInfinite`/`-AutonomousMode` je zakázáno.
- Kontrolovaný autonomní režim vyžaduje tyto přepínače plus vestavěné limity.

### Povinný výsledek
Zkontroluj, zda byly změny úspěšně přidány a commitovány, a zda byl push proveden bez chyb. 
===
