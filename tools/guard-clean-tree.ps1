param(
  [string[]]$AllowFiles = @()
)

$st = git status --porcelain
if (-not $st) {
  Write-Host "OK: clean working tree."
  exit 0
}

# Parse changed paths
$paths = @()
$st -split "`n" | ForEach-Object {
  $line = $_.TrimEnd()
  if ($line.Length -ge 4) {
    $paths += $line.Substring(3)
  }
}

# If allow list provided, enforce it
if ($AllowFiles.Count -gt 0) {
  $bad = $paths | Where-Object { $AllowFiles -notcontains $_ }
  if ($bad.Count -gt 0) {
    Write-Error ("STOP-SHIP: dirty tree includes disallowed paths: " + ($bad -join ", "))
    exit 2
  }
}

Write-Error ("STOP-SHIP: dirty working tree. Paths: " + ($paths -join ", "))
exit 2
