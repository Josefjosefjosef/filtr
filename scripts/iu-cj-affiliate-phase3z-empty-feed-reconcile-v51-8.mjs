#!/usr/bin/env node
/**
 * Unify CJ_FEED_API_EMPTY partner evidence across inventory + continuation + completeness.
 * Explains 9-vs-11 snapshot drift without renaming failures to PASS.
 */
import fs from "node:fs";
import path from "node:path";
import { emptyPartnersFromFeedCompleteness } from "./iu-cj-affiliate-phase3z-empty-feed-reprobe-v51-8.mjs";

export const EMPTY_FEED_RECONCILE_SCHEMA = "iu-cj-affiliate-phase3z-empty-feed-reconcile-v51-8";

export function reconcileEmptyFeedSnapshots(opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const continuation = opts.continuation || {};
  const inventory = opts.inventory || {};
  const completeness = opts.completeness || null;
  const priorSnapshotIds = Array.isArray(opts.priorEmptyIds) ? opts.priorEmptyIds.map(String) : [];

  const contEmpty = [];
  for (const p of continuation.partners || []) {
    if (p?.emptyApi === true && Number(p.currentLoaded || 0) === 0) {
      contEmpty.push({
        advertiserId: String(p.advertiserId),
        partnerName: p.partnerName || null,
        source: "continuation.emptyApi",
        currentLoaded: p.currentLoaded ?? 0,
        completePassCount: p.completePassCount ?? null,
        lastComplete: p.lastComplete === true,
        offset: p.nextCursor?.offset ?? null,
        mode: p.nextCursor?.mode ?? null,
      });
    }
  }

  const invById = new Map(
    (inventory.partners || []).map((p) => [String(p.advertiserId || ""), p]),
  );
  const completenessEmpty = completeness
    ? emptyPartnersFromFeedCompleteness(completeness)
    : [];

  const allIds = new Set([
    ...contEmpty.map((p) => p.advertiserId),
    ...completenessEmpty.map((p) => p.advertiserId),
    ...priorSnapshotIds,
  ]);

  const partners = [];
  for (const id of [...allIds].sort()) {
    const cont = contEmpty.find((p) => p.advertiserId === id) || null;
    const comp = completenessEmpty.find((p) => p.advertiserId === id) || null;
    const inv = invById.get(id) || null;
    const inPrior = priorSnapshotIds.includes(id);
    const classification =
      cont || comp
        ? "CJ_FEED_API_EMPTY"
        : inv?.hasFeed === true
          ? "PRIOR_EMPTY_NOW_ABSENT_FROM_CONTINUATION"
          : "PRIOR_ONLY_OR_INACTIVE";
    partners.push({
      advertiserId: id,
      partnerName: cont?.partnerName || comp?.partnerName || inv?.partnerName || null,
      classification,
      inContinuationEmpty: Boolean(cont),
      inCompletenessEmpty: Boolean(comp),
      inPriorSnapshot: inPrior,
      hasFeed: inv?.hasFeed === true,
      declaredProductCount:
        inv?.declaredProductCountSum ??
        inv?.declaredProductCount ??
        comp?.declaredProductCount ??
        null,
      continuation: cont,
      note:
        classification === "CJ_FEED_API_EMPTY"
          ? "CJ product-search empty with declared inventory — external/source limit until NOW_NONEMPTY reprobe"
          : "Present in one snapshot set but not current emptyApi set — explain via inventory/continuation drift",
    });
  }

  const currentEmpty = partners.filter((p) => p.classification === "CJ_FEED_API_EMPTY");
  const onlyContinuation = partners.filter((p) => p.inContinuationEmpty && !p.inCompletenessEmpty);
  const onlyCompleteness = partners.filter((p) => p.inCompletenessEmpty && !p.inContinuationEmpty);
  const priorNotCurrent = partners.filter((p) => p.inPriorSnapshot && !p.inContinuationEmpty);

  return {
    schema: EMPTY_FEED_RECONCILE_SCHEMA,
    at: nowIso,
    counts: {
      continuationEmpty: contEmpty.length,
      completenessEmpty: completenessEmpty.length,
      unifiedCurrentEmpty: currentEmpty.length,
      onlyInContinuation: onlyContinuation.length,
      onlyInCompleteness: onlyCompleteness.length,
      priorNotCurrent: priorNotCurrent.length,
      priorSnapshotCount: priorSnapshotIds.length,
    },
    driftExplanation: [
      onlyContinuation.length
        ? `${onlyContinuation.length} partner(s) emptyApi in continuation but not completeness (often published>0 or durableEligible path)`
        : null,
      onlyCompleteness.length
        ? `${onlyCompleteness.length} partner(s) in completeness empty but not continuation.emptyApi`
        : null,
      priorNotCurrent.length
        ? `${priorNotCurrent.length} prior-snapshot empty id(s) no longer emptyApi — partnership/API recovery or inventory scope change`
        : null,
      contEmpty.length !== completenessEmpty.length
        ? `Count drift continuation=${contEmpty.length} vs completeness=${completenessEmpty.length} is taxonomy filter difference, not silent loss`
        : "Continuation and completeness empty counts match",
    ].filter(Boolean),
    partners,
    currentEmptyIds: currentEmpty.map((p) => p.advertiserId),
  };
}

async function main() {
  const outPath =
    process.env.IU_CJ_EMPTY_FEED_RECONCILE_OUT ||
    path.join(process.env.TEMP || "/tmp", "iu-empty-feed-reconcile-v51-8.json");
  const contPath =
    process.env.IU_CJ_FEED_CONTINUATION_PATH ||
    path.join(process.env.TEMP || "/tmp", "iu-affiliate-cj-feed-continuation-v47.json");
  const invPath =
    process.env.IU_CJ_FEED_INVENTORY_PATH ||
    path.join(process.env.TEMP || "/tmp", "iu-affiliate-cj-feed-inventory-v40.json");
  const completenessPath = process.env.IU_CJ_FEED_COMPLETENESS_PATH || "";
  const priorRaw = String(process.env.IU_CJ_PRIOR_EMPTY_IDS || "").trim();
  const priorEmptyIds = priorRaw
    ? priorRaw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)
    : [];

  const continuation = fs.existsSync(contPath)
    ? JSON.parse(fs.readFileSync(contPath, "utf8"))
    : { partners: [] };
  const inventory = fs.existsSync(invPath)
    ? JSON.parse(fs.readFileSync(invPath, "utf8"))
    : { partners: [] };
  const completeness =
    completenessPath && fs.existsSync(completenessPath)
      ? JSON.parse(fs.readFileSync(completenessPath, "utf8"))
      : null;

  const doc = reconcileEmptyFeedSnapshots({
    continuation,
    inventory,
    completeness,
    priorEmptyIds,
  });
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        outPath,
        counts: doc.counts,
        driftExplanation: doc.driftExplanation,
        currentEmptyIds: doc.currentEmptyIds,
      },
      null,
      2,
    ),
  );
}

const isDirect =
  process.argv[1] &&
  process.argv[1].replace(/\\/g, "/").endsWith("iu-cj-affiliate-phase3z-empty-feed-reconcile-v51-8.mjs");
if (isDirect) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
