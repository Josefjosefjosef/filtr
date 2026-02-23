@echo off
setlocal

set "ROOT=C:\projects\filtr"

REM spustit autorun silent bez okna (nezávislé na aktuálním working dir)
start "" cmd /c "%ROOT%\tools\autorun\run-local.cmd /silent"

REM volitelně otevřít web (můžeš nechat / odstranit)
start "" "https://infouzel.cz/"

endlocal
