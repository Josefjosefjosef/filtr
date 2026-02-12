$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-RepoRoot {
  try {
    $root = (& git rev-parse --show-toplevel 2>$null)
    if ($LASTEXITCODE -eq 0 -and $root) { return $root.Trim() }
  } catch {}
  return (Get-Location).Path
}

function Get-FreeTcpPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  $listener.Stop()
  return $port
}

function New-CdpWebSocket {
  param(
    [Parameter(Mandatory = $true)][string]$Url
  )

  $ws = [System.Net.WebSockets.ClientWebSocket]::new()
  $ws.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(10)
  $null = $ws.ConnectAsync([Uri]$Url, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
  return $ws
}

function Receive-CdpMessage {
  param(
    [Parameter(Mandatory = $true)][System.Net.WebSockets.ClientWebSocket]$WebSocket
  )

  $ms = [System.IO.MemoryStream]::new()
  try {
    while ($true) {
      $buffer = [byte[]]::new(8192)
      $seg = [System.ArraySegment[byte]]::new($buffer)
      $res = $WebSocket.ReceiveAsync($seg, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
      if ($res.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
        throw "WebSocket closed by peer"
      }
      if ($res.Count -gt 0) { $ms.Write($buffer, 0, $res.Count) }
      if ($res.EndOfMessage) { break }
    }
    $ms.Position = 0
    $sr = [System.IO.StreamReader]::new($ms, [Text.Encoding]::UTF8)
    return $sr.ReadToEnd()
  } finally {
    $ms.Dispose()
  }
}

function Send-CdpCommand {
  param(
    [Parameter(Mandatory = $true)][System.Net.WebSockets.ClientWebSocket]$WebSocket,
    [Parameter(Mandatory = $true)][int]$Id,
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter()][hashtable]$Params,
    [Parameter()][string]$SessionId,
    [Parameter()][int]$TimeoutMs = 15000
  )

  $msg = @{
    id     = $Id
    method = $Method
  }
  if ($Params) { $msg.params = $Params }
  if ($SessionId) { $msg.sessionId = $SessionId }

  $json = ($msg | ConvertTo-Json -Depth 50 -Compress)
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $seg = [System.ArraySegment[byte]]::new($bytes)
  $null = $WebSocket.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while ($sw.ElapsedMilliseconds -lt $TimeoutMs) {
    $raw = Receive-CdpMessage -WebSocket $WebSocket
    $obj = $raw | ConvertFrom-Json -ErrorAction Stop
    $propId = $obj.PSObject.Properties['id']
    if ($null -ne $propId -and $null -ne $propId.Value -and [int]$propId.Value -eq $Id) {
      $propErr = $obj.PSObject.Properties['error']
      if ($null -ne $propErr -and $null -ne $propErr.Value) {
        throw ("CDP error for " + $Method + ": " + ($propErr.Value | ConvertTo-Json -Depth 50))
      }
      $propRes = $obj.PSObject.Properties['result']
      return $(if ($null -ne $propRes) { $propRes.Value } else { $null })
    }
    # ignore events / other responses
  }
  throw ("Timeout waiting for CDP response id=" + $Id + " method=" + $Method)
}

$repoRoot = Get-RepoRoot
Set-Location $repoRoot

$tmpDir = Join-Path $repoRoot "tmp"
New-Item -ItemType Directory -Force $tmpDir | Out-Null
$outPath = Join-Path $tmpDir "cls_prod_dump.json"

$url = "https://infouzel.cz/projects/"

# Prefer Edge (present on Windows) – Chrome is optional.
$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edgePath)) {
  throw "msedge.exe not found at expected path: $edgePath"
}

