#!/usr/bin/env node
/**
 * Phase 3B offers public build selftest (fixture only — not live CJ verification).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  OFFERS_SCHEMA,
  buildOffersFromFixtureXml,
  buildOffersDocumentFromCatalogBatch,
  emptyOffersDocument,
  promoteOffersPublicAtomic,
  rollbackOffersPublicFromLkg,
  validateOffersPublicPayload,
  publicProductFromEvidence,
} from "./iu-cj-affiliate-offers-public-build-v1.mjs";
import { normalizeCjLinkSearchXmlToCatalog } from "./iu-cj-affiliate-phase2-cj-link-search-catalog-normalize-v1.mjs";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";

const failures = [];
function expect(id, cond, detail) {
  if (!cond) failures.push(detail ? { id, detail } : id);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const built = buildOffersFromFixtureXml({});
expect("fixture_build_ok", built.ok === true);
expect("schema", built.doc.schema === OFFERS_SCHEMA);
expect("live_disarmed", built.doc.liveEnabled === false);
expect("source_fixture", built.doc.sourceKind === "fixture_synthetic_anonymized");
expect("zero_live_http", built.doc.CJ_LIVE_HTTP_CALLS === 0);
expect("has_sections_or_empty_ok", Array.isArray(built.doc.sections));
expect("no_publication_ready", built.doc.stats.publicationReady === 0);
expect(
  "all_cards_not_ready",
  built.doc.sections.every((s) =>
    [...(s.coupons || []), ...(s.actions || []), ...(s.products || [])].every(
      (c) => c.publicationReady !== true && c.publishable !== true
    )
  )
);

const v = validateOffersPublicPayload(built.doc, { allowLive: false });
expect("validate_fixture", v.ok === true, v.errors);

const liveBad = { ...built.doc, liveEnabled: true };
const vLive = validateOffersPublicPayload(liveBad, { allowLive: false });
expect("reject_live_without_allow", vLive.ok === false);

const httpFail = normalizeCjLinkSearchXmlToCatalog("<x/>", {
  httpStatus: 500,
  observedAt: "2026-10-24T12:00:00.000Z",
});
const failBuilt = buildOffersDocumentFromCatalogBatch(httpFail, {});
expect("http_error_not_ok", failBuilt.ok === false);
expect("http_error_doc_not_false_ok", failBuilt.doc.ok === false);
expect("http_error_source", failBuilt.doc.sourceKind === "error");

const noPhoto = publicProductFromEvidence(
  { productId: "P1", title: "Test", price: 10, currency: "CZK" },
  {
    couponCode: "X",
    affiliateUrl: "https://www.kqzyfj.com/click-101883843-1",
    partnerMapping: {},
  }
);
expect("no_photo_null_image", noPhoto.imageUrl === null);
expect("no_photo_blocker", noPhoto.blockers.includes("missing_or_invalid_photo"));
expect("no_invented_discount", noPhoto.discountLabel === null);

expect(
  "cj_url_gate",
  isCjTrackingUrl("https://www.kqzyfj.com/click-101883843-123") === true
);
expect(
  "merchant_url_not_cj",
  isCjTrackingUrl("https://www.autohotarek.cz/") === false
);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "iu-offers-"));
const dataDir = path.join(tmpDir, "projects", "data");
fs.mkdirSync(dataDir, { recursive: true });
const dry = promoteOffersPublicAtomic({
  dataDir,
  payload: emptyOffersDocument({ sourceKind: "empty_disarmed" }),
  env: {},
});
expect("promote_disarmed", dry.ok === true && dry.wrote === false && dry.reason === "PROMOTE_DISARMED");

const armed = promoteOffersPublicAtomic({
  dataDir,
  payload: emptyOffersDocument({ sourceKind: "empty_disarmed" }),
  env: { IU_CJ_OFFERS_PROMOTE_ARMED: "1" },
});
expect("promote_armed_write", armed.ok === true && armed.wrote === true);
expect("public_exists", fs.existsSync(path.join(dataDir, "iu-affiliate-cj-offers-public-v1.json")));

const next = emptyOffersDocument({ sourceKind: "empty_disarmed", updatedAt: "2099-01-01T00:00:00.000Z" });
const armed2 = promoteOffersPublicAtomic({
  dataDir,
  payload: next,
  env: { IU_CJ_OFFERS_PROMOTE_ARMED: "1" },
});
expect("lkg_created", armed2.ok && fs.existsSync(path.join(dataDir, "iu-affiliate-cj-offers-public-lkg-v1.json")));
const rb = rollbackOffersPublicFromLkg(dataDir);
expect("rollback_ok", rb.ok === true);

const shipped = path.join(ROOT, "projects", "data", "iu-affiliate-cj-offers-public-v1.json");
expect("shipped_stub_exists", fs.existsSync(shipped));
const stub = JSON.parse(fs.readFileSync(shipped, "utf8"));
expect("shipped_disarmed", stub.liveEnabled === false);
expect("shipped_schema", stub.schema === OFFERS_SCHEMA);
expect("shipped_no_ready", (stub.stats?.publicationReady || 0) === 0);

const policy = JSON.parse(
  fs.readFileSync(path.join(ROOT, "projects", "data", "iu-affiliate-slot-policy-v1.json"), "utf8")
);
const counted = (policy.partners || []).filter((p) => p.management === "MANUAL_PROTECTED").length;
expect("manual_protected_43", counted === 43, { counted });

const ok = failures.length === 0;
console.log(
  JSON.stringify({
    IU_CJ_OFFERS_PUBLIC_BUILD_SELFTEST: ok ? "OK" : "FAIL",
    failures,
    fixtureStats: built.doc?.stats || null,
    manualProtectedCount: counted,
    fixtureKind: "SYNTHETIC_ANONYMIZED_NOT_LIVE_CJ",
  })
);
process.exit(ok ? 0 : 1);
