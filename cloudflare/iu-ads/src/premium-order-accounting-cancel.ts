/**
 * Accounting cancellation of approved order + invoice (storno PDF + credit note).
 * Does NOT turn off the ad — requires prior definitive ad turn-off when ad was published.
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, newId } from "./admin-auth";
import { appendPremiumOrderEvent } from "./premium-order-history";
import {
  allocatePremiumCreditNoteNumber,
  allocatePremiumStornoNumber,
  newCreditNoteId,
  newStornoRecordId,
} from "./premium-document-numbers";
import {
  computeAccountingSettlementRecap,
  sumPriorCreditCorrectionsCents,
} from "./premium-accounting-settlement";
import {
  paymentSettlementLabelCs,
  validatePremiumStornoReason,
  type PremiumPaymentSettlementMode,
} from "./premium-czech-money";
import { enqueuePremiumStornoDocuments } from "./premium-storno-documents";
import type { Env } from "./types";

export type PremiumAccountingCancelInput = {
  orderId: string;
  actorUserId: string;
  reason: string;
  /** Legacy: negative haléře. Prefer storno_amount_cents (positive Kč). */
  correctionCents?: number;
  /** Positive haléře to credit (storno amount). */
  stornoAmountCents?: number;
  paymentSettlement?: PremiumPaymentSettlementMode;
  amountPaidCents?: number;
  idempotencyKey?: string;
};

export type PremiumAccountingCancelResult =
  | {
      ok: true;
      idempotent: boolean;
      storno_id: string;
      storno_number: string;
      credit_note_id: string | null;
      document_enqueue: { ok: boolean };
    }
  | { ok: false; status: number; error: string; message_cs?: string };

function isAdPubliclyLive(input: {
  workflow_status: string;
  ad_turned_off_at: string | null;
  published_campaign_id: string | null;
  campaign_status: string | null;
  placement_active_campaign_id: string | null;
}): boolean {
  if (input.workflow_status !== "published") return false;
  if (input.ad_turned_off_at) return false;
  if (!input.published_campaign_id) return false;
  if (input.placement_active_campaign_id === input.published_campaign_id) {
    if (input.campaign_status === "active" || input.campaign_status === "paused") return true;
  }
  if (input.campaign_status === "active" || input.campaign_status === "paused") return true;
  return false;
}

