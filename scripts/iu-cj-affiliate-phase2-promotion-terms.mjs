#!/usr/bin/env node
/** Extract promotion condition signals from CJ link-search creative (not program legal terms). */
function parseCjDate(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const d = new Date(s.replace(/\.0$/, "").replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

function classifyTimeWindow(startRaw, endRaw, ref) {
  const start = parseCjDate(startRaw);
  const end = parseCjDate(endRaw);
  if (!start && !end) return "time_unverified";
  if (end && end < ref) return "expired";
  if (start && start > ref) return "future";
  if (start && end && start <= ref && ref <= end) return "time_active";
  if (start && !end && start <= ref) return "time_active";
  if (!start && end && end >= ref) return "time_active";
  return "time_unverified";
}

function stripHtmlLite(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const RE = {
  percentOff: /\d+\s*(?:%|percent|\bprocent)/i,
  amountOff: /(?:\d[\d\s.,]*)\s*(?:Kč|CZK|EUR|USD|£|\$|€)\s*(?:off|sleva|z\s*levnění)/i,
  freeShipping: /free\s*shipping|doprava\s*zdarma|dopravu\s*zdarma/i,
  minOrder: /min(?:imum|\.?\s*(?:objednávka|order|purchase|spend|utrat))/i,
  minOrderAmount: /(?:min(?:imum)?[^.\n]{0,40}?(?:\d[\d\s.,]*)\s*(?:Kč|CZK|EUR|USD|£|\$|€))/i,
  newCustomers: /nov[ýy]\s*zákazn|new\s*customer|first\s*order|první\s*objednáv/i,
  exclusions: /(?:neplat[ií]|except|excluded|vyj[ií]m|only\s*on)/i,
  categoryScope: /(?:na\s*(?:sortiment|kategor|značk|brand|collection)|only\s*(?:on|for))/i,
  skuList: /\bSKU\b|\bcjsku\b|\b(?:kód\s*produktu)/i,
};

export function extractPromotionSignals(link, ref) {
  const desc = String(link.description || "").trim();
  const ad = String(link.adContent || "").trim();
  const raw = [desc, ad].filter(Boolean).join("\n");
  const stripped = stripHtmlLite(raw);
  const timeWindow = classifyTimeWindow(link.promotionStartDate, link.promotionEndDate, ref);
  const start = parseCjDate(link.promotionStartDate);
  const end = parseCjDate(link.promotionEndDate);

  const signals = {};
  for (const [key, re] of Object.entries(RE)) {
    signals[key] = re.test(raw) || re.test(stripped);
  }

  return {
    source: "cj_link_search_description_adcontent",
    notProgramLegalTerms: true,
    strippedTextLength: stripped.length,
    qualityHeuristicSubstantive: stripped.length >= 40 && !/^[\W_]+$/u.test(stripped),
    validity: {
      timeWindow,
      promotionStartDate: link.promotionStartDate || null,
      promotionEndDate: link.promotionEndDate || null,
      source: "cj_link_search_promotion_dates",
    },
    targetedCountries: link.targetedCountries || null,
    signals,
    signalSources: Object.fromEntries(
      Object.entries(signals).map(([k, hit]) => [k, hit ? "creative_regex" : "not_detected_in_creative"])
    ),
  };
}

/** Documented = time active + at least discount scope signal + validity dates present (start or end). */
export function promotionConditionsDocumented(link, ref) {
  const ex = extractPromotionSignals(link, ref);
  const tw = ex.validity.timeWindow;
  if (tw === "expired") {
    return { documented: false, reason: "time_expired", extraction: ex, timeState: "expired" };
  }
  if (tw === "future") {
    return { documented: false, reason: "time_future", extraction: ex, timeState: "future" };
  }
  if (tw !== "time_active") {
    return { documented: false, reason: "time_unverified_or_contradictory", extraction: ex, timeState: "unverified" };
  }
  const priceBenefit = ex.signals.percentOff || ex.signals.amountOff;
  const shippingBenefit = ex.signals.freeShipping;
  const scopeBenefit = ex.signals.categoryScope || ex.signals.skuList;
  const scope = priceBenefit || shippingBenefit || scopeBenefit;
  const datesPresent = Boolean(ex.validity.promotionStartDate || ex.validity.promotionEndDate);
  if (!scope) {
    return { documented: false, reason: "discount_scope_not_detected_in_creative", extraction: ex };
  }
  if (!datesPresent) return { documented: false, reason: "promotion_dates_missing", extraction: ex };
  const benefitTypes = [];
  if (priceBenefit) benefitTypes.push("price_discount_on_goods");
  if (shippingBenefit) benefitTypes.push("free_shipping_benefit");
  if (scopeBenefit) benefitTypes.push("scoped_selection");
  if (ex.signals.minOrderAmount || ex.signals.minOrder) benefitTypes.push("cart_minimum_condition");
  return {
    documented: true,
    reason: "creative_scope_plus_cj_dates",
    extraction: ex,
    benefitTypes,
    shippingOnly: shippingBenefit && !priceBenefit,
  };
}

/** Catalog/display must not treat shipping benefit as unit price discount. */
export function productDisplayPriceFromOffer(product, promoDoc) {
  const base = product?.price?.amount ?? product?.price ?? null;
  if (promoDoc?.shippingOnly) {
    return { displayUnitPrice: base, priceDiscountApplied: false, note: "free_shipping_does_not_alter_product_unit_price" };
  }
  return { displayUnitPrice: base, priceDiscountApplied: false, note: "no_automatic_price_discount_without_documented_goods_benefit" };
}
