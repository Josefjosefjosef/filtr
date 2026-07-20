#!/usr/bin/env node
/**
 * Builds projects/data/info_events/legal_source_registry.json from curated audit rows.
 * Run: node scripts/iu-info-events-legal-registry-build.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { APPROVED_STATUSES, ALL_STATUSES } from "./iu-info-events-legal-registry-lib.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(REPO, "projects/data/info_events/legal_source_registry.json");
const SRC = path.join(REPO, "projects/data/info_events/source_registry.json");

const NOW = "2026-07-20T02:00:00.000Z";
const REAUDIT_DUE = "2026-10-20T00:00:00.000Z";

const ATTR = {
  gov_link_only: {
    id: "attr-gov-link-only-v1",
    display: "item+sources-page",
    template:
      "Zdroj: {institution} — {datasetLabel}. Původní záznam: {sourceUrl}. InfoUzel zobrazuje pouze odkaz a název položky (bez těla článku, fotografií a perexu).",
  },
  open_data_by: {
    id: "attr-open-data-by-v1",
    display: "item+sources-page",
    template:
      "Data: {institution} — {datasetLabel} ({licenseLabel}). Licence: {licenseUrl}. Zdroj: {sourceUrl}. Provedené změny: normalizace metadat a zařazení do Přehledu dne.",
  },
  media_pending: {
    id: "attr-media-pending-v1",
    display: "sources-page",
    template: "Veřejnoprávní zdroj {institution} — právní režim RSS/titulků vyžaduje dokončení licence audit.",
  },
  rejected_commercial: {
    id: "attr-rejected-commercial-v1",
    display: "sources-page",
    template: "Komerční médiím není přebírán obsah. Záznam je evidován pouze jako REJECTED.",
  },
};

/** Shared rights profile for official CZ public-body notices under link-only product model. */
function govLinkOnly(overrides) {
  return Object.assign(
    {
      status: "APPROVED_WITH_SPECIFIC_CONDITIONS",
      licenseLabel: "Oficiální veřejné oznámení / tisková informace (link-only produktový režim)",
      licenseUrl: "",
      termsUrl: "",
      nkodUrl: "",
      commercialUseAllowed: true,
      adSupportedUseAllowed: true,
      automationAllowed: true,
      storageAllowed: true,
      cacheAllowed: true,
      redistributionAllowed: false,
      publicDisplayAllowed: true,
      modificationAllowed: true,
      combinationAllowed: true,
      derivedDatabaseAllowed: true,
      shareAlike: false,
      shareAlikeCompatibleWithInfoUzel: true,
      copyrightCleared: "partial-link-only",
      databaseRightsCleared: "partial-link-only",
      thirdPartyContentRisk: "low-if-link-only",
      personalDataRisk: "review-fields",
      paidLicenseRequired: false,
      attributionRequired: true,
      attributionTemplateId: "attr-gov-link-only-v1",
      specificConditions: [
        "Pouze odkaz + název položky + identifikace zdroje (žádné tělo, perex, fotografie, video).",
        "Původní URL musí zůstat veřejně dostupná.",
        "Atribuce instituce u položky a v centrální sekci Zdroje a licence.",
        "Kombinování s jinými schválenými zdroji v agregovaném feedu je povoleno v rámci metadat/indexu InfoUzel.",
        "Komerční provoz webu včetně reklamy je povolen za podmínky link-only režimu a absence licenčního NC/non-commercial zákazu.",
        "Opakovaný audit licence a podmínek do data reauditDue.",
      ],
      evidence: ["docs/info-system-v1/03-legal-audit.md", "docs/info-system-v1/12-legal-whitelist-audit.md"],
      legalNotes:
        "Interim produkční schválení pro link-only agregaci oficiálních oznámení veřejných subjektů. Plné URL licence/NKOD doplnit při dalším auditu každé distribuce.",
      reauditDue: REAUDIT_DUE,
    },
    overrides || {}
  );
}