export async function executePremiumOrderAccountingCancel(
  env: Env,
  input: PremiumAccountingCancelInput
): Promise<PremiumAccountingCancelResult> {
  if (!env.DB) return { ok: false, status: 503, error: "auth_not_configured" };
  const reasonCheck = validatePremiumStornoReason(input.reason);
  if (!reasonCheck.ok) {
    return {
      ok: false,
      status: 400,
      error: reasonCheck.error,
      message_cs: "Zadejte srozumitelný důvod storna (min. 12 znaků, smysluplný text).",
    };
  }
  const reason = reasonCheck.reason;

  const db = env.DB;
  const nowIso = new Date().toISOString();

  const existingStorno = await db
    .prepare(
      "SELECT storno_id, storno_number, credit_note_id, storno_kind FROM premium_order_storno_records WHERE order_id = ?"
    )
    .bind(input.orderId)
    .first<{ storno_id: string; storno_number: string; credit_note_id: string | null; storno_kind: string }>();
  if (existingStorno) {
    if (existingStorno.storno_kind === "rejection") {
      return {
        ok: false,
        status: 409,
        error: "rejected_order_use_settlement",
        message_cs:
          "U zamítnuté objednávky použijte „Vystavit dobropis“ s explicitní opravovanou částkou (nelze stornovat jako schválenou objednávku).",
      };
    }
    const docEnqueue = await enqueuePremiumStornoDocuments(env, input.orderId, input.actorUserId, {
      stornoKind: "cancellation",
      forceRetryIncomplete: true,
    });
    return {
      ok: true,
      idempotent: true,
      storno_id: existingStorno.storno_id,
      storno_number: existingStorno.storno_number,
      credit_note_id: existingStorno.credit_note_id,
      document_enqueue: { ok: docEnqueue.ok },
    };
  }

  const po = await db
    .prepare(
      `SELECT po.order_id, po.workflow_status, po.placement_id, po.published_campaign_id, po.ad_turned_off_at,
              po.payment_status, po.published_at, camp.status AS campaign_status
       FROM premium_selected_orders po
       LEFT JOIN campaigns camp ON camp.campaign_id = po.published_campaign_id
       WHERE po.order_id = ?`
    )
    .bind(input.orderId)
    .first<{
      order_id: string;
      workflow_status: string;
      placement_id: string;
      published_campaign_id: string | null;
      ad_turned_off_at: string | null;
      payment_status: string | null;
      published_at: string | null;
    } & { campaign_status: string | null }>();

  if (!po) return { ok: false, status: 404, error: "premium_order_not_found" };
  if (po.workflow_status === "rejected") {
    return {
      ok: false,
      status: 409,
      error: "already_rejected",
      message_cs: "Objednávka je zamítnutá — pro dobropis použijte endpoint vystavení dobropisu u zamítnuté objednávky.",
    };
  }
  if (po.workflow_status === "cancelled") {
    return { ok: false, status: 409, error: "already_cancelled" };
  }
  if (po.workflow_status !== "published") {
    return {
      ok: false,
      status: 409,
      error: "not_approved",
      message_cs: "Stornovat lze pouze schválenou objednávku (nebo ji nejdříve zamítněte).",
    };
  }

  const placementRow = await db
    .prepare("SELECT active_campaign_id FROM premium_selected_placements WHERE placement_id = ?")
    .bind(po.placement_id)
    .first<{ active_campaign_id: string | null }>();

  if (
    po.published_at &&
    isAdPubliclyLive({
      workflow_status: po.workflow_status,
      ad_turned_off_at: po.ad_turned_off_at,
      published_campaign_id: po.published_campaign_id,
      campaign_status: po.campaign_status,
      placement_active_campaign_id: placementRow?.active_campaign_id ?? null,
    })
  ) {
    return {
      ok: false,
      status: 409,
      error: "ad_still_live",
      message_cs:
        "Reklama stále běží nebo není definitivně vypnutá. Nejdříve použijte „Vypnout reklamu“ (dočasné pozastavení nestačí).",
    };
  }

  if (po.published_at && !po.ad_turned_off_at) {
    const stillOnPlacement =
      po.published_campaign_id &&
      placementRow?.active_campaign_id &&
      placementRow.active_campaign_id === po.published_campaign_id;
    if (stillOnPlacement || po.campaign_status === "paused") {
      return {
        ok: false,
        status: 409,
        error: "ad_not_turned_off",
        message_cs:
          "Před stornem schválené objednávky musí být reklama definitivně vypnutá a pozice uvolněná.",
      };
    }
  }

  const invoice = await db
    .prepare(
      "SELECT invoice_id, invoice_number, total_cents, currency, status, paid_at FROM invoices WHERE order_id = ? ORDER BY created_at DESC LIMIT 1"
    )
    .bind(input.orderId)
    .first<{
      invoice_id: string;
      invoice_number: string;
      total_cents: number;
      currency: string;
      status: string;
      paid_at: string | null;
    }>();

  const originalTotal = invoice ? Math.round(Number(invoice.total_cents) || 0) : 0;
  let priorCorrected = 0;
  if (invoice?.invoice_id) {
    const priorRows = await db
      .prepare("SELECT correction_cents FROM premium_credit_notes WHERE invoice_id = ?")
      .bind(invoice.invoice_id)
      .all<{ correction_cents: number }>();
    priorCorrected = sumPriorCreditCorrectionsCents(priorRows.results || []);
  }
  const remainingCorrectable = Math.max(0, originalTotal - priorCorrected);

  let stornoAmountCents = 0;
  if (input.stornoAmountCents != null && Number.isFinite(input.stornoAmountCents)) {
    stornoAmountCents = Math.round(Math.abs(Number(input.stornoAmountCents)));
  } else if (input.correctionCents != null && Number.isFinite(input.correctionCents)) {
    stornoAmountCents = Math.abs(Math.round(Number(input.correctionCents)));
  } else if (invoice) {
    return {
      ok: false,
      status: 400,
      error: "storno_amount_required",
      message_cs: "Zadejte částku ke stornování (Kč).",
    };
  }

  let correctionCents = invoice ? -stornoAmountCents : 0;

  if (invoice && stornoAmountCents <= 0) {
    return { ok: false, status: 400, error: "correction_zero", message_cs: "Částka ke stornování musí být vyšší než 0 Kč." };
  }
  if (invoice && stornoAmountCents > remainingCorrectable) {
    return {
      ok: false,
      status: 400,
      error: "correction_exceeds_remaining",
      message_cs:
        "Částka ke stornování nesmí překročit zbývající neopravenou částku faktury (" +
        (remainingCorrectable / 100).toFixed(2) +
        " Kč).",
    };
  }

  const paymentSettlement: PremiumPaymentSettlementMode =
    input.paymentSettlement === "paid" || input.paymentSettlement === "partial" || input.paymentSettlement === "unpaid"
      ? input.paymentSettlement
      : po.payment_status === "paid" || invoice?.status === "paid" || invoice?.paid_at
        ? "paid"
        : "unpaid";

  let amountPaidDeclared = Math.max(0, Math.round(Number(input.amountPaidCents) || 0));
  if (paymentSettlement === "unpaid") amountPaidDeclared = 0;
  if (paymentSettlement === "paid") amountPaidDeclared = originalTotal;
  if (paymentSettlement === "partial") {
    if (amountPaidDeclared <= 0 || amountPaidDeclared >= originalTotal) {
      return {
        ok: false,
        status: 400,
        error: "partial_payment_invalid",
        message_cs: "U částečné úhrady zadejte skutečně uhrazenou částku větší než 0 a menší než fakturovaná částka.",
      };
    }
  }

  const settlementRecap = invoice
    ? computeAccountingSettlementRecap({
        originalInvoiceCents: originalTotal,
        priorCorrectedCents: priorCorrected,
        stornoAmountCents,
        paymentMode: paymentSettlement,
        amountPaidCents: amountPaidDeclared,
      })
    : null;

  if (
    settlementRecap &&
    paymentSettlement === "paid" &&
    po.payment_status !== "paid" &&
    !invoice?.paid_at &&
    invoice?.status !== "paid"
  ) {
    /* Admin explicitly confirms full payment — allowed with audit trail below. */
  }

  const stornoId = newStornoRecordId();
  const stornoNumber = await allocatePremiumStornoNumber(db, nowIso);
  const idempotencyKey =
    input.idempotencyKey?.trim() || "accounting_cancel:" + input.orderId + ":" + stornoNumber;

  let creditNoteId: string | null = null;
  if (invoice && correctionCents !== 0) {
    creditNoteId = newCreditNoteId();
    const creditNoteNumber = await allocatePremiumCreditNoteNumber(db, nowIso);
    const newTotal = originalTotal + correctionCents;
    const paidSnapshot = paymentSettlement;
    const amountPaid = settlementRecap?.amount_paid_cents ?? 0;

    await db
      .prepare(
        `INSERT INTO premium_credit_notes (
          credit_note_id, order_id, invoice_id, credit_note_number, correction_cents, original_total_cents,
          new_total_cents, reason, payment_status_snapshot, amount_paid_cents_snapshot, issued_at,
          correction_effective_at, created_at, created_by, idempotency_key
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        creditNoteId,
        input.orderId,
        invoice.invoice_id,
        creditNoteNumber,
        correctionCents,
        originalTotal,
        newTotal,
        reason,
        paidSnapshot,
        amountPaid,
        nowIso,
        nowIso,
        nowIso,
        input.actorUserId,
        idempotencyKey + ":credit"
      )
      .run();
  }

  await db
    .prepare(
      `INSERT INTO premium_order_storno_records (
        storno_id, order_id, storno_number, storno_kind, reason, invoice_id, credit_note_id,
        correction_cents, idempotency_key, created_at, created_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      stornoId,
      input.orderId,
      stornoNumber,
      "cancellation",
      reason,
      invoice?.invoice_id ?? null,
      creditNoteId,
      correctionCents,
      idempotencyKey,
      nowIso,
      input.actorUserId
    )
    .run();

  await db
    .prepare(
      `UPDATE premium_selected_orders SET workflow_status = 'cancelled', accounting_cancelled_at = ?,
       accounting_cancelled_by = ?, accounting_cancellation_reason = ?, updated_at = ? WHERE order_id = ?`
    )
    .bind(nowIso, input.actorUserId, reason, nowIso, input.orderId)
    .run();

  if (invoice && correctionCents !== 0) {
    const newTotal = originalTotal + correctionCents;
    if (newTotal <= 0) {
      await db
        .prepare("UPDATE invoices SET status = 'cancelled', updated_at = ? WHERE invoice_id = ? AND status != 'cancelled'")
        .bind(nowIso, invoice.invoice_id)
        .run();
    }
  }

  const paymentChanged =
    (paymentSettlement === "paid" && po.payment_status !== "paid") ||
    (paymentSettlement === "unpaid" && po.payment_status === "paid") ||
    paymentSettlement === "partial";
  if (paymentSettlement === "paid" || paymentSettlement === "unpaid") {
    const nextPay = paymentSettlement;
    if (po.payment_status !== nextPay) {
      await db
        .prepare(
          `UPDATE premium_selected_orders SET payment_status = ?, paid_at = ?, paid_by = ?, updated_at = ? WHERE order_id = ?`
        )
        .bind(
          nextPay,
          nextPay === "paid" ? nowIso : null,
          nextPay === "paid" ? input.actorUserId : null,
          nowIso,
          input.orderId
        )
        .run();
    }
  }

  await appendPremiumOrderEvent(db, {
    orderId: input.orderId,
    eventType: "order_accounting_cancelled",
    actorUserId: input.actorUserId,
    payload: {
      reason,
      storno_number: stornoNumber,
      credit_note_id: creditNoteId,
      correction_cents: correctionCents,
      storno_amount_cents: stornoAmountCents,
      payment_settlement: paymentSettlement,
      payment_settlement_label: paymentSettlementLabelCs(paymentSettlement),
      amount_paid_cents: settlementRecap?.amount_paid_cents ?? null,
      overpayment_cents: settlementRecap?.overpayment_cents ?? null,
      remaining_due_cents: settlementRecap?.remaining_due_cents ?? null,
      payment_changed: paymentChanged,
      actor_label: input.actorUserId,
    },
  });

  if (paymentChanged && (paymentSettlement === "paid" || paymentSettlement === "unpaid" || paymentSettlement === "partial")) {
    await appendPremiumOrderEvent(db, {
      orderId: input.orderId,
      eventType: "payment_status_changed",
      actorUserId: input.actorUserId,
      payload: {
        from: po.payment_status || "unpaid",
        to: paymentSettlement === "partial" ? "partial_declared" : paymentSettlement,
        amount_paid_cents: settlementRecap?.amount_paid_cents ?? 0,
        context: "accounting_cancel",
        actor_label: input.actorUserId,
      },
    });
  }

  await insertAuditLog(
    db,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: input.actorUserId,
      operation: "premium_order_accounting_cancelled",
      objectType: "premium_order",
      objectId: input.orderId,
      before: { workflow_status: po.workflow_status },
      after: {
        workflow_status: "cancelled",
        storno_number: stornoNumber,
        credit_note_id: creditNoteId,
        correction_cents: correctionCents,
      },
      result: "success",
    })
  );

  const docEnqueue = await enqueuePremiumStornoDocuments(env, input.orderId, input.actorUserId, {
    stornoKind: "cancellation",
    forceRetryIncomplete: false,
  });

  return {
    ok: true,
    idempotent: false,
    storno_id: stornoId,
    storno_number: stornoNumber,
    credit_note_id: creditNoteId,
    document_enqueue: { ok: docEnqueue.ok },
  };
}

