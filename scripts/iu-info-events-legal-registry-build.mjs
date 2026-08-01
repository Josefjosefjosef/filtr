#!/usr/bin/env node
/**
 * Builds projects/data/info_events/legal_source_registry.json (phase-2).
 * Only APPROVED_* rows with concrete licenseUrl + external evidence may stay production-active.
 * Run: node scripts/iu-info-events-legal-registry-build.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { APPROVED_STATUSES, ALL_STATUSES } from "./iu-info-events-legal-registry-lib.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(REPO, "projects/data/info_events/legal_source_registry.json");
const SRC = path.join(REPO, "projects/data/info_events/source_registry.json");
const NKOD_INV = path.join(REPO, "docs/info-system-v1/13-nkod-deep-dive-inventory.json");

const NOW = "2026-07-20T10:00:00.000Z";
const REAUDIT_DUE = "2026-10-18T00:00:00.000Z";
const RECORD_VERSION = "2026-07-20.phase2.1";

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
  ndic: {
    id: "attr-ndic-v1",
    display: "item+sources-page",
    template:
      "Zdroj: NDIC. Zdrojem digitalizovaných informací o silničním provozu je NDIC. InfoUzel.cz je samostatná informační služba; nejde o partnerství ani oficiální službu ŘSD/NDIC. Surový feed a TMC tabulka nejsou veřejně redistribuovány.",
  },
  media_pending: {
    id: "attr-media-pending-v1",
    display: "sources-page",
    template: "Veřejnoprávní zdroj {institution} — právní režim RSS/titulků vyžaduje dokončení licence auditu.",
  },
  rejected_commercial: {
    id: "attr-rejected-commercial-v1",
    display: "sources-page",
    template: "Komerční médium není přebírán obsah. Záznam je evidován pouze jako REJECTED.",
  },
};

const LINK_ONLY_FIELDS = [
  "id",
  "sourceId",
  "title",
  "url",
  "originalUrl",
  "publishedAt",
  "sourceLabel",
  "region",
  "importance",
  "eventType",
  "sectionId",
];

function baseRights(extra) {
  return Object.assign(
    {
      commercialUseAllowed: false,
      adSupportedUseAllowed: false,
      sponsoredContentContextAllowed: false,
      affiliateContextAllowed: false,
      automationAllowed: false,
      storageAllowed: false,
      cacheAllowed: false,
      redistributionAllowed: false,
      publicDisplayAllowed: false,
      modificationAllowed: false,
      normalizationAllowed: false,
      metadataEnrichmentAllowed: false,
      combinationAllowed: false,
      aggregationAllowed: false,
      derivativesAllowed: false,
      crossSourceDisplayAllowed: false,
      databaseCreationAllowed: false,
      derivedDatabaseAllowed: false,
      shareAlike: false,
      shareAlikeCompatibleWithInfoUzel: true,
      odblOrShareAlikeRisk: false,
      paidLicenseRequired: false,
      attributionRequired: true,
      suspended: false,
      copyrightStatus: "unknown",
      databaseRightsStatus: "unknown",
      extractionAllowed: false,
      reuseAllowed: false,
      systematicExtractionAllowed: false,
      archiveAllowed: false,
      copyrightCleared: "unknown",
      databaseRightsCleared: "unknown",
      thirdPartyContentRisk: "unknown",
      personalDataRisk: "unknown",
      fieldAllowlist: [],
      transformations: ["normalized-metadata-link-only"],
      specificConditions: [],
      evidence: [],
      conditionsEvidenceUrl: "",
      licenseUrl: "",
      termsUrl: "",
      nkodUrl: "",
      catalogUrl: "",
      distributionUrl: "",
      documentationUrl: "",
      contact: "",
      format: "",
      fetchMethod: "",
      updatePeriodicityMin: 60,
      technicalLimits: "",
      datasetId: "",
      distributionId: "",
      datasetLabel: "",
      licenseLabel: "",
      legalNotes: "",
      rationale: "",
      firstReviewedAt: NOW,
      lastReviewedAt: NOW,
      reauditDue: REAUDIT_DUE,
      recordVersion: RECORD_VERSION,
      attributionTemplateId: "attr-gov-link-only-v1",
      productionSourceActive: false,
    },
    extra || {}
  );
}

/**
 * NDIC / ŘSD MobilityData — Contract and Free of charge (DATEX II + TMC LTN 25).
 * Approved for InfoUzel.cz display; raw feed / full TMC redistribution forbidden.
 * Do not store approval e-mails or signed PDFs in the repository.
 */
