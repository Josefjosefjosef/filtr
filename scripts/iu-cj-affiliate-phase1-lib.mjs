#!/usr/bin/env node
/**
 * infoUzel.cz — CJ affiliate phase 1 shared helpers (server-side only).
 * Secrets: IU_CJ_PAT or CJ_PERSONAL_ACCESS_TOKEN, IU_CJ_PUBLISHER_CID, IU_CJ_WEBSITE_PID.
 * Never log token values.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const CJ_ADVERTISER_LOOKUP_BASE = "https://advertiser-lookup.api.cj.com/v2/advertiser-lookup";
export const CJ_LINK_SEARCH_BASE = "https://link-search.api.cj.com/v2/link-search";
export const CJ_CALL_MIN_INTERVAL_MS = 2600;
export const CJ_DEFAULT_RECORDS_PER_PAGE = 100;

let lastCjCallAt = 0;

export function repoRoot() {
  return ROOT;
}

export function defaultStateDir() {
  const fromEnv = process.env.IU_CJ_STATE_DIR;
  if (fromEnv && String(fromEnv).trim()) return path.resolve(String(fromEnv).trim());
  return path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "iu-cj-affiliate");
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/** Trim only leading/trailing whitespace (per project PAT rules). */
export function trimPat(raw) {
  return String(raw ?? "").trim();
}

/** RFC 6750 section 2.1: b64token in Authorization: Bearer &lt;b64token&gt; */
export const RFC6750_B64TOKEN_RE = /^[A-Za-z0-9\-._~+/]+=*$/;

const INVISIBLE_CHAR_RE = /[\u200B-\u200D\uFEFF]/;

function codePointAboveByteString(ch) {
  const cp = ch.codePointAt(0);
  return cp > 0xff;
}

/**
 * Local PAT format check (no network). Does not mutate inner content.
 * CJ uses Authorization: Bearer &lt;token&gt; per OAuth Bearer (RFC 6750).
 */
export function validatePatFormat(patTrimmed) {
  if (!patTrimmed) {
    return {
      ok: false,
      reason: "empty",
      safeMessage: "PAT is empty after trimming edges. Enter again using secure prompt.",
    };
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(patTrimmed)) {
    return {
      ok: false,
      reason: "control_char",
      safeMessage: "PAT contains control characters. Copy again from CJ Developer Portal.",
    };
  }
  if (/\s/.test(patTrimmed)) {
    return {
      ok: false,
      reason: "inner_whitespace",
      safeMessage: "PAT contains whitespace inside the value. Enter again using secure prompt.",
    };
  }
  if (INVISIBLE_CHAR_RE.test(patTrimmed)) {
    return {
      ok: false,
      reason: "invisible_char",
      safeMessage: "PAT contains invisible Unicode (e.g. zero-width space). Copy again from CJ portal.",
    };
  }
  for (const ch of patTrimmed) {
    if (codePointAboveByteString(ch)) {
      return {
        ok: false,
        reason: "non_bytestring_char",
        safeMessage: "PAT contains a character outside HTTP ByteString range. Re-copy from CJ portal.",
      };
    }
  }
  if (!RFC6750_B64TOKEN_RE.test(patTrimmed)) {
    return {
      ok: false,
      reason: "invalid_bearer_char",
      safeMessage:
        "PAT contains a character not allowed in RFC 6750 Bearer b64token (use only A-Z a-z 0-9 - . _ ~ + / and optional =).",
    };
  }
  return { ok: true };
}

/** CJ docs: Authorization: Bearer &lt;personal-access-token&gt; */
export function buildCjAuthorizationHeader(patTrimmed) {
  return "Bearer " + patTrimmed;
}

/**
 * Local header assembly check (same Headers API as fetch). No network I/O.
 */
export function validateAuthorizationHeaderAssembly(patTrimmed) {
  const authorization = buildCjAuthorizationHeader(patTrimmed);
  try {
    const headers = new Headers();
    headers.set("Authorization", authorization);
    headers.set("Accept", "application/xml,text/xml,*/*");
    return { ok: true, stage: "http_client" };
  } catch {
    return {
      ok: false,
      stage: "http_client",
      reason: "http_client_header_reject",
      safeMessage: "HTTP client rejected Authorization header assembly.",
    };
  }
}

