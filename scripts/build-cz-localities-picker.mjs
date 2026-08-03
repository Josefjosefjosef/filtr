/**
 * Build official CZ obec picker with obec→ORP (CISORP) mapping.
 *
 * Sources (downloaded at build time into %TEMP%):
 *   ČSÚ CISOB (43): obce a vojenské újezdy
 *   ČSÚ vazba CISORP→CISOB (cisvaz=43_1182): obce spadající pod SO ORP
 *   ČÚZK UI_OBEC / UI_OKRES: okres names for duplicate-name disambiguation
 *   scripts/chmi-cap-v2/data/geo-registry.json: authoritative CISORP codes for CAP
 *
 * Run: node scripts/build-cz-localities-picker.mjs
 * Requires: network, Node 18+
 */
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "projects/data/cz_localities_picker.json");
const GEO_REG = path.join(ROOT, "scripts/chmi-cap-v2/data/geo-registry.json");

const CISOB_URL =
  "https://apl2.czso.cz/iSMS/do_cis_export?kodcis=43&typdat=0&cisjaz=203&format=2";
const VAZBA_URL =
  "https://apl2.czso.cz/iSMS/do_cis_export?kodcis=65&typdat=1&cisvaz=43_1182&cisjaz=203&format=2";
const UI_OBEC_URL = "https://services.cuzk.cz/sestavy/cis/UI_OBEC.zip";
const UI_OKRES_URL = "https://services.cuzk.cz/sestavy/cis/UI_OKRES.zip";

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const f = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          f.close();
          try {
            fs.unlinkSync(dest);
          } catch (_) {}
          return download(res.headers.location, dest).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          f.close();
          reject(new Error("HTTP " + res.statusCode + " " + url));
          return;
        }
        res.pipe(f);
        f.on("finish", () => f.close(() => resolve()));
      })
      .on("error", reject);
  });
}

function parseCsv(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, ""));
  return lines
    .slice(1)
    .filter(Boolean)
    .map((line) => {
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
    if ((ch === "," || ch === ";") && !q) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function decodeCp1250(buf) {
  return new TextDecoder("windows-1250").decode(buf);
}

function unzip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  execFileSync("tar", ["-xf", zipPath, "-C", destDir], { stdio: "inherit" });
}

function findCsv(dir) {
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const name of fs.readdirSync(cur)) {
      const p = path.join(cur, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) stack.push(p);
      else if (/\.csv$/i.test(name)) return p;
    }
  }
  throw new Error("csv_not_found:" + dir);
}

