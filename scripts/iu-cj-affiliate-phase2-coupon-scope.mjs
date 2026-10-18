#!/usr/bin/env node
/** Parse coupon product scope from link-search creative (not legal terms). */
import { stripHtmlLite } from "./iu-cj-affiliate-phase2-lib.mjs";

const RE = {
  fullSortiment: /(?:na\s+v[sš]e|v[sš]echny\s+produkty|cel[ýy]\s+sortiment|entire\s+store|site.?wide|storewide)/i,
  fullSortimentFromStore: /na\s+v[sš]e\s+z\s+([a-z0-9-]+\.(?:cz|sk|ro|pl|ie|com))/i,
  selectedModels: /vybran[ée]\s+modely|selected\s+models|vybran[ée]\s+/i,
  categoryLine: /sleva\s+\d+\s*%?\s*na\s+([^<\n.]{3,80})/i,
  brandMention: /zna[cč]k[aouy]\s+([A-Za-z0-9\u00C0-\u017F\-]{2,40})/i,
  minCart: /(?:nad|peste|over|above)\s+(\d[\d\s.,]*)\s*(Kč|CZK|lei|EUR|USD|€|\$)/i,
  minCartPurchasePhrase:
    /minim[áa]ln[ií]\s+(?:hodnota\s+)?n[áa]kupu\s*[:\s]*(\d[\d\s.,]*)\s*(kč|Kč|CZK)/i,
  secondItem: /(?:al\s+doilea|druh[ýy]|second)\s+(?:element|kus|item|produkt)/i,
  exclusionBlock: /(?:krom[eě]|except|excluding|neplat[ií]\s+(?:na|pro)|vylou[cč]eno)[^.!\n]{0,200}/gi,
};

