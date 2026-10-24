#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const js = fs.readFileSync(path.join(repoRoot, "assets", "iu-affiliate-phase2-offers-v1.js"), "utf8");
const css = fs.readFileSync(path.join(repoRoot, "assets", "iu-affiliate-phase2-offers-v1.css"), "utf8");
const catalog = fs.readFileSync(path.join(repoRoot, "assets", "iu-affiliate-catalog.js"), "utf8");

const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

expect("localhost_gate", js.includes("isLocalDevHost"));
expect("copy_coupon", js.includes("Kopírovat kód"));
expect("partner_name", js.includes("partnerName"));
expect("conditions", js.includes("conditionsSummary"));
expect("product_image", js.includes("iuAffiliatePhase2Offers__img"));
expect("show_more", js.includes("Zobrazit další"));
expect("no_prod_bypass", js.includes("public_stub_no_staging_data"));
expect("dark_mode_css", css.includes("prefers-color-scheme: dark"));
expect("responsive_grid", css.includes("max-width: 767px"));
expect("cta_label", js.includes("Zobrazit nabídku"));
expect("live_enabled_gate", js.includes("liveEnabled !== true") || js.includes("liveEnabled===true") || js.includes("doc.liveEnabled !== true"));
expect("offers_public_path", js.includes("iu-affiliate-cj-offers-public-v1.json"));
expect("action_without_code", js.includes("Nabídka bez kódu") || js.includes("renderAction"));
expect("orange_cta_css", css.includes("#ea580c") || css.includes("#f97316"));
expect("blue_price_css", css.includes("#1d4ed8") || css.includes("#60a5fa"));
expect("white_card_css", css.includes("background: #fff"));
expect("catalog_hooks_offers", catalog.includes("iuAffiliatePhase2OffersRender"));
expect("catalog_loads_offers_script", catalog.includes("ensurePhase2OffersScript"));
expect("publication_ready_filter", js.includes("publicationReady === true") || js.includes("publicationReady!==true") || js.includes("c.publicationReady === true"));

const ok = failures.length === 0;
console.log(
  JSON.stringify({
    IU_CJ_OFFERS_PREVIEW_UI_SELFTEST: ok ? "OK" : "FAIL",
    failures,
  })
);
process.exit(ok ? 0 : 1);
