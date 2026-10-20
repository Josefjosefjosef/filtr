#!/usr/bin/env node
/** Fixture state → publication pipeline → section offer view model (no public mount). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSectionOfferViewModel } from "./iu-cj-affiliate-phase2-offer-cards-view-model.mjs";
import { PRODUCTION_SIGNING_ENABLED } from "./iu-cj-affiliate-phase2-email-ingest-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function fail(id, detail) {
  failures.push({ id, detail });
}

const vm = await buildSectionOfferViewModel(null, {
  linkId: "17365257",
  sectionKey: "aff-auto-moto",
  partnerSlug: "autohotarek",
});

if (PRODUCTION_SIGNING_ENABLED !== false) fail("signing_must_be_off", { PRODUCTION_SIGNING_ENABLED });

if (vm.previewOnly !== true) fail("preview_only_flag", { previewOnly: vm.previewOnly });

const cards = vm.productCards || [];
if (cards.length < 1) fail("expected_product_cards", { count: cards.length });

const readyImages = cards.filter((c) => c.imageUrl);
const blockedImages = cards.filter((c) => !c.imageUrl && c.publicationReady !== true);
if (readyImages.some((c) => String(c.imageUrl || "").startsWith("http://"))) {
  fail("insecure_image_url", { count: readyImages.length });
}

if (vm.coupon && vm.coupon.publicationReady === true && !vm.coupon.affiliateUrl) {
  fail("coupon_ready_without_url", {});
}

const fixturePath = path.join(repoRoot, "scripts", "fixtures", "cj-phase2-preview-autohotarek.json");
if (fs.existsSync(fixturePath)) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  if (fixture.sectionKey !== vm.sectionKey) fail("fixture_section_mismatch", { fixture: fixture.sectionKey, vm: vm.sectionKey });
} else {
  fail("missing_preview_fixture", { fixturePath });
}

console.log(
  JSON.stringify({
    IU_CJ_OFFERS_DATAFLOW_OFFLINE_SELFTEST: failures.length ? "FAIL" : "OK",
    productCount: cards.length,
    couponPresent: Boolean(vm.coupon),
    publicationReadyProducts: cards.filter((c) => c.publicationReady === true).length,
    fail: failures.length,
    failures,
  })
);
process.exit(failures.length ? 1 : 0);
