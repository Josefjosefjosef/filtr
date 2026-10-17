#!/usr/bin/env node
/** SSRF-safe direct landing fetch (inner product URL / coupon destination only; no affiliate click hops). */
import dns from "node:dns/promises";
import { extractLandingUrl } from "./iu-cj-affiliate-phase2-coupon-eligibility.mjs";

const PRIVATE_V4 = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];
const PRIVATE_V6 = [
  /^::1$/,
  /^::$/,
  /^fe80:/i,
  /^fc/i,
  /^fd/i,
  /^::ffff:127\./i,
  /^::ffff:10\./i,
  /^::ffff:192\.168\./i,
  /^::ffff:169\.254\./i,
  /^::ffff:0:127\./i,
  /^::ffff:0:10\./i,
  /^::ffff:0:192\.168\./i,
];
const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "[::1]", "::1"]);

export function normalizeHost(hostname) {
  return String(hostname || "")
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.$/, "");
}

export function isPrivateOrBlockedHost(hostname) {
  const h = normalizeHost(hostname);
  if (!h || BLOCKED_HOSTS.has(h)) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;
  for (const re of PRIVATE_V4) {
    if (re.test(h)) return true;
  }
  for (const re of PRIVATE_V6) {
    if (re.test(h)) return true;
  }
  const v4Mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4Mapped && isPrivateOrBlockedHost(v4Mapped[1])) return true;
  return false;
}

/**
 * @param {string} url
 * @param {{ allowedHostSuffixes?: string[] }} opts
 */
export async function assertFetchAllowed(url, opts = {}) {
  const u = new URL(String(url));
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "unsupported_protocol", host: u.hostname };
  }
  const host = normalizeHost(u.hostname);
  if (isPrivateOrBlockedHost(host)) {
    return { ok: false, reason: "private_or_blocked_host", host };
  }
  const suffixes = (opts.allowedHostSuffixes || []).map((s) => normalizeHost(s).replace(/^\./, ""));
  if (suffixes.length > 0) {
    const allowed = suffixes.some((s) => host === s || host.endsWith("." + s));
    if (!allowed) return { ok: false, reason: "host_not_in_allowlist", host };
  }
  try {
    const resolved = await dns.lookup(host, { verbatim: true });
    if (isPrivateOrBlockedHost(resolved.address)) {
      return { ok: false, reason: "dns_resolves_private", host, resolved: resolved.address };
    }
  } catch {
    return { ok: false, reason: "dns_lookup_failed", host };
  }
  return { ok: true, reason: "ok", host, finalUrl: u.href };
}