/** RFC 6750 format + local Authorization header assembly (no network). */
export function validatePatForCjImport(patTrimmed) {
  const fmt = validatePatFormat(patTrimmed);
  if (!fmt.ok) {
    return { ok: false, stage: "format", reason: fmt.reason, safeMessage: fmt.safeMessage };
  }
  const hdr = validateAuthorizationHeaderAssembly(patTrimmed);
  if (!hdr.ok) {
    return {
      ok: false,
      stage: hdr.stage || "http_client",
      reason: hdr.reason || "http_client_header_reject",
      safeMessage: hdr.safeMessage,
    };
  }
  return { ok: true, stage: "ok" };
}

export function loadCjEnv() {
  const pat = trimPat(
    process.env.IU_CJ_PAT ||
      process.env.CJ_PERSONAL_ACCESS_TOKEN ||
      process.env.CJ_ACCESS_TOKEN ||
      ""
  );
  const publisherCid = String(process.env.IU_CJ_PUBLISHER_CID || process.env.CJ_PUBLISHER_CID || "").trim();
  const websitePid = String(process.env.IU_CJ_WEBSITE_PID || process.env.CJ_WEBSITE_PID || process.env.CJ_PID || "").trim();
  return {
    pat,
    publisherCid,
    websitePid,
  };
}

export function assertCjEnvPartial(env, needs) {
  const missing = [];
  if (needs.pat && !env.pat) missing.push("IU_CJ_PAT (or CJ_PERSONAL_ACCESS_TOKEN)");
  if (needs.publisherCid && !env.publisherCid) missing.push("IU_CJ_PUBLISHER_CID");
  if (needs.websitePid && !env.websitePid) missing.push("IU_CJ_WEBSITE_PID");
  if (missing.length) {
    const err = new Error("MISSING_CJ_ENV:" + missing.join(","));
    err.code = "MISSING_CJ_ENV";
    err.missing = missing;
    throw err;
  }
}

export async function throttleCj() {
  const now = Date.now();
  const wait = lastCjCallAt + CJ_CALL_MIN_INTERVAL_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCjCallAt = Date.now();
}

/** Safe one-line hint from CJ XML/HTTP — never includes tokens or full payloads. */
export function classifyCjResponse(body, httpStatus) {
  const text = String(body || "");
  const lower = text.toLowerCase();
  if (httpStatus === 401 || /not authenticated/i.test(text)) {
    return { authenticated: false, reason: "not_authenticated", httpStatus };
  }
  if (httpStatus === 403 || /not authorized/i.test(text)) {
    return { authenticated: false, reason: "not_authorized", httpStatus };
  }
  if (httpStatus >= 400) {
    const msg =
      parseTag(text, "error-message") ||
      parseTag(text, "message") ||
      parseTag(text, "Message") ||
      "";
    const safeMsg = String(msg).replace(/\s+/g, " ").trim().slice(0, 160);
    return {
      authenticated: false,
      reason: safeMsg ? "api_error" : "http_error",
      httpStatus,
      message: safeMsg || undefined,
    };
  }
  if (/<advertisers[\s>]/i.test(text) || /<links[\s>]/i.test(text) || /<cj-api/i.test(text)) {
    return { authenticated: true, reason: "xml_ok", httpStatus };
  }
  if (lower.includes("incorrect resource url")) {
    return { authenticated: false, reason: "bad_resource_url", httpStatus };
  }
  return { authenticated: httpStatus >= 200 && httpStatus < 300, reason: "unknown_shape", httpStatus };
}

export function hostnameFromCjUrl(url) {
  try {
    return new URL(String(url)).hostname;
  } catch {
    return "unknown";
  }
}

function isAuthorizationHeaderClientReject(err) {
  const c = err?.cause;
  const errText = String(c?.message || err?.message || "");
  return (
    (c?.code === "UND_ERR_INVALID_ARG" && /invalid Authorization header/i.test(errText)) ||
    /invalid header value/i.test(errText)
  );
}

