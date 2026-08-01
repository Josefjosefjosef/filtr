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

/**
 * Short factual summary from official comment (sanitized plain text).
 */
export function buildTrafficSummary(comment, maxLen = 280) {
  let t = clean(comment);
  if (!t) return "";
  // Strip any HTML-like tags defensively
  t = t.replace(/<[^>]*>/g, " ");
  t = clean(t);
  if (t.length > maxLen) t = t.slice(0, maxLen - 1).trim() + "…";
  return t;
}
