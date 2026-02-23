@echo off
setlocal
set "SILENT="
if /I "%~1"=="/silent" set "SILENT=1"
chcp 65001 >nul

set "ROOT=C:\projects\filtr"
set "LOG=C:\projects\filtr\tools\autorun\autorun.log"
set "LOCK=C:\projects\filtr\tools\autorun\autorun.lock"

if not exist "%LOCK%" goto :run
echo ===== %date% %time% LOCKED (skipping) =====>> "C:\projects\filtr\tools\autorun\autorun.log"
exit /b 0
:run
echo %date% %time% > "%LOCK%"

echo.>> "%LOG%"
echo ===== %date% %time% RUN-LOCAL START (silent=%SILENT%) =====>> "%LOG%"
echo CWD=%CD% >> "%LOG%"
echo ROOT=%ROOT% >> "%LOG%"
where py >> "%LOG%" 2>&1
py --version >> "%LOG%" 2>&1
if defined SILENT ping -n 3 127.0.0.1 >nul 2>&1

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