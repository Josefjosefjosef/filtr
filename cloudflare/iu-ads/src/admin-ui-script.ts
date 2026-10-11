/**
 * Inline admin SPA script (served inside ADMIN_SHELL_HTML). No secrets / credentials.
 * Kept as a TS string so HTML shell stays readable.
 */
export const ADMIN_UI_SCRIPT = String.raw`
(function(){
  "use strict";
  var state = {
    health:null, me:null, nav:[], view:"dashboard", roles:[], flash:null,
    orderDetailId:null, publishConfirmRow:null, publishBusy:false,
    accountingCancelModal:null,
    extendNewOrderModal:null,
    orderEditModal:null, purgeOrderModal:null, rejectedCreditModal:null,
    premiumFilters:{ q:"", filter:"", payment:"", category:"", position:"", ending_days:"", ad_product:"" },
    searchFilters:null,
    searchSuggestTimer:null,
    searchReqSeq:0
  };
  var el = function(id){ return document.getElementById(id); };
  function esc(s){
    return String(s==null?"":s).replace(/[&<>"']/g,function(c){
      return ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c];
    });
  }
  function apiError(body){
    if(!body||typeof body!=="object") return "Požadavek se nezdařil — server nevrátil detail chyby (zkuste obnovit stránku).";
    if(typeof body.message_cs==="string"&&body.message_cs.trim()) return body.message_cs.trim();
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
      already_reviewed:"Kreativa už byla posouzena.",
      main_admin_required:"Nemáte oprávnění k úplnému odstranění (vyžadován hlavní administrátor).",
      purge_paid_accounting:"Objednávku nelze odstranit, protože je evidována úhrada.",
      purge_not_eligible:"Objednávku nelze odstranit — chybí potvrzení testovacího záznamu.",
      has_child_orders:"Objednávka má navazující prodloužení — nejdříve odstraňte podřízené záznamy.",
      purge_db_failed:"Odstranění nebylo dokončeno kvůli chybě databáze.",
      purge_failed:"Nepodařilo se odstranit související provozní záznamy."
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
  async function downloadZipExport(path, payload){
    var res = await fetch(path,{
      method:"POST",
      credentials:"include",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload||{})
    });
    if(!res.ok){
      var errBody=null;
      try{ errBody=await res.json(); }catch(_){ errBody=null; }
      return {ok:false, message:errBody?apiError(errBody):"Export ZIP se nezdařil."};
    }
    var blob=await res.blob();
    var cd=res.headers.get("Content-Disposition")||"";
    var m=cd.match(/filename=\"?([^\";]+)/);
    var fname=m?m[1]:"export.zip";
    var a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=fname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); },8000);
    return {ok:true, warnings:res.headers.get("X-IU-Export-Errors")||""};
  }
  function isoFromDateInput(d, endOfDay){
    if(!d||d.length<10) return "";
    if(endOfDay) return new Date(d+"T23:59:59.999").toISOString();
    return new Date(d+"T00:00:00").toISOString();
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
  function setupMobileNav(){
    var toggle=el("btn-nav-toggle");
    var backdrop=el("nav-backdrop");
    var nav=el("nav");
    if(!toggle||!nav) return;
    function closeNav(){
      nav.classList.remove("open");
      if(backdrop){ backdrop.hidden=true; backdrop.classList.remove("show"); }
    }
    function openNav(){
      nav.classList.add("open");
      if(backdrop){ backdrop.hidden=false; backdrop.classList.add("show"); }
    }
    toggle.onclick=function(){
      if(nav.classList.contains("open")) closeNav(); else openNav();
    };
    if(backdrop) backdrop.onclick=closeNav;
  }
  function setLoggedIn(on){
    el("login-view").className = on ? "" : "show";
    el("app-view").className = on ? "show" : "";
    var ha = el("header-actions");
    var navBtn='<button type="button" class="btn secondary nav-toggle" id="btn-nav-toggle" aria-label="Otevřít navigaci">Menu</button> ';
    if(on){
      ha.innerHTML=navBtn+'<span class="muted">'+esc(state.me&&(state.me.email||state.me.user_id)||"")+
        '</span> <button class="btn secondary" type="button" id="btn-account">Účet</button>'+
        ' <button class="btn secondary" type="button" id="btn-logout">Odhlásit</button>'+
        ' <button class="btn secondary" type="button" id="btn-logout-all">Odhlásit všechny relace</button>';
      el("btn-logout").onclick=logout;
      el("btn-logout-all").onclick=logoutAll;
      el("btn-account").onclick=function(){ state.view="account"; renderNavActive(); render(); };
    } else ha.innerHTML=navBtn;
    setupMobileNav();
  }
  var NAV_PRIMARY_IDS={"dashboard":1,"search":1,"orders_all":1,"premium":1,"banner_pc":1,"order_confirmations":1,"invoices":1};
  function navButtonClassName(itemId){
    var parts=[];
    if(NAV_PRIMARY_IDS[itemId]) parts.push("nav-primary");
    if(itemId===state.view) parts.push("active");
    return parts.join(" ");
  }
  function renderNavActive(){
    var nav=el("nav");
    Array.prototype.forEach.call(nav.querySelectorAll("button"),function(b){
      var id=b.getAttribute("data-id");
      if(!id) return;
      b.className=navButtonClassName(id);
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
      var badge = item.badge_count && Number(item.badge_count) > 0
        ? ' <span class="nav-badge" aria-label="Počet objednávek čekajících na posouzení">'+esc(String(item.badge_count))+'</span>'
        : "";
      return '<button type="button" data-id="'+esc(item.id)+'" class="'+navButtonClassName(item.id)+'">'+esc(item.label_cs)+badge+'</button>';
    }).join("")+'<button type="button" data-id="account">Účet / heslo</button>';
    nav.onclick=function(ev){
      var t=ev.target;
      if(t && t.getAttribute && t.getAttribute("data-id")){
        state.view=t.getAttribute("data-id");
        renderNavActive();
        render();
        nav.classList.remove("open");
        var backdrop=el("nav-backdrop");
        if(backdrop){ backdrop.hidden=true; backdrop.classList.remove("show"); }
      }
    };
    setupMobileNav();
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
  function wireRegistrySuggest(inputId,panelId,suggestPath,onApply){
    var input=el(inputId);
    var panel=el(panelId);
    if(!input||!panel) return;
    var timer=null;
    var lastItems=[];
    async function fetchSuggest(q){
      if(q.length<1){ panel.innerHTML=""; panel.hidden=true; lastItems=[]; return; }
      var r=await api(suggestPath+"?q="+encodeURIComponent(q)+"&limit=12",{method:"GET",headers:{}});
      if(!r.res.ok){ panel.innerHTML=""; panel.hidden=true; lastItems=[]; return; }
      lastItems=(r.body&&r.body.suggestions)||[];
      if(!lastItems.length){
        panel.innerHTML='<p class="muted registry-suggest-empty">Žádné shody</p>';
        panel.hidden=false;
        return;
      }
      panel.innerHTML=lastItems.map(function(it,idx){
        return '<button type="button" class="registry-suggest-item" data-suggest-idx="'+String(idx)+'">'+esc(it.label||"")+"</button>";
      }).join("");
      panel.hidden=false;
      Array.prototype.forEach.call(panel.querySelectorAll(".registry-suggest-item"),function(btn){
        btn.onclick=function(){
          var i=Number(btn.getAttribute("data-suggest-idx"));
          var pick=lastItems[i];
          if(pick&&pick.value!=null&&String(pick.value)!=="") input.value=String(pick.value);
          else if(pick&&pick.label) input.value=String(pick.label);
          panel.innerHTML="";
          panel.hidden=true;
          if(onApply) onApply();
        };
      });
    }
    input.oninput=function(){
      if(timer) clearTimeout(timer);
      timer=setTimeout(function(){ fetchSuggest(input.value.trim()); },220);
    };
    input.onkeydown=function(ev){
      if(ev.key==="Enter"){ ev.preventDefault(); panel.innerHTML=""; panel.hidden=true; if(onApply) onApply(); }
      if(ev.key==="Escape"){ panel.innerHTML=""; panel.hidden=true; }
    };
    input.onblur=function(){
      setTimeout(function(){ if(panel) panel.hidden=true; },180);
    };
  }
  function numOrNull(id){ var v=val(id).trim(); if(v==="") return null; var n=Number(v); return isFinite(n)?n:null; }
  function csvArr(id){ var v=val(id).trim(); if(!v) return []; return v.split(/[,;\s]+/).map(function(x){return x.trim();}).filter(Boolean); }
  function isMainAdminUser(){
    var u=state.me||{};
    var roles=u.roles||[];
    return roles.indexOf("main_admin")>=0;
  }
  function premiumPaymentLabel(st){
    if(st==="paid") return "Uhrazeno";
    if(st==="partial") return "Uhrazeno částečně";
    return "Neuhrazeno";
  }
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
    try{
      return new Intl.DateTimeFormat("cs-CZ",{timeZone:"Europe/Prague",day:"numeric",month:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(t));
    }catch(_){ return String(iso); }
  }
  function premiumRowStatus(row){
    if(row.is_ad_turned_off) return "Vypnuto administrátorem";
    var base=row.workflow_status_label_cs || row.workflow_status || "—";
    if(row.publication && row.publication.consistency_mismatch){
      return base+" · nesoulad veřejné publikace";
    }
    return base;
  }
  function premiumWorkflowUiTone(row){
    if(row.is_ad_turned_off) return "turned-off";
    var ws=row.workflow_status||"";
    if(ws==="submitted"||ws==="under_review") return "pending";
    if(ws==="rejected") return "rejected";
    if(ws==="published") return "published";
    if(ws==="cancelled") return "cancelled";
    return "neutral";
  }
  function premiumWorkflowStatusClass(tone){
    if(tone==="pending") return "order-status--pending";
    if(tone==="rejected") return "order-status--rejected";
    if(tone==="published") return "order-status--published";
    if(tone==="cancelled") return "order-status--cancelled";
    if(tone==="turned-off") return "order-status--turned-off";
    return "";
  }
  function premiumCardCornerBadgeHtml(row){
    if(row.is_ad_turned_off){
      return '<span class="ad-corner-badge ad-corner-badge--off">VYPNUTO ADMINISTRÁTOREM</span>';
    }
    if(row.workflow_status==="cancelled"||row.workflow_status==="rejected") return "";
    if(row.workflow_status==="submitted"){
      return '<span class="ad-corner-badge ad-corner-badge--pending">ČEKÁ NA SCHVÁLENÍ</span>';
    }
    if(row.workflow_status==="under_review"){
      return '<span class="ad-corner-badge ad-corner-badge--pending">ČEKÁ NA VYŘÍZENÍ</span>';
    }
    var pub=row.publication||{};
    if(row.workflow_status==="published"&&pub.expected_in_public_output&&!row.is_ad_turned_off){
      return '<span class="ad-corner-badge ad-corner-badge--active">AKTIVNÍ</span>';
    }
    return "";
  }
  function premiumOrderCardBorderClass(row){
    var t=premiumWorkflowUiTone(row);
    if(t==="pending") return "order-card--pending";
    if(t==="rejected") return "order-card--rejected";
    if(t==="published") return "order-card--published";
    if(t==="cancelled") return "order-card--cancelled";
    if(t==="turned-off") return "order-card--turned-off";
    return "";
  }
  function premiumOrderRowBorderClass(row){
    var t=premiumWorkflowUiTone(row);
    if(t==="pending") return "order-row--pending";
    if(t==="rejected") return "order-row--rejected";
    if(t==="published") return "order-row--published";
    if(t==="cancelled") return "order-row--cancelled";
    if(t==="turned-off") return "order-row--turned-off";
    return "";
  }
  function premiumPaymentStatusSpan(ord){
    var ps=ord.payment_status||"unpaid";
    if(ps==="paid") return '<span class="pay-status--paid">'+esc(premiumPaymentLabel("paid"))+"</span>";
    if(ps==="partial") return '<span class="pay-status--partial">'+esc(premiumPaymentLabel("partial"))+"</span>";
    return '<span class="pay-status--unpaid">'+esc(premiumPaymentLabel("unpaid"))+"</span>";
  }
  function premiumInvoicePaymentBadgeHtml(ord, asBlock){
    if(!ord.invoice_issued||!ord.invoice_payment_label_cs) return "";
    var cls=ord.invoice_paid?"invoice-pay-badge--paid":"invoice-pay-badge--unpaid";
    var tag=asBlock?"div":"span";
    return "<"+tag+' class="invoice-pay-badge '+cls+'">'+esc(ord.invoice_payment_label_cs)+"<"+"/"+tag+">";
  }
  function premiumDetailStatusHeaderHtml(ord){
    var ws=ord.workflow_status||"";
    var payPart=ord.invoice_issued?premiumInvoicePaymentBadgeHtml(ord,false):premiumPaymentStatusSpan(ord);
    if(ws==="rejected"){
      return '<p class="detail-status-line"><span class="order-status order-status--rejected">Zamítnuto</span> – '+payPart+"</p>";
    }
    if(ord.is_ad_turned_off){
      return '<p class="detail-status-line"><span class="order-status order-status--turned-off">Reklama vypnuta</span> '+payPart+"</p>";
    }
    var wfTone=premiumWorkflowUiTone(ord);
    var wfCls=premiumWorkflowStatusClass(wfTone);
    var wfLabel=ord.workflow_status_label_cs||ws||"—";
    return '<p class="detail-status-line"><span class="order-status '+wfCls+'">'+esc(wfLabel)+"</span> "+payPart+"</p>";
  }
  function premiumOrderCardPayActionHtml(row){
    if(row.workflow_status!=="published"||!row.invoice_issued||row.invoice_paid) return "";
    return '<button type="button" class="btn success" data-premium-pay="'+esc(row.order_id)+'" data-stop-row="1">Potvrdit úhradu faktury</button> ';
  }
  function premiumOrderActions(row, opts){
    opts=opts||{};
    var id=esc(row.order_id);
    var stop=opts.stopPropagation ? ' data-stop-row="1"' : "";
    var publishableHint=row.publishable?"1":"0";
    return '<button type="button" class="btn detail" data-premium-detail="'+id+'" data-order-publishable="'+esc(publishableHint)+'"'+stop+
      ' aria-label="Detail objednávky'+(row.publishable?" (připraveno ke schválení)":"")+'">Detail</button>';
  }
  function premiumOrdersTableHtml(rows,opts){
    opts=opts||{};
    if(!rows||!rows.length) return '<p class="muted empty">Žádné objednávky k zobrazení.</p>';
    var head=["Firma","IČO"];
    if(opts.showAdMeta){ head.push("Produkt","Číslo objednávky"); }
    head=head.concat(["Sekce","Pozice","Období","Cena","Stav","Přijato","Akce"]);
    var headHtml=head.map(function(h){return "<th>"+esc(h)+"</th>";}).join("");
    var body=rows.map(function(row){
      var ref=row.order_reference||row.customer_order_code||row.order_number||"—";
      return '<tr class="order-row-click '+esc(premiumOrderRowBorderClass(row))+'" tabindex="0" role="button" data-order-open="'+esc(row.order_id)+'" aria-label="Otevřít detail objednávky">'+
        "<td>"+esc(row.company_name)+"</td>"+
        "<td>"+esc(row.ico||"—")+"</td>"+
        (opts.showAdMeta?("<td>"+esc(row.ad_product_label_cs||"—")+"</td><td>"+esc(ref)+"</td>"):"")+
        "<td>"+esc(row.category_title_cs||row.category_slug)+"</td>"+
        "<td>"+esc(row.position_label||("P"+row.position))+"</td>"+
        "<td>"+esc(row.duration_label_cs||"6 měsíců")+"</td>"+
        "<td>"+esc(row.price_label_cs||"—")+"</td>"+
        '<td><span class="order-status '+esc(premiumWorkflowStatusClass(premiumWorkflowUiTone(row)))+'">'+esc(premiumRowStatus(row))+"</span></td>"+
        "<td>"+esc(row.submitted_at_label_cs||formatCsDate(row.submitted_at))+"</td>"+
        '<td class="order-actions">'+premiumOrderActions(row,{stopPropagation:true})+"</td></tr>";
    }).join("");
    return '<div class="table-wrap order-table-desktop"><table class="order-table"><thead><tr>'+headHtml+'</tr></thead><tbody>'+body+"</tbody></table></div>";
  }
  function premiumOrdersCardsHtml(rows,opts){
    opts=opts||{};
    if(!rows||!rows.length) return "";
    return '<div class="order-cards">'+rows.map(function(row){
      return '<article class="order-card '+esc(premiumOrderCardBorderClass(row))+'" tabindex="0" role="button" data-order-open="'+esc(row.order_id)+'" aria-label="Otevřít detail objednávky">'+
        premiumCardCornerBadgeHtml(row)+
        '<div class="order-card-head"><strong>'+esc(row.company_name)+'</strong><div class="order-card-badges">'+
        premiumInvoicePaymentBadgeHtml(row,true)+
        '<span class="order-status '+esc(premiumWorkflowStatusClass(premiumWorkflowUiTone(row)))+'">'+esc(premiumRowStatus(row))+'</span></div></div>'+
        '<p class="muted">IČO: '+esc(row.ico||"—")+'</p>'+
        (opts.showAdMeta?('<p class="muted">'+esc(row.ad_product_label_cs||"—")+' · '+esc(row.order_reference||row.customer_order_code||row.order_number||"—")+'</p>'):'')+
        '<p>'+esc(row.category_title_cs||row.category_slug)+' · '+esc(row.position_label||("P"+row.position))+'</p>'+
        '<p>'+esc(row.duration_label_cs||"6 měsíců")+' · '+esc(row.price_label_cs||"—")+'</p>'+
        '<p class="muted">Přijato: '+esc(row.submitted_at_label_cs||formatCsDate(row.submitted_at))+'</p>'+
        '<div class="row order-card-actions">'+premiumOrderCardPayActionHtml(row)+premiumOrderActions(row,{stopPropagation:true})+'</div></article>';
    }).join("")+"</div>";
  }
  function publishConfirmDialogHtml(row){
    if(!row) return "";
    return '<div class="modal-backdrop" id="premium-publish-modal" role="dialog" aria-modal="true" aria-labelledby="premium-publish-title">'+
      '<div class="modal-card"><h3 id="premium-publish-title">Finální kontrola před zveřejněním</h3>'+
      '<p>Chystáte se zveřejnit:</p><ul class="confirm-list">'+
      "<li><strong>"+esc(row.company_name)+"</strong></li>"+
      "<li>"+esc(row.category_title_cs||row.category_slug)+"</li>"+
      "<li>Pozice "+esc(row.position_label||("P"+row.position))+"</li>"+
      "<li>"+esc(row.duration_label_cs||"6 měsíců")+"</li>"+
      "<li>"+esc(row.price_label_cs||"—")+"</li></ul>"+
      '<div class="row"><button type="button" class="btn" id="premium-publish-confirm" '+(state.publishBusy?"disabled":"")+'>Schválit a zveřejnit</button> '+
      '<button type="button" class="btn secondary" id="premium-publish-cancel">Zpět</button></div></div></div>';
  }
  function parseKcInputToCents(raw){
    var t=String(raw==null?"":raw).trim().replace(/\s/g,"").replace(/,/g,".");
    if(!/^\d+(\.\d{1,2})?$/.test(t)) return null;
    var parts=t.split(".");
    var whole=parts[0]||"0";
    var frac=(parts[1]||"").padEnd(2,"0").slice(0,2);
    var cents=parseInt(whole,10)*100+parseInt(frac,10);
    if(!Number.isFinite(cents)||cents<=0) return null;
    return cents;
  }
  function computeAcctRecap(invTotal, remainingCorrectable, stornoCents, payMode, paidCents){
    invTotal=Math.max(0,Math.round(Number(invTotal)||0));
    remainingCorrectable=Math.max(0,Math.round(Number(remainingCorrectable)||0));
    stornoCents=Math.max(0,Math.round(Number(stornoCents)||0));
    var credit=-stornoCents;
    var newSvc=Math.max(0,invTotal+credit);
    var paid=Math.max(0,Math.round(Number(paidCents)||0));
    if(payMode==="unpaid") paid=0;
    if(payMode==="paid") paid=invTotal;
    return {
      credit_note_cents:credit,
      new_service_price_cents:newSvc,
      amount_paid_cents:paid,
      remaining_due_cents:Math.max(0,newSvc-paid),
      overpayment_cents:Math.max(0,paid-newSvc),
      remaining_correctable_cents:remainingCorrectable
    };
  }
  function accountingCancelModalHtml(){
    var m=state.accountingCancelModal;
    if(!m||!m.detail) return "";
    var ord=m.detail.order||{};
    var inv=m.detail.invoice;
    var acct=m.detail.invoice_accounting||{};
    var blocked=ord.accounting_cancel_blocked_reason_cs||(!ord.accounting_cancel_allowed?"Storno není povoleno.":null);
    var invTotal=inv?Number(inv.total_cents)||0:0;
    var remain=acct.remaining_correctable_cents!=null?Number(acct.remaining_correctable_cents):invTotal;
    var payMode=m.form.payment_settlement||acct.suggested_payment_settlement||"unpaid";
    var stornoCents=remain;
    var paidCents=parseKcInputToCents(m.form.paid_kc);
    var recap=inv?computeAcctRecap(invTotal,remain,stornoCents,payMode,paidCents||0):null;
    var reasonOk=String(m.form.reason||"").trim().length>=12;
    var canSubmit=!blocked&&inv&&stornoCents>0&&reasonOk&&
      (payMode!=="partial"||(paidCents&&paidCents>0&&paidCents<invTotal))&&!m.submitBusy;
    return '<div class="modal-backdrop" id="premium-acct-cancel-modal" role="dialog" aria-modal="true" aria-labelledby="premium-acct-cancel-title">'+
      '<div class="modal-card modal-wide"><h3 id="premium-acct-cancel-title">Stornovat objednávku a fakturu</h3>'+
      (blocked?'<p class="err">'+esc(blocked)+"</p>":"")+
      '<section><h4>1. Objednávka a faktura</h4><div class="acct-cancel-grid">'+
      '<div><span class="muted">Objednávka</span><br><strong>'+esc(ord.customer_order_code||ord.order_number||ord.order_id)+'</strong></div>'+
      (inv?'<div><span class="muted">Faktura</span><br><strong>'+esc(inv.invoice_number)+'</strong></div>':"")+
      '<div><span class="muted">Zákazník</span><br>'+esc(ord.company_name||"—")+'</div>'+
      '<div><span class="muted">IČO</span><br>'+esc(ord.ico||"—")+'</div>'+
      '<div class="full"><span class="muted">Kategorie · pozice</span><br>'+esc(ord.category_title_cs||"—")+" · "+esc(ord.position_label||"—")+'</div>'+
      '<div class="full"><span class="muted">Období služby</span><br>'+esc(ord.service_period_label_cs||ord.campaign_start_at_label_cs&&ord.campaign_end_at_label_cs?(ord.campaign_start_at_label_cs+" – "+ord.campaign_end_at_label_cs):"—")+'</div>'+
      (inv?'<div><span class="muted">Fakturovaná částka</span><br><strong>'+esc(formatKc(inv.total_cents))+'</strong></div>':"")+
      (acct.prior_corrected_cents?'<div><span class="muted">Již opraveno</span><br>'+esc(formatKc(acct.prior_corrected_cents))+'</div>':"")+
      '<div><span class="muted">Stav objednávky</span><br>'+esc(ord.workflow_status_label_cs||ord.workflow_status)+'</div>'+
      '<div><span class="muted">Reklama vypnuta</span><br>'+(ord.is_ad_turned_off?"Ano — "+esc(ord.ad_turned_off_at_label_cs||""):"Ne")+'</div>'+
      "</div></section>"+
      (inv?('<section><h4>2. Stav úhrady faktury</h4>'+
      '<label><input type="radio" name="acct-pay" value="unpaid" '+(payMode==="unpaid"?"checked":"")+' data-acct-pay> Neuhrazeno</label><br>'+
      '<label><input type="radio" name="acct-pay" value="paid" '+(payMode==="paid"?"checked":"")+' data-acct-pay> Uhrazeno</label><br>'+
      '<label><input type="radio" name="acct-pay" value="partial" '+(payMode==="partial"?"checked":"")+' data-acct-pay> Uhrazeno částečně</label>'+
      (payMode==="partial"?('<p><label for="acct-paid-kc">Skutečně uhrazená částka (Kč)</label><input id="acct-paid-kc" type="text" inputmode="decimal" autocomplete="off" value="'+esc(m.form.paid_kc||"")+'" data-acct-paid-kc></p>'):"")+
      "</section>"+
      '<section><h4>3. Důvod storna</h4>'+
      '<p class="muted">Storno se vztahuje vždy na celou zbývající neopravenou fakturovanou částku ('+esc(formatKc(stornoCents))+').</p>'+
      '<p><label for="acct-reason">Důvod storna objednávky a faktury *</label><textarea id="acct-reason" rows="3" maxlength="2000" minlength="12" data-acct-reason aria-describedby="acct-reason-hint acct-reason-err" '+(reasonOk?"":"aria-invalid=\"true\"")+'>'+esc(m.form.reason||"")+'</textarea></p>'+
      '<p class="muted" id="acct-reason-hint">Minimálně 12 znaků (srozumitelný důvod storna).</p>'+
      '<p class="err" id="acct-reason-err" '+(m.formError&&String(m.form.reason||"").trim().length<12?"":"hidden")+'>'+(m.formError&&String(m.form.reason||"").trim().length<12?esc(m.formError):"")+'</p></section>'+
      '<section><h4>4. Rekapitulace</h4><div class="acct-recap"><dl>'+
      '<dt>Původní faktura</dt><dd>'+esc(formatKc(invTotal))+'</dd>'+
      '<dt>Stornovaná částka (100 % zbývající)</dt><dd>'+esc(formatKc(stornoCents))+'</dd>'+
      '<dt>Dobropis</dt><dd>− '+esc(formatKc(stornoCents))+'</dd>'+
      '<dt>Zbývající cena služby</dt><dd>'+esc(formatKc(recap.new_service_price_cents))+'</dd>'+
      '<dt>Skutečně zaplaceno</dt><dd>'+esc(formatKc(recap.amount_paid_cents))+'</dd>'+
      (recap.remaining_due_cents?('<dt>Zbývá k úhradě</dt><dd>'+esc(formatKc(recap.remaining_due_cents))+'</dd>'):"")+
      (recap.overpayment_cents?('<dt>Přeplatek k vypořádání</dt><dd>'+esc(formatKc(recap.overpayment_cents))+'</dd>'):"")+
      '</dl><p class="muted">Vystavení dobropisu neznamená automatické vrácení peněz.</p></div>'+
      (ord.is_ad_turned_off?'<p class="muted">✓ Reklama byla definitivně vypnuta.</p>':'')+
      "</section>"):"")+
      (m.formError?'<p class="err">'+esc(m.formError)+"</p>":"")+
      '<div class="row">'+
      '<button type="button" class="btn danger" id="premium-acct-cancel-confirm" '+(canSubmit?"":"disabled")+'>Potvrdit storno objednávky a faktury</button> '+
      '<button type="button" class="btn secondary" id="premium-acct-cancel-dismiss">Zrušit</button></div></div></div>';
  }
  function syncAccountingCancelConfirmButton(){
    var m=state.accountingCancelModal;
    if(!m||!m.detail) return;
    var ord=m.detail.order||{};
    var inv=m.detail.invoice;
    var acct=m.detail.invoice_accounting||{};
    var blocked=ord.accounting_cancel_blocked_reason_cs||(!ord.accounting_cancel_allowed?"Storno není povoleno.":null);
    var invTotal=inv?Number(inv.total_cents)||0:0;
    var remain=acct.remaining_correctable_cents!=null?Number(acct.remaining_correctable_cents):invTotal;
    var payMode=m.form.payment_settlement||acct.suggested_payment_settlement||"unpaid";
    var stornoCents=remain;
    var paidCents=parseKcInputToCents(m.form.paid_kc);
    var reasonOk=String(m.form.reason||"").trim().length>=12;
    var canSubmit=!blocked&&inv&&stornoCents>0&&reasonOk&&
      (payMode!=="partial"||(paidCents&&paidCents>0&&paidCents<invTotal))&&!m.submitBusy;
    var confirmBtn=el("premium-acct-cancel-confirm");
    if(confirmBtn) confirmBtn.disabled=!canSubmit;
    var errEl=el("acct-reason-err");
    var reasonText=String(m.form.reason||"").trim();
    if(errEl){
      if(!reasonOk&&reasonText.length>0){
        errEl.hidden=false;
        errEl.textContent="Důvod storna musí mít alespoň 12 znaků (aktuálně "+String(reasonText.length)+").";
      } else if(!reasonOk&&m.formError&&reasonText.length===0){
        errEl.hidden=false;
        errEl.textContent=m.formError;
      } else {
        errEl.hidden=true;
        errEl.textContent="";
      }
    }
    var ta=el("acct-reason");
    if(ta) ta.setAttribute("aria-invalid",reasonOk?"false":"true");
  }
  function extendNewOrderModalHtml(){
    var m=state.extendNewOrderModal;
    if(!m||!m.detail) return "";
    var ord=m.detail.order||{};
    var sug=m.detail.extend_suggested_period||{};
    var blocked=m.detail.extend_new_order_blocked_reason_cs||(!m.detail.extend_new_order_allowed?"Prodloužení není dostupné.":null);
    var f=m.form||{};
    var canSubmit=!blocked&&f.period_start&&f.period_end&&String(f.price_kc||"").trim()&&String(f.target_url||"").trim()&&!m.submitBusy;
    return '<div class="modal-backdrop" id="premium-extend-modal" role="dialog" aria-modal="true"><div class="modal-card modal-wide"><h3>Prodloužit reklamu (nová navazující objednávka)</h3>'+
      (blocked?'<p class="err">'+esc(blocked)+"</p>":"")+
      '<p class="muted">Vytvoří se nová objednávka navazující na řetězec — reklama zůstane zveřejněná bez přerušení.</p>'+
      '<div class="acct-cancel-grid">'+
      '<div><span class="muted">Firma</span><br><strong>'+esc(ord.company_name||"—")+'</strong></div>'+
      '<div><span class="muted">Objednávka</span><br><strong>'+esc(ord.customer_order_code||ord.order_number||ord.order_id)+'</strong></div>'+
      '<div class="full"><span class="muted">Sekce · pozice</span><br>'+esc(ord.category_title_cs||ord.category_slug||"—")+" · "+esc(ord.position_label||"—")+'</div>'+
      '<div class="full"><span class="muted">Konec kampaně</span><br>'+esc(ord.campaign_end_at_label_cs||formatCsDate(ord.campaign_end_at))+'</div>'+
      "</div>"+
      '<section><h4>Období a cena</h4>'+
      '<div class="grid2">'+
      '<label>Období od<input id="ext-period-start" type="date" value="'+esc(f.period_start||"")+'"></label>'+
      '<label>Období do<input id="ext-period-end" type="date" value="'+esc(f.period_end||"")+'"></label>'+
      '<label>Cena (Kč)<input id="ext-price-kc" type="text" inputmode="decimal" value="'+esc(f.price_kc||"")+'"></label>'+
      '<label>Cílová URL (https)<input id="ext-target-url" type="url" value="'+esc(f.target_url||"")+'"></label>'+
      "</div></section>"+
      (m.formError?'<p class="err">'+esc(m.formError)+"</p>":"")+
      '<div class="row"><button type="button" class="btn success" id="premium-extend-confirm" '+(canSubmit?"":"disabled")+'>Vytvořit navazující objednávku</button> '+
      '<button type="button" class="btn secondary" id="premium-extend-dismiss">Zrušit</button></div></div></div>';
  }
  function syncExtendNewOrderConfirmButton(){
    var m=state.extendNewOrderModal;
    if(!m||!m.detail) return;
    var blocked=m.detail.extend_new_order_blocked_reason_cs||(!m.detail.extend_new_order_allowed?"Prodloužení není dostupné.":null);
    var f=m.form||{};
    var canSubmit=!blocked&&f.period_start&&f.period_end&&String(f.price_kc||"").trim()&&String(f.target_url||"").trim()&&!m.submitBusy;
    var btn=el("premium-extend-confirm");
    if(btn) btn.disabled=!canSubmit;
  }
  function wireExtendNewOrderModal(){
    var m=state.extendNewOrderModal;
    if(!m) return;
    var dismiss=el("premium-extend-dismiss");
    if(dismiss) dismiss.onclick=function(){ state.extendNewOrderModal=null; render(); };
    function syncFormFromInputs(){
      if(!state.extendNewOrderModal) return;
      var ps=el("ext-period-start");
      var pe=el("ext-period-end");
      var pr=el("ext-price-kc");
      var tu=el("ext-target-url");
      state.extendNewOrderModal.form={
        period_start:ps?ps.value:"",
        period_end:pe?pe.value:"",
        price_kc:pr?pr.value:"",
        target_url:tu?tu.value:""
      };
      syncExtendNewOrderConfirmButton();
    }
    ["ext-period-start","ext-period-end","ext-price-kc","ext-target-url"].forEach(function(id){
      var node=el(id);
      if(node){
        node.oninput=syncFormFromInputs;
        node.onchange=syncFormFromInputs;
      }
    });
    var confirm=el("premium-extend-confirm");
    if(confirm) confirm.onclick=async function(){
      if(!state.extendNewOrderModal||state.extendNewOrderModal.submitBusy) return;
      var modal=state.extendNewOrderModal;
      syncFormFromInputs();
      var f=modal.form;
      var extendFrom=(modal.detail&&modal.detail.extend_chain_source_order_id)||modal.orderId;
      modal.submitBusy=true;
      render();
      var idem="ui-ext-new:"+extendFrom+":"+String(f.period_start)+":"+String(f.period_end)+":"+String(f.price_kc);
      var r=await api("/v1/admin/premium/orders/"+encodeURIComponent(extendFrom)+"/extend-new-order",{
        method:"POST",
        body:JSON.stringify({
          period_start_at:isoFromDateInput(f.period_start,false)||f.period_start,
          period_end_at:isoFromDateInput(f.period_end,true)||f.period_end,
          price_kc:String(f.price_kc||"").trim(),
          target_url:String(f.target_url||"").trim(),
          idempotency_key:idem
        })
      });
      modal.submitBusy=false;
      if(r.res.ok&&r.body){
        state.extendNewOrderModal=null;
        state.flash="Nová objednávka "+(r.body.new_order_number||"")+" vytvořena, faktura "+(r.body.invoice_number||"")+".";
        state.orderDetailId=r.body.new_order_id||modal.orderId;
        await loadNav();
        render();
        return;
      }
      modal.formError=r.body&&r.body.message_cs?r.body.message_cs:apiError(r.body);
      render();
    };
  }
  function wireAccountingCancelModal(){
    var m=state.accountingCancelModal;
    if(!m) return;
    var dismiss=el("premium-acct-cancel-dismiss");
    if(dismiss) dismiss.onclick=function(){ state.accountingCancelModal=null; render(); };
    Array.prototype.forEach.call(document.querySelectorAll("[data-acct-pay]"),function(r){
      r.onchange=function(){
        if(!state.accountingCancelModal) return;
        state.accountingCancelModal.form.payment_settlement=r.value;
        render();
      };
    });
    var paid=el("acct-paid-kc");
    if(paid){
      paid.oninput=function(){ state.accountingCancelModal.form.paid_kc=paid.value; };
      paid.onchange=function(){ render(); };
    }
    var reason=el("acct-reason");
    if(reason){
      reason.oninput=function(){
        if(!state.accountingCancelModal) return;
        state.accountingCancelModal.form.reason=reason.value;
        syncAccountingCancelConfirmButton();
      };
    }
    syncAccountingCancelConfirmButton();
    var confirmBtn=el("premium-acct-cancel-confirm");
    if(confirmBtn) confirmBtn.onclick=async function(){
      if(!state.accountingCancelModal||state.accountingCancelModal.submitBusy) return;
      syncAccountingCancelConfirmButton();
      var liveConfirm=el("premium-acct-cancel-confirm");
      if(liveConfirm&&liveConfirm.disabled){
        var modalEarly=state.accountingCancelModal;
        if(modalEarly){
          var rtEarly=String(modalEarly.form.reason||"").trim();
          if(rtEarly.length<12){
            modalEarly.formError=null;
            syncAccountingCancelConfirmButton();
          } else {
            modalEarly.formError="Storno nelze dokončit — zkontrolujte stav faktury a rekapitulaci.";
          }
        }
        render();
        return;
      }
      var modal=state.accountingCancelModal;
      var inv=modal.detail&&modal.detail.invoice;
      var acct=modal.detail&&modal.detail.invoice_accounting||{};
      var invTotal=inv?Number(inv.total_cents)||0:0;
      var remain=acct.remaining_correctable_cents!=null?Number(acct.remaining_correctable_cents):invTotal;
      var payMode=modal.form.payment_settlement||"unpaid";
      var paidCents=parseKcInputToCents(modal.form.paid_kc);
      var reasonText=String(modal.form.reason||"").trim();
      if(!inv){ modal.formError="Chybí faktura."; render(); return; }
      if(!remain){ modal.formError="Faktura již nemá zbývající částku ke stornu."; render(); return; }
      if(reasonText.length<12){ modal.formError="Důvod storna musí být srozumitelný (min. 12 znaků)."; render(); return; }
      if(payMode==="partial"&&(!paidCents||paidCents<=0||paidCents>=invTotal)){
        modal.formError="U částečné úhrady zadejte skutečně zaplacenou částku."; render(); return;
      }
      modal.formError=null;
      modal.submitBusy=true;
      render();
      var body={
        reason:reasonText,
        payment_settlement:payMode,
        idempotency_key:"ui-acct-cancel:"+modal.orderId
      };
      if(payMode==="partial") body.amount_paid_cents=paidCents;
      var r=await api("/v1/admin/premium/orders/"+encodeURIComponent(modal.orderId)+"/accounting-cancel",{method:"POST",body:JSON.stringify(body)});
      modal.submitBusy=false;
      if(r.res.ok){
        state.accountingCancelModal=null;
        var docsOk=r.body&&r.body.document_enqueue&&r.body.document_enqueue.ok;
        if(docsOk){
          state.flash=r.body&&r.body.idempotent?"Storno již bylo zaevidováno — PDF jsou k dispozici.":"Storno dokončeno včetně PDF dokumentů.";
        } else if(r.body&&r.body.idempotent){
          state.flash="Storno již bylo zaevidováno — dokončuji PDF (nouzové tlačítko v sekci Dokumenty).";
        } else {
          state.flash="Storno zaevidováno, ale generování PDF selhalo — použijte nouzové dokončení v sekci Dokumenty.";
        }
        state.orderDetailId=modal.orderId;
        render();
        return;
      }
      modal.formError=r.body&&r.body.message_cs?r.body.message_cs:apiError(r.body);
      render();
    };
  }
  function auxiliaryModalsHtml(){
    var h="";
    var em=state.orderEditModal;
    if(em&&em.detail){
      var o=em.detail.order||{};
      var opts=em.detail.edit_form_options||{};
      var catOpts=(opts.categories||[]).map(function(c){
        var sel=c.slug===o.category_slug?' selected="selected"':"";
        return '<option value="'+esc(c.slug)+'"'+sel+'>'+esc(c.title_cs||c.slug)+"</option>";
      }).join("");
      var modeOpts=(opts.creative_modes||[]).map(function(m){
        var sel=m.id===o.creative_mode?' selected="selected"':"";
        return '<option value="'+esc(m.id)+'"'+sel+'>'+esc(m.label_cs||m.id)+"</option>";
      }).join("");
      var posOpts=(opts.positions||[1,2,3,4,5,6,7,8]).map(function(p){
        var sel=Number(o.position)===Number(p)?' selected="selected"':"";
        return '<option value="'+esc(String(p))+'"'+sel+">P"+esc(String(p))+"</option>";
      }).join("");
      h+='<div class="modal-backdrop" role="dialog" aria-modal="true"><div class="modal-card modal-wide"><h3>Upravit objednávku</h3>'+
        '<div class="acct-cancel-grid">'+
        '<div class="full"><label>Obchodní firma / jméno podnikatele<input id="oe-company" type="text" value="'+esc(o.company_name||"")+'"></label></div>'+
        '<div><label>IČO<input id="oe-ico" type="text" value="'+esc(o.ico||"")+'"></label></div>'+
        '<div><label>DIČ<input id="oe-dic" type="text" value="'+esc(o.dic||"")+'"></label></div>'+
        '<div><label>Kontaktní osoba<input id="oe-contact" type="text" value="'+esc(o.contact_person_name||o.contact_name||"")+'"></label></div>'+
        '<div><label>Osoba oprávněná objednat<input id="oe-ordering" type="text" value="'+esc(o.ordering_person_name||"")+'"></label></div>'+
        '<div><label>E-mail<input id="oe-email" type="email" value="'+esc(o.contact_email||"")+'"></label></div>'+
        '<div><label>Telefon<input id="oe-phone" type="text" value="'+esc(o.contact_phone||"")+'"></label></div>'+
        '<div class="full"><label>Ulice (fakturační adresa)<input id="oe-street" type="text" value="'+esc(o.billing_street||"")+'"></label></div>'+
        '<div><label>Město<input id="oe-city" type="text" value="'+esc(o.billing_city||"")+'"></label></div>'+
        '<div><label>PSČ<input id="oe-zip" type="text" value="'+esc(o.billing_zip||"")+'"></label></div>'+
        '<div><label>Země<input id="oe-country" type="text" value="'+esc(o.billing_country||"CZ")+'"></label></div>'+
        '<div><label>Reklamní kategorie<select id="oe-category">'+catOpts+'</select></label></div>'+
        '<div><label>Reklamní pozice<select id="oe-position">'+posOpts+'</select></label></div>'+
        '<div class="full"><label>Název reklamy<input id="oe-ad-title" type="text" value="'+esc(o.ad_title||"")+'"></label></div>'+
        '<div class="full"><label>Cílová URL<input id="oe-url" type="url" value="'+esc(o.target_url||"")+'"></label></div>'+
        '<div><label>Režim kreativy<select id="oe-mode">'+modeOpts+'</select></label></div>'+
        '<div><label>Cena reklamní služby (Kč)<input id="oe-price" type="text" inputmode="decimal" value="'+esc(o.price_cents!=null?String(Number(o.price_cents)/100).replace(".",","):"")+'"></label></div>'+
        '<div><label>Začátek reklamního období<input id="oe-svc-start" type="datetime-local" value="'+esc(isoToDatetimeLocal(o.service_start_at||""))+'"></label></div>'+
        '<div><label>Konec reklamního období<input id="oe-svc-end" type="datetime-local" value="'+esc(isoToDatetimeLocal(o.service_end_at||""))+'"></label></div>'+
        '<div class="full"><label>Nový reklamní podklad (volitelné)<input id="oe-creative-file" type="file" accept="image/png,image/jpeg,image/webp"></label>'+
        (o.creative_id?'<p class="muted">Aktuální kreativa: '+esc(o.creative_id)+"</p>":"")+
        '</div>'+
        '<div class="full"><label>Poznámka zákazníka<textarea id="oe-note" rows="2">'+esc(o.note_client||"")+'</textarea></label></div>'+
        '</div><p class="muted">Uložením vznikne nová verze potvrzení objednávky. Vystavená faktura se nemění.</p>'+
        (em.formError?'<p class="err">'+esc(em.formError)+'</p>':"")+
        '<div class="row"><button type="button" class="btn" id="oe-save" '+(em.submitBusy?"disabled":"")+'>Uložit změny</button> '+
        '<button type="button" class="btn secondary" id="oe-cancel">Zrušit</button></div></div></div>';
    }
    var tr=state.testDataResetModal;
    if(tr){
      h+='<div class="modal-backdrop" role="dialog" aria-modal="true"><div class="modal-card modal-wide"><h3>Vyčistit všechny testovací záznamy</h3>'+
        '<p class="err">Nevratné odstranění všech prémiových objednávek, kampaní, dokumentů a souvisejících dat v D1/R2.</p>'+
        '<p class="muted">Zadejte přesně: <strong>VYMAZAT TESTOVACI DATA</strong></p>'+
        '<p><label>Potvrzení<input id="tr-phrase" type="text" autocomplete="off" value="'+esc(tr.phrase||"")+'"></label></p>'+
        '<p><label><input type="checkbox" id="tr-ack" '+(tr.ack?"checked":"")+'> Beru na vědomí, že jde o nevratnou operaci a všechny dosavadní testovací objednávky budou odstraněny.</label></p>'+
        (tr.formError?'<p class="err">'+esc(tr.formError)+'</p>':"")+
        '<div class="row"><button type="button" class="btn danger" id="tr-confirm" '+(tr.submitBusy?"disabled":"")+'>Provést reset</button> '+
        '<button type="button" class="btn secondary" id="tr-cancel">Zrušit</button></div></div></div>';
    }
    var pu=state.purgeOrderModal;
    if(pu&&pu.detail){
      var po=pu.detail.order||{};
      h+='<div class="modal-backdrop" role="dialog" aria-modal="true"><div class="modal-card modal-wide"><h3>Odstranit celý záznam ze systému</h3>'+
        '<p class="err">Nevratné odstranění testovacího případu včetně PDF a metadat.</p>'+
        '<ul><li><strong>'+esc(po.customer_order_code||po.order_number||pu.orderId)+'</strong></li>'+
        '<li>'+esc(po.company_name||"—")+' · IČO '+esc(po.ico||"—")+'</li>'+
        '<li>'+esc(po.category_title_cs||"—")+' · '+esc(po.position_label||"—")+'</li>'+
        '<li>Dokumentů: '+esc(String(pu.docCount||0))+'</li></ul>'+
        '<p><label><input type="checkbox" id="pu-test-ack"> Potvrzuji, že jde o testovací záznam bez úhrady, který lze fyzicky odstranit (ne archivovat).</label></p>'+
        (pu.formError?'<p class="err">'+esc(pu.formError)+'</p>':"")+
        '<div class="row"><button type="button" class="btn danger" id="pu-confirm" '+(pu.submitBusy?"disabled":"")+'>Definitivně odstranit</button> '+
        '<button type="button" class="btn secondary" id="pu-cancel">Zrušit</button></div></div></div>';
    }
    var rc=state.rejectedCreditModal;
    if(rc&&rc.detail){
      var inv=rc.detail.invoice;
      var remain=rc.detail.invoice_accounting?Number(rc.detail.invoice_accounting.remaining_correctable_cents||inv.total_cents):Number(inv.total_cents);
      h+='<div class="modal-backdrop" role="dialog" aria-modal="true"><div class="modal-card modal-wide"><h3>Dobropis u zamítnuté objednávky</h3>'+
        '<p>Faktura '+esc(inv.invoice_number)+' · max. '+esc(formatKc(remain))+'</p>'+
        '<p><label>Částka ke stornování (Kč)<input id="rc-storno" type="text" inputmode="decimal" value="'+esc(rc.form.storno_kc||"")+'"></label></p>'+
        '<p><label>Důvod<textarea id="rc-reason" rows="3">'+esc(rc.form.reason||"")+'</textarea></label></p>'+
        (rc.formError?'<p class="err">'+esc(rc.formError)+'</p>':"")+
        '<div class="row"><button type="button" class="btn danger" id="rc-save" '+(rc.submitBusy?"disabled":"")+'>Vystavit dobropis</button> '+
        '<button type="button" class="btn secondary" id="rc-cancel">Zrušit</button></div></div></div>';
    }
    return h;
  }
  function isoToDatetimeLocal(iso){
    if(!iso) return "";
    var d=new Date(iso);
    if(isNaN(d.getTime())) return "";
    var p=function(n){ return (n<10?"0":"")+n; };
    return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+"T"+p(d.getHours())+":"+p(d.getMinutes());
  }
  function wireAuxiliaryModals(){
    var trOpen=el("premium-test-reset-open");
    if(trOpen) trOpen.onclick=function(){ state.testDataResetModal={phrase:"",ack:false,submitBusy:false}; render(); };
    var trCancel=el("tr-cancel");
    if(trCancel) trCancel.onclick=function(){ state.testDataResetModal=null; render(); };
    var trConfirm=el("tr-confirm");
    if(trConfirm) trConfirm.onclick=async function(){
      var m=state.testDataResetModal; if(!m||m.submitBusy) return;
      m.phrase=val("tr-phrase").trim();
      m.ack=!!(el("tr-ack")&&el("tr-ack").checked);
      if(!m.ack){ m.formError="Zaškrtněte potvrzení nevratné operace."; render(); return; }
      if(m.phrase.toUpperCase()!=="VYMAZAT TESTOVACI DATA"){ m.formError="Neplatná potvrzovací fráze."; render(); return; }
      m.submitBusy=true; m.formError=""; render();
      var r=await api("/v1/admin/premium/test-data/reset",{method:"POST",body:JSON.stringify({confirm:true,confirm_phrase:m.phrase})});
      m.submitBusy=false;
      if(!r.res.ok){ m.formError=r.body&&r.body.message_cs?r.body.message_cs:apiError(r.body); render(); return; }
      state.testDataResetModal=null;
      state.orderDetailId=null;
      state.flash=r.body&&r.body.message_cs?r.body.message_cs:"Reset testovacích dat dokončen.";
      await loadNav();
      render();
    };
    var c=el("oe-cancel"); if(c) c.onclick=function(){ state.orderEditModal=null; render(); };
    var es=el("oe-save");
    if(es) es.onclick=async function(){
      var m=state.orderEditModal; if(!m||m.submitBusy) return;
      m.submitBusy=true; render();
      var ord=m.detail&&m.detail.order||{};
      var creativeId=ord.creative_id||null;
      var fileInput=el("oe-creative-file");
      if(fileInput&&fileInput.files&&fileInput.files[0]){
        var f=fileInput.files[0];
        var b64=await new Promise(function(resolve,reject){
          var reader=new FileReader();
          reader.onload=function(){ var s=String(reader.result||""); resolve(s.indexOf(",")>=0?s.split(",")[1]:s); };
          reader.onerror=reject;
          reader.readAsDataURL(f);
        });
        var up=await api("/v1/admin/creatives",{method:"POST",body:JSON.stringify({
          client_id:ord.client_id,
          campaign_id:ord.published_campaign_id||null,
          format:"image",
          filename:f.name,
          declared_mime:f.type||"image/png",
          content_base64:b64,
          device_category:"universal"
        })});
        if(!up.res.ok){ m.submitBusy=false; m.formError=up.body&&up.body.message_cs?up.body.message_cs:apiError(up.body); render(); return; }
        creativeId=up.body&&up.body.creative_id?up.body.creative_id:creativeId;
      }
      var svcStart=el("oe-svc-start")&&el("oe-svc-start").value;
      var svcEnd=el("oe-svc-end")&&el("oe-svc-end").value;
      var body={
        company_name:el("oe-company")&&el("oe-company").value,
        ico:el("oe-ico")&&el("oe-ico").value,
        dic:el("oe-dic")&&el("oe-dic").value,
        contact_person:el("oe-contact")&&el("oe-contact").value,
        ordering_person_name:el("oe-ordering")&&el("oe-ordering").value,
        client_contact_email:el("oe-email")&&el("oe-email").value,
        contact_phone:el("oe-phone")&&el("oe-phone").value,
        billing_street:el("oe-street")&&el("oe-street").value,
        billing_city:el("oe-city")&&el("oe-city").value,
        billing_zip:el("oe-zip")&&el("oe-zip").value,
        billing_country:el("oe-country")&&el("oe-country").value,
        category_slug:el("oe-category")&&el("oe-category").value,
        position:el("oe-position")&&Number(el("oe-position").value),
        ad_title:el("oe-ad-title")&&el("oe-ad-title").value,
        target_url:el("oe-url")&&el("oe-url").value,
        creative_mode:el("oe-mode")&&el("oe-mode").value,
        creative_id:creativeId,
        price_kc:el("oe-price")&&el("oe-price").value,
        note_client:el("oe-note")&&el("oe-note").value,
        service_start_at:svcStart?new Date(svcStart).toISOString():undefined,
        service_end_at:svcEnd?new Date(svcEnd).toISOString():undefined
      };
      var r=await api("/v1/admin/premium/orders/"+encodeURIComponent(m.orderId)+"/amend",{method:"POST",body:JSON.stringify(body)});
      m.submitBusy=false;
      if(r.res.ok){ state.orderEditModal=null; state.flash="Objednávka upravena, potvrzení se generuje."; state.orderDetailId=m.orderId; render(); return; }
      m.formError=r.body&&r.body.message_cs?r.body.message_cs:apiError(r.body); render();
    };
    var pc=el("pu-cancel"); if(pc) pc.onclick=function(){ state.purgeOrderModal=null; render(); };
    var pcf=el("pu-confirm");
    if(pcf) pcf.onclick=async function(){
      var m=state.purgeOrderModal; if(!m||m.submitBusy) return;
      var ack=el("pu-test-ack");
      if(!ack||!ack.checked){ m.formError="Zaškrtněte potvrzení testovacího záznamu bez úhrady."; render(); return; }
      m.submitBusy=true; render();
      var r=await api("/v1/admin/premium/orders/"+encodeURIComponent(m.orderId)+"/delete",{method:"POST",body:JSON.stringify({confirm:true,purge_system_record:true,explicit_test_purge_confirmed:true})});
      m.submitBusy=false;
      if(r.res.ok){ state.purgeOrderModal=null; state.orderDetailId=null; state.flash="Záznam byl odstraněn ze systému."; await loadNav(); render(); return; }
      m.formError=r.body&&r.body.message_cs?r.body.message_cs:apiError(r.body); render();
    };
    var rcc=el("rc-cancel"); if(rcc) rcc.onclick=function(){ state.rejectedCreditModal=null; render(); };
    var rcs=el("rc-save");
    if(rcs) rcs.onclick=async function(){
      var m=state.rejectedCreditModal; if(!m||m.submitBusy) return;
      var storno=parseKcInputToCents(el("rc-storno")&&el("rc-storno").value);
      var reason=String(el("rc-reason")&&el("rc-reason").value||"").trim();
      if(!storno||reason.length<12){ m.formError="Zadejte částku a srozumitelný důvod."; render(); return; }
      m.submitBusy=true; render();
      var r=await api("/v1/admin/premium/orders/"+encodeURIComponent(m.orderId)+"/rejected-invoice-settlement",{
        method:"POST",body:JSON.stringify({reason:reason,correction_cents:-storno})
      });
      m.submitBusy=false;
      if(r.res.ok){ state.rejectedCreditModal=null; state.flash="Dobropis vystaven."; state.orderDetailId=m.orderId; render(); return; }
      m.formError=r.body&&r.body.message_cs?r.body.message_cs:apiError(r.body); render();
    };
  }
  function wirePremiumOrderInteractions(rowsById){
    rowsById=rowsById||{};
    function openDetail(id){
      if(!id) return;
      state.orderDetailId=id;
      state.publishConfirmRow=null;
      render();
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-order-open]"),function(node){
      function go(ev){
        if(ev.target && ev.target.closest && ev.target.closest("[data-stop-row]")) return;
        openDetail(node.getAttribute("data-order-open"));
      }
      node.addEventListener("click", go);
      node.addEventListener("keydown", function(ev){
        if(ev.key==="Enter" || ev.key===" "){ ev.preventDefault(); go(ev); }
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-premium-detail]"),function(b){
      b.onclick=function(ev){
        ev.stopPropagation();
        openDetail(b.getAttribute("data-premium-detail"));
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-premium-publish]"),function(b){
      b.onclick=function(ev){
        ev.stopPropagation();
        var id=b.getAttribute("data-premium-publish");
        state.publishConfirmRow=rowsById[id]||{order_id:id};
        render();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-premium-reject]"),function(b){
      b.onclick=async function(ev){
        ev.stopPropagation();
        var id=b.getAttribute("data-premium-reject");
        if(!id) return;
        var row=rowsById[id]||{};
        var ref=row.customer_order_code||row.order_number||id;
        var reason=window.prompt("Opravdu zamítnout objednávku "+ref+"?\n\nDůvod zamítnutí (povinný):","");
        if(reason===null) return;
        if(!String(reason).trim()){ state.flash="Zadejte důvod zamítnutí."; render(); return; }
        var r=await api("/v1/admin/premium/orders/"+encodeURIComponent(id)+"/reject",{method:"POST",body:JSON.stringify({reason:String(reason).trim()})});
        if(r.res.ok){
          state.flash=r.body&&r.body.accounting_invoice_settlement_required?
            "Objednávka zamítnuta. Existuje faktura — dobropis vystavte explicitně tlačítkem „Vystavit dobropis“.":
            "Objednávka zamítnuta.";
        } else {
          state.flash=(r.body&&r.body.message_cs)?r.body.message_cs:("Chyba: "+apiError(r.body));
        }
        await loadNav();
        render();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-premium-turn-off]"),function(b){
      b.onclick=async function(ev){
        ev.stopPropagation();
        var id=b.getAttribute("data-premium-turn-off");
        var ord=rowsById[id]||{};
        var ref=ord.customer_order_code||ord.order_number||id;
        var msg="Vypnout reklamu (definitivně)?\n\n"+
          "Objednávka: "+ref+"\n"+
          "Zákazník: "+(ord.company_name||"—")+"\n"+
          "Kategorie: "+(ord.category_title_cs||ord.category_slug||"—")+"\n"+
          "Pozice: "+(ord.position_label||"—")+"\n"+
          "Stav kampaně: "+(ord.workflow_status_label_cs||ord.workflow_status||"—")+"\n\n"+
          "Reklama přestane být veřejně dostupná a pozice se uvolní.\nObjednávka a faktura zůstanou beze změny.";
        if(!window.confirm(msg)) return;
        var reason=window.prompt("Důvod vypnutí reklamy (povinný):","");
        if(reason===null) return;
        if(!String(reason).trim()){ state.flash="Zadejte důvod vypnutí."; render(); return; }
        var r=await api("/v1/admin/premium/orders/"+encodeURIComponent(id)+"/turn-off-ad",{method:"POST",body:JSON.stringify({reason:String(reason).trim()})});
        state.flash=r.res.ok?(r.body&&r.body.idempotent?"Reklama již byla vypnutá.":"Reklama vypnuta, pozice uvolněna."):(r.body&&r.body.message_cs?r.body.message_cs:"Chyba: "+apiError(r.body));
        if(r.res.ok){
          state.orderDetailId=id;
          if(rowsById[id]) rowsById[id].is_ad_turned_off=true;
        }
        await loadNav();
        render();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-premium-rejected-credit]"),function(b){
      b.onclick=async function(ev){
        ev.stopPropagation();
        var id=b.getAttribute("data-premium-rejected-credit");
        var detail=await api("/v1/admin/premium/orders/"+encodeURIComponent(id),{method:"GET",headers:{}});
        if(!detail.res.ok||!detail.body||!detail.body.invoice){ state.flash="U objednávky není faktura."; render(); return; }
        state.rejectedCreditModal={orderId:id,detail:detail.body,form:{storno_kc:"",reason:""},submitBusy:false,formError:null};
        render();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-premium-accounting-cancel]"),function(b){
      b.onclick=async function(ev){
        ev.stopPropagation();
        var id=b.getAttribute("data-premium-accounting-cancel");
        var detail=await api("/v1/admin/premium/orders/"+encodeURIComponent(id),{method:"GET",headers:{}});
        if(!detail.res.ok){ state.flash="Nelze načíst detail objednávky."; render(); return; }
        var acct=detail.body&&detail.body.invoice_accounting;
        var suggested=acct&&acct.suggested_payment_settlement?acct.suggested_payment_settlement:"unpaid";
        state.accountingCancelModal={
          orderId:id,
          detail:detail.body,
          form:{payment_settlement:suggested,storno_kc:"",paid_kc:"",reason:""},
          submitBusy:false,
          formError:null
        };
        render();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-premium-suspend]"),function(b){
      b.onclick=async function(ev){
        ev.stopPropagation();
        var id=b.getAttribute("data-premium-suspend");
        var reason=window.prompt("Důvod pozastavení reklamy:","");
        if(reason===null) return;
        var r=await api("/v1/admin/premium/orders/"+encodeURIComponent(id)+"/suspend",{method:"POST",body:JSON.stringify({reason:String(reason||"").trim()})});
        state.flash=r.res.ok?"Reklama pozastavena.":"Chyba: "+apiError(r.body);
        if(r.res.ok) state.orderDetailId=id;
        render();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-premium-resume]"),function(b){
      b.onclick=async function(ev){
        ev.stopPropagation();
        var id=b.getAttribute("data-premium-resume");
        if(!window.confirm("Znovu spustit reklamu?")) return;
        var r=await api("/v1/admin/premium/orders/"+encodeURIComponent(id)+"/reactivate",{method:"POST",body:"{}"});
        state.flash=r.res.ok?"Reklama znovu spuštěna.":"Chyba: "+apiError(r.body);
        if(r.res.ok) state.orderDetailId=id;
        render();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-premium-extend]"),function(b){
      b.onclick=async function(ev){
        ev.stopPropagation();
        var id=b.getAttribute("data-premium-extend");
        if(!id) return;
        var detail=await api("/v1/admin/premium/orders/"+encodeURIComponent(id),{method:"GET",headers:{}});
        if(!detail.res.ok){ state.flash=apiError(detail.body); render(); return; }
        var ord=detail.body&&detail.body.order||{};
        var sug=detail.body&&detail.body.extend_suggested_period||{};
        var ps=sug.start_at?String(sug.start_at).slice(0,10):"";
        var pe=sug.end_at?String(sug.end_at).slice(0,10):"";
        state.extendNewOrderModal={
          orderId:id,
          detail:detail.body,
          form:{
            period_start:ps,
            period_end:pe,
            price_kc:sug.price_kc||"",
            target_url:ord.target_url||""
          },
          submitBusy:false,
          formError:null
        };
        render();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-premium-pay]"),function(b){
      b.onclick=async function(ev){
        ev.stopPropagation();
        var id=b.getAttribute("data-premium-pay");
        if(!window.confirm("Potvrdit úhradu faktury u této objednávky?")) return;
        var r=await api("/v1/admin/premium/orders/"+encodeURIComponent(id)+"/payment",{method:"PATCH",body:JSON.stringify({payment_status:"paid"})});
        state.flash=r.res.ok?"Úhrada faktury potvrzena.":"Chyba: "+apiError(r.body);
        if(r.res.ok) state.orderDetailId=id;
        render();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-premium-unpay]"),function(b){
      b.onclick=async function(ev){
        ev.stopPropagation();
        var id=b.getAttribute("data-premium-unpay");
        if(!window.confirm("Označit objednávku jako neuhrazeno?")) return;
        var r=await api("/v1/admin/premium/orders/"+encodeURIComponent(id)+"/payment",{method:"PATCH",body:JSON.stringify({payment_status:"unpaid"})});
        state.flash=r.res.ok?"Označeno neuhrazeno.":"Chyba: "+apiError(r.body);
        if(r.res.ok) state.orderDetailId=id;
        render();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-premium-delete]"),function(b){
      b.onclick=async function(ev){
        ev.stopPropagation();
        var id=b.getAttribute("data-premium-delete");
        if(!id) return;
        if(isMainAdminUser()){
          var detail=await api("/v1/admin/premium/orders/"+encodeURIComponent(id),{method:"GET",headers:{}});
          var docs=detail.body&&detail.body.order_documents||[];
          state.purgeOrderModal={orderId:id,detail:detail.body||{},docCount:docs.length,submitBusy:false,formError:null};
          render();
          return;
        }
        if(!window.confirm("Odstranit objednávku? Tato akce je nevratná (u účetních záznamů proběhne archivace).")) return;
        var reason=window.prompt("Důvod (volitelné):","");
        if(reason===null) return;
        var r=await api("/v1/admin/premium/orders/"+encodeURIComponent(id)+"/delete",{method:"POST",body:JSON.stringify({confirm:true,reason:String(reason||"").trim()})});
        state.flash=r.res.ok?(r.body&&r.body.message_cs?r.body.message_cs:"Objednávka odstraněna."):"Chyba: "+apiError(r.body);
        if(r.res.ok){ state.orderDetailId=null; await loadNav(); }
        render();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-premium-edit]"),function(b){
      b.onclick=async function(ev){
        ev.stopPropagation();
        var id=b.getAttribute("data-premium-edit");
        var detail=await api("/v1/admin/premium/orders/"+encodeURIComponent(id),{method:"GET",headers:{}});
        if(!detail.res.ok){ state.flash="Nelze načíst objednávku."; render(); return; }
        var o=detail.body&&detail.body.order||{};
        if(!o.order_amend_allowed){
          state.flash="Úprava je dostupná až po schválení, zveřejnění a vytvoření potvrzení objednávky.";
          render(); return;
        }
        state.orderEditModal={orderId:id,detail:detail.body,submitBusy:false,formError:null};
        render();
      };
    });
    var noteBtn=el("premium-add-note-btn");
    if(noteBtn){
      noteBtn.onclick=async function(){
        var id=noteBtn.getAttribute("data-order-id");
        var ta=el("premium-note-text");
        var text=ta&&ta.value?String(ta.value).trim():"";
        if(!text){ state.flash="Zadejte text poznámky."; render(); return; }
        var r=await api("/v1/admin/premium/orders/"+encodeURIComponent(id)+"/notes",{method:"POST",body:JSON.stringify({body_text:text})});
        state.flash=r.res.ok?"Poznámka přidána.":"Chyba: "+apiError(r.body);
        if(r.res.ok) state.orderDetailId=id;
        render();
      };
    }
    var cancel=el("premium-publish-cancel");
    if(cancel) cancel.onclick=function(){ state.publishConfirmRow=null; render(); };
    Array.prototype.forEach.call(document.querySelectorAll("[data-premium-doc-preview]"),function(b){
      b.onclick=async function(ev){
        ev.stopPropagation();
        await openPremiumOrderDocument(b.getAttribute("data-premium-doc-preview"), b.getAttribute("data-doc-kind"), "inline", b.getAttribute("data-doc-version"));
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-premium-doc-download]"),function(b){
      b.onclick=async function(ev){
        ev.stopPropagation();
        await openPremiumOrderDocument(b.getAttribute("data-premium-doc-download"), b.getAttribute("data-doc-kind"), "attachment", b.getAttribute("data-doc-version"));
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-premium-doc-retry]"),function(b){
      b.onclick=async function(ev){
        ev.stopPropagation();
        var id=b.getAttribute("data-premium-doc-retry");
        var r=await api("/v1/admin/premium/orders/"+encodeURIComponent(id)+"/documents/retry",{method:"POST",body:"{}"});
        state.flash=r.res.ok?"Generování dokumentů dokončeno.":"Chyba: "+apiError(r.body);
        if(r.res.ok) state.orderDetailId=id;
        render();
      };
    });
    var confirmBtn=el("premium-publish-confirm");
    if(confirmBtn) confirmBtn.onclick=async function(){
      var row=state.publishConfirmRow;
      if(!row||!row.order_id||state.publishBusy) return;
      state.publishBusy=true;
      confirmBtn.disabled=true;
      var r=await api("/v1/admin/premium/orders/"+encodeURIComponent(row.order_id)+"/approve-publish",{method:"POST",body:JSON.stringify({idempotency_key:"ui:"+row.order_id})});
      state.publishBusy=false;
      state.publishConfirmRow=null;
      var errMsg=apiError(r.body);
      if(r.body&&r.body.error==="missing_creative_or_url"&&Array.isArray(r.body.missing)){
        errMsg="Nelze zveřejnit — chybí: "+r.body.missing.map(function(f){return f==="creative"?"kreativa (upload)":"cílová URL";}).join(", ");
      }
      state.flash=r.res.ok?"Reklama schválena a zveřejněna.":"Chyba: "+errMsg;
      if(r.res.ok) state.orderDetailId=row.order_id;
      await loadNav();
      render();
    };
  }
  function premiumOrderDocActionsHtml(docOrderId, d){
    if(d.status==="ready"){
      return '<div class="order-doc-actions">'+
        '<button type="button" class="btn secondary" data-premium-doc-preview="'+esc(docOrderId)+'" data-doc-kind="'+esc(d.kind)+'">Náhled</button>'+
        '<button type="button" class="btn secondary" data-premium-doc-download="'+esc(docOrderId)+'" data-doc-kind="'+esc(d.kind)+'">Stáhnout</button>'+
        "</div>";
    }
    if(d.status==="error"){
      return '<div class="order-doc-actions"><button type="button" class="btn warning" data-premium-doc-retry="'+esc(docOrderId)+'" data-doc-kind="'+esc(d.kind)+'">Dokončit / opakovat PDF</button></div>';
    }
    return "";
  }
  function premiumOrderHistorySectionHtml(body){
    var groups=body.order_history_groups||[];
    if(!groups.length) return "";
    var blocks=groups.map(function(g){
      if(g.group_kind==="confirmation_amendments"){
        var revs=g.confirmation_revisions||[];
        if(!revs.length) return "";
        return '<section class="history-group"><h4>'+esc(g.title_cs||"Opravné verze potvrzení")+'</h4><ul class="history-list">'+
          revs.map(function(rv){
            var ver=rv.version!=null?String(rv.version):"";
            var oid=g.order_id;
            return "<li>Verze "+esc(String(rv.version||"—"))+" · "+esc(rv.created_at_label_cs||"—")+
              (rv.reason?" · "+esc(rv.reason):"")+
              ' <button type="button" class="btn secondary" data-premium-doc-preview="'+esc(oid)+'" data-doc-kind="order_confirmation" data-doc-version="'+esc(ver)+'">Náhled</button>'+
              ' <button type="button" class="btn secondary" data-premium-doc-download="'+esc(oid)+'" data-doc-kind="order_confirmation" data-doc-version="'+esc(ver)+'">Stáhnout</button></li>';
          }).join("")+"</ul></section>";
      }
      var docs=g.documents||[];
      var docHtml=docs.map(function(d){
        var statusMsg="";
        if(d.status==="error") statusMsg='<p class="err">'+esc(d.last_error||"Generování selhalo")+"</p>";
        else if(d.status!=="ready"){
          var stLabel={pending:"Ve frontě",generating:"Generuje se…",missing:"PDF zatím chybí — lze dokončit",error:"Chyba generování"}[d.status]||d.status;
          statusMsg='<p class="muted">Stav: '+esc(stLabel)+"</p>";
        }
        return '<div class="order-doc-item history-doc-item"><strong>'+esc(d.title)+'</strong><p class="muted">'+esc(d.subtitle)+"</p>"+statusMsg+
          premiumOrderDocActionsHtml(g.order_id,d)+"</div>";
      }).join("");
      var revBlock="";
      var hRevs=g.confirmation_revisions||[];
      if(hRevs.length){
        revBlock='<ul class="history-list">'+hRevs.map(function(rv){
          var ver=rv.version!=null?String(rv.version):"";
          return "<li>Verze potvrzení "+esc(String(rv.version||"—"))+" · "+esc(rv.created_at_label_cs||"—")+
            ' <button type="button" class="btn secondary" data-premium-doc-preview="'+esc(g.order_id)+'" data-doc-kind="order_confirmation" data-doc-version="'+esc(ver)+'">Náhled</button>'+
            ' <button type="button" class="btn secondary" data-premium-doc-download="'+esc(g.order_id)+'" data-doc-kind="order_confirmation" data-doc-version="'+esc(ver)+'">Stáhnout</button></li>';
        }).join("")+"</ul>";
      }
      return '<section class="history-group"><h4>'+esc(g.order_reference||g.order_id)+"</h4>"+
        '<p class="muted">Období: '+esc(g.service_period_label_cs||"—")+" · Vytvořeno: "+esc(g.created_at_label_cs||"—")+
        (g.invoice_number?" · Faktura "+esc(g.invoice_number):"")+
        (g.invoice_payment_label_cs?" · "+esc(g.invoice_payment_label_cs):"")+
        (g.workflow_status_label_cs?" · "+esc(g.workflow_status_label_cs):"")+"</p>"+
        (docHtml?'<div class="order-doc-grid history-doc-grid">'+docHtml+"</div>":"")+
        revBlock+
        ' <button type="button" class="btn secondary" data-order-open="'+esc(g.order_id)+'">Otevřít objednávku</button></section>';
    }).join("");
    return '<div class="card"><h3>Historie</h3>'+blocks+"</div>";
  }
  function premiumOrderDocumentsSectionHtml(orderId, body){
    var docOrderId=body.documents_order_id||orderId;
    var docs=body.order_documents||[];
    var count=Number(body.order_documents_pdf_count)||0;
    var headRight=count>0?String(count)+" PDF":"";
    var chainHint=docOrderId!==orderId?'<p class="muted">Aktuální období řetězce — dokumenty nejnovější objednávky.</p>':"";
    if(!docs.length){
      var ws=body.order&&body.order.workflow_status;
      var emptyMsg=(ws==="rejected"||ws==="cancelled")
        ? "Dokumenty ke stornu nebo zamítnutí se dokončují — obnovte detail za chvíli, případně použijte dokončení PDF v administraci."
        : "Dokumenty vzniknou po schválení a zveřejnění reklamy.";
      return '<div class="card order-docs-card"><div class="order-docs-head"><h3>Dokumenty objednávky</h3></div>'+chainHint+'<p class="muted">'+esc(emptyMsg)+'</p></div>';
    }
    var cards="";
    docs.forEach(function(d){
      var statusMsg="";
      if(d.status==="error") statusMsg='<p class="err">'+esc(d.last_error||"Generování selhalo")+"</p>";
      else if(d.status!=="ready"){
        var stLabel={pending:"Ve frontě",generating:"Generuje se…",missing:"PDF zatím chybí — lze dokončit",error:"Chyba generování"}[d.status]||d.status;
        statusMsg='<p class="muted">Stav: '+esc(stLabel)+"</p>";
      }
      var actions="";
      if(d.status==="ready"){
        actions=premiumOrderDocActionsHtml(docOrderId,d);
      } else if(d.status==="error"){
        actions=premiumOrderDocActionsHtml(docOrderId,d);
      } else if(d.status==="missing"||d.status==="generating"||d.status==="pending"){
        statusMsg+='<p class="muted">PDF se dokončuje automaticky — obnovte detail za chvíli.</p>';
      }
      var icon=d.kind==="invoice_pdf"?"🧾":"📄";
      cards+='<div class="order-doc-item"><div class="order-doc-icon" aria-hidden="true">'+icon+'</div><div class="order-doc-body"><strong>'+esc(d.title)+'</strong><p class="muted">'+esc(d.subtitle)+"</p>"+statusMsg+actions+"</div></div>";
    });
    return '<div class="card order-docs-card"><div class="order-docs-head"><h3>Dokumenty objednávky</h3>'+
      (headRight?'<span class="order-docs-count">'+esc(headRight)+"</span>":"")+
      '</div>'+chainHint+'<div class="order-doc-grid">'+cards+"</div></div>";
  }
  function triggerPdfDownload(path, title){
    var a=document.createElement("a");
    a.href=path;
    a.rel="noopener noreferrer";
    a.target="_blank";
    var safe=String(title||"dokument").replace(/[^\w\d\-_. áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]+/g,"_").trim()||"dokument";
    if(!/\.pdf$/i.test(safe)) safe+=".pdf";
    a.download=safe;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  async function openAdminDocumentAccess(accessPath){
    var disposition="inline";
    try{
      var qIdx=accessPath.indexOf("?");
      if(qIdx>=0){
        var sp=new URLSearchParams(accessPath.slice(qIdx+1));
        if(sp.get("disposition")==="attachment") disposition="attachment";
      }
    }catch(_){}
    var popup=disposition==="inline"?window.open("about:blank","_blank"):null;
    if(popup){ try{ popup.opener=null; }catch(_){ } }
    var r=await api(accessPath,{method:"GET",headers:{}});
    if(!r.res.ok){
      if(popup){ try{ popup.close(); }catch(_){ } }
      state.flash="Dokument: "+apiError(r.body);
      render();
      return;
    }
    var path=r.body&&r.body.path;
    var title=r.body&&r.body.title;
    if(!path){
      if(popup){ try{ popup.close(); }catch(_){ } }
      state.flash="Chybí bezpečný odkaz na PDF.";
      render();
      return;
    }
    if(disposition==="attachment") triggerPdfDownload(path, title);
    else if(popup) popup.location.href=path;
    else window.location.href=path;
  }
  async function openPremiumOrderDocument(orderId, kind, disposition, version){
    var qs="disposition="+encodeURIComponent(disposition);
    if(version!=null&&String(version).trim()!=="") qs+="&version="+encodeURIComponent(String(version));
    await openAdminDocumentAccess("/v1/admin/premium/orders/"+encodeURIComponent(orderId)+"/documents/"+encodeURIComponent(kind)+"/access?"+qs);
  }
  async function renderPremiumOrderDetail(orderId){
    var d=await api("/v1/admin/premium/orders/"+encodeURIComponent(orderId),{method:"GET",headers:{}});
    if(!d.res.ok){ panel('<p class="err">'+esc(apiError(d.body))+'</p>'); return; }
    var body=d.body||{};
    var ord=body.order||{};
    var css=body.preview_css_href?'<link rel="stylesheet" href="'+esc(body.preview_css_href)+'">':"";
    if(body.preview_scoped_css){ css+='<style>'+String(body.preview_scoped_css)+"</style>"; }
    var modeLabel=ord.creative_mode_label_cs||ord.creative_mode||"";
    var tech='<details class="tech-ids"><summary>Technické údaje</summary><ul class="muted">'+
      "<li>Order ID: "+esc(ord.order_id)+"</li>"+
      "<li>Client ID: "+esc(ord.client_id)+"</li>"+
      (ord.creative_id?"<li>Creative ID: "+esc(ord.creative_id)+"</li>":"")+
      (ord.published_campaign_id?"<li>Campaign ID: "+esc(ord.published_campaign_id)+"</li>":"")+
      "<li>Placement: "+esc(ord.placement_id)+"</li></ul></details>";
    var orderActionsHtml="";
    if(ord.workflow_status!=="rejected"){
      orderActionsHtml=
      '<div class="card">'+tech+
      '<div class="row">'+
      (ord.workflow_status==="submitted"||ord.workflow_status==="under_review"?
        (ord.publishable?'<button type="button" class="btn" data-premium-publish="'+esc(ord.order_id)+'">Schválit a zveřejnit</button> ':"")+
        (ord.missing_publish_fields&&ord.missing_publish_fields.length?
          '<p class="err">Nelze zveřejnit — chybí: '+esc(ord.missing_publish_fields.map(function(f){return f==="creative"?"nahraná kreativa":"cílová URL";}).join(", "))+'</p>':"")+
        '<button type="button" class="btn danger" data-premium-reject="'+esc(ord.order_id)+'">Zamítnout</button> ':"")+
      (ord.workflow_status==="published"?
        (
          (ord.is_ad_turned_off?
            '<p class="muted">Reklama definitivně vypnuta'+(ord.ad_turned_off_at_label_cs?" · "+esc(ord.ad_turned_off_at_label_cs):"")+'.</p> ':
            (ord.is_paused?
              '<button type="button" class="btn success" data-premium-resume="'+esc(ord.order_id)+'">Znovu spustit reklamu</button> ':
              '<button type="button" class="btn warning" data-premium-suspend="'+esc(ord.order_id)+'">Pozastavit reklamu</button> ')+
            '<button type="button" class="btn danger" data-premium-turn-off="'+esc(ord.order_id)+'">Vypnout reklamu</button> ')+
          (!ord.is_ad_turned_off?
            (body.extend_new_order_allowed?
              '<button type="button" class="btn success" data-premium-extend="'+esc(ord.order_id)+'">Prodloužit reklamu</button> ':
              (body.extend_new_order_blocked_reason_cs?'<p class="muted">'+esc(body.extend_new_order_blocked_reason_cs)+"</p> ":"")):"")+
          (ord.invoice_issued?
            (ord.invoice_paid?
              '<span class="pay-status--paid">Faktura uhrazena</span> ':
              '<button type="button" class="btn success" data-premium-pay="'+esc(ord.order_id)+'">Potvrdit úhradu faktury</button> '):"")
        ):"")+
      (ord.workflow_status==="published"||ord.workflow_status==="cancelled"?
        (ord.workflow_status==="cancelled"?
          '<p class="muted">Objednávka a faktura stornovány (účetně).</p> ':
          (ord.is_ad_turned_off?
            '<button type="button" class="btn danger" data-premium-accounting-cancel="'+esc(ord.order_id)+'">Stornovat objednávku a fakturu</button> ':
            '<p class="muted">Před účetním stornem nejdříve vypněte reklamu.</p> ')):"")+
      (ord.order_amend_allowed?
        '<button type="button" class="btn secondary" data-premium-edit="'+esc(ord.order_id)+'">Upravit objednávku</button> ':"")+
      "</div></div>";
    }
    var termsCard="";
    if(ord.terms_version){
      termsCard='<div class="card"><h3>Souhlasy</h3><p class="muted">Premium podmínky: '+esc(ord.terms_version)+
      (ord.terms_effective_at?" · účinnost "+esc(ord.terms_effective_at):"")+"</p>"+
      (body.terms_archive_warning_cs?'<p class="err">'+esc(body.terms_archive_warning_cs)+"</p>":"")+
      (body.terms_archive_available?
        '<button type="button" class="btn secondary" id="premium-terms-view" data-order-id="'+esc(ord.order_id)+'">Zobrazit podmínky</button>':
        (body.terms_archive_warning_cs?"":'<p class="muted">Archiv podmínek se připravuje.</p>'))+
      "</div>";
    }
    panel(
      '<div class="card"><div class="row"><button type="button" class="btn secondary" id="order-detail-back">← Zpět na seznam</button></div>'+
      "<h2>"+esc(ord.customer_order_code||ord.order_number||"Objednávka")+" — "+esc(ord.company_name)+"</h2>"+
      premiumDetailStatusHeaderHtml(ord)+
      "</div>"+
      '<div class="card"><h3>Zákazník</h3><dl class="detail-dl">'+
      "<dt>Firma</dt><dd>"+esc(ord.company_name)+"</dd>"+
      "<dt>IČO</dt><dd>"+esc(ord.ico||"—")+"</dd>"+
      (ord.dic?"<dt>DIČ</dt><dd>"+esc(ord.dic)+"</dd>":"")+
      "<dt>Kontaktní osoba</dt><dd>"+esc(ord.contact_person_name||ord.contact_name||"—")+"</dd>"+
      "<dt>E-mail</dt><dd>"+esc(ord.contact_email||"—")+"</dd>"+
      (ord.contact_phone?"<dt>Telefon</dt><dd>"+esc(ord.contact_phone)+"</dd>":"")+
      "<dt>Fakturační údaje</dt><dd>"+esc(ord.billing_info||ord.address||"—").replace(/\n/g,"<br>")+"</dd>"+
      "<dt>Objednávající osoba</dt><dd>"+esc(ord.ordering_person_name||"—")+
      (ord.authorization_confirmed?' <span class="muted">(potvrzeno oprávnění objednat)</span>':"")+"</dd></dl></div>"+
      '<div class="card"><h3>Objednávka</h3><dl class="detail-dl">'+
      "<dt>Sekce</dt><dd>"+esc(ord.category_title_cs||ord.category_slug)+"</dd>"+
      "<dt>Pozice</dt><dd>"+esc(ord.position_label||("P"+ord.position))+"</dd>"+
      "<dt>Období</dt><dd>"+esc(ord.duration_months||6)+" měsíců</dd>"+
      "<dt>Cena</dt><dd>"+esc(ord.price_label_cs||"—")+"</dd>"+
      "<dt>Odesláno ke schválení a zveřejnění</dt><dd>"+esc(ord.submitted_at_label_cs||formatCsDate(ord.submitted_at))+" · objednatelem</dd>"+
      (ord.published_at_label_cs && ord.published_at_label_cs!=="—" ? '<dt>Schváleno a zveřejněno</dt><dd class="ts-published">'+esc(ord.published_at_label_cs)+"</dd>" : "")+
      (ord.campaign_end_at_label_cs && ord.campaign_end_at_label_cs!=="—" ? '<dt>Konec reklamy</dt><dd class="ts-end">'+esc(ord.campaign_end_at_label_cs)+"</dd>" : "")+
      "<dt>Stav</dt><dd>"+esc(ord.workflow_status_label_cs||ord.workflow_status)+"</dd></dl></div>"+
      '<div class="card"><h3>Reklama</h3><p>URL: <a href="'+esc(ord.target_url||"#")+'" rel="noopener" target="_blank">'+esc(ord.target_url||"")+'</a></p>'+
      '<p>Typ kreativy: <strong>'+esc(modeLabel)+"</strong></p>"+
      (ord.note_client?'<p>Poznámka: '+esc(ord.note_client)+"</p>":"")+
      (body.placement_conflict&&body.placement_conflict.foreign_owner?'<p class="err">Skutečný konflikt placementu — aktivní cizí kampaň.</p>':"")+
      (body.publication_visibility?'<dl class="detail-dl">'+
        "<dt>Schválená objednávka (zveřejněno)</dt><dd>"+(body.publication_visibility.order_approved_published?"Ano":"Ne")+"</dd>"+
        "<dt>Publikovaná kampaň na pozici</dt><dd>"+esc(body.publication_visibility.placement_active_campaign_id||"—")+"</dd>"+
        "<dt>Očekáváno ve veřejném výstupu</dt><dd>"+(body.publication_visibility.expected_in_public_output?"Ano":"Ne")+"</dd>"+
        "<dt>Veřejný výstup ověřen (DB)</dt><dd>"+(body.publication_visibility.public_output_verified?"Ano":"Ne")+"</dd>"+
        (body.publication_visibility.consistency_mismatch?'<dt class="err">Nesoulad</dt><dd class="err">'+esc(body.publication_visibility.mismatch_reason_cs||"Ano")+"</dd>":"")+
        "</dl>":"")+
      '<div class="preview-box">'+String(body.preview_html||"")+"</div></div>"+
      termsCard+
      orderActionsHtml+
      premiumOrderDocumentsSectionHtml(ord.order_id, body)+
      premiumOrderHistorySectionHtml(body)+
      '<div class="card"><h3>Interní poznámky</h3>'+
      (body.internal_notes&&body.internal_notes.length?
        '<ul class="history-list">'+body.internal_notes.map(function(n){
          return "<li><strong>"+esc(n.created_at_label_cs||formatCsDate(n.created_at))+"</strong><br>"+esc(n.body_text)+"</li>";
        }).join("")+"</ul>":'<p class="muted empty">Zatím žádné interní poznámky.</p>')+
      '<label for="premium-note-text">Nová poznámka</label><textarea id="premium-note-text" rows="3" maxlength="4000"></textarea>'+
      '<button type="button" class="btn secondary" id="premium-add-note-btn" data-order-id="'+esc(ord.order_id)+'">Přidat poznámku</button></div>'+
      (body.history&&body.history.length?'<div class="card"><h3>Historie objednávky</h3><ul class="history-list">'+
        body.history.map(function(h){ return "<li><strong>"+esc(h.created_at_label_cs)+"</strong> — "+esc(h.summary_cs)+"</li>"; }).join("")+
        "</ul></div>":"")+
      css+publishConfirmDialogHtml(state.publishConfirmRow)+accountingCancelModalHtml()+extendNewOrderModalHtml()+auxiliaryModalsHtml()
    );
    el("order-detail-back").onclick=function(){ state.orderDetailId=null; render(); };
    var termsView=el("premium-terms-view");
    if(termsView){
      termsView.onclick=function(){
        var oid=termsView.getAttribute("data-order-id");
        if(!oid) return;
        window.open("/v1/admin/premium/orders/"+encodeURIComponent(oid)+"/terms-archive","_blank","noopener,noreferrer");
      };
    }
    var rowsById={}; rowsById[ord.order_id]=ord;
    wirePremiumOrderInteractions(rowsById);
    wireAccountingCancelModal();
    wireExtendNewOrderModal();
    wireAuxiliaryModals();
    var renderJs=body.preview_render_js_href;
    if(renderJs){
      var host=el("panel");
      function initPreviewCreative(){
        var slot=host&&host.querySelector(".iuPremiumSlot--preview");
        var img=slot&&slot.querySelector("img.iuPremiumSlotImg");
        if(slot&&img&&window.iuPremiumCreativeRender){
          window.iuPremiumCreativeRender.bindPremiumCreativeImage(slot,img,ord.creative_mode||"logo");
        }
      }
      if(window.iuPremiumCreativeRender){ initPreviewCreative(); }
      else {
        var existing=document.getElementById("iu-premium-creative-render-js");
        if(!existing){
          var s=document.createElement("script");
          s.id="iu-premium-creative-render-js";
          s.src=renderJs;
          s.onload=initPreviewCreative;
          document.head.appendChild(s);
        } else if(window.iuPremiumCreativeRender) initPreviewCreative();
      }
    }
  }
  function premiumOrdersFilterBarHtml(){
    var f=state.premiumFilters||{};
    return '<div class="card filters-card"><h3>Filtry objednávek</h3>'+
      '<div class="filter-grid">'+
      '<label>Hledat<input id="premium-filter-q" type="search" value="'+esc(f.q||"")+'" placeholder="firma, IČO, kód, kontakt, e-mail"></label>'+
      sel("premium-filter-bucket","Stav",[
        ["","Vše"],
        ["pending_review","Čeká na posouzení"],
        ["published_active","Schváleno a zveřejněno"],
        ["ad_turned_off","Vypnuto administrátorem"],
        ["paused","Pozastaveno"],
        ["ended","Ukončeno"],
        ["rejected","Zamítnuto"]
      ],f.filter||"")+
      sel("premium-filter-payment","Platba",[["","Vše"],["unpaid","Neuhrazeno"],["paid","Uhrazeno"]],f.payment||"")+
      sel("premium-filter-ending","Konec do",[
        ["","—"],
        ["30","30 dnů"],
        ["14","14 dnů"],
        ["7","7 dnů"]
      ],f.ending_days||"")+
      sel("premium-filter-position","Pozice",[
        ["","Vše"],["1","P1"],["2","P2"],["3","P3"],["4","P4"],["5","P5"],["6","P6"],["7","P7"],["8","P8"]
      ],f.position||"")+
      '<label>Sekce (slug)<input id="premium-filter-category" type="text" value="'+esc(f.category||"")+'" placeholder="např. cestovni-kancelare"></label>'+
      '</div><div class="row"><button type="button" class="btn" id="premium-filter-apply">Použít filtry</button></div></div>';
  }
  function premiumSummaryWidgetsHtml(s){
    if(!s||typeof s!=="object") return "";
    return '<div class="widgets">'+[
      ["Čeká na schválení",s.pending_review],
      ["Aktivní",s.active_published],
      ["Pozastavené",s.paused],
      ["Končí do 30 dnů",s.ending_within_30_days],
      ["Neuhrazené",s.unpaid]
    ].map(function(pair){
      return '<div class="widget"><div class="widget-k">'+esc(pair[0])+'</div><div class="widget-v">'+esc(String(pair[1]||0))+'</div></div>';
    }).join("")+"</div>";
  }
  async function renderAllAdOrdersAdmin(){
    if(state.orderDetailId) { await renderPremiumOrderDetail(state.orderDetailId); return; }
    var f=state.premiumFilters||{};
    var qs=new URLSearchParams();
    if(f.q) qs.set("q",f.q);
    if(f.filter) qs.set("filter",f.filter);
    if(f.payment) qs.set("payment",f.payment);
    if(f.category) qs.set("category",f.category);
    if(f.position) qs.set("position",f.position);
    if(f.ending_days) qs.set("ending_days",f.ending_days);
    if(f.ad_product) qs.set("ad_product",f.ad_product);
    var path="/v1/admin/ad-orders"+(qs.toString()?"?"+qs.toString():"");
    var po=await api(path,{method:"GET",headers:{}});
    if(!po.res.ok){ panel('<p class="err">'+esc(apiError(po.body))+'</p>'); return; }
    var rows=(po.body&&po.body.orders)||[];
    var rowsById={};
    rows.forEach(function(r){ rowsById[r.order_id]=r; });
    panel('<div class="card"><h2>Všechny objednávky</h2><p class="muted">Společný přehled reklamních objednávek napříč produkty.</p></div>'+
      premiumOrdersFilterBarHtml()+
      '<details class="card"><summary class="muted">Reklamní produkt</summary>'+
      sel("all-orders-ad-product","Produkt",[
        ["","Všechny reklamní produkty"],
        ["premium_buttons","Reklamní tlačítka – Vybrané služby a odkazy (PC, mobil, tablet)"],
        ["banner_pc_right","Bannerová reklama – pravý sloupec PC"]
      ],f.ad_product||"")+'</details>'+
      '<div class="card">'+premiumOrdersTableHtml(rows,{showAdMeta:true})+premiumOrdersCardsHtml(rows,{showAdMeta:true})+"</div>"+
      publishConfirmDialogHtml(state.publishConfirmRow)+accountingCancelModalHtml()+extendNewOrderModalHtml()+auxiliaryModalsHtml());
    var apply=el("premium-filter-apply");
    if(apply) apply.onclick=function(){
      state.premiumFilters={
        q:val("premium-filter-q").trim(),
        filter:val("premium-filter-bucket"),
        payment:val("premium-filter-payment"),
        category:val("premium-filter-category").trim(),
        position:val("premium-filter-position"),
        ending_days:val("premium-filter-ending"),
        ad_product:val("all-orders-ad-product")
      };
      render();
    };
    wirePremiumOrderInteractions(rowsById);
    wireAccountingCancelModal();
    wireExtendNewOrderModal();
    wireAuxiliaryModals();
  }
  async function renderPremiumOrdersAdmin(){
    if(state.orderDetailId) { await renderPremiumOrderDetail(state.orderDetailId); return; }
    var f=state.premiumFilters||{};
    var qs=new URLSearchParams();
    if(f.q) qs.set("q",f.q);
    if(f.filter) qs.set("filter",f.filter);
    if(f.payment) qs.set("payment",f.payment);
    if(f.category) qs.set("category",f.category);
    if(f.position) qs.set("position",f.position);
    if(f.ending_days) qs.set("ending_days",f.ending_days);
    var path="/v1/admin/premium/orders"+(qs.toString()?"?"+qs.toString():"");
    var sumPo=await Promise.all([
      api("/v1/admin/premium/orders/summary",{method:"GET",headers:{}}),
      api(path,{method:"GET",headers:{}})
    ]);
    var sum=sumPo[0];
    var po=sumPo[1];
    if(!po.res.ok){ panel('<p class="err">'+esc(apiError(po.body))+'</p>'); return; }
    var rows=(po.body&&po.body.premium_orders)||[];
    var rowsById={};
    rows.forEach(function(r){ rowsById[r.order_id]=r; });
    var resetBar=isMainAdminUser()?('<div class="card"><h3>Testovací data (hlavní administrátor)</h3><p class="muted">Jednorázově odstraní všechny prémiové objednávky, kampaně, PDF a související provozní záznamy. Katalog P1–P8 a administrace zůstanou.</p>'+
      '<button type="button" class="btn danger" id="premium-test-reset-open">Vyčistit všechny testovací záznamy</button></div>'):"";
    panel('<div class="card"><h2>Reklamní tlačítka – Vybrané služby a odkazy (PC, mobil, tablet)</h2><p class="muted">Prémiová tlačítka P1–P8. Schválení a zveřejnění = okamžitá publikace na InfoUzel.cz.</p>'+
      premiumSummaryWidgetsHtml(sum.body)+"</div>"+resetBar+
      premiumOrdersFilterBarHtml()+
      '<div class="card">'+premiumOrdersTableHtml(rows)+premiumOrdersCardsHtml(rows)+"</div>"+publishConfirmDialogHtml(state.publishConfirmRow)+accountingCancelModalHtml()+extendNewOrderModalHtml()+auxiliaryModalsHtml());
    var apply=el("premium-filter-apply");
    if(apply) apply.onclick=function(){
      state.premiumFilters={
        q:val("premium-filter-q").trim(),
        filter:val("premium-filter-bucket"),
        payment:val("premium-filter-payment"),
        category:val("premium-filter-category").trim(),
        position:val("premium-filter-position"),
        ending_days:val("premium-filter-ending")
      };
      render();
    };
    wirePremiumOrderInteractions(rowsById);
    wireAccountingCancelModal();
    wireExtendNewOrderModal();
    wireAuxiliaryModals();
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
  function opsDashboardHtml(body){
    var ops=body&&body.ops_v1;
    if(!ops||typeof ops!=="object") return widgetsHtml(body&&body.widgets);
    function pushKpi(label,value,cls,clickAttr){
      cls=cls||"";
      var click=clickAttr?' data-dash-nav="'+esc(clickAttr)+'" role="button" tabindex="0"':"";
      return '<div class="widget'+cls+'"'+click+'><div class="widget-k">'+esc(label)+'</div><div class="widget-v">'+esc(value)+"</div></div>";
    }
    var cards=[];
    var pending=ops.new_orders_pending||{};
    cards.push(pushKpi("Nové objednávky",String(pending.count||0),pending.highlight?" widget--alert":"",pending.count>0?"premium:pending_review":""));
    var pay=ops.awaiting_payment||{};
    cards.push(pushKpi("Čekají na platbu",(pay.count||0)+" · "+formatKc(pay.total_unpaid_cents||0),"","premium:payment:unpaid"));
    cards.push(pushKpi("Aktivní reklamní tlačítka",String((ops.active_premium_buttons&&ops.active_premium_buttons.count)||0),"","premium:published_active"));
    var banners=ops.active_banners||{};
    cards.push(pushKpi("Aktivní bannery",(banners.status_cs||"0")+" ("+String(banners.count||0)+")","","banner_pc"));
    cards.push(pushKpi("Reklamy končící do 14 dnů",String((ops.ending_within_14_days&&ops.ending_within_14_days.count)||0),"","premium:ending_14"));
    cards.push(pushKpi("Vypnuté reklamy",String((ops.ads_turned_off&&ops.ads_turned_off.count)||0),"","premium:turned_off"));
    var inv=ops.invoiced_this_month||{};
    cards.push(pushKpi("Fakturováno tento měsíc",formatKc(inv.net_cents||0),"", "invoices"));
    var paid=ops.paid_this_month||{};
    cards.push(pushKpi("Uhrazeno tento měsíc",formatKc(paid.total_cents||0),"", "invoices"));
    var notes=(inv.vat_note_cs||"")+" "+(paid.vat_note_cs||"");
    return '<div class="widgets widgets-ops">'+cards.join("")+'</div>'+
      (notes.trim()?'<p class="muted">'+esc(notes.trim())+"</p>":"");
  }
  function attentionSectionHtml(body){
    var items=(body&&body.attention)||[];
    if(!items.length) return "";
    return '<div class="card"><h3>Vyžaduje pozornost</h3><ul class="history-list">'+
      items.map(function(it){
        var nav=it.nav_view||"premium";
        var hint=it.filter_hint?" data-attention-filter='"+esc(it.filter_hint)+"'":"";
        return "<li><strong>"+esc(it.label_cs)+"</strong> — "+esc(String(it.count||0))+
          ' <button type="button" class="btn secondary" data-attention-nav="'+esc(nav)+'"'+hint+">Zobrazit</button></li>";
      }).join("")+"</ul></div>";
  }
  function wireDashboardNav(body){
    Array.prototype.forEach.call(document.querySelectorAll("[data-dash-nav]"),function(el){
      el.onclick=function(){ applyDashboardNav(el.getAttribute("data-dash-nav")); };
      el.onkeydown=function(ev){ if(ev.key==="Enter"||ev.key===" "){ ev.preventDefault(); applyDashboardNav(el.getAttribute("data-dash-nav")); } };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-attention-nav]"),function(b){
      b.onclick=function(){
        var v=b.getAttribute("data-attention-nav");
        var f=b.getAttribute("data-attention-filter");
        if(v){ state.view=v; if(f){ state.premiumFilters=state.premiumFilters||{}; state.premiumFilters.filter=f; } render(); }
      };
    });
  }
  function applyDashboardNav(token){
    if(!token) return;
    var parts=String(token).split(":");
    var view=parts[0];
    state.premiumFilters=state.premiumFilters||{};
    if(view==="premium"){
      state.view="premium";
      if(parts[1]==="pending_review") state.premiumFilters.filter="pending_review";
      else if(parts[1]==="published_active") state.premiumFilters.filter="published_active";
      else if(parts[1]==="ending_14") state.premiumFilters.ending_days="14";
      else if(parts[1]==="turned_off") state.premiumFilters.filter="published_active";
      if(parts[1]==="payment"&&parts[2]) state.premiumFilters.payment=parts[2];
    } else if(view==="invoices") state.view="invoices";
    else if(view==="banner_pc") state.view="banner_pc";
    else state.view=view;
    render();
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
          ? '<div class="table-wrap mt"><table><thead><tr><th>Stav</th><th>Počet</th><th>Částka</th></tr></thead><tbody>'+
            statusKeys.map(function(st){
              var row=s.by_status[st];
              return '<tr><td>'+esc(st)+'</td><td>'+esc(row.count)+'</td><td>'+esc(formatKc(row.total_cents))+'</td></tr>';
            }).join("")+
            '</tbody></table></div>'
          : '<p class="muted empty mt">Žádné faktury v zvoleném období.</p>');
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
        panel('<div class="card"><h2>Dashboard</h2>'+opsDashboardHtml(d.body||{})+'</div>'+attentionSectionHtml(d.body||{}));
        wireDashboardNav(d.body||{});
      } else if(v==="search"){
        if(!state.searchFilters) state.searchFilters=Object.assign({}, state.premiumFilters||{});
        var sf=state.searchFilters;
        panel('<div class="card"><h2>Globální vyhledávání reklamních objednávek</h2>'+
          '<p class="muted">Hledání napříč firmami, IČO, kódy objednávek a kontakty. Našeptávač firmy / IČO.</p>'+
          '<div class="filter-grid">'+
          '<label>Hledat<input id="search-filter-q" type="search" list="search-suggest-list" autocomplete="off" value="'+esc(sf.q||"")+'" placeholder="firma, IČO, kód, kontakt, e-mail"></label>'+
          '<datalist id="search-suggest-list"></datalist>'+
          sel("search-filter-bucket","Stav",[
            ["","Vše"],
            ["pending_review","Čeká na posouzení"],
            ["published_active","Schváleno a zveřejněno"],
            ["ad_turned_off","Vypnuto administrátorem"],
            ["paused","Pozastaveno"],
            ["ended","Ukončeno"],
            ["rejected","Zamítnuto"]
          ],sf.filter||"")+
          sel("search-filter-payment","Platba",[["","Vše"],["unpaid","Neuhrazeno"],["paid","Uhrazeno"]],sf.payment||"")+
          sel("search-filter-ending","Konec do",[["","—"],["30","30 dnů"],["14","14 dnů"],["7","7 dnů"]],sf.ending_days||"")+
          sel("search-filter-position","Pozice",[["","Vše"],["1","P1"],["2","P2"],["3","P3"],["4","P4"],["5","P5"],["6","P6"],["7","P7"],["8","P8"]],sf.position||"")+
          '<label>Sekce (slug)<input id="search-filter-category" type="text" value="'+esc(sf.category||"")+'" placeholder="např. cestovni-kancelare"></label>'+
          sel("search-filter-ad-product","Reklamní produkt",[
            ["","Všechny reklamní produkty"],
            ["premium_buttons","Reklamní tlačítka"],
            ["banner_pc_right","Banner PC (připravuje se)"]
          ],sf.ad_product||"")+
          '</div><div class="row"><button class="btn" type="button" id="search-go">Hledat objednávky</button></div>'+
          '<details class="muted"><summary>Rozšířené vyhledávání (ostatní entity)</summary>'+
          '<div class="grid2">'+inp("q-legacy","Dotaz")+sel("q-ent","Typ",["all","client","campaign","order","contract","invoice","document","code"],"all")+
          '<div class="row"><button class="btn secondary" type="button" id="go-q-legacy">Hledat entity</button></div>'+
          '<div id="q-legacy-out"></div></details>'+
          '<div id="q-out"><p class="muted empty">Zadejte dotaz a stiskněte Hledat objednávky.</p></div></div>');
        async function runAdOrderSearch(){
          var q=val("search-filter-q").trim();
          state.searchFilters={
            q:q,
            filter:val("search-filter-bucket"),
            payment:val("search-filter-payment"),
            category:val("search-filter-category").trim(),
            position:val("search-filter-position"),
            ending_days:val("search-filter-ending"),
            ad_product:val("search-filter-ad-product")
          };
          var qs=new URLSearchParams();
          if(q) qs.set("q",q);
          if(state.searchFilters.filter) qs.set("filter",state.searchFilters.filter);
          if(state.searchFilters.payment) qs.set("payment",state.searchFilters.payment);
          if(state.searchFilters.category) qs.set("category",state.searchFilters.category);
          if(state.searchFilters.position) qs.set("position",state.searchFilters.position);
          if(state.searchFilters.ending_days) qs.set("ending_days",state.searchFilters.ending_days);
          if(state.searchFilters.ad_product) qs.set("ad_product",state.searchFilters.ad_product);
          var seq=++state.searchReqSeq;
          el("q-out").innerHTML='<p class="muted">Načítám…</p>';
          var r=await api("/v1/admin/ad-orders"+(qs.toString()?"?"+qs.toString():""),{method:"GET",headers:{}});
          if(seq!==state.searchReqSeq) return;
          if(!r.res.ok){ el("q-out").innerHTML='<p class="err">'+esc(apiError(r.body))+'</p>'; return; }
          var rows=(r.body&&r.body.orders)||[];
          if(!rows.length){ el("q-out").innerHTML='<p class="muted empty">Žádné objednávky neodpovídají filtrům.</p>'; return; }
          el("q-out").innerHTML='<div class="card">'+premiumOrdersTableHtml(rows,{showAdMeta:true})+premiumOrdersCardsHtml(rows,{showAdMeta:true})+"</div>";
          var rowsById={};
          rows.forEach(function(row){ rowsById[row.order_id]=row; });
          wirePremiumOrderInteractions(rowsById);
        }
        el("search-go").onclick=runAdOrderSearch;
        var sq=el("search-filter-q");
        if(sq){
          sq.oninput=function(){
            var q=sq.value.trim();
            if(state.searchSuggestTimer) clearTimeout(state.searchSuggestTimer);
            if(q.length<2){
              var dl=el("search-suggest-list");
              if(dl) dl.innerHTML="";
              return;
            }
            state.searchSuggestTimer=setTimeout(async function(){
              var r=await api("/v1/admin/search/suggest?q="+encodeURIComponent(q),{method:"GET",headers:{}});
              var dl=el("search-suggest-list");
              if(!dl||!r.res.ok) return;
              var items=(r.body&&r.body.suggestions)||[];
              dl.innerHTML=items.map(function(it){ return '<option value="'+esc(it.company_name||it.label)+'"></option>'; }).join("");
            },250);
          };
          sq.onkeydown=function(ev){ if(ev.key==="Enter"){ ev.preventDefault(); runAdOrderSearch(); } };
        }
        var legacyGo=el("go-q-legacy");
        if(legacyGo) legacyGo.onclick=async function(){
          var q=val("q-legacy").trim();
          if(q.length<2){ el("q-legacy-out").innerHTML='<p class="muted empty">Zadejte alespoň 2 znaky.</p>'; return; }
          var ent=val("q-ent")||"all";
          var r=await api("/v1/admin/search?q="+encodeURIComponent(q)+"&entity="+encodeURIComponent(ent),{method:"GET",headers:{}});
          if(!r.res.ok){ el("q-legacy-out").innerHTML='<p class="err">'+esc(apiError(r.body))+'</p>'; return; }
          el("q-legacy-out").innerHTML=searchHtml(r.body);
        };
        if(sf.q&&sf.q.length>=2) await runAdOrderSearch();
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
      else if(v==="orders_all") { await renderAllAdOrdersAdmin(); return; }
      else if(v==="banner_pc"){
        var bp=await api("/v1/admin/banner-pc",{method:"GET",headers:{}});
        if(!bp.res.ok){ panel('<p class="err">'+esc(apiError(bp.body))+'</p>'); return; }
        panel('<div class="card"><h2>Bannerová reklama – pravý sloupec PC</h2><p class="muted">'+esc((bp.body&&bp.body.message_cs)||"")+'</p><p><strong>Stav:</strong> '+esc((bp.body&&bp.body.product_status_cs)||"Připravuje se")+"</p></div>");
      }
      else if(v==="order_confirmations"){
        async function loadConfRegistry(){
          var qs="?limit=200&q="+encodeURIComponent(val("conf-q"))+
            "&doc_kind="+encodeURIComponent(val("conf-doc-kind"))+
            "&from="+encodeURIComponent(val("conf-from"))+
            "&to="+encodeURIComponent(val("conf-to"));
          var oc=await api("/v1/admin/order-confirmations/registry"+qs,{method:"GET",headers:{}});
          if(!oc.res.ok){ el("conf-out").innerHTML='<p class="err">'+esc(apiError(oc.body))+"</p>"; return; }
          var confs=(oc.body&&oc.body.confirmations)||[];
          if(!confs.length){ el("conf-out").innerHTML='<p class="muted empty">Žádné záznamy pro zadané filtry.</p>'; return; }
          el("conf-out").innerHTML='<div class="table-wrap"><table><thead><tr><th>Objednávka</th><th>Zákazník</th><th>Produkt</th><th>Dokument</th><th>Datum</th><th>PDF</th></tr></thead><tbody>'+
            confs.map(function(c){
              return "<tr><td>"+esc(c.order_reference||"—")+"</td><td>"+esc(c.company_name||"—")+" · "+esc(c.ico||"—")+"</td><td>"+esc(c.ad_product_label_cs||"—")+"</td><td>"+esc(c.document_title_cs||"—")+"</td><td>"+esc(c.created_at_label_cs||"—")+"</td><td>"+
                (c.preview_path?'<button type="button" class="btn secondary" data-conf-preview="'+esc(c.preview_path)+'">Náhled</button> ':"")+
                (c.download_path?'<button type="button" class="btn secondary" data-conf-download="'+esc(c.download_path)+'">Stáhnout</button>':"")+
                "</td></tr>";
            }).join("")+"</tbody></table></div>";
          Array.prototype.forEach.call(document.querySelectorAll("[data-conf-preview]"),function(b){
            b.onclick=function(){ openAdminDocumentAccess(b.getAttribute("data-conf-preview")); };
          });
          Array.prototype.forEach.call(document.querySelectorAll("[data-conf-download]"),function(b){
            b.onclick=function(){ openAdminDocumentAccess(b.getAttribute("data-conf-download")); };
          });
        }
        var zipTo=new Date().toISOString().slice(0,10);
        var zipFrom=new Date(Date.now()-30*864e5).toISOString().slice(0,10);
        var confFrom=new Date(Date.now()-365*864e5).toISOString().slice(0,10);
        panel('<div class="card"><h2>Potvrzení objednávek</h2><p class="muted">Centrální archiv PDF potvrzení a storno dokumentů (reklamní tlačítka).</p>'+
          '<div class="grid2"><div class="registry-search-wrap">'+inp("conf-q","Hledat (objednávka, firma, IČO, e-mail)","search","")+
          '<div id="conf-suggest-panel" class="registry-suggest-panel" hidden></div></div>'+
          sel("conf-doc-kind","Typ dokumentu",[["all","Vše"],["order_confirmation","Potvrzení objednávky"],["order_cancellation","Potvrzení storna"]],"all")+
          inp("conf-from","Vytvořeno od","date",confFrom)+inp("conf-to","Vytvořeno do","date",zipTo)+
          '</div><div class="row"><button type="button" class="btn" id="conf-search-go">Vyhledat</button></div>'+
          '<div id="conf-out"><p class="muted">Načítám…</p></div></div>'+
          '<div class="card"><h3>Export ZIP (uložená PDF)</h3><p class="muted">ZIP exportuje PDF podle období a typů níže (ne podle textového filtru tabulky).</p><div class="grid2">'+
          inp("conf-zip-from","Od", "date", zipFrom)+inp("conf-zip-to","Do", "date", zipTo)+
          '</div><p class="muted"><label><input type="checkbox" id="conf-zip-kind-conf" checked> Potvrzení objednávek</label> '+
          '<label><input type="checkbox" id="conf-zip-kind-cancel" checked> Storno potvrzení</label></p>'+
          '<div class="row"><button type="button" class="btn" id="conf-zip-go">Stáhnout ZIP</button></div>'+
          '<p id="conf-zip-msg" class="muted" hidden></p></div>');
        el("conf-search-go").onclick=loadConfRegistry;
        wireRegistrySuggest("conf-q","conf-suggest-panel","/v1/admin/order-confirmations/registry/suggest",loadConfRegistry);
        await loadConfRegistry();
        var confZipGo=el("conf-zip-go");
        if(confZipGo) confZipGo.onclick=async function(){
          var kinds=[];
          if(el("conf-zip-kind-conf")&&el("conf-zip-kind-conf").checked) kinds.push("order_confirmation");
          if(el("conf-zip-kind-cancel")&&el("conf-zip-kind-cancel").checked) kinds.push("order_cancellation");
          if(!kinds.length){ state.flash="Vyberte alespoň jeden typ dokumentu."; render(); return; }
          confZipGo.disabled=true;
          var out=await downloadZipExport("/v1/admin/order-confirmations/registry/export-zip",{
            from:val("conf-zip-from"),
            to:val("conf-zip-to"),
            kinds:kinds
          });
          confZipGo.disabled=false;
          if(!out.ok){ state.flash=out.message; render(); return; }
          state.flash=out.warnings?"ZIP stažen (některá PDF chyběla: "+out.warnings+")":"ZIP potvrzení stažen.";
          render();
        };
      }
      else if(v==="premium"||v==="orders") { await renderPremiumOrdersAdmin(); return; }
      else if(v==="contracts") return renderSimpleCrud({
        title:"Smlouvy", listPath:"/v1/admin/contracts", listKey:"contracts", createPath:"/v1/admin/contracts",
        cols:[["contract_id","ID"],["contract_number","Číslo"],["status","Stav"],["client_id","Klient"]],
        fields:[
          {id:"co-client",key:"client_id",label:"client_id *"},
          {id:"co-order",key:"order_id",label:"order_id (volitelné)",optional:true},
          {id:"co-num",key:"contract_number",label:"contract_number (auto pokud prázdné)",optional:true}
        ]
      });
      else if(v==="invoices"){
        async function loadInvRegistry(){
          var qs="?limit=200&q="+encodeURIComponent(val("inv-q"))+
            "&doc_kind="+encodeURIComponent(val("inv-doc-kind"))+
            "&payment="+encodeURIComponent(val("inv-payment"))+
            "&from="+encodeURIComponent(val("inv-from"))+
            "&to="+encodeURIComponent(val("inv-to"));
          var ir=await api("/v1/admin/invoices/registry"+qs,{method:"GET",headers:{}});
          if(!ir.res.ok){ el("inv-out").innerHTML='<p class="err">'+esc(apiError(ir.body))+"</p>"; return; }
          var docs=(ir.body&&ir.body.documents)||[];
          if(!docs.length){ el("inv-out").innerHTML='<p class="muted empty">Žádné záznamy pro zadané filtry.</p>'; return; }
          el("inv-out").innerHTML='<div class="table-wrap"><table><thead><tr><th>Číslo dokladu</th><th>Zákazník</th><th>Objednávka</th><th>Vystaveno</th><th>Částka</th><th>Platba</th><th>PDF</th></tr></thead><tbody>'+
            docs.map(function(d){
              var num=d.document_kind==="credit_note"?d.credit_note_number:d.invoice_number;
              return "<tr><td>"+esc(num||"—")+(d.linked_invoice_number?" → faktura "+esc(d.linked_invoice_number):"")+"</td><td>"+esc(d.company_name||"—")+" · "+esc(d.ico||"—")+"</td><td>"+esc(d.order_reference||"—")+"</td><td>"+esc(d.issued_at_label_cs||"—")+"</td><td>"+esc(formatKc(d.total_cents||0))+"</td><td>"+esc(d.payment_label_cs||"—")+"</td><td>"+
                (d.preview_path?'<button type="button" class="btn secondary" data-inv-preview="'+esc(d.preview_path)+'">Náhled</button> ':"")+
                (d.download_path?'<button type="button" class="btn secondary" data-inv-download="'+esc(d.download_path)+'">Stáhnout</button>':"")+
                "</td></tr>";
            }).join("")+"</tbody></table></div>";
          Array.prototype.forEach.call(document.querySelectorAll("[data-inv-preview]"),function(b){
            b.onclick=function(){ openAdminDocumentAccess(b.getAttribute("data-inv-preview")); };
          });
          Array.prototype.forEach.call(document.querySelectorAll("[data-inv-download]"),function(b){
            b.onclick=function(){ openAdminDocumentAccess(b.getAttribute("data-inv-download")); };
          });
        }
        var invZipTo=new Date().toISOString().slice(0,10);
        var invZipFrom=new Date(Date.now()-30*864e5).toISOString().slice(0,10);
        var invFrom=new Date(Date.now()-365*864e5).toISOString().slice(0,10);
        panel('<div class="card"><h2>Faktury</h2><p class="muted">Centrální evidence faktur a dobropisů (reklamní objednávky).</p>'+
          '<div class="grid2"><div class="registry-search-wrap">'+inp("inv-q","Hledat (číslo dokladu, objednávka, firma, IČO, e-mail)","search","")+
          '<div id="inv-suggest-panel" class="registry-suggest-panel" hidden></div></div>'+
          sel("inv-doc-kind","Typ dokladu",[["all","Vše"],["invoices","Faktury"],["credit_notes","Dobropisy"]],"all")+
          sel("inv-payment","Platba",[["all","Vše"],["paid","Uhrazeno"],["unpaid","Neuhrazeno"]],"all")+
          inp("inv-from","Vystaveno od","date",invFrom)+inp("inv-to","Vystaveno do","date",invZipTo)+
          '</div><div class="row"><button type="button" class="btn" id="inv-search-go">Vyhledat</button></div>'+
          '<div id="inv-out"><p class="muted">Načítám…</p></div></div>'+
          '<div class="card"><h3>Export ZIP (uložená PDF)</h3><p class="muted">ZIP exportuje PDF podle období a typů níže (ne podle textového filtru tabulky).</p><div class="grid2">'+
          inp("inv-zip-from","Od", "date", invZipFrom)+inp("inv-zip-to","Do", "date", invZipTo)+
          '</div><p class="muted"><label><input type="checkbox" id="inv-zip-kind-inv" checked> Faktury</label> '+
          '<label><input type="checkbox" id="inv-zip-kind-credit" checked> Dobropisy</label></p>'+
          '<div class="row"><button type="button" class="btn" id="inv-zip-go">Stáhnout ZIP</button></div></div>');
        el("inv-search-go").onclick=loadInvRegistry;
        wireRegistrySuggest("inv-q","inv-suggest-panel","/v1/admin/invoices/registry/suggest",loadInvRegistry);
        await loadInvRegistry();
        var invZipGo=el("inv-zip-go");
        if(invZipGo) invZipGo.onclick=async function(){
          var kinds=[];
          if(el("inv-zip-kind-inv")&&el("inv-zip-kind-inv").checked) kinds.push("invoices");
          if(el("inv-zip-kind-credit")&&el("inv-zip-kind-credit").checked) kinds.push("credit_notes");
          if(!kinds.length){ state.flash="Vyberte alespoň jeden typ dokladu."; render(); return; }
          invZipGo.disabled=true;
          var out=await downloadZipExport("/v1/admin/invoices/registry/export-zip",{
            from:val("inv-zip-from"),
            to:val("inv-zip-to"),
            kinds:kinds,
            idempotency_key:"ui-inv-zip:"+val("inv-zip-from")+":"+val("inv-zip-to")
          });
          invZipGo.disabled=false;
          if(!out.ok){ state.flash=out.message; render(); return; }
          state.flash=out.warnings?"ZIP stažen (některá PDF chyběla: "+out.warnings+")":"ZIP faktur stažen.";
          render();
        };
        return;
      }
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
          '<hr class="soft"/>'+
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
      var errMsg=(e&&e.message)?String(e.message):"";
      panel('<p class="err">Nepodařilo se načíst obsah.'+(errMsg?" "+esc(errMsg):"")+'</p>'+
        '<div class="row"><button type="button" class="btn" id="render-retry">Zkusit znovu</button></div>');
      var retryBtn=el("render-retry");
      if(retryBtn) retryBtn.onclick=function(){ render(); };
    }
  }
  bootstrap();
})();
`;
