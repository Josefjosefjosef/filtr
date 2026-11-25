#!/usr/bin/env node
/**
 * V51.8 — individual completeness audit (offline, pure, no network / no env / no writes).
 *
 * Complements iu-cj-affiliate-phase3z-coupons-actions-audit-v51-8.mjs (validity classifier)
 * with per-item field completeness:
 *   1) per-coupon:       code, advertiser, dates, deep link
 *   2) per-action/button: button fields + publication state vs published offers
 *   3) sample product card: title (UTF-8 box-drawing count), price, link
 *
 * DISARMED: reads a JSON snapshot only. No growth / email / D1 / R2 activation.
 *
 * CLI:
 *   node scripts/iu-cj-affiliate-phase3z-individual-completeness-audit-v51-8.mjs            (selftest)
 *   node scripts/iu-cj-affiliate-phase3z-individual-completeness-audit-v51-8.mjs --file <offers-public.json> [--sample N] [--full] [--strict]
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";

export const INDIVIDUAL_COMPLETENESS_SCHEMA =
  "iu-cj-affiliate-phase3z-individual-completeness-audit-v51-8";

export const COMPLETENESS = Object.freeze({
  COMPLETE: "COMPLETE",
  INCOMPLETE: "INCOMPLETE",
});

export const BUTTON_STATUS = Object.freeze({
  BUTTON_OK: "BUTTON_OK",
  BUTTON_MISSING_FIELDS: "BUTTON_MISSING_FIELDS",
  NOT_PUBLISHED: "NOT_PUBLISHED",
  ORPHAN_BUTTON: "ORPHAN_BUTTON",
});

/** U+2500..U+257F — characters that appear when CP852 UTF-8 mojibake leaks into titles. */
const BOX_DRAWING_RE = /[\u2500-\u257F]/g;

export function countBoxDrawing(text) {
  if (text == null) return 0;
  const m = String(text).match(BOX_DRAWING_RE);
  return m ? m.length : 0;
}

function nonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function parseInstant(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (!s) return null;
  const normalized = /Z$/i.test(s) || /[+-]\d{2}:\d{2}$/.test(s) ? s : s.replace(" ", "T") + "Z";
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

export function isHttpsUrl(raw) {
  if (!nonEmptyString(raw)) return false;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" && u.hostname.length > 0;
  } catch {
    return false;
  }
}

function offerKey(row) {
  return row?.offerId ?? row?.id ?? null;
}

function datesProblems(row) {
  const problems = [];
  const fromRaw = row?.validFrom;
  const toRaw = row?.validTo;
  const fromMs = parseInstant(fromRaw);
  const toMs = parseInstant(toRaw);
  if (!nonEmptyString(fromRaw)) problems.push("validFrom_missing");
  else if (fromMs == null) problems.push("validFrom_unparseable");
  if (!nonEmptyString(toRaw)) problems.push("validTo_missing");
  else if (toMs == null) problems.push("validTo_unparseable");
  if (fromMs != null && toMs != null && fromMs > toMs) problems.push("dates_inverted");
  return problems;
}

function advertiserProblems(row) {
  const problems = [];
  if (!nonEmptyString(String(row?.advertiserId ?? ""))) problems.push("advertiserId_missing");
  if (!nonEmptyString(row?.partnerName)) problems.push("partnerName_missing");
  return problems;
}

/**
 * Per-coupon field completeness: code, advertiser, dates, deep link.
 * @param {object[]} coupons
 */
export function auditCouponCompleteness(coupons) {
  const list = Array.isArray(coupons) ? coupons : [];
  const rows = list.map((row, index) => {
    const missing = [];
    if (!nonEmptyString(row?.couponCode)) missing.push("couponCode_missing");
    missing.push(...advertiserProblems(row));
    missing.push(...datesProblems(row));
    if (!nonEmptyString(row?.affiliateUrl)) missing.push("deepLink_missing");
    else if (!isHttpsUrl(row.affiliateUrl)) missing.push("deepLink_not_https_url");
    return {
      kind: "coupon",
      index,
      offerId: offerKey(row),
      advertiserId: row?.advertiserId ?? null,
      couponCode: row?.couponCode ?? null,
      status: missing.length === 0 ? COMPLETENESS.COMPLETE : COMPLETENESS.INCOMPLETE,
      missing,
    };
  });
  const incomplete = rows.filter((r) => r.status === COMPLETENESS.INCOMPLETE);
  const missingByField = {};
  for (const r of incomplete) for (const m of r.missing) missingByField[m] = (missingByField[m] || 0) + 1;
  return {
    total: rows.length,
    complete: rows.length - incomplete.length,
    incomplete: incomplete.length,
    missingByField,
    rows,
  };
}

