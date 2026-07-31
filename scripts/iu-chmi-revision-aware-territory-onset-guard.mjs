#!/usr/bin/env node
/**
 * Guard: revision-aware territory onset — Ústecký firstValidFrom = 30.7.2026 13:12:59
 * (not overwritten by 31.7. 11:25 Update that keeps the same 16 ORP).
 *
 * Frozen chain:
 *   301116 → Ústecký 16 ORP @ 13:12:59+02
 *   310929 → same 16 ORP @ 11:25:23+02 (must NOT win)
 *   311120 → +27 Praha/SČ @ 13:17:45+02
 *   311230 → +30 Pardubický/KH @ 14:29:29+02
 *
 * Also asserts production sync has no incident-specific fixture seed.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  applyTerritoryOnsetLedgerToFeed,
  buildTerritoryOnsetLedgerFromOrderedDocuments,
} from "./chmi-cap-v2/territory-onset-ledger.mjs";
import { isPublishableChmiItem, normalizeCapInstant } from "./chmi-cap-v2/normalize-feed.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = path.join(REPO, "scripts/fixtures/chmi-cap-v2");
const fails = [];
function ok(name, cond, detail) {
  if (!cond) fails.push(name + (detail != null ? "=" + detail : ""));
}

function read(name) {
  return fs.readFileSync(path.join(FIX, name), "utf8");
}

const base = "https://opendata.chmi.cz/meteorology/weather/alerts/cap/";
const chain = [
  { name: "alert-smog-oustecky-301116-1312.xml", url: base + "alert-smog-oustecky-301116-1312.xml" },
  { name: "alert-smog-oustecky-310929-1125.xml", url: base + "alert-smog-oustecky-310929-1125.xml" },
  { name: "alert-smog-expand-praha-sc-1317.xml", url: base + "alert-smog-expand-praha-sc-1317.xml" },
  { name: "alert-smog-expand-pardubicky-1429.xml", url: base + "alert-smog-expand-pardubicky-1429.xml" },
].map((f) => ({ xml: read(f.name), sourceUrl: f.url, name: f.name }));

const nowIso = "2026-07-31T15:00:00.000Z";
const built = buildTerritoryOnsetLedgerFromOrderedDocuments(chain, { nowIso });
ok("chain_steps_4", built.steps.length === 4, String(built.steps.length));

const headItems = (built.itemsByStep[3] || []).filter((i) => isPublishableChmiItem(i));
const split = applyTerritoryOnsetLedgerToFeed([], headItems, built.ledger, { nowIso });
const smog = (split.items || []).filter((i) => /smogov/i.test((i.capV2 && i.capV2.event) || i.title || ""));
ok("smog_segments_3", smog.length === 3, String(smog.length));

const byVf = Object.fromEntries(
  smog.map((i) => [normalizeCapInstant(i.validFrom), (i.region.orpIds || []).length])
);
const vf1312 = normalizeCapInstant("2026-07-30T13:12:59+02:00");
const vf1317 = normalizeCapInstant("2026-07-31T13:17:45+02:00");
const vf1429 = normalizeCapInstant("2026-07-31T14:29:29+02:00");
const vf1125 = normalizeCapInstant("2026-07-31T11:25:23+02:00");

ok("usti_firstValidFrom_1312", byVf[vf1312] === 16, JSON.stringify(byVf));
ok("praha_sc_1317_27", byVf[vf1317] === 27, JSON.stringify(byVf));
ok("pardubicky_1429_30", byVf[vf1429] === 30, JSON.stringify(byVf));
ok("no_1125_overwrite", byVf[vf1125] == null, JSON.stringify(byVf));
ok(
  "no_collapsed_43_or_73",
  !smog.some((i) => [43, 73].includes((i.region.orpIds || []).length)),
  smog.map((i) => (i.region.orpIds || []).length).join(",")
);

const prodSync = fs.readFileSync(path.join(REPO, "scripts/chmi-cap-v2-prod-sync.mjs"), "utf8");
ok("no_fixture_seed_fn", !/seedOpenEndedLedgerFromSmogFixtures/.test(prodSync), "seed_fn");
ok("no_usti_orp_hardcode", !/USTI_ORP_RE/.test(prodSync), "usti_re");
ok("uses_revision_chain_builder", /buildTerritoryOnsetLedgerFromOrderedDocuments/.test(prodSync), "builder");
ok("fixtureSeed_false", /fixtureSeed:\s*false/.test(prodSync), "flag");
ok("listRecent_for_ledger", /listRecentForOnsetLedger/.test(prodSync), "recent");

if (fails.length) {
  console.error("IU_CHMI_REVISION_AWARE_TERRITORY_ONSET_GUARD=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  process.exit(1);
}
console.log("IU_CHMI_REVISION_AWARE_TERRITORY_ONSET_GUARD=PASS");
console.log(
  "smog=" +
    JSON.stringify(
      smog.map((i) => ({
        id: i.id,
        validFrom: i.validFrom,
        orp: (i.region.orpIds || []).length,
        title: i.title,
      }))
    )
);
