/**
 * Streaming DATEX II SituationPublication parser — one SituationRecord at a time.
 * No full DOM, no full XML string, bounded per-record state + JSONL output.
 */
import fs from "node:fs";
import path from "node:path";
import { createXmlStreamTokenizer, STREAM_XML_LIMITS } from "./stream-xml-tokenizer.mjs";
import { isApplicationDatexNamespace } from "./datex-structure.mjs";
import { mapSituationRecordType } from "./category-map.mjs";
import { classifyTrafficLifecycle } from "./lifecycle.mjs";
import { DEFAULT_LIMITS } from "./config.mjs";

const RECORD_LOCAL = new Set([
  "situationrecord",
  "accident",
  "roadworks",
  "maintenanceworks",
  "constructionworks",
  "abnormaltraffic",
  "trafficconcentration",
  "obstruction",
  "vehicleobstruction",
  "animalpresenceobstruction",
  "infrastructuredamageobstruction",
  "generalobstruction",
  "poorenvironmentconditions",
  "weatherrelatedroadconditions",
  "nonweatherrelatedroadconditions",
  "conditions",
  "roadorcarriagewayorlanemanagement",
  "generalnetworkmanagement",
  "reroutingmanagement",
  "speedmanagement",
  "activity",
  "authorityoperation",
  "publicevent",
  "disturbanceactivity",
  "genericsituationrecord",
]);

const ALLOWED_FIELD = new Set([
  "situationrecordcreationtime",
  "situationrecordversiontime",
  "situationrecordfirstsupplierversiontime",
  "probabilityofoccurrence",
  "severity",
  "validitystatus",
  "overallstarttime",
  "overallendtime",
  "latitude",
  "longitude",
  "specificlocation",
  "alertclocationcountrycode",
  "alertclocationtablenumber",
  "alertcdirectioncoded",
  "offsetdistance",
  "roadnumber",
  "roadname",
  "value",
  "cause",
  "comment",
]);

const ALLOWED_TOP_DIAG = new Set([
  "d2logicalmodel",
  "exchange",
  "payloadpublication",
  "situation",
  "publicationtime",
  "publicationcreator",
  "headerinformation",
  "supplieridentification",
  "country",
  "nationalidentifier",
]);

function clip(s, max) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? t.slice(0, max) : t;
}

function attrType(attrs) {
  for (const a of attrs || []) {
    if (a.local === "type" || /type$/i.test(a.local)) {
      const v = String(a.value || "");
      const i = v.indexOf(":");
      return i >= 0 ? v.slice(i + 1) : v;
    }
  }
  return "";
}

function attrId(attrs) {
  for (const a of attrs || []) {
    if (a.local === "id") return clip(a.value, 200);
  }
  return "";
}

function attrVersion(attrs) {
  for (const a of attrs || []) {
    if (a.local === "version") return clip(a.value, 80);
  }
  return "";
}

function modelBaseFromAttrs(attrs) {
  for (const a of attrs || []) {
    if (a.local === "modelBaseVersion" || a.local.toLowerCase() === "modelbaseversion") {
      return clip(a.value, 40);
    }
  }
  return null;
}

/**
 * @param {string} filePath
 * @param {{
 *   limits?: object,
 *   jsonlPath?: string,
 *   signal?: AbortSignal,
 *   nowIso?: string,
 *   chunkSize?: number,
 *   onRecord?: (rec: object) => void,
 * }} [opts]
 */
