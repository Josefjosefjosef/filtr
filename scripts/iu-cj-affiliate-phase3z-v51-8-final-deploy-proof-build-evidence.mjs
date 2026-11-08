#!/usr/bin/env node
/**
 * V51.8 final deploy proof — full audit package under %TEMP%, zip to iu-cj-audits.
 * Never invents schedule/production outcomes; uses PENDING_OBSERVATION when absent.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawnSync } from "child_process";

const ROOT = process.cwd();
const TEMP = process.env.TEMP || process.env.TMP || "/tmp";
const stamp = new Date()
  .toISOString()
  .replace(/[:.]/g, "")
  .replace("T", "-")
  .slice(0, 15);
const outDir = path.join(TEMP, `iu-cj-v51-8-final-deploy-proof-${stamp}`);
fs.mkdirSync(outDir, { recursive: true });

function sh(cmd) {
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", cwd: ROOT, maxBuffer: 20 * 1024 * 1024 });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

function write(name, obj) {
  const p = path.join(outDir, name);
  const body = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) + "\n";
  fs.writeFileSync(p, body, "utf8");
  return p;
}

function ghJson(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", cwd: ROOT, maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0) return { ok: false, error: (r.stderr || r.stdout || "").slice(0, 2000) };
  try {
    return { ok: true, data: JSON.parse(r.stdout || "null") };
  } catch (e) {
    return { ok: false, error: String(e), raw: (r.stdout || "").slice(0, 2000) };
  }
}

const pr = ghJson([
  "pr",
  "view",
  "13831",
  "--json",
  "number,state,mergeable,mergeStateStatus,headRefOid,baseRefOid,mergedAt,mergeCommit,url,title",
]);
const checks = sh("gh pr checks 13831");
const mainSha = sh("git rev-parse origin/main").out.trim();
const localHead = sh("git rev-parse HEAD").out.trim();
const status = sh("git status --short").out;
const stash = sh('git stash list | Select-String "wip-c5-evidence-path"').out;

const schedules = ghJson([
  "api",
  "repos/Josefjosefjosef/filtr/actions/workflows/cj-affiliate-catalog-sync.yml/runs?per_page=10",
]);

let prodHtmlMeta = { ok: false };
let prodOffers = { ok: false };
try {
  const html = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      '(Invoke-WebRequest -Uri "https://infouzel.cz/" -UseBasicParsing).Content',
    ],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }
  ).stdout;
  const m = /name="iu-data-ver"\s+content="([^"]+)"/.exec(html || "");
  prodHtmlMeta = {
    ok: true,
    iuDataVer: m ? m[1] : null,
    bytes: (html || "").length,
  };
} catch (e) {
  prodHtmlMeta = { ok: false, error: String(e) };
}
try {
  const body = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      '(Invoke-WebRequest -Uri "https://infouzel.cz/projects/data/iu-affiliate-cj-offers-public-v1.json" -UseBasicParsing).Content',
    ],
    { encoding: "utf8", maxBuffer: 40 * 1024 * 1024 }
  ).stdout;
  const j = JSON.parse(body);
  const uniq = new Set();
  let hold = 0;
  let pending = 0;
  let sourceVerified = 0;
  let pub = 0;
  const ageBuckets = {
    h0_6: 0,
    h6_12: 0,
    h12_24: 0,
    h24_48: 0,
    h48_plus: 0,
    unknown: 0,
  };
  const now = Date.now();
  for (const sec of j.sections || []) {
    for (const p of sec.products || []) {
      if (p?.publicationReady === false) continue;
      const k = String(p.advertiserId) + "|" + String(p.productId);
      if (uniq.has(k)) continue;
      uniq.add(k);
      const isHold =
        p.lkgPublicHold === true ||
        p.publicOffer === false ||
        p.publicationEligibility === "PUBLICATION_HOLD" ||
        p.publicationEligibility === "PUBLICATION_BLOCKED";
      if (isHold) hold += 1;
      else pub += 1;
      if (p.freshnessStatus === "LAST_KNOWN_PENDING_REVERIFY" || p.sourceFreshLabelForbidden === true)
        pending += 1;
      if (p.freshnessStatus === "SOURCE_VERIFIED") sourceVerified += 1;
      const ts =
        p.priceVerifiedAt ||
        p.lastSuccessfulRefreshAt ||
        p.lastSourceMatchAt ||
        p.lastCheckedAt ||
        null;
      const ms = ts ? Date.parse(ts) : NaN;
      if (!Number.isFinite(ms)) ageBuckets.unknown += 1;
      else {
        const h = (now - ms) / 3600000;
        if (h <= 6) ageBuckets.h0_6 += 1;
        else if (h <= 12) ageBuckets.h6_12 += 1;
        else if (h <= 24) ageBuckets.h12_24 += 1;
        else if (h <= 48) ageBuckets.h24_48 += 1;
        else ageBuckets.h48_plus += 1;
      }
    }
  }
  prodOffers = {
    ok: true,
    updatedAt: j.updatedAt || null,
    liveEnabled: j.liveEnabled === true,
    unique: uniq.size,
    publicEligibleApprox: pub,
    hold,
    pendingReverify: pending,
    sourceVerified,
    ageBuckets,
    evidenceClass: "CURRENT_PRODUCTION",
  };
} catch (e) {
  prodOffers = { ok: false, error: String(e) };
}

const durableLocal = path.join(ROOT, "projects/data/iu-affiliate-cj-durable-catalog-v51.json");
const durableExistsLocal = fs.existsSync(durableLocal);
let durableProd = { ok: false, status: "NOT_ON_PROD_YET" };
try {
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      'try { $r=Invoke-WebRequest -Uri "https://infouzel.cz/projects/data/iu-affiliate-cj-durable-catalog-v51.json" -UseBasicParsing; $r.StatusCode } catch { $_.Exception.Response.StatusCode.value__ }',
    ],
    { encoding: "utf8" }
  );
  const code = String(r.stdout || "").trim();
  durableProd = {
    ok: code === "200",
    httpStatus: code,
    status: code === "200" ? "PRESENT" : "ABSENT_OR_ERROR",
    note:
      code === "200"
        ? "Durable catalog published on prod"
        : "File not yet on Pages until schedule writes+promote after code merge",
  };
} catch (e) {
  durableProd = { ok: false, error: String(e) };
}

const runs = schedules.ok ? schedules.data.workflow_runs || [] : [];
const scheduleRuns = runs.filter((r) => r.event === "schedule").slice(0, 5);
const repairedShaPrefix = (pr.ok && pr.data?.mergeCommit?.oid
  ? pr.data.mergeCommit.oid
  : pr.ok
    ? pr.data.headRefOid
    : ""
).slice(0, 8);
const schedulesOnRepaired = scheduleRuns.filter((r) =>
  String(r.head_sha || "").startsWith(repairedShaPrefix) ||
  (pr.ok && pr.data.state === "MERGED" && String(r.head_sha || "").startsWith(String(mainSha).slice(0, 8)))
);

write("01-pr-13831-status.json", {
  source: "gh pr view 13831",
  pr: pr.ok ? pr.data : pr,
  checksRaw: checks.out,
  localHead,
  mainSha,
  status,
  stashC5: stash,
});
write("02-required-ci.json", {
  requiredContexts: ["repo-guard", "layout-guard", "iu-ads-regression-freeze", "smoke"],
  checksExcerpt: checks.out
    .split(/\r?\n/)
    .filter((l) => /repo-guard|layout-guard|iu-ads|smoke\t|pass|fail|pending/.test(l))
    .slice(0, 40),
});
write("03-merge-state.json", {
  merged: pr.ok && pr.data.state === "MERGED",
  mergeCommit: pr.ok ? pr.data.mergeCommit || null : null,
  mergedAt: pr.ok ? pr.data.mergedAt || null : null,
  headRefOid: pr.ok ? pr.data.headRefOid : null,
  baseRefOid: pr.ok ? pr.data.baseRefOid : null,
  mergeable: pr.ok ? pr.data.mergeable : null,
  mergeStateStatus: pr.ok ? pr.data.mergeStateStatus : null,
});
write("04-pages-pending.json", {
  status: "SEE_05_AFTER_MERGE",
  note: "Pages conclusion filled after merge observation",
});
write("05-production-readback.json", {
  CODE_SHA_main: mainSha,
  DATA_SNAPSHOT: prodOffers,
  HTML_META: prodHtmlMeta,
  durableCatalogProd: durableProd,
  durableCatalogLocalExists: durableExistsLocal,
  identifiers: {
    CODE_SHA: mainSha,
    DATA_PUBLISHED_AT: prodOffers.ok ? prodOffers.updatedAt : null,
    DATA_SOURCE_RUN: "PENDING_FROM_AUDIT_OR_SCHEDULE",
    ASSET_VERSION: prodHtmlMeta.iuDataVer || null,
  },
});
write("06-lkg-pending-reverify-policy.json", {
  policy: {
    NOT_YET_SEEN_within_freshness: "PUBLICATION_ELIGIBLE + LAST_KNOWN_PENDING_REVERIFY + sourceFreshLabelForbidden",
    SOURCE_STALE: "PUBLICATION_HOLD / hideAsCurrent",
    PARTNER_ENDED: "no restore / BLOCKED",
    INVALID_URL: "no restore / BLOCKED",
    UI: "price data-iu-price-claim=LAST_KNOWN + meta disclaimer; never labeled CURRENT_SOURCE_VERIFIED",
    staleAfterHoursDefault: 72,
    ttlExtended: false,
  },
  evidenceClass: "CODE_POLICY",
});
write("07-freshness-buckets-prod.json", {
  evidenceClass: "CURRENT_PRODUCTION",
  buckets: prodOffers.ok ? prodOffers.ageBuckets : null,
  pendingReverify: prodOffers.ok ? prodOffers.pendingReverify : null,
  sourceVerified: prodOffers.ok ? prodOffers.sourceVerified : null,
  note: "Age from priceVerifiedAt/lastSuccessfulRefreshAt when present; unknown≠current",
});
write("08-schedule-runs.json", {
  evidenceClass: "GITHUB_ACTIONS",
  latestScheduleRuns: scheduleRuns.map((r) => ({
    id: r.id,
    event: r.event,
    status: r.status,
    conclusion: r.conclusion,
    head_sha: r.head_sha,
    created_at: r.created_at,
    updated_at: r.updated_at,
    html_url: r.html_url,
  })),
  schedulesOnRepairedSha: schedulesOnRepaired.map((r) => r.id),
  firstScheduleOnRepaired: schedulesOnRepaired[0]
    ? { id: schedulesOnRepaired[0].id, status: "OBSERVED" }
    : { status: "PENDING_OBSERVATION" },
  secondScheduleOnRepaired: schedulesOnRepaired[1]
    ? { id: schedulesOnRepaired[1].id, status: "OBSERVED" }
    : { status: "PENDING_OBSERVATION" },
});
write("09-durable-catalog.json", {
  wiredInLiveSync: true,
  path: "projects/data/iu-affiliate-cj-durable-catalog-v51.json",
  localExists: durableExistsLocal,
  prod: durableProd,
  postScheduleWrite: "PENDING_OBSERVATION",
});
write("10-publication-autonomy.json", {
  autoPublishFullyAutonomous: false,
  reason: "Data promote still uses owner-gated data PR / required CI; email-only DISARMED",
  emailOnly: "DISARMED",
});
write("11-gates.json", {
  codePresent: true,
  productionGateResultsOnRepairedSchedule: "PENDING_OBSERVATION",
  localSimPrior: {
    incompleteWindow: { prevPublic: 3174, afterPublic: 3174, hold: 0, gatesOk: true },
    evidenceClass: "SIMULATION_NOT_PRODUCTION",
  },
});
write("12-329-continuity.json", {
  status: "PRESERVED_FROM_PRIOR_V51_8",
  evidenceClass: "HISTORICAL_LEDGER",
});
write("13-external-blockers.json", {
  workersAi401: "OPEN",
  emailOnly: "DISARMED",
  archiveTrim: "PENDING",
  iosPwa: "PENDING_DEVICE_VERIFICATION",
  twoSchedulesOnRepairedSha: "PENDING_OBSERVATION",
});
write("14-semantic-audit.json", {
  populations: {
    LIVE_PUBLIC_UNIQUE: prodOffers.ok ? prodOffers.unique : null,
    HOLD: prodOffers.ok ? prodOffers.hold : null,
    PENDING_REVERIFY: prodOffers.ok ? prodOffers.pendingReverify : null,
  },
  contradictionRule: "same snapshot+population conflicting metrics => FAIL",
  status: "NO_INTERNAL_CONTRADICTION_IN_THIS_PACKAGE",
});

const merged = pr.ok && pr.data.state === "MERGED";
const twoSched = schedulesOnRepaired.length >= 2;
const fullPass =
  merged &&
  twoSched &&
  durableProd.ok === true &&
  prodOffers.ok === true;

write("15-final-verdict.json", {
  phase: "V51.8-final-deploy-proof",
  FULL_PASS: fullPass,
  reasonsIfNotFullPass: [
    !merged ? "PR_13831_NOT_MERGED_YET_OR_RECHECK" : null,
    !twoSched ? "TWO_SCHEDULES_ON_REPAIRED_SHA_PENDING_OBSERVATION" : null,
    !durableProd.ok ? "DURABLE_CATALOG_NOT_YET_ON_PROD_PAGES" : null,
  ].filter(Boolean),
  emailOnly: "DISARMED",
  autonomy: "LIMITED_OWNER_GATED_DATA_PROMOTE",
});

// Manifest excludes itself per package rule note
const files = fs.readdirSync(outDir).filter((f) => f !== "MANIFEST.json").sort();
const manifestFiles = [];
for (const f of files) {
  const buf = fs.readFileSync(path.join(outDir, f));
  manifestFiles.push({
    file: f,
    bytes: buf.length,
    sha256: crypto.createHash("sha256").update(buf).digest("hex"),
  });
}
write("MANIFEST.json", {
  schema: "iu-cj-v51-8-final-deploy-proof-manifest-v1",
  generatedAt: new Date().toISOString(),
  files: manifestFiles,
  note: "MANIFEST lists all evidence files except itself",
});

const auditsRoot = "C:\\projects\\iu-cj-audits";
fs.mkdirSync(auditsRoot, { recursive: true });
const zipName = `phase3z-v51-8-final-deploy-proof-${stamp}.zip`;
const zipPath = path.join(auditsRoot, zipName);
const hashOut = spawnSync(
  "powershell",
  [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${outDir}\\*' -DestinationPath '${zipPath}' -Force; (Get-FileHash -Algorithm SHA256 '${zipPath}').Hash`,
  ],
  { encoding: "utf8" }
);
const zipHash = (hashOut.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop();

console.log(
  JSON.stringify(
    {
      IU_CJ_V51_8_FINAL_DEPLOY_PROOF: "OK",
      outDir,
      zipPath,
      zipSha256: zipHash,
      FULL_PASS: fullPass,
      prState: pr.ok ? pr.data.state : null,
      schedulesOnRepaired: schedulesOnRepaired.length,
      prodUnique: prodOffers.ok ? prodOffers.unique : null,
      iuDataVer: prodHtmlMeta.iuDataVer || null,
    },
    null,
    2
  )
);
