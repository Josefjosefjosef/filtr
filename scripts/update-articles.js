// scripts/update-articles.js
// Minimalni generator articles.json – bez tahani perexu.
// Jen demo data + struktura. Pozdeji to nahradime realnym ziskavanim titulku + odkazu.

const fs = require("fs");
const path = require("path");

const outPath = path.join(process.cwd(), "data", "articles.json");

const now = new Date();
const iso = now.toISOString();

const data = [
  {
    id: "demo-1",
    section: "Doprava",
    datetime: iso,
    title: "Nehoda na D1",
    description: "Dopravni komplikace na dalnici D1.",
    sources: [
      { name: "CT24 – Doprava", url: "https://ct24.ceskatelevize.cz/doprava" },
      { name: "iDNES – Doprava", url: "https://www.idnes.cz/zpravy/doprava" }
    ]
  },
  {
    id: "demo-2",
    section: "Zpravy",
    datetime: iso,
    title: "Aktualni prehled",
    description: "Prehled hlavnich udalosti z vice zdroju.",
    sources: [
      { name: "Seznam Zpravy", url: "https://www.seznamzpravy.cz/" },
      { name: "iROZHLAS", url: "https://www.irozhlas.cz/" }
    ]
  }
];

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf8");

console.log("Wrote:", outPath);