export function classifyLandingTargetType(url, ctx = {}) {
  const u = new URL(String(url));
  const path = u.pathname.toLowerCase();
  const host = normalizeHost(u.hostname);
  if (ctx.offerProductIds?.includes(ctx.productId)) return { type: "product_explicit_in_offer", source: "offer_creative_or_list" };
  if (ctx.offerProductListUrl && url.startsWith(ctx.offerProductListUrl)) {
    return { type: "selected_products_list_for_promotion", source: "offer_destination" };
  }
  if (/\/kategorie\/|category|\/c\//i.test(path)) return { type: "category_page", source: "landing_path_heuristic" };
  if (path === "/" || path === "") return { type: "homepage", source: "landing_path" };
  if (ctx.productId && (path.includes(String(ctx.productId).toLowerCase()) || path.includes("sku"))) {
    return { type: "product_detail_page", source: "landing_path_or_sku_token" };
  }
  return { type: "other_shop_page", source: "landing_path", host, path: path.slice(0, 120) };
}

export async function fetchLandingSafe(url, opts = {}) {
  const gate = await assertFetchAllowed(url, opts);
  if (!gate.ok) {
    return {
      fetchStatus: "blocked",
      gateReason: gate.reason,
      httpStatus: 0,
      snippet: null,
    };
  }
  const maxBytes = opts.maxBytes || 120_000;
  const timeoutMs = opts.timeoutMs || 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(gate.finalUrl, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "infoUzel-cj-audit-landing/1.0" },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (loc) {
        const next = new URL(loc, gate.finalUrl).href;
        const gate2 = await assertFetchAllowed(next, opts);
        if (!gate2.ok) {
          return { fetchStatus: "redirect_blocked", gateReason: gate2.reason, httpStatus: res.status, redirectTo: next };
        }
        return {
          fetchStatus: "redirect_not_followed",
          httpStatus: res.status,
          redirectTo: next,
          note: "manual_redirect_policy_requires_revalidation",
        };
      }
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const snippet = buf.slice(0, maxBytes).toString("utf8", 0, Math.min(buf.length, maxBytes));
    return {
      fetchStatus: res.ok ? "ok" : "http_error",
      httpStatus: res.status,
      snippet: res.ok ? snippet.slice(0, 8000) : null,
      bytesRead: buf.length,
    };
  } catch (err) {
    return {
      fetchStatus: "error",
      httpStatus: 0,
      error: String(err?.message || err).slice(0, 200),
      snippet: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function productIdMatchTokens(productId) {
  const pid = String(productId || "").trim();
  const tokens = new Set();
  if (pid) tokens.add(pid.toLowerCase());
  const idn = pid.match(/^IDN(\d+)$/i);
  if (idn) {
    tokens.add(`idn${idn[1]}`);
    tokens.add(idn[1]);
  }
  return [...tokens];
}

/** @deprecated for identity pass — use primary-product parsers only */
export function snippetContainsProductId(snippet, productId) {
  const lower = String(snippet || "").toLowerCase();
  for (const t of productIdMatchTokens(productId)) {
    if (t && lower.includes(t)) return true;
  }
  const idn = String(productId || "").match(/^IDN(\d+)$/i);
  if (idn) {
    const num = idn[1];
    if (lower.includes(`'idn' + ${num}`) || lower.includes(`"idn" + ${num}`)) return true;
  }
  return false;
}

export function hostSuffixesFromProductAndCouponUrls(productUrl, couponDestUrl) {
  const hosts = new Set();
  for (const raw of [productUrl, couponDestUrl]) {
    if (!raw) continue;
    try {
      const h = normalizeHost(new URL(String(raw)).hostname);
      if (!h) continue;
      hosts.add(h);
      const parts = h.split(".");
      if (parts.length >= 2) hosts.add(parts.slice(-2).join("."));
    } catch {
      /* skip */
    }
  }
  return [...hosts];
}

export function normalizeMerchantProductId(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const idnVar = s.match(/^IDN(\d+)_(\d+)$/i);
  if (idnVar) return "IDN" + idnVar[1] + "_" + idnVar[2];
  const idn = s.match(/^IDN(\d+)$/i);
  if (idn) return "IDN" + idn[1];
  const unders = s.match(/^(\d+)_(\d+)$/);
  if (unders) return "IDN" + unders[1] + "_" + unders[2];
  if (/^\d+$/.test(s)) return "IDN" + s;
  return s.toUpperCase();
}

export function merchantProductIdNumericBase(productId) {
  const s = String(productId || "").trim();
  const m = s.match(/^IDN(\d+)$/i) || s.match(/^(\d+)(?:_\d+)?$/);
  return m ? m[1] : null;
}

/** @returns {{ base: string, variant: string|null }} */
export function parseFeedSkuParts(productId) {
  const s = String(productId || "").trim();
  const unders = s.match(/^IDN(\d+)_(\d+)$/i) || s.match(/^(\d+)_(\d+)$/);
  if (unders) return { base: unders[1], variant: unders[2] };
  const idn = s.match(/^IDN(\d+)$/i);
  if (idn) return { base: idn[1], variant: null };
  if (/^\d+$/.test(s)) return { base: s, variant: null };
  return { base: null, variant: null };
}

/** Variant token from URL path: 309152.1, 309152_1, or trailing -11650 for numeric SKU paths */
export function parseUrlSkuVariantToken(productUrl, base) {
  if (!productUrl || !base) return null;
  const u = String(productUrl);
  let m = u.match(new RegExp("\\b" + base + "\\.(\\d+)(?:[^0-9]|$)", "i"));
  if (m) return m[1];
  m = u.match(new RegExp("\\b" + base + "_(\\d+)(?:[^0-9]|$)", "i"));
  if (m) return m[1];
  return null;
}

export function urlDocumentsBaseSku(productUrl, base) {
  if (!productUrl || !base) return false;
  const u = String(productUrl).toLowerCase();
  return (
    u.includes(base + ".") ||
    u.includes(base + "_") ||
    u.includes("-" + base) ||
    u.includes("/" + base) ||
    u.includes("idn" + base)
  );
}

/**
 * Strict variant-aware equivalence. Same numeric base alone is NOT enough when feed carries _variant.
 */
export function merchantProductIdsEquivalent(expectedId, observedId, productUrl) {
  const normExpected = normalizeMerchantProductId(expectedId);
  const normObserved = normalizeMerchantProductId(observedId);
  const feedEarly = parseFeedSkuParts(expectedId);
  if (normExpected && normObserved && normExpected === normObserved) {
    if (productUrl && feedEarly.base && feedEarly.variant !== null) {
      const urlVariant = parseUrlSkuVariantToken(productUrl, feedEarly.base);
      if (urlVariant !== null && urlVariant !== feedEarly.variant) return false;
    }
    return true;
  }

  const feed = feedEarly;
  const page = parseFeedSkuParts(observedId?.replace(/^IDN/i, "IDN") || observedId);
  const pageBase = page.base || merchantProductIdNumericBase(observedId);
  if (!feed.base || !pageBase || feed.base !== pageBase) return false;

  if (feed.variant !== null && page.variant !== null && feed.variant !== page.variant) {
    return false;
  }

  if (feed.variant === null) {
    return urlDocumentsBaseSku(productUrl, feed.base);
  }

  const urlVariant = parseUrlSkuVariantToken(productUrl, feed.base);
  if (urlVariant === null) return false;
  return urlVariant === feed.variant;
}

export function assessVariantEquivalence(expectedId, observedId, productUrl) {
  const ok = merchantProductIdsEquivalent(expectedId, observedId, productUrl);
  const feed = parseFeedSkuParts(expectedId);
  const urlVariant = parseUrlSkuVariantToken(productUrl, feed.base);
  return {
    equivalent: ok,
    feedSku: feed,
    observedId: observedId ? normalizeMerchantProductId(observedId) : null,
    urlVariantToken: urlVariant,
    evidence: ok
      ? ["base_match", feed.variant !== null ? "url_variant_matches_feed_suffix" : "url_documents_base_sku"]
      : [
          feed.variant !== null && urlVariant !== null && urlVariant !== feed.variant
            ? "variant_mismatch_feed_" + feed.variant + "_url_" + urlVariant
            : feed.variant !== null && urlVariant === null
              ? "feed_has_variant_url_missing_variant_token"
              : "base_or_id_mismatch",
        ],
  };
}

export function urlPathsAlignRelaxed(expectedUrl, canonicalUrl) {
  const strict = urlPathsAlign(expectedUrl, canonicalUrl);
  if (strict === true) return true;
  if (!expectedUrl || !canonicalUrl) return strict;
  try {
    const a = new URL(expectedUrl).pathname.replace(/\/$/, "").toLowerCase();
    const b = new URL(canonicalUrl).pathname.replace(/\/$/, "").toLowerCase();
    if (a === b) return true;
    if (a.startsWith(b + "-") || a.startsWith(b + "/")) return true;
    if (b.startsWith(a)) return true;
  } catch {
    return strict;
  }
  return strict;
}

export function parseProdIdFromDataLayerWindow(windowText) {
  const w = String(windowText || "");
  let m = w.match(/ecomm_prodid\s*['":\s]+['"]IDN['"]\s*\+\s*(\d+)/i);
  if (m) return normalizeMerchantProductId("IDN" + m[1]);
  m = w.match(/ecomm_prodid\s*['":\s]+['"]?(IDN\d+)['"]?/i);
  if (m) return normalizeMerchantProductId(m[1]);
  m = w.match(/ecomm_prodid\s*['":\s]+['"]?(\d+)['"]?/i);
  if (m) return normalizeMerchantProductId(m[1]);
  return null;
}

export function parsePrimaryDataLayerProduct(html) {
  const snip = String(html || "");
  const pagetypeIdx = snip.search(/ecomm_pagetype\s*['":\s]+['"]?product['"]?/i);
  if (pagetypeIdx < 0) return null;
  const window = snip.slice(Math.max(0, pagetypeIdx - 80), pagetypeIdx + 520);
  if (!/ecomm_pagetype\s*['":\s]+['"]?product['"]?/i.test(window)) return null;
  const productId = parseProdIdFromDataLayerWindow(window);
  if (!productId) return null;
  const nameM = window.match(/product_name\s*['":\s]+['"]([^'"]{2,200})/i);
  return {
    zone: "primary_datalayer_first_product_page",
    productId,
    productName: nameM ? nameM[1].trim() : null,
    windowStart: pagetypeIdx,
  };
}

const RECOMMENDATION_ZONE_RE =
  /(?:class|id)=["'][^"']*(?:recommend|related|cross[-_]?sell|similar|alternativ|doporuc|upsell|also[-_]?bought|souvisej|dalsi[-_]?zbozi)[^"']*["']/gi;

export function recommendationZoneStartIndex(html) {
  const snip = String(html || "");
  let earliest = -1;
  let m;
  RECOMMENDATION_ZONE_RE.lastIndex = 0;
  while ((m = RECOMMENDATION_ZONE_RE.exec(snip)) !== null) {
    if (earliest < 0 || m.index < earliest) earliest = m.index;
  }
  return earliest;
}

export function skuMentionedOnlyInRecommendationZone(html, productId) {
  const snip = String(html || "");
  const recStart = recommendationZoneStartIndex(snip);
  const primary = parsePrimaryDataLayerProduct(snip);
  if (primary?.productId === normalizeMerchantProductId(productId)) return false;
  if (recStart < 0) return false;
  const recZone = snip.slice(recStart);
  const headZone = snip.slice(0, recStart);
  const inRec = snippetContainsProductId(recZone, productId);
  const inHead = snippetContainsProductId(headZone, productId);
  const primaryHead = parsePrimaryDataLayerProduct(headZone);
  if (inRec && !inHead) return true;
  if (inRec && primaryHead && primaryHead.productId !== normalizeMerchantProductId(productId)) return true;
  return false;
}

export function parseCanonicalProductUrl(html) {
  const m = String(html || "").match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
  if (!m) return null;
  try {
    return new URL(m[1]).href;
  } catch {
    return null;
  }
}

export function parseDocumentTitle(html) {
  const m = String(html || "").match(/<title[^>]*>([^<]{2,300})<\/title>/i);
  return m ? m[1].trim() : null;
}

export function urlPathsAlign(expectedUrl, canonicalUrl) {
  if (!expectedUrl || !canonicalUrl) return null;
  try {
    const a = new URL(expectedUrl).pathname.replace(/\/$/, "").toLowerCase();
    const b = new URL(canonicalUrl).pathname.replace(/\/$/, "").toLowerCase();
    return a === b;
  } catch {
    return null;
  }
}

export function normalizeProductNameForCompare(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function productNamesAlign(expectedName, observedName) {
  if (!expectedName || !observedName) return null;
  const a = normalizeProductNameForCompare(expectedName);
  const b = normalizeProductNameForCompare(observedName);
  if (!a || !b) return null;
  const mgA = a.match(/\bmg\s*(\d+)/);
  const mgB = b.match(/\bmg\s*(\d+)/);
  if (mgA && mgB && mgA[1] !== mgB[1]) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const tokA = a.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  const tokB = new Set(b.split(/[^a-z0-9]+/).filter((t) => t.length >= 4));
  const overlap = tokA.filter((t) => tokB.has(t)).length;
  const need = Math.min(3, Math.max(2, Math.min(tokA.length, tokB.size)));
  return overlap >= need;
}

export function parseVisiblePrimaryH1(html, recStart = -1) {
  const zone = recStart > 0 ? String(html).slice(0, recStart) : String(html || "");
  const m = zone.match(/<h1[^>]*>([^<]{2,300})<\/h1>/i);
  return m ? m[1].trim() : null;
}

export function parseJsonLdProduct(html) {
  const snip = String(html || "");
  const blocks = snip.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of blocks) {
    const inner = block.replace(/^[\s\S]*?>/, "").replace(/<\/script>$/, "");
    if (!/product/i.test(inner)) continue;
    try {
      const data = JSON.parse(inner.trim());
      const list = Array.isArray(data) ? data : [data];
      for (const node of list) {
        const type = String(node["@type"] || "").toLowerCase();
        if (!type.includes("product")) continue;
        const sku = node.sku || node.productID || node.gtin13 || node.gtin;
        return {
          sku: sku ? normalizeMerchantProductId(String(sku)) : null,
          name: node.name ? String(node.name).trim() : null,
          source: "json_ld_product",
        };
      }
    } catch {
      /* ignore parse errors */
    }
  }
  return null;
}

export function assessMainProductConsensus({ html, productUrl, expectedProduct }) {
  const snip = String(html || "");
  const pid = normalizeMerchantProductId(expectedProduct?.productId);
  const expectedName = expectedProduct?.name || "";
  const recStart = recommendationZoneStartIndex(snip);
  const primary = parsePrimaryDataLayerProduct(snip);
  const canonical = parseCanonicalProductUrl(snip);
  const title = parseDocumentTitle(snip);
  const h1 = parseVisiblePrimaryH1(snip, recStart);
  const jsonLd = parseJsonLdProduct(snip);
  const canonicalAlign = urlPathsAlignRelaxed(productUrl, canonical);
  const slugAlign = slugAlignsWithProductName(productUrl, expectedName || primary?.productName || title);

  const idVotes = [];
  if (merchantProductIdsEquivalent(pid, primary?.productId, productUrl)) idVotes.push("primary_datalayer");
  if (merchantProductIdsEquivalent(pid, jsonLd?.sku, productUrl)) idVotes.push("json_ld");

  const nameVotes = [];
  if (productNamesAlign(expectedName, primary?.productName)) nameVotes.push("datalayer_product_name");
  if (productNamesAlign(expectedName, title)) nameVotes.push("document_title");
  if (productNamesAlign(expectedName, h1)) nameVotes.push("visible_h1");
  if (productNamesAlign(expectedName, jsonLd?.name)) nameVotes.push("json_ld_name");

  const conflicts = [];
  if (primary?.productId && !merchantProductIdsEquivalent(pid, primary.productId, productUrl)) {
    conflicts.push("primary_datalayer_id_mismatch");
  }
  if (jsonLd?.sku && !merchantProductIdsEquivalent(pid, jsonLd.sku, productUrl)) {
    conflicts.push("json_ld_sku_mismatch");
  }
  if (canonicalAlign === false && idVotes.length === 0) conflicts.push("canonical_path_mismatch");
  if (canonicalAlign === false && idVotes.length > 0 && nameVotes.length === 0) {
    conflicts.push("canonical_path_mismatch_without_name_consensus");
  }
  if (primary?.productId === pid && h1 && !productNamesAlign(expectedName, h1) && !productNamesAlign(primary.productName, h1)) {
    conflicts.push("visible_h1_not_main_product_for_expected_sku");
  }
  if (primary?.productId === pid && primary.productName && !productNamesAlign(expectedName, primary.productName)) {
    conflicts.push("variant_or_model_mismatch_feed_vs_page");
  }
  const modelFeed = expectedName.match(/\bmg\s*(\d+)/i);
  const modelPage = (h1 || primary?.productName || title || "").match(/\bmg\s*(\d+)/i);
  if (modelFeed && modelPage && modelFeed[1] !== modelPage[1]) {
    conflicts.push("variant_model_number_mismatch");
  }
  if (title && h1 && !productNamesAlign(title, h1)) {
    conflicts.push("title_vs_h1_mismatch");
  }

  const urlAuthority = canonicalAlign === true || slugAlign === true;
  const idAuthority = idVotes.length >= 1;
  const nameAuthority = nameVotes.length >= 2 || (nameVotes.length === 1 && urlAuthority);

  let status = "unknown";
  let reason = "main_product_consensus_not_reached";
  if (conflicts.length) {
    reason = "authoritative_signals_conflict:" + conflicts[0];
  } else if (urlAuthority && idAuthority && nameAuthority) {
    status = "pass";
    reason = "url_canonical_id_and_visible_name_consensus";
  } else if (urlAuthority && jsonLd?.sku === pid && nameAuthority) {
    status = "pass";
    reason = "url_jsonld_and_name_consensus_without_datalayer";
  } else if (!idAuthority && !jsonLd?.sku) {
    reason = "missing_product_id_in_authoritative_structured_signals";
  } else if (!nameAuthority) {
    reason = "insufficient_visible_name_alignment";
  }

  return {
    status,
    reason,
    conflicts,
    consensus: {
      idVotes,
      nameVotes,
      urlAuthority,
      canonicalAlign,
      slugAlign,
    },
    signals: {
      productUrl,
      canonicalUrl: canonical,
      documentTitle: title,
      visibleH1: h1,
      primaryDataLayer: primary,
      jsonLdProduct: jsonLd,
    },
  };
}

export function slugAlignsWithProductName(productUrl, productName) {
  if (!productUrl || !productName) return null;
  try {
    const slug = new URL(productUrl).pathname.toLowerCase();
    const tokens = String(productName)
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4)
      .slice(0, 4);
    if (!tokens.length) return null;
    const hit = tokens.filter((t) => slug.includes(t)).length;
    return hit >= Math.min(2, tokens.length);
  } catch {
    return null;
  }
}

export function assessLandingIdentity({ product, couponLinkMeta, productLandingUrl, couponDestinationUrl, landingFetch, offerText }) {
  const productUrl = productLandingUrl || extractLandingUrl(product.affiliateClickUrl)?.href;
  const couponDest = couponDestinationUrl || couponLinkMeta?.destination;
  const blockers = [];
  const evidence = [];

  if (couponDest) {
    evidence.push({ kind: "coupon_destination", url: couponDest, role: "offer_store_entry_not_checkout_proof" });
  }
  if (productUrl) {
    evidence.push({ kind: "product_landing_inner_url", url: productUrl, role: "product_identity_target_no_code_proof" });
  }

  let status = "unknown";
  let reason = "landing_not_fetched_or_inconclusive";

  if (!landingFetch || landingFetch.fetchStatus === "blocked" || landingFetch.fetchStatus === "error") {
    reason = "landing_fetch_" + (landingFetch?.fetchStatus || "missing");
    return { status, reason, evidence, blockers, note: "page_error_is_unknown_not_coupon_invalid" };
  }
  if (landingFetch.fetchStatus === "redirect_not_followed" || landingFetch.fetchStatus === "redirect_blocked") {
    reason = landingFetch.fetchStatus;
    blockers.push("redirect_policy");
    return { status, reason, evidence, blockers };
  }
  if (landingFetch.fetchStatus !== "ok") {
    reason = "landing_http_not_ok";
    return { status, reason, evidence, blockers };
  }

  const pid = normalizeMerchantProductId(product.productId);
  const snip = String(landingFetch.snippet || "");
  const targetType = classifyLandingTargetType(productUrl || couponDest || "https://example.invalid/", {
    productId: pid,
  });

  if (targetType.type === "homepage" && productUrl === couponDest) {
    reason = "coupon_destination_homepage_does_not_prove_product_in_promotion";
    return { status, reason, evidence: [...evidence, { targetType }], blockers };
  }

  if (skuMentionedOnlyInRecommendationZone(snip, pid)) {
    reason = "sku_only_in_recommendation_zone_not_primary_product";
    evidence.push({ targetType, primaryProduct: parsePrimaryDataLayerProduct(snip) });
    return { status, reason, evidence, blockers };
  }

  const consensus = assessMainProductConsensus({
    html: snip,
    productUrl,
    expectedProduct: product,
  });
  evidence.push({ mainProductConsensus: consensus, targetType });

  if (consensus.status === "pass") {
    targetType.type = "product_detail_page";
    targetType.source = "main_product_consensus";
    return { status: "pass", reason: consensus.reason, evidence, blockers };
  }

  reason = consensus.reason;
  return { status, reason, evidence, blockers };
}