function isPublished(row) {
  return (
    row?.publicationReady === true &&
    row?.publishable === true &&
    row?.fixtureOnly !== true &&
    (!Array.isArray(row?.blockers) || row.blockers.length === 0)
  );
}

/**
 * Per-action / button audit vs published offers.
 *
 * A "button" is the CTA rendered from an action (title + https deep link + advertiser).
 * `buttons` (optional) is an explicit published-button list ({ offerId, url?, label? });
 * when given, buttons without a matching published action are ORPHAN_BUTTON and
 * published actions without a button are reported in `actionsWithoutButton`.
 *
 * @param {object[]} actions
 * @param {{ buttons?: object[], coupons?: object[] }} [opts]
 */
export function auditActionButtons(actions, opts = {}) {
  const list = Array.isArray(actions) ? actions : [];
  const buttons = Array.isArray(opts.buttons) ? opts.buttons : null;
  const couponIds = new Set((Array.isArray(opts.coupons) ? opts.coupons : []).map(offerKey).filter((v) => v != null));
  const seenIds = new Map();
  const seenUrls = new Map();

  const rows = list.map((row, index) => {
    const missing = [];
    const id = offerKey(row);
    if (!nonEmptyString(row?.title)) missing.push("title_missing");
    missing.push(...advertiserProblems(row));
    if (!nonEmptyString(row?.affiliateUrl)) missing.push("buttonUrl_missing");
    else if (!isHttpsUrl(row.affiliateUrl)) missing.push("buttonUrl_not_https_url");
    if (id == null) missing.push("offerId_missing");

    const flags = [];
    if (id != null) {
      if (seenIds.has(id)) flags.push("duplicate_offerId");
      seenIds.set(id, (seenIds.get(id) || 0) + 1);
      if (couponIds.has(id)) flags.push("offerId_also_coupon");
    }
    if (nonEmptyString(row?.affiliateUrl)) {
      if (seenUrls.has(row.affiliateUrl)) flags.push("duplicate_buttonUrl");
      seenUrls.set(row.affiliateUrl, true);
    }

    const published = isPublished(row);
    let status;
    if (!published) status = BUTTON_STATUS.NOT_PUBLISHED;
    else if (missing.length > 0) status = BUTTON_STATUS.BUTTON_MISSING_FIELDS;
    else status = BUTTON_STATUS.BUTTON_OK;

    return {
      kind: "action",
      index,
      offerId: id,
      advertiserId: row?.advertiserId ?? null,
      published,
      status,
      missing,
      flags,
    };
  });

  const orphanButtons = [];
  const actionsWithoutButton = [];
  if (buttons) {
    const publishedIds = new Set(rows.filter((r) => r.published && r.offerId != null).map((r) => r.offerId));
    const buttonIds = new Set();
    buttons.forEach((b, index) => {
      const id = offerKey(b);
      if (id != null) buttonIds.add(id);
      if (id == null || !publishedIds.has(id)) {
        orphanButtons.push({ kind: "button", index, offerId: id, status: BUTTON_STATUS.ORPHAN_BUTTON });
      }
    });
    for (const id of publishedIds) if (!buttonIds.has(id)) actionsWithoutButton.push(id);
  }

  const counts = { BUTTON_OK: 0, BUTTON_MISSING_FIELDS: 0, NOT_PUBLISHED: 0, ORPHAN_BUTTON: orphanButtons.length };
  for (const r of rows) counts[r.status] += 1;
  const duplicates = rows.filter((r) => r.flags.some((f) => f.startsWith("duplicate_"))).length;

  return {
    total: rows.length,
    publishedOffers: rows.filter((r) => r.published).length,
    counts,
    duplicates,
    alsoCoupon: rows.filter((r) => r.flags.includes("offerId_also_coupon")).length,
    buttonsChecked: buttons ? buttons.length : null,
    orphanButtons,
    actionsWithoutButton,
    rows,
  };
}

