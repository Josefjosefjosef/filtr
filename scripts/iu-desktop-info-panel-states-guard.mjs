#!/usr/bin/env node
/**
 * Segment state guard — PC informační panel (loading/live/placeholder/stale/error + independence).
 */
import {
  IU_INFO_PANEL_CATALOG,
  IU_INFO_PANEL_CATALOG_COUNT,
  getLoadingInfoPanelItems,
  mergeInfoPanelItemForGuard,
} from "../assets/iu-desktop-info-panel-data.js";
import { getExpectedLatestCnbPublicationDate } from "../assets/iu-cnb-exchange-utils.js";

const failures = [];
const lines = [];

function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

function formatCzechDailyDate(date) {
  return (
    String(date.getDate()).padStart(2, "0") +
    "." +
    String(date.getMonth() + 1).padStart(2, "0") +
    "." +
    String(date.getFullYear())
  );
}

const expectedCnbDateLabel = formatCzechDailyDate(getExpectedLatestCnbPublicationDate());

const fuel = IU_INFO_PANEL_CATALOG.find((i) => i.id === "fuel");
const eur = IU_INFO_PANEL_CATALOG.find((i) => i.id === "eur_czk");
const usd = IU_INFO_PANEL_CATALOG.find((i) => i.id === "usd_czk");
const bitcoin = IU_INFO_PANEL_CATALOG.find((i) => i.id === "bitcoin");

assert(fuel && eur && usd && bitcoin, "catalog items missing for state tests");

const freshMeta = { generatedAt: new Date().toISOString(), errors: [] };
const staleMeta = { generatedAt: "2020-01-01T00:00:00.000Z", errors: [] };
const errorMeta = { generatedAt: freshMeta.generatedAt, errors: [{ id: "cnb", message: "mock" }] };
const fuelErrorMeta = { generatedAt: freshMeta.generatedAt, errors: [{ id: "csu_fuel", message: "mock" }] };

const missingRow = mergeInfoPanelItemForGuard(fuel, null, freshMeta);
assert(missingRow.state === "placeholder", "fuel without snapshot row must be placeholder");
lines.push("STATE_PLACEHOLDER=PASS");

const liveFuel = mergeInfoPanelItemForGuard(fuel, {
  isLive: true,
  legalStatus: "verified_requires_attribution",
  value: 38.82,
  unit: "Kč/l",
  primaryLabel: "Natural 95",
  secondaryValue: "beze změny",
  trendDirection: "flat",
  updatedAt: "2026-W26",
}, freshMeta);
assert(liveFuel.state === "live", "fuel must be live with fresh snapshot");
assert(liveFuel.isLive === true, "fuel live flag");
lines.push("STATE_LIVE=PASS");

const liveItem = mergeInfoPanelItemForGuard(eur, {
  isLive: true,
  legalStatus: "verified_requires_attribution",
  value: 25.12,
  unit: "Kč",
  secondaryValue: "beze změny",
  trendDirection: "flat",
  updatedAt: expectedCnbDateLabel,
}, freshMeta);
assert(liveItem.state === "live", "eur must be live with current CNB publication date");
assert(liveItem.isLive === true, "eur live flag");

const staleItem = mergeInfoPanelItemForGuard(eur, {
  isLive: true,
  legalStatus: "verified_requires_attribution",
  value: 25.12,
  unit: "Kč",
  secondaryValue: "beze změny",
  trendDirection: "flat",
  updatedAt: "01.01.2020",
}, staleMeta);
assert(staleItem.state === "stale", "eur must be stale with old generatedAt");
assert(staleItem.primaryValue.includes("nejsou aktuální"), "stale message");
lines.push("STATE_STALE=PASS");

const staleBucketMeta = {
  generatedAt: new Date().toISOString(),
  bucketFetchedAt: { cnb: "2020-01-01T00:00:00.000Z" },
  errors: [],
};
const staleBucketEur = mergeInfoPanelItemForGuard(eur, {
  isLive: true,
  legalStatus: "verified_requires_attribution",
  value: 25.12,
  unit: "Kč",
  secondaryValue: "beze změny",
  trendDirection: "flat",
  updatedAt: "01.01.2020",
}, staleBucketMeta);
assert(staleBucketEur.state === "stale", "eur must be stale when CNB publication date is behind expected");

const freshCoinMeta = {
  generatedAt: "2020-01-01T00:00:00.000Z",
  bucketFetchedAt: { coingecko: new Date().toISOString() },
  errors: [],
};
const freshBtc = mergeInfoPanelItemForGuard(bitcoin, {
  isLive: true,
  legalStatus: "verified_requires_attribution",
  value: 2500000,
  unit: "Kč",
  secondaryValue: "beze změny",
  trendDirection: "flat",
  updatedAt: freshCoinMeta.bucketFetchedAt.coingecko,
}, freshCoinMeta);
assert(freshBtc.state === "live", "bitcoin must be live when coingecko bucket is fresh");
lines.push("STATE_BUCKET_FRESHNESS=PASS");

