/**
 * V49 — exact price normalization + change classification.
 * Format-only differences are NOT economic price changes.
 * Uses integer minor units (no float equality).
 */

export const PRICE_CHANGE_CLASS = Object.freeze({
  PRICE_CHANGED: "PRICE_CHANGED",
  PRICE_UNCHANGED: "PRICE_UNCHANGED",
  FORMAT_ONLY: "FORMAT_ONLY",
  CURRENCY_CHANGED: "CURRENCY_CHANGED",
  PRICE_UNKNOWN: "PRICE_UNKNOWN",
  PRICE_INVALID: "PRICE_INVALID",
  PRICE_UNAVAILABLE: "PRICE_UNAVAILABLE",
});

/** ISO 4217 minor-unit exponents (fallback 2). */
const CURRENCY_EXPONENT = Object.freeze({
  CZK: 2,
  EUR: 2,
  USD: 2,
  GBP: 2,
  PLN: 2,
  RON: 2,
  HUF: 2,
  CHF: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  JPY: 0,
  KRW: 0,
});

export function currencyExponent(currency) {
  const c = String(currency || "").trim().toUpperCase();
  // Missing currency → provisional ISO default (2). Invalid codes stay null.
  if (!c) return 2;
  if (!/^[A-Z]{3}$/.test(c)) return null;
  return CURRENCY_EXPONENT[c] != null ? CURRENCY_EXPONENT[c] : 2;
}

/**
 * Parse a price amount into integer minor units.
 * Ambiguous thousand/decimal separators → invalid (never guess).
 */
export function normalizePriceAmount(raw, currency) {
  if (raw == null || raw === "") {
    return {
      ok: false,
      classification: PRICE_CHANGE_CLASS.PRICE_UNAVAILABLE,
      minorUnits: null,
      decimalString: null,
      exponent: currencyExponent(currency),
      raw,
    };
  }
  const exp = currencyExponent(currency);
  if (exp == null) {
    return {
      ok: false,
      classification: PRICE_CHANGE_CLASS.PRICE_INVALID,
      minorUnits: null,
      decimalString: null,
      exponent: null,
      raw,
      reason: "invalid_currency",
    };
  }

  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) {
      return {
        ok: false,
        classification: PRICE_CHANGE_CLASS.PRICE_INVALID,
        minorUnits: null,
        decimalString: null,
        exponent: exp,
        raw,
        reason: "non_finite_number",
      };
    }
    if (raw < 0) {
      return {
        ok: false,
        classification: PRICE_CHANGE_CLASS.PRICE_INVALID,
        minorUnits: null,
        decimalString: null,
        exponent: exp,
        raw,
        reason: "negative",
      };
    }
    return finalizeFromNumber(raw, exp, raw);
  }

  const s0 = String(raw).trim();
  if (!s0) {
    return {
      ok: false,
      classification: PRICE_CHANGE_CLASS.PRICE_UNAVAILABLE,
      minorUnits: null,
      decimalString: null,
      exponent: exp,
      raw,
    };
  }

  // Strip currency symbols / letters; keep digits, separators, minus.
  let s = s0.replace(/[^\d.,\s-]/g, "").trim();
  s = s.replace(/\s+/g, " ");
  if (!s || s === "-" || s === "." || s === ",") {
    return {
      ok: false,
      classification: PRICE_CHANGE_CLASS.PRICE_INVALID,
      minorUnits: null,
      decimalString: null,
      exponent: exp,
      raw,
      reason: "empty_after_strip",
    };
  }
  if (s.startsWith("-")) {
    return {
      ok: false,
      classification: PRICE_CHANGE_CLASS.PRICE_INVALID,
      minorUnits: null,
      decimalString: null,
      exponent: exp,
      raw,
      reason: "negative",
    };
  }

  const parsed = parseDecimalStringStrict(s);
  if (!parsed.ok) {
    return {
      ok: false,
      classification:
        parsed.reason === "ambiguous"
          ? PRICE_CHANGE_CLASS.PRICE_UNKNOWN
          : PRICE_CHANGE_CLASS.PRICE_INVALID,
      minorUnits: null,
      decimalString: null,
      exponent: exp,
      raw,
      reason: parsed.reason,
    };
  }

  const n = Number(parsed.normalized);
  if (!Number.isFinite(n) || n < 0) {
    return {
      ok: false,
      classification: PRICE_CHANGE_CLASS.PRICE_INVALID,
      minorUnits: null,
      decimalString: null,
      exponent: exp,
      raw,
      reason: "parse_number_failed",
    };
  }
  return finalizeFromNumber(n, exp, raw, parsed.normalized);
}

function finalizeFromNumber(n, exp, raw, decimalString) {
  // Convert to minor units via string scale to avoid float drift.
  const scaled = scaleToMinorUnits(n, exp);
  if (!scaled.ok) {
    return {
      ok: false,
      classification: PRICE_CHANGE_CLASS.PRICE_INVALID,
      minorUnits: null,
      decimalString: null,
      exponent: exp,
      raw,
      reason: scaled.reason,
    };
  }
  return {
    ok: true,
    classification: PRICE_CHANGE_CLASS.PRICE_UNCHANGED,
    minorUnits: scaled.minorUnits,
    decimalString: decimalString != null ? decimalString : minorUnitsToDecimalString(scaled.minorUnits, exp),
    exponent: exp,
    raw,
  };
}

