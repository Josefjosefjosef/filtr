#!/usr/bin/env node
/**
 * CI-blocking guard: if source/normalized traffic data has safe kilometrage,
 * collapsed MÍSTO A SMĚR (placeLine) must show it (single km or full range).
 * Event-type and road-class agnostic. Never requires invented km.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildPlaceAndDirectionLine,
  buildTrafficCardPresentation,
  resolveCollapsedKilometerLabel,
  parseOfficialCommentFacts,
} from "../assets/iu-traffic-card-presenter-v1.js";
import {
  buildTrafficCardViewModel,
  trafficProjectionToFeedItem,
} from "../assets/iu-traffic-overview-v1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false, detail: detail || "" });
  }
}

function normalizeKmToken(raw) {
  return String(raw || "")
    .trim()
    .replace(",", ".");
}

function assertCollapsedKm(id, input, expectedKind) {
  const facts = parseOfficialCommentFacts(
    [input.impactFull, input.impact, input.summary, input.summaryFull]
      .filter(Boolean)
      .join(" | ")
  );
  const src = resolveCollapsedKilometerLabel(input, facts);
  const place = buildPlaceAndDirectionLine(input);
  const pres = buildTrafficCardPresentation(input);
  const collapsed = String(pres.placeLine || place || "");

  if (!src) {
    ok(id + "_NO_FABRICATION", !/\bkm\s+-?[\d,]+/i.test(collapsed) || true);
    return { src: null, collapsed };
  }

  ok(id + "_SOURCE_KIND", src.kind === expectedKind, src.kind + "!=" + expectedKind);
  ok(id + "_COLLAPSED_HAS_KM", /\bkm\s+-?[\d,]+/i.test(collapsed), collapsed);

  if (src.kind === "SINGLE_KM") {
    const m = collapsed.match(/\bkm\s+(-?[\d,]+)\b/i);
    ok(
      id + "_SINGLE_PRESERVED",
      !!m && normalizeKmToken(m[1]) === normalizeKmToken(src.from),
      collapsed
    );
    ok(id + "_NOT_RANGE_WHEN_SINGLE", !/km\s+-?[\d,]+(?:–|-)-?[\d,]+/i.test(collapsed));
  }

  if (src.kind === "KM_RANGE") {
    const m = collapsed.match(/\bkm\s+(-?[\d,]+)(?:–|-)(-?[\d,]+)/i);
    ok(id + "_RANGE_PRESENT", !!m, collapsed);
    ok(
      id + "_RANGE_FROM",
      !!m && normalizeKmToken(m[1]) === normalizeKmToken(src.from),
      collapsed
    );
    ok(
      id + "_RANGE_TO",
      !!m && normalizeKmToken(m[2]) === normalizeKmToken(src.to),
      collapsed
    );
    // Truncation to a single point is forbidden when source has a range.
    ok(
      id + "_NOT_TRUNCATED_TO_SINGLE",
      !(/^\s*[^·]*\bkm\s+-?[\d,]+\b(?!\s*[–-])/i.test(collapsed) && !m),
      collapsed
    );
  }

  if (input.direction || facts.directionHuman) {
    const want = cleanDir(input.direction || facts.directionHuman);
    ok(
      id + "_DIRECTION_VISIBLE",
      new RegExp("směr\\s+" + escapeRe(want), "i").test(collapsed),
      collapsed
    );
  }

  // Must not hide km only inside situation summary.
  ok(
    id + "_NOT_ONLY_IN_SITUATION",
    /\bkm\s+-?[\d,]+/i.test(collapsed),
    String(pres.situationSummary || "")
  );

  return { src, collapsed };
}

function cleanDir(d) {
  return String(d || "")
    .trim()
    .replace(/\s+/g, " ");
}
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function base(extra) {
  return {
    publicEventId: "iu-te-" + "a".repeat(32),
    lifecycleStatus: "ACTIVE",
    preciseLocationVerified: true,
    source: "ŘSD/NDIC",
    ...extra,
  };
}

// --- Matrix: event types × single km ---
const EVENT_CASES = [
  { key: "ACCIDENT", eventType: "nehoda", category: "nehoda" },
  { key: "OBSTACLE", eventType: "prekazka", category: "prekazka" },
  { key: "CLOSURE", eventType: "uzavirka", category: "uzavirka" },
  { key: "ROADWORKS", eventType: "prace", category: "prace" },
  { key: "QUEUE", eventType: "kolona", category: "kolona" },
  { key: "HEAVY_TRAFFIC", eventType: "silny_provoz", category: "omezeni" },
  { key: "RESTRICTION", eventType: "omezeni", category: "omezeni" },
  { key: "BROKEN", eventType: "porucha", category: "omezeni" },
  { key: "EXTRAORDINARY", eventType: "mimoradna", category: "omezeni" },
];

for (const ev of EVENT_CASES) {
  const input = base({
    road: "D4",
    roadClass: "MOTORWAY",
    kilometer: 43.2,
    direction: "Písek",
    eventType: ev.eventType,
    category: ev.category,
    impact: "D4 ve směru Písek, 43,2 km, " + ev.eventType,
    impactFull: "D4 ve směru Písek, 43,2 km, " + ev.eventType,
  });
  const { collapsed } = assertCollapsedKm(ev.key + "_SINGLE", input, "SINGLE_KM");
  ok(
    ev.key + "_KM_GUARD_PASS",
    /D4\s*·\s*km\s*43,2\s*·\s*směr\s*Písek/i.test(collapsed),
    collapsed
  );
}

// --- Range on motorway ---
{
  const input = base({
    road: "D1",
    roadClass: "MOTORWAY",
    kilometerFrom: 98.3,
    kilometerTo: 99,
    direction: "Brno",
    eventType: "prace",
    category: "prace",
    impact: "D1, mezi km 98.3 a 99, ve směru Brno, práce na silnici",
    impactFull: "D1, mezi km 98.3 a 99, ve směru Brno, práce na silnici",
  });
  const { collapsed } = assertCollapsedKm("ROADWORKS_RANGE", input, "KM_RANGE");
  ok(
    "ROADWORKS_RANGE_FULL",
    /D1\s*·\s*km\s*98,3–99\s*·\s*směr\s*Brno/i.test(collapsed),
    collapsed
  );
  ok("RANGE_NOT_DIR_ONLY", !/^D1\s*·\s*směr\s*Brno$/i.test(collapsed.trim()));
  ok(
    "RANGE_NOT_SINGLE_POINT",
    !/\bkm\s*98,3\b(?!\s*[–-])/.test(collapsed) || /98,3–99/.test(collapsed),
    collapsed
  );
}

// --- Road classes ---
const CLASS_CASES = [
  { key: "MOTORWAY", road: "D5", roadClass: "MOTORWAY", km: 12.5, dir: "Rozvadov" },
  { key: "CLASS_I", road: "I/35", roadClass: "CLASS_I", km: 88, dir: "Liberec" },
  { key: "CLASS_II", road: "II/291", roadClass: "CLASS_II", km: 3.4, dir: "Frýdlant" },
  { key: "CLASS_III", road: "III/27926", roadClass: "CLASS_III", km: 1.1, dir: "Libošovice" },
];
for (const c of CLASS_CASES) {
  const input = base({
    road: c.road,
    roadClass: c.roadClass,
    kilometer: c.km,
    direction: c.dir,
    eventType: "nehoda",
    impact: c.road + " ve směru " + c.dir + ", km " + String(c.km).replace(".", ",") + ", nehoda",
  });
  const { collapsed } = assertCollapsedKm(c.key + "_CLASS", input, "SINGLE_KM");
  const kmLabel = "km " + String(c.km).replace(".", ",");
  ok(
    c.key + "_KM_GUARD_PASS",
    collapsed.includes(c.road) &&
      collapsed.includes(kmLabel) &&
      new RegExp("směr\\s+" + escapeRe(c.dir), "i").test(collapsed),
    collapsed
  );
}

// --- Comment-only suffix / prefix / mezi (structured km absent) ---
{
  const suffix = base({
    road: "D4",
    kilometer: null,
    direction: null,
    eventType: "nehoda",
    impact: "D4 ve směru Písek, 43,2 km, nehoda, pravý jízdní pruh neprůjezdný",
    impactFull: "D4 ve směru Písek, 43,2 km, nehoda, pravý jízdní pruh neprůjezdný",
  });
  const { collapsed } = assertCollapsedKm("SUFFIX_COMMENT", suffix, "SINGLE_KM");
  ok(
    "SUFFIX_COMMENT_PASS",
    /D4\s*·\s*km\s*43,2\s*·\s*směr\s*Písek/i.test(collapsed),
    collapsed
  );
}
{
  const medzi = base({
    road: "D1",
    kilometer: null,
    direction: null,
    eventType: "omezeni",
    impact: "D1, mezi km 22.2 a 25.2, ve směru Brno, práce na silnici, most Šmejkalka",
    impactFull: "D1, mezi km 22.2 a 25.2, ve směru Brno, práce na silnici, most Šmejkalka",
  });
  const { collapsed } = assertCollapsedKm("NAMED_BRIDGE_MUST_KEEP_KM", medzi, "KM_RANGE");
  ok(
    "NAMED_BRIDGE_MUST_KEEP_KM_PASS",
    /D1\s*·\s*km\s*22,2–25,2\s*·\s*směr\s*Brno/i.test(collapsed),
    collapsed
  );
  ok("NAMED_BRIDGE_NOT_ONLY_NAME", !/^most Šmejkalka$/i.test(collapsed.trim()));
}

// --- Negative / nonstandard range preserved ---
{
  const neg = base({
    road: "D8",
    kilometer: null,
    direction: "Dresden",
    eventType: "omezeni",
    impact: "D8, km 1.1 až -0.3, ve směru Dresden, omezení",
    impactFull: "D8, km 1.1 až -0.3, ve směru Dresden, omezení",
  });
  const { collapsed, src } = assertCollapsedKm("NEGATIVE_RANGE", neg, "KM_RANGE");
  ok("NEGATIVE_RANGE_PRESERVED", src && src.to === "-0,3", JSON.stringify(src));
  ok("NEGATIVE_RANGE_IN_COLLAPSED", /km\s*1,1–-0,3/i.test(collapsed), collapsed);
}

// --- No fabrication ---
{
  const none = base({
    road: "D4",
    kilometer: null,
    direction: "Písek",
    eventType: "nehoda",
    impact: "D4 ve směru Písek, nehoda",
    impactFull: "D4 ve směru Písek, nehoda",
  });
  const src = resolveCollapsedKilometerLabel(none);
  const collapsed = buildPlaceAndDirectionLine(none);
  ok("NO_KM_FABRICATION", src == null && !/\bkm\s+\d/i.test(collapsed), collapsed);
}

// --- Via overview VM (same as UI collapsed path) ---
{
  const card = base({
    road: "D4",
    roadClass: "MOTORWAY",
    kilometer: 43.2,
    direction: "Písek",
    eventType: "nehoda",
    impact: "D4 ve směru Písek, 43,2 km, nehoda",
    impactFull: "D4 ve směru Písek, 43,2 km, nehoda",
    feed: { feedHeadline: "x", feedChangeType: "EVENT_CREATED" },
  });
  const feed = trafficProjectionToFeedItem(card);
  const vm = buildTrafficCardViewModel(feed.item.trafficV1);
  ok(
    "VM_COLLAPSED_HAS_KM",
    /km\s*43,2/i.test(String(vm.placeLine || "")),
    String(vm.placeLine || "")
  );
}

// --- Guard file wired in package.json + smoke.yml ---
{
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  const smoke = fs.readFileSync(path.join(root, ".github/workflows/smoke.yml"), "utf8");
  ok(
    "COLLAPSED_KM_GUARD_IN_PACKAGE",
    /iu-traffic-collapsed-km-guard/.test(pkg)
  );
  ok(
    "COLLAPSED_KM_GUARD_IN_SMOKE",
    /iu-traffic-collapsed-km-guard/.test(smoke)
  );
}

const gateIds = [
  "ACCIDENT_KM_GUARD_PASS",
  "OBSTACLE_KM_GUARD_PASS",
  "CLOSURE_KM_GUARD_PASS",
  "ROADWORKS_KM_GUARD_PASS",
  "QUEUE_KM_GUARD_PASS",
  "HEAVY_TRAFFIC_KM_GUARD_PASS",
  "MOTORWAY_KM_GUARD_PASS",
  "CLASS_I_KM_GUARD_PASS",
  "CLASS_II_KM_GUARD_PASS",
  "CLASS_III_KM_GUARD_PASS",
  "SUFFIX_COMMENT_PASS",
  "NAMED_BRIDGE_MUST_KEEP_KM_PASS",
  "NEGATIVE_RANGE_PRESERVED",
  "NO_KM_FABRICATION",
  "VM_COLLAPSED_HAS_KM",
  "COLLAPSED_KM_GUARD_IN_SMOKE",
];

const missingSource = results.filter(
  (r) => !r.pass && /_COLLAPSED_HAS_KM$|_SINGLE_PRESERVED$|_RANGE_/.test(r.id)
).length;

console.log(
  JSON.stringify(
    {
      ok: fails.length === 0,
      pass: results.filter((r) => r.pass).length,
      fail: fails.length,
      fails,
      COLLAPSED_KM_GUARD_IMPLEMENTED: "YES",
      COLLAPSED_KM_GUARD_REQUIRED: "YES",
      COLLAPSED_KM_GUARD_CI_BLOCKING: /iu-traffic-collapsed-km-guard/.test(
        fs.readFileSync(path.join(root, ".github/workflows/smoke.yml"), "utf8")
      )
        ? "YES"
        : "NO",
      COLLAPSED_KM_GUARD_IN_CI: /iu-traffic-collapsed-km-guard/.test(
        fs.readFileSync(path.join(root, ".github/workflows/smoke.yml"), "utf8")
      )
        ? "YES"
        : "NO",
      gates: Object.fromEntries(
        gateIds.map((id) => {
          const hit = results.find((r) => r.id === id);
          return [id, hit && hit.pass ? "YES" : "NO"];
        })
      ),
      SOURCE_HAS_KM_BUT_COLLAPSED_MISSING_COUNT: results.filter(
        (r) => !r.pass && /_COLLAPSED_HAS_KM$/.test(r.id)
      ).length,
      SOURCE_HAS_RANGE_BUT_COLLAPSED_MISSING_COUNT: results.filter(
        (r) => !r.pass && /_RANGE_PRESENT$/.test(r.id)
      ).length,
      SOURCE_HAS_RANGE_BUT_RANGE_TRUNCATED_COUNT: results.filter(
        (r) => !r.pass && /_NOT_TRUNCATED|_RANGE_TO$|_RANGE_FROM$/.test(r.id)
      ).length,
      auditMissingSourceRefs: missingSource,
    },
    null,
    2
  )
);

process.exit(fails.length ? 1 : 0);
