#!/usr/bin/env node
/** Authoritative OR cross-check via ARES REST (IČO 29482241). No secrets logged. */
const ICO = "29482241";
const EXPECTED_MARK = "C 447292";

const res = await fetch(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${ICO}`);
if (!res.ok) {
  console.log("COMMERCIAL_REGISTER_VERIFIED=false");
  process.exit(1);
}
const data = await res.json();
const vr = (data.dalsiUdaje || []).find((u) => u.datovyZdroj === "vr");
const mark = vr && vr.spisovaZnacka ? String(vr.spisovaZnacka) : "";
const ok =
  data.ico === ICO &&
  data.obchodniJmeno === "Média uzel s.r.o." &&
  mark.includes(EXPECTED_MARK);
console.log("COMMERCIAL_REGISTER_VERIFIED=" + (ok ? "true" : "false"));
console.log("COMMERCIAL_REGISTER_MARK=" + (ok ? "C_447292_MSPH" : "mismatch"));
process.exit(ok ? 0 : 1);
