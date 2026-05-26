#!/usr/bin/env node
"use strict";

const core = require("./rhc-v3-deterministic-core.cjs");

const CRITICAL_SCREENSHOT_PACK = {
  privacy_storage: [
    "Odchází něco mimo můj telefon když si uložím něco do kalendáře?",
    "Když si něco uložím do kalendáře úkolu nebo poznámek tak se mi to někde vymaže?",
    "Kam se ukládají všechny informace které ti dám?"
  ],
  storage_capacity: ["Kolik si můžu uložit poznámek?", "Jak velký je úložiště v kalendáři?"],
  task_guidance: ["Ty mi ty úkoly nějak připomeneš když si je uložím?", "Kde si potom ty úkoly přečtu?"],
  multi_storage: [
    "Můžu uložit něco do kalendáře v jednom pokynu zároveň do úkolů a zároveň do poznámek?",
    "Můžu uložit něco do úkolů a rovnou i do poznámek?"
  ],
  calendar_update: [
    "Prosím tě dnes v 10 hod. máš v kalendáři schůzka s Tomášem přesuň tu schůzku na 11. hodinu"
  ]
};

const PRIVACY_STORAGE_SEEDS = [
  "Odchází něco mimo můj telefon když si uložím něco do kalendáře?",
  "Když si něco uložím do kalendáře úkolu nebo poznámek tak se mi to někde vymaže?",
  "Kam se ukládají všechny informace které ti dám?",
  "Posíláš data někam mimo můj telefon?",
  "Zůstávají moje věci jen v prohlížeči?",
  "Je to bezpečné když si uložím schůzku?",
  "Může se něco smazat když si uložím úkol?",
  "Kam jdou moje poznámky když je uložím?",
  "Ukládáš to někde na serveru?",
  "Chci vědět jestli něco odchází z telefonu při ukládání"
];

const STORAGE_CAPACITY_SEEDS = [
  "Kolik si můžu uložit poznámek?",
  "Jak velký je úložiště v kalendáři?",
  "Je nějaký limit poznámek?",
  "Kolik úkolů unese Silver?",
  "Má kalendář kapacitu?",
  "Kolik záznamů si můžu nechat?",
  "Je úložiště neomezené?",
  "Jak velké je lokální úložiště?"
];

const TASK_GUIDANCE_SEEDS = [
  "Ty mi ty úkoly nějak připomeneš když si je uložím?",
  "Kde si potom ty úkoly přečtu?",
  "Jak si přečtu uložené úkoly?",
  "Připomeneš mi úkoly po uložení?",
  "Kde najdu uložené úkoly?",
  "Kde uvidím seznam úkolů?",
  "Jak fungují připomínky u úkolů které uložím?"
];

const MULTI_STORAGE_SEEDS = [
  "Můžu uložit něco do kalendáře v jednom pokynu zároveň do úkolů a zároveň do poznámek?",
  "Můžu uložit něco do úkolů a rovnou i do poznámek?",
  "Jde uložit najednou do kalendáře i do úkolů?",
  "Umíš v jednom pokynu kalendář i poznámky?",
  "Můžu najednou úkol i poznámku?",
  "Lze současně uložit do více modulů?",
  "Můžu v jedné větě kalendář a úkoly zároveň?"
];

const CALENDAR_UPDATE_SEEDS = [
  "Prosím tě dnes v 10 hod. máš v kalendáři schůzka s Tomášem přesuň tu schůzku na 11. hodinu",
  "Přesuň schůzku s Tomášem z desíti na jedenáct",
  "Dnes v 10 mám schůzku s Tomášem posuň ji na 11",
  "Přesuň dnešní schůzku s Tomášem o hodinu později",
  "Máš dnes v kalendáři schůzku s Tomášem v deset přesuň ji na jedenáct"
];

function expandCorpus(seeds, prefix, targetCount, mutators) {
  const cases = [];
  let n = 0;
  function add(input, extra) {
    n++;
    cases.push(Object.assign({ id: prefix + String(n).padStart(5, "0"), input: input }, extra || {}));
  }
  for (let si = 0; si < seeds.length; si++) {
    add(seeds[si], { seed: true });
    if (cases.length >= targetCount) return cases.slice(0, targetCount);
  }
  const rng = core.mulberry32(prefix.split("").reduce(function (a, c) {
    return a + c.charCodeAt(0);
  }, 0));
  while (cases.length < targetCount) {
    const seed = seeds[Math.floor(rng() * seeds.length)];
    const m = mutators[Math.floor(rng() * mutators.length)];
    add(m(seed), { variant: true });
  }
  return cases.slice(0, targetCount);
}

const DEFAULT_MUTATORS = [
  function (s) {
    return s;
  },
  function (s) {
    return "Hele " + s;
  },
  function (s) {
    return "Prosím " + s;
  },
  function (s) {
    return s.replace(/\?/g, "") + " prosím?";
  },
  function (s) {
    return "Silver " + s;
  },
  function (s) {
    return "Krátce " + s;
  },
  function (s) {
    return s.replace("?", "") + " stručně?";
  }
];

function buildPrivacyStorageCorpusV1(targetCount) {
  return expandCorpus(PRIVACY_STORAGE_SEEDS, "PSS", targetCount || 800, DEFAULT_MUTATORS);
}

function buildStorageCapacityCorpusV1(targetCount) {
  return expandCorpus(STORAGE_CAPACITY_SEEDS, "SCG", targetCount || 600, DEFAULT_MUTATORS);
}

function buildTaskGuidanceCorpusV1(targetCount) {
  return expandCorpus(TASK_GUIDANCE_SEEDS, "TGH", targetCount || 600, DEFAULT_MUTATORS);
}

function buildMultiStorageCapabilityCorpusV1(targetCount) {
  return expandCorpus(MULTI_STORAGE_SEEDS, "MSC", targetCount || 600, DEFAULT_MUTATORS);
}

function buildCalendarUpdateSafeCorpusV1(targetCount) {
  return expandCorpus(CALENDAR_UPDATE_SEEDS, "CUS", targetCount || 200, DEFAULT_MUTATORS);
}

module.exports = {
  CRITICAL_SCREENSHOT_PACK,
  PRIVACY_STORAGE_SEEDS,
  STORAGE_CAPACITY_SEEDS,
  TASK_GUIDANCE_SEEDS,
  MULTI_STORAGE_SEEDS,
  CALENDAR_UPDATE_SEEDS,
  buildPrivacyStorageCorpusV1,
  buildStorageCapacityCorpusV1,
  buildTaskGuidanceCorpusV1,
  buildMultiStorageCapabilityCorpusV1,
  buildCalendarUpdateSafeCorpusV1
};
