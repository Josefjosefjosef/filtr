#requires -Version 5.1
<#
.SYNOPSIS
  Shared UTF-8 / mojibake helpers for Silver WSL handoff (scripts-only).
#>
Set-StrictMode -Version 2

if (-not (Get-Variable -Name SilverUtf8NoBom -Scope Script -ErrorAction SilentlyContinue)) {
  $script:SilverUtf8NoBom = New-Object System.Text.UTF8Encoding $false
}

function New-SilverCzechGoodCharString {
  $codes = @(
    0x00E1, 0x010D, 0x010F, 0x00E9, 0x011B, 0x00ED, 0x0148, 0x00F3, 0x0159, 0x0161, 0x0165, 0x00FA, 0x016F, 0x00FD, 0x017E,
    0x00C1, 0x010C, 0x010E, 0x00C9, 0x011A, 0x00CD, 0x0147, 0x00D3, 0x0158, 0x0160, 0x0164, 0x00DA, 0x016E, 0x00DD, 0x017D,
    0x2014
  )
  $sb = New-Object System.Text.StringBuilder
  foreach ($c in $codes) {
    [void]$sb.Append([char]$c)
  }
  return $sb.ToString()
}

function New-SilverCzechBadCharString {
  $codes = @(0x0102, 0x00C4, 0x017D, 0x00C2, 0x00C3)
  $sb = New-Object System.Text.StringBuilder
  foreach ($c in $codes) {
    [void]$sb.Append([char]$c)
  }
  return $sb.ToString()
}

$script:SilverCzechGoodChars = New-SilverCzechGoodCharString
$script:SilverCzechBadChars = New-SilverCzechBadCharString

$script:SilverRealApiMojibakeMarkers = @(
  [string][char]0x0102 + [char]0x0161,
  [char]0x00E2 + [char]0x20AC + [char]0x0094,
  [char]0x00E2 + [char]0x20AC + [char]0x0093,
  "Ov" + [char]0x00C4,
  [char]0x00C4 + [char]0x203A,
  [char]0x017D + [char]0x0159,
  [char]0x0102 + [char]0x02C1,
  [char]0x00C4 + [char]0x0165,
  [char]0x017D + [char]0x017E,
  "po" + [char]0x017D,
  "p" + [char]0x017D,
  "zm" + [char]0x00C4,
  "aktu" + [char]0x0102,
  "p" + [char]0x017D + [char]0x203A
)

function Initialize-SilverConsoleUtf8 {
  try {
    $enc = New-Object System.Text.UTF8Encoding $false
    [Console]::OutputEncoding = $enc
    $global:OutputEncoding = $enc
  }
  catch { }
}