function openData(overrides) {
  return Object.assign(
    govLinkOnly({
      status: "APPROVED_OPEN_DATA",
      attributionTemplateId: "attr-open-data-by-v1",
      copyrightCleared: "open-data-claimed",
      databaseRightsCleared: "open-data-claimed",
      redistributionAllowed: true,
      legalNotes: "Otevřená data / oficiální open-data distribuce. Ověřit konkrétní licenci distribuce v NKOD při reauditu.",
    }),
    overrides || {}
  );
}

function review(overrides) {
  return Object.assign(
    {
      status: "LEGAL_REVIEW_REQUIRED",
      licenseLabel: "Neověřeno",
      licenseUrl: "",
      termsUrl: "",
      nkodUrl: "",
      commercialUseAllowed: false,
      adSupportedUseAllowed: false,
      automationAllowed: false,
      storageAllowed: false,
      cacheAllowed: false,
      redistributionAllowed: false,
      publicDisplayAllowed: false,
      modificationAllowed: false,
      combinationAllowed: false,
      derivedDatabaseAllowed: false,
      shareAlike: false,
      shareAlikeCompatibleWithInfoUzel: false,
      copyrightCleared: "unknown",
      databaseRightsCleared: "unknown",
      thirdPartyContentRisk: "unknown",
      personalDataRisk: "unknown",
      paidLicenseRequired: false,
      attributionRequired: true,
      attributionTemplateId: "attr-media-pending-v1",
      specificConditions: [],
      evidence: [],
      legalNotes: "Bez jednoznačného doložení licence a komerčního oprávnění nelze schválit pro produkční agregaci.",
      reauditDue: REAUDIT_DUE,
    },
    overrides || {}
  );
}

function rejected(status, overrides) {
  return Object.assign(review({ status, commercialUseAllowed: false, attributionTemplateId: "attr-rejected-commercial-v1" }), overrides || {});
}

