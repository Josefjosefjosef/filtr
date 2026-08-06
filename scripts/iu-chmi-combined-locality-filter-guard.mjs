#!/usr/bin/env node
/**
 * Guard: combined CHMI locality filter (kraj + okres + obec) — title + visibility + ORP remainder.
 * Runtime logic tests (not text-search-only). Prevents foreign CAP ORP names in filtered titles.
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
const CACHE_BUST = "traffic-overview-rsd-prehled-v1-20260806";

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

function warningFromLinks(links, titlePrimary) {
  const primary = titlePrimary || (links[0] && links[0].orpName) || "Oblast";
  const now = Date.now();
  return {
    id: "ie-chmi-v2-combined-loc",
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

function staticGate() {
  const core = fs.readFileSync(CORE, "utf8");
  const ui = fs.readFileSync(UI, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  ok("core_list_selected", /function listSelectedLocationEntries/.test(core), "list");
  ok("core_no_pick_primary", !/function pickPrimaryLocalityName/.test(core), "no fallback picker");
  ok("core_no_global_fallback_filtered", !/Non-CAP or incomplete geo: keep legacy summary/.test(core), "no legacy");
  ok("core_diag", /CHMU location filter inconsistency/.test(core), "diag");
  ok("ui_order_preserve_cities", /desiredByKey/.test(ui), "city order");
  ok("ui_order_preserve_loc", /wantedKeys/.test(ui), "loc order");
  ok("bust_ui", ui.includes(CACHE_BUST), "ui");
  ok("bust_index", index.includes("iu-prehled-dne-ui-v1.js?v=" + CACHE_BUST), "index");
}

function unitGate(IU) {
  const baseLinks = [
    link("1000", "Praha", "Hlavní město Praha", "Hlavní město Praha"),
    link("2122", "Říčany", "Praha-východ", "Středočeský kraj"),
    link("2115", "Český Brod", "Kolín", "Středočeský kraj"),
    link("3203", "Horšovský Týn", "Domažlice", "Plzeňský kraj"),
    link("3201", "Domažlice", "Domažlice", "Plzeňský kraj"),
    link("3202", "Klatovy", "Klatovy", "Plzeňský kraj"),
    link("3204", "Přeštice", "Plzeň-jih", "Plzeňský kraj"),
    link("3205", "Blovice", "Plzeň-jih", "Plzeňský kraj"),
    link("3206", "Nepomuk", "Plzeň-jih", "Plzeňský kraj"),
    link("3207", "Stod", "Plzeň-jih", "Plzeňský kraj"),
    link("6203", "Brno", "Brno-město", "Jihomoravský kraj"),
  ];
  // pad to 73 unique ORPs (matches acceptance examples scale)
  while (baseLinks.length < 73) {
    const i = baseLinks.length;
    baseLinks.push(
      link(String(9000 + i), "Oblast" + i, "OkresPad", "Jihočeský kraj")
    );
  }
  const warning = warningFromLinks(baseLinks, "Horšovský Týn");
  const snap = JSON.stringify(warning);

  // 16.1 kraj + obec both match
  const selPN = {
    localities: [
      { name: "Hlavní město Praha", level: "kraj" },
      { name: "Nupaky", level: "mesto", id: "564907", orpCode: "2122" },
    ],
  };
  const labelPN = IU.getFilteredWarningLocationLabel(warning, selPN);
  ok("16_1_visible", IU.eventMatchesLocationFilter(warning, selPN) === true, "match");
  ok("16_1_title", labelPN === "Praha, Nupaky a dalších 71 oblastí", labelPN);
  ok("16_1_no_foreign", !/Horšovský Týn|Říčany|Brno/.test(labelPN), labelPN);

  // 16.2 kraj no / obec yes
  const onlyNupakyLinks = baseLinks.filter((l) => l.orpCode !== "1000");
  const wNoPraha = warningFromLinks(onlyNupakyLinks, "Horšovský Týn");
  const labelOnlyN = IU.getFilteredWarningLocationLabel(wNoPraha, selPN);
  ok("16_2_title", labelOnlyN === "Nupaky a dalších 71 oblastí", labelOnlyN);
  ok("16_2_no_praha", !/^Praha|Praha,/.test(labelOnlyN), labelOnlyN);

  // 16.3 obec no / kraj yes
  const onlyPrahaLinks = baseLinks.filter((l) => l.orpCode !== "2122");
  const wNoNup = warningFromLinks(onlyPrahaLinks, "Horšovský Týn");
  const labelOnlyP = IU.getFilteredWarningLocationLabel(wNoNup, selPN);
  ok("16_3_title", labelOnlyP === "Praha a dalších 71 oblastí", labelOnlyP);
  ok("16_3_no_nupaky", !/Nupaky/.test(labelOnlyP), labelOnlyP);

  // 16.4 none match
  const selOutside = {
    localities: [
      { name: "Hlavní město Praha", level: "kraj" },
      { name: "Nupaky", level: "mesto", id: "564907", orpCode: "2122" },
    ],
  };
  const wPlzenOnly = warningFromLinks(
    baseLinks.filter((l) => l.krajName === "Plzeňský kraj"),
    "Horšovský Týn"
  );
  ok("16_4_hidden", IU.eventMatchesLocationFilter(wPlzenOnly, selOutside) === false, "hidden");
  ok("16_4_empty_label", IU.getFilteredWarningLocationLabel(wPlzenOnly, selOutside) === "", "empty");

  // 16.5 foreign source primary must never appear
  ok("16_5_source_primary_horsovsky", /Horšovský Týn/.test(warning.region.summary), warning.region.summary);
  const labelForeign = IU.getFilteredWarningLocationLabel(warning, {
    localities: [{ name: "Nupaky", level: "mesto", id: "564907", orpCode: "2122" }],
  });
  ok("16_5_title_nupaky", labelForeign.startsWith("Nupaky"), labelForeign);
  ok("16_5_no_horsovsky", !/Horšovský Týn/.test(labelForeign), labelForeign);

  // 16.6 multi obce partial
  const selMulti = {
    localities: [
      { name: "Nupaky", level: "mesto", id: "564907", orpCode: "2122" },
      { name: "Brno", level: "mesto", id: "582786", orpCode: "6203" },
      { name: "Průhonice", level: "mesto", id: "539597", orpCode: "2122" },
    ],
  };
  const labelMulti = IU.getFilteredWarningLocationLabel(warning, selMulti);
  ok("16_6_names", labelMulti === "Nupaky, Brno, Průhonice a dalších 71 oblastí", labelMulti);
  const wNoBrno = warningFromLinks(
    baseLinks.filter((l) => l.orpCode !== "6203"),
    "Horšovský Týn"
  );
  const labelNoBrno = IU.getFilteredWarningLocationLabel(wNoBrno, selMulti);
  ok("16_6_partial", labelNoBrno === "Nupaky, Průhonice a dalších 71 oblastí", labelNoBrno);
  ok("16_6_no_brno", !/Brno/.test(labelNoBrno), labelNoBrno);

  // 16.7 two obce same ORP — names both, ORP once
  const sameOrp = IU.getFilteredWarningLocationLabel(warning, {
    localities: [
      { name: "Nupaky", level: "mesto", id: "564907", orpCode: "2122" },
      { name: "Průhonice", level: "mesto", id: "539597", orpCode: "2122" },
    ],
  });
  ok("16_7_both_names", sameOrp.startsWith("Nupaky, Průhonice"), sameOrp);
  ok("16_7_extra_once", /a dalších 72 oblastí/.test(sameOrp), sameOrp);

  // 16.8 kraj + obec: shared label is localities-only; kraj becomes a separate presentation card
  const selStcNup = {
    localities: [
      { name: "Středočeský kraj", level: "kraj" },
      { name: "Nupaky", level: "mesto", id: "564907", orpCode: "2122" },
    ],
  };
  const labelStc = IU.getFilteredWarningLocationLabel(warning, selStcNup);
  ok("16_8_local_only_nupaky", /^Nupaky\b/.test(labelStc) && !/Středočeský kraj/.test(labelStc), labelStc);
  // Nupaky represents 1 ORP → extra 72
  ok("16_8_local_extra_no_kraj_subtract", /a dalších 72 oblastí/.test(labelStc), labelStc);
  const cardsStc = IU.buildChmiLocalityPresentationCards
    ? IU.buildChmiLocalityPresentationCards(warning, selStcNup)
    : [];
  ok("16_8_split_cards", cardsStc.length === 2, String(cardsStc.length));
  ok(
    "16_8_region_card",
    cardsStc.some((c) => c._iuPresentation && c._iuPresentation.kind === "region" && /Středočeský/.test(c._iuPresentation.locationLabel)),
    "region"
  );

  // 16.9 removal: old locality gone from title after prefs change
  const withHors = {
    localities: [{ name: "Horšovský Týn", level: "mesto", orpCode: "3203" }],
  };
  const afterRemove = {
    localities: [{ name: "Nupaky", level: "mesto", id: "564907", orpCode: "2122" }],
  };
  const before = IU.getFilteredWarningLocationLabel(warning, withHors);
  const after = IU.getFilteredWarningLocationLabel(warning, afterRemove);
  ok("16_9_before_hors", before.startsWith("Horšovský Týn"), before);
  ok("16_9_after_no_hors", !/Horšovský Týn/.test(after) && after.startsWith("Nupaky"), after);

  // 16.11 Celá ČR
  const whole = IU.getFilteredWarningLocationLabel(warning, { localities: [] });
  ok("16_11_whole_keeps_global", /Horšovský Týn/.test(whole), whole);
  ok("16_11_no_cela_cr_text", !/Celá ČR|Cela CR/i.test(whole), whole);
  const resolvedWhole = IU.resolveWarningLocalityMatch(warning, { localities: [] });
  ok("16_11_whole_flag", resolvedWhole.wholeCr === true, String(resolvedWhole.wholeCr));

  // Praha + Nupaky + Český Brod
  const selThree = {
    localities: [
      { name: "Hlavní město Praha", level: "kraj" },
      { name: "Nupaky", level: "mesto", id: "564907", orpCode: "2122" },
      { name: "Český Brod", level: "mesto", id: "533294", orpCode: "2115" },
    ],
  };
  const three = IU.getFilteredWarningLocationLabel(warning, selThree);
  ok("prod_three_title", three === "Praha, Nupaky, Český Brod a dalších 70 oblastí", three);
  ok("prod_three_no_foreign", !/Horšovský Týn|Říčany/.test(three), three);

  // kraje not overwritten by obce: both present when both match
  const resolved = IU.resolveWarningLocalityMatch(warning, selThree);
  ok("combo_matching_count_3", resolved.matchingSelections.length === 3, String(resolved.matchingSelections.length));
  ok("combo_types", resolved.matchingSelections.map((s) => s.type).join(",") === "kraj,city,city", resolved.matchingSelections.map((s) => s.type).join(","));

  // limit 20
  const twenty = Array.from({ length: 25 }, (_, i) => ({
    name: "Obec" + i,
    id: String(1000 + i),
    orpCode: "2122",
    level: "mesto",
  }));
  const norm = IU.normalizeLocalitiesList(twenty.concat([{ name: "Hlavní město Praha", level: "kraj" }]));
  ok("16_12_cities_20", norm.filter((x) => x.level === "mesto").length === 20, String(norm.filter((x) => x.level === "mesto").length));
  ok("16_12_kraj_kept", norm.some((x) => x.level === "kraj"), "kraj");

  ok("no_mutate", JSON.stringify(warning) === snap, "mutated");
}

function main() {
  staticGate();
  const IU = loadIU();
  ok("iu_loaded", !!(IU && IU.getFilteredWarningLocationLabel && IU.resolveWarningLocalityMatch), "load");
  if (IU && IU.getFilteredWarningLocationLabel) unitGate(IU);
  if (fails.length) {
    console.error("[iu-chmi-combined-locality-filter-guard] FAIL");
    for (const f of fails) console.error(" - " + f);
    process.exit(1);
  }
  console.log("[iu-chmi-combined-locality-filter-guard] OK");
}

main();
