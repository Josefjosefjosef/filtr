/**
 * Dokumentační výpis RSS zdrojů (infoUzel.cz).
 * Kanonický zdroj pravdy: projects/data/source_registry.json + scripts/gen_source_registry.py.
 * Duplicitní URL řeší build (jeden HTTP fetch na URL).
 */
export const IU_SOURCES = [
  // ZPRÁVY — GENERAL CORE
  { id: "ct24", url: "https://www.ceskatelevize.cz/ct24/rss", category: "zpravy", type: "general", intervalMin: 10, intervalMax: 15 },
  { id: "seznam", url: "https://www.seznamzpravy.cz/rss", category: "zpravy", type: "general", intervalMin: 10, intervalMax: 15 },
  { id: "novinky", url: "https://www.novinky.cz/rss", category: "zpravy", type: "general", intervalMin: 10, intervalMax: 15 },
  { id: "irozhlas", url: "https://www.irozhlas.cz/rss/irozhlas", category: "zpravy", type: "general", intervalMin: 10, intervalMax: 15 },
  { id: "denik", url: "https://www.denik.cz/rss/zpravy.html", category: "zpravy", type: "general", intervalMin: 10, intervalMax: 15 },
  // ZPRÁVY — SECTION
  { id: "aktualne", url: "https://www.aktualne.cz/rss/", category: "zpravy", type: "section", intervalMin: 12, intervalMax: 18 },
  { id: "idnes_zpravy", url: "https://servis.idnes.cz/rss.aspx?c=zpravodaj", category: "zpravy", type: "section", intervalMin: 12, intervalMax: 18 },
  { id: "idnes_krimi", url: "https://servis.idnes.cz/rss.aspx?c=krimi", category: "zpravy", type: "section", intervalMin: 15, intervalMax: 20 },
  // SPORT — CORE
  { id: "ctsport", url: "https://sport.ceskatelevize.cz/rss2", category: "sport", type: "general", intervalMin: 10, intervalMax: 15 },
  { id: "sportcz", url: "https://www.sport.cz/rss", category: "sport", type: "general", intervalMin: 10, intervalMax: 15 },
  { id: "isport", url: "https://isport.blesk.cz/rss", category: "sport", type: "general", intervalMin: 10, intervalMax: 15 },
  { id: "irozhlas_sport", url: "https://www.irozhlas.cz/rss/irozhlas/section/sport", category: "sport", type: "section", intervalMin: 12, intervalMax: 18 },
  // SPORT — NICHE
  { id: "efotbal", url: "https://www.efotbal.cz/rss", category: "sport", type: "niche", intervalMin: 20, intervalMax: 30 },
  { id: "eurofotbal", url: "https://www.eurofotbal.cz/rss/", category: "sport", type: "niche", intervalMin: 20, intervalMax: 30 },
  { id: "mmamag", url: "https://www.mmamag.cz/feed/", category: "sport", type: "niche", intervalMin: 20, intervalMax: 30 },
  // TECHNOLOGIE
  { id: "lupa", url: "https://www.lupa.cz/rss/", category: "tech", enabled: false, type: "section", intervalMin: 15, intervalMax: 25 },
  { id: "root", url: "https://www.root.cz/rss/", category: "tech", enabled: false, type: "section", intervalMin: 15, intervalMax: 25 },
  { id: "zive", url: "https://www.zive.cz/rss/sc-47/", category: "tech", enabled: false, type: "general", intervalMin: 15, intervalMax: 25 },
  { id: "mobilmania", url: "https://www.mobilmania.cz/rss/sc-47/", category: "tech", enabled: false, type: "section", intervalMin: 20, intervalMax: 30 },
  { id: "cnews", url: "https://www.cnews.cz/feed/", category: "tech", enabled: false, type: "niche", intervalMin: 20, intervalMax: 30 },
  // FINANCE
  { id: "hn", url: "https://hn.cz/?m=rss", category: "finance", type: "general", intervalMin: 10, intervalMax: 15 },
  { id: "e15", url: "https://www.e15.cz/rss", category: "finance", type: "general", intervalMin: 10, intervalMax: 15 },
  { id: "roklen", url: "https://roklen24.cz/rss/", category: "finance", type: "section", intervalMin: 12, intervalMax: 18 },
  { id: "kurzy", url: "https://www.kurzy.cz/rss/", category: "finance", type: "section", intervalMin: 12, intervalMax: 18 },
  { id: "podnikatel", url: "https://www.podnikatel.cz/rss/", category: "finance", type: "section", intervalMin: 20, intervalMax: 30 },
  // ZDRAVÍ
  { id: "idnes_zdravi", url: "https://servis.idnes.cz/rss.aspx?c=zdravi", category: "zdravi", type: "section", intervalMin: 15, intervalMax: 20 },
  { id: "novinky_zdravi", url: "https://www.novinky.cz/rss/zdravi", category: "zdravi", type: "section", intervalMin: 15, intervalMax: 20 },
  { id: "zdravi_euro", url: "https://zdravi.euro.cz/feed/", category: "zdravi", type: "niche", intervalMin: 25, intervalMax: 35 },
  // BYDLENÍ & HOBBY
  { id: "irozhlas_life", url: "https://www.irozhlas.cz/rss/irozhlas/section/zivotni-styl", category: "bydleni", enabled: false, type: "section", intervalMin: 20, intervalMax: 30 },
  { id: "denik_bydleni", url: "https://www.denik.cz/rss/bydleni.html", category: "bydleni", enabled: false, type: "section", intervalMin: 25, intervalMax: 35 },
  { id: "novinky_bydleni", url: "https://www.novinky.cz/rss/bydleni", category: "bydleni", enabled: false, type: "section", intervalMin: 25, intervalMax: 35 },
  { id: "dumazahrada", url: "https://www.dumazahrada.cz/rss/", category: "bydleni", enabled: false, type: "section", intervalMin: 25, intervalMax: 35 },
  { id: "recepty", url: "https://www.recepty.cz/rss", category: "bydleni", enabled: false, type: "niche", intervalMin: 30, intervalMax: 45 },
  { id: "chatar", url: "https://www.chatar-chalupar.cz/feed/", category: "bydleni", enabled: false, type: "niche", intervalMin: 30, intervalMax: 45 },
  // CESTOVÁNÍ (stejný RSS jako irozhlas_life — build načte URL jednou)
  { id: "irozhlas_travel", url: "https://www.irozhlas.cz/rss/irozhlas/section/zivotni-styl", category: "cestovani", type: "section", intervalMin: 25, intervalMax: 40 },
  { id: "novinky_cestovani", url: "https://www.novinky.cz/rss/cestovani", category: "cestovani", type: "section", intervalMin: 25, intervalMax: 40 },
  { id: "denik_cestovani", url: "https://www.denik.cz/rss/cestovani.html", category: "cestovani", type: "section", intervalMin: 30, intervalMax: 45 },
  { id: "kudyznudy", url: "https://www.kudyznudy.cz/rss", category: "cestovani", type: "section", intervalMin: 30, intervalMax: 45 },
  { id: "travelbible", url: "https://travelbible.cz/feed/", category: "cestovani", type: "niche", intervalMin: 35, intervalMax: 50 },
  // CZ vertikály (kanonické klíče: hry / kultura / veda / vzdelavani) — viz scripts/feeds.json
  { id: "novinky_hry", url: "https://www.novinky.cz/rss/hry", category: "hry", type: "section", intervalMin: 20, intervalMax: 35 },
  { id: "vortex", url: "https://www.vortex.cz/feed/", category: "hry", type: "section", intervalMin: 25, intervalMax: 40 },
  { id: "zing_hry", url: "https://www.zing.cz/feed/", category: "hry", type: "section", intervalMin: 22, intervalMax: 38 },
  { id: "irozhlas_kultura", url: "https://www.irozhlas.cz/rss/irozhlas/section/kultura", category: "kultura", type: "section", intervalMin: 15, intervalMax: 25 },
  { id: "novinky_kultura", url: "https://www.novinky.cz/rss/kultura", category: "kultura", type: "section", intervalMin: 18, intervalMax: 30 },
  { id: "aktualne_kultura", url: "https://www.aktualne.cz/rss/kultura/", category: "kultura", type: "section", intervalMin: 18, intervalMax: 30 },
  { id: "denik_kultura", url: "https://www.denik.cz/rss/kultura.html", category: "kultura", type: "section", intervalMin: 20, intervalMax: 32 },
  { id: "idnes_kultura", url: "https://servis.idnes.cz/rss.aspx?c=kultura", category: "kultura", type: "section", intervalMin: 18, intervalMax: 30 },
  { id: "irozhlas_veda_tech", url: "https://www.irozhlas.cz/rss/irozhlas/section/veda-technologie", category: "veda", type: "section", intervalMin: 15, intervalMax: 25 },
  { id: "novinky_veda", url: "https://www.novinky.cz/rss/veda", category: "veda", type: "section", intervalMin: 18, intervalMax: 30 },
  { id: "novinky_historie", url: "https://www.novinky.cz/rss/historie", category: "veda", type: "section", intervalMin: 22, intervalMax: 38 },
  { id: "denik_veda", url: "https://www.denik.cz/rss/veda.html", category: "veda", type: "section", intervalMin: 20, intervalMax: 32 },
  { id: "denik_veda_tech", url: "https://www.denik.cz/rss/veda-a-technika.html", category: "veda", type: "section", intervalMin: 20, intervalMax: 32 },
  { id: "aktualne_veda", url: "https://www.aktualne.cz/rss/veda/", category: "veda", type: "section", intervalMin: 18, intervalMax: 30 },
  { id: "e15_veda", url: "https://www.e15.cz/rss/veda", category: "veda", type: "niche", intervalMin: 25, intervalMax: 40 },
  { id: "novinky_skolstvi", url: "https://www.novinky.cz/rss/skolstvi", category: "vzdelavani", type: "section", intervalMin: 20, intervalMax: 35 },
  { id: "edu_cz", url: "https://edu.cz/rss", category: "vzdelavani", type: "section", intervalMin: 25, intervalMax: 40 },
  { id: "denik_vzdelavani", url: "https://www.denik.cz/rss/vzdelavani.html", category: "vzdelavani", type: "section", intervalMin: 22, intervalMax: 36 },
];
