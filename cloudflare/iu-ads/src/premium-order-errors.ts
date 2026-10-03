/** Map public premium order API error codes to Czech user-facing messages. */
export const PREMIUM_ORDER_ERROR_CS: Record<string, string> = {
  ico_required: "Zadejte prosím IČO.",
  invalid_ico_format: "IČO musí obsahovat 8 číslic.",
  invalid_ico_checksum: "Zadané IČO není platné. Zkontrolujte jej prosím.",
  missing_contact: "Vyplňte prosím kontaktní údaje.",
  missing_billing_address: "Vyplňte prosím fakturační adresu.",
  invalid_placement: "Neplatná reklamní pozice. Otevřete objednávku z tlačítka P1–P4 na InfoUzel.cz.",
  placement_mismatch: "Pozice neodpovídá kategorii.",
  invalid_target_url: "Cílová URL není platná (povoleno https://).",
  invalid_creative_mode: "Neplatný typ kreativy.",
  invalid_terms_version: "Obchodní podmínky se změnily. Obnovte stránku a zkuste znovu.",
  invalid_terms_effective_at: "Obchodní podmínky se změnily. Obnovte stránku a zkuste znovu.",
  b2b_required: "Služba je určena výhradně podnikatelům.",
  invalid_body: "Neplatná data formuláře.",
  not_configured: "Objednávkový systém dočasně nedostupný.",
  missing_file: "Vyberte soubor s kreativou.",
};

export function premiumOrderErrorMessageCs(code: string | undefined | null): string {
  if (!code) return "Odeslání se nezdařilo. Zkontrolujte údaje nebo to zkuste později.";
  return PREMIUM_ORDER_ERROR_CS[code] || "Odeslání se nezdařilo. Zkontrolujte údaje nebo to zkuste později.";
}
