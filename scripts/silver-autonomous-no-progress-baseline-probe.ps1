#requires -Version 5.1
<#
.SYNOPSIS
  Read-only regression probe: autonomous no-progress breaker vs baseline placeholder metric (does not run the loop).

.DESCRIPTION
  Verifies scripts contain the baseline-only skip for autonomous_no_progress_streak and that writeRunReport
  only emits core_engine_progress when the value is not a baseline_pending_precise_measurement placeholder.
#>
param()

Set-StrictMode -Version 2
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$loopPath = Join-Path $repoRoot "scripts\silver-autopilot-loop.ps1"
$cjsPath = Join-Path $repoRoot "scripts\silver-autopilot.cjs"

$loopRaw = Get-Content -LiteralPath $loopPath -Raw
$cjsRaw = Get-Content -LiteralPath $cjsPath -Raw

$hitFn = ($loopRaw | Select-String -SimpleMatch -Pattern "function Test-SilverCoreEngineProgressIsBaselinePlaceholderOnly" -Quiet)
$hitSkipMsg = ($loopRaw | Select-String -Pattern "SILVER_NO_PROGRESS_CHECK_SKIPPED" -Quiet)
$hitBaselineTest = ($loopRaw | Select-String -SimpleMatch -Pattern 'Test-SilverCoreEngineProgressIsBaselinePlaceholderOnly -Value $coreEngineProgress' -Quiet)
$hitCjsGuard = ($cjsRaw | Select-String -SimpleMatch -Pattern "baseline_pending_precise_measurement" -Quiet)
$hitCjsLine = ($cjsRaw | Select-String -SimpleMatch -Pattern 'lines.push("core_engine_progress=" + cep)' -Quiet)

Write-Host "=== SILVER_AUTONOMOUS_NO_PROGRESS_BASELINE_PROBE ==="
Write-Host ("repo_root=" + $repoRoot)
Write-Host ("loop_has_baseline_placeholder_test_fn=" + ($(if ($hitFn) { "YES" } else { "NO" })))
Write-Host ("loop_has_skip_log_line=" + ($(if ($hitSkipMsg) { "YES" } else { "NO" })))
Write-Host ("loop_wires_test_around_no_progress_streak=" + ($(if ($hitBaselineTest) { "YES" } else { "NO" })))
Write-Host ("cjs_write_run_report_filters_baseline_placeholder=" + ($(if ($hitCjsGuard -and $hitCjsLine) { "YES" } else { "NO" })))
Write-Host "interpretation=When core_engine_progress is baseline-only, autonomous no-progress streak must not advance; real flat metrics still use the streak breaker."
Write-Host "=== END_SILVER_AUTONOMOUS_NO_PROGRESS_BASELINE_PROBE ==="
