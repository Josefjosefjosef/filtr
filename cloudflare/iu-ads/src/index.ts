import { handleBootstrapMainAdmin } from "./admin-bootstrap";
import {
  handleLogin,
  handleLogout,
  handleLogoutAllSessions,
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
import { handleCreateExportJob, handleDownloadExportJob, handleGetExportJob, handleListExportJobs } from "./admin-exports";
import { handleFinanceSummary } from "./admin-finance";
import {
  handleCreateCampaign,
  handleGetCampaign,
  handleListCampaigns,
  handleTransitionCampaign,
  handleUpdateCampaign,
} from "./admin-campaigns";
import {
  handleCreateCampaignPlacement,
  handleCreatePlacementType,
  handleGetPlacementType,
  handleListCampaignPlacements,
  handleListPlacementTypes,
  handleUpdateCampaignPlacement,
  handleUpdatePlacementType,
} from "./admin-placements";
import { handleCancelReservation, handleCreateReservation, handleGetReservation, handleListReservations } from "./admin-reservations";
import {
  handleApproveCreative,
  handleGetCreative,
  handleGetCreativeAccess,
  handleListCreatives,
  handleRejectCreative,
  handleUploadCreative,
} from "./admin-creatives";
import { handlePreviewCampaign } from "./admin-preview";
import { handleGetCampaignStats, handleGetStatsSummary } from "./admin-stats";
import {
  handleGetCode,
  handleIssueCode,
  handleListCodes,
  handleRegenCode,
  handleRevokeCode,
} from "./admin-codes";
import { handleGetAdminDashboard } from "./admin-dashboard";
import { handleAdminSearch } from "./admin-search";
import { handleGetAdminCalendar } from "./admin-calendar";
import {
  handleAckAlert,
  handleGenerateAlerts,
  handleGetAlert,
  handleListAlerts,
  handleResolveAlert,
  runAlertsCron,
} from "./admin-alerts";
import {
  handleBackupDrill,
  handleCreateBackup,
  handleGetBackup,
  handleListBackups,
  handlePruneBackups,
} from "./admin-backup";
import { handleGetAdminNav } from "./admin-nav";
import { buildAdminShellHtml } from "./admin-ui";
import { handleClientLogin, handleClientLogout, handleClientMe } from "./client-auth";
import { handleClientReport, handleClientReportExport } from "./client-report";
import { buildClientShellHtml } from "./client-ui";
import { isDeviceCategory, selectPublicAds } from "./delivery-engine";
import { resolveFeatureFlags, isPublicDeliveryActive } from "./feature-flags";
import { emptyPublicDelivery, sanitizePublicAds, assertNoForbiddenPublicKeys } from "./isolation";
import { parseAccessQuery, verifyObjectAccess } from "./signed-access";
import { finalizeSecurityHeaders, generateNonce, htmlSecurityHeaders } from "./security-headers";
import type { Env, PublicAd, PublicDeliveryResponse } from "./types";

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
    return finalizeSecurityHeaders(request, await handleFetch(request, env));
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runAlertsCron(env).then((result) => {
        // Structured log only — never secrets.
        console.log("iu-ads alerts cron", JSON.stringify(result));
      })
    );
  },
};

