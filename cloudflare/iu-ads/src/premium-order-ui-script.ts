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
    "var MAX_FILE_BYTES=5*1024*1024;\n" +
    "var ALLOWED_MIME={\"image/png\":1,\"image/jpeg\":1,\"image/webp\":1};\n" +
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
function validatePhoneClient(raw){
  var phone=String(raw||"").trim();
  if(!phone)return {ok:false,reason:"phone_required"};
  var digits=phone.replace(/\\D/g,"");
  if(digits.length<9||digits.length>15)return {ok:false,reason:"invalid_phone"};
  return {ok:true,phone:phone};
}
function clearFieldErrors(){
  var icoEl=document.getElementById("ico");
  var icoErr=document.getElementById("ico_err");
  if(icoEl){icoEl.removeAttribute("aria-invalid");icoEl.classList.remove("invalid");}
  if(icoErr){icoErr.hidden=true;icoErr.textContent="";}
  var phoneEl=document.getElementById("phone");
  var phoneErr=document.getElementById("phone_err");
  if(phoneEl){phoneEl.removeAttribute("aria-invalid");phoneEl.classList.remove("invalid");}
  if(phoneErr){phoneErr.hidden=true;phoneErr.textContent="";}
  var fileErr=document.getElementById("file_err");
  if(fileErr){fileErr.hidden=true;fileErr.textContent="";}
  var orderingErr=document.getElementById("ordering_person_err");
  if(orderingErr){orderingErr.hidden=true;orderingErr.textContent="";}
  var orderingEl=document.getElementById("ordering_person_name");
  if(orderingEl){orderingEl.removeAttribute("aria-invalid");orderingEl.classList.remove("invalid");}
  var err=document.getElementById("err");if(err)err.hidden=true;
}
function validateOrderingPersonClient(raw){
  var name=String(raw||"").trim();
  if(!name)return {ok:false,reason:"ordering_person_required"};
  if(name.length<2||name.length>200)return {ok:false,reason:"ordering_person_invalid"};
  if(/[<>]/.test(name))return {ok:false,reason:"ordering_person_invalid"};
  return {ok:true,name:name};
}
function showOrderingPersonError(reason){
  var el=document.getElementById("ordering_person_name");
  var orderingErr=document.getElementById("ordering_person_err");
  var msg=userMsg(reason);
  if(el){el.setAttribute("aria-invalid","true");el.classList.add("invalid");el.focus({preventScroll:false});}
  if(orderingErr){orderingErr.textContent=msg;orderingErr.hidden=false;}
  var err=document.getElementById("err");if(err){err.textContent=msg;err.hidden=false;}
}
function showAuthorizationError(reason){
  var authCb=document.getElementById("authorization_confirmed");
  var msg=userMsg(reason);
  if(authCb){authCb.focus({preventScroll:false});}
  var err=document.getElementById("err");if(err){err.textContent=msg;err.hidden=false;}
}
function showIcoError(reason){
  var icoEl=document.getElementById("ico");
  var icoErr=document.getElementById("ico_err");
  var msg=userMsg(reason);
  if(icoEl){
    icoEl.setAttribute("aria-invalid","true");
    icoEl.classList.add("invalid");
    icoEl.setAttribute("aria-describedby","ico_hint ico_lookup ico_err");
    icoEl.focus({preventScroll:false});
    try{icoEl.scrollIntoView({block:"center",behavior:"smooth"});}catch(_){}
  }
  if(icoErr){icoErr.textContent=msg;icoErr.hidden=false;}
  var err=document.getElementById("err");
  if(err){err.textContent=msg;err.hidden=false;}
}
function showPhoneError(reason){
  var phoneEl=document.getElementById("phone");
  var phoneErr=document.getElementById("phone_err");
  var msg=userMsg(reason);
  if(phoneEl){
    phoneEl.setAttribute("aria-invalid","true");
    phoneEl.classList.add("invalid");
    phoneEl.focus({preventScroll:false});
  }
  if(phoneErr){phoneErr.textContent=msg;phoneErr.hidden=false;}
  var err=document.getElementById("err");
  if(err){err.textContent=msg;err.hidden=false;}
}
function showApiError(code,field){
  if(field==="ico"||(code&&code.indexOf("ico")===0)){showIcoError(code||"invalid_ico_checksum");return;}
  if(field==="phone"||code==="phone_required"||code==="invalid_phone"){showPhoneError(code||"invalid_phone");return;}
  if(code==="authorization_required"){showAuthorizationError(code);return;}
  if(code==="ordering_person_required"||code==="ordering_person_invalid"){showOrderingPersonError(code);return;}
  var err=document.getElementById("err");
  if(err){err.textContent=userMsg(code);err.hidden=false;}
}
var q=new URLSearchParams(location.search);
var placement=q.get("placement")||"";
var previewSlot=document.getElementById("previewSlot");
var fileEl=document.getElementById("file");
var modeEl=document.getElementById("creative_mode");
var submitBtn=document.getElementById("submit_btn");
var authCb=document.getElementById("authorization_confirmed");
var orderingWrap=document.getElementById("ordering_person_wrap");
var orderingPersonEl=document.getElementById("ordering_person_name");
function syncOrderingPersonField(){
  if(!authCb||!orderingWrap)return;
  var on=!!authCb.checked;
  orderingWrap.hidden=!on;
  if(orderingPersonEl){
    if(on)orderingPersonEl.setAttribute("required","required");
    else orderingPersonEl.removeAttribute("required");
  }
}
if(authCb){authCb.addEventListener("change",syncOrderingPersonField);syncOrderingPersonField();}
var reqLogo=document.getElementById("creative_req_logo");
var reqBanner=document.getElementById("creative_req_banner");
function syncCreativeReq(){
  if(!reqLogo||!reqBanner||!modeEl)return;
  var banner=modeEl.value==="full_bleed_banner";
  reqLogo.hidden=banner;
  reqBanner.hidden=!banner;
}
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
function validateFileClient(file){
  if(!file)return {ok:false,reason:"missing_file"};
  if(!ALLOWED_MIME[file.type])return {ok:false,reason:"file_type_invalid"};
  if(file.size<=0||file.size>MAX_FILE_BYTES)return {ok:false,reason:"file_too_large"};
  return {ok:true};
}
function showFileError(reason){
  var fileErr=document.getElementById("file_err");
  var msg=userMsg(reason);
  if(fileErr){fileErr.textContent=msg;fileErr.hidden=false;}
  var err=document.getElementById("err");
  if(err){err.textContent=msg;err.hidden=false;}
}
fileEl.onchange=function(){
  var f=fileEl.files&&fileEl.files[0];
  var fileErr=document.getElementById("file_err");
  if(fileErr){fileErr.hidden=true;fileErr.textContent="";}
  if(f){
    var chk=validateFileClient(f);
    if(!chk.ok){showFileError(chk.reason);fileEl.value="";renderPreview();return;}
  }
  renderPreview();
};
modeEl.onchange=function(){syncCreativeReq();renderPreview();};
syncCreativeReq();
document.getElementById("ico").addEventListener("input",clearFieldErrors);
var aresSeq=0;
var aresFilled={company:false,street:false,city:false,zip:false,country:false,dic:false};
function markManual(field){
  if(field==="company_name")aresFilled.company=true;
  if(field==="billing_street")aresFilled.street=true;
  if(field==="billing_city")aresFilled.city=true;
  if(field==="billing_zip")aresFilled.zip=true;
  if(field==="billing_country")aresFilled.country=true;
  if(field==="dic")aresFilled.dic=true;
}
["company_name","billing_street","billing_city","billing_zip","billing_country","dic"].forEach(function(id){
  var el=document.getElementById(id);
  if(el)el.addEventListener("input",function(){markManual(id);});
});
function clearAresPopulatedFields(){
  document.getElementById("company_name").value="";
  document.getElementById("billing_street").value="";
  document.getElementById("billing_city").value="";
  document.getElementById("billing_zip").value="";
  document.getElementById("billing_country").value="Česká republika";
  document.getElementById("dic").value="";
  aresFilled={company:false,street:false,city:false,zip:false,country:false,dic:false};
}
function setLookupStatus(text,kind){
  var el=document.getElementById("ico_lookup");
  if(!el)return;
  el.textContent=text||"";
  el.hidden=!text;
  el.classList.remove("is-ok","is-err");
  if(kind==="ok")el.classList.add("is-ok");
  if(kind==="err")el.classList.add("is-err");
}
function applyAresData(data,reqIco){
  if(!data)return;
  if(!aresFilled.company)document.getElementById("company_name").value=data.company_name||"";
  if(!aresFilled.street)document.getElementById("billing_street").value=data.billing_street||"";
  if(!aresFilled.city)document.getElementById("billing_city").value=data.billing_city||"";
  if(!aresFilled.zip)document.getElementById("billing_zip").value=data.billing_zip||"";
  if(!aresFilled.country)document.getElementById("billing_country").value=data.billing_country||"Česká republika";
  if(!aresFilled.dic&&data.dic)document.getElementById("dic").value=data.dic;
  setLookupStatus("Údaje doplněny z registru pro IČO "+reqIco+". Zkontrolujte je prosím.","ok");
}
async function lookupAresFromIco(raw){
  var check=validateIcoClient(raw);
  if(!check.ok){setLookupStatus("",null);return;}
  var reqIco=check.ico;
  var seq=++aresSeq;
  setLookupStatus("Načítám údaje z registru…",null);
  try{
    var r=await fetch("/v1/public/ares/ico?ico="+encodeURIComponent(reqIco),{credentials:"omit"});
    if(seq!==aresSeq)return;
    var current=normalizeIco(document.getElementById("ico").value);
    if(current!==reqIco)return;
    if(r.status===404){setLookupStatus(userMsg("ares_not_found"),"err");return;}
    if(!r.ok){setLookupStatus(userMsg("ares_unavailable"),"err");return;}
    var j=await r.json();
    if(seq!==aresSeq||normalizeIco(document.getElementById("ico").value)!==reqIco)return;
    applyAresData(j,reqIco);
  }catch(_){
    if(seq!==aresSeq)return;
    setLookupStatus(userMsg("ares_unavailable"),"err");
  }
}
var icoEl=document.getElementById("ico");
var icoTimer=null;
icoEl.addEventListener("input",function(){
  if(icoTimer)clearTimeout(icoTimer);
  var raw=icoEl.value;
  var check=validateIcoClient(raw);
  if(!check.ok){setLookupStatus("",null);return;}
  icoTimer=setTimeout(function(){
    clearAresPopulatedFields();
    lookupAresFromIco(raw);
  },400);
});
icoEl.addEventListener("blur",function(){
  var raw=icoEl.value;
  var check=validateIcoClient(raw);
  if(check.ok)lookupAresFromIco(raw);
});
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
  var phoneCheck=validatePhoneClient(document.getElementById("phone").value);
  if(!phoneCheck.ok){showPhoneError(phoneCheck.reason);return;}
  var file=fileEl.files[0];
  var fileCheck=validateFileClient(file);
  if(!fileCheck.ok){showFileError(fileCheck.reason);return;}
  if(!authCb||!authCb.checked){showAuthorizationError("authorization_required");return;}
  var orderingCheck=validateOrderingPersonClient(orderingPersonEl?orderingPersonEl.value:"");
  if(!orderingCheck.ok){showOrderingPersonError(orderingCheck.reason);return;}
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
      phone:phoneCheck.phone,
      billing_street:document.getElementById("billing_street").value.trim(),
      billing_city:document.getElementById("billing_city").value.trim(),
      billing_zip:document.getElementById("billing_zip").value.trim(),
      billing_country:document.getElementById("billing_country").value.trim(),
      target_url:document.getElementById("target_url").value.trim(),
      creative_mode:modeEl.value,
      note:document.getElementById("note").value.trim()||null,
      terms_version:termsVersion,
      terms_effective_at:termsEffective,
      b2b_only:true,
      authorization_confirmed:true,
      ordering_person_name:orderingCheck.name
    };
    var r1=await fetch("/v1/public/premium/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(submitBody)});
    var j1=await r1.json().catch(function(){return {};});
    if(!r1.ok){
      var code=j1&&j1.error?String(j1.error):"";
      if(code.indexOf("ico")>=0)showIcoError(code);
      else if(code==="phone_required"||code==="invalid_phone")showPhoneError(code);
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
function closeOrderForm(){
  try{
    var raw=sessionStorage.getItem("iuPremiumOrderReturn");
    if(raw){
      var st=JSON.parse(raw);
      sessionStorage.removeItem("iuPremiumOrderReturn");
      if(st&&st.href&&String(st.href).indexOf("infouzel.cz")>=0){
        if(typeof st.scrollY==="number")sessionStorage.setItem("iuPremiumOrderRestoreScroll",String(st.scrollY));
        if(st.focusId)sessionStorage.setItem("iuPremiumOrderRestoreFocus",String(st.focusId));
        location.href=st.href;
        return;
      }
    }
  }catch(_){}
  var ref=document.referrer||"";
  if(ref.indexOf("infouzel.cz")>=0){history.back();return;}
  location.href="https://infouzel.cz/";
}
var cancelBtn=document.getElementById("cancel_btn");
if(cancelBtn){cancelBtn.addEventListener("click",function(){closeOrderForm();});}
})();`
  );
}
