#!/usr/bin/env node
/**
 * Phase 3B / Phase 2C — build same-origin offers public JSON (coupons / actions / products).
 *
 * Defaults DISARMED:
 *   - liveEnabled always false unless IU_CJ_OFFERS_LIVE_ENABLED=1 AND IU_CJ_OFFERS_PROMOTE_ARMED=1
 *   - fixture/offline path never claims live CJ account verification
 *   - never invents prices, photos, discount %, or affiliate URLs
 *   - publishable/publicationReady stay false for fixture records
 *
 * Writes only under projects/data (asserted). Atomic tmp→rename + LKG sidecar when armed.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CATALOG_RECORD_KIND,
  normalizeCjLinkSearchXmlToCatalog,
} from "./iu-cj-affiliate-phase2-cj-link-search-catalog-normalize-v1.mjs";
import {
  buildInternalCouponCard,
  buildInternalProductCard,
} from "./iu-cj-affiliate-phase2-catalog-coupon-product-cards-v1.mjs";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OFFERS_SCHEMA = "iu-affiliate-cj-offers-public-v1";
export const OFFERS_PUBLIC_REL = "projects/data/iu-affiliate-cj-offers-public-v1.json";
export const OFFERS_LKG_REL = "projects/data/iu-affiliate-cj-offers-public-lkg-v1.json";

function assertDataWrite(absPath) {
  const norm = path.resolve(absPath).replace(/\\/g, "/").toLowerCase();
  if (!norm.includes("/projects/data/") || !norm.includes("iu-affiliate-cj-offers")) {
    throw new Error("OFFERS_WRITE_PATH_FORBIDDEN:" + absPath);
  }
}

function emptyOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function affiliateUrlReady(url) {
  const u = emptyOrNull(url);
  if (!u || !/^https:\/\//i.test(u)) return false;
  return isCjTrackingUrl(u);
}

/**
 * Public coupon/action card from normalized catalog record (never invents fields).
 */
export function publicCouponOrActionFromRecord(rec) {
  if (!rec) return null;
  const code = emptyOrNull(rec.couponCode);
  const kind =
    rec.recordKind === CATALOG_RECORD_KIND.coupon_with_code
      ? "coupon"
      : rec.recordKind === CATALOG_RECORD_KIND.action_without_code
        ? "action"
        : code
          ? "coupon"
          : "action";
  const affiliateOk = affiliateUrlReady(rec.affiliateUrl);
  const card = buildInternalCouponCard(rec);
  return {
    kind,
    offerId: rec.offerId || null,
    partnerName: card.partner || rec.partnerName || null,
    partnerSlug: card.partnerSlug || null,
    advertiserId: rec.partnerId || null,
    sectionKey: card.sectionKey || null,
    partnerLogoUrl: null,
    title: card.actionTitle || null,
    couponCode: kind === "coupon" ? code : null,
    conditionsSummary: card.conditions || null,
    validFrom: card.validFrom || null,
    validTo: card.validTo || null,
    affiliateUrl: affiliateOk ? rec.affiliateUrl : null,
    publicationReady: false,
    publishable: false,
    blockers: [...new Set([...(card.blockers || []), ...(affiliateOk ? [] : ["affiliate_url_unverified"])])],
    sourceSystem: rec.sourceSystem || "cj_link_search",
    fixtureOnly: true,
  };
}

/**
 * Public product card — photo/price only when evidenced; never invent.
 */
export function publicProductFromEvidence(productEvidence, catalogRecord) {
  const card = buildInternalProductCard(productEvidence, catalogRecord);
  const affiliateOk = affiliateUrlReady(card.affiliateUrl);
  const imageOk =
    typeof card.imageUrl === "string" && /^https:\/\//i.test(card.imageUrl);
  return {
    productId: card.productId,
    productVariant: card.productVariant,
    brand: productEvidence?.brand || productEvidence?.manufacturer || null,
    title: card.product,
    description: productEvidence?.description || null,
    imageUrl: imageOk ? card.imageUrl : null,
    currentPrice: card.currentPrice,
    originalPrice: card.originalPrice,
    currency: productEvidence?.currency || null,
    discountLabel: null,
    savingsLabel: null,
    validTo: catalogRecord?.validTo || null,
    affiliateUrl: affiliateOk ? card.affiliateUrl : null,
    ctaLabel: "Zobrazit nabídku",
    publicationReady: false,
    publishable: false,
    blockers: [
      ...new Set([
        ...(card.blockers || []),
        ...(imageOk ? [] : ["missing_or_invalid_photo"]),
        ...(affiliateOk ? [] : ["affiliate_url_unverified"]),
      ]),
    ],
    sourceSystem: card.sourceSystem || "product_feed",
    fixtureOnly: true,
  };
}

