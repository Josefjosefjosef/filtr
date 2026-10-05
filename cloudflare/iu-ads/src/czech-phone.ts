/** Basic phone validation for premium B2B orders (CZ/international formats). */

export function validatePremiumPhone(raw: string): { ok: true; phone: string } | { ok: false; reason: "phone_required" | "invalid_phone" } {
  const phone = String(raw || "").trim();
  if (!phone) return { ok: false, reason: "phone_required" };
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) return { ok: false, reason: "invalid_phone" };
  return { ok: true, phone };
}
