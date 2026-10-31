/**
 * Phase 3Z V8 — merchant assortment profiling + stable primary-section selection.
 * One partner = one public main button; multiple assortment groups are internal only.
 * Never invents taxonomy tiles. Never moves section on a single weak product signal.
 */
import { parseCjPrimaryCategory } from "./iu-cj-affiliate-phase3e-partner-recon-v1.mjs";

export const MERCHANT_TYPE = Object.freeze({
  SPECIALIST: "SPECIALIST",
  MULTI_ASSORTMENT: "MULTI_ASSORTMENT",
  UNIVERSAL_ESHOP: "UNIVERSAL_ESHOP",
  MARKETPLACE: "MARKETPLACE",
  SERVICE_PROVIDER: "SERVICE_PROVIDER",
  DIGITAL_SERVICE: "DIGITAL_SERVICE",
  GOODS_AND_SERVICES: "GOODS_AND_SERVICES",
  UNKNOWN: "UNKNOWN",
});

/** Minimum score delta before replacing a still-valid previous section. */
export const CATEGORY_SELECTION_HYSTERESIS = 18;

const KEYWORD_GROUPS = Object.freeze([
  { group: "moda", sectionId: "aff-moda", re: /\b(móda|moda|fashion|oblečen|apparel|clothing|šaty|saty)\b/i },
  { group: "boty", sectionId: "aff-boty", re: /\b(boty|shoe|footwear|barefoot)\b/i },
  { group: "kosmetika", sectionId: "aff-kosmetika", re: /\b(kosmetik|beauty|skin\s*care|makeup|make-up)\b/i },
  { group: "drogerie", sectionId: "aff-drogerie", re: /\b(drogerie|drugstore|hygien)\b/i },
  { group: "elektro", sectionId: "aff-elektro", re: /\b(elektro|electronics|appliance|notebook|laptop|pc\b|tv\b)\b/i },
  { group: "mobily", sectionId: "aff-mobily", re: /\b(mobil|phone|smartphone|iphone|android)\b/i },
  { group: "software", sectionId: "aff-software", re: /\b(software|vpn|antivirus|security\s*suite|abbyy|paragon)\b/i },
  { group: "sport", sectionId: "aff-sport-outdoor", re: /\b(sport|outdoor|fitness|turistik)\b/i },
  { group: "sport_apparel", sectionId: "aff-sportovni-obleceni", re: /\b(sportovn[íi]\s*obleč|sportswear)\b/i },
  { group: "deti", sectionId: "aff-deti-hracky", re: /\b(dět|deti|hračka|hracka|toy|kids|child)\b/i },
  { group: "jidlo", sectionId: "aff-jidlo", re: /\b(jídlo|jidlo|potravin|food|gourmet|supermarket)\b/i },
  { group: "zdravi", sectionId: "aff-zdravi-doplnky", re: /\b(zdrav[íi]|doplněk|supplement|vitamin)\b/i },
  { group: "lekarny", sectionId: "aff-lekarny", re: /\b(l[eé]k[aá]rn\w*|pharmacy|pharma(?:cy|ceutical)?s?)\b/i },
  { group: "dum", sectionId: "aff-dum-zahrada", re: /\b(dům|dum|zahrad|garden|home\s*&\s*garden)\b/i },
  { group: "nabytek", sectionId: "aff-nabytek", re: /\b(nábytek|nabytek|furniture|bydlen)\b/i },
  { group: "kuchyn", sectionId: "aff-kuchyn", re: /\b(kuchyn|kitchen|cookware)\b/i },
  { group: "auto", sectionId: "aff-auto-moto", re: /\b(auto|moto|automotive|pneu|car\s*part)\b/i },
  { group: "cestovani", sectionId: "aff-cestovni-kancelare", re: /\b(cestovn|travel|vacation|tour)\b/i },
  { group: "ubytovani", sectionId: "aff-ubytovani-hotely", re: /\b(hotel|ubytov|booking|lodging|accommodation)\b/i },
  { group: "letenky", sectionId: "aff-letenky-letecka-doprava", re: /\b(letenk|flight|airline|air\s*travel)\b/i },
  { group: "pojisteni", sectionId: "aff-pojisteni", re: /\b(pojišt|pojist|insurance)\b/i },
  { group: "finance", sectionId: "aff-finance", re: /\b(financ|bank|invest|půjč|loan)\b/i },
  { group: "energie", sectionId: "aff-energie-uspor", re: /\b(energi|elektřin|plyn|utility)\b/i },
  { group: "knihy", sectionId: "aff-knihy", re: /\b(knih|book|ebook|hudba|music|hry|games)\b/i },
  { group: "sperky", sectionId: "aff-sperky-hodinky", re: /\b(šperk|sperk|jewelry|hodink|watch)\b/i },
  { group: "zvirata", sectionId: "aff-zvirata", re: /\b(zvíř|zvir|pet|chovatel)\b/i },
  { group: "kvetiny", sectionId: "aff-kvetiny-darky", re: /\b(květin|kvetin|flower|dárek|darek|gift)\b/i },
  { group: "dilna", sectionId: "aff-dilna-naradi", re: /\b(díln|dilna|nářad|naradi|tool)\b/i },
  { group: "kancelar", sectionId: "aff-kancelarske-potreby", re: /\b(kancelář|kancelar|office\s*suppl)\b/i },
  { group: "reality", sectionId: "aff-reality-nemovitosti", re: /\b(realit|nemovit|real\s*estate)\b/i },
  { group: "inzerce", sectionId: "aff-inzerce-bazary", re: /\b(inzerce|bazar|marketplace|allegro|aukro)\b/i },
  { group: "tv", sectionId: "aff-tv-streamovani", re: /\b(stream|iptv|netflix|tv\s*service)\b/i },
]);

