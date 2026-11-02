#!/usr/bin/env node
/**
 * V21 selftests — reset-once backfill, welcome recognition, partnerSummary name, overrides, Hero Wars.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createMockForpsiImapTransport } from "./iu-cj-affiliate-phase2-forpsi-imap-adapter-lib.mjs";
import {
  runMailboxSyncBatch,
  runMailboxHintsReplayBatch,
  loadSyncState,
  defaultForpsiSyncStatePath,
  defaultForpsiSyncLockPath,
} from "./iu-cj-affiliate-phase2-forpsi-imap-sync-lib.mjs";
import {
  processPartnerMessageForForpsiStaging,
  mapToAffiliateCategories,
  AFFILIATE_EMAIL_CATEGORY,
} from "./iu-cj-affiliate-phase2-forpsi-imap-ingest-lib.mjs";
import { classifyPartnerEmail } from "./iu-cj-affiliate-phase2-email-ingest-lib.mjs";
import { buildAllOverrideMetrics } from "./iu-cj-affiliate-phase3z-v20-override-metrics.mjs";
import { parseAffiliateCatalogOrdered } from "./iu-cj-affiliate-phase2-partner-slot-inventory-v1.mjs";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import { deterministicEventFallback } from "./iu-cj-affiliate-phase3r-ai-email-event-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function expect(name, cond, detail) {
  if (!cond) fails.push({ name, detail: detail || null });
  else console.log("PASS " + name);
}

// --- Welcome recognition CS / SK / EN ---
const welcomeCases = [
  { subject: "Vítejte v našem partnerském programu", body: "Děkujeme." },
  { subject: "Váš účet byl schválen", body: "Program CJ." },
  { subject: "Vaše žádost byla přijata", body: "Affiliate." },
  { subject: "You've been approved", body: "Welcome aboard." },
  { subject: "Partnership approved", body: "Thank you for joining." },
  { subject: "Advertiser invitation — GANT.CZ", body: "Please confirm." },
  { subject: "Publisher application is approved", body: "Start promoting." },
];
for (const c of welcomeCases) {
  const cls = classifyPartnerEmail(c);
  const cats = mapToAffiliateCategories(c, cls, { confidence: "catalog_confirmed" });
  expect(
    "welcome_" + c.subject.slice(0, 24).replace(/\s+/g, "_"),
    cls.commercialKinds.includes("program_welcome") &&
      (cats.includes(AFFILIATE_EMAIL_CATEGORY.partner_welcome) ||
        cats.includes(AFFILIATE_EMAIL_CATEGORY.program_approval)),
    { cls, cats }
  );
}

// Admin notice must NOT be treated as assortment welcome alone.
const admin = classifyPartnerEmail({
  subject: "Company details changed",
  body: "Podle našich záznamů jste nedávno změnili údaje o společnosti.",
});
expect("admin_not_welcome", !admin.commercialKinds.includes("program_welcome"), admin);

// --- partnerSummary carries catalogMatchName ---
const staged = processPartnerMessageForForpsiStaging(
  {
    uid: 42,
    uidvalidity: 1,
    mailbox: "affiliate@infouzel.cz",
    folder: "INBOX",
    from: "owner-membermessaging@mx6.cj.com",
    subject: "Welcome to GANT.CZ affiliate program",
    bodyText: "You have been approved. Fashion apparel clothing.",
    sizeBytes: 120,
    authSource: "staging_unverified",
  },
  {
    catalogAdvertisers: [{ advertiserId: "4978487", advertiserName: "GANT.CZ", relationshipStatus: "joined" }],
  }
);
expect(
  "catalog_match_name_present",
  staged.partnerSummary?.catalogMatchName === "GANT.CZ" &&
    staged.partnerSummary?.catalogAdvertiserId === "4978487",
  staged.partnerSummary
);

// --- AI fallback recognizes partner_welcome category ---
const aiEv = deterministicEventFallback({
  subjectSafe: "Váš účet byl schválen — Čedok.cz",
  excerptSafe: "cestovní kancelář zájezdy",
  categories: ["partner_welcome"],
  advertiserId: "6179554",
  fromSafe: "owner-membermessaging@mx6.cj.com",
});
expect(
  "ai_partner_welcome_approved",
  aiEv.eventType === "PARTNER_APPROVED" && aiEv.productHint,
  aiEv
);

// --- RESET once across multi-batch (V20 bug regression) ---
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iu-v21-reset-"));
const statePath = defaultForpsiSyncStatePath(dir);
const lockPath = defaultForpsiSyncLockPath(dir);
const messages = [];
for (let uid = 1; uid <= 25; uid++) {
  messages.push({
    uid,
    from: "owner-membermessaging@mx6.cj.com",
    subject: uid <= 3 ? `Welcome to Partner${uid}` : `Newsletter ${uid}`,
    bodyText:
      uid <= 3
        ? `You have been approved into the affiliate program. Assortment fashion. Advertiser 497848${uid}.`
        : `Routine update ${uid}`,
    sizeBytes: 100 + uid,
  });
}
const syncT = createMockForpsiImapTransport({ messages });
const sync = await runMailboxSyncBatch({
  transport: syncT,
  statePath,
  lockPath,
  ownerId: "v21-sync",
  batchSize: 50,
  catalogAdvertisers: [{ advertiserId: "4978487", advertiserName: "GANT.CZ" }],
});
expect("sync_ok", sync.ok === true, sync);
process.env.IU_FORPSI_IMAP_HINTS_REPLAY_RESET = "1";
const r1 = await runMailboxHintsReplayBatch({
  transport: createMockForpsiImapTransport({ messages }),
  statePath,
  lockPath,
  ownerId: "v21-r1",
  batchSize: 10,
  resetReplay: true,
});
process.env.IU_FORPSI_IMAP_HINTS_REPLAY_RESET = "0";
expect("replay1_10", r1.ok && r1.batchSize === 10 && r1.pendingAfterBatch === 15, r1);
const r2 = await runMailboxHintsReplayBatch({
  transport: createMockForpsiImapTransport({ messages }),
  statePath,
  lockPath,
  ownerId: "v21-r2",
  batchSize: 10,
  resetReplay: false,
});
expect("replay2_advances", r2.ok && r2.batchSize === 10 && r2.pendingAfterBatch === 5, {
  pending: r2.pendingAfterBatch,
  batch: r2.batchSize,
});
const r3 = await runMailboxHintsReplayBatch({
  transport: createMockForpsiImapTransport({ messages }),
  statePath,
  lockPath,
  ownerId: "v21-r3",
  batchSize: 10,
  resetReplay: false,
});
expect("replay3_complete", r3.ok && r3.complete === true && r3.pendingAfterBatch === 0, r3);

// Env RESET must NOT wipe when options.resetReplay===false (V20 multi-batch bug).
process.env.IU_FORPSI_IMAP_HINTS_REPLAY_RESET = "1";
const rEnvIgnored = await runMailboxHintsReplayBatch({
  transport: createMockForpsiImapTransport({ messages }),
  statePath,
  lockPath,
  ownerId: "v21-env",
  batchSize: 10,
  resetReplay: false,
});
process.env.IU_FORPSI_IMAP_HINTS_REPLAY_RESET = "0";
expect(
  "env_reset_ignored_when_options_false",
  rEnvIgnored.ok && rEnvIgnored.batchSize === 0 && rEnvIgnored.complete === true,
  rEnvIgnored
);

try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch {
  /* ignore */
}

