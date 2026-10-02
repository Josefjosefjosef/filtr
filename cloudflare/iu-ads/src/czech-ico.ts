/** Czech IČO (8 digits) — normalize + weighted checksum validation. */

export function normalizeCzechIco(raw: string): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits.length || digits.length > 8) return null;
  return digits.padStart(8, "0");
}

export function validateCzechIco(raw: string): { ok: true; ico: string } | { ok: false; reason: "invalid_ico_format" | "invalid_ico_checksum" } {
  const ico = normalizeCzechIco(raw);
  if (!ico || !/^\d{8}$/.test(ico)) return { ok: false, reason: "invalid_ico_format" };
  const weights = [8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(ico[i]) * weights[i];
  let check = (11 - (sum % 11)) % 10;
  if (check === 10) check = 0;
  if (check !== Number(ico[7])) return { ok: false, reason: "invalid_ico_checksum" };
  return { ok: true, ico };
}