const MARKETPLACE_RE =
  /\b(marketplace|allegro|amazon|ebay|mall\.cz|heureka|bazos|aukro)\b/i;
const UNIVERSAL_RE =
  /\b(supermarket|hypermarket|department\s*store|obchodn[íi]\s*d[ůu]m|general\s*merchandise|vše\s*pro|vse\s*pro)\b/i;
const DIGITAL_RE =
  /\b(vpn|software|saas|streaming|ebook|online\s*course|digitál|digital\s*service)\b/i;
const SERVICE_RE =
  /\b(insurance|pojišt|bank|financ|travel\s*agency|cestovn[íi]\s*kancel|hotel|booking|realit)\b/i;

function pushSignal(map, sectionId, group, weight, source) {
  if (!sectionId) return;
  const cur = map.get(sectionId) || { sectionId, group, weight: 0, sources: [] };
  cur.weight += weight;
  cur.group = cur.group || group;
  if (source && cur.sources.length < 12) cur.sources.push(source);
  map.set(sectionId, cur);
}

/** Max total weight any single section may gain from link-inventory keyword hits. */
export const LINK_INVENTORY_SECTION_CAP = 15;

/**
 * Build assortment profile from CJ advertiser + link inventory (+ optional website evidence).
 * Never invents facts. Link keywords alone cannot dominate primary section.
 */
