/**
 * Stable public event ID — domain-separated hash, no raw NDIC/locationCode leakage.
 */
import crypto from "node:crypto";
import { PUBLIC_EVENT_ID_VERSION } from "./traffic-publication-constants.mjs";

/**
 * @param {string} internalEventIdHash — opaque aggregator hash
 * @param {{ namespace?: string }} [opts]
 */
export function buildPublicEventId(internalEventIdHash, opts = {}) {
  const ns = opts.namespace || "infouzel.traffic.public";
  const raw = String(internalEventIdHash || "");
  if (!raw) return null;
  const h = crypto.createHash("sha256");
  h.update(PUBLIC_EVENT_ID_VERSION);
  h.update("|");
  h.update(ns);
  h.update("|");
  h.update(raw);
  // Truncated hex — not reversible to NDIC id / LCD
  return "iu-te-" + h.digest("hex").slice(0, 32);
}
