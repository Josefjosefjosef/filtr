@echo off
setlocal
set "SILENT="
if /I "%~1"=="/silent" set "SILENT=1"
chcp 65001 >nul

set "ROOT=C:\projects\filtr"
set "LOG=%ROOT%\tools\autorun\autorun.log"
set "LOCK=%ROOT%\tools\autorun\autorun.lock"

if exist "%LOCK%" (
  echo ===== %date% %time% LOCKED (skipping) =====>> "%LOG%"
  exit /b 0
)
echo %date% %time% > "%LOCK%"

cd /d "%ROOT%"

if not defined SILENT echo.
if not defined SILENT echo [RUN-LOCAL] start %date% %time%
echo.>> "%LOG%"
echo ===== %date% %time% RUN-LOCAL START =====>> "%LOG%"

REM --- hard init data dirs (safe) ---
mkdir "%ROOT%\filtr\data" 2>nul
mkdir "%ROOT%\filtr\data\next" 2>nul
mkdir "%ROOT%\filtr\data\prod" 2>nul
mkdir "%ROOT%\filtr\data\lkg" 2>nul
mkdir "%ROOT%\filtr\data\releases" 2>nul
mkdir "%ROOT%\filtr\data\emergency" 2>nul
mkdir "%ROOT%\filtr\data\health" 2>nul

where py >> "%LOG%" 2>&1
py --version >> "%LOG%" 2>&1

if not defined SILENT echo [RUN-LOCAL] doctor.py
py "%ROOT%\tools\doctor.py" >> "%LOG%" 2>&1
if errorlevel 1 echo [RUN-LOCAL] doctor warning >> "%LOG%"

if not defined SILENT echo [RUN-LOCAL] verify_paths.py
py "%ROOT%\tools\verify_paths.py" >> "%LOG%" 2>&1

if not defined SILENT echo [RUN-LOCAL] build feed
py "%ROOT%\scripts\build_articles.py" >> "%LOG%" 2>&1
echo [RUN-LOCAL] build feed exit=%errorlevel% >> "%LOG%"

echo ===== %date% %time% RUN-LOCAL END =====>> "%LOG%"
if not defined SILENT echo [RUN-LOCAL] done (log: %LOG%)
del "%LOCK%" >nul 2>nul
if not defined SILENT pause
endlocal