/**
 * Deterministic sample: evenly strided across the list (no randomness => reproducible).
 * sampleSize <= 0 or >= length => all rows.
 */
export function strideSample(list, sampleSize) {
  const arr = Array.isArray(list) ? list : [];
  const n = Number(sampleSize);
  if (!Number.isFinite(n) || n <= 0 || n >= arr.length) return arr.slice();
  const out = [];
  const step = arr.length / n;
  for (let i = 0; i < n; i += 1) out.push(arr[Math.floor(i * step)]);
  return out;
}

/**
 * Sample product-card field audit: title (UTF-8 box-drawing count), price, link.
 * @param {object[]} products
 * @param {{ sampleSize?: number }} [opts]
 */
export function auditProductCards(products, opts = {}) {
  const all = Array.isArray(products) ? products : [];
  const sample = strideSample(all, opts.sampleSize ?? 200);
  const rows = sample.map((row, index) => {
    const missing = [];
    const title = row?.title;
    const boxDrawingCount = countBoxDrawing(title);
    if (!nonEmptyString(title)) missing.push("title_missing");
    if (boxDrawingCount > 0) missing.push("title_box_drawing_mojibake");
    const price = row?.currentPrice;
    const priceNum = typeof price === "string" ? Number(price) : price;
    if (price == null || price === "") missing.push("price_missing");
    else if (!Number.isFinite(priceNum) || priceNum <= 0) missing.push("price_invalid");
    if (!nonEmptyString(row?.affiliateUrl)) missing.push("link_missing");
    else if (!isHttpsUrl(row.affiliateUrl)) missing.push("link_not_https_url");
    return {
      kind: "product",
      index,
      productKey: row?.productKey ?? row?.productId ?? null,
      boxDrawingCount,
      status: missing.length === 0 ? COMPLETENESS.COMPLETE : COMPLETENESS.INCOMPLETE,
      missing,
    };
  });
  const incomplete = rows.filter((r) => r.status === COMPLETENESS.INCOMPLETE);
  const missingByField = {};
  for (const r of incomplete) for (const m of r.missing) missingByField[m] = (missingByField[m] || 0) + 1;
  return {
    totalProducts: all.length,
    sampled: rows.length,
    complete: rows.length - incomplete.length,
    incomplete: incomplete.length,
    titlesWithBoxDrawing: rows.filter((r) => r.boxDrawingCount > 0).length,
    boxDrawingCharsTotal: rows.reduce((a, r) => a + r.boxDrawingCount, 0),
    missingByField,
    rows,
  };
}

/**
 * Build full snapshot from an offers-public JSON (sections[].coupons|actions|products).
 * @param {object} doc
 * @param {{ sampleSize?: number, buttons?: object[] }} [opts]
 */