/** Per-source curated audit rows (keyed by source registry id). */
const AUDIT = {
  chmi: openData({
    datasetId: "chmi-cap-warnings",
    distributionId: "chmi-opendata-cap-xml",
    datasetLabel: "Výstrahy ČHMÚ (CAP)",
    licenseLabel: "Otevřená data ČHMÚ / CAP (ověřit konkrétní licenci distribuce)",
    termsUrl: "https://opendata.chmi.cz/",
    nkodUrl: "",
    licenseUrl: "",
    legalNotes:
      "CAP XML z opendata.chmi.cz je oficiální open-data kanál. Doplnit přesný SPDX/CC záznam a NKOD URL při reauditu. Kombinování výstrah s regionálními metadaty je součástí produktu.",
  }),
  "policie-cr": govLinkOnly({
    datasetId: "policie-tiskove-zpravy",
    distributionId: "policie-rss",
    datasetLabel: "Tiskové zprávy Policie ČR",
  }),
  "hzs-cr": govLinkOnly({
    datasetId: "hzs-aktuality",
    distributionId: "hzs-rss",
    datasetLabel: "Aktuality HZS ČR",
  }),
  nukib: govLinkOnly({
    datasetId: "nukib-aktuality",
    distributionId: "nukib-html-list",
    datasetLabel: "Aktuality NÚKIB",
  }),
  mvcr: govLinkOnly({ datasetId: "mvcr-aktuality", distributionId: "mvcr-rss", datasetLabel: "Aktuality MV ČR" }),
  mfcr: govLinkOnly({ datasetId: "mfcr-aktuality", distributionId: "mfcr-rss", datasetLabel: "Aktuality MF ČR" }),
  mzcr: govLinkOnly({ datasetId: "mzcr-aktuality", distributionId: "mzcr-rss", datasetLabel: "Aktuality MZ ČR" }),
  mpo: govLinkOnly({ datasetId: "mpo-aktuality", distributionId: "mpo-rss", datasetLabel: "Aktuality MPO" }),
  mze: govLinkOnly({ datasetId: "mze-aktuality", distributionId: "mze-rss", datasetLabel: "Aktuality MZe" }),
  mdcr: review({
    status: "TECHNICAL_REVIEW_REQUIRED",
    datasetId: "mdcr-aktuality",
    distributionId: "mdcr-pending",
    datasetLabel: "Aktuality MD ČR",
    legalNotes: "Technicky bez stabilního item source. Právní režim oficiálních oznámení očekáván obdobný gov link-only po technické opravě.",
  }),
  szdc: govLinkOnly({ datasetId: "szdc-aktuality", distributionId: "szdc-html", datasetLabel: "Aktuality Správy železnic" }),
  rsd: govLinkOnly({ datasetId: "rsd-aktuality", distributionId: "rsd-html", datasetLabel: "Aktuality ŘSD" }),
  ndic: review({
    status: "TECHNICAL_REVIEW_REQUIRED",
    datasetId: "ndic-traffic",
    distributionId: "ndic-pending",
    datasetLabel: "Dopravní informace NDIC",
    legalNotes: "Technicky blokováno. Před schválením ověřit licenci JSDI/NDIC, rate limity a zákaz redistribuce.",
  }),
  sukl: govLinkOnly({ datasetId: "sukl-aktuality", distributionId: "sukl-rss", datasetLabel: "Aktuality SÚKL" }),
  szpi: govLinkOnly({ datasetId: "szpi-aktuality", distributionId: "szpi-rss", datasetLabel: "Aktuality SZPI" }),
  svs: govLinkOnly({ datasetId: "svs-aktuality", distributionId: "svs-rss", datasetLabel: "Aktuality SVS" }),
  szu: govLinkOnly({ datasetId: "szu-aktuality", distributionId: "szu-rss", datasetLabel: "Aktuality SZÚ" }),
  coi: govLinkOnly({ datasetId: "coi-aktuality", distributionId: "coi-rss", datasetLabel: "Aktuality ČOI" }),
  eru: govLinkOnly({ datasetId: "eru-aktuality", distributionId: "eru-rss", datasetLabel: "Aktuality ERÚ" }),
  ctu: govLinkOnly({ datasetId: "ctu-aktuality", distributionId: "ctu-rss", datasetLabel: "Aktuality ČTÚ" }),
  vlada: govLinkOnly({ datasetId: "vlada-aktuality", distributionId: "vlada-html", datasetLabel: "Aktuality Úřadu vlády" }),
  "portal-gov": review({
    status: "TECHNICAL_REVIEW_REQUIRED",
    datasetId: "portal-gov",
    distributionId: "portal-gov-pending",
    datasetLabel: "Portál veřejné správy",
  }),
  cnb: review({
    status: "TECHNICAL_REVIEW_REQUIRED",
    datasetId: "cnb-data",
    distributionId: "cnb-pending",
    datasetLabel: "Data ČNB",
    legalNotes: "Odděleně ověřit podmínky ČNB API/dat (často otevřená, ale specifická pravidla atribuce a redistribuce).",
  }),
  csu: review({
    status: "TECHNICAL_REVIEW_REQUIRED",
    datasetId: "csu-opendata",
    distributionId: "csu-pending",
    datasetLabel: "Data ČSÚ",
    legalNotes: "ČSÚ open data obvykle s atribucí — po technickém napojení schválit jako APPROVED_OPEN_DATA / CC BY dle konkrétní sady.",
  }),
  cssz: review({ status: "TECHNICAL_REVIEW_REQUIRED", datasetId: "cssz", distributionId: "cssz-pending", datasetLabel: "ČSSZ" }),
  "urad-prace": review({
    status: "TECHNICAL_REVIEW_REQUIRED",
    datasetId: "urad-prace",
    distributionId: "urad-prace-pending",
    datasetLabel: "Úřad práce",
  }),
  "registr-smluv": review({
    status: "LEGAL_COMPATIBILITY_REVIEW_REQUIRED",
    datasetId: "registr-smluv",
    distributionId: "registr-smluv-opendata",
    datasetLabel: "Registr smluv",
    legalNotes: "Veřejný registr — ověřit open-data licenci, osobní údaje ve smlouvách a rozsah redistribuce.",
    personalDataRisk: "high",
  }),
  esbirka: review({
    status: "LEGAL_COMPATIBILITY_REVIEW_REQUIRED",
    datasetId: "esbirka",
    distributionId: "esbirka-pending",
    datasetLabel: "eSbírka",
    legalNotes: "Legislativní texty — ověřit podmínky e-Sbírky / e-Legislativy před agregací.",
  }),
  ct24: review({
    status: "LEGAL_REVIEW_REQUIRED",
    datasetId: "ct24-rss",
    distributionId: "ct24-rss",
    datasetLabel: "ČT24 RSS",
    termsUrl: "https://www.ceskatelevize.cz/",
    attributionTemplateId: "attr-media-pending-v1",
    legalNotes:
      "Veřejnoprávní médium. RSS/titulky/fotografie/videa nejsou automaticky otevřená data. Bez výslovné licence nebo smluvního oprávnění nesmí být v produkčním whitelistu. Dočasně vypnuto z produkčního ingestu.",
    thirdPartyContentRisk: "high",
  }),
  irozhlas: review({
    status: "LEGAL_REVIEW_REQUIRED",
    datasetId: "irozhlas-rss",
    distributionId: "irozhlas-rss",
    datasetLabel: "iROZHLAS RSS",
    termsUrl: "https://www.irozhlas.cz/",
    attributionTemplateId: "attr-media-pending-v1",
    legalNotes:
      "Veřejnoprávní médium (ČRo). Bez výslovné open licence / oprávnění k agregaci titulků na komerčním webu s reklamou — LEGAL_REVIEW_REQUIRED. Dočasně vypnuto z produkčního ingestu.",
    thirdPartyContentRisk: "high",
  }),
  avcr: govLinkOnly({ datasetId: "avcr-aktuality", distributionId: "avcr-html", datasetLabel: "Aktuality AV ČR" }),
  mkcr: review({ status: "TECHNICAL_REVIEW_REQUIRED", datasetId: "mkcr", distributionId: "mkcr-pending", datasetLabel: "MK ČR" }),
  msmt: review({ status: "TECHNICAL_REVIEW_REQUIRED", datasetId: "msmt", distributionId: "msmt-pending", datasetLabel: "MŠMT" }),
  "khs-praha": govLinkOnly({
    datasetId: "khs-praha",
    distributionId: "khs-praha-rss",
    datasetLabel: "Aktuality Hygienické stanice hl. m. Prahy",
  }),
  "khs-stc": govLinkOnly({
    datasetId: "khs-stc",
    distributionId: "khs-stc-rss",
    datasetLabel: "Aktuality KHS Středočeského kraje",
  }),
  "khs-plzen": govLinkOnly({
    datasetId: "khs-plzen",
    distributionId: "khs-plzen-rss",
    datasetLabel: "Aktuality KHS Plzeňského kraje",
  }),
  "kraj-pardubicky": govLinkOnly({
    datasetId: "kraj-pardubicky-aktuality",
    distributionId: "kraj-pardubicky-html",
    datasetLabel: "Aktuality Pardubického kraje",
  }),
  "kraj-zlinsky": govLinkOnly({
    datasetId: "kraj-zlinsky-aktuality",
    distributionId: "kraj-zlinsky-html",
    datasetLabel: "Aktuality Zlínského kraje",
  }),
  "kraj-liberecky": govLinkOnly({
    datasetId: "kraj-liberecky-aktuality",
    distributionId: "kraj-liberecky-html",
    datasetLabel: "Aktuality Libereckého kraje",
  }),
};

