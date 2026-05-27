#!/usr/bin/env node
"use strict";

const v1 = require("./silver-search-read-hardening-v1-shared.cjs");
const core = require("./rhc-v3-deterministic-core.cjs");

const FRAGMENT_REPLAY = [
  { id: "FRV2_001", input: "tu schůzku s Petrem", module: "calendar", forbidWrite: true },
  { id: "FRV2_002", input: "to co sem řešil s Kubou", module: "note", forbidWrite: true },
  { id: "FRV2_003", input: "rohlíky v úkolech", module: "task", forbidWrite: true }
];

const FOLLOWUP_REPLAY = [
  { id: "CFV2_001", input: "a kolik z toho dal Pepa?", forbidWrite: true, expectRx: /1500|pep/i },
  { id: "CFV2_002", input: "a co mám zítra v kalendáři?", forbidWrite: true },
  { id: "CFV2_003", input: "a v úkolech?", forbidWrite: true }
];

const STALE_CONTEXT_REPLAY = [
  { id: "SCV2_001", input: "ulož do kalendáře zítra oběd", setupWrite: true },
  { id: "SCV2_002", input: "jen se podívej co mám zítra v kalendáři", forbidWrite: true },
  { id: "SCV2_003", input: "nic neukládej co mám v poznámkách o autě", forbidWrite: true }
];

const QUERY_NO_CREATE_EXTRA = [
  { id: "QNCV2_001", input: "co mám zítra v kalendáři", forbidWrite: true },
  { id: "QNCV2_002", input: "mám na zítra nějaké úkoly", forbidWrite: true },
  { id: "QNCV2_003", input: "najdi v poznámkách barvu auta", forbidWrite: true }
];

function buildSearchReadHardeningV2Corpus() {
  const base = v1.buildCrossModuleCorpusV1();
  const extra = [];
  const paraphrase = {
    calendar: ["hele co mam zitra v kalendari", "voice style kdy mam doktora", "jen zjisti schuzku s petrem"],
    task: ["ukol rohliky prosim", "kolik mam ukolu na zitra", "co mam splnit do patku jen ukoly"],
    note: ["poznamka o tricku", "kde mam klice v poznamkach", "jestli sem daval pepovi zalohu"]
  };
  const mods = ["calendar", "task", "note"];
  for (let mi = 0; mi < mods.length; mi++) {
    const mod = mods[mi];
    const tpls = paraphrase[mod];
    for (let i = 0; i < 1000; i++) {
      const baseTpl = tpls[i % tpls.length];
      const mask = core.deriveMutationMask(mod + "_srhv2", i, 0x53525232);
      const rng = core.mulberry32(0x53525232 ^ i ^ mi);
      let input = core.applyMutationLayers(baseTpl, mask, rng);
      if (i % 3 === 0) input = "Hele " + input;
      extra.push({
        id: "SRHV2_" + mod.toUpperCase() + "_" + String(i).padStart(4, "0"),
        module: mod,
        input: input,
        tier: "B"
      });
    }
  }
  return base.concat(extra);
}

module.exports = Object.assign({}, v1, {
  FRAGMENT_REPLAY,
  FOLLOWUP_REPLAY,
  STALE_CONTEXT_REPLAY,
  QUERY_NO_CREATE_EXTRA,
  buildSearchReadHardeningV2Corpus
});
