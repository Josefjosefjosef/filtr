@echo off
setlocal
chcp 65001 >nul

set "ROOT=C:\projects\filtr"
set "LOG=%ROOT%\tools\autorun\autorun.log"

echo.>> "%LOG%"
echo ===== %date% %time% AUTORUN START =====>> "%LOG%"

cd /d "%ROOT%"

start "" cursor "%ROOT%"
start "" "https://infouzel.cz/"
start "" cmd /c "%ROOT%\tools\autorun\run-local.cmd /silent"

echo ===== %date% %time% AUTORUN END =====>> "%LOG%"
endlocal
