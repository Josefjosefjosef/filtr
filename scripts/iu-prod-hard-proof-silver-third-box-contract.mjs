/**
 * Contract for #iuSilverTallScrollSection min-height on mobile/tablet (see assets/app.css @media max-width: 1024px).
 * Hard proof must not treat the authoritative 180px floor as a regression.
 */
export const SILVER_TALL_SCROLL_SECTION_MIN_HEIGHT_PX = 180;
export const SILVER_TALL_SCROLL_SECTION_MIN_HEIGHT_TOLERANCE_PX = 2;
/** Reject runaway min-heights that would create excess blank space. */
export const SILVER_TALL_SCROLL_SECTION_MAX_ALLOWED_MIN_HEIGHT_PX = 220;

export function evaluateSilverTallScrollThirdBoxMinHeightContract(minHeightPx, heightCss, maxHeightCss) {
  const minH = Number(minHeightPx);
  const minHF = Number.isFinite(minH) ? minH : 0;
  const heightHS = String(heightCss || "");
  const maxHS = String(maxHeightCss || "");
  const vhUnit = /(?:^|[^a-z])(?:min-|max-)?(?:[\d.]+\s*)?(?:[slvd])?vh\b/i;
  const badVh = vhUnit.test(maxHS) || vhUnit.test(heightHS);
  if (badVh || minHF > SILVER_TALL_SCROLL_SECTION_MAX_ALLOWED_MIN_HEIGHT_PX) {
    return { ok: false, badVh, minHF, reason: badVh ? "vh_on_height" : "min_height_excessive" };
  }
  const lo = SILVER_TALL_SCROLL_SECTION_MIN_HEIGHT_PX - SILVER_TALL_SCROLL_SECTION_MIN_HEIGHT_TOLERANCE_PX;
  const hi = SILVER_TALL_SCROLL_SECTION_MIN_HEIGHT_PX + SILVER_TALL_SCROLL_SECTION_MIN_HEIGHT_TOLERANCE_PX;
  const contentDriven = minHF < 0.5;
  const atAuthoritativeFloor = minHF >= lo && minHF <= hi;
  const ok = contentDriven || atAuthoritativeFloor;
  return {
    ok,
    badVh: false,
    minHF,
    contentDriven,
    atAuthoritativeFloor,
    reason: ok ? "pass" : "min_height_out_of_contract",
  };
}
