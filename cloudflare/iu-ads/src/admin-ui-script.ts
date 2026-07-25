/**
 * Inline admin SPA script (served inside ADMIN_SHELL_HTML). No secrets / credentials.
 * Kept as a TS string so HTML shell stays readable.
 */
export const ADMIN_UI_SCRIPT = String.raw`
(function(){
  "use strict";
  var state = { health:null, me:null, nav:[], view:"dashboard", roles:[], flash:null };
  var el = function(id){ return document.getElementById(id); };
  function esc(s){
    return String(s==null?"":s).replace(/[&<>"']/g,function(c){
      return ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c];
    });
  }
  function apiError(body){
    if(!body||typeof body!=="object") return "Požadavek se nezdařil.";
    var e = body.error;
    var map = {
      admin_api_disabled:"Admin API je vypnuté.",
      auth_not_configured:"Auth není nakonfigurována.",
      invalid_credentials:"Neplatné přihlašovací údaje.",
      unauthorized:"Relace vypršela.",
      session_expired:"Relace vypršela.",
      forbidden:"Nedostatečná oprávnění.",
      locked_out:"Dočasně uzamčeno. Zkuste později.",
      not_found:"Záznam nenalezen.",
      invalid_transition:"Neplatný přechod stavu.",
      rights_confirmation_required:"Chybí potvrzení autorských práv.",
      reservation_collision:"Kolize rezervace.",
      evidence_code_taken:"Evidenční číslo už existuje.",
      invalid_body:"Neplatné tělo požadavku.",
      invalid_request:"Neplatný požadavek.",
      invalid_or_expired_token:"Neplatný nebo expirovaný aktivační token.",
      invalid_current_password:"Současné heslo je nesprávné.",
      invalid_display_name:"Display name je povinné.",
      client_id_required:"client_id je povinné.",
      campaign_ids_required:"campaign_ids jsou povinné.",
      client_not_found:"Klient nenalezen.",
      already_reviewed:"Kreativa už byla posouzena."
    };
    if(map[e]) return map[e];
    if(e) return "Chyba: "+e;
    return "Požadavek se nezdařil.";
  }
  async function api(path, opts){
    opts = opts || {};
    var headers = Object.assign({"Content-Type":"application/json"}, opts.headers||{});
    if(opts.rawBody) headers = opts.headers||{};
    var res = await fetch(path, Object.assign({ credentials:"include", headers:headers }, opts, opts.rawBody?{body:opts.rawBody}:{}));
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
      b.innerHTML="Admin API je vypnuté (fail-closed). safeMode="+esc(h.safeMode)+
        ", publicDelivery="+esc(h.publicDeliveryEnabled)+
        ", schema="+esc(h.schemaVersion)+
        ". Shell je dostupný; live API volání zůstávají gated. Veřejné reklamy zůstávají OFF.";
    } else { b.hidden=true; }
  }
  function setLoggedIn(on){
    el("login-view").className = on ? "" : "show";
    el("app-view").className = on ? "show" : "";
    var ha = el("header-actions");
    if(on){
      ha.innerHTML='<span class="muted">'+esc(state.me&&(state.me.email||state.me.user_id)||"")+
        '</span> <button class="btn secondary" type="button" id="btn-account">Účet</button>'+
        ' <button class="btn secondary" type="button" id="btn-logout">Odhlásit</button>'+
        ' <button class="btn secondary" type="button" id="btn-logout-all">Odhlásit všechny relace</button>';
      el("btn-logout").onclick=logout;
      el("btn-logout-all").onclick=logoutAll;
      el("btn-account").onclick=function(){ state.view="account"; renderNavActive(); render(); };
    } else ha.innerHTML="";
  }
  function renderNavActive(){
    var nav=el("nav");
    Array.prototype.forEach.call(nav.querySelectorAll("button"),function(b){
      b.className=b.getAttribute("data-id")===state.view?"active":"";
    });
  }
  async function loadHealth(){
    var r = await api("/health", { method:"GET", headers:{} });
    state.health = r.body;
    showGate(r.body);
  }
  async function loadNav(){
    var r = await api("/v1/admin/nav", { method:"GET", headers:{} });
    if(r.res.ok && r.body){
      state.nav = r.body.nav || [];
      state.roles = r.body.roles || [];
    } else {
      state.nav = [{id:"dashboard",label_cs:"Dashboard"}];
    }
    var nav = el("nav");
    nav.innerHTML = state.nav.map(function(item){
      return '<button type="button" data-id="'+esc(item.id)+'" class="'+(state.view===item.id?"active":"")+'">'+esc(item.label_cs)+'</button>';
    }).join("")+'<button type="button" data-id="account">Účet / heslo</button>';
    nav.onclick=function(ev){
      var t=ev.target;
      if(t && t.getAttribute && t.getAttribute("data-id")){
        state.view=t.getAttribute("data-id");
        renderNavActive();
        render();
      }
    };
  }
  async function bootstrap(){
    await loadHealth();
    var me = await api("/v1/admin/auth/me", { method:"GET", headers:{} });
    if(me.res.ok && me.body && me.body.user){
      state.me = me.body.user;
      await loadNav();
      setLoggedIn(true);
      render();
    } else setLoggedIn(false);
  }
  async function logout(){
    await api("/v1/admin/auth/logout", { method:"POST", body:"{}" });
    state.me=null; state.nav=[]; setLoggedIn(false);
  }
  async function logoutAll(){
    await api("/v1/admin/auth/sessions/revoke-all", { method:"POST", body:"{}" });
    state.me=null; state.nav=[]; setLoggedIn(false);
  }
  (function setupActivation(){
    try{
      var params=new URLSearchParams(window.location.search||"");
      var token=params.get("activate")||"";
      var emailHint=params.get("email")||"";
      if(!token) return;
      var card=el("activate-card");
      if(!card) return;
      card.hidden=false;
      el("activate-token").value=token;
      if(emailHint && el("email")) el("email").value=emailHint;
      if(emailHint && el("reset-email")) el("reset-email").value=emailHint;
      el("activate-form").addEventListener("submit", async function(ev){
        ev.preventDefault();
        var err=el("activate-err"); var ok=el("activate-ok");
        err.hidden=true; ok.hidden=true;
        var p1=el("activate-pass").value;
        var p2=el("activate-pass2").value;
        if(p1!==p2){ err.textContent="Hesla se neshodují."; err.hidden=false; return; }
        var r=await api("/v1/admin/auth/password-reset/confirm",{method:"POST",body:JSON.stringify({token:token,newPassword:p1})});
        el("activate-pass").value=""; el("activate-pass2").value="";
        if(!r.res.ok){ err.textContent=apiError(r.body); err.hidden=false; return; }
        ok.textContent="Heslo nastaveno. Nyní se přihlaste e-mailem a novým heslem.";
        ok.hidden=false;
        try{
          var clean=window.location.pathname;
          window.history.replaceState({}, "", clean);
        }catch(_){}
      });
    }catch(_){}
  })();
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
  el("reset-form").addEventListener("submit", async function(ev){
    ev.preventDefault();
    var msg=el("reset-msg");
    var email=el("reset-email").value.trim();
    await api("/v1/admin/auth/password-reset/request",{method:"POST",body:JSON.stringify({email:email})});
    msg.hidden=false;
    msg.textContent="Pokud účet existuje, instrukce byly zpracovány (bez enumerace).";
  });

  function panel(html){
    var flash = state.flash ? '<div class="banner ok">'+esc(state.flash)+'</div>' : '';
    state.flash=null;
    el("panel").innerHTML = flash + html;
  }
  function listTable(rows, cols, actionsHtmlFn){
    if(!rows||!rows.length) return '<p class="muted empty">Žádné záznamy.</p>';
    var head=cols.map(function(c){return "<th>"+esc(c[1])+"</th>";}).join("")+(actionsHtmlFn?"<th></th>":"");
    var body=rows.map(function(row){
      var acts = actionsHtmlFn ? "<td>"+actionsHtmlFn(row)+"</td>" : "";
      return "<tr>"+cols.map(function(c){return "<td>"+esc(row[c[0]])+"</td>";}).join("")+acts+"</tr>";
    }).join("");
    return "<div class=\"table-wrap\"><table><thead><tr>"+head+"</tr></thead><tbody>"+body+"</tbody></table></div>";
  }
  function inp(id,label,type,val,attrs){
    type=type||"text";
    attrs=attrs||"";
    return '<label for="'+id+'">'+esc(label)+'</label><input id="'+id+'" type="'+type+'" value="'+esc(val==null?"":val)+'" '+attrs+'/>';
  }
  function ta(id,label,val){
    return '<label for="'+id+'">'+esc(label)+'</label><textarea id="'+id+'" rows="3">'+esc(val==null?"":val)+'</textarea>';
  }
  function sel(id,label,options,val){
    var opts=options.map(function(o){
      var v=typeof o==="string"?o:o[0]; var t=typeof o==="string"?o:o[1];
      return '<option value="'+esc(v)+'"'+(String(val)===String(v)?" selected":"")+'>'+esc(t)+'</option>';
    }).join("");
    return '<label for="'+id+'">'+esc(label)+'</label><select id="'+id+'">'+opts+'</select>';
  }
  function val(id){ var n=el(id); return n ? n.value : ""; }
  function numOrNull(id){ var v=val(id).trim(); if(v==="") return null; var n=Number(v); return isFinite(n)?n:null; }
  function csvArr(id){ var v=val(id).trim(); if(!v) return []; return v.split(/[,;\s]+/).map(function(x){return x.trim();}).filter(Boolean); }
  function formatKc(cents){
    var n=Number(cents);
    if(!isFinite(n)) n=0;
    var kc=Math.round(n)/100;
    try{ return kc.toLocaleString("cs-CZ",{minimumFractionDigits:0,maximumFractionDigits:2})+" Kč"; }
    catch(_){ return String(kc)+" Kč"; }
  }
  function formatCsDate(iso){
    if(!iso) return "—";
    var t=new Date(iso).getTime();
    if(!isFinite(t)) return String(iso);
    try{ return new Date(t).toLocaleString("cs-CZ",{day:"numeric",month:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit"}); }
    catch(_){ return String(iso); }
  }
  function auditLabel(op){
    var map={
      main_admin_bootstrap_created:"Vytvoření hlavního administrátora",
      password_reset_confirmed:"Potvrzení resetu/aktivace hesla",
      login_success:"Úspěšné přihlášení",
      login_failed:"Neúspěšné přihlášení",
      logout:"Odhlášení",
      logout_all_sessions:"Odhlášení všech relací",
      password_changed:"Změna hesla",
      user_created:"Vytvoření uživatele",
      user_updated:"Úprava uživatele",
      roles_set:"Nastavení rolí",
      campaign_created:"Vytvoření kampaně",
      campaign_updated:"Úprava kampaně",
      client_code_issued:"Vydání klientského kódu",
      client_code_revoked:"Deaktivace klientského kódu",
      backup_created:"Vytvoření zálohy",
      export_created:"Vytvoření exportu"
    };
    return map[op]||op||"—";
  }
  function widgetsHtml(w){
    if(!w||typeof w!=="object") return '<p class="muted empty">Žádné záznamy</p>';
    var cards=[];
    function push(label,value){ cards.push('<div class="widget"><div class="widget-k">'+esc(label)+'</div><div class="widget-v">'+esc(value)+'</div></div>'); }
    if(w.campaigns_by_status && typeof w.campaigns_by_status==="object"){
      var active=Number(w.campaigns_by_status.active||w.campaigns_by_status.running||0)||0;
      var total=0; Object.keys(w.campaigns_by_status).forEach(function(k){ total+=Number(w.campaigns_by_status[k])||0; });
      push("Aktivní kampaně", String(active));
      push("Kampaně celkem", String(total));
    }
    if(typeof w.open_inquiries==="number") push("Otevřené poptávky", String(w.open_inquiries));
    if(typeof w.open_orders==="number") push("Otevřené objednávky", String(w.open_orders));
    if(w.reservations_upcoming && typeof w.reservations_upcoming==="object"){
      push("Rezervace v příštích "+String(w.reservations_upcoming.days||14)+" dnech", String(w.reservations_upcoming.count||0));
    }
    if(w.unpaid_invoices && typeof w.unpaid_invoices==="object"){
      push("Neuhrazené faktury", String(w.unpaid_invoices.count||0)+" · "+formatKc(w.unpaid_invoices.total_cents||0));
    }
    if(typeof w.open_alerts==="number") push("Otevřená upozornění", String(w.open_alerts));
    if(w.recent_audit && typeof w.recent_audit==="object"){
      push("Auditní události za "+String(w.recent_audit.hours||24)+" h", String(w.recent_audit.count||0));
    }
    if(!cards.length){
      Object.keys(w).forEach(function(k){
        var v=w[k];
        if(v!==null && typeof v==="object") return;
        push(k, String(v));
      });
    }
    if(!cards.length) return '<p class="muted empty">Žádné záznamy</p>';
    return '<div class="widgets">'+cards.join("")+'</div>';
  }
  function financeHtml(body){
    var summary=(body&&body.summary)||{};
    var currencies=Object.keys(summary);
    if(!currencies.length){
      summary={CZK:{invoiced_cents:0,paid_cents:0,outstanding_cents:0,overdue_cents:0,by_status:{}}};
      currencies=["CZK"];
    }
    return currencies.map(function(cur){
      var s=summary[cur]||{};
      var statusKeys=Object.keys(s.by_status||{});
      return '<div class="widgets">'+
        '<div class="widget"><div class="widget-k">Fakturováno ('+esc(cur)+')</div><div class="widget-v">'+esc(formatKc(s.invoiced_cents||0))+'</div></div>'+
        '<div class="widget"><div class="widget-k">Uhrazeno</div><div class="widget-v">'+esc(formatKc(s.paid_cents||0))+'</div></div>'+
        '<div class="widget"><div class="widget-k">Neuhrazeno</div><div class="widget-v">'+esc(formatKc(s.outstanding_cents||0))+'</div></div>'+
        '<div class="widget"><div class="widget-k">Po splatnosti</div><div class="widget-v">'+esc(formatKc(s.overdue_cents||0))+'</div></div>'+
        '</div>'+
        (statusKeys.length
          ? '<div class="table-wrap" style="margin-top:.75rem"><table><thead><tr><th>Stav</th><th>Počet</th><th>Částka</th></tr></thead><tbody>'+
            statusKeys.map(function(st){
              var row=s.by_status[st];
              return '<tr><td>'+esc(st)+'</td><td>'+esc(row.count)+'</td><td>'+esc(formatKc(row.total_cents))+'</td></tr>';
            }).join("")+
            '</tbody></table></div>'
          : '<p class="muted empty" style="margin-top:.75rem">Žádné faktury v zvoleném období.</p>');
    }).join("");
  }
  function statsHtml(body){
    if(!body) return '<p class="muted empty">Žádné záznamy</p>';
    if(body.configured===false){
      return '<p class="muted empty">'+esc(body.message_cs||"Analytics není napojeno — prázdný stav.")+'</p>'+
        '<div class="widgets">'+
        '<div class="widget"><div class="widget-k">Imprese</div><div class="widget-v">0</div></div>'+
        '<div class="widget"><div class="widget-k">Kliknutí</div><div class="widget-v">0</div></div>'+
        '<div class="widget"><div class="widget-k">Platná kliknutí</div><div class="widget-v">0</div></div>'+
        '<div class="widget"><div class="widget-k">CTR</div><div class="widget-v">0</div></div>'+
        '</div>';
    }
    var t=body.totals||{};
    var rows=body.rows||[];
    return '<div class="widgets">'+
      '<div class="widget"><div class="widget-k">Imprese</div><div class="widget-v">'+esc(t.impressions||0)+'</div></div>'+
      '<div class="widget"><div class="widget-k">Kliknutí</div><div class="widget-v">'+esc(t.clicks||0)+'</div></div>'+
      '<div class="widget"><div class="widget-k">Platná kliknutí</div><div class="widget-v">'+esc(t.valid_clicks||0)+'</div></div>'+
      '<div class="widget"><div class="widget-k">Podezřelá kliknutí</div><div class="widget-v">'+esc(t.suspicious_clicks||0)+'</div></div>'+
      '<div class="widget"><div class="widget-k">CTR</div><div class="widget-v">'+esc(t.ctr||0)+'</div></div>'+
      '</div>'+
      (rows.length?listTable(rows,[["campaign_id","Kampaň"],["date","Datum"],["impressions","Imp"],["clicks","Kliky"],["valid_clicks","Platné"],["device_category","Zařízení"],["section_id","Sekce"]]):
        '<p class="muted empty">Žádné záznamy pro zvolené období.</p>');
  }
  function calendarHtml(body){
    var items=(body&&body.items)||[];
    if(!items.length) return '<p class="muted empty">Žádné záznamy</p>';
    var kindLabel={campaign:"Kampaň",reservation:"Rezervace",invoice_due:"Splatnost faktury",code_expiry:"Expirace klientského kódu"};
    var rows=items.map(function(it){
      var kind=kindLabel[it.kind]||it.kind||"—";
      var title=it.title||it.placement_id||it.reservation_id||it.invoice_number||it.campaign_id||"—";
      return {
        kind:kind,
        title:title,
        ref:it.campaign_id||it.invoice_id||it.code_id||it.reservation_id||"",
        start_at:formatCsDate(it.start_at),
        end_at:formatCsDate(it.end_at),
        status:it.status||"",
        collision:it.has_collision?"Ano":""
      };
    });
    return listTable(rows,[["kind","Typ"],["title","Název"],["ref","Odkaz"],["start_at","Od"],["end_at","Do"],["status","Stav"],["collision","Kolize"]]);
  }

  async function renderAccount(){
    var u=state.me||{};
    panel('<div class="card"><h2>Účet</h2>'+
      '<p><strong>E-mail:</strong> '+esc(u.email||"—")+'</p>'+
      '<p><strong>Jméno:</strong> '+esc(u.display_name||u.displayName||"—")+'</p>'+
      '<p><strong>Role:</strong> '+esc((state.roles||[]).join(", ")||"—")+'</p>'+
      '<p><strong>Aktivní:</strong> '+esc(u.is_active===false||u.is_active===0?"ne":"ano")+'</p>'+
      '<p class="muted">Force PW: '+(u.force_password_change?"ano":"ne")+'</p>'+
      '</div><div class="card"><h3>Změna hesla</h3>'+
      inp("pw-cur","Současné heslo","password","","autocomplete=\"current-password\" required")+
      inp("pw-new","Nové heslo","password","","autocomplete=\"new-password\" required")+
      '<div class="row"><button class="btn" type="button" id="pw-go">Změnit heslo</button></div><p id="pw-err" class="err" hidden></p><p id="pw-ok" class="ok" hidden></p></div>');
    el("pw-go").onclick=async function(){
      el("pw-err").hidden=true; el("pw-ok").hidden=true;
      var r=await api("/v1/admin/auth/password/change",{method:"POST",body:JSON.stringify({
        currentPassword:val("pw-cur"), newPassword:val("pw-new")
      })});
      el("pw-cur").value=""; el("pw-new").value="";
      if(!r.res.ok){ el("pw-err").textContent=apiError(r.body); el("pw-err").hidden=false; return; }
      el("pw-ok").textContent="Heslo změněno."; el("pw-ok").hidden=false;
    };
  }

  async function renderCampaigns(){
    var c=await api("/v1/admin/campaigns",{method:"GET",headers:{}});
    if(!c.res.ok){ panel('<p class="err">'+esc(apiError(c.body))+'</p>'); return; }
    var camps=(c.body&&c.body.campaigns)||[];
    var cl=await api("/v1/admin/clients",{method:"GET",headers:{}});
    var clients=(cl.res.ok&&cl.body&&cl.body.clients)||[];
    var clientOpts=[["","— vyberte klienta —"]].concat(clients.map(function(x){return [x.client_id,(x.company_name||x.client_id)+" ("+x.client_id+")"];}));
    var labels=["Reklama","Inzerce","Sponzorováno","Placený obsah","Komerční sdělení"];
    panel('<div class="card"><h2>Kampaně</h2>'+
      listTable(camps,[["campaign_id","ID"],["evidence_code","Evidence"],["title","Název"],["status","Stav"],["client_id","Klient"]],function(row){
        return '<button type="button" class="linkish" data-open="'+esc(row.campaign_id)+'">Otevřít</button>';
      })+'</div>'+
      '<div class="card"><h3>Nová kampaň (úplný formulář)</h3><div class="grid2">'+
      sel("c-client","Klient *",clientOpts,"")+
      inp("c-title","Název kampaně *")+
      inp("c-evidence","Evidenční číslo (prázdné = auto)")+
      sel("c-label","Označení reklamy",labels,"Reklama")+
      inp("c-target","Cílová URL (https)")+
      inp("c-start","Začátek (ISO)","text","","placeholder=\"2026-08-01T00:00:00Z\"")+
      inp("c-end","Konec (ISO)")+
      inp("c-price","Cena vč. DPH (cents)","number")+
      inp("c-price-ex","Cena bez DPH (cents)","number")+
      inp("c-vat","DPH (cents)","number")+
      inp("c-pricing","Cenový model")+
      inp("c-imp","Limit impresí","number")+
      inp("c-clk","Limit kliknutí","number")+
      inp("c-budget","Rozpočet (cents)","number")+
      inp("c-devices","Zařízení (csv: pc,mobile,tablet)")+
      inp("c-sections","Sekce (csv)")+
      inp("c-regions","Regiony (csv)")+
      inp("c-order","order_id")+
      inp("c-contract","contract_id")+
      inp("c-invoice","invoice_id")+
      inp("c-ordered","Objednatel")+
      inp("c-payer","Plátce")+
      inp("c-agency","Agentura")+
      ta("c-note-int","Interní poznámka")+
      ta("c-note-cli","Poznámka pro klienta")+
      ta("c-note-pub","Veřejná poznámka")+
      '<label><input type="checkbox" id="c-report" checked/> client_report_enabled</label>'+
      '<label><input type="checkbox" id="c-export"/> client_export_enabled</label>'+
      '</div><div class="row"><button class="btn" type="button" id="c-create">Vytvořit draft</button></div>'+
      '<p id="c-err" class="err" hidden></p><p class="muted">campaign_id se generuje serverem. Stav začíná jako draft; přechody po otevření kampaně.</p></div>'+
      '<div id="c-detail"></div>');
    el("c-create").onclick=async function(){
      el("c-err").hidden=true;
      var body={
        client_id:val("c-client").trim(),
        title:val("c-title").trim(),
        label_type:val("c-label"),
        target_url:val("c-target").trim()||null,
        start_at:val("c-start").trim()||null,
        end_at:val("c-end").trim()||null,
        price_cents:numOrNull("c-price"),
        price_ex_vat_cents:numOrNull("c-price-ex"),
        vat_cents:numOrNull("c-vat"),
        pricing_model:val("c-pricing").trim()||null,
        impression_limit:numOrNull("c-imp"),
        click_limit:numOrNull("c-clk"),
        budget_limit_cents:numOrNull("c-budget"),
        devices:csvArr("c-devices"),
        sections:csvArr("c-sections"),
        regions:csvArr("c-regions"),
        order_id:val("c-order").trim()||null,
        contract_id:val("c-contract").trim()||null,
        invoice_id:val("c-invoice").trim()||null,
        ordered_by:val("c-ordered").trim()||null,
        payer:val("c-payer").trim()||null,
        agency_name:val("c-agency").trim()||null,
        note_internal:val("c-note-int")||null,
        note_client:val("c-note-cli")||null,
        note_public:val("c-note-pub")||null,
        client_report_enabled:el("c-report").checked,
        client_export_enabled:el("c-export").checked
      };
      if(val("c-evidence").trim()) body.evidence_code=val("c-evidence").trim();
      var r=await api("/v1/admin/campaigns",{method:"POST",body:JSON.stringify(body)});
      if(!r.res.ok){ el("c-err").textContent=apiError(r.body); el("c-err").hidden=false; return; }
      state.flash="Kampaň vytvořena: "+((r.body&&r.body.campaign&&r.body.campaign.campaign_id)||"");
      render();
    };
    Array.prototype.forEach.call(document.querySelectorAll("[data-open]"),function(btn){
      btn.onclick=function(){ openCampaign(btn.getAttribute("data-open")); };
    });
  }

  async function openCampaign(id){
    var box=el("c-detail");
    if(!box) return;
    box.innerHTML='<p class="muted">Načítám kampaň…</p>';
    var r=await api("/v1/admin/campaigns/"+encodeURIComponent(id),{method:"GET",headers:{}});
    if(!r.res.ok){ box.innerHTML='<p class="err">'+esc(apiError(r.body))+'</p>'; return; }
    var camp=r.body.campaign||r.body;
    var next=["awaiting_assets","awaiting_legal","awaiting_tech","awaiting_approval","approved","scheduled","active","paused","ended","cancelled","archived","draft"];
    box.innerHTML='<div class="card"><h3>Detail kampaně '+esc(id)+'</h3><pre class="json">'+esc(JSON.stringify(camp,null,2))+
      '</pre><h4>Úprava polí</h4><div class="grid2">'+
      inp("e-title","Název", "text", camp.title)+
      inp("e-target","Cílová URL","text",camp.target_url||"")+
      inp("e-start","start_at","text",camp.start_at||"")+
      inp("e-end","end_at","text",camp.end_at||"")+
      inp("e-budget","budget_limit_cents","number",camp.budget_limit_cents!=null?camp.budget_limit_cents:"")+
      '</div><p class="muted">impression_limit/click_limit se nastavují při vytvoření (PATCH je zatím neukládá).</p>'+
      '<div class="row"><button class="btn" type="button" id="e-save">Uložit</button></div>'+
      '<h4>Přechod stavu (aktuálně: '+esc(camp.status)+')</h4><div class="row" id="e-trans"></div>'+
      '<p id="e-err" class="err" hidden></p></div>';
    el("e-save").onclick=async function(){
      el("e-err").hidden=true;
      // PATCH handler persists title/target/window/budget; impression_limit/click_limit are create-time only.
      var body={
        title:val("e-title").trim(),
        target_url:val("e-target").trim()||null,
        start_at:val("e-start").trim()||null,
        end_at:val("e-end").trim()||null,
        budget_limit_cents:numOrNull("e-budget")
      };
      var u=await api("/v1/admin/campaigns/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify(body)});
      if(!u.res.ok){ el("e-err").textContent=apiError(u.body); el("e-err").hidden=false; return; }
      state.flash="Kampaň uložena."; render();
    };
    var tb=el("e-trans");
    next.forEach(function(st){
      var b=document.createElement("button"); b.type="button"; b.className="btn secondary"; b.textContent="→ "+st;
      b.onclick=async function(){
        el("e-err").hidden=true;
        var t=await api("/v1/admin/campaigns/"+encodeURIComponent(id)+"/transition",{method:"POST",body:JSON.stringify({to:st})});
        if(!t.res.ok){ el("e-err").textContent=apiError(t.body); el("e-err").hidden=false; return; }
        state.flash="Stav → "+st; render();
      };
      tb.appendChild(b);
    });
  }

  async function renderClients(){
    var cl=await api("/v1/admin/clients",{method:"GET",headers:{}});
    if(!cl.res.ok){ panel('<p class="err">'+esc(apiError(cl.body))+'</p>'); return; }
    var clients=(cl.body&&cl.body.clients)||[];
    panel('<div class="card"><h2>Klienti</h2>'+listTable(clients,[["client_id","ID"],["company_name","Firma"],["ico","IČO"],["dic","DIČ"]])+
      '</div><div class="card"><h3>Nový klient</h3><div class="grid2">'+
      inp("cl-name","Firma *")+
      inp("cl-ico","IČO")+
      inp("cl-dic","DIČ")+
      ta("cl-addr","Adresa")+
      ta("cl-bill","Fakturační údaje")+
      ta("cl-notes","Interní poznámky")+
      '</div><div class="row"><button class="btn" type="button" id="cl-create">Vytvořit</button></div><p id="cl-err" class="err" hidden></p></div>');
    el("cl-create").onclick=async function(){
      el("cl-err").hidden=true;
      var r=await api("/v1/admin/clients",{method:"POST",body:JSON.stringify({
        company_name:val("cl-name").trim(),
        ico:val("cl-ico").trim()||null,
        dic:val("cl-dic").trim()||null,
        address:val("cl-addr").trim()||null,
        billing_info:val("cl-bill").trim()||null,
        notes_internal:val("cl-notes").trim()||null
      })});
      if(!r.res.ok){ el("cl-err").textContent=apiError(r.body); el("cl-err").hidden=false; return; }
      state.flash="Klient vytvořen."; render();
    };
  }

  async function renderSimpleCrud(opts){
    var list=await api(opts.listPath,{method:"GET",headers:{}});
    if(!list.res.ok){ panel('<p class="err">'+esc(apiError(list.body))+'</p>'); return; }
    var rows=(list.body&&list.body[opts.listKey])||list.body&&list.body.items||[];
    if(!Array.isArray(rows) && list.body){ rows = list.body[opts.listKey] || []; }
    var formFields=(opts.fields||[]).map(function(f){
      if(f.type==="textarea") return ta(f.id,f.label,f.value||"");
      if(f.type==="select") return sel(f.id,f.label,f.options||[],f.value||"");
      return inp(f.id,f.label,f.type||"text",f.value||"");
    }).join("");
    panel('<div class="card"><h2>'+esc(opts.title)+'</h2>'+
      (opts.emptyHint&&(!rows||!rows.length)?'<p class="muted empty">'+esc(opts.emptyHint)+'</p>':'')+
      listTable(rows,opts.cols)+
      '</div><div class="card"><h3>'+esc(opts.createTitle||"Nový záznam")+'</h3><div class="grid2">'+formFields+
      '</div><div class="row"><button class="btn" type="button" id="crud-go">Uložit</button></div><p id="crud-err" class="err" hidden></p></div>');
    el("crud-go").onclick=async function(){
      el("crud-err").hidden=true;
      var body={};
      (opts.fields||[]).forEach(function(f){
        var v=val(f.id);
        if(f.asNumber){ body[f.key]=v===""?null:Number(v); }
        else if(f.optional && !v.trim()) body[f.key]=null;
        else body[f.key]=f.type==="textarea"?v:v.trim();
      });
      if(opts.buildBody) body=opts.buildBody(body);
      var r=await api(opts.createPath,{method:"POST",body:JSON.stringify(body)});
      if(!r.res.ok){ el("crud-err").textContent=apiError(r.body); el("crud-err").hidden=false; return; }
      state.flash=opts.successMsg||"Uloženo."; render();
    };
  }

  async function renderCreatives(){
    var list=await api("/v1/admin/creatives",{method:"GET",headers:{}});
    if(!list.res.ok){ panel('<p class="err">'+esc(apiError(list.body))+'</p>'); return; }
    var rows=(list.body&&list.body.creatives)||[];
    panel('<div class="card"><h2>Kreativy</h2>'+listTable(rows,[["creative_id","ID"],["campaign_id","Kampaň"],["device_category","Zařízení"],["review_status","Stav"],["mime_type","MIME"]],function(row){
      return '<button type="button" class="linkish" data-acc="'+esc(row.creative_id)+'">Access</button> '+
        (row.review_status==="pending"?'<button type="button" class="linkish" data-ap="'+esc(row.creative_id)+'">Schválit</button> <button type="button" class="linkish" data-rj="'+esc(row.creative_id)+'">Zamítnout</button>':"");
    })+'<div id="cr-acc" class="muted"></div></div>'+
      '<div class="card"><h3>Upload kreativy</h3>'+
      inp("cr-client","client_id *")+
      inp("cr-camp","campaign_id (volitelné)")+
      inp("cr-fmt","format * (např. banner_728x90)")+
      sel("cr-dev","Zařízení",["pc","mobile","tablet","universal"],"universal")+
      inp("cr-w","Šířka","number")+
      inp("cr-h","Výška","number")+
      '<label for="cr-file">Soubor (image)</label><input id="cr-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif"/>'+
      '<div class="row"><button class="btn" type="button" id="cr-up">Nahrát</button></div><p id="cr-err" class="err" hidden></p></div>');
    el("cr-up").onclick=async function(){
      el("cr-err").hidden=true;
      var f=el("cr-file").files&&el("cr-file").files[0];
      if(!f){ el("cr-err").textContent="Vyberte soubor."; el("cr-err").hidden=false; return; }
      var buf=await f.arrayBuffer();
      var bytes=new Uint8Array(buf);
      var bin=""; for(var i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]);
      var b64=btoa(bin);
      var body={
        client_id:val("cr-client").trim(),
        format:val("cr-fmt").trim(),
        device_category:val("cr-dev"),
        filename:f.name,
        declared_mime:f.type||"application/octet-stream",
        content_base64:b64
      };
      if(val("cr-camp").trim()) body.campaign_id=val("cr-camp").trim();
      var w=numOrNull("cr-w"); if(w!=null) body.width=w;
      var h=numOrNull("cr-h"); if(h!=null) body.height=h;
      var r=await api("/v1/admin/creatives",{method:"POST",body:JSON.stringify(body)});
      if(!r.res.ok){ el("cr-err").textContent=apiError(r.body); el("cr-err").hidden=false; return; }
      state.flash="Kreativa nahrána."; render();
    };
    Array.prototype.forEach.call(document.querySelectorAll("[data-acc]"),function(b){
      b.onclick=async function(){
        var id=b.getAttribute("data-acc");
        var r=await api("/v1/admin/creatives/"+encodeURIComponent(id)+"/access",{method:"GET",headers:{}});
        el("cr-acc").textContent = r.res.ok ? ("Signed path: "+((r.body&&r.body.path)||JSON.stringify(r.body))) : apiError(r.body);
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-ap]"),function(b){
      b.onclick=async function(){
        var r=await api("/v1/admin/creatives/"+encodeURIComponent(b.getAttribute("data-ap"))+"/approve",{method:"POST",body:"{}"});
        if(!r.res.ok){ el("cr-err").textContent=apiError(r.body); el("cr-err").hidden=false; return; }
        state.flash="Kreativa schválena."; render();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-rj]"),function(b){
      b.onclick=async function(){
        var r=await api("/v1/admin/creatives/"+encodeURIComponent(b.getAttribute("data-rj"))+"/reject",{method:"POST",body:JSON.stringify({reason:"rejected_via_admin_ui"})});
        if(!r.res.ok){ el("cr-err").textContent=apiError(r.body); el("cr-err").hidden=false; return; }
        state.flash="Kreativa zamítnuta."; render();
      };
    });
  }

  async function renderDocuments(){
    var list=await api("/v1/admin/documents",{method:"GET",headers:{}});
    if(!list.res.ok){ panel('<p class="err">'+esc(apiError(list.body))+'</p>'); return; }
    var rows=(list.body&&list.body.documents)||[];
    panel('<div class="card"><h2>Dokumenty</h2>'+listTable(rows,[["document_id","ID"],["title","Název"],["visibility","Viditelnost"],["status","Stav"]],function(row){
      return '<button type="button" class="linkish" data-dacc="'+esc(row.document_id)+'">Access</button>';
    })+'<div id="doc-acc" class="muted"></div></div>'+
      '<div class="card"><h3>Upload dokumentu</h3>'+
      inp("doc-type","doc_type * (např. contract)")+
      inp("doc-title","Název *")+
      sel("doc-vis","Viditelnost",[["internal_only","internal_only"],["client_visible","client_visible"],["public","public (stále jen signed)"]],"internal_only")+
      inp("doc-client","client_id (volitelné)")+
      inp("doc-camp","campaign_id (volitelné)")+
      '<label for="doc-file">Soubor</label><input id="doc-file" type="file"/>'+
      '<div class="row"><button class="btn" type="button" id="doc-up">Nahrát</button></div><p id="doc-err" class="err" hidden></p></div>');
    el("doc-up").onclick=async function(){
      el("doc-err").hidden=true;
      var f=el("doc-file").files&&el("doc-file").files[0];
      if(!f){ el("doc-err").textContent="Vyberte soubor."; el("doc-err").hidden=false; return; }
      var buf=await f.arrayBuffer();
      var bytes=new Uint8Array(buf);
      var bin=""; for(var i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]);
      var body={
        doc_type:val("doc-type").trim(),
        title:val("doc-title").trim(),
        visibility:val("doc-vis"),
        filename:f.name,
        declared_mime:f.type||"application/octet-stream",
        content_base64:btoa(bin)
      };
      if(val("doc-client").trim()) body.client_id=val("doc-client").trim();
      if(val("doc-camp").trim()) body.campaign_id=val("doc-camp").trim();
      var r=await api("/v1/admin/documents",{method:"POST",body:JSON.stringify(body)});
      if(!r.res.ok){ el("doc-err").textContent=apiError(r.body); el("doc-err").hidden=false; return; }
      state.flash="Dokument nahrán (bez veřejné R2 URL)."; render();
    };
    Array.prototype.forEach.call(document.querySelectorAll("[data-dacc]"),function(b){
      b.onclick=async function(){
        var r=await api("/v1/admin/documents/"+encodeURIComponent(b.getAttribute("data-dacc"))+"/access",{method:"GET",headers:{}});
        el("doc-acc").textContent = r.res.ok ? ("Signed path: "+((r.body&&r.body.path)||"")) : apiError(r.body);
      };
    });
  }

  async function renderCodes(){
    var list=await api("/v1/admin/codes",{method:"GET",headers:{}});
    if(!list.res.ok){ panel('<p class="err">'+esc(apiError(list.body))+'</p>'); return; }
    var rows=(list.body&&list.body.codes)||[];
    panel('<div class="card"><h2>Klientské kódy</h2><p class="muted">Plaintext se ukáže jen jednou při issue/regen.</p>'+
      listTable(rows,[["code_id","ID"],["client_id","Klient"],["code_prefix","Prefix"],["status","Stav"],["expires_at","Expirace"]],function(row){
        return '<button type="button" class="linkish" data-regen="'+esc(row.code_id)+'">Regen</button> '+
          '<button type="button" class="linkish" data-rev="'+esc(row.code_id)+'">Revoke</button>';
      })+'</div><div class="card"><h3>Vydat kód</h3>'+
      inp("code-client","client_id *")+
      inp("code-exp","expires_at ISO (volitelné)")+
      inp("code-camps","campaign_ids csv * (povinný scope)")+
      '<div class="row"><button class="btn" type="button" id="code-go">Vydat</button></div>'+
      '<p id="code-err" class="err" hidden></p></div>');
    el("code-go").onclick=async function(){
      el("code-err").hidden=true;
      var camps=csvArr("code-camps");
      if(!camps.length){ el("code-err").textContent="campaign_ids jsou povinné."; el("code-err").hidden=false; return; }
      var body={ client_id:val("code-client").trim(), campaign_ids:camps };
      if(val("code-exp").trim()) body.expires_at=val("code-exp").trim();
      var r=await api("/v1/admin/codes",{method:"POST",body:JSON.stringify(body)});
      if(!r.res.ok){ el("code-err").textContent=apiError(r.body); el("code-err").hidden=false; return; }
      var plain=r.body&&r.body.access_code;
      state.flash=plain ? ("PLAINTEXT kód (jednou): "+plain) : "Kód vydán (plaintext neuveden).";
      render();
    };
    Array.prototype.forEach.call(document.querySelectorAll("[data-regen]"),function(b){
      b.onclick=async function(){
        var r=await api("/v1/admin/codes/"+encodeURIComponent(b.getAttribute("data-regen"))+"/regen",{method:"POST",body:"{}"});
        if(r.res.ok && r.body&&r.body.access_code){ state.flash="PLAINTEXT kód (jednou): "+r.body.access_code; }
        else if(!r.res.ok){ state.flash=apiError(r.body); }
        render();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-rev]"),function(b){
      b.onclick=async function(){
        var r=await api("/v1/admin/codes/"+encodeURIComponent(b.getAttribute("data-rev"))+"/revoke",{method:"POST",body:"{}"});
        if(!r.res.ok){ state.flash=apiError(r.body); }
        else state.flash="Kód zneplatněn.";
        render();
      };
    });
  }

  async function renderBackups(){
    var bu=await api("/v1/admin/backups",{method:"GET",headers:{}});
    if(!bu.res.ok){ panel('<p class="err">'+esc(apiError(bu.body))+'</p>'); return; }
    var backs=(bu.body&&bu.body.backups)||[];
    panel('<div class="card"><h2>Zálohy</h2><p class="muted">main_admin. Bez encryption key → manifest_only. Restore drill nezasahuje prod D1.</p>'+
      listTable(backs,[["backup_id","ID"],["status","Stav"],["encryption","Šifrování"],["content_hash","Hash"],["created_at","Vytvořeno"]],function(b){
        return '<button type="button" class="linkish" data-drill="'+esc(b.backup_id)+'">Drill</button>';
      })+
      '<div class="row"><button class="btn" type="button" id="bu-create">Vytvořit zálohu</button> '+
      '<button class="btn secondary" type="button" id="bu-prune">Prune</button></div><p id="bu-msg" class="muted"></p></div>');
    el("bu-create").onclick=async function(){
      var r=await api("/v1/admin/backups",{method:"POST",body:"{}"});
      el("bu-msg").textContent=r.res.ok?JSON.stringify(r.body):apiError(r.body);
      if(r.res.ok) render();
    };
    el("bu-prune").onclick=async function(){
      var r=await api("/v1/admin/backups/prune",{method:"POST",body:"{}"});
      el("bu-msg").textContent=r.res.ok?JSON.stringify(r.body):apiError(r.body);
      if(r.res.ok) render();
    };
    Array.prototype.forEach.call(document.querySelectorAll("[data-drill]"),function(b){
      b.onclick=async function(){
        var r=await api("/v1/admin/backups/"+encodeURIComponent(b.getAttribute("data-drill"))+"/drill",{method:"POST",body:"{}"});
        el("bu-msg").textContent=r.res.ok?JSON.stringify(r.body):apiError(r.body);
      };
    });
  }

  function searchHtml(body){
    var rows=(body&&body.results)||[];
    if(!rows.length) return '<p class="muted empty">Žádné záznamy</p>';
    var entityLabel={client:"Klient",campaign:"Kampaň",order:"Objednávka",contract:"Smlouva",invoice:"Faktura",document:"Dokument",code:"Klientský kód"};
    var mapped=rows.map(function(hit){
      var meta=hit.meta||{};
      var metaBits=[];
      Object.keys(meta).forEach(function(k){
        if(meta[k]!=null && String(meta[k]).length) metaBits.push(k+": "+meta[k]);
      });
      return {
        entity:entityLabel[hit.entity]||hit.entity||"—",
        label:hit.label||"—",
        id:hit.id||"",
        meta:metaBits.join(" · ")||"—"
      };
    });
    return listTable(mapped,[["entity","Typ"],["label","Název"],["id","ID"],["meta","Detaily"]]);
  }

  async function render(){
    var v=state.view;
    panel('<p class="muted">Načítám…</p>');
    try{
      if(v==="account") return renderAccount();
      if(v==="dashboard"){
        var d=await api("/v1/admin/dashboard",{method:"GET",headers:{}});
        if(!d.res.ok){ panel('<p class="err">'+esc(apiError(d.body))+'</p>'); return; }
        panel('<div class="card"><h2>Dashboard</h2>'+widgetsHtml(d.body&&d.body.widgets||d.body)+'</div>');
      } else if(v==="search"){
        panel('<div class="card"><h2>Vyhledávání</h2>'+
          '<div class="grid2">'+inp("q","Dotaz (min. 2 znaky)")+
          sel("q-ent","Typ",["all","client","campaign","order","contract","invoice","document","code"],"all")+
          '</div>'+
          '<div class="row"><button class="btn" type="button" id="go-q">Hledat</button></div>'+
          '<div id="q-out"><p class="muted empty">Zadejte dotaz a stiskněte Hledat.</p></div></div>');
        el("go-q").onclick=async function(){
          var q=val("q").trim();
          if(q.length<2){ el("q-out").innerHTML='<p class="muted empty">Zadejte alespoň 2 znaky.</p>'; return; }
          var ent=val("q-ent")||"all";
          var r=await api("/v1/admin/search?q="+encodeURIComponent(q)+"&entity="+encodeURIComponent(ent),{method:"GET",headers:{}});
          if(!r.res.ok){ el("q-out").innerHTML='<p class="err">'+esc(apiError(r.body))+'</p>'; return; }
          el("q-out").innerHTML=searchHtml(r.body);
        };
      } else if(v==="calendar"){
        var now=new Date(); var toDef=new Date(now.getTime()+30*864e5);
        panel('<div class="card"><h2>Kalendář</h2>'+
          '<div class="grid2">'+
          inp("cal-from","Od (ISO)", "text", now.toISOString())+
          inp("cal-to","Do (ISO)", "text", toDef.toISOString())+
          '</div><div class="row"><button class="btn" type="button" id="cal-go">Načíst období</button></div>'+
          '<div id="cal-out"><p class="muted">Načítám…</p></div></div>');
        async function loadCal(){
          var from=val("cal-from").trim()||now.toISOString();
          var to=val("cal-to").trim()||toDef.toISOString();
          var cal=await api("/v1/admin/calendar?from="+encodeURIComponent(from)+"&to="+encodeURIComponent(to),{method:"GET",headers:{}});
          if(!cal.res.ok){ el("cal-out").innerHTML='<p class="err">'+esc(apiError(cal.body))+'</p>'; return; }
          el("cal-out").innerHTML=calendarHtml(cal.body);
        }
        el("cal-go").onclick=loadCal;
        await loadCal();
      } else if(v==="alerts"){
        var al=await api("/v1/admin/alerts",{method:"GET",headers:{}});
        if(!al.res.ok){ panel('<p class="err">'+esc(apiError(al.body))+'</p>'); return; }
        var itemsA=(al.body&&al.body.alerts)||[];
        panel('<div class="card"><h2>Upozornění</h2>'+listTable(itemsA,[["alert_id","ID"],["type","Typ"],["severity","Závažnost"],["status","Stav"],["created_at","Vytvořeno"]],function(a){
          return '<button type="button" class="linkish" data-ack="'+esc(a.alert_id)+'">Ack</button> '+
            '<button type="button" class="linkish" data-res="'+esc(a.alert_id)+'">Resolve</button>';
        })+'<div class="row"><button class="btn secondary" type="button" id="al-gen">Generate</button></div></div>');
        el("al-gen").onclick=async function(){
          var r=await api("/v1/admin/alerts/generate",{method:"POST",body:"{}"});
          if(!r.res.ok){ state.flash=apiError(r.body); }
          render();
        };
        Array.prototype.forEach.call(document.querySelectorAll("[data-ack]"),function(b){
          b.onclick=async function(){
            var r=await api("/v1/admin/alerts/"+encodeURIComponent(b.getAttribute("data-ack"))+"/ack",{method:"POST",body:"{}"});
            if(!r.res.ok){ state.flash=apiError(r.body); }
            render();
          };
        });
        Array.prototype.forEach.call(document.querySelectorAll("[data-res]"),function(b){
          b.onclick=async function(){
            var r=await api("/v1/admin/alerts/"+encodeURIComponent(b.getAttribute("data-res"))+"/resolve",{method:"POST",body:"{}"});
            if(!r.res.ok){ state.flash=apiError(r.body); }
            render();
          };
        });
      } else if(v==="campaigns") return renderCampaigns();
      else if(v==="clients") return renderClients();
      else if(v==="creatives") return renderCreatives();
      else if(v==="documents") return renderDocuments();
      else if(v==="codes") return renderCodes();
      else if(v==="backups") return renderBackups();
      else if(v==="inquiries") return renderSimpleCrud({
        title:"Poptávky", listPath:"/v1/admin/inquiries", listKey:"inquiries", createPath:"/v1/admin/inquiries",
        cols:[["inquiry_id","ID"],["status","Stav"],["client_id","Klient"],["title","Název"]],
        fields:[
          {id:"iq-client",key:"client_id",label:"client_id (volitelné)",optional:true},
          {id:"iq-title",key:"title",label:"Název *"}
        ],
        emptyHint:"Žádné poptávky."
      });
      else if(v==="orders") return renderSimpleCrud({
        title:"Objednávky", listPath:"/v1/admin/orders", listKey:"orders", createPath:"/v1/admin/orders",
        cols:[["order_id","ID"],["order_number","Číslo"],["status","Stav"],["client_id","Klient"]],
        fields:[
          {id:"or-client",key:"client_id",label:"client_id *"},
          {id:"or-num",key:"order_number",label:"order_number (auto pokud prázdné)",optional:true},
          {id:"or-by",key:"ordered_by",label:"Objednatel",optional:true},
          {id:"or-pay",key:"payer",label:"Plátce",optional:true},
          {id:"or-contact",key:"contact_person",label:"Kontaktní osoba",optional:true}
        ]
      });
      else if(v==="contracts") return renderSimpleCrud({
        title:"Smlouvy", listPath:"/v1/admin/contracts", listKey:"contracts", createPath:"/v1/admin/contracts",
        cols:[["contract_id","ID"],["contract_number","Číslo"],["status","Stav"],["client_id","Klient"]],
        fields:[
          {id:"co-client",key:"client_id",label:"client_id *"},
          {id:"co-order",key:"order_id",label:"order_id (volitelné)",optional:true},
          {id:"co-num",key:"contract_number",label:"contract_number (auto pokud prázdné)",optional:true}
        ]
      });
      else if(v==="invoices") return renderSimpleCrud({
        title:"Faktury", listPath:"/v1/admin/invoices", listKey:"invoices", createPath:"/v1/admin/invoices",
        cols:[["invoice_id","ID"],["invoice_number","Číslo"],["status","Stav"],["client_id","Klient"],["total_cents","Částka (cents)"]],
        fields:[
          {id:"in-client",key:"client_id",label:"client_id *"},
          {id:"in-total",key:"total_cents",label:"total_cents",type:"number",asNumber:true},
          {id:"in-cur",key:"currency",label:"Měna",value:"CZK"}
        ]
      });
      else if(v==="placements"){
        var pt=await api("/v1/admin/placement-types",{method:"GET",headers:{}});
        if(!pt.res.ok){ panel('<p class="err">'+esc(apiError(pt.body))+'</p>'); return; }
        var types=((pt.body&&pt.body.placement_types)||[]).map(function(t){
          return {
            name_cs:t.name_cs||"—",
            placement_type_id:t.placement_type_id,
            technical_type:t.technical_type||"",
            section_id:t.section_id||"",
            collision_mode:t.collision_mode||"",
            devices:Array.isArray(t.devices)?t.devices.join(", "):"",
            anchor:t.anchor||"",
            is_active:t.is_active?"ano":"ne"
          };
        });
        panel('<div class="card"><h2>Umístění</h2>'+
          (types.length?listTable(types,[["name_cs","Název"],["placement_type_id","Interní ID"],["technical_type","Typ"],["section_id","Sekce"],["devices","Zařízení"],["collision_mode","Kolize"],["anchor","Kotva"],["is_active","Aktivní"]]):
            '<p class="muted empty">Žádné záznamy</p>')+
          '</div>');
      } else if(v==="reservations"){
        var rv=await api("/v1/admin/reservations",{method:"GET",headers:{}});
        if(!rv.res.ok){ panel('<p class="err">'+esc(apiError(rv.body))+'</p>'); return; }
        var resv=(rv.body&&rv.body.reservations)||[];
        panel('<div class="card"><h2>Rezervace</h2>'+listTable(resv,[["reservation_id","ID"],["campaign_id","Kampaň"],["placement_id","Umístění"],["start_at","Od"],["end_at","Do"],["status","Stav"]])+
          '</div><div class="card"><h3>Nová rezervace</h3>'+
          inp("rs-type","placement_type_id *")+
          inp("rs-pl","placement_id *")+
          inp("rs-camp","campaign_id *")+
          sel("rs-dev","device_category",["pc","mobile","tablet"],"pc")+
          inp("rs-sec","section_id (volitelné)")+
          inp("rs-reg","region_code (volitelné)")+
          inp("rs-from","start_at ISO *")+
          inp("rs-to","end_at ISO *")+
          '<div class="row"><button class="btn" type="button" id="rs-go">Vytvořit</button></div><p id="rs-err" class="err" hidden></p></div>');
        el("rs-go").onclick=async function(){
          var body={
            placement_type_id:val("rs-type").trim(),
            placement_id:val("rs-pl").trim(),
            campaign_id:val("rs-camp").trim(),
            device_category:val("rs-dev"),
            start_at:val("rs-from").trim(),
            end_at:val("rs-to").trim()
          };
          if(val("rs-sec").trim()) body.section_id=val("rs-sec").trim();
          if(val("rs-reg").trim()) body.region_code=val("rs-reg").trim();
          var r=await api("/v1/admin/reservations",{method:"POST",body:JSON.stringify(body)});
          if(!r.res.ok){ el("rs-err").textContent=apiError(r.body); el("rs-err").hidden=false; return; }
          render();
        };
      } else if(v==="rights") return renderSimpleCrud({
        title:"Autorská práva", listPath:"/v1/admin/rights", listKey:"confirmations", createPath:"/v1/admin/rights",
        cols:[["confirmation_id","ID"],["campaign_id","Kampaň"],["confirmed_by_name","Potvrdil"],["confirmed_at","Potvrzeno"]],
        fields:[
          {id:"ri-camp",key:"campaign_id",label:"campaign_id *"},
          {id:"ri-name",key:"confirmed_by_name",label:"Jméno potvrzujícího *"},
          {id:"ri-stmt",key:"statement_text",label:"Prohlášení *",type:"textarea"},
          {id:"ri-terms",key:"terms_version",label:"Verze podmínek *"},
          {id:"ri-doc",key:"document_id",label:"document_id (volitelné)",optional:true}
        ]
      });
      else if(v==="complaints") return renderSimpleCrud({
        title:"Reklamace", listPath:"/v1/admin/complaints", listKey:"complaints", createPath:"/v1/admin/complaints",
        cols:[["complaint_id","ID"],["status","Stav"],["client_id","Klient"],["campaign_id","Kampaň"]],
        fields:[
          {id:"cm-client",key:"client_id",label:"client_id *"},
          {id:"cm-camp",key:"campaign_id",label:"campaign_id (volitelné)",optional:true},
          {id:"cm-desc",key:"description",label:"Popis *",type:"textarea"},
          {id:"cm-imp",key:"impact",label:"Dopad (volitelné)",optional:true}
        ]
      });
      else if(v==="stats"){
        var st=await api("/v1/admin/stats/summary",{method:"GET",headers:{}});
        panel('<div class="card"><h2>Statistiky</h2>'+(st.res.ok?statsHtml(st.body):'<p class="err">'+esc(apiError(st.body))+'</p>')+
          '<hr style="border:0;border-top:1px solid var(--line);margin:1rem 0"/>'+
          inp("st-id","Detail kampaně (campaign_id)")+'<div class="row"><button class="btn secondary" type="button" id="st-go">Načíst kampaň</button></div><div id="st-out"></div></div>');
        el("st-go").onclick=async function(){
          var id=val("st-id").trim();
          if(!id){ el("st-out").innerHTML='<p class="muted">Zadejte campaign_id.</p>'; return; }
          var r=await api("/v1/admin/stats/campaigns/"+encodeURIComponent(id),{method:"GET",headers:{}});
          el("st-out").innerHTML=r.res.ok?statsHtml(r.body):'<p class="err">'+esc(apiError(r.body))+'</p>';
        };
      } else if(v==="finance"){
        panel('<div class="card"><h2>Finance</h2>'+
          '<div class="grid2">'+inp("fi-client","Klient (client_id, volitelné)")+inp("fi-from","Od (ISO, volitelné)")+inp("fi-to","Do (ISO, volitelné)")+'</div>'+
          '<div class="row"><button class="btn" type="button" id="fi-go">Filtrovat</button></div><div id="fi-out"><p class="muted">Načítám…</p></div></div>');
        async function loadFi(){
          var q=[];
          if(val("fi-client").trim()) q.push("client_id="+encodeURIComponent(val("fi-client").trim()));
          if(val("fi-from").trim()) q.push("from="+encodeURIComponent(val("fi-from").trim()));
          if(val("fi-to").trim()) q.push("to="+encodeURIComponent(val("fi-to").trim()));
          var fi=await api("/v1/admin/finance/summary"+(q.length?"?"+q.join("&"):""),{method:"GET",headers:{}});
          if(!fi.res.ok){ el("fi-out").innerHTML='<p class="err">'+esc(apiError(fi.body))+'</p>'; return; }
          el("fi-out").innerHTML=financeHtml(fi.body);
        }
        el("fi-go").onclick=loadFi;
        await loadFi();
      } else if(v==="exports"){
        var ex=await api("/v1/admin/exports",{method:"GET",headers:{}});
        var jobs=(ex.res.ok&&ex.body&&ex.body.exports)||[];
        panel('<div class="card"><h2>Exporty</h2>'+listTable(jobs,[["export_id","ID"],["status","Stav"],["scope_type","Scope"],["scope_id","Scope ID"],["created_at","Vytvořeno"]],function(j){
          return j.status==="completed"?'<a class="linkish" href="/v1/admin/exports/'+esc(j.export_id)+'/download">Stáhnout</a>':"";
        })+
          '</div><div class="card"><h3>Nový export (materializovaný JSON/CSV)</h3>'+
          sel("ex-scope","scope_type",["client","campaign","invoices","audit","order"],"client")+
          sel("ex-fmt","format",["json","csv"],"json")+
          inp("ex-sid","scope_id (povinné pro campaign/order)")+
          inp("ex-from","period_from ISO (volitelné)")+
          inp("ex-to","period_to ISO (volitelné)")+
          '<div class="row"><button class="btn" type="button" id="ex-go">Vytvořit a materializovat</button></div>'+
          '<p id="ex-err" class="err" hidden></p><p class="muted">Testovací kampaně (test_/IU_TEST_/EV-TEST) jsou vyloučeny z obchodních součtů. CSV escaping proti injection.</p></div>');
        el("ex-go").onclick=async function(){
          var body={ scope_type:val("ex-scope"), format:val("ex-fmt") };
          if(val("ex-sid").trim()) body.scope_id=val("ex-sid").trim();
          if(val("ex-from").trim()) body.period_from=val("ex-from").trim();
          if(val("ex-to").trim()) body.period_to=val("ex-to").trim();
          var r=await api("/v1/admin/exports",{method:"POST",body:JSON.stringify(body)});
          if(!r.res.ok){ el("ex-err").textContent=apiError(r.body); el("ex-err").hidden=false; return; }
          state.flash="Export hotov: "+((r.body&&r.body.export&&r.body.export.export_id)||"");
          render();
        };
      } else if(v==="audit"){
        var au=await api("/v1/admin/audit?limit=50",{method:"GET",headers:{}});
        if(!au.res.ok){ panel('<p class="err">'+esc(apiError(au.body))+'</p>'); return; }
        var logs=((au.body&&au.body.entries)||(au.body&&au.body.audit_logs)||[]).map(function(row){
          return {
            operation_cs:auditLabel(row.operation),
            operation:row.operation,
            object_type:row.object_type||"",
            object_id:row.object_id||"",
            actor:row.actor_user_id||row.actor||"",
            created_at:formatCsDate(row.created_at)
          };
        });
        panel('<div class="card"><h2>Audit</h2>'+
          (logs.length?listTable(logs,[["operation_cs","Operace"],["object_type","Objekt"],["object_id","ID objektu"],["actor","Uživatel"],["created_at","Čas"]]):
            '<p class="muted empty">Žádné záznamy</p>')+
          '<p class="muted">Citlivé hodnoty (hesla, tokeny, sessions) se v auditu nezobrazují.</p></div>');
      } else if(v==="users"){
        var us=await api("/v1/admin/users",{method:"GET",headers:{}});
        if(!us.res.ok){ panel('<p class="err">'+esc(apiError(us.body))+'</p>'); return; }
        var users=(us.body&&us.body.users)||[];
        panel('<div class="card"><h2>Uživatelé</h2>'+listTable(users,[["user_id","ID"],["email","E-mail"],["is_active","Aktivní"],["force_password_change","Force PW"]])+
          '</div><div class="card"><h3>Nový uživatel</h3>'+inp("us-email","E-mail *")+inp("us-name","Display name *")+inp("us-pass","Dočasné heslo *","password")+
          sel("us-role","Role",["main_admin","ads_manager","sales","read_only"],"read_only")+
          '<div class="row"><button class="btn" type="button" id="us-go">Vytvořit</button></div><p id="us-err" class="err" hidden></p></div>');
        el("us-go").onclick=async function(){
          el("us-err").hidden=true;
          var displayName=val("us-name").trim();
          if(!displayName){ el("us-err").textContent="Display name je povinné."; el("us-err").hidden=false; return; }
          var body={email:val("us-email").trim(),display_name:displayName,password:val("us-pass"),roles:[val("us-role")]};
          var r=await api("/v1/admin/users",{method:"POST",body:JSON.stringify(body)});
          if(!r.res.ok){ el("us-err").textContent=apiError(r.body); el("us-err").hidden=false; return; }
          el("us-pass").value=""; state.flash="Uživatel vytvořen."; render();
        };
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
`;
