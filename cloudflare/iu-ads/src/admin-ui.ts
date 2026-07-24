/**
 * Production admin SPA-lite (Worker-served HTML+inline JS). No secrets/hardcoded credentials.
 * API remains fail-closed behind ADS_ADMIN_API_ENABLED; this shell is always GET-able.
 */
export const ADMIN_SHELL_HTML = `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="robots" content="noindex,nofollow"/>
  <title>InfoUzel Ads — Admin</title>
  <style>
    :root{--bg:#f4f1ea;--ink:#1a221e;--muted:#5c675f;--accent:#0f6b5c;--line:#d6d0c4;--card:#fffdf9;--danger:#9b2c2c;--ok:#1b6b3a}
    *{box-sizing:border-box}
    body{margin:0;font:15px/1.45 "Segoe UI",system-ui,sans-serif;background:linear-gradient(165deg,#ebe4d8,#f7f5f1 42%,#e4efe9);color:var(--ink);min-height:100vh}
    a{color:var(--accent)}
    header{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid var(--line);background:rgba(255,255,255,.72);backdrop-filter:blur(6px);position:sticky;top:0;z-index:5}
    header h1{font-size:1.15rem;margin:0;letter-spacing:-.02em}
    .layout{display:grid;grid-template-columns:220px 1fr;gap:0;min-height:calc(100vh - 64px)}
    nav{padding:1rem .75rem;border-right:1px solid var(--line);background:rgba(255,255,255,.4)}
    nav button{display:block;width:100%;text-align:left;border:0;background:transparent;padding:.55rem .7rem;border-radius:8px;cursor:pointer;color:var(--ink);font:inherit}
    nav button:hover,nav button.active{background:rgba(15,107,92,.12);color:var(--accent)}
    main{padding:1.25rem;max-width:980px}
    .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:1rem 1.1rem;margin:0 0 1rem}
    .muted{color:var(--muted)}
    .err{color:var(--danger);margin:.5rem 0}
    .ok{color:var(--ok)}
    .banner{border-left:4px solid var(--accent);padding:.65rem .9rem;background:rgba(255,255,255,.65);margin-bottom:1rem}
    .banner.warn{border-left-color:var(--danger)}
    label{display:block;font-size:.85rem;margin:.55rem 0 .2rem;color:var(--muted)}
    input,select,textarea{width:100%;max-width:420px;padding:.55rem .65rem;border:1px solid var(--line);border-radius:8px;font:inherit;background:#fff}
    .row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-top:.75rem}
    button.btn,a.btn{appearance:none;border:0;background:var(--accent);color:#fff;padding:.55rem .9rem;border-radius:8px;cursor:pointer;font:inherit;text-decoration:none;display:inline-block}
    button.btn.secondary{background:#fff;color:var(--ink);border:1px solid var(--line)}
    table{width:100%;border-collapse:collapse;font-size:.92rem}
    th,td{text-align:left;padding:.45rem .35rem;border-bottom:1px solid var(--line);vertical-align:top}
    pre.json{white-space:pre-wrap;word-break:break-word;font:12px/1.4 ui-monospace,Consolas,monospace;background:#f7f4ee;padding:.75rem;border-radius:8px;max-height:420px;overflow:auto}
    #login-view,#app-view{display:none}
    #login-view.show,#app-view.show{display:block}
    @media (max-width:860px){.layout{grid-template-columns:1fr}nav{border-right:0;border-bottom:1px solid var(--line);display:flex;flex-wrap:wrap;gap:.25rem}nav button{width:auto}}
  </style>
</head>
<body>
<header>
  <h1>InfoUzel Ads — Admin</h1>
  <div class="row" id="header-actions"></div>
</header>
<div id="gate-banner" class="banner warn" hidden></div>
<section id="login-view">
  <main>
    <div class="card">
      <h2>Přihlášení</h2>
      <p class="muted">Session cookie po úspěchu. Hesla se nelogují.</p>
      <form id="login-form">
        <label for="email">E-mail</label>
        <input id="email" name="email" type="email" autocomplete="username" required/>
        <label for="password">Heslo</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required/>
        <div class="row"><button class="btn" type="submit">Přihlásit</button></div>
        <p id="login-err" class="err" hidden></p>
      </form>
    </div>
  </main>
</section>
<section id="app-view">
  <div class="layout">
    <nav id="nav"></nav>
    <main id="panel"></main>
  </div>
</section>
<script>
(function(){
  "use strict";
  var state = { health:null, me:null, nav:[], view:"dashboard", roles:[] };
  var el = function(id){ return document.getElementById(id); };
  function esc(s){
    return String(s==null?"":s).replace(/[&<>"']/g,function(c){
      return ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"})[c];
    });
  }
  function apiError(body){
    if(!body||typeof body!=="object") return "Požadavek se nezdařil.";
    var e = body.error;
    if(e==="admin_api_disabled") return "Admin API je vypnuté.";
    if(e==="auth_not_configured") return "Auth není nakonfigurována.";
    if(e==="invalid_credentials") return "Neplatné přihlašovací údaje.";
    if(e==="unauthorized"||e==="session_expired") return "Relace vypršela.";
    if(e==="forbidden") return "Nedostatečná oprávnění.";
    if(e==="locked_out") return "Dočasně uzamčeno. Zkuste později.";
    return "Požadavek se nezdařil.";
  }
  async function api(path, opts){
    opts = opts || {};
    var res = await fetch(path, Object.assign({ credentials:"include", headers:{"Content-Type":"application/json"} }, opts));
    var body = null;
    try { body = await res.json(); } catch(_){ body = null; }
    return { res:res, body:body };
  }
  function showGate(h){
    var b = el("gate-banner");
    if(!h){ b.hidden=true; return; }
    if(h.adminApiEnabled===false){
      b.hidden=false;
      b.className="banner warn";
      b.innerHTML="Admin API disabled. Health: safeMode="+esc(h.safeMode)+
        ", publicDeliveryEnabled="+esc(h.publicDeliveryEnabled)+
        ", adminApiEnabled="+esc(h.adminApiEnabled)+
        ", clientApiEnabled="+esc(h.clientApiEnabled)+
        ", schemaVersion="+esc(h.schemaVersion)+
        ", r2.backupsBound="+esc(h.r2&&h.r2.backupsBound)+
        ". Shell is viewable; live API calls remain gated.";
    } else {
      b.hidden=true;
    }
  }
  function setLoggedIn(on){
    el("login-view").className = on ? "" : "show";
    el("app-view").className = on ? "show" : "";
    var ha = el("header-actions");
    if(on){
      ha.innerHTML='<span class="muted">'+esc(state.me&&state.me.email||"")+'</span> <button class="btn secondary" type="button" id="btn-logout">Odhlásit</button>';
      el("btn-logout").onclick=logout;
    } else {
      ha.innerHTML="";
    }
  }
  async function loadHealth(){
    var r = await api("/health", { method:"GET", headers:{} });
    state.health = r.body;
    showGate(r.body);
  }
  async function bootstrap(){
    await loadHealth();
    var me = await api("/v1/admin/auth/me", { method:"GET", headers:{} });
    if(me.res.ok && me.body && me.body.user){
      state.me = me.body.user;
      await loadNav();
      setLoggedIn(true);
      render();
    } else {
      setLoggedIn(false);
    }
  }
  async function loadNav(){
    var r = await api("/v1/admin/nav", { method:"GET", headers:{} });
    if(r.res.ok && r.body){
      state.nav = r.body.nav || [];
      state.roles = r.body.roles || [];
    } else {
      state.nav = [
        {id:"dashboard",label_cs:"Dashboard"},
        {id:"search",label_cs:"Vyhledávání"},
        {id:"calendar",label_cs:"Kalendář"},
        {id:"alerts",label_cs:"Upozornění"},
        {id:"campaigns",label_cs:"Kampaně"},
        {id:"clients",label_cs:"Klienti"},
        {id:"stats",label_cs:"Statistiky"},
        {id:"backups",label_cs:"Zálohy"}
      ];
    }
    var nav = el("nav");
    nav.innerHTML = state.nav.map(function(item){
      return '<button type="button" data-id="'+esc(item.id)+'" class="'+(state.view===item.id?"active":"")+'">'+esc(item.label_cs)+'</button>';
    }).join("");
    nav.onclick=function(ev){
      var t=ev.target;
      if(t && t.getAttribute && t.getAttribute("data-id")){
        state.view=t.getAttribute("data-id");
        Array.prototype.forEach.call(nav.querySelectorAll("button"),function(b){ b.className=b.getAttribute("data-id")===state.view?"active":""; });
        render();
      }
    };
  }
  async function logout(){
    await api("/v1/admin/auth/logout", { method:"POST", body:"{}" });
    state.me=null; state.nav=[]; setLoggedIn(false);
  }
  el("login-form").addEventListener("submit", async function(ev){
    ev.preventDefault();
    var err=el("login-err"); err.hidden=true;
    var email=el("email").value.trim();
    var password=el("password").value;
    var r=await api("/v1/admin/auth/login",{method:"POST",body:JSON.stringify({email:email,password:password})});
    el("password").value="";
    if(!r.res.ok){ err.textContent=apiError(r.body); err.hidden=false; return; }
    var me=await api("/v1/admin/auth/me",{method:"GET",headers:{}});
    state.me=me.body&&me.body.user||{email:email};
    await loadNav(); setLoggedIn(true); render();
  });
  function panel(html){ el("panel").innerHTML=html; }
  function listTable(rows, cols){
    if(!rows||!rows.length) return '<p class="muted">Žádné záznamy.</p>';
    var head=cols.map(function(c){return "<th>"+esc(c[1])+"</th>";}).join("");
    var body=rows.map(function(row){
      return "<tr>"+cols.map(function(c){return "<td>"+esc(row[c[0]])+"</td>";}).join("")+"</tr>";
    }).join("");
    return "<table><thead><tr>"+head+"</tr></thead><tbody>"+body+"</tbody></table>";
  }
  async function render(){
    var v=state.view;
    panel('<p class="muted">Načítám…</p>');
    try{
      if(v==="dashboard"){
        var d=await api("/v1/admin/dashboard",{method:"GET",headers:{}});
        if(!d.res.ok){ panel('<p class="err">'+esc(apiError(d.body))+'</p>'); return; }
        panel('<div class="card"><h2>Dashboard</h2><pre class="json">'+esc(JSON.stringify(d.body&&d.body.widgets||d.body,null,2))+'</pre></div>');
      } else if(v==="search"){
        panel('<div class="card"><h2>Vyhledávání</h2><label>Dotaz</label><input id="q" /><div class="row"><button class="btn" type="button" id="go-q">Hledat</button></div><div id="q-out"></div></div>');
        el("go-q").onclick=async function(){
          var q=el("q").value.trim();
          var r=await api("/v1/admin/search?q="+encodeURIComponent(q),{method:"GET",headers:{}});
          el("q-out").innerHTML = r.res.ok ? '<pre class="json">'+esc(JSON.stringify(r.body,null,2))+'</pre>' : '<p class="err">'+esc(apiError(r.body))+'</p>';
        };
      } else if(v==="calendar"){
        var now=new Date(); var to=new Date(now.getTime()+30*864e5);
        var cal=await api("/v1/admin/calendar?from="+encodeURIComponent(now.toISOString())+"&to="+encodeURIComponent(to.toISOString()),{method:"GET",headers:{}});
        if(!cal.res.ok){ panel('<p class="err">'+esc(apiError(cal.body))+'</p>'); return; }
        panel('<div class="card"><h2>Kalendář (30 dní)</h2><pre class="json">'+esc(JSON.stringify(cal.body,null,2))+'</pre></div>');
      } else if(v==="alerts"){
        var al=await api("/v1/admin/alerts",{method:"GET",headers:{}});
        if(!al.res.ok){ panel('<p class="err">'+esc(apiError(al.body))+'</p>'); return; }
        var items=(al.body&&al.body.alerts)||al.body&&al.body.items||[];
        var html='<div class="card"><h2>Upozornění</h2>'+listTable(items,[["alert_id","ID"],["type","Typ"],["severity","Závažnost"],["status","Stav"],["created_at","Vytvořeno"]])+'<div id="alert-actions" class="row"></div></div>';
        panel(html);
        var box=el("alert-actions");
        items.filter(function(a){return a.status==="open"||a.status==="new";}).slice(0,5).forEach(function(a){
          var b=document.createElement("button"); b.className="btn secondary"; b.type="button"; b.textContent="Ack "+a.alert_id;
          b.onclick=async function(){ await api("/v1/admin/alerts/"+encodeURIComponent(a.alert_id)+"/ack",{method:"POST",body:"{}"}); render(); };
          box.appendChild(b);
        });
      } else if(v==="campaigns"){
        var c=await api("/v1/admin/campaigns",{method:"GET",headers:{}});
        if(!c.res.ok){ panel('<p class="err">'+esc(apiError(c.body))+'</p>'); return; }
        var camps=(c.body&&c.body.campaigns)||[];
        panel('<div class="card"><h2>Kampaně</h2>'+listTable(camps,[["campaign_id","ID"],["title","Název"],["status","Stav"],["client_id","Klient"]])+
          '</div><div class="card"><h3>Nová kampaň (stub)</h3><label>client_id</label><input id="c-client"/><label>title</label><input id="c-title"/><div class="row"><button class="btn" type="button" id="c-create">Vytvořit draft</button></div><p id="c-err" class="err" hidden></p></div>');
        el("c-create").onclick=async function(){
          var r=await api("/v1/admin/campaigns",{method:"POST",body:JSON.stringify({client_id:el("c-client").value.trim(),title:el("c-title").value.trim()})});
          if(!r.res.ok){ el("c-err").textContent=apiError(r.body); el("c-err").hidden=false; return; }
          render();
        };
      } else if(v==="clients"){
        var cl=await api("/v1/admin/clients",{method:"GET",headers:{}});
        if(!cl.res.ok){ panel('<p class="err">'+esc(apiError(cl.body))+'</p>'); return; }
        var clients=(cl.body&&cl.body.clients)||[];
        panel('<div class="card"><h2>Klienti</h2>'+listTable(clients,[["client_id","ID"],["company_name","Firma"],["ico","IČO"]])+
          '</div><div class="card"><h3>Nový klient</h3><label>company_name</label><input id="cl-name"/><div class="row"><button class="btn" type="button" id="cl-create">Vytvořit</button></div><p id="cl-err" class="err" hidden></p></div>');
        el("cl-create").onclick=async function(){
          var r=await api("/v1/admin/clients",{method:"POST",body:JSON.stringify({company_name:el("cl-name").value.trim()})});
          if(!r.res.ok){ el("cl-err").textContent=apiError(r.body); el("cl-err").hidden=false; return; }
          render();
        };
      } else if(v==="stats"){
        var st=await api("/v1/admin/stats/summary",{method:"GET",headers:{}});
        if(!st.res.ok){ panel('<p class="err">'+esc(apiError(st.body))+'</p>'); return; }
        panel('<div class="card"><h2>Statistiky</h2><pre class="json">'+esc(JSON.stringify(st.body,null,2))+'</pre></div>');
      } else if(v==="backups"){
        var bu=await api("/v1/admin/backups",{method:"GET",headers:{}});
        if(!bu.res.ok){ panel('<p class="err">'+esc(apiError(bu.body))+'</p>'); return; }
        var backs=(bu.body&&bu.body.backups)||[];
        panel('<div class="card"><h2>Zálohy</h2><p class="muted">main_admin only. Create / drill.</p>'+
          listTable(backs,[["backup_id","ID"],["status","Stav"],["content_hash","Hash"],["created_at","Vytvořeno"]])+
          '<div class="row"><button class="btn" type="button" id="bu-create">Vytvořit manifest</button></div><div id="bu-extra" class="row"></div></div>');
        el("bu-create").onclick=async function(){ await api("/v1/admin/backups",{method:"POST",body:"{}"}); render(); };
        var extra=el("bu-extra");
        backs.slice(0,5).forEach(function(b){
          var btn=document.createElement("button"); btn.className="btn secondary"; btn.type="button"; btn.textContent="Drill "+b.backup_id;
          btn.onclick=async function(){ await api("/v1/admin/backups/"+encodeURIComponent(b.backup_id)+"/drill",{method:"POST",body:"{}"}); render(); };
          extra.appendChild(btn);
        });
      } else {
        var entry=state.nav.find(function(n){return n.id===v;});
        var href=entry&&entry.href||("/v1/admin/"+v);
        var raw=await api(href,{method:"GET",headers:{}});
        if(!raw.res.ok){ panel('<p class="err">'+esc(apiError(raw.body))+'</p>'); return; }
        panel('<div class="card"><h2>'+esc(entry&&entry.label_cs||v)+'</h2><pre class="json">'+esc(JSON.stringify(raw.body,null,2))+'</pre></div>');
      }
    }catch(e){
      panel('<p class="err">Síťová chyba.</p>');
    }
  }
  bootstrap();
})();
</script>
</body>
</html>`;
