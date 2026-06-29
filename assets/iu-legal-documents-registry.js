/**
 * infoUzel.cz — registr dokumentů pro generátor (metadata + buildText).
 */
import {
  createEmptyParty,
  formatClosing,
  formatLabeledFieldBlock,
  formatPartyHumanReadable,
  joinSections,
} from "./iu-legal-documents-schema.js";

/** @typedef {{ key: string, label: string, multiline?: boolean }} LegalContentField */

/**
 * @typedef {ReturnType<typeof createEmptyParty>} LegalPartyState
 * @typedef {{
 *   id: string,
 *   title: string,
 *   category: string,
 *   shortDescription: string,
 *   complexity: 'basic'|'standard'|'advanced',
 *   legalRiskLevel: 'low'|'medium'|'high',
 *   supportsNaturalPerson: boolean,
 *   supportsEntrepreneur: boolean,
 *   supportsLegalEntity: boolean,
 *   supportsHandoverSection: boolean,
 *   requiresSpecialWarning: boolean,
 *   outputTemplate: string,
 *   tags: string[],
 *   partyMode: 'two'|'power'|'one',
 *   partyLabels: { a: string, b?: string },
 *   contentFields: LegalContentField[],
 *   extraFields: LegalContentField[],
 *   fieldsSchema: string,
 *   buildText: (state: LegalFormState) => string,
 * }} LegalDocumentDef
 */

/** @typedef {{ partyA: LegalPartyState, partyB: LegalPartyState, content: Record<string,string>, extra: Record<string,string> }} LegalFormState */

function g(state, key) {
  return String((state.content && state.content[key]) || "").trim();
}

function partiesTwo(doc, state, n1) {
  const la = doc.partyLabels.a;
  const lb = doc.partyLabels.b || "Strana B";
  return joinSections([
    `${n1}. Identifikace stran`,
    formatPartyHumanReadable(state.partyA, la),
    formatPartyHumanReadable(state.partyB, lb),
  ]);
}

function partiesOne(doc, state, n1) {
  const la = doc.partyLabels.a;
  return joinSections([
    `${n1}. Identifikace strany`,
    formatPartyHumanReadable(state.partyA, la),
  ]);
}

function lf(label, value, opts) {
  return formatLabeledFieldBlock(label, value, opts);
}
function isPlaceholderDots(value) {
  const t = String(value || "").trim();
  if (!t) return true;
  return /^[·…\.\s_\-]+$/.test(t);
}

function sectionBlock(num, title, inner) {
  const content = String(inner || "").trim();
  if (!content) return "";
  return joinSections([`${num}. ${title}`, content]);
}

function sectionField(num, sectionTitle, fieldLabel, value, opts) {
  const block = lf(fieldLabel, value, { optional: true, ...(opts || {}) });
  if (!block) return "";
  return sectionBlock(num, sectionTitle, block);
}

function sectionText(num, title, text) {
  const t = String(text || "").trim();
  if (!t || isPlaceholderDots(t)) return "";
  return sectionBlock(num, title, t);
}

function sectionTextOrDefault(num, title, text, defaultText) {
  const t = String(text || "").trim();
  const content = t && !isPlaceholderDots(t) ? t : String(defaultText || "").trim();
  if (!content) return "";
  return sectionBlock(num, title, content);
}


function appendixBlock(state) {
  const parts = [
    lf("Přílohy", g(state, "prilohy"), { optional: true }),
    lf("Předávací seznam / soupis", g(state, "predavaci_seznam"), { optional: true }),
    lf("Stav věci, vady, příslušenství", g(state, "stav_veci"), { optional: true }),
  ].filter(Boolean);
  if (!parts.length) return "";
  return joinSections(parts);
}

/** @param {Partial<LegalDocumentDef> & { id: string, title: string, category: string, shortDescription: string, buildText: LegalDocumentDef['buildText'] }} raw */
function doc(raw) {
  const { contentFields = [], extraFields = [], ...rest } = raw;
  /** @type {LegalDocumentDef} */
  const o = {
    complexity: "standard",
    legalRiskLevel: "medium",
    supportsNaturalPerson: true,
    supportsEntrepreneur: true,
    supportsLegalEntity: true,
    supportsHandoverSection: false,
    requiresSpecialWarning: false,
    outputTemplate: "structured_cs_v1",
    tags: ["fo", "podnikatel", "firma"],
    partyMode: "two",
    partyLabels: { a: "Strana A", b: "Strana B" },
    fieldsSchema: "iu-legal-v1",
    contentFields,
    extraFields,
    ...rest,
  };
  return o;
}

