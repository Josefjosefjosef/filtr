#!/usr/bin/env node
/**
 * Guard: CHMI CAP card locality label follows active location filter (display-only).
 * Unit tests via IUInfoSystem core + static UI/wiring contract.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CORE = path.join(ROOT, "assets", "iu-info-system-core-v1.js");
const UI = path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js");
const INDEX = path.join(ROOT, "projects", "index.html");
const CACHE_BUST = "heavy-feed-offmain-v1-20260809";

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
    document: {
      documentElement: { classList: { toggle() {} } },
    },
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

function sampleWarning() {
  const links = [
    {
      orpCode: "1000",
      orpId: "orp:1000",
      orpName: "Praha",
      okresName: "Hlavní město Praha",
      krajName: "Hlavní město Praha",
    },
    {
      orpCode: "2101",
      orpId: "orp:2101",
      orpName: "Benešov",
      okresName: "Benešov",
      krajName: "Středočeský kraj",
    },
    {
      orpCode: "2108",
      orpId: "orp:2108",
      orpName: "Kladno",
      okresName: "Kladno",
      krajName: "Středočeský kraj",
    },
    {
      orpCode: "2103",
      orpId: "orp:2103",
      orpName: "Beroun",
      okresName: "Beroun",
      krajName: "Středočeský kraj",
    },
    {
      orpCode: "5205",
      orpId: "orp:5205",
      orpName: "Hradec Králové",
      okresName: "Hradec Králové",
      krajName: "Královéhradecký kraj",
    },
    {
      orpCode: "6203",
      orpId: "orp:6203",
      orpName: "Brno",
      okresName: "Brno-město",
      krajName: "Jihomoravský kraj",
    },
    {
      orpCode: "4213",
      orpId: "orp:4213",
      orpName: "Rumburk",
      okresName: "Děčín",
      krajName: "Ústecký kraj",
    },
    {
      orpCode: "2117",
      orpId: "orp:2117",
      orpName: "Vlašim",
      okresName: "Benešov",
      krajName: "Středočeský kraj",
    },
    {
      orpCode: "2118",
      orpId: "orp:2118",
      orpName: "Votice",
      okresName: "Benešov",
      krajName: "Středočeský kraj",
    },
    {
      orpCode: "2122",
      orpId: "orp:2122",
      orpName: "Říčany",
      okresName: "Praha-východ",
      krajName: "Středočeský kraj",
    },
    {
      orpCode: "2105",
      orpId: "orp:2105",
      orpName: "Černošice",
      okresName: "Praha-západ",
      krajName: "Středočeský kraj",
    },
  ];
  // pad to mimic multi-area count for city-mode remainder
  while (links.length < 192) {
    links.push({
      orpCode: String(9000 + links.length),
      orpId: "orp:" + String(9000 + links.length),
      orpName: "Oblast" + links.length,
      okresName: "OkresX",
      krajName: "Jihočeský kraj",
    });
  }
  const now = Date.now();
  return {
    id: "ie-chmi-v2-loc-test",
    title: "Vysoké teploty — Praha a dalších 191 oblastí",
    url: "https://opendata.chmi.cz/meteorology/weather/alerts/cap/alert_cap_50_loc.xml?hid=loc-test",
    originalUrl: "https://opendata.chmi.cz/meteorology/weather/alerts/cap/alert_cap_50_loc.xml?hid=loc-test",
    sourceId: "chmi",
    sourceLabel: "ČHMÚ",
    status: "aktivni",
    eventType: "mimoradne",
    publishedAtSource: new Date(now - 3600000).toISOString(),
    publishedAt: new Date(now - 3600000).toISOString(),
    validFrom: new Date(now - 3600000).toISOString(),
    validTo: new Date(now + 48 * 3600000).toISOString(),
    timeConfidence: "high",
    sectionId: "pocasi",
    lane: "pocasi",
    region: {
      level: "multi",
      name: "Praha",
      summary: "Praha a dalších 191 oblastí",
      extraAreaCount: 191,
      orpNames: links.map((l) => l.orpName),
      orpCodes: links.map((l) => l.orpCode),
      orpIds: links.map((l) => l.orpId),
      krajNames: [...new Set(links.map((l) => l.krajName))],
      okresNames: [...new Set(links.map((l) => l.okresName))],
    },
    capV2: {
      badgeActive: true,
      geo: { links: links.map((l) => Object.assign({}, l)) },
      searchText: "vysoke teploty praha hradec",
    },
  };
}

function staticGate() {
  const ui = fs.readFileSync(UI, "utf8");
  const core = fs.readFileSync(CORE, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  ok("core_fn", /function getFilteredWarningLocationLabel/.test(core), "fn");
  ok("core_export", /getFilteredWarningLocationLabel/.test(core), "export");
  ok("core_no_mutate_assign", !/warning\.region\s*=/.test(core.split("getFilteredWarningLocationLabel")[1] || ""), "mutate");
  ok("ui_imports_fn", /getFilteredWarningLocationLabel/.test(ui), "import");
  ok("ui_uses_in_render", /getFilteredWarningLocationLabel\(ev/.test(ui), "render");
  ok("ui_title_uses_filter", /displayEventTitle\(ev,\s*locationFilter\)/.test(ui), "title");
  ok("ui_url_prefers_public_web", /vystrahy-cr\.chmi\.cz/.test(ui) && /chmiPublicDetailUrl\(ev\)/.test(ui), "url");
  ok("ui_rejects_cap_xml_click", /Never open CAP XML/.test(ui), "xml");
  ok("ui_cache_bust", ui.includes(CACHE_BUST), "ui bust");
  ok("index_cache_bust", index.includes("iu-prehled-dne-ui-v1.js?v=" + CACHE_BUST), "index bust");
  ok("open_title_mark_only", /act === "open-title"[\s\S]{0,180}markRead/.test(ui), "open");
}

function unitGate(IU) {
  const warning = sampleWarning();
  const snapshot = JSON.stringify(warning);

  const whole = IU.getFilteredWarningLocationLabel(warning, { localities: [] });
  ok("cr_keeps_global", whole === "Praha a dalších 191 oblastí", whole);

  const hk = IU.getFilteredWarningLocationLabel(warning, {
    localities: [{ name: "Hradec Králové", level: "mesto" }],
    homeObec: "Hradec Králové",
  });
  ok("city_starts_hk", hk.startsWith("Hradec Králové"), hk);
  ok("city_not_praha_first", !hk.startsWith("Praha"), hk);
  ok("city_keeps_global_remainder", /a dalších 191 oblastí/.test(hk), hk);

  const stcFilter = {
    localities: [{ name: "Středočeský kraj", level: "kraj" }],
    homeKraj: "Středočeský kraj",
  };
  const stc = IU.getFilteredWarningLocationLabel(warning, stcFilter);
  // Ordinary kraj is no longer in the shared localities label (separate region card).
  ok("kraj_shared_label_empty", stc === "", stc);
  const stcCards = IU.buildChmiLocalityPresentationCards
    ? IU.buildChmiLocalityPresentationCards(warning, stcFilter)
    : [];
  ok("kraj_region_card", stcCards.length === 1 && stcCards[0]._iuPresentation.kind === "region", String(stcCards.length));
  ok(
    "kraj_uses_selected_name",
    stcCards[0] && stcCards[0]._iuPresentation.locationLabel === "Středočeský kraj",
    stcCards[0] && stcCards[0]._iuPresentation.locationLabel
  );
  ok(
    "kraj_no_orp_fallback",
    stcCards[0] && !/Benešov|Beroun|Kladno|Vlašim|Votice|Říčany|Černošice/.test(stcCards[0]._iuPresentation.locationLabel),
    stcCards[0] && stcCards[0]._iuPresentation.locationLabel
  );
  ok(
    "kraj_coverage_line",
    stcCards[0] && /ORP/.test(stcCards[0]._iuPresentation.regionCoverageLine || ""),
    stcCards[0] && stcCards[0]._iuPresentation.regionCoverageLine
  );
  ok("kraj_no_zero", stcCards[0] && !/0 z /.test(stcCards[0]._iuPresentation.regionCoverageLine || ""), "zero");

  const okres = IU.getFilteredWarningLocationLabel(warning, {
    localities: [{ name: "Benešov", level: "okres" }],
    homeOkres: "Benešov",
  });
  ok("okres_starts_benesov", okres.startsWith("Benešov"), okres);
  // Benešov okres: Benešov + Vlašim + Votice = 3 ORPs → 192 - 3 = 189
  ok("okres_extra_unique_orp", /a dalších 189 oblastí/.test(okres), okres);

  const praha = IU.getFilteredWarningLocationLabel(warning, {
    localities: [{ name: "Praha", level: "mesto" }],
  });
  ok("praha_first", praha.startsWith("Praha"), praha);

  const brno = IU.getFilteredWarningLocationLabel(warning, {
    localities: [{ name: "Brno", level: "mesto" }],
  });
  ok("brno_first", brno.startsWith("Brno"), brno);
  ok("brno_not_praha", !brno.startsWith("Praha"), brno);

  const rum = IU.getFilteredWarningLocationLabel(warning, {
    localities: [{ name: "Rumburk", level: "mesto" }],
  });
  ok("rumburk_first", rum.startsWith("Rumburk"), rum);

  const outside = IU.getFilteredWarningLocationLabel(warning, {
    localities: [{ name: "Cheb", level: "mesto" }],
  });
  ok("outside_empty", outside === "", outside);

  const single = {
    id: "ie-chmi-v2-one",
    sourceId: "chmi",
    title: "Sucho — Kladno",
    region: { summary: "Kladno", name: "Kladno" },
    capV2: {
      geo: {
        links: [{ orpName: "Kladno", okresName: "Kladno", krajName: "Středočeský kraj", orpCode: "2108", orpId: "orp:2108" }],
      },
    },
  };
  const singleFilter = { localities: [{ name: "Středočeský kraj", level: "kraj" }] };
  const one = IU.getFilteredWarningLocationLabel(single, singleFilter);
  // Ordinary kraj is a region card now — shared localities label stays empty.
  ok("single_no_extra", one === "", one);
  const singleCards = IU.buildChmiLocalityPresentationCards
    ? IU.buildChmiLocalityPresentationCards(single, singleFilter)
    : [];
  ok(
    "single_region_card",
    singleCards.length === 1 &&
      singleCards[0]._iuPresentation.kind === "region" &&
      singleCards[0]._iuPresentation.locationLabel === "Středočeský kraj",
    singleCards[0] && singleCards[0]._iuPresentation.locationLabel
  );

  const prahaNupaky = IU.getFilteredWarningLocationLabel(warning, {
    localities: [
      { name: "Hlavní město Praha", level: "kraj" },
      { name: "Nupaky", level: "mesto", id: "564907", orpCode: "2122" },
    ],
  });
  ok("combo_praha_nupaky_both", prahaNupaky.startsWith("Praha, Nupaky"), prahaNupaky);
  ok("combo_praha_nupaky_extra", /a dalších 190 oblastí/.test(prahaNupaky), prahaNupaky);
  ok("combo_no_horsovsky", !/Horšovský Týn/.test(prahaNupaky), prahaNupaky);

  const multi = IU.getFilteredWarningLocationLabel(warning, {
    localities: [
      { name: "Hradec Králové", level: "mesto", orpCode: "5205" },
      { name: "Brno", level: "mesto", orpCode: "6203" },
      { name: "Rumburk", level: "mesto", orpCode: "4213" },
    ],
  });
  ok("multi_all_relevant_names", multi.startsWith("Hradec Králové, Brno, Rumburk"), multi);
  ok("multi_remainder_unique_orp", /a dalších 189 oblastí/.test(multi), multi);

  const nupaky = IU.getFilteredWarningLocationLabel(warning, {
    localities: [{ name: "Nupaky", level: "mesto", id: "564907", orpCode: "2122" }],
  });
  ok("village_via_orp", nupaky.startsWith("Nupaky"), nupaky);
  ok("village_keeps_191", /a dalších 191 oblastí/.test(nupaky), nupaky);

  const sameOrp = IU.getFilteredWarningLocationLabel(warning, {
    localities: [
      { name: "Nupaky", level: "mesto", id: "564907", orpCode: "2122" },
      { name: "Čestlice", level: "mesto", id: "538141", orpCode: "2122" },
    ],
  });
  ok("same_orp_both_names", sameOrp.startsWith("Nupaky, Čestlice"), sameOrp);
  ok("same_orp_global_extra", /a dalších 191 oblastí/.test(sameOrp), sameOrp);

  const dupNames = IU.getFilteredWarningLocationLabel(warning, {
    localities: [
      { name: "Praha", level: "mesto", orpCode: "1000" },
      { name: "Praha", level: "mesto", orpCode: "1000" },
      { name: "praha", level: "mesto", orpCode: "1000" },
    ],
  });
  ok("title_dedupe_praha", dupNames === "Praha a dalších 191 oblastí" || /^Praha a dalších 191/.test(dupNames), dupNames);
  ok("title_no_double_praha", !/Praha,\s*Praha/.test(dupNames), dupNames);

  const outsideMatch = IU.eventMatchesLocationFilter(warning, {
    localities: [{ name: "Cheb", level: "mesto", orpCode: "4102" }],
  });
  ok("match_fn_outside_false", outsideMatch === false, String(outsideMatch));
  const insideMatch = IU.eventMatchesLocationFilter(warning, {
    localities: [{ name: "Nupaky", level: "mesto", orpCode: "2122" }],
  });
  ok("match_fn_inside_true", insideMatch === true, String(insideMatch));
  const orMatch = IU.eventMatchesLocationFilter(warning, {
    localities: [
      { name: "Cheb", level: "mesto", orpCode: "4102" },
      { name: "Brno", level: "mesto", orpCode: "6203" },
    ],
  });
  ok("match_fn_or_true", orMatch === true, String(orMatch));

  const partial = IU.getFilteredWarningLocationLabel(warning, {
    localities: [
      { name: "Nupaky", level: "mesto", id: "564907", orpCode: "2122" },
      { name: "Brno", level: "mesto", id: "582786", orpCode: "6203" },
      { name: "Cheb", level: "mesto", id: "554499", orpCode: "4102" },
    ],
  });
  ok("partial_order", partial.startsWith("Nupaky, Brno"), partial);
  ok("partial_excludes_cheb", !/Cheb/.test(partial), partial);

  ok("no_mutate", JSON.stringify(warning) === snapshot, "mutated");

  const filtered = IU.filterEvents(
    [warning],
    { localities: [{ name: "Cheb", level: "mesto", orpCode: "4102" }], localityQuery: "" },
    { skipMemo: true }
  );
  ok("filter_hides_outside", filtered.length === 0, String(filtered.length));

  const kept = IU.filterEvents(
    [warning],
    { localities: [{ name: "Nupaky", level: "mesto", id: "564907", orpCode: "2122" }] },
    { skipMemo: true }
  );
  ok("filter_keeps_village_via_orp", kept.length === 1, String(kept.length));
  ok("filter_url_intact", kept[0] && kept[0].url === "https://opendata.chmi.cz/meteorology/weather/alerts/cap/alert_cap_50_loc.xml?hid=loc-test", kept[0] && kept[0].url);

  const base = IU.eventTitleBaseWithoutLocality(warning);
  ok("title_base_event", base === "Vysoké teploty", base);

  const norm = IU.normalizeLocalitiesList(
    Array.from({ length: 25 }, (_, i) => ({ name: "Obec" + i, id: String(1000 + i), orpCode: "2122", level: "mesto" }))
  );
  ok("limit_20", norm.filter((x) => x.level === "mesto").length === 20, String(norm.length));
  ok("max_const", IU.MAX_CITY_LOCALITIES === 20, String(IU.MAX_CITY_LOCALITIES));
}

function main() {
  staticGate();
  const IU = loadIU();
  ok("iu_loaded", !!(IU && typeof IU.getFilteredWarningLocationLabel === "function"), "load");
  if (IU && typeof IU.getFilteredWarningLocationLabel === "function") unitGate(IU);

  if (fails.length) {
    console.error("[iu-chmi-cap-filtered-location-label-guard] FAIL");
    for (const f of fails) console.error(" - " + f);
    process.exit(1);
  }
  console.log("[iu-chmi-cap-filtered-location-label-guard] OK");
}

main();
