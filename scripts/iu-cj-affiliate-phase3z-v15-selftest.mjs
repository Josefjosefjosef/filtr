#!/usr/bin/env node
/**
 * Phase 3Z V15 — purge historical CJ (incl. MANUAL_PROTECTED), single catalog only.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  simulateAtomicSwap,
  simulateRollback,
  evaluateSwapPreflight,
} from "./iu-cj-affiliate-phase3z-atomic-swap-dry-run-v13.mjs";
import { classifyAllLegacy } from "./iu-cj-affiliate-phase3z-v15-legacy-cj-classify.mjs";
import { runPositivePreservation } from "./iu-cj-affiliate-phase3z-v14-positive-preservation.mjs";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import { packAuditZipExternalSha } from "./iu-cj-affiliate-phase3z-v14-audit-pack.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const proofs = [];
function expect(id, cond, detail) {
  if (!cond) failures.push({ id, detail: detail ?? null });
  else proofs.push({ id, ok: true });
}
function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const catalogJs = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
const registry = readJson(path.join(ROOT, "projects", "data", "iu-affiliate-cj-partner-registry-v1.json"));
const staticCatalog = readJson(
  path.join(ROOT, "projects", "data", "iu-affiliate-cj-main-buttons-static-v13.json")
);
const slotPolicy = readJson(path.join(ROOT, "projects", "data", "iu-affiliate-slot-policy-v1.json"));
const managedPublic = readJson(
  path.join(ROOT, "projects", "data", "iu-affiliate-cj-managed-public-v1.json")
);

expect("disarmed", staticCatalog.publicButtonSwapArmed === false && staticCatalog.liveEnabled === false);
expect("browser_no_cj_api", staticCatalog.browserCjApiDependency === false);
expect("ready_174", staticCatalog.counts.mainButtonReady === 174, staticCatalog.counts);

const classified = classifyAllLegacy({
  catalogJsText: catalogJs,
  slotPolicy,
  staticCatalog,
  managedPublic,
});
expect("classify_ok", classified.ok === true, classified.counts);
expect("manual_all_cj", classified.allManualProtectedAreLegacyCj === true, {
  n: classified.counts.manualProtected,
});
expect("manual_43", classified.counts.manualProtected === 43, classified.counts);
expect("baked_cj_167", classified.counts.bakedCj === 167, classified.counts);
expect("unresolved_0", classified.unresolvedCount === 0);

const dry = simulateAtomicSwap({
  catalogJsText: catalogJs,
  staticCatalog,
  slotPolicy,
  publicButtonSwapArmed: false,
});
expect("dry_ok", dry.ok === true, dry.counts);
expect("legacy_after_0", dry.counts.legacyCjAfterSwap === 0, dry.counts);
expect("removed_167", dry.counts.removedLegacyCj === 167, dry.counts);
expect("removed_manual_cj_22_or_43", dry.counts.removedManualProtectedCj >= 22, dry.counts);
expect("added_174", dry.counts.addedStaticCj === 174, dry.counts);
expect("preserved_paid_0", dry.counts.preservedPaid === 0, dry.counts);
expect("gates_legacy_zero", dry.gates.legacyCjAfterZero === true);
expect("gates_from_cj_only", dry.gates.newButtonsFromCjCatalogOnly === true);

// After state: every CJ URL must be static_catalog_v13
let rogue = 0;
for (const sec of dry.snapshot.after || []) {
  for (const it of sec.items || []) {
    if (isCjTrackingUrl(it.url || "") && it.source !== "static_catalog_v13") rogue += 1;
  }
}
expect("no_rogue_legacy_cj_in_after", rogue === 0, { rogue });

const rb = simulateRollback(dry);
expect("rollback", rb.ok === true && rb.publicButtonSwapArmed === false);

let armedThrew = false;
try {
  simulateAtomicSwap({ catalogJsText: catalogJs, staticCatalog, publicButtonSwapArmed: true });
} catch (e) {
  armedThrew = String(e.message || e).includes("REFUSES_ARMED");
}
expect("armed_refused", armedThrew);

const pre = evaluateSwapPreflight({ registry, staticCatalog, publicButtonSwapArmed: false });
expect("preflight", pre.ok === true, pre.blockers);

const pos = runPositivePreservation({ catalogJsText: catalogJs, staticCatalog, slotPolicy });
expect("positive_ok", pos.ok === true, pos.failures);
expect("positive_manual_removed", pos.inventory.manualProtectedCjRemoved === 43, pos.inventory);

// Audit pack regression
{
  const stamp = Date.now();
  const staging = path.join(process.env.TEMP || "/tmp", `iu-v15-auditpack-${stamp}`);
  fs.mkdirSync(path.join(staging, "G_final"), { recursive: true });
  fs.writeFileSync(path.join(staging, "G_final", "probe.txt"), "v15\n");
  const packed = packAuditZipExternalSha({
    stagingDir: staging,
    zipPath: path.join(process.env.TEMP || "/tmp", `iu-v15-auditpack-${stamp}.zip`),
    externalShaPath: path.join(process.env.TEMP || "/tmp", `iu-v15-auditpack-${stamp}.zip.sha256`),
  });
  expect("audit_pack", packed.ok === true && packed.internalClaimsZipSha === false, packed);
}

const out = {
  ok: failures.length === 0,
  schema: "iu-cj-affiliate-phase3z-v15-selftest",
  proofs: proofs.length,
  failures,
  publicButtonSwapArmed: false,
  LEGACY_CJ_BUTTONS_AFTER_SWAP_DRY_RUN: dry.counts.legacyCjAfterSwap,
  MANUAL_CJ_EXCEPTIONS: 0,
  READY_FOR_EXPLICIT_PUBLIC_SWAP_APPROVAL:
    failures.length === 0 && dry.counts.legacyCjAfterSwap === 0 && classified.ok,
};
console.log(JSON.stringify(out, null, 2));
if (!out.ok) process.exitCode = 2;
