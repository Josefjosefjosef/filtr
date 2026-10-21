/**
 * Offline staging R2 stand-in for CJ banner binaries (no public ACL, no live fetch).
 */
import crypto from "node:crypto";
import {
  validateBannerImageBuffer,
  validateBannerImageSourceUrl,
  rejectActiveScriptOrHtmlCreative,
} from "./iu-cj-affiliate-phase2-banner-asset-security-lib.mjs";
import { assessBannerWithdrawalDecision } from "./iu-cj-affiliate-phase2-banner-lifecycle-lib.mjs";

export function createInMemoryBannerR2Store() {
  const objects = new Map();
  return {
    async put(key, buffer, meta = {}) {
      objects.set(String(key), { buffer, meta, storedAt: new Date().toISOString() });
      return { ok: true, key: String(key) };
    },
    async head(key) {
      const row = objects.get(String(key));
      if (!row) return null;
      return { key: String(key), size: row.buffer.length, meta: row.meta, storedAt: row.storedAt };
    },
    async get(key) {
      const row = objects.get(String(key));
      if (!row) return null;
      return row.buffer;
    },
    keys() {
      return [...objects.keys()];
    },
  };
}

export function buildBannerObjectKey(creativeId, format) {
  const id = String(creativeId || "unknown").replace(/[^\w.-]+/g, "_").slice(0, 80);
  const ext = format === "jpeg" ? "jpg" : String(format || "bin");
  return `staging/banners/${id}.${ext}`;
}

export async function ingestBannerAssetToStagingR2(options = {}) {
  const store = options.store || createInMemoryBannerR2Store();
  const sourceUrl = options.sourceUrl;
  const creative = options.creative || {};
  const scriptGate = rejectActiveScriptOrHtmlCreative(sourceUrl);
  if (!scriptGate.ok) {
    return { ok: false, phase: "source", publishable: false, ...scriptGate };
  }
  let urlGate = { ok: true, reason: "ok" };
  if (options.skipUrlDnsCheck === true) {
    try {
      const u = new URL(String(sourceUrl));
      if (u.protocol !== "https:") urlGate = { ok: false, reason: "https_required" };
    } catch {
      urlGate = { ok: false, reason: "invalid_url" };
    }
  } else {
    urlGate = await validateBannerImageSourceUrl(sourceUrl, {
      allowedHostSuffixes: options.allowedHostSuffixes,
    });
  }
  if (!urlGate.ok) {
    return { ok: false, phase: "url", publishable: false, ...urlGate };
  }

  let buffer = options.buffer;
  if (!buffer && options.mockFetch) {
    const res = await options.mockFetch(sourceUrl);
    if (!res.ok) {
      return { ok: false, phase: "fetch", status: res.status, publishable: false, reason: "mock_fetch_failed" };
    }
    buffer = Buffer.from(await res.arrayBuffer());
  }
  if (!buffer) {
    return { ok: false, phase: "buffer", reason: "missing_buffer_or_mock", publishable: false };
  }

  const imageGate = validateBannerImageBuffer(buffer, options.limits);
  if (!imageGate.ok) {
    return { ok: false, phase: "asset", publishable: false, ...imageGate };
  }

  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const objectKey = buildBannerObjectKey(creative.creativeId || creative.id, imageGate.format);
  const withdrawal = assessBannerWithdrawalDecision(creative, { now: options.now });
  const archiveMeta = {
    creativeId: creative.creativeId || creative.id || null,
    partnerKey: creative.partnerKey || null,
    permissionEvidence: creative.permissionEvidence || null,
    sha256,
    format: imageGate.format,
    bytes: imageGate.bytes,
    sourceUrl,
    expiresAt: creative.expiresAt || null,
    publishable: false,
    withdrawalReasons: withdrawal.reasons || [],
    environment: "staging",
  };

  await store.put(objectKey, buffer, archiveMeta);
  return {
    ok: true,
    phase: "archived",
    publishable: false,
    objectKey,
    sha256,
    archiveMeta,
    withdrawal,
  };
}
