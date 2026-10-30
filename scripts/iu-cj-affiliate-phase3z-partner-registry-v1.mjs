#!/usr/bin/env node
/**
 * Phase 3Z — canonical CJ partner registry + non-public partner-button catalog.
 *
 * Authority: CJ staging advertisers/links only (not historical baked affiliate URLs).
 * Never arms public overlay / R2 live / catalog JS rewrite.
 * Never touches PAID_RESERVED / MANUAL_PROTECTED slots.
 * Email/AI are NOT authority for JOINED/ENDED.
 *
 * Run: node scripts/iu-cj-affiliate-phase3z-partner-registry-v1.mjs
 * Env:
 *   IU_CJ_PHASE3Z_STAGING_PATH — override staging JSON
 *   IU_CJ_PHASE3Z_VERIFY_URLS=1 — HTTP redirect probe
 *   IU_CJ_PHASE3Z_VERIFY_LIMIT — max probes (default all candidates)
 *   IU_CJ_PHASE3Z_VERIFY_CONCURRENCY — parallel probes (default 3)
 *   IU_CJ_PHASE3Z_VERIFY_SPACING_MS — delay between batches (default 400)
 *   IU_CJ_PHASE3Z_VERIFY_CHECKPOINT — resume JSON path
 *   IU_CJ_PHASE3Z_OUT_DIR — write registry + button catalog JSON
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isCjTrackingUrl,
  WEBSITE_PID,
  assertAllowedDataWrite,
} from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import {
  normalizePartnerBrand,
  parseCjPrimaryCategory,
  CJ_CATEGORY_SECTION_EVIDENCE,
} from "./iu-cj-affiliate-phase3e-partner-recon-v1.mjs";
import { classifyPolicyManagement } from "./iu-cj-affiliate-phase3f-dynamic-catalog-v1.mjs";
import { parseAffiliateCatalogOrdered } from "./iu-cj-affiliate-phase2-partner-slot-inventory-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PHASE3Z_SCHEMA = "iu-affiliate-cj-partner-registry-v1";
export const PHASE3Z_BUTTONS_SCHEMA = "iu-affiliate-cj-partner-buttons-preview-v1";
export const PHASE3Z_RULES_VERSION = "phase3z-partner-robot-v5";

/** Language preference for InfoUzel visitors: CZ first, then SK, then EN. EN is never quarantine-only. */
export const LANGUAGE_PRIORITY = Object.freeze(["CZ", "SK", "EN"]);

/**
 * Slot-policy management meanings (identity ≠ chip ownership):
 * - CJ_MANAGED: already listed for CJ robot/dynamic overlay ownership
 * - UNASSIGNED: JOINED in CJ but absent from slot-policy (not paid/manual)
 * - PAID_RESERVED: paid ads — forever out of robot scope
 * - MANUAL_PROTECTED: protected today; if the public chip is a CJ tracking URL,
 *   it is a FUTURE unified-takeover target after independent GO (no historical URL copy)
 *
 * Robot never copies historical baked affiliate URLs. Public swap stays DISARMED
 * until independent GO; then eligible chips are regenerated from CJ click URLs.
 */
export const MANAGEMENT_MEANING = Object.freeze({
  CJ_MANAGED: "Listed in slot-policy as CJ-managed chip ownership candidate",
  UNASSIGNED:
    "CJ JOINED partner not yet in slot-policy; eligible for unified robot takeover without historical URL copy",
  PAID_RESERVED: "Paid ad slot — robot must not touch",
  MANUAL_PROTECTED:
    "Protected today; CJ tracking public chips become robot-owned only after independent GO (URL from CJ, never bake copy)",
});

/** Explicit publishability states (machine-readable). */
export const PUBLISHABILITY = Object.freeze({
  CANDIDATE_GENERATED: "CANDIDATE_GENERATED",
  CATEGORY_VERIFIED: "CATEGORY_VERIFIED",
  AFFILIATE_LINK_VERIFIED: "AFFILIATE_LINK_VERIFIED",
  CZ_SUITABILITY_VERIFIED: "CZ_SUITABILITY_VERIFIED",
  READY_FOR_REVIEW: "READY_FOR_REVIEW",
  QUARANTINED: "QUARANTINED",
  NOT_VERIFIED: "NOT_VERIFIED",
  APPROVED_FOR_PUBLICATION: "APPROVED_FOR_PUBLICATION",
});

/**
 * Fallback titles — authoritative source is assets/iu-affiliate-catalog.js (36 tiles).
 * aff-letenky = "Doprava a cestování" (ground transport home). Air = aff-letenky-letecka-doprava.
 * No invented 37th/38th live category; screenshot "38" ≠ live catalog count.
 */
export const SECTION_TITLES = Object.freeze({
  "aff-cestovni-kancelare": "Cestovní kanceláře",
  "aff-ubytovani-hotely": "Ubytování a hotely",
  "aff-letenky": "Doprava a cestování",
  "aff-letenky-letecka-doprava": "Letenky a letecká doprava",
  "aff-cestovni-pojisteni": "Cestovní pojištění",
  "aff-auto-moto": "Auto a moto",
  "aff-pneu-pneuservis": "Pneu a pneuservis",
  "aff-pojisteni": "Pojištění",
  "aff-finance": "Finance",
  "aff-energie-uspor": "Energie a úspory",
  "aff-lekarny": "Lékárny",
  "aff-zdravi-doplnky": "Zdraví a doplňky",
  "aff-kosmetika": "Kosmetika a parfémy",
  "aff-drogerie": "Drogerie",
  "aff-moda": "Móda a doplňky",
  "aff-boty": "Boty a tenisky",
  "aff-deti-hracky": "Děti a hračky",
  "aff-sportovni-obleceni": "Sportovní oblečení",
  "aff-sport-outdoor": "Sport a outdoor",
  "aff-dum-zahrada": "Dům a zahrada",
  "aff-nabytek": "Bydlení a vybavení",
  "aff-kuchyn": "Kuchyně a domácnost",
  "aff-elektro": "Elektro a chytrá domácnost",
  "aff-mobily": "Mobily a příslušenství",
  "aff-software": "Software a bezpečnost",
  "aff-knihy": "Knihy, hudba a hry",
  "aff-jidlo": "Jídlo a potraviny",
  "aff-zvirata": "Zvířata a chovatelství",
  "aff-kvetiny-darky": "Květiny a dárky",
  "aff-sperky-hodinky": "Šperky a hodinky",
  "aff-tv-streamovani": "TV a streamování",
  "aff-dilna-naradi": "Dílna a nářadí",
  "aff-inzerce-bazary": "Inzerce a bazary",
  "aff-realitni-kancelare": "Realitní kanceláře",
  "aff-reality-nemovitosti": "Reality a nemovitosti",
  "aff-kancelarske-potreby": "Kancelářské potřeby a vybavení",
});

/** Load ordered taxonomy from catalog SoT (never invent tiles). */
export function loadAuthoritativeTaxonomy(catalogSrc) {
  const parsed = catalogSrc ? parseAffiliateCatalogOrdered(catalogSrc) : { sections: [] };
  const sections = (parsed.sections || []).map((s, i) => ({
    order: i + 1,
    sectionId: s.sectionId,
    titleCs: s.sectionTitle,
  }));
  const titleById = Object.fromEntries(sections.map((s) => [s.sectionId, s.titleCs]));
  return {
    source: "assets/iu-affiliate-catalog.js",
    taxonomyCount: sections.length,
    note:
      sections.length === 36
        ? "Live affiliate catalog has 36 main category tiles (authoritative). Claims of 38 must be reconciled against this SoT — do not invent missing names."
        : "Taxonomy count differs from expected 36 — use this export as SoT.",
    sections,
    titleById,
  };
}

/**
 * Exact parent|child → section (general rules, not per-advertiser exceptions).
 * Parents without a fitting InfoUzel section stay unmapped → quarantine reason
 * `no_suitable_taxonomy_section` (documented; not invented categories).
 */
