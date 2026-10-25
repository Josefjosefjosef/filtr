#!/usr/bin/env node
/**
 * Phase 3E — affiliate section capacity audit (read-only).
 * Confirms freeEmpty slot claim; never mutates catalog.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildCatalogSlotInventory } from "./iu-cj-affiliate-phase2-partner-slot-inventory-v1.mjs";
import { summarizeCapacity } from "./iu-cj-affiliate-phase3e-partner-recon-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function auditAffiliateSectionCapacity(opts = {}) {
  const catalogSrc =
    opts.catalogSrc != null
      ? opts.catalogSrc
      : fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
  const inventory = buildCatalogSlotInventory({ catalogSrc });
  const summary = summarizeCapacity(inventory);
  return {
    schema: "iu-cj-phase3e-capacity-audit-v1",
    at: new Date().toISOString(),
    ok: true,
    catalogMutated: false,
    dynamicModel: summary.dynamicModel || "unlimited_overlay",
    freeEmptySlotCount: summary.freeEmptySlotCount,
    freeEmptyGateActive: false,
    occupiedButtonCount: summary.occupiedButtonCount,
    reservedSlotCount: summary.reservedSlotCount,
    blockedSlotCount: summary.blockedSlotCount,
    paidSlotCount: summary.paidSlotCount,
    sectionCount: summary.sectionCount,
    emptySections: summary.emptySections,
    sections: summary.sections,
    uiNote: summary.uiNote,
    businessProposal: summary.businessProposal,
    viewportNote:
      "Same item list drives PC/tablet/mobile/PWA. Dynamic CJ chips are unlimited via overlay; paid/manual positions unchanged.",
  };
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const r = auditAffiliateSectionCapacity();
  console.log(
    JSON.stringify({
      IU_CJ_PHASE3E_CAPACITY_AUDIT: r.ok ? "OK" : "FAIL",
      freeEmptySlotCount: r.freeEmptySlotCount,
      occupiedButtonCount: r.occupiedButtonCount,
      emptySections: r.emptySections,
      dynamicModel: r.dynamicModel,
      overflowRetired: r.businessProposal.overflowCatalogOutsidePaidSlots.retired === true,
    })
  );
  process.exit(r.ok ? 0 : 1);
}
