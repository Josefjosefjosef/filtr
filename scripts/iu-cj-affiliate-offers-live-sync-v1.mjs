#!/usr/bin/env node
/**
 * Phase 3V — build + optionally promote CJ offers-public from staging (and optional product sample).
 *
 * Fail-closed:
 *   - liveEnabled only when IU_CJ_OFFERS_LIVE_ENABLED=1 AND IU_CJ_OFFERS_PROMOTE_ARMED=1
 *   - never invent prices / photos / codes
 *   - refuse empty LIVE overwrite of non-empty LKG
 *   - incomplete staging / apiOutage → keep LKG, do not arm
 *
 * Writes only projects/data/iu-affiliate-cj-offers-public(-lkg)-v1.json
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  classifyOfferPublicationState,
  PUB_STATE,
} from "./iu-cj-affiliate-phase3d-complete-validation-v1.mjs";
import {
  OFFERS_SCHEMA,
  OFFERS_PUBLIC_REL,
  OFFERS_LKG_REL,
  validateOffersPublicPayload,
  emptyOffersDocument,
} from "./iu-cj-affiliate-offers-public-build-v1.mjs";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import {
  CJ_PRODUCT_SEARCH_MAX_LIMIT,
  CJ_PRODUCT_SEARCH_OFFSET_FIRST,
  CJ_PRODUCT_SEARCH_PAGE_SIZE_DEFAULT,
  fetchAllShoppingProductsForPartner,
  inventoryShoppingProductFeedsForPartner,
  mapGraphqlProductRow,
} from "./iu-cj-affiliate-phase2-product-api.mjs";
import {
  advancePartnerCheckpoint,
  emptyProductFeedCheckpointState,
  getPartnerCheckpoint,
  loadProductFeedCheckpointState,
  recordCheckpointRun,
  saveProductFeedCheckpointState,
  selectPresentationSlice,
} from "./iu-cj-affiliate-phase3z-product-feed-checkpoint-v31.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEBSITE_PID = "101883843";

function readJson(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  try {
    const raw = fs.readFileSync(p, "utf8");
    if (!String(raw || "").trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeSectionMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!k || k.startsWith("_")) continue;
    if (typeof v === "string" && v.startsWith("aff-")) out[String(k)] = v;
    else if (v && typeof v.sectionId === "string" && v.sectionId.startsWith("aff-")) {
      out[String(k)] = v.sectionId;
    }
  }
  return out;
}

/**
 * Published main-button partners are authoritative for section placement.
 * managed-public can lag behind static main buttons; without this fill,
 * JOINED partners with a live main button lose otherwise-ready coupons/actions
 * via partner_section_unmapped (V28 audit: Skinners Europe, E-armyshop.cz).
 */
export function sectionIdsFromMainButtons(mainButtons) {
  const out = {};
  if (!mainButtons || typeof mainButtons !== "object") return out;
  const ingest = (btn) => {
    const id = String(btn?.advertiserId ?? "").trim();
    const sec = String(btn?.sectionId || btn?.sectionKey || "").trim();
    if (!id || !sec.startsWith("aff-")) return;
    if (!out[id]) out[id] = sec;
  };
  for (const b of mainButtons.buttons || []) ingest(b);
  for (const s of mainButtons.sections || []) {
    for (const b of s.buttons || []) {
      ingest({
        ...b,
        sectionId: b.sectionId || b.sectionKey || s.sectionId || s.sectionKey,
      });
    }
  }
  return out;
}

export function buildSectionByAdvertiser({ managedPublic, policy, sectionMap, mainButtons }) {
  const sectionByAdv = {};
  for (const p of managedPublic?.partners || []) {
    if (p?.advertiserId != null && p.sectionId) {
      sectionByAdv[String(p.advertiserId)] = String(p.sectionId);
    }
  }
  for (const p of policy?.partners || []) {
    const id = String(p?.advertiserId || "");
    if (!id || sectionByAdv[id]) continue;
    if (p.sectionId) sectionByAdv[id] = String(p.sectionId);
  }
  for (const [id, sec] of Object.entries(normalizeSectionMap(sectionMap))) {
    if (!sectionByAdv[id]) sectionByAdv[id] = sec;
  }
  // Fill gaps from published main buttons (never override an existing mapping).
  for (const [id, sec] of Object.entries(sectionIdsFromMainButtons(mainButtons))) {
    if (!sectionByAdv[id]) sectionByAdv[id] = sec;
  }
  return sectionByAdv;
}

function isCouponLink(link) {
  const code = String(link?.couponCode || "").trim();
  if (code) return true;
  const t = String(link?.promotionType || "").toLowerCase();
  return /coupon/.test(t);
}

/**
 * Cross-category offer mapping: partner main button stays in one section,
 * but individual offers/products may map to additional relevant sections
 * when title/description evidence is strong. Never invents categories.
 */
