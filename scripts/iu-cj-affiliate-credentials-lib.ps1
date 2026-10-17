# infoUzel.cz - local CJ credentials (DPAPI CurrentUser, PS 5.1). No secrets in repo.
# Dot-source only; do not run directly.

if (-not ([System.Management.Automation.PSTypeName]"IuCjCredentialsLibLoaded").Type) {
  Add-Type -AssemblyName System.Security -ErrorAction Stop
}

function Get-IuCjCredentialsRoot {
  if (-not [string]::IsNullOrWhiteSpace($env:IU_CJ_CREDENTIALS_ROOT)) {
    return [System.IO.Path]::GetFullPath($env:IU_CJ_CREDENTIALS_ROOT.Trim())
  }
  return Join-Path $env:LOCALAPPDATA "infoUzel\CJ"
}

function Get-IuCjCredentialsPaths {
  $root = Get-IuCjCredentialsRoot
  return @{
    Root       = $root
    Identity   = Join-Path $root "identity.json"
    PatDpapi   = Join-Path $root "pat.dpapi"
    PatTmp     = Join-Path $root "pat.dpapi.tmp"
  }
}

function Initialize-IuCjCredentialsDirectory {
  $paths = Get-IuCjCredentialsPaths
  if (-not (Test-Path -LiteralPath $paths.Root)) {
    $null = New-Item -ItemType Directory -Path $paths.Root -Force
  }
  try {
    $acl = Get-Acl -LiteralPath $paths.Root
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
      [System.Security.Principal.WindowsIdentity]::GetCurrent().Name,
      "FullControl",
      "ContainerInherit,ObjectInherit",
      "None",
      "Allow"
    )
    $acl.SetAccessRuleProtection($true, $false)
    $acl.ResetAccessRule($rule)
    Set-Acl -LiteralPath $paths.Root -AclObject $acl
  }
  catch {
    # LocalAppData is already user-private; ACL hardening is best-effort.
  }
}

function ConvertFrom-IuSecurePlain {
  param([Security.SecureString] $Secure)
  if ($null -eq $Secure) { return $null }
  if ($PSVersionTable.PSVersion.Major -ge 7) {
    return [System.Net.NetworkCredential]::new("", $Secure).Password
  }
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
  finally {
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  }
}

function Clear-IuCjProcessEnv {
  foreach ($name in @(
      "IU_CJ_PAT", "CJ_PERSONAL_ACCESS_TOKEN", "CJ_ACCESS_TOKEN",
      "IU_CJ_PUBLISHER_CID", "CJ_PUBLISHER_CID",
      "IU_CJ_WEBSITE_PID", "CJ_WEBSITE_PID", "CJ_PID",
      "IU_CJ_CREDENTIAL_SOURCE"
    )) {
    Remove-Item -Path ("Env:" + $name) -ErrorAction SilentlyContinue
  }
}

function Protect-IuCjPatToBytes {
  param([string] $PlainPat)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$PlainPat)
  try {
    return [System.Security.Cryptography.ProtectedData]::Protect(
      $bytes,
      $null,
      [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )
  }
  finally {
    if ($bytes.Length -gt 0) { [Array]::Clear($bytes, 0, $bytes.Length) }
  }
}

function Unprotect-IuCjPatFromBytes {
  param([byte[]] $ProtectedBytes)
  $plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $ProtectedBytes,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  try {
    return [System.Text.Encoding]::UTF8.GetString($plainBytes)
  }
  finally {
    if ($null -ne $plainBytes -and $plainBytes.Length -gt 0) {
      [Array]::Clear($plainBytes, 0, $plainBytes.Length)
    }
  }
}

