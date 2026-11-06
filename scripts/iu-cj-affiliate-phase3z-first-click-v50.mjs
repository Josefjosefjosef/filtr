/**
 * V50 — first-click result classification (honest popup allowed/blocked).
 * target=_blank alone is NOT proof of successful click navigation.
 */
export const FIRST_CLICK_RESULT = Object.freeze({
  PASS_POPUP_OPENED: "PASS_POPUP_OPENED",
  PASS_SAME_TAB_NAVIGATION: "PASS_SAME_TAB_NAVIGATION",
  BLOCKED_BY_BROWSER: "BLOCKED_BY_BROWSER",
  LINK_BROKEN: "LINK_BROKEN",
  NOT_TESTED: "NOT_TESTED",
});

/**
 * Classify a real click attempt.
 * @param {{ href?: string|null, popupOpened?: boolean, popupUrl?: string|null, sameTabNavigated?: boolean, afterUrl?: string|null, originHost?: string, clickError?: string|null, hrefBroken?: boolean }} obs
 */
export function classifyFirstClick(obs = {}) {
  const href = obs.href != null ? String(obs.href) : "";
  if (obs.hrefBroken === true || !href || href === "#" || href.startsWith("javascript:")) {
    return {
      result: FIRST_CLICK_RESULT.LINK_BROKEN,
      reason: "missing_or_invalid_href",
    };
  }
  if (obs.popupOpened === true) {
    return {
      result: FIRST_CLICK_RESULT.PASS_POPUP_OPENED,
      reason: "popup_event_observed",
      popupUrl: obs.popupUrl || null,
    };
  }
  if (obs.sameTabNavigated === true) {
    return {
      result: FIRST_CLICK_RESULT.PASS_SAME_TAB_NAVIGATION,
      reason: "same_tab_url_changed_off_origin",
      afterUrl: obs.afterUrl || null,
    };
  }
  // Click executed, attributes look ok, but no popup and stayed on origin → browser blocked popup (headless common).
  if (obs.clickError) {
    return {
      result: FIRST_CLICK_RESULT.LINK_BROKEN,
      reason: "click_threw",
      clickError: String(obs.clickError).slice(0, 200),
    };
  }
  return {
    result: FIRST_CLICK_RESULT.BLOCKED_BY_BROWSER,
    reason: "click_ok_no_popup_no_same_tab_nav_origin_retained",
    afterUrl: obs.afterUrl || null,
    note: "Headless/CI often blocks window.open; classify honestly — do not claim PASS_POPUP_OPENED.",
  };
}

export function emptyFirstClickReport(opts = {}) {
  return {
    schema: "iu-cj-affiliate-phase3z-first-click-v50",
    at: opts.nowIso || new Date().toISOString(),
    phase: "3Z-V50",
    note: "Real Playwright user clicks. No purchases. Popup block ≠ link failure.",
    byType: {},
    devices: [],
  };
}