export async function parseDatexFileStreaming(filePath, opts = {}) {
  const limits = {
    ...STREAM_XML_LIMITS,
    ...DEFAULT_LIMITS,
    ...(opts.limits || {}),
  };
  const chunkSize = opts.chunkSize || 64 * 1024;
  const nowIso = opts.nowIso || new Date().toISOString();
  const peak = { heapUsed: 0, rss: 0 };
  const sampleMem = () => {
    const m = process.memoryUsage();
    if (m.heapUsed > peak.heapUsed) peak.heapUsed = m.heapUsed;
    if (m.rss > peak.rss) peak.rss = m.rss;
  };

  const diag = {
    rootLocalName: null,
    rootNamespaceUri: null,
    namespaceUris: [],
    detectedDatexMajorVersion: null,
    detectedDatexProfile: null,
    topLevelElementLocalNameCounts: Object.create(null),
    topLevelOverflow: 0,
    candidateSituationElementCount: 0,
    candidateSituationRecordElementCount: 0,
    recordTypeLocalNameCounts: Object.create(null),
    recordTypeOverflow: 0,
    documentWellFormed: false,
    parserFailureCode: null,
    parserCompatibilityReason: null,
    maxDepthObserved: 0,
    totalElementsSeen: 0,
    recordsSeen: 0,
    recordsNormalized: 0,
    recordsRejected: 0,
    inputBytes: 0,
    peakHeapUsedMiB: 0,
    peakRssMiB: 0,
    chunkBoundaryProbePassed: true,
  };

  const nsSeen = new Set();
  let situationId = "";
  let situationVersion = "";
  let inSituation = false;
  let record = null;
  let textTarget = null;
  let jsonlFd = null;
  let jsonlTmp = null;
  let jsonlFinal = opts.jsonlPath || null;
  let categories = Object.create(null);
  let lifecycle = { ACTIVE: 0, FUTURE: 0, ENDED: 0, CANCELLED: 0, UNKNOWN: 0 };
  let withGeometry = 0;
  let withTmcRef = 0;
  let pointGeom = 0;
  let linearGeom = 0;
  let textOnlyLoc = 0;

  if (jsonlFinal) {
    jsonlTmp = jsonlFinal + ".partial";
    jsonlFd = fs.openSync(jsonlTmp, "w", 0o600);
  }

  function bumpTop(name) {
    if (ALLOWED_TOP_DIAG.has(name)) {
      diag.topLevelElementLocalNameCounts[name] =
        (diag.topLevelElementLocalNameCounts[name] || 0) + 1;
    } else if (Object.keys(diag.topLevelElementLocalNameCounts).length < 32) {
      diag.topLevelElementLocalNameCounts[name] =
        (diag.topLevelElementLocalNameCounts[name] || 0) + 1;
    } else diag.topLevelOverflow += 1;
  }

  function bumpType(name) {
    if (RECORD_LOCAL.has(name) || name === "situationrecord") {
      if (Object.keys(diag.recordTypeLocalNameCounts).length < 48 || diag.recordTypeLocalNameCounts[name]) {
        diag.recordTypeLocalNameCounts[name] = (diag.recordTypeLocalNameCounts[name] || 0) + 1;
      } else diag.recordTypeOverflow += 1;
    }
  }

  function finishRecord(okReason) {
    if (!record) return;
    diag.recordsSeen += 1;
    try {
      const fields = record.fields;
      const typeRaw = record.recordType || "SituationRecord";
      const cat = mapSituationRecordType(typeRaw);
      const start = fields.overallstarttime || null;
      const end = fields.overallendtime || null;
      const vStatus = fields.validitystatus || "";
      const life = classifyTrafficLifecycle({
        validFrom: start,
        validTo: end,
        openEnded: !end,
        validityStatus: vStatus,
        explicitlyCancelled: false,
        nowIso,
      });
      const lat = fields.latitude != null ? Number(fields.latitude) : null;
      const lon = fields.longitude != null ? Number(fields.longitude) : null;
      const hasGeom = Number.isFinite(lat) && Number.isFinite(lon);
      const tmcCode = fields.specificlocation != null ? Number(fields.specificlocation) : null;
      const hasTmc = Number.isFinite(tmcCode);
      const normalized = {
        situationId: clip(record.situationId, 200),
        recordId: clip(record.recordId, 200),
        recordVersion: clip(record.recordVersion, 80),
        recordType: clip(typeRaw, 80),
        category: cat.category,
        categoryKnown: cat.known === true,
        validFrom: start ? clip(start, 40) : null,
        validTo: end ? clip(end, 40) : null,
        validityStatus: clip(vStatus, 80),
        lifecycle: life.lifecycle,
        lat: hasGeom ? lat : null,
        lon: hasGeom ? lon : null,
        tmcLocationCode: hasTmc ? tmcCode : null,
        tmcCountryCode: fields.alertclocationcountrycode
          ? Number(fields.alertclocationcountrycode)
          : null,
        tmcTableNumber: fields.alertclocationtablenumber
          ? Number(fields.alertclocationtablenumber)
          : null,
        roadNumber: clip(fields.roadnumber, 40) || null,
        comment: clip(fields.value || fields.comment, 240) || null,
      };
      if (!normalized.situationId || !normalized.recordId) {
        diag.recordsRejected += 1;
      } else {
        diag.recordsNormalized += 1;
        categories[cat.category] = (categories[cat.category] || 0) + 1;
        const key =
          life.lifecycle === "cancelled"
            ? "CANCELLED"
            : life.lifecycle === "ended" || life.lifecycle === "ended_missing"
              ? "ENDED"
              : life.lifecycle === "scheduled"
                ? "FUTURE"
                : life.lifecycle === "active" || life.lifecycle === "active_unconfirmed"
                  ? "ACTIVE"
                  : "UNKNOWN";
        lifecycle[key] += 1;
        if (hasGeom) {
          withGeometry += 1;
          pointGeom += 1;
        } else if (hasTmc) withTmcRef += 1;
        else textOnlyLoc += 1;
        if (hasTmc) withTmcRef += 1;
        if (jsonlFd != null) {
          fs.writeSync(jsonlFd, JSON.stringify(normalized) + "\n");
        }
        if (opts.onRecord) opts.onRecord(normalized);
      }
    } catch (_) {
      diag.recordsRejected += 1;
    }
    record = null;
    textTarget = null;
    void okReason;
    sampleMem();
  }

  function isRecordOpen(ev) {
    if (RECORD_LOCAL.has(ev.localName)) return true;
    const t = attrType(ev.attrs);
    if (t && /Record|Accident|Roadworks|Obstruction|Traffic|Management|Conditions|Activity/i.test(t)) {
      return true;
    }
    return false;
  }

  const tokenizer = createXmlStreamTokenizer(
    {
      maxDepth: limits.maxXmlDepth || limits.maxDepth,
      maxElements: limits.maxElements,
      maxTextNodeChars: limits.maxTextFieldChars || limits.maxTextNodeChars,
      maxRuntimeMs: limits.maxRuntimeMs || STREAM_XML_LIMITS.maxRuntimeMs,
      maxRecordBytes: limits.maxRecordBytes || STREAM_XML_LIMITS.maxRecordBytes,
      maxRecords: limits.maxSituations || limits.maxRecords,
    },
    {
      signal: opts.signal,
      onOpen(ev) {
        sampleMem();
        diag.totalElementsSeen = ev.elements;
        if (ev.depth > diag.maxDepthObserved) diag.maxDepthObserved = ev.depth;
        if (!diag.rootLocalName) {
          diag.rootLocalName = ev.localName;
          if (isApplicationDatexNamespace(ev.uri)) diag.rootNamespaceUri = ev.uri;
          const mb = modelBaseFromAttrs(ev.attrs);
          if (mb) {
            diag.detectedDatexMajorVersion = Number(String(mb).split(".")[0]) || null;
          }
        }
        for (const a of ev.attrs || []) {
          if (a.qname === "xmlns" || a.prefix === "xmlns") {
            if (isApplicationDatexNamespace(a.value) || /w3\.org|datex2\.eu/i.test(a.value)) {
              if (nsSeen.size < 16) nsSeen.add(String(a.value).slice(0, 120));
            }
            if (!diag.rootNamespaceUri && isApplicationDatexNamespace(a.value)) {
              diag.rootNamespaceUri = String(a.value).slice(0, 120);
            }
          }
        }
        if (ev.depth === 1) bumpTop(ev.localName);
        if (ev.localName === "payloadpublication" && /SituationPublication/i.test(attrType(ev.attrs))) {
          diag.detectedDatexProfile = "SituationPublication";
        }
        if (ev.localName === "situation") {
          inSituation = true;
          situationId = attrId(ev.attrs);
          situationVersion = attrVersion(ev.attrs);
          diag.candidateSituationElementCount += 1;
        }
        if (inSituation && isRecordOpen(ev) && !record) {
          diag.candidateSituationRecordElementCount += 1;
          bumpType(ev.localName === "situationrecord" ? (attrType(ev.attrs) || "situationrecord").toLowerCase() : ev.localName);
          if (diag.recordsSeen >= (limits.maxSituations || STREAM_XML_LIMITS.maxRecords)) {
            throw Object.assign(new Error("too_many_records"), { code: "XML_TOO_MANY_RECORDS" });
          }
          record = {
            situationId,
            situationVersion,
            recordId: attrId(ev.attrs),
            recordVersion: attrVersion(ev.attrs),
            recordType: attrType(ev.attrs) || (ev.localName !== "situationrecord" ? ev.localName : "SituationRecord"),
            fields: Object.create(null),
            depth: ev.depth,
            bytes: 0,
          };
        } else if (record) {
          record.bytes += 32 + (ev.localName ? ev.localName.length : 0);
          if (record.bytes > (limits.maxRecordBytes || STREAM_XML_LIMITS.maxRecordBytes)) {
            throw Object.assign(new Error("record_too_large"), { code: "XML_RECORD_TOO_LARGE" });
          }
          if (ALLOWED_FIELD.has(ev.localName)) textTarget = ev.localName;
          else textTarget = null;
        }
      },
      onText(ev) {
        if (!record || !textTarget) return;
        const prev = record.fields[textTarget] || "";
        const next = clip(prev + ev.text, limits.maxTextFieldChars || 12000);
        record.fields[textTarget] = next;
        record.bytes += ev.text.length;
        if (record.bytes > (limits.maxRecordBytes || STREAM_XML_LIMITS.maxRecordBytes)) {
          throw Object.assign(new Error("record_too_large"), { code: "XML_RECORD_TOO_LARGE" });
        }
      },
      onClose(ev) {
        if (record && ev.depth === record.depth) {
          finishRecord("close");
        }
        if (ev.localName === "situation" && inSituation) {
          inSituation = false;
          situationId = "";
          situationVersion = "";
        }
        textTarget = null;
      },
    }
  );

  const st = fs.statSync(filePath);
  diag.inputBytes = st.size;
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(chunkSize);
    let pos = 0;
    while (pos < st.size) {
      const n = fs.readSync(fd, buf, 0, Math.min(chunkSize, st.size - pos), pos);
      if (n <= 0) break;
      tokenizer.write(buf.subarray(0, n));
      pos += n;
      if ((pos & ((256 * 1024) - 1)) === 0) sampleMem();
    }
    tokenizer.end();
    diag.documentWellFormed = true;
  } catch (e) {
    diag.documentWellFormed = false;
    diag.parserFailureCode = (e && e.code) || "XML_PARSE";
    diag.parserCompatibilityReason = "stream_parse_failed";
    if (jsonlFd != null) {
      try {
        fs.closeSync(jsonlFd);
      } catch (_) {}
      jsonlFd = null;
      try {
        fs.unlinkSync(jsonlTmp);
      } catch (_) {}
    }
    sampleMem();
    diag.peakHeapUsedMiB = Math.round((peak.heapUsed / (1024 * 1024)) * 10) / 10;
    diag.peakRssMiB = Math.round((peak.rss / (1024 * 1024)) * 10) / 10;
    diag.namespaceUris = [...nsSeen].sort();
    return {
      ok: false,
      parserCompatible: false,
      structure: diag,
      categories,
      lifecycle,
      withGeometry,
      withTmcRef,
      pointGeom,
      linearGeom,
      textOnlyLoc,
      situationRecords: diag.recordsNormalized,
      normalized: diag.recordsNormalized,
      rejected: diag.recordsRejected,
      namespace: diag.rootNamespaceUri,
      datexVersion:
        diag.detectedDatexMajorVersion != null ? String(diag.detectedDatexMajorVersion) : null,
      parserFailureCode: diag.parserFailureCode,
      parserCompatibilityReason: diag.parserCompatibilityReason,
      jsonlPath: null,
      peak,
    };
  } finally {
    try {
      fs.closeSync(fd);
    } catch (_) {}
  }

  if (jsonlFd != null) {
    fs.closeSync(jsonlFd);
    jsonlFd = null;
    fs.renameSync(jsonlTmp, jsonlFinal);
  }

  diag.namespaceUris = [...nsSeen].sort();
  sampleMem();
  diag.peakHeapUsedMiB = Math.round((peak.heapUsed / (1024 * 1024)) * 10) / 10;
  diag.peakRssMiB = Math.round((peak.rss / (1024 * 1024)) * 10) / 10;

  const compatible = Boolean(
    diag.documentWellFormed &&
      isApplicationDatexNamespace(diag.rootNamespaceUri) &&
      diag.recordsNormalized > 0 &&
      (diag.detectedDatexMajorVersion == null || diag.detectedDatexMajorVersion === 2)
  );
  if (!compatible) {
    diag.parserFailureCode =
      diag.parserFailureCode ||
      (!isApplicationDatexNamespace(diag.rootNamespaceUri)
        ? "NAMESPACE_NOT_DATEX"
        : diag.recordsNormalized === 0
          ? "NO_SITUATION_RECORDS"
          : "PARSER_INCOMPATIBLE");
    diag.parserCompatibilityReason = diag.parserFailureCode;
  }

  return {
    ok: compatible,
    parserCompatible: compatible,
    structure: diag,
    categories,
    lifecycle,
    withGeometry,
    withTmcRef,
    pointGeom,
    linearGeom,
    textOnlyLoc,
    situationRecords: diag.recordsNormalized,
    normalized: diag.recordsNormalized,
    rejected: diag.recordsRejected,
    namespace: diag.rootNamespaceUri,
    datexVersion:
      diag.detectedDatexMajorVersion != null ? String(diag.detectedDatexMajorVersion) : null,
    parserFailureCode: compatible ? null : diag.parserFailureCode,
    parserCompatibilityReason: compatible ? null : diag.parserCompatibilityReason,
    jsonlPath: jsonlFinal,
    peak,
  };
}

/**
 * Parse Readable / async iterable of Buffer chunks (tests).
 */
export async function parseDatexStream(chunks, opts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "ndic-stream-"));
  const file = path.join(tmpDir, "in.xml");
  const ws = fs.createWriteStream(file, { mode: 0o600 });
  for await (const c of chunks) {
    ws.write(Buffer.isBuffer(c) ? c : Buffer.from(c));
  }
  await new Promise((resolve, reject) => {
    ws.end(() => resolve());
    ws.on("error", reject);
  });
  try {
    return await parseDatexFileStreaming(file, opts);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
}