export type PremiumRejectedInvoiceSettlementInput = {
  orderId: string;
  actorUserId: string;
  reason: string;
  correctionCents: number;
  idempotencyKey?: string;
};

/** Credit note for rejected order that already has an invoice — explicit correction only. */
export async function executePremiumRejectedOrderInvoiceSettlement(
  env: Env,
  input: PremiumRejectedInvoiceSettlementInput
): Promise<PremiumAccountingCancelResult> {
  if (!env.DB) return { ok: false, status: 503, error: "auth_not_configured" };
  const reason = input.reason.trim();
  if (!reason) return { ok: false, status: 400, error: "reason_required" };

  let correctionCents = Math.round(Number(input.correctionCents));
  if (!Number.isFinite(correctionCents) || correctionCents === 0) {
    return {
      ok: false,
      status: 400,
      error: "correction_required",
      message_cs: "Zadejte nenulovou opravovanou částku dobropisu.",
    };
  }
  if (correctionCents > 0) correctionCents = -Math.abs(correctionCents);

  const db = env.DB;
  const nowIso = new Date().toISOString();

  const po = await db
    .prepare("SELECT workflow_status FROM premium_selected_orders WHERE order_id = ?")
    .bind(input.orderId)
    .first<{ workflow_status: string }>();
  if (!po) return { ok: false, status: 404, error: "premium_order_not_found" };
  if (po.workflow_status !== "rejected") {
    return {
      ok: false,
      status: 409,
      error: "not_rejected",
      message_cs: "Dobropis u zamítnuté objednávky lze vystavit pouze pro stav Zamítnuto.",
    };
  }

  const storno = await db
    .prepare(
      "SELECT storno_id, storno_number, credit_note_id, invoice_id FROM premium_order_storno_records WHERE order_id = ?"
    )
    .bind(input.orderId)
    .first<{ storno_id: string; storno_number: string; credit_note_id: string | null; invoice_id: string | null }>();
  if (!storno) {
    return { ok: false, status: 409, error: "storno_missing", message_cs: "Chybí záznam storna — nejdříve zamítněte objednávku." };
  }
  if (storno.credit_note_id) {
    const docEnqueue = await enqueuePremiumStornoDocuments(env, input.orderId, input.actorUserId, {
      stornoKind: "rejection",
      forceRetryIncomplete: true,
    });
    return {
      ok: true,
      idempotent: true,
      storno_id: storno.storno_id,
      storno_number: storno.storno_number,
      credit_note_id: storno.credit_note_id,
      document_enqueue: { ok: docEnqueue.ok },
    };
  }

  let invoice = storno.invoice_id
    ? await db
        .prepare(
          "SELECT invoice_id, invoice_number, total_cents, currency, status, paid_at FROM invoices WHERE invoice_id = ? LIMIT 1"
        )
        .bind(storno.invoice_id)
        .first<{
          invoice_id: string;
          invoice_number: string;
          total_cents: number;
          currency: string;
          status: string;
          paid_at: string | null;
        }>()
    : null;
  if (!invoice) {
    invoice = await db
      .prepare(
        "SELECT invoice_id, invoice_number, total_cents, currency, status, paid_at FROM invoices WHERE order_id = ? ORDER BY created_at DESC LIMIT 1"
      )
      .bind(input.orderId)
      .first<{
        invoice_id: string;
        invoice_number: string;
        total_cents: number;
        currency: string;
        status: string;
        paid_at: string | null;
      }>();
  }
  if (!invoice) {
    return {
      ok: false,
      status: 409,
      error: "no_invoice",
      message_cs: "U této zamítnuté objednávky není faktura — dobropis se nevystavuje.",
    };
  }

  const originalTotal = Math.round(Number(invoice.total_cents) || 0);
  if (Math.abs(correctionCents) > originalTotal) {
    return {
      ok: false,
      status: 400,
      error: "correction_exceeds_invoice",
      message_cs: "Opravovaná částka nesmí překročit původně fakturovanou částku.",
    };
  }

  const creditNoteId = newCreditNoteId();
  const creditNoteNumber = await allocatePremiumCreditNoteNumber(db, nowIso);
  const newTotal = originalTotal + correctionCents;
  const paymentRow = await db
    .prepare("SELECT payment_status FROM premium_selected_orders WHERE order_id = ?")
    .bind(input.orderId)
    .first<{ payment_status: string | null }>();
  const paidSnapshot =
    paymentRow?.payment_status === "paid" || invoice.status === "paid" || invoice.paid_at ? "paid" : "unpaid";
  const amountPaid = paidSnapshot === "paid" ? originalTotal : 0;
  const idempotencyKey =
    input.idempotencyKey?.trim() || "rejected_settlement:" + input.orderId + ":" + creditNoteNumber;

  await db
    .prepare(
      `INSERT INTO premium_credit_notes (
        credit_note_id, order_id, invoice_id, credit_note_number, correction_cents, original_total_cents,
        new_total_cents, reason, payment_status_snapshot, amount_paid_cents_snapshot, issued_at,
        correction_effective_at, created_at, created_by, idempotency_key
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      creditNoteId,
      input.orderId,
      invoice.invoice_id,
      creditNoteNumber,
      correctionCents,
      originalTotal,
      newTotal,
      reason,
      paidSnapshot,
      amountPaid,
      nowIso,
      nowIso,
      nowIso,
      input.actorUserId,
      idempotencyKey
    )
    .run();

  await db
    .prepare(
      "UPDATE premium_order_storno_records SET credit_note_id = ?, correction_cents = ?, invoice_id = ? WHERE storno_id = ?"
    )
    .bind(creditNoteId, correctionCents, invoice.invoice_id, storno.storno_id)
    .run();

  await db
    .prepare("UPDATE invoices SET status = 'cancelled', updated_at = ? WHERE invoice_id = ? AND status != 'cancelled'")
    .bind(nowIso, invoice.invoice_id)
    .run();

  await appendPremiumOrderEvent(db, {
    orderId: input.orderId,
    eventType: "rejected_order_credit_note_issued",
    actorUserId: input.actorUserId,
    payload: {
      reason,
      credit_note_id: creditNoteId,
      correction_cents: correctionCents,
      storno_number: storno.storno_number,
      actor_label: input.actorUserId,
    },
  });

  await insertAuditLog(
    db,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: input.actorUserId,
      operation: "premium_rejected_order_credit_note",
      objectType: "premium_order",
      objectId: input.orderId,
      before: { credit_note_id: null },
      after: { credit_note_id: creditNoteId, correction_cents: correctionCents },
      result: "success",
    })
  );

  const docEnqueue = await enqueuePremiumStornoDocuments(env, input.orderId, input.actorUserId, {
    stornoKind: "rejection",
    forceRetryIncomplete: false,
  });

  return {
    ok: true,
    idempotent: false,
    storno_id: storno.storno_id,
    storno_number: storno.storno_number,
    credit_note_id: creditNoteId,
    document_enqueue: { ok: docEnqueue.ok },
  };
}

/** Storno PDF after reject — never auto-issues credit note (invoice settlement is explicit). */
export async function ensurePremiumRejectionStornoRecord(
  env: Env,
  input: { orderId: string; actorUserId: string; reason: string | null; idempotencyKey?: string }
): Promise<{ storno_id: string; storno_number: string } | null> {
  if (!env.DB) return null;
  const db = env.DB;
  const existing = await db
    .prepare("SELECT storno_id, storno_number FROM premium_order_storno_records WHERE order_id = ?")
    .bind(input.orderId)
    .first<{ storno_id: string; storno_number: string }>();
  if (existing) return existing;

  const po = await db
    .prepare("SELECT workflow_status FROM premium_selected_orders WHERE order_id = ?")
    .bind(input.orderId)
    .first<{ workflow_status: string }>();
  if (!po || po.workflow_status !== "rejected") return null;

  const nowIso = new Date().toISOString();
  const stornoId = newStornoRecordId();
  const stornoNumber = await allocatePremiumStornoNumber(db, nowIso);
  const idempotencyKey = input.idempotencyKey?.trim() || "rejection_storno:" + input.orderId;

  const invoice = await db
    .prepare("SELECT invoice_id, total_cents FROM invoices WHERE order_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(input.orderId)
    .first<{ invoice_id: string; total_cents: number }>();

  await db
    .prepare(
      `INSERT INTO premium_order_storno_records (
        storno_id, order_id, storno_number, storno_kind, reason, invoice_id, credit_note_id,
        correction_cents, idempotency_key, created_at, created_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      stornoId,
      input.orderId,
      stornoNumber,
      "rejection",
      input.reason,
      invoice?.invoice_id ?? null,
      null,
      0,
      idempotencyKey,
      nowIso,
      input.actorUserId
    )
    .run();

  await enqueuePremiumStornoDocuments(env, input.orderId, input.actorUserId, {
    stornoKind: "rejection",
    forceRetryIncomplete: false,
  });

  return { storno_id: stornoId, storno_number: stornoNumber };
}
