$ErrorActionPreference='Stop'

$port=9222
# Deterministic fixture: load current commit CSS and compute styles on known DOM.
$sha = ""
try { $sha = (git rev-parse HEAD).Trim() } catch {}
if(-not $sha){ throw "git rev-parse HEAD failed" }
$cssUrl = "https://raw.githubusercontent.com/Josefjosefjosef/filtr/$sha/assets/app.css"
$html = @"
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="$cssUrl" />
  </head>
  <body>
    <div id="topbarWrap">
      <header id="topbarWrap" class="topbar-new iuTopbar">
        <div class="topbar-new-main"></div>
        <button class="topbar-links-arrow topbar-links-arrow--left"></button>
        <button class="topbar-links-arrow topbar-links-arrow--right"></button>
      </header>
    </div>
  </body>
</html>
"@
$url = "data:text/html;charset=utf-8," + [uri]::EscapeDataString($html)
$ud=Join-Path $env:TEMP ("edge-cdp-" + [guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Path $ud | Out-Null

$edgeCandidates=@(
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
)
$edge=$edgeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if(-not $edge){ throw 'msedge.exe not found' }

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $edge
$psi.Arguments = "--headless=new --disable-gpu --window-size=1400,900 --remote-debugging-port=$port --user-data-dir=`"$ud`" --no-first-run --no-default-browser-check --disable-background-networking --disable-features=TranslateUI `"$url`""
$psi.UseShellExecute = $true
$p = [System.Diagnostics.Process]::Start($psi)

try{
  function Get-TargetWsUrl {
    $list = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 2
    foreach($t in $list){
      if($t.type -eq 'page'){ return $t.webSocketDebuggerUrl }
    }
    return $null
  }

  $wsUrl=$null
  for($i=0;$i -lt 60 -and -not $wsUrl;$i++){
    Start-Sleep -Milliseconds 250
    try{ $wsUrl = Get-TargetWsUrl }catch{}
  }
  if(-not $wsUrl){ throw 'CDP target page not found' }

  try{ [void][System.Net.WebSockets.ClientWebSocket]::new() }catch{ try{ Add-Type -AssemblyName System.Net.WebSockets.Client }catch{} }

  $ws = [System.Net.WebSockets.ClientWebSocket]::new()
  $ct = [System.Threading.CancellationToken]::None
  $ws.ConnectAsync([Uri]$wsUrl, $ct).Wait(8000) | Out-Null

  function Send($id,$method,$params){
    $msg=@{id=$id;method=$method;params=$params} | ConvertTo-Json -Compress -Depth 10
    $bytes=[System.Text.Encoding]::UTF8.GetBytes($msg)
    $ws.SendAsync([ArraySegment[byte]]::new($bytes),[System.Net.WebSockets.WebSocketMessageType]::Text,$true,$ct).Wait()
  }
  function Recv($id){
    $buf=New-Object byte[] 1048576; $seg=[ArraySegment[byte]]::new($buf)
    $sw=[System.Diagnostics.Stopwatch]::StartNew()
    while($sw.ElapsedMilliseconds -lt 20000){
      $sb=New-Object System.Text.StringBuilder
      do{
        $r=$ws.ReceiveAsync($seg,$ct)
        if(-not $r.Wait(3000)){ break }
        $n=$r.Result.Count
        if($n -gt 0){ [void]$sb.Append([System.Text.Encoding]::UTF8.GetString($buf,0,$n)) }
      }while(-not $r.Result.EndOfMessage)
      if($sb.Length -eq 0){ continue }
      try{
        $o=$sb.ToString() | ConvertFrom-Json
        if($o.id -eq $id){ return $o }
      }catch{}
    }
    throw "timeout waiting id=$id"
  }
  function Eval($id,$expr){
    Send $id 'Runtime.evaluate' @{expression=$expr;returnByValue=$true;awaitPromise=$true}
    (Recv $id).result.result.value
  }

  Start-Sleep -Milliseconds 2200

  $expr=@'
(() => {
  const topbar = document.querySelector('header#topbarWrap.topbar-new.iuTopbar');
  const main = document.querySelector('#topbarWrap .topbar-new-main');
  const leftA = document.querySelector('.topbar-links-arrow--left');
  const rightA = document.querySelector('.topbar-links-arrow--right');

  const info = (el) => {
    if(!el) return null;
    const cs = getComputedStyle(el);
    return {
      sel: el.className ? '.'+String(el.className).trim().split(/\s+/).join('.') : (el.id ? '#'+el.id : el.tagName),
      bg: cs.backgroundColor,
      bgImg: cs.backgroundImage,
      bgFull: cs.background
    };
  };

  return {
    topbar: info(topbar),
    main: info(main),
    arrowLeft: info(leftA),
    arrowRight: info(rightA)
  };
})();
'@

  $out = Eval 1 $expr
  if(-not $out){ throw "TOPBAR gate failed: no output" }

  # Must have all targets to claim "computed" no-gradient
  if(-not $out.topbar){ throw "TOPBAR gate failed: topbar element missing" }
  if(-not $out.main){ throw "TOPBAR gate failed: main element missing" }
  if(-not $out.arrowLeft){ throw "TOPBAR gate failed: arrowLeft missing" }
  if(-not $out.arrowRight){ throw "TOPBAR gate failed: arrowRight missing" }

  $out | ConvertTo-Json -Compress -Depth 10

  if($out.topbar.bgImg -ne "none"){ throw "TOPBAR gate failed: topbar.bgImg=$($out.topbar.bgImg)" }
  if($out.main.bgImg -ne "none"){ throw "TOPBAR gate failed: main.bgImg=$($out.main.bgImg)" }
  if($out.arrowLeft.bgImg -ne "none"){ throw "TOPBAR gate failed: arrowLeft.bgImg=$($out.arrowLeft.bgImg)" }
  if($out.arrowRight.bgImg -ne "none"){ throw "TOPBAR gate failed: arrowRight.bgImg=$($out.arrowRight.bgImg)" }

  "OK: TOPBAR no-gradient"
}finally{
  try{ $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure,'bye',$ct).Wait(1000) | Out-Null }catch{}
  try{ Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }catch{}
  try{ Remove-Item -Recurse -Force $ud -ErrorAction SilentlyContinue }catch{}
}
