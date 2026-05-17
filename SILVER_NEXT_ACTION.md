<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

```
CÍL: Zkontrolovat a případně commitnout změny v repozitáři.

SOUBORY (whitelist):
- SILVER_CURSOR_OUTPUT.md
- SILVER_NEXT_ACTION.md
- SILVER_PROGRESS_LOG.md
- SILVER_RUN_REPORT.md

NO-GO:
- Neprovádět žádné změny mimo uvedené soubory.

KROKY (max 7):
1. Zkontroluj stav repozitáře pomocí příkazu:
   ```powershell
   git status
   ```
2. Pokud jsou soubory připravené k commitu, proveď commit:
   ```powershell
   git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
   git commit -m "Změny v SILVER_* souborech"
   ```

GATE (co musí vypsat / změřit):
- `git status` by měl ukázat, že nejsou žádné necommitované změny.

COMMIT MESSAGE: "Změny v SILVER_* souborech"
```
