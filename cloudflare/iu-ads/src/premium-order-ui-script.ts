import { PREMIUM_ORDER_ERROR_CS } from "./premium-order-errors";

export function buildPremiumOrderClientScript(termsVersion: string, termsEffective: string): string {
  return (
    "(function(){\n" +
    '"use strict";\n' +
    "var ERR_CS=" +
    JSON.stringify(PREMIUM_ORDER_ERROR_CS) +
    ";\n" +
    "var termsVersion=" +
    JSON.stringify(termsVersion) +
    ";\n" +
    "var termsEffective=" +
    JSON.stringify(termsEffective) +
    ";\n" +
    `function userMsg(code){return ERR_CS[code]||"Odeslání se nezdařilo. Zkontrolujte údaje nebo to zkuste později.";}
function normalizeIco(raw){var d=String(raw||"").replace(/\\D/g,"");if(!d.length||d.length>8)return null;return d.padStart(8,"0");}
function validateIcoClient(raw){
  var ico=normalizeIco(raw);
  if(!ico)return {ok:false,reason:"ico_required"};
  if(!/^\\d{8}$/.test(ico))return {ok:false,reason:"invalid_ico_format"};
  var w=[8,7,6,5,4,3,2],s=0,i;
  for(i=0;i<7;i++)s+=Number(ico[i])*w[i];
  var c=(11-(s%11))%10;if(c===10)c=0;
  if(c!==Number(ico[7]))return {ok:false,reason:"invalid_ico_checksum"};
  return {ok:true,ico:ico};
}
function clearFieldErrors(){
  var icoEl=document.getElementById("ico");
  var icoErr=document.getElementById("ico_err");
  if(icoEl){icoEl.removeAttribute("aria-invalid");icoEl.classList.remove("invalid");}
  if(icoErr){icoErr.hidden=true;icoErr.textContent="";}
  var err=document.getElementById("err");if(err)err.hidden=true;
}
function showIcoError(reason){
  var icoEl=document.getElementById("ico");
  var icoErr=document.getElementById("ico_err");
  var msg=userMsg(reason);
  if(icoEl){
    icoEl.setAttribute("aria-invalid","true");
    icoEl.classList.add("invalid");
    icoEl.setAttribute("aria-describedby","ico_err");
    icoEl.focus({preventScroll:false});
    try{icoEl.scrollIntoView({block:"center",behavior:"smooth"});}catch(_){}
  }
  if(icoErr){icoErr.textContent=msg;icoErr.hidden=false;}
  var err=document.getElementById("err");
  if(err){err.textContent=msg;err.hidden=false;}
}
function showApiError(code,field){
  if(field==="ico"||(code&&code.indexOf("ico")===0)){showIcoError(code||"invalid_ico_checksum");return;}
  var err=document.getElementById("err");
  if(err){err.textContent=userMsg(code);err.hidden=false;}
}
var q=new URLSearchParams(location.search);
var placement=q.get("placement")||"";
var previewSlot=document.getElementById("previewSlot");
var fileEl=document.getElementById("file");
var modeEl=document.getElementById("creative_mode");
var submitBtn=document.getElementById("submit_btn");
function syncPreviewMode(){
  if(!previewSlot)return;
  previewSlot.classList.remove("iuPremiumSlot--logo","iuPremiumSlot--banner");
  previewSlot.classList.add(modeEl.value==="full_bleed_banner"?"iuPremiumSlot--banner":"iuPremiumSlot--logo");
}
function renderPreview(){
  syncPreviewMode();
  if(!previewSlot)return;
  previewSlot.innerHTML="";
  var f=fileEl.files&&fileEl.files[0];
  if(!f){previewSlot.setAttribute("aria-hidden","true");return;}
  var reader=new FileReader();
  reader.onload=function(){
    var img=document.createElement("img");
    img.className="iuPremiumSlotImg";
    img.src=String(reader.result||"");
    img.alt="Náhled kreativity";
    previewSlot.appendChild(img);
    previewSlot.removeAttribute("aria-hidden");
  };
  reader.onerror=function(){previewSlot.setAttribute("aria-hidden","true");};
  reader.readAsDataURL(f);
}
fileEl.onchange=renderPreview;
modeEl.onchange=renderPreview;
document.getElementById("ico").addEventListener("input",clearFieldErrors);
function bytesToBase64(bytes){
  var chunk=0x8000,parts=[],i;
  for(i=0;i<bytes.length;i+=chunk){parts.push(String.fromCharCode.apply(null,bytes.subarray(i,i+chunk)));}
  return btoa(parts.join(""));
}
var submitting=false;
document.getElementById("form").onsubmit=async function(ev){
  ev.preventDefault();
  if(submitting)return;
  clearFieldErrors();
  var icoRaw=document.getElementById("ico").value.trim();
  var icoCheck=validateIcoClient(icoRaw);
  if(!icoCheck.ok){showIcoError(icoCheck.reason);return;}
  var file=fileEl.files[0];
  if(!file){showApiError("missing_file");return;}
  submitting=true;
  if(submitBtn){submitBtn.disabled=true;submitBtn.textContent="Odesílám…";}
  try{
    var buf=new Uint8Array(await file.arrayBuffer());
    var b64=bytesToBase64(buf);
    var submitBody={
      placement_id:placement,
      company_name:document.getElementById("company_name").value.trim(),
      ico:icoCheck.ico,
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
    var j1=await r1.json().catch(function(){return {};});
    if(!r1.ok){
      var code=j1&&j1.error?String(j1.error):"";
      if(code.indexOf("ico")>=0)showIcoError(code);
      else showApiError(code);
      return;
    }
    var token=j1.order_access_token;
    var upBody={content_base64:b64,declared_mime:file.type,filename:file.name};
    var r2=await fetch("/v1/public/premium/orders/"+encodeURIComponent(j1.order_id)+"/upload",{
      method:"POST",
      headers:{"Content-Type":"application/json","X-IU-Premium-Order-Token":token},
      body:JSON.stringify(upBody)
    });
    if(!r2.ok){
      var j2=await r2.json().catch(function(){return {};});
      showApiError(j2&&j2.error?String(j2.error):"");
      return;
    }
    document.getElementById("form").hidden=true;
    document.getElementById("keyterms").hidden=true;
    document.getElementById("done").hidden=false;
    window.scrollTo(0,0);
  } finally {
    submitting=false;
    if(submitBtn){submitBtn.disabled=false;submitBtn.textContent="Odeslat k posouzení";}
  }
};
})();`
  );
}
