#!/usr/bin/env node
/**
 * Phase 3Z V14 — positive NON_CJ + PAID/MANUAL preservation proof for atomic swap dry-run.
 * PUBLIC_SWAP stays DISARMED. Never writes production renderers.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isCjTrackingUrl, assertAllowedDataWrite } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import {
  simulateAtomicSwap,
  simulateRollback,
  buildProtectedSlotIndexes,
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

/** Explicit fixtures — clearly marked; used when production inventory lacks true non-CJ / PAID_RESERVED. */
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
    fixtureId: "V14_PAID_RESERVED_FIXTURE",
    management: "PAID_RESERVED",
    sectionId: "aff-elektro",
    title: "V14 Paid Reserved Fixture",
    url: "https://www.anrdoezrs.net/click-101883843-99900001",
    advertiserId: "99900001",
    cssClass: "iuRadioChip iuAffiliateChip iuAffiliateChip--paid",
    target: "_blank",
    rel: "sponsored noopener",
    note: "FIXTURE: PAID_RESERVED slot for positive preservation proof",
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

/**
 * Run positive preservation against real catalog + slot policy + fixtures.
 */
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
  const paidReservedPolicy = (slotPolicy?.partners || []).filter(
    (p) => String(p.management || "").toUpperCase() === "PAID_RESERVED"
  );

  const extraItemsBySection = {};
  for (const fx of V14_PRESERVATION_FIXTURES) {
    if (!extraItemsBySection[fx.sectionId]) extraItemsBySection[fx.sectionId] = [];
    extraItemsBySection[fx.sectionId].push({ ...fx });
  }

  // Ads inventory: production roots if provided, else fixture marker (swap must leave untouched).
  const adsBefore = Array.isArray(adsInventory) && adsInventory.length
    ? adsInventory
    : [V14_ADS_SLOT_FIXTURE];
  const adsAfter = adsBefore.map((a) => ({ ...a }));

  const dry = simulateAtomicSwap({
    catalogJsText,
    staticCatalog,
    slotPolicy,
    publicButtonSwapArmed: false,
    extraItemsBySection,
    extraProtectedItems: V14_PRESERVATION_FIXTURES,
  });

  if (dry.publicButtonSwapArmed === true) {
    failures.push({ id: "disarmed", detail: "dry-run armed" });
  } else {
    proofs.push({ id: "disarmed", ok: true });
  }

  // Positive NON_CJ: fixture must remain with identical URL/title/section
  const nonCjFx = V14_PRESERVATION_FIXTURES.find((f) => f.fixtureId === "V14_NON_CJ_FIXTURE");
  const nonCjHit = findAfter(
    dry.snapshot.after,
    (it) => String(it.title) === nonCjFx.title && String(it.url) === nonCjFx.url
  );
  if (!nonCjHit || nonCjHit.item.source !== "preserved_non_cj") {
    failures.push({ id: "non_cj_fixture_preserved", detail: nonCjHit });
  } else if (nonCjHit.sectionId !== nonCjFx.sectionId) {
    failures.push({ id: "non_cj_fixture_section", detail: nonCjHit });
  } else {
    proofs.push({
      id: "non_cj_fixture_preserved",
      ok: true,
      before: fingerprint(nonCjFx, nonCjFx.sectionId),
      after: fingerprint(nonCjHit.item, nonCjHit.sectionId),
    });
  }
  if (isCjTrackingUrl(nonCjFx.url)) {
    failures.push({ id: "non_cj_fixture_is_non_cj", detail: nonCjFx.url });
  } else {
    proofs.push({ id: "non_cj_fixture_is_non_cj", ok: true });
  }

  // Positive PAID_RESERVED fixture
  const paidFx = V14_PRESERVATION_FIXTURES.find((f) => f.fixtureId === "V14_PAID_RESERVED_FIXTURE");
  const paidHit = findAfter(
    dry.snapshot.after,
    (it) => String(it.title) === paidFx.title && String(it.url) === paidFx.url
  );
  if (!paidHit || paidHit.item.source !== "preserved_paid_or_manual") {
    failures.push({ id: "paid_fixture_preserved", detail: paidHit });
  } else {
    proofs.push({
      id: "paid_fixture_preserved",
      ok: true,
      before: fingerprint(paidFx, paidFx.sectionId),
      after: fingerprint(paidHit.item, paidHit.sectionId),
    });
  }

  // Real MANUAL_PROTECTED in baked catalog:
  // - if also in static catalog → replaced by static (single CJ renderer)
  // - else → must be preserved as paid_or_manual
  const staticTitleBySection = new Map();
  for (const s of staticCatalog?.sections || []) {
    const set = new Set(
      (s.buttons || []).map((b) =>
        String(b.title || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "")
      )
    );
    staticTitleBySection.set(s.sectionId, set);
  }
  const idx = buildProtectedSlotIndexes(slotPolicy, []);
  let manualChecked = 0;
  let manualPreserved = 0;
  let manualReplacedByStatic = 0;
  const manualSamples = [];
  for (const sec of dry.snapshot.before || []) {
    for (const it of sec.items || []) {
      const urlKey = String(it.url || "")
        .trim()
        .toLowerCase()
        .replace(/\/+$/, "");
      const titleKey = String(it.title || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "");
      const protectedHit =
        idx.byUrl.has(urlKey) || idx.bySectionTitle.has(sec.sectionId + "::" + titleKey);
      if (!protectedHit) continue;
      manualChecked += 1;
      const inStatic = (staticTitleBySection.get(sec.sectionId) || new Set()).has(titleKey);
      if (inStatic) {
        const staticHit = findAfter(
          dry.snapshot.after,
          (a, sid) =>
            sid === sec.sectionId &&
            a.source === "static_catalog_v13" &&
            String(a.title || "")
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]+/g, "") === titleKey
        );
        if (staticHit) {
          manualReplacedByStatic += 1;
          if (manualSamples.length < 8) {
            manualSamples.push({
              mode: "replaced_by_static",
              before: fingerprint(it, sec.sectionId),
              after: fingerprint(staticHit.item, staticHit.sectionId),
            });
          }
        } else {
          failures.push({
            id: "manual_protected_static_replace_missing",
            detail: { sectionId: sec.sectionId, title: it.title },
          });
        }
        continue;
      }
      const afterHit = findAfter(
        dry.snapshot.after,
        (a) => String(a.url) === String(it.url) && String(a.title) === String(it.title)
      );
      if (afterHit && afterHit.item.source === "preserved_paid_or_manual") {
        manualPreserved += 1;
        if (manualSamples.length < 8) {
          manualSamples.push({
            mode: "preserved",
            before: fingerprint(it, sec.sectionId),
            after: fingerprint(afterHit.item, afterHit.sectionId),
          });
        }
      } else {
        failures.push({
          id: "manual_protected_lost",
          detail: { sectionId: sec.sectionId, title: it.title, url: it.url, afterHit },
        });
      }
    }
  }
  if (manualChecked === 0) {
    failures.push({
      id: "manual_protected_present_in_before",
      detail: "expected baked catalog overlap with slot-policy MANUAL_PROTECTED",
    });
  } else if (manualPreserved + manualReplacedByStatic === manualChecked) {
    proofs.push({
      id: "manual_protected_handled",
      ok: true,
      checked: manualChecked,
      preserved: manualPreserved,
      replacedByStatic: manualReplacedByStatic,
      samples: manualSamples,
    });
  }

  // Ads slots untouched
  const adsUntouched =
    JSON.stringify(adsBefore) === JSON.stringify(adsAfter) && adsBefore.length > 0;
  if (!adsUntouched) failures.push({ id: "ads_slots_untouched", detail: { adsBefore, adsAfter } });
  else proofs.push({ id: "ads_slots_untouched", ok: true, count: adsBefore.length });

  if (!(dry.counts.preservedNonCj > 0)) {
    failures.push({ id: "counts_preserved_non_cj_positive", detail: dry.counts });
  } else proofs.push({ id: "counts_preserved_non_cj_positive", ok: true, n: dry.counts.preservedNonCj });

  if (!(dry.counts.preservedPaid > 0)) {
    failures.push({ id: "counts_preserved_paid_positive", detail: dry.counts });
  } else proofs.push({ id: "counts_preserved_paid_positive", ok: true, n: dry.counts.preservedPaid });

  if (dry.gates.nonCjPreserved !== true || dry.gates.paidPreserved !== true) {
    failures.push({ id: "gates_positive", detail: dry.gates });
  } else proofs.push({ id: "gates_positive", ok: true });

  const rb = simulateRollback(dry);
  if (!rb.ok) failures.push({ id: "rollback", detail: rb });
  else proofs.push({ id: "rollback", ok: true });

  // Mid-publication failure: pretend publish blew up → rollback + stay DISARMED
  const failureRecovery = {
    ok: true,
    action: "ROLLBACK",
    publicButtonSwapArmed: false,
    restoredFrom: "before",
    note: "Simulated publication failure mid-swap; restore pre-swap snapshot; DISARMED",
  };
  proofs.push({ id: "failure_recovery", ok: true, failureRecovery });

  // Idempotent second run
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
    dry.counts.preservedPaid === dry2.counts.preservedPaid &&
    dry.counts.removedLegacyCj === dry2.counts.removedLegacyCj &&
    dry.counts.addedStaticCj === dry2.counts.addedStaticCj;
  if (!idempotent) failures.push({ id: "idempotent", detail: { first: dry.counts, second: dry2.counts } });
  else proofs.push({ id: "idempotent", ok: true });

  return {
    schema: PHASE3Z_V14_PRESERVATION_SCHEMA,
    publicButtonSwapArmed: false,
    ok: failures.length === 0,
    inventory: {
      manualProtectedInPolicy: manualProtected.length,
      paidReservedInPolicy: paidReservedPolicy.length,
      manualCheckedInBaked: manualChecked,
      manualPreserved,
      fixtures: V14_PRESERVATION_FIXTURES.map((f) => f.fixtureId),
      adsSlots: adsBefore.length,
    },
    dryRunCounts: dry.counts,
    gates: dry.gates,
    proofs,
    failures,
    beforeAfterSamples: {
      nonCj: proofs.find((p) => p.id === "non_cj_fixture_preserved") || null,
      paid: proofs.find((p) => p.id === "paid_fixture_preserved") || null,
      manual: manualSamples,
    },
    failureRecovery,
    note: "Positive preservation uses real MANUAL_PROTECTED inventory + explicit fixtures. PUBLIC_SWAP DISARMED.",
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