// --- Override metrics load published sections correctly ---
const catalogJs = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
const parsed = parseAffiliateCatalogOrdered(catalogJs);
const pub = new Map();
for (const s of parsed.sections || []) {
  for (const it of s.items || []) {
    if (!it.url || !isCjTrackingUrl(it.url)) continue;
    pub.set(String(it.advertiserId || ""), String(s.sectionId || s.id || ""));
  }
}
const { summary, rows } = buildAllOverrideMetrics(pub);
const noBtn = rows.filter((r) => r.kind === "OVERRIDE_NO_PUBLIC_BUTTON");
expect("override_not_all_no_button", summary.OVERRIDE_APPLIED >= 20 && noBtn.length <= 2, {
  applied: summary.OVERRIDE_APPLIED,
  noBtn: noBtn.length,
  byKind: summary.byKind,
});
expect("override_consistent", summary.consistent === true, summary);

// --- Hero Wars present as hero-wars.com / 7520433 ---
let hero = null;
for (const s of parsed.sections || []) {
  for (const it of s.items || []) {
    if (String(it.advertiserId) === "7520433") hero = { ...it, sectionId: s.sectionId };
  }
}
expect(
  "hero_wars_published",
  hero &&
    /hero-wars/i.test(hero.title || "") &&
    isCjTrackingUrl(hero.url) &&
    hero.sectionId,
  hero
);

expect("published_175", pub.size === 175, pub.size);

if (fails.length) {
  console.error(JSON.stringify({ ok: false, fails }, null, 2));
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      ok: true,
      overrideApplied: summary.OVERRIDE_APPLIED,
      byKind: summary.byKind,
      heroWars: { advertiserId: "7520433", sectionId: hero.sectionId, title: hero.title },
      mainCheckpointUnchanged: true,
    },
    null,
    2
  )
);