function ndicApproved(src) {
  return baseRights({
    status: "APPROVED_WITH_SPECIFIC_CONDITIONS",
    licenseLabel: "Contract and Free of charge (NDIC / MobilityData)",
    licenseUrl: "https://registr.dopravniinfo.cz/cs/sources/cz-ndic_d2-common-pull/",
    termsUrl: "https://mobilitydata.rsd.cz/",
    catalogUrl: "https://registr.dopravniinfo.cz/cs/providers/cz-ndic/",
    distributionUrl: "https://registr.dopravniinfo.cz/cs/sources/cz-ndic_d2-common-pull/",
    documentationUrl: "https://registr.dopravniinfo.cz/cs/protocols/cz-ndic_pull-v1.1/",
    contact: "https://mobilitydata.rsd.cz/",
    format: "DATEX II v2.3 SituationPublication + TMC location table (TISA 2.6)",
    fetchMethod: "https-pull-basic-auth",
    datasetId: "cz-ndic_d2-common-pull",
    distributionId: "cz-ndic_pull-v1.1",
    datasetLabel: "DATEX II — Běžné dopravní informace (snímek) + TMC lokační tabulka CC2/LTN25",
    commercialUseAllowed: true,
    adSupportedUseAllowed: true,
    sponsoredContentContextAllowed: true,
    affiliateContextAllowed: false,
    automationAllowed: true,
    storageAllowed: true,
    cacheAllowed: true,
    // Licence: no standalone redistribution of raw NDIC/TMC datasets
    redistributionAllowed: false,
    publicDisplayAllowed: true,
    modificationAllowed: true,
    normalizationAllowed: true,
    metadataEnrichmentAllowed: true,
    combinationAllowed: true,
    aggregationAllowed: true,
    derivativesAllowed: true,
    crossSourceDisplayAllowed: true,
    databaseCreationAllowed: true,
    derivedDatabaseAllowed: true,
    shareAlike: false,
    odblOrShareAlikeRisk: false,
    copyrightStatus: "contract-free-of-charge-ndic",
    databaseRightsStatus: "covered-by-ndic-subscription-terms",
    extractionAllowed: true,
    reuseAllowed: true,
    systematicExtractionAllowed: false,
    archiveAllowed: true,
    copyrightCleared: "yes-contract-ndic",
    databaseRightsCleared: "yes-per-ndic-terms",
    thirdPartyContentRisk: "low-official-traffic-fields",
    personalDataRisk: "low-no-personal-fields-in-allowlist",
    fieldAllowlist: LINK_ONLY_FIELDS.concat([
      "summary",
      "status",
      "lifecycle",
      "validFrom",
      "validTo",
      "roadNumber",
      "direction",
      "attribution",
      "badge",
    ]),
    attributionTemplateId: "attr-ndic-v1",
    productionSourceActive: true,
    evidence: [
      {
        url: "https://registr.dopravniinfo.cz/cs/sources/cz-ndic_d2-common-pull/",
        kind: "national-traffic-registry-source",
        checkedAt: NOW,
        note: "Oficiální registr: DATEX II běžné dopravní informace, licence Contract and Free of charge",
      },
      {
        url: "https://registr.dopravniinfo.cz/cs/sources/cz-ndic_tmc-location-table-v11.0/",
        kind: "national-traffic-registry-tmc",
        checkedAt: NOW,
        note: "TMC lokační tabulka (TABCD/LTN 25) — interní lokalizace, zákaz veřejné redistribuce tabulky",
      },
      {
        url: "https://registr.dopravniinfo.cz/cs/protocols/cz-ndic_pull-v1.1/",
        kind: "protocol-spec",
        checkedAt: NOW,
        note: "HTTP PULL v1.1 + Basic Auth + If-Modified-Since/ETag",
      },
      {
        url: "https://mobilitydata.rsd.cz/",
        kind: "subscription-portal",
        checkedAt: NOW,
        note: "MobilityData registr odběrů ŘSD/NDIC",
      },
    ],
    conditionsEvidenceUrl: "https://registr.dopravniinfo.cz/cs/sources/cz-ndic_d2-common-pull/",
    specificConditions: [
      "Povinná veřejná atribuce u každé dopravní položky: „Zdroj: NDIC“ (kde vhodné i plná formulace o digitalizovaných informacích NDIC).",
      "Zákaz dojmu partnerství/garance ŘSD nebo NDIC vůči službě InfoUzel.cz.",
      "Zákaz veřejné redistribuce surového DATEX/NDIC feedu a kompletní TMC lokační tabulky; data jen jako součást služby InfoUzel.",
      "TMC tabulka (kód země 2, číslo tabulky 25) pouze interní lokalizace na serveru.",
      "Kill switch IU_NDIC_DATEX_V1_MODE musí umožnit bezpečné vypnutí publikace bez mazání historie.",
    ],
    rationale:
      "Schválený odběr digitalizovaných dopravních informací NDIC a TMC LTN 25 pro lokalizaci a zobrazení ve službě InfoUzel.cz (MobilityData). Licence Contract and Free of charge dle národního registru; redistribuce raw datasetu zakázána specifickými podmínkami.",
    legalNotes:
      "Nepublikovat přístupové údaje MobilityData. Nepřikládat schvalovací e-maily ani podepsané smlouvy do repozitáře ani do veřejné aplikace.",
    technicalLimits: "HTTP PULL Basic Auth; conditional GET; sync interval konfigurovatelný (default 5 min).",
    updatePeriodicityMin: 5,
  });
}

