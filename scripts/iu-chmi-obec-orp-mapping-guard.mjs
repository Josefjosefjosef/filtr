#!/usr/bin/env node
/**
 * Guard: full obec→ORP coverage for CHMI locality filter + runtime behaviour.
 * - Every picker obec has stable id + exactly one valid CISORP code
 * - All geo-registry ORPs are covered
 * - Filter/title use ORP codes (not bare village text)
 * - Max 20 cities, dedupe, no CHMI data mutation
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CORE = path.join(ROOT, "assets", "iu-info-system-core-v1.js");
const UI = path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js");
const CSS = path.join(ROOT, "assets", "iu-prehled-dne-v1.css");
const PICKER = path.join(ROOT, "projects", "data", "cz_localities_picker.json");
const GEO = path.join(ROOT, "scripts", "chmi-cap-v2", "data", "geo-registry.json");
const BUILD = path.join(ROOT, "scripts", "build-cz-localities-picker.mjs");
const CACHE_BUST = "obec-orp-filter-v1-20260802";

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function loadIU() {
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
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const src = fs.readFileSync(CORE, "utf8");
  const stripped = src.replace(/export \{[\s\S]*\}\s*;?\s*$/m, "").replace(/export default[\s\S]*$/m, "");
  vm.runInNewContext(stripped + "\nthis.__IU = IUInfoSystem;\n", sandbox, { filename: "core.js" });
  return sandbox.__IU;
}

function dataGate() {
  const picker = JSON.parse(fs.readFileSync(PICKER, "utf8"));
  const geo = JSON.parse(fs.readFileSync(GEO, "utf8"));
  const regOrp = geo.units.filter((u) => u.type === "orp").map((u) => String(u.code));
  const regSet = new Set(regOrp);
  ok("picker_version3", Number(picker.version) >= 3, String(picker.version));
  ok("items_array", Array.isArray(picker.items), "items");
  ok("orp_count_206", regOrp.length === 206, String(regOrp.length));

  const ids = new Set();
  const covered = new Set();
  const bad = [];
  for (const it of picker.items || []) {
    const id = String(it.id || "").trim();
    const n = String(it.n || "").trim();
    const orp = String(it.orp || "").trim();
    if (!id || !n || !orp) {
      bad.push("incomplete:" + id + ":" + n + ":" + orp);
      continue;
    }
    if (ids.has(id)) bad.push("dup_id:" + id);
    ids.add(id);
    if (!regSet.has(orp)) bad.push("unknown_orp:" + id + "->" + orp);
    covered.add(orp);
  }
  ok("obce_count", (picker.items || []).length >= 6200, String((picker.items || []).length));
  ok("all_obce_valid", bad.length === 0, bad.slice(0, 15).join("|"));
  const missing = regOrp.filter((c) => !covered.has(c));
  ok("all_orp_covered", missing.length === 0, missing.join(","));
  ok("counts_match", Number(picker.counts && picker.counts.orp) === covered.size, JSON.stringify(picker.counts));

  const nupaky = (picker.items || []).find((x) => x.n === "Nupaky");
  ok("nupaky_orp_ricany", !!(nupaky && nupaky.orp === "2122"), JSON.stringify(nupaky || null));
  const cestlice = (picker.items || []).find((x) => x.n === "Čestlice");
  ok("cestlice_same_orp", !!(cestlice && cestlice.orp === "2122"), JSON.stringify(cestlice || null));
  const praha = (picker.items || []).find((x) => x.n === "Praha");
  ok("praha_orp", !!(praha && praha.orp === "1000"), JSON.stringify(praha || null));
  const brno = (picker.items || []).find((x) => x.n === "Brno");
  ok("brno_is_orp_seat", !!(brno && brno.orp === "6203" && brno.orpN === "Brno"), JSON.stringify(brno || null));

  const build = fs.readFileSync(BUILD, "utf8");
  ok("build_uses_cisob", /kodcis=43/.test(build), "cisob");
  ok("build_uses_vazba", /43_1182/.test(build), "vazba");
  ok("build_uses_geo_reg", /geo-registry\.json/.test(build), "geo");
}

function staticGate() {
  const core = fs.readFileSync(CORE, "utf8");
  const ui = fs.readFileSync(UI, "utf8");
  const css = fs.readFileSync(CSS, "utf8");
  ok("core_max20", /MAX_CITY_LOCALITIES\s*=\s*20/.test(core), "max");
  ok("core_normalize_orp", /function normalizeOrpCode/.test(core), "orp");
  ok("core_event_match", /function eventMatchesLocationFilter/.test(core), "match");
  ok("core_relevant_cities", /function relevantSelectedCities/.test(core), "relevant");
  ok("core_no_text_only_village_filter", !/hay\.includes\(nn\).*Nupaky/.test(core), "text");
  ok("ui_limit_msg", /Můžete vybrat maximálně 20 obcí/.test(ui), "msg");
  ok("ui_city_add_id", /data-orp=/.test(ui) && /data-id=/.test(ui), "attrs");
  ok("ui_set_city_list", /function setCityList/.test(ui), "setCity");
  ok("ui_cache_bust", ui.includes(CACHE_BUST), "bust");
  ok("css_title_wrap", /\.iuPdCard__title[\s\S]{0,220}overflow-wrap:\s*anywhere/.test(css), "wrap");
}

function warningA() {
  const now = Date.now();
  const links = [
    { orpCode: "2122", orpId: "orp:2122", orpName: "Říčany", okresName: "Praha-východ", krajName: "Středočeský kraj" },
    { orpCode: "2105", orpId: "orp:2105", orpName: "Černošice", okresName: "Praha-západ", krajName: "Středočeský kraj" },
  ];
  while (links.length < 85) {
    links.push({
      orpCode: String(7000 + links.length),
      orpId: "orp:" + String(7000 + links.length),
      orpName: "X" + links.length,
      okresName: "O",
      krajName: "Jihočeský kraj",
    });
  }
  return {
    id: "ie-chmi-v2-a",
    title: "Silné bouřky — Říčany a dalších 84 oblastí",
    url: "https://example.test/a",
    sourceId: "chmi",
    status: "aktivni",
    publishedAtSource: new Date(now - 3600000).toISOString(),
    publishedAt: new Date(now - 3600000).toISOString(),
    validFrom: new Date(now - 3600000).toISOString(),
    validTo: new Date(now + 48 * 3600000).toISOString(),
    timeConfidence: "high",
    region: {
      name: "Říčany",
      summary: "Říčany a dalších 84 oblastí",
      orpCodes: links.map((l) => l.orpCode),
      orpIds: links.map((l) => l.orpId),
      orpNames: links.map((l) => l.orpName),
    },
    capV2: { badgeActive: true, geo: { links: links.map((l) => Object.assign({}, l)) } },
  };
}

function warningB() {
  const now = Date.now();
  const links = [
    { orpCode: "6203", orpId: "orp:6203", orpName: "Brno", okresName: "Brno-město", krajName: "Jihomoravský kraj" },
  ];
  while (links.length < 85) {
    links.push({
      orpCode: String(8000 + links.length),
      orpId: "orp:" + String(8000 + links.length),
      orpName: "Y" + links.length,
      okresName: "O",
      krajName: "Olomoucký kraj",
    });
  }
  return {
    id: "ie-chmi-v2-b",
    title: "Silné bouřky — Brno a dalších 84 oblastí",
    url: "https://example.test/b",
    sourceId: "chmi",
    status: "aktivni",
    publishedAtSource: new Date(now - 3600000).toISOString(),
    publishedAt: new Date(now - 3600000).toISOString(),
    validFrom: new Date(now - 3600000).toISOString(),
    validTo: new Date(now + 48 * 3600000).toISOString(),
    timeConfidence: "high",
    region: {
      name: "Brno",
      summary: "Brno a dalších 84 oblastí",
      orpCodes: links.map((l) => l.orpCode),
      orpIds: links.map((l) => l.orpId),
      orpNames: links.map((l) => l.orpName),
    },
    capV2: { badgeActive: true, geo: { links: links.map((l) => Object.assign({}, l)) } },
  };
}

function unitGate(IU) {
  const a = warningA();
  const b = warningB();
  const snapA = JSON.stringify(a);
  const snapB = JSON.stringify(b);

  const whole = IU.getFilteredWarningLocationLabel(a, { localities: [] });
  ok("no_filter_keeps_summary", whole === "Říčany a dalších 84 oblastí", whole);

  const nup = IU.getFilteredWarningLocationLabel(a, {
    localities: [{ name: "Nupaky", id: "564907", orpCode: "2122", level: "mesto" }],
  });
  ok("nupaky_title", nup === "Nupaky a dalších 84 oblastí", nup);

  const same = IU.getFilteredWarningLocationLabel(a, {
    localities: [
      { name: "Nupaky", id: "564907", orpCode: "2122", level: "mesto" },
      { name: "Čestlice", id: "538141", orpCode: "2122", level: "mesto" },
    ],
  });
  ok("same_orp_once_card_names", same === "Nupaky, Čestlice a dalších 84 oblastí", same);

  const multiSel = {
    localities: [
      { name: "Nupaky", id: "564907", orpCode: "2122", level: "mesto" },
      { name: "Brno", id: "582786", orpCode: "6203", level: "mesto" },
      { name: "Průhonice", id: "539571", orpCode: "2105", level: "mesto" },
    ],
  };
  const labelA = IU.getFilteredWarningLocationLabel(a, multiSel);
  const labelB = IU.getFilteredWarningLocationLabel(b, multiSel);
  ok("card_a_nupaky_pruhonice", labelA === "Nupaky, Průhonice a dalších 84 oblastí", labelA);
  ok("card_a_no_brno", !/Brno/.test(labelA), labelA);
  ok("card_b_brno_only", labelB === "Brno a dalších 84 oblastí", labelB);
  ok("card_b_no_nupaky", !/Nupaky|Průhonice/.test(labelB), labelB);

  const filtered = IU.filterEvents([a, b], multiSel, { skipMemo: true });
  ok("two_distinct_cards", filtered.length === 2, String(filtered.length));
  const idSet = new Set(filtered.map((x) => x.id));
  ok("ids_intact", idSet.has("ie-chmi-v2-a") && idSet.has("ie-chmi-v2-b") && idSet.size === 2, [...idSet].join(","));

  const none = IU.filterEvents([a, b], {
    localities: [{ name: "Cheb", id: "554499", orpCode: "4102", level: "mesto" }],
  }, { skipMemo: true });
  ok("no_false_positive", none.length === 0, String(none.length));

  const cleared = IU.getFilteredWarningLocationLabel(a, { localities: [] });
  ok("clear_filter_restores", cleared === "Říčany a dalších 84 oblastí", cleared);

  const over = IU.normalizeLocalitiesList(
    Array.from({ length: 30 }, (_, i) => ({
      name: "O" + i,
      id: String(20000 + i),
      orpCode: "2122",
      level: "mesto",
    }))
  );
  ok("normalize_caps_20", over.length === 20, String(over.length));
  ok("normalize_keeps_order", over[0].name === "O0" && over[19].name === "O19", over.map((x) => x.name).join(","));

  const dedupe = IU.normalizeLocalitiesList([
    { name: "Nupaky", id: "564907", orpCode: "2122", level: "mesto" },
    { name: "Nupaky", id: "564907", orpCode: "2122", level: "mesto" },
    { name: "Brno", id: "582786", orpCode: "6203", level: "mesto" },
  ]);
  ok("dedupe_by_id", dedupe.length === 2, JSON.stringify(dedupe));

  const prefs = IU.sanitizeUserPrefs({
    localities: Array.from({ length: 25 }, (_, i) => ({
      name: "Z" + i,
      id: String(30000 + i),
      orpCode: "2122",
      level: "mesto",
    })),
  });
  ok("sanitize_caps_20", prefs.localities.filter((x) => x.level === "mesto").length === 20, String(prefs.localities.length));

  ok("no_mutate_a", JSON.stringify(a) === snapA, "mutated_a");
  ok("no_mutate_b", JSON.stringify(b) === snapB, "mutated_b");

  const alias = IU.normalizeOrpCode("1100");
  ok("praha_alias", alias === "1000", alias);
}

function main() {
  dataGate();
  staticGate();
  const IU = loadIU();
  ok("iu_loaded", !!(IU && IU.getFilteredWarningLocationLabel && IU.MAX_CITY_LOCALITIES === 20), "load");
  if (IU) unitGate(IU);

  if (fails.length) {
    console.error("[iu-chmi-obec-orp-mapping-guard] FAIL");
    for (const f of fails) console.error(" - " + f);
    process.exit(1);
  }
  console.log("[iu-chmi-obec-orp-mapping-guard] OK");
  console.log(
    JSON.stringify({
      obce: JSON.parse(fs.readFileSync(PICKER, "utf8")).items.length,
      orp: 206,
      maxCities: 20,
    })
  );
}

main();