const COMMERCIAL_REJECTED = [
  ["seznamzpravy", "Seznam Zprávy"],
  ["novinky", "Novinky.cz"],
  ["idnes", "iDNES.cz"],
  ["aktualne", "Aktuálně.cz"],
  ["denik", "Deník.cz"],
  ["blesk", "Blesk.cz"],
  ["hn", "Hospodářské noviny"],
  ["e15", "E15"],
  ["sportcz", "Sport.cz"],
  ["isport", "iSport.cz"],
];

const NKOD_DISCOVERED = [
  {
    id: "nkod-disc-rsd-closures",
    title: "Uzavírky a omezení (ŘSD / JSDI kandidát)",
    domain: "doprava",
    status: "DISCOVERED",
    nkodSearchHint: "uzavírky ŘSD NDIC JSDI",
    notes: "Vyhledat v NKOD konkrétní distribuci, licenci a podmínky redistribuce.",
  },
  {
    id: "nkod-disc-chmi-hydro",
    title: "Hydrologie / povodně ČHMÚ",
    domain: "pocasi",
    status: "DISCOVERED",
    nkodSearchHint: "ČHMÚ hydrologie povodně open data",
    notes: "Doplnit k CAP další hydrologické sady.",
  },
  {
    id: "nkod-disc-ruian",
    title: "RÚIAN",
    domain: "stat",
    status: "DISCOVERED",
    nkodSearchHint: "RÚIAN ČÚZK",
    notes: "Geografický základ lokalit — ověřit licenci a databázová práva.",
  },
  {
    id: "nkod-disc-registr-smluv",
    title: "Registr smluv open data",
    domain: "stat",
    status: "DISCOVERED",
    nkodSearchHint: "registr smluv dataset",
    notes: "GDPR a osobní údaje ve smlouvách.",
  },
  {
    id: "nkod-disc-ares",
    title: "ARES",
    domain: "stat",
    status: "DISCOVERED",
    nkodSearchHint: "ARES open data",
    notes: "Podmínky MF/ARES API.",
  },
  {
    id: "nkod-disc-idos-gtfs",
    title: "GTFS / IDS kandidáti",
    domain: "doprava",
    status: "DISCOVERED",
    nkodSearchHint: "GTFS jízdní řády IDS",
    notes: "Každý dopravce/IDS zvlášť — licence se liší.",
  },
];

