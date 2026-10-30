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
 *   IU_CJ_PHASE3Z_VERIFY_URLS=1 — optional HTTP redirect probe (slow)
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
export const PHASE3Z_RULES_VERSION = "phase3z-partner-robot-v1";

const CJ_TRACKING_HOSTS = new Set([
  "www.anrdoezrs.com",
  "www.anrdoezrs.net",
  "www.jdoqocy.com",
  "www.jdoqocy.net",
  "www.dpbolvw.com",
  "www.dpbolvw.net",
  "www.kqzyfj.com",
  "www.kqzyfj.net",
  "www.tkqlhce.com",
  "www.tkqlhce.net",
]);

const SECTION_TITLES = Object.freeze({
  "aff-kosmetika": "Kosmetika a parfémy",
  "aff-drogerie": "Drogerie",
  "aff-moda": "Móda",
  "aff-boty": "Boty",
  "aff-sperky-hodinky": "Šperky a hodinky",
  "aff-sport-outdoor": "Sport a outdoor",
  "aff-zdravi-doplnky": "Zdraví a doplňky",
  "aff-lekarny": "Lékárny",
  "aff-jidlo": "Jídlo a potraviny",
  "aff-deti-hracky": "Děti a hračky",
  "aff-ubytovani-hotely": "Ubytování a hotely",
  "aff-letenky": "Letenky",
  "aff-letenky-letecka-doprava": "Letenky a letecká doprava",
  "aff-cestovni-pojisteni": "Cestovní pojištění",
  "aff-pojisteni": "Pojištění",
  "aff-auto-moto": "Auto-moto",
  "aff-pneu-pneuservis": "Pneu a pneuservis",
  "aff-zvirata": "Zvířata",
});

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
  // Title-ish cleanup: keep diacritics if present; strip trailing punctuation
  return name.replace(/[\s\-_/|]+$/g, "").trim();
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

  // Prefer homepage / deeplink home over campaign/coupon
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

  return { score, reasons };
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

export function resolveSectionId({ advertiserId, advertiser, sectionMap, categoryEvidence }) {
  const id = String(advertiserId);
  if (sectionMap && sectionMap[id] && !String(sectionMap[id]).startsWith("_")) {
    return {
      sectionId: sectionMap[id],
      source: "section_map",
      confidence: "high",
    };
  }
  const cat = parseCjPrimaryCategory(advertiser.primaryCategory);
  const hit = categoryEvidence[cat.key] || CJ_CATEGORY_SECTION_EVIDENCE[cat.key];
  if (hit?.sectionId) {
    return {
      sectionId: hit.sectionId,
      source: "cj_category_evidence",
      confidence: "medium",
      categoryKey: cat.key,
      evidenceReason: hit.reason,
    };
  }
  return {
    sectionId: null,
    source: "unmapped",
    confidence: "low",
    categoryKey: cat.key || null,
  };
}

function policyByAdvertiserId(slotPolicy) {
  const map = new Map();
  for (const p of slotPolicy?.partners || []) {
    if (p?.advertiserId == null) continue;
    map.set(String(p.advertiserId), p);
  }
  return map;
}

