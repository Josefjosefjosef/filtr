/**
 * Prod hard proof: Silver flex-remainder metrics require expanded Kalendář+Úkoly on mobile/tablet.
 * Default collapsed info cards (silver-info-cards-collapse-v1) zero calendar/tasks height and break remainder math.
 */

export const IU_TERMS_ACCEPTED_VERSION_V1 = "2026-09-08-v1";

export function isMobileOrTabletHardProofViewport(vp) {
  if (!vp) return false;
  const g = vp.group || vp.name || "";
  return g === "mobile" || g === "tablet";
}

/** Gate: flex remainder proof is invalid when info cards stay collapsed (calendar/tasks height 0). */
export function evaluateFlexRemainderInfoCardsReadiness({
  infoCardsDisplay,
  calendarHeightPx,
  tasksHeightPx,
}) {
  const disp = String(infoCardsDisplay || "");
  if (disp === "none" || disp === "") {
    return { ok: false, reason: "info_cards_collapsed" };
  }
  const cal = Number(calendarHeightPx);
  const tasks = Number(tasksHeightPx);
  if (!Number.isFinite(cal) || !Number.isFinite(tasks)) {
    return { ok: false, reason: "missing_heights" };
  }
  if (cal < 8 || tasks < 8) {
    return { ok: false, reason: "zero_or_hidden_summary_cards" };
  }
  return { ok: true, reason: "ready" };
}

export async function applySilverFlexRemainderReadiness(page, vp) {
  await page.evaluate((termsVer) => {
    try {
      localStorage.setItem("iu:terms:accepted:v1", "1");
      localStorage.setItem("iu:terms:accepted-version:v1", termsVer);
      localStorage.setItem("iu:terms:accepted-at:v1", new Date().toISOString());
      localStorage.setItem("iu:consent:layer:dismissed:v1", "1");
      localStorage.setItem("iu:consent:analytics:v1", "denied");
    } catch (_) {}
    try {
      document.documentElement.classList.remove("iu-terms-gate-open");
      document.body.classList.remove("iu-terms-gate-open");
    } catch (_) {}
    const terms = document.getElementById("iuTermsGate");
    if (terms) {
      try {
        terms.hidden = true;
        terms.setAttribute("aria-hidden", "true");
      } catch (_) {}
    }
    const layer = document.getElementById("iuConsentLayer");
    if (layer) {
      try {
        layer.hidden = true;
      } catch (_) {}
    }
  }, IU_TERMS_ACCEPTED_VERSION_V1);

  if (!isMobileOrTabletHardProofViewport(vp)) return;

  await page.evaluate(() => {
    try {
      localStorage.setItem("iu.infoCards.expanded.v1", "1");
    } catch (_) {}
    try {
      document.documentElement.setAttribute("data-iu-info-cards-expanded", "1");
    } catch (_) {}
    const btn = document.getElementById("iuInfoCardsExpandToggle");
    if (btn) {
      try {
        btn.setAttribute("aria-expanded", "true");
      } catch (_) {}
    }
    const panel = document.getElementById("iuInfoCardsMobileTablet");
    if (panel) {
      try {
        panel.setAttribute("aria-hidden", "false");
      } catch (_) {}
    }
  });

  await page.waitForFunction(
    () => {
      const wrap = document.getElementById("iuInfoCardsMobileTablet");
      const cal = document.getElementById("iuSilverCalendarSummaryCard");
      const tasks = document.getElementById("iuSilverTasksSummaryCard");
      if (!wrap || !cal || !tasks) return false;
      const wcs = getComputedStyle(wrap);
      if (wcs.display === "none") return false;
      return cal.getBoundingClientRect().height > 8 && tasks.getBoundingClientRect().height > 8;
    },
    { timeout: 25000 }
  );
}
