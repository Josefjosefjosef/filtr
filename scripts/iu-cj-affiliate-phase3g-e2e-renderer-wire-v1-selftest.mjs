#!/usr/bin/env node
/**
 * Offline Phase 3G selftest — catalog.js overlay extract + render contract.
 * Does not require live CJ pack (uses fixture overlay). When live pack exists in %TEMP%,
 * also asserts live E2E path stays DISARMED.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractCatalogJsOverlayApplicator,
  cloneCatalogForOverlay,
  renderSectionChipsFromCatalogJs,
  runPhase3gE2e,
} from "./iu-cj-affiliate-phase3g-e2e-renderer-wire-v1.mjs";
import { syncUnlimitedDynamicCatalog } from "./iu-cj-affiliate-phase3f-dynamic-catalog-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEBSITE_PID = "101883843";
const u = (n) => "https://www.kqzyfj.com/click-" + WEBSITE_PID + "-" + n;

const failures = [];
function expect(id, cond, detail) {
  if (!cond) failures.push(detail ? { id, detail } : id);
}

const catalogSrc = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
const extractor = extractCatalogJsOverlayApplicator(catalogSrc);
expect("helpers_extracted", extractor.helpersSrc.includes("Never hide MANUAL_PROTECTED"));
expect("helpers_has_apply", /function applyManagedPublicOverlay\(overlay\)/.test(extractor.helpersSrc));

const catalog = cloneCatalogForOverlay(catalogSrc);
const before = catalog.reduce(
  (n, s) => n + renderSectionChipsFromCatalogJs(s).count,
  0
);

const sync = syncUnlimitedDynamicCatalog({
  joined: [
    { advertiserId: "444001", advertiserName: "E2E New", relationshipStatus: "joined" },
    { advertiserId: "444002", advertiserName: "E2E Keep", relationshipStatus: "joined" },
  ],
  previousManaged: [
    {
      advertiserId: "444002",
      sectionId: "aff-pojisteni",
      title: "E2E Keep",
      url: u(444002),
      active: true,
    },
    {
      advertiserId: "444003",
      sectionId: "aff-pojisteni",
      title: "E2E End",
      url: u(444003),
      active: true,
    },
  ],
  sectionMap: { "444001": "aff-pojisteni", "444002": "aff-pojisteni" },
  urlByAdvertiser: { "444001": u(444001), "444002": u(444002) },
  titleByAdvertiser: { "444001": "E2E New" },
  confirmedEndedAdvertiserIds: ["444003"],
  fetchComplete: true,
  slotPolicyPartners: [
    { advertiserId: "999888", management: "MANUAL_PROTECTED", sectionId: "aff-pojisteni" },
  ],
});

expect("sync_ok", sync.ok === true);
expect("sync_added", sync.added.some((a) => a.advertiserId === "444001"));
expect("sync_removed", sync.removed.some((r) => r.advertiserId === "444003"));

const { applyManagedPublicOverlay } = extractor.bind(catalog);
applyManagedPublicOverlay(sync.nextManagedPublic);
const poj = catalog.find((s) => s.id === "aff-pojisteni");
const chips = renderSectionChipsFromCatalogJs(poj);
expect("new_chip_rendered", chips.chips.some((c) => c.advertiserId === "444001"));
expect("ended_hidden", !chips.chips.some((c) => c.advertiserId === "444003"));
expect(
  "rel_target",
  chips.chips.every((c) => c.rel === "sponsored noopener" && c.target === "_blank")
);
expect("grew_or_stable_total", catalog.reduce((n, s) => n + renderSectionChipsFromCatalogJs(s).count, 0) >= before);

// Protected survives active:false
const cat2 = cloneCatalogForOverlay(catalogSrc);
const sec = cat2.find((s) => (s.items || []).some((it) => it.affiliateUrlReady && it.url));
const item = sec.items.find((it) => it.affiliateUrlReady && it.url);
item.management = "MANUAL_PROTECTED";
item.advertiserId = item.advertiserId || "prot-e2e";
extractor.bind(cat2).applyManagedPublicOverlay({
  partners: [
    {
      advertiserId: item.advertiserId,
      sectionId: sec.id,
      title: item.title,
      url: item.url,
      active: false,
    },
  ],
});
const afterProt = renderSectionChipsFromCatalogJs(sec);
expect("protected_survives", afterProt.chips.some((c) => c.title === item.title));

// Live pack path (optional): must stay DISARMED when present
const livePath = path.join(
  process.env.TEMP || "",
  "iu-cj-phase3e-validation",
  "readiness",
  "iu-affiliate-cj-publication-readiness-live.json"
);
let liveSummary = { ran: false };
if (fs.existsSync(livePath)) {
  const liveReport = runPhase3gE2e({ readinessPath: livePath, root: ROOT });
  liveSummary = {
    ran: true,
    ok: liveReport.ok,
    liveEnabled: liveReport.liveEnabled,
    publishArmed: liveReport.publishArmed,
    joined: liveReport.counts?.joined,
    rendered: liveReport.counts?.renderedChipsAfterOverlay,
    stillManual: liveReport.counts?.stillManualReview,
  };
  expect("live_disarmed", liveReport.liveEnabled === false && liveReport.publishArmed === false);
  expect("live_e2e_ok", liveReport.ok === true, liveReport.reason || liveReport.counts);
  expect(
    "live_rendered_gte_baked",
    liveReport.counts.renderedChipsAfterOverlay >= liveReport.counts.bakedChipsBeforeOverlay
  );
  expect(
    "live_auto_add_grows",
    liveReport.tests?.autoAddNetNewPartner?.renderedGrew === true
  );
  expect("klik_not_manual", !(liveReport.remainingManualReview || []).some((m) => String(m.advertiserId) === "5871720"));
  expect("klik_mapped", liveReport.tests?.klikPrimaryPojisteni === true);
}

const ok = failures.length === 0;
console.log(
  JSON.stringify({
    IU_CJ_PHASE3G_E2E_SELFTEST: ok ? "OK" : "FAIL",
    failures,
    liveSummary,
  })
);
process.exit(ok ? 0 : 1);
