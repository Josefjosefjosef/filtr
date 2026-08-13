#!/usr/bin/env node
/**
 * Guard: CHMI title locality counts use unique ORP unit + Czech inflection + O₃ display + same-day platnost od.
 * Does not change segment IDs / validity / publicUrl.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import {
  summarizeAlertLocality,
  formatExtraOrpAreasPhrase,
  formatChmiEventDisplayName,
  refreshItemLocalityPresentation,
} from "./chmi-cap-v2/normalize-feed.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CORE = path.join(ROOT, "assets", "iu-info-system-core-v1.js");
const UI = path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js");
const INDEX = path.join(ROOT, "projects", "index.html");
const SW = path.join(ROOT, "sw.js");
const GEO = path.join(ROOT, "scripts", "chmi-cap-v2", "geo-registry.mjs");
const NORM = path.join(ROOT, "scripts", "chmi-cap-v2", "normalize-feed.mjs");
const CACHE_BUST = "heavy-feed-shell-first-v1-20260809";
const SW_VER = "2026-08-13-orphan-paren-street-sanitize-v1";

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function link(orpName, krajName, orpId) {
  return { orpName, krajName, orpId: orpId || "orp:" + orpName, orpCode: orpName };
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
const ui = fs.readFileSync(UI, "utf8");
const index = fs.readFileSync(INDEX, "utf8");
const sw = fs.readFileSync(SW, "utf8");
const geoSrc = fs.readFileSync(GEO, "utf8");
const normSrc = fs.readFileSync(NORM, "utf8");

ok("bust_ui_import", ui.includes("iu-info-system-core-v1.js?v=" + CACHE_BUST), "ui import");
ok("bust_index_js", index.includes("iu-prehled-dne-ui-v1.js?v=" + CACHE_BUST), "index js");
ok("bust_index_css", index.includes("iu-prehled-dne-v1.css?v=" + CACHE_BUST), "index css");
ok("sw_version", sw.includes(SW_VER), "sw");
ok("geo_dedupe_seenOrp", /seenOrp/.test(geoSrc), "geo");
ok("norm_export_phrase", /formatExtraOrpAreasPhrase/.test(normSrc), "norm");
ok("ui_o3_display", /\\\\bO3\\\\b/.test(ui) || /\\bO3\\b/.test(ui), "ui o3");

ok("phrase_1", formatExtraOrpAreasPhrase(1) === "a 1 další oblast", formatExtraOrpAreasPhrase(1));
ok("phrase_2", formatExtraOrpAreasPhrase(2) === "a 2 další oblasti", formatExtraOrpAreasPhrase(2));
ok("phrase_4", formatExtraOrpAreasPhrase(4) === "a 4 další oblasti", formatExtraOrpAreasPhrase(4));
ok("phrase_5", formatExtraOrpAreasPhrase(5) === "a dalších 5 oblastí", formatExtraOrpAreasPhrase(5));
ok("phrase_32", formatExtraOrpAreasPhrase(32) === "a dalších 32 oblastí", formatExtraOrpAreasPhrase(32));
ok("o3_display", formatChmiEventDisplayName("Smogová situace - troposférický ozón O3") === "Smogová situace - troposférický ozón O₃", "o3");
ok("o3_identity_safe", formatChmiEventDisplayName("O3") === "O₃" && "O3" !== "O₃", "identity");

// 304 cache: refresh presentation without changing id / validity
{
  const stale = {
    id: "ie-chmi-v2-stale-rumburk",
    title: "Stav sucha — Rumburk a dalších 1 oblastí",
    validFrom: "2026-07-28T14:00:00+02:00",
    validTo: null,
    publicUrl: "https://example.test/portal",
    region: { summary: "Rumburk a dalších 1 oblastí", name: "Rumburk" },
    capV2: {
      event: "Stav sucha",
      geo: {
        links: [
          { orpName: "Rumburk", krajName: "Ústecký kraj", orpId: "r" },
          { orpName: "Vrchlabí", krajName: "Královéhradecký kraj", orpId: "v" },
        ],
      },
    },
  };
  const fresh = refreshItemLocalityPresentation(stale);
  ok("cache_refresh_two_names", fresh.title === "Stav sucha — Rumburk a Vrchlabí", fresh.title);
  ok("cache_refresh_id_stable", fresh.id === stale.id, fresh.id);
  ok("cache_refresh_validFrom_stable", fresh.validFrom === stale.validFrom, fresh.validFrom);
  ok("cache_refresh_url_stable", fresh.publicUrl === stale.publicUrl, fresh.publicUrl);
}

// concrete ORP list (multi kraj) — count unique ORP only
const multi = summarizeAlertLocality(
  [
    link("Český Krumlov", "Jihočeský kraj", "a"),
    link("Písek", "Jihočeský kraj", "b"),
    link("Praha", "Hlavní město Praha", "c"),
  ],
  []
);
ok("multi_orp_count", multi.extraAreaCount === 2, String(multi.extraAreaCount));
ok("multi_inflection", /a 2 další oblasti/.test(multi.summary), multi.summary);
ok("multi_no_parent_triple", !/kraj.*okres/i.test(multi.summary), multi.summary);

// whole kraj → rule B
const whole = summarizeAlertLocality(
  [
    link("Blovice", "Plzeňský kraj", "p1"),
    link("Plzeň", "Plzeňský kraj", "p2"),
    link("Klatovy", "Plzeňský kraj", "p3"),
  ],
  []
);
ok("whole_kraj_form", whole.summary === "Plzeňský kraj (3 ORP)", whole.summary);
ok("whole_kraj_level", whole.level === "kraj", whole.level);

// mix whole-kraj style links + other kraj ORPs: unique ORP across kraje
const mix = summarizeAlertLocality(
  [
    link("Blovice", "Plzeňský kraj", "p1"),
    link("Plzeň", "Plzeňský kraj", "p2"),
    link("Brno", "Jihomoravský kraj", "b1"),
  ],
  []
);
ok("mix_not_double_kraj", mix.summary.startsWith("Blovice"), mix.summary);
ok("mix_extra_2", mix.extraAreaCount === 2, String(mix.extraAreaCount));

// parent dedupe: duplicate ORP links must not inflate
const dups = summarizeAlertLocality(
  [link("Praha", "Hlavní město Praha", "praha"), link("Praha", "Hlavní město Praha", "praha"), link("Brno", "Jihomoravský kraj", "brno")],
  []
);
ok("dedupe_two_names", dups.summary === "Praha a Brno", dups.summary);
ok("dedupe_extra_1", dups.extraAreaCount === 1, String(dups.extraAreaCount));

// Praha as ORP
const prahaOnly = summarizeAlertLocality([link("Praha", "Hlavní město Praha", "praha")], []);
ok("praha_single", prahaOnly.summary === "Praha", prahaOnly.summary);

// 1 / 2-4 / 5+
ok("one_extra", summarizeAlertLocality([link("Rumburk", "Ústecký kraj", "r"), link("Nová Paka", "Královéhradecký kraj", "n")], []).summary === "Rumburk a Nová Paka", "two names");
ok(
  "three_extra_phrase",
  /a 2 další oblasti/.test(
    summarizeAlertLocality(
      [link("A", "K1", "1"), link("B", "K2", "2"), link("C", "K3", "3")],
      []
    ).summary
  ),
  "3"
);
ok(
  "four_extra_phrase",
  /a 4 další oblasti/.test(
    summarizeAlertLocality(
      [link("A", "K1", "1"), link("B", "K2", "2"), link("C", "K3", "3"), link("D", "K4", "4"), link("E", "K5", "5")],
      []
    ).summary
  ),
  "5orp_extra4"
);
ok(
  "five_extra_phrase",
  /a dalších 5 oblastí/.test(
    summarizeAlertLocality(
      [
        link("A", "K1", "1"),
        link("B", "K2", "2"),
        link("C", "K3", "3"),
        link("D", "K4", "4"),
        link("E", "K5", "5"),
        link("F", "K6", "6"),
      ],
      []
    ).summary
  ),
  "6orp_extra5"
);

// FUTURE platnost: single red sentence „Výstraha ČHMÚ platí od … hod.“ (no split date/time)
const future = {
  id: "ie-chmi-v2-future-same",
  sourceId: "chmi",
  capV2: { badgeActive: true },
  status: "naplanovano",
  publishedAtSource: "2026-07-31T08:00:00+02:00",
  publishedAt: "2026-07-31T08:00:00+02:00",
  validFrom: "2026-07-31T16:00:00+02:00",
  validTo: "2026-08-01T00:00:00+02:00",
};
const t = IU.getEffectiveTimelinePresentation(future, Date.parse("2026-07-31T12:00:00+02:00"));
ok("future_same_day_label", t.secondaryValidFromLabel === "Výstraha ČHMÚ platí od 31. 7. 16:00 hod.", String(t.secondaryValidFromLabel));
ok("future_same_day_date", t.secondaryValidFromDate == null, String(t.secondaryValidFromDate));
ok("future_same_day_time", t.secondaryValidFromTime == null, String(t.secondaryValidFromTime));

const futureNext = {
  ...future,
  id: "ie-chmi-v2-future-next",
  validFrom: "2026-08-01T12:00:00+02:00",
  validTo: "2026-08-02T00:00:00+02:00",
};
const tn = IU.getEffectiveTimelinePresentation(futureNext, Date.parse("2026-07-31T12:00:00+02:00"));
ok("future_next_day_label", tn.secondaryValidFromLabel === "Výstraha ČHMÚ platí od 1. 8. 12:00 hod.", String(tn.secondaryValidFromLabel));
ok("future_next_day_date", tn.secondaryValidFromDate == null, String(tn.secondaryValidFromDate));
ok("future_next_day_time", tn.secondaryValidFromTime == null, String(tn.secondaryValidFromTime));

if (fails.length) {
  console.error("IU_CHMI_TITLE_LOCALITY_GRAMMAR=FAIL");
  for (const f of fails) console.error(" - " + f);
  process.exit(1);
}
console.log("IU_CHMI_TITLE_LOCALITY_GRAMMAR=PASS");
