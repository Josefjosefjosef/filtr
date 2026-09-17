#!/usr/bin/env node
/**
 * Freeze guard: Můj přehled / Nastavení — city locality must drive feed results.
 *
 * Proves:
 *  A) Saved city filter matches traffic cards by municipality/region (not ORP-only).
 *  B) Same city filter matches ČHMÚ CAP warnings via ORP / ORP-seat name.
 *  C) Negative: foreign city / foreign ORP do not match.
 *  D) sanitizeFeedFilter heals one-sided city lists (Doprava ↔ ČHMÚ shared cities).
 *  E) addCityLocality mirrors cities to both traffic and chmu.
 *
 * Run: npm run iu-pd-city-filter-feed-match-guard
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { swHasAllowedCacheVersion } from "./guards/iu-sw-cache-version-allowlist.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(path.join(ROOT, "package.json"));

const CORE = path.join(ROOT, "assets", "iu-info-system-core-v1.js");
const FEED_FILTER = path.join(ROOT, "assets", "iu-feed-filter-v1.js");
const FEED_SETTINGS = path.join(ROOT, "assets", "iu-prehled-dne-feed-settings-v1.js");
const UI = path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js");
const INDEX = path.join(ROOT, "projects", "index.html");
const SW = path.join(ROOT, "sw.js");
const ALLOW = path.join(ROOT, "scripts", "guards", "iu-sw-cache-version-allowlist.cjs");
const REPORT = path.join(
  process.env.TEMP || process.env.TMPDIR || "/tmp",
  "iu_pd_city_filter_feed_match_guard.json"
);

const CACHE_TOKEN = "2026-09-17-pd-city-filter-feed-match-v1";
const BUST = "pd-city-filter-feed-match-v1-20260917";

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function loadCoreIU() {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
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
    RegExp,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const src = fs.readFileSync(CORE, "utf8");
  const stripped = src.replace(/export \{[\s\S]*\}\s*;?\s*$/m, "").replace(/export default[\s\S]*$/m, "");
  vm.runInNewContext(stripped + "\nthis.__IU = IUInfoSystem;\n", sandbox, { filename: "core.js" });
  return sandbox.__IU;
}

async function loadFeedMods() {
  const { pathToFileURL } = await import("node:url");
  const ffUrl = pathToFileURL(FEED_FILTER).href + "?g=" + Date.now();
  const fsUrl = pathToFileURL(FEED_SETTINGS).href + "?g=" + Date.now();
  const feedFilter = await import(ffUrl);
  const feedSettings = await import(fsUrl);
  return { feedFilter, feedSettings };
}

function staticGate() {
  const core = fs.readFileSync(CORE, "utf8");
  const feedFilter = fs.readFileSync(FEED_FILTER, "utf8");
  const feedSettings = fs.readFileSync(FEED_SETTINGS, "utf8");
  const ui = fs.readFileSync(UI, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  const sw = fs.readFileSync(SW, "utf8");
  const allow = fs.readFileSync(ALLOW, "utf8");

  ok("core_unstructured_city_fn", /function cityMatchesUnstructuredLocation/.test(core));
  ok(
    "core_resolve_uses_unstructured_city",
    /cityMatchesUnstructuredLocation\(sel,\s*warning\)/.test(core)
  );
  ok(
    "core_city_orp_name_fallback",
    /function cityMatchesWarning[\s\S]{0,400}if \(code && orpSet\.has\(code\)\) return true;/.test(core) &&
      /function cityMatchesWarning[\s\S]{0,700}locNamesEqual\(l\.orpName,\s*name\)/.test(core)
  );
  ok(
    "feed_sanitize_heals_one_sided_cities",
    /Heal one-sided city selections/.test(feedFilter) &&
      /trafficCities\.length && !chmuCities\.length/.test(feedFilter)
  );
  ok(
    "feed_settings_mirror_cities",
    /Keep city selection shared across Doprava/.test(feedSettings) &&
      /mirror\.localities/.test(feedSettings)
  );
  ok("index_core_bust", index.includes(BUST) && /iu-info-system-core-v1\.js\?v=/.test(index));
  ok("ui_core_bust", ui.includes(BUST));
  ok("ui_feed_filter_bust", ui.includes(BUST) || /iu-feed-filter-v1\.js\?v=/.test(ui));
  ok("sw_allowlist", swHasAllowedCacheVersion(sw));
  ok("allowlist_token", allow.includes(`"${CACHE_TOKEN}"`));
  ok("sw_current_token", sw.includes(CACHE_TOKEN) || allow.includes(CACHE_TOKEN));
}

function unitCore(IU) {
  ok("iu_loaded", !!(IU && IU.eventMatchesLocationFilter && IU.resolveWarningLocalityMatch));

  const ostravaFilter = {
    localities: [{ name: "Ostrava", id: "554821", orpCode: "8119", level: "mesto" }],
    homeObec: "Ostrava",
  };
  const brnoFilter = {
    localities: [{ name: "Brno", id: "582786", orpCode: "6203", level: "mesto" }],
  };

  const trafficOst = {
    id: "t-ost",
    trafficV1: { municipality: "Ostrava", district: "Ostrava-město", publicEventId: "a" },
    region: { name: "Ostrava", summary: "Ostrava", krajName: "Moravskoslezský kraj" },
  };
  const trafficBrno = {
    id: "t-brno",
    trafficV1: { municipality: "Brno", publicEventId: "b" },
    region: { name: "Brno", summary: "Brno" },
  };
  const trafficEmptyMuni = {
    id: "t-road",
    trafficV1: { municipality: null, publicEventId: "c", road: "D1" },
    region: { name: "D1", summary: "D1" },
  };

  ok("A_traffic_city_hit", IU.eventMatchesLocationFilter(trafficOst, ostravaFilter) === true);
  ok("A_traffic_city_miss", IU.eventMatchesLocationFilter(trafficBrno, ostravaFilter) === false);
  ok("A_traffic_whole_cr", IU.eventMatchesLocationFilter(trafficOst, { localities: [] }) === true);
  ok(
    "A_traffic_name_only_filter",
    IU.eventMatchesLocationFilter(trafficOst, {
      localities: [{ name: "Ostrava", level: "mesto" }],
    }) === true
  );
  ok("A_traffic_no_false_road", IU.eventMatchesLocationFilter(trafficEmptyMuni, ostravaFilter) === false);

  const chmiWide = {
    id: "c-wide",
    sourceId: "chmi",
    capV2: {
      geo: {
        links: [
          {
            orpCode: "8119",
            orpName: "Ostrava",
            okresName: "Ostrava-město",
            krajName: "Moravskoslezský kraj",
          },
          {
            orpCode: "8102",
            orpName: "Frýdek-Místek",
            okresName: "Frýdek-Místek",
            krajName: "Moravskoslezský kraj",
          },
        ],
      },
    },
    region: { orpCodes: ["8119", "8102"], krajNames: ["Moravskoslezský kraj"] },
  };
  const chmiBrnoOnly = {
    id: "c-brno",
    sourceId: "chmi",
    capV2: {
      geo: {
        links: [{ orpCode: "6203", orpName: "Brno", krajName: "Jihomoravský kraj" }],
      },
    },
    region: { orpCodes: ["6203"] },
  };

  ok("B_chmi_orp_hit", IU.eventMatchesLocationFilter(chmiWide, ostravaFilter) === true);
  ok("B_chmi_orp_miss", IU.eventMatchesLocationFilter(chmiBrnoOnly, ostravaFilter) === false);
  ok("B_chmi_brno_hit", IU.eventMatchesLocationFilter(chmiBrnoOnly, brnoFilter) === true);

  const resolved = IU.resolveWarningLocalityMatch(chmiWide, ostravaFilter);
  ok("B_chmi_title_uses_city", !!(resolved && resolved.match && (resolved.names || []).includes("Ostrava")));
}

async function unitFeedMods() {
  const { feedFilter, feedSettings } = await loadFeedMods();
  const oneSided = feedFilter.sanitizeFeedFilter({
    traffic: {
      localities: [{ name: "Ostrava", level: "mesto", id: "554821", orpCode: "8119" }],
      roads: [],
      eventCategories: [],
      parkingEnabled: false,
      parkingIds: [],
    },
    chmu: { localities: [] },
  });
  const chmuCities = (oneSided.chmu.localities || []).filter((l) => l.level === "mesto");
  ok("D_sanitize_mirrors_to_chmu", chmuCities.length === 1 && chmuCities[0].name === "Ostrava");

  const ff = feedFilter.defaultFeedFilter();
  const add = feedSettings.addCityLocality(
    ff,
    "traffic",
    { name: "Plzeň", id: "554791", orpCode: "3209" },
    20
  );
  ok("E_add_ok", !!(add && add.ok));
  const tCities = (ff.traffic.localities || []).filter((l) => l.level === "mesto");
  const cCities = (ff.chmu.localities || []).filter((l) => l.level === "mesto");
  ok("E_add_traffic", tCities.some((c) => c.name === "Plzeň"));
  ok("E_add_chmu_mirror", cCities.some((c) => c.name === "Plzeň"));
  feedSettings.removeCityLocality(ff, "chmu", "Plzeň", "554791");
  ok(
    "E_remove_both",
    !(ff.traffic.localities || []).some((l) => l.level === "mesto" && l.name === "Plzeň") &&
      !(ff.chmu.localities || []).some((l) => l.level === "mesto" && l.name === "Plzeň")
  );
}

async function main() {
  staticGate();
  const IU = loadCoreIU();
  unitCore(IU);
  await unitFeedMods();

  const pass = fails.length === 0;
  const report = {
    IU_PD_CITY_FILTER_FEED_MATCH_GUARD: pass ? "PASS" : "FAIL",
    fails,
    cacheToken: CACHE_TOKEN,
    bust: BUST,
  };
  try {
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");
  } catch (_) {}
  console.log(JSON.stringify(report, null, 2));
  if (!pass) process.exit(1);
}

main().catch((err) => {
  console.error("[iu-pd-city-filter-feed-match-guard] FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
