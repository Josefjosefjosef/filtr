#!/usr/bin/env node
/**
 * Phase 3Z V15 — classify every historical / MANUAL_PROTECTED catalog chip.
 * CJ tracking URL ⇒ LEGACY_CJ_REMOVE (no MANUAL_PROTECTED exception).
 * True non-CJ ⇒ NON_CJ_PRESERVE. Paid ads ⇒ PAID_AD_SLOT_PRESERVE (external).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isCjTrackingUrl,
  extractLinkIdFromUrl,
  assertAllowedDataWrite,
} from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import { parseAffiliateCatalogOrdered } from "./iu-cj-affiliate-phase2-partner-slot-inventory-v1.mjs";

export const PHASE3Z_V15_LEGACY_CLASSIFY_SCHEMA = "iu-affiliate-cj-legacy-classify-v15";

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

function normTitleKey(t) {
  try {
    return String(t || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "");
  } catch {
    return String(t || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }
}

function classifyItem({ title, url, sectionId, management, advertiserId, source }, staticByKey) {
  const cj = isCjTrackingUrl(url);
  const linkMeta = extractLinkIdFromUrl(url);
  const key = sectionId + "::" + normTitleKey(title);
  const staticMatch = staticByKey.get(key) || null;
  let decision;
  if (cj) decision = "LEGACY_CJ_REMOVE";
  else if (String(management || "").toUpperCase() === "PAID_RESERVED" && !cj) {
    decision = "PAID_AD_SLOT_PRESERVE";
  } else if (!cj) decision = "NON_CJ_PRESERVE";
  else decision = "UNRESOLVED_BLOCK_SWAP";

  return {
    title,
    url,
    sectionId,
    management: management || null,
    historicalFlag: management || source || null,
    affiliateNetwork: cj ? "CJ" : "NON_CJ",
    isCjTrackingUrl: cj,
    advertiserId: advertiserId != null ? String(advertiserId) : linkMeta?.advertiserId || null,
    cjLinkId: linkMeta?.linkId || null,
    websitePid: linkMeta?.pid || null,
    decision,
    matchingStaticButton: staticMatch
      ? {
          advertiserId: staticMatch.advertiserId,
          title: staticMatch.title,
          url: staticMatch.url,
          sectionId: staticMatch.sectionId,
        }
      : null,
    note:
      decision === "LEGACY_CJ_REMOVE"
        ? "Historical CJ chip must be removed on approved swap; new button only if JOINED+authorized in static catalog."
        : decision === "NON_CJ_PRESERVE"
          ? "True non-CJ link preserved."
          : "Requires manual resolution before armed swap.",
  };
}

export function classifyAllLegacy({ catalogJsText, slotPolicy, staticCatalog, managedPublic } = {}) {
  const ordered = parseAffiliateCatalogOrdered(catalogJsText || "");
  const staticByKey = new Map();
  for (const s of staticCatalog?.sections || []) {
    for (const b of s.buttons || []) {
      staticByKey.set(s.sectionId + "::" + normTitleKey(b.title), { ...b, sectionId: s.sectionId });
    }
  }

  const baked = [];
  for (const sec of ordered?.sections || []) {
    for (const it of sec.items || []) {
      baked.push(
        classifyItem(
          {
            title: it.title,
            url: it.url,
            sectionId: sec.sectionId,
            management: it.management || null,
            advertiserId: it.advertiserId,
            source: "baked",
          },
          staticByKey
        )
      );
    }
  }

  const manualProtected = [];
  for (const p of slotPolicy?.partners || []) {
    if (String(p.management || "").toUpperCase() !== "MANUAL_PROTECTED") continue;
    manualProtected.push(
      classifyItem(
        {
          title: p.title,
          url: p.url,
          sectionId: p.sectionId,
          management: "MANUAL_PROTECTED",
          advertiserId: p.advertiserId,
          source: "slot_policy",
        },
        staticByKey
      )
    );
  }

  const managed = [];
  for (const p of managedPublic?.partners || []) {
    managed.push(
      classifyItem(
        {
          title: p.title,
          url: p.url,
          sectionId: p.sectionId,
          management: "CJ_MANAGED",
          advertiserId: p.advertiserId,
          source: "managed_public",
        },
        staticByKey
      )
    );
  }

  const decisions = { LEGACY_CJ_REMOVE: 0, NON_CJ_PRESERVE: 0, PAID_AD_SLOT_PRESERVE: 0, UNRESOLVED_BLOCK_SWAP: 0 };
  for (const row of [...baked, ...manualProtected]) {
    decisions[row.decision] = (decisions[row.decision] || 0) + 1;
  }

  const manualAllCj = manualProtected.every((r) => r.decision === "LEGACY_CJ_REMOVE");
  const unresolved = [...baked, ...manualProtected].filter((r) => r.decision === "UNRESOLVED_BLOCK_SWAP");

  return {
    schema: PHASE3Z_V15_LEGACY_CLASSIFY_SCHEMA,
    publicButtonSwapArmed: false,
    counts: {
      bakedTotal: baked.length,
      bakedCj: baked.filter((r) => r.isCjTrackingUrl).length,
      bakedNonCj: baked.filter((r) => !r.isCjTrackingUrl).length,
      manualProtected: manualProtected.length,
      manualProtectedCj: manualProtected.filter((r) => r.isCjTrackingUrl).length,
      managedDynamic: managed.length,
      decisions,
    },
    allManualProtectedClassified: unresolved.length === 0 && manualProtected.length > 0,
    allManualProtectedAreLegacyCj: manualAllCj,
    unresolvedCount: unresolved.length,
    manualProtected,
    baked,
    managedSample: managed.slice(0, 20),
    ok: unresolved.length === 0 && manualAllCj && baked.every((b) => b.isCjTrackingUrl || b.decision === "NON_CJ_PRESERVE"),
    note: "V15: MANUAL_PROTECTED does not preserve CJ chips. Identity = tracking URL / network, not historical flag.",
  };
}

function main() {
  const argv = process.argv.slice(2);
  const catalogJs = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
  const slotPolicy = readJson(path.join(ROOT, "projects", "data", "iu-affiliate-slot-policy-v1.json"));
  const staticCatalog = readJson(
    path.join(ROOT, "projects", "data", "iu-affiliate-cj-main-buttons-static-v13.json")
  );
  const managedPublic = readJson(
    path.join(ROOT, "projects", "data", "iu-affiliate-cj-managed-public-v1.json")
  );
  const report = classifyAllLegacy({ catalogJsText: catalogJs, slotPolicy, staticCatalog, managedPublic });
  const out = path.join(ROOT, "projects", "data", "iu-affiliate-cj-legacy-classify-v15.json");
  const writeRepo = argv.includes("--write-repo") || process.env.IU_CJ_PHASE3Z_WRITE_REPO === "1";
  if (writeRepo) {
    assertAllowedDataWrite(out);
    writeJson(out, report);
  }
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        counts: report.counts,
        allManualProtectedAreLegacyCj: report.allManualProtectedAreLegacyCj,
        unresolvedCount: report.unresolvedCount,
        wrote: writeRepo,
      },
      null,
      2
    )
  );
  if (!report.ok) process.exitCode = 2;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
