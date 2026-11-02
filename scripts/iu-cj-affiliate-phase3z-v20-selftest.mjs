#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractWeightedAssortmentEvidence } from "./iu-cj-affiliate-phase3z-merchant-evidence-v9.mjs";
import { getMerchantEvidenceOverride } from "./iu-cj-affiliate-phase3z-merchant-evidence-v9.mjs";
import {
  buildAllOverrideMetrics,
  reconcileOverrideMetrics,
  classifyOverridePartner,
} from "./iu-cj-affiliate-phase3z-v20-override-metrics.mjs";
import { parseAffiliateCatalogOrdered } from "./iu-cj-affiliate-phase2-partner-slot-inventory-v1.mjs";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function expect(name, cond, detail) {
  if (!cond) fails.push({ name, detail: detail || null });
  else console.log("PASS " + name);
}

// --- Abracadabra costume vs kosmetika ---
const html = `<html><head><title>Halloween Costume Store, Cosplay Makeup &amp; Collectibles Gift Shop – AbracadabraNYC</title></head>
<body><h1>Costume Store</h1><nav>Halloween Cosplay Collectibles</nav><main>Costume shop makeup for cosplay</main></body></html>`;
const ev = extractWeightedAssortmentEvidence(html, {
  title: "Halloween Costume Store, Cosplay Makeup & Collectibles Gift Shop – AbracadabraNYC",
  merchantIdentity: "Abracadabra NYC",
  cjCategoryBlob: "gifts & flowers|collectibles",
});
expect(
  "abracadabra_not_kosmetika_primary",
  ev.primaryAssortment?.sectionId === "aff-kvetiny-darky",
  ev.primaryAssortment
);
expect(
  "abracadabra_override",
  getMerchantEvidenceOverride("7889430")?.primaryAssortment?.sectionId === "aff-kvetiny-darky"
);

// --- Override metrics consistency ---
const catalogJs = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
const parsed = parseAffiliateCatalogOrdered(catalogJs);
const pub = new Map();
for (const s of parsed.sections || []) {
  for (const it of s.items || []) {
    if (!it.url || !isCjTrackingUrl(it.url)) continue;
    pub.set(String(it.advertiserId || ""), String(s.id || s.sectionId || ""));
  }
}
const { rows, summary } = buildAllOverrideMetrics(pub);
expect("override_metrics_consistent", summary.consistent === true, summary);
expect(
  "vsc_legacy_equals_override_applied",
  summary.VERIFIED_SAFE_CHANGE_LEGACY === summary.OVERRIDE_APPLIED,
  summary
);
expect("kind_sum_equals_applied", summary.kindSum === summary.OVERRIDE_APPLIED, summary);
expect("abra_published_matches", pub.get("7889430") === "aff-kvetiny-darky");

const abra = classifyOverridePartner({
  advertiserId: "7889430",
  publishedSectionId: "aff-kvetiny-darky",
});
expect("abra_override_published", abra.CATEGORY_CHANGE_PUBLISHED === true && abra.CATEGORY_CHANGE_RECOMMENDED === false, abra);

// Synthetic reconcile of V18 discrepancy
const fake = [
  ...Array.from({ length: 23 }, (_, i) =>
    classifyOverridePartner({ advertiserId: "A" + i, publishedSectionId: "aff-x", override: { primaryAssortment: { sectionId: "aff-x" } } })
  ),
  classifyOverridePartner({
    advertiserId: "NOBTN",
    publishedSectionId: null,
    override: { primaryAssortment: { sectionId: "aff-software" } },
  }),
  ...["5027071", "5260576", "7612998"].map((id) =>
    classifyOverridePartner({
      advertiserId: id,
      publishedSectionId: "aff-new",
      override: { primaryAssortment: { sectionId: "aff-old" } },
    })
  ),
];
const rec = reconcileOverrideMetrics(fake);
expect("fake_kind_sum_27", rec.kindSum === 27 && rec.OVERRIDE_APPLIED === 27, rec);
expect("fake_not_26", rec.OVERRIDE_APPLIED !== 26);

// Content exclusivity note (unit-level classifier import via re-run small)
expect("published_buttons_175", pub.size === 175, pub.size);

if (fails.length) {
  console.error(JSON.stringify({ ok: false, fails }, null, 2));
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      ok: true,
      overrideApplied: summary.OVERRIDE_APPLIED,
      byKind: summary.byKind,
      abracadabraPrimary: ev.primaryAssortment,
    },
    null,
    2
  )
);