export function buildIndividualCompletenessAudit(doc, opts = {}) {
  const sections = Array.isArray(doc?.sections) ? doc.sections : [];
  const coupons = [];
  const actions = [];
  const products = [];
  for (const s of sections) {
    if (Array.isArray(s?.coupons)) coupons.push(...s.coupons);
    if (Array.isArray(s?.actions)) actions.push(...s.actions);
    if (Array.isArray(s?.products)) products.push(...s.products);
  }
  const couponAudit = auditCouponCompleteness(coupons);
  const actionAudit = auditActionButtons(actions, { buttons: opts.buttons, coupons });
  const productAudit = auditProductCards(products, { sampleSize: opts.sampleSize });
  return {
    schema: INDIVIDUAL_COMPLETENESS_SCHEMA,
    disarmed: true,
    sourceSchema: doc?.schema ?? null,
    sourceUpdatedAt: doc?.updatedAt ?? null,
    sections: sections.length,
    coupons: couponAudit,
    actions: actionAudit,
    products: productAudit,
    summary: {
      couponsIncomplete: couponAudit.incomplete,
      actionsMissingFields: actionAudit.counts.BUTTON_MISSING_FIELDS,
      actionsNotPublished: actionAudit.counts.NOT_PUBLISHED,
      orphanButtons: actionAudit.counts.ORPHAN_BUTTON,
      productCardsIncomplete: productAudit.incomplete,
      productTitlesWithBoxDrawing: productAudit.titlesWithBoxDrawing,
    },
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

export function runIndividualCompletenessSelftest() {
  const okCoupon = {
    offerId: "c1",
    couponCode: "SAVE10",
    advertiserId: "111",
    partnerName: "Shop A",
    validFrom: "2026-11-01 00:00:00.0",
    validTo: "2026-12-01 00:00:00.0",
    affiliateUrl: "https://www.example.com/click-1-c1",
  };
  const couponDoc = [
    okCoupon,
    { ...okCoupon, offerId: "c2", couponCode: "" },
    { ...okCoupon, offerId: "c3", advertiserId: null, partnerName: null },
    { ...okCoupon, offerId: "c4", validFrom: null, validTo: "garbage" },
    { ...okCoupon, offerId: "c5", validFrom: "2026-12-02 00:00:00.0" },
    { ...okCoupon, offerId: "c6", affiliateUrl: "http://insecure.example/x" },
    { ...okCoupon, offerId: "c7", affiliateUrl: null },
  ];
  const ca = auditCouponCompleteness(couponDoc);
  assert(ca.total === 7 && ca.complete === 1 && ca.incomplete === 6, "coupon counts");
  assert(ca.rows[1].missing.includes("couponCode_missing"), "coupon code missing");
  assert(ca.rows[2].missing.includes("advertiserId_missing") && ca.rows[2].missing.includes("partnerName_missing"), "coupon advertiser");
  assert(ca.rows[3].missing.includes("validFrom_missing") && ca.rows[3].missing.includes("validTo_unparseable"), "coupon dates");
  assert(ca.rows[4].missing.includes("dates_inverted"), "coupon inverted");
  assert(ca.rows[5].missing.includes("deepLink_not_https_url"), "coupon http link");
  assert(ca.rows[6].missing.includes("deepLink_missing"), "coupon link missing");

  const okAction = {
    offerId: "a1",
    title: "Black Week",
    advertiserId: "222",
    partnerName: "Shop B",
    affiliateUrl: "https://www.example.com/click-1-a1",
    publicationReady: true,
    publishable: true,
    fixtureOnly: false,
    blockers: [],
  };
  const actions = [
    okAction,
    { ...okAction, offerId: "a2", title: "", affiliateUrl: "https://www.example.com/click-1-a2" },
    { ...okAction, offerId: "a3", publishable: false, affiliateUrl: "https://www.example.com/click-1-a3" },
    { ...okAction, offerId: "a4", blockers: ["x"], affiliateUrl: "https://www.example.com/click-1-a4" },
    { ...okAction, offerId: "a1", affiliateUrl: "https://www.example.com/click-1-dup" },
    { ...okAction, offerId: "c1", affiliateUrl: "https://www.example.com/click-1-also" },
  ];
  const aa = auditActionButtons(actions, {
    coupons: [okCoupon],
    buttons: [{ offerId: "a1" }, { offerId: "ghost" }, { offerId: "a3" }],
  });
  assert(aa.total === 6, "action total");
  assert(aa.counts.BUTTON_OK === 3, "action ok count: " + aa.counts.BUTTON_OK);
  assert(aa.counts.BUTTON_MISSING_FIELDS === 1, "action missing fields");
  assert(aa.counts.NOT_PUBLISHED === 2, "action not published");
  assert(aa.counts.ORPHAN_BUTTON === 2, "orphan buttons (ghost + unpublished a3)");
  assert(aa.duplicates === 1, "duplicate offerId");
  assert(aa.alsoCoupon === 1, "action also coupon");
  assert(aa.actionsWithoutButton.includes("c1"), "published action without button");

  const okProduct = {
    productKey: "p1",
    title: "Škrabadlo Housenka 50x22x9cm",
    currentPrice: 419,
    affiliateUrl: "https://www.example.com/click-1?url=x",
  };
  const mojibake = "PAOLA n┼Ĺi pizsama bambuszb├│l";
  assert(countBoxDrawing(mojibake) === 4 || countBoxDrawing(mojibake) > 0, "box drawing detection");
  assert(countBoxDrawing("Příliš žluťoučký kůň") === 0, "clean czech has no box drawing");
  const pa = auditProductCards(
    [
      okProduct,
      { ...okProduct, productKey: "p2", title: mojibake },
      { ...okProduct, productKey: "p3", currentPrice: null },
      { ...okProduct, productKey: "p4", currentPrice: 0 },
      { ...okProduct, productKey: "p5", affiliateUrl: "" },
      { ...okProduct, productKey: "p6", title: "" },
    ],
    { sampleSize: 0 },
  );
  assert(pa.sampled === 6 && pa.complete === 1 && pa.incomplete === 5, "product counts");
  assert(pa.titlesWithBoxDrawing === 1 && pa.boxDrawingCharsTotal === countBoxDrawing(mojibake), "box counts");
  assert(pa.rows[2].missing.includes("price_missing"), "price missing");
  assert(pa.rows[3].missing.includes("price_invalid"), "price invalid");
  assert(pa.rows[4].missing.includes("link_missing"), "link missing");
  assert(pa.rows[5].missing.includes("title_missing"), "title missing");

  const big = Array.from({ length: 1000 }, (_, i) => ({ ...okProduct, productKey: "k" + i }));
  const s1 = strideSample(big, 10);
  const s2 = strideSample(big, 10);
  assert(s1.length === 10 && s1[0].productKey === "k0" && s1[9].productKey === "k900", "stride sample");
  assert(JSON.stringify(s1) === JSON.stringify(s2), "sample deterministic");
  assert(strideSample(big, 0).length === 1000 && strideSample(big, 5000).length === 1000, "sample all");

  const doc = {
    schema: "iu-affiliate-cj-offers-public-v1",
    updatedAt: "2026-11-25T00:00:00.000Z",
    sections: [
      { sectionKey: "s1", coupons: [okCoupon], actions: [okAction], products: [okProduct] },
      { sectionKey: "s2", coupons: [], actions: [], products: [{ ...okProduct, title: mojibake }] },
    ],
  };
  const full = buildIndividualCompletenessAudit(doc, { sampleSize: 0 });
  assert(full.disarmed === true, "disarmed flag");
  assert(full.sections === 2 && full.coupons.total === 1 && full.actions.total === 1 && full.products.totalProducts === 2, "doc totals");
  assert(full.summary.couponsIncomplete === 0 && full.summary.productTitlesWithBoxDrawing === 1, "doc summary");
  const empty = buildIndividualCompletenessAudit({});
  assert(empty.coupons.total === 0 && empty.actions.total === 0 && empty.products.sampled === 0, "empty doc");

  return {
    schema: INDIVIDUAL_COMPLETENESS_SCHEMA + "-selftest",
    ok: true,
    checks: { coupon: ca.rows.length, action: aa.rows.length, product: pa.rows.length },
    summary: full.summary,
  };
}

function parseArgs(argv) {
  const out = { file: null, sample: 200, full: false, strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--file") out.file = argv[++i];
    else if (a === "--sample") out.sample = Number(argv[++i]);
    else if (a === "--full") out.full = true;
    else if (a === "--strict") out.strict = true;
  }
  return out;
}

function isDirectRun() {
  const arg = process.argv[1];
  if (!arg) return false;
  return path.resolve(arg) === path.resolve(fileURLToPath(import.meta.url));
}

if (isDirectRun()) {
  const args = parseArgs(process.argv.slice(2));
  if (args.file) {
    const doc = JSON.parse(readFileSync(path.resolve(args.file), "utf8"));
    const audit = buildIndividualCompletenessAudit(doc, { sampleSize: args.sample });
    const view = args.full
      ? audit
      : {
          ...audit,
          coupons: { ...audit.coupons, rows: audit.coupons.rows.filter((r) => r.status !== COMPLETENESS.COMPLETE).slice(0, 20) },
          actions: { ...audit.actions, rows: audit.actions.rows.filter((r) => r.status !== BUTTON_STATUS.BUTTON_OK).slice(0, 20) },
          products: { ...audit.products, rows: audit.products.rows.filter((r) => r.status !== COMPLETENESS.COMPLETE).slice(0, 20) },
        };
    console.log(JSON.stringify(view, null, 2));
    const s = audit.summary;
    const dirty = s.couponsIncomplete + s.actionsMissingFields + s.orphanButtons + s.productCardsIncomplete;
    if (args.strict && dirty > 0) process.exit(1);
  } else {
    const result = runIndividualCompletenessSelftest();
    console.log(
      JSON.stringify(
        { IU_CJ_INDIVIDUAL_COMPLETENESS_SELFTEST: result.ok ? "PASS" : "FAIL", ...result },
        null,
        2,
      ),
    );
    if (!result.ok) process.exit(1);
  }
}