/** Safe fetch failure fields for logs (no token, no raw client messages). */
export function serializeFetchFailure(err, url) {
  const hostname = hostnameFromCjUrl(url);
  const c = err?.cause;
  if (isAuthorizationHeaderClientReject(err)) {
    return {
      kind: "authorization_header_rejected_by_client",
      hostname,
      reason: "http_client_header_reject",
      causeCode: c?.code ? String(c.code) : "HEADER_VALUE_INVALID",
      errorName: String(err?.name || "Error"),
    };
  }
  const out = {
    kind: "network",
    hostname,
    reason: "network_error",
    errorName: String(err?.name || "Error"),
  };
  if (c?.code) out.causeCode = String(c.code);
  if (Array.isArray(c?.errors)) {
    out.aggregateCodes = c.errors.map((e) => e?.code).filter(Boolean);
  }
  if (err?.name === "AbortError") out.causeCode = out.causeCode || "FETCH_TIMEOUT";
  return out;
}

export async function cjGet(url, pat) {
  const patCheck = validatePatForCjImport(pat);
  if (!patCheck.ok) {
    return {
      ok: false,
      status: 0,
      body: "",
      auth: { authenticated: false, reason: "pat_format_rejected", httpStatus: 0 },
      networkError: false,
      patFormatRejected: true,
      patFormatReason: patCheck.reason,
      patFormatMessage: patCheck.safeMessage,
    };
  }
  await throttleCj();
  const timeoutMs = Number(process.env.IU_CJ_FETCH_TIMEOUT_MS || 120000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const authorization = buildCjAuthorizationHeader(pat);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Authorization: authorization,
        Accept: "application/xml,text/xml,*/*",
      },
    });
    const body = await res.text();
    const auth = classifyCjResponse(body, res.status);
    return { ok: res.ok, status: res.status, body, auth, networkError: false };
  } catch (err) {
    const network = serializeFetchFailure(err, url);
    return {
      ok: false,
      status: 0,
      body: "",
      auth: { authenticated: false, reason: "network_error", httpStatus: 0 },
      networkError: true,
      network,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Let libuv close handles (e.g. after fetch) before setting exitCode. Avoid process.exit() after HTTP. */
export async function settleEventLoopBeforeExit() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export function finishNodeProcess(exitCode) {
  process.exitCode = exitCode;
}

export async function finishNodeProcessAfterNetwork(exitCode) {
  await settleEventLoopBeforeExit();
  clearCjEnvFromProcess();
  finishNodeProcess(exitCode);
}

export function parseTag(xml, tag) {
  const re = new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">", "i");
  const m = xml.match(re);
  return m ? m[1].trim() : "";
}

export function parseAllTags(xml, tag) {
  const re = new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">", "gi");
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

export function parseAdvertiserBlocks(xml) {
  const re = /<advertiser>([\s\S]*?)<\/advertiser>/gi;
  const blocks = [];
  let m;
  while ((m = re.exec(xml)) !== null) blocks.push(m[1]);
  return blocks;
}

export function parseAdvertiserRecord(block) {
  return {
    advertiserId: parseTag(block, "advertiser-id"),
    advertiserName: parseTag(block, "advertiser-name"),
    accountStatus: parseTag(block, "account-status"),
    relationshipStatus: parseTag(block, "relationship-status"),
    programUrl: parseTag(block, "program-url"),
    primaryCategory: parseTag(block, "primary-category"),
  };
}

export function parseLinkBlocks(xml) {
  const re = /<link>([\s\S]*?)<\/link>/gi;
  const blocks = [];
  let m;
  while ((m = re.exec(xml)) !== null) blocks.push(m[1]);
  return blocks;
}

export function parseLinkRecord(block) {
  return {
    linkId: parseTag(block, "link-id"),
    advertiserId: parseTag(block, "advertiser-id"),
    advertiserName: parseTag(block, "advertiser-name"),
    linkName: parseTag(block, "link-name"),
    linkType: parseTag(block, "link-type"),
    description: parseTag(block, "description"),
    adContent: parseTag(block, "ad-content"),
    destination: parseTag(block, "destination"),
    clickUrl: parseTag(block, "clickUrl") || parseTag(block, "click-url"),
    couponCode: parseTag(block, "coupon-code"),
    promotionStartDate: parseTag(block, "promotion-start-date"),
    promotionEndDate: parseTag(block, "promotion-end-date"),
    promotionType: parseTag(block, "promotion-type"),
    relationshipStatus: parseTag(block, "relationship-status"),
    targetedCountries: parseTag(block, "targeted-countries"),
    saleCommission: parseTag(block, "sale-commission"),
    allowDeepLinking: parseTag(block, "allow-deep-linking"),
    lastUpdated: parseTag(block, "last-updated"),
  };
}

export const CJ_PROMOTION_TYPES = [
  "coupon",
  "sweepstakes",
  "product",
  "sale/discount",
  "free shipping",
  "seasonal link",
  "site to store",
];

export function clearCjEnvFromProcess() {
  for (const key of [
    "IU_CJ_PAT",
    "CJ_PERSONAL_ACCESS_TOKEN",
    "CJ_ACCESS_TOKEN",
    "IU_CJ_PUBLISHER_CID",
    "CJ_PUBLISHER_CID",
    "IU_CJ_WEBSITE_PID",
    "CJ_WEBSITE_PID",
    "CJ_PID",
  ]) {
    try {
      delete process.env[key];
    } catch (_) {
      /* ignore */
    }
  }
}

export function parseProductBlocks(xml) {
  const re = /<product>([\s\S]*?)<\/product>/gi;
  const blocks = [];
  let m;
  while ((m = re.exec(xml)) !== null) blocks.push(m[1]);
  return blocks;
}

export function parseProductRecord(block) {
  return {
    sku: parseTag(block, "sku") || parseTag(block, "SKU") || parseTag(block, "product-id"),
    name: parseTag(block, "name") || parseTag(block, "product-name") || parseTag(block, "title"),
    price: parseTag(block, "price"),
    salePrice: parseTag(block, "sale-price"),
    currency: parseTag(block, "currency"),
    inStock: parseTag(block, "instock") || parseTag(block, "in-stock") || parseTag(block, "stock"),
    imageUrl: parseTag(block, "image-url") || parseTag(block, "image-link"),
    buyUrl: parseTag(block, "buy-url") || parseTag(block, "link"),
    advertiserId: parseTag(block, "advertiser-id"),
  };
}

export function parseListMeta(xml) {
  const advertisersOpen = xml.match(/<advertisers[^>]*>/i);
  const linksOpen = xml.match(/<links[^>]*>/i);
  const open = advertisersOpen || linksOpen;
  if (!open) return { totalMatched: 0, recordsReturned: 0, pageNumber: 1 };
  const tag = open[0];
  const attr = (name) => {
    const m = tag.match(new RegExp(name + '="([^"]*)"', "i"));
    return m ? m[1] : "";
  };
  return {
    totalMatched: Number(attr("total-matched") || 0),
    recordsReturned: Number(attr("records-returned") || 0),
    pageNumber: Number(attr("page-number") || 1),
  };
}

export function extractCjLinkIdFromClickUrl(url) {
  const m = String(url || "").match(/click-\d+-(\d+)/i);
  return m ? m[1] : "";
}

export function readWebAffiliateCatalogSnapshot() {
  const catalogPath = path.join(ROOT, "assets", "iu-affiliate-catalog.js");
  const src = fs.readFileSync(catalogPath, "utf8");
  const sections = [];
  const sectionRe = /\{\s*id:\s*"(aff-[^"]+)"[\s\S]*?title:\s*"([^"]+)"[\s\S]*?items:\s*\[([\s\S]*?)\]\s*,?\s*\}/g;
  let sm;
  while ((sm = sectionRe.exec(src)) !== null) {
    const sectionId = sm[1];
    const sectionTitle = sm[2];
    const itemsBlock = sm[3];
    const items = [];
    const partnerRe = /affPartner\(\s*"((?:\\.|[^"\\])*)"\s*,\s*"(https:\/\/[^"]+)"/g;
    let pm;
    while ((pm = partnerRe.exec(itemsBlock)) !== null) {
      const title = pm[1].replace(/\\u2019/g, "'").replace(/\\"/g, '"');
      const url = pm[2];
      items.push({
        title,
        url,
        cjLinkId: extractCjLinkIdFromClickUrl(url),
        affiliateUrlReady: true,
      });
    }
    const placeholderRe = /affItem\(\s*"((?:\\.|[^"\\])*)"\s*,\s*"([^"]+)"/g;
    let im;
    while ((im = placeholderRe.exec(itemsBlock)) !== null) {
      items.push({
        title: im[1],
        slug: im[2],
        affiliateUrlReady: false,
      });
    }
    sections.push({ sectionId, sectionTitle, items });
  }
  const pidMatch = src.match(/click-(\d+)-/);
  const publisherPidFromUrls = pidMatch ? pidMatch[1] : "";
  return { generatedAt: new Date().toISOString(), publisherPidFromUrls, sections };
}
