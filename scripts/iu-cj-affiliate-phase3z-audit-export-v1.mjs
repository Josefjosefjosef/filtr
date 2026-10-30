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
  "OWNERSHIP-UNASSIGNED.csv",
  toCsv(
    partners.map((p) => ({
      partnerId: p.partnerId,
      advertiserId: p.advertiserId,
      displayNameCs: p.displayNameCs,
      management: p.management,
      ownership: p.chipOwnership?.ownership,
      takeoverEligible: p.chipOwnership?.takeoverEligible,
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
      "meaning",
      "publishability",
      "hasButton",
      "historicalUrlCopied",
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

// Manifest with portable forward-slash paths (exclude MANIFEST itself first)
const files = walkFiles(dir).filter((f) => f.rel !== "MANIFEST.json");
const manifestFiles = files.map((f) => ({
  path: f.rel,
  bytes: fs.statSync(f.full).size,
  sha256: sha256File(f.full),
}));
const manifest = {
  phase: "3Z-V3",
  rulesVersion: reg.rulesVersion,
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
  })
);
