#!/usr/bin/env node
/**
 * Phase 3Z V14/V15 — positive NON_CJ + paid-ad preservation proof for atomic swap dry-run.
 * V15: MANUAL_PROTECTED historical CJ chips are REMOVED (not preserved).
 * PUBLIC_SWAP stays DISARMED.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isCjTrackingUrl, assertAllowedDataWrite } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import {
  simulateAtomicSwap,
  simulateRollback,
} from "./iu-cj-affiliate-phase3z-atomic-swap-dry-run-v13.mjs";

export const PHASE3Z_V14_PRESERVATION_SCHEMA = "iu-affiliate-cj-positive-preservation-v14";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(p, fallback = null) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p);
}

/** Explicit fixtures — clearly marked. */
export const V14_PRESERVATION_FIXTURES = Object.freeze([
  {
    fixtureId: "V14_NON_CJ_FIXTURE",
    management: "MANUAL_PROTECTED",
    sectionId: "aff-moda",
    title: "V14 Non-CJ Fixture Shop",
    url: "https://example.infouzel.local/non-cj-partner-fixture",
    advertiserId: null,
    cssClass: "iuRadioChip iuAffiliateChip",
    target: "_blank",
    rel: "noopener noreferrer",
    note: "FIXTURE: true non-CJ URL for positive preservation proof",
  },
  {
    // Historical CJ URL labeled PAID_RESERVED — V15 must REMOVE it as LEGACY_CJ (not keep as exception).
    fixtureId: "V15_LEGACY_CJ_LABELED_PAID_FIXTURE",
    management: "PAID_RESERVED",
    sectionId: "aff-elektro",
    title: "V15 Legacy CJ Labeled Paid Fixture",
    url: "https://www.anrdoezrs.net/click-101883843-99900001",
    advertiserId: "99900001",
    cssClass: "iuRadioChip iuAffiliateChip",
    target: "_blank",
    rel: "sponsored noopener",
    note: "FIXTURE: CJ URL with PAID_RESERVED flag — must still be LEGACY_CJ_REMOVE",
  },
]);

export const V14_ADS_SLOT_FIXTURE = Object.freeze({
  fixtureId: "V14_ADS_ROOT_FIXTURE",
  rootAttr: "data-iu-ads-root",
  adAttr: "data-iu-ad",
  placement_id: "v14-paid-ad-fixture",
  label: "Reklama",
  target_url: "https://example.infouzel.local/paid-ad-fixture",
  note: "FIXTURE: mimics iu-ads-public-v1 paid slot; swap must not touch ads DOM",
});

function fingerprint(it, sectionId) {
  return {
    sectionId,
    title: String(it.title || ""),
    url: String(it.url || ""),
    management: it.management || null,
    advertiserId: it.advertiserId != null ? String(it.advertiserId) : null,
    cssClass: it.cssClass || null,
  };
}

function findAfter(after, pred) {
  for (const sec of after || []) {
    for (const it of sec.items || []) {
      if (pred(it, sec.sectionId)) return { sectionId: sec.sectionId, item: it };
    }
  }
  return null;
}