/** ČHMÚ open data — CC BY 4.0 (documented on chmi.cz FAQ + opendata portal). */
function chmiApproved(src) {
  return baseRights({
    status: "APPROVED_CC_BY",
    licenseLabel: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    termsUrl: "https://www.chmi.cz/o-chmu/produkty-a-sluzby/data-a-vyhodnoceni",
    nkodUrl: "https://data.gov.cz/datov%C3%A9-sady?poskytovatel=%C4%8Cesk%C3%BD%20hydrometeorologick%C3%BD%20%C3%BAstav",
    catalogUrl: "https://opendata.chmi.cz/",
    distributionUrl: "https://opendata.chmi.cz/",
    documentationUrl: "https://www.chmi.cz/o-chmu/produkty-a-sluzby/data-a-vyhodnoceni",
    contact: "https://www.chmi.cz/",
    format: "JSON/CSV/CAP-feed",
    fetchMethod: "https-get",
    datasetId: "chmi-opendata-national-hydromet-db",
    distributionId: "chmi-opendata-portal-primary",
    datasetLabel: "Národní databáze hydrometeorologických údajů a produktů / výstrahy",
    commercialUseAllowed: true,
    adSupportedUseAllowed: true,
    sponsoredContentContextAllowed: true,
    affiliateContextAllowed: true,
    automationAllowed: true,
    storageAllowed: true,
    cacheAllowed: true,
    redistributionAllowed: true,
    publicDisplayAllowed: true,
    modificationAllowed: true,
    normalizationAllowed: true,
    metadataEnrichmentAllowed: true,
    combinationAllowed: true,
    aggregationAllowed: true,
    derivativesAllowed: true,
    crossSourceDisplayAllowed: true,
    databaseCreationAllowed: true,
    derivedDatabaseAllowed: true,
    shareAlike: false,
    odblOrShareAlikeRisk: false,
    copyrightStatus: "licensed-cc-by-4.0",
    databaseRightsStatus: "covered-by-stated-cc-by-terms",
    extractionAllowed: true,
    reuseAllowed: true,
    systematicExtractionAllowed: true,
    archiveAllowed: true,
    copyrightCleared: "yes-cc-by-4.0",
    databaseRightsCleared: "yes-per-provider-terms",
    thirdPartyContentRisk: "low-open-data-fields",
    personalDataRisk: "low-no-personal-fields-in-allowlist",
    fieldAllowlist: LINK_ONLY_FIELDS.slice(),
    attributionTemplateId: "attr-open-data-by-v1",
    productionSourceActive: true,
    evidence: [
      {
        url: "https://www.chmi.cz/-/jak-mohu-pou%C5%BE%C3%ADvat-otev%C5%99en%C3%A1-data-%C4%8Dhm%C3%BA-",
        kind: "provider-faq-license",
        checkedAt: NOW,
        note: "ČHMÚ FAQ: otevřená data bezplatně při respektování CC BY 4.0",
      },
      {
        url: "https://www.chmi.cz/o-chmu/produkty-a-sluzby/data-a-vyhodnoceni",
        kind: "provider-open-data-hub",
        checkedAt: NOW,
        note: "Oficiální rozcestník otevřených dat + odkaz na opendata.chmi.cz a NKOD metadata",
      },
      {
        url: "https://creativecommons.org/licenses/by/4.0/",
        kind: "license-text",
        checkedAt: NOW,
        note: "Plné znění CC BY 4.0",
      },
      {
        url: "https://opendata.chmi.cz/",
        kind: "distribution-portal",
        checkedAt: NOW,
        note: "Národní databáze hydrometeorologických údajů a produktů",
      },
    ],
    conditionsEvidenceUrl: "https://www.chmi.cz/o-chmu/produkty-a-sluzby/data-a-vyhodnoceni",
    specificConditions: [
      "Povinná atribuce ČHMÚ dle CC BY 4.0.",
      "Produktový režim InfoUzel: link-only / vybraná metadata dle fieldAllowlist (bez fotografií a dlouhých textů třetích stran).",
      "Kombinování s jinými schválenými zdroji ve společném feedu je povoleno.",
    ],
    rationale:
      "Phase-2: konkrétní CC BY 4.0 doložena z oficiálního FAQ ČHMÚ a open-data hubu; komerční použití a reklama jsou v rámci CC BY přípustné.",
    legalNotes: "Nezaměňovat placené posudkové služby ČHMÚ s otevřenými daty na opendata.chmi.cz.",
    productionSourceActive: true,
  });
}

