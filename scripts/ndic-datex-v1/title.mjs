/**
 * Deterministic Czech public titles from structured fields — no invented facts.
 */

function clean(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

/**
 * @param {{
 *   labelCs?: string,
 *   roadNumber?: string,
 *   locationLabel?: string,
 *   direction?: string,
 *   km?: string|number|null,
 * }} p
 */
export function buildTrafficTitle(p = {}) {
  const type = clean(p.labelCs) || "Dopravní informace";
  const bits = [];
  if (p.roadNumber) bits.push(clean(p.roadNumber));
  if (p.km != null && p.km !== "") bits.push("km " + clean(p.km));
  if (p.locationLabel && !bits.includes(clean(p.locationLabel))) {
    const loc = clean(p.locationLabel);
    // Avoid duplicating road number as location
    if (loc && loc !== clean(p.roadNumber)) bits.push(loc);
  }
  if (p.direction) bits.push("směr " + clean(p.direction));
  if (!bits.length) return type;
  return type + " — " + bits.join(", ");
}

/** Parser / DATEX text-field ceiling — preserve full source up to this bound. */
export const TRAFFIC_COMMENT_FULL_MAX = 12000;
/** Short card/list summary length (presentation only; never feeds impactFull). */
export const TRAFFIC_COMMENT_SUMMARY_MAX = 280;

/**
 * Sanitize official DATEX comment / cause as plain text WITHOUT presentation truncation.
 * Strips HTML-like tags; collapses whitespace; caps only at TRAFFIC_COMMENT_FULL_MAX
 * (same order as DEFAULT_LIMITS.maxTextFieldChars) — not the 280 summary limit.
 */
export function sanitizeTrafficComment(comment, maxLen = TRAFFIC_COMMENT_FULL_MAX) {
  let t = clean(comment);
  if (!t) return "";
  t = t.replace(/<[^>]*>/g, " ");
  t = clean(t);
  const cap = Number.isFinite(maxLen) && maxLen > 0 ? maxLen : TRAFFIC_COMMENT_FULL_MAX;
  if (t.length > cap) t = t.slice(0, cap);
  return t;
}

/**
 * Short factual summary from official comment (sanitized plain text).
 * Presentation-only — must NOT be used as the sole source for impactFull.
 */
export function buildTrafficSummary(comment, maxLen = TRAFFIC_COMMENT_SUMMARY_MAX) {
  let t = sanitizeTrafficComment(comment, TRAFFIC_COMMENT_FULL_MAX);
  if (!t) return "";
  const cap = Number.isFinite(maxLen) && maxLen > 0 ? maxLen : TRAFFIC_COMMENT_SUMMARY_MAX;
  if (t.length > cap) t = t.slice(0, cap - 1).trim() + "…";
  return t;
}
