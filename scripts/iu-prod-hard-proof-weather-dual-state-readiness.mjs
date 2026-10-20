/**
 * Hard proof: Silver weather setup → ready stack (mobile firstVisit / document scroll).
 */

export function weatherSlotMaxHeightCapIsActive(slotClientHeightPx, slotMaxHeightPx, viewportHeightPx) {
  const ch = Number(slotClientHeightPx);
  const maxPx = Number(slotMaxHeightPx);
  const vh = Number(viewportHeightPx);
  if (!Number.isFinite(ch) || ch <= 0) return false;
  if (!Number.isFinite(maxPx) || maxPx <= 0) return false;
  if (ch > maxPx + 4) return false;
  if (Number.isFinite(vh) && vh > 0 && ch > vh + 96) return false;
  return true;
}

/** Document-scroll mobile: stack may extend; first-screen input fold must fit (same policy as SILVER flex remainder). */
export function evaluateWeatherStackFitsViewport(probe) {
  if (!probe || typeof probe !== "object") return false;
  if (probe.slotMaxHeightCapActive === true) {
    return probe.overflowDelta <= 2;
  }
  return probe.foldOk === true;
}

/** firstVisit uses compact copy + card tap/overlay; #iuSilverWeatherActions stays hidden (see iuSilverWeatherRenderFirstVisit). */
export function evaluateWeatherSetupControlsVisible(probe) {
  if (!probe || typeof probe !== "object") return false;
  const phase = String(probe.phase || "");
  if (phase === "firstVisit") {
    return probe.compactPromptVisible === true;
  }
  if (phase === "denied") {
    return probe.deniedPromptVisible === true || probe.actionsFallbackVisible === true;
  }
  return probe.actionsFallbackVisible === true;
}

export function evaluateWeatherSetupStateGate(probe) {
  return (
    probe &&
    probe.layout === "setup" &&
    evaluateWeatherSetupControlsVisible(probe) === true &&
    evaluateWeatherStackFitsViewport(probe) === true &&
    probe.foldOk === true
  );
}

export function evaluateWeatherReadyStateGate(probe) {
  return (
    probe &&
    probe.layout === "ready" &&
    probe.actionsFallbackVisible === false &&
    evaluateWeatherStackFitsViewport(probe) === true &&
    probe.foldOk === true
  );
}

export function evaluateWeatherSetupToReadyReallocationOk(setupProbe, readyProbe) {
  if (!setupProbe || !readyProbe) return false;
  const wxShrunk = setupProbe.wxH > readyProbe.wxH + 5;
  if (!wxShrunk) return false;
  if (readyProbe.thirdH > setupProbe.thirdH + 5) return true;
  /* Document scroll: third box already fills remainder; weather card shrink is the reallocation. */
  if (
    setupProbe.slotMaxHeightCapActive !== true &&
    readyProbe.slotMaxHeightCapActive !== true &&
    String(readyProbe.phase || "") === "data"
  ) {
    const third = Number(readyProbe.thirdH);
    return Number.isFinite(third) && third >= 178;
  }
  return false;
}