function Test-SilverUtf8MojibakeMarkers {
  param([string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return $false }
  if (Test-SilverUtf8MojibakeMarkersCore -Text $Text) { return $true }
  $score = Get-SilverCzechTextScore -Text $Text
  $cand = Repair-SilverUtf8MojibakeText -Text $Text
  $candScore = Get-SilverCzechTextScore -Text $cand
  if (($cand -ne $Text) -and ($candScore -gt $score)) { return $true }
  return $false
}

function Get-SilverCzechTextScore {
  param([string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return 0 }
  $score = 0
  foreach ($ch in $Text.ToCharArray()) {
    if ($script:SilverCzechGoodChars.IndexOf($ch) -ge 0) { $score++ }
    if ($script:SilverCzechBadChars.IndexOf($ch) -ge 0) { $score-- }
  }
  return $score
}

function Test-SilverUtf8MojibakeMarkersCore {
  param([string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return $false }
  foreach ($ch in $script:SilverCzechBadChars.ToCharArray()) {
    if ($Text.IndexOf($ch) -ge 0) { return $true }
  }
  foreach ($frag in $script:SilverRealApiMojibakeMarkers) {
    if ($Text.IndexOf($frag, [System.StringComparison]::Ordinal) -ge 0) { return $true }
  }
  if ($Text.Contains([string][char]0x00E2 + [char]0x20AC)) { return $true }
  if ($Text.Contains([string][char]0x00C3 + [char]0x009A)) { return $true }
  if ($Text.Contains('p' + [char]0x017D)) { return $true }
  return $false
}

function Get-SilverUtf8MojibakeHitLocations {
  param([string]$Text)
  $hits = New-Object System.Collections.Generic.List[string]
  if ([string]::IsNullOrEmpty($Text)) { return $hits.ToArray() }
  foreach ($ch in $script:SilverCzechBadChars.ToCharArray()) {
    $idx = $Text.IndexOf($ch)
    if ($idx -ge 0) {
      [void]$hits.Add("char_" + [string]$ch + "@" + [string]$idx)
    }
  }
  foreach ($frag in $script:SilverRealApiMojibakeMarkers) {
    $idx = $Text.IndexOf($frag, [System.StringComparison]::Ordinal)
    if ($idx -ge 0) {
      [void]$hits.Add("frag_" + $frag + "@" + [string]$idx)
    }
  }
  if ($Text.Contains([string][char]0x00E2 + [char]0x20AC)) {
    [void]$hits.Add("frag_em_dash_mojibake")
  }
  return $hits.ToArray()
}

function Repair-SilverUtf8MojibakeText {
  param([string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return $Text }
  if (-not (Test-SilverUtf8MojibakeMarkersCore -Text $Text)) { return $Text }
  $utf8 = $script:SilverUtf8NoBom
  $candidates = New-Object System.Collections.Generic.List[string]
  [void]$candidates.Add($Text)
  $encodings = @(
    [System.Text.Encoding]::GetEncoding(28591),
    [System.Text.Encoding]::GetEncoding(1252),
    [System.Text.Encoding]::GetEncoding(1250)
  )
  foreach ($enc in $encodings) {
    try {
      $bytes = $enc.GetBytes($Text)
      [void]$candidates.Add($utf8.GetString($bytes))
    }
    catch { }
  }
  try {
    $latin1 = [System.Text.Encoding]::GetEncoding(28591)
    $byteList = New-Object System.Collections.Generic.List[byte]
    foreach ($ch in $Text.ToCharArray()) {
      $cp = [int][char]$ch
      if ($cp -gt 255) {
        $byteList = $null
        break
      }
      [void]$byteList.Add([byte]$cp)
    }
    if ($null -ne $byteList) {
      [void]$candidates.Add($utf8.GetString($byteList.ToArray()))
    }
  }
  catch { }
  $best = $Text
  $bestScore = Get-SilverCzechTextScore -Text $Text
  foreach ($cand in $candidates) {
    $sc = Get-SilverCzechTextScore -Text $cand
    if ($sc -gt $bestScore) {
      $bestScore = $sc
      $best = $cand
    }
  }
  return $best
}

function Repair-SilverUtf8HandoffText {
  param(
    [string]$Text,
    [ref]$Repaired
  )
  if ($null -eq $Repaired) {
    throw "Repair-SilverUtf8HandoffText requires [ref]`$Repaired"
  }
  $Repaired.Value = "NO"
  if ([string]::IsNullOrEmpty($Text)) { return $Text }
  if (-not (Test-SilverUtf8MojibakeMarkersCore -Text $Text)) { return $Text }
  $fixed = Repair-SilverUtf8MojibakeText -Text $Text
  if ($fixed -ne $Text) {
    $Repaired.Value = "YES"
  }
  return $fixed
}

function Read-TextFileUtf8NoBomShared {
  param([string]$Path)
  return [System.IO.File]::ReadAllText($Path, $script:SilverUtf8NoBom)
}

function Read-TextFileUtf8Handoff {
  param([string]$Path)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $utf8 = $script:SilverUtf8NoBom
  $text = ""
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $text = $utf8.GetString($bytes, 3, $bytes.Length - 3)
  }
  else {
    $text = $utf8.GetString($bytes)
  }
  $repairedFlag = "NO"
  $fixed = Repair-SilverUtf8HandoffText -Text $text -Repaired ([ref]$repairedFlag)
  return $fixed
}

function Read-ProcessPipeUtf8 {
  param([System.IO.StreamReader]$Reader)
  if ($null -eq $Reader) { return "" }
  try {
    $stream = $Reader.BaseStream
    if ($null -eq $stream) {
      return $Reader.ReadToEnd()
    }
    $ms = New-Object System.IO.MemoryStream
    try {
      $stream.CopyTo($ms)
      $bytes = $ms.ToArray()
      if ($bytes.Length -eq 0) { return "" }
      return $script:SilverUtf8NoBom.GetString($bytes)
    }
    finally {
      $ms.Dispose()
    }
  }
  catch {
    return $Reader.ReadToEnd()
  }
}

function Set-SilverWslUtf8ProcessEnvironment {
  $prev = [Environment]::GetEnvironmentVariable("WSL_UTF8", "Process")
  [Environment]::SetEnvironmentVariable("WSL_UTF8", "1", "Process")
  return $prev
}

function Restore-SilverWslUtf8ProcessEnvironment {
  param([string]$PreviousValue)
  if ($null -eq $PreviousValue) {
    [Environment]::SetEnvironmentVariable("WSL_UTF8", $null, "Process")
  }
  else {
    [Environment]::SetEnvironmentVariable("WSL_UTF8", $PreviousValue, "Process")
  }
}

function Get-SilverWslBashLocalePrefix {
  return 'export LANG=C.UTF-8 LC_ALL=C.UTF-8; '
}

function Add-SilverWslBashLocaleToScript {
  param([string]$BashScript)
  if ([string]::IsNullOrEmpty($BashScript)) { return $BashScript }
  if ($BashScript.StartsWith('export LANG=C.UTF-8')) { return $BashScript }
  return (Get-SilverWslBashLocalePrefix) + $BashScript
}
