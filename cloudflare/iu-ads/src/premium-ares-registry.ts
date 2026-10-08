/**
 * Commercial / public registry lines from ARES `dalsiUdaje` (server-side only).
 */

export type CustomerRegistrySnapshot = {
  registry_kind: "commercial_register" | "other_register" | "none";
  registry_name_cs: string | null;
  court_name_cs: string | null;
  section: string | null;
  insert: string | null;
  file_mark: string | null;
  display_line_cs: string | null;
  verified_source: "ares" | "manual" | null;
  verified_at: string | null;
  user_confirmed: boolean;
};

/** Common OR court codes in spisová značka (suffix after /). */
const OR_COURT_CODE_TO_CS: Record<string, string> = {
  MSPH: "Městským soudem v Praze",
  KSBR: "Krajským soudem v Brně",
  KSOS: "Krajským soudem v Ostravě",
  KSPL: "Krajským soudem v Plzni",
  KSHK: "Krajským soudem v Hradci Králové",
  KSUL: "Krajským soudem v Ústí nad Labem",
  KSCB: "Krajským soudem v Českých Budějovicích",
};

export function parseOrSpisovaZnacka(raw: string): {
  section: string | null;
  insert: string | null;
  courtCode: string | null;
} | null {
  const s = String(raw || "").trim();
  const m = /^([A-Za-z])\s*(\d+)\s*\/\s*([A-Za-z0-9]+)$/.exec(s);
  if (!m) return null;
  return { section: m[1].toUpperCase(), insert: m[2], courtCode: m[3].toUpperCase() };
}

export function courtNameFromOrCode(code: string | null): string | null {
  if (!code) return null;
  return OR_COURT_CODE_TO_CS[code.toUpperCase()] || null;
}

export function formatCommercialRegisterDisplayLine(input: {
  courtNameCs: string;
  section: string;
  insert: string;
}): string {
  return (
    "Společnost zapsaná v obchodním rejstříku vedeném " +
    input.courtNameCs +
    ", oddíl " +
    input.section +
    ", vložka " +
    input.insert +
    "."
  );
}

type AresDalsiUdaj = {
  datovyZdroj?: string;
  spisovaZnacka?: string;
};

type AresRegistryBody = {
  dalsiUdaje?: AresDalsiUdaj[];
};

/** Extract verified OR line from full ARES REST subject JSON. */
export function extractCustomerRegistryFromAresBody(body: AresRegistryBody, verifiedAtIso: string): CustomerRegistrySnapshot {
  const empty: CustomerRegistrySnapshot = {
    registry_kind: "none",
    registry_name_cs: null,
    court_name_cs: null,
    section: null,
    insert: null,
    file_mark: null,
    display_line_cs: null,
    verified_source: null,
    verified_at: null,
    user_confirmed: false,
  };
  const list = Array.isArray(body.dalsiUdaje) ? body.dalsiUdaje : [];
  const vr = list.find((u) => u && u.datovyZdroj === "vr" && u.spisovaZnacka);
  if (!vr || !vr.spisovaZnacka) return empty;
  const parsed = parseOrSpisovaZnacka(String(vr.spisovaZnacka));
  if (!parsed || !parsed.section || !parsed.insert) return empty;
  const court = courtNameFromOrCode(parsed.courtCode);
  if (!court) {
    return {
      ...empty,
      registry_kind: "commercial_register",
      registry_name_cs: "obchodní rejstřík",
      file_mark: String(vr.spisovaZnacka).trim(),
      verified_source: "ares",
      verified_at: verifiedAtIso,
    };
  }
  const display = formatCommercialRegisterDisplayLine({
    courtNameCs: court,
    section: parsed.section,
    insert: parsed.insert,
  });
  return {
    registry_kind: "commercial_register",
    registry_name_cs: "obchodní rejstřík",
    court_name_cs: court,
    section: parsed.section,
    insert: parsed.insert,
    file_mark: String(vr.spisovaZnacka).trim(),
    display_line_cs: display,
    verified_source: "ares",
    verified_at: verifiedAtIso,
    user_confirmed: false,
  };
}

export function isEmptyRegistrySnapshot(r: CustomerRegistrySnapshot | null | undefined): boolean {
  if (!r) return true;
  return r.registry_kind === "none" || !r.display_line_cs;
}
