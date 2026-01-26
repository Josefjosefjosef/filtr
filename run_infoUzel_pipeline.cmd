@echo off
setlocal enabledelayedexpansion

REM === Always run from this script folder (portable; no absolute paths) ===
cd /d "%~dp0"

echo.
echo [0/5] ROOT: %CD%
echo.

REM === [1/5] Check Python (py launcher) ===
echo [1/5] Checking Python...
py -V >nul 2>&1
if errorlevel 1 (
  echo ERROR: Python not found. Install Python 3.10+ and ensure 'py' launcher works.
  exit /b 1
)

REM === [2/5] Run pipeline (existing script) ===
echo [2/5] Running pipeline...
py "%~dp0scripts\run_articles_pipeline.py"
if errorlevel 1 (
  echo ERROR: Pipeline failed.
  exit /b 1
)

REM === [3/5] Verify required outputs ===
echo [3/5] Verifying outputs...
py "%~dp0tools\doctor.py"
if errorlevel 1 (
  echo ERROR: Output verification failed.
  exit /b 1
)

REM === [4/5] Show file details (size + time) ===
echo [4/5] Output file details:
dir /-C "%~dp0filtr\data\prod\articles.json" 2>nul
dir /-C "%~dp0filtr\data\health\health.json" 2>nul

REM === [5/5] Done ===
echo.
echo OK: Pipeline finished and outputs verified.
exit /b 0
