/** Public premium order form shell (ads.infouzel.cz/premium/order). */
import { PREMIUM_LIVE_SLOT_CSS } from "./premium-live-slot-css";
import { buildPremiumOrderClientScript } from "./premium-order-ui-script";
import {
  buildPremiumOrderKeyTermsHtml,
  buildPremiumPrivacyNoticeHtml,
  PREMIUM_TERMS_EFFECTIVE_AT,
  PREMIUM_TERMS_VERSION,
} from "./premium-terms";

export function buildPremiumOrderShellHtml(nonce: string, metaHtml: string): string {
  const privacy = buildPremiumPrivacyNoticeHtml();
  const keyTerms = buildPremiumOrderKeyTermsHtml();
  const clientScript = buildPremiumOrderClientScript(PREMIUM_TERMS_VERSION, PREMIUM_TERMS_EFFECTIVE_AT);
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
.muted{color:var(--muted);font-size:.9rem}
.err{color:#9b2c2c;font-size:.9rem;margin:.35rem 0 0}
.field-err{color:#9b2c2c;font-size:.85rem;margin:.2rem 0 0}
.summary-h{margin:0 0 .5rem;font-size:1.05rem}
.summary-dl{display:grid;grid-template-columns:9rem 1fr;gap:.25rem .75rem;margin:0}
.summary-dl dt{color:var(--muted);margin:0}
.summary-dl dd{margin:0}
.b2b{margin-top:.75rem}
.legal{margin-top:.5rem;font-size:.85rem}
.keyterms-ul{margin:.35rem 0 .5rem;padding-left:1.15rem}
.keyterms-ul li{margin:.25rem 0}
${PREMIUM_LIVE_SLOT_CSS}
</style>
</head>
<body>
<main>
<h1>Prémiová reklamní pozice</h1>
<p class="muted">InfoUzel.cz nesleduje zobrazení ani prokliky prémiových reklamních pozic. Cena je sjednána vždy na jedno reklamní období v délce 6 měsíců. Prodloužení není automatické.</p>
<div class="card" id="meta">${metaHtml}</div>
${keyTerms}
<form id="form" class="card">
<p class="muted b2b"><strong>B2B only:</strong> služba je určena výhradně podnikatelům. IČO je povinné.</p>
<label for="company_name">Obchodní firma / jméno podnikatele *</label>
<input id="company_name" name="company_name" required autocomplete="organization"/>
<label for="ico">IČO *</label>
<input id="ico" name="ico" required inputmode="numeric" pattern="[0-9\\s]{8,}" autocomplete="off" aria-describedby="ico_err"/>
<p id="ico_err" class="field-err" hidden role="alert"></p>
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
<label for="previewSlot">Náhled reklamní pozice</label>
<p class="previewHint muted">Náhled odpovídá skutečné prémiové pozici na tomto zařízení (stejná geometrie jako P1–P4 na InfoUzel.cz).</p>
<div class="previewWrap" id="iuAffiliateView">
<div class="iuRadioGrid iuJRGrid iuPremiumGrid">
<a id="previewSlot" class="iuPremiumSlot iuPremiumSlot--sold iuPremiumSlot--logo" href="#" tabindex="-1" aria-hidden="true"></a>
</div>
</div>
<label for="note">Poznámka</label>
<textarea id="note" rows="2"></textarea>
<p class="legal">Odesláním žádosti souhlasíte s <a href="/premium/terms" target="_blank" rel="noopener">Obchodními podmínkami Premium</a> (verze ${PREMIUM_TERMS_VERSION}, účinnost ${PREMIUM_TERMS_EFFECTIVE_AT}).</p>
${privacy}
<button type="submit" id="submit_btn">Odeslat k posouzení</button>
<p id="err" class="err" hidden role="alert"></p>
</form>
<div id="done" class="card" hidden><p class="muted">Objednávka odeslána k posouzení. Po schválení a zveřejnění obdržíte e-mail.</p></div>
</main>
<script nonce="${nonce}">${clientScript}</script>
</body>
</html>`;
}
