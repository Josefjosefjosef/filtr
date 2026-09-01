/**
 * Inteligentní plánovač aktualizací informační lišty — frekvence podle zdroje.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { IU_INFO_PANEL_CATALOG } from "../assets/iu-desktop-info-panel-catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
export const SCHEDULER_STATE_PATH = path.join(ROOT, "projects", "data", "info_panel_scheduler_state.json");

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** @type {Record<string, { checkIntervalMs: number, label: string }>} */
export const BUCKET_SCHEDULE = {
  cnb: { checkIntervalMs: HOUR_MS, label: "hourly" },
  coingecko: { checkIntervalMs: HOUR_MS, label: "hourly" },
  csu_fuel: { checkIntervalMs: DAY_MS, label: "daily" },
  csu_coicop: { checkIntervalMs: DAY_MS, label: "daily" },
  csu_inflation: { checkIntervalMs: DAY_MS, label: "daily" },
  mpsv_labor: { checkIntervalMs: DAY_MS, label: "daily" },
  csu_wage_q: { checkIntervalMs: DAY_MS, label: "daily" },
  csu_wage_y: { checkIntervalMs: DAY_MS, label: "daily" },
  csu_gdp: { checkIntervalMs: DAY_MS, label: "daily" },
  csu_industry: { checkIntervalMs: DAY_MS, label: "daily" },
  csu_construction: { checkIntervalMs: DAY_MS, label: "daily" },
  csu_retail: { checkIntervalMs: DAY_MS, label: "daily" },
  csu_agriculture: { checkIntervalMs: DAY_MS, label: "daily" },
  csu_employment: { checkIntervalMs: DAY_MS, label: "daily" },
  csu_population: { checkIntervalMs: DAY_MS, label: "daily" },
  csu_births: { checkIntervalMs: DAY_MS, label: "daily" },
  csu_deaths: { checkIntervalMs: DAY_MS, label: "daily" },
  csu_marriages: { checkIntervalMs: DAY_MS, label: "daily" },
  csu_divorces: { checkIntervalMs: DAY_MS, label: "daily" },
  csu_foreigners: { checkIntervalMs: DAY_MS, label: "daily" },
  csu_seniors: { checkIntervalMs: DAY_MS, label: "daily" },
  csu_migration: { checkIntervalMs: DAY_MS, label: "daily" },
  csu_education: { checkIntervalMs: DAY_MS, label: "daily" },
  csu_health: { checkIntervalMs: DAY_MS, label: "daily" },
  csu_crime: { checkIntervalMs: DAY_MS, label: "daily" },
  csu_elections: { checkIntervalMs: DAY_MS, label: "daily" },
};

const GROUP_LABELS = {
  daily: "Denní ukazatele",
  economy: "Ekonomika a finance",
  labor: "Trh práce",
  population: "Populace a demografie",
  society: "Společnost",
};

const FREQUENCY_LABELS = {
  hourly: "Hodinově",
  daily: "Denně (pracovní dny)",
  weekly: "Týdně",
  monthly: "Měsíčně",
  quarterly: "Čtvrtletně",
  semi_annual: "Pololetně",
  annual: "Ročně",
  school_year: "Školní rok",
  event: "Po konání akce",
};

export function getAllFetchBuckets() {
  const set = new Set();
  IU_INFO_PANEL_CATALOG.forEach((item) => {
    if (item.fetchBucket) set.add(item.fetchBucket);
  });
  return [...set];
}

export function readSchedulerState() {
  try {
    if (!fs.existsSync(SCHEDULER_STATE_PATH)) return { version: 1, buckets: {} };
    return JSON.parse(fs.readFileSync(SCHEDULER_STATE_PATH, "utf8"));
  } catch (_) {
    return { version: 1, buckets: {} };
  }
}

export function writeSchedulerState(state) {
  fs.mkdirSync(path.dirname(SCHEDULER_STATE_PATH), { recursive: true });
  const tmp = SCHEDULER_STATE_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, SCHEDULER_STATE_PATH);
}

export function itemContentHash(item) {
  if (!item || typeof item !== "object") return "";
  return [item.value, item.updatedAt, item.primaryLabel, item.unit].join("|");
}

export function bucketContentHash(items, bucket) {
  const ids = IU_INFO_PANEL_CATALOG.filter((c) => c.fetchBucket === bucket).map((c) => c.id);
  return ids.map((id) => `${id}:${itemContentHash(items[id])}`).join(";");
}

export function bucketsDueForCheck(nowMs, state) {
  const due = [];
  const buckets = getAllFetchBuckets();
  for (const bucket of buckets) {
    const schedule = BUCKET_SCHEDULE[bucket] || { checkIntervalMs: DAY_MS };
    const entry = (state.buckets && state.buckets[bucket]) || {};
    const lastChecked = entry.lastCheckedAt ? Date.parse(entry.lastCheckedAt) : 0;
    if (!Number.isFinite(lastChecked) || nowMs - lastChecked >= schedule.checkIntervalMs) {
      due.push(bucket);
    }
  }
  return due;
}

export function touchBucketCheck(state, bucket, nowIso, extra = {}) {
  if (!state.buckets) state.buckets = {};
  const prev = state.buckets[bucket] || {};
  state.buckets[bucket] = {
    ...prev,
    lastCheckedAt: nowIso,
    ...extra,
  };
}

export function shouldSkipFetchDueToUnchanged(state, bucket, newHash) {
  const prev = state.buckets && state.buckets[bucket];
  if (!prev || !prev.contentHash) return false;
  return prev.contentHash === newHash;
}

export function getCatalogMetaHelpers() {
  return { GROUP_LABELS, FREQUENCY_LABELS };
}