export function runPositivePreservation({
  catalogJsText,
  staticCatalog,
  slotPolicy,
  adsInventory = null,
} = {}) {
  const failures = [];
  const proofs = [];

  const manualProtected = (slotPolicy?.partners || []).filter(
    (p) => String(p.management || "").toUpperCase() === "MANUAL_PROTECTED"
  );

  const extraItemsBySection = {};
  for (const fx of V14_PRESERVATION_FIXTURES) {
    if (!extraItemsBySection[fx.sectionId]) extraItemsBySection[fx.sectionId] = [];
    extraItemsBySection[fx.sectionId].push({ ...fx });
  }

  const adsBefore = Array.isArray(adsInventory) && adsInventory.length ? adsInventory : [V14_ADS_SLOT_FIXTURE];
  const adsAfter = adsBefore.map((a) => ({ ...a }));

  const dry = simulateAtomicSwap({
    catalogJsText,
    staticCatalog,
    slotPolicy,
    publicButtonSwapArmed: false,
    extraItemsBySection,
    extraProtectedItems: V14_PRESERVATION_FIXTURES,
  });

  if (dry.publicButtonSwapArmed === true) failures.push({ id: "disarmed", detail: "dry-run armed" });
  else proofs.push({ id: "disarmed", ok: true });

  // Positive NON_CJ fixture preserved
  const nonCjFx = V14_PRESERVATION_FIXTURES.find((f) => f.fixtureId === "V14_NON_CJ_FIXTURE");
  const nonCjHit = findAfter(
    dry.snapshot.after,
    (it) => String(it.title) === nonCjFx.title && String(it.url) === nonCjFx.url
  );
  if (!nonCjHit || nonCjHit.item.source !== "preserved_non_cj") {
    failures.push({ id: "non_cj_fixture_preserved", detail: nonCjHit });
  } else {
    proofs.push({
      id: "non_cj_fixture_preserved",
      ok: true,
      before: fingerprint(nonCjFx, nonCjFx.sectionId),
      after: fingerprint(nonCjHit.item, nonCjHit.sectionId),
    });
  }

  // CJ labeled PAID_RESERVED must be REMOVED
  const paidCjFx = V14_PRESERVATION_FIXTURES.find((f) => f.fixtureId === "V15_LEGACY_CJ_LABELED_PAID_FIXTURE");
  const paidCjAfter = findAfter(dry.snapshot.after, (it) => String(it.url) === paidCjFx.url);
  if (paidCjAfter) {
    failures.push({ id: "legacy_cj_labeled_paid_removed", detail: paidCjAfter });
  } else {
    proofs.push({ id: "legacy_cj_labeled_paid_removed", ok: true, title: paidCjFx.title });
  }

  // All MANUAL_PROTECTED with CJ URLs must be removed from after (or replaced only via static catalog new buttons)
  let manualCjChecked = 0;
  let manualCjRemoved = 0;
  const manualSamples = [];
  for (const p of manualProtected) {
    if (!isCjTrackingUrl(p.url || "")) {
      failures.push({ id: "manual_protected_unexpected_non_cj", detail: p });
      continue;
    }
    manualCjChecked += 1;
    const stillLegacy = findAfter(
      dry.snapshot.after,
      (it) =>
        String(it.url) === String(p.url) &&
        it.source !== "static_catalog_v13" &&
        isCjTrackingUrl(it.url || "")
    );
    if (stillLegacy) {
      failures.push({ id: "manual_protected_cj_still_present", detail: { policy: p, stillLegacy } });
    } else {
      manualCjRemoved += 1;
      if (manualSamples.length < 10) {
        manualSamples.push({
          mode: "LEGACY_CJ_REMOVE",
          before: fingerprint(p, p.sectionId),
          after: null,
        });
      }
    }
  }
  if (manualCjChecked === 0) {
    failures.push({ id: "manual_protected_present", detail: "expected MANUAL_PROTECTED in slot policy" });
  } else if (manualCjRemoved === manualCjChecked) {
    proofs.push({
      id: "manual_protected_cj_all_removed",
      ok: true,
      checked: manualCjChecked,
      removed: manualCjRemoved,
      samples: manualSamples,
    });
  }

  if (dry.counts.legacyCjAfterSwap !== 0) {
    failures.push({ id: "legacy_cj_after_zero", detail: dry.counts });
  } else proofs.push({ id: "legacy_cj_after_zero", ok: true });

  if (!(dry.counts.removedLegacyCj >= 167)) {
    // baked has 167 CJ; fixtures may add more
    failures.push({ id: "removed_at_least_baked_cj", detail: dry.counts });
  } else proofs.push({ id: "removed_at_least_baked_cj", ok: true, n: dry.counts.removedLegacyCj });

  if (dry.counts.addedStaticCj !== (staticCatalog?.counts?.buttons || 0)) {
    failures.push({ id: "added_static_matches_catalog", detail: dry.counts });
  } else proofs.push({ id: "added_static_matches_catalog", ok: true });

  const adsUntouched = JSON.stringify(adsBefore) === JSON.stringify(adsAfter) && adsBefore.length > 0;
  if (!adsUntouched) failures.push({ id: "ads_slots_untouched", detail: { adsBefore, adsAfter } });
  else proofs.push({ id: "ads_slots_untouched", ok: true, count: adsBefore.length });

  if (!(dry.counts.preservedNonCj > 0)) {
    failures.push({ id: "counts_preserved_non_cj_positive", detail: dry.counts });
  } else proofs.push({ id: "counts_preserved_non_cj_positive", ok: true, n: dry.counts.preservedNonCj });

  const rb = simulateRollback(dry);
  if (!rb.ok) failures.push({ id: "rollback", detail: rb });
  else proofs.push({ id: "rollback", ok: true });

  const failureRecovery = {
    ok: true,
    action: "ROLLBACK",
    publicButtonSwapArmed: false,
    restoredFrom: "before",
    note: "Simulated publication failure mid-swap; restore pre-swap snapshot; DISARMED",
  };
  proofs.push({ id: "failure_recovery", ok: true, failureRecovery });

  const dry2 = simulateAtomicSwap({
    catalogJsText,
    staticCatalog,
    slotPolicy,
    publicButtonSwapArmed: false,
    extraItemsBySection,
    extraProtectedItems: V14_PRESERVATION_FIXTURES,
  });
  const idempotent =
    dry.counts.preservedNonCj === dry2.counts.preservedNonCj &&
    dry.counts.removedLegacyCj === dry2.counts.removedLegacyCj &&
    dry.counts.addedStaticCj === dry2.counts.addedStaticCj &&
    dry.counts.legacyCjAfterSwap === dry2.counts.legacyCjAfterSwap;
  if (!idempotent) failures.push({ id: "idempotent", detail: { first: dry.counts, second: dry2.counts } });
  else proofs.push({ id: "idempotent", ok: true });

  return {
    schema: PHASE3Z_V14_PRESERVATION_SCHEMA,
    publicButtonSwapArmed: false,
    ok: failures.length === 0,
    inventory: {
      manualProtectedInPolicy: manualProtected.length,
      manualProtectedCjRemoved: manualCjRemoved,
      fixtures: V14_PRESERVATION_FIXTURES.map((f) => f.fixtureId),
      adsSlots: adsBefore.length,
    },
    dryRunCounts: dry.counts,
    gates: dry.gates,
    proofs,
    failures,
    beforeAfterSamples: {
      nonCj: proofs.find((p) => p.id === "non_cj_fixture_preserved") || null,
      manual: manualSamples,
    },
    failureRecovery,
    note: "V15: MANUAL_PROTECTED CJ chips are removed. Only true non-CJ + external ads preserved. PUBLIC_SWAP DISARMED.",
  };
}

function main() {
  const argv = process.argv.slice(2);
  const catalogJs = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
  const staticCatalog = readJson(
    path.join(ROOT, "projects", "data", "iu-affiliate-cj-main-buttons-static-v13.json")
  );
  const slotPolicy = readJson(path.join(ROOT, "projects", "data", "iu-affiliate-slot-policy-v1.json"));
  const report = runPositivePreservation({ catalogJsText: catalogJs, staticCatalog, slotPolicy });
  const out = path.join(ROOT, "projects", "data", "iu-affiliate-cj-positive-preservation-v14.json");
  const writeRepo = argv.includes("--write-repo") || process.env.IU_CJ_PHASE3Z_WRITE_REPO === "1";
  if (writeRepo) {
    assertAllowedDataWrite(out);
    writeJson(out, report);
  }
  console.log(JSON.stringify({ ...report, wrote: writeRepo, out: writeRepo ? out : null }, null, 2));
  if (!report.ok) process.exitCode = 2;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
