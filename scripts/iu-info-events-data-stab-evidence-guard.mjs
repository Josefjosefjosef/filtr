/**
 * Guard + unit evidence for Přehled dne data-stabilization closeout.
 * Run: node scripts/iu-info-events-data-stab-evidence-guard.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import vm from "vm";
import { isInActiveFeedWindow, applyChronology } from "./iu-info-events-v2.mjs";
import { parsePublishDateToIso, extractTitleLeadingDate } from "./iu-info-events-lib.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function ok(cond, msg) {
  if (!cond) fails.push(msg);
}

// --- Parser unit proofs ---
{
  const rss = parsePublishDateToIso("Fri, 18 Jul 2026 10:28:00 +0200");
  ok(!!(rss && rss.startsWith("2026-07-18")), "parser:rss_pubDate");
  const titleRaw = extractTitleLeadingDate("16.07.2026 Na provoz mezi Prahou a Milovicemi");
  const titleIso = parsePublishDateToIso(titleRaw);
  ok(titleRaw === "16.07.2026" && !!(titleIso && titleIso.startsWith("2026-07-16")), "parser:title_date");
  ok(!parsePublishDateToIso(""), "parser:empty");
  ok(!parsePublishDateToIso("Fri, 18 Jul 2099 10:00:00 GMT"), "parser:future_rejected");
  const cz = parsePublishDateToIso("18.07.2026 14:30");
  ok(!!(cz && cz.startsWith("2026-07-18")), "parser:czech_datetime");
}

// --- Feed window (no default publish-age cutoff; optional maxAgeHours still honored) ---
{
  const now = "2026-07-19T12:00:00.000Z";
  const in95 = isInActiveFeedWindow(
    { publishedAtSource: "2026-07-15T13:00:00.000Z", status: "publikovano", timeConfidence: "high" },
    now,
    null
  );
  ok(in95.ok === true, "win:95h_in:" + in95.reason);
  const out97 = isInActiveFeedWindow(
    { publishedAtSource: "2026-07-15T10:00:00.000Z", status: "publikovano", timeConfidence: "high" },
    now,
    null
  );
  ok(out97.ok === true, "win:97h_kept_no_default_window:" + out97.reason);
  const capped = isInActiveFeedWindow(
    { publishedAtSource: "2026-07-15T10:00:00.000Z", status: "publikovano", timeConfidence: "high" },
    now,
    96
  );
  ok(capped.ok === false && capped.reason === "older_than_window", "win:optional_96h_still_works:" + capped.reason);
  const active = isInActiveFeedWindow(
    {
      publishedAtSource: "2026-07-01T10:00:00.000Z",
      status: "aktivni",
      validTo: "2026-07-20T18:00:00.000Z",
      timeConfidence: "high",
    },
    now,
    null
  );
  ok(active.ok === true && active.reason === "valid_active_event", "win:long_active:" + active.reason);
}

// --- Chronology ---
{
  const now = "2026-07-19T12:00:00.000Z";
  const prev = new Map();
  const withSrc = applyChronology(
    {
      id: "a",
      url: "https://example.test/a",
      publishedAtSource: "2026-07-16T10:00:00.000Z",
      _hasSourcePubDate: true,
      timeSourceHint: "title_date",
    },
    now,
    prev
  );
  ok(withSrc.publishedAtSource === "2026-07-16T10:00:00.000Z", "chrono:publishedAtSource");
  ok(withSrc.firstSeenByInfoUzel === now, "chrono:firstSeen");
  ok(withSrc.timeConfidence === "medium", "chrono:confidence");
  ok(withSrc.publishedAtSource !== withSrc.firstSeenByInfoUzel, "chrono:separated");
  const noSrc = applyChronology({ id: "b", url: "https://example.test/b" }, now, prev);
  ok(noSrc.timeConfidence === "fallback", "chrono:fallback_path");
  ok(noSrc.isHistoricalBackfill === true, "chrono:backfill_flag");
}

// --- Client filter 96h + multi-source + migration ---
{
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(String(k), String(v)),
    removeItem: (k) => store.delete(k),
  };
  const sandbox = {
    localStorage,
    console,
    Date,
    JSON,
    Map,
    Set,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Math,
    location: { pathname: "/projects/" },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const src = fs.readFileSync(path.join(REPO, "assets/iu-info-system-core-v1.js"), "utf8");
  const stripped = src.replace(/export \{[\s\S]*\}\s*;?\s*$/m, "").replace(/export default[\s\S]*$/m, "");
  vm.runInNewContext(stripped + "\nthis.__IU = IUInfoSystem;\n", sandbox, { filename: "core.js" });
  const IU = sandbox.__IU;
  const tNow = Date.now();
  const items = [
    {
      id: "old",
      title: "old press",
      publishedAtSource: new Date(tNow - 97 * 3600000).toISOString(),
      status: "publikovano",
      timeConfidence: "high",
      sectionId: "stat",
      sourceId: "x",
      url: "https://example.test/old",
    },
    {
      id: "fresh",
      title: "fresh",
      publishedAtSource: new Date(tNow - 10 * 3600000).toISOString(),
      status: "publikovano",
      timeConfidence: "high",
      sectionId: "stat",
      sourceId: "x",
      url: "https://example.test/fresh",
    },
    {
      id: "cap",
      title: "active warning",
      publishedAtSource: new Date(tNow - 200 * 3600000).toISOString(),
      status: "aktivni",
      validTo: new Date(tNow + 6 * 3600000).toISOString(),
      timeConfidence: "high",
      sectionId: "pocasi",
      sourceId: "chmi",
      url: "https://example.test/cap",
    },
  ];
  const ids = IU.filterEvents(items, {}).map((x) => x.id);
  ok(ids.includes("fresh"), "clientWin:fresh_kept");
  ok(ids.includes("old"), "clientWin:old_kept_no_96h");
  ok(ids.includes("cap"), "clientWin:active_kept");

  const multi = [
    {
      id: "m1",
      title: "multi",
      publishedAtSource: new Date(tNow - 5 * 3600000).toISOString(),
      status: "publikovano",
      timeConfidence: "high",
      sectionId: "doprava",
      sourceId: "policie-cr",
      sourceGroup: "policie",
      url: "https://example.test/m1",
      sourcePublications: [
        { sourceId: "policie-cr", sourceLabel: "Policie ČR", sourceGroup: "policie", url: "https://example.test/m1a" },
        { sourceId: "szdc", sourceLabel: "Správa železnic", sourceGroup: "doprava", url: "https://example.test/m1b" },
      ],
    },
  ];
  ok(IU.filterEvents(multi, { sourceIds: ["szdc"] }).length === 1, "dedup:filter_secondary_source");
  ok(IU.filterEvents(multi, { sourceGroups: ["doprava"] }).length === 1, "dedup:filter_secondary_group");
  ok(IU.filterEvents(multi, { sourceIds: ["neexistuje"] }).length === 0, "dedup:filter_miss");

  localStorage.setItem(
    "iu.infoEvents.prefs.v1",
    JSON.stringify({ eventTypes: ["aktivni"], sortMode: "nejdulezitejsi", sections: ["doprava"], unreadOnly: true })
  );
  localStorage.setItem("iu.infoEvents.views.v1", JSON.stringify({ views: [{ id: "custom-x", label: "X", prefs: { eventTypes: ["mimoradne"] } }] }));
  localStorage.setItem("iu.infoEvents.schema.v1", "4");
  localStorage.setItem("iu.infoEvents.read.v1", JSON.stringify(["keep-me"]));
  localStorage.setItem("iu.infoEvents.saved.v1", JSON.stringify(["saved-1"]));
  localStorage.setItem("iu.infoEvents.scroll.v1", JSON.stringify({ viewId: "muj-prehled", y: 420 }));
  IU.migrateLocalStateOnce();
  const prefs = IU.getPrefs();
  ok(prefs.eventTypes.length === 0, "regen:eventTypes_cleared");
  ok(prefs.sortMode === "nejnovejsi", "regen:sort_chrono");
  ok(prefs.sections[0] === "doprava", "regen:sections_kept");
  ok(prefs.unreadOnly === false, "regen:unread_session_only");
  ok(JSON.parse(localStorage.getItem("iu.infoEvents.read.v1")).includes("keep-me"), "localfirst:read_kept");
  ok(JSON.parse(localStorage.getItem("iu.infoEvents.saved.v1")).includes("saved-1"), "localfirst:saved_kept");
  ok(JSON.parse(localStorage.getItem("iu.infoEvents.scroll.v1")).y === 420, "localfirst:scroll_kept");
  const views = IU.listViews();
  const custom = views.find((v) => v.id === "custom-x");
  ok(!!custom && custom.prefs.eventTypes.length === 0, "localfirst:view_migrated");
  ok(typeof IU.unhideItem === "function", "core:unhideItem");
  const hid = [
    {
      id: "hid1",
      title: "hidden",
      publishedAtSource: new Date(tNow - 5 * 3600000).toISOString(),
      status: "publikovano",
      timeConfidence: "high",
      sectionId: "stat",
      sourceId: "x",
      url: "https://example.test/hid",
    },
  ];
  IU.hideItem("hid1");
  ok(IU.filterEvents(hid, {}, { hiddenMode: "only" }).length === 1, "hidden:only");
  IU.unhideItem("hid1");
  ok(IU.filterEvents(hid, {}, { hiddenMode: "exclude" }).length === 1, "hidden:restored");
}

// --- Evidence docs ---
{
  const j = path.join(REPO, "docs/info-system-v1/09-data-stabilization-evidence.json");
  const m = path.join(REPO, "docs/info-system-v1/09-data-stabilization-evidence.md");
  ok(fs.existsSync(j), "evidence:json");
  ok(fs.existsSync(m), "evidence:md");
  if (fs.existsSync(j)) {
    const rep = JSON.parse(fs.readFileSync(j, "utf8"));
    ok(!!(rep.monitoring && rep.monitoring.dataQuality), "evidence:dq");
    ok(Array.isArray(rep.auditedSources) && rep.auditedSources.length >= 8, "evidence:sources");
    ok(rep.metadata && rep.metadata.techArtifactHits === 0, "evidence:no_tech_artifacts");
    ok(Number(rep.monitoring.dataQuality.fallbackTime || 0) === 0, "evidence:no_fallback");
  }
}

if (fails.length) {
  console.error("[iu-info-events-data-stab-evidence-guard] FAIL");
  for (const f of fails) console.error(" -", f);
  console.log("RESULT=FAIL");
  process.exit(1);
}
console.log("[iu-info-events-data-stab-evidence-guard] PASS checks=" + (30));
console.log("RESULT=PASS");