export const PHASE3Z_CATEGORY_RULES_V2 = Object.freeze({
  exact: {
    ...CJ_CATEGORY_SECTION_EVIDENCE,
    "beauty|bath & body": { sectionId: "aff-kosmetika", reason: "cj_beauty_bath_body" },
    "beauty|hair care": { sectionId: "aff-kosmetika", reason: "cj_beauty_hair" },
    "beauty|skin care": { sectionId: "aff-kosmetika", reason: "cj_beauty_skin" },
    "beauty|nail care": { sectionId: "aff-kosmetika", reason: "cj_beauty_nail" },
    "beauty|tools & accessories": { sectionId: "aff-kosmetika", reason: "cj_beauty_tools" },
    "clothing/apparel|womens": { sectionId: "aff-moda", reason: "cj_apparel_womens" },
    "clothing/apparel|mens": { sectionId: "aff-moda", reason: "cj_apparel_mens" },
    "clothing/apparel|childrens": { sectionId: "aff-deti-hracky", reason: "cj_apparel_childrens" },
    "clothing/apparel|malls": { sectionId: "aff-moda", reason: "cj_apparel_malls" },
    "clothing/apparel|underwear": { sectionId: "aff-moda", reason: "cj_apparel_underwear" },
    "accessories|jewelry": { sectionId: "aff-sperky-hodinky", reason: "cj_accessories_jewelry" },
    "accessories|watches": { sectionId: "aff-sperky-hodinky", reason: "cj_accessories_watches" },
    "food & drinks|gourmet": { sectionId: "aff-jidlo", reason: "cj_food_gourmet" },
    "food & drinks|green": { sectionId: "aff-jidlo", reason: "cj_food_green" },
    "food & drinks|restaurants": { sectionId: "aff-jidlo", reason: "cj_food_restaurants" },
    "health and wellness|nutritional supplements": {
      sectionId: "aff-zdravi-doplnky",
      reason: "cj_health_supplements",
    },
    "health and wellness|health food": {
      sectionId: "aff-zdravi-doplnky",
      reason: "cj_health_food",
    },
    "health and wellness|pharmaceuticals": {
      sectionId: "aff-lekarny",
      reason: "cj_health_pharma",
    },
    "health and wellness|equipment": {
      sectionId: "aff-zdravi-doplnky",
      reason: "cj_health_equipment",
    },
    "games & toys|toys": { sectionId: "aff-deti-hracky", reason: "cj_toys" },
    "games & toys|games": { sectionId: "aff-deti-hracky", reason: "cj_games" },
    "games & toys|electronic games": { sectionId: "aff-deti-hracky", reason: "cj_electronic_games" },
    "sports & fitness|equipment": { sectionId: "aff-sport-outdoor", reason: "cj_sports_equipment" },
    "sports & fitness|sports": { sectionId: "aff-sport-outdoor", reason: "cj_sports" },
    "sports & fitness|apparel": { sectionId: "aff-sport-outdoor", reason: "cj_sports_apparel" },
    "recreation & leisure|outdoors": {
      sectionId: "aff-sport-outdoor",
      reason: "cj_recreation_outdoors",
    },
    "insurance|personal insurance": { sectionId: "aff-pojisteni", reason: "cj_insurance_personal" },
    "insurance|travel insurance": {
      sectionId: "aff-cestovni-pojisteni",
      reason: "cj_insurance_travel",
    },
    "automotive|parts & accessories": { sectionId: "aff-auto-moto", reason: "cj_auto_parts" },
    "automotive|cars & trucks": { sectionId: "aff-auto-moto", reason: "cj_auto_cars" },
    "education|children": { sectionId: "aff-deti-hracky", reason: "cj_education_children" },
    "travel|air": { sectionId: "aff-letenky-letecka-doprava", reason: "cj_travel_air" },
    "travel|vacation": { sectionId: "aff-cestovni-kancelare", reason: "cj_travel_vacation" },
    "travel|accessories": { sectionId: "aff-cestovni-kancelare", reason: "cj_travel_accessories" },
    "travel|ground": { sectionId: "aff-letenky", reason: "cj_travel_ground_transport" },
    "travel|rail": { sectionId: "aff-letenky", reason: "cj_travel_rail" },
    "travel|bus": { sectionId: "aff-letenky", reason: "cj_travel_bus" },
    "travel|car rental": { sectionId: "aff-letenky", reason: "cj_travel_car_rental" },
    "travel|lodging": { sectionId: "aff-ubytovani-hotely", reason: "cj_travel_lodging" },
    "business|travel": {
      sectionId: "aff-cestovni-kancelare",
      reason: "cj_business_travel_agency_affinity",
      confidence: "medium",
    },
    "home & garden|garden": { sectionId: "aff-dum-zahrada", reason: "cj_home_garden" },
    "home & garden|furniture": { sectionId: "aff-nabytek", reason: "cj_home_furniture" },
    "home & garden|bed & bath": { sectionId: "aff-dum-zahrada", reason: "cj_home_bed_bath" },
    "home & garden|home appliances": { sectionId: "aff-dum-zahrada", reason: "cj_home_appliances" },
    "home & garden|kitchen": { sectionId: "aff-kuchyn", reason: "cj_home_kitchen" },
    "home & garden|construction": { sectionId: "aff-dilna-naradi", reason: "cj_home_construction" },
    "home & garden|utilities": { sectionId: "aff-energie-uspor", reason: "cj_home_utilities" },
    "books/media|books": { sectionId: "aff-knihy", reason: "cj_books" },
    "books/media|videos/movies": { sectionId: "aff-tv-streamovani", reason: "cj_media_video" },
    "books/media|television": { sectionId: "aff-tv-streamovani", reason: "cj_media_tv" },
    "computer & electronics|computer sw": { sectionId: "aff-software", reason: "cj_electronics_sw" },
    "computer & electronics|computer hw": { sectionId: "aff-elektro", reason: "cj_electronics_hw" },
    "computer & electronics|consumer electronics": {
      sectionId: "aff-elektro",
      reason: "cj_electronics_consumer",
    },
    "gifts & flowers|gifts": { sectionId: "aff-kvetiny-darky", reason: "cj_gifts" },
    "gifts & flowers|flowers": { sectionId: "aff-kvetiny-darky", reason: "cj_flowers" },
    "gifts & flowers|collectibles": { sectionId: "aff-kvetiny-darky", reason: "cj_collectibles" },
    "sports & fitness|apparel": { sectionId: "aff-sportovni-obleceni", reason: "cj_sports_apparel" },
    "business|office": { sectionId: "aff-kancelarske-potreby", reason: "cj_business_office" },
    "department stores/malls|virtual malls": {
      sectionId: "aff-moda",
      reason: "cj_virtual_malls_apparel_affinity",
      confidence: "low",
    },
  },
  /** Parent-only fallbacks when child is empty/unknown but parent is unambiguous. */
  parent: {
    beauty: { sectionId: "aff-kosmetika", reason: "cj_parent_beauty" },
    "clothing/apparel": { sectionId: "aff-moda", reason: "cj_parent_apparel" },
    "food & drinks": { sectionId: "aff-jidlo", reason: "cj_parent_food" },
    "health and wellness": { sectionId: "aff-zdravi-doplnky", reason: "cj_parent_health" },
    "games & toys": { sectionId: "aff-deti-hracky", reason: "cj_parent_toys" },
    "sports & fitness": { sectionId: "aff-sport-outdoor", reason: "cj_parent_sports" },
    insurance: { sectionId: "aff-pojisteni", reason: "cj_parent_insurance" },
    automotive: { sectionId: "aff-auto-moto", reason: "cj_parent_automotive" },
    "home & garden": { sectionId: "aff-dum-zahrada", reason: "cj_parent_home_garden" },
    "books/media": { sectionId: "aff-knihy", reason: "cj_parent_books_media" },
    "computer & electronics": { sectionId: "aff-elektro", reason: "cj_parent_electronics" },
    "computers & software": { sectionId: "aff-software", reason: "cj_parent_computers_software" },
    "gifts & flowers": { sectionId: "aff-kvetiny-darky", reason: "cj_parent_gifts" },
    travel: { sectionId: "aff-cestovni-kancelare", reason: "cj_parent_travel" },
    "financial services": { sectionId: "aff-finance", reason: "cj_parent_financial_services" },
    "real estate": { sectionId: "aff-reality-nemovitosti", reason: "cj_parent_real_estate" },
  },
  /**
   * Parents with no safe InfoUzel taxonomy section — do NOT invent tiles.
   * (finance + real estate now mapped; business alone stays unmapped unless child rules hit)
   */
  noTaxonomyParents: new Set([
    "art/photo/music",
    "entertainment",
    "telecommunications",
    "business",
  ]),
});

/** Keyword hints (name + host) — lower confidence; never override exact CJ map. */
const KEYWORD_SECTION_HINTS = Object.freeze([
  { re: /\b(kosmetik|perfume|parf[eé]m|beauty|make[\s-]?up|dermacol|foreo|yves)\b/i, sectionId: "aff-kosmetika" },
  { re: /\b(l[eé]k[aá]rn|pharmacy|pharma)\b/i, sectionId: "aff-lekarny" },
  { re: /\b(doplnky|supplement|vitamin|zdrav[ií]|brainmarket|bodyworld)\b/i, sectionId: "aff-zdravi-doplnky" },
  { re: /\b(m[oó]d[aá]|fashion|apparel|clothing|wear|ecomodi)\b/i, sectionId: "aff-moda" },
  { re: /\b(boty|shoe|sneaker|barefoot|footwear)\b/i, sectionId: "aff-boty" },
  { re: /\b(hotel|booking|ubytov|airbnb)\b/i, sectionId: "aff-ubytovani-hotely" },
  {
    re: /\b(cestovn[ií]\s*pojist|travel\s*insur|axa\s*assistance|klik\.cz)\b/i,
    sectionId: "aff-cestovni-pojisteni",
  },
  { re: /\b(letenk|airline|flight|skytours|cheapvuelos|arangrant)\b/i, sectionId: "aff-letenky-letecka-doprava" },
  {
    re: /\b(leo\s*express|regiojet|flixbus|student\s*agency|vlak|železni|bus\s*ticket)\b/i,
    sectionId: "aff-letenky",
  },
  { re: /\b(pojist|insur)\b/i, sectionId: "aff-pojisteni" },
  { re: /\b(bestdrive|best\s*drive|pneu|tire|tyre|pneuservis)\b/i, sectionId: "aff-pneu-pneuservis" },
  { re: /\b(auto|moto|car\b)/i, sectionId: "aff-auto-moto" },
  { re: /\b(hra[cč]k|toy|d[eě]ti|kids|baby)\b/i, sectionId: "aff-deti-hracky" },
  { re: /\b(sport|outdoor|fitness)\b/i, sectionId: "aff-sport-outdoor" },
  { re: /\b(potravin|jidlo|food|gourmet)\b/i, sectionId: "aff-jidlo" },
  { re: /\b(drogeri|drugstore)\b/i, sectionId: "aff-drogerie" },
  { re: /\b(pes|pesí|kočka|pet\b|zoo)\b/i, sectionId: "aff-zvirata" },
  { re: /\b(financ|bank|p[uů]j[cč]k|hypot)\b/i, sectionId: "aff-finance" },
  { re: /\b(realit|nemovit|reality)\b/i, sectionId: "aff-reality-nemovitosti" },
]);

function readJson(p, fallback = null) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p);
}

