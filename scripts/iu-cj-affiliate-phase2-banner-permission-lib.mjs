#!/usr/bin/env node
/** Banner display permission + publication gates (offline; flags ≠ evidence). */
import { stripHtmlLite } from "./iu-cj-affiliate-phase2-lib.mjs";

export const INTENDED_USE = Object.freeze({
  localPreview: "local_preview_metadata_and_asset_if_licensed",
  publicDisplay: "public_site_embed",
  localStorage: "local_archive_of_creative_file",
  officialSourceFetch: "download_image_from_official_creative_source",
});

const ALL_USES = Object.values(INTENDED_USE);

function parseRefDate(ref) {
  if (ref instanceof Date) return ref;
  return new Date(String(ref || ""));
}

function parseDocDateField(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { present: false, date: null, invalid: false };
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return { present: true, date: null, invalid: true };
  return { present: true, date: d, invalid: false };
}

/** Proven partner binding on the document itself (storage map key is not evidence). */
export function documentHasProvenPartnerLinkage(doc, requestedAdvertiserCid) {
  const cid = String(requestedAdvertiserCid || "").trim();
  if (!cid) return { proven: false, reason: "missing_requested_advertiser_cid" };
  const docCid = String(doc?.advertiserCid || "").trim();
  if (docCid && docCid !== cid) return { proven: false, reason: "document_advertiser_cid_mismatch" };
  if (docCid && docCid === cid) return { proven: true, via: "document_advertiser_cid" };
  const scoped = doc?.appliesToAdvertiserCids;
  if (Array.isArray(scoped) && scoped.length > 0) {
    if (scoped.map(String).includes(cid)) return { proven: true, via: "applies_to_advertiser_cids" };
    return { proven: false, reason: "document_scope_excludes_advertiser" };
  }
  const authoritative = String(doc?.authoritativeAdvertiserCid || doc?.programTermsAdvertiserCid || "").trim();
  if (authoritative) {
    if (authoritative === cid) return { proven: true, via: "authoritative_advertiser_binding" };
    return { proven: false, reason: "authoritative_advertiser_binding_mismatch" };
  }
  return { proven: false, reason: "missing_document_partner_linkage" };
}

export function documentMatchesAdvertiserScope(doc, requestedAdvertiserCid) {
  const link = documentHasProvenPartnerLinkage(doc, requestedAdvertiserCid);
  return { match: link.proven, reason: link.reason || link.via || "missing_document_partner_linkage" };
}

function documentMatchesAccountParty(doc, ctx) {
  const expectedPub = String(ctx?.publisherCid || "").trim();
  const docPub = String(doc?.publisherCid || "").trim();
  if (docPub && !expectedPub) return { match: false, reason: "missing_expected_publisher_cid_for_account_document" };
  if (docPub && expectedPub && docPub !== expectedPub) return { match: false, reason: "account_document_publisher_cid_mismatch" };
  return { match: true };
}

function findProvisionForGrant(doc, grant) {
  if (!doc?.provisions || !grant?.provisionId) return null;
  return doc.provisions.find((p) => String(p.provisionId) === String(grant.provisionId)) || null;
}

/**
 * Unified document + provision scope (account and partner). Exclusion → denied; conflict/incomplete → unknown.
 */
export function assessDocumentProvisionScope(layerScope, doc, provision, advertiserCid, ctx) {
  const cid = String(advertiserCid || "").trim();
  if (!cid) return { outcome: "unknown", reason: "missing_advertiser_cid" };
  if (!doc || !provision) return { outcome: "unknown", reason: "missing_document_or_provision" };

  const docEx = (Array.isArray(doc.excludesAdvertiserCids) ? doc.excludesAdvertiserCids : []).map(String);
  const provEx = (Array.isArray(provision.excludesAdvertiserCids) ? provision.excludesAdvertiserCids : []).map(String);
  if (docEx.includes(cid) || provEx.includes(cid)) {
    return { outcome: "denied", reason: "documented_advertiser_exclusion" };
  }

  const docAdv = String(doc.advertiserCid || "").trim();
  const docList = Array.isArray(doc.appliesToAdvertiserCids) ? doc.appliesToAdvertiserCids.map(String) : null;
  const provList = Array.isArray(provision.appliesToAdvertiserCids) ? provision.appliesToAdvertiserCids.map(String) : null;

  if (docList && docList.length > 0) {
    const inDocList = docList.includes(cid);
    if (docAdv && docAdv === cid && !inDocList) {
      return { outcome: "unknown", reason: "document_advertiser_cid_conflicts_with_applies_to_list" };
    }
    if (!inDocList) {
      return { outcome: "denied", reason: "document_applies_to_list_excludes_advertiser" };
    }
  }

  if (layerScope === "account") {
    const party = documentMatchesAccountParty(doc, ctx);
    if (!party.match) return { outcome: "unknown", reason: party.reason };
    if (docAdv && docAdv !== cid) return { outcome: "unknown", reason: "account_document_advertiser_cid_not_target" };
  }

  if (provList && provList.length > 0) {
    if (!provList.includes(cid)) {
      return { outcome: "denied", reason: "provision_applies_to_list_excludes_advertiser" };
    }
    if (layerScope === "account") {
      const party = documentMatchesAccountParty(doc, ctx);
      if (!party.match) return { outcome: "unknown", reason: party.reason };
    }
    if (layerScope === "advertiser") {
      const link = documentHasProvenPartnerLinkage(doc, cid);
      if (!link.proven) return { outcome: "unknown", reason: link.reason };
    }
    return { outcome: "allowed", via: "provision_advertiser_cid_list" };
  }

  if (provision.appliesToAllJoinedAdvertisers === true) {
    if (layerScope === "account") {
      const party = documentMatchesAccountParty(doc, ctx);
      if (!party.match) return { outcome: "unknown", reason: party.reason };
      if (docAdv && docAdv !== cid) return { outcome: "unknown", reason: "account_document_advertiser_cid_not_target" };
      return { outcome: "allowed", via: "applies_to_all_joined_advertisers" };
    }
  }

  if (layerScope === "advertiser") {
    const link = documentHasProvenPartnerLinkage(doc, cid);
    if (!link.proven) return { outcome: "unknown", reason: link.reason };
    if (docAdv && docAdv !== cid) return { outcome: "unknown", reason: "document_advertiser_cid_not_target" };
    return { outcome: "allowed", via: link.via || "advertiser_traceable_provision" };
  }

  return { outcome: "unknown", reason: "provision_not_in_scope_for_advertiser" };
}

