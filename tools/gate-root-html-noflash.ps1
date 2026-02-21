$ErrorActionPreference='Stop'

$cb=[int][double]::Parse((Get-Date -UFormat %s))
$url="https://infouzel.cz/?cb=$cb"

$html = curl.exe -fsSL $url

# 1) Root HTML nesmí obsahovat viditelný text „Pokračuji“
if($html -match "Pokračuj" -or $html -match "Pokračuji"){
  throw "NO-FLASH gate failed: root HTML contains 'Pokračuj*'"
}

# 2) Root HTML nesmí mít <p> ani viditelné odkazy
if($html -match "<p\b" -or $html -match "<a\b"){
  throw "NO-FLASH gate failed: root HTML contains <p> or <a>"
}

"OK: root HTML contains no visible redirect text"
