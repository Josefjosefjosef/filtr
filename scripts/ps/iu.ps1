# iu.ps1 - PowerShell helper pro filtr projekt
# How to use:
#   . .\scripts\ps\iu.ps1
#   iu-status
#   iu-log
#   iu-diffwf

function iu-cd { Set-Location C:\projects\filtr }

function iu-status { iu-cd; git status }

function iu-log { iu-cd; git log --oneline -10 }

function iu-diffwf { iu-cd; git diff HEAD -- .github/workflows }