function detectDuplicates(rows) {
  const byBrand = new Map();
  for (const r of rows) {
    const n = r.brandKey;
    if (!n || n.length < 4) continue;
    if (!byBrand.has(n)) byBrand.set(n, []);
    byBrand.get(n).push(r.partnerId);
  }
  const decisions = [];
  for (const [brandKey, ids] of byBrand) {
    if (ids.length < 2) continue;
    // Do NOT auto-merge different advertiserIds — record suspicion only.
    decisions.push({
      brandKey,
      advertiserIds: ids,
      action: "KEEP_SEPARATE_PENDING_EVIDENCE",
      reason: "same_normalized_brand_distinct_cid",
      confidence: "medium",
    });
  }
  return decisions;
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
  const catalogOrdered = catalogSrc ? parseAffiliateCatalogOrdered(catalogSrc) : { sections: [] };
  const knownSections = new Set(
    (catalogOrdered.sections || []).map((s) => s.sectionId).filter(Boolean)
  );
  for (const sid of Object.values(SECTION_TITLES)) {
    /* titles only */
  }
  for (const sid of Object.keys(SECTION_TITLES)) knownSections.add(sid);

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
    const section = resolveSectionId({
      advertiserId,
      advertiser: adv,
      sectionMap,
      categoryEvidence: CJ_CATEGORY_SECTION_EVIDENCE,
    });
    const advLinks = linksByAdv.get(advertiserId) || [];
    const pick = selectPrimaryAffiliateLink(advLinks, adv);

    const protectedSkip =
      management === "PAID_RESERVED" || management === "MANUAL_PROTECTED";

    let publishability = "QUARANTINED";
    let holdReason = null;
    const triple = {
      technical: { status: "NOT_VERIFIED", confidence: "low", notes: [] },
      visitor: { status: "NOT_VERIFIED", confidence: "low", notes: [] },
      business: { status: "NOT_VERIFIED", confidence: "low", notes: [] },
    };

    if (protectedSkip) {
      holdReason = "protected_slot_out_of_scope";
      triple.technical = {
        status: "PROTECTED_SKIP",
        confidence: "high",
        notes: [management],
      };
    } else if (rel !== "joined") {
      holdReason = "relationship_not_joined";
      triple.technical = {
        status: "NOT_JOINED",
        confidence: "high",
        notes: [rel || "missing"],
      };
    } else if (!pick.selected) {
      holdReason = pick.reason || "no_affiliate_link";
      triple.technical = {
        status: "NO_SUITABLE_LINK",
        confidence: "high",
        notes: [holdReason],
      };
    } else if (!section.sectionId) {
      holdReason = "partner_section_unmapped";
      triple.business = {
        status: "NEEDS_CATEGORY",
        confidence: "medium",
        notes: [section.categoryKey || ""],
      };
      triple.technical = {
        status: "JOINED_LINK_OK",
        confidence: "medium",
        notes: ["awaiting_section"],
      };
    } else if (!knownSections.has(section.sectionId)) {
      holdReason = "section_not_in_taxonomy";
      triple.business = {
        status: "UNKNOWN_SECTION",
        confidence: "medium",
        notes: [section.sectionId],
      };
    } else {
      // Candidate for non-public button catalog (still not public live)
      publishability = "PREVIEW_READY";
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
      triple.business = {
        status: "SECTION_ASSIGNED",
        confidence: section.confidence,
        notes: [section.sectionId, section.source],
      };
      const destHost = (() => {
        try {
          return new URL(pick.selected.destination).hostname;
        } catch {
          return "";
        }
      })();
      if (/\.cz$/i.test(destHost) || marketAllowsCzechRepublic(pick.selected.targetedCountries) === true) {
        triple.visitor.notes.push("cz_affinity");
        triple.visitor.confidence = "high";
      } else if (marketAllowsCzechRepublic(pick.selected.targetedCountries) === false) {
        publishability = "QUARANTINED";
        holdReason = "market_not_targeting_cz";
        triple.visitor = {
          status: "NON_CZ_MARKET",
          confidence: "high",
          notes: [String(pick.selected.targetedCountries || "")],
        };
      }
    }

    const partnerId = "cj-" + advertiserId;
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
      sectionId: section.sectionId,
      sectionTitleCs: section.sectionId ? SECTION_TITLES[section.sectionId] || section.sectionId : null,
      sectionSource: section.source,
      sectionConfidence: section.confidence,
      selectedClickUrl: pick.selected?.clickUrl || null,
      selectedDestination: pick.selected?.destination || null,
      selectedLinkId: pick.selected?.linkId || null,
      selectedLinkName: pick.selected?.linkName || null,
      selectedTargetedCountries: pick.selected?.targetedCountries || null,
      linkSelectionReason: pick.reason || null,
      linkSelectionScore: pick.score ?? null,
      linkCandidateCount: pick.candidates || 0,
      publishability,
      holdReason,
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
    };

    partners.push(row);

    if (publishability === "PREVIEW_READY") {
      buttons.push({
        partnerId,
        advertiserId,
        displayNameCs,
        sectionId: section.sectionId,
        sectionTitleCs: row.sectionTitleCs,
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
        publicSwapArmed: false,
        chipStyle: "radio-compact-v1",
        rel: "sponsored noopener",
        target: "_blank",
        rulesVersion,
        triple,
      });
    } else {
      quarantined.push({
        partnerId,
        advertiserId,
        displayNameCs,
        holdReason,
        management,
        relationshipStatus: rel,
        sectionId: section.sectionId,
        rulesVersion,
      });
    }
  }

  const dedupe = detectDuplicates(partners);

  const registry = {
    schema: PHASE3Z_SCHEMA,
    version: 1,
    rulesVersion,
    generatedAt: nowIso,
    liveEnabled: false,
    publishArmed: false,
    publicButtonSwapArmed: false,
    websitePid: String(staging?.websitePid || websitePid),
    note:
      "NON-PUBLIC canonical CJ partner registry. Historical baked affiliate URLs are NOT authoritative. Paid ads / MANUAL_PROTECTED out of scope.",
    counts: {
      advertisersInStaging: advertisers.length,
      partners: partners.length,
      previewButtons: buttons.length,
      quarantined: quarantined.length,
      duplicateBrandGroups: dedupe.length,
      sectionMapped: partners.filter((p) => p.sectionSource === "section_map").length,
      categoryMapped: partners.filter((p) => p.sectionSource === "cj_category_evidence").length,
      unmapped: partners.filter((p) => !p.sectionId).length,
      joined: partners.filter((p) => p.relationshipStatus === "joined").length,
      protectedSkipped: partners.filter((p) => p.holdReason === "protected_slot_out_of_scope").length,
    },
    partners,
    deduplicationDecisions: dedupe,
  };

  const buttonCatalog = {
    schema: PHASE3Z_BUTTONS_SCHEMA,
    version: 1,
    rulesVersion,
    generatedAt: nowIso,
    liveEnabled: false,
    publishArmed: false,
    publicButtonSwapArmed: false,
    note:
      "NON-PUBLIC preview of partner buttons. Do NOT mass-replace production affiliate chips until independent audit GO.",
    counts: {
      buttons: buttons.length,
      quarantined: quarantined.length,
      sections: [...new Set(buttons.map((b) => b.sectionId))].length,
    },
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
    out.status = res.ok ? "VERIFIED_HTTP_OK" : "HTTP_NOT_OK";
    // HTTP 200 alone is not proof of CZ suitability — caller must still judge.
    return out;
  } catch (e) {
    out.error = String(e && e.name === "AbortError" ? "timeout" : e.message || e);
    out.status = "NOT_VERIFIED";
    return out;
  }
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
  const paid = (registry?.partners || []).filter((p) => p.management === "PAID_RESERVED" && p.publishability === "PREVIEW_READY");
  if (paid.length) blockers.push("paid_reserved_leaked_into_preview");
  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    previewButtons: n,
    quarantined: q,
  };
}

