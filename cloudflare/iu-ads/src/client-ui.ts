/**
 * Client portal SPA (Worker-served). Access-code login; uniform errors; no secrets in markup.
 * Public delivery remains independent — this shell only talks to /v1/client/* (gated by ADS_CLIENT_API_ENABLED).
 */
export const CLIENT_SHELL_HTML = `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="robots" content="noindex,nofollow"/>
  <title>InfoUzel Ads — Klientský portál</title>
  <style>
    :root{--bg:#f3f0e9;--ink:#1a221e;--muted:#5c675f;--accent:#0f6b5c;--line:#d6d0c4;--card:#fffdf9;--danger:#9b2c2c;--ok:#1b6b3a}
    *{box-sizing:border-box}
    body{margin:0;font:15px/1.45 "Segoe UI",system-ui,sans-serif;background:linear-gradient(165deg,#ebe4d8,#f7f5f1 40%,#e6f0eb);color:var(--ink);min-height:100vh}
    header{padding:1rem 1.25rem;border-bottom:1px solid var(--line);background:rgba(255,255,255,.75);display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;position:sticky;top:0;z-index:5}
    h1{font-size:1.15rem;margin:0}
    main{max-width:960px;margin:0 auto;padding:1.25rem}
    .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:1rem 1.1rem;margin:0 0 1rem}
    .muted{color:var(--muted)} .err{color:var(--danger)} .ok{color:var(--ok)}
    .banner{border-left:4px solid var(--danger);padding:.65rem .9rem;background:rgba(255,255,255,.65);margin:1rem 1.25rem}
    .banner.ok{border-left-color:var(--ok)}
    label{display:block;font-size:.85rem;margin:.55rem 0 .2rem;color:var(--muted)}
    input,select{width:100%;max-width:360px;padding:.55rem .65rem;border:1px solid var(--line);border-radius:8px;font:inherit}
    .row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-top:.75rem}
    button.btn,a.btn{appearance:none;border:0;background:var(--accent);color:#fff;padding:.55rem .9rem;border-radius:8px;cursor:pointer;font:inherit;text-decoration:none;display:inline-block}
    button.btn.secondary{background:#fff;color:var(--ink);border:1px solid var(--line)}
    .tabs{display:flex;flex-wrap:wrap;gap:.35rem;margin:0 0 1rem}
    .tabs button{border:1px solid var(--line);background:#fff;border-radius:8px;padding:.45rem .7rem;cursor:pointer;font:inherit}
    .tabs button.active{background:rgba(15,107,92,.12);border-color:var(--accent);color:var(--accent)}
    .table-wrap{overflow:auto}
    table{width:100%;border-collapse:collapse;font-size:.92rem}
    th,td{text-align:left;padding:.45rem .35rem;border-bottom:1px solid var(--line);vertical-align:top}
    .widgets{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:.65rem}
    .widget{border:1px solid var(--line);border-radius:10px;padding:.65rem;background:#fff}
    .widget-k{font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
    .widget-v{font-size:1.05rem;margin-top:.2rem;word-break:break-word}
    pre.json{white-space:pre-wrap;word-break:break-word;font:12px/1.4 ui-monospace,Consolas,monospace;background:#f7f4ee;padding:.75rem;border-radius:8px;max-height:360px;overflow:auto}
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
      <p class="muted">Zadejte kód od administrátora. Chybové zprávy jsou jednotné (bez enumerace).</p>
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
  <main>
    <div class="tabs" id="tabs" role="tablist"></div>
    <div id="panel"></div>
  </main>
</section>
<script>
(function(){
  "use strict";
  var state={health:null,me:null,report:null,view:"overview",flash:null};
  function el(id){return document.getElementById(id);}
  function esc(s){
    return String(s==null?"":s).replace(/[&<>"']/g,function(c){
      return ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c];
    });
  }
  function apiError(body){
    if(!body||typeof body!=="object") return "Požadavek se nezdařil.";
    var e=body.error;
    if(e==="client_api_disabled") return "Klientské API je vypnuté.";
    if(e==="auth_not_configured") return "Auth není nakonfigurována.";
    if(e==="invalid_credentials"||e==="unauthorized") return "Neplatné přihlašovací údaje.";
    if(e==="locked_out") return "Dočasně uzamčeno. Zkuste později.";
    if(e==="forbidden_campaign") return "Kampaň mimo scope kódu.";
    if(e==="pdf_export_deferred") return "PDF export zatím není k dispozici.";
    return e ? ("Chyba: "+e) : "Požadavek se nezdařil.";
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
      b.className="banner";
      b.textContent="Client API disabled (fail-closed). safeMode="+String(h.safeMode)+
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
  function listTable(rows, cols){
    if(!rows||!rows.length) return '<p class="muted">Žádné záznamy ve scope.</p>';
    var head=cols.map(function(c){return "<th>"+esc(c[1])+"</th>";}).join("");
    var body=rows.map(function(row){
      return "<tr>"+cols.map(function(c){return "<td>"+esc(row[c[0]])+"</td>";}).join("")+"</tr>";
    }).join("");
    return '<div class="table-wrap"><table><thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody></table></div>';
  }
  function totalsWidgets(totals){
    if(!totals||typeof totals!=="object") return "";
    return '<div class="widgets">'+Object.keys(totals).map(function(k){
      return '<div class="widget"><div class="widget-k">'+esc(k)+'</div><div class="widget-v">'+esc(totals[k])+'</div></div>';
    }).join("")+'</div>';
  }
  async function logout(){
    await api("/v1/client/auth/logout",{method:"POST",body:"{}"});
    state.me=null; state.report=null; setLoggedIn(false);
  }
  function renderTabs(){
    var items=[["overview","Přehled"],["campaigns","Kampaně"],["creatives","Kreativy"],["documents","Dokumenty"],["stats","Statistiky"],["export","Export"]];
    el("tabs").innerHTML=items.map(function(it){
      return '<button type="button" data-v="'+it[0]+'" class="'+(state.view===it[0]?"active":"")+'">'+esc(it[1])+'</button>';
    }).join("");
    el("tabs").onclick=function(ev){
      var t=ev.target;
      if(t&&t.getAttribute&&t.getAttribute("data-v")){
        state.view=t.getAttribute("data-v");
        renderTabs();
        renderPanel();
      }
    };
  }
  async function loadReport(){
    var q="";
    var camp=el("f-camp")&&el("f-camp").value;
    var from=el("f-from")&&el("f-from").value;
    var to=el("f-to")&&el("f-to").value;
    var params=[];
    if(camp&&camp.trim()) params.push("campaign_id="+encodeURIComponent(camp.trim()));
    if(from&&from.trim()) params.push("from="+encodeURIComponent(from.trim()));
    if(to&&to.trim()) params.push("to="+encodeURIComponent(to.trim()));
    if(params.length) q="?"+params.join("&");
    var report=await api("/v1/client/report"+q,{method:"GET",headers:{}});
    if(!report.res.ok){
      state.report=null;
      return {ok:false,error:apiError(report.body)};
    }
    state.report=report.body&&report.body.report;
    return {ok:true};
  }
  function filterBar(rep){
    var camps=(rep&&rep.campaigns)||[];
    var opts='<option value="">— všechny kampaně ve scope —</option>'+camps.map(function(c){
      return '<option value="'+esc(c.campaign_id)+'">'+esc(c.title||c.campaign_id)+'</option>';
    }).join("");
    return '<div class="card"><h3>Filtry reportu</h3><div class="row">'+
      '<label>Kampaň<select id="f-camp">'+opts+'</select></label>'+
      '<label>Od<input id="f-from" type="text" placeholder="ISO from"/></label>'+
      '<label>Do<input id="f-to" type="text" placeholder="ISO to"/></label>'+
      '<button class="btn secondary" type="button" id="f-go">Obnovit</button></div></div>';
  }
  async function renderPanel(){
    var panel=el("panel");
    var flash=state.flash?'<div class="banner ok">'+esc(state.flash)+'</div>':"";
    state.flash=null;
    if(!state.report){
      panel.innerHTML=flash+'<p class="muted">Načítám report…</p>';
      var loaded=await loadReport();
      if(!loaded.ok){ panel.innerHTML=flash+'<p class="err">'+esc(loaded.error)+'</p>'; return; }
    }
    var rep=state.report;
    var v=state.view;
    if(v==="overview"){
      panel.innerHTML=flash+filterBar(rep)+
        '<div class="card"><h2>Profil</h2><p>client_id: <strong>'+esc(rep.client&&rep.client.client_id)+
        '</strong></p><p class="muted">code_id: '+esc(rep.code&&rep.code.code_id)+
        ' · generated_at: '+esc(rep.generated_at)+'</p></div>'+
        '<div class="card"><h2>Souhrn statistik</h2>'+totalsWidgets(rep.stats&&rep.stats.totals)+
        (rep.stats&&rep.stats.configured===false?'<p class="muted">Analytics reporting není nakonfigurováno (stats.configured=false).</p>':'')+
        '</div>'+
        '<div class="card"><h2>Kampaně ve scope</h2>'+listTable(rep.campaigns,[["campaign_id","ID"],["evidence_code","Evidence"],["title","Název"],["status","Stav"],["label_type","Označení"]])+'</div>';
    } else if(v==="campaigns"){
      panel.innerHTML=flash+'<div class="card"><h2>Kampaně</h2>'+listTable(rep.campaigns,[["campaign_id","ID"],["evidence_code","Evidence"],["title","Název"],["status","Stav"],["start_at","Od"],["end_at","Do"]])+
        '</div><div class="card"><h2>Umístění</h2>'+listTable(rep.placements,[["campaign_placement_id","ID"],["campaign_id","Kampaň"],["placement_id","Placement"],["device_category","Zařízení"],["status","Stav"]])+'</div>';
    } else if(v==="creatives"){
      panel.innerHTML=flash+'<div class="card"><h2>Kreativy (scope)</h2>'+listTable(rep.creatives,[["creative_id","ID"],["campaign_id","Kampaň"],["format","Formát"],["device_category","Zařízení"],["review_status","Review"],["width","W"],["height","H"]])+'</div>';
    } else if(v==="documents"){
      panel.innerHTML=flash+'<div class="card"><h2>Dokumenty (client_visible)</h2><p class="muted">Bez interních cen a bez veřejných R2 URL — jen metadata ve scope.</p>'+
        listTable(rep.documents,[["document_id","ID"],["title","Název"],["doc_type","Typ"],["visibility","Viditelnost"],["created_at","Vytvořeno"]])+'</div>';
    } else if(v==="stats"){
      panel.innerHTML=flash+filterBar(rep)+'<div class="card"><h2>Statistiky</h2>'+totalsWidgets(rep.stats&&rep.stats.totals)+
        listTable((rep.stats&&rep.stats.rows)||[],[["campaign_id","Kampaň"],["impressions","Imp"],["clicks","Kliky"],["date","Datum"]])+
        '<details><summary class="muted">Raw JSON</summary><pre class="json">'+esc(JSON.stringify(rep.stats,null,2))+'</pre></details></div>';
    } else if(v==="export"){
      var base="/v1/client/report/export";
      var qs=[];
      if(rep.filters&&rep.filters.campaign_id) qs.push("campaign_id="+encodeURIComponent(rep.filters.campaign_id));
      if(rep.filters&&rep.filters.from) qs.push("from="+encodeURIComponent(rep.filters.from));
      if(rep.filters&&rep.filters.to) qs.push("to="+encodeURIComponent(rep.filters.to));
      var q=qs.length?"&"+qs.join("&"):"";
      panel.innerHTML=flash+'<div class="card"><h2>Export</h2><p class="muted">Formáty: JSON, CSV. PDF je deferred (501).</p>'+
        '<div class="row"><a class="btn secondary" href="'+base+'?format=json'+q+'">Export JSON</a>'+
        '<a class="btn secondary" href="'+base+'?format=csv'+q+'">Export CSV</a></div>'+
        '<p class="muted">Export respektuje client_export_enabled na kampani (při filtru jedné kampaně).</p></div>';
    }
    var go=el("f-go");
    if(go){
      go.onclick=async function(){
        panel.innerHTML='<p class="muted">Obnovuji…</p>';
        state.report=null;
        var loaded=await loadReport();
        if(!loaded.ok){ panel.innerHTML='<p class="err">'+esc(loaded.error)+'</p>'; return; }
        renderPanel();
      };
    }
  }
  async function renderApp(){
    renderTabs();
    state.report=null;
    await renderPanel();
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
    if(me.res.ok){ state.me=me.body; setLoggedIn(true); await renderApp(); }
    else setLoggedIn(false);
  })();
})();
</script>
</body>
</html>`;