function fold(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cz-obec-orp-"));
  const cisobPath = path.join(tmp, "cisob43.csv");
  const vazPath = path.join(tmp, "vaz_65_43.csv");
  const obecZip = path.join(tmp, "UI_OBEC.zip");
  const okresZip = path.join(tmp, "UI_OKRES.zip");

  await download(CISOB_URL, cisobPath);
  await download(VAZBA_URL, vazPath);
  await download(UI_OBEC_URL, obecZip);
  await download(UI_OKRES_URL, okresZip);

  const obecDir = path.join(tmp, "ui_obec");
  const okresDir = path.join(tmp, "ui_okres");
  unzip(obecZip, obecDir);
  unzip(okresZip, okresDir);

  const uiObec = parseCsv(decodeCp1250(fs.readFileSync(findCsv(obecDir))));
  const uiOkres = parseCsv(decodeCp1250(fs.readFileSync(findCsv(okresDir))));
  const okresNameByKod = new Map(uiOkres.map((r) => [String(r.KOD), String(r.NAZEV || "").trim()]));
  const obecOkresByKod = new Map(
    uiObec.map((r) => [String(r.KOD), okresNameByKod.get(String(r.OKRES_KOD)) || ""])
  );

  const cisobRows = parseCsv(fs.readFileSync(cisobPath, "utf8"));
  const obecNameById = new Map();
  for (const row of cisobRows) {
    const id = String(row.chodnota || "").trim();
    const name = String(row.text || row.zkrtext || "").trim();
    const validTo = String(row.admnepo || "");
    if (!id || !name) continue;
    if (validTo && !validTo.startsWith("9999")) continue;
    obecNameById.set(id, name);
  }

  const vazRows = parseCsv(fs.readFileSync(vazPath, "utf8"));
  const byObec = new Map();
  for (const row of vazRows) {
    const orp = String(row.chodnota1 || "").trim();
    const orpName = String(row.text1 || "").trim();
    const obecId = String(row.chodnota2 || "").trim();
    const obecName = String(row.text2 || obecNameById.get(obecId) || "").trim();
    if (!orp || !obecId || !obecName) continue;
    if (byObec.has(obecId)) {
      const prev = byObec.get(obecId);
      if (prev.orp !== orp) {
        throw new Error("conflict_obec_multi_orp:" + obecId + ":" + prev.orp + ":" + orp);
      }
      continue;
    }
    byObec.set(obecId, { id: obecId, n: obecName, orp, orpN: orpName });
  }

  const geo = JSON.parse(fs.readFileSync(GEO_REG, "utf8"));
  const regOrpCodes = new Set(geo.units.filter((u) => u.type === "orp").map((u) => String(u.code)));
  const orpNameByCode = new Map(
    geo.units.filter((u) => u.type === "orp").map((u) => [String(u.code), String(u.name)])
  );

  const missingOrp = [];
  for (const code of regOrpCodes) {
    let hit = false;
    for (const row of byObec.values()) {
      if (row.orp === code) {
        hit = true;
        break;
      }
    }
    if (!hit) missingOrp.push(code);
  }
  if (missingOrp.length) {
    throw new Error("orp_without_obce:" + missingOrp.join(","));
  }

  const badOrp = [];
  const items = [];
  for (const row of byObec.values()) {
    if (!regOrpCodes.has(row.orp)) {
      badOrp.push(row.id + "->" + row.orp);
      continue;
    }
    const ok = obecOkresByKod.get(row.id) || "";
    const isSeat = fold(row.n) === fold(row.orpN || orpNameByCode.get(row.orp) || "");
    items.push({
      id: row.id,
      n: row.n,
      orp: row.orp,
      orpN: row.orpN || orpNameByCode.get(row.orp) || "",
      ok,
      p: isSeat ? 90 : 40,
      t: isSeat ? "city" : "obec",
    });
  }
  if (badOrp.length) {
    throw new Error("obec_unknown_orp:" + badOrp.slice(0, 20).join(","));
  }

  items.sort(
    (a, b) =>
      b.p - a.p || a.n.localeCompare(b.n, "cs", { sensitivity: "base" }) || a.id.localeCompare(b.id)
  );

  const coveredOrp = new Set(items.map((x) => x.orp));
  if (coveredOrp.size !== regOrpCodes.size) {
    throw new Error("orp_coverage_mismatch:" + coveredOrp.size + "/" + regOrpCodes.size);
  }

  const json = {
    version: 3,
    source:
      "ČSÚ CISOB (43) + vazba CISORP→CISOB (cisvaz=43_1182) + ČÚZK UI_OBEC/UI_OKRES; ORP codes aligned to scripts/chmi-cap-v2/data/geo-registry.json (CISORP).",
    sourceDetail:
      "Built by scripts/build-cz-localities-picker.mjs. Stable ids = ČSÚ chodnota obce (RÚIAN obec kod). orp = CISORP code used by CHMI CAP.",
    counts: {
      obce: items.length,
      orp: coveredOrp.size,
      expectedOrp: regOrpCodes.size,
    },
    items,
  };

  fs.writeFileSync(OUT, JSON.stringify(json), "utf8");
  const st = fs.statSync(OUT);
  console.log("OK", OUT, "obce", items.length, "orp", coveredOrp.size, "bytes", st.size);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