function Write-IuCjFileAtomic {
  param(
    [string] $TargetPath,
    [scriptblock] $Writer
  )
  $dir = Split-Path -Parent $TargetPath
  if (-not (Test-Path -LiteralPath $dir)) {
    $null = New-Item -ItemType Directory -Path $dir -Force
  }
  $tmp = $TargetPath + ".tmp-" + [Guid]::NewGuid().ToString("N")
  $bak = $TargetPath + ".bak-" + [Guid]::NewGuid().ToString("N")
  $hadBackup = $false
  try {
    & $Writer $tmp
    if (Test-Path -LiteralPath $TargetPath) {
      Move-Item -LiteralPath $TargetPath -Destination $bak -Force
      $hadBackup = $true
    }
    Move-Item -LiteralPath $tmp -Destination $TargetPath -Force
    if ($hadBackup -and (Test-Path -LiteralPath $bak)) {
      Remove-Item -LiteralPath $bak -Force -ErrorAction SilentlyContinue
    }
  }
  catch {
    if ($hadBackup -and (Test-Path -LiteralPath $bak)) {
      if (Test-Path -LiteralPath $TargetPath) {
        Remove-Item -LiteralPath $TargetPath -Force -ErrorAction SilentlyContinue
      }
      Move-Item -LiteralPath $bak -Destination $TargetPath -Force
    }
    throw
  }
  finally {
    if (Test-Path -LiteralPath $tmp) {
      Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $bak) {
      Remove-Item -LiteralPath $bak -Force -ErrorAction SilentlyContinue
    }
  }
}

function Save-IuCjIdentityConfig {
  param(
    [string] $PublisherCid,
    [string] $WebsitePid
  )
  Initialize-IuCjCredentialsDirectory
  $paths = Get-IuCjCredentialsPaths
  $obj = @{
    version      = 1
    publisherCid = [string]$PublisherCid.Trim()
    websitePid   = [string]$WebsitePid.Trim()
    updatedAt    = (Get-Date).ToUniversalTime().ToString("o")
  }
  $json = $obj | ConvertTo-Json -Compress
  Write-IuCjFileAtomic -TargetPath $paths.Identity -Writer {
    param($OutPath)
    [System.IO.File]::WriteAllText($OutPath, $json, [System.Text.UTF8Encoding]::new($false))
  }
}

function Save-IuCjPatEncrypted {
  param([string] $PlainPat)
  Initialize-IuCjCredentialsDirectory
  $paths = Get-IuCjCredentialsPaths
  $protected = Protect-IuCjPatToBytes -PlainPat $PlainPat
  Write-IuCjFileAtomic -TargetPath $paths.PatDpapi -Writer {
    param($OutPath)
    [System.IO.File]::WriteAllBytes($OutPath, $protected)
  }
}

function Get-IuCjIdentityConfig {
  $paths = Get-IuCjCredentialsPaths
  if (-not (Test-Path -LiteralPath $paths.Identity)) { return $null }
  try {
    $raw = Get-Content -LiteralPath $paths.Identity -Raw -Encoding UTF8
    return ($raw | ConvertFrom-Json)
  }
  catch {
    return $null
  }
}

function Test-IuCjCredentialsStorePresent {
  $paths = Get-IuCjCredentialsPaths
  return @{
    RootExists     = (Test-Path -LiteralPath $paths.Root)
    IdentityExists = (Test-Path -LiteralPath $paths.Identity)
    PatExists      = (Test-Path -LiteralPath $paths.PatDpapi)
  }
}

function Test-IuCjPatDecrypt {
  $paths = Get-IuCjCredentialsPaths
  if (-not (Test-Path -LiteralPath $paths.PatDpapi)) { return $false }
  try {
    $bytes = [System.IO.File]::ReadAllBytes($paths.PatDpapi)
    $plain = Unprotect-IuCjPatFromBytes -ProtectedBytes $bytes
    $ok = -not [string]::IsNullOrWhiteSpace($plain)
    if ($plain) { $plain = (" " * [Math]::Min($plain.Length, 4096)) }
    return $ok
  }
  catch {
    return $false
  }
}

function Get-IuCjCredentialsStatusObject {
  $paths = Get-IuCjCredentialsPaths
  $present = Test-IuCjCredentialsStorePresent
  $identity = Get-IuCjIdentityConfig
  $decryptOk = $false
  if ($present.PatExists) { $decryptOk = Test-IuCjPatDecrypt }
  return @{
    credentialsRoot   = $paths.Root
    storePresent      = ($present.IdentityExists -and $present.PatExists)
    identityReadable  = ($null -ne $identity)
    patFilePresent    = $present.PatExists
    decryptOk         = $decryptOk
    publisherCidSet   = [bool]$identity.publisherCid
    websitePidSet     = [bool]$identity.websitePid
    readyForLocalRun  = ($present.IdentityExists -and $present.PatExists -and $decryptOk -and $identity.publisherCid -and $identity.websitePid)
  }
}

