#!/usr/bin/env node
/**
 * Regression guard — premium order form invariants (IČO order, phone, cancel, preview grid).
 * Run: npm run iu-premium-order-form-guard
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const orderUi = read("cloudflare/iu-ads/src/premium-order-ui.ts");
const orderScript = read("cloudflare/iu-ads/src/premium-order-ui-script.ts");
const liveSlot = read("cloudflare/iu-ads/src/premium-live-slot-css.ts");
const publicOrder = read("cloudflare/iu-ads/src/public-premium-order.ts");
const publicJs = read("assets/iu-premium-selected-services-v1.js");
const indexTs = read("cloudflare/iu-ads/src/index.ts");

const icoPos = orderUi.indexOf('id="ico"');
const companyPos = orderUi.indexOf('id="company_name"');
ok("ico_before_company", icoPos > 0 && companyPos > icoPos);
ok("privacy_philosophy_in_keyterms", /PREMIUM_ORDER_PRIVACY_PERIOD_PARAGRAPH_CS/.test(read("cloudflare/iu-ads/src/premium-terms.ts")));
ok("privacy_not_under_h1", !/<h1>Prémiová reklamní pozice<\/h1>\s*<p class="muted">infoUzel\.cz nesleduje/.test(orderUi));
ok("authorization_checkbox", /id="authorization_confirmed"/.test(orderUi) && /oprávněn\/a objednat tuto reklamu/.test(orderUi));
ok("ordering_person_single_field", /id="ordering_person_name"/.test(orderUi) && /Jméno a příjmení objednávající osoby/.test(orderUi));
ok("server_authorization_validation", /authorization_confirmed !== true/.test(publicOrder) && /ordering_person_name/.test(publicOrder));
ok("preview_block_center", /previewBlock/.test(orderUi) && /margin-left:auto;margin-right:auto/.test(liveSlot));
ok("banner_full_bleed_css", /iuPremiumSlot--banner\{padding:0\}/.test(liveSlot.replace(/\s/g, "")));
ok("total_price_wording", /formatPremiumTotalPriceLabelCs/.test(read("cloudflare/iu-ads/src/premium-selected-services.ts")));
ok("b2b_plain_cs", /Reklamní služba je určena výhradně podnikatelům a firmám/.test(orderUi));
ok("phone_required_label", /Telefon \*/.test(orderUi));
ok("phone_required_attr", /id="phone"[^>]*required/.test(orderUi.replace(/\s+/g, " ")));
ok("cancel_button", /id="cancel_btn"/.test(orderUi) && /Zrušit a zavřít/.test(orderUi));
ok("preview_hint_device", /Takto bude vaše reklama vypadat v prémiové pozici na tomto zařízení/.test(orderUi));
ok("preview_position_grid", /iuPremiumPreviewGrid--p/.test(orderUi));
ok("no_preview_fullwidth_hack", !/previewWrap[\s\S]*\.iuPremiumSlot\{[^}]*width:100%/.test(liveSlot.replace(/\n/g, "")) || /justify-self:stretch/.test(liveSlot));
ok("preview_grid_centered_slot", /iuPremiumPreviewGrid[\s\S]*justify-content:center/.test(liveSlot));
ok("server_phone_validation", /validatePremiumPhone/.test(publicOrder));
ok("ares_route", /\/v1\/public\/ares\/ico/.test(indexTs));
ok("client_ares_lookup", /\/v1\/public\/ares\/ico/.test(orderScript));
ok("client_phone_validation", /validatePhoneClient/.test(orderScript));
ok("client_cancel_close", /closeOrderForm/.test(orderScript) && /cancel_btn/.test(orderScript));
ok("return_session_storage", /iuPremiumOrderReturn/.test(publicJs) && /iuPremiumOrderReturn/.test(orderScript));
ok("creative_requirements", /max\. 5 MB/.test(orderUi) && /Logo<\/span>/.test(orderUi));
ok("creative_mode_five", /image_small/.test(orderUi) && /image_medium/.test(orderUi) && /image_large/.test(orderUi));
ok("premium_file_picker", /iuPremiumFilePick/.test(orderUi) && /Vybrat obrázek/.test(orderUi));
ok("creative_mode_server_five", /PREMIUM_CREATIVE_MODE_SET/.test(publicOrder));
ok("shared_creative_render", /bindPremiumCreativeImage/.test(read("assets/iu-premium-creative-render-v1.js")));
ok("no_tracking_endpoint", !/\/v1\/public\/premium\/selected-services\/click/.test(indexTs));

if (fails.length) {
  console.error("FAIL iu-premium-order-form-guard-v1");
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log("PASS iu-premium-order-form-guard-v1");
