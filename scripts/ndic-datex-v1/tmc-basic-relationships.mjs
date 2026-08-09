/**
 * Basic relationship validation only (no RNLT / PES_LEV advanced resolution).
 */
import { RESOLUTION_STATUS, FEATURE_FLAGS } from "./tmc-basic-model.mjs";
import { TMC_IMPORTER_ERROR } from "./tmc-importer-errors.mjs";

/**
 * @param {{ points: object[], roads: object[], segments: object[], locationCodes: Set<string> }} model
 * @param {{ maxUnresolved?: number, failOnSelfCycle?: boolean }} [opts]
 */
export function validateBasicRelationships(model, opts = {}) {
  const maxUnresolved = opts.maxUnresolved != null ? opts.maxUnresolved : 10_000;
  const lcdSet = model.locationCodes || new Set();
  const pointByLcd = new Map();
  for (const p of model.points || []) {
    if (pointByLcd.has(p.lcd)) {
      return {
        ok: false,
        rejectCode: TMC_IMPORTER_ERROR.TMC_PRIMARY_KEY_DUPLICATE,
        resolutions: [],
        metrics: { missingReferenceCount: 0, duplicateKeyCount: 1, unsupportedAdvancedRelationshipCount: 0 },
      };
    }
    pointByLcd.set(p.lcd, p);
  }

  const resolutions = [];
  let missing = 0;
  let unsupportedAdv = 0;
  let rejected = 0;

  for (const p of model.points || []) {
    let status = RESOLUTION_STATUS.RESOLVED_BASIC;
    const refs = [p.segLcd, p.roaLcd, p.polLcd].filter((x) => x != null && String(x).trim() !== "");
    for (const r of refs) {
      if (String(r) === String(p.lcd)) {
        status = RESOLUTION_STATUS.UNRESOLVED_INVALID_REFERENCE;
        rejected += 1;
      } else if (lcdSet.size > 0 && !lcdSet.has(String(r))) {
        status = RESOLUTION_STATUS.UNRESOLVED_MISSING_REFERENCE;
        missing += 1;
      }
    }
    // Self-cycle on next/prev when same as own LCD (when those fields carry LCD-like values)
    for (const edge of [p.nextPos, p.nextNeg, p.prevPos, p.prevNeg]) {
      if (edge != null && String(edge).trim() !== "" && String(edge) === String(p.lcd)) {
        if (opts.failOnSelfCycle !== false) {
          status = RESOLUTION_STATUS.UNRESOLVED_INVALID_REFERENCE;
          rejected += 1;
        }
      }
    }
    resolutions.push({ lcdOpaque: true, status });
  }

  // Advanced relationships always disabled in basic importer
  if (FEATURE_FLAGS.ADVANCED_RNLT_RELATIONSHIPS_ENABLED !== false) {
    unsupportedAdv += 1;
  }
  unsupportedAdv += model.rnltAdvancedAttempted ? 1 : 0;

  if (rejected > 0 && opts.failOnSelfCycle !== false) {
    return {
      ok: false,
      rejectCode: TMC_IMPORTER_ERROR.TMC_REFERENCE_INVALID,
      resolutions,
      metrics: {
        missingReferenceCount: missing,
        duplicateKeyCount: 0,
        unsupportedAdvancedRelationshipCount: unsupportedAdv,
        rejectedInvalidCount: rejected,
      },
    };
  }

  if (missing + rejected > maxUnresolved) {
    return {
      ok: false,
      rejectCode: TMC_IMPORTER_ERROR.TMC_VALIDATION_FAILED,
      resolutions,
      metrics: {
        missingReferenceCount: missing,
        duplicateKeyCount: 0,
        unsupportedAdvancedRelationshipCount: unsupportedAdv,
        rejectedInvalidCount: rejected,
      },
    };
  }

  return {
    ok: true,
    resolutions,
    metrics: {
      missingReferenceCount: missing,
      duplicateKeyCount: 0,
      unsupportedAdvancedRelationshipCount: unsupportedAdv,
      rejectedInvalidCount: rejected,
    },
  };
}

/**
 * Detect simple directed cycles among point SEG_LCD edges (basic).
 */
export function detectPointNextCycles(points) {
  const next = new Map();
  for (const p of points || []) {
    if (p.segLcd != null && String(p.segLcd).trim() !== "") {
      next.set(String(p.lcd), String(p.segLcd));
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function dfs(n) {
    if (visiting.has(n)) return true;
    if (visited.has(n)) return false;
    visiting.add(n);
    const nx = next.get(n);
    if (nx && dfs(nx)) return true;
    visiting.delete(n);
    visited.add(n);
    return false;
  }
  for (const k of next.keys()) {
    if (dfs(k)) return { hasCycle: true };
  }
  return { hasCycle: false };
}
