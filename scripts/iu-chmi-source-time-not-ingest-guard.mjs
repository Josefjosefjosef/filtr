#!/usr/bin/env node
/**
 * Guard: public CHMI timeline uses official validFrom/onset, never ingest/deploy/fetched times.
 * Case: CAP sent 11:29 vs onset 11:25 → UI primary must be 11:25.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CORE = path.join(ROOT, "assets", "iu-info-system-core-v1.js");

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function loadIU() {
  const sandbox = {
    console,
    localStorage: {
      _m: new Map(),
      getItem(k) {
        return this._m.has(k) ? this._m.get(k) : null;
      },
      setItem(k, v) {
        this._m.set(k, String(v));
      },
      removeItem(k) {
        this._m.delete(k);
      },
    },
    document: { documentElement: { classList: { toggle() {} } } },
    location: { pathname: "/projects/" },
    Date,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Math,
    Set,
    Map,
    Intl,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const src = fs.readFileSync(CORE, "utf8");
  const stripped = src.replace(/export \{[\s\S]*\}\s*;?\s*$/m, "").replace(/export default[\s\S]*$/m, "");
  vm.runInNewContext(stripped + "\nthis.__IU = IUInfoSystem;\n", sandbox, { filename: "core.js" });
  return sandbox.__IU;
}

const IU = loadIU();
const core = fs.readFileSync(CORE, "utf8");
ok("doc_validFrom_primary", /official validFrom|Primary public clock = official onset/i.test(core), "docs");
ok("no_firstSeen_as_clock", !/primaryTime = formatPragueTime\(parseTime\(item\.firstSeen/i.test(core), "firstSeen");

const item = {
  id: "ie-chmi-v2-source-time-1125",
  sourceId: "chmi",
  status: "aktivni",
  publishedAtSource: "2026-07-31T11:29:00+02:00",
  publishedAt: "2026-07-31T11:29:00+02:00",
  validFrom: "2026-07-31T11:25:00+02:00",
  validTo: "2026-08-01T00:00:00+02:00",
  firstSeenByInfoUzel: "2026-07-31T09:49:00.000Z",
  sortAt: "2026-07-31T11:29:00+02:00",
  updatedAt: "2026-07-31T09:49:00.000Z",
  capV2: {
    badgeActive: true,
    msgType: "Update",
    onset: "2026-07-31T11:25:00+02:00",
    sent: "2026-07-31T11:29:00+02:00",
  },
};

const t = IU.getEffectiveTimelinePresentation(item, Date.parse("2026-07-31T12:00:00+02:00"));
ok("active", t.isActiveWarning === true, String(t.isActiveWarning));
ok("primary_1125", t.primaryTime === "11:25", String(t.primaryTime));
ok("not_sent_1129", t.primaryTime !== "11:29", String(t.primaryTime));
ok(
  "issued_secondary",
  /Aktualizováno\s*11:29/.test(String(t.secondaryIssuedLabel || "")),
  String(t.secondaryIssuedLabel)
);
ok("not_ingest_0949", !/9:49|09:49|11:49/.test([t.primaryTime, t.secondaryIssuedLabel, t.primaryDate].join(" ")), "ingest");

const drought = {
  id: "ie-chmi-v2-open-ended",
  sourceId: "chmi",
  status: "aktivni",
  publishedAtSource: "2026-07-28T14:00:00+02:00",
  publishedAt: "2026-07-28T14:00:00+02:00",
  validFrom: "2026-07-28T14:00:00+02:00",
  validTo: null,
  untilRevoked: true,
  firstSeenByInfoUzel: "2026-07-31T11:00:00.000Z",
  capV2: { badgeActive: true, msgType: "Alert", untilRevoked: true },
};
const d = IU.getEffectiveTimelinePresentation(drought, Date.parse("2026-07-31T12:00:00+02:00"));
ok("open_ended_rolled", d.isRolledActiveWarning === true, String(d.isRolledActiveWarning));
ok("open_ended_issued_day", /Vydáno\s*28\.\s*7/.test(String(d.secondaryIssuedLabel || "")), String(d.secondaryIssuedLabel));
ok("open_ended_platnost", d.secondaryValidFromLabel === "Platí od", String(d.secondaryValidFromLabel));
ok("open_ended_vf_time", d.secondaryValidFromTime === "14:00", String(d.secondaryValidFromTime));
ok("open_ended_not_sync_day_as_issued", !/31\.\s*7/.test(String(d.secondaryIssuedLabel || "")), String(d.secondaryIssuedLabel));

if (fails.length) {
  console.error("IU_CHMI_SOURCE_TIME_NOT_INGEST=FAIL");
  for (const f of fails) console.error(" - " + f);
  process.exit(1);
}
console.log("IU_CHMI_SOURCE_TIME_NOT_INGEST=PASS");