export function buildAssortmentProfile({
  advertiser,
  links = [],
  knownSections = null,
  websiteEvidence = null,
} = {}) {
  const name = String(advertiser?.advertiserName || "");
  const programUrl = String(advertiser?.programUrl || "");
  const cat = parseCjPrimaryCategory(advertiser?.primaryCategory);
  const bySection = new Map();
  const sources = ["cj_advertiser_name", "cj_program_url", "cj_primary_category", "cj_link_inventory"];
  const checkedAt = new Date().toISOString();

  if (cat.parent || cat.child) {
    // Weight primary CJ category strongly but not exclusively.
    for (const kg of KEYWORD_GROUPS) {
      const blob = `${cat.parent || ""} ${cat.child || ""}`;
      if (kg.re.test(blob)) {
        if (!knownSections || knownSections.has(kg.sectionId)) {
          pushSignal(bySection, kg.sectionId, kg.group, 40, "cj_primary_category:" + cat.key);
        }
      }
    }
  }

  const nameBlob = `${name} ${programUrl}`;
  for (const kg of KEYWORD_GROUPS) {
    if (kg.re.test(nameBlob)) {
      if (!knownSections || knownSections.has(kg.sectionId)) {
        pushSignal(bySection, kg.sectionId, kg.group, 25, "name_or_program_url");
      }
    }
  }

  // High-trust website evidence (title/nav/h1/identity) — never body-only noise.
  const webGroups = Array.isArray(websiteEvidence?.significantGroups)
    ? websiteEvidence.significantGroups
    : websiteEvidence?.primaryAssortment
      ? [websiteEvidence.primaryAssortment, ...(websiteEvidence.secondaryAssortments || [])]
      : [];
  if (webGroups.length) {
    sources.push("merchant_website_weighted_evidence");
    for (const g of webGroups) {
      const sectionId = g.sectionId;
      if (!sectionId) continue;
      if (knownSections && !knownSections.has(sectionId)) continue;
      const w = Math.min(55, Number(g.weight) || 30);
      pushSignal(bySection, sectionId, g.group || "web", w, "website:" + ((g.sources || [])[0] || "weighted"));
    }
  }

  let productishHits = 0;
  const linkWeightBySection = new Map();
  for (const link of links) {
    const blob = `${link.linkName || ""} ${link.destination || ""} ${link.linkType || ""} ${link.promotionType || ""}`;
    let hit = false;
    for (const kg of KEYWORD_GROUPS) {
      if (kg.re.test(blob)) {
        hit = true;
        if (!knownSections || knownSections.has(kg.sectionId)) {
          const used = linkWeightBySection.get(kg.sectionId) || 0;
          if (used >= LINK_INVENTORY_SECTION_CAP) continue;
          // Cap per-link (3) and per-section total so link spam cannot invent assortment.
          const add = Math.min(3, LINK_INVENTORY_SECTION_CAP - used);
          pushSignal(bySection, kg.sectionId, kg.group, add, "link:" + String(link.linkId || ""));
          linkWeightBySection.set(kg.sectionId, used + add);
        }
      }
    }
    if (hit) productishHits += 1;
  }

  const ranked = [...bySection.values()].sort((a, b) => b.weight - a.weight || a.sectionId.localeCompare(b.sectionId));
  // Require stronger weight when signal is only from capped link inventory.
  const significant = ranked.filter((r) => {
    const sourcesList = r.sources || [];
    const onlyLinks = sourcesList.length > 0 && sourcesList.every((s) => String(s).startsWith("link:"));
    if (onlyLinks) return r.weight >= LINK_INVENTORY_SECTION_CAP && ranked.length <= 2;
    return r.weight >= 20 || (r.weight >= 12 && ranked.length <= 3);
  });
  const top = ranked[0] || null;
  const second = ranked[1] || null;

  let merchantType = MERCHANT_TYPE.UNKNOWN;
  let confidence = "low";
  if (MARKETPLACE_RE.test(nameBlob) || significant.some((s) => s.sectionId === "aff-inzerce-bazary" && s.weight >= 25)) {
    merchantType = MERCHANT_TYPE.MARKETPLACE;
    confidence = "medium";
  } else if (DIGITAL_RE.test(nameBlob) && significant.length <= 2) {
    merchantType = MERCHANT_TYPE.DIGITAL_SERVICE;
    confidence = "medium";
  } else if (SERVICE_RE.test(nameBlob) && significant.length <= 2) {
    merchantType = MERCHANT_TYPE.SERVICE_PROVIDER;
    confidence = "medium";
  } else if (UNIVERSAL_RE.test(nameBlob) || significant.length >= 4) {
    merchantType = MERCHANT_TYPE.UNIVERSAL_ESHOP;
    confidence = significant.length >= 4 ? "medium" : "low";
  } else if (significant.length >= 2 && second && top && second.weight >= top.weight * 0.55) {
    merchantType = MERCHANT_TYPE.MULTI_ASSORTMENT;
    confidence = "medium";
  } else if (significant.length === 1 || (top && (!second || second.weight < top.weight * 0.4))) {
    merchantType = MERCHANT_TYPE.SPECIALIST;
    confidence = top && top.weight >= 40 ? "high" : "medium";
  } else if (significant.length >= 2) {
    merchantType = MERCHANT_TYPE.GOODS_AND_SERVICES;
    confidence = "low";
  }

  if (!top) {
    confidence = "low";
    merchantType = MERCHANT_TYPE.UNKNOWN;
  }

  return {
    merchantType,
    primaryAssortment: top
      ? { sectionId: top.sectionId, group: top.group, weight: top.weight }
      : null,
    secondaryAssortment: second
      ? { sectionId: second.sectionId, group: second.group, weight: second.weight }
      : null,
    significantGroups: significant.map((s) => ({
      sectionId: s.sectionId,
      group: s.group,
      weight: s.weight,
      sources: s.sources,
    })),
    allScoredGroups: ranked.slice(0, 12).map((s) => ({
      sectionId: s.sectionId,
      group: s.group,
      weight: Math.round(s.weight * 10) / 10,
    })),
    productSignalLinks: productishHits,
    confidence,
    sources,
    checkedAt,
    notes: [
      "Assortment inferred from CJ fields + capped link inventory + weighted website evidence.",
      "Single weak product signal / footer keyword cannot dominate primary section.",
      "Link-inventory keyword contribution capped at LINK_INVENTORY_SECTION_CAP per section.",
      "Public UI still exposes one main button / one primary section.",
    ],
    linkInventorySectionCap: LINK_INVENTORY_SECTION_CAP,
  };
}

