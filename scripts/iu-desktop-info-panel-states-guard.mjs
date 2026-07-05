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

const failures = [];
const lines = [];

function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

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
  updatedAt: "29.06.2026",
}, freshMeta);
assert(liveItem.state === "live", "eur must be live with fresh snapshot");
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
  updatedAt: staleBucketMeta.bucketFetchedAt.cnb,
}, staleBucketMeta);
assert(staleBucketEur.state === "stale", "eur must be stale with old bucketFetchedAt");

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

const errorEur = mergeInfoPanelItemForGuard(eur, null, errorMeta);
const errorUsd = mergeInfoPanelItemForGuard(usd, null, errorMeta);
assert(errorEur.state === "error", "eur must be error when cnb snapshot fails");
assert(errorUsd.state === "error", "usd must be error when cnb snapshot fails");
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