/** Traceable document record — required for allowed/denied (not bare read:true). */
export function isTraceableDocumentEvidence(doc) {
  if (!doc || doc.read !== true) return false;
  if (!String(doc.documentId || "").trim()) return false;
  if (!String(doc.source || "").trim()) return false;
  if (!Array.isArray(doc.provisions) || doc.provisions.length === 0) return false;
  for (const p of doc.provisions) {
    if (!String(p.provisionId || "").trim()) return false;
    if (!Array.isArray(p.intendedUses) || p.intendedUses.length === 0) return false;
    if (!String(p.summary || "").trim()) return false;
  }
  return true;
}

export function documentEffectiveAtReference(doc, refDate) {
  const ref = parseRefDate(refDate);
  if (Number.isNaN(ref.getTime())) return { effective: false, reason: "invalid_reference_date" };
  const fromP = parseDocDateField(doc?.effectiveFrom);
  const toP = parseDocDateField(doc?.effectiveTo);
  if (fromP.invalid || toP.invalid) return { effective: false, reason: "invalid_document_date_field" };
  if (!fromP.present && !toP.present) return { effective: false, reason: "missing_document_effective_window" };
  if (!fromP.present && toP.present) {
    if (ref > toP.date) return { effective: false, reason: "document_expired" };
    return { effective: false, reason: "missing_effective_from_cannot_prove_reference_usability" };
  }
  if (fromP.present && ref < fromP.date) return { effective: false, reason: "document_not_yet_effective" };
  if (toP.present && ref > toP.date) return { effective: false, reason: "document_expired" };
  return { effective: true, openEnded: fromP.present && !toP.present };
}

function provisionsTargetingIntendedUse(doc, intendedUse) {
  if (!doc?.provisions) return [];
  const found = [];
  for (const p of doc.provisions) {
    let hits = false;
    for (const use of p.intendedUses || []) {
      if (use === intendedUse || use === "all_banner_intended_uses") hits = true;
    }
    if (hits) found.push(p);
  }
  return found;
}

function lookupSupersedesBasisRecord(ctx, basisDocumentId) {
  const key = String(basisDocumentId || "").trim();
  const registry = ctx?.supersedesEvidenceRegistry || {};
  return registry[key] || null;
}

function verifyConfirmReadTraceableBasis(confirm, excludedProvision, parentDoc) {
  const td = confirm?.readTraceableDocument;
  if (!td || td.read !== true) {
    return { ok: false, reason: "supersedes_confirm_missing_read_traceable_document" };
  }
  if (!String(td.documentId || "").trim() || !String(td.source || "").trim()) {
    return { ok: false, reason: "supersedes_confirm_incomplete_traceable_document" };
  }
  if (!String(td.parentProvisionId || "").trim() || String(td.parentProvisionId) !== String(excludedProvision?.provisionId || "")) {
    return { ok: false, reason: "supersedes_confirm_parent_provision_mismatch" };
  }
  if (String(td.parentDocumentId || "").trim() && String(td.parentDocumentId) !== String(parentDoc?.documentId || "")) {
    return { ok: false, reason: "supersedes_confirm_parent_document_mismatch" };
  }
  if (!Array.isArray(td.provisions) || td.provisions.length === 0) {
    return { ok: false, reason: "supersedes_confirm_missing_read_provisions" };
  }
  if (!isTraceableDocumentEvidence({ read: true, documentId: td.documentId, source: td.source, provisions: td.provisions })) {
    return { ok: false, reason: "supersedes_confirm_traceable_document_invalid" };
  }
  const citation = String(confirm.citation || "").trim();
  const citedProvisionId = citation.includes("§") ? citation.split("§").pop() : String(td.citesProvisionId || "").trim();
  if (!citedProvisionId) {
    return { ok: false, reason: "supersedes_confirm_missing_citation" };
  }
  if (!td.provisions.some((p) => String(p.provisionId) === citedProvisionId)) {
    return { ok: false, reason: "supersedes_confirm_citation_provision_not_in_read_document" };
  }
  if (String(confirm.citation || "").trim() && !String(confirm.citation).startsWith(String(td.documentId))) {
    return { ok: false, reason: "supersedes_confirm_citation_document_mismatch" };
  }
  return { ok: true, citation: String(td.documentId) + "§" + citedProvisionId };
}

