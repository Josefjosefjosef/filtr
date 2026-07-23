/**
 * Admin contracts endpoints (Etapa 3, kap. 28). RBAC: contracts.read/contracts.write (sales/main_admin).
 * `legal_verified` is a separate, explicit flag — a contract is never treated as legally
 * final just because its `status` looks final (kap. 28 acceptance test: contract-not-legal-final).
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import type { Env } from "./types";

export const CONTRACT_STATUSES = ["draft", "sent", "signed", "active", "terminated", "expired"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

function isContractStatus(value: unknown): value is ContractStatus {
  return typeof value === "string" && (CONTRACT_STATUSES as readonly string[]).includes(value);
}

type ContractRow = {
  contract_id: string;
  client_id: string;
  order_id: string | null;
  contract_number: string;
  status: string;
  legal_verified: number;
  payload_json: string | null;
  created_at: string;
  updated_at: string;
};

const CONTRACT_COLUMNS =
  "contract_id, client_id, order_id, contract_number, status, legal_verified, payload_json, created_at, updated_at";

function clampLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(200, Math.floor(n));
}

function clampOffset(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function serializeContract(row: ContractRow) {
  return {
    contract_id: row.contract_id,
    client_id: row.client_id,
    order_id: row.order_id,
    contract_number: row.contract_number,
    status: row.status,
    legal_verified: row.legal_verified === 1,
    payload: row.payload_json ? JSON.parse(row.payload_json) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function handleListContracts(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "contracts.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const status = url.searchParams.get("status");
  const clientId = url.searchParams.get("client_id");
  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }
  if (clientId) {
    conditions.push("client_id = ?");
    params.push(clientId);
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  params.push(limit, offset);

  const res = await env.DB.prepare(
    "SELECT " + CONTRACT_COLUMNS + " FROM contracts " + where + " ORDER BY created_at DESC LIMIT ? OFFSET ?"
  )
    .bind(...params)
    .all<ContractRow>();
  return json({ contracts: (res.results || []).map(serializeContract), limit, offset });
}

export async function handleCreateContract(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "contracts.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: { client_id?: unknown; order_id?: unknown; contract_number?: unknown; status?: unknown; payload?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const clientId = typeof body.client_id === "string" ? body.client_id : "";
  if (!clientId) return json({ error: "invalid_client_id" }, 400);
  const clientRow = await env.DB.prepare("SELECT client_id FROM clients WHERE client_id = ?").bind(clientId).first();
  if (!clientRow) return json({ error: "client_not_found" }, 400);

  const contractNumber =
    typeof body.contract_number === "string" && body.contract_number.trim()
      ? body.contract_number.trim()
      : "CTR-" + String(new Date().getFullYear()) + "-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  const existing = await env.DB.prepare("SELECT contract_id FROM contracts WHERE contract_number = ?")
    .bind(contractNumber)
    .first();
  if (existing) return json({ error: "contract_number_taken" }, 409);

  const status = isContractStatus(body.status) ? body.status : "draft";
  const nowIso = new Date().toISOString();
  const contractId = newId("ctr");

  await env.DB.prepare(
    "INSERT INTO contracts (contract_id, client_id, order_id, contract_number, status, legal_verified, payload_json, created_at, updated_at) VALUES (?,?,?,?,?,0,?,?,?)"
  )
    .bind(
      contractId,
      clientId,
      typeof body.order_id === "string" ? body.order_id : null,
      contractNumber,
      status,
      body.payload !== undefined ? JSON.stringify(body.payload) : null,
      nowIso,
      nowIso
    )
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "contract_created",
      objectType: "contract",
      objectId: contractId,
      after: { client_id: clientId, contract_number: contractNumber, status },
      result: "success",
    })
  );

  const row = await env.DB.prepare("SELECT " + CONTRACT_COLUMNS + " FROM contracts WHERE contract_id = ?")
    .bind(contractId)
    .first<ContractRow>();
  return json({ contract: row ? serializeContract(row) : null }, 201);
}

export async function handleGetContract(request: Request, env: Env, contractId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "contracts.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const row = await env.DB.prepare("SELECT " + CONTRACT_COLUMNS + " FROM contracts WHERE contract_id = ?")
    .bind(contractId)
    .first<ContractRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json({ contract: serializeContract(row) });
}

export async function handleUpdateContract(request: Request, env: Env, contractId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "contracts.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const before = await env.DB.prepare("SELECT " + CONTRACT_COLUMNS + " FROM contracts WHERE contract_id = ?")
    .bind(contractId)
    .first<ContractRow>();
  if (!before) return json({ error: "not_found" }, 404);

  let body: { status?: unknown; legal_verified?: unknown; payload?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (body.status !== undefined && !isContractStatus(body.status)) return json({ error: "invalid_status" }, 400);

  const status = isContractStatus(body.status) ? body.status : before.status;
  const legalVerified = typeof body.legal_verified === "boolean" ? (body.legal_verified ? 1 : 0) : before.legal_verified;
  const payloadJson = body.payload !== undefined ? JSON.stringify(body.payload) : before.payload_json;
  const nowIso = new Date().toISOString();

  await env.DB.prepare("UPDATE contracts SET status = ?, legal_verified = ?, payload_json = ?, updated_at = ? WHERE contract_id = ?")
    .bind(status, legalVerified, payloadJson, nowIso, contractId)
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "contract_updated",
      objectType: "contract",
      objectId: contractId,
      before: { status: before.status, legal_verified: before.legal_verified === 1 },
      after: { status, legal_verified: legalVerified === 1 },
      result: "success",
    })
  );

  const after = await env.DB.prepare("SELECT " + CONTRACT_COLUMNS + " FROM contracts WHERE contract_id = ?")
    .bind(contractId)
    .first<ContractRow>();
  return json({ contract: after ? serializeContract(after) : null });
}
