/** Public premium order form shell (ads.infouzel.cz/premium/order). */
import { buildPremiumPrivacyNoticeHtml, PREMIUM_TERMS_EFFECTIVE_AT, PREMIUM_TERMS_VERSION } from "./premium-terms";

export function buildPremiumOrderShellHtml(nonce: string, metaHtml: string): string {
  const privacy = buildPremiumPrivacyNoticeHtml();
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
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:.65rem}
@media(max-width:560px){.grid2{grid-template-columns:1fr}}
button{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:.6rem 1rem;font:inherit;cursor:pointer;width:100%;margin-top:.75rem}
.previewBox{height:110px;border-radius:12px;border:1px solid var(--line);overflow:hidden;display:flex;align-items:center;justify-content:center;background:#f3f4f6}
.previewBox img{display:block;max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain}
.previewBox.banner img{object-fit:cover}
.muted{color:var(--muted);font-size:.9rem}
.err{color:#9b2c2c}
.summary-h{margin:0 0 .5rem;font-size:1.05rem}
.summary-dl{display:grid;grid-template-columns:9rem 1fr;gap:.25rem .75rem;margin:0}
.summary-dl dt{color:var(--muted);margin:0}
.summary-dl dd{margin:0}
.b2b{margin-top:.75rem}
.legal{margin-top:.5rem;font-size:.85rem}
</style>
</head>
<body>
<main>
<h1>Prémiová reklamní pozice</h1>
<p class="muted">InfoUzel.cz nesleduje zobrazení ani prokliky prémiových reklamních pozic. Cena je sjednána vždy na jedno reklamní období v délce 6 měsíců. Prodloužení není automatické.</p>
<div class="card" id="meta">${metaHtml}</div>
<form id="form" class="card">
<p class="muted b2b"><strong>B2B only:</strong> služba je určena výhradně podnikatelům. IČO je povinné.</p>
<label for="company_name">Obchodní firma / jméno podnikatele *</label>
<input id="company_name" name="company_name" required autocomplete="organization"/>
<label for="ico">IČO *</label>
<input id="ico" name="ico" required inputmode="numeric" pattern="[0-9\\s]{8,}" autocomplete="off"/>
<div class="grid2">
<div><label for="billing_street">Ulice a číslo *</label><input id="billing_street" required autocomplete="street-address"/></div>
<div><label for="billing_city">Město *</label><input id="billing_city" required autocomplete="address-level2"/></div>
</div>
<div class="grid2">
<div><label for="billing_zip">PSČ *</label><input id="billing_zip" required inputmode="numeric" autocomplete="postal-code"/></div>
<div><label for="billing_country">Země *</label><input id="billing_country" value="Česká republika" required/></div>
</div>
<label for="dic">DIČ</label>
<input id="dic" name="dic" autocomplete="off" placeholder="Volitelné"/>
<label for="contact_name">Kontaktní osoba *</label>
<input id="contact_name" required autocomplete="name"/>
<label for="email">E-mail *</label>
<input id="email" type="email" required autocomplete="email"/>
<label for="phone">Telefon</label>
<input id="phone" type="tel" autocomplete="tel"/>
<label for="target_url">Cílová URL *</label>
<input id="target_url" type="url" required placeholder="https://"/>
<label for="creative_mode">Typ kreativy *</label>
<select id="creative_mode"><option value="logo">Logo</option><option value="full_bleed_banner">Banner (celá plocha)</option></select>
<label for="file">Soubor (PNG/JPG/WebP) *</label>
<input id="file" type="file" accept="image/png,image/jpeg,image/webp" required/>
<label for="preview">Náhled</label>
<div id="preview" class="previewBox logo" aria-hidden="true"></div>
<label for="note">Poznámka</label>
<textarea id="note" rows="2"></textarea>
<p class="legal">Odesláním žádosti souhlasíte s <a href="/premium/terms" target="_blank" rel="noopener">Obchodními podmínkami Premium</a> (verze ${PREMIUM_TERMS_VERSION}, účinnost ${PREMIUM_TERMS_EFFECTIVE_AT}).</p>
${privacy}
<button type="submit">Odeslat k posouzení</button>
<p id="err" class="err" hidden></p>
</form>
<div id="done" class="card" hidden><p class="muted">Objednávka odeslána k posouzení. Po schválení a zveřejnění obdržíte e-mail.</p></div>
</main>
<script nonce="${nonce}">
(function(){
  var q=new URLSearchParams(location.search);
  var placement=q.get("placement")||"";
  var category=q.get("category")||"";
  var preview=document.getElementById("preview");
  var fileEl=document.getElementById("file");
  var modeEl=document.getElementById("creative_mode");
  var termsVersion=${JSON.stringify(PREMIUM_TERMS_VERSION)};
  var termsEffective=${JSON.stringify(PREMIUM_TERMS_EFFECTIVE_AT)};
  function renderPreview(){
    var f=fileEl.files&&fileEl.files[0];
    preview.innerHTML="";
    if(!f){preview.setAttribute("aria-hidden","true");return;}
    var reader=new FileReader();
    reader.onload=function(){
      var img=document.createElement("img");
      img.src=String(reader.result||"");
      img.alt="Náhled kreativity";
      preview.className="previewBox "+(modeEl.value==="full_bleed_banner"?"banner":"logo");
      preview.appendChild(img);
      preview.removeAttribute("aria-hidden");
    };
    reader.onerror=function(){preview.setAttribute("aria-hidden","true");};
    reader.readAsDataURL(f);
  }
  fileEl.onchange=renderPreview;
  modeEl.onchange=renderPreview;
  function bytesToBase64(bytes){
    var chunk=0x8000;var parts=[];
    for(var i=0;i<bytes.length;i+=chunk){
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i,i+chunk)));
    }
    return btoa(parts.join(""));
  }
  document.getElementById("form").onsubmit=async function(ev){
    ev.preventDefault();
    var err=document.getElementById("err"); err.hidden=true;
    var file=fileEl.files[0];
    if(!file){err.textContent="Vyberte soubor."; err.hidden=false; return;}
    var buf=new Uint8Array(await file.arrayBuffer());
    var b64=bytesToBase64(buf);
    var submitBody={
      placement_id:placement,
      company_name:document.getElementById("company_name").value.trim(),
      ico:document.getElementById("ico").value.trim(),
      dic:document.getElementById("dic").value.trim()||null,
      contact_name:document.getElementById("contact_name").value.trim(),
      email:document.getElementById("email").value.trim(),
      phone:document.getElementById("phone").value.trim()||null,
      billing_street:document.getElementById("billing_street").value.trim(),
      billing_city:document.getElementById("billing_city").value.trim(),
      billing_zip:document.getElementById("billing_zip").value.trim(),
      billing_country:document.getElementById("billing_country").value.trim(),
      target_url:document.getElementById("target_url").value.trim(),
      creative_mode:modeEl.value,
      note:document.getElementById("note").value.trim()||null,
      terms_version:termsVersion,
      terms_effective_at:termsEffective,
      b2b_only:true
    };
    var r1=await fetch("/v1/public/premium/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(submitBody)});
    var j1=await r1.json();
    if(!r1.ok){err.textContent=(j1&&j1.error)||"Chyba"; err.hidden=false; return;}
    var token=j1.order_access_token;
    var upBody={content_base64:b64,declared_mime:file.type,filename:file.name};
    var r2=await fetch("/v1/public/premium/orders/"+encodeURIComponent(j1.order_id)+"/upload",{
      method:"POST",
      headers:{"Content-Type":"application/json","X-IU-Premium-Order-Token":token},
      body:JSON.stringify(upBody)
    });
    if(!r2.ok){var j2=await r2.json(); err.textContent=(j2&&j2.error)||"Upload selhal"; err.hidden=false; return;}
    document.getElementById("form").hidden=true;
    document.getElementById("done").hidden=false;
  };
})();
</script>
</body>
</html>`;
}