/** Verifiable supersession of a documented exclusion (metadata pointers ≠ read basis). */
export function verifyProvisionSupersedesExclusion(
  replacingProvision,
  excludedProvision,
  intendedUse,
  advertiserCid,
  refDate,
  ctx,
  parentDoc
) {
  const targetId = String(excludedProvision?.provisionId || "");
  const ids = (replacingProvision?.supersedesProvisionIds || []).map(String);
  if (!targetId || !ids.includes(targetId)) {
    return { valid: false, reason: "no_link_to_replaced_provision" };
  }
  const ev = replacingProvision?.supersedesEvidence;
  if (!ev || ev.read !== true) {
    return { valid: false, reason: "missing_verifiable_supersedes_basis" };
  }
  if (!String(ev.basisDocumentId || "").trim() || !String(ev.basisSource || "").trim()) {
    return { valid: false, reason: "incomplete_supersedes_basis_metadata" };
  }
  const documentedUses = replacingProvision?.supersedesIntendedUses;
  if (!Array.isArray(documentedUses) || documentedUses.length === 0 || !documentedUses.includes(intendedUse)) {
    return { valid: false, reason: "supersedes_intended_use_not_documented" };
  }
  const partnerScope = replacingProvision?.supersedesForAdvertiserCids;
  if (!Array.isArray(partnerScope) || partnerScope.length === 0 || !partnerScope.map(String).includes(String(advertiserCid))) {
    return { valid: false, reason: "supersedes_partner_scope_not_documented" };
  }
  const metaEff = documentEffectiveAtReference(
    { effectiveFrom: ev.effectiveFrom, effectiveTo: ev.effectiveTo ?? null },
    refDate
  );
  if (!metaEff.effective) {
    return { valid: false, reason: metaEff.reason || "supersedes_basis_not_effective_at_reference" };
  }

  const record = lookupSupersedesBasisRecord(ctx, ev.basisDocumentId);
  if (!record || record.read !== true) {
    return { valid: false, reason: "supersedes_basis_not_on_record" };
  }
  if (String(record.documentId || "").trim() !== String(ev.basisDocumentId).trim()) {
    return { valid: false, reason: "supersedes_basis_document_id_mismatch" };
  }
  if (String(record.source || "").trim() !== String(ev.basisSource || "").trim()) {
    return { valid: false, reason: "supersedes_basis_source_mismatch" };
  }
  const recordEff = documentEffectiveAtReference(record, refDate);
  if (!recordEff.effective) {
    return { valid: false, reason: recordEff.reason || "supersedes_basis_record_not_effective_at_reference" };
  }

  const confirms = Array.isArray(record.confirmsSupersedes) ? record.confirmsSupersedes : [];
  const confirm = confirms.find(
    (c) =>
      String(c.replacesProvisionId || "") === targetId &&
      Array.isArray(c.intendedUses) &&
      c.intendedUses.includes(intendedUse) &&
      Array.isArray(c.advertiserCids) &&
      c.advertiserCids.map(String).includes(String(advertiserCid)) &&
      c.confirmsReplacement === true
  );
  if (!confirm) {
    return { valid: false, reason: "supersedes_basis_does_not_confirm_replacement" };
  }

  const traceCheck = verifyConfirmReadTraceableBasis(confirm, excludedProvision, parentDoc);
  if (!traceCheck.ok) {
    return { valid: false, reason: traceCheck.reason };
  }

  const limitations = Array.isArray(record.limitations) ? record.limitations : [];
  for (const lim of limitations) {
    const deniedCids = (lim.deniesAdvertiserCids || lim.excludesAdvertiserCids || []).map(String);
    if (deniedCids.includes(String(advertiserCid))) {
      return { valid: false, reason: "supersedes_basis_contains_limitation_for_advertiser" };
    }
    const deniedUses = lim.deniesIntendedUses || [];
    if (Array.isArray(deniedUses) && deniedUses.includes(intendedUse)) {
      return { valid: false, reason: "supersedes_basis_contains_limitation_for_intended_use" };
    }
  }

  return {
    valid: true,
    via: "documented_supersedes_exclusion",
    confirmSummary: confirm.summary || null,
    readCitation: traceCheck.citation,
  };
}