function scaleToMinorUnits(n, exp) {
  // Use toFixed then strip — deterministic for money amounts within safe range.
  if (!Number.isFinite(n) || n > 1e15) {
    return { ok: false, reason: "out_of_range" };
  }
  const fixed = n.toFixed(exp + 4); // extra precision then round
  const [intPart, fracPart = ""] = fixed.split(".");
  const digits = (intPart.replace(/^-/, "") + fracPart).replace(/^0+(?=\d)/, "") || "0";
  // Round at exp using integer math on (exp+4) scale.
  const full = intPart.replace(/^-/, "") + fracPart.padEnd(exp + 4, "0").slice(0, exp + 4);
  const asBig = BigInt(full || "0");
  const div = 10000n;
  const half = 5000n;
  const rounded = (asBig + half) / div;
  return { ok: true, minorUnits: Number(rounded) };
}

function minorUnitsToDecimalString(minorUnits, exp) {
  if (exp === 0) return String(minorUnits);
  const s = String(Math.trunc(minorUnits));
  const neg = s.startsWith("-");
  const digits = neg ? s.slice(1) : s;
  const padded = digits.padStart(exp + 1, "0");
  const whole = padded.slice(0, -exp);
  const frac = padded.slice(-exp);
  return (neg ? "-" : "") + whole + "." + frac;
}

/**
 * Strict decimal parse for common EU / US money strings.
 * Ambiguous patterns return ok:false reason ambiguous.
 */
export function parseDecimalStringStrict(input) {
  const s = String(input).trim().replace(/\s/g, "");
  if (!s) return { ok: false, reason: "empty" };
  if (!/^[\d.,]+$/.test(s)) return { ok: false, reason: "bad_chars" };

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");

  if (!hasDot && !hasComma) {
    if (!/^\d+$/.test(s)) return { ok: false, reason: "bad_int" };
    return { ok: true, normalized: s };
  }

  if (hasDot && hasComma) {
    // US: 1,299.00  or EU: 1.299,00 — last separator is decimal.
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastDot > lastComma) {
      // 1,299.00
      if (!/^\d{1,3}(,\d{3})*(\.\d+)?$/.test(s)) return { ok: false, reason: "ambiguous" };
      return { ok: true, normalized: s.replace(/,/g, "") };
    }
    // 1.299,00
    if (!/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(s)) return { ok: false, reason: "ambiguous" };
    return { ok: true, normalized: s.replace(/\./g, "").replace(",", ".") };
  }

  if (hasComma && !hasDot) {
    // 1299,00 or 1 299,00 (spaces already stripped) or 1,299 ambiguous
    const parts = s.split(",");
    if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d{1,4}$/.test(parts[1])) {
      // decimal comma when fractional length is 1–4 (money)
      if (parts[1].length <= 2 || parts[1].length === 3) {
        // 1299,00 or 1299,000 — treat as decimal if frac len 1-2; len 3 could be thousands
        if (parts[1].length <= 2) {
          return { ok: true, normalized: parts[0] + "." + parts[1] };
        }
        // 1,299 as thousands — only if left side length <=3
        if (parts[0].length <= 3 && parts[1].length === 3) {
          return { ok: true, normalized: parts[0] + parts[1] };
        }
        return { ok: false, reason: "ambiguous" };
      }
    }
    if (parts.length > 2) return { ok: false, reason: "ambiguous" };
    return { ok: false, reason: "ambiguous" };
  }

  // only dot
  const parts = s.split(".");
  if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
    if (parts[1].length <= 2) {
      // 4490.00 or 1299.5
      return { ok: true, normalized: s };
    }
    if (parts[0].length <= 3 && parts[1].length === 3) {
      // 1.299 thousands (EU) — ambiguous vs 1.299 decimal with 3 places
      // Prefer UNKNOWN rather than inventing.
      return { ok: false, reason: "ambiguous" };
    }
    return { ok: false, reason: "ambiguous" };
  }
  if (parts.length > 2) {
    // 1.299.000 EU thousands
    if (parts.every((p) => /^\d{1,3}$/.test(p))) {
      return { ok: true, normalized: parts.join("") };
    }
    return { ok: false, reason: "ambiguous" };
  }
  return { ok: false, reason: "ambiguous" };
}

/**
 * Classify transition between two price observations.
 */