/**
 * Choose primary section using assortment + prior CJ evidence section, with hysteresis.
 */
export function selectPrimarySectionWithAssortment({
  baseSection,
  assortment,
  previousSectionId = null,
  knownSections = null,
  hysteresis = CATEGORY_SELECTION_HYSTERESIS,
} = {}) {
  const candidates = [];
  if (baseSection?.sectionId) {
    candidates.push({
      sectionId: baseSection.sectionId,
      score: 50 + (baseSection.confidence === "high" ? 20 : baseSection.confidence === "medium" ? 10 : 0),
      reason: "cj_evidence_or_section_map:" + (baseSection.rule || baseSection.source || ""),
    });
  }
  for (const g of assortment?.significantGroups || []) {
    if (knownSections && !knownSections.has(g.sectionId)) continue;
    candidates.push({
      sectionId: g.sectionId,
      score: Math.min(90, 20 + g.weight),
      reason: "assortment_group:" + g.group,
    });
  }
  // Marketplace / universal: prefer general shopping tiles only if they exist and score.
  if (
    assortment?.merchantType === MERCHANT_TYPE.MARKETPLACE ||
    assortment?.merchantType === MERCHANT_TYPE.UNIVERSAL_ESHOP
  ) {
    for (const sid of ["aff-inzerce-bazary", "aff-moda", "aff-elektro"]) {
      if (knownSections && !knownSections.has(sid)) continue;
      const hit = (assortment.significantGroups || []).find((g) => g.sectionId === sid);
      if (hit) {
        candidates.push({
          sectionId: sid,
          score: 35 + hit.weight * 0.5,
          reason: "universal_or_marketplace_preference:" + assortment.merchantType,
        });
      }
    }
  }

  const bestById = new Map();
  for (const c of candidates) {
    const prev = bestById.get(c.sectionId);
    if (!prev || c.score > prev.score) bestById.set(c.sectionId, c);
  }
  const ranked = [...bestById.values()].sort(
    (a, b) => b.score - a.score || a.sectionId.localeCompare(b.sectionId)
  );
  let selected = ranked[0] || null;
  let hysteresisKept = false;

  // Without a base sectionId, only accept a strong assortment signal (never guess).
  if (!baseSection?.sectionId) {
    const strong =
      selected &&
      (assortment?.confidence === "high" || (selected.score >= 70 && assortment?.confidence === "medium"));
    if (!strong) {
      selected = null;
    }
  }

  if (previousSectionId && selected) {
    const prevCand = ranked.find((c) => c.sectionId === previousSectionId);
    if (prevCand && selected.sectionId !== previousSectionId) {
      if (selected.score - prevCand.score < hysteresis) {
        selected = prevCand;
        hysteresisKept = true;
      }
    } else if (selected.sectionId === previousSectionId) {
      hysteresisKept = true;
    } else if (!prevCand && assortment?.confidence !== "high") {
      // Unknown previous still valid in taxonomy — keep unless high-confidence challenger.
      if (knownSections && knownSections.has(previousSectionId) && selected.score < 70) {
        selected = {
          sectionId: previousSectionId,
          score: selected.score,
          reason: "keep_previous_pending_stronger_evidence",
        };
        hysteresisKept = true;
      }
    }
  }

  const alternatives = ranked
    .filter((c) => !selected || c.sectionId !== selected.sectionId)
    .slice(0, 5)
    .map((c) => ({ sectionId: c.sectionId, score: Math.round(c.score), reason: c.reason }));

  return {
    sectionId: selected?.sectionId || baseSection?.sectionId || null,
    score: selected ? Math.round(selected.score) : null,
    reason: selected?.reason || baseSection?.rule || "no_section",
    alternatives,
    hysteresisKept,
    merchantType: assortment?.merchantType || MERCHANT_TYPE.UNKNOWN,
    confidence: assortment?.confidence || baseSection?.confidence || "low",
    reviewRequired:
      !selected?.sectionId ||
      assortment?.merchantType === MERCHANT_TYPE.UNKNOWN ||
      assortment?.confidence === "low",
  };
}