/** Order-independent merge of all provisions touching one intended use on one document. */
export function resolveDocumentProvisionsForIntendedUse(layerScope, doc, intendedUse, advertiserCid, ctx) {
  const refDate = parseRefDate(ctx?.referenceAssessmentAt ?? new Date());
  const provisions = provisionsTargetingIntendedUse(doc, intendedUse);
  if (provisions.length === 0) {
    return { state: "unknown", reason: "no_provision_for_use", citations: [] };
  }

  const assessed = provisions.map((p) => ({
    provision: p,
    assess: assessDocumentProvisionScope(layerScope, doc, p, advertiserCid, ctx),
    citation: doc.documentId + "§" + p.provisionId,
  }));
  const citations = assessed.map((a) => a.citation);

  const exclusions = assessed.filter(
    (a) => a.assess.outcome === "denied" && a.assess.reason === "documented_advertiser_exclusion"
  );
  const allows = assessed.filter((a) => a.assess.outcome === "allowed");
  const unknowns = assessed.filter((a) => a.assess.outcome === "unknown");
  const otherDenied = assessed.filter(
    (a) => a.assess.outcome === "denied" && a.assess.reason !== "documented_advertiser_exclusion"
  );

  if (otherDenied.length > 0 && allows.length > 0) {
    return {
      state: "unknown",
      reason: "unresolved_provision_conflict_limitation_vs_grant",
      citation: citations.join("+"),
      citations,
      provisionSummary: assessed.map((a) => a.provision.summary).join("; "),
    };
  }

  if (otherDenied.length > 0) {
    const d = otherDenied[0];
    return {
      state: "denied",
      reason: d.assess.reason,
      citation: d.citation,
      citations,
      provisionSummary: d.provision.summary,
    };
  }

  if (exclusions.length > 0) {
    const unsuperseded = exclusions.filter((ex) => {
      const superseding = allows.filter((al) => {
        const v = verifyProvisionSupersedesExclusion(al.provision, ex.provision, intendedUse, advertiserCid, refDate, ctx, doc);
        return v.valid === true;
      });
      return superseding.length === 0;
    });
    if (unsuperseded.length > 0) {
      const ex = unsuperseded[0];
      let state = "denied";
      let reason = "documented_advertiser_exclusion";
      for (const al of allows) {
        const ids = (al.provision?.supersedesProvisionIds || []).map(String);
        if (!ids.includes(String(ex.provision.provisionId))) continue;
        const v = verifyProvisionSupersedesExclusion(al.provision, ex.provision, intendedUse, advertiserCid, refDate, ctx, doc);
        if (
          !v.valid &&
          (v.reason === "missing_verifiable_supersedes_basis" ||
            v.reason === "incomplete_supersedes_basis_metadata" ||
            v.reason === "no_link_to_replaced_provision" ||
            v.reason === "supersedes_basis_not_on_record" ||
            v.reason === "supersedes_basis_does_not_confirm_replacement" ||
            v.reason === "supersedes_basis_document_id_mismatch" ||
            v.reason === "supersedes_basis_source_mismatch" ||
            v.reason === "supersedes_basis_record_not_effective_at_reference" ||
            v.reason === "supersedes_basis_contains_limitation_for_advertiser" ||
            v.reason === "supersedes_basis_contains_limitation_for_intended_use" ||
            v.reason === "supersedes_confirm_missing_read_traceable_document" ||
            v.reason === "supersedes_confirm_incomplete_traceable_document" ||
            v.reason === "supersedes_confirm_parent_provision_mismatch" ||
            v.reason === "supersedes_confirm_parent_document_mismatch" ||
            v.reason === "supersedes_confirm_missing_read_provisions" ||
            v.reason === "supersedes_confirm_traceable_document_invalid" ||
            v.reason === "supersedes_confirm_missing_citation" ||
            v.reason === "supersedes_confirm_citation_provision_not_in_read_document" ||
            v.reason === "supersedes_confirm_citation_document_mismatch")
        ) {
          state = "unknown";
          reason = v.reason;
          break;
        }
      }
      return {
        state,
        reason,
        citation: ex.citation,
        citations,
        provisionSummary: ex.provision.summary,
      };
    }
  }

  if (allows.length > 0 && unknowns.length === 0) {
    return {
      state: "allowed",
      reason: allows[0].assess.via || "traceable_provision",
      citation: allows.map((a) => a.citation).join("+"),
      citations,
      provisionSummary: allows.map((a) => a.provision.summary).join("; "),
    };
  }

  if (unknowns.length > 0) {
    return {
      state: "unknown",
      reason: allows.length > 0 ? "unresolved_provision_conflict" : unknowns[0].assess.reason,
      citation: citations.join("+"),
      citations,
      provisionSummary: assessed.map((a) => a.provision.summary).join("; "),
    };
  }

  return { state: "unknown", reason: "no_applicable_traceable_provision", citations };
}

export function grantsFromDocumentEvidence(doc, refDate) {
  const grants = Object.fromEntries(
    ALL_USES.map((u) => [u, { state: "unknown", reason: "no_provision_for_use", provisionRefs: [] }])
  );
  if (!doc) return grants;
  if (doc.denial === true && isTraceableDocumentEvidence(doc)) {
    for (const u of ALL_USES) grants[u] = { state: "denied", reason: "documented_denial", citation: doc.documentId };
    return grants;
  }
  if (!isTraceableDocumentEvidence(doc)) return grants;
  const eff = documentEffectiveAtReference(doc, refDate);
  if (!eff.effective) {
    for (const u of ALL_USES) grants[u] = { state: "unknown", reason: eff.reason, provisionRefs: [] };
    return grants;
  }
  for (const p of doc.provisions) {
    for (const use of p.intendedUses) {
      if (!ALL_USES.includes(use) && use !== "all_banner_intended_uses") continue;
      const targets = use === "all_banner_intended_uses" ? ALL_USES : [use];
      for (const t of targets) {
        const citation = doc.documentId + "§" + p.provisionId;
        grants[t].provisionRefs.push({
          provisionId: p.provisionId,
          citation,
          provisionSummary: p.summary,
          appliesToAllJoinedAdvertisers: p.appliesToAllJoinedAdvertisers === true,
        });
        grants[t].state = "provisions_aggregate";
        grants[t].reason = "merged_provision_resolution_required";
        grants[t].citation = grants[t].provisionRefs.map((r) => r.citation).join("+");
      }
    }
  }
  return grants;
}

export function mergeGrantLayers(layers, intendedUse) {
  for (const layer of layers) {
    if (!layer?.grants) continue;
    const g = layer.grants[intendedUse];
    if (g?.state === "denied") {
      return { state: "denied", reason: g.reason, citation: g.citation || null, layer: layer.scope };
    }
  }
  for (const layer of layers) {
    if (!layer?.grants) continue;
    const g = layer.grants[intendedUse];
    if (g?.state === "allowed") {
      return {
        state: "allowed",
        reason: g.reason,
        citation: g.citation || null,
        layer: layer.scope,
        provisionSummary: g.provisionSummary || null,
      };
    }
  }
  return { state: "unknown", reason: "no_traceable_grant_for_intended_use" };
}

export function basisFromDocumentEvidence(scope, doc, refDate, extra = {}) {
  if (doc?.denial === true && isTraceableDocumentEvidence(doc)) {
    return {
      scope,
      state: "denied",
      source: doc.source,
      documentId: doc.documentId,
      version: doc.version || null,
      grants: grantsFromDocumentEvidence(doc, refDate),
      ...extra,
    };
  }
  if (!isTraceableDocumentEvidence(doc)) {
    return {
      scope,
      state: "unknown",
      source: doc?.source || null,
      reason: "missing_traceable_document_or_provisions",
      grants: grantsFromDocumentEvidence(null, refDate),
      ...extra,
    };
  }
  const grants = grantsFromDocumentEvidence(doc, refDate);
  const anyAllowed = ALL_USES.some(
    (u) => grants[u].state === "provisions_aggregate" && (grants[u].provisionRefs?.length || 0) > 0
  );
  const mayCoverClass =
    doc.provisions.some((p) => p.appliesToAllJoinedAdvertisers === true)
      ? "explicit_account_provision_covers_joined_advertiser_programs"
      : null;
  return {
    scope,
    state: anyAllowed ? "allowed" : "unknown",
    source: doc.source,
    documentId: doc.documentId,
    version: doc.version || null,
    effectiveFrom: doc.effectiveFrom || null,
    effectiveTo: doc.effectiveTo || null,
    grants,
    mayCoverClass,
    traceDocument: doc,
    ...extra,
  };
}

