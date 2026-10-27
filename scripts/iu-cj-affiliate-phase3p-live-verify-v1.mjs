#!/usr/bin/env node
/**
 * Phase 3P live/staging verify orchestrator (DISARMED).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  applyConfirmedEndedAtomic,
  assertEndedRemovalAllowed,
} from "./iu-cj-affiliate-phase3m-unified-lifecycle-v1.mjs";
import { applyOverlayToSections } from "./iu-cj-affiliate-phase3f-dynamic-catalog-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEBSITE_PID = "101883843";
const u = (n) => "https://www.kqzyfj.com/click-" + WEBSITE_PID + "-" + n;
const failures = [];
function expect(id, cond) {
  if (!cond) failures.push(id);
}

function runNode(rel) {
  const r = spawnSync(process.execPath, [path.join(ROOT, rel)], {
    encoding: "utf8",
    env: process.env,
    cwd: ROOT,
  });
  let json = null;
  try {
    json = JSON.parse(r.stdout || "{}");
  } catch {
    json = { parseError: true, stdout: (r.stdout || "").slice(0, 500) };
  }
  return { code: r.status, json, stderr: r.stderr };
}

const workflow = fs.readFileSync(
  path.join(ROOT, ".github/workflows/cj-affiliate-catalog-sync.yml"),
  "utf8"
);
const fetchSrc = fs.readFileSync(
  path.join(ROOT, "scripts/iu-cj-affiliate-catalog-sync-fetch-v1.mjs"),
  "utf8"
);
const emailWf = fs.readFileSync(
  path.join(ROOT, ".github/workflows/cj-affiliate-email-ingest.yml"),
  "utf8"
);

expect("schedule_live_fetch", /github\.event_name == 'schedule'/.test(workflow));
expect("cron_17_3", /cron:\s*"17 3 \* \* \*"/.test(workflow));
expect("text_link_fetch", /link_search_text_joined|link-type=.*Text Link/.test(fetchSrc));
expect("probe_ids_supported", /IU_CJ_SYNC_PROBE_ADVERTISER_IDS/.test(fetchSrc));
expect("email_connect_gate_documented", /IU_FORPSI_IMAP_CONNECT_APPROVED/.test(emailWf));

const mig = runNode("scripts/iu-cj-affiliate-phase3p-migration-plan-v1.mjs");
expect("migration_plan_ok", mig.code === 0 && mig.json.OK === true);
expect("production_not_executed", mig.json.executeNow === false && mig.json.productionMigrated === false);
expect(
  "migration_status_known",
  mig.json.status === "STAGING_ABSENT_PLAN_SKIPPED" ||
    mig.json.verified?.plannedMigrate >= 1 ||
    typeof mig.json.verified?.plannedMigrate === "number"
);

const probe = runNode("scripts/iu-cj-affiliate-phase3p-missing-url-probe-v1.mjs");
expect("probe_ran", probe.code === 0);

const forpsi = runNode("scripts/iu-cj-affiliate-phase3p-forpsi-operator-runbook-v1.mjs");
expect("forpsi_runbook", forpsi.code === 0);
expect(
  "forpsi_blocked_or_ready",
  forpsi.json.status === "BLOCKED" || forpsi.json.status === "READY_FOR_OPERATOR_CONNECT"
);

// ENDED regression
const managedBefore = {
  liveEnabled: false,
  partners: [
    { advertiserId: "811001", sectionId: "aff-lekarny", title: "EndMe", url: u(811001), active: true },
    { advertiserId: "811002", sectionId: "aff-lekarny", title: "KeepMe", url: u(811002), active: true },
  ],
};
const offers = {
  liveEnabled: false,
  coupons: [
    { id: "c1", advertiserId: "811001" },
    { id: "c2", advertiserId: "811002" },
  ],
  actions: [{ id: "a1", advertiserId: "811001" }],
  products: [{ id: "p1", advertiserId: "811001", imageUrl: "https://x/a.jpg", currentPrice: 1 }],
};
const ended = applyConfirmedEndedAtomic({
  advertiserId: "811001",
  managedPublic: managedBefore,
  offersPublic: offers,
  endedCtx: { confirmedEnded: true, fetchComplete: true, title: "EndMe", sectionId: "aff-lekarny" },
});
expect("ended_ok", ended.ok === true);
expect("ended_inactive", ended.nextManagedPublic.partners.find((p) => p.advertiserId === "811001")?.active === false);
expect("ended_strip", ended.stripped.coupons === 1 && ended.stripped.products === 1);
const overlay = applyOverlayToSections(
  [
    {
      id: "aff-lekarny",
      items: [
        { title: "EndMe", url: u(811001), advertiserId: "811001", affiliateUrlReady: true },
        { title: "EndMe", url: u(811001), advertiserId: null, affiliateUrlReady: true },
        {
          title: "Paid",
          url: "https://example.com/paid",
          management: "PAID_RESERVED",
          affiliateUrlReady: true,
        },
      ],
    },
  ],
  ended.nextManagedPublic
);
expect("ended_no_baked_fallback", !(overlay[0].items || []).some((i) => i.title === "EndMe"));
expect("ended_keeps_paid", (overlay[0].items || []).some((i) => i.title === "Paid"));
expect("unsafe_429", assertEndedRemovalAllowed({ httpStatus: 429, confirmedEnded: true }).ok === false);

const out = {
  OK: failures.length === 0,
  schema: "iu-cj-affiliate-phase3p-live-verify-v1",
  liveEnabled: false,
  publishArmed: false,
  cjLivePublishing: "DISARMED",
  failures,
  migration: mig.json,
  missingUrlProbe: probe.json,
  forpsi: {
    status: forpsi.json.status,
    reason: forpsi.json.reason,
    nextUserAction: forpsi.json.nextUserAction,
  },
  ended: { ok: ended.ok, stripped: ended.stripped },
  scheduleContract: {
    cron: "17 3 * * *",
    textLinkFetch: true,
    probeAdvertiserIdsEnv: "IU_CJ_SYNC_PROBE_ADVERTISER_IDS",
  },
};
console.log(JSON.stringify(out, null, 2));
if (failures.length) process.exit(1);