$port = Get-FreeTcpPort
$profileDir = Join-Path $tmpDir ("cdp-edge-profile-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $profileDir | Out-Null

$edgeArgs = @(
  "--headless=new"
  "--disable-gpu"
  "--no-first-run"
  "--no-default-browser-check"
  "--window-size=1365,768"
  "--remote-debugging-port=$port"
  "--user-data-dir=$profileDir"
  "about:blank"
)

Write-Host ("Launching headless Edge on port " + $port + " ...")
$proc = Start-Process -FilePath $edgePath -ArgumentList $edgeArgs -PassThru -WindowStyle Hidden

try {
  $versionUrl = "http://127.0.0.1:$port/json/version"
  $deadline = (Get-Date).AddSeconds(15)
  $version = $null
  while ((Get-Date) -lt $deadline) {
    try {
      $version = Invoke-RestMethod -Uri $versionUrl -TimeoutSec 2
      if ($version -and $version.webSocketDebuggerUrl) { break }
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $version -or -not $version.webSocketDebuggerUrl) {
    throw "CDP endpoint not ready: $versionUrl"
  }

  $ws = New-CdpWebSocket -Url $version.webSocketDebuggerUrl
  try {
    $id = 1
    $create = Send-CdpCommand -WebSocket $ws -Id $id -Method "Target.createTarget" -Params @{ url = $url }
    $id++
    $targetId = $create.targetId
    if (-not $targetId) { throw "Target.createTarget returned no targetId" }

    $attach = Send-CdpCommand -WebSocket $ws -Id $id -Method "Target.attachToTarget" -Params @{ targetId = $targetId; flatten = $true }
    $id++
    $sessionId = $attach.sessionId
    if (-not $sessionId) { throw "Target.attachToTarget returned no sessionId" }

    # Enable domains (best effort – not strictly required for Runtime.evaluate)
    Send-CdpCommand -WebSocket $ws -Id $id -Method "Runtime.enable" -SessionId $sessionId | Out-Null
    $id++
    Send-CdpCommand -WebSocket $ws -Id $id -Method "Page.enable" -SessionId $sessionId | Out-Null
    $id++

    # Give the page a moment to paint before we install the observer (buffered:true will catch early shifts).
    Start-Sleep -Milliseconds 500

    $snifferJs = @'
(() => new Promise((resolve) => {
  const out = {
    ts: new Date().toISOString(),
    href: location.href,
    context: {
      vw: innerWidth,
      vh: innerHeight,
      dpr: devicePixelRatio,
      ua: navigator.userAgent
    },
    realTotal: 0,
    topShifts: [],
    realTopShifts: [],
    counts: { entriesTotal: 0, entriesKept: 0, withSources: 0, withoutSources: 0 },
    observerInstalled: false
  };

  const selOf = (el) => {
    if (!el || !el.tagName) return String(el);
    if (el.id) return `#${el.id}`;
    const cls = (el.className && typeof el.className === "string")
      ? el.className.trim().split(/\\s+/).slice(0, 2).map(c => "." + c).join("")
      : "";
    return (el.tagName.toLowerCase() + cls) || el.tagName.toLowerCase();
  };

  const rec = (entry) => {
    const sources = (entry.sources || []).map(s => ({
      node: s.node ? (s.node.tagName ? s.node.tagName.toLowerCase() : String(s.node)) : String(s.node),
      selector: s.node ? selOf(s.node) : undefined,
      previousRect: s.previousRect ? {
        x: s.previousRect.x, y: s.previousRect.y,
        width: s.previousRect.width, height: s.previousRect.height,
        top: s.previousRect.top, left: s.previousRect.left,
        bottom: s.previousRect.bottom, right: s.previousRect.right
      } : undefined,
      currentRect: s.currentRect ? {
        x: s.currentRect.x, y: s.currentRect.y,
        width: s.currentRect.width, height: s.currentRect.height,
        top: s.currentRect.top, left: s.currentRect.left,
        bottom: s.currentRect.bottom, right: s.currentRect.right
      } : undefined,
      deltaX: (s.previousRect && s.currentRect) ? (s.currentRect.x - s.previousRect.x) : undefined,
      deltaY: (s.previousRect && s.currentRect) ? (s.currentRect.y - s.previousRect.y) : undefined
    }));

    const item = {
      t: new Date().toISOString(),
      value: entry.value,
      hadRecentInput: entry.hadRecentInput,
      startTime: entry.startTime,
      sourceCount: sources.length,
      sources
    };

    out.topShifts.push({
      value: item.value,
      t: item.t,
      startTime: item.startTime,
      hadRecentInput: item.hadRecentInput,
      sources: item.sources.map(s => ({
        node: s.node,
        selector: s.selector,
        previousRect: s.previousRect,
        currentRect: s.currentRect,
        deltaX: s.deltaX,
        deltaY: s.deltaY
      }))
    });

    if (!item.hadRecentInput) {
      out.realTopShifts.push({
        value: item.value,
        t: item.t,
        startTime: item.startTime,
        sources: item.sources.map(s => ({
          node: s.node,
          selector: s.selector,
          previousRect: s.previousRect,
          currentRect: s.currentRect,
          deltaX: s.deltaX,
          deltaY: s.deltaY
        }))
      });
      out.realTotal += item.value;
    }
  };

  try {
    const obs = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      out.counts.entriesTotal += entries.length;
      for (const e of entries) {
        if (!e || e.entryType !== "layout-shift") continue;
        out.counts.entriesKept += 1;
        out.counts.withSources += (e.sources && e.sources.length) ? 1 : 0;
        out.counts.withoutSources += (!e.sources || !e.sources.length) ? 1 : 0;
        rec(e);
      }
    });
    obs.observe({ type: "layout-shift", buffered: true });
    out.observerInstalled = true;
  } catch (e) {
    out.observerInstalled = false;
    out.note = String(e && e.message ? e.message : e);
  }

  setTimeout(() => resolve(JSON.stringify(out)), 6000);
}))()
'@

    $eval = Send-CdpCommand -WebSocket $ws -Id $id -Method "Runtime.evaluate" -SessionId $sessionId -Params @{
      expression    = $snifferJs
      awaitPromise  = $true
      returnByValue = $true
    } -TimeoutMs 20000
    $id++

    if (-not $eval -or -not $eval.result -or -not $eval.result.value) {
      throw ("Runtime.evaluate returned no value: " + ($eval | ConvertTo-Json -Depth 50))
    }

    $jsonText = [string]$eval.result.value
    $obj = $jsonText | ConvertFrom-Json -ErrorAction Stop

    # Persist JSON (normalized formatting)
    ($obj | ConvertTo-Json -Depth 50) | Set-Content -Encoding UTF8 -Path $outPath

    # Gate evaluation: forbidden selectors anywhere in realTopShifts sources.
    $tokens = @("iuDailyWeather", "iu-mmQuickLinks", "iu-rightContent", "iuWxNowMeta")
    $selectors = @()
    foreach ($shift in ($obj.realTopShifts | ForEach-Object { $_ })) {
      foreach ($src in ($shift.sources | ForEach-Object { $_ })) {
        if ($src.selector) { $selectors += [string]$src.selector }
      }
    }

    $hits = @()
    foreach ($s in ($selectors | Select-Object -Unique)) {
      foreach ($t in $tokens) {
        if ($s -like "*$t*") { $hits += $s; break }
      }
    }
    $hits = @($hits | Select-Object -Unique)

    Write-Host ("Wrote " + $outPath)
    if ($hits.Count -gt 0) {
      Write-Host "GATE: FAIL"
      Write-Host ("hits: " + ($hits -join ", "))
      exit 2
    } else {
      Write-Host "GATE: SPLNĚN"
      exit 0
    }
  } finally {
    try { $ws.Dispose() } catch {}
  }
} finally {
  try {
    if ($proc -and -not $proc.HasExited) {
      $proc.Kill()
      $proc.WaitForExit(5000) | Out-Null
    }
  } catch {}
}