function defaultPaths() {
  return {
    staging:
      process.env.IU_CJ_PHASE3Z_STAGING_PATH ||
      path.join(ROOT, "projects", "data", "iu-affiliate-cj-staging-v1.json"),
    sectionMap: path.join(ROOT, "projects", "data", "iu-affiliate-cj-section-map-v1.json"),
    slotPolicy: path.join(ROOT, "projects", "data", "iu-affiliate-cj-slot-policy-v1.json".replace("cj-slot", "slot")),
    catalog: path.join(ROOT, "assets", "iu-affiliate-catalog.js"),
    outRegistry: path.join(ROOT, "projects", "data", "iu-affiliate-cj-partner-registry-v1.json"),
    outButtons: path.join(ROOT, "projects", "data", "iu-affiliate-cj-partner-buttons-preview-v1.json"),
  };
}

export async function main(argv = process.argv.slice(2)) {
  const paths = defaultPaths();
  // fix slot policy path typo-safe
  paths.slotPolicy = path.join(ROOT, "projects", "data", "iu-affiliate-slot-policy-v1.json");
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

  if (process.env.IU_CJ_PHASE3Z_VERIFY_URLS === "1") {
    const limit = Math.min(buttonCatalog.buttons.length, Number(process.env.IU_CJ_PHASE3Z_VERIFY_LIMIT || 40));
    for (let i = 0; i < limit; i++) {
      const b = buttonCatalog.buttons[i];
      const v = await verifyClickUrlRedirect(b.clickUrl);
      b.urlVerification = v;
      const partner = registry.partners.find((p) => p.partnerId === b.partnerId);
      if (partner) partner.urlVerification = v;
    }
  }

  const gates = buildPhase3zSafetyGates(registry, buttonCatalog);
  registry.safetyGates = gates;
  buttonCatalog.safetyGates = gates;

  // Only write into repo allowlisted path when explicitly armed for data write
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
      outRegistry: paths.outRegistry,
      outButtons: paths.outButtons,
      publicButtonSwapArmed: false,
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
