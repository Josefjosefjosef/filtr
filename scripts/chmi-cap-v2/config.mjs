/**
 * CHMI CAP v2 (Variant B+) — central config + feature flag.
 * Default MODE=off keeps legacy production path unchanged.
 *
 * Env (server/CI only — never public URL / localStorage):
 *   IU_CHMI_CAP_V2_MODE=off|shadow|active
 *   IU_CHMI_CAP_V2_ENABLED=true  → shorthand for active (avoid in prod until rollout)
 *   IU_CHMI_CAP_V2_SHADOW=true   → shorthand for shadow when mode unset
 */
export const CHMI_PUBLIC_ALERTS_URL = "https://vystrahy-cr.chmi.cz/";
export const CHMI_OPENDATA_CAP_INDEX = "https://opendata.chmi.cz/meteorology/weather/alerts/cap/";
export const CHMI_SYNC_UA =
  "InfoUzel-CHMI-Sync/1.0 (+https://infouzel.cz/; contact: info@infouzel.cz)";
export const CHMI_ATTRIBUTION =
  "Zdroj: Český hydrometeorologický ústav (CC BY 4.0). Územní přiřazení, normalizaci a zobrazení zpracoval InfoUzel.cz.";

export const DEFAULT_LIMITS = Object.freeze({
  maxResponseBytes: 8 * 1024 * 1024,
  maxXmlDepth: 40,
  maxElements: 200000,
  maxTextFieldChars: 20000,
  maxInfoBlocks: 200,
  maxAreasPerInfo: 500,
  maxGeocodesPerArea: 800,
  maxPolygonPoints: 20000,
  // Safety ceilings — exceeding them throws CAP_TRUNCATED (never silent truncate).
  maxParametersPerInfo: 100,
  maxEventCodesPerInfo: 50,
  maxReferencesParts: 200,
});

export const DEFAULT_BACKOFF_MINUTES = Object.freeze([10, 20, 40, 80]);
export const DEFAULT_SYNC_INTERVAL_MIN = 5;
export const DEFAULT_JITTER_SEC = 30;
export const DEFAULT_STALE_SOFT_MIN = 10;
export const DEFAULT_STALE_HARD_MIN = 30;
export const DEFAULT_ENDED_UI_HOURS = 36;
export const DEFAULT_REVISION_RETENTION_DAYS = 60;

/** @typedef {'off'|'shadow'|'active'} ChmiCapV2Mode */

/**
 * @param {NodeJS.ProcessEnv|Record<string,string|undefined>} [env]
 * @returns {{ mode: ChmiCapV2Mode, enabled: boolean, shadow: boolean, limits: typeof DEFAULT_LIMITS, backoffMinutes: number[], syncIntervalMin: number, jitterSec: number }}
 */
export function getChmiCapV2Config(env = process.env) {
  const e = env || {};
  let mode = String(e.IU_CHMI_CAP_V2_MODE || "").trim().toLowerCase();
  if (!mode) {
    if (String(e.IU_CHMI_CAP_V2_ENABLED || "").toLowerCase() === "true") mode = "active";
    else if (String(e.IU_CHMI_CAP_V2_SHADOW || "").toLowerCase() === "true") mode = "shadow";
    else mode = "off";
  }
  if (mode !== "off" && mode !== "shadow" && mode !== "active") mode = "off";

  const limits = { ...DEFAULT_LIMITS };
  const n = (key, fallback) => {
    const v = Number(e[key]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  limits.maxResponseBytes = n("IU_CHMI_CAP_V2_MAX_BYTES", limits.maxResponseBytes);
  limits.maxXmlDepth = n("IU_CHMI_CAP_V2_MAX_DEPTH", limits.maxXmlDepth);
  limits.maxElements = n("IU_CHMI_CAP_V2_MAX_ELEMENTS", limits.maxElements);

  return {
    mode,
    enabled: mode === "active",
    shadow: mode === "shadow",
    limits,
    backoffMinutes: DEFAULT_BACKOFF_MINUTES.slice(),
    syncIntervalMin: n("IU_CHMI_CAP_V2_INTERVAL_MIN", DEFAULT_SYNC_INTERVAL_MIN),
    jitterSec: n("IU_CHMI_CAP_V2_JITTER_SEC", DEFAULT_JITTER_SEC),
    staleSoftMin: n("IU_CHMI_CAP_V2_STALE_SOFT_MIN", DEFAULT_STALE_SOFT_MIN),
    staleHardMin: n("IU_CHMI_CAP_V2_STALE_HARD_MIN", DEFAULT_STALE_HARD_MIN),
    endedUiHours: n("IU_CHMI_CAP_V2_ENDED_UI_HOURS", DEFAULT_ENDED_UI_HOURS),
    revisionRetentionDays: n("IU_CHMI_CAP_V2_REVISION_DAYS", DEFAULT_REVISION_RETENTION_DAYS),
    publicAlertsUrl: CHMI_PUBLIC_ALERTS_URL,
    userAgent: CHMI_SYNC_UA,
    attribution: CHMI_ATTRIBUTION,
  };
}

export function isLegacyProductionPath(config = getChmiCapV2Config()) {
  return config.mode !== "active";
}

export function shouldRunShadow(config = getChmiCapV2Config()) {
  return config.mode === "shadow";
}

export function shouldPublishV2(config = getChmiCapV2Config()) {
  return config.mode === "active";
}
