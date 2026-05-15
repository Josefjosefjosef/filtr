/**
 * P1 security foundation: external origins registry (passive metadata only).
 * No enforcement; deterministic classification for future CSP / governance.
 */

export const IU_EXTERNAL_ORIGINS_SOURCE_OF_TRUTH = "infouzel.cz/projects baseline + CSP meta";

/**
 * @typedef {Object} IuExternalOriginRow
 * @property {string} origin
 * @property {"first_party"|"third_party"} classification
 * @property {string} purpose
 * @property {string} source_of_truth
 * @property {boolean} active
 */

/** @type {ReadonlyArray<IuExternalOriginRow>} */
export const IU_EXTERNAL_ORIGINS_REGISTRY = Object.freeze([
  { origin: "https://infouzel.cz", classification: "first_party", purpose: "production site", source_of_truth: IU_EXTERNAL_ORIGINS_SOURCE_OF_TRUTH, active: true },
  { origin: "https://www.infouzel.cz", classification: "first_party", purpose: "production site (www)", source_of_truth: IU_EXTERNAL_ORIGINS_SOURCE_OF_TRUTH, active: true },
  { origin: "https://api.open-meteo.com", classification: "third_party", purpose: "weather forecast API (fetch)", source_of_truth: IU_EXTERNAL_ORIGINS_SOURCE_OF_TRUTH, active: true },
  { origin: "https://i.ytimg.com", classification: "third_party", purpose: "YouTube thumbnail images", source_of_truth: IU_EXTERNAL_ORIGINS_SOURCE_OF_TRUTH, active: true },
  { origin: "https://www.youtube.com", classification: "third_party", purpose: "YouTube embeds and links", source_of_truth: IU_EXTERNAL_ORIGINS_SOURCE_OF_TRUTH, active: true },
  { origin: "https://www.youtube-nocookie.com", classification: "third_party", purpose: "YouTube privacy-enhanced embeds", source_of_truth: IU_EXTERNAL_ORIGINS_SOURCE_OF_TRUTH, active: true },
  { origin: "https://use.fontawesome.com", classification: "third_party", purpose: "Font Awesome CDN (removed from /projects/; inline SVG icons)", source_of_truth: IU_EXTERNAL_ORIGINS_SOURCE_OF_TRUTH, active: false },
  { origin: "https://www.google.com", classification: "third_party", purpose: "external search links", source_of_truth: IU_EXTERNAL_ORIGINS_SOURCE_OF_TRUTH, active: true },
  { origin: "https://tracking.app.packeta.com", classification: "third_party", purpose: "Zásilkovna tracking", source_of_truth: IU_EXTERNAL_ORIGINS_SOURCE_OF_TRUTH, active: true },
  { origin: "https://tracking.packeta.com", classification: "third_party", purpose: "Packeta tracking fallback", source_of_truth: IU_EXTERNAL_ORIGINS_SOURCE_OF_TRUTH, active: true },
  { origin: "https://www.balikovna.cz", classification: "third_party", purpose: "Balíkovna tracking", source_of_truth: IU_EXTERNAL_ORIGINS_SOURCE_OF_TRUTH, active: true },
  { origin: "https://www.ppl.cz", classification: "third_party", purpose: "PPL tracking", source_of_truth: IU_EXTERNAL_ORIGINS_SOURCE_OF_TRUTH, active: true },
  { origin: "https://tracking.dpd.de", classification: "third_party", purpose: "DPD tracking", source_of_truth: IU_EXTERNAL_ORIGINS_SOURCE_OF_TRUTH, active: true },
  { origin: "https://gls-group.com", classification: "third_party", purpose: "GLS tracking", source_of_truth: IU_EXTERNAL_ORIGINS_SOURCE_OF_TRUTH, active: true },
  { origin: "https://trace.wedo.cz", classification: "third_party", purpose: "WeDo tracking", source_of_truth: IU_EXTERNAL_ORIGINS_SOURCE_OF_TRUTH, active: true },
  { origin: "https://www.dhl.com", classification: "third_party", purpose: "DHL tracking", source_of_truth: IU_EXTERNAL_ORIGINS_SOURCE_OF_TRUTH, active: true },
  { origin: "https://www.msng.cz", classification: "third_party", purpose: "Messenger tracking", source_of_truth: IU_EXTERNAL_ORIGINS_SOURCE_OF_TRUTH, active: true },
]);

/** Same string as legacy app.js open-meteo forecast URL base (no behavior change). */
export const IU_OPEN_METEO_FORECAST_BASE = "https://api.open-meteo.com/v1/forecast";

function iuCoerceUrlInput(input) {
  if (input == null) return null;
  if (typeof input === "string") return input;
  try {
    if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  } catch (_) {}
  return String(input);
}

function iuParseUrlLike(input) {
  const raw = iuCoerceUrlInput(input);
  if (raw == null || raw === "") return null;
  try {
    if (typeof raw === "string" && raw.indexOf("/") === 0) {
      if (typeof location !== "undefined" && location && location.href) {
        return new URL(raw, location.origin);
      }
      return null;
    }
    return new URL(raw, typeof location !== "undefined" && location && location.href ? location.href : "https://infouzel.cz/");
  } catch (_) {
    return null;
  }
}

/**
 * Deterministic metadata for a URL origin; does not block or mutate network behavior.
 * @returns {{ matched: boolean, active: boolean, classification: string|null, purpose: string|null, source_of_truth: string|null, origin: string|null, registryEntry: IuExternalOriginRow|null }}
 */
export function getExternalOriginMeta(url) {
  const u = iuParseUrlLike(url);
  if (!u) {
    return { matched: false, active: false, classification: null, purpose: null, source_of_truth: null, origin: null, registryEntry: null };
  }
  const originStr = u.origin;
  try {
    if (typeof location !== "undefined" && location && location.origin && originStr === location.origin) {
      return {
        matched: true,
        active: true,
        classification: "first_party",
        purpose: "same-origin page asset or API",
        source_of_truth: "runtime_location",
        origin: originStr,
        registryEntry: null,
      };
    }
  } catch (_) {}
  const row = IU_EXTERNAL_ORIGINS_REGISTRY.find(function (r) { return r.origin === originStr; });
  if (!row) {
    return { matched: false, active: false, classification: null, purpose: null, source_of_truth: null, origin: originStr, registryEntry: null };
  }
  return {
    matched: true,
    active: row.active,
    classification: row.classification,
    purpose: row.purpose,
    source_of_truth: row.source_of_truth,
    origin: originStr,
    registryEntry: row,
  };
}

export function isAllowedExternalOrigin(url) {
  const meta = getExternalOriginMeta(url);
  if (!meta.matched) return false;
  return meta.active === true;
}
