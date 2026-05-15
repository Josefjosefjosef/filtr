/**
 * infoUzel.cz — CTA resolve vrstva pro finanční kalkulačky (bez tvrdých produkčních URL v UI).
 * Globální napojení: window.__iuFinCtaRoutes (volitelné) + CustomEvent "iu-fin-cta".
 */

function iuFinIsNonEmptyString(s) {
  return typeof s === "string" && String(s).trim() !== "";
}

/**
 * @param {object} cfg — kalkulační CTA konfigurace
 * @returns {boolean} zda lze bezpečně zobrazit interaktivní CTA
 */
export function iuFinCtaConfigIsRenderable(cfg) {
  if (!cfg || cfg.enabled === false) return false;
  const mode = cfg.ctaMode;
  if (mode === "disabled") return false;
  if (mode !== "contact" && mode !== "landing") return false;
  if (!iuFinIsNonEmptyString(cfg.ctaLabel)) return false;
  if (!iuFinIsNonEmptyString(cfg.ctaServiceKey)) return false;
  return true;
}

function iuFinSafeExternalUrl(url) {
  if (!iuFinIsNonEmptyString(url)) return null;
  const t = String(url).trim();
  try {
    const u = new URL(t, typeof window !== "undefined" ? window.location.href : "https://infouzel.cz/");
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.href;
  } catch (_) {
    return null;
  }
}

/**
 * Sloučení výchozího CTA s případným override (např. z runtime konfigurace).
 */
export function iuFinMergeCtaConfig(base, override) {
  if (!base || typeof base !== "object") return base || null;
  if (!override || typeof override !== "object") return base;
  return { ...base, ...override };
}

/**
 * @param {object} cfg — validní renderovatelná konfigurace
 * @param {{ calculatorId: string }} ctx
 * @returns {{ show: boolean, label: string, mode: string, onActivate: (ev: Event) => void, serviceKey: string, resultSummaryMode: string }}
 */
export function resolveIuFinCta(cfg, ctx) {
  const empty = {
    show: false,
    label: "",
    mode: "disabled",
    onActivate: null,
    serviceKey: "",
    resultSummaryMode: "default",
  };
  if (!iuFinCtaConfigIsRenderable(cfg)) return empty;
  const calculatorId = ctx && ctx.calculatorId ? String(ctx.calculatorId) : "";
  const label = String(cfg.ctaLabel).trim();
  const mode = cfg.ctaMode;
  const serviceKey = String(cfg.ctaServiceKey).trim();
  const resultSummaryMode = iuFinIsNonEmptyString(cfg.resultSummaryMode) ? String(cfg.resultSummaryMode).trim() : "default";
  const target = cfg.ctaTarget != null && typeof cfg.ctaTarget === "object" ? cfg.ctaTarget : {};

  function onActivate(ev) {
    try {
      if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
    } catch (_) {}
    const detail = { mode, serviceKey, calculatorId, target };
    try {
      const map =
        typeof window !== "undefined" && window.__iuFinCtaRoutes && typeof window.__iuFinCtaRoutes === "object"
          ? window.__iuFinCtaRoutes
          : null;
      if (map && typeof map[serviceKey] === "function") {
        map[serviceKey](detail);
        return;
      }
    } catch (_) {}
    try {
      if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
        window.dispatchEvent(new CustomEvent("iu-fin-cta", { detail, bubbles: true }));
      }
    } catch (_) {}
    try {
      const kind = target.kind;
      if (kind === "external") {
        const href = iuFinSafeExternalUrl(target.url);
        if (href && typeof window !== "undefined") window.open(href, "_blank", "noopener,noreferrer");
        return;
      }
      if (kind === "route" && iuFinIsNonEmptyString(target.path)) {
        if (typeof window !== "undefined") {
          const p = String(target.path).trim();
          if (p.startsWith("#")) window.location.hash = p;
          else window.location.assign(p);
        }
        return;
      }
    } catch (_) {}
  }

  return { show: true, label, mode, onActivate, serviceKey, resultSummaryMode };
}
