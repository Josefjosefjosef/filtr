/**
 * Centrální výpočet a formátování změn pro Informační lištu.
 * Změna pouze mezi dvěma srovnatelnými hodnotami; nikdy proti nule/chybějícímu.
 */

export const IU_CHANGE_UNAVAILABLE = "Předchozí srovnatelná hodnota není dostupná.";

/** @typedef {"percentage_points"|"percent"|"absolute"|"index_points"|"none"} ChangeKind */

/**
 * @param {number} n
 * @param {{ maxFractionDigits?: number, minFractionDigits?: number }} [opts]
 */
export function formatCzechNumber(n, opts = {}) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  const maxFractionDigits = opts.maxFractionDigits != null ? opts.maxFractionDigits : 2;
  const minFractionDigits = opts.minFractionDigits != null ? opts.minFractionDigits : 0;
  return n.toLocaleString("cs-CZ", { minimumFractionDigits: minFractionDigits, maximumFractionDigits: maxFractionDigits });
}

/**
 * @param {string} unit
 * @param {string} [indicatorId]
 * @returns {ChangeKind}
 */
export function resolveChangeKind(unit, indicatorId) {
  const id = String(indicatorId || "");
  const u = String(unit || "").trim().toLowerCase();

  if (
    id === "unemployment" ||
    id === "seniors" ||
    id === "elections" ||
    id === "inflation" ||
    id === "gdp"
  ) {
    return "percentage_points";
  }
  if (u === "%" || u === "p. b." || u === "p.b.") return "percentage_points";
  if (u === "index" || /bod/.test(u)) return "index_points";
  if (id === "bitcoin" || id === "gold") return "percent";
  if (u === "") return "absolute";
  return "absolute";
}

/**
 * @param {number|null|undefined} current
 * @param {number|null|undefined} previous
 * @param {{ kind?: ChangeKind, unit?: string, indicatorId?: string, maxAbsRatio?: number }} [options]
 */
export function computeComparableChange(current, previous, options = {}) {
  const kind = options.kind || resolveChangeKind(options.unit, options.indicatorId);
  if (kind === "none") {
    return { direction: "flat", text: IU_CHANGE_UNAVAILABLE, absoluteChange: null, percentageChange: null };
  }
  if (typeof current !== "number" || !Number.isFinite(current)) {
    return { direction: "flat", text: IU_CHANGE_UNAVAILABLE, absoluteChange: null, percentageChange: null };
  }
  if (typeof previous !== "number" || !Number.isFinite(previous)) {
    return { direction: "flat", text: IU_CHANGE_UNAVAILABLE, absoluteChange: null, percentageChange: null };
  }
  // Nikdy nepočítat proti nule (rozbité historické období / chybný parser).
  if (previous === 0) {
    return { direction: "flat", text: IU_CHANGE_UNAVAILABLE, absoluteChange: null, percentageChange: null };
  }

  const delta = current - previous;
  const ratio = Math.abs(delta / previous);
  const maxAbsRatio = options.maxAbsRatio != null ? options.maxAbsRatio : defaultMaxAbsRatio(kind, options.unit);
  if (Number.isFinite(maxAbsRatio) && ratio > maxAbsRatio) {
    return { direction: "flat", text: IU_CHANGE_UNAVAILABLE, absoluteChange: null, percentageChange: null };
  }

  if (Math.abs(delta) < 1e-9) {
    return { direction: "flat", text: "beze změny", absoluteChange: 0, percentageChange: 0 };
  }

  const direction = delta > 0 ? "up" : "down";
  const sign = delta > 0 ? "▲" : "▼";
  const abs = Math.abs(delta);
  const unit = String(options.unit || "").trim();

  if (kind === "percentage_points") {
    return {
      direction,
      text: `${sign} ${formatCzechNumber(abs, { minFractionDigits: 2, maxFractionDigits: 2 })} p. b.`,
      absoluteChange: delta,
      percentageChange: null,
    };
  }

  if (kind === "percent") {
    const pct = (delta / previous) * 100;
    return {
      direction,
      text: `${sign} ${formatCzechNumber(Math.abs(pct), { minFractionDigits: 2, maxFractionDigits: 2 })} %`,
      absoluteChange: delta,
      percentageChange: pct,
    };
  }

  if (kind === "index_points") {
    return {
      direction,
      text: `${sign} ${formatCzechNumber(abs, { minFractionDigits: 2, maxFractionDigits: 2 })}`,
      absoluteChange: delta,
      percentageChange: null,
    };
  }

  // absolute — měna / počet / Kč/l …
  let digits = 2;
  if (unit === "Kč" && abs >= 1) digits = 0;
  if (unit === "" || unit === "žáků" || unit === "tis." || unit === "mil. Kč" || unit === "tis. Kč") {
    digits = abs >= 1 ? 0 : 2;
  }
  if (unit === "Kč/l") digits = 2;
  if (/^Kč$/.test(unit) && options.indicatorId && /eur_czk|usd_czk/.test(options.indicatorId)) {
    digits = 3;
  }

  const formatted = formatCzechNumber(abs, { minFractionDigits: digits === 0 ? 0 : digits, maxFractionDigits: digits });
  const suffix = unit ? ` ${unit}` : "";
  return {
    direction,
    text: `${sign} ${formatted}${suffix}`,
    absoluteChange: delta,
    percentageChange: null,
  };
}

function defaultMaxAbsRatio(kind, unit) {
  if (kind === "percentage_points") return 50; // sanity; p.b. jumps >50 are nonsense
  if (kind === "index_points") return 20;
  const u = String(unit || "");
  if (u === "Kč" || u === "Kč/l") return 5;
  if (u === "žáků" || u === "" || u === "tis." || u === "mil. Kč" || u === "tis. Kč") return 5;
  return 10;
}

/**
 * Změna z hotového procentního ukazatele (např. CoinGecko 24h).
 * @param {number|null|undefined} pct
 */
export function trendFromPercentPoint(pct) {
  if (typeof pct !== "number" || !Number.isFinite(pct)) {
    return { direction: "flat", text: IU_CHANGE_UNAVAILABLE, absoluteChange: null, percentageChange: null };
  }
  if (Math.abs(pct) < 0.0001) {
    return { direction: "flat", text: "beze změny", absoluteChange: null, percentageChange: 0 };
  }
  const direction = pct > 0 ? "up" : "down";
  const sign = pct > 0 ? "▲" : "▼";
  return {
    direction,
    text: `${sign} ${formatCzechNumber(Math.abs(pct), { minFractionDigits: 2, maxFractionDigits: 2 })} %`,
    absoluteChange: null,
    percentageChange: pct,
  };
}

/**
 * @param {{ value: number }|null|undefined} current
 * @param {{ value: number }|null|undefined} prev
 * @param {{ unit?: string, indicatorId?: string, kind?: ChangeKind }} [options]
 */
export function trendFromComparablePair(current, prev, options = {}) {
  if (!current || !prev) {
    return computeComparableChange(null, null, options);
  }
  return computeComparableChange(current.value, prev.value, options);
}
