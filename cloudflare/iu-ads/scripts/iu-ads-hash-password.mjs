#!/usr/bin/env node
/**
 * Offline password hash helper for seeding the first main_admin via D1.
 *
 * Usage (PowerShell):
 *   $env:ADS_PASSWORD_PEPPER = '<pepper>'   # never commit; never log
 *   node scripts/iu-ads-hash-password.mjs
 *   # then type password + Enter (stdin); stdout prints ONLY the hash line
 *
 * Does not print the pepper or password.
 */
import { createInterface } from "node:readline";
import { webcrypto } from "node:crypto";

const crypto = webcrypto;
const ITERATIONS = 100_000;

function toHex(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, "0");
  return s;
}

async function hashPassword(password, pepper) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const saltHex = toHex(salt);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password + "|" + pepper),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
    keyMaterial,
    256
  );
  return "pbkdf2$" + ITERATIONS + "$" + saltHex + "$" + toHex(bits);
}

const pepper = process.env.ADS_PASSWORD_PEPPER || "";
if (!pepper) {
  console.error("ERROR: set ADS_PASSWORD_PEPPER in the environment (value never printed).");
  process.exit(2);
}

const rl = createInterface({ input: process.stdin, output: process.stderr });
rl.question("Password (stdin; not echoed to stdout): ", async (password) => {
  rl.close();
  if (!password || password.length < 12) {
    console.error("ERROR: password must be at least 12 characters.");
    process.exit(3);
  }
  const hash = await hashPassword(password, pepper);
  process.stdout.write(hash + "\n");
});
