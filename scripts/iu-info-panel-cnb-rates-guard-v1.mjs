#!/usr/bin/env node
/**
 * ČNB EUR/CZK + USD/CZK — parser, kalendář, freshness, snapshot build.
 * Run: npm run iu-info-panel-cnb-rates-guard
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  CNB_DAILY_RATES_URL,
  getExpectedLatestCnbPublicationDate,
  isCnbPublicationBehindExpected,
  isCnbNonTradingDay,
  isCzechBankHoliday,
  parseCnbRatesText,
  parseCzechDailyDate,
} from "../assets/iu-cnb-exchange-utils.js";
import { mergeInfoPanelItemForGuard, IU_INFO_PANEL_CATALOG } from "../assets/iu-desktop-info-panel-data.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

const eur = IU_INFO_PANEL_CATALOG.find((i) => i.id === "eur_czk");
const usd = IU_INFO_PANEL_CATALOG.find((i) => i.id === "usd_czk");
assert(!!eur && !!usd, "catalog eur/usd missing");

async function fetchLiveCnbSample() {
  const res = await fetch(CNB_DAILY_RATES_URL, {
    headers: { Accept: "text/plain", "Accept-Language": "cs" },
  });
  assert(res.ok, "live CNB HTTP must succeed");
  return res.text();
}

function auditBuildScript() {
  const src = fs.readFileSync(path.join(REPO, "scripts", "build_info_panel_snapshot.mjs"), "utf8");
  assert(src.includes("iu-cnb-exchange-utils.js"), "build must import cnb utils");
  assert(src.includes("cnb_fetch_ok"), "build must log cnb_fetch_ok");
  assert(src.includes('filter((err) => err && err.id !== "cnb")'), "build must clear cnb error on success");
}

function auditWorkflow() {
  const wf = fs.readFileSync(path.join(REPO, ".github", "workflows", "update-info-panel-snapshot.yml"), "utf8");
  assert(wf.includes("AUTOMATION_BRANCH: automation/update-info-panel-snapshot"), "workflow must use automation branch");
  assert(wf.includes("gh pr create"), "workflow must open PR instead of pushing main");
  assert(wf.includes("gh pr merge"), "workflow must enable auto-merge");
}

async function auditWorkflowEnabledInCi() {
  const repo = process.env.GITHUB_REPOSITORY || "";
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  if (!repo || !token || process.env.GITHUB_ACTIONS !== "true") return;
  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/update-info-panel-snapshot.yml`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );
  assert(res.ok, "snapshot workflow metadata must be readable in CI");
  const body = await res.json();
  assert(body && body.state === "active", `snapshot workflow must be active not ${body && body.state}`);
}

async function main() {
  auditBuildScript();
  auditWorkflow();
  await auditWorkflowEnabledInCi();

  const liveText = await fetchLiveCnbSample();
  const parsed = parseCnbRatesText(liveText);
  assert(typeof parsed.EUR === "number" && parsed.EUR > 0, "EUR must parse");
  assert(typeof parsed.USD === "number" && parsed.USD > 0, "USD must parse");
  assert(parseCzechDailyDate(parsed.date), "CNB header date must parse");

  const amountFixture = [
    "14.07.2026 #1",
    "h|a|b|c|d",
    "EMU|euro|1|EUR|24,285",
    "USA|dollar|100|USD|2113,0",
  ].join("\n");
  const amountParsed = parseCnbRatesText(amountFixture);
  assert(Math.abs(amountParsed.USD - 21.13) < 0.001, "USD amount 100 must normalize to per-unit rate");

  const friday = new Date(2026, 6, 10, 12, 0, 0, 0);
  const saturday = new Date(2026, 6, 11, 12, 0, 0, 0);
  assert(isCnbNonTradingDay(saturday), "Saturday is non-trading");
  assert(!isCnbNonTradingDay(friday), "Friday is trading");
  const expectedSat = getExpectedLatestCnbPublicationDate(saturday);
  assert(expectedSat.getDate() === 10, "Saturday expects Friday CNB date");

  const mondayMorning = new Date(2026, 6, 13, 10, 0, 0, 0);
  const expectedMonAm = getExpectedLatestCnbPublicationDate(mondayMorning);
  assert(expectedMonAm.getDate() === 10, "Monday before 16:00 expects previous trading day");

  const mondayAfternoon = new Date(2026, 6, 13, 17, 0, 0, 0);
  const expectedMonPm = getExpectedLatestCnbPublicationDate(mondayAfternoon);
  assert(expectedMonPm.getDate() === 13, "Monday after grace expects same-day CNB");

  assert(!isCnbPublicationBehindExpected(parsed.date), "live CNB date must not be behind expected");
  assert(isCnbPublicationBehindExpected("03.07.2026", new Date(2026, 6, 15, 12, 0, 0, 0)), "old July 3 must be behind on July 15");

  // Fixed CZ bank holidays use YYYYMMDD keys (MM*100+DD) — catch MMDD transposition.
  assert(isCzechBankHoliday(new Date(2026, 4, 8, 12, 0, 0, 0)), "1 May Victory Day / 8 May must be holiday");
  assert(isCzechBankHoliday(new Date(2026, 6, 5, 12, 0, 0, 0)), "5 July must be holiday");
  assert(isCzechBankHoliday(new Date(2026, 6, 6, 12, 0, 0, 0)), "6 July must be holiday");
  assert(isCzechBankHoliday(new Date(2026, 0, 1, 12, 0, 0, 0)), "1 January must be holiday");
  assert(isCzechBankHoliday(new Date(2026, 3, 3, 12, 0, 0, 0)), "Good Friday 2026 must be holiday");
  assert(isCzechBankHoliday(new Date(2026, 3, 6, 12, 0, 0, 0)), "Easter Monday 2026 must be holiday");
  const jul6Evening = new Date(2026, 6, 6, 17, 0, 0, 0);
  const expectedJul6 = getExpectedLatestCnbPublicationDate(jul6Evening);
  assert(expectedJul6.getDate() === 3 && expectedJul6.getMonth() === 6, "6 July holiday evening expects Fri 3 July board");

  const liveRow = {
    isLive: true,
    legalStatus: "verified_requires_attribution",
    value: parsed.EUR,
    unit: "Kč",
    secondaryValue: "beze změny",
    trendDirection: "flat",
    updatedAt: parsed.date,
  };
  const staleMeta = { generatedAt: "2020-01-01T00:00:00.000Z", bucketFetchedAt: { cnb: "2020-01-01T00:00:00.000Z" }, errors: [] };
  const liveEur = mergeInfoPanelItemForGuard(eur, liveRow, staleMeta);
  assert(liveEur.state === "live", "fresh CNB publication must render live even with old fetch anchor");
  assert(String(liveEur.primaryValue).includes(","), "EUR must use cs-CZ formatting");

  const errorMeta = { generatedAt: new Date().toISOString(), errors: [{ id: "cnb", message: "mock" }] };
  const preservedEur = mergeInfoPanelItemForGuard(eur, liveRow, errorMeta);
  assert(preservedEur.state === "live", "last CNB values must survive fetch error when row exists");

  const snapPath = path.join(REPO, "projects", "data", "info_panel_snapshot.json");
  if (fs.existsSync(snapPath)) {
    const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
    const snapEur = snap.items && snap.items.eur_czk;
    const snapUsd = snap.items && snap.items.usd_czk;
    assert(snapEur && typeof snapEur.value === "number", "snapshot eur_czk numeric");
    assert(snapUsd && typeof snapUsd.value === "number", "snapshot usd_czk numeric");
    const mergedSnapEur = mergeInfoPanelItemForGuard(eur, snapEur, snap);
    assert(mergedSnapEur.state === "live", "committed snapshot EUR must be live after refresh");
  }

  if (failures.length) {
    console.error("IU_INFO_PANEL_CNB_RATES_GUARD_FAIL");
    failures.forEach((f) => console.error(f));
    process.exit(1);
  }

  console.log(
    JSON.stringify({
      pass: true,
      cnbDate: parsed.date,
      eur: parsed.EUR,
      usd: parsed.USD,
      source: CNB_DAILY_RATES_URL,
    })
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
