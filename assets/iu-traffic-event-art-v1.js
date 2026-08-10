/**
 * InfoUzel traffic event illustrations (inline SVG).
 * Own visual language — not Czech traffic signs, not UAMK yellow.
 * Strokes use currentColor for light/dark CSS theming.
 */

export const ROAD_BADGE_CLASS = Object.freeze({
  MOTORWAY: "motorway",
  CLASS_I: "class-i",
  CLASS_II: "class-ii",
  CLASS_III: "class-iii",
  LOCAL: "local",
  UNKNOWN: "unknown",
});

function svgWrap(inner) {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" ' +
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true" focusable="false">' +
    inner +
    "</svg>"
  );
}

function car(x, y, scale) {
  const s = scale != null ? scale : 1;
  const tx = x;
  const ty = y;
  return (
    `<g transform="translate(${tx} ${ty}) scale(${s})">` +
    `<path d="M4 14h20l4-6h8l4 6h4v8H4z"/>` +
    `<circle cx="12" cy="22" r="3"/>` +
    `<circle cx="28" cy="22" r="3"/>` +
    `</g>`
  );
}

const ILLUSTRATIONS = Object.freeze({
  nehoda: svgWrap(
    car(2, 18, 0.9) +
      car(28, 22, 0.85) +
      `<path d="M30 12l4 6M34 12l-4 6" stroke-width="2.2"/>`
  ),
  prekazka: svgWrap(
    car(6, 28, 0.95) +
      `<path d="M40 10L52 34H28z"/>` +
      `<path d="M40 22v6M40 30.5v1.5"/>`
  ),
  prace: svgWrap(
    `<path d="M18 48V28l6-10h4l6 10v20"/>` +
      `<path d="M22 28h12"/>` +
      `<path d="M40 20l8 8M48 20l-8 8"/>` +
      `<path d="M12 48h40"/>` +
      `<circle cx="24" cy="18" r="3"/>`
  ),
  uzavirka: svgWrap(
    `<path d="M10 40h44"/>` +
      `<path d="M14 40V22M50 40V22"/>` +
      `<path d="M14 28h36M14 34h36"/>` +
      `<path d="M22 22l4-8h12l4 8"/>`
  ),
  kolona: svgWrap(car(4, 10, 0.75) + car(14, 24, 0.75) + car(24, 38, 0.75)),
  pozar: svgWrap(
    car(4, 28, 0.95) +
      `<path d="M46 36c0-8 6-12 6-18 4 6 8 10 8 18a8 8 0 01-16 0z"/>` +
      `<path d="M50 30c1-3 3-5 4-8"/>`
  ),
  omezeni: svgWrap(
    `<path d="M8 18h48M8 32h48M8 46h48"/>` +
      `<path d="M20 14v8M36 28v8M28 42v8" stroke-width="3"/>` +
      `<rect x="16" y="12" width="8" height="12" rx="1"/>` +
      `<rect x="32" y="26" width="8" height="12" rx="1"/>` +
      `<rect x="24" y="40" width="8" height="12" rx="1"/>`
  ),
  neutral: svgWrap(
    `<path d="M32 8L56 52H8z"/>` + `<path d="M32 24v14M32 42v2"/>`
  ),
});

/**
 * @param {string|null|undefined} illustrationKey
 * @returns {string} inline SVG markup
 */
export function trafficEventIllustrationSvg(illustrationKey) {
  const k = String(illustrationKey || "neutral").toLowerCase();
  return ILLUSTRATIONS[k] || ILLUSTRATIONS.neutral;
}
