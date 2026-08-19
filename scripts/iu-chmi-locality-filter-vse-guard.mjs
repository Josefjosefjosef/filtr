#!/usr/bin/env node
/**
 * Guard: CHMI locality filter ↔ title unified source of truth + Vše locality bypass
 * + future-only „Výstraha ČHMÚ platí od … hod.“ sentence.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { readPrehledDneUiCacheBust } from "./guards/iu-prehled-dne-cache-bust.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CORE = path.join(ROOT, "assets", "iu-info-system-core-v1.js");
const UI = path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js");
const CSS = path.join(ROOT, "assets", "iu-prehled-dne-v1.css");
const INDEX = path.join(ROOT, "projects", "index.html");
const CACHE_BUST = "evening-theme-settings-v1-20260818";

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

function warning(extraLinks) {
  const links = [
    {
      orpCode: "2122",
      orpName: "Říčany",
      okresName: "Praha-východ",
      krajName: "Středočeský kraj",
    },
    {
      orpCode: "7201",
      orpName: "Zlín",
      okresName: "Zlín",
      krajName: "Zlínský kraj",
    },
    {
      orpCode: "1000",
      orpName: "Praha",
      okresName: "Hlavní město Praha",
      krajName: "Hlavní město Praha",
    },
  ].concat(extraLinks || []);
  while (links.length < 75) {
    links.push({
      orpCode: String(8000 + links.length),
      orpName: "Oblast" + links.length,
      okresName: "Okres",
      krajName: "Kraj",
    });
  }
  const now = Date.now();
  return {
    id: "ie-chmi-v2-filter-vse",
    title: "Vítr — Praha a dalších 74 oblastí",
    sourceId: "chmi",
    status: "aktivni",
    eventType: "mimoradne",
    publishedAtSource: new Date(now - 7200000).toISOString(),
    publishedAt: new Date(now - 7200000).toISOString(),
    validFrom: new Date(now + 3600000).toISOString(),
    validTo: new Date(now + 48 * 3600000).toISOString(),
    sectionId: "pocasi",
    lane: "pocasi",
    region: {
      summary: "Praha a dalších 74 oblastí",
      name: "Praha",
      orpCodes: links.map((l) => l.orpCode),
    },
    capV2: { badgeActive: true, geo: { links: links.map((l) => Object.assign({}, l)) } },
  };
}

function staticGate() {
  const core = fs.readFileSync(CORE, "utf8");
  const ui = fs.readFileSync(UI, "utf8");
  const css = fs.readFileSync(CSS, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");

  ok("core_resolve_fn", /function resolveWarningLocalityMatch/.test(core), "resolve");
  ok("core_match_uses_resolve", /function eventMatchesLocationFilter[\s\S]{0,120}resolveWarningLocalityMatch/.test(core), "match");
  ok("core_label_uses_resolve", /function getFilteredWarningLocationLabel[\s\S]{0,480}resolveWarningLocalityMatch/.test(core), "label");
  ok("core_future_sentence", /Výstraha ČHMÚ platí od/.test(core) && /hod\./.test(core), "sentence");
  ok("core_active_no_future_sentence", /Active warnings must never show the future-only/.test(core), "active ban");
  ok("ui_effective_prefs", /function effectivePrefs/.test(ui) && /effectivePrefs\(\)/.test(ui), "effective");
  ok("ui_vse_toggle_home", /viewMode === "all" \? "home" : "all"/.test(ui), "toggle");
  ok("ui_vse_locality_only", /Temporary locality bypass only/.test(ui), "bypass scope");
  ok("ui_title_uses_effective", /locationFilter = effectivePrefs\(\)/.test(ui), "title filter");
  ok("ui_future_sentence_class", /validFrom--futureSentence/.test(ui), "css class");
  ok("css_sentence", /validFrom--futureSentence/.test(css), "css");
  ok("bust_ui", ui.includes(CACHE_BUST), "ui bust");
  ok("bust_index_js", index.includes("iu-prehled-dne-ui-v1.js?v=" + readPrehledDneUiCacheBust(ROOT)), "index js");
  ok("bust_index_css", index.includes("iu-prehled-dne-v1.css?v=" + CACHE_BUST), "index css");
}

function unitGate(IU) {
  const w = warning();
  const savedLocalities = [
    { name: "Nupaky", level: "mesto", id: "564907", orpCode: "2122" },
    { name: "Zlín", level: "mesto", orpCode: "7201" },
    { name: "Cheb", level: "mesto", orpCode: "4102" },
  ];
  const prefs = { localities: savedLocalities, localityQuery: "", sections: ["pocasi"] };

  ok("hide_cheb_only", IU.filterEvents([w], { localities: [{ name: "Cheb", level: "mesto", orpCode: "4102" }] }, { skipMemo: true }).length === 0, "cheb");
  ok(
    "keep_or_nupaky_zlin",
    IU.filterEvents([w], { localities: savedLocalities }, { skipMemo: true }).length === 1,
    "or"
  );

  const label = IU.getFilteredWarningLocationLabel(w, prefs);
  ok("title_has_nupaky_zlin", /Nupaky/.test(label) && /Zlín/.test(label), label);
  ok("title_no_cheb", !/Cheb/.test(label), label);
  ok("title_no_dup", !/Nupaky,\s*Nupaky/.test(label) && !/Zlín,\s*Zlín/.test(label), label);

  const dupPrefs = {
    localities: [
      { name: "Zlín", level: "mesto", orpCode: "7201" },
      { name: "Zlín", level: "mesto", orpCode: "7201" },
      { name: "zlín", level: "mesto", orpCode: "7201" },
    ],
  };
  const dupLabel = IU.getFilteredWarningLocationLabel(w, dupPrefs);
  ok("dedupe_title", dupLabel.startsWith("Zlín") && !/Zlín,\s*Zlín/.test(dupLabel), dupLabel);

  // Vše-like prefs: empty localities must show the card and keep stored prefs object intact.
  const prefsSnap = JSON.stringify(prefs);
  const allMode = Object.assign({}, prefs, {
    localities: [],
    localityQuery: "",
    homeKraj: "",
    homeOkres: "",
    homeObec: "",
    myRegionOnly: false,
  });
  ok("vse_shows_all", IU.filterEvents([w], allMode, { skipMemo: true }).length === 1, "vse show");
  ok("vse_prefs_untouched", JSON.stringify(prefs) === prefsSnap, "prefs intact");
  ok(
    "restore_filter",
    IU.filterEvents([w], prefs, { skipMemo: true }).length === 1 &&
      IU.filterEvents([w], { localities: [{ name: "Cheb", level: "mesto", orpCode: "4102" }] }, { skipMemo: true }).length === 0,
    "restore"
  );

  const before = Date.now() - 1000;
  const futureFrom = before + 6 * 3600000;
  const future = warning();
  future.validFrom = new Date(futureFrom).toISOString();
  future.validTo = new Date(futureFrom + 12 * 3600000).toISOString();
  future.publishedAtSource = new Date(before - 3600000).toISOString();
  future.publishedAt = future.publishedAtSource;
  const tl = IU.getEffectiveTimelinePresentation(future, before);
  ok("future_flag", tl.isFutureWarning === true, "future");
  ok("future_sentence_prefix", /^Výstraha ČHMÚ platí od /.test(String(tl.secondaryValidFromLabel || "")), tl.secondaryValidFromLabel);
  ok("future_sentence_hod", / hod\.$/.test(String(tl.secondaryValidFromLabel || "")), tl.secondaryValidFromLabel);
  ok("future_no_split_parts", tl.secondaryValidFromDate == null && tl.secondaryValidFromTime == null, "split");

  const activeTl = IU.getEffectiveTimelinePresentation(future, futureFrom + 60000);
  ok("active_clears_sentence", activeTl.isActiveWarning === true && !activeTl.secondaryValidFromLabel, String(activeTl.secondaryValidFromLabel));
}

function main() {
  staticGate();
  const IU = loadIU();
  ok("iu_loaded", !!(IU && IU.resolveWarningLocalityMatch && IU.getEffectiveTimelinePresentation), "load");
  if (IU && IU.resolveWarningLocalityMatch) unitGate(IU);
  if (fails.length) {
    console.error("[iu-chmi-locality-filter-vse-guard] FAIL");
    for (const f of fails) console.error(" - " + f);
    process.exit(1);
  }
  console.log("[iu-chmi-locality-filter-vse-guard] OK");
}

main();