export function decodeHtmlEntitiesLite(s) {
  return String(s || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"');
}

export function parseCouponScope(link) {
  const raw = decodeHtmlEntitiesLite([link.description, link.adContent].filter(Boolean).join("\n"));
  const stripped = stripHtmlLite(raw);
  const lower = stripped.toLowerCase();

  const exclusionSpans = [];
  let m;
  const exRe = new RegExp(RE.exclusionBlock.source, RE.exclusionBlock.flags);
  while ((m = exRe.exec(raw)) !== null) {
    exclusionSpans.push({ start: m.index, end: m.index + m[0].length, text: stripHtmlLite(m[0]) });
  }

  let scopeType = "unknown";
  const evidence = [];
  let categoryKeywords = [];
  let brandKeyword = null;
  let targetStoreHost = null;
  const dest = String(link.destination || "").trim();
  if (/\/akce\/[a-z0-9-]+/i.test(dest)) {
    evidence.push("destination_promo_landing:" + dest.slice(0, 120));
  }
  const brandProductSubset = /(?:sleva|zlevn[eě]n[ií]|slevu)\s+\d+\s*%?\s*na\s+v[sš]echny\s+produkty\s+([A-Za-z0-9\u00C0-\u017F-]{2,40})/i.exec(
    stripped
  );
  if (brandProductSubset) {
    scopeType = "category_or_subset_restricted";
    brandKeyword = brandProductSubset[1];
    categoryKeywords = [brandProductSubset[1].toLowerCase()];
    evidence.push("creative_brand_product_subset:" + brandProductSubset[1].slice(0, 40));
  } else if (RE.fullSortimentFromStore.test(stripped)) {
    const storeM = stripped.match(RE.fullSortimentFromStore);
    targetStoreHost = storeM ? storeM[1].toLowerCase() : targetStoreHost;
    scopeType = "full_sortiment_site_restricted";
    evidence.push("creative_full_sortiment_na_vse_z_store:" + (targetStoreHost || ""));
  } else if (RE.fullSortiment.test(stripped)) {
    scopeType = "full_sortiment";
    evidence.push("creative_full_sortiment_phrase");
  }
  if (RE.selectedModels.test(stripped)) {
    scopeType = scopeType === "full_sortiment" ? "full_sortiment_with_selected_models_note" : "category_or_subset_restricted";
    evidence.push("creative_selected_models_phrase");
  }
  const skuPhrase = stripped.match(/(?:produkt|product|sku|model)\s+(SKU[-A-Z0-9]+)/i);
  if (skuPhrase) {
    const sku = skuPhrase[1].toUpperCase();
    if (scopeType === "unknown" || scopeType === "full_sortiment") {
      scopeType = "selected_models";
    }
    evidence.push("model_list:" + sku);
    evidence.push("creative_documented_sku:" + sku);
  }
  const catM = stripped.match(RE.categoryLine);
  if (catM) {
    const phrase = stripHtmlLite(catM[1]).toLowerCase();
    categoryKeywords = phrase
      .split(/\s+/)
      .filter((w) => w.length >= 4)
      .slice(0, 6);
    if (scopeType === "unknown") scopeType = "category_restricted";
    evidence.push("creative_category_phrase:" + phrase.slice(0, 60));
  }
  const siteStoreM = stripped.match(/na\s+v[sš]e\s+na\s+([a-z0-9-]+\.(?:sk|cz|ro|pl|ie))/i);
  if (siteStoreM && !targetStoreHost) {
    targetStoreHost = siteStoreM[1].toLowerCase();
  }
  if (targetStoreHost) {
    if (scopeType === "full_sortiment" || scopeType === "full_sortiment_site_restricted") {
      scopeType = "full_sortiment_site_restricted";
    } else if (scopeType === "unknown" || scopeType === "site_restricted") {
      scopeType = "site_restricted";
    }
    evidence.push("creative_target_store:" + targetStoreHost);
    if (targetStoreHost.includes("wrangler")) {
      brandKeyword = "wrangler";
      evidence.push("creative_wrangler_store_domain");
    }
  }

  const hasDocumentedModelList = evidence.some((e) => e.startsWith("model_list:"));
  const naPhrase = stripped.match(/(?<![\p{L}])na\s+(?:vybran[eé]\s+modely\s+)?([a-záčďéěíňóřšťúůýžA-Z0-9\s]{4,55})/iu);
  if (naPhrase) {
    const phrase = stripHtmlLite(naPhrase[1]).toLowerCase();
    const skipNa =
      hasDocumentedModelList ||
      /použit|rozbalen|výprodej|outlet|gift|poukaz|kromě|except/i.test(phrase) ||
      /neplat[ií]\s+na/i.test(stripped.slice(Math.max(0, naPhrase.index - 12), naPhrase.index + 4));
    if (!skipNa) {
      const tokens = phrase.split(/\s+/).filter((w) => w.length >= 4);
      categoryKeywords = [...new Set([...categoryKeywords, ...tokens])].slice(0, 8);
      if (!scopeType.includes("full") && !scopeType.includes("site")) {
        scopeType = RE.selectedModels.test(stripped) ? "category_or_subset_restricted" : "category_restricted";
      }
      evidence.push("creative_na_phrase:" + phrase.slice(0, 60));
    }
  }
  const brandM = stripped.match(RE.brandMention);
  if (brandM && !brandKeyword) brandKeyword = brandM[1].trim();
  if (brandKeyword && scopeType === "unknown") {
    scopeType = "brand_restricted";
    evidence.push("creative_brand_mention:" + brandKeyword);
  }

  if (RE.secondItem.test(stripped)) {
    scopeType = "cart_rule_second_item";
    evidence.push("creative_second_item_discount");
  }
  let cartM = stripped.match(RE.minCart);
  if (!cartM) cartM = stripped.match(RE.minCartPurchasePhrase);
  if (!cartM) {
    const glued = stripped.match(/minim[áa]ln[ií][^.!\n]{0,40}?(\d+)\s*(kč|Kč|CZK)/i);
    if (glued) cartM = [glued[0], glued[1], glued[2]];
  }
  const cartMin = cartM
    ? {
        amount: String(cartM[1]).replace(/\s/g, "").replace(/,/g, "."),
        currency: String(cartM[2]).replace(/^kč$/i, "Kč"),
      }
    : null;
  if (cartMin) evidence.push("creative_min_cart:" + (cartM[0] || "").slice(0, 40));

  if (exclusionSpans.length > 0) {
    if (scopeType === "full_sortiment") scopeType = "full_sortiment_with_exclusions";
    evidence.push("creative_exclusion_block_count:" + exclusionSpans.length);
  }

  const productUrlMatch = raw.match(/https?:\/\/[^\s<"]+/i);
  if (productUrlMatch && /\/c\/|category|kategorie/i.test(productUrlMatch[0])) {
    evidence.push("creative_category_url_present");
    if (scopeType === "unknown") scopeType = "category_restricted";
  }
  if (/\/akce\/[a-z0-9-]+/i.test(dest) && scopeType === "full_sortiment") {
    scopeType = "category_or_subset_restricted";
    evidence.push("destination_overrides_full_sortiment_inference");
    const slug = dest.match(/\/akce\/([a-z0-9-]+)/i)?.[1];
    if (slug && !brandKeyword) {
      brandKeyword = slug.replace(/-/g, " ");
      categoryKeywords = [slug.replace(/-/g, ""), slug].slice(0, 4);
    }
  }

  return {
    scopeType,
    evidence,
    categoryKeywords,
    brandKeyword,
    targetStoreHost,
    cartMin,
    exclusionSpans: exclusionSpans.map((e) => e.text),
    offerTextRaw: raw.slice(0, 2000),
    offerTextStripped: stripped.slice(0, 500),
    source: "cj_link_search_description_adcontent",
  };
}

/** Terms after kromě/except in creative exclusion blocks (not hardcoded brand list). */
export function parseDocumentedExclusionTerms(scope) {
  const out = [];
  for (const span of scope?.exclusionSpans || []) {
    let body = String(span)
      .replace(/^(?:krom[eě]|except|excluding|neplat[ií]\s+(?:na|pro)|vylou[cč]eno)\s*/i, "")
      .trim()
      .replace(/[.!]+$/, "");
    if (!body) continue;
    const parts = body.split(/\s*,\s*|\s+a\s+|\s+and\s+/i);
    for (const part of parts) {
      const t = stripHtmlLite(part).trim().toLowerCase();
      if (t.length >= 3) out.push(t);
    }
  }
  return [...new Set(out)];
}

function exclusionTermMatchesProductText(haystack, term) {
  const hay = String(haystack || "").toLowerCase();
  const core = String(term || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u017F]+/g, " ")
    .trim();
  if (core.length < 4) return false;
  if (hay.includes(core)) return true;
  const stem = core.replace(/(u|ů|ě|í|y|a)$/i, "");
  if (stem.length >= 4 && hay.includes(stem)) return true;
  const words = core.split(/\s+/).filter((w) => w.length >= 4);
  if (words.length > 1 && words.every((w) => hay.includes(w.replace(/(u|ů)$/i, "")))) return true;
  return false;
}

/**
 * @returns {{ status: 'pass'|'ineligible'|'unknown', reason?: string, source?: string, term?: string }}
 */
export function assessProductDocumentedExclusions(product, scope) {
  const terms = parseDocumentedExclusionTerms(scope);
  if (terms.length === 0) return { status: "pass" };
  const name = String(product.name || "").toLowerCase();
  const desc = String(product.description || "").toLowerCase();
  const hay = `${name} ${desc}`;
  for (const term of terms) {
    if (exclusionTermMatchesProductText(hay, term)) {
      return {
        status: "ineligible",
        reason: "product_in_documented_exclusion_zone",
        source: "creative_exclusion_block",
        term,
      };
    }
  }
  return { status: "pass" };
}

export function tokenInExclusionZone(token, raw, exclusionSpans) {
  const t = String(token || "").toLowerCase();
  if (!t || t.length < 3) return false;
  const idx = raw.toLowerCase().indexOf(t);
  if (idx < 0) return false;
  for (const span of exclusionSpans) {
    const s = raw.toLowerCase().indexOf(span.text.toLowerCase().slice(0, 20));
    if (s >= 0 && idx >= s && idx <= s + span.text.length + 40) return true;
  }
  return false;
}

export function productMatchesScope(product, scope, rawForExclusion = "") {
  const name = String(product.name || "").toLowerCase();
  const id = String(product.productId || "").toLowerCase();
  const desc = String(product.description || "").toLowerCase();
  const exclusions = scope.exclusionSpans || [];

  const inExclusion = (token) => tokenInExclusionZone(token, rawForExclusion, exclusions);

  if (
    scope.scopeType === "full_sortiment" ||
    scope.scopeType === "full_sortiment_with_exclusions" ||
    scope.scopeType === "full_sortiment_site_restricted"
  ) {
    const exAssess = assessProductDocumentedExclusions(product, scope);
    if (exAssess.status === "ineligible") {
      return { match: false, reason: exAssess.reason, detail: exAssess.term || "documented_exclusion" };
    }
    if (exAssess.status === "unknown") {
      return { match: false, reason: exAssess.reason, detail: "exclusion_unverified", scopeStatus: "unknown" };
    }
    return { match: true, reason: "full_sortiment_scope", detail: "sample_or_query_not_full_catalog_proof" };
  }

  if (scope.scopeType === "category_restricted" || scope.scopeType === "category_or_subset_restricted") {
    const keys = scope.categoryKeywords.length ? scope.categoryKeywords : [];
    if (keys.length === 0 && scope.offerTextStripped) {
      const fallback = scope.offerTextStripped.match(/na\s+([a-záčďéěíňóřšťúůýž\s]{4,40})/i);
      if (fallback) keys.push(...fallback[1].trim().split(/\s+/).filter((w) => w.length >= 4));
    }
    for (const k of keys) {
      if (inExclusion(k)) continue;
      if (k.length < 5) continue;
      if (name.includes(k)) {
        return { match: true, reason: "category_keyword_in_product_name", detail: k };
      }
      if (desc.includes(k) && name.length > 0) {
        return {
          match: true,
          reason: "category_keyword_in_product_description_only",
          detail: k,
          warning: "name_did_not_match; weaker_evidence",
        };
      }
    }
    return { match: false, reason: "no_category_keyword_in_product_fields", detail: keys.join("|") || "none_extracted" };
  }

  if (scope.scopeType === "brand_restricted" && scope.brandKeyword) {
    if (inExclusion(scope.brandKeyword)) return { match: false, reason: "brand_in_exclusion_zone" };
    if (name.includes(scope.brandKeyword.toLowerCase()) || desc.includes(scope.brandKeyword.toLowerCase())) {
      return { match: true, reason: "brand_in_product_text", detail: scope.brandKeyword };
    }
    return { match: false, reason: "brand_not_in_product_sample_fields" };
  }

  if (scope.scopeType === "cart_rule_second_item" || scope.cartMin) {
    return {
      match: false,
      reason: "cart_level_rule_no_sku_binding_without_eligibility_api",
      detail: scope.scopeType,
    };
  }

  return { match: false, reason: "scope_not_mapped_or_unknown" };
}
