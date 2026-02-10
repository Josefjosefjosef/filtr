$ErrorActionPreference = 'Stop'

function Write-FileUtf8 {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $Content | Out-File -FilePath $Path -Encoding utf8
}

function Run-Git {
  param([Parameter(Mandatory = $true)][string[]]$Args)
  $out = & git @Args 2>&1
  $code = $LASTEXITCODE
  return [PSCustomObject]@{ ExitCode = $code; Output = ($out -join "`r`n") }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

$systemMapDir = Join-Path $repoRoot 'docs\system-map'
$auditDir = Join-Path $systemMapDir '_audit'
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null

# 1) Tree (source of truth)
cmd /c "tree /F /A > docs\\system-map\\_tree.txt"

# 2) Git head snapshot
$branch = (Run-Git @('rev-parse','--abbrev-ref','HEAD')).Output.Trim()
$commit = (Run-Git @('rev-parse','HEAD')).Output.Trim()
$log1   = (Run-Git @('log','-1','--oneline')).Output.Trim()
$when   = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
$status = (Run-Git @('status','--porcelain')).Output.TrimEnd()

$statusText = if ($status -and $status.Trim().Length -gt 0) { $status } else { '(clean)' }

$headText = @(
  "date=$when"
  "branch=$branch"
  "commit=$commit"
  "log1=$log1"
  ""
  "git status --porcelain:"
  $statusText
) -join "`r`n"

Write-FileUtf8 -Path (Join-Path $auditDir '_git_head.txt') -Content $headText

# 3) Grep packs (git grep only)
$packs = @(
  @{
    File = '_grep_sw.txt'
    Args = @('grep','-n','-E','navigator\.serviceWorker|serviceWorker\.register|getRegistration|getRegistrations|unregister|caches\.','--','.')
  },
  @{
    File = '_grep_data.txt'
    Args = @('grep','-n','-E','projects/data|articles\.json|videos\.json|brief\.json|meta\.json|feed_health\.json|weather\.json|namedays\.json|_probe\.txt','--','assets','scripts','.github','projects','tools')
  },
  @{
    File = '_grep_init.txt'
    Args = @('grep','-n','-E','DOMContentLoaded|document\.readyState|iuDailyPanelInit|initAiPanel','--','assets/app.js','projects/index.html')
  },
  @{
    File = '_grep_ui.txt'
    Args = @('grep','-n','-E','iuDaily|iu-aiPanel|iuParcels|iuMindPanel|iu-actionsWithSquares|iu-mmQuickItem|iu-parcels','--','projects/index.html','assets/app.js')
  },
  @{
    File = '_grep_cls.txt'
    Args = @('grep','-n','-E','scrollbar-gutter|layout-shift|LayoutShift|replaceChildren|innerHTML|min-height|transition:','--','assets/app.css','assets/app.js','projects/index.html')
  }
)

foreach ($p in $packs) {
  $res = Run-Git -Args $p.Args
  # git grep returns exit code 1 when no matches; that's OK for audit output.
  $header = "command: git $($p.Args -join ' ')`r`nexitCode: $($res.ExitCode)`r`n---`r`n"
  Write-FileUtf8 -Path (Join-Path $auditDir $p.File) -Content ($header + $res.Output + "`r`n")
}

# 4) Workflows list + extracted triggers/jobs
$wfList = Run-Git -Args @('ls-files','.github/workflows')
$wfFiles = $wfList.Output -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 }
Write-FileUtf8 -Path (Join-Path $auditDir '_workflows_list.txt') -Content ($wfFiles -join "`r`n")

$wfExtract = New-Object System.Collections.Generic.List[string]
$wfExtract.Add("date=$when")
$wfExtract.Add("branch=$branch")
$wfExtract.Add("commit=$commit")
$wfExtract.Add("")

foreach ($wf in $wfFiles) {
  $wfExtract.Add("=== $wf ===")
  $show = Run-Git -Args @('show','--', $wf)
  $lines = $show.Output -split "`r?`n"

  $onIdx = ($lines | Select-String -Pattern '^\s*on\s*:' | Select-Object -First 1).LineNumber
  if ($onIdx) {
    $start = $onIdx - 1
    $wfExtract.Add("[on:]")
    for ($i = $start; $i -lt $lines.Length; $i++) {
      $l = $lines[$i]
      if ($i -gt $start -and $l -match '^(permissions|concurrency|jobs|name)\s*:') { break }
      $wfExtract.Add($l)
    }
  } else {
    $wfExtract.Add("[on:] (not found)")
  }

  $jobsIdx = ($lines | Select-String -Pattern '^\s*jobs\s*:' | Select-Object -First 1).LineNumber
  if ($jobsIdx) {
    $wfExtract.Add("[jobs:]")
    for ($i = $jobsIdx; $i -lt $lines.Length; $i++) {
      $l = $lines[$i]
      if ($l -match '^\s{2}([A-Za-z0-9_-]+)\s*:\s*$') {
        $wfExtract.Add("  - $($Matches[1])")
      }
      if ($i -gt $jobsIdx -and $l -match '^(permissions|concurrency|name)\s*:') { break }
    }
  } else {
    $wfExtract.Add("[jobs:] (not found)")
  }
  $wfExtract.Add("")
}

Write-FileUtf8 -Path (Join-Path $auditDir '_workflows_extract.txt') -Content ($wfExtract -join "`r`n")

Write-Host "OK: System Map audit updated."
Write-Host ("- tree: {0}" -f (Join-Path $systemMapDir '_tree.txt'))
Write-Host ("- audit: {0}" -f $auditDir)
