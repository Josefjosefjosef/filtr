/**
 * MPSV Portál otevřených dat — registrovaná nezaměstnanost (od 2025).
 * Legální strojový přístup: /portal/api/reports/by-table/.../data/{json|csv}
 * Starý /od/soubory/nezamestnanost-mesicni-* končí 12/2024 (2025+ → 404).
 */

const MPSV_API = "https://data.mpsv.cz/portal/api/reports/by-table";
const PNO_HISTORY = `${MPSV_API}/evid_pno_up_agr_frz_odata/data/json`;
const VPM_LAST_MONTH_CSV = `${MPSV_API}/vm_stav_vm_stat_agr_frz_odata_vp/data/csv?fileName=volna_mista_posledni_data`;
const PORTAL_DOCS = "https://data.mpsv.cz/portal/datove-sady/trh-prace/statistiky-nezamestnanosti";

const CZ_MONTHS = [
  "",
  "leden",
  "únor",
  "březen",
  "duben",
  "květen",
  "červen",
  "červenec",
  "srpen",
  "září",
  "říjen",
  "listopad",
  "prosinec",
];

export const MPSV_LABOR_SOURCE = {
  provider: "Ministerstvo práce a sociálních věcí / Úřad práce ČR",
  portalUrl: "https://data.mpsv.cz/portal",
  docsUrl: PORTAL_DOCS,
  pnoEndpoint: PNO_HISTORY,
  vpmEndpoint: VPM_LAST_MONTH_CSV,
  licenseNote:
    "Otevřená data MPSV — neobsahuje autorská díla / zvláštní právo DB / osobní údaje (viz podmínky data.gov.cz vázané portálem).",
  attribution: "Zdroj: MPSV / Úřad práce ČR — Portál otevřených dat",
};

/**
 * @param {string} isoDate YYYY-MM-DD
 */
export function periodLabelFromIsoDate(isoDate) {
  const m = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(isoDate || "");
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const name = CZ_MONTHS[month] || m[2];
  return `${name} ${year}`;
}

/**
 * @param {any[]} rows
 * @returns {{ periodIso: string, period: string, unemploymentRatePct: number, registeredSeekers: number, reachableSeekers: number }[]}
 */
export function aggregateNationalPnoRows(rows) {
  /** @type {Record<string, { dos: number, evid: number, obyv: number }>} */
  const byDate = {};
  for (const row of rows || []) {
    const date = String(row && row.rozhodne_datum ? row.rozhodne_datum : "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!byDate[date]) byDate[date] = { dos: 0, evid: 0, obyv: 0 };
    byDate[date].dos += Number(row.pocet_uchazeci_dosazitelni) || 0;
    byDate[date].evid += Number(row.pocet_uchazeci_v_evidenci) || 0;
    byDate[date].obyv += Number(row.pocet_obyvatel_vek_15_64) || 0;
  }
  return Object.keys(byDate)
    .sort()
    .map((periodIso) => {
      const b = byDate[periodIso];
      const unemploymentRatePct = b.obyv > 0 ? (100 * b.dos) / b.obyv : null;
      return {
        periodIso,
        period: periodLabelFromIsoDate(periodIso),
        unemploymentRatePct,
        registeredSeekers: Math.round(b.evid),
        reachableSeekers: Math.round(b.dos),
      };
    })
    .filter((r) => typeof r.unemploymentRatePct === "number" && Number.isFinite(r.unemploymentRatePct));
}

/**
 * @param {string} csvText
 * @returns {{ periodIso: string, period: string, vacancies: number }[]}
 */
export function aggregateNationalVacanciesCsv(csvText) {
  const text = String(csvText || "").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delim = lines[0].includes(";") ? ";" : ",";
  const header = lines[0].split(delim).map((h) => h.trim());
  const dateIdx = header.findIndex((h) => /^rozhodne_datum$/i.test(h));
  const vacIdx = header.findIndex((h) => /^volna_mista_rozhodne_datum$/i.test(h));
  if (dateIdx < 0 || vacIdx < 0) throw new Error("mpsv_vpm_csv_schema");

  /** @type {Record<string, number>} */
  const byDate = {};
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(delim);
    const date = String(cells[dateIdx] || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const raw = String(cells[vacIdx] || "").replace(/\s/g, "").replace(",", ".");
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) continue;
    byDate[date] = (byDate[date] || 0) + n;
  }

  return Object.keys(byDate)
    .sort()
    .map((periodIso) => ({
      periodIso,
      period: periodLabelFromIsoDate(periodIso),
      vacancies: Math.round(byDate[periodIso]),
    }));
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "InfoUzelInfoPanel/1.0 (+https://infouzel.cz)",
    },
  });
  if (!res.ok) throw new Error("mpsv_http_" + res.status);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "text/csv,application/json,*/*",
      "User-Agent": "InfoUzelInfoPanel/1.0 (+https://infouzel.cz)",
    },
  });
  if (!res.ok) throw new Error("mpsv_http_" + res.status);
  return res.text();
}

/**
 * Načte celostátní měsíční PNO + uchazeče (historie) a aktuální VPM.
 */
export async function fetchMpsvNationalLaborSeries() {
  const pnoRaw = await fetchJson(PNO_HISTORY);
  const pnoRows = Array.isArray(pnoRaw) ? pnoRaw : pnoRaw && Array.isArray(pnoRaw.data) ? pnoRaw.data : [];
  if (!pnoRows.length) throw new Error("mpsv_pno_empty");
  const pnoSeries = aggregateNationalPnoRows(pnoRows);
  if (!pnoSeries.length) throw new Error("mpsv_pno_aggregate_empty");

  const vpmCsv = await fetchText(VPM_LAST_MONTH_CSV);
  const vpmSeries = aggregateNationalVacanciesCsv(vpmCsv);
  if (!vpmSeries.length) throw new Error("mpsv_vpm_empty");

  const latestPno = pnoSeries[pnoSeries.length - 1];
  const prevPno = pnoSeries.length > 1 ? pnoSeries[pnoSeries.length - 2] : null;
  const latestVpm = vpmSeries[vpmSeries.length - 1];

  return {
    source: MPSV_LABOR_SOURCE,
    pnoSeries,
    vpmSeries,
    latest: {
      unemployment: {
        value: Number(latestPno.unemploymentRatePct.toFixed(2)),
        period: latestPno.period,
        periodIso: latestPno.periodIso,
      },
      registered_unemployment: {
        value: latestPno.registeredSeekers,
        period: latestPno.period,
        periodIso: latestPno.periodIso,
      },
      job_vacancies: {
        value: latestVpm.vacancies,
        period: latestVpm.period,
        periodIso: latestVpm.periodIso,
      },
    },
    previous: {
      unemployment: prevPno
        ? {
            value: Number(prevPno.unemploymentRatePct.toFixed(2)),
            period: prevPno.period,
            periodIso: prevPno.periodIso,
          }
        : null,
      registered_unemployment: prevPno
        ? {
            value: prevPno.registeredSeekers,
            period: prevPno.period,
            periodIso: prevPno.periodIso,
          }
        : null,
      // VPM last-month file má typicky 1 období — previous bere caller ze snapshotu.
      job_vacancies: null,
    },
  };
}
