/**
 * infoUzel.cz — právní generátor: sdílený model stran a textové formátování (bez :has(), bez serveru).
 */

export const IU_LEGAL_MODULE_DISCLAIMER =
  "Tento nástroj tvoří standardizované textové vzory pro vlastní použití. Nejedná se o individuální právní službu ani advokacii. V sporu, u vyšší hodnoty nebo nestandardní situace doporučujeme text konzultovat s advokátem.";

export const IU_LEGAL_HIGH_RISK_NOTE =
  "U tohoto typu dokumentu bývá právní dopad zvlášť citlivý. Před použitím zvažte odbornou kontrolu.";

export const IU_LEGAL_CATEGORIES = [
  { id: "smlouvy", label: "SMLOUVY" },
  { id: "plne_moci", label: "PLNÉ MOCI" },
  { id: "predavaci", label: "PŘEDÁVACÍ A POTVRZOVACÍ DOKUMENTY" },
  { id: "podani", label: "PODÁNÍ A OZNÁMENÍ" },
  { id: "cestni", label: "ČESTNÁ PROHLÁŠENÍ A OSTATNÍ" },
];

export function createEmptyParty() {
  return {
    type: "fo",
    firstName: "",
    lastName: "",
    birthDate: "",
    address: "",
    tradeName: "",
    ico: "",
    dic: "",
    placeOfBusiness: "",
    deliveryAddress: "",
    registryNote: "",
    companyName: "",
    legalForm: "",
    registeredOffice: "",
    actingPerson: "",
    actingRole: "",
    zapsanoV: "",
    oddil: "",
    vlozka: "",
    registryConsolidated: "",
  };
}

function line(label, value) {
  const v = String(value || "").trim();
  if (!v) return "";
  return `${label}: ${v}`;
}

/** @param {Record<string, string>} party @param {string} heading */
export function formatPartyHumanReadable(party, heading) {
  const h = String(heading || "Subjekt").trim() || "Subjekt";
  if (!party) return `${h}\n(neuvedeno)`;
  const out = [h];
  const t = party.type;
  if (t === "fo") {
    out.push("Typ: fyzická osoba");
    const l1 = line("Jméno", party.firstName);
    const l2 = line("Příjmení", party.lastName);
    const l3 = line("Datum narození", party.birthDate);
    const l4 = line("Trvalé bydliště / adresa", party.address);
    [l1, l2, l3, l4].forEach((x) => {
      if (x) out.push(x);
    });
  } else if (t === "zivnost") {
    out.push("Typ: podnikající fyzická osoba");
    const rows = [
      line("Jméno", party.firstName),
      line("Příjmení", party.lastName),
      line("Obchodní firma (pokud používá)", party.tradeName),
      line("IČO", party.ico),
      line("DIČ", party.dic),
      line("Místo podnikání / sídlo", party.placeOfBusiness),
      line("Adresa pro doručování", party.deliveryAddress),
      line("Údaj o zápisu / evidenci", party.registryNote),
    ];
    rows.forEach((x) => {
      if (x) out.push(x);
    });
  } else if (t === "po") {
    out.push("Typ: právnická osoba");
    const rows = [
      line("Obchodní firma / název", party.companyName),
      line("Právní forma", party.legalForm),
      line("IČO", party.ico),
      line("DIČ", party.dic),
      line("Sídlo", party.registeredOffice),
      line("Zapsána v / zapsán v", party.zapsanoV),
      line("Oddíl", party.oddil),
      line("Vložka", party.vlozka),
      line("Spisová značka / rejstříkový údaj (souhrn)", party.registryConsolidated),
      line("Osoba jednající", party.actingPerson),
      line("Funkce", party.actingRole),
    ];
    rows.forEach((x) => {
      if (x) out.push(x);
    });
  } else {
    out.push("(neznámý typ subjektu)");
  }
  return out.join("\n");
}

export function formatClosing(state) {
  const place = String((state && state.extra && state.extra.misto) || "").trim();
  const date = String((state && state.extra && state.extra.datum) || "").trim();
  const lines = ["Místo a datum"];
  if (place || date) {
    lines.push([place, date].filter(Boolean).join(", "));
  } else {
    lines.push("………………, dne ………………");
  }
  lines.push("");
  lines.push("Podpisy");
  lines.push("______________________________          ______________________________");
  return lines.join("\n");
}

export function joinSections(parts) {
  return parts
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .join("\n\n");
}
