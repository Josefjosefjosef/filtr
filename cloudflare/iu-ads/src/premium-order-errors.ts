/** Map public premium order API error codes to Czech user-facing messages. */
export const PREMIUM_ORDER_ERROR_CS: Record<string, string> = {
  ico_required: "Zadejte prosím IČO.",
  invalid_ico_format: "IČO musí obsahovat 8 číslic.",
  invalid_ico_checksum: "Zadané IČO není platné. Zkontrolujte jej prosím.",
  missing_contact: "Vyplňte prosím kontaktní údaje.",
  missing_billing_address: "Vyplňte prosím fakturační adresu.",
  invalid_placement: "Neplatná reklamní pozice. Otevřete objednávku z tlačítka P1–P8 na InfoUzel.cz.",
  placement_mismatch: "Pozice neodpovídá kategorii.",
  invalid_target_url: "Cílová URL není platná (povoleno https://).",
  invalid_creative_mode: "Neplatný typ kreativy.",
  invalid_terms_version: "Obchodní podmínky se změnily. Obnovte stránku a zkuste znovu.",
  invalid_terms_effective_at: "Obchodní podmínky se změnily. Obnovte stránku a zkuste znovu.",
  b2b_required: "Služba je určena výhradně podnikatelům.",
  invalid_body: "Neplatná data formuláře.",
  not_configured: "Objednávkový systém dočasně nedostupný.",
  missing_file: "Vyberte soubor s kreativou.",
  placement_occupied: "Tato pozice je obsazená aktivní reklamou a nelze ji nyní objednat.",
  placement_unavailable: "Tato pozice není momentálně k dispozici k objednání.",
  placement_reserved: "Na této pozici již probíhá jiná objednávka k posouzení.",
  phone_required: "Zadejte prosím telefonní číslo.",
  invalid_phone: "Telefonní číslo není platné (min. 9 číslic).",
  ares_not_found: "Subjekt v registru nenalezen — vyplňte údaje ručně.",
  ares_unavailable: "Registr dočasně nedostupný — vyplňte údaje ručně.",
  rate_limited: "Příliš mnoho požadavků. Zkuste to prosím za chvíli.",
  file_too_large: "Soubor je příliš velký (max. 5 MB).",
  file_type_invalid: "Nepodporovaný formát souboru (povoleno PNG, JPG, WebP).",
  creative_appearance_unconfirmed: "Nejprve nahrajte obrázek a potvrďte jeho vzhled.",
  authorization_required: "Potvrďte prosím, že jste oprávněni objednat reklamu za uvedenou firmu nebo podnikatele.",
  ordering_person_required: "Vyplňte prosím jméno a příjmení objednávající osoby.",
  ordering_person_invalid: "Jméno a příjmení objednávající osoby není platné.",
};

export function premiumOrderErrorMessageCs(code: string | undefined | null): string {
  if (!code) return "Odeslání se nezdařilo. Zkontrolujte údaje nebo to zkuste později.";
  return PREMIUM_ORDER_ERROR_CS[code] || "Odeslání se nezdařilo. Zkontrolujte údaje nebo to zkuste později.";
}