export const IU_LEGAL_DOCUMENTS = [
  doc({
    id: "kupni-movita",
    title: "Kupní smlouva – movitá věc",
    category: "smlouvy",
    shortDescription: "Převod movité věci mezi prodávajícím a kupujícím s jednoduchou konstrukcí ujednání.",
    supportsHandoverSection: true,
    partyLabels: { a: "Prodávající", b: "Kupující" },
    contentFields: [
      { key: "predmet", label: "Předmět koupě (označení věci)", multiline: true },
      { key: "cena", label: "Kupní cena", multiline: false },
      { key: "vlastnictvi", label: "Převod vlastnictví a předání", multiline: true },
      { key: "prava", label: "Práva a povinnosti stran (volitelně)", multiline: true },
      { key: "prilohy", label: "Přílohy (volitelně)", multiline: true },
      { key: "predavaci_seznam", label: "Předávací seznam / soupis (volitelně)", multiline: true },
      { key: "stav_veci", label: "Stav věci, vady, příslušenství (volitelně)", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Předmět smlouvy", "Předmět koupě", g(state, "predmet")),
        sectionField("3", "Kupní cena", "Kupní cena", g(state, "cena"), { isPrice: true }),
        sectionTextOrDefault(
          "4",
          "Převod vlastnictví a předání",
          g(state, "vlastnictvi"),
          "Vlastnictví přechází na kupujícího okamžikem úplné úhrady kupní ceny, není-li dále ujednáno jinak. Předání věci proběhne způsobem mezi stranami dohodnutým.",
        ),
        g(state, "prava")
          ? joinSections(["5. Další ujednání", lf("Práva a povinnosti stran", g(state, "prava"), { optional: true })])
          : "",
        (function () {
          const appendix = appendixBlock(state);
          return appendix ? joinSections(["6. Přílohy a předání", appendix]) : "";
        })(),
        joinSections([
          "Závěrečná ujednání",
          "Strany prohlásily, že jim nejsou známy žádné skutečnosti, které by uzavření smlouvy bránily. Právní vztahy se řídí právním řádem České republiky.",
        ]),
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "kupni-vozidlo",
    title: "Kupní smlouva – motorové vozidlo",
    category: "smlouvy",
    shortDescription: "Základ převodu vozidla včetně identifikace a předání dokladů.",
    supportsHandoverSection: true,
    partyLabels: { a: "Prodávající", b: "Kupující" },
    contentFields: [
      { key: "vozidlo", label: "Vozidlo (VIN, typ, RZ, TP)", multiline: true },
      { key: "cena", label: "Kupní cena", multiline: false },
      { key: "stav_tachometr", label: "Stav km / stav vozidla", multiline: true },
      { key: "doklady", label: "Předávané doklady a klíče", multiline: true },
      { key: "prava", label: "Další ujednání", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Předmět koupě", "Předmět koupě", g(state, "vozidlo")),
        sectionField("3", "Kupní cena", "Kupní cena", g(state, "cena")),
        sectionField("4", "Stav a předání", "Stav a předání", g(state, "stav_tachometr")),
        sectionTextOrDefault("5", "Doklady", g(state, "doklady"), "Strany předají doklady potřebné k přepisu vozidla, není-li dále ujednáno jinak."),
        g(state, "prava") ? joinSections(["6. Další ujednání", g(state, "prava")]) : "",
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "kupni-nemovitost",
    title: "Kupní smlouva – nemovitost",
    category: "smlouvy",
    shortDescription: "Kostra kupní smlouvy k nemovité věci — u hodnotných případů typicky s advokátem a vkladem do katastru.",
    complexity: "advanced",
    legalRiskLevel: "high",
    requiresSpecialWarning: true,
    partyLabels: { a: "Prodávající", b: "Kupující" },
    contentFields: [
      { key: "nemovitost", label: "Označení nemovitosti (LV, parcelní čísla, část obce)", multiline: true },
      { key: "cena", label: "Kupní cena a způsob úhrady", multiline: true },
      { key: "prevod", label: "Převod vlastnictví / vklad (rámcově)", multiline: true },
      { key: "prava", label: "Další ujednání", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        "POZNÁMKA: U převodů nemovitostí bývá nutná forma stanovená zákonem a zápis v katastru nemovitostí. Tento text je pouze pracovní kostrou.",
        partiesTwo(this, state, "1"),
        sectionField("2", "Předmět koupě", "Předmět koupě", g(state, "nemovitost")),
        sectionField("3", "Kupní cena", "Kupní cena", g(state, "cena")),
        sectionTextOrDefault("4", "Převod vlastnictví", g(state, "prevod"), "Vlastnictví přechází v souladu se zákonem a po provedení vkladu do katastru nemovitostí, není-li dále ujednáno jinak."),
        g(state, "prava") ? joinSections(["5. Další ujednání", g(state, "prava")]) : "",
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "darovaci",
    title: "Darovací smlouva",
    category: "smlouvy",
    shortDescription: "Převod bez protiplnění — základní struktura s popisem daru.",
    partyLabels: { a: "Dárce", b: "Obdarovaný" },
    contentFields: [
      { key: "dar", label: "Předmět daru", multiline: true },
      { key: "predani", label: "Předání a převod", multiline: true },
      { key: "prava", label: "Další ujednání", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Předmět darování", "Předmět darování", g(state, "dar")),
        sectionTextOrDefault("3", "Předání", g(state, "predani"), "Dárce předmět daru předává a obdarovaný jej přijímá do svého vlastnictví."),
        g(state, "prava") ? joinSections(["4. Další ujednání", g(state, "prava")]) : "",
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "najem-byt",
    title: "Nájemní smlouva – byt / dům",
    category: "smlouvy",
    shortDescription: "Nájem obytného prostoru — předmět, nájemné, délka a základní práva.",
    partyLabels: { a: "Pronajímatel", b: "Nájemce" },
    contentFields: [
      { key: "predmet", label: "Předmět nájmu (adresa, část domu)", multiline: true },
      { key: "najemne", label: "Nájemné a zálohy", multiline: true },
      { key: "doba", label: "Doba nájmu", multiline: true },
      { key: "ucel", label: "Účel užívání", multiline: false },
      { key: "prava", label: "Práva a povinnosti (volitelně)", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Předmět nájmu", "Předmět nájmu", g(state, "predmet")),
        sectionField("3", "Nájemné", "Nájemné", g(state, "najemne")),
        sectionField("4", "Doba nájmu", "Doba nájmu", g(state, "doba")),
        sectionTextOrDefault("5", "Účel užívání", g(state, "ucel"), "Bydlení."),
        g(state, "prava") ? joinSections(["6. Další ujednání", g(state, "prava")]) : "",
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "najem-podnikani",
    title: "Nájemní smlouva – prostor sloužící podnikání",
    category: "smlouvy",
    shortDescription: "Nájem nebytového prostoru pro podnikání — základní ujednání.",
    partyLabels: { a: "Pronajímatel", b: "Nájemce" },
    contentFields: [
      { key: "predmet", label: "Předmět nájmu", multiline: true },
      { key: "najemne", label: "Nájemné a služby", multiline: true },
      { key: "doba", label: "Doba nájmu", multiline: true },
      { key: "ucel", label: "Účel (činnost)", multiline: true },
      { key: "prava", label: "Další ujednání", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Předmět nájmu", "Předmět nájmu", g(state, "predmet")),
        sectionField("3", "Nájemné", "Nájemné", g(state, "najemne")),
        sectionField("4", "Doba nájmu", "Doba nájmu", g(state, "doba")),
        sectionTextOrDefault("5", "Účel užívání", g(state, "ucel"), "Podnikání."),
        g(state, "prava") ? joinSections(["6. Další ujednání", g(state, "prava")]) : "",
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "dilo",
    title: "Smlouva o dílo",
    category: "smlouvy",
    shortDescription: "Zhotovení díla, cena a předání — obecný rámec.",
    partyLabels: { a: "Objednatel", b: "Zhotovitel" },
    contentFields: [
      { key: "dilo", label: "Popis díla", multiline: true },
      { key: "cena", label: "Cena a platební podmínky", multiline: true },
      { key: "lhuty", label: "Lhůty provedení / předání", multiline: true },
      { key: "prava", label: "Další ujednání", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Předmět díla", "Předmět díla", g(state, "dilo")),
        sectionField("3", "Cena", "Cena", g(state, "cena")),
        sectionField("4", "Lhůty", "Lhůty", g(state, "lhuty")),
        g(state, "prava") ? joinSections(["5. Další ujednání", g(state, "prava")]) : "",
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "zapujcka",
    title: "Smlouva o zápůjčce / půjčce",
    category: "smlouvy",
    shortDescription: "Rámec pro zapůjčení věci nebo peněžní půjčku — doplňte podstatné náležitosti.",
    legalRiskLevel: "high",
    requiresSpecialWarning: true,
    partyLabels: { a: "Věřitel / půjčitel", b: "Dlužník / vydlužitel" },
    contentFields: [
      { key: "predmet", label: "Předmět (částka / věc)", multiline: true },
      { key: "splatnost", label: "Splatnost a úroky (pokud ujednáno)", multiline: true },
      { key: "podminky", label: "Další podmínky", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        "UPOZORNĚNÍ: U peněžitých zápůjček a úroků mohou platit zvláštní pravidla. Ověřte aktuální právní rámec.",
        partiesTwo(this, state, "1"),
        sectionField("2", "Předmět", "Předmět", g(state, "predmet")),
        sectionField("3", "Splatnost a úrok", "Splatnost a úrok", g(state, "splatnost")),
        g(state, "podminky") ? joinSections(["4. Další ujednání", g(state, "podminky")]) : "",
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "narovnani",
    title: "Dohoda o narovnání",
    category: "smlouvy",
    shortDescription: "Ukončení nebo úprava sporu či nejasností dohodou stran.",
    partyLabels: { a: "První strana", b: "Druhá strana" },
    contentFields: [
      { key: "predmet_sporu", label: "Stručný popis předmětu", multiline: true },
      { key: "dohoda", label: "Obsah dohody / plnění", multiline: true },
      { key: "zaver", label: "Závěrečná ustanovení (např. zřeknutí nároků)", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Předmět", "Předmět", g(state, "predmet_sporu")),
        sectionField("3", "Ujednání stran", "Ujednání stran", g(state, "dohoda")),
        sectionTextOrDefault("4", "Závěr", g(state, "zaver"), "Strany tímto narovnávají vzájemné vztahy v rozsahu této dohody."),
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "dodatek",
    title: "Dodatek ke smlouvě",
    category: "smlouvy",
    shortDescription: "Změna nebo doplnění již uzavřené smlouvy.",
    partyLabels: { a: "První strana", b: "Druhá strana" },
    contentFields: [
      { key: "odkaz", label: "Odkaz na původní smlouvu (datum, číslo, předmět)", multiline: true },
      { key: "zmena", label: "Změna / doplnění ujednání", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Původní smlouva", "Původní smlouva", g(state, "odkaz")),
        sectionField("3", "Ujednání dodatku", "Ujednání dodatku", g(state, "zmena")),
        joinSections([
          "4. Závěr",
          "Ostatní ujednání původní smlouvy zůstávají nedotčena, pokud tento dodatek výslovně nemění jejich obsah.",
        ]),
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "plna-moc-obecna",
    title: "Obecná plná moc",
    category: "plne_moci",
    shortDescription: "Širší zmocnění k právním úkonům — používejte uvážlivě.",
    partyMode: "power",
    partyLabels: { a: "Zmocnitel", b: "Zmocněnec" },
    contentFields: [
      { key: "rozsah", label: "Rozsah zmocnění", multiline: true },
      { key: "ucel", label: "Účel", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Rozsah zmocnění", "Rozsah zmocnění", g(state, "rozsah")),
        sectionField("3", "Účel", "Účel", g(state, "ucel")),
        joinSections([
          "4. Závěr",
          "Zmocnitel zmocňuje zmocněnce k činění právních a jiných úkonů v rozsahu uvedeném výše. Zmocnění zůstává v platnosti do odvolání písemným prohlášením zmocnitele, není-li ujednáno jinak.",
        ]),
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "plna-moc-specialni",
    title: "Speciální plná moc",
    category: "plne_moci",
    shortDescription: "Zmocnění k přesně vymezeným úkonům.",
    partyMode: "power",
    partyLabels: { a: "Zmocnitel", b: "Zmocněnec" },
    contentFields: [
      { key: "rozsah", label: "Konkrétní úkony", multiline: true },
      { key: "ucel", label: "Účel", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Rozsah zmocnění", "Rozsah zmocnění", g(state, "rozsah")),
        sectionField("3", "Účel", "Účel", g(state, "ucel")),
        joinSections(["4. Závěr", "Tato plná moc je speciální a zmocněnec je oprávněn pouze k úkonům výslovně uvedeným."]),
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "plna-moc-vozidlo",
    title: "Plná moc k přepisu vozidla",
    category: "plne_moci",
    shortDescription: "Zmocnění k úkonům při převodu a přepisu motorového vozidla.",
    partyMode: "power",
    partyLabels: { a: "Zmocnitel", b: "Zmocněnec" },
    contentFields: [
      { key: "vozidlo", label: "Vozidlo (RZ, VIN)", multiline: false },
      { key: "rozsah", label: "Rozsah (např. podání žádosti, podpis dokumentů)", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Vozidlo", "Vozidlo", g(state, "vozidlo")),
        sectionTextOrDefault("3", "Rozsah zmocnění", g(state, "rozsah"), "Zmocněnec je oprávněn vyřídit úkony související s převodem a přepisem vozidla v příslušných registrech a na úřadech."),
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "plna-moc-urady",
    title: "Plná moc k zastupování před úřady",
    category: "plne_moci",
    shortDescription: "Zastupování ve správním řízení nebo na úřadě — doplňte konkrétní úřad a věc.",
    partyMode: "power",
    partyLabels: { a: "Zmocnitel", b: "Zmocněnec" },
    contentFields: [
      { key: "urad", label: "Úřad / agenda", multiline: true },
      { key: "rozsah", label: "Rozsah zmocnění", multiline: true },
      { key: "ucel", label: "Účel", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Úřad / agenda", "Úřad / agenda", g(state, "urad")),
        sectionField("3", "Rozsah zmocnění", "Rozsah zmocnění", g(state, "rozsah")),
        sectionField("4", "Účel", "Účel", g(state, "ucel")),
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "plna-moc-zasilka",
    title: "Plná moc k převzetí zásilky / dokumentu",
    category: "plne_moci",
    shortDescription: "Převzetí zásilky nebo listiny jménem zmocnitele.",
    partyMode: "power",
    partyLabels: { a: "Zmocnitel", b: "Zmocněnec" },
    contentFields: [
      { key: "predmet", label: "Zásilka / dokument (číslo, dopravce…)", multiline: true },
      { key: "rozsah", label: "Rozsah (převzetí, podpis stvrzenky…)", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Předmět", "Předmět", g(state, "predmet")),
        sectionTextOrDefault("3", "Rozsah", g(state, "rozsah"), "Zmocněnec je oprávněn převzít uvedenou zásilku nebo dokument a podepsat potřebná potvrzení."),
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "plna-moc-advokat",
    title: "Plná moc pro advokáta / zástupce",
    category: "plne_moci",
    shortDescription: "Zmocnění zástupce k právním úkonům — doplňte věc a rozsah.",
    partyMode: "power",
    partyLabels: { a: "Zmocnitel", b: "Zmocněnec (zástupce)" },
    contentFields: [
      { key: "vec", label: "Věc / řízení", multiline: true },
      { key: "rozsah", label: "Rozsah zmocnění", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Věc", "Věc", g(state, "vec")),
        sectionField("3", "Rozsah zmocnění", "Rozsah zmocnění", g(state, "rozsah")),
        joinSections([
          "4. Závěr",
          "Zmocnitel uděluje zmocněnci plnou moc k zastupování ve věci výše, včetně podávání návrhů, podpisů potřebných podání a přebírání písemností, není-li dále ujednáno jinak.",
        ]),
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "predani-obecny",
    title: "Předávací protokol – obecný",
    category: "predavaci",
    shortDescription: "Obecný předávací dokument movité věci nebo souboru položek.",
    supportsHandoverSection: true,
    partyLabels: { a: "Předávající", b: "Přejímající" },
    contentFields: [
      { key: "predmet", label: "Předmět předání", multiline: true },
      { key: "stav", label: "Stav při předání", multiline: true },
      { key: "vady", label: "Zjištěné vady / výhrady", multiline: true },
      { key: "prilohy", label: "Přílohy / seznam", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Předmět předání", "Předmět předání", g(state, "predmet")),
        sectionField("3", "Stav", "Stav", g(state, "stav")),
        g(state, "vady") ? joinSections(["4. Vady a výhrady", g(state, "vady")]) : "",
        g(state, "prilohy") ? joinSections(["5. Přílohy", g(state, "prilohy")]) : "",
        joinSections(["6. Potvrzení", "Přejímající převzetím stvrzuje, že předmět převzal v uvedeném stavu."]),
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "predani-byt",
    title: "Předávací protokol – byt / dům",
    category: "predavaci",
    shortDescription: "Předání bytu nebo domu — stav měřidel a základní soupis.",
    supportsHandoverSection: true,
    partyLabels: { a: "Předávající", b: "Přejímající" },
    contentFields: [
      { key: "nemovitost", label: "Byt / dům (adresa, číslo jednotky)", multiline: true },
      { key: "meridla", label: "Stav měřidel (elektřina, plyn, voda)", multiline: true },
      { key: "klice", label: "Klíče a přístupy", multiline: true },
      { key: "vady", label: "Vady a výhrady", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Předmět", "Předmět", g(state, "nemovitost")),
        sectionField("3", "Měřidla", "Měřidla", g(state, "meridla")),
        sectionField("4", "Klíče", "Klíče", g(state, "klice")),
        g(state, "vady") ? joinSections(["5. Vady", g(state, "vady")]) : "",
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "predani-nebyt",
    title: "Předávací protokol – nebytový prostor",
    category: "predavaci",
    shortDescription: "Předání prostoru sloužícího podnikání nebo jinému účelu.",
    supportsHandoverSection: true,
    partyLabels: { a: "Předávající", b: "Přejímající" },
    contentFields: [
      { key: "prostor", label: "Prostor (adresa, část budovy)", multiline: true },
      { key: "vybaveni", label: "Vybavení a příslušenství", multiline: true },
      { key: "meridla", label: "Měřidla / média", multiline: true },
      { key: "vady", label: "Vady a výhrady", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Předmět", "Předmět", g(state, "prostor")),
        sectionField("3", "Vybavení", "Vybavení", g(state, "vybaveni")),
        sectionField("4", "Měřidla", "Měřidla", g(state, "meridla")),
        g(state, "vady") ? joinSections(["5. Vady", g(state, "vady")]) : "",
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "predani-vozidlo",
    title: "Předávací protokol – vozidlo",
    category: "predavaci",
    shortDescription: "Stav vozidla, příslušenství a dokladů při předání.",
    supportsHandoverSection: true,
    partyLabels: { a: "Předávající", b: "Přejímající" },
    contentFields: [
      { key: "vozidlo", label: "Vozidlo (VIN, RZ, typ)", multiline: true },
      { key: "stav_km", label: "Stav tachometru", multiline: false },
      { key: "doklady", label: "Doklady a klíče", multiline: true },
      { key: "vady", label: "Vady a výhrady", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Vozidlo", "Vozidlo", g(state, "vozidlo")),
        sectionField("3", "Stav km", "Stav km", g(state, "stav_km")),
        sectionField("4", "Doklady", "Doklady", g(state, "doklady")),
        g(state, "vady") ? joinSections(["5. Vady", g(state, "vady")]) : "",
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "predani-vec",
    title: "Předávací protokol – věc / zařízení",
    category: "predavaci",
    shortDescription: "Technologie, zařízení nebo vybavení — stav a příslušenství.",
    supportsHandoverSection: true,
    partyLabels: { a: "Předávající", b: "Přejímající" },
    contentFields: [
      { key: "predmet", label: "Zařízení / věc", multiline: true },
      { key: "stav", label: "Stav a testování", multiline: true },
      { key: "prilohy", label: "Příslušenství, licence, hesla (pokud relevantní)", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Předmět", "Předmět", g(state, "predmet")),
        sectionField("3", "Stav", "Stav", g(state, "stav")),
        g(state, "prilohy") ? joinSections(["4. Příslušenství", g(state, "prilohy")]) : "",
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "potvrzeni-penize",
    title: "Potvrzení o převzetí peněz",
    category: "predavaci",
    shortDescription: "Stručné potvrzení předání hotovosti nebo platby.",
    partyLabels: { a: "Plátce / předávající", b: "Příjemce" },
    contentFields: [
      { key: "castka", label: "Částka a měna", multiline: false },
      { key: "duvod", label: "Důvod / právní důvod (volitelně)", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        g(state, "castka")
          ? joinSections(["2. Potvrzení", `Příjemce potvrzuje převzetí částky: ${g(state, "castka")}.`])
          : "",
        g(state, "duvod") ? joinSections(["3. Poznámka", g(state, "duvod")]) : "",
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "potvrzeni-dokumenty",
    title: "Potvrzení o předání dokumentů",
    category: "predavaci",
    shortDescription: "Seznam nebo popis předaných listin.",
    partyLabels: { a: "Předávající", b: "Přejímající" },
    contentFields: [
      { key: "dokumenty", label: "Předané dokumenty", multiline: true },
      { key: "ucel", label: "Účel předání", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Dokumenty", "Dokumenty", g(state, "dokumenty")),
        g(state, "ucel") ? joinSections(["3. Účel", g(state, "ucel")]) : "",
        joinSections(["4. Potvrzení", "Přejímající potvrzuje převzetí uvedených dokumentů."]),
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "vypoved-najmu",
    title: "Výpověď nájmu",
    category: "podani",
    shortDescription: "Jednostranné ukončení nájmu — typicky vyžaduje zákonné důvody a formu.",
    legalRiskLevel: "high",
    requiresSpecialWarning: true,
    partyLabels: { a: "Vypovídající", b: "Adresát" },
    contentFields: [
      { key: "predmet", label: "Nájem (adresa, smlouva)", multiline: true },
      { key: "duvod", label: "Důvod výpovědi", multiline: true },
      { key: "ucinek", label: "Datum účinnosti / výpovědní doba", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        "UPOZORNĚNÍ: Nájemní poměry podléhají zákonu. Ověřte oprávněnost výpovědi a doručení.",
        partiesTwo(this, state, "1"),
        sectionField("2", "Předmět", "Předmět", g(state, "predmet")),
        sectionField("3", "Výpověď", "Výpověď", g(state, "duvod")),
        sectionField("4", "Účinek", "Účinek", g(state, "ucinek")),
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "odstoupeni",
    title: "Odstoupení od smlouvy",
    category: "podani",
    shortDescription: "Jednostranné odstoupení podle smlouvy nebo zákona — doplňte titul.",
    legalRiskLevel: "high",
    requiresSpecialWarning: true,
    partyLabels: { a: "Odstupující", b: "Adresát" },
    contentFields: [
      { key: "smlouva", label: "Smlouva / vztah", multiline: true },
      { key: "duvod", label: "Právní důvod odstoupení", multiline: true },
      { key: "ucinek", label: "Požadované následky (vrácení plnění…)", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        "UPOZORNĚNÍ: Odstoupení od smlouvy musí splňovat zákonné nebo smluvní podmínky. Ověřte důvod, formu a doručení.",
        partiesTwo(this, state, "1"),
        sectionField("2", "Smlouva", "Smlouva", g(state, "smlouva")),
        sectionField("3", "Odstoupení", "Odstoupení", g(state, "duvod")),
        sectionField("4", "Účinky", "Účinky", g(state, "ucinek")),
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "reklamace",
    title: "Reklamace",
    category: "podani",
    shortDescription: "Uplatnění vadného plnění u dodavatele.",
    partyLabels: { a: "Reklamující", b: "Adresát (dodavatel)" },
    contentFields: [
      { key: "predmet", label: "Smlouva / objednávka", multiline: true },
      { key: "vada", label: "Popis vady", multiline: true },
      { key: "navrh", label: "Navrhované řešení", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Předmět", "Předmět", g(state, "predmet")),
        sectionField("3", "Reklamace", "Reklamace", g(state, "vada")),
        sectionField("4", "Návrh", "Návrh", g(state, "navrh")),
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "predzalobni-vyzva",
    title: "Předžalobní výzva",
    category: "podani",
    shortDescription: "Výzva k plnění před zahájením sporu — citlivý typ dokumentu.",
    legalRiskLevel: "high",
    requiresSpecialWarning: true,
    partyLabels: { a: "Věřitel / oprávněná osoba", b: "Adresát" },
    contentFields: [
      { key: "narok", label: "Popis nároku a skutkového stavu", multiline: true },
      { key: "plneni", label: "Požadované plnění", multiline: true },
      { key: "lhuta", label: "Lhůta k vyhovění", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        "UPOZORNĚNÍ: Předžalobní výzva může ovlivnit náklady sporu a promlčení. Ověřte obsah, lhůtu a doručení.",
        partiesTwo(this, state, "1"),
        sectionField("2", "Skutkový stav", "Skutkový stav", g(state, "narok")),
        sectionField("3", "Výzva", "Výzva", g(state, "plneni")),
        sectionField("4", "Lhůta", "Lhůta", g(state, "lhuta")),
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "zadost-odvolani",
    title: "Žádost / odvolání – obecný základ",
    category: "podani",
    shortDescription: "Obecný rámec podání bez nároku na konkrétní řízení.",
    complexity: "basic",
    legalRiskLevel: "low",
    partyLabels: { a: "Žadatel", b: "Adresát (úřad / subjekt)" },
    contentFields: [
      { key: "zadost", label: "Text žádosti / odvolání", multiline: true },
      { key: "prilohy", label: "Přílohy", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Podání", "Podání", g(state, "zadost")),
        g(state, "prilohy") ? joinSections(["3. Přílohy", g(state, "prilohy")]) : "",
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "vyzva-uhrade",
    title: "Výzva k úhradě",
    category: "podani",
    shortDescription: "Výzva k zaplacení dlužné částky.",
    legalRiskLevel: "medium",
    partyLabels: { a: "Věřitel", b: "Dlužník" },
    contentFields: [
      { key: "dluh", label: "Dluh (částka, faktura, splatnost)", multiline: true },
      { key: "lhuta", label: "Lhůta k úhradě", multiline: true },
      { key: "ucet", label: "Platební údaje", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Dluh", "Dluh", g(state, "dluh")),
        g(state, "lhuta")
          ? joinSections(["3. Výzva", `Vyzýváme Vás k úhradě ve lhůtě: ${g(state, "lhuta")}.`])
          : "",
        g(state, "ucet") ? joinSections(["4. Platební údaje", g(state, "ucet")]) : "",
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "cestne-prohlaseni",
    title: "Čestné prohlášení",
    category: "cestni",
    shortDescription: "Prohlášení o pravdivosti tvrzení podle potřeby.",
    complexity: "basic",
    legalRiskLevel: "medium",
    partyMode: "one",
    partyLabels: { a: "Prohlásivší" },
    contentFields: [
      { key: "text", label: "Text prohlášení", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesOne(this, state, "1"),
        sectionField("2", "Prohlášení", "Prohlášení", g(state, "text")),
        joinSections(["3. Závěr", "Prohlásivší prohlašuje na svou čest, že uvedené údaje jsou pravdivé."]),
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "souhlas-vlastnika",
    title: "Souhlas vlastníka nemovitosti",
    category: "cestni",
    shortDescription: "Souhlas s určitým úkonem nebo užíváním.",
    partyLabels: { a: "Vlastník", b: "Adresát / oprávněná osoba" },
    contentFields: [
      { key: "nemovitost", label: "Nemovitost", multiline: true },
      { key: "souhlas", label: "Rozsah souhlasu", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Nemovitost", "Nemovitost", g(state, "nemovitost")),
        sectionField("3", "Souhlas", "Souhlas", g(state, "souhlas")),
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "potvrzeni-druhe-strany",
    title: "Potvrzení / souhlas druhé strany",
    category: "cestni",
    shortDescription: "Stručné potvrzení ujednání nebo souhlasu.",
    partyLabels: { a: "Potvrzující", b: "Druhá strana" },
    contentFields: [
      { key: "obsah", label: "Co se potvrzuje", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        partiesTwo(this, state, "1"),
        sectionField("2", "Obsah", "Obsah", g(state, "obsah")),
        formatClosing(state),
      ]);
    },
  }),
  doc({
    id: "uznani-dluhu",
    title: "Uznání dluhu",
    category: "cestni",
    shortDescription: "Standardizovaný základ — může mít významné právní důsledky.",
    complexity: "advanced",
    legalRiskLevel: "high",
    requiresSpecialWarning: true,
    partyLabels: { a: "Dlužník", b: "Věřitel" },
    contentFields: [
      { key: "dluh", label: "Popis dluhu (jistina, příslušenství)", multiline: true },
      { key: "ujednani", label: "Způsob a termín úhrady", multiline: true },
    ],
    buildText(state) {
      return joinSections([
        this.title.toUpperCase(),
        "VÝSTRAHA: Uznání dluhu může ovlivnit promlčení a prokázání nároku. Před podpisem zvažte právní posouzení.",
        partiesTwo(this, state, "1"),
        sectionField("2", "Uznání", "Uznání", g(state, "dluh")),
        sectionField("3", "Plnění", "Plnění", g(state, "ujednani")),
        joinSections([
          "4. Prohlášení dlužníka",
          "Dlužník uznává svůj závazek vůči věřiteli v rozsahu uvedeném výše a zavazuje se jej splnit.",
        ]),
        formatClosing(state),
      ]);
    },
  }),
];

export function getLegalDocumentById(id) {
  return IU_LEGAL_DOCUMENTS.find((d) => d.id === id) || null;
}

export function listLegalDocumentsInCategory(categoryId) {
  return IU_LEGAL_DOCUMENTS.filter((d) => d.category === categoryId);
}

