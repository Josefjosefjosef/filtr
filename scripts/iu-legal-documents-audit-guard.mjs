/**
 * Audit all legal document generators: signatures, optional fields, preview parity.
 */
import { createEmptyParty } from "../assets/iu-legal-documents-schema.js";
import { IU_LEGAL_DOCUMENTS } from "../assets/iu-legal-documents-registry.js";
import {
  buildLegalDocumentPreviewHtml,
  derivePartySignatureMetaFromPlainText,
  filterEmptySectionsForVisualOutput,
  parseLegalDocumentVisualStructure,
  stripParentheticalForBarTitle,
} from "../assets/iu-legal-documents-pdf-renderer.js";

const LONG = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore.";

function filledParty(first, last) {
  const p = createEmptyParty();
  p.firstName = first;
  p.lastName = last;
  p.birthDate = "1. 1. 1980";
  p.address = "Praha 1, Václavské náměstí 1";
  return p;
}

function filledState(doc) {
  const content = {};
  doc.contentFields.forEach((f) => {
    content[f.key] = f.multiline ? LONG : "Test hodnota";
  });
  const extra = { misto: "Praha", datum: "1. 6. 2026" };
  return {
    partyA: filledParty("Jan", "Novák"),
    partyB: filledParty("Marie", "Svobodová"),
    content,
    extra,
  };
}

function emptyState(doc) {
  const content = {};
  doc.contentFields.forEach((f) => {
    content[f.key] = "";
  });
  return {
    partyA: createEmptyParty(),
    partyB: createEmptyParty(),
    content,
    extra: {},
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

let checked = 0;
let failures = 0;
const failureLines = [];

for (const doc of IU_LEGAL_DOCUMENTS) {
  checked += 1;
  const filled = filledState(doc);
  const empty = emptyState(doc);
  const filledText = doc.buildText(filled);
  const emptyText = doc.buildText(empty);

  assert(filledText.includes("Jan"), `${doc.id}: missing party A first name in filled text`);
  assert(filledText.includes("Novák"), `${doc.id}: missing party A last name in filled text`);

  if (doc.partyMode !== "one") {
    assert(filledText.includes("Marie"), `${doc.id}: missing party B first name in filled text`);
    assert(filledText.includes("Svobodová"), `${doc.id}: missing party B last name in filled text`);
  }

  const visualFilled = filterEmptySectionsForVisualOutput(filledText);
  const visualEmpty = filterEmptySectionsForVisualOutput(emptyText);

  assert(!visualFilled.includes("…………"), `${doc.id}: placeholder dots in filled visual output`);
  assert(!visualEmpty.includes("…………"), `${doc.id}: placeholder dots in empty visual output`);

  const meta = derivePartySignatureMetaFromPlainText(filledText);
  assert(meta.nameA === "Jan Novák", `${doc.id}: signature nameA expected Jan Novák got ${meta.nameA}`);

  if (doc.partyMode === "one") {
    assert(!meta.nameB, `${doc.id}: one-party doc should not infer nameB`);
  } else {
    assert(meta.nameB === "Marie Svobodová", `${doc.id}: signature nameB expected Marie Svobodová got ${meta.nameB}`);
    assert(!/strana\s+[ab]/i.test(meta.nameA || ""), `${doc.id}: Strana A/B in nameA when names filled`);
    assert(!/strana\s+[ab]/i.test(meta.nameB || ""), `${doc.id}: Strana A/B in nameB when names filled`);
  }

  const structure = parseLegalDocumentVisualStructure(emptyText);
  for (const sec of structure.sections) {
    if (sec.isSignatures || sec.isPlaceDate) continue;
    if (!sec.body && !sec.heading) continue;
    const labeled = sec.body && sec.body.split("\n\n");
    if (labeled && labeled.some((p) => /^[·…\.]{10,}/.test(p.trim()))) {
      failures += 1;
      failureLines.push(`${doc.id}: empty section may contain placeholder block`);
    }
  }

  if (doc.requiresSpecialWarning) {
  const warnRe = /UPOZORNĚNÍ|POZNÁMKA|VÝSTRAHA/i;
    if (!warnRe.test(filledText)) {
      failures += 1;
      failureLines.push(`${doc.id}: requiresSpecialWarning but no inline warning in buildText`);
    }
  }

  const previewHtml = buildLegalDocumentPreviewHtml(doc.title, filledText);
  const barCount = (previewHtml.match(/iu-legal-doc-paper__sectionBar/g) || []).length;
  const minBars = doc.partyMode === "one" ? 2 : 3;
  if (barCount < minBars) {
    failures += 1;
    failureLines.push(`${doc.id}: preview section bars ${barCount} < ${minBars}`);
  }
  if (/class="iu-legal-doc-paper__fieldLabel">Prodávající<\/span>/i.test(previewHtml)) {
    failures += 1;
    failureLines.push(`${doc.id}: party role still rendered as plain field label (expected section bar)`);
  }
  const barTitles = [...previewHtml.matchAll(/class="iu-legal-doc-paper__sectionTitle">([^<]+)</g)].map((m) => m[1]);
  barTitles.forEach((title) => {
    if (/\([^)]*\)/.test(title)) {
      failures += 1;
      failureLines.push(`${doc.id}: section bar title contains parentheses: ${title}`);
    }
  });
  if (doc.id === "kupni-movita") {
    if (!barTitles.some((t) => /PŘEDMĚT KOUPĚ/.test(t))) {
      failures += 1;
      failureLines.push(`${doc.id}: expected field-label bar PŘEDMĚT KOUPĚ`);
    }
    if (barTitles.some((t) => /PŘEDMĚT SMLOUVY/.test(t))) {
      failures += 1;
      failureLines.push(`${doc.id}: section title PŘEDMĚT SMLOUVY must not replace field bar`);
    }
  }
  if (doc.id === "kupni-vozidlo") {
    ["PŘEDMĚT KOUPĚ", "KUPNÍ CENA", "STAV A PŘEDÁNÍ"].forEach((expected) => {
      if (!barTitles.some((t) => t.includes(expected))) {
        failures += 1;
        failureLines.push(`${doc.id}: missing expected section bar ${expected}`);
      }
    });
  }
}

assert(stripParentheticalForBarTitle("Předmět koupě (označení věci)") === "Předmět koupě", "stripParentheticalForBarTitle basic");
assert(
  stripParentheticalForBarTitle("Práva a povinnosti stran (volitelně)") === "Práva a povinnosti stran",
  "stripParentheticalForBarTitle volitelne",
);

if (failures > 0) {
  console.error("IU_LEGAL_DOCUMENTS_AUDIT_FAIL");
  failureLines.forEach((line) => console.error(line));
  process.exit(1);
}

console.log("IU_LEGAL_DOCUMENTS_AUDIT_PASS");
console.log(`generators_checked=${checked}`);
console.log(`failures=${failures}`);
