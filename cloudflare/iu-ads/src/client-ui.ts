/**
 * Client portal SPA-lite (Worker-served). Access-code login; uniform errors; no secrets in markup.
 */
export const CLIENT_SHELL_HTML = `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="robots" content="noindex,nofollow"/>
  <title>InfoUzel Ads — Klientský portál</title>
  <style>
    :root{--bg:#f3f0e9;--ink:#1a221e;--muted:#5c675f;--accent:#0f6b5c;--line:#d6d0c4;--card:#fffdf9;--danger:#9b2c2c}
    *{box-sizing:border-box}
    body{margin:0;font:15px/1.45 "Segoe UI",system-ui,sans-serif;background:linear-gradient(165deg,#ebe4d8,#f7f5f1 40%,#e6f0eb);color:var(--ink);min-height:100vh}
    header{padding:1rem 1.25rem;border-bottom:1px solid var(--line);background:rgba(255,255,255,.75);display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap}
    h1{font-size:1.15rem;margin:0}
    main{max-width:820px;margin:0 auto;padding:1.25rem}
    .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:1rem 1.1rem;margin:0 0 1rem}
    .muted{color:var(--muted)}
    .err{color:var(--danger)}
    .banner{border-left:4px solid var(--danger);padding:.65rem .9rem;background:rgba(255,255,255,.65);margin:1rem 1.25rem}
    label{display:block;font-size:.85rem;margin:.55rem 0 .2rem;color:var(--muted)}
    input{width:100%;max-width:360px;padding:.55rem .65rem;border:1px solid var(--line);border-radius:8px;font:inherit}
    .row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-top:.75rem}
    button.btn,a.btn{appearance:none;border:0;background:var(--accent);color:#fff;padding:.55rem .9rem;border-radius:8px;cursor:pointer;font:inherit;text-decoration:none;display:inline-block}
    button.btn.secondary{background:#fff;color:var(--ink);border:1px solid var(--line)}
    pre.json{white-space:pre-wrap;word-break:break-word;font:12px/1.4 ui-monospace,Consolas,monospace;background:#f7f4ee;padding:.75rem;border-radius:8px;max-height:480px;overflow:auto}
    #login-view,#app-view{display:none}
    #login-view.show,#app-view.show{display:block}
    @media (max-width:640px){main{padding:1rem}}
  </style>
</head>
<body>
<header>
  <h1>InfoUzel Ads — Klientský portál</h1>
  <div id="header-actions"></div>
</header>
<div id="gate-banner" class="banner" hidden></div>
<section id="login-view">
  <main>
    <div class="card">
      <h2>Přístupový kód</h2>
      <p class="muted">Zadejte kód od administrátora. Chybové zprávy jsou jednotné.</p>
      <form id="login-form">
        <label for="access_code">Přístupový kód</label>
        <input id="access_code" name="access_code" type="password" autocomplete="one-time-code" required/>
        <div class="row"><button class="btn" type="submit">Přihlásit</button></div>
        <p id="login-err" class="err" hidden></p>
      </form>
    </div>
  </main>
</section>
<section id="app-view">
  <main id="panel"></main>
</section>
<script>
(function(){
  "use strict";
  var state={health:null,me:null};
  function el(id){return document.getElementById(id);}
  function esc(s){
    return String(s==null?"":s).replace(/[&<>"']/g,function(c){
      return ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"})[c];
    });
  }
  function apiError(body){
    if(!body||typeof body!=="object") return "Požadavek se nezdařil.";
    var e=body.error;
    if(e==="client_api_disabled") return "Klientské API je vypnuté.";
    if(e==="auth_not_configured") return "Auth není nakonfigurována.";
    if(e==="invalid_credentials"||e==="unauthorized") return "Neplatné přihlašovací údaje.";
    if(e==="locked_out") return "Dočasně uzamčeno. Zkuste později.";
    return "Požadavek se nezdařil.";
  }
  async function api(path, opts){
    opts=opts||{};
    var res=await fetch(path,Object.assign({credentials:"include",headers:{"Content-Type":"application/json"}},opts));
    var body=null;
    try{body=await res.json();}catch(_){body=null;}
    return {res:res,body:body};
  }
  function showGate(h){
    var b=el("gate-banner");
    if(h && h.clientApiEnabled===false){
      b.hidden=false;
      b.textContent="Client API disabled. safeMode="+String(h.safeMode)+
        ", publicDeliveryEnabled="+String(h.publicDeliveryEnabled)+
        ", adminApiEnabled="+String(h.adminApiEnabled)+
        ", clientApiEnabled="+String(h.clientApiEnabled)+".";
    } else { b.hidden=true; }
  }
  function setLoggedIn(on){
    el("login-view").className=on?"":"show";
    el("app-view").className=on?"show":"";
    var ha=el("header-actions");
    if(on){
      ha.innerHTML='<button class="btn secondary" type="button" id="btn-logout">Odhlásit</button>';
      el("btn-logout").onclick=logout;
    } else ha.innerHTML="";
  }
  async function logout(){
    await api("/v1/client/auth/logout",{method:"POST",body:"{}"});
    state.me=null; setLoggedIn(false);
  }
  async function renderApp(){
    var panel=el("panel");
    panel.innerHTML='<p class="muted">Načítám report…</p>';
    var me=await api("/v1/client/auth/me",{method:"GET",headers:{}});
    if(!me.res.ok){ setLoggedIn(false); return; }
    state.me=me.body;
    var report=await api("/v1/client/report",{method:"GET",headers:{}});
    var reportHtml=report.res.ok
      ? '<pre class="json">'+esc(JSON.stringify(report.body,null,2))+'</pre>'
      : '<p class="err">'+esc(apiError(report.body))+'</p>';
    panel.innerHTML='<div class="card"><h2>Profil</h2><pre class="json">'+esc(JSON.stringify(me.body,null,2))+
      '</pre></div><div class="card"><h2>Report</h2>'+reportHtml+
      '<div class="row"><a class="btn secondary" href="/v1/client/report/export?format=json">Export JSON</a>'+
      '<a class="btn secondary" href="/v1/client/report/export?format=csv">Export CSV</a></div></div>';
  }
  el("login-form").addEventListener("submit",async function(ev){
    ev.preventDefault();
    var err=el("login-err"); err.hidden=true;
    var code=el("access_code").value;
    var r=await api("/v1/client/auth/login",{method:"POST",body:JSON.stringify({access_code:code})});
    el("access_code").value="";
    if(!r.res.ok){ err.textContent=apiError(r.body); err.hidden=false; return; }
    setLoggedIn(true); await renderApp();
  });
  (async function boot(){
    var h=await api("/health",{method:"GET",headers:{}});
    state.health=h.body; showGate(h.body);
    var me=await api("/v1/client/auth/me",{method:"GET",headers:{}});
    if(me.res.ok){ setLoggedIn(true); await renderApp(); }
    else setLoggedIn(false);
  })();
})();
</script>
</body>
</html>`;
