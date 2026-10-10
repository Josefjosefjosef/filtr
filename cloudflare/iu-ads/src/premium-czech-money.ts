/** Parse admin-entered Kč amount (comma or dot decimals) to integer haléře. */
export function parseCzechMoneyToCents(raw: string): { ok: true; cents: number } | { ok: false; error: string } {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { ok: false, error: "empty" };
  const normalized = trimmed.replace(/\s/g, "").replace(/,/g, ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return { ok: false, error: "invalid_format" };
  const parts = normalized.split(".");
  const whole = parts[0] ?? "0";
  const frac = (parts[1] ?? "").padEnd(2, "0").slice(0, 2);
  const major = BigInt(whole);
  const minor = BigInt(frac || "0");
  const cents = major * 100n + minor;
  if (cents <= 0n) return { ok: false, error: "non_positive" };
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, error: "too_large" };
  return { ok: true, cents: Number(cents) };
}

export function validatePremiumStornoReason(raw: string): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (reason.length < 12) return { ok: false, error: "reason_too_short" };
  const letters = reason.replace(/[^A-Za-zÀ-ž]/g, "");
  if (letters.length < 8) return { ok: false, error: "reason_not_meaningful" };
  return { ok: true, reason: reason.slice(0, 2000) };
}

export type PremiumPaymentSettlementMode = "unpaid" | "paid" | "partial";

export function paymentSettlementLabelCs(mode: PremiumPaymentSettlementMode): string {
  if (mode === "paid") return "Uhrazeno";
  if (mode === "partial") return "Uhrazeno částečně";
  return "Neuhrazeno";
}
