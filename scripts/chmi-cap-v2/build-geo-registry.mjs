/**
 * Build versioned geo registry from official ČSÚ CISORP + ČÚZK UI_ORP/OKRES/VUSC.
 * Sources (downloaded at build time into %TEMP% or via --from-temp):
 *   ČSÚ CISORP CSV: https://apl2.czso.cz/iSMS/do_cis_export?kodcis=65&typdat=0&cisjaz=203&format=2
 *   ČSÚ vazba kraj: ...&typdat=1&cisvaz=100_398&format=2
 *   ČÚZK UI_ORP.zip: https://services.cuzk.cz/sestavy/cis/UI_ORP.zip
 *   ČÚZK UI_OKRES.zip / UI_VUSC.zip
 *
 * CHMI CAP uses valueName=CISORP. Praha alias: CHMI often emits 1100 while ČSÚ lists 1000.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "data", "geo-registry.json");
const TEMP = process.env.TEMP || process.env.TMPDIR || "/tmp";

function fold(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseCsv(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, ""));
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = splitCsvLine(line).map((c) => c.replace(/^"|"$/g, ""));
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return row;
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
      continue;
    }
    if (ch === "," && !q) {
      out.push(cur);
      cur = "";
      continue;
    }
    if ((ch === ";" && !q)) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function readTemp(name) {
  const p = path.join(TEMP, name);
  if (!fs.existsSync(p)) throw new Error("missing_temp_file:" + p);
  return fs.readFileSync(p);
}

/** ČÚZK UI_* CSVs are Windows-1250; ČSÚ CISORP exports are UTF-8. */
function decodeBuffer(buf, encoding) {
  const enc = String(encoding || "utf8").toLowerCase();
  if (enc === "utf8" || enc === "utf-8") return buf.toString("utf8");
  if (enc === "windows-1250" || enc === "cp1250") {
    return new TextDecoder("windows-1250").decode(buf);
  }
  return buf.toString(enc);
}

function readCsvFlexible(preferredPaths, encoding = "utf8") {
  for (const p of preferredPaths) {
    if (fs.existsSync(p)) return decodeBuffer(fs.readFileSync(p), encoding);
  }
  throw new Error("missing_csv:" + preferredPaths.join("|"));
}

