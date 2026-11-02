#!/usr/bin/env node
/**
 * V23 — close deferred partners; Svelt World laptop-stand ≠ travel agency.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMerchantEvidenceOverride } from "./iu-cj-affiliate-phase3z-merchant-evidence-v9.mjs";
import { buildAssortmentProfile } from "./iu-cj-affiliate-phase3z-assortment-v8.mjs";
import { suggestSectionIdFromEmailText } from "./iu-cj-affiliate-phase3z-email-hints-bridge-v19.mjs";
import { parseAffiliateCatalogOrdered } from "./iu-cj-affiliate-phase2-partner-slot-inventory-v1.mjs";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function expect(name, cond, detail) {
  if (!cond) fails.push({ name, detail: detail || null });
  else console.log("PASS " + name);
}

// --- Svelt World ---
const sveltEmail =
  "Welcome to the affiliate account Svelt World! Svelt is a premium portable laptop stand designed for people who work anywhere. It attaches to your laptop, folds flat.";
expect(
  "svelt_email_elektro",
  suggestSectionIdFromEmailText(sveltEmail) === "aff-elektro",
  suggestSectionIdFromEmailText(sveltEmail)
);
expect(
  "svelt_override_elektro",
  getMerchantEvidenceOverride("7995512")?.primaryAssortment?.sectionId === "aff-elektro"
);
expect(
  "svelt_rejects_travel_agency",
  (getMerchantEvidenceOverride("7995512")?.rejectSectionIds || []).includes("aff-cestovni-kancelare")
);
const sveltProf = buildAssortmentProfile({
  advertiser: {
    advertiserName: "Svelt World portable laptop stand",
    programUrl: "https://www.svelt.us/",
    primaryCategory: "Travel|Accessories",
  },
});
expect(
  "svelt_cj_travel_accessories_not_agency",
  sveltProf.primaryAssortment?.sectionId === "aff-elektro",
  sveltProf.primaryAssortment
);

// Catalog bake
const parsed = parseAffiliateCatalogOrdered(
  fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8")
);
let sveltSection = null;
for (const s of parsed.sections || []) {
  for (const it of s.items || []) {
    if (String(it.advertiserId) === "7995512" && it.url && isCjTrackingUrl(it.url)) {
      sveltSection = s.sectionId;
    }
  }
}
expect("svelt_catalog_elektro", sveltSection === "aff-elektro", sveltSection);
expect(
  "svelt_not_in_travel_section",
  !(parsed.sections || [])
    .find((s) => s.sectionId === "aff-cestovni-kancelare")
    ?.items?.some((it) => String(it.advertiserId) === "7995512")
);

// Brasty — perfume shop; dárek zdarma must not force gifts
const brasty =
  "BRASTY.CZ je online obchod s parfémy a kosmetikou. K objednávce navíc obdrží dárek zdarma.";
expect(
  "brasty_not_gifts_from_freebie",
  suggestSectionIdFromEmailText(brasty) !== "aff-kvetiny-darky",
  suggestSectionIdFromEmailText(brasty)
);
expect(
  "brasty_kosmetika_or_null",
  (() => {
    const s = suggestSectionIdFromEmailText(brasty);
    return s === "aff-kosmetika" || s === null;
  })()
);

// Sensilab supplements stay health (not forced cosmetics)
const sensi =
  "Sensilab Europe! Our mission is to help people lead healthier lives. Our brand portfolio consists of a wide array of supplements.";
expect(
  "sensilab_not_forced_kosmetika",
  suggestSectionIdFromEmailText(sensi) !== "aff-kosmetika" ||
    suggestSectionIdFromEmailText(sensi) === "aff-zdravi-doplnky"
);

// Booking still lodging (V22 regression)
expect(
  "booking_still_lodging",
  suggestSectionIdFromEmailText(
    "Welcome to Booking.com. Earth's #1 accommodation site with hotels and vacation homes."
  ) === "aff-ubytovani-hotely"
);

if (fails.length) {
  console.error(JSON.stringify({ ok: false, fails }, null, 2));
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      ok: true,
      sveltSection,
      suite: "v23-nine-partners-close",
    },
    null,
    2
  )
);