export function accountLevelBannerBasis(licenseBasis, refDate = new Date()) {
  const ev = licenseBasis?.bannerPermissionEvidence?.account;
  if (ev) {
    return basisFromDocumentEvidence("account", ev, refDate);
  }
  const flaggedAllowed = licenseBasis?.imageUsageAllowedState === "allowed";
  const psaReadFlag = licenseBasis?.documents?.publisherServiceAgreement?.read === true;
  if (flaggedAllowed || psaReadFlag) {
    return {
      scope: "account",
      state: "unknown",
      source: "cj-phase2-image-license-basis.json",
      reason: "flags_without_traceable_provisions_insufficient",
      grants: grantsFromDocumentEvidence(null, refDate),
      mayCoverClass: null,
    };
  }
  if (licenseBasis?.imageUsageAllowedState === "denied" && licenseBasis?.bannerPermissionEvidence?.accountDenial) {
    return basisFromDocumentEvidence("account", licenseBasis.bannerPermissionEvidence.accountDenial, refDate);
  }
  return {
    scope: "account",
    state: "unknown",
    source: "cj-phase2-image-license-basis.json",
    reason: "executed_psa_and_banner_provisions_not_on_record",
    grants: grantsFromDocumentEvidence(null, refDate),
    mayCoverClass: null,
  };
}

export function advertiserLevelBannerBasis(advertiserCid, licenseBasis, programTermsProbe, refDate = new Date()) {
  const cid = String(advertiserCid || "");
  const byCid = licenseBasis?.bannerPermissionEvidence?.byAdvertiserCid?.[cid];
  if (byCid) {
    const scopeMatch = documentMatchesAdvertiserScope(byCid, cid);
    if (!scopeMatch.match) {
      return {
        scope: "advertiser",
        advertiserCid: cid,
        state: "unknown",
        source: byCid.source || null,
        reason: scopeMatch.reason,
        grants: grantsFromDocumentEvidence(null, refDate),
      };
    }
    return basisFromDocumentEvidence("advertiser", byCid, refDate, { advertiserCid: cid });
  }
  const probeCid = String(programTermsProbe?.contractsSummary?.[0]?.advertiserId || "");
  if (cid && probeCid && cid === probeCid) {
    const len = programTermsProbe?.contractsSummary?.[0]?.specialTermsBodyLength ?? 0;
    return {
      scope: "advertiser",
      advertiserCid: cid,
      state: "unknown",
      source: "cj-phase2-program-terms-probe.json",
      reason: len > 0 ? "api_special_terms_not_extracted_to_provisions" : "special_terms_body_empty_not_grant",
      grants: grantsFromDocumentEvidence(null, refDate),
      programTermsStatus: programTermsProbe?.contractsSummary?.[0]?.status || null,
    };
  }
  return {
    scope: "advertiser",
    advertiserCid: cid,
    state: "unknown",
    source: null,
    reason: "no_traceable_advertiser_program_terms_for_cid",
    grants: grantsFromDocumentEvidence(null, refDate),
  };
}

export function buildContractEvidenceInventory(licenseBasis, programTermsProbe) {
  const docs = licenseBasis?.documents || {};
  const probeCid = programTermsProbe?.contractsSummary?.[0]?.advertiserId || "7084105";
  return {
    capturedAt: licenseBasis?.generatedAt || null,
    readSources: [
      docs.productFeedImageLinkField?.read
        ? {
            id: "cj_product_feed_image_link_field_doc",
            kind: "public_technical_doc",
            source: docs.productFeedImageLinkField.source,
            scopeNote: docs.productFeedImageLinkField.scope,
            grantsDisplayRights: false,
          }
        : null,
      docs.programTermsApiResponse?.read
        ? {
            id: "program_terms_api_partial",
            kind: "account_api_response",
            advertiserCidInProbe: String(probeCid),
            effectiveWindow: docs.programTermsApiResponse.effectiveWindow || null,
            specialTermsBodyLength: docs.programTermsApiResponse.specialTermsBodyLength ?? null,
            mediaProvisionsExtracted: docs.programTermsApiResponse.mediaProvisionsExtracted === true,
            grantsDisplayRights: false,
            note: "Empty specialTerms.body is neither grant nor denial per stored basis",
          }
        : null,
      licenseBasis?.bannerPermissionEvidence?.account
        ? {
            id: licenseBasis.bannerPermissionEvidence.account.documentId,
            kind: "traceable_account_evidence",
            traceable: isTraceableDocumentEvidence(licenseBasis.bannerPermissionEvidence.account),
          }
        : {
            id: "publisher_service_agreement_executed",
            kind: "account_contract",
            read: docs.publisherServiceAgreement?.read === true,
            traceable: isTraceableDocumentEvidence(licenseBasis?.bannerPermissionEvidence?.account),
            referenceOnly: docs.publisherServiceAgreement?.officialReferenceOnly || null,
            grantsDisplayRights: false,
          },
    ].filter(Boolean),
    notReadNamedDocuments: licenseBasis?.namedDocumentsStillNeeded || [],
    emptySpecialTermsSemantics: licenseBasis?.emptySpecialTermsSemantics || null,
    perCreativeConsentAssumedRequired: false,
    unknownIsNotDenial: true,
  };
}