/** Official body without distribution-level open license proof — cannot stay production-active. */
function unclearLicense(src, note) {
  return baseRights({
    status: "LICENSE_UNCLEAR",
    licenseLabel: "Nepodložená interim licence (phase-1 APPROVED_WITH_SPECIFIC_CONDITIONS zrušeno)",
    datasetId: "pending-" + src.id,
    distributionId: "pending-" + src.id + "-primary",
    datasetLabel: src.label || src.id,
    catalogUrl: src.homeUrl || src.url || "",
    distributionUrl: src.feedUrl || src.homeUrl || "",
    documentationUrl: src.homeUrl || "",
    fieldAllowlist: LINK_ONLY_FIELDS.slice(),
    evidence: [
      "docs/info-system-v1/12-legal-whitelist-audit.md",
      "docs/info-system-v1/14-legal-phase2-decisions.md",
    ],
    rationale:
      note ||
      "Phase-2: chybí konkrétní licenseUrl/termsUrl u distribuce používané ingestem (RSS/tiskové zprávy ≠ doložená open-data licence).",
    legalNotes:
      "Zdroj byl v phase-1 interim schválen link-only. Bez dohledatelné licence konkrétní distribuce nesmí zůstat produkčně aktivní.",
    productionSourceActive: false,
    attributionTemplateId: "attr-gov-link-only-v1",
  });
}

function reviewPublicMedia(src) {
  return baseRights({
    status: "LEGAL_REVIEW_REQUIRED",
    licenseLabel: "Veřejnoprávní médium — licence RSS/titulků nedoložena",
    termsUrl: src.homeUrl || "",
    datasetId: "pending-" + src.id,
    distributionId: "pending-" + src.id + "-rss",
    datasetLabel: src.label || src.id,
    catalogUrl: src.homeUrl || "",
    distributionUrl: src.feedUrl || "",
    fieldAllowlist: LINK_ONLY_FIELDS.slice(),
    evidence: ["docs/info-system-v1/12-legal-whitelist-audit.md"],
    rationale: "Veřejnoprávní charakter neznamená otevřenou licenci; produkce zakázána do doložení oprávnění.",
    productionSourceActive: false,
    attributionTemplateId: "attr-media-pending-v1",
  });
}

function rejectedCommercial(id, label) {
  return baseRights({
    status: "REJECTED",
    sourceId: id,
    institution: label,
    providerLabel: label,
    licenseLabel: "Komerční médium — bez open licence / souhlasu",
    datasetId: "rejected-" + id,
    distributionId: "rejected-" + id,
    datasetLabel: label,
    fieldAllowlist: [],
    evidence: ["docs/info-system-v1/12-legal-whitelist-audit.md"],
    rationale: "Komerční média nejsou přebírána bez výslovné open licence nebo bezplatného API souhlasu.",
    attributionTemplateId: "attr-rejected-commercial-v1",
    productionSourceActive: false,
  });
}

