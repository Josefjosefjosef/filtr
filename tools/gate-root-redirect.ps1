$ErrorActionPreference='Stop'

$port=9222
$cb=[int][double]::Parse((Get-Date -UFormat %s))
$url="https://infouzel.cz/?nosw=1&cb=$cb"
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
      if($t.type -eq 'page' -and $t.url -like "*infouzel.cz/*"){ return $t.webSocketDebuggerUrl }
    }
    return $null
  }

  $wsUrl=$null
  for($i=0;$i -lt 80 -and -not $wsUrl;$i++){
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
      try{ $o=$sb.ToString() | ConvertFrom-Json; if($o.id -eq $id){ return $o } }catch{}
    }
    throw "timeout waiting id=$id"
  }
  function Eval($id,$expr){
    Send $id 'Runtime.evaluate' @{expression=$expr;returnByValue=$true;awaitPromise=$true}
    (Recv $id).result.result.value
  }

  Start-Sleep -Milliseconds 2500

  $expr=@'
(async () => {
  await new Promise(r => setTimeout(r, 800));
  const href = String(location.href || "");
  const txt = (document.body && document.body.innerText) ? document.body.innerText : "";
  return { href, bodyTextLen: txt.trim().length };
})();
'@

  $out = Eval 1 $expr
  $out | ConvertTo-Json -Compress

  if($out.href -notmatch '/projects/'){
    throw "ROOT redirect gate failed: href=$($out.href)"
  }

  "OK: root redirect target=/projects/"
}finally{
  try{ $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure,'bye',$ct).Wait(1000) | Out-Null }catch{}
  try{ Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }catch{}
  try{ Remove-Item -Recurse -Force $ud -ErrorAction SilentlyContinue }catch{}
}
