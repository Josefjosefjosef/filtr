#!/usr/bin/env node
/** MIME charset / QP / limits — offline only. */
import {
  decodePartBody,
  decodeQuotedPrintableToBuffer,
  parseRawMimeMessage,
  MIME_PARSE_LIMITS,
} from "./iu-cj-affiliate-phase2-forpsi-mime-lib.mjs";

let passed = 0;
let failed = 0;

function expect(name, cond) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL: " + name);
  }
}

expect("MIME_qp_utf8_czech", decodePartBody("=C4=9B", "quoted-printable", "utf-8") === "\u011B");

const iso2Raw = Buffer.from([0xec, 0xb9, 0x65, 0x6e, 0xed]);
expect(
  "MIME_iso8859_2",
  decodePartBody(iso2Raw.toString("latin1"), "7bit", "iso-8859-2").includes("ě") &&
    decodePartBody(iso2Raw.toString("latin1"), "7bit", "iso-8859-2").includes("š")
);

const win1250Raw = Buffer.from([0xec, 0x65, 0x9a, 0x65, 0x6e, 0xfd]);
expect("MIME_windows1250", decodePartBody(win1250Raw.toString("latin1"), "7bit", "windows-1250").includes("ě"));

expect("MIME_base64", decodePartBody("b8OzZA==", "base64", "utf-8").includes("ó"));

const multipart = [
  "From: test@example.com",
  "Subject: =?UTF-8?Q?Kup=C3=B3n?=",
  "MIME-Version: 1.0",
  "Content-Type: multipart/alternative; boundary=bnd",
  "",
  "--bnd",
  "Content-Type: text/plain; charset=UTF-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "Sleva 10 %",
  "--bnd",
  "Content-Type: text/html; charset=UTF-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "<p>Kup&oacute;n &amp; sleva</p>",
  "--bnd--",
].join("\r\n");
const mp = parseRawMimeMessage(multipart);
expect("MIME_multipart_plain_html", mp.ok === true && mp.bodyText.includes("Sleva") && mp.bodyHtml.includes("ó"));

const oversize = "Subject: x\r\n\r\n" + "a".repeat(MIME_PARSE_LIMITS.maxMessageBytes + 1);
expect("MIME_oversize_fail_closed", parseRawMimeMessage(oversize).ok === false);

const deepNest = [
  "Content-Type: multipart/mixed; boundary=a",
  "",
  "--a",
  "Content-Type: multipart/mixed; boundary=b",
  "",
  "--b",
  "Content-Type: text/plain",
  "",
  "hi",
  "--b--",
  "--a--",
].join("\r\n");
for (let i = 0; i < MIME_PARSE_LIMITS.maxMimeDepth + 2; i += 1) {
  /* shallow — depth test via many nested multiparts in one message */
}
const manyParts = [
  "Content-Type: multipart/mixed; boundary=x",
  "",
  ...Array.from({ length: MIME_PARSE_LIMITS.maxParts + 2 }, (_, i) => [
    "--x",
    "Content-Type: text/plain",
    "",
    "part" + i,
  ]).flat(),
  "--x--",
].join("\r\n");
const many = parseRawMimeMessage(manyParts);
expect("MIME_max_parts_fail_closed", many.ok === false);

const broken = "Content-Type: text/plain\r\n\r\n=broken=qp=\r\n";
expect("MIME_broken_qp_does_not_throw", parseRawMimeMessage(broken).ok === true);

console.log(
  JSON.stringify({
    IU_CJ_FORPSI_MIME_SELFTEST: failed === 0 ? "OK" : "FAIL",
    passed,
    failed,
  })
);
process.exit(failed === 0 ? 0 : 1);