async function handleFetch(request: Request, env: Env): Promise<Response> {
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
          schemaVersion: "0010",
          safeMode: flags.safeMode,
          publicDeliveryEnabled: flags.publicDeliveryEnabled,
          adminApiEnabled: flags.adminApiEnabled,
          clientApiEnabled: flags.clientApiEnabled,
          r2: {
            creativesBound,
            documentsBound,
            backupsBound: !!env.BACKUPS,
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

    // Admin SPA-lite shell. Always GET-able; live API calls still require ADS_ADMIN_API_ENABLED + session.
    if (path === "/admin" || path === "/admin/index.html") {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      const nonce = generateNonce();
      return new Response(buildAdminShellHtml(nonce), {
        status: 200,
        headers: htmlSecurityHeaders(request, nonce),
      });
    }

    // Client portal SPA-lite. Always GET-able; live API calls still require ADS_CLIENT_API_ENABLED + secrets.
    if (path === "/client" || path === "/client/index.html") {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      const nonce = generateNonce();
      return new Response(buildClientShellHtml(nonce), {
        status: 200,
        headers: htmlSecurityHeaders(request, nonce),
      });
    }

    if (path === "/v1/public/ads/delivery") {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      const active = isPublicDeliveryActive(flags);
      const body: PublicDeliveryResponse = emptyPublicDelivery(active, flags.safeMode);
      if (!active) {
        const headers = { ...NO_STORE, ...corsHeaders(env) };
        return new Response(JSON.stringify(body), { status: 200, headers });
      }
      const deviceParam = url.searchParams.get("device");
      let rawAds: PublicAd[] = [];
      if (isDeviceCategory(deviceParam)) {
        try {
          rawAds = await selectPublicAds(env, url.origin, { device: deviceParam, section: url.searchParams.get("section") });
        } catch {
          // Delivery engine failures must never surface as a 500 or a partial leak — fail closed to no ads.
          rawAds = [];
        }
      }
      body.ads = sanitizePublicAds(rawAds);
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

    // One-time main_admin bootstrap (Worker D1 batch). Requires ADS_BOOTSTRAP_TOKEN.
    // Outside /v1/admin so it does not depend on ADS_ADMIN_API_ENABLED.
    if (path === "/v1/internal/bootstrap/main-admin") {
      return handleBootstrapMainAdmin(request, env);
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
      if (path === "/v1/admin/auth/sessions/revoke-all" && method === "POST") {
        return handleLogoutAllSessions(request, env);
      }
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
      const exportDownloadMatch = path.match(/^\/v1\/admin\/exports\/([^/]+)\/download$/);
      if (exportDownloadMatch && method === "GET") return handleDownloadExportJob(request, env, exportDownloadMatch[1]);
      const exportIdMatch = path.match(/^\/v1\/admin\/exports\/([^/]+)$/);
      if (exportIdMatch && method === "GET") return handleGetExportJob(request, env, exportIdMatch[1]);

      if (path === "/v1/admin/finance/summary" && method === "GET") return handleFinanceSummary(request, env, url);

      // Etapa 4 — campaigns/placements/reservations/creatives (kap. 7,10,11,12,13,21,43).
      if (path === "/v1/admin/campaigns" && method === "GET") return handleListCampaigns(request, env, url);
      if (path === "/v1/admin/campaigns" && method === "POST") return handleCreateCampaign(request, env);
      const campaignTransitionMatch = path.match(/^\/v1\/admin\/campaigns\/([^/]+)\/transition$/);
      if (campaignTransitionMatch && method === "POST") return handleTransitionCampaign(request, env, campaignTransitionMatch[1]);
      const campaignPlacementItemMatch = path.match(/^\/v1\/admin\/campaigns\/([^/]+)\/placements\/([^/]+)$/);
      if (campaignPlacementItemMatch && method === "PATCH") {
        return handleUpdateCampaignPlacement(request, env, campaignPlacementItemMatch[1], campaignPlacementItemMatch[2]);
      }
      const campaignPlacementsMatch = path.match(/^\/v1\/admin\/campaigns\/([^/]+)\/placements$/);
      if (campaignPlacementsMatch && method === "GET") return handleListCampaignPlacements(request, env, campaignPlacementsMatch[1]);
      if (campaignPlacementsMatch && method === "POST") return handleCreateCampaignPlacement(request, env, campaignPlacementsMatch[1]);
      const campaignIdMatch = path.match(/^\/v1\/admin\/campaigns\/([^/]+)$/);
      if (campaignIdMatch && method === "GET") return handleGetCampaign(request, env, campaignIdMatch[1]);
      if (campaignIdMatch && method === "PATCH") return handleUpdateCampaign(request, env, campaignIdMatch[1]);

      if (path === "/v1/admin/placement-types" && method === "GET") return handleListPlacementTypes(request, env, url);
      if (path === "/v1/admin/placement-types" && method === "POST") return handleCreatePlacementType(request, env);
      const placementTypeIdMatch = path.match(/^\/v1\/admin\/placement-types\/([^/]+)$/);
      if (placementTypeIdMatch && method === "GET") return handleGetPlacementType(request, env, placementTypeIdMatch[1]);
      if (placementTypeIdMatch && method === "PATCH") return handleUpdatePlacementType(request, env, placementTypeIdMatch[1]);

      if (path === "/v1/admin/reservations" && method === "GET") return handleListReservations(request, env, url);
      if (path === "/v1/admin/reservations" && method === "POST") return handleCreateReservation(request, env);
      const reservationCancelMatch = path.match(/^\/v1\/admin\/reservations\/([^/]+)\/cancel$/);
      if (reservationCancelMatch && method === "POST") return handleCancelReservation(request, env, reservationCancelMatch[1]);
      const reservationIdMatch = path.match(/^\/v1\/admin\/reservations\/([^/]+)$/);
      if (reservationIdMatch && method === "GET") return handleGetReservation(request, env, reservationIdMatch[1]);

      if (path === "/v1/admin/creatives" && method === "GET") return handleListCreatives(request, env, url);
      if (path === "/v1/admin/creatives" && method === "POST") return handleUploadCreative(request, env);
      const creativeAccessMatch = path.match(/^\/v1\/admin\/creatives\/([^/]+)\/access$/);
      if (creativeAccessMatch && method === "GET") return handleGetCreativeAccess(request, env, creativeAccessMatch[1]);
      const creativeApproveMatch = path.match(/^\/v1\/admin\/creatives\/([^/]+)\/approve$/);
      if (creativeApproveMatch && method === "POST") return handleApproveCreative(request, env, creativeApproveMatch[1]);
      const creativeRejectMatch = path.match(/^\/v1\/admin\/creatives\/([^/]+)\/reject$/);
      if (creativeRejectMatch && method === "POST") return handleRejectCreative(request, env, creativeRejectMatch[1]);
      const creativeIdMatch = path.match(/^\/v1\/admin\/creatives\/([^/]+)$/);
      if (creativeIdMatch && method === "GET") return handleGetCreative(request, env, creativeIdMatch[1]);

      if (path === "/v1/admin/preview" && method === "POST") return handlePreviewCampaign(request, env);

      // Etapa 6 — measurement/reporting (kap. 20): read-only join against Analytics' aggregate report.
      if (path === "/v1/admin/stats/summary" && method === "GET") return handleGetStatsSummary(request, env, url);
      const statsCampaignMatch = path.match(/^\/v1\/admin\/stats\/campaigns\/([^/]+)$/);
      if (statsCampaignMatch && method === "GET") return handleGetCampaignStats(request, env, url, statsCampaignMatch[1]);

      // Etapa 7 — client access codes (kap. 36): issue/list/regen/revoke (hash-only storage).
      if (path === "/v1/admin/codes" && method === "GET") return handleListCodes(request, env, url);
      if (path === "/v1/admin/codes" && method === "POST") return handleIssueCode(request, env);
      const codeRegenMatch = path.match(/^\/v1\/admin\/codes\/([^/]+)\/regen$/);
      if (codeRegenMatch && method === "POST") return handleRegenCode(request, env, codeRegenMatch[1]);
      const codeRevokeMatch = path.match(/^\/v1\/admin\/codes\/([^/]+)\/revoke$/);
      if (codeRevokeMatch && method === "POST") return handleRevokeCode(request, env, codeRevokeMatch[1]);
      const codeIdMatch = path.match(/^\/v1\/admin\/codes\/([^/]+)$/);
      if (codeIdMatch && method === "GET") return handleGetCode(request, env, codeIdMatch[1]);

      // Etapa 8 — admin ops (kap. 5, 6, 16–19): nav / dashboard / search / calendar / alerts.
      if (path === "/v1/admin/nav" && method === "GET") return handleGetAdminNav(request, env);
      if (path === "/v1/admin/dashboard" && method === "GET") return handleGetAdminDashboard(request, env);
      if (path === "/v1/admin/search" && method === "GET") return handleAdminSearch(request, env, url);
      if (path === "/v1/admin/calendar" && method === "GET") return handleGetAdminCalendar(request, env, url);
      if (path === "/v1/admin/alerts" && method === "GET") return handleListAlerts(request, env, url);
      if (path === "/v1/admin/alerts/generate" && method === "POST") return handleGenerateAlerts(request, env);
      const alertAckMatch = path.match(/^\/v1\/admin\/alerts\/([^/]+)\/ack$/);
      if (alertAckMatch && method === "POST") return handleAckAlert(request, env, alertAckMatch[1]);
      const alertResolveMatch = path.match(/^\/v1\/admin\/alerts\/([^/]+)\/resolve$/);
      if (alertResolveMatch && method === "POST") return handleResolveAlert(request, env, alertResolveMatch[1]);
      const alertIdMatch = path.match(/^\/v1\/admin\/alerts\/([^/]+)$/);
      if (alertIdMatch && method === "GET") return handleGetAlert(request, env, alertIdMatch[1]);

      // Etapa 9 — backup manifests + restore drill (kap. 34); main_admin via backups.*.
      if (path === "/v1/admin/backups" && method === "GET") return handleListBackups(request, env, url);
      if (path === "/v1/admin/backups" && method === "POST") return handleCreateBackup(request, env);
      if (path === "/v1/admin/backups/prune" && method === "POST") return handlePruneBackups(request, env);
      const backupDrillMatch = path.match(/^\/v1\/admin\/backups\/([^/]+)\/drill$/);
      if (backupDrillMatch && method === "POST") return handleBackupDrill(request, env, backupDrillMatch[1]);
      const backupIdMatch = path.match(/^\/v1\/admin\/backups\/([^/]+)$/);
      if (backupIdMatch && method === "GET") return handleGetBackup(request, env, backupIdMatch[1]);

      return json({ error: "not_found" }, 404);
    }

    // Client portal (Etapa 7, kap. 37–38). Gate: ADS_CLIENT_API_ENABLED + session/code secrets.
    // safeMode only gates Public Ad Delivery — same rule as Admin API.
    if (path.startsWith("/v1/client")) {
      if (!flags.clientApiEnabled) {
        return json({ error: "client_api_disabled" }, 503);
      }
      if (!env.ADS_CLIENT_SESSION_SECRET || !env.ADS_CODE_PEPPER) {
        return json({ error: "auth_not_configured" }, 503);
      }

      const method = request.method;
      if (path === "/v1/client/auth/login" && method === "POST") return handleClientLogin(request, env);
      if (path === "/v1/client/auth/logout" && method === "POST") return handleClientLogout(request, env);
      if (path === "/v1/client/auth/me" && method === "GET") return handleClientMe(request, env);
      if (path === "/v1/client/report" && method === "GET") return handleClientReport(request, env, url);
      if (path === "/v1/client/report/export" && method === "GET") return handleClientReportExport(request, env, url);

      return json({ error: "not_found" }, 404);
    }

    return json({ error: "not_found" }, 404);
}
