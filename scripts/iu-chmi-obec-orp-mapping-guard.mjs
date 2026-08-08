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
const CACHE_BUST = "traffic-ui-ls-mem-guard-v1-20260808";

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
  const regOrpUnits = geo.units.filter((u) => u.type === "orp");
  const regOrp = regOrpUnits.map((u) => String(u.code));
  const regSet = new Set(regOrp);
  const standardOrp = regOrp.filter((c) => c !== "1000");
  const prahaUnits = regOrpUnits.filter((u) => String(u.code) === "1000");
  ok("picker_version3", Number(picker.version) >= 3, String(picker.version));
  ok("items_array", Array.isArray(picker.items), "items");
  // Exact CISORP model used by CHMI CAP:
  // 205 standard správní obvody ORP + 1 technical Praha code 1000 = 206 technical codes.
  ok("tech_codes_206", regOrp.length === 206 && regSet.size === 206, String(regOrp.length) + "/" + regSet.size);
  ok("standard_orp_205", standardOrp.length === 205, String(standardOrp.length));
  ok("praha_single_unit", prahaUnits.length === 1 && prahaUnits[0].name === "Praha", JSON.stringify(prahaUnits));
  ok("praha_not_in_standard", !standardOrp.includes("1000"), "1000_in_standard");
  ok("alias_1100_to_1000", String((geo.aliases || {})["1100"]) === "1000", JSON.stringify(geo.aliases));
  ok("alias_1100_not_registry_unit", !regSet.has("1100"), "1100_present");

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
  ok("obce_exact_6258", (picker.items || []).length === 6258, String((picker.items || []).length));
  ok("all_obce_valid", bad.length === 0, bad.slice(0, 15).join("|"));
  const missing = regOrp.filter((c) => !covered.has(c));
  ok("all_tech_codes_covered", missing.length === 0, missing.join(","));
  ok("standard_205_covered", standardOrp.every((c) => covered.has(c)), "missing_standard");
  ok("praha_code_covered", covered.has("1000"), "praha_uncovered");
  ok("counts_match", Number(picker.counts && picker.counts.orp) === covered.size, JSON.stringify(picker.counts));
  // CISOB (43) = obce + vojenské újezdy; known újezd seats must remain mapped.
  const libava = (picker.items || []).find((x) => x.id === "503941" && x.n === "Libavá");
  const boletice = (picker.items || []).find((x) => x.id === "545422" && x.n === "Boletice");
  ok("military_libava_mapped", !!(libava && libava.orp), JSON.stringify(libava || null));
  ok("military_boletice_mapped", !!(boletice && boletice.orp), JSON.stringify(boletice || null));

  const nupaky = (picker.items || []).find((x) => x.n === "Nupaky");
  ok("nupaky_orp_ricany", !!(nupaky && nupaky.orp === "2122"), JSON.stringify(nupaky || null));
  const cestlice = (picker.items || []).find((x) => x.n === "Čestlice");
  ok("cestlice_same_orp", !!(cestlice && cestlice.orp === "2122"), JSON.stringify(cestlice || null));
  const pruhonice = (picker.items || []).find((x) => x.n === "Průhonice");
  ok("pruhonice_orp_cernosice", !!(pruhonice && pruhonice.orp === "2105"), JSON.stringify(pruhonice || null));
  ok("pruhonice_not_same_as_nupaky", !!(pruhonice && nupaky && pruhonice.orp !== nupaky.orp), "same_orp_wrong");
  const praha = (picker.items || []).find((x) => x.n === "Praha");
  ok("praha_orp", !!(praha && praha.orp === "1000"), JSON.stringify(praha || null));
  const brno = (picker.items || []).find((x) => x.n === "Brno");
  ok("brno_is_orp_seat", !!(brno && brno.orp === "6203" && brno.orpN === "Brno"), JSON.stringify(brno || null));
  const benesov = (picker.items || []).filter((x) => x.n === "Benešov");
  ok("same_name_distinct_ids", benesov.length >= 2 && new Set(benesov.map((x) => x.id)).size === benesov.length, JSON.stringify(benesov));
  ok("same_name_distinct_orp_possible", new Set(benesov.map((x) => x.orp)).size >= 2, JSON.stringify(benesov.map((x) => x.orp)));

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
  ok("card_a_nupaky_pruhonice", labelA === "Nupaky, Průhonice a dalších 83 oblastí", labelA);
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

  // Praha alias must not double-count ORP remainder when CAP emits 1100 + 1000.
  const prahaWarn = {
    id: "ie-chmi-v2-praha",
    title: "Sucho — Praha",
    sourceId: "chmi",
    status: "aktivni",
    validFrom: new Date(Date.now() - 3600000).toISOString(),
    validTo: new Date(Date.now() + 48 * 3600000).toISOString(),
    publishedAtSource: new Date(Date.now() - 3600000).toISOString(),
    region: {
      name: "Praha",
      summary: "Praha",
      orpCodes: ["1000", "1100"],
      orpIds: ["orp:1000", "orp:1100"],
      orpNames: ["Praha", "Praha"],
    },
    capV2: {
      badgeActive: true,
      geo: {
        links: [
          { orpCode: "1000", orpId: "orp:1000", orpName: "Praha", okresName: "Hlavní město Praha", krajName: "Hlavní město Praha" },
          { orpCode: "1100", orpId: "orp:1100", orpName: "Praha", okresName: "Hlavní město Praha", krajName: "Hlavní město Praha" },
        ],
      },
    },
  };
  const prahaCodes = IU.warningOrpCodeSet(prahaWarn);
  ok("praha_alias_dedupe_set", prahaCodes.size === 1 && prahaCodes.has("1000"), [...prahaCodes].join(","));
  const prahaKept = IU.filterEvents(
    [prahaWarn],
    { localities: [{ name: "Praha", id: "554782", orpCode: "1000", level: "mesto" }] },
    { skipMemo: true }
  );
  ok("praha_filter_once", prahaKept.length === 1, String(prahaKept.length));

  // 20 relevant obce in one title (selection order preserved).
  const twenty = Array.from({ length: 20 }, (_, i) => ({
    name: "Obec" + String(i + 1).padStart(2, "0"),
    id: String(40000 + i),
    orpCode: i % 2 === 0 ? "2122" : "2105",
    level: "mesto",
  }));
  const title20 = IU.getFilteredWarningLocationLabel(a, { localities: twenty });
  // 20 obce across 2 unique ORPs ⇒ remainder = 85 links − 2 ORPs = 83
  const expected20 = twenty.map((x) => x.name).join(", ") + " a dalších 83 oblastí";
  ok("title_all_20_names", title20 === expected20, title20.slice(0, 120));
  ok("title_20_order_stable", title20.startsWith("Obec01, Obec02, Obec03"), title20.slice(0, 40));

  // Migration: 25 + duplicate + invalid → first 20 unique valid by order.
  const migrated = IU.normalizeLocalitiesList([
    { name: "A", id: "1", orpCode: "2122", level: "mesto" },
    { name: "A-dup", id: "1", orpCode: "2122", level: "mesto" },
    { name: "", id: "bad", orpCode: "2122", level: "mesto" },
    ...Array.from({ length: 24 }, (_, i) => ({
      name: "M" + i,
      id: String(50000 + i),
      orpCode: "2122",
      level: "mesto",
    })),
  ]);
  ok("migrate_len_20", migrated.length === 20, String(migrated.length));
  ok("migrate_first_is_A", migrated[0].id === "1" && migrated[0].name === "A", JSON.stringify(migrated[0]));
  ok("migrate_no_dup_id", new Set(migrated.map((x) => x.id)).size === 20, "dups");

  // Isolation: two independent preference objects do not leak titles into shared warning.
  const snapShared = JSON.stringify(a);
  const labelUserA = IU.getFilteredWarningLocationLabel(a, {
    localities: [{ name: "Nupaky", id: "564907", orpCode: "2122", level: "mesto" }],
  });
  const labelUserB = IU.getFilteredWarningLocationLabel(a, {
    localities: [{ name: "Brno", id: "582786", orpCode: "6203", level: "mesto" }],
  });
  ok("isolation_a_nupaky", labelUserA.startsWith("Nupaky"), labelUserA);
  ok("isolation_b_empty_for_brno_on_a", labelUserB === "", labelUserB);
  ok("isolation_no_shared_mutation", JSON.stringify(a) === snapShared, "mutated");
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
      obce: 6258,
      standardOrp: 205,
      technicalCodes: 206,
      prahaCode: "1000",
      prahaAlias: "1100->1000",
      maxCities: 20,
    })
  );
}

main();