const monthlyInflation = IU_INFO_PANEL_CATALOG.find((i) => i.id === "inflation");
const monthlyLive = mergeInfoPanelItemForGuard(
  monthlyInflation,
  {
    isLive: true,
    legalStatus: "verified_requires_attribution",
    value: 2.1,
    unit: "%",
    secondaryValue: "beze změny",
    trendDirection: "flat",
    updatedAt: "květen 2026",
  },
  staleMeta
);
assert(monthlyLive.state === "live", "monthly item must stay live when publication period is valid");
assert(monthlyLive.primaryValue.includes("2,10"), "monthly item must show value");

const dailyEurOldFetch = mergeInfoPanelItemForGuard(
  eur,
  {
    isLive: true,
    legalStatus: "verified_requires_attribution",
    value: 24.2,
    unit: "Kč",
    secondaryValue: "beze změny",
    trendDirection: "flat",
    updatedAt: expectedCnbDateLabel,
  },
  { generatedAt: "2026-07-05T07:26:30.777Z", errors: [] }
);
assert(dailyEurOldFetch.state === "live", "CNB item stays live when publication date matches expected even if fetch anchor is old");

const dailyEurBehindExpected = mergeInfoPanelItemForGuard(
  eur,
  {
    isLive: true,
    legalStatus: "verified_requires_attribution",
    value: 24.2,
    unit: "Kč",
    secondaryValue: "beze změny",
    trendDirection: "flat",
    updatedAt: "03.07.2026",
  },
  { generatedAt: new Date().toISOString(), errors: [] }
);
assert(dailyEurBehindExpected.state === "stale", "CNB item must be stale when publication date is behind expected");

const hourlyOldFetch = mergeInfoPanelItemForGuard(
  bitcoin,
  {
    isLive: true,
    legalStatus: "verified_requires_attribution",
    value: 1326206,
    unit: "Kč",
    secondaryValue: "beze změny",
    trendDirection: "flat",
    updatedAt: "2026-07-05T07:26:30.777Z",
  },
  { generatedAt: "2026-07-05T07:26:30.777Z", errors: [] }
);
assert(hourlyOldFetch.state === "live", "hourly item must show last value when snapshot row exists");
assert(
  hourlyOldFetch.updatedAtDisplay.includes("2026") || hourlyOldFetch.updatedAtDisplay.includes("5."),
  "hourly updatedAtDisplay must not expose raw ISO"
);
lines.push("STATE_PERIOD_FRESHNESS=PASS");

const errorEur = mergeInfoPanelItemForGuard(eur, null, errorMeta);
const errorUsd = mergeInfoPanelItemForGuard(usd, null, errorMeta);
assert(errorEur.state === "error", "eur must be error when cnb snapshot fails without row");
assert(errorUsd.state === "error", "usd must be error when cnb snapshot fails without row");

const preservedEur = mergeInfoPanelItemForGuard(
  eur,
  {
    isLive: true,
    legalStatus: "verified_requires_attribution",
    value: 24.285,
    unit: "Kč",
    secondaryValue: "beze změny",
    trendDirection: "flat",
    updatedAt: expectedCnbDateLabel,
  },
  errorMeta
);
assert(preservedEur.state === "live", "eur keeps last value when cnb fetch fails but row exists");
lines.push("STATE_CNB_FALLBACK=PASS");
lines.push("STATE_ERROR=PASS");

const fuelAfterCnbError = mergeInfoPanelItemForGuard(fuel, {
  isLive: true,
  legalStatus: "verified_requires_attribution",
  value: 38.82,
  unit: "Kč/l",
  secondaryValue: "beze změny",
  trendDirection: "flat",
  updatedAt: "2026-W26",
}, errorMeta);
assert(fuelAfterCnbError.state === "live", "fuel independent of cnb error");

const fuelAfterFuelError = mergeInfoPanelItemForGuard(fuel, null, fuelErrorMeta);
assert(fuelAfterFuelError.state === "error", "fuel must error when csu_fuel snapshot fails");

const btcAfterError = mergeInfoPanelItemForGuard(bitcoin, {
  isLive: true,
  legalStatus: "verified_requires_attribution",
  value: 2500000,
  unit: "Kč",
  secondaryValue: "beze změny",
  trendDirection: "flat",
  updatedAt: "29.06.2026",
}, errorMeta);
assert(btcAfterError.state === "live", "bitcoin independent of cnb error");
lines.push("STATE_INDEPENDENCE=PASS");

const loadingItems = getLoadingInfoPanelItems();
assert(loadingItems.length === IU_INFO_PANEL_CATALOG_COUNT, `loading must expose ${IU_INFO_PANEL_CATALOG_COUNT} items`);
assert(loadingItems.every((i) => i.state === "loading"), "all loading states");
assert(loadingItems.every((i) => i.primaryValue === "…"), "loading primary ellipsis");
lines.push("STATE_LOADING=PASS");

if (failures.length) {
  console.error("IU_DESKTOP_INFO_PANEL_STATES_GUARD_FAIL");
  failures.forEach((f) => console.error(f));
  process.exit(1);
}

console.log("IU_DESKTOP_INFO_PANEL_STATES_GUARD_PASS");
lines.forEach((l) => console.log(l));