function resolveIntendedUseGrant(ctx, intendedUse) {
  const advertiserCid = String(ctx.advertiserCid || ctx.advertiserBasis?.advertiserCid || "");
  const layers = [
    { layer: ctx.creativeBasis, scope: "creative" },
    { layer: ctx.advertiserBasis, scope: "advertiser" },
    { layer: ctx.accountBasis, scope: "account" },
  ].filter((x) => x.layer);

  for (const { layer } of layers) {
    const g = layer.grants?.[intendedUse];
    if (g?.state === "denied") {
      return { state: "denied", reason: g.reason, citation: g.citation, layer: layer.scope };
    }
  }

  let partnerDocBlocksAccountFallback = false;

  const advLayer = ctx.advertiserBasis;
  if (advLayer && String(advLayer.advertiserCid || "") === advertiserCid && advLayer.traceDocument) {
    const doc = advLayer.traceDocument;
    if (provisionsTargetingIntendedUse(doc, intendedUse).length > 0) {
      const merged = resolveDocumentProvisionsForIntendedUse("advertiser", doc, intendedUse, advertiserCid, ctx);
      if (merged.state === "denied") {
        return {
          state: "denied",
          reason: merged.reason,
          citation: merged.citation,
          citations: merged.citations,
          layer: "advertiser",
          provisionSummary: merged.provisionSummary,
        };
      }
      if (merged.state === "unknown") {
        partnerDocBlocksAccountFallback = true;
        return {
          state: "unknown",
          reason: merged.reason,
          citation: merged.citation,
          citations: merged.citations,
          layer: "advertiser",
          provisionSummary: merged.provisionSummary,
        };
      }
      if (merged.state === "allowed") {
        return {
          state: "allowed",
          reason: merged.reason,
          citation: merged.citation,
          citations: merged.citations,
          layer: "advertiser",
          provisionSummary: merged.provisionSummary,
        };
      }
    }
  }

  if (partnerDocBlocksAccountFallback) {
    return { state: "unknown", reason: "partner_evidence_unresolved_blocks_account_fallback" };
  }

  for (const { layer, scope } of layers) {
    if (scope !== "account" && scope !== "creative") continue;
    const g = layer.grants?.[intendedUse];
    if (scope === "account") {
      const doc = layer.traceDocument;
      if (!doc || provisionsTargetingIntendedUse(doc, intendedUse).length === 0) continue;
      const merged = resolveDocumentProvisionsForIntendedUse("account", doc, intendedUse, advertiserCid, ctx);
      if (merged.state === "denied") {
        return {
          state: "denied",
          reason: merged.reason,
          citation: merged.citation,
          citations: merged.citations,
          layer: scope,
          provisionSummary: merged.provisionSummary,
        };
      }
      if (merged.state !== "allowed") continue;
      return {
        state: "allowed",
        reason: merged.reason,
        citation: merged.citation,
        citations: merged.citations,
        layer: scope,
        provisionSummary: merged.provisionSummary,
      };
    }
    if (scope === "creative" && g?.state === "allowed") {
      return { state: "allowed", reason: g.reason, citation: g.citation, layer: scope, provisionSummary: g.provisionSummary };
    }
  }
  return { state: "unknown", reason: "no_applicable_traceable_provision_for_intended_use" };
}

export function evaluateIntendedUsePermission(ctx, intendedUse) {
  const resolved = resolveIntendedUseGrant(ctx, intendedUse);
  return { intendedUse, ...resolved };
}