function techReview(src, note) {
  return baseRights({
    status: "TECHNICAL_REVIEW_REQUIRED",
    datasetId: "pending-" + src.id,
    distributionId: "pending-" + src.id,
    datasetLabel: src.label || src.id,
    catalogUrl: src.homeUrl || "",
    rationale: note || "Technický konektor / přístup vyžaduje dokončení před právním schválením produkce.",
    productionSourceActive: false,
  });
}

function compatReview(src, note) {
  return baseRights({
    status: "LEGAL_COMPATIBILITY_REVIEW_REQUIRED",
    datasetId: "pending-" + src.id,
    distributionId: "pending-" + src.id,
    datasetLabel: src.label || src.id,
    catalogUrl: src.homeUrl || "",
    odblOrShareAlikeRisk: true,
    shareAlikeCompatibleWithInfoUzel: false,
    rationale: note || "Možný ShareAlike/ODbL nebo databázový konflikt — vyžaduje oddělený legal compat review.",
    productionSourceActive: false,
  });
}

const COMMERCIAL = [
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

/** Per-source legal decision map (phase-2). */
const AUDIT = {
  chmi: (s) => chmiApproved(s),
  "policie-cr": (s) => unclearLicense(s),
  "hzs-cr": (s) => unclearLicense(s),
  mvcr: (s) => unclearLicense(s),
  mzcr: (s) => unclearLicense(s),
  mze: (s) => unclearLicense(s),
  mfcr: (s) => unclearLicense(s),
  mpo: (s) => unclearLicense(s),
  nukib: (s) => unclearLicense(s),
  coi: (s) => unclearLicense(s),
  ctu: (s) => unclearLicense(s),
  eru: (s) => unclearLicense(s),
  sukl: (s) => unclearLicense(s),
  svs: (s) => unclearLicense(s),
  szpi: (s) => unclearLicense(s),
  szu: (s) => unclearLicense(s),
  rsd: (s) =>
    unclearLicense(
      s,
      "ŘSD HTML web není schválený strojový kanál; dopravní data jdou přes NDIC DATEX II (zdroj ndic)."
    ),
  szdc: (s) => unclearLicense(s),
  vlada: (s) => unclearLicense(s),
  avcr: (s) => unclearLicense(s),
  "khs-praha": (s) => unclearLicense(s),
  "khs-stc": (s) => unclearLicense(s),
  "khs-plzen": (s) => unclearLicense(s),
  "kraj-liberecky": (s) => unclearLicense(s),
  "kraj-pardubicky": (s) => unclearLicense(s),
  "kraj-zlinsky": (s) => unclearLicense(s),
  ct24: (s) => reviewPublicMedia(s),
  irozhlas: (s) => reviewPublicMedia(s),
  ndic: (s) => ndicApproved(s),
  esbirka: (s) => techReview(s),
  "registr-smluv": (s) =>
    baseRights({
      status: "PERSONAL_DATA_REVIEW_REQUIRED",
      datasetId: "pending-registr-smluv",
      distributionId: "pending-registr-smluv",
      datasetLabel: s.label || s.id,
      personalDataRisk: "high",
      rationale: "Registr smluv může obsahovat osobní/identifikační údaje smluvních stran — GDPR review před publikací.",
      productionSourceActive: false,
    }),
  cnb: (s) => techReview(s),
  cssz: (s) => techReview(s),
  csu: (s) => techReview(s),
  mdcr: (s) => techReview(s),
  mkcr: (s) => techReview(s),
  msmt: (s) => techReview(s),
  "portal-gov": (s) => techReview(s),
  "urad-prace": (s) => techReview(s),
};

function loadNkodDiscovery() {
  if (!fs.existsSync(NKOD_INV)) return [];
  const inv = JSON.parse(fs.readFileSync(NKOD_INV, "utf8"));
  return (inv.datasets || []).slice(0, 120).map((d, i) => ({
    id: "nkod-phase2-" + String(i + 1).padStart(4, "0"),
    status: "DISCOVERED",
    title: d.title,
    publisher: d.publisher,
    nkodDatasetUrl: d.nkodDatasetUrl,
    sampleAccessURL: d.sampleAccessURL,
    queryBucket: d.queryBucket,
    distributionCount: d.distributionCount,
    note: "Phase-2 SPARQL discovery — licence musí být ověřena na úrovni konkrétní distribuce před APPROVED_*.",
    discoveredAt: inv.generatedAt || NOW,
  }));
}

function main() {
  const registry = JSON.parse(fs.readFileSync(SRC, "utf8"));
  const entries = [];
  let approved = 0;
  let suspended = 0;
  let rejected = 0;
  let unclear = 0;

  for (const src of registry.entries || []) {
    const fn = AUDIT[src.id];
    if (!fn) throw new Error("AUDIT missing for sourceId=" + src.id);
    const legal = fn(src);
    const row = Object.assign(
      {
        id: "legal-" + src.id,
        sourceId: src.id,
        institution: src.label || src.id,
        providerLabel: src.label || src.id,
        group: src.group || "",
        lane: src.lane || "",
      },
      legal
    );
    // Sync production flags on source registry
    const canApprove = APPROVED_STATUSES.includes(row.status) && row.productionSourceActive === true;
    if (canApprove) {
      src.productionActive = true;
      src.productionApproved = true;
      src.legalStatus = "approved";
      approved += 1;
    } else {
      src.productionActive = false;
      // keep productionApproved false when not legally clear
      if (row.status.startsWith("REJECTED")) {
        src.productionApproved = false;
        src.legalStatus = "rejected";
        rejected += 1;
      } else if (row.status === "SUSPENDED") {
        src.productionApproved = false;
        src.legalStatus = "suspended";
        suspended += 1;
      } else {
        src.productionApproved = false;
        src.legalStatus = "review";
        if (row.status === "LICENSE_UNCLEAR") unclear += 1;
      }
    }
    if (!ALL_STATUSES.includes(row.status)) throw new Error("bad status " + row.status);
    entries.push(row);
  }

  for (const [id, label] of COMMERCIAL) {
    const row = Object.assign({ id: "legal-" + id, sourceId: id, institution: label, providerLabel: label, group: "commercial-media", lane: "rejected" }, rejectedCommercial(id, label));
    entries.push(row);
    rejected += 1;
  }

  const nkodDiscovery = loadNkodDiscovery();
  const out = {
    version: "2.0.0",
    generatedAt: NOW,
    schema: "iu-info-events-legal-source-registry-v2",
    phase: 2,
    productModel: {
      commercialSite: true,
      advertisingAllowed: true,
      sponsoredContentAllowed: true,
      aggregationModel: "link-only-official-open-data",
    },
    gate: {
      enforceHard: true,
      phase2EvidenceRequired: true,
      allowedStatuses: APPROVED_STATUSES.slice(),
      requiredFlags: [
        "commercialUseAllowed",
        "adSupportedUseAllowed",
        "sponsoredContentContextAllowed",
        "automationAllowed",
        "storageAllowed",
        "cacheAllowed",
        "publicDisplayAllowed",
        "modificationAllowed",
        "normalizationAllowed",
        "metadataEnrichmentAllowed",
        "combinationAllowed",
        "aggregationAllowed",
        "crossSourceDisplayAllowed",
      ],
      requireLicenseUrl: true,
      requireExternalEvidence: true,
      requireFieldAllowlist: true,
      requireFreshReaudit: true,
      publishRequiresLegalProvenanceOnItem: true,
    },
    attributionTemplates: ATTR,
    statusEnum: ALL_STATUSES.slice(),
    nkodDiscovery,
    stats: {
      entries: entries.length,
      approved,
      notApproved: entries.length - approved,
      licenseUnclear: unclear,
      rejected,
      suspended,
      nkodDiscovered: nkodDiscovery.length,
      productionActiveSources: (registry.entries || []).filter((e) => e.productionActive).length,
    },
    entries,
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");
  fs.writeFileSync(SRC, JSON.stringify(registry, null, 2) + "\n", "utf8");
  console.log("[legal-registry-build] phase2 entries=" + entries.length + " approved=" + approved + " nkod=" + nkodDiscovery.length);
  console.log("[legal-registry-build] wrote " + path.relative(REPO, OUT));
  console.log("[legal-registry-build] synced " + path.relative(REPO, SRC));
}

main();
