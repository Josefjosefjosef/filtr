/**
 * Documented empty-field policy for LT CZE v11 POINTS import.
 *
 * SP08001 Table 4-22 marks INTERRUPTSROAD Optional=No.
 * LT CZE v11.0 technical documentation (§2.5, cert 2025-060-CZ) defines
 * Přerušení komunikace (INTERRUPTS) as an attribute that is *filled* with
 * successor/predecessor point codes when an interruption exists (Tab. 5).
 * Rows without an interruption leave the designation empty → semantic null /
 * not applicable (does not interrupt). This is a national coding convention
 * against the SP08001 Optional=No letter, proven by the certified POINTS.DAT.
 *
 * Topology flags INPOS/INNEG/OUTPOS/OUTNEG/PRESENTPOS/PRESENTNEG are separately
 * documented in LT CZE v11 Tab. 6 as binary values only: "0 = ne / 1 = ano".
 * Empty topology flags are NOT documented and must remain fail-closed.
 *
 * This module is NOT a broad mandatory bypass.
 */
export const LT_CZE_V11_TECH_DOC = Object.freeze({
  title: "Technická dokumentace — Lokalizační tabulky Česka",
  version: "11.0",
  certification: "2025-060-CZ",
  section: "2.5 Popis vybraných atributů",
  interruptsHeading: "Přerušení komunikace (INTERRUPTS)",
  interruptsTab: "Tab. 5",
  topologyTab: "Tab. 6",
});

/**
 * @param {string} tableCode
 * @param {string} fieldCode
 * @returns {{ allowed: boolean, semantics?: string, docReference?: string }}
 */
export function documentedEmptyFieldPolicy(tableCode, fieldCode) {
  const table = String(tableCode || "");
  const field = String(fieldCode || "");

  // Existing importer precedent (ROADS / RNLT path) — keep behaviour explicit here too.
  if (field === "PES_LEV") {
    return {
      allowed: true,
      semantics: "documented_but_unproven_mandatory_empty_null",
      docReference: "importer:PES_LEV_empty_special_case",
    };
  }

  if (table === "POINTS" && field === "INTERRUPTSROAD") {
    return {
      allowed: true,
      semantics: "not_applicable_no_interruption",
      docReference:
        "ltcze11_0_technicka_dokumentace.pdf:2.5/INTERRUPTS+Tab.5 (cert 2025-060-CZ)",
    };
  }

  return { allowed: false };
}

/**
 * True only for exact documented semantic-null empties.
 * Never a global allowEmptyMandatory.
 */
export function isDocumentedSemanticNullEmpty(tableCode, fieldCode) {
  return documentedEmptyFieldPolicy(tableCode, fieldCode).allowed === true;
}

/** Topology flags: LT CZE v11 Tab. 6 allows only 0|1 — empty is not documented. */
export const POINTS_TOPOLOGY_FLAG_CODES = Object.freeze([
  "INPOS",
  "INNEG",
  "OUTPOS",
  "OUTNEG",
  "PRESENTPOS",
  "PRESENTNEG",
]);

export function isPointsTopologyFlag(fieldCode) {
  return POINTS_TOPOLOGY_FLAG_CODES.includes(String(fieldCode || ""));
}