export function evaluatePublicationGates(row, ctx, refCouponGate) {
  const blockers = [];
  const advisories = [];
  const role = row.bannerRole || "";
  const isGeneralCreative = role === "A_partner_general_banner";
  const isCouponCampaign = role === "C_coupon_campaign_banner";
  const isTimeBoundAction = role.startsWith("B_") || isCouponCampaign;
  const action = row.actionValidity || {};

  const push = (id, category, detail) => blockers.push({ id, category, detail: detail || null });

  const permDisplay = evaluateIntendedUsePermission(ctx, INTENDED_USE.publicDisplay);
  if (permDisplay.state === "denied") push("display_permission_denied", "permission", permDisplay.citation);
  else if (permDisplay.state !== "allowed") push("display_permission_unknown", "permission", permDisplay.reason);

  const permStorage = evaluateIntendedUsePermission(ctx, INTENDED_USE.localStorage);
  const permFetch = evaluateIntendedUsePermission(ctx, INTENDED_USE.officialSourceFetch);
  const localImage = row.technicalAvailability?.localImageFile;
  const creativeAlreadyLocal = Boolean(localImage);

  if (creativeAlreadyLocal) {
    if (permStorage.state === "denied") push("storage_permission_denied", "permission", permStorage.citation);
    else if (permStorage.state !== "allowed") push("storage_permission_unknown", "permission", permStorage.reason);
  } else {
    if (permFetch.state === "denied") push("fetch_permission_denied", "permission", permFetch.citation);
    else if (permFetch.state !== "allowed") push("fetch_permission_unknown", "permission", permFetch.reason);
    push("no_local_licensed_banner_asset", "asset", null);
  }

  const technicalComplete = Boolean(row.affiliateClickUrlPresent) && row.relationshipStatus === "joined";
  if (!technicalComplete) push("incomplete_tracking_row", "technical", null);

  if (row.publicationReadiness?.competitorDestinationBlocked) {
    push("competitor_destination", "destination", null);
  }

  if (row.partnerLinkVerified !== true) {
    push("storefront_partner_link_not_verified", "integrity", "competitor_clear_not_proof_of_partner_or_link");
  }
  const tc = String(row.marketTargeting || "").toUpperCase();
  const czSignal = tc.includes("CZ") || (row.storeHost || "").endsWith(".cz") || row.languageHint === "CZ";
  if (isCouponCampaign && czSignal && row.czDeliveryDocumented !== true) {
    push("cz_delivery_and_territorial_validity_unknown", "market", "targeting_or_cz_tld_not_proof_of_delivery");
  } else if (isCouponCampaign && !czSignal && row.czAudienceRelevanceDocumented !== true) {
    push("cz_audience_relevance_unknown", "market", null);
  }

  if (isCouponCampaign && action.state === "not_applicable") {
    push("coupon_action_validity_not_applicable_rejected", "time", "not_applicable_only_for_general_creatives");
  } else if (isTimeBoundAction && !isGeneralCreative) {
    if (action.state === "documented_inactive") push("action_expired", "time", action.reason);
    else if (action.state === "documented_not_yet_active") push("action_future", "time", action.reason);
    else if (action.state === "unknown") push("action_validity_unknown", "time", action.reason);
    else if (action.state === "partially_documented_period") {
      push("action_validity_unverified", "time", action.partialEndKind || action.reason);
    } else if (action.state === "not_applicable") {
      push("action_validity_not_applicable_for_campaign", "time", action.state);
    } else if (action.state !== "documented_active_in_window") {
      push("action_validity_not_approved", "time", action.state);
    }
  }

  if (isCouponCampaign) {
    const gate = refCouponGate?.czCouponPublishEligibility;
    if (refCouponGate == null) push("coupon_gate_assessment_missing", "coupon", null);
    else if (gate === "ineligible" || gate === "blocked") push("coupon_gate_ineligible", "coupon", gate);
    else if (gate === "unknown") push("coupon_gate_unknown", "coupon", null);
    else if (gate !== "eligible") push("coupon_gate_not_approved", "coupon", String(gate));
  }

  const scopeType = row.scopeSummary?.scopeType || null;
  const isSubsetCouponAction =
    isCouponCampaign &&
    (scopeType === "category_or_subset_restricted" ||
      scopeType === "selected_models" ||
      /vybran/i.test(String(row.linkName || "")));
  if (isSubsetCouponAction) {
    advisories.push("subset_coupon_action_do_not_treat_as_whole_sortiment_product_card");
  }

  const blocking = blockers.length > 0;
  return {
    state: blocking ? "not_ready" : "ready_pending_manual_confirmation",
    blockers,
    advisories,
    permissionPublicDisplay: permDisplay,
  };
}

export function evaluateBannerBatchDimensions(row, ctx, refCouponGate) {
  const publicationReadiness = evaluatePublicationGates(row, ctx, refCouponGate);
  const technicalComplete = Boolean(row.affiliateClickUrlPresent) && row.relationshipStatus === "joined";
  const imageAsset = row.technicalAvailability?.localImageFile ? "local_file_present" : "no_local_banner_image_in_state_dir";
  const storeOk = !row.publicationReadiness?.competitorDestinationBlocked;
  const tc = String(row.marketTargeting || "").toUpperCase();
  const czSignal = tc.includes("CZ") || (row.storeHost || "").endsWith(".cz") || row.languageHint === "CZ";
  const scopeType = row.scopeSummary?.scopeType || null;
  const isSubsetCouponAction =
    row.bannerRole === "C_coupon_campaign_banner" &&
    (scopeType === "category_or_subset_restricted" ||
      scopeType === "selected_models" ||
      /vybran/i.test(String(row.linkName || "")));

  return {
    technicalRowComplete: technicalComplete,
    imageAssetAvailability: imageAsset,
    permission: {
      account: ctx.accountBasis,
      advertiser: ctx.advertiserBasis,
      creative: ctx.creativeBasis || null,
      intendedUses: {
        localPreview: evaluateIntendedUsePermission(ctx, INTENDED_USE.localPreview),
        publicDisplay: evaluateIntendedUsePermission(ctx, INTENDED_USE.publicDisplay),
        localStorage: evaluateIntendedUsePermission(ctx, INTENDED_USE.localStorage),
        officialSourceFetch: evaluateIntendedUsePermission(ctx, INTENDED_USE.officialSourceFetch),
      },
    },
    partnerLinkStore: { storeHost: row.storeHost, competitorBlocked: !storeOk },
    czMarketSignal: {
      state: czSignal ? "cz_targeting_or_storefront_signal_present" : "no_cz_signal",
      note: "Targeting alone does not prove CZ delivery or coupon territorial validity",
    },
    actionValidity: row.actionValidity,
    isSubsetCouponAction,
    publicationReadiness,
  };
}

export function buildPermissionContextForAdvertiser(advertiserCid, licenseBasis, programTermsProbe, refDate = new Date()) {
  const cid = String(advertiserCid || "");
  const publisherCid =
    String(licenseBasis?.accountPublisherCid || licenseBasis?.publisherCid || "").trim() || null;
  return {
    advertiserCid: cid,
    publisherCid,
    referenceAssessmentAt: refDate,
    supersedesEvidenceRegistry: licenseBasis?.bannerPermissionEvidence?.supersedesByBasisDocumentId || {},
    accountBasis: accountLevelBannerBasis(licenseBasis, refDate),
    advertiserBasis: advertiserLevelBannerBasis(cid, licenseBasis, programTermsProbe, refDate),
    creativeBasis: null,
    explicitCreativeDenial: false,
  };
}

