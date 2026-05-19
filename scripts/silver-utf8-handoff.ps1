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
  # Do not list 0x017D (Ž): valid Czech; mojibake uses Ž only inside fragment markers below.
  $codes = @(0x0102, 0x00C4, 0x00C2, 0x00C3)
  $sb = New-Object System.Text.StringBuilder
  foreach ($c in $codes) {
    [void]$sb.Append([char]$c)
  }
  return $sb.ToString()
}

$script:SilverCzechGoodChars = New-SilverCzechGoodCharString
$script:SilverCzechBadChars = New-SilverCzechBadCharString

$script:SilverRealApiMojibakeMarkers = @(
  [string][char]0x0102 + [char]0x02C1,
  [string][char]0x0102 + [char]0x00AD,
  [string][char]0x0102 + [char]0x00A9,
  [string][char]0x0102 + [char]0x00BD,
  [string][char]0x0102 + [char]0x0161,
  "Aktu" + [char]0x0102 + [char]0x02C1 + "ln" + [char]0x0102 + [char]0x00AD,
  "Shrnut" + [char]0x0102 + [char]0x00AD,
  "Orchestr" + [char]0x0102 + [char]0x00A1 + "tor",
  "dob" + [char]0x00C4 + [char]0x203A,
  [char]0x017D + [char]0x02C1 + "pinav",
  "bezpe" + [char]0x00C4 + [char]0x0165 + "nostn" + [char]0x0102 + [char]0x00AD,
  "po" + [char]0x0102 + [char]0x00A1 + "tadla",
  "ko" + [char]0x017D + [char]0x0159 + "eni",
  [char]0x017D + [char]0x017E + [char]0x0102 + [char]0x00BD + "dn",
  [char]0x00E2 + [char]0x20AC + [char]0x0094,
  [char]0x00E2 + [char]0x20AC + [char]0x0093,
  [char]0x00E2 + [char]0x20AC + [char]0x009D,
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
  "p" + [char]0x017D + [char]0x203A,
  "p" + [char]0x017D + [char]0x203A,
  "klasifik" + [char]0x00C4 + "tor"
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
  return (Test-SilverUtf8MojibakeMarkersCore -Text $Text)
}

function Test-SilverUtf8MojibakeMarkersStrict {
  param([string]$Text)
  return (Test-SilverUtf8MojibakeMarkers -Text $Text)
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

function Read-TextFileUtf8Raw {
  param([string]$Path)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $utf8 = $script:SilverUtf8NoBom
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    return $utf8.GetString($bytes, 3, $bytes.Length - 3)
  }
  return $utf8.GetString($bytes)
}

function Read-TextFileUtf8Handoff {
  param([string]$Path)
  $text = Read-TextFileUtf8Raw -Path $Path
  $repairedFlag = "NO"
  $fixed = Repair-SilverUtf8HandoffText -Text $text -Repaired ([ref]$repairedFlag)
  return $fixed
}

function Get-SilverUtf8MojibakeFirstSample {
  param([string]$Text, [int]$ContextChars = 48)
  if ([string]::IsNullOrEmpty($Text)) { return "" }
  $idx = -1
  foreach ($ch in $script:SilverCzechBadChars.ToCharArray()) {
    $i = $Text.IndexOf($ch)
    if ($i -ge 0 -and ($idx -lt 0 -or $i -lt $idx)) { $idx = $i }
  }
  foreach ($frag in $script:SilverRealApiMojibakeMarkers) {
    $i = $Text.IndexOf($frag, [System.StringComparison]::Ordinal)
    if ($i -ge 0 -and ($idx -lt 0 -or $i -lt $idx)) { $idx = $i }
  }
  if ($Text.Contains([string][char]0x00E2 + [char]0x20AC)) {
    $i = $Text.IndexOf([string][char]0x00E2 + [char]0x20AC, [System.StringComparison]::Ordinal)
    if ($i -ge 0 -and ($idx -lt 0 -or $i -lt $idx)) { $idx = $i }
  }
  if ($idx -lt 0) { return "" }
  $start = [Math]::Max(0, $idx - $ContextChars)
  $len = [Math]::Min($Text.Length - $start, ($ContextChars * 2) + 32)
  return $Text.Substring($start, $len).Replace("`r", " ").Replace("`n", " ")
}

function Set-SilverProcessStartInfoUtf8Streams {
  param([System.Diagnostics.ProcessStartInfo]$Psi)
  if ($null -eq $Psi) { return }
  $enc = $script:SilverUtf8NoBom
  try {
    $Psi.StandardOutputEncoding = $enc
    $Psi.StandardErrorEncoding = $enc
  }
  catch { }
}

function Read-ProcessPipeUtf8 {
  param([System.IO.StreamReader]$Reader)
  if ($null -eq $Reader) { return "" }
  try {
    $text = $Reader.ReadToEnd()
    if (-not [string]::IsNullOrEmpty($text)) {
      return $text
    }
  }
  catch { }
  try {
    $stream = $Reader.BaseStream
    if ($null -eq $stream) {
      return ""
    }
    if (-not $stream.CanRead) {
      return ""
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
    return ""
  }
}

function Read-CmdRedirectCaptureFileUtf8 {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return "" }
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -eq 0) { return "" }
  $utf8 = $script:SilverUtf8NoBom
  $text = $utf8.GetString($bytes)
  if (Test-SilverUtf8MojibakeMarkersCore -Text $text) {
    $repairedFlag = "NO"
    $text = Repair-SilverUtf8HandoffText -Text $text -Repaired ([ref]$repairedFlag)
  }
  return $text
}

function Get-SilverUtf8CaptureProbeRequiredPhrases {
  return @(
    ([string][char]0x00DA + "KOL PRO CURSOR"),
    ("Aktu" + [char]0x00E1 + "ln" + [char]0x00ED),
    ("Co jsem zm" + [char]0x011B + "nil"),
    ("K" + [char]0x00F3 + "d jsem nem" + [char]0x011B + "nil"),
    ("spou" + [char]0x0161 + "t" + [char]0x011B + "l existuj" + [char]0x00ED + "c" + [char]0x00ED),
    ("diagnostick" + [char]0x00E9),
    ("pracovn" + [char]0x00ED),
    ("strom t" + [char]0x00ED + "m p" + [char]0x00E1 + "dem"),
    ("P" + [char]0x0159 + [char]0x00ED + "kazy"),
    ("prost" + [char]0x0159 + "ed" + [char]0x00ED),
    ("n" + [char]0x00E1 + "hradn" + [char]0x00ED),
    ([char]0x017D + [char]0x00E1 + "dn" + [char]0x00FD)
  )
}

function Test-SilverRealUtf8CaptureProbeText {
  param([string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return $false }
  if (Test-SilverUtf8MojibakeMarkersCore -Text $Text) { return $false }
  foreach ($frag in (Get-SilverUtf8CaptureProbeRequiredPhrases)) {
    if ($Text.IndexOf($frag, [System.StringComparison]::Ordinal) -lt 0) {
      return $false
    }
  }
  return $true
}

function Test-SilverPromptPreviewUtf8ProbeText {
  param([string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return $false }
  if (Test-SilverUtf8MojibakeMarkersCore -Text $Text) { return $false }
  $need = @(
    ([string][char]0x00DA + "KOL PRO CURSOR"),
    ("Aktu" + [char]0x00E1 + "ln" + [char]0x00ED)
  )
  foreach ($frag in $need) {
    if ($Text.IndexOf($frag, [System.StringComparison]::Ordinal) -lt 0) {
      return $false
    }
  }
  return $true
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
