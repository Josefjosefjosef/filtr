# Safe production verify helpers (PowerShell)
# Fixes ArgumentOutOfRangeException from Substring using original length after -replace.
# NEVER use: ($vj -replace '\s+',' ').Substring(0, [Math]::Min(120, $vj.Length))

param(
  [string]$BaseUrl = "https://infouzel.cz"
)

$ErrorActionPreference = "Continue"
$base = $BaseUrl.TrimEnd("/")

function Get-SafePreview {
  param(
    [AllowNull()][string]$Text,
    [int]$MaxLen = 120
  )
  if ($null -eq $Text) { return "" }
  $collapsed = ([string]$Text) -replace "\s+", " "
  $collapsed = $collapsed.Trim()
  if ($collapsed.Length -eq 0) { return "" }
  $n = [Math]::Min($MaxLen, $collapsed.Length)
  if ($n -le 0) { return "" }
  return $collapsed.Substring(0, $n)
}

Write-Output ("PROD_BASE=" + $base)

try {
  $html = (Invoke-WebRequest -UseBasicParsing -Uri ($base + "/projects/index.html") -Headers @{ "Cache-Control" = "no-cache" }).Content
  if ($html -match "app\.([a-f0-9]{8})\.js") {
    Write-Output ("PROD_APP_SHA8=" + $Matches[1])
  } else {
    Write-Output "PROD_APP_SHA8="
    Write-Output "DIAG_APP_PARSE=UNVERIFIED"
  }
} catch {
  Write-Output "PROD_APP_SHA8="
  Write-Output ("DIAG_HTML_ERROR=" + $_.Exception.Message)
}

try {
  $vj = (Invoke-WebRequest -UseBasicParsing -Uri ($base + "/projects/version.json") -Headers @{ "Cache-Control" = "no-cache" }).Content
  if ($null -eq $vj) { $vj = "" }
  Write-Output ("VERSION_JSON_LEN=" + ([string]$vj).Length)
  Write-Output ("VERSION_JSON_PREVIEW=" + (Get-SafePreview -Text $vj -MaxLen 120))
  try {
    $obj = $vj | ConvertFrom-Json
    if ($null -ne $obj -and $obj.version) {
      Write-Output ("VERSION_JSON_VERSION=" + [string]$obj.version)
    } else {
      Write-Output "VERSION_JSON_VERSION="
      Write-Output "DIAG_VERSION_PARSE=MISSING_FIELD"
    }
  } catch {
    Write-Output "VERSION_JSON_VERSION="
    Write-Output ("DIAG_VERSION_PARSE=FAIL_JSON:" + $_.Exception.Message)
  }
} catch {
  Write-Output "VERSION_JSON_LEN=0"
  Write-Output "VERSION_JSON_PREVIEW="
  Write-Output "VERSION_JSON_VERSION="
  Write-Output ("DIAG_VERSION_FETCH=" + $_.Exception.Message)
}

try {
  $sw = (Invoke-WebRequest -UseBasicParsing -Uri ($base + "/sw.js") -Headers @{ "Cache-Control" = "no-cache" }).Content
  if ($sw -match "pwa-offline-menu-articles-v4") { Write-Output "SW_V4=YES" } else { Write-Output "SW_V4=NO" }
} catch {
  Write-Output "SW_V4=UNVERIFIED"
  Write-Output ("DIAG_SW_ERROR=" + $_.Exception.Message)
}

Write-Output "DIAG_VERDICT=INFORMATIONAL_ONLY"