/** Synthetic traceable evidence for offline regression only. */
export function buildSyntheticTraceableDocument({
  documentId,
  source,
  version,
  effectiveFrom,
  effectiveTo,
  provisions,
  coversJoinedAdvertiserCreatives,
  advertiserCid,
  appliesToAdvertiserCids,
  authoritativeAdvertiserCid,
  programTermsAdvertiserCid,
  publisherCid,
  excludesAdvertiserCids,
  denial,
}) {
  return {
    read: true,
    documentId,
    source,
    version: version || "1",
    effectiveFrom: effectiveFrom ?? null,
    effectiveTo: effectiveTo ?? null,
    provisions,
    coversJoinedAdvertiserCreatives: coversJoinedAdvertiserCreatives === true,
    advertiserCid: advertiserCid ?? null,
    appliesToAdvertiserCids: appliesToAdvertiserCids ?? null,
    authoritativeAdvertiserCid: authoritativeAdvertiserCid ?? null,
    programTermsAdvertiserCid: programTermsAdvertiserCid ?? null,
    publisherCid: publisherCid ?? null,
    excludesAdvertiserCids: excludesAdvertiserCids ?? null,
    denial: denial === true,
  };
}

export function aggregateBatchPermissionCounts(recordsWithBatch) {
  const counts = {
    rowsAssessed: recordsWithBatch.length,
    permissionPublicDisplay: { unknown: 0, denied: 0, allowed: 0 },
    permissionOfficialFetch: { unknown: 0, denied: 0, allowed: 0 },
    publicationNotReady: 0,
    publicationBlockerIds: {},
    imageAssetMissing: 0,
    subsetCouponBannerRows: 0,
  };
  for (const r of recordsWithBatch) {
    const b = r.batchAssessment;
    const pd = b.permission.intendedUses.publicDisplay.state;
    counts.permissionPublicDisplay[pd] = (counts.permissionPublicDisplay[pd] || 0) + 1;
    const pf = b.permission.intendedUses.officialSourceFetch.state;
    counts.permissionOfficialFetch[pf] = (counts.permissionOfficialFetch[pf] || 0) + 1;
    if (b.imageAssetAvailability !== "local_file_present") counts.imageAssetMissing += 1;
    if (b.isSubsetCouponAction) counts.subsetCouponBannerRows += 1;
    if (b.publicationReadiness.state !== "ready_pending_manual_confirmation") counts.publicationNotReady += 1;
    for (const bl of b.publicationReadiness.blockers) {
      counts.publicationBlockerIds[bl.id] = (counts.publicationBlockerIds[bl.id] || 0) + 1;
    }
  }
  return counts;
}

export function bannersCoverableBySharedAccountBasis(accountBasis, records) {
  if (accountBasis.state !== "allowed" || !accountBasis.mayCoverClass) {
    return { coverable: false, reason: "account_basis_not_allowed", rowCount: 0 };
  }
  return {
    coverable: true,
    reason: accountBasis.mayCoverClass,
    rowCount: records.filter((r) => r.relationshipStatus === "joined").length,
    note: "Advertiser-specific terms still required per CID — not transferred across partners",
  };
}

export function buildYvesCaseAssessment(row, ctx, dossier) {
  const batch = evaluateBannerBatchDimensions(row, ctx, row.publicationReadiness?.couponTextGate || null);
  const fetch = batch.permission.intendedUses.officialSourceFetch;
  return {
    aid: "17365226",
    advertiserCid: "5124968",
    storedCopy: "Dny Yves-rocher_1+1 na vybrané produkty",
    couponCode: "YRDAYS26",
    actionMeaning: {
      documented: dossier?.conditionsAssessment?.documented || {},
      notInferred: dossier?.conditionsAssessment?.unknownOrNotInferred || {},
    },
    creativeImage: {
      localRelativePath: null,
      fetchAttempted: false,
      fetchBlockedReason:
        fetch.state !== "allowed"
          ? "fetch_not_allowed_" + fetch.state + "_missing_traceable_terms_for_cid_5124968"
          : "no_official_image_url_in_export",
      officialImageUrlInExport: false,
    },
    localPreviewPath: "cj-phase2-banner-yves-17365226-local-preview.html",
    batchAssessment: batch,
    userDocumentStep: {
      namedDocument:
        "Executed Program Terms for advertiser CID 5124968 (Yves-rocher.cz) including promotional/trademark/banner clauses",
      oneStep:
        "From logged-in CJ publisher account, archive executed Program Terms for joined program 5124968 to local secure storage (outside repo); do not accept new terms in automation",
    },
  };
}

export function renderYvesLocalPreviewHtml(assessment, esc) {
  const imgBlock = assessment.creativeImage.localRelativePath
    ? '<img src="' + esc(assessment.creativeImage.localRelativePath) + '" alt="local banner asset">'
    : '<div class="ph">[placeholder — chybí lokální soubor; ' + esc(assessment.creativeImage.fetchBlockedReason) + "]</div>";
  return [
    "<!DOCTYPE html><html lang=\"cs\"><head><meta charset=\"utf-8\"><title>Yves Rocher — místní náhled AID 17365226</title>",
    "<style>body{font-family:system-ui,sans-serif;margin:1rem;max-width:720px}",
    ".ph{background:#eee;border:1px dashed #888;min-height:100px;padding:1rem}",
    "img{max-width:100%;height:auto}</style></head><body>",
    "<h1>Yves-rocher.cz — místní náhled (AID 17365226)</h1>",
    "<p>Bez externích obrázků, skriptů, pixelů a affiliate prokliků.</p>",
    imgBlock,
    "<h2>Text a podmínky (uložený export)</h2>",
    "<pre>" + esc(JSON.stringify(assessment.actionMeaning, null, 2)) + "</pre>",
    "<h2>Oprávnění a připravenost</h2>",
    "<pre>" + esc(JSON.stringify(assessment.batchAssessment, null, 2)) + "</pre>",
    "<p><small>" + esc(assessment.userDocumentStep.oneStep) + "</small></p>",
    "</body></html>",
  ].join("\n");
}
