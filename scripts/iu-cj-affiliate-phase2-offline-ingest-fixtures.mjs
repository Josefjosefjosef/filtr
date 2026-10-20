/** Offline-only IMAP fixtures for tests and CI (never used on live ingest path). */
import fs from "node:fs";

export const OFFLINE_DEFAULT_COUPON_MESSAGE = Object.freeze({
  uid: 1,
  uidvalidity: 7001,
  subject: "Coupon",
  from: "owner-membermessaging@mx6.cj.com",
  bodyText: "Kupón SAVE20\nLINK ID: 444333\nCID: 123456",
});

export function resolveOfflineIngestFixture(env = process.env) {
  const mode = String(env.IU_CJ_OFFLINE_FIXTURE || "default").trim().toLowerCase();
  if (mode === "none" || mode === "0" || mode === "empty") {
    return { messages: [] };
  }
  const pathArg = env.IU_CJ_OFFLINE_FIXTURE_PATH;
  if (pathArg && String(pathArg).trim()) {
    const raw = fs.readFileSync(String(pathArg).trim(), "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { messages: parsed };
    if (parsed?.messages) return { messages: parsed.messages };
    throw new Error("offline_fixture_invalid_shape");
  }
  if (mode === "default") {
    return { messages: [{ ...OFFLINE_DEFAULT_COUPON_MESSAGE }] };
  }
  throw new Error("offline_fixture_unknown_mode:" + mode);
}
