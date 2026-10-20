/**
 * Desktop right column contract for prod hard proof.
 * Layout V3 (≥901px): MindMenu is CSS-hidden; visible rail = QR banner + #iuDesktopRightRailCards.
 */

export function evaluateDesktopRightColumnGate(input) {
  const asidePaddingTopPx = Number(input.asidePaddingTopPx) || 0;
  const isDesktopBp = input.isDesktopBp === true;

  if (!isDesktopBp) {
    return { ok: true, mode: "not_desktop", reason: null };
  }

  if (input.horizontalOverflow === true) {
    return {
      ok: false,
      mode: "desktop_rail_v3",
      reason: "RIGHT COLUMN BROKEN: horizontal overflow on desktop",
    };
  }

  if (asidePaddingTopPx > 0) {
    return {
      ok: false,
      mode: "desktop_rail_v3",
      reason:
        "RIGHT COLUMN BROKEN: aside padding-top > 0 (wrapper silver strip risk)",
    };
  }

  if (input.mindMenuVisible === true) {
    const asideTopY = input.asideTopY;
    const mindMenuTopY = input.mindMenuTopY;
    const extra =
      asideTopY != null && mindMenuTopY != null
        ? Math.round((mindMenuTopY - asideTopY) * 100) / 100
        : null;
    if (extra != null && Math.abs(extra) > 1) {
      return {
        ok: false,
        mode: "mindmenu_visible",
        reason:
          "RIGHT COLUMN BROKEN: silver background above MindMenu detected (wrapperExtra=" +
          extra +
          ")",
      };
    }
    return { ok: true, mode: "mindmenu_visible", reason: null };
  }

  const qrVisible = input.qrVisible === true;
  const railVisible = input.railVisible === true;
  if (!qrVisible && !railVisible) {
    return {
      ok: false,
      mode: "desktop_rail_v3",
      reason: "RIGHT COLUMN BROKEN: no visible desktop right-rail content",
    };
  }

  const railHeightPx = input.railHeightPx;
  if (railVisible && (railHeightPx == null || railHeightPx < 80)) {
    return {
      ok: false,
      mode: "desktop_rail_v3",
      reason: "RIGHT COLUMN BROKEN: desktop banner rail height too small",
    };
  }

  const asideTopY = input.asideTopY;
  const qrTopY = input.qrTopY;
  if (qrVisible && qrTopY != null && asideTopY != null) {
    const qrDelta = Math.round(Math.abs(qrTopY - asideTopY) * 100) / 100;
    if (qrDelta > 2) {
      return {
        ok: false,
        mode: "desktop_rail_v3",
        reason:
          "RIGHT COLUMN BROKEN: QR banner misaligned with aside top (delta=" + qrDelta + ")",
      };
    }
  }

  const leftSilverTopY = input.leftSilverTopY;
  if (qrVisible && qrTopY != null && leftSilverTopY != null) {
    const colDelta = Math.round(Math.abs(qrTopY - leftSilverTopY) * 100) / 100;
    if (colDelta > 3) {
      return {
        ok: false,
        mode: "desktop_rail_v3",
        reason:
          "RIGHT COLUMN BROKEN: right QR rail not aligned with left silver (delta=" +
          colDelta +
          ")",
      };
    }
  }

  const railTopY = input.railTopY;
  if (!qrVisible && railVisible && railTopY != null && asideTopY != null) {
    const railOffset = Math.round((railTopY - asideTopY) * 100) / 100;
    if (railOffset < 12 || railOffset > 28) {
      return {
        ok: false,
        mode: "desktop_rail_v3",
        reason:
          "RIGHT COLUMN BROKEN: banner rail vertical offset unexpected (offset=" +
          railOffset +
          ")",
      };
    }
  }

  return { ok: true, mode: "desktop_rail_v3", reason: null };
}