export function emptyOffersDocument(opts = {}) {
  return {
    schema: OFFERS_SCHEMA,
    version: 1,
    updatedAt: opts.updatedAt || new Date().toISOString(),
    liveEnabled: false,
    sourceKind: opts.sourceKind || "empty_disarmed",
    websitePid: String(opts.websitePid || "101883843"),
    sections: [],
    stats: {
      partners: 0,
      coupons: 0,
      actions: 0,
      products: 0,
      publicationReady: 0,
    },
    note:
      "DISARMED: liveEnabled=false. Coupons/products not live-verified. Fixture path ≠ live CJ account proof.",
  };
}

export function validateOffersPublicPayload(doc, opts = {}) {
  const errors = [];
  if (!doc || typeof doc !== "object") {
    return { ok: false, errors: ["missing_doc"] };
  }
  if (doc.schema !== OFFERS_SCHEMA) errors.push("bad_schema");
  if (doc.liveEnabled === true && opts.allowLive !== true) {
    errors.push("live_enabled_forbidden_without_explicit_allow");
  }
  if (!Array.isArray(doc.sections)) errors.push("sections_not_array");
  if (doc.ok === true && (!doc.sections || doc.sections.length === 0) && doc.sourceKind === "error") {
    errors.push("false_ok_on_error");
  }
  for (const sec of doc.sections || []) {
    if (!sec || !sec.sectionKey) errors.push("section_missing_key");
    for (const c of sec.coupons || []) {
      if (c.publicationReady === true && !affiliateUrlReady(c.affiliateUrl)) {
        errors.push("coupon_ready_without_cj_url:" + String(c.offerId || ""));
      }
      if (c.couponCode == null || String(c.couponCode).trim() === "") {
        errors.push("coupon_missing_code:" + String(c.offerId || ""));
      }
    }
    for (const a of sec.actions || []) {
      if (a.couponCode) errors.push("action_must_not_have_code:" + String(a.offerId || ""));
      if (a.publicationReady === true && !affiliateUrlReady(a.affiliateUrl)) {
        errors.push("action_ready_without_cj_url:" + String(a.offerId || ""));
      }
    }
    for (const p of sec.products || []) {
      if (p.publicationReady === true) {
        if (!affiliateUrlReady(p.affiliateUrl)) {
          errors.push("product_ready_without_cj_url:" + String(p.productId || ""));
        }
        if (p.imageUrl && !/^https:\/\//i.test(String(p.imageUrl))) {
          errors.push("product_ready_bad_image:" + String(p.productId || ""));
        }
      }
      if (p.imageUrl && !/^https:\/\//i.test(String(p.imageUrl))) {
        errors.push("product_non_https_image:" + String(p.productId || ""));
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Group normalized catalog records into section bundles (fixture/offline).
 * Product evidence map: offerId → productEvidence[] (optional; never invent).
 */
export function buildOffersDocumentFromCatalogBatch(batch, opts = {}) {
  const updatedAt = opts.updatedAt || new Date().toISOString();
  const sourceKind = opts.sourceKind || "fixture_synthetic_anonymized";
  const productEvidenceByOfferId = opts.productEvidenceByOfferId || {};

  if (!batch || batch.ok === false) {
    const errDoc = emptyOffersDocument({
      updatedAt,
      sourceKind: "error",
      websitePid: opts.websitePid,
    });
    errDoc.ok = false;
    errDoc.reason = batch?.reason || "catalog_batch_failed";
    errDoc.note =
      "NOT OK: upstream catalog batch failed/incomplete. Never treat as successful offers sync.";
    return { ok: false, doc: errDoc, reason: errDoc.reason };
  }

  const bySection = new Map();
  for (const rec of batch.records || []) {
    if (!rec) continue;
    const map = rec.partnerMapping || {};
    const sectionKey = map.sectionKey || null;
    if (!sectionKey) continue;
    if (!bySection.has(sectionKey)) {
      bySection.set(sectionKey, {
        sectionKey,
        partnerSlug: map.partnerSlug || null,
        partnerName: map.partnerName || rec.partnerName || null,
        advertiserId: rec.partnerId || null,
        coupons: [],
        actions: [],
        products: [],
        seenOfferIds: new Set(),
        seenProductKeys: new Set(),
      });
    }
    const sec = bySection.get(sectionKey);
    if (rec.offerId && sec.seenOfferIds.has(rec.offerId)) continue;
    if (rec.offerId) sec.seenOfferIds.add(rec.offerId);

    if (rec.recordKind === CATALOG_RECORD_KIND.coupon_with_code) {
      const c = publicCouponOrActionFromRecord(rec);
      if (c && c.couponCode) sec.coupons.push(c);
    } else if (rec.recordKind === CATALOG_RECORD_KIND.action_without_code) {
      const a = publicCouponOrActionFromRecord(rec);
      if (a) {
        a.kind = "action";
        a.couponCode = null;
        sec.actions.push(a);
      }
    }

    const evidenceList = productEvidenceByOfferId[String(rec.offerId || "")] || [];
    for (const ev of evidenceList) {
      const p = publicProductFromEvidence(ev, rec);
      const key = String(p.productId || "") + "|" + String(p.productVariant || "");
      if (sec.seenProductKeys.has(key)) continue;
      sec.seenProductKeys.add(key);
      sec.products.push(p);
    }
  }

  const sections = [];
  let coupons = 0;
  let actions = 0;
  let products = 0;
  let publicationReady = 0;
  for (const sec of bySection.values()) {
    delete sec.seenOfferIds;
    delete sec.seenProductKeys;
    coupons += sec.coupons.length;
    actions += sec.actions.length;
    products += sec.products.length;
    for (const x of [...sec.coupons, ...sec.actions, ...sec.products]) {
      if (x.publicationReady === true) publicationReady += 1;
    }
    sections.push(sec);
  }

  const doc = {
    schema: OFFERS_SCHEMA,
    version: 1,
    updatedAt,
    liveEnabled: false,
    sourceKind,
    websitePid: String(opts.websitePid || "101883843"),
    sections,
    stats: {
      partners: sections.length,
      coupons,
      actions,
      products,
      publicationReady,
    },
    note:
      "DISARMED fixture/offline offers catalog. liveEnabled=false. Not live CJ account verification.",
    ok: true,
    CJ_LIVE_HTTP_CALLS: batch.CJ_LIVE_HTTP_CALLS ?? 0,
  };

  const forceLive =
    opts.env?.IU_CJ_OFFERS_LIVE_ENABLED === "1" &&
    opts.env?.IU_CJ_OFFERS_PROMOTE_ARMED === "1";
  if (forceLive) {
    doc.liveEnabled = true;
    doc.note = "ARMED liveEnabled — requires separate production GO + verified publicationReady items.";
  }

  return { ok: true, doc, reason: "built" };
}

export function buildOffersFromFixtureXml(opts = {}) {
  const env = opts.env || process.env;
  const fixturePath =
    opts.fixturePath ||
    path.join(ROOT, "scripts", "fixtures", "cj-link-search-coupon-offline-anonymized-v1.xml");
  if (!fs.existsSync(fixturePath)) {
    return {
      ok: false,
      doc: emptyOffersDocument({ sourceKind: "error", websitePid: opts.websitePid }),
      reason: "fixture_missing",
    };
  }
  const xml = fs.readFileSync(fixturePath, "utf8");
  const batch = normalizeCjLinkSearchXmlToCatalog(xml, {
    httpStatus: 200,
    observedAt: opts.observedAt || "2026-10-24T12:00:00.000Z",
    websitePid: opts.websitePid || "101883843",
    refDate: opts.refDate || new Date("2026-10-24T12:00:00.000Z"),
    fixtureKind: "synthetic_anonymized",
  });
  return buildOffersDocumentFromCatalogBatch(batch, {
    ...opts,
    env,
    sourceKind: "fixture_synthetic_anonymized",
    productEvidenceByOfferId: opts.productEvidenceByOfferId || {},
  });
}

/**
 * Atomic promote of offers public JSON. Default DISARMED (validate only).
 */
export function promoteOffersPublicAtomic(opts = {}) {
  const env = opts.env || process.env;
  const armed = env.IU_CJ_OFFERS_PROMOTE_ARMED === "1";
  const dataDir = opts.dataDir || path.join(ROOT, "projects", "data");
  const publicPath = path.join(dataDir, "iu-affiliate-cj-offers-public-v1.json");
  const lkgPath = path.join(dataDir, "iu-affiliate-cj-offers-public-lkg-v1.json");

  let incoming = opts.payload || null;
  if (!incoming && opts.fromFixture) {
    const built = buildOffersFromFixtureXml({ env, websitePid: opts.websitePid });
    if (!built.ok) {
      return { ok: false, wrote: false, reason: built.reason || "BUILD_FAILED", plan: { armed } };
    }
    incoming = built.doc;
  }
  if (!incoming && fs.existsSync(publicPath)) {
    incoming = JSON.parse(fs.readFileSync(publicPath, "utf8"));
  }
  if (!incoming) {
    incoming = emptyOffersDocument({ websitePid: opts.websitePid });
  }

  // Hard safety: never persist liveEnabled unless both flags set
  if (!(env.IU_CJ_OFFERS_LIVE_ENABLED === "1" && armed)) {
    incoming = { ...incoming, liveEnabled: false };
  }

  const validation = validateOffersPublicPayload(incoming, {
    allowLive: env.IU_CJ_OFFERS_LIVE_ENABLED === "1" && armed,
  });
  const plan = {
    armed,
    ok: validation.ok,
    validation,
    publicPath,
    lkgPath,
    sha256: crypto.createHash("sha256").update(JSON.stringify(incoming)).digest("hex"),
    mode: armed ? "WRITE_IF_VALID" : "DRY_VALIDATE_ONLY",
    liveEnabled: incoming.liveEnabled === true,
  };

  if (!validation.ok) {
    return { ok: false, wrote: false, reason: "VALIDATION_FAILED", plan };
  }
  if (!armed) {
    return { ok: true, wrote: false, reason: "PROMOTE_DISARMED", plan, doc: incoming };
  }

  assertDataWrite(publicPath);
  assertDataWrite(lkgPath);
  if (fs.existsSync(publicPath)) {
    fs.writeFileSync(lkgPath, fs.readFileSync(publicPath, "utf8"), "utf8");
  }
  const tmp = publicPath + ".tmp." + process.pid;
  const body = JSON.stringify(incoming, null, 2) + "\n";
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, publicPath);
  return {
    ok: true,
    wrote: true,
    reason: "PROMOTED_ATOMIC",
    plan,
    rollback: fs.existsSync(lkgPath) ? lkgPath : null,
  };
}

export function rollbackOffersPublicFromLkg(dataDir) {
  const dir = dataDir || path.join(ROOT, "projects", "data");
  const publicPath = path.join(dir, "iu-affiliate-cj-offers-public-v1.json");
  const lkgPath = path.join(dir, "iu-affiliate-cj-offers-public-lkg-v1.json");
  if (!fs.existsSync(lkgPath)) return { ok: false, reason: "NO_LKG" };
  assertDataWrite(publicPath);
  const tmp = publicPath + ".tmp.rollback." + process.pid;
  fs.copyFileSync(lkgPath, tmp);
  fs.renameSync(tmp, publicPath);
  return { ok: true, reason: "ROLLED_BACK_TO_LKG" };
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const r = promoteOffersPublicAtomic({ fromFixture: true });
  console.log(
    JSON.stringify({
      IU_CJ_OFFERS_PUBLIC_BUILD: r.ok ? "OK" : "FAIL",
      reason: r.reason,
      wrote: r.wrote,
      liveEnabled: r.plan?.liveEnabled === true,
      stats: r.doc?.stats || null,
      validationErrors: r.plan?.validation?.errors || [],
    })
  );
  process.exit(r.ok ? 0 : 1);
}
