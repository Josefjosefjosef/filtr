/**
 * Deklarativní registr datových zdrojů Informační lišty (V5+).
 * UI čte katalog; tento registr drží auditní metadata pro build/ops.
 * Následující PR doplní zbývající ČSÚ položky dle auditní tabulky.
 */

export const IU_INFO_PANEL_SOURCE_REGISTRY = {
  version: 1,
  revisedAt: "2026-07-16",
  note:
    "Toto není formální právní stanovisko. Licence ověřeny z veřejných podmínek poskytovatelů k datu revize.",
  indicators: {
    eur_czk: {
      provider: "ČNB",
      endpoint:
        "https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt",
      license: "Pravidla ČNB pro užívání informací — povinná atribuce",
      periodicity: "daily_business_days",
      changeKind: "absolute",
      status: "verified_ok",
      auditFix: "CNB calendar freshness (PR #7497); change format with Kč",
    },
    usd_czk: {
      provider: "ČNB",
      endpoint:
        "https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt",
      license: "Pravidla ČNB pro užívání informací — povinná atribuce",
      periodicity: "daily_business_days",
      changeKind: "absolute",
      status: "verified_ok",
      auditFix: "CNB calendar freshness (PR #7497); change format with Kč",
    },
    unemployment: {
      provider: "MPSV / ÚP ČR",
      endpoint:
        "https://data.mpsv.cz/portal/api/reports/by-table/evid_pno_up_agr_frz_odata/data/json",
      license: "Otevřená data (CC0-like terms via data.gov.cz links on portal)",
      periodicity: "monthly",
      changeKind: "percentage_points",
      status: "verified_ok",
      removedEndpoint: "ČSÚ DataStat WREG01CT4 (annual archive — not current MPSV)",
      auditFix: "Reconnected to MPSV portal API; national aggregate of dosažitelní/obyvatelstvo 15–64",
    },
    registered_unemployment: {
      provider: "MPSV / ÚP ČR",
      endpoint:
        "https://data.mpsv.cz/portal/api/reports/by-table/evid_pno_up_agr_frz_odata/data/json",
      license: "Otevřená data MPSV",
      periodicity: "monthly",
      changeKind: "absolute",
      status: "verified_ok",
      removedEndpoint: "ČSÚ DataStat WREG01CT4",
      auditFix: "National sum of pocet_uchazeci_v_evidenci",
    },
    job_vacancies: {
      provider: "MPSV / ÚP ČR",
      endpoint:
        "https://data.mpsv.cz/portal/api/reports/by-table/vm_stav_vm_stat_agr_frz_odata_vp/data/csv",
      license: "Otevřená data MPSV",
      periodicity: "monthly",
      changeKind: "absolute",
      status: "verified_ok",
      removedEndpoint: "ČSÚ DataStat WREG01CT4",
      auditFix: "National sum of volna_mista_rozhodne_datum; MoM vs previous snapshot period",
      risk: "Last-month CSV ≈7 MB — acceptable for monthly bucket; full history CSV ≈119 MB avoided",
    },
    bitcoin: {
      provider: "CoinGecko",
      endpoint: "https://api.coingecko.com/api/v3/simple/price",
      license: "API terms — attribution; rate limits; commercial review follow-up",
      periodicity: "hourly",
      changeKind: "percent_24h",
      status: "verified_with_followup",
      followUp: "Re-verify commercial/redistribution clauses in dedicated PR",
    },
    gold: {
      provider: "CoinGecko (PAX Gold)",
      endpoint: "https://api.coingecko.com/api/v3/simple/price",
      license: "API terms — attribution; rate limits",
      periodicity: "hourly",
      changeKind: "percent_24h",
      status: "verified_with_followup",
      followUp: "Same as bitcoin",
    },
  },
  mpsvCandidates: {
    recommendAddLater: [
      {
        id: "seekers_per_vacancy",
        reason: "Celostátní, srozumitelné, spočitatelné z již načtených agregátů",
      },
      {
        id: "seekers_mom_change",
        reason: "Již částečně pokryto secondaryValue u registered_unemployment",
      },
      {
        id: "vacancies_mom_change",
        reason: "Již částečně pokryto secondaryValue u job_vacancies",
      },
    ],
    doNotAddToMainBar: [
      {
        id: "regional_rankings",
        reason: "Lišta je primárně celostátní; regionální žebříčky zahlcují mobil",
      },
      {
        id: "age_education_structure",
        reason: "Příliš granularní pro hlavní lištu",
      },
    ],
    blocked: [],
    needsDecision: [
      {
        id: "long_term_unemployed_share",
        reason: "Uživatelská hodnota ano, ale nutná stabilní měsíční agregace a UI slot",
      },
    ],
  },
  followUpSources: [
    "ČSÚ DataStat items — confirm each vyber still current; tighten change formatting (done centrally)",
    "Fuel CENPHMTT01 — confirm DPH / geographic average wording",
    "Health / crime / elections / environment — verify open-data alternatives where DataStat is thin",
    "CoinGecko commercial redistrib terms",
  ],
};
