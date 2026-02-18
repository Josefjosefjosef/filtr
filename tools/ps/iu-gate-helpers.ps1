Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Iu-EnsureDir([string]$path){
  if([string]::IsNullOrWhiteSpace($path)){ throw "Iu-EnsureDir: empty path" }
  if(!(Test-Path $path)){ New-Item -ItemType Directory -Path $path | Out-Null }
}

function Iu-MoveGateArtifacts([string]$dest){
  Iu-EnsureDir $dest
  Get-ChildItem -File -Filter "gate-*.png" -ErrorAction SilentlyContinue | ForEach-Object {
    Move-Item $_.FullName $dest -Force
  }
  if(Test-Path .\gate-weather-stuck-transcript.txt){
    Move-Item .\gate-weather-stuck-transcript.txt $dest -Force
  }
}

function Iu-AbortMergeRebase(){
  if(Test-Path .git\MERGE_HEAD){ git merge --abort | Out-Null }
  if( (Test-Path .git\rebase-apply) -or (Test-Path .git\rebase-merge) ){ git rebase --abort | Out-Null }
}

function Iu-HardClean(){
  git reset --hard | Out-Null
  git clean -fd | Out-Null
}

function Iu-SyncMain(){
  git fetch origin | Out-Null
  git switch main | Out-Null
  git pull --ff-only origin main | Out-Null
}

