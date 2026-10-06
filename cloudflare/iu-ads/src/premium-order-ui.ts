/** Public premium order form shell (ads.infouzel.cz/premium/order). */
import { PREMIUM_LIVE_SLOT_CSS } from "./premium-live-slot-css";
import { buildPremiumOrderClientScript } from "./premium-order-ui-script";
import {
  buildPremiumOrderKeyTermsHtml,
  buildPremiumPrivacyNoticeHtml,
  PREMIUM_TERMS_EFFECTIVE_AT,
  PREMIUM_TERMS_VERSION,
} from "./premium-terms";
import type { PremiumContractedPosition } from "./premium-display";

export function buildPremiumOrderShellHtml(
  nonce: string,
  metaHtml: string,
  previewPosition: PremiumContractedPosition = 1
): string {
  const privacy = buildPremiumPrivacyNoticeHtml();
  const keyTerms = buildPremiumOrderKeyTermsHtml();
  const clientScript = buildPremiumOrderClientScript(PREMIUM_TERMS_VERSION, PREMIUM_TERMS_EFFECTIVE_AT);
  const previewPosClass = "iuPremiumPreviewGrid--p" + String(previewPosition);
  return `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>InfoUzel — Premium reklamní pozice</title>
<style nonce="${nonce}">
:root{--line:#d6d0c4;--ink:#1a221e;--muted:#5c675f;--accent:#0f6b5c;--iuChipH:110px;--iuChipPadX:12px}
body{margin:0;font:15px/1.45 system-ui,sans-serif;background:#f7f5f1;color:var(--ink)}
main{max-width:720px;margin:0 auto;padding:1.25rem}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:1rem;margin-bottom:1rem}
label{display:block;font-size:.85rem;color:var(--muted);margin:.5rem 0 .15rem}
input,select,textarea{width:100%;box-sizing:border-box;padding:.55rem;border:1px solid var(--line);border-radius:8px;font:inherit}
input.invalid{border-color:#9b2c2c}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:.65rem}
@media(max-width:560px){.grid2{grid-template-columns:1fr}}
button{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:.6rem 1rem;font:inherit;cursor:pointer;width:100%;margin-top:.75rem}
button:disabled{opacity:.65;cursor:wait}
button.btn-secondary{background:#fff;color:var(--ink);border:1px solid var(--line);margin-top:.5rem}
.muted{color:var(--muted);font-size:.9rem}
.err{color:#9b2c2c;font-size:.9rem;margin:.35rem 0 0}
.field-err{color:#9b2c2c;font-size:.85rem;margin:.2rem 0 0}
.field-hint{color:var(--muted);font-size:.85rem;margin:.15rem 0 .35rem}
.lookup-status{font-size:.85rem;margin:.2rem 0 .35rem;color:var(--muted)}
.lookup-status.is-ok{color:#0f6b5c}
.lookup-status.is-err{color:#9b2c2c}
.summary-h{margin:0 0 .5rem;font-size:1.05rem}
.summary-dl{display:grid;grid-template-columns:9rem 1fr;gap:.25rem .75rem;margin:0}
.summary-dl dt{color:var(--muted);margin:0}
.summary-dl dd{margin:0}
.b2b{margin-top:.75rem}
.legal{margin-top:.5rem;font-size:.85rem}
.keyterms-ul{margin:.35rem 0 .5rem;padding-left:1.15rem}
.keyterms-ul li{margin:.25rem 0}
.creative-req{font-size:.85rem;margin:.25rem 0 .5rem;padding-left:1rem}
.creative-req li{margin:.2rem 0}
.creative-mode-label{display:block;font-size:.85rem;color:var(--muted);margin:.5rem 0 .35rem}
.creative-mode-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr));gap:.45rem;margin:0 0 .65rem;width:100%;box-sizing:border-box}
.creative-mode-option{display:flex;align-items:center;gap:.45rem;border:1px solid var(--line);border-radius:8px;padding:.45rem .55rem;font-size:.88rem;line-height:1.25;cursor:pointer;background:#faf9f7;min-width:0}
.creative-mode-option:has(input:checked){border-color:var(--accent);background:#f0faf8;box-shadow:0 0 0 1px rgba(15,107,92,.25)}
.creative-mode-option input{width:1rem;height:1rem;margin:0;flex-shrink:0;cursor:pointer}
.creative-mode-option span{min-width:0;word-break:break-word}
.iuPremiumFilePick{display:flex;flex-wrap:wrap;align-items:center;gap:.55rem .75rem;margin:.25rem 0 .5rem;width:100%;box-sizing:border-box}
.iuPremiumFilePick-input{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.iuPremiumFilePick-btn{display:inline-flex;align-items:center;justify-content:center;padding:.55rem .85rem;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);font:inherit;font-weight:600;cursor:pointer;flex-shrink:0}
.iuPremiumFilePick-btn:hover{border-color:var(--accent);color:var(--accent)}
.iuPremiumFilePick-btn:focus-visible{outline:2px solid rgba(15,107,92,.45);outline-offset:2px}
.iuPremiumFilePick-name{flex:1 1 8rem;min-width:0;font-size:.88rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.auth-block{margin:.75rem 0;padding:.65rem;border:1px solid var(--line);border-radius:8px;background:#faf9f7}
.auth-check{display:flex;align-items:flex-start;gap:.55rem;font-size:.95rem;line-height:1.35;cursor:pointer;margin:0}
.auth-check input[type=checkbox]{width:1.15rem;height:1.15rem;margin:.15rem 0 0;flex-shrink:0;cursor:pointer}
#ordering_person_wrap{margin-top:.65rem}
${PREMIUM_LIVE_SLOT_CSS}
</style>
</head>
<body>
<main>
<h1>Prémiová reklamní pozice</h1>
<div class="card" id="meta">${metaHtml}</div>
${keyTerms}
<form id="form" class="card">
<p class="muted b2b">Reklamní služba je určena výhradně podnikatelům a firmám. Pro objednání a následné zveřejnění reklamy je nutné vyplnit následující údaje včetně IČO.</p>
<p class="field-hint">Pole označená <strong>*</strong> jsou povinná. Odesláním žádosti nedojde automaticky ke zveřejnění — nejdříve proběhne posouzení.</p>
<label for="ico">IČO *</label>
<input id="ico" name="ico" required type="text" inputmode="numeric" autocomplete="off" aria-describedby="ico_hint ico_lookup ico_err"/>
<p id="ico_hint" class="field-hint">Nejprve zadejte IČO. Název a sídlo firmy nebo podnikatele se automaticky doplní podle dostupných údajů v registru. Údaje prosím zkontrolujte.</p>
<p id="ico_lookup" class="lookup-status" hidden role="status" aria-live="polite"></p>
<p id="ico_err" class="field-err" hidden role="alert"></p>
<label for="company_name">Obchodní firma / jméno podnikatele *</label>
<input id="company_name" name="company_name" required autocomplete="organization"/>
<div class="grid2">
<div><label for="billing_street">Ulice a číslo *</label><input id="billing_street" name="billing_street" required autocomplete="street-address"/></div>
<div><label for="billing_city">Město *</label><input id="billing_city" name="billing_city" required autocomplete="address-level2"/></div>
</div>
<div class="grid2">
<div><label for="billing_zip">PSČ *</label><input id="billing_zip" name="billing_zip" required inputmode="numeric" autocomplete="postal-code"/></div>
<div><label for="billing_country">Země *</label><input id="billing_country" name="billing_country" value="Česká republika" required/></div>
</div>
<label for="dic">DIČ</label>
<input id="dic" name="dic" autocomplete="off" placeholder="Volitelné"/>
<label for="contact_name">Kontaktní osoba *</label>
<input id="contact_name" name="contact_name" required autocomplete="name"/>
<label for="email">E-mail *</label>
<input id="email" name="email" type="email" required autocomplete="email"/>
<label for="phone">Telefon *</label>
<input id="phone" name="phone" type="tel" required autocomplete="tel" aria-describedby="phone_err"/>
<p id="phone_err" class="field-err" hidden role="alert"></p>
<label for="target_url">Cílová URL *</label>
<input id="target_url" name="target_url" type="url" required placeholder="https://"/>
<span id="creative_mode_label" class="creative-mode-label">Typ kreativy *</span>
<div class="creative-mode-grid" role="radiogroup" aria-labelledby="creative_mode_label">
<label class="creative-mode-option"><input type="radio" name="creative_mode_choice" value="logo" checked/><span>Logo</span></label>
<label class="creative-mode-option"><input type="radio" name="creative_mode_choice" value="image_small"/><span>Menší obrázek</span></label>
<label class="creative-mode-option"><input type="radio" name="creative_mode_choice" value="image_medium"/><span>Střední obrázek</span></label>
<label class="creative-mode-option"><input type="radio" name="creative_mode_choice" value="image_large"/><span>Velký obrázek</span></label>
<label class="creative-mode-option"><input type="radio" name="creative_mode_choice" value="full_bleed_banner"/><span>Banner (celá plocha)</span></label>
</div>
<input type="hidden" id="creative_mode" name="creative_mode" value="logo"/>
<label for="file">Soubor s kreativou *</label>
<ul class="creative-req muted" id="creative_req_common">
<li>Formáty PNG, JPG/JPEG nebo WebP; max. 5 MB.</li>
<li>Doporučené rozměry: logo cca 800×400 px, banner cca 1200×370 px (nejsou povinné).</li>
<li><strong>Logo</strong> zobrazí celý obrázek bez ořezu.</li>
<li><strong>Menší / střední / velký obrázek</strong> postupně zvětšují plochu — s rostoucí velikostí může dojít k mírnému symetrickému ořezu okrajů.</li>
<li><strong>Banner (celá plocha)</strong> vyplní celou reklamní plochu; podle poměru stran mohou být okraje oříznuty.</li>
<li>Náhled níže odpovídá skutečnému zobrazení na infoUzel.cz na tomto zařízení.</li>
</ul>
<div class="iuPremiumFilePick">
<input id="file" class="iuPremiumFilePick-input" name="file" type="file" accept="image/png,image/jpeg,image/webp" required aria-describedby="file_err file_name_display"/>
<label for="file" class="iuPremiumFilePick-btn">Vybrat obrázek</label>
<span id="file_name_display" class="iuPremiumFilePick-name">Zatím není vybraný žádný soubor</span>
</div>
<p id="file_err" class="field-err" hidden role="alert"></p>
<div class="previewBlock">
<h2 class="summary-h">Náhled reklamní pozice</h2>
<p class="previewHint muted">Takto bude vaše reklama vypadat v prémiové pozici na tomto zařízení.</p>
<div class="previewWrap" id="iuAffiliateView">
<div class="iuJRGrid iuPremiumGrid iuPremiumPreviewGrid ${previewPosClass}">
<a id="previewSlot" class="iuPremiumSlot iuPremiumSlot--sold iuPremiumSlot--logo" href="#" tabindex="-1" aria-hidden="true"></a>
</div>
</div>
</div>
<label for="note">Poznámka</label>
<textarea id="note" name="note" rows="2"></textarea>
<div class="auth-block" id="auth_block">
<label class="auth-check" for="authorization_confirmed"><input type="checkbox" id="authorization_confirmed" name="authorization_confirmed" value="1"/>Potvrzuji, že jsem oprávněn/a objednat tuto reklamu za uvedenou firmu nebo podnikatele.</label>
<div id="ordering_person_wrap" hidden>
<label for="ordering_person_name">Jméno a příjmení objednávající osoby *</label>
<input id="ordering_person_name" name="ordering_person_name" autocomplete="name" aria-describedby="ordering_person_err"/>
<p id="ordering_person_err" class="field-err" hidden role="alert"></p>
</div>
</div>
<p class="legal">Odesláním žádosti souhlasíte s <a href="/premium/terms" target="_blank" rel="noopener">Obchodními podmínkami Premium</a> (verze ${PREMIUM_TERMS_VERSION}, účinnost ${PREMIUM_TERMS_EFFECTIVE_AT}).</p>
${privacy}
<button type="submit" id="submit_btn">Odeslat k posouzení</button>
<button type="button" class="btn-secondary" id="cancel_btn">Zrušit a zavřít</button>
<p id="err" class="err" hidden role="alert"></p>
</form>
<div id="done" class="card" hidden><p class="muted">Objednávka odeslána k posouzení. Po schválení a zveřejnění obdržíte e-mail.</p></div>
</main>
<script nonce="${nonce}">${clientScript}</script>
</body>
</html>`;
}
