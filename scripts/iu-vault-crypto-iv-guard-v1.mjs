#!/usr/bin/env node
/**
 * Vault crypto IV uniqueness + tamper resistance tests.
 */
import {
  generateMdk,
  encryptString,
  decryptString,
  importMdkRaw,
  exportMdkRaw,
} from "../assets/iu-vault-core-v1.js";

const fails = [];

function t(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    fails.push(`${name}: ${e.message || e}`);
    console.log(`FAIL ${name}: ${e.message || e}`);
  }
}

async function runAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    fails.push(`${name}: ${e.message || e}`);
    console.log(`FAIL ${name}: ${e.message || e}`);
  }
}

await runAsync("iv_unique_200_encrypts", async () => {
  const mdk = await generateMdk();
  const ivs = new Set();
  for (let i = 0; i < 200; i += 1) {
    const env = await encryptString(mdk, "iu.test.iv", `payload_${i}`);
    if (!env.iv) throw new Error("missing iv");
    if (ivs.has(env.iv)) throw new Error("duplicate iv");
    ivs.add(env.iv);
  }
});

await runAsync("ciphertext_changes_per_iv", async () => {
  const mdk = await generateMdk();
  const a = await encryptString(mdk, "iu.test.ct", "same");
  const b = await encryptString(mdk, "iu.test.ct", "same");
  if (a.iv === b.iv) throw new Error("iv collision");
  if (a.ct === b.ct) throw new Error("ct identical");
});

await runAsync("bit_flip_decrypt_fails", async () => {
  const mdk = await generateMdk();
  const env = await encryptString(mdk, "iu.test.tamper", "secret");
  const bytes = Uint8Array.from(atob(env.ct), (c) => c.charCodeAt(0));
  bytes[0] ^= 0x01;
  const tampered = { ...env, ct: btoa(String.fromCharCode(...bytes)) };
  let threw = false;
  try {
    await decryptString(mdk, "iu.test.tamper", tampered);
  } catch (_) {
    threw = true;
  }
  if (!threw) throw new Error("decrypt should fail");
});

await runAsync("aad_tamper_decrypt_fails", async () => {
  const mdk = await generateMdk();
  const env = await encryptString(mdk, "iu.test.aad", "x");
  const aadBytes = Uint8Array.from(atob(env.aad), (c) => c.charCodeAt(0));
  aadBytes[0] ^= 0x01;
  const tampered = { ...env, aad: btoa(String.fromCharCode(...aadBytes)) };
  let threw = false;
  try {
    await decryptString(mdk, "iu.test.aad", tampered);
  } catch (_) {
    threw = true;
  }
  if (!threw) throw new Error("aad tamper should fail");
});

await runAsync("mdk_not_extractable", async () => {
  const mdk = await generateMdk();
  let threw = false;
  try {
    await exportMdkRaw(mdk);
  } catch (_) {
    threw = true;
  }
  if (!threw) throw new Error("mdk should not be extractable");
});

t("negative_iv_detector", () => {
  const seen = new Set(["a", "b"]);
  if (!seen.has("a")) throw new Error("detector broken");
  const bad = new Set(["x", "x"]);
  if (bad.size !== 1) throw new Error("duplicate iv not detected");
});

if (fails.length) {
  console.error("IU_VAULT_CRYPTO_IV_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_VAULT_CRYPTO_IV_GUARD_PASS");
