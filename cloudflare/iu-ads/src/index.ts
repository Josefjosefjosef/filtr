import {
  handleLogin,
  handleLogout,
  handleMe,
  handlePasswordChange,
  handlePasswordResetConfirm,
  handlePasswordResetRequest,
} from "./admin-auth";
import { handleGetAuditLog, handleListAuditLogs } from "./admin-audit";
import {
  handleCreateUser,
  handleGetUser,
  handleListRoles,
  handleListUsers,
  handleSetUserRoles,
  handleUpdateUser,
} from "./admin-users";
import {
  handleCreateClient,
  handleCreateClientContact,
  handleDeleteClientContact,
  handleGetClient,
  handleListClients,
  handleUpdateClient,
  handleUpdateClientContact,
} from "./admin-clients";
import {
  handleConvertInquiryToOrder,
  handleCreateInquiry,
  handleGetInquiry,
  handleListInquiries,
  handleUpdateInquiry,
} from "./admin-inquiries";
import { handleCreateOrder, handleGetOrder, handleListOrders, handleUpdateOrder } from "./admin-orders";
import { handleCreateContract, handleGetContract, handleListContracts, handleUpdateContract } from "./admin-contracts";
import { handleCreateInvoice, handleGetInvoice, handleListInvoices, handleUpdateInvoice } from "./admin-invoices";
import {
  handleGetDocument,
  handleGetDocumentAccess,
  handleListDocuments,
  handleUpdateDocument,
  handleUploadDocument,
} from "./admin-documents";
import { handleCreateRightsConfirmation, handleGetRightsConfirmation, handleListRightsConfirmations } from "./admin-rights";
import {
  handleCreateComplaint,
  handleGetComplaint,
  handleListComplaints,
  handleUpdateComplaint,
} from "./admin-complaints";
import { handleCreateExportJob, handleGetExportJob, handleListExportJobs } from "./admin-exports";
import { handleFinanceSummary } from "./admin-finance";
import { resolveFeatureFlags, isPublicDeliveryActive } from "./feature-flags";
import { emptyPublicDelivery, sanitizePublicAds, assertNoForbiddenPublicKeys } from "./isolation";
import { parseAccessQuery, verifyObjectAccess } from "./signed-access";
import type { Env, PublicDeliveryResponse } from "./types";

const NO_STORE = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: NO_STORE });
}

async function pingDb(env: Env): Promise<boolean> {
  if (!env.DB) return false;
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    return true;
  } catch {
    return false;
  }
}

