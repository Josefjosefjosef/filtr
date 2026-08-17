#!/usr/bin/env node
/**
 * Guard: CHMI region presentation cards — ordinary kraje split from shared localities card.
 * Runtime logic tests (not text-search-only).
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
const INDEX = path.join(ROOT, "projects", "index.html");
const CACHE_BUST = "feed-filter-redesign-v1-20260817";

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

function link(orpCode, orpName, okresName, krajName) {
  return {
    orpCode,
    orpId: "orp:" + orpCode,
    orpName,
    okresName,
    krajName,
  };
}

function warningFromLinks(links, id) {
  const primary = (links[0] && links[0].orpName) || "Oblast";
  const now = Date.now();
  return {
    id: id || "ie-chmi-v2-region-split",
    title: primary + " a dalších " + Math.max(0, links.length - 1) + " oblastí",
    sourceId: "chmi",
    status: "aktivni",
    publishedAtSource: new Date(now - 3600000).toISOString(),
    publishedAt: new Date(now - 3600000).toISOString(),
    validFrom: new Date(now - 3600000).toISOString(),
    validTo: new Date(now + 48 * 3600000).toISOString(),
    region: {
      name: primary,
      summary: primary + " a dalších " + Math.max(0, links.length - 1) + " oblastí",
      orpCodes: links.map((l) => l.orpCode),
      orpIds: links.map((l) => l.orpId),
      orpNames: links.map((l) => l.orpName),
    },
    capV2: {
      badgeActive: true,
      geo: { links: links.map((l) => Object.assign({}, l)) },
      searchText: links.map((l) => l.orpName).join(" "),
    },
  };
}

function makeStcKvLinks() {
  const links = [
    link("1000", "Praha", "Hlavní město Praha", "Hlavní město Praha"),
    link("2122", "Říčany", "Praha-východ", "Středočeský kraj"),
    link("2115", "Český Brod", "Kolín", "Středočeský kraj"),
    link("2101", "Benešov", "Benešov", "Středočeský kraj"),
    link("2103", "Beroun", "Beroun", "Středočeský kraj"),
    link("2109", "Kladno", "Kladno", "Středočeský kraj"),
    link("4102", "Karlovy Vary", "Karlovy Vary", "Karlovarský kraj"),
    link("4101", "Cheb", "Cheb", "Karlovarský kraj"),
    link("4103", "Sokolov", "Sokolov", "Karlovarský kraj"),
    link("4104", "Ostrov", "Karlovy Vary", "Karlovarský kraj"),
    link("4105", "Mariánské Lázně", "Cheb", "Karlovarský kraj"),
    link("4106", "Aš", "Cheb", "Karlovarský kraj"),
    link("4107", "Kraslice", "Sokolov", "Karlovarský kraj"),
    link("3203", "Horšovský Týn", "Domažlice", "Plzeňský kraj"),
  ];
  // pad Středočeský to 18 hit ORPs in this warning
  let n = 0;
  while (links.filter((l) => l.krajName === "Středočeský kraj").length < 18) {
    n += 1;
    links.push(link(String(2180 + n), "StcOrp" + n, "Kolín", "Středočeský kraj"));
  }
  // pad total unique ORPs for remainder math
  while (links.length < 90) {
    const i = links.length;
    links.push(link(String(9000 + i), "Pad" + i, "OkresPad", "Jihočeský kraj"));
  }
  return links;
}

function staticGate() {
  const core = fs.readFileSync(CORE, "utf8");
  const ui = fs.readFileSync(UI, "utf8");
  const css = fs.readFileSync(CSS, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  ok("core_expand", /function expandChmiLocalityPresentationCards/.test(core), "expand");
  ok("core_build", /function buildChmiLocalityPresentationCards/.test(core), "build");
  ok("core_totals", /stredocesky kraj.: 26/.test(core) && /karlovarsky kraj.: 7/.test(core), "totals");
  ok("core_phrase_full", /Platí pro celý kraj/.test(core), "full");
  ok("core_phrase_partial", /ORP v kraji/.test(core), "partial");
  ok("ui_expand_hook", /expandChmiLocalityPresentationCards/.test(ui), "ui hook");
  ok("ui_coverage_markup", /iuPrehledDne__regionCoverage/.test(ui), "coverage");
  ok("css_coverage", /\.iuPrehledDne__regionCoverage/.test(css), "css");
  ok("bust_ui", ui.includes(CACHE_BUST), "ui bust");
  ok("bust_index_js", index.includes("iu-prehled-dne-ui-v1.js?v=" + CACHE_BUST), "index js");
  ok("bust_index_css", index.includes("iu-prehled-dne-v1.css?v=" + CACHE_BUST), "index css");
}

function unitGate(IU) {
  const links = makeStcKvLinks();
  const warning = warningFromLinks(links);
  const snap = JSON.stringify(warning);

  // 21.1 kraj + obec
  const sel1 = {
    localities: [
      { name: "Středočeský kraj", level: "kraj" },
      { name: "Nupaky", level: "mesto", id: "564907", orpCode: "2122" },
    ],
  };
  const cards1 = IU.buildChmiLocalityPresentationCards(warning, sel1);
  ok("21_1_count", cards1.length === 2, String(cards1.length));
  const local1 = cards1.find((c) => c._iuPresentation && c._iuPresentation.kind === "localities");
  const reg1 = cards1.find((c) => c._iuPresentation && c._iuPresentation.kind === "region");
  ok("21_1_local_nupaky", local1 && /Nupaky/.test(local1._iuPresentation.locationLabel), local1 && local1._iuPresentation.locationLabel);
  ok("21_1_local_no_stc", local1 && !/Středočeský kraj/.test(local1._iuPresentation.locationLabel), local1 && local1._iuPresentation.locationLabel);
  ok("21_1_region_stc", reg1 && reg1._iuPresentation.locationLabel === "Středočeský kraj", reg1 && reg1._iuPresentation.locationLabel);
  ok("21_1_region_x_of_26", reg1 && /18 z 26 ORP/.test(reg1._iuPresentation.regionCoverageLine), reg1 && reg1._iuPresentation.regionCoverageLine);
  ok("21_1_label_fn_no_kraj", !/Středočeský kraj/.test(IU.getFilteredWarningLocationLabel(warning, sel1)), IU.getFilteredWarningLocationLabel(warning, sel1));

  // 21.2 kraj + Praha + cities — Praha stays local, no Praha region card
  const sel2 = {
    localities: [
      { name: "Středočeský kraj", level: "kraj" },
      { name: "Hlavní město Praha", level: "kraj" },
      { name: "Nupaky", level: "mesto", id: "564907", orpCode: "2122" },
      { name: "Průhonice", level: "mesto", id: "539597", orpCode: "2122" },
      { name: "Česká Lípa", level: "mesto", id: "561380", orpCode: "5103" },
    ],
  };
  // add Česká Lípa ORP in Liberec for match? Spec example has Česká Lípa as city — if not in warning, won't match.
  // Add Liberec ORP for Česká Lípa
  const links2 = links.concat([link("5103", "Česká Lípa", "Česká Lípa", "Liberecký kraj")]);
  const w2 = warningFromLinks(links2, "ie-chmi-v2-region-split-2");
  const cards2 = IU.buildChmiLocalityPresentationCards(w2, sel2);
  const locals2 = cards2.filter((c) => c._iuPresentation.kind === "localities");
  const regions2 = cards2.filter((c) => c._iuPresentation.kind === "region");
  ok("21_2_one_local", locals2.length === 1, String(locals2.length));
  ok("21_2_one_stc_region", regions2.length === 1 && regions2[0]._iuPresentation.locationLabel === "Středočeský kraj", String(regions2.length));
  ok("21_2_praha_in_local", /Praha/.test(locals2[0]._iuPresentation.locationLabel), locals2[0]._iuPresentation.locationLabel);
  ok("21_2_no_praha_region", !regions2.some((c) => /Praha/.test(c._iuPresentation.locationLabel)), "praha region");
  ok("21_2_no_1_of_1", !cards2.some((c) => /1 z 1 ORP/.test((c._iuPresentation && c._iuPresentation.regionCoverageLine) || "")), "1z1");

  // 21.3 two kraje
  const sel3 = {
    localities: [
      { name: "Středočeský kraj", level: "kraj" },
      { name: "Karlovarský kraj", level: "kraj" },
      { name: "Nupaky", level: "mesto", id: "564907", orpCode: "2122" },
    ],
  };
  const cards3 = IU.buildChmiLocalityPresentationCards(warning, sel3);
  ok("21_3_count", cards3.length === 3, String(cards3.length));
  ok(
    "21_3_kinds",
    cards3.map((c) => c._iuPresentation.kind).join(",") === "localities,region,region",
    cards3.map((c) => c._iuPresentation.kind).join(",")
  );

  // 21.4 kraj without match
  const sel4 = {
    localities: [
      { name: "Karlovarský kraj", level: "kraj" },
      { name: "Nupaky", level: "mesto", id: "564907", orpCode: "2122" },
    ],
  };
  const wNoKv = warningFromLinks(
    links.filter((l) => l.krajName !== "Karlovarský kraj"),
    "ie-chmi-v2-no-kv"
  );
  const cards4 = IU.buildChmiLocalityPresentationCards(wNoKv, sel4);
  ok("21_4_no_kv_card", !cards4.some((c) => /Karlovarský/.test((c._iuPresentation && c._iuPresentation.locationLabel) || "")), String(cards4.length));
  ok("21_4_no_zero", !cards4.some((c) => /0 z /.test((c._iuPresentation && c._iuPresentation.regionCoverageLine) || "")), "zero");

  // 21.5 full kraj coverage
  const fullKvLinks = links.filter((l) => l.krajName === "Karlovarský kraj");
  ok("21_5_kv_7", fullKvLinks.length === 7, String(fullKvLinks.length));
  const wFullKv = warningFromLinks(fullKvLinks, "ie-chmi-v2-full-kv");
  const cards5 = IU.buildChmiLocalityPresentationCards(wFullKv, {
    localities: [{ name: "Karlovarský kraj", level: "kraj" }],
  });
  ok("21_5_only_region", cards5.length === 1 && cards5[0]._iuPresentation.kind === "region", String(cards5.length));
  ok(
    "21_5_full_phrase",
    cards5[0]._iuPresentation.regionCoverageLine === "Platí pro celý kraj – všech 7 ORP",
    cards5[0]._iuPresentation.regionCoverageLine
  );

  // 21.6 partial
  const partial = IU.formatRegionOrpCoveragePhrase(10, 26);
  ok("21_6_partial", partial === "Platí pro 10 z 26 ORP v kraji", partial);

  // 21.7 duplicate ORP identity
  const dupLinks = [
    link("2122", "Říčany", "Praha-východ", "Středočeský kraj"),
    link("2122", "Říčany", "Praha-východ", "Středočeský kraj"),
    link("2115", "Český Brod", "Kolín", "Středočeský kraj"),
  ];
  const wDup = warningFromLinks(dupLinks, "ie-chmi-v2-dup");
  const covDup = IU.regionOrpCoverageForSelection(wDup, {
    type: "kraj",
    name: "Středočeský kraj",
    displayName: "Středočeský kraj",
  });
  ok("21_7_unique_hit", covDup.hit === 2, String(covDup.hit));
  ok("21_7_hit_le_total", covDup.hit <= covDup.total, covDup.hit + "/" + covDup.total);

  // 21.8 only kraj — no empty local
  const cards8 = IU.buildChmiLocalityPresentationCards(warning, {
    localities: [{ name: "Středočeský kraj", level: "kraj" }],
  });
  ok("21_8_only_region", cards8.length === 1 && cards8[0]._iuPresentation.kind === "region", String(cards8.length));

  // 21.9 only cities — no region card, same shared label behavior
  const sel9 = {
    localities: [
      { name: "Hlavní město Praha", level: "kraj" },
      { name: "Nupaky", level: "mesto", id: "564907", orpCode: "2122" },
    ],
  };
  const cards9 = IU.buildChmiLocalityPresentationCards(warning, sel9);
  ok("21_9_only_local", cards9.length === 1 && cards9[0]._iuPresentation.kind === "localities", String(cards9.length));
  ok("21_9_label", /Praha/.test(cards9[0]._iuPresentation.locationLabel) && /Nupaky/.test(cards9[0]._iuPresentation.locationLabel), cards9[0]._iuPresentation.locationLabel);

  // 21.10 Praha
  ok("21_10_is_prague", IU.isPragueKrajSelection({ type: "kraj", name: "Hlavní město Praha" }) === true, "praha");
  ok("21_10_stc_ordinary", IU.isOrdinaryKrajSelection({ type: "kraj", name: "Středočeský kraj" }) === true, "stc");

  // stable ids + source binding
  ok("id_local", local1 && String(local1.id).endsWith("::p:local"), local1 && local1.id);
  ok("id_region", reg1 && /::p:kraj:/.test(reg1.id), reg1 && reg1.id);
  ok("source_bind", local1 && local1._iuSourceWarningId === warning.id && reg1._iuSourceWarningId === warning.id, "src");
  ok("lifecycle_same", local1.status === warning.status && reg1.status === warning.status, "status");
  ok("no_mutate", JSON.stringify(warning) === snap, "mutated");

  // expand preserves non-CHMI
  const other = { id: "ie-other", title: "X", sourceId: "hzs" };
  const expanded = IU.expandChmiLocalityPresentationCards([warning, other], sel1);
  ok("expand_keeps_other", expanded.some((e) => e.id === "ie-other"), "other");
  ok("expand_split", expanded.filter((e) => e._iuSourceWarningId === warning.id).length === 2, "split");
}

function main() {
  staticGate();
  const IU = loadIU();
  ok(
    "iu_loaded",
    !!(IU && IU.buildChmiLocalityPresentationCards && IU.expandChmiLocalityPresentationCards),
    "load"
  );
  if (IU && IU.buildChmiLocalityPresentationCards) unitGate(IU);
  if (fails.length) {
    console.error("[iu-chmi-region-cards-split-guard] FAIL");
    for (const f of fails) console.error(" - " + f);
    process.exit(1);
  }
  console.log("[iu-chmi-region-cards-split-guard] OK");
}

main();