export const OFFER_CROSS_CATEGORY_RULES = [
  { sectionKey: "aff-boty", re: /\b(bot[ay]|tenisk|obuv|shoes?|sneakers?|boots?)\b/i },
  {
    sectionKey: "aff-sportovni-obleceni",
    re: /\b(sportovn[ií]\s+oble[cč]|running\s+jacket|sport\s*(wear|apparel)|leggins|mikina\s+sport)\b/i,
  },
  {
    sectionKey: "aff-sport-outdoor",
    re: /\b(stan|turistik|outdoor|camping|trekking|hiking|batoh\s+turist)\b/i,
  },
  { sectionKey: "aff-moda", re: /\b(m[oó]da|fashion|oble[cč]en[ií]|apparel|dress|sukn[eě])\b/i },
  { sectionKey: "aff-kosmetika", re: /\b(kosmetik|makeup|parf[eé]m|skin\s*care|kr[eé]m)\b/i },
  { sectionKey: "aff-elektro", re: /\b(notebook|laptop|televize|sluch[aá]tk|elektro)\b/i },
  { sectionKey: "aff-mobily", re: /\b(mobil|smartphone|iphone|android\s*phone)\b/i },
  { sectionKey: "aff-sperky-hodinky", re: /\b(hodink|watch(es)?|smartwatch|sperk|jewellery|jewelry)\b/i },
  { sectionKey: "aff-dum-zahrada", re: /\b(zahrad|garden|seka[cč]ka|gril)\b/i },
  { sectionKey: "aff-nabytek", re: /\b(n[aá]bytek|sofa|matrace|sk[rř][ií][nň])\b/i },
  {
    sectionKey: "aff-jidlo",
    re: /\b(potravin|jidlo|gourmet|doplnky?\s+stravy|food\s*(box|delivery|market|shop)|potravinov)\b/i,
  },
  { sectionKey: "aff-deti-hracky", re: /\b(d[eě]tsk|hra[cč]k|toy|kids?\b|baby)\b/i },
  {
    sectionKey: "aff-cestovni-kancelare",
    re: /\b(z[aá]jezd|dovolen[aá]|package\s*tour|cestovn[ií]\s+kancel[aá][rř])\b/i,
  },
  { sectionKey: "aff-letenky", re: /\b(letenk|flight|airline|leteck)\b/i },
  { sectionKey: "aff-ubytovani-hotely", re: /\b(hotel|ubytov[aá]n|accommodation|booking\.com)\b/i },
];

export function resolveOfferSectionKeys({ primarySection, text, allowCrossCategory = true } = {}) {
  const keys = [];
  const add = (k) => {
    if (!k || !String(k).startsWith("aff-")) return;
    if (!keys.includes(k)) keys.push(k);
  };
  add(primarySection || null);
  if (!allowCrossCategory) return keys;
  const blob = String(text || "");
  if (!blob.trim()) return keys;
  for (const rule of OFFER_CROSS_CATEGORY_RULES) {
    if (rule.re.test(blob)) add(rule.sectionKey);
  }
  return keys;
}

export function offerEvidenceText(linkOrProduct = {}) {
  return [
    linkOrProduct.linkName,
    linkOrProduct.title,
    linkOrProduct.description,
    linkOrProduct.conditionsSummary,
    linkOrProduct.category,
    linkOrProduct.advertiserName,
    linkOrProduct.partnerName,
  ]
    .filter(Boolean)
    .join(" | ");
}

function toPublicOfferCard(card) {
  if (!card || card.state !== PUB_STATE.PUBLICATION_READY || card.publicationReady !== true) {
    return null;
  }
  const affiliateOk = isCjTrackingUrl(card.affiliateUrl);
  if (!affiliateOk) return null;
  const kind = card.kind === "coupon" ? "coupon" : "action";
  if (kind === "coupon" && !String(card.couponCode || "").trim()) return null;
  return {
    kind,
    offerId: card.offerId || null,
    partnerName: card.partnerName || null,
    partnerSlug: null,
    advertiserId: card.advertiserId || null,
    sectionKey: card.sectionId || null,
    partnerLogoUrl: null,
    title: card.title || null,
    couponCode: kind === "coupon" ? String(card.couponCode).trim() : null,
    conditionsSummary: card.conditionsSummary || null,
    validFrom: card.validFrom || null,
    validTo: card.validTo || null,
    targetedCountries: card.targetedCountries || null,
    affiliateUrl: card.affiliateUrl,
    publicationReady: true,
    publishable: true,
    blockers: [],
    sourceSystem: "cj_link_search_staging",
    fixtureOnly: false,
  };
}

function isPositiveSalePrice(raw) {
  if (raw == null || raw === "") return false;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0;
}

