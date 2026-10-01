/** Public premium order form shell (ads.infouzel.cz/premium/order). */
export function buildPremiumOrderShellHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>InfoUzel — Premium reklamní pozice</title>
<style nonce="${nonce}">
:root{--line:#d6d0c4;--ink:#1a221e;--muted:#5c675f;--accent:#0f6b5c}
body{margin:0;font:15px/1.45 system-ui,sans-serif;background:#f7f5f1;color:var(--ink)}
main{max-width:720px;margin:0 auto;padding:1.25rem}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:1rem;margin-bottom:1rem}
label{display:block;font-size:.85rem;color:var(--muted);margin:.5rem 0 .15rem}
input,select,textarea{width:100%;box-sizing:border-box;padding:.55rem;border:1px solid var(--line);border-radius:8px;font:inherit}
button{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:.6rem 1rem;font:inherit;cursor:pointer}
.previewBox{height:110px;border-radius:12px;border:1px solid var(--line);overflow:hidden;display:flex;align-items:center;justify-content:center;background:#f3f4f6}
.previewBox img{max-width:100%;max-height:100%;object-fit:contain}
.previewBox.banner img{width:100%;height:100%;object-fit:cover}
.muted{color:var(--muted);font-size:.9rem}
.err{color:#9b2c2c}
</style>
</head>
<body>
<main>
<h1>Prémiová reklamní pozice</h1>
<p class="muted">InfoUzel.cz nesleduje zobrazení ani prokliky prémiových reklamních pozic. Cena je sjednána vždy na jedno reklamní období v délce 6 měsíců. Prodloužení není automatické.</p>
<div class="card" id="meta"></div>
<form id="form" class="card">
<label>Firma *</label><input id="company_name" required/>
<label>IČO</label><input id="ico"/>
<label>Kontaktní osoba *</label><input id="contact_name" required/>
<label>E-mail *</label><input id="email" type="email" required/>
<label>Telefon</label><input id="phone"/>
<label>Fakturační údaje</label><textarea id="billing_info" rows="2"></textarea>
<label>Cílová URL *</label><input id="target_url" type="url" required placeholder="https://"/>
<label>Typ kreativy *</label>
<select id="creative_mode"><option value="logo">Logo</option><option value="full_bleed_banner">Banner (celá plocha)</option></select>
<label>Soubor (PNG/JPG/WebP) *</label><input id="file" type="file" accept="image/png,image/jpeg,image/webp" required/>
<label>Náhled</label>
<div id="preview" class="previewBox" aria-hidden="true"></div>
<label>Poznámka</label><textarea id="note" rows="2"></textarea>
<button type="submit">Odeslat k posouzení</button>
<p id="err" class="err" hidden></p>
</form>
<div id="done" class="card" hidden><p class="muted">Objednávka odeslána. Po schválení a zveřejnění obdržíte e-mail.</p></div>
</main>
<script nonce="${nonce}">
(function(){
  var q=new URLSearchParams(location.search);
  var placement=q.get("placement")||"";
  var category=q.get("category")||"";
  var meta=document.getElementById("meta");
  var preview=document.getElementById("preview");
  var fileEl=document.getElementById("file");
  var modeEl=document.getElementById("creative_mode");
  fetch("/v1/public/premium/selected-services/catalog?category="+encodeURIComponent(category)).then(function(r){return r.json();}).then(function(body){
    var slot=(body.slots||[]).find(function(s){return s.placement_id===placement;});
    meta.innerHTML=slot?("<strong>"+slot.price_label_cs+"</strong><br/><span class=\"muted\">"+placement+"</span>"):"<span class=\"err\">Neplatná pozice</span>";
  }).catch(function(){meta.textContent="Katalog nedostupný";});
  function renderPreview(){
    var f=fileEl.files&&fileEl.files[0];
    preview.innerHTML="";
    if(!f){preview.setAttribute("aria-hidden","true");return;}
    var url=URL.createObjectURL(f);
    var img=document.createElement("img");
    img.src=url; img.alt="Náhled kreativity";
    preview.className="previewBox "+(modeEl.value==="full_bleed_banner"?"banner":"logo");
    preview.appendChild(img);
    preview.removeAttribute("aria-hidden");
  }
  fileEl.onchange=renderPreview;
  modeEl.onchange=renderPreview;
  document.getElementById("form").onsubmit=async function(ev){
    ev.preventDefault();
    var err=document.getElementById("err"); err.hidden=true;
    var file=fileEl.files[0];
    if(!file){err.textContent="Vyberte soubor."; err.hidden=false; return;}
    var buf=await file.arrayBuffer();
    var b64=btoa(String.fromCharCode.apply(null,new Uint8Array(buf)));
    var submitBody={
      placement_id:placement,
      company_name:document.getElementById("company_name").value.trim(),
      ico:document.getElementById("ico").value.trim()||null,
      contact_name:document.getElementById("contact_name").value.trim(),
      email:document.getElementById("email").value.trim(),
      phone:document.getElementById("phone").value.trim()||null,
      billing_info:document.getElementById("billing_info").value.trim()||null,
      target_url:document.getElementById("target_url").value.trim(),
      creative_mode:modeEl.value,
      note:document.getElementById("note").value.trim()||null,
      price_cents:1
    };
    var r1=await fetch("/v1/public/premium/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(submitBody)});
    var j1=await r1.json();
    if(!r1.ok){err.textContent=j1.error||"Chyba"; err.hidden=false; return;}
    var token=j1.order_access_token;
    var upBody={content_base64:b64,declared_mime:file.type,filename:file.name};
    var r2=await fetch("/v1/public/premium/orders/"+encodeURIComponent(j1.order_id)+"/upload",{
      method:"POST",
      headers:{"Content-Type":"application/json","X-IU-Premium-Order-Token":token},
      body:JSON.stringify(upBody)
    });
    if(!r2.ok){var j2=await r2.json(); err.textContent=j2.error||"Upload selhal"; err.hidden=false; return;}
    document.getElementById("form").hidden=true;
    document.getElementById("done").hidden=false;
  };
})();
</script>
</body>
</html>`;
}