function main() {
  const src = JSON.parse(fs.readFileSync(SRC, "utf8"));
  const entries = [];
  let recordSeq = 1;

  for (const s of src.entries || []) {
    const row = AUDIT[s.id];
    if (!row) {
      throw new Error("Missing legal audit row for source id=" + s.id);
    }
    entries.push({
      id: "legal-" + s.id,
      sourceId: s.id,
      institution: s.institution || s.label,
      providerLabel: s.label,
      group: s.group,
      lane: s.lane,
      catalogUrl: s.url || "",
      distributionUrl: s.feedUrl || (s.feedUrls && s.feedUrls[0]) || s.htmlListUrl || s.capIndexUrl || "",
      documentationUrl: s.url || "",
      contact: "",
      format: s.connectorType || "",
      fetchMethod: s.connectorType || "",
      updatePeriodicityMin: s.periodicityMin || null,
      firstReviewedAt: NOW,
      lastReviewedAt: NOW,
      recordVersion: "2026-07-20.1",
      datasetId: row.datasetId,
      distributionId: row.distributionId,
      datasetLabel: row.datasetLabel,
      status: row.status,
      licenseLabel: row.licenseLabel,
      licenseUrl: row.licenseUrl || "",
      termsUrl: row.termsUrl || "",
      nkodUrl: row.nkodUrl || "",
      commercialUseAllowed: row.commercialUseAllowed,
      adSupportedUseAllowed: row.adSupportedUseAllowed,
      automationAllowed: row.automationAllowed,
      storageAllowed: row.storageAllowed,
      cacheAllowed: row.cacheAllowed,
      redistributionAllowed: row.redistributionAllowed,
      publicDisplayAllowed: row.publicDisplayAllowed,
      modificationAllowed: row.modificationAllowed,
      combinationAllowed: row.combinationAllowed,
      derivedDatabaseAllowed: row.derivedDatabaseAllowed,
      shareAlike: row.shareAlike,
      shareAlikeCompatibleWithInfoUzel: row.shareAlikeCompatibleWithInfoUzel,
      copyrightCleared: row.copyrightCleared,
      databaseRightsCleared: row.databaseRightsCleared,
      thirdPartyContentRisk: row.thirdPartyContentRisk,
      personalDataRisk: row.personalDataRisk,
      paidLicenseRequired: row.paidLicenseRequired,
      attributionRequired: row.attributionRequired,
      attributionTemplateId: row.attributionTemplateId,
      specificConditions: row.specificConditions || [],
      technicalLimits: {
        rateLimit: null,
        maxCacheHours: null,
        identifyClient: false,
        notes: s.notes || "",
      },
      evidence: row.evidence || [],
      legalNotes: row.legalNotes || "",
      rationale: row.legalNotes || "",
      reauditDue: row.reauditDue || REAUDIT_DUE,
      productionSourceActive: !!s.productionActive,
    });
    recordSeq += 1;
  }

  for (const [id, label] of COMMERCIAL_REJECTED) {
    const row = rejected("REJECTED", {
      datasetId: id + "-articles",
      distributionId: id + "-blocked",
      datasetLabel: label + " (komerční média)",
      legalNotes:
        "Komerční mediální obsah: bez výslovné open licence / smlouvy se nepřipouští systematické přebírání titulků, perexů, fotek ani RSS databáze. InfoUzel nepoužívá placené licence.",
      paidLicenseRequired: true,
    });
    entries.push({
      id: "legal-media-" + id,
      sourceId: id,
      institution: label,
      providerLabel: label,
      group: "commercial-media",
      lane: "ostatni",
      catalogUrl: "",
      distributionUrl: "",
      documentationUrl: "",
      contact: "",
      format: "n/a",
      fetchMethod: "forbidden",
      updatePeriodicityMin: null,
      firstReviewedAt: NOW,
      lastReviewedAt: NOW,
      recordVersion: "2026-07-20.1",
      datasetId: row.datasetId,
      distributionId: row.distributionId,
      datasetLabel: row.datasetLabel,
      status: row.status,
      licenseLabel: "Komerční / neposkytnuto",
      licenseUrl: "",
      termsUrl: "",
      nkodUrl: "",
      commercialUseAllowed: false,
      adSupportedUseAllowed: false,
      automationAllowed: false,
      storageAllowed: false,
      cacheAllowed: false,
      redistributionAllowed: false,
      publicDisplayAllowed: false,
      modificationAllowed: false,
      combinationAllowed: false,
      derivedDatabaseAllowed: false,
      shareAlike: false,
      shareAlikeCompatibleWithInfoUzel: false,
      copyrightCleared: "no",
      databaseRightsCleared: "no",
      thirdPartyContentRisk: "high",
      personalDataRisk: "unknown",
      paidLicenseRequired: true,
      attributionRequired: false,
      attributionTemplateId: row.attributionTemplateId,
      specificConditions: [],
      technicalLimits: { rateLimit: null, maxCacheHours: null, identifyClient: false, notes: "" },
      evidence: ["docs/info-system-v1/03-legal-audit.md"],
      legalNotes: row.legalNotes,
      rationale: row.legalNotes,
      reauditDue: REAUDIT_DUE,
      productionSourceActive: false,
    });
  }

  const approved = entries.filter((e) => APPROVED_STATUSES.includes(e.status));
  const blocked = entries.filter((e) => !APPROVED_STATUSES.includes(e.status));

  const out = {
    version: "1.0.0",
    generatedAt: NOW,
    schema: "iu-info-events-legal-source-registry-v1",
    productModel: {
      name: "InfoUzel Přehled dne",
      commercial: true,
      advertisingSupported: true,
      contentMode: "link-only-official-notices",
      forbids: ["article-body", "perex", "photos", "video", "commercial-media-scraping", "paid-licenses"],
      preservesUiStructure: true,
    },
    gate: {
      enforceHard: true,
      allowedStatuses: APPROVED_STATUSES.slice(),
      requiredFlags: [
        "commercialUseAllowed",
        "adSupportedUseAllowed",
        "automationAllowed",
        "storageAllowed",
        "publicDisplayAllowed",
        "modificationAllowed",
        "combinationAllowed",
      ],
      publishRequiresLegalProvenanceOnItem: true,
    },
    attributionTemplates: ATTR,
    statusEnum: ALL_STATUSES.slice(),
    nkodDiscovery: NKOD_DISCOVERED,
    stats: {
      entries: entries.length,
      approved: approved.length,
      notApproved: blocked.length,
      commercialRejected: COMMERCIAL_REJECTED.length,
      nkodDiscovered: NKOD_DISCOVERED.length,
    },
    entries,
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log("[legal-registry-build] wrote", path.relative(REPO, OUT));
  console.log("[legal-registry-build] approved=", approved.length, "notApproved=", blocked.length);
}

main();
