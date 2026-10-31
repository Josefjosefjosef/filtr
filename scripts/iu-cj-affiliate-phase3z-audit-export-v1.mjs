#!/usr/bin/env node
/**
 * Phase 3Z audit pack exporter — portable paths (forward slashes) + SHA-256 manifest.
 * Never embeds secrets. Writes only under IU_CJ_PHASE3Z_AUDIT_DIR.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(rows, cols) {
  const lines = [cols.join(",")];
  for (const r of rows) {
    lines.push(
      cols
        .map((c) => csvEscape(Array.isArray(r[c]) ? r[c].join("|") : r[c]))
        .join(",")
    );
  }
  return lines.join("\n") + "\n";
}

function write(dir, name, body) {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, "utf8");
}

function sha256File(p) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return h.digest("hex");
}

function walkFiles(root) {
  const out = [];
  function rec(d, relBase) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = relBase ? relBase + "/" + ent.name : ent.name;
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) rec(full, rel);
      else out.push({ rel: rel.replace(/\\/g, "/"), full });
    }
  }
  rec(root, "");
  return out;
}

const dir = process.env.IU_CJ_PHASE3Z_AUDIT_DIR;
const regPath = process.env.IU_CJ_PHASE3Z_REG_PATH;
const btnPath = process.env.IU_CJ_PHASE3Z_BTN_PATH;
if (!dir || !regPath || !btnPath) {
  console.error(
    JSON.stringify({
      ok: false,
      reason: "missing_env",
      need: ["IU_CJ_PHASE3Z_AUDIT_DIR", "IU_CJ_PHASE3Z_REG_PATH", "IU_CJ_PHASE3Z_BTN_PATH"],
    })
  );
  process.exit(1);
}

fs.mkdirSync(dir, { recursive: true });
const reg = JSON.parse(fs.readFileSync(regPath, "utf8"));
const btn = JSON.parse(fs.readFileSync(btnPath, "utf8"));
const partners = reg.partners || [];
const buttons = btn.buttons || [];
const quarantined = btn.quarantined || [];

write(dir, "PARTNER-REGISTRY.json", JSON.stringify(reg, null, 2) + "\n");
write(dir, "NEW-PARTNER-BUTTONS.json", JSON.stringify(btn, null, 2) + "\n");

write(
  dir,
  "PARTNER-REGISTRY.csv",
  toCsv(
    partners.map((p) => ({
      ...p,
      urlVerificationStatus: p.urlVerification?.status || "",
      ownership: p.chipOwnership?.ownership || "",
      takeoverEligible: p.chipOwnership?.takeoverEligible,
    })),
    [
      "partnerId",
      "advertiserId",
      "cjName",
      "displayNameCs",
      "management",
      "ownership",
      "takeoverEligible",
      "sectionId",
      "sectionSource",
      "sectionRule",
      "publishability",
      "holdReason",
      "buttonRecordStatus",
      "selectedLanguage",
      "czMarketEligibilityVerified",
      "selectedClickUrl",
      "selectedDestination",
      "urlVerificationStatus",
      "categoryKey",
    ]
  )
);

write(
  dir,
  "NEW-PARTNER-BUTTONS.csv",
  toCsv(
    buttons.map((b) => ({
      ...b,
      urlVerificationStatus: b.urlVerification?.status || "",
      httpStatus: b.urlVerification?.httpStatus ?? "",
      finalHost: b.urlVerification?.finalHost || "",
      ownership: b.chipOwnership?.ownership || "",
    })),
    [
      "partnerId",
      "advertiserId",
      "displayNameCs",
      "management",
      "ownership",
      "sectionId",
      "publishability",
      "holdReason",
      "buttonRecordStatus",
      "selectedLanguage",
      "clickUrl",
      "destination",
      "linkId",
      "urlVerificationStatus",
      "httpStatus",
      "finalHost",
    ]
  )
);

write(
  dir,
  "QUARANTINED-PARTNERS.csv",
  toCsv(quarantined, [
    "partnerId",
    "advertiserId",
    "displayNameCs",
    "holdReason",
    "management",
    "sectionId",
    "categoryKey",
    "sectionRule",
    "publishability",
  ])
);

write(
  dir,
  "CATEGORY-DECISIONS.csv",
  toCsv(
    partners.map((p) => ({
      partnerId: p.partnerId,
      advertiserId: p.advertiserId,
      displayNameCs: p.displayNameCs,
      sectionId: p.sectionId,
      sectionTitleCs: p.sectionTitleCs,
      sectionSource: p.sectionSource,
      sectionRule: p.sectionRule,
      sectionConfidence: p.sectionConfidence,
      categoryKey: p.categoryKey,
      categoryChangeFrom: p.categoryChange?.from || "",
      categoryChangeTo: p.categoryChange?.to || "",
      categoryChangeReason: p.categoryChange?.reason || "",
    })),
    [
      "partnerId",
      "advertiserId",
      "displayNameCs",
      "sectionId",
      "sectionTitleCs",
      "sectionSource",
      "sectionRule",
      "sectionConfidence",
      "categoryKey",
      "categoryChangeFrom",
      "categoryChangeTo",
      "categoryChangeReason",
    ]
  )
);

write(
  dir,
  "DEDUPLICATION-DECISIONS.csv",
  toCsv(reg.deduplicationDecisions || [], [
    "partnerId",
    "advertiserId",
    "brandKey",
    "merchantDomain",
    "action",
    "reason",
    "confidence",
    "peerAdvertiserIds",
  ])
);

write(
  dir,
  "BRAND-COMPARISON-MATRIX.csv",
  toCsv(reg.brandComparisonMatrix || [], [
    "brandKey",
    "advertiserIds",
    "domains",
    "names",
    "sectionIds",
    "action",
    "reason",
    "merge",
    "confidence",
  ])
);

write(
  dir,
  "AFFILIATE-URL-VERIFICATION.csv",
  toCsv(
    buttons.map((b) => ({
      partnerId: b.partnerId,
      advertiserId: b.advertiserId,
      linkId: b.linkId,
      clickUrl: b.clickUrl,
      destination: b.destination,
      status: b.urlVerification?.status,
      httpStatus: b.urlVerification?.httpStatus,
      finalHost: b.urlVerification?.finalHost,
      finalUrl: b.urlVerification?.finalUrl,
      error: b.urlVerification?.error,
      clientBlockedPossible: b.urlVerification?.clientBlockedPossible,
    })),
    [
      "partnerId",
      "advertiserId",
      "linkId",
      "clickUrl",
      "destination",
      "status",
      "httpStatus",
      "finalHost",
      "finalUrl",
      "error",
      "clientBlockedPossible",
    ]
  )
);

write(
  dir,
  "REGIONAL-SPECIAL-CASES.csv",
  toCsv(reg.regionalSpecialCases || [], [
    "caseId",
    "partnerId",
    "advertiserId",
    "cjName",
    "verdict",
    "reason",
    "selectedTargetedCountries",
    "selectedDestination",
    "publishability",
    "holdReason",
  ])
);

write(
  dir,
  "CATEGORY-CHANGES.csv",
  toCsv(reg.categoryChanges || [], [
    "partnerId",
    "advertiserId",
    "displayNameCs",
    "from",
    "to",
    "reason",
  ])
);

write(
  dir,
  "CJ-SOURCE-TRACEABILITY.csv",
  toCsv(
    partners.map((p) => ({
      partnerId: p.partnerId,
      advertiserId: p.advertiserId,
      stagingGeneratedAt: p.source?.stagingGeneratedAt,
      websitePid: p.source?.websitePid,
      confirmedAt: p.source?.confirmedAt,
      rulesVersion: p.rulesVersion,
      sectionSource: p.sectionSource,
      linkSelectionReason: p.linkSelectionReason,
    })),
    [
      "partnerId",
      "advertiserId",
      "stagingGeneratedAt",
      "websitePid",
      "confirmedAt",
      "rulesVersion",
      "sectionSource",
      "linkSelectionReason",
    ]
  )
);

write(dir, "TAXONOMY-38-AUTHORITATIVE.json", JSON.stringify(reg.taxonomy || {}, null, 2) + "\n");
write(
  dir,
  "TAXONOMY-OCCUPANCY.json",
  JSON.stringify(reg.taxonomyOccupancy || {}, null, 2) + "\n"
);
write(
  dir,
  "UNIFIED-TAKEOVER-PLAN.json",
  JSON.stringify(reg.unifiedTakeoverPlan || {}, null, 2) + "\n"
);
write(
  dir,
  "EVIDENCE-MATRIX.csv",
  toCsv(reg.evidenceMatrix || [], [
    "partnerId",
    "advertiserId",
    "linkId",
    "cjJoined",
    "cjAuthorizationVerified",
    "affiliateUrlPresent",
    "trackingUrlVerified",
    "affiliateUrlVerified",
    "redirectVerified",
    "httpRedirectVerified",
    "httpStatus",
    "urlVerificationStatus",
    "merchantIdentityVerified",
    "merchantIdentityProposed",
    "selectedLanguage",
    "languageVerified",
    "languagePrioritySatisfied",
    "czechLanguageVerified",
    "czechTargetingVerified",
    "czMarketEligibilityVerified",
    "czechAvailabilityVerified",
    "czShippingVerified",
    "czBookingOrServiceVerified",
    "categoryVerified",
    "semanticCategoryVerified",
    "readyForReview",
    "approvedForPublication",
    "evidenceSource",
    "verifiedAt",
    "method",
    "limitation",
  ])
);
write(
  dir,
  "EVIDENCE-CONSISTENCY.json",
  JSON.stringify(reg.evidenceConsistency || {}, null, 2) + "\n"
);
write(
  dir,
  "LANGUAGE-MATRIX.csv",
  toCsv(
    partners.map((p) => ({
      partnerId: p.partnerId,
      advertiserId: p.advertiserId,
      selectedLanguage: p.selectedLanguage,
      languagePrioritySatisfied: p.languagePrioritySatisfied,
      availableLanguages: (p.languageEvidence?.availableLanguages || []).join("|"),
      languageReason: p.languageEvidence?.reason || "",
      czMarketEligibilityVerified: p.czMarketEligibilityVerified,
      publishability: p.publishability,
      holdReason: p.holdReason,
    })),
    [
      "partnerId",
      "advertiserId",
      "selectedLanguage",
      "languagePrioritySatisfied",
      "availableLanguages",
      "languageReason",
      "czMarketEligibilityVerified",
      "publishability",
      "holdReason",
    ]
  )
);
write(
  dir,
  "SAFETY-GATES.json",
  JSON.stringify(reg.safetyGates || btn.safetyGates || {}, null, 2) + "\n"
);
write(
  dir,
  "JOINED-BUTTON-PARITY.json",
  JSON.stringify(
    {
      ok: reg.joinedButtonParity?.ok === true,
      joined: reg.counts?.joined,
      buttonRecords: btn.counts?.buttons,
      difference: Number(reg.counts?.joined || 0) - Number(btn.counts?.buttons || 0),
      parity: reg.joinedButtonParity || null,
      ready: btn.counts?.readyForReview,
      quarantined: btn.counts?.quarantined,
      linkMissing: btn.counts?.linkMissing,
      categoryReviewRequired: btn.counts?.categoryReviewRequired,
      publicButtonSwapArmed: false,
      note: "JOINED count must equal button record count; quarantine is status not omission",
    },
    null,
    2
  ) + "\n"
);
write(
  dir,
  "LINK-SELECTION.json",
  JSON.stringify(
    {
      selectionAudit: reg.selectionAudit || null,
      partners: partners.map((p) => ({
        advertiserId: p.advertiserId,
        displayNameCs: p.displayNameCs,
        selectedLinkId: p.selectedLinkId,
        selectedClickUrl: p.selectedClickUrl,
        selectedDestination: p.selectedDestination,
        selectedDestinationRaw: p.selectedDestinationRaw,
        destinationRole: p.destinationRole,
        selectionReasonNarrative: p.selectionReasonNarrative,
        linkSelectionScore: p.linkSelectionScore,
        linkSelectionReason: p.linkSelectionReason,
        languageDecision: p.languageDecision || p.selectedLanguage,
        countryDecision: p.countryDecision || p.selectedTargetedCountries,
        eligibilityEvidence: p.eligibilityEvidence,
        htmlEntitiesDecoded: p.htmlEntitiesDecoded,
        rejectedAlternatives: p.rejectedAlternatives || [],
        lastVerifiedAt: p.lastVerifiedAt,
        technicalVerification: p.technicalVerification || p.urlVerification,
      })),
    },
    null,
    2
  ) + "\n"
);
write(
  dir,
  "LINK-INVENTORY-BY-PARTNER.json",
  JSON.stringify(
    {
      totalLinks: partners.reduce((a, p) => a + Number(p.linkCandidateCount || 0), 0),
      partners: partners.map((p) => ({
        advertiserId: p.advertiserId,
        displayNameCs: p.displayNameCs,
        linkCandidateCount: p.linkCandidateCount,
        linkEligibleCandidateCount: p.linkEligibleCandidateCount,
        inventory: p.linkInventory || [],
      })),
    },
    null,
    2
  ) + "\n"
);
write(
  dir,
  "HTTP-VERIFY-CLASSES.json",
  JSON.stringify(
    {
      byClass: partners.reduce((a, p) => {
        const c = p.urlVerification?.classification || p.technicalVerification?.status || "UNVERIFIED";
        a[c] = (a[c] || 0) + 1;
        return a;
      }, {}),
      rows: partners.map((p) => ({
        advertiserId: p.advertiserId,
        displayNameCs: p.displayNameCs,
        classification: p.urlVerification?.classification || null,
        httpStatus: p.urlVerification?.httpStatus ?? null,
        status: p.urlVerification?.status || null,
        holdReason: p.holdReason,
      })),
    },
    null,
    2
  ) + "\n"
);

write(
  dir,
  "LINK-CANDIDATE-AUDIT.json",
  JSON.stringify(reg.linkCandidateAudit || reg.selectionAudit?.linkCandidateAudit || {}, null, 2) + "\n"
);
write(
  dir,
  "TAXONOMY-SOURCE-OF-TRUTH.json",
  JSON.stringify(
    {
      taxonomy: reg.taxonomy || null,
      reconciliation: reg.taxonomyReconciliation || null,
      occupancy: reg.taxonomyOccupancy || null,
    },
    null,
    2
  ) + "\n"
);
write(
  dir,
  "ASSORTMENT-PROFILES.json",
  JSON.stringify(
    {
      stats: reg.assortmentStats || null,
      partners: partners.map((p) => ({
        advertiserId: p.advertiserId,
        displayNameCs: p.displayNameCs,
        merchantType: p.merchantType,
        sectionId: p.sectionId,
        sectionTitleCs: p.sectionTitleCs,
        assortmentProfile: p.assortmentProfile || null,
        assortmentAlternatives: p.assortmentAlternatives || [],
        categoryHysteresisKept: p.categoryHysteresisKept === true,
        categoryChange: p.categoryChange || null,
      })),
    },
    null,
    2
  ) + "\n"
);
write(
  dir,
  "CATEGORY-SEMANTIC-AUDIT-ALL-PARTNERS.csv",
  toCsv(
    partners.map((p) => {
      const ap = p.assortmentProfile || {};
      const sig = (ap.significantGroups || []).map((g) => g.group || g.sectionId).join("|");
      const alts = (p.assortmentAlternatives || []).map((a) => a.sectionId).join("|");
      return {
        advertiserId: p.advertiserId,
        partner: p.displayNameCs || p.cjName,
        merchantType: p.merchantType || "",
        primaryAssortment: ap.primaryAssortment?.group || ap.primaryAssortment?.sectionId || "",
        secondaryAssortment: ap.secondaryAssortment?.group || ap.secondaryAssortment?.sectionId || "",
        significantGroups: sig,
        previousSectionId: p.categoryChange?.from || "",
        previousSectionTitle: "",
        recommendedSectionId: p.sectionId || "",
        recommendedSectionTitle: p.sectionTitleCs || "",
        alternativeSections: alts,
        evidenceSources: (ap.sources || []).join("|"),
        verifiedAt: ap.checkedAt || p.source?.confirmedAt || "",
        confidence: ap.confidence || p.sectionConfidence || "",
        decisionReason: p.sectionRule || "",
        changeReason: p.categoryChange?.reason || "",
        reviewStatus: p.holdReason || p.publishability || "",
        blockingIssue: p.holdReason || "",
      };
    }),
    [
      "advertiserId",
      "partner",
      "merchantType",
      "primaryAssortment",
      "secondaryAssortment",
      "significantGroups",
      "previousSectionId",
      "previousSectionTitle",
      "recommendedSectionId",
      "recommendedSectionTitle",
      "alternativeSections",
      "evidenceSources",
      "verifiedAt",
      "confidence",
      "decisionReason",
      "changeReason",
      "reviewStatus",
      "blockingIssue",
    ]
  )
);
write(
  dir,
  "MIGRATION-PLAN-DISARMED.json",
  JSON.stringify(
    {
      publicSwapArmed: false,
      mode: "PREP_ONLY",
      invariant: "atomic_cutover_required_no_empty_gap",
      map: buttons.map((b) => ({
        advertiserId: b.advertiserId,
        partnerId: b.partnerId,
        displayNameCs: b.displayNameCs,
        sectionId: b.sectionId,
        cjLinkId: b.linkId,
        clickUrlPresent: Boolean(b.clickUrl),
        publishability: b.publishability,
        holdReason: b.holdReason || null,
        ownership: b.chipOwnership?.ownership || null,
        migrationAction:
          b.publishability === "READY_FOR_REVIEW"
            ? "REPLACE_ON_GO"
            : b.holdReason
              ? "HOLD_NO_PUBLIC_CHIP"
              : "REVIEW",
      })),
      pendingPlan:
        "PENDING partners stay evidential only; never silently keep unauthorized public chips; never mass-drop without replacement set.",
      rollback:
        "LKG restore allowed for technical outage only; never restore proven-prohibited affiliate URLs.",
    },
    null,
    2
  ) + "\n"
);

write(
  dir,
  "OWNERSHIP-UNASSIGNED.csv",
  toCsv(
    partners.map((p) => ({
      partnerId: p.partnerId,
      advertiserId: p.advertiserId,
      displayNameCs: p.displayNameCs,
      management: p.management,
      ownership: p.chipOwnership?.ownership,
      takeoverEligible: p.chipOwnership?.takeoverEligible,
      unifiedManagementTarget: p.chipOwnership?.unifiedManagementTarget || "",
      meaning: p.managementMeaning || p.chipOwnership?.meaning,
      publishability: p.publishability,
      hasButton: buttons.some((b) => b.partnerId === p.partnerId),
      historicalUrlCopied: false,
    })),
    [
      "partnerId",
      "advertiserId",
      "displayNameCs",
      "management",
      "ownership",
      "takeoverEligible",
      "unifiedManagementTarget",
      "meaning",
      "publishability",
      "hasButton",
      "historicalUrlCopied",
    ]
  )
);

// Manifest with portable forward-slash paths (exclude MANIFEST itself first)
const files = walkFiles(dir).filter((f) => f.rel !== "MANIFEST.json");
const manifestFiles = files.map((f) => ({
  path: f.rel,
  bytes: fs.statSync(f.full).size,
  sha256: sha256File(f.full),
}));
const manifest = {
  phase: "3Z-V8",
  rulesVersion: reg.rulesVersion,
  joinedButtonParity: reg.joinedButtonParity || null,
  selectionAudit: reg.selectionAudit || null,
  generatedAt: new Date().toISOString(),
  pathStyle: "portable-forward-slash",
  fileCount: manifestFiles.length,
  files: manifestFiles,
};
write(dir, "MANIFEST.json", JSON.stringify(manifest, null, 2) + "\n");

console.log(
  JSON.stringify({
    ok: true,
    dir,
    fileCount: manifestFiles.length + 1,
    partners: partners.length,
    buttons: buttons.length,
    ready: reg.counts?.readyForReview,
    unassignedWithButton: reg.ownershipSummary?.unassignedWithButton,
    categoryChanges: reg.counts?.categoryChanges,
    taxonomyCount: reg.taxonomy?.taxonomyCount,
  })
);
