#!/usr/bin/env node
/**
 * Phase 3Z V14 — production gates: positive preservation, DOM inventory,
 * deterministic catalog, armed static overlay invariants, Paragon blocker,
 * audit integrity helper.
 *
 * V24: public swap is intentionally ARMED in production static catalog.
 * Counts track authoritative joined/buttons (Paragon held = missingMainButtons).
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

const buttonCount = Number(staticCatalog.counts?.buttons || 0);
const joinedCount = Number(staticCatalog.counts?.joined || 0);
const readyCount = Number(staticCatalog.counts?.mainButtonReady || 0);

expect("public_swap_armed_catalog", staticCatalog.publicButtonSwapArmed === true);
expect("live_enabled", staticCatalog.liveEnabled === true);
expect("browser_no_cj_api", staticCatalog.browserCjApiDependency === false);
/* V51.8: after 4camping/Picasee/Impresi static enrollment, counts must track buttons[]. */
expect("joined_matches_buttons_plus_blockers", joinedCount === buttonCount + Number(staticCatalog.counts?.missingMainButtons || 0), staticCatalog.counts);
expect("ready_matches_buttons", readyCount === buttonCount, staticCatalog.counts);
expect("buttons_gt0", buttonCount >= 175, staticCatalog.counts);
expect("missing_main_1", Number(staticCatalog.counts?.missingMainButtons || 0) === 1, staticCatalog.counts);
expect("buttons_178_after_three_partner_enroll", buttonCount === 178, staticCatalog.counts);
expect("joined_179_after_three_partner_enroll", joinedCount === 179, staticCatalog.counts);
expect("dups_0", staticCatalog.counts.duplicates === 0);
expect("paragon_blocked", (staticCatalog.remainingBlockers || []).some((b) => String(b.advertiserId) === "4686326"));
expect("svelt_elektro", (staticCatalog.buttons || []).some((b) => String(b.advertiserId) === "7995512" && b.sectionId === "aff-elektro"));

const rebuilt = buildStaticMainButtonCatalog(registry);
/* Static V13 may include manually enrolled MAIN buttons ahead of registry snapshot rebuild. */
expect(
  "rebuild_not_exceed_static",
  rebuilt.counts.buttons <= buttonCount,
  { rebuilt: rebuilt.counts.buttons, staticButtons: buttonCount }
);
expect(
  "static_includes_registry_ready",
  rebuilt.counts.buttons === 0 || buttonCount >= rebuilt.counts.buttons,
  rebuilt.counts
);

// Armed production catalog must be detected by disarmed preflight (fail-closed signal).
const pre = evaluateSwapPreflight({ registry, staticCatalog, publicButtonSwapArmed: false });
expect(
  "preflight_detects_armed_catalog",
  pre.ok === false && Array.isArray(pre.blockers) && pre.blockers.includes("catalog_claims_armed"),
  pre.blockers
);
expect("preflight_would_not_publish_when_caller_disarmed", pre.wouldPublish === false);

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
expect("dry_added_static_matches_buttons", dry.counts.addedStaticCj === buttonCount, dry.counts);
expect("dry_removed_legacy_gt0", dry.counts.removedLegacyCj > 0, dry.counts);
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
expect("dom_all_buttons", inv.counts.buttons === buttonCount, inv.counts);
expect("dom_gt8", inv.gt8Sections.length >= 1, inv.gt8Sections);
const html = buildPreviewHtml(staticCatalog, inv);
const chipN = (html.match(/<a class="iuRadioChip iuAffiliateChip"/g) || []).length;
expect("preview_html_chip_count", chipN === buttonCount, { n: chipN, expected: buttonCount });
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
  publicButtonSwapArmed: staticCatalog.publicButtonSwapArmed === true,
  productionArmedVerified:
    failures.length === 0 &&
    staticCatalog.publicButtonSwapArmed === true &&
    staticCatalog.liveEnabled === true &&
    pos.ok === true &&
    inv.ok === true,
};
console.log(JSON.stringify(out, null, 2));
if (!out.ok) process.exitCode = 2;
