/**
 * Premium creative layout (keep in sync with cloudflare/iu-ads/src/premium-creative-render.ts).
 */
(function (global) {
  "use strict";

  var MODES = {
    logo: 0,
    image_small: 0.25,
    image_medium: 0.5,
    image_large: 0.75,
    full_bleed_banner: 1,
  };

  var SLOT_PAD_Y = 16;
  var SLOT_PAD_X = 12;
  var LOGO_INSET = 10;

  function normalizeMode(raw) {
    var v = String(raw == null ? "" : raw)
      .trim()
      .toLowerCase();
    if (v === "banner") return "full_bleed_banner";
    if (Object.prototype.hasOwnProperty.call(MODES, v)) return v;
    if (v.indexOf("banner") >= 0) return "full_bleed_banner";
    return "logo";
  }

  function fillFraction(mode) {
    var k = normalizeMode(mode);
    return Object.prototype.hasOwnProperty.call(MODES, k) ? MODES[k] : 0;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function computeLayout(slotW, slotH, iw, ih, mode) {
    var t = fillFraction(mode);
    if (!(slotW > 0 && slotH > 0 && iw > 0 && ih > 0)) return { endpoint: true, mode: normalizeMode(mode) };
    if (t <= 0) return { endpoint: true, mode: "logo" };
    if (t >= 1) return { endpoint: true, mode: "full_bleed_banner" };

    var padY = lerp(SLOT_PAD_Y, 0, t);
    var padX = lerp(SLOT_PAD_X, 0, t);
    var imgInset = lerp(LOGO_INSET, 0, t);
    var innerW = slotW - 2 * padX;
    var innerH = slotH - 2 * padY;
    var availW = Math.max(0, innerW - 2 * imgInset);
    var availH = Math.max(0, innerH - 2 * imgInset);
    var sContain = Math.min(availW / iw, availH / ih);
    var sCover = Math.max(innerW / iw, innerH / ih);
    var scale = lerp(sContain, sCover, t);
    var dispW = iw * scale;
    var dispH = ih * scale;
    return {
      endpoint: false,
      slotPad: { top: padY, right: padX, bottom: padY, left: padX },
      img: {
        width: dispW,
        height: dispH,
        left: padX + imgInset + (availW - dispW) / 2,
        top: padY + imgInset + (availH - dispH) / 2,
      },
    };
  }

  function modeClassSuffix(mode) {
    var m = normalizeMode(mode);
    if (m === "logo") return "logo";
    if (m === "full_bleed_banner") return "banner";
    return "blend";
  }

  function clearBlendStyles(slot, img) {
    slot.style.padding = "";
    slot.style.position = "";
    slot.style.overflow = "";
    img.style.position = "";
    img.style.left = "";
    img.style.top = "";
    img.style.width = "";
    img.style.height = "";
    img.style.maxWidth = "";
    img.style.maxHeight = "";
    img.style.objectFit = "";
    img.style.objectPosition = "";
    img.style.padding = "";
    img.style.boxSizing = "";
  }

  function applyLayoutToSlot(slot, img, mode) {
    if (!slot || !img) return;
    var layout = computeLayout(slot.clientWidth, slot.clientHeight, img.naturalWidth, img.naturalHeight, mode);
    slot.classList.remove("iuPremiumSlot--logo", "iuPremiumSlot--banner", "iuPremiumSlot--blend");
    slot.classList.add("iuPremiumSlot--" + modeClassSuffix(mode));
    slot.setAttribute("data-creative-mode", normalizeMode(mode));
    clearBlendStyles(slot, img);
    if (layout.endpoint && layout.mode === "logo") return;
    if (layout.endpoint && layout.mode === "full_bleed_banner") return;
    var sp = layout.slotPad;
    slot.style.padding = sp.top + "px " + sp.right + "px " + sp.bottom + "px " + sp.left + "px";
    slot.style.position = "relative";
    slot.style.overflow = "hidden";
    img.style.position = "absolute";
    img.style.left = layout.img.left + "px";
    img.style.top = layout.img.top + "px";
    img.style.width = layout.img.width + "px";
    img.style.height = layout.img.height + "px";
    img.style.maxWidth = "none";
    img.style.maxHeight = "none";
    img.style.objectFit = "cover";
    img.style.objectPosition = "center center";
    img.style.padding = "0";
    img.style.boxSizing = "border-box";
  }

  function bindPremiumCreativeImage(slot, img, mode) {
    if (!slot || !img) return;
    function run() {
      applyLayoutToSlot(slot, img, mode);
    }
    if (img.complete && img.naturalWidth > 0) run();
    else img.addEventListener("load", run, { once: true });
  }

  global.iuPremiumCreativeRender = {
    normalizeMode: normalizeMode,
    fillFraction: fillFraction,
    modeClassSuffix: modeClassSuffix,
    applyLayoutToSlot: applyLayoutToSlot,
    bindPremiumCreativeImage: bindPremiumCreativeImage,
  };
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
