#!/usr/bin/env node
/**
 * Phase 2F — negative fixtures for Klik.cz dual-placement protection.
 * Proves missing / moved / swapped / duplicated Klik would FAIL static checks.
 * Does not mutate the real catalog.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = path.join(ROOT, "assets", "iu-affiliate-catalog.js");
const CJ_POJ = "https://www.dpbolvw.net/click-101883843-15024026";
const CJ_CEST = "https://www.dpbolvw.net/click-101883843-15024030";

function auditKlikDual(catalog) {
  const fails = [];
  const ok = (id, cond, detail) => {
    if (!cond) fails.push(id + (detail ? ":" + detail : ""));
  };
  const klikPojisteniHits = (
    catalog.match(
      /affPartner\(\s*"Klik\.cz"\s*,\s*"https:\/\/www\.dpbolvw\.net\/click-101883843-15024026"(?:\s*,\s*"[^"]*")?\s*\)/g
    ) || []
  ).length;
  const klikCestovniHits = (
    catalog.match(
      /affPartner\(\s*"Klik\.cz"\s*,\s*"https:\/\/www\.dpbolvw\.net\/click-101883843-15024030"(?:\s*,\s*"[^"]*")?\s*\)/g
    ) || []
  ).length;
  const klikAnyHits = (catalog.match(/affPartner\(\s*"Klik\.cz"/g) || []).length;
  ok("catalog:klik_pojisteni_url_count_1", klikPojisteniHits === 1, "n=" + klikPojisteniHits);
  ok("catalog:klik_cestovni_url_count_1", klikCestovniHits === 1, "n=" + klikCestovniHits);
  ok("catalog:klik_total_placements_2", klikAnyHits === 2, "n=" + klikAnyHits);
  ok(
    "catalog:slot1_klik",
    /id:\s*"aff-pojisteni"[\s\S]*?items:\s*\[\s*affPartner\(\s*"Klik\.cz"/.test(catalog)
  );
  const blockStart = catalog.indexOf('id: "aff-pojisteni"');
  const blockEnd = catalog.indexOf('id: "aff-finance"', blockStart);
  const block = blockStart >= 0 && blockEnd > blockStart ? catalog.slice(blockStart, blockEnd) : "";
  ok("catalog:klik_in_pojisteni_block", block.includes("15024026"));
  ok("catalog:no_travel_cj_in_pojisteni", !block.includes("15024030"));
  const cestStart = catalog.indexOf('id: "aff-cestovni-pojisteni"');
  const cestEnd = catalog.indexOf('id: "aff-auto-moto"', cestStart);
  const cestBlock =
    cestStart >= 0 && cestEnd > cestStart ? catalog.slice(cestStart, cestEnd) : "";
  ok("catalog:cestovni_has_15024030", cestBlock.includes("15024030"));
  ok("catalog:not_in_cestovni_block", !cestBlock.includes("15024026"));
  return fails;
}

const base = fs.readFileSync(CATALOG, "utf8");
assert.equal(auditKlikDual(base).length, 0, "baseline_must_pass");

const scenarios = [];

// 1) Missing pojisteni Klik
{
  const mutated = base.replace(
    /affPartner\(\s*"Klik\.cz"\s*,\s*"https:\/\/www\.dpbolvw\.net\/click-101883843-15024026"(?:\s*,\s*"[^"]*")?\s*\)\s*,?/,
    ""
  );
  const fails = auditKlikDual(mutated);
  scenarios.push({
    name: "missing_pojisteni_klik",
    expectFail: true,
    failed: fails.length > 0,
    fails,
  });
}

// 2) URL changed
{
  const mutated = base.replace(CJ_POJ, "https://www.dpbolvw.net/click-101883843-99999999");
  const fails = auditKlikDual(mutated);
  scenarios.push({
    name: "pojisteni_url_changed",
    expectFail: true,
    failed: fails.length > 0,
    fails,
  });
}

// 3) Cross-swap URLs between sections
{
  let mutated = base.replace(CJ_POJ, "__TMP_POJ__");
  mutated = mutated.replace(CJ_CEST, CJ_POJ);
  mutated = mutated.replace("__TMP_POJ__", CJ_CEST);
  const fails = auditKlikDual(mutated);
  scenarios.push({
    name: "cross_swap_urls",
    expectFail: true,
    failed: fails.length > 0,
    fails,
  });
}

// 4) Duplicate pojisteni Klik
{
  const mutated = base.replace(
    /id:\s*"aff-pojisteni"[\s\S]*?items:\s*\[/,
    (m) => m + '\n        affPartner("Klik.cz", "' + CJ_POJ + '"),'
  );
  const fails = auditKlikDual(mutated);
  scenarios.push({
    name: "duplicate_pojisteni_klik",
    expectFail: true,
    failed: fails.length > 0,
    fails,
  });
}

// 5) Slot1 no longer Klik (prepend another partner)
{
  const mutated = base.replace(
    /id:\s*"aff-pojisteni"[\s\S]*?items:\s*\[\s*affPartner\(\s*"Klik\.cz"/,
    'id: "aff-pojisteni",\n      title: "Pojištění",\n      icon: "x",\n      description: "x",\n      items: [\n        affPartner("Other", "https://www.dpbolvw.net/click-101883843-11111111"),\n        affPartner("Klik.cz"'
  );
  const fails = auditKlikDual(mutated);
  scenarios.push({
    name: "slot1_not_klik",
    expectFail: true,
    failed: fails.length > 0,
    fails,
  });
}

const allOk = scenarios.every((s) => s.expectFail === s.failed);
console.log(
  JSON.stringify(
    {
      IU_AFFILIATE_KLIK_POJISTENI_GUARD_NEGATIVES: allOk ? "PASS" : "FAIL",
      baselinePass: true,
      scenarios: scenarios.map((s) => ({
        name: s.name,
        expectFail: s.expectFail,
        didFail: s.failed,
        sampleFails: s.fails.slice(0, 4),
      })),
    },
    null,
    2
  )
);
process.exit(allOk ? 0 : 1);
