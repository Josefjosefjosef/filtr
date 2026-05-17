<!-- SILVER_NEXT_ACTION: full-auto-loop-openai; copy-paste for Cursor; not auto-applied -->

ÚKOL PRO CURSOR — infoUzel.cz / Silver

```
===
1. Zkontroluj stav repozitáře
Ověř, zda je pracovní strom čistý a zda je potřeba provést push.
```powershell
Set-Location -Path C:\projects\filtr
git status
```

2. Zpracuj necommitované změny
Pokud chceš tyto změny zahrnout do dalšího commitu, přidej soubory a commitni je explicitně podle svého procesu, pak proveď push.
```powershell
git add SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
git commit -m "Úpravy v SILVER souborech"
git push origin main
```

3. Pokud nechceš tyto změny na remote
Pokud nechceš tyto změny odeslat, použij stash, pak proveď push a nakonec obnov změny.
```powershell
git stash -u
git push origin main
git stash pop
```

4. Pokud jsi změny provedl omylem
Pokud jsi změny provedl omylem, obnov soubory do předchozího stavu.
```powershell
git restore SILVER_CURSOR_OUTPUT.md SILVER_NEXT_ACTION.md SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md
```
===
```
