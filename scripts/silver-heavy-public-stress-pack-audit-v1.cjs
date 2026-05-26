#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-payload-intelligence-line-k-shared.cjs");

const { SILVER_RELOAD_SENTINEL, SILVER_DELAY_SENTINEL } = shared;

function buildStressCorpus() {
  const families = [
    {
      id: "HPS_RELOAD_1",
      steps: ["Zítra Kuba", SILVER_RELOAD_SENTINEL, "Přidej adresu"],
      expectIntent: "calendar.create",
      titleNeed: ["kub"],
      locNeed: ["adres"],
      maxDuplicateCreates: 0
    },
    {
      id: "HPS_STORM_1",
      steps: ["Zítra Kuba", "Jo počkej", "Ne vlastně doktor", "A Kubovi adresu"],
      expectIntent: "calendar.create",
      titleNeed: ["kub"],
      locNeed: ["adres"],
      maxDuplicateCreates: 1
    },
    {
      id: "HPS_PATH_1",
      steps: ["Hele zejtra Kuba", "Počkej", "Kubovi notebook", "Servis auta", "Čtvrtek"],
      expectIntent: "calendar.create",
      titleNeed: ["servis"],
      maxDuplicateCreates: 1
    },
    {
      id: "HPS_CROSSDAY_1",
      steps: ["Včera Kuba", "Dnes přidej adresu"],
      expectIntent: "calendar.create",
      titleNeed: ["kub"],
      locNeed: ["adres"],
      maxDuplicateCreates: 0
    },
    {
      id: "HPS_DELAY_1",
      steps: ["Servis auta", SILVER_DELAY_SENTINEL, "Přidej techničák"],
      expectIntent: "calendar.create",
      titleNeed: ["servis"],
      noteNeed: ["techn"],
      maxDuplicateCreates: 0
    },
    {
      id: "HPS_MOBILE_1",
      steps: ["Hele zejtra Kuba", "A jo doktor", "Ne počkej servis až ve čtvrtek"],
      expectIntent: "calendar.create",
      titleNeed: ["doktor"],
      maxDuplicateCreates: 1
    },
    {
      id: "HPS_MIX_1",
      steps: ["Zítra Kuba", "Co mám zítra?", "A přidej servis", "K servisu techničák"],
      expectIntent: "calendar.create",
      titleNeed: ["servis"],
      noteNeed: ["techn"],
      maxDuplicateCreates: 2
    },
    {
      id: "HPS_RECALL_1",
      steps: ["Ráno doktor", "Večer změň čas na 10"],
      expectIntent: "calendar.create",
      titleNeed: ["doktor"],
      timeNeed: "10:00",
      maxDuplicateCreates: 0
    },
    {
      id: "HPS_BROKEN_1",
      steps: ["No a doktor", "Výsledky", "Servis auta", "Ne pátek"],
      expectIntent: "calendar.create",
      titleNeed: ["servis"],
      maxDuplicateCreates: 1
    },
    {
      id: "HPS_LONG_1",
      steps: [
        "Zítra Kuba a doktor v pátek a servis auta a Kubovi notebook a doktorovi výsledky a servisu techničák"
      ],
      expectIntent: "calendar.create",
      titleNeed: ["doktor"],
      maxDuplicateCreates: 0
    }
  ];
  const out = [];
  for (let i = 0; i < families.length; i++) {
    out.push(families[i]);
    out.push(Object.assign({}, families[i], { id: families[i].id + "_B" }));
  }
  return out;
}

const SCENARIOS = buildStressCorpus();

if (require.main === module) {
  process.exit(
    shared.runAudit(
      "silver_heavy_public_stress_pack_audit_v1",
      SCENARIOS,
      path.join(__dirname, "silver-heavy-public-stress-pack-audit-v1-report.json")
    )
  );
}

module.exports = { SCENARIOS, buildStressCorpus };