function Write-IuCjCredentialsMissingGuide {
  Write-Host "CJ local credentials are not configured or not readable."
  Write-Host "One-time setup (secure PAT prompt, DPAPI CurrentUser):"
  Write-Host "  powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/iu-cj-affiliate-credentials-setup.ps1"
  Write-Host "Status without revealing secrets:"
  Write-Host "  powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/iu-cj-affiliate-credentials-status.ps1"
}

function Test-IuCjPatFormatWithNode {
  param(
    [string] $RepoRoot,
    [string] $PlainPat
  )
  Remove-Item Env:IU_CJ_PAT -ErrorAction SilentlyContinue
  $env:IU_CJ_PAT = $PlainPat
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { throw "Node.js is not on PATH." }
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $lines = @(& node --dns-result-order=ipv4first (Join-Path $RepoRoot "scripts/iu-cj-affiliate-phase1-check-pat-format.mjs") 2>&1 | ForEach-Object { "$_" })
    $code = [int]$LASTEXITCODE
    $jsonLine = $null
    for ($i = $lines.Count - 1; $i -ge 0; $i--) {
      if ($lines[$i] -match '^\s*\{') { $jsonLine = $lines[$i]; break }
    }
    $parsed = $null
    if ($jsonLine) {
      try { $parsed = $jsonLine | ConvertFrom-Json } catch { }
    }
    return @{ ExitCode = $code; Parsed = $parsed; Lines = $lines }
  }
  finally {
    Remove-Item Env:IU_CJ_PAT -ErrorAction SilentlyContinue
    $ErrorActionPreference = $prevEap
  }
}

function Install-IuCjProcessCredentialsFromStore {
  param([string] $RepoRoot)
  $status = Get-IuCjCredentialsStatusObject
  if (-not $status.readyForLocalRun) {
    Write-IuCjCredentialsMissingGuide
    if (-not $status.decryptOk -and $status.patFilePresent) {
      Write-Host "DPAPI decrypt failed. Re-run setup or rotate PAT on this Windows user profile."
    }
    throw "CJ credentials store not ready."
  }
  $identity = Get-IuCjIdentityConfig
  $paths = Get-IuCjCredentialsPaths
  $bytes = [System.IO.File]::ReadAllBytes($paths.PatDpapi)
  $patPlain = Unprotect-IuCjPatFromBytes -ProtectedBytes $bytes
  if ([string]::IsNullOrWhiteSpace($patPlain)) {
    throw "Decrypted PAT is empty."
  }
  $check = Test-IuCjPatFormatWithNode -RepoRoot $RepoRoot -PlainPat $patPlain
  if ($check.ExitCode -ne 0 -or -not $check.Parsed -or $check.Parsed.IU_CJ_PAT_FORMAT -ne "OK") {
    $patPlain = (" " * [Math]::Min($patPlain.Length, 4096))
    $patPlain = $null
    throw "Stored PAT failed local format/header check. Use credentials-rotate.ps1 to replace it."
  }
  Clear-IuCjProcessEnv
  $env:IU_CJ_CREDENTIAL_SOURCE = "local_dpapi"
  $env:IU_CJ_PUBLISHER_CID = [string]$identity.publisherCid
  $env:IU_CJ_WEBSITE_PID = [string]$identity.websitePid
  $env:IU_CJ_PAT = $patPlain
  return @{
    PatPlain     = $patPlain
    PublisherCid = [string]$identity.publisherCid
    WebsitePid   = [string]$identity.websitePid
    Source       = "local_dpapi"
  }
}

function Clear-IuCjPatPlainInMemory {
  param([ref] $PatPlainRef)
  if ($null -eq $PatPlainRef) { return }
  $val = $PatPlainRef.Value
  if ($val) {
    $PatPlainRef.Value = (" " * [Math]::Min($val.Length, 4096))
    $PatPlainRef.Value = $null
  }
}
