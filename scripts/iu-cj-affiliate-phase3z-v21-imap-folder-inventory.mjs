#!/usr/bin/env node
/**
 * V21 — read-only IMAP folder inventory for affiliate@infouzel.cz (no secrets printed).
 */
import fs from "node:fs";
import {
  AFFILIATE_MAILBOX_ADDRESS,
  FORPSI_IMAP_HOST,
  DEFAULT_FORPSI_IMAP_TLS_MODE,
  FORPSI_IMAP_DEFAULT_FOLDERS,
} from "./iu-cj-affiliate-phase2-forpsi-imap-config.mjs";
import { createForpsiImapTransport } from "./iu-cj-affiliate-phase2-forpsi-imap-adapter-lib.mjs";

const outPath = process.env.IU_IMAP_FOLDER_INVENTORY_OUT || "/tmp/iu-imap-folder-inventory.json";

function relevantFolder(name) {
  const n = String(name || "");
  return /^(INBOX|Archive|Archiv|CJ|Partner|Affiliate|Received|Doručen|Sent|Odeslan)/i.test(n);
}

async function main() {
  const base = {
    mailbox: AFFILIATE_MAILBOX_ADDRESS,
    host: FORPSI_IMAP_HOST,
    tlsMode: DEFAULT_FORPSI_IMAP_TLS_MODE,
    readOnly: true,
    defaultFolders: [...FORPSI_IMAP_DEFAULT_FOLDERS],
  };
  try {
    const t = await createForpsiImapTransport({
      host: FORPSI_IMAP_HOST,
      tlsModeId: DEFAULT_FORPSI_IMAP_TLS_MODE,
    });
    await t.connect();
    const listed = await t.listMailboxes();
    const names = (Array.isArray(listed) ? listed : [])
      .map((f) => (typeof f === "string" ? f : f?.name || f?.path || null))
      .filter(Boolean);
    const inventory = [];
    const probe = [...new Set([...FORPSI_IMAP_DEFAULT_FOLDERS, ...names.filter(relevantFolder)])];
    for (const folder of probe.slice(0, 20)) {
      try {
        const sel = await t.selectMailbox(folder);
        if (!sel?.ok) {
          inventory.push({ folder, ok: false, reason: sel?.reason || "select_failed" });
          continue;
        }
        const uids = await t.fetchAllUids();
        inventory.push({
          folder,
          ok: true,
          messageCount: Array.isArray(uids) ? uids.length : null,
          uidvalidity: sel.uidvalidity ?? null,
        });
      } catch (e) {
        inventory.push({ folder, ok: false, reason: String(e?.message || e).slice(0, 80) });
      }
    }
    try {
      await t.disconnect();
    } catch {
      /* ignore */
    }
    const out = {
      ...base,
      ok: true,
      listedFolderCount: names.length,
      listedFolders: names.slice(0, 40),
      inventory,
      MAILBOX_IDENTITY: "VERIFIED",
    };
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
    console.log(
      JSON.stringify({
        ok: true,
        mailbox: AFFILIATE_MAILBOX_ADDRESS,
        listedFolderCount: names.length,
        inventoried: inventory.length,
      })
    );
  } catch (e) {
    const out = {
      ...base,
      ok: false,
      reason: String(e?.message || e).slice(0, 160),
      MAILBOX_IDENTITY: "BLOCKED",
    };
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
    console.log(JSON.stringify({ ok: false, reason: out.reason }));
    process.exitCode = 0; // non-fatal for ingest pipeline
  }
}

main();