function corsHeaders(env: Env): HeadersInit {
  const origin = env.CORS_ALLOW_ORIGIN || "https://infouzel.cz";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const flags = resolveFeatureFlags(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...corsHeaders(env), ...NO_STORE } });
    }

    if (path === "/health" || path === "/") {
      const dbOk = await pingDb(env);
      const creativesBound = !!env.CREATIVES;
      const documentsBound = !!env.DOCUMENTS;
      const r2Ok = creativesBound && documentsBound;
      return json(
        {
          ok: dbOk,
          service: "infouzel-ads",
          mode: "ads-business",
          storageMode: dbOk ? "d1" : env.DB ? "unavailable" : "unbound",
          schemaVersion: "0004",
          safeMode: flags.safeMode,
          publicDeliveryEnabled: flags.publicDeliveryEnabled,
          adminApiEnabled: flags.adminApiEnabled,
          clientApiEnabled: flags.clientApiEnabled,
          r2: {
            creativesBound,
            documentsBound,
            ready: r2Ok,
            privateDocumentsPublicUrl: false,
          },
          storesIp: false,
          storesFingerprint: false,
          storesFullUserAgent: false,
          personalizedAds: false,
          retargeting: false,
          profiling: false,
          contextualAdsOnly: true,
        },
        dbOk ? 200 : 503
      );
    }

    if (path === "/v1/public/ads/delivery") {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      const active = isPublicDeliveryActive(flags);
      const body: PublicDeliveryResponse = emptyPublicDelivery(active, flags.safeMode);
      if (!active) {
        const headers = { ...NO_STORE, ...corsHeaders(env) };
        return new Response(JSON.stringify(body), { status: 200, headers });
      }
      body.ads = sanitizePublicAds([]);
      const leaks = assertNoForbiddenPublicKeys(body);
      if (leaks.length) return json({ error: "isolation_violation", leaks }, 500);
      const headers = { ...NO_STORE, ...corsHeaders(env) };
      return new Response(JSON.stringify(body), { status: 200, headers });
    }

    // Private document / creative stream — signed query only; never permanent public R2 URL.
    if (path === "/v1/objects/get") {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      if (!env.ADS_R2_SIGNING_SECRET) return json({ error: "signing_not_configured" }, 503);
      const access = parseAccessQuery(url);
      if (!access) return json({ error: "invalid_access" }, 400);
      const verified = await verifyObjectAccess(env.ADS_R2_SIGNING_SECRET, access);
      if (!verified.ok) return json({ error: "access_denied", reason: verified.reason }, 403);
      const bucket = access.bucket === "DOCUMENTS" ? env.DOCUMENTS : env.CREATIVES;
      if (!bucket) return json({ error: "bucket_unbound" }, 503);
      const obj = await bucket.get(access.objectKey);
      if (!obj) return json({ error: "not_found" }, 404);
      const headers = new Headers();
      headers.set("Cache-Control", "no-store");
      headers.set("X-Content-Type-Options", "nosniff");
      if (obj.httpMetadata?.contentType) headers.set("Content-Type", obj.httpMetadata.contentType);
      return new Response(obj.body, { status: 200, headers });
    }

    // Admin API gate: safeMode only blocks public delivery — never the admin surface.
    if (path.startsWith("/v1/admin")) {
      if (!flags.adminApiEnabled) {
        return json({ error: "admin_api_disabled" }, 503);
      }
      if (!env.ADS_SESSION_SECRET || !env.ADS_PASSWORD_PEPPER) {
        return json({ error: "auth_not_configured" }, 503);
      }

      const method = request.method;

      if (path === "/v1/admin/auth/login" && method === "POST") return handleLogin(request, env);
      if (path === "/v1/admin/auth/logout" && method === "POST") return handleLogout(request, env);
      if (path === "/v1/admin/auth/me" && method === "GET") return handleMe(request, env);
      if (path === "/v1/admin/auth/password-reset/request" && method === "POST") {
        return handlePasswordResetRequest(request, env);
      }
      if (path === "/v1/admin/auth/password-reset/confirm" && method === "POST") {
        return handlePasswordResetConfirm(request, env);
      }
      if (path === "/v1/admin/auth/password/change" && method === "POST") {
        return handlePasswordChange(request, env);
      }

      if (path === "/v1/admin/users" && method === "GET") return handleListUsers(request, env);
      if (path === "/v1/admin/users" && method === "POST") return handleCreateUser(request, env);

      const userRolesMatch = path.match(/^\/v1\/admin\/users\/([^/]+)\/roles$/);
      if (userRolesMatch && method === "PUT") return handleSetUserRoles(request, env, userRolesMatch[1]);

      const userIdMatch = path.match(/^\/v1\/admin\/users\/([^/]+)$/);
      if (userIdMatch && method === "GET") return handleGetUser(request, env, userIdMatch[1]);
      if (userIdMatch && method === "PATCH") return handleUpdateUser(request, env, userIdMatch[1]);

      if (path === "/v1/admin/roles" && method === "GET") return handleListRoles(request, env);

      if (path === "/v1/admin/audit" && method === "GET") return handleListAuditLogs(request, env, url);
      const auditIdMatch = path.match(/^\/v1\/admin\/audit\/([^/]+)$/);
      if (auditIdMatch && method === "GET") return handleGetAuditLog(request, env, auditIdMatch[1]);

      // Etapa 3 — business + documents (kap. 15,22,24-31).
      if (path === "/v1/admin/clients" && method === "GET") return handleListClients(request, env, url);
      if (path === "/v1/admin/clients" && method === "POST") return handleCreateClient(request, env);
      const clientContactMatch = path.match(/^\/v1\/admin\/clients\/([^/]+)\/contacts\/([^/]+)$/);
      if (clientContactMatch && method === "PATCH") {
        return handleUpdateClientContact(request, env, clientContactMatch[1], clientContactMatch[2]);
      }
      if (clientContactMatch && method === "DELETE") {
        return handleDeleteClientContact(request, env, clientContactMatch[1], clientContactMatch[2]);
      }
      const clientContactsMatch = path.match(/^\/v1\/admin\/clients\/([^/]+)\/contacts$/);
      if (clientContactsMatch && method === "POST") return handleCreateClientContact(request, env, clientContactsMatch[1]);
      const clientIdMatch = path.match(/^\/v1\/admin\/clients\/([^/]+)$/);
      if (clientIdMatch && method === "GET") return handleGetClient(request, env, clientIdMatch[1]);
      if (clientIdMatch && method === "PATCH") return handleUpdateClient(request, env, clientIdMatch[1]);

      if (path === "/v1/admin/inquiries" && method === "GET") return handleListInquiries(request, env, url);
      if (path === "/v1/admin/inquiries" && method === "POST") return handleCreateInquiry(request, env);
      const inquiryConvertMatch = path.match(/^\/v1\/admin\/inquiries\/([^/]+)\/convert$/);
      if (inquiryConvertMatch && method === "POST") return handleConvertInquiryToOrder(request, env, inquiryConvertMatch[1]);
      const inquiryIdMatch = path.match(/^\/v1\/admin\/inquiries\/([^/]+)$/);
      if (inquiryIdMatch && method === "GET") return handleGetInquiry(request, env, inquiryIdMatch[1]);
      if (inquiryIdMatch && method === "PATCH") return handleUpdateInquiry(request, env, inquiryIdMatch[1]);

      if (path === "/v1/admin/orders" && method === "GET") return handleListOrders(request, env, url);
      if (path === "/v1/admin/orders" && method === "POST") return handleCreateOrder(request, env);
      const orderIdMatch = path.match(/^\/v1\/admin\/orders\/([^/]+)$/);
      if (orderIdMatch && method === "GET") return handleGetOrder(request, env, orderIdMatch[1]);
      if (orderIdMatch && method === "PATCH") return handleUpdateOrder(request, env, orderIdMatch[1]);

      if (path === "/v1/admin/contracts" && method === "GET") return handleListContracts(request, env, url);
      if (path === "/v1/admin/contracts" && method === "POST") return handleCreateContract(request, env);
      const contractIdMatch = path.match(/^\/v1\/admin\/contracts\/([^/]+)$/);
      if (contractIdMatch && method === "GET") return handleGetContract(request, env, contractIdMatch[1]);
      if (contractIdMatch && method === "PATCH") return handleUpdateContract(request, env, contractIdMatch[1]);

      if (path === "/v1/admin/invoices" && method === "GET") return handleListInvoices(request, env, url);
      if (path === "/v1/admin/invoices" && method === "POST") return handleCreateInvoice(request, env);
      const invoiceIdMatch = path.match(/^\/v1\/admin\/invoices\/([^/]+)$/);
      if (invoiceIdMatch && method === "GET") return handleGetInvoice(request, env, invoiceIdMatch[1]);
      if (invoiceIdMatch && method === "PATCH") return handleUpdateInvoice(request, env, invoiceIdMatch[1]);

      if (path === "/v1/admin/documents" && method === "GET") return handleListDocuments(request, env, url);
      if (path === "/v1/admin/documents" && method === "POST") return handleUploadDocument(request, env);
      const documentAccessMatch = path.match(/^\/v1\/admin\/documents\/([^/]+)\/access$/);
      if (documentAccessMatch && method === "GET") return handleGetDocumentAccess(request, env, documentAccessMatch[1]);
      const documentIdMatch = path.match(/^\/v1\/admin\/documents\/([^/]+)$/);
      if (documentIdMatch && method === "GET") return handleGetDocument(request, env, documentIdMatch[1]);
      if (documentIdMatch && method === "PATCH") return handleUpdateDocument(request, env, documentIdMatch[1]);

      if (path === "/v1/admin/rights" && method === "GET") return handleListRightsConfirmations(request, env, url);
      if (path === "/v1/admin/rights" && method === "POST") return handleCreateRightsConfirmation(request, env);
      const rightsIdMatch = path.match(/^\/v1\/admin\/rights\/([^/]+)$/);
      if (rightsIdMatch && method === "GET") return handleGetRightsConfirmation(request, env, rightsIdMatch[1]);

      if (path === "/v1/admin/complaints" && method === "GET") return handleListComplaints(request, env, url);
      if (path === "/v1/admin/complaints" && method === "POST") return handleCreateComplaint(request, env);
      const complaintIdMatch = path.match(/^\/v1\/admin\/complaints\/([^/]+)$/);
      if (complaintIdMatch && method === "GET") return handleGetComplaint(request, env, complaintIdMatch[1]);
      if (complaintIdMatch && method === "PATCH") return handleUpdateComplaint(request, env, complaintIdMatch[1]);

      if (path === "/v1/admin/exports" && method === "GET") return handleListExportJobs(request, env, url);
      if (path === "/v1/admin/exports" && method === "POST") return handleCreateExportJob(request, env);
      const exportIdMatch = path.match(/^\/v1\/admin\/exports\/([^/]+)$/);
      if (exportIdMatch && method === "GET") return handleGetExportJob(request, env, exportIdMatch[1]);

      if (path === "/v1/admin/finance/summary" && method === "GET") return handleFinanceSummary(request, env, url);

      return json({ error: "not_found" }, 404);
    }

    if (path.startsWith("/v1/client")) {
      if (!flags.clientApiEnabled || flags.safeMode) {
        return json({ error: "client_api_disabled", safeMode: flags.safeMode }, 503);
      }
      return json({ error: "not_implemented" }, 501);
    }

    return json({ error: "not_found" }, 404);
  },
};