export function classifyPriceTransition(prevRaw, nextRaw, prevCurrency, nextCurrency) {
  const prevC = prevCurrency != null ? String(prevCurrency).trim().toUpperCase() : "";
  const nextC = nextCurrency != null ? String(nextCurrency).trim().toUpperCase() : prevC;

  if ((prevRaw == null || prevRaw === "") && (nextRaw == null || nextRaw === "")) {
    return {
      class: PRICE_CHANGE_CLASS.PRICE_UNAVAILABLE,
      economicChange: false,
      prev: null,
      next: null,
    };
  }
  if (prevRaw == null || prevRaw === "") {
    const next = normalizePriceAmount(nextRaw, nextC || "CZK");
    return {
      class: PRICE_CHANGE_CLASS.PRICE_UNKNOWN,
      economicChange: false,
      transition: "UNKNOWN_TO_VALUE",
      prev: null,
      next,
    };
  }
  if (nextRaw == null || nextRaw === "") {
    const prev = normalizePriceAmount(prevRaw, prevC || nextC || "CZK");
    return {
      class: PRICE_CHANGE_CLASS.PRICE_UNKNOWN,
      economicChange: false,
      transition: "VALUE_TO_UNKNOWN",
      prev,
      next: null,
    };
  }

  if (prevC && nextC && prevC !== nextC) {
    return {
      class: PRICE_CHANGE_CLASS.CURRENCY_CHANGED,
      economicChange: false,
      prev: normalizePriceAmount(prevRaw, prevC),
      next: normalizePriceAmount(nextRaw, nextC),
      previousCurrency: prevC,
      currentCurrency: nextC,
    };
  }

  const currency = nextC || prevC;
  const prev = normalizePriceAmount(prevRaw, currency);
  const next = normalizePriceAmount(nextRaw, currency);
  if (!prev.ok || !next.ok) {
    return {
      class:
        !prev.ok && prev.classification === PRICE_CHANGE_CLASS.PRICE_UNKNOWN
          ? PRICE_CHANGE_CLASS.PRICE_UNKNOWN
          : !next.ok && next.classification === PRICE_CHANGE_CLASS.PRICE_UNKNOWN
            ? PRICE_CHANGE_CLASS.PRICE_UNKNOWN
            : PRICE_CHANGE_CLASS.PRICE_INVALID,
      economicChange: false,
      prev,
      next,
    };
  }

  if (prev.minorUnits === next.minorUnits) {
    const rawDiff = String(prevRaw) !== String(nextRaw);
    return {
      class: rawDiff ? PRICE_CHANGE_CLASS.FORMAT_ONLY : PRICE_CHANGE_CLASS.PRICE_UNCHANGED,
      economicChange: false,
      prev,
      next,
    };
  }

  return {
    class: PRICE_CHANGE_CLASS.PRICE_CHANGED,
    economicChange: true,
    prev,
    next,
  };
}

/**
 * Reclassify historical ledger rows (V48 PRICE_DELTA etc.) without inventing raw.
 */
export function reclassifyPriceChangeEvents(events) {
  const out = {
    total: 0,
    priceChanged: [],
    formatOnly: [],
    currencyChanged: [],
    unknown: [],
    invalid: [],
    unavailable: [],
    unchanged: [],
    insufficientEvidence: [],
  };
  for (const ev of Array.isArray(events) ? events : []) {
    out.total += 1;
    if (ev == null || (ev.previousPrice == null && ev.newPrice == null && ev.currentPrice == null)) {
      out.insufficientEvidence.push({ ...ev, reclass: "INSUFFICIENT_EVIDENCE" });
      continue;
    }
    const prev = ev.previousPrice;
    const next = ev.newPrice != null ? ev.newPrice : ev.currentPrice;
    const currency = ev.currency || null;
    const classified = classifyPriceTransition(prev, next, currency, currency);
    const row = {
      ...ev,
      changeClassification: classified.class,
      previousNormalizedPrice: classified.prev?.decimalString ?? null,
      currentNormalizedPrice: classified.next?.decimalString ?? null,
      previousMinorUnits: classified.prev?.minorUnits ?? null,
      currentMinorUnits: classified.next?.minorUnits ?? null,
      economicChange: classified.economicChange === true,
      reclassifiedFrom: ev.changeClassification || null,
    };
    if (classified.class === PRICE_CHANGE_CLASS.PRICE_CHANGED) out.priceChanged.push(row);
    else if (classified.class === PRICE_CHANGE_CLASS.FORMAT_ONLY) out.formatOnly.push(row);
    else if (classified.class === PRICE_CHANGE_CLASS.CURRENCY_CHANGED) out.currencyChanged.push(row);
    else if (classified.class === PRICE_CHANGE_CLASS.PRICE_UNKNOWN) out.unknown.push(row);
    else if (classified.class === PRICE_CHANGE_CLASS.PRICE_INVALID) out.invalid.push(row);
    else if (classified.class === PRICE_CHANGE_CLASS.PRICE_UNAVAILABLE) out.unavailable.push(row);
    else out.unchanged.push(row);
  }
  out.counts = {
    total: out.total,
    priceChanged: out.priceChanged.length,
    formatOnly: out.formatOnly.length,
    currencyChanged: out.currencyChanged.length,
    unknown: out.unknown.length,
    invalid: out.invalid.length,
    unavailable: out.unavailable.length,
    unchanged: out.unchanged.length,
    insufficientEvidence: out.insufficientEvidence.length,
  };
  return out;
}