function main() {
  const cisorpRows = parseCsv(readTemp("cisorp65.csv").toString("utf8"));
  const krajRows = parseCsv(readTemp("cisorp65_kraj.csv").toString("utf8"));
  const uiOrp = parseCsv(
    readCsvFlexible(
      [path.join(TEMP, "ui_orp_ok", "UI_ORP.csv"), path.join(TEMP, "UI_ORP.csv")],
      "windows-1250"
    )
  );
  const uiOkres = parseCsv(
    readCsvFlexible(
      [path.join(TEMP, "ui_okres_ok", "UI_OKRES.csv"), path.join(TEMP, "UI_OKRES.csv")],
      "windows-1250"
    )
  );
  const uiVusc = parseCsv(
    readCsvFlexible(
      [path.join(TEMP, "ui_vusc_ok", "UI_VUSC.csv"), path.join(TEMP, "UI_VUSC.csv")],
      "windows-1250"
    )
  );

  const orpByRuian = new Map(uiOrp.map((r) => [String(r.KOD), r]));
  const okresByKod = new Map(uiOkres.map((r) => [String(r.KOD), r]));
  const vuscByKod = new Map(uiVusc.map((r) => [String(r.KOD), r]));
  const krajByCisorp = new Map(krajRows.map((r) => [String(r.chodnota1), r]));

  const updatedAt = new Date().toISOString();
  const units = [];
  const aliases = {};

  // kraje from VUSC
  for (const v of uiVusc) {
    const code = String(v.NUTS_LAU || v.KOD);
    units.push({
      id: "kraj:" + code,
      code,
      name: String(v.NAZEV || ""),
      nameNorm: fold(v.NAZEV),
      type: "kraj",
      parentId: null,
      validFrom: String(v.DATUM_VZNIKU || v.PLATI_OD || "2000-01-01").slice(0, 10),
      validTo: v.PLATI_DO ? String(v.PLATI_DO).slice(0, 10) : null,
      registryVersion: "cisorp-csu65+cuzk-ui-" + updatedAt.slice(0, 10),
      source: "CSU_CISORP_65+CUZK_UI_VUSC",
      updatedAt,
      ruianKod: String(v.KOD),
    });
  }

  // okresy
  for (const o of uiOkres) {
    const nuts = String(o.NUTS_LAU || o.KOD);
    const vusc = vuscByKod.get(String(o.VUSC_KOD));
    const krajCode = vusc ? String(vusc.NUTS_LAU || vusc.KOD) : null;
    units.push({
      id: "okres:" + nuts,
      code: nuts,
      name: String(o.NAZEV || ""),
      nameNorm: fold(o.NAZEV),
      type: "okres",
      parentId: krajCode ? "kraj:" + krajCode : null,
      validFrom: String(o.DATUM_VZNIKU || o.PLATI_OD || "1960-01-01").slice(0, 10),
      validTo: o.PLATI_DO ? String(o.PLATI_DO).slice(0, 10) : null,
      registryVersion: "cisorp-csu65+cuzk-ui-" + updatedAt.slice(0, 10),
      source: "CUZK_UI_OKRES",
      updatedAt,
      ruianKod: String(o.KOD),
    });
  }

  // ORP from CISORP
  for (const row of cisorpRows) {
    const code = String(row.chodnota || "").trim();
    if (!code) continue;
    const ruian = String(row.kod_ruian || "").trim();
    const ui = orpByRuian.get(ruian);
    const okresKod = ui ? String(ui.OKRES_KOD) : null;
    const okres = okresKod ? okresByKod.get(okresKod) : null;
    const okresNuts = okres ? String(okres.NUTS_LAU || okres.KOD) : null;
    const krajRow = krajByCisorp.get(code);
    const krajName = krajRow ? String(krajRow.text2 || "") : "";
    units.push({
      id: "orp:" + code,
      code,
      name: String(row.text || row.zkrtext || ""),
      nameNorm: fold(row.text || row.zkrtext),
      type: "orp",
      parentId: okresNuts ? "okres:" + okresNuts : null,
      krajNameHint: krajName || null,
      validFrom: String(row.admplod || "2003-01-01").slice(0, 10),
      validTo: row.admnepo && String(row.admnepo).startsWith("9999") ? null : String(row.admnepo || "").slice(0, 10) || null,
      registryVersion: "cisorp-csu65+cuzk-ui-" + updatedAt.slice(0, 10),
      source: "CSU_CISORP_65",
      updatedAt,
      ruianKod: ruian || null,
    });
  }

  // CHMI Praha alias observed in CAP geocodes (1100) vs ČSÚ (1000)
  aliases["1100"] = "1000";

  const registry = {
    version: "cisorp-csu65+cuzk-ui-" + updatedAt.slice(0, 10),
    source: {
      cisorp: "https://apl2.czso.cz/iSMS/do_cis_export?kodcis=65&typdat=0&cisjaz=203&format=2",
      cisorpKrajVazba: "https://apl2.czso.cz/iSMS/do_cis_export?kodcis=65&typdat=1&cisvaz=100_398&cisjaz=203&format=2",
      uiOrp: "https://services.cuzk.cz/sestavy/cis/UI_ORP.zip",
      uiOkres: "https://services.cuzk.cz/sestavy/cis/UI_OKRES.zip",
      uiVusc: "https://services.cuzk.cz/sestavy/cis/UI_VUSC.zip",
      note: "Official ČSÚ CISORP (65) codes are primary for CAP geocode mapping. ČÚZK UI_* used for ORP→okres→kraj hierarchy via kod_ruian.",
    },
    generatedAt: updatedAt,
    counts: {
      orp: units.filter((u) => u.type === "orp").length,
      okres: units.filter((u) => u.type === "okres").length,
      kraj: units.filter((u) => u.type === "kraj").length,
    },
    aliases,
    units,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(registry, null, 2) + "\n", "utf8");
  console.log("GEO_REGISTRY_BUILD=OK");
  console.log("out=" + OUT);
  console.log("counts=" + JSON.stringify(registry.counts));
  console.log("aliases=" + JSON.stringify(aliases));
}

main();