function toPublicProductCard(p, sectionKey) {
  if (!p || p.publicationReady !== true) return null;
  if (!isCjTrackingUrl(p.affiliateUrl)) return null;
  if (!p.imageUrl || !/^https:\/\//i.test(String(p.imageUrl))) return null;
  if (p.currentPrice == null || !p.currency) return null;
  // Never publish zero/negative as a confirmed sale price (Phase 3Y).
  if (!isPositiveSalePrice(p.currentPrice)) return null;
  return {
    productId: p.productId || null,
    productVariant: p.productVariant || null,
    brand: p.brand || null,
    title: p.title || null,
    description: p.description || null,
    imageUrl: p.imageUrl,
    currentPrice: p.currentPrice,
    originalPrice: p.originalPrice ?? null,
    currency: p.currency,
    discountLabel: null,
    savingsLabel: null,
    validTo: p.validTo || null,
    affiliateUrl: p.affiliateUrl,
    ctaLabel: "Zobrazit výrobek",
    advertiserId: p.advertiserId || null,
    sectionKey: sectionKey || null,
    partnerName: p.partnerName || null,
    publicationReady: true,
    publishable: true,
    blockers: [],
    sourceSystem: "cj_shopping_products_graphql",
    fixtureOnly: false,
  };
}

/**
 * Build offers-public document from staging links (+ optional product cards).
 */
export function buildOffersPublicFromStaging(opts = {}) {
  const staging = opts.staging || { advertisers: [], links: [], apiOutage: true };
  const sectionByAdv = opts.sectionByAdv || {};
  const websitePid = String(opts.websitePid || WEBSITE_PID);
  const refDate = opts.refDate || new Date();
  const productsIn = Array.isArray(opts.products) ? opts.products : [];
  const rejectReasons = {};
  const bump = (r) => {
    rejectReasons[r] = (rejectReasons[r] || 0) + 1;
  };

  if (staging.apiOutage === true) {
    const doc = emptyOffersDocument({
      updatedAt: new Date().toISOString(),
      sourceKind: "staging_api_outage",
      websitePid,
    });
    doc.ok = false;
    doc.reason = "API_OUTAGE_KEEP_LKG";
    doc.note = "Staging marked apiOutage — refuse offers write.";
    return { ok: false, doc, reason: "API_OUTAGE_KEEP_LKG", rejectReasons };
  }

  const links = Array.isArray(staging.links) ? staging.links : [];
  if (links.length === 0) {
    const doc = emptyOffersDocument({
      updatedAt: new Date().toISOString(),
      sourceKind: "staging_empty",
      websitePid,
    });
    doc.ok = false;
    doc.reason = "STAGING_EMPTY";
    return { ok: false, doc, reason: "STAGING_EMPTY", rejectReasons };
  }

  const seen = new Set();
  const bySection = new Map();
  function secBucket(sectionKey, advertiserId, partnerName) {
    if (!bySection.has(sectionKey)) {
      bySection.set(sectionKey, {
        sectionKey,
        partnerSlug: null,
        partnerName: partnerName || null,
        advertiserId: advertiserId || null,
        coupons: [],
        actions: [],
        products: [],
        seenOfferIds: new Set(),
        seenProductKeys: new Set(),
      });
    }
    return bySection.get(sectionKey);
  }

  for (const link of links) {
    const card = classifyOfferPublicationState(link, {
      refDate,
      websitePid,
      sectionByAdv,
      seenOfferIds: seen,
    });
    if (card.state !== PUB_STATE.PUBLICATION_READY) {
      for (const r of card.reasons || [card.state]) bump(r);
      continue;
    }
    // Coupons vs actions: classify kind; skip "other"
    if (card.kind !== "coupon" && card.kind !== "action") {
      bump("unsupported_kind");
      continue;
    }
    // Prefer coupon classification when staging has a code even if promotion-type was sale
    if (isCouponLink(link) && card.kind === "action" && String(link.couponCode || "").trim()) {
      card.kind = "coupon";
      card.couponCode = String(link.couponCode).trim();
    }
    const pubBase = toPublicOfferCard(card);
    if (!pubBase || !pubBase.sectionKey) {
      bump("public_card_rejected");
      continue;
    }
    const sectionKeys = resolveOfferSectionKeys({
      primarySection: pubBase.sectionKey,
      text: offerEvidenceText(link) + " " + offerEvidenceText(card),
      allowCrossCategory: opts.allowCrossCategory !== false,
    });
    let placed = 0;
    for (const sectionKey of sectionKeys) {
      const pub = { ...pubBase, sectionKey, sectionKeys };
      const sec = secBucket(sectionKey, pub.advertiserId, pub.partnerName);
      if (pub.offerId && sec.seenOfferIds.has(pub.offerId)) {
        bump("duplicate_offer_id");
        continue;
      }
      if (pub.offerId) sec.seenOfferIds.add(pub.offerId);
      if (pub.kind === "coupon") sec.coupons.push(pub);
      else sec.actions.push(pub);
      placed += 1;
    }
    if (!placed) bump("cross_category_unplaced");
  }

  for (const p of productsIn) {
    const primary =
      sectionByAdv[String(p.advertiserId || "")] || p.sectionKey || null;
    const sectionKeys = resolveOfferSectionKeys({
      primarySection: primary,
      text: offerEvidenceText(p),
      allowCrossCategory: opts.allowCrossCategory !== false,
    });
    let placed = 0;
    for (const sectionKey of sectionKeys) {
      const pub = toPublicProductCard(p, sectionKey);
      if (!pub || !pub.sectionKey) {
        bump("product_rejected");
        continue;
      }
      pub.sectionKeys = sectionKeys;
      const sec = secBucket(pub.sectionKey, pub.advertiserId, pub.partnerName);
      const key = String(pub.productId || "") + "|" + String(pub.productVariant || "");
      if (sec.seenProductKeys.has(key)) {
        bump("duplicate_product");
        continue;
      }
      sec.seenProductKeys.add(key);
      sec.products.push(pub);
      placed += 1;
    }
    if (!placed) bump("product_unplaced");
  }

  const sections = [];
  let coupons = 0;
  let actions = 0;
  let products = 0;
  let publicationReady = 0;
  let crossCategoryOfferPlacements = 0;
  const offerIdSections = new Map();
  for (const sec of bySection.values()) {
    delete sec.seenOfferIds;
    delete sec.seenProductKeys;
    coupons += sec.coupons.length;
    actions += sec.actions.length;
    products += sec.products.length;
    publicationReady += sec.coupons.length + sec.actions.length + sec.products.length;
    for (const item of [...sec.coupons, ...sec.actions, ...sec.products]) {
      const oid = item.offerId || item.productId;
      if (!oid) continue;
      if (!offerIdSections.has(oid)) offerIdSections.set(oid, new Set());
      offerIdSections.get(oid).add(sec.sectionKey);
    }
    sections.push(sec);
  }
  for (const set of offerIdSections.values()) {
    if (set.size > 1) crossCategoryOfferPlacements += 1;
  }

  const doc = {
    schema: OFFERS_SCHEMA,
    version: 1,
    updatedAt: new Date().toISOString(),
    liveEnabled: false,
    sourceKind: "cj_staging_live_sync_v1",
    websitePid,
    sections,
    stats: {
      partners: sections.length,
      coupons,
      actions,
      products,
      publicationReady,
      crossCategoryOfferPlacements,
      sectionsWithOffers: sections.filter(
        (s) => (s.coupons?.length || 0) + (s.actions?.length || 0) + (s.products?.length || 0) > 0
      ).length,
    },
    rejectReasons,
    note: "Built from CJ staging; liveEnabled disarmed until both arm flags set.",
    ok: true,
  };

  return {
    ok: true,
    doc,
    reason: "built",
    rejectReasons,
    counts: doc.stats,
  };
}

/**
 * Fetch shoppingProducts for managed partners with documented CJ pagination.
 * V30: removes artificial Math.min(10) source cap. Uses offset/limit (≤10k) + page token.
 * partnerLimit 0 = all active partners.
 * Optional publishPerPartner is a presentation budget only (VALID_NOT_PUBLISHED), never a source cap.
 * Presentation “Zobrazit více” must not be confused with source fetch completeness.
 */
export async function sampleProductsForManagedPartners(opts = {}) {
  const env = opts.env || process.env;
  const pat =
    env.IU_CJ_PAT || env.CJ_API_PAT || env.CJ_PERSONAL_ACCESS_TOKEN || "";
  const publisherCid = String(env.IU_CJ_PUBLISHER_CID || "").trim();
  const websitePid = String(opts.websitePid || env.IU_CJ_WEBSITE_PID || WEBSITE_PID).trim();
  const partners = Array.isArray(opts.partners) ? opts.partners : [];
  const rawPartnerLimit = opts.partnerLimit != null
    ? Number(opts.partnerLimit)
    : env.IU_CJ_OFFERS_PRODUCT_PARTNER_LIMIT != null && String(env.IU_CJ_OFFERS_PRODUCT_PARTNER_LIMIT).trim() !== ""
      ? Number(env.IU_CJ_OFFERS_PRODUCT_PARTNER_LIMIT)
      : 0;
  // 0 = no partner cap (fetch all active managed partners).
  const partnerLimit = Number.isFinite(rawPartnerLimit) ? rawPartnerLimit : 0;
  const rawPageSize = opts.pageSize != null
    ? Number(opts.pageSize)
    : env.IU_CJ_OFFERS_PRODUCT_PAGE_SIZE != null && String(env.IU_CJ_OFFERS_PRODUCT_PAGE_SIZE).trim() !== ""
      ? Number(env.IU_CJ_OFFERS_PRODUCT_PAGE_SIZE)
      : opts.perPartner != null
        ? Number(opts.perPartner)
        : env.IU_CJ_OFFERS_PRODUCT_LIMIT != null && String(env.IU_CJ_OFFERS_PRODUCT_LIMIT).trim() !== ""
          ? Number(env.IU_CJ_OFFERS_PRODUCT_LIMIT)
          : CJ_PRODUCT_SEARCH_PAGE_SIZE_DEFAULT;
  const pageSize = Math.max(
    1,
    Math.min(
      CJ_PRODUCT_SEARCH_MAX_LIMIT,
      Number.isFinite(rawPageSize) && rawPageSize > 0 ? Math.floor(rawPageSize) : CJ_PRODUCT_SEARCH_PAGE_SIZE_DEFAULT
    )
  );
  const rawMaxPages = opts.maxPagesPerPartner != null
    ? Number(opts.maxPagesPerPartner)
    : env.IU_CJ_OFFERS_PRODUCT_MAX_PAGES != null && String(env.IU_CJ_OFFERS_PRODUCT_MAX_PAGES).trim() !== ""
      ? Number(env.IU_CJ_OFFERS_PRODUCT_MAX_PAGES)
      : 100;
  const maxPagesPerPartner = Math.max(1, Math.min(500, Number.isFinite(rawMaxPages) ? rawMaxPages : 100));
  const rawPublish = opts.publishPerPartner != null
    ? Number(opts.publishPerPartner)
    : env.IU_CJ_OFFERS_PRODUCT_PUBLISH_PER_PARTNER != null &&
        String(env.IU_CJ_OFFERS_PRODUCT_PUBLISH_PER_PARTNER).trim() !== ""
      ? Number(env.IU_CJ_OFFERS_PRODUCT_PUBLISH_PER_PARTNER)
      : 25;
  // Presentation/runtime budget (not API source cap). 0 = unlimited (unsafe for huge feeds in one JSON).
  const publishPerPartner = Number.isFinite(rawPublish) && rawPublish > 0 ? Math.floor(rawPublish) : 0;
  const keepFullSourceRows = opts.keepFullSourceRows === true || env.IU_CJ_OFFERS_KEEP_SOURCE_ROWS === "1";
  const inventoryFeeds = opts.inventoryFeeds === true || env.IU_CJ_OFFERS_INVENTORY_FEEDS === "1";
  const checkpointPath =
    opts.checkpointPath ||
    (env.IU_CJ_PRODUCT_FEED_CHECKPOINT_PATH
      ? String(env.IU_CJ_PRODUCT_FEED_CHECKPOINT_PATH)
      : path.join(ROOT, "projects", "data", "iu-affiliate-cj-product-feed-checkpoints-v31.json"));
  const persistCheckpoints =
    opts.skipCheckpointPersist === true
      ? false
      : opts.checkpointPath != null ||
        Boolean(env.IU_CJ_PRODUCT_FEED_CHECKPOINT_PATH) ||
        env.IU_CJ_OFFERS_PROMOTE_ARMED === "1" ||
        env.IU_CJ_PRODUCT_FEED_CHECKPOINT_PERSIST === "1";
  let checkpointState =
    opts.checkpointState ||
    (persistCheckpoints
      ? loadProductFeedCheckpointState(checkpointPath)
      : emptyProductFeedCheckpointState({ websitePid }));
  if (!checkpointState.partners) checkpointState.partners = {};
  const meta = {
    sampledPartners: 0,
    activePartners: 0,
    partnerCapApplied: partnerLimit > 0,
    partnerLimit: partnerLimit > 0 ? partnerLimit : null,
    pageSize,
    maxPagesPerPartner,
    publishPerPartner: publishPerPartner || null,
    keepFullSourceRows,
    perPartner: pageSize,
    apiMaxPerQuery: CJ_PRODUCT_SEARCH_MAX_LIMIT,
    apiDefaultLimit: 1000,
    artificialTenCapRemoved: true,
    presentationBudgetNotApiCap: true,
    durableCheckpoints: true,
    checkpointPath,
    partnersWithFeed: 0,
    partnersEmptyFeed: 0,
    partnersError: 0,
    partnersIncompletePagination: 0,
    partnersTruncatedByApiLimit: 0,
    partnersResumedFromCheckpoint: 0,
    sourceProductsFetched: 0,
    sourceProductsPublishReady: 0,
    sourceProductsDeferredPresentationBudget: 0,
    feedsInventoried: 0,
    feedDeclaredProductCount: 0,
    continuationSamples: [],
    partnerFetch: [],
    skippedNoCredentials: false,
    note:
      "V31: durable per-partner checkpoints resume offset/page across sync runs; presentation budget rotates and is not an API source cap.",
  };
  const active = partners.filter((p) => p && p.active !== false && p.advertiserId != null);
  meta.activePartners = active.length;
  const sample =
    partnerLimit > 0 ? active.slice(0, Math.max(0, partnerLimit)) : active.slice();
  meta.sampledPartners = sample.length;
  if (!pat || !publisherCid) {
    meta.skippedNoCredentials = true;
    return { products: [], sourceProducts: [], feedInventory: [], meta };
  }
  const gqlEnv = { pat, publisherCid, websitePid };
  const products = [];
  const sourceProducts = [];
  const feedInventory = [];
  for (const p of sample) {
    const partnerId = String(p.advertiserId);
    const partnerMeta = {
      advertiserId: partnerId,
      partnerName: p.title || null,
      fetched: 0,
      totalCount: null,
      complete: false,
      error: null,
      feeds: 0,
      declaredProductCount: null,
    };
    try {
      if (inventoryFeeds) {
        const inv = await inventoryShoppingProductFeedsForPartner(gqlEnv, partnerId, {
          pageSize: 50,
          maxPages: 20,
        });
        partnerMeta.feeds = inv.feedCount;
        partnerMeta.declaredProductCount = inv.declaredProductCount;
        meta.feedsInventoried += inv.feedCount;
        meta.feedDeclaredProductCount += inv.declaredProductCount || 0;
        for (const f of inv.feeds || []) {
          feedInventory.push({
            advertiserId: partnerId,
            partnerName: p.title || null,
            adId: f.adId != null ? String(f.adId) : null,
            feedName: f.feedName || null,
            productCount: f.productCount != null ? Number(f.productCount) : null,
            lastUpdated: f.lastUpdated || null,
            sourceFeedType: f.sourceFeedType || null,
            currency: f.currency || null,
            language: f.language || null,
            advertiserCountry: f.advertiserCountry || null,
            inventoryComplete: inv.complete === true,
          });
        }
      }
      // V31: resume from durable checkpoint so successive syncs continue past prior window.
      const prevCp = getPartnerCheckpoint(checkpointState, partnerId);
      const resumeOffset =
        prevCp.resumeOffset != null && Number.isFinite(Number(prevCp.resumeOffset))
          ? Number(prevCp.resumeOffset)
          : CJ_PRODUCT_SEARCH_OFFSET_FIRST;
      const resumePage = prevCp.resumePage || null;
      if (resumeOffset > CJ_PRODUCT_SEARCH_OFFSET_FIRST || resumePage) {
        meta.partnersResumedFromCheckpoint += 1;
      }
      partnerMeta.resumeOffset = resumeOffset;
      partnerMeta.resumePagePresent = Boolean(resumePage);
      // Fetch a continueable window (not entire mega-catalogs into RAM).
      const stopAfter =
        publishPerPartner > 0 ? Math.min(pageSize * maxPagesPerPartner, Math.max(publishPerPartner * 4, pageSize)) : null;
      const fetched = await fetchAllShoppingProductsForPartner(gqlEnv, partnerId, {
        pageSize,
        maxPages: maxPagesPerPartner,
        stopAfterCount: stopAfter,
        resumeOffset: resumePage ? undefined : resumeOffset,
        resumePage: resumePage || undefined,
      });
      partnerMeta.fetched = fetched.fetchedCount;
      partnerMeta.totalCount = fetched.totalCount;
      partnerMeta.complete = fetched.complete === true;
      partnerMeta.stoppedEarlyForBudget = fetched.stoppedEarlyForBudget === true;
      partnerMeta.error = fetched.error || null;
      partnerMeta.nextOffset = fetched.checkpoint?.nextOffset ?? null;
      partnerMeta.nextPagePresent = Boolean(fetched.checkpoint?.nextPage);
      const advanced = advancePartnerCheckpoint(
        prevCp,
        {
          ...fetched,
          startedOffset: resumeOffset,
        },
        { pageSize, publishPerPartner }
      );
      checkpointState.partners[partnerId] = advanced;
      if (meta.continuationSamples.length < 12) {
        meta.continuationSamples.push({
          advertiserId: partnerId,
          startedOffset: resumeOffset,
          nextOffset: advanced.resumeOffset,
          fetched: fetched.fetchedCount,
          totalCount: fetched.totalCount,
          resumed: resumeOffset > CJ_PRODUCT_SEARCH_OFFSET_FIRST || Boolean(resumePage),
        });
      }
      if (fetched.error && fetched.fetchedCount === 0) {
        meta.partnersError += 1;
        meta.partnerFetch.push(partnerMeta);
        continue;
      }
      if (!fetched.resultList?.length) {
        meta.partnersEmptyFeed += 1;
        meta.partnerFetch.push(partnerMeta);
        continue;
      }
      meta.partnersWithFeed += 1;
      if ((!fetched.complete && !fetched.stoppedEarlyForBudget) || fetched.incompleteResponse) {
        meta.partnersIncompletePagination += 1;
        meta.partnersTruncatedByApiLimit += 1;
      }
      const readyRows = [];
      for (const item of fetched.resultList || []) {
        const mapped = mapGraphqlProductRow(item, websitePid);
        const img = mapped.imageUrl;
        const amount = mapped.price;
        const currency = mapped.currency;
        const click = mapped.affiliateClickUrl;
        const trusted = isCjTrackingUrl(click);
        const publicationReady = Boolean(
          trusted && amount != null && currency && typeof img === "string" && /^https:\/\//i.test(img)
        );
        const row = {
          advertiserId: partnerId,
          partnerName: p.title || null,
          sectionKey: p.sectionId || null,
          productId: mapped.productId,
          title: mapped.name,
          description: mapped.description,
          imageUrl: typeof img === "string" && /^https:\/\//i.test(img) ? img : null,
          currentPrice: amount,
          originalPrice: null,
          currency,
          affiliateUrl: trusted ? click : null,
          availability: mapped.availability,
          sourceTotalCount: fetched.totalCount,
          sourceFetchComplete: fetched.complete === true,
          sourceResumeOffset: resumeOffset,
          publicationReady,
          rejectReason: null,
        };
        meta.sourceProductsFetched += 1;
        if (keepFullSourceRows) sourceProducts.push(row);
        if (!publicationReady) {
          if (keepFullSourceRows) sourceProducts[sourceProducts.length - 1].rejectReason = "not_publication_ready";
          continue;
        }
        meta.sourceProductsPublishReady += 1;
        readyRows.push(row);
      }
      const slice = selectPresentationSlice(readyRows, publishPerPartner, prevCp.presentationCursor || 0);
      for (const row of slice.selected) products.push(row);
      meta.sourceProductsDeferredPresentationBudget += slice.deferred;
      if (keepFullSourceRows) {
        const selectedIds = new Set(slice.selected.map((r) => String(r.productId || "")));
        for (const sp of sourceProducts) {
          if (String(sp.advertiserId) !== partnerId) continue;
          if (sp.publicationReady && !selectedIds.has(String(sp.productId || ""))) {
            sp.rejectReason = "valid_not_published_presentation_budget";
            sp.publicationReady = false;
          }
        }
      }
      if (Number.isFinite(fetched.totalCount) && fetched.totalCount > (fetched.fetchedCount || 0)) {
        meta.sourceProductsDeferredPresentationBudget += Math.max(
          0,
          fetched.totalCount - (fetched.fetchedCount || 0)
        );
      }
    } catch (e) {
      meta.partnersError += 1;
      partnerMeta.error = String(e?.message || e).slice(0, 120);
    }
    meta.partnerFetch.push(partnerMeta);
  }
  // Cap partnerFetch audit size in meta for huge partner sets
  if (meta.partnerFetch.length > 40) {
    meta.partnerFetchSample = meta.partnerFetch.slice(0, 40);
    meta.partnerFetchCount = meta.partnerFetch.length;
    delete meta.partnerFetch;
  }
  checkpointState = recordCheckpointRun(checkpointState, {
    sampledPartners: meta.sampledPartners,
    partnersResumedFromCheckpoint: meta.partnersResumedFromCheckpoint,
    sourceProductsFetched: meta.sourceProductsFetched,
    productsPublished: products.length,
    continuationSamples: meta.continuationSamples,
  });
  meta.checkpointPersistArmed = persistCheckpoints;
  if (persistCheckpoints) {
    try {
      saveProductFeedCheckpointState(checkpointPath, checkpointState);
      meta.checkpointSaved = true;
    } catch (e) {
      meta.checkpointSaved = false;
      meta.checkpointSaveError = String(e?.message || e).slice(0, 120);
    }
  } else {
    meta.checkpointSaved = false;
  }
  return { products, sourceProducts, feedInventory, meta, checkpointState };
}

function readyCounts(doc) {
  let coupons = 0;
  let actions = 0;
  let products = 0;
  for (const sec of doc?.sections || []) {
    coupons += (sec.coupons || []).filter((c) => c.publicationReady === true).length;
    actions += (sec.actions || []).filter((a) => a.publicationReady === true).length;
    products += (sec.products || []).filter((p) => p.publicationReady === true).length;
  }
  return { coupons, actions, products, total: coupons + actions + products };
}

/**
 * Atomic write of offers-public when armed. Default dry-run.
 */
export async function runOffersLiveSync(opts = {}) {
  const env = opts.env || process.env;
  const dataDir = opts.dataDir || path.join(ROOT, "projects", "data");
  const armed = env.IU_CJ_OFFERS_PROMOTE_ARMED === "1";
  const liveWanted = env.IU_CJ_OFFERS_LIVE_ENABLED === "1";
  const sampleProducts = opts.sampleProducts !== false && env.IU_CJ_OFFERS_SAMPLE_PRODUCTS !== "0";

  const staging = readJson(path.join(dataDir, "iu-affiliate-cj-staging-v1.json"), {
    apiOutage: true,
    advertisers: [],
    links: [],
  });
  const managedPublic = readJson(path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json"), {
    partners: [],
  });
  const policy = readJson(path.join(dataDir, "iu-affiliate-slot-policy-v1.json"), { partners: [] });
  const sectionMap = readJson(path.join(dataDir, "iu-affiliate-cj-section-map-v1.json"), {});
  const mainButtons = readJson(path.join(dataDir, "iu-affiliate-cj-main-buttons-static-v13.json"), null);
  const prevPublic = readJson(path.join(dataDir, "iu-affiliate-cj-offers-public-v1.json"), null);
  // V31: merge email-only offers that already passed partner-authorized-URL gates (never fixtureOnly).
  const emailOnlyBridge = readJson(
    path.join(dataDir, "iu-affiliate-cj-email-only-offers-bridge-v31.json"),
    null
  );
  const emailOnlyLinks = Array.isArray(emailOnlyBridge?.links)
    ? emailOnlyBridge.links.filter((l) => l && l.fixtureOnly !== true && isCjTrackingUrl(l.clickUrl || l.affiliateUrl))
    : [];
  if (emailOnlyLinks.length > 0 && Array.isArray(staging.links)) {
    const seenIds = new Set(staging.links.map((l) => String(l.linkId || "")));
    for (const link of emailOnlyLinks) {
      const id = String(link.linkId || "");
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      staging.links.push({
        ...link,
        clickUrl: link.clickUrl || link.affiliateUrl,
        sourceSystem: link.sourceSystem || "email_plus_partner_authorized_cj_url",
      });
    }
  }

  const sectionByAdvWithoutMain = buildSectionByAdvertiser({ managedPublic, policy, sectionMap });
  const sectionByAdv = buildSectionByAdvertiser({ managedPublic, policy, sectionMap, mainButtons });
  const mainButtonSectionFillIds = Object.keys(sectionByAdv).filter((id) => !sectionByAdvWithoutMain[id]);

  let products = opts.products || [];
  let productMeta = opts.productMeta || null;
  let sourceProducts = opts.sourceProducts || null;
  let feedInventory = opts.feedInventory || null;
  if (sampleProducts && products.length === 0) {
    const sampled = await sampleProductsForManagedPartners({
      env,
      partners: managedPublic.partners || [],
      websitePid: WEBSITE_PID,
      partnerLimit: opts.productPartnerLimit,
      perPartner: opts.productLimitPerPartner,
      pageSize: opts.productPageSize,
      maxPagesPerPartner: opts.productMaxPages,
      publishPerPartner: opts.productPublishPerPartner,
      inventoryFeeds: opts.inventoryFeeds,
    });
    products = sampled.products;
    productMeta = sampled.meta;
    sourceProducts = sampled.sourceProducts || null;
    feedInventory = sampled.feedInventory || null;
  }

  const built = buildOffersPublicFromStaging({
    staging,
    sectionByAdv,
    websitePid: WEBSITE_PID,
    products,
    refDate: opts.refDate || new Date(),
  });

  if (!built.ok) {
    return {
      ok: false,
      armed,
      wrote: false,
      reason: built.reason,
      liveEnabled: false,
      counts: readyCounts(built.doc),
      productMeta,
      doc: built.doc,
    };
  }

  const prevReady = readyCounts(prevPublic);
  const nextReady = readyCounts(built.doc);

  let doc = built.doc;
  const keepLive =
    armed &&
    prevPublic?.liveEnabled === true &&
    nextReady.total > 0 &&
    !liveWanted;
  if ((liveWanted && armed) || keepLive) {
    doc = {
      ...doc,
      liveEnabled: true,
      note: keepLive
        ? "KEEP_LIVE: rebuilt from CJ staging; previous public was liveEnabled=true."
        : "LIVE offers/coupons/products from CJ staging (+ optional shoppingProducts sample). publicationReady items only.",
    };
  }

  // Refuse empty LIVE wipe of prior non-empty public catalog.
  if (armed && liveWanted && prevReady.total > 0 && nextReady.total === 0) {
    return {
      ok: false,
      armed,
      wrote: false,
      reason: "EMPTY_OFFERS_REGRESSION_KEEP_LKG",
      liveEnabled: false,
      counts: nextReady,
      prevReady,
      productMeta,
    };
  }

  // V30.1: refuse product-catalog wipe when prior LIVE had products but rebuild fetched none
  // (e.g. GraphQL http_400 on all partners). Coupons/actions alone must not overwrite product LKG.
  if (
    armed &&
    prevPublic?.liveEnabled === true &&
    prevReady.products > 0 &&
    nextReady.products === 0 &&
    (productMeta?.partnersError > 0 || productMeta?.sourceProductsFetched === 0)
  ) {
    return {
      ok: false,
      armed,
      wrote: false,
      reason: "PRODUCT_FETCH_REGRESSION_KEEP_LKG",
      liveEnabled: false,
      counts: nextReady,
      prevReady,
      productMeta,
      note: "Product source fetch failed or empty while prior LIVE had products — keep LKG, do not promote.",
    };
  }

  // Refuse arming LIVE with zero ready items (transparent zero, not false success).
  if (armed && liveWanted && nextReady.total === 0) {
    return {
      ok: false,
      armed,
      wrote: false,
      reason: "ZERO_PUBLICATION_READY_REFUSED",
      liveEnabled: false,
      counts: nextReady,
      productMeta,
      rejectReasons: built.rejectReasons,
    };
  }

  const validation = validateOffersPublicPayload(doc, {
    allowLive: doc.liveEnabled === true && armed,
  });
  if (!validation.ok) {
    return {
      ok: false,
      armed,
      wrote: false,
      reason: "VALIDATION_FAILED",
      errors: validation.errors,
      counts: nextReady,
      productMeta,
    };
  }

  const publicPath = path.join(dataDir, path.basename(OFFERS_PUBLIC_REL));
  const lkgPath = path.join(dataDir, path.basename(OFFERS_LKG_REL));
  const auditPath = path.join(dataDir, "iu-affiliate-cj-offers-sync-audit-v1.json");

  // Layer loss audit: unexplained ready drop vs prior LIVE catalog (expiration is OK;
  // zero unauthorized pipeline loss is required). Does not invent offers.
  const layerLossAudit = {
    sectionMapSize: Object.keys(sectionByAdv).length,
    mainButtonSectionFillCount: mainButtonSectionFillIds.length,
    mainButtonSectionFillIdsSample: mainButtonSectionFillIds.slice(0, 20),
    rejectPartnerSectionUnmapped: built.rejectReasons?.partner_section_unmapped || 0,
    prevReadyTotal: prevReady.total,
    nextReadyTotal: nextReady.total,
    readyDelta: nextReady.total - prevReady.total,
    // Negative delta alone is not a failure (legitimate expiry). Flag only empty wipe path.
    unexplainedEmptyWipeBlocked: false,
    note:
      "Compare rejectReasons + mainButtonSectionFillCount. Legitimate expiry reduces counts; section fill recovers main-button partner offers.",
  };

  const audit = {
    at: new Date().toISOString(),
    armed,
    liveWanted,
    liveEnabled: doc.liveEnabled === true,
    reason: armed ? "ready_to_write" : "dry_run",
    counts: nextReady,
    prevReady,
    productMeta,
    sourceInventory: {
      fetched: Array.isArray(sourceProducts) ? sourceProducts.length : null,
      publishedSelected: products.length,
      feeds: Array.isArray(feedInventory) ? feedInventory.length : null,
      feedDeclaredProductCount: productMeta?.feedDeclaredProductCount ?? null,
      artificialTenCapRemoved: productMeta?.artificialTenCapRemoved === true,
      incompletePartners: productMeta?.partnersIncompletePagination ?? null,
    },
    feedInventorySample: Array.isArray(feedInventory) ? feedInventory.slice(0, 40) : null,
    rejectReasons: built.rejectReasons,
    layerLossAudit,
    sha256: crypto.createHash("sha256").update(JSON.stringify(doc)).digest("hex"),
  };

  if (!armed) {
    fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2) + "\n", "utf8");
    return {
      ok: true,
      armed: false,
      wrote: false,
      reason: "DRY_RUN_DISARMED",
      liveEnabled: false,
      counts: nextReady,
      productMeta,
      doc,
      auditPath,
    };
  }

  if (fs.existsSync(publicPath)) {
    fs.writeFileSync(lkgPath, fs.readFileSync(publicPath, "utf8"), "utf8");
  }
  const tmp = publicPath + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, publicPath);
  audit.reason = "PROMOTED_ATOMIC";
  audit.wrote = true;
  fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2) + "\n", "utf8");

  return {
    ok: true,
    armed: true,
    wrote: true,
    reason: "PROMOTED_ATOMIC",
    liveEnabled: doc.liveEnabled === true,
    counts: nextReady,
    productMeta,
    doc,
    publicPath,
    lkgPath,
    auditPath,
  };
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  runOffersLiveSync()
    .then((r) => {
      console.log(
        JSON.stringify(
          {
            ok: r.ok,
            armed: r.armed,
            wrote: r.wrote,
            reason: r.reason,
            liveEnabled: r.liveEnabled,
            counts: r.counts,
            productMeta: r.productMeta,
            errors: r.errors || null,
          },
          null,
          2
        )
      );
      process.exit(r.ok || !r.armed ? 0 : 1);
    })
    .catch((e) => {
      console.error(String(e && e.stack ? e.stack : e));
      process.exit(1);
    });
}
