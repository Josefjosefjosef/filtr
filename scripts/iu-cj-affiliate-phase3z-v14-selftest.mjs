#!/usr/bin/env node
/**
 * Phase 3Z V14 — pre-production gates: positive preservation, DOM inventory,
 * deterministic catalog, DISARMED, Paragon blocker, audit integrity helper.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  buildStaticMainButtonCatalog,
  assertCatalogDeterministic,
} from "./iu-cj-affiliate-phase3z-static-main-catalog-v13.mjs";
import {
  evaluateSwapPreflight,
  simulateAtomicSwap,
  simulateRollback,
} from "./iu-cj-affiliate-phase3z-atomic-swap-dry-run-v13.mjs";
import { runPositivePreservation } from "./iu-cj-affiliate-phase3z-v14-positive-preservation.mjs";
import { buildDomInventory, buildPreviewHtml } from "./iu-cj-affiliate-phase3z-v14-dom-inventory.mjs";
import { PHASE3Z_V14_CLEANUP_INVENTORY } from "./iu-cj-affiliate-phase3z-v14-cleanup-inventory.mjs";
import { packAuditZipExternalSha } from "./iu-cj-affiliate-phase3z-v14-audit-pack.mjs";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";

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

expect("public_swap_disarmed_catalog", staticCatalog.publicButtonSwapArmed === false);
expect("live_disabled", staticCatalog.liveEnabled === false);
expect("browser_no_cj_api", staticCatalog.browserCjApiDependency === false);
expect("joined_175", staticCatalog.counts.joined === 175, staticCatalog.counts);
expect("ready_174", staticCatalog.counts.mainButtonReady === 174, staticCatalog.counts);
expect("dups_0", staticCatalog.counts.duplicates === 0);
expect("paragon_blocked", (staticCatalog.remainingBlockers || []).some((b) => String(b.advertiserId) === "4686326"));

const rebuilt = buildStaticMainButtonCatalog(registry);
expect("rebuild_count", rebuilt.counts.buttons === staticCatalog.counts.buttons, rebuilt.counts);
expect("deterministic", assertCatalogDeterministic(rebuilt, staticCatalog) === true);

const pre = evaluateSwapPreflight({ registry, staticCatalog, publicButtonSwapArmed: false });
expect("preflight_ok", pre.ok === true, pre.blockers);
expect("preflight_disarmed", pre.publicButtonSwapArmed === false && pre.wouldPublish === false);

let armedThrew = false;
try {
  simulateAtomicSwap({ catalogJsText: catalogJs, staticCatalog, publicButtonSwapArmed: true });
} catch (e) {
  armedThrew = String(e.message || e).includes("REFUSES_ARMED");
}
expect("armed_refused", armedThrew);

const dry = simulateAtomicSwap({
  catalogJsText: catalogJs,
  staticCatalog,
  slotPolicy,
  publicButtonSwapArmed: false,
});
expect("dry_ok", dry.ok === true, dry.counts);
expect("dry_removed_legacy", dry.counts.removedLegacyCj === 167, dry.counts);
expect("dry_legacy_after_zero", dry.counts.legacyCjAfterSwap === 0, dry.counts);
expect("dry_no_manual_cj_exception", dry.counts.preservedPaid === 0, dry.counts);
expect("dry_gates_paid", dry.gates.paidPreserved === true, dry.gates);
expect("dry_dups_0", dry.counts.duplicateAdvertiserIdsAfter === 0);
const rb = simulateRollback(dry);
expect("rollback_ok", rb.ok === true && rb.publicButtonSwapArmed === false);

const pos = runPositivePreservation({ catalogJsText: catalogJs, staticCatalog, slotPolicy });
expect("positive_preservation_ok", pos.ok === true, pos.failures);
expect("positive_non_cj", pos.dryRunCounts.preservedNonCj > 0, pos.dryRunCounts);
expect("positive_legacy_cj_zero", pos.dryRunCounts.legacyCjAfterSwap === 0, pos.dryRunCounts);
expect("positive_manual_cj_purged", pos.inventory.manualProtectedCjRemoved === 43, pos.inventory);

const inv = buildDomInventory(staticCatalog);
expect("dom_ok", inv.ok === true, inv.failures);
expect("dom_all_174", inv.counts.buttons === 174, inv.counts);
expect("dom_gt8", inv.gt8Sections.length >= 1, inv.gt8Sections);
const html = buildPreviewHtml(staticCatalog, inv);
expect(
  "preview_html_has_174_chips",
  (html.match(/<a class="iuRadioChip iuAffiliateChip"/g) || []).length === 174,
  { n: (html.match(/<a class="iuRadioChip iuAffiliateChip"/g) || []).length }
);
expect("preview_attrs_blank", html.includes('target="_blank"') && html.includes('rel="sponsored noopener"'));
expect("preview_no_logo_img", !/<img\b/i.test(html));

// Unauthorized / wrong destinations on static buttons
let badDest = 0;
for (const b of staticCatalog.buttons || []) {
  if (!isCjTrackingUrl(b.url)) badDest += 1;
}
expect("unauthorized_0", badDest === 0);

// Cleanup inventory shape
expect(
  "cleanup_has_deactivate",
  (PHASE3Z_V14_CLEANUP_INVENTORY.deactivateOnApprovedSwap || []).length >= 1
);
expect(
  "cleanup_ads_active",
  PHASE3Z_V14_CLEANUP_INVENTORY.items.some(
    (i) => i.id === "ads-public" && i.decision === "ACTIVE_REQUIRED"
  )
);

// Audit pack integrity (TEMP only)
{
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const staging = path.join(process.env.TEMP || "/tmp", `iu-v14-selftest-audit-${stamp}`);
  fs.mkdirSync(path.join(staging, "G_final"), { recursive: true });
  fs.writeFileSync(path.join(staging, "G_final", "probe.txt"), "v14-audit-probe\n");
  const packed = packAuditZipExternalSha({
    stagingDir: staging,
    zipPath: path.join(process.env.TEMP || "/tmp", `iu-v14-selftest-${stamp}.zip`),
    externalShaPath: path.join(process.env.TEMP || "/tmp", `iu-v14-selftest-${stamp}.zip.sha256`),
  });
  expect("audit_pack_ok", packed.ok === true, packed);
  expect("audit_external_sha_matches", packed.zipSha256 === packed.verifiedSha256);
  expect("audit_no_internal_zip_sha", packed.internalClaimsZipSha === false);
}

const out = {
  ok: failures.length === 0,
  schema: "iu-cj-affiliate-phase3z-v14-selftest",
  proofs: proofs.length,
  failures,
  publicButtonSwapArmed: false,
  readyForExplicitPublicSwapApproval:
    failures.length === 0 &&
    staticCatalog.publicButtonSwapArmed === false &&
    pos.ok === true &&
    inv.ok === true,
};
console.log(JSON.stringify(out, null, 2));
if (!out.ok) process.exitCode = 2;