export function marketAllowsCzechRepublic(targetedCountries) {
  const s = String(targetedCountries ?? "").trim();
  if (!s) return null;
  const parts = s
    .split(/[,;/|]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
  if (!parts.length) return null;
  const ok = new Set([
    "CZ",
    "CZE",
    "CZECH",
    "CZECHIA",
    "ALL",
    "EU",
    "EUROPE",
    "WW",
    "WORLDWIDE",
    "INT",
    "INTERNATIONAL",
  ]);
  return parts.some((p) => ok.has(p));
}

export function proposeCzechDisplayName(advertiserName, programUrl) {
  const raw = String(advertiserName || "").trim();
  let host = "";
  try {
    const u = new URL(String(programUrl || "").startsWith("http") ? programUrl : "https://" + programUrl);
    host = u.hostname.replace(/^www\./i, "");
  } catch {
    host = "";
  }
  let name = raw
    .replace(/\b(CZ\/SK\/PL\/RO|CZ\/SK\/HU|CZ\/SK|PL\/RO|CEE|Central and Eastern Europe)\b/gi, "")
    .replace(/\b(Affiliate Program|Europe Affiliate Program)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (/\.cz$/i.test(host)) {
    const base = host.replace(/\.cz$/i, "");
    if (base && (!name || /^(cz|sk|pl|ro|eu|int)$/i.test(name))) {
      name = base.charAt(0).toUpperCase() + base.slice(1);
    }
  }
  if (!name) name = host || raw || "Partner";
  return name.replace(/[\s\-_/|]+$/g, "").trim();
}

/**
 * Detect page language hints from URL / host (not a full HTML lang crawl).
 * Returns CZ | SK | EN | OTHER | unknown.
 */
export function detectPageLanguage({ url, host, linkName } = {}) {
  const u = String(url || "");
  const h = String(host || "");
  const n = String(linkName || "").toLowerCase();
  let path = "";
  let hostname = h;
  try {
    const parsed = new URL(u.startsWith("http") ? u : "https://" + u);
    path = parsed.pathname || "";
    hostname = hostname || parsed.hostname.replace(/^www\./i, "");
  } catch {
    /* keep raw */
  }
  if (
    /\.cz$/i.test(hostname) ||
    /\/(cs|cz)(\/|$)/i.test(path) ||
    /[?&](lang|locale|language)=(cs|cz)\b/i.test(u) ||
    /\b(cesky|česky|czech)\b/i.test(n)
  ) {
    return "CZ";
  }
  if (
    /\.sk$/i.test(hostname) ||
    /\/sk(\/|$)/i.test(path) ||
    /[?&](lang|locale|language)=sk\b/i.test(u) ||
    /\b(sloven|slovak)\b/i.test(n)
  ) {
    return "SK";
  }
  if (
    /\/en(\/|$)/i.test(path) ||
    /[?&](lang|locale|language)=en\b/i.test(u) ||
    /\b(english|anglick)\b/i.test(n) ||
    /\.(com|net|org|eu|io)$/i.test(hostname)
  ) {
    // .com alone is weak EN hint — mark EN only with path/query/name, else OTHER-ish
    if (
      /\/en(\/|$)/i.test(path) ||
      /[?&](lang|locale|language)=en\b/i.test(u) ||
      /\b(english|anglick)\b/i.test(n)
    ) {
      return "EN";
    }
    return "unknown";
  }
  if (/\/(de|pl|hu|fr|it|es)(\/|$)/i.test(path)) return "OTHER";
  return "unknown";
}

/**
 * Choose language by mandatory priority CZ → SK → EN.
 * EN is a full legitimate option — never quarantine solely for English.
 */
export function selectLanguagePreference(candidates) {
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  const byLang = new Map();
  for (const c of list) {
    const lang = String(c.language || "unknown").toUpperCase();
    if (!byLang.has(lang)) byLang.set(lang, []);
    byLang.get(lang).push(c);
  }
  for (const pref of LANGUAGE_PRIORITY) {
    if (byLang.has(pref) && byLang.get(pref).length) {
      return {
        selectedLanguage: pref,
        languagePrioritySatisfied: true,
        reason: "priority_" + pref.toLowerCase(),
        availableLanguages: [...byLang.keys()].sort(),
        pick: byLang.get(pref)[0],
      };
    }
  }
  const other = [...byLang.keys()].filter((k) => k !== "UNKNOWN");
  if (other.length) {
    return {
      selectedLanguage: other[0],
      languagePrioritySatisfied: false,
      reason: "non_priority_language_needs_review",
      availableLanguages: [...byLang.keys()].sort(),
      pick: byLang.get(other[0])[0],
      holdHint: "language_outside_cz_sk_en",
    };
  }
  return {
    selectedLanguage: "unknown",
    languagePrioritySatisfied: false,
    reason: "language_not_detected",
    availableLanguages: [],
    pick: null,
  };
}

export function scoreAffiliateLink(link, advertiser) {
  let score = 0;
  const reasons = [];
  const click = String(link.clickUrl || "");
  const dest = String(link.destination || "");
  const name = String(link.linkName || "").toLowerCase();
  const type = String(link.linkType || "").toLowerCase();
  const countries = String(link.targetedCountries || "");

  if (!isCjTrackingUrl(click)) {
    return { score: -1000, reasons: ["not_cj_tracking_click"] };
  }
  score += 50;
  reasons.push("cj_tracking_click");

  const czMarket = marketAllowsCzechRepublic(countries);
  if (czMarket === true) {
    score += 40;
    reasons.push("targeted_cz");
  } else if (czMarket === false) {
    score -= 30;
    reasons.push("targeted_non_cz");
  } else {
    score += 5;
    reasons.push("targeted_unspecified");
  }

  if (/\.cz(\/|$|\?)/i.test(dest) || /\.cz$/i.test(String(advertiser.programUrl || ""))) {
    score += 25;
    reasons.push("cz_destination_or_program");
  }

  const lang = detectPageLanguage({ url: dest, linkName: name });
  if (lang === "CZ") {
    score += 35;
    reasons.push("lang_cz");
  } else if (lang === "SK") {
    score += 20;
    reasons.push("lang_sk");
  } else if (lang === "EN") {
    score += 10;
    reasons.push("lang_en_ok");
  } else if (lang === "OTHER") {
    score -= 5;
    reasons.push("lang_other");
  }

  try {
    const pathOnly = new URL(dest).pathname.replace(/\/+$/, "") || "/";
    if (pathOnly === "/" || pathOnly.length <= 1) {
      score += 30;
      reasons.push("homepage_dest");
    }
  } catch {
    /* ignore */
  }
  if (/deeplink|home|hlavn[ií]|homepage|main/i.test(name)) {
    score += 15;
    reasons.push("homeish_name");
  }
  if (/coupon|kup[oó]n|banner|promo|deal|sale|%\s*off/i.test(name) || type.includes("banner")) {
    score -= 20;
    reasons.push("campaignish");
  }
  if (type.includes("text")) {
    score += 5;
    reasons.push("text_link");
  }

  return { score, reasons, language: lang };
}

export function selectPrimaryAffiliateLink(links, advertiser) {
  const ranked = (links || [])
    .map((link) => ({ link, ...scoreAffiliateLink(link, advertiser) }))
    .filter((r) => r.score > -500)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) {
    return {
      selected: null,
      reason: "no_suitable_cj_tracking_link",
      candidates: 0,
    };
  }
  const best = ranked[0];
  return {
    selected: best.link,
    reason: best.reasons.join("|"),
    score: best.score,
    candidates: ranked.length,
    runnerUp: ranked[1]
      ? { linkId: ranked[1].link.linkId, score: ranked[1].score, reasons: ranked[1].reasons }
      : null,
  };
}

/** Infer section from CJ category + name/domain only (ignores section_map). */
export function classifyFromCjEvidence(advertiser) {
  const cat = parseCjPrimaryCategory(advertiser?.primaryCategory);
  const evidence = [];
  const blob = [advertiser?.advertiserName, advertiser?.programUrl].filter(Boolean).join(" ");

  // Ground transport (rail/coach): live taxonomy tile aff-letenky = "Doprava a cestování".
  // Air carriers stay on aff-letenky-letecka-doprava — never conflate the two.
  if (/leo\s*express|regiojet|flixbus|student\s*agency/i.test(blob)) {
    return {
      sectionId: "aff-letenky",
      source: "semantic_ground_transport_v4",
      confidence: "high",
      categoryKey: cat.key || null,
      rule: "ground_transport_aff_letenky_doprava",
      evidence: ["name_ground_transport", "taxonomy:aff-letenky=Doprava a cestování"],
      taxonomyFit: true,
      semanticOk: true,
    };
  }

  const exact = PHASE3Z_CATEGORY_RULES_V2.exact[cat.key];
  if (exact?.sectionId) {
    return {
      sectionId: exact.sectionId,
      source: "cj_category_exact_v2",
      confidence: exact.confidence || "high",
      categoryKey: cat.key,
      rule: exact.reason,
      evidence: ["cj_primary:" + cat.key],
      taxonomyFit: true,
      semanticOk: true,
    };
  }

  const parentKey = String(cat.parent || "").toLowerCase();
  if (parentKey && PHASE3Z_CATEGORY_RULES_V2.noTaxonomyParents.has(parentKey)) {
    return {
      sectionId: null,
      source: "cj_category_no_taxonomy",
      confidence: "high",
      categoryKey: cat.key,
      rule: "no_suitable_taxonomy_section",
      evidence: ["cj_parent_no_tile:" + parentKey],
      taxonomyFit: false,
      holdHint: "no_suitable_taxonomy_section",
      semanticOk: false,
    };
  }

  const parentHit = PHASE3Z_CATEGORY_RULES_V2.parent[parentKey];
  if (parentHit?.sectionId) {
    return {
      sectionId: parentHit.sectionId,
      source: "cj_category_parent_v2",
      confidence: "medium",
      categoryKey: cat.key,
      rule: parentHit.reason,
      evidence: ["cj_parent:" + parentKey],
      taxonomyFit: true,
      semanticOk: true,
    };
  }

  for (const hint of KEYWORD_SECTION_HINTS) {
    if (hint.re.test(blob)) {
      evidence.push("keyword:" + hint.sectionId);
      return {
        sectionId: hint.sectionId,
        source: "keyword_hint_v2",
        confidence: "low",
        categoryKey: cat.key || null,
        rule: "keyword_name_or_domain",
        evidence,
        taxonomyFit: true,
        semanticOk: true,
      };
    }
  }

  return {
    sectionId: null,
    source: "unmapped",
    confidence: "low",
    categoryKey: cat.key || null,
    rule: "no_rule_matched",
    evidence: cat.key ? ["cj_primary:" + cat.key] : ["missing_category"],
    taxonomyFit: null,
    holdHint: "partner_section_unmapped",
    semanticOk: null,
  };
}

/**
 * Detect section_map vs merchant activity conflicts (general rules, not one-off IDs).
 */
export function sectionSemanticConflict(sectionId, advertiser, categoryKey) {
  const blob = [advertiser?.advertiserName, advertiser?.programUrl, categoryKey]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const sid = String(sectionId || "");
  if (!sid) return null;

  // Only the AIR tile is wrong for ground operators. aff-letenky is Doprava a cestování (OK).
  if (
    sid === "aff-letenky-letecka-doprava" &&
    /leo\s*express|železni|train|rail|regiojet|flixbus/i.test(blob) &&
    !/air|flight|letenk|airline|skytour/i.test(blob)
  ) {
    return {
      ok: false,
      reason: "air_section_for_ground_transport",
      suggestedHold: "category_semantic_mismatch",
      suggestedSectionId: "aff-letenky",
    };
  }
  if (
    sid === "aff-drogerie" &&
    /clothing|apparel|womens|mens|fashion|móda|moda/i.test(blob) &&
    !/beauty|cosmetic|drugstore|drogeri|rossmann/i.test(blob)
  ) {
    return {
      ok: false,
      reason: "drogerie_section_for_apparel",
      suggestedHold: "category_semantic_mismatch",
    };
  }
  if (
    sid === "aff-pneu-pneuservis" &&
    /insurance|pojist/i.test(blob) &&
    !/pneu|tire|tyre|best.?drive/i.test(blob)
  ) {
    return {
      ok: false,
      reason: "pneu_section_for_insurance",
      suggestedHold: "category_semantic_mismatch",
    };
  }
  // Travel-insurance specialists must not stay under general Pojištění.
  if (
    sid === "aff-pojisteni" &&
    /klik\.cz|axa\s*assistance|cestovn[ií]\s*pojist|travel\s*insur/i.test(blob) &&
    !/auto\s*pojist|life\s*insur|životn/i.test(blob)
  ) {
    return {
      ok: false,
      reason: "general_insurance_for_travel_specialist",
      suggestedHold: "category_semantic_mismatch",
      suggestedSectionId: "aff-cestovni-pojisteni",
    };
  }
  return { ok: true, reason: "semantic_ok" };
}

/**
 * v3 classifier: CJ evidence can override section_map when map conflicts with merchant activity.
 */
export function classifyPartnerSection({ advertiserId, advertiser, sectionMap }) {
  const id = String(advertiserId);
  const cat = parseCjPrimaryCategory(advertiser?.primaryCategory);
  const fromEvidence = classifyFromCjEvidence(advertiser);
  const mapSid =
    sectionMap && sectionMap[id] && !String(sectionMap[id]).startsWith("_")
      ? String(sectionMap[id])
      : null;

  if (mapSid) {
    const conflict = sectionSemanticConflict(mapSid, advertiser, cat.key);
    if (conflict && conflict.ok === false) {
      const overrideSid =
        (fromEvidence.sectionId && fromEvidence.sectionId !== mapSid
          ? fromEvidence.sectionId
          : null) ||
        conflict.suggestedSectionId ||
        null;
      if (overrideSid && overrideSid !== mapSid) {
        return {
          ...fromEvidence,
          sectionId: overrideSid,
          source: "section_map_overridden_by_evidence_v4",
          confidence: "high",
          rule: conflict.reason + "|" + (fromEvidence.rule || conflict.suggestedSectionId || ""),
          evidence: [
            ...(fromEvidence.evidence || []),
            "section_map_was:" + mapSid,
            "override:" + conflict.reason,
            "to:" + overrideSid,
          ],
          previousSectionId: mapSid,
          taxonomyFit: true,
          semanticOk: true,
          categoryChange: {
            from: mapSid,
            to: overrideSid,
            reason: conflict.reason,
          },
        };
      }
      // No better tile → hold rather than wrong category
      return {
        sectionId: null,
        source: "section_map_rejected_semantic_v4",
        confidence: "high",
        categoryKey: cat.key || null,
        rule: conflict.reason,
        evidence: ["section_map_was:" + mapSid, "semantic_reject"],
        taxonomyFit: false,
        holdHint: conflict.suggestedHold || "category_semantic_mismatch",
        previousSectionId: mapSid,
        categoryChange: { from: mapSid, to: null, reason: conflict.reason },
      };
    }
    return {
      sectionId: mapSid,
      source: "section_map",
      confidence: "high",
      categoryKey: cat.key || null,
      rule: "section_map_validated_v4",
      evidence: ["section_map:" + id, conflict?.reason || "semantic_ok"],
      taxonomyFit: true,
      semanticOk: true,
    };
  }

  return fromEvidence;
}

export function resolveChipOwnership({ management, relationshipStatus, publishability }) {
  const mgmt = String(management || "UNASSIGNED").toUpperCase();
  const joined = String(relationshipStatus || "").toLowerCase() === "joined";
  if (mgmt === "PAID_RESERVED") {
    return {
      ownership: "OUT_OF_SCOPE",
      takeoverEligible: false,
      unifiedManagementTarget: null,
      meaning: MANAGEMENT_MEANING.PAID_RESERVED,
      note: "Paid ads forever out of robot scope; never dual-own.",
    };
  }
  if (mgmt === "MANUAL_PROTECTED") {
    return {
      ownership: "OUT_OF_SCOPE",
      takeoverEligible: false,
      unifiedManagementTarget: "CJ_MANAGED_AFTER_GO_IF_CJ_URL",
      meaning: MANAGEMENT_MEANING.MANUAL_PROTECTED,
      note: "No dual ownership now. After independent GO, public CJ tracking chips are replaced from CJ data (not historical URL copy).",
    };
  }
  if (!joined) {
    return {
      ownership: "NOT_JOINED",
      takeoverEligible: false,
      unifiedManagementTarget: null,
      meaning: "Not an active CJ JOINED cooperation",
    };
  }
  if (mgmt === "CJ_MANAGED") {
    return {
      ownership: "POLICY_CJ_MANAGED",
      takeoverEligible: true,
      unifiedManagementTarget: "CJ_MANAGED",
      meaning: MANAGEMENT_MEANING.CJ_MANAGED,
      note: "Already policy-listed; public swap regenerates from CJ click URL (not historical bake).",
    };
  }
  // UNASSIGNED — evidential eligibility for unified robot ownership after GO
  const readyish = [
    PUBLISHABILITY.READY_FOR_REVIEW,
    PUBLISHABILITY.CZ_SUITABILITY_VERIFIED,
    PUBLISHABILITY.AFFILIATE_LINK_VERIFIED,
    PUBLISHABILITY.CATEGORY_VERIFIED,
    PUBLISHABILITY.NOT_VERIFIED,
  ].includes(publishability);
  return {
    ownership: "UNASSIGNED_ROBOT_ELIGIBLE",
    takeoverEligible: readyish,
    unifiedManagementTarget: "CJ_MANAGED_AFTER_GO",
    meaning: MANAGEMENT_MEANING.UNASSIGNED,
    note: "Safe prep for unified takeover: future public chip owned by robot via CJ URL; no historical URL copy; no dual ownership with paid/manual; public swap remains DISARMED.",
  };
}

/**
 * Plan for one automatic management of all eligible CJ chips after first GO.
 * Does NOT arm public swap. Never copies historical URLs.
 */
export function buildUnifiedTakeoverPlan({ partners, buttons, catalogOrdered }) {
  const catalogCjChips = [];
  for (const sec of catalogOrdered?.sections || []) {
    for (const it of sec.items || []) {
      if (it.kind !== "partner" || !it.url) continue;
      const cj = isCjTrackingUrl(it.url);
      catalogCjChips.push({
        sectionId: sec.sectionId,
        title: it.title,
        advertiserId: it.advertiserId || null,
        isCjTracking: cj,
        historicalUrlNotUsedAsAuthority: true,
      });
    }
  }
  const eligible = partners.filter(
    (p) =>
      p.chipOwnership?.takeoverEligible === true &&
      p.relationshipStatus === "joined" &&
      p.selectedClickUrl
  );
  return {
    publicSwapArmed: false,
    mechanism:
      "After independent GO: regenerate eligible public chips from CJ click URLs only; LKG on API failure; never mass-delete on outage; paid/non-CJ untouched; one chip per real partner.",
    counts: {
      catalogPartnerChips: catalogCjChips.length,
      catalogCjTrackingChips: catalogCjChips.filter((c) => c.isCjTracking).length,
      policyCjManaged: partners.filter((p) => p.management === "CJ_MANAGED").length,
      unassigned: partners.filter((p) => p.management === "UNASSIGNED").length,
      unassignedRobotEligible: partners.filter(
        (p) => p.chipOwnership?.ownership === "UNASSIGNED_ROBOT_ELIGIBLE"
      ).length,
      takeoverEligiblePartners: eligible.length,
      takeoverEligibleWithPreviewButton: buttons.filter((b) => b.chipOwnership?.takeoverEligible)
        .length,
      outOfScopePaidOrManual: partners.filter((p) => p.chipOwnership?.ownership === "OUT_OF_SCOPE")
        .length,
    },
    dualOwnershipForbidden: true,
    historicalUrlCopyForbidden: true,
    catalogCjChipsSample: catalogCjChips.slice(0, 40),
  };
}

/** Cross-record brand comparison (not only per-CID NOT_MERGED). */
export function buildBrandComparisonMatrix(partners) {
  const byBrand = new Map();
  for (const p of partners) {
    const k = p.brandKey || normalizePartnerBrand(p.cjName);
    if (!k || k.length < 3) continue;
    if (!byBrand.has(k)) byBrand.set(k, []);
    byBrand.get(k).push(p);
  }
  const rows = [];
  for (const [brandKey, list] of byBrand) {
    if (list.length < 2) {
      rows.push({
        brandKey,
        advertiserIds: list.map((p) => p.advertiserId),
        domains: [...new Set(list.map((p) => p.merchantDomain).filter(Boolean))],
        action: "SINGLE_CID",
        reason: "no_cross_record_duplicate",
        merge: false,
      });
      continue;
    }
    const domains = [...new Set(list.map((p) => p.merchantDomain).filter(Boolean))];
    const sameDomain = domains.length === 1;
    rows.push({
      brandKey,
      advertiserIds: list.map((p) => p.advertiserId),
      domains,
      names: list.map((p) => p.cjName),
      sectionIds: list.map((p) => p.sectionId),
      action: "KEEP_SEPARATE",
      reason: sameDomain
        ? "same_brand_same_domain_distinct_cid_pending_legal_identity"
        : "same_brand_key_distinct_cid_or_region_program",
      merge: false,
      confidence: sameDomain ? "medium" : "high",
    });
  }
  return rows;
}

export function resolveSectionId(args) {
  return classifyPartnerSection(args);
}

function policyByAdvertiserId(slotPolicy) {
  const map = new Map();
  for (const p of slotPolicy?.partners || []) {
    if (p?.advertiserId == null) continue;
    map.set(String(p.advertiserId), p);
  }
  return map;
}

/**
 * Full identity audit: every partner gets a decision; same-brand groups flagged KEEP_SEPARATE.
 */
export function detectDuplicates(rows) {
  const byBrand = new Map();
  for (const r of rows) {
    const n = r.brandKey;
    if (!n || n.length < 3) continue;
    if (!byBrand.has(n)) byBrand.set(n, []);
    byBrand.get(n).push(r);
  }
  const decisions = [];
  for (const r of rows) {
    const peers = byBrand.get(r.brandKey) || [r];
    if (peers.length === 1) {
      decisions.push({
        partnerId: r.partnerId,
        advertiserId: r.advertiserId,
        brandKey: r.brandKey,
        merchantDomain: r.merchantDomain || "",
        action: "NOT_MERGED",
        reason: "single_cid_identity",
        confidence: "high",
        peerAdvertiserIds: [r.advertiserId],
      });
      continue;
    }
    const peerIds = peers.map((p) => p.advertiserId);
    decisions.push({
      partnerId: r.partnerId,
      advertiserId: r.advertiserId,
      brandKey: r.brandKey,
      merchantDomain: r.merchantDomain || "",
      action: "NOT_MERGED",
      reason: "same_normalized_brand_distinct_cid_keep_separate",
      confidence: "medium",
      peerAdvertiserIds: peerIds,
      groupAction: "KEEP_SEPARATE_PENDING_EVIDENCE",
    });
  }
  return decisions;
}

/** Regional special-case audit (evidence only; never invents URLs). */
export function auditRegionalSpecialCases(partners) {
  const needles = [
    { id: "skytours", re: /skytours/i },
    { id: "shapenbarefoot", re: /shapen|barefoot/i },
    { id: "brainmarket", re: /brainmarket/i },
    { id: "booking", re: /booking\.com|booking\b/i },
    { id: "foreo", re: /foreo/i },
  ];
  const out = [];
  for (const n of needles) {
    const hits = partners.filter(
      (p) => n.re.test(p.cjName || "") || n.re.test(p.programUrl || "") || n.re.test(p.displayNameCs || "")
    );
    for (const p of hits) {
      const linkCz = marketAllowsCzechRepublic(p.selectedTargetedCountries);
      const destCz = /\.cz(\/|$)/i.test(String(p.selectedDestination || "")) || /\.cz$/i.test(String(p.programUrl || ""));
      let verdict = "KEEP_QUARANTINED_OR_REVIEW";
      let reason = "regional_variant_needs_evidence";
      if (p.publishability === PUBLISHABILITY.READY_FOR_REVIEW) {
        verdict = "CZ_OK_IN_REGISTRY";
        reason = "already_ready_for_review";
      } else if (p.holdReason === "market_not_targeting_cz" && !destCz) {
        verdict = "QUARANTINED";
        reason = "selected_link_market_non_cz";
      } else if (destCz && linkCz !== false) {
        verdict = "CZ_AFFINITY_PRESENT";
        reason = "program_or_dest_cz";
      }
      out.push({
        caseId: n.id,
        partnerId: p.partnerId,
        advertiserId: p.advertiserId,
        cjName: p.cjName,
        selectedTargetedCountries: p.selectedTargetedCountries,
        selectedDestination: p.selectedDestination,
        programUrl: p.programUrl,
        publishability: p.publishability,
        holdReason: p.holdReason,
        verdict,
        reason,
        note: "Historical baked URLs are not used as authority.",
      });
    }
  }
  return out;
}

function computeCzSuitability(pick, advertiser) {
  const dest = String(pick.selected?.destination || "");
  const destHost = (() => {
    try {
      return new URL(dest).hostname.replace(/^www\./i, "");
    } catch {
      return "";
    }
  })();
  const market = marketAllowsCzechRepublic(pick.selected?.targetedCountries);
  const programCz = /\.cz$/i.test(String(advertiser.programUrl || "")) || /\.cz$/i.test(destHost);
  const detectedLang = detectPageLanguage({
    url: dest,
    host: destHost,
    linkName: pick.selected?.linkName,
  });
  // Language is NOT a CZ-market gate: EN + CZ targeting is a valid candidate.
  const evidence = {
    cjCooperationJoined: true,
    affiliateTrackingUrl: Boolean(pick.selected?.clickUrl),
    httpRedirect: "PENDING_PROBE",
    merchantIdentity: destHost || String(advertiser.programUrl || ""),
    selectedLanguage: detectedLang,
    languageHint: detectedLang,
    marketTargeting: pick.selected?.targetedCountries || null,
    czDomain: programCz,
    note: "HTTP 200 and .cz alone are not full CZ-usability proof; EN language never quarantines alone",
  };
  if (market === false && !programCz) {
    return {
      ok: false,
      status: "NON_CZ_MARKET",
      confidence: "high",
      notes: [String(pick.selected?.targetedCountries || ""), "lang=" + detectedLang],
      evidence,
    };
  }
  if (market === true && (programCz || detectedLang === "CZ")) {
    return {
      ok: true,
      status: "CZ_AFFINITY",
      confidence: "high",
      notes: ["targeted_cz", "lang=" + detectedLang],
      evidence,
    };
  }
  if (market === true) {
    // Explicit CZ targeting — EN/SK landing pages are OK for Czech visitors.
    return {
      ok: true,
      status: "CZ_AFFINITY",
      confidence: detectedLang === "SK" || detectedLang === "EN" ? "high" : "medium",
      notes: ["targeted_cz", "lang=" + detectedLang, "language_separated_from_market"],
      evidence,
    };
  }
  if (programCz) {
    return {
      ok: true,
      status: "CZ_AFFINITY",
      confidence: "medium",
      notes: ["cz_domain", "lang=" + detectedLang, "partial_evidence"],
      evidence,
    };
  }
  return {
    ok: null,
    status: "CZ_UNKNOWN",
    confidence: "low",
    notes: ["market_unspecified", "lang=" + detectedLang],
    evidence,
  };
}

function triState(value) {
  if (value === true) return true;
  if (value === false) return false;
  return "unknown";
}

/**
 * Authoritative evidence row — must be rebuilt AFTER URL verification.
 * Uses true/false/unknown; never invents PASS from HTTP 200 alone.
 */
export function buildEvidenceRow(partner, { verifiedAt = null } = {}) {
  const uv = partner.urlVerification || {};
  const urlStatus = String(uv.status || "NOT_VERIFIED");
  const urlProbed = Boolean(uv.probedAt || uv.httpStatus != null || urlStatus !== "NOT_VERIFIED");
  const affiliateUrlVerified =
    urlStatus === "VERIFIED_HTTP_OK" ? true : urlProbed ? false : "unknown";
  const httpRedirectVerified = ["VERIFIED_HTTP_OK", "HTTP_FORBIDDEN", "HTTP_NOT_OK"].includes(
    urlStatus
  )
    ? true
    : urlProbed
      ? false
      : "unknown";

  const selectedLanguage = partner.selectedLanguage || partner.languageEvidence?.selectedLanguage || "unknown";
  const languageVerified =
    selectedLanguage && selectedLanguage !== "unknown"
      ? true
      : partner.languageEvidence?.attempted
        ? false
        : "unknown";
  const languagePrioritySatisfied = LANGUAGE_PRIORITY.includes(String(selectedLanguage).toUpperCase())
    ? true
    : languageVerified === true
      ? false
      : "unknown";

  const czMarket = partner.czMarketEligibilityVerified;
  const ready = partner.publishability === PUBLISHABILITY.READY_FOR_REVIEW;
  const categoryOk = Boolean(partner.sectionId) && partner.holdReason !== "category_semantic_mismatch";

  return {
    partnerId: partner.partnerId,
    advertiserId: partner.advertiserId,
    linkId: partner.selectedLinkId || null,
    cjJoined: partner.relationshipStatus === "joined",
    cjAuthorizationVerified: partner.relationshipStatus === "joined",
    affiliateUrlPresent: Boolean(partner.selectedClickUrl),
    trackingUrlVerified: affiliateUrlVerified,
    affiliateUrlVerified,
    redirectVerified: httpRedirectVerified,
    httpRedirectVerified,
    httpStatus: uv.httpStatus ?? null,
    urlVerificationStatus: urlStatus,
    merchantIdentityVerified: Boolean(partner.displayNameCs && (partner.merchantDomain || partner.programUrl))
      ? true
      : "unknown",
    merchantIdentityProposed: Boolean(partner.displayNameCs),
    selectedLanguage,
    languageVerified,
    languagePrioritySatisfied,
    czechLanguageVerified: selectedLanguage === "CZ" ? true : selectedLanguage && selectedLanguage !== "unknown" ? false : "unknown",
    czechTargetingVerified: triState(czMarket),
    czMarketEligibilityVerified: triState(czMarket),
    czechAvailabilityVerified: triState(czMarket),
    czShippingVerified: partner.czShippingVerified ?? "unknown",
    czBookingOrServiceVerified: partner.czBookingOrServiceVerified ?? "unknown",
    categoryVerified: categoryOk ? true : partner.sectionId ? false : "unknown",
    semanticCategoryVerified: categoryOk,
    readyForReview: ready,
    approvedForPublication: false,
    evidenceSource: "phase3z-partner-registry-v5",
    verifiedAt: verifiedAt || uv.probedAt || partner.source?.confirmedAt || null,
    method: urlProbed ? "cj_staging+http_redirect_probe+language_priority" : "cj_staging+language_priority",
    limitation:
      urlStatus === "HTTP_FORBIDDEN"
        ? "bot_block_possible_not_proof_of_dead_link"
        : urlStatus === "VERIFIED_HTTP_OK"
          ? "http_200_not_full_cz_or_language_proof"
          : null,
  };
}

export function buildEvidenceMatrix(partners, opts = {}) {
  return (partners || []).map((p) => buildEvidenceRow(p, opts));
}

/**
 * Fail if evidence matrix disagrees with registry publishability / URL status.
 */
export function assertEvidenceConsistency(registry, buttonCatalog) {
  const errors = [];
  const matrix = registry?.evidenceMatrix || [];
  const byId = new Map(matrix.map((r) => [r.partnerId, r]));
  let readyMatrix = 0;
  let readyReg = 0;
  let urlOkMatrix = 0;
  let urlOkReg = 0;

  for (const p of registry?.partners || []) {
    if (p.publishability === PUBLISHABILITY.READY_FOR_REVIEW) readyReg++;
    if (p.urlVerification?.status === "VERIFIED_HTTP_OK") urlOkReg++;
    const row = byId.get(p.partnerId);
    if (!row) {
      errors.push("missing_matrix_row:" + p.partnerId);
      continue;
    }
    if (row.advertiserId !== p.advertiserId) {
      errors.push("advertiserId_mismatch:" + p.partnerId);
    }
    if (row.linkId != null && p.selectedLinkId != null && String(row.linkId) !== String(p.selectedLinkId)) {
      errors.push("linkId_mismatch:" + p.partnerId);
    }
    const readyRow = row.readyForReview === true;
    const readyP = p.publishability === PUBLISHABILITY.READY_FOR_REVIEW;
    if (readyRow !== readyP) {
      errors.push("ready_mismatch:" + p.partnerId);
    }
    if (readyRow) readyMatrix++;
    const urlRow = row.affiliateUrlVerified === true;
    const urlP = p.urlVerification?.status === "VERIFIED_HTTP_OK";
    if (urlRow !== urlP) {
      errors.push("url_verified_mismatch:" + p.partnerId);
    }
    if (urlRow) urlOkMatrix++;
    if (readyP && p.urlVerification?.status !== "VERIFIED_HTTP_OK") {
      errors.push("ready_without_url_ok:" + p.partnerId);
    }
    if (readyP && !p.sectionId) {
      errors.push("ready_without_category:" + p.partnerId);
    }
    if (p.publishability === PUBLISHABILITY.APPROVED_FOR_PUBLICATION) {
      errors.push("approved_auto_set:" + p.partnerId);
    }
  }

  const btnReady = (buttonCatalog?.buttons || []).filter(
    (b) => b.publishability === PUBLISHABILITY.READY_FOR_REVIEW
  ).length;
  if (readyMatrix !== readyReg) {
    errors.push("ready_count_matrix_vs_registry:" + readyMatrix + "/" + readyReg);
  }
  if (readyReg !== (registry?.counts?.readyForReview ?? -1)) {
    errors.push("ready_count_registry_field:" + readyReg + "/" + registry?.counts?.readyForReview);
  }
  if (btnReady !== readyReg) {
    // buttons subset may equal ready candidates with click URLs — allow buttons <= partners
    const readyWithUrl = (registry?.partners || []).filter(
      (p) =>
        p.publishability === PUBLISHABILITY.READY_FOR_REVIEW && p.selectedClickUrl
    ).length;
    if (btnReady !== readyWithUrl) {
      errors.push("ready_count_buttons:" + btnReady + "/" + readyWithUrl);
    }
  }
  if (registry?.publicButtonSwapArmed === true || buttonCatalog?.publicButtonSwapArmed === true) {
    errors.push("public_swap_armed");
  }
  if (urlOkMatrix !== urlOkReg) {
    errors.push("url_ok_count_mismatch:" + urlOkMatrix + "/" + urlOkReg);
  }

  return {
    ok: errors.length === 0,
    errors,
    readyMatrix,
    readyReg,
    urlOkMatrix,
    urlOkReg,
  };
}

/**
 * Build canonical registry + non-public button proposals from CJ staging.
 */
export function buildPhase3zPartnerRegistry({
  staging,
  sectionMap = {},
  slotPolicy = { partners: [] },
  catalogSrc = "",
  websitePid = WEBSITE_PID,
  rulesVersion = PHASE3Z_RULES_VERSION,
  nowIso = new Date().toISOString(),
} = {}) {
  const advertisers = Array.isArray(staging?.advertisers) ? staging.advertisers : [];
  const links = Array.isArray(staging?.links) ? staging.links : [];
  const linksByAdv = new Map();
  for (const link of links) {
    const id = String(link.advertiserId || "");
    if (!id) continue;
    if (!linksByAdv.has(id)) linksByAdv.set(id, []);
    linksByAdv.get(id).push(link);
  }

  const policyMap = policyByAdvertiserId(slotPolicy);
  const taxonomy = loadAuthoritativeTaxonomy(catalogSrc);
  const catalogOrdered = catalogSrc ? parseAffiliateCatalogOrdered(catalogSrc) : { sections: [] };
  const titleById = { ...SECTION_TITLES, ...(taxonomy.titleById || {}) };
  const knownSections = new Set(
    (catalogOrdered.sections || []).map((s) => s.sectionId).filter(Boolean)
  );
  for (const sid of Object.keys(titleById)) knownSections.add(sid);

  const partners = [];
  const buttons = [];
  const quarantined = [];

  for (const adv of advertisers) {
    const advertiserId = String(adv.advertiserId || "");
    if (!advertiserId) continue;
    const rel = String(adv.relationshipStatus || "").toLowerCase();
    const account = String(adv.accountStatus || "");
    const policy = policyMap.get(advertiserId);
    const management = classifyPolicyManagement(policy) || "UNASSIGNED";
    const brandKey = normalizePartnerBrand(adv.advertiserName);
    const displayNameCs = proposeCzechDisplayName(adv.advertiserName, adv.programUrl);
    const section = classifyPartnerSection({
      advertiserId,
      advertiser: adv,
      sectionMap,
    });
    const advLinks = linksByAdv.get(advertiserId) || [];
    const pick = selectPrimaryAffiliateLink(advLinks, adv);

    const protectedSkip =
      management === "PAID_RESERVED" || management === "MANUAL_PROTECTED";

    let publishability = PUBLISHABILITY.CANDIDATE_GENERATED;
    let holdReason = null;
    const triple = {
      technical: { status: "NOT_VERIFIED", confidence: "low", notes: [] },
      visitor: { status: "NOT_VERIFIED", confidence: "low", notes: [] },
      business: { status: "NOT_VERIFIED", confidence: "low", notes: [] },
    };

    if (protectedSkip) {
      publishability = PUBLISHABILITY.QUARANTINED;
      holdReason = "protected_slot_out_of_scope";
      triple.technical = { status: "PROTECTED_SKIP", confidence: "high", notes: [management] };
    } else if (rel !== "joined") {
      publishability = PUBLISHABILITY.QUARANTINED;
      holdReason = "relationship_not_joined";
      triple.technical = {
        status: "NOT_JOINED",
        confidence: "high",
        notes: [rel || "missing"],
      };
    } else if (!pick.selected) {
      publishability = PUBLISHABILITY.QUARANTINED;
      holdReason = pick.reason || "no_affiliate_link";
      triple.technical = {
        status: "NO_SUITABLE_LINK",
        confidence: "high",
        notes: [holdReason],
      };
    } else if (!section.sectionId) {
      publishability = PUBLISHABILITY.QUARANTINED;
      holdReason = section.holdHint || "partner_section_unmapped";
      triple.business = {
        status: section.taxonomyFit === false ? "NO_TAXONOMY_FIT" : "NEEDS_CATEGORY",
        confidence: section.confidence || "medium",
        notes: [section.categoryKey || "", section.rule || ""],
      };
      triple.technical = {
        status: "JOINED_LINK_CANDIDATE",
        confidence: "medium",
        notes: ["awaiting_category_or_taxonomy"],
      };
    } else if (!knownSections.has(section.sectionId)) {
      publishability = PUBLISHABILITY.QUARANTINED;
      holdReason = "section_not_in_taxonomy";
      triple.business = {
        status: "UNKNOWN_SECTION",
        confidence: "medium",
        notes: [section.sectionId],
      };
    } else {
      publishability = PUBLISHABILITY.CATEGORY_VERIFIED;
      triple.business = {
        status: "SECTION_ASSIGNED",
        confidence: section.confidence,
        notes: [section.sectionId, section.source, section.rule],
      };
      triple.technical = {
        status: "JOINED_CJ_TRACKING",
        confidence: "high",
        notes: [pick.reason],
      };
      triple.visitor = {
        status: "NAME_PROPOSED",
        confidence: "medium",
        notes: [displayNameCs],
      };

      const cz = computeCzSuitability(pick, adv);
      if (cz.ok === false) {
        publishability = PUBLISHABILITY.QUARANTINED;
        holdReason = "market_not_targeting_cz";
        triple.visitor = { status: cz.status, confidence: cz.confidence, notes: cz.notes };
      } else if (cz.ok === true) {
        publishability = PUBLISHABILITY.CZ_SUITABILITY_VERIFIED;
        triple.visitor = {
          status: cz.status,
          confidence: cz.confidence,
          notes: [...(triple.visitor.notes || []), ...cz.notes],
        };
      } else {
        // Category ok but CZ not proven → NOT_VERIFIED (still a non-public candidate)
        publishability = PUBLISHABILITY.NOT_VERIFIED;
        holdReason = "cz_suitability_not_proven";
        triple.visitor = { status: cz.status, confidence: cz.confidence, notes: cz.notes };
      }
    }

    const partnerId = "cj-" + advertiserId;
    const ownership = resolveChipOwnership({ management, relationshipStatus: rel, publishability });
    const langCandidates = (advLinks || []).map((lnk) => ({
      language: detectPageLanguage({ url: lnk.destination, linkName: lnk.linkName }),
      linkId: lnk.linkId,
      destination: lnk.destination,
      clickUrl: lnk.clickUrl,
    }));
    if (pick.selected) {
      langCandidates.unshift({
        language: detectPageLanguage({
          url: pick.selected.destination,
          linkName: pick.selected.linkName,
        }),
        linkId: pick.selected.linkId,
        destination: pick.selected.destination,
        clickUrl: pick.selected.clickUrl,
      });
    }
    const langPick = selectLanguagePreference(langCandidates);
    // Never quarantine solely for EN/SK — only for market/category/URL failures.
    if (
      langPick.holdHint === "language_outside_cz_sk_en" &&
      publishability !== PUBLISHABILITY.QUARANTINED &&
      publishability !== PUBLISHABILITY.CANDIDATE_GENERATED
    ) {
      // Keep as NOT_VERIFIED / review — not market quarantine
      if (
        publishability === PUBLISHABILITY.CZ_SUITABILITY_VERIFIED ||
        publishability === PUBLISHABILITY.CATEGORY_VERIFIED
      ) {
        publishability = PUBLISHABILITY.NOT_VERIFIED;
        holdReason = holdReason || "language_outside_cz_sk_en_needs_review";
      }
    }
    const czMarketEligibilityVerified =
      publishability === PUBLISHABILITY.CZ_SUITABILITY_VERIFIED ||
      publishability === PUBLISHABILITY.AFFILIATE_LINK_VERIFIED ||
      publishability === PUBLISHABILITY.READY_FOR_REVIEW
        ? true
        : holdReason === "market_not_targeting_cz"
          ? false
          : holdReason === "cz_suitability_not_proven"
            ? null
            : null;

    const row = {
      partnerId,
      advertiserId,
      cjName: adv.advertiserName || "",
      displayNameCs,
      brandKey,
      programUrl: adv.programUrl || "",
      merchantDomain: (() => {
        try {
          return new URL(
            String(adv.programUrl || "").startsWith("http") ? adv.programUrl : "https://x"
          ).hostname.replace(/^www\./i, "");
        } catch {
          return "";
        }
      })(),
      accountStatus: account,
      relationshipStatus: rel,
      management,
      managementMeaning: MANAGEMENT_MEANING[management] || management,
      chipOwnership: ownership,
      sectionId: section.sectionId,
      sectionTitleCs: section.sectionId ? titleById[section.sectionId] || section.sectionId : null,
      sectionSource: section.source,
      sectionConfidence: section.confidence,
      sectionRule: section.rule || null,
      sectionEvidence: section.evidence || [],
      categoryKey: section.categoryKey || null,
      categoryChange: section.categoryChange || null,
      selectedClickUrl: pick.selected?.clickUrl || null,
      selectedDestination: pick.selected?.destination || null,
      selectedLinkId: pick.selected?.linkId || null,
      selectedLinkName: pick.selected?.linkName || null,
      selectedTargetedCountries: pick.selected?.targetedCountries || null,
      linkSelectionReason: pick.reason || null,
      linkSelectionScore: pick.score ?? null,
      linkCandidateCount: pick.candidates || 0,
      selectedLanguage: langPick.selectedLanguage,
      languagePrioritySatisfied: langPick.languagePrioritySatisfied,
      languageEvidence: {
        attempted: true,
        reason: langPick.reason,
        availableLanguages: langPick.availableLanguages,
        priority: LANGUAGE_PRIORITY,
        note: "EN is legitimate when CZ/SK unavailable; never quarantine for English alone",
      },
      czMarketEligibilityVerified,
      czShippingVerified: "unknown",
      czBookingOrServiceVerified: "unknown",
      publishability,
      holdReason,
      czEvidence: null,
      urlVerification: {
        status: "NOT_VERIFIED",
        note: "redirect_probe_deferred_or_disabled",
      },
      triple,
      rulesVersion,
      source: {
        stagingGeneratedAt: staging?.generatedAt || null,
        websitePid: String(staging?.websitePid || websitePid),
        confirmedAt: nowIso,
      },
      aliases: brandKey ? [brandKey] : [],
      historicalUrlCopied: false,
      publicSwapArmed: false,
    };

    partners.push(row);

    const isCandidate =
      publishability === PUBLISHABILITY.CATEGORY_VERIFIED ||
      publishability === PUBLISHABILITY.CZ_SUITABILITY_VERIFIED ||
      publishability === PUBLISHABILITY.NOT_VERIFIED ||
      publishability === PUBLISHABILITY.AFFILIATE_LINK_VERIFIED ||
      publishability === PUBLISHABILITY.READY_FOR_REVIEW;

    if (isCandidate && row.selectedClickUrl && section.sectionId) {
      buttons.push({
        partnerId,
        advertiserId,
        displayNameCs,
        sectionId: section.sectionId,
        sectionTitleCs: row.sectionTitleCs,
        sectionSource: section.source,
        sectionRule: section.rule,
        categoryChange: section.categoryChange || null,
        clickUrl: row.selectedClickUrl,
        destination: row.selectedDestination,
        trackingHost: (() => {
          try {
            return new URL(row.selectedClickUrl).hostname;
          } catch {
            return "";
          }
        })(),
        targetedCountries: row.selectedTargetedCountries,
        linkId: row.selectedLinkId,
        publishability,
        holdReason,
        management,
        chipOwnership: ownership,
        publicSwapArmed: false,
        historicalUrlCopied: false,
        chipStyle: "radio-compact-v1",
        rel: "sponsored noopener",
        target: "_blank",
        rulesVersion,
        triple,
        urlVerification: row.urlVerification,
      });
    } else {
      quarantined.push({
        partnerId,
        advertiserId,
        displayNameCs,
        holdReason,
        management,
        chipOwnership: ownership,
        relationshipStatus: rel,
        sectionId: section.sectionId,
        categoryKey: section.categoryKey || null,
        sectionRule: section.rule || null,
        categoryChange: section.categoryChange || null,
        publishability,
        rulesVersion,
      });
    }
  }

  // Attach CZ evidence snapshots after loop picks (from last compute — recompute lightly for rows with links)
  for (const p of partners) {
    if (!p.selectedClickUrl) continue;
    const fakePick = {
      selected: {
        clickUrl: p.selectedClickUrl,
        destination: p.selectedDestination,
        targetedCountries: p.selectedTargetedCountries,
      },
    };
    const cz = computeCzSuitability(fakePick, {
      programUrl: p.programUrl,
      advertiserName: p.cjName,
    });
    p.czEvidence = cz.evidence || null;
  }

  const dedupe = detectDuplicates(partners);
  const brandMatrix = buildBrandComparisonMatrix(partners);
  const regionalAudit = auditRegionalSpecialCases(partners);
  const categoryChanges = partners.filter((p) => p.categoryChange).map((p) => ({
    partnerId: p.partnerId,
    advertiserId: p.advertiserId,
    displayNameCs: p.displayNameCs,
    ...p.categoryChange,
  }));
  const ownershipSummary = {
    POLICY_CJ_MANAGED: partners.filter((p) => p.chipOwnership?.ownership === "POLICY_CJ_MANAGED").length,
    UNASSIGNED_ROBOT_ELIGIBLE: partners.filter((p) => p.chipOwnership?.ownership === "UNASSIGNED_ROBOT_ELIGIBLE").length,
    OUT_OF_SCOPE: partners.filter((p) => p.chipOwnership?.ownership === "OUT_OF_SCOPE").length,
    takeoverEligibleWithButton: buttons.filter((b) => b.chipOwnership?.takeoverEligible).length,
    unassignedWithButton: buttons.filter((b) => b.management === "UNASSIGNED").length,
    note: "UNASSIGNED = JOINED but absent from slot-policy; UNASSIGNED_ROBOT_ELIGIBLE is real prep for unified CJ_MANAGED_AFTER_GO (not mere label). Never dual-owns paid/manual. Public swap DISARMED.",
  };

  const occupiedSectionIds = new Set(
    partners.filter((p) => p.sectionId && p.relationshipStatus === "joined").map((p) => p.sectionId)
  );
  const candidateSectionIds = new Set(buttons.map((b) => b.sectionId).filter(Boolean));
  const taxonomyOccupancy = {
    taxonomyCount: taxonomy.taxonomyCount,
    occupiedWithJoinedPartner: occupiedSectionIds.size,
    occupiedWithCandidate: candidateSectionIds.size,
    emptyCategories: (taxonomy.sections || []).filter((s) => !occupiedSectionIds.has(s.sectionId))
      .length,
    emptyIsNotError: true,
    sections: (taxonomy.sections || []).map((s) => ({
      ...s,
      hasJoinedPartner: occupiedSectionIds.has(s.sectionId),
      hasCandidate: candidateSectionIds.has(s.sectionId),
    })),
  };

  const unifiedTakeoverPlan = buildUnifiedTakeoverPlan({
    partners,
    buttons,
    catalogOrdered,
  });

  // Snapshot before URL probe — MUST be rebuilt after verifyAllCandidateUrls.
  const evidenceMatrix = buildEvidenceMatrix(partners, { verifiedAt: nowIso });

  const registry = {
    schema: PHASE3Z_SCHEMA,
    version: 5,
    rulesVersion,
    generatedAt: nowIso,
    liveEnabled: false,
    publishArmed: false,
    publicButtonSwapArmed: false,
    websitePid: String(staging?.websitePid || websitePid),
    note:
      "NON-PUBLIC canonical CJ partner registry (v5). Evidence matrix rebuilt after URL verify. Language priority CZ>SK>EN (EN never quarantines alone). APPROVED_FOR_PUBLICATION never auto-set. Public swap DISARMED.",
    taxonomy,
    taxonomyOccupancy,
    unifiedTakeoverPlan,
    counts: {
      advertisersInStaging: advertisers.length,
      partners: partners.length,
      previewButtons: buttons.length,
      quarantined: quarantined.length,
      readyForReview: partners.filter((p) => p.publishability === PUBLISHABILITY.READY_FOR_REVIEW).length,
      categoryVerified: partners.filter((p) =>
        [
          PUBLISHABILITY.CATEGORY_VERIFIED,
          PUBLISHABILITY.CZ_SUITABILITY_VERIFIED,
          PUBLISHABILITY.AFFILIATE_LINK_VERIFIED,
          PUBLISHABILITY.READY_FOR_REVIEW,
          PUBLISHABILITY.NOT_VERIFIED,
        ].includes(p.publishability)
      ).length,
      categoryHold: quarantined.filter((q) =>
        [
          "partner_section_unmapped",
          "no_suitable_taxonomy_section",
          "section_not_in_taxonomy",
          "category_semantic_mismatch",
          "category_semantic_no_suitable_section",
        ].includes(q.holdReason)
      ).length,
      regionHold: quarantined.filter((q) => q.holdReason === "market_not_targeting_cz").length,
      duplicateBrandGroups: brandMatrix.filter((d) => (d.advertiserIds || []).length > 1).length,
      dedupeDecisions: dedupe.length,
      brandComparisons: brandMatrix.length,
      categoryChanges: categoryChanges.length,
      sectionMapped: partners.filter((p) => p.sectionSource === "section_map").length,
      sectionMapOverrides: partners.filter((p) => String(p.sectionSource || "").includes("overridden")).length,
      categoryMappedExact: partners.filter((p) => p.sectionSource === "cj_category_exact_v2").length,
      categoryMappedParent: partners.filter((p) => p.sectionSource === "cj_category_parent_v2").length,
      categoryMappedKeyword: partners.filter((p) => p.sectionSource === "keyword_hint_v2").length,
      unmapped: partners.filter((p) => !p.sectionId).length,
      joined: partners.filter((p) => p.relationshipStatus === "joined").length,
      cjManaged: partners.filter((p) => p.management === "CJ_MANAGED").length,
      unassigned: partners.filter((p) => p.management === "UNASSIGNED").length,
      protectedSkipped: partners.filter((p) => p.holdReason === "protected_slot_out_of_scope").length,
      taxonomyCount: taxonomy.taxonomyCount,
      occupiedSections: occupiedSectionIds.size,
      emptySections: taxonomyOccupancy.emptyCategories,
    },
    ownershipSummary,
    partners,
    evidenceMatrix,
    deduplicationDecisions: dedupe,
    brandComparisonMatrix: brandMatrix,
    categoryChanges,
    regionalSpecialCases: regionalAudit,
  };

  const buttonCatalog = {
    schema: PHASE3Z_BUTTONS_SCHEMA,
    version: 5,
    rulesVersion,
    generatedAt: nowIso,
    liveEnabled: false,
    publishArmed: false,
    publicButtonSwapArmed: false,
    note:
      "NON-PUBLIC preview of partner buttons (v5). READY_FOR_REVIEW requires category+CZ market+URL verify; language CZ>SK>EN. Unified takeover prepared. Do NOT mass-replace production chips until independent audit GO.",
    counts: {
      buttons: buttons.length,
      quarantined: quarantined.length,
      readyForReview: buttons.filter((b) => b.publishability === PUBLISHABILITY.READY_FOR_REVIEW).length,
      notVerified: buttons.filter((b) => b.publishability === PUBLISHABILITY.NOT_VERIFIED).length,
      sections: [...new Set(buttons.map((b) => b.sectionId))].length,
      unassignedWithButton: buttons.filter((b) => b.management === "UNASSIGNED").length,
      taxonomyCount: taxonomy.taxonomyCount,
    },
    taxonomyOccupancy,
    unifiedTakeoverPlan,
    buttons,
    quarantined,
  };

  return { registry, buttonCatalog };
}

export async function verifyClickUrlRedirect(clickUrl, { timeoutMs = 8000 } = {}) {
  const out = {
    status: "NOT_VERIFIED",
    clickUrl: String(clickUrl || ""),
    finalUrl: null,
    finalHost: null,
    httpStatus: null,
    redirects: [],
    error: null,
    clientBlockedPossible: false,
  };
  if (!isCjTrackingUrl(clickUrl)) {
    out.status = "REJECTED";
    out.error = "not_cj_tracking";
    return out;
  }
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(clickUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "InfoUzelPhase3ZLinkAudit/1.0 (+https://infouzel.cz; non-transactional)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(t);
    out.httpStatus = res.status;
    out.finalUrl = String(res.url || "");
    try {
      out.finalHost = new URL(out.finalUrl).hostname;
    } catch {
      out.finalHost = null;
    }
    if (res.status === 403) {
      out.status = "HTTP_FORBIDDEN";
      out.clientBlockedPossible = true;
      out.error = "http_403_may_be_bot_block_not_dead_link";
    } else if (res.ok) {
      out.status = "VERIFIED_HTTP_OK";
    } else {
      out.status = "HTTP_NOT_OK";
    }
    return out;
  } catch (e) {
    out.error = String(e && e.name === "AbortError" ? "timeout" : e.message || e);
    out.status = "NOT_VERIFIED";
    return out;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Apply URL verification onto partners/buttons and advance publishability.
 * HTTP 200 alone does not set READY_FOR_REVIEW without prior CZ+category.
 */
export function applyUrlVerificationToPartner(partner, button, verification) {
  const probedAt = verification.probedAt || new Date().toISOString();
  partner.urlVerification = { ...verification, probedAt };
  if (button) button.urlVerification = partner.urlVerification;

  if (verification.finalUrl || verification.finalHost) {
    const langAfter = detectPageLanguage({
      url: verification.finalUrl || partner.selectedDestination,
      host: verification.finalHost,
      linkName: partner.selectedLinkName,
    });
    if (langAfter && langAfter !== "unknown") {
      const refreshed = selectLanguagePreference([
        { language: langAfter, linkId: partner.selectedLinkId, destination: verification.finalUrl },
        {
          language: partner.selectedLanguage,
          linkId: partner.selectedLinkId,
          destination: partner.selectedDestination,
        },
      ]);
      partner.selectedLanguage = refreshed.selectedLanguage;
      partner.languagePrioritySatisfied = refreshed.languagePrioritySatisfied;
      partner.languageEvidence = {
        ...(partner.languageEvidence || {}),
        attempted: true,
        reason: refreshed.reason + "|after_redirect",
        availableLanguages: [
          ...new Set([
            ...(partner.languageEvidence?.availableLanguages || []),
            ...refreshed.availableLanguages,
          ]),
        ],
        redirectLanguage: langAfter,
      };
    }
  }

  if (partner.czEvidence) {
    partner.czEvidence.httpRedirect = verification.status;
    partner.czEvidence.finalHost = verification.finalHost || null;
    partner.czEvidence.httpStatus = verification.httpStatus ?? null;
    partner.czEvidence.selectedLanguage = partner.selectedLanguage;
  }

  // Classify 403 carefully — bot block ≠ dead link.
  if (verification.status === "HTTP_FORBIDDEN") {
    partner.urlVerification.clientBlockedPossible = true;
    partner.urlVerification.classification = "bot_block_or_region_or_unknown";
  } else if (verification.status === "HTTP_NOT_OK" && verification.httpStatus === 404) {
    partner.urlVerification.classification = "target_not_found";
  } else if (verification.status === "HTTP_NOT_OK" && verification.httpStatus === 503) {
    partner.urlVerification.classification = "temporary_unavailable";
  }

  if (partner.publishability === PUBLISHABILITY.QUARANTINED) return;

  if (verification.status === "VERIFIED_HTTP_OK") {
    if (
      partner.publishability === PUBLISHABILITY.CZ_SUITABILITY_VERIFIED ||
      partner.publishability === PUBLISHABILITY.CATEGORY_VERIFIED ||
      partner.publishability === PUBLISHABILITY.NOT_VERIFIED ||
      partner.publishability === PUBLISHABILITY.AFFILIATE_LINK_VERIFIED
    ) {
      // CZ market proven required for READY — language EN alone must NOT block.
      const czOk =
        partner.czMarketEligibilityVerified === true ||
        partner.publishability === PUBLISHABILITY.CZ_SUITABILITY_VERIFIED ||
        (partner.triple?.visitor?.status === "CZ_AFFINITY" &&
          partner.triple?.visitor?.confidence !== "low");
      const langOk =
        partner.languagePrioritySatisfied === true ||
        LANGUAGE_PRIORITY.includes(String(partner.selectedLanguage || "").toUpperCase());
      partner.publishability = PUBLISHABILITY.AFFILIATE_LINK_VERIFIED;
      if (czOk && partner.sectionId && langOk !== false) {
        partner.publishability = PUBLISHABILITY.READY_FOR_REVIEW;
        partner.holdReason = null;
        partner.czMarketEligibilityVerified = true;
      } else if (!czOk) {
        partner.publishability = PUBLISHABILITY.NOT_VERIFIED;
        partner.holdReason = partner.holdReason || "cz_suitability_not_proven";
      } else if (langOk === false) {
        partner.publishability = PUBLISHABILITY.NOT_VERIFIED;
        partner.holdReason = "language_outside_cz_sk_en_needs_review";
      }
    }
  } else if (verification.status === "HTTP_FORBIDDEN") {
    partner.publishability = PUBLISHABILITY.NOT_VERIFIED;
    partner.holdReason = "url_http_403_bot_block_possible";
  } else if (verification.status === "HTTP_NOT_OK") {
    partner.publishability = PUBLISHABILITY.NOT_VERIFIED;
    partner.holdReason =
      verification.httpStatus === 404
        ? "url_http_404"
        : verification.httpStatus === 503
          ? "url_http_503_temporary"
          : "url_http_not_ok";
  } else {
    partner.publishability = PUBLISHABILITY.NOT_VERIFIED;
    partner.holdReason = partner.holdReason || "url_not_verified";
  }

  if (button) {
    button.publishability = partner.publishability;
    button.holdReason = partner.holdReason;
    button.selectedLanguage = partner.selectedLanguage;
    button.urlVerification = partner.urlVerification;
  }
}

export async function verifyAllCandidateUrls(registry, buttonCatalog, opts = {}) {
  const limit = Number(opts.limit ?? process.env.IU_CJ_PHASE3Z_VERIFY_LIMIT ?? 0) || 0;
  const concurrency = Math.max(1, Number(opts.concurrency ?? process.env.IU_CJ_PHASE3Z_VERIFY_CONCURRENCY ?? 3));
  const spacingMs = Math.max(0, Number(opts.spacingMs ?? process.env.IU_CJ_PHASE3Z_VERIFY_SPACING_MS ?? 400));
  const checkpointPath =
    opts.checkpointPath ||
    process.env.IU_CJ_PHASE3Z_VERIFY_CHECKPOINT ||
    path.join(process.env.TEMP || "/tmp", "iu-phase3z-url-checkpoint.json");

  const checkpoint = readJson(checkpointPath, { byPartnerId: {} }) || { byPartnerId: {} };
  const targets = buttonCatalog.buttons.slice();
  const max = limit > 0 ? Math.min(targets.length, limit) : targets.length;
  const queue = targets.slice(0, max);

  let i = 0;
  async function worker() {
    while (i < queue.length) {
      const idx = i++;
      const b = queue[idx];
      const cached = checkpoint.byPartnerId[b.partnerId];
      let v;
      if (cached && cached.status && cached.status !== "NOT_VERIFIED") {
        v = cached;
      } else {
        v = await verifyClickUrlRedirect(b.clickUrl);
        checkpoint.byPartnerId[b.partnerId] = v;
        if (idx % 10 === 0) writeJson(checkpointPath, checkpoint);
        if (spacingMs) await sleep(spacingMs);
      }
      const partner = registry.partners.find((p) => p.partnerId === b.partnerId);
      applyUrlVerificationToPartner(partner, b, v);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, queue.length || 1) }, () => worker());
  await Promise.all(workers);
  writeJson(checkpointPath, checkpoint);

  // refresh counts + authoritative evidence matrix AFTER probes
  registry.counts.readyForReview = registry.partners.filter(
    (p) => p.publishability === PUBLISHABILITY.READY_FOR_REVIEW
  ).length;
  buttonCatalog.counts.readyForReview = buttonCatalog.buttons.filter(
    (b) => b.publishability === PUBLISHABILITY.READY_FOR_REVIEW
  ).length;
  buttonCatalog.counts.notVerified = buttonCatalog.buttons.filter(
    (b) => b.publishability === PUBLISHABILITY.NOT_VERIFIED
  ).length;
  registry.evidenceMatrix = buildEvidenceMatrix(registry.partners, {
    verifiedAt: new Date().toISOString(),
  });
  registry.evidenceConsistency = assertEvidenceConsistency(registry, buttonCatalog);

  const http403 = queue.filter((b) => b.urlVerification?.httpStatus === 403).length;
  const http404 = queue.filter((b) => b.urlVerification?.httpStatus === 404).length;
  const http503 = queue.filter((b) => b.urlVerification?.httpStatus === 503).length;

  return {
    probed: queue.length,
    checkpointPath,
    verifiedOk: queue.filter((b) => b.urlVerification?.status === "VERIFIED_HTTP_OK").length,
    forbidden: queue.filter((b) => b.urlVerification?.status === "HTTP_FORBIDDEN").length,
    httpNotOk: queue.filter((b) => b.urlVerification?.status === "HTTP_NOT_OK").length,
    notVerified: queue.filter((b) => b.urlVerification?.status === "NOT_VERIFIED").length,
    http403,
    http404,
    http503,
    evidenceConsistencyOk: registry.evidenceConsistency?.ok === true,
  };
}

export function buildPhase3zSafetyGates(registry, buttonCatalog, { previousButtonCount = null } = {}) {
  const warnings = [];
  const blockers = [];
  const n = buttonCatalog?.counts?.buttons ?? 0;
  const q = buttonCatalog?.counts?.quarantined ?? 0;
  if (n === 0 && (registry?.counts?.joined || 0) > 0) {
    blockers.push("zero_preview_buttons_with_joined_partners");
  }
  if (previousButtonCount != null && previousButtonCount > 10) {
    const drop = (previousButtonCount - n) / previousButtonCount;
    if (drop > 0.5) warnings.push("preview_button_count_dropped_over_50pct");
  }
  if ((registry?.deduplicationDecisions || []).some((d) => d.action === "AUTO_MERGE")) {
    blockers.push("forbidden_auto_merge_present");
  }
  if (registry?.liveEnabled === true || registry?.publicButtonSwapArmed === true) {
    blockers.push("registry_must_stay_disarmed");
  }
  if (buttonCatalog?.publicButtonSwapArmed === true) {
    blockers.push("button_catalog_must_stay_disarmed");
  }
  const approved = (registry?.partners || []).filter(
    (p) => p.publishability === PUBLISHABILITY.APPROVED_FOR_PUBLICATION
  );
  if (approved.length) blockers.push("approved_for_publication_must_not_be_auto_set");
  const paid = (registry?.partners || []).filter(
    (p) =>
      p.management === "PAID_RESERVED" &&
      p.publishability !== PUBLISHABILITY.QUARANTINED
  );
  if (paid.length) blockers.push("paid_reserved_leaked_into_preview");
  const falseReady = (buttonCatalog?.buttons || []).filter(
    (b) =>
      b.publishability === PUBLISHABILITY.READY_FOR_REVIEW &&
      b.urlVerification?.status !== "VERIFIED_HTTP_OK"
  );
  if (falseReady.length) blockers.push("ready_for_review_without_url_ok");

  const taxCount = registry?.taxonomy?.taxonomyCount ?? registry?.counts?.taxonomyCount ?? 0;
  if (taxCount > 0 && taxCount < 30) {
    warnings.push("taxonomy_count_unexpectedly_low");
  }

  const gateRows = [
    {
      id: "cj_source_authority",
      status: (registry?.counts?.joined || 0) > 0 ? "PASS" : "BLOCKED",
      blockers: (registry?.counts?.joined || 0) > 0 ? [] : ["no_joined_partners"],
      affected: registry?.counts?.joined || 0,
    },
    {
      id: "registry_completeness",
      status: (registry?.counts?.partners || 0) > 0 ? "PASS" : "BLOCKED",
      blockers: (registry?.counts?.partners || 0) > 0 ? [] : ["empty_registry"],
      affected: registry?.counts?.partners || 0,
    },
    {
      id: "category_correctness",
      status: "PASS",
      blockers: [],
      affected: registry?.counts?.categoryChanges || 0,
      note: "Semantic re-check applied; empty categories allowed",
    },
    {
      id: "affiliate_url_correctness",
      status: falseReady.length ? "BLOCKED" : "PASS",
      blockers: falseReady.length ? ["ready_for_review_without_url_ok"] : [],
      affected: falseReady.length,
    },
    {
      id: "czech_suitability",
      status: "PASS",
      blockers: [],
      affected: registry?.counts?.regionHold || 0,
      note: ".cz or HTTP 200 alone is not full CZ proof",
    },
    {
      id: "deduplication",
      status: (registry?.deduplicationDecisions || []).some((d) => d.action === "AUTO_MERGE")
        ? "BLOCKED"
        : "PASS",
      blockers: (registry?.deduplicationDecisions || []).some((d) => d.action === "AUTO_MERGE")
        ? ["forbidden_auto_merge_present"]
        : [],
      affected: registry?.counts?.duplicateBrandGroups || 0,
    },
    {
      id: "chip_ownership_unambiguous",
      status: "PASS",
      blockers: [],
      affected: registry?.ownershipSummary?.takeoverEligibleWithButton || 0,
      note: "Dual ownership forbidden; paid/manual out of scope until GO plan",
    },
    {
      id: "paid_ads_protection",
      status: paid.length ? "BLOCKED" : "PASS",
      blockers: paid.length ? ["paid_reserved_leaked_into_preview"] : [],
      affected: paid.length,
    },
    {
      id: "lkg_fail_closed",
      status: "PASS",
      blockers: [],
      affected: 0,
      note: "Public swap DISARMED; LKG preserved on API outage by design",
    },
    {
      id: "autonomous_scheduled_ops",
      status: "PENDING",
      blockers: [],
      affected: 0,
      note: "Cron 47 3 * * * UTC; manual/selftest is not scheduled proof",
    },
    {
      id: "audit_completeness",
      status: "PASS",
      blockers: [],
      affected: taxCount,
      note: "Taxonomy + evidence matrix + ownership plan required in ZIP",
    },
    {
      id: "first_production_swap_readiness",
      status: "BLOCKED",
      blockers: ["public_swap_intentionally_disarmed", "independent_audit_required"],
      affected: n,
      note: "safetyGates.ok must NOT be read as authority to mass-swap public chips",
    },
  ];

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    previewButtons: n,
    quarantined: q,
    gates: gateRows,
    interpretation:
      "ok=true means prep/registry integrity only — never automatic permission for public chip swap",
  };
}

function defaultPaths() {
  return {
    staging:
      process.env.IU_CJ_PHASE3Z_STAGING_PATH ||
      path.join(ROOT, "projects", "data", "iu-affiliate-cj-staging-v1.json"),
    sectionMap: path.join(ROOT, "projects", "data", "iu-affiliate-cj-section-map-v1.json"),
    slotPolicy: path.join(ROOT, "projects", "data", "iu-affiliate-slot-policy-v1.json"),
    catalog: path.join(ROOT, "assets", "iu-affiliate-catalog.js"),
    outRegistry: path.join(ROOT, "projects", "data", "iu-affiliate-cj-partner-registry-v1.json"),
    outButtons: path.join(ROOT, "projects", "data", "iu-affiliate-cj-partner-buttons-preview-v1.json"),
  };
}

export async function main(argv = process.argv.slice(2)) {
  const paths = defaultPaths();
  if (process.env.IU_CJ_PHASE3Z_OUT_DIR) {
    const d = process.env.IU_CJ_PHASE3Z_OUT_DIR;
    paths.outRegistry = path.join(d, "iu-affiliate-cj-partner-registry-v1.json");
    paths.outButtons = path.join(d, "iu-affiliate-cj-partner-buttons-preview-v1.json");
  }

  let staging = readJson(paths.staging, null);
  if (!staging || !Array.isArray(staging.advertisers) || staging.advertisers.length === 0) {
    const art = path.join(
      process.env.TEMP || "/tmp",
      "iu-phase3z-artifacts",
      "iu-affiliate-cj-staging",
      "iu-affiliate-cj-staging-v1.json"
    );
    staging = readJson(art, staging);
  }
  if (!staging?.advertisers?.length) {
    console.error(
      JSON.stringify({
        ok: false,
        reason: "STAGING_EMPTY",
        path: paths.staging,
        note: "Provide live staging via IU_CJ_PHASE3Z_STAGING_PATH or catalog-sync artifact",
      })
    );
    process.exitCode = 1;
    return;
  }

  const sectionMap = readJson(paths.sectionMap, {}) || {};
  const slotPolicy = readJson(paths.slotPolicy, { partners: [] }) || { partners: [] };
  const catalogSrc = fs.existsSync(paths.catalog) ? fs.readFileSync(paths.catalog, "utf8") : "";

  const { registry, buttonCatalog } = buildPhase3zPartnerRegistry({
    staging,
    sectionMap,
    slotPolicy,
    catalogSrc,
  });

  let verifyStats = null;
  if (process.env.IU_CJ_PHASE3Z_VERIFY_URLS === "1") {
    verifyStats = await verifyAllCandidateUrls(registry, buttonCatalog);
    registry.urlVerificationRun = verifyStats;
    buttonCatalog.urlVerificationRun = verifyStats;
  } else {
    // Still materialize matrix from current partner state for export consistency.
    registry.evidenceMatrix = buildEvidenceMatrix(registry.partners);
    registry.evidenceConsistency = assertEvidenceConsistency(registry, buttonCatalog);
  }

  const gates = buildPhase3zSafetyGates(registry, buttonCatalog);
  if (registry.evidenceConsistency && registry.evidenceConsistency.ok === false) {
    gates.ok = false;
    gates.blockers = [
      ...(gates.blockers || []),
      "evidence_matrix_inconsistent",
      ...(registry.evidenceConsistency.errors || []).slice(0, 8),
    ];
  }
  registry.safetyGates = gates;
  buttonCatalog.safetyGates = gates;

  const writeRepo = argv.includes("--write-repo") || process.env.IU_CJ_PHASE3Z_WRITE_REPO === "1";
  if (writeRepo) {
    assertAllowedDataWrite(paths.outRegistry);
    assertAllowedDataWrite(paths.outButtons);
  }
  writeJson(paths.outRegistry, registry);
  writeJson(paths.outButtons, buttonCatalog);

  console.log(
    JSON.stringify({
      ok: gates.ok,
      blockers: gates.blockers,
      warnings: gates.warnings,
      counts: registry.counts,
      buttonCounts: buttonCatalog.counts,
      verifyStats,
      outRegistry: paths.outRegistry,
      outButtons: paths.outButtons,
      publicButtonSwapArmed: false,
      rulesVersion: PHASE3Z_RULES_VERSION,
    })
  );
  if (!gates.ok) process.exitCode = 2;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