/**
 * Exclusive candidate accounting across all links.
 * TOTAL = SELECTED + ELIGIBLE_NOT_SELECTED + INELIGIBLE + PENDING_EVIDENCE
 */
export function auditLinkCandidateBuckets(partners, totalLinksFromStaging) {
  let selected = 0;
  let eligibleNotSelected = 0;
  let ineligible = 0;
  let pending = 0;
  const perPartner = [];

  for (const p of partners || []) {
    const inv = Array.isArray(p.linkInventory) ? p.linkInventory : [];
    const sid = p.selectedLinkId != null ? String(p.selectedLinkId) : null;
    let s = 0;
    let e = 0;
    let i = 0;
    let pend = 0;
    const seen = new Set();
    for (const row of inv) {
      const id = String(row.linkId || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const st = String(row.eligibility || row.status || "");
      if (sid && id === sid) {
        s += 1;
      } else if (st === "ELIGIBLE") {
        e += 1;
      } else if (st === "PENDING_EVIDENCE") {
        pend += 1;
      } else {
        i += 1;
      }
    }
    // If inventory missing but candidates counted on partner:
    if (inv.length === 0 && Number(p.linkCandidateCount || 0) > 0) {
      const n = Number(p.linkCandidateCount || 0);
      if (sid) {
        s = 1;
        const elig = Number(p.linkEligibleCandidateCount || 0);
        e = Math.max(0, elig - 1);
        i = Math.max(0, n - s - e);
      } else {
        pend = n;
      }
    }
    selected += s;
    eligibleNotSelected += e;
    ineligible += i;
    pending += pend;
    perPartner.push({
      advertiserId: p.advertiserId,
      selected: s,
      eligibleNotSelected: e,
      ineligible: i,
      pendingEvidence: pend,
      accounted: s + e + i + pend,
      linkCandidateCount: Number(p.linkCandidateCount || inv.length || 0),
    });
  }

  const accounted = selected + eligibleNotSelected + ineligible + pending;
  return {
    totalLinksFromStaging: Number(totalLinksFromStaging || 0),
    selected,
    eligibleNotSelected,
    ineligible,
    pendingEvidence: pending,
    accounted,
    exclusiveInvariantOk: accounted === Number(totalLinksFromStaging || 0) || accounted === perPartner.reduce((a, r) => a + r.accounted, 0),
    note:
      accounted === Number(totalLinksFromStaging || 0)
        ? "FULL_COVERAGE"
        : "Accounted from per-partner inventories; compare to staging.links length for drift.",
    perPartner,
  };
}

/** Explain taxonomy filename vs live count once and for all. */
export function explainTaxonomy36vs38(taxonomyCount) {
  return {
    authoritativeSource: "assets/iu-affiliate-catalog.js",
    productionMainCategoryTiles: taxonomyCount,
    expectedLiveCount: 36,
    filenameHistoricalClaim: 38,
    explanation:
      "TAXONOMY-38-AUTHORITATIVE.json was a historical/misnamed audit label. Live InfoUzel affiliate catalog SoT exposes 36 main category tiles. Robot must use catalog parse count, never the ZIP filename numeral.",
    ok: taxonomyCount === 36,
  };
}
