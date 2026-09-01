/**
 * EXT-SEC-TXT-01 — RFC 9116 security.txt semantic guard.
 *
 * Validates first-party /.well-known/security.txt:
 * - Contact + Expires present
 * - Contact is the proven public operator mailbox (mailto:info@infouzel.cz)
 * - Expires is RFC 3339, future, < 366 days, and not within 30 days (renewal pressure)
 * - Canonical matches production HTTPS well-known URL
 * - no placeholder / fake domains / HTML / forbidden optional claims
 * - _headers sets text/plain; charset=utf-8 for the path
 * - Pages stage allowlist includes .well-known
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEC_TXT = path.join(ROOT, ".well-known", "security.txt");
const HEADERS = path.join(ROOT, "_headers");
const STAGE = path.join(ROOT, "scripts", "iu-pages-stage-artifact-v1.mjs");

const EXPECTED_CONTACT = "mailto:info@infouzel.cz";
const EXPECTED_CANONICAL = "https://infouzel.cz/.well-known/security.txt";
const MIN_REMAINING_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 366 * 24 * 60 * 60 * 1000;

const FORBIDDEN_FIELD_RE =
  /^(Policy|Hiring|Acknowledgments|Encryption|Preferred-Languages)\s*:/i;
const PLACEHOLDER_RE =
  /example\.com|example\.org|security@infouzel\.cz|TODO|FIXME|placeholder|changeme|yourcompany/i;

const fails = [];

function fail(msg) {
  fails.push(msg);
}

if (!fs.existsSync(SEC_TXT)) {
  fail("missing_.well-known/security.txt");
} else {
  const raw = fs.readFileSync(SEC_TXT, "utf8");
  if (!raw || !raw.trim()) fail("security_txt_empty");
  if (/<\s*html|<\s*script|<\s*!DOCTYPE/i.test(raw)) fail("security_txt_looks_like_html");
  if (PLACEHOLDER_RE.test(raw)) fail("security_txt_placeholder_or_forbidden_token");

  const lines = raw.split(/\r?\n/);
  const fields = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "") continue;
    if (line.startsWith("#")) continue;
    if (FORBIDDEN_FIELD_RE.test(line)) {
      fail("forbidden_optional_field_line=" + (i + 1));
      continue;
    }
    const m = line.match(/^([A-Za-z0-9-]+):\s*(.+)$/);
    if (!m) {
      fail("invalid_line=" + (i + 1));
      continue;
    }
    fields.push({ name: m[1].toLowerCase(), value: m[2].trim(), line: i + 1 });
  }

  const contacts = fields.filter((f) => f.name === "contact");
  const expires = fields.filter((f) => f.name === "expires");
  const canonicals = fields.filter((f) => f.name === "canonical");
  const unknown = fields.filter(
    (f) => f.name !== "contact" && f.name !== "expires" && f.name !== "canonical"
  );

  if (contacts.length < 1) fail("contact_missing");
  if (contacts.length > 1) fail("contact_duplicate_unexpected");
  if (contacts[0] && contacts[0].value !== EXPECTED_CONTACT) {
    fail("contact_unexpected=" + contacts[0].value);
  }
  if (contacts[0] && !/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(contacts[0].value)) {
    fail("contact_uri_invalid");
  }

  if (expires.length !== 1) fail("expires_must_appear_exactly_once");
  else {
    const expVal = expires[0].value;
    const expMs = Date.parse(expVal);
    if (!Number.isFinite(expMs)) fail("expires_not_rfc3339_parseable");
    else {
      const now = Date.now();
      if (expMs <= now) fail("expires_not_in_future");
      if (expMs - now < MIN_REMAINING_MS) fail("expires_within_30_days_renew_required");
      if (expMs - now > MAX_FUTURE_MS) fail("expires_more_than_366_days_rfc_staleness");
      // Require trailing Z or numeric offset (RFC 3339 timezone).
      if (!/(Z|[+-]\d{2}:\d{2})$/.test(expVal)) fail("expires_missing_timezone");
    }
  }

  if (canonicals.length !== 1) fail("canonical_must_appear_exactly_once");
  else if (canonicals[0].value !== EXPECTED_CANONICAL) {
    fail("canonical_unexpected=" + canonicals[0].value);
  } else if (!canonicals[0].value.startsWith("https://")) {
    fail("canonical_must_be_https");
  }

  if (unknown.length) {
    fail("unexpected_fields=" + unknown.map((f) => f.name).join(","));
  }
}

if (!fs.existsSync(HEADERS)) fail("missing__headers");
else {
  const h = fs.readFileSync(HEADERS, "utf8");
  if (!/\/\.well-known\/security\.txt\b/.test(h)) {
    fail("_headers_missing_security_txt_path");
  }
  if (!/text\/plain;\s*charset=utf-8/i.test(h)) {
    fail("_headers_missing_text_plain_utf8");
  }
}

if (!fs.existsSync(STAGE)) fail("missing_stage_script");
else {
  const s = fs.readFileSync(STAGE, "utf8");
  if (!/"\.well-known"/.test(s)) fail("stage_allowlist_missing_.well-known");
}

if (fails.length) {
  console.log(JSON.stringify({ IU_SECURITY_TXT_GUARD: "FAIL", fails }, null, 0));
  console.error("IU_SECURITY_TXT_GUARD_FAIL");
  process.exit(1);
}

console.log(
  JSON.stringify({
    IU_SECURITY_TXT_GUARD: "PASS",
    contact: EXPECTED_CONTACT,
    canonical: EXPECTED_CANONICAL,
    path: ".well-known/security.txt",
  })
);
