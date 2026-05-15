/**
 * Cloudflare Worker — VIN (dataovozidlech) + R2 upload.
 * CORS: /health a /vin musí být volatelné z prohlížeče (infouzel.cz).
 */

const JSON_BASE = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

function respCorsJson(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...JSON_BASE, ...corsHeaders() }
  });
}

function respCorsOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

const UPSTREAM_BASE = "https://api.dataovozidlech.cz/api/vehicletechnicaldata/v2";
const SOURCE = "dataovozidlech";
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function jsonResponseNoCors(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: JSON_BASE
  });
}

function vinModel(success, error, vin, data) {
  return {
    success,
    error: error == null ? null : String(error),
    vin: vin == null ? "" : String(vin),
    data: data == null ? null : data,
    cached: false,
    source: SOURCE
  };
}

/** API někdy vrací Status jako číslo, někdy řetězec; Data může být vnořený JSON string. */
function upstreamStatusOk(status) {
  if (status === 1 || status === true) return true;
  const s = String(status ?? "").trim();
  return s === "1" || s.toLowerCase() === "true";
}

function normalizeVinDataPayload(data) {
  if (data == null) return null;
  if (typeof data === "string") {
    const t = data.trim();
    if (!t) return null;
    try {
      return JSON.parse(t);
    } catch (_e) {
      return null;
    }
  }
  if (typeof data === "object") return data;
  return null;
}

function jsonStringifyVinResponse(obj) {
  try {
    return JSON.stringify(obj);
  } catch (_e) {
    try {
      const safe = JSON.stringify(obj, function (_k, v) {
        if (typeof v === "bigint") return String(v);
        if (v === undefined) return null;
        return v;
      });
      return safe;
    } catch (_e2) {
      return null;
    }
  }
}

function normalizeVin(value) {
  return String(value || "").trim().toUpperCase();
}

function isValidVin(vin) {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin);
}

function safeText(value) {
  if (value == null) return "";
  return String(value);
}

function extForKind(kind) {
  if (kind === "jpeg") return "jpg";
  if (kind === "png") return "png";
  if (kind === "webp") return "webp";
  return "bin";
}

function mimeForKind(kind) {
  if (kind === "jpeg") return "image/jpeg";
  if (kind === "png") return "image/png";
  if (kind === "webp") return "image/webp";
  return "application/octet-stream";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method.toUpperCase();

    if (path === "/health") {
      if (method === "OPTIONS") return respCorsOptions();
      if (method !== "GET") {
        return respCorsJson(405, { success: false, error: "method_not_allowed" });
      }
      return respCorsJson(200, { ok: true, worker: "up" });
    }

    if (path === "/upload-image" && method === "POST") {
      return handleUploadImage(request, env);
    }

    if (path === "/vin") {
      if (method === "OPTIONS") return respCorsOptions();
      if (method !== "GET") {
        return respCorsJson(405, vinModel(false, "method_not_allowed", "", null));
      }

      let vinForErr = "";
      try {
        const apiKey = safeText(env.VIN_UPSTREAM_KEY || env.VIN_API_KEY).trim();
        if (!apiKey) {
          return respCorsJson(500, vinModel(false, "missing_secret", "", null));
        }

        const vin = normalizeVin(url.searchParams.get("vin"));
        vinForErr = vin;
        if (!isValidVin(vin)) {
          return respCorsJson(
            400,
            vinModel(false, "VIN musí mít přesně 17 znaků.", vin, null)
          );
        }

        const upstreamUrl = `${UPSTREAM_BASE}?vin=${encodeURIComponent(vin)}`;

        let upstreamResponse;
        try {
          upstreamResponse = await fetch(upstreamUrl, {
            method: "GET",
            headers: {
              API_KEY: apiKey,
              Accept: "application/json"
            },
            cf: {
              cacheTtl: 0,
              cacheEverything: false
            }
          });
        } catch (_err) {
          return respCorsJson(
            502,
            vinModel(false, "upstream_fetch_failed", vin, null)
          );
        }

        const rawText = await upstreamResponse.text();

        if (!upstreamResponse.ok) {
          return respCorsJson(
            502,
            vinModel(false, "upstream_http_error", vin, null)
          );
        }

        let parsed;
        try {
          parsed = rawText ? JSON.parse(rawText) : null;
        } catch (_err) {
          return respCorsJson(
            502,
            vinModel(false, "upstream_invalid_json", vin, null)
          );
        }

        if (typeof parsed === "string") {
          try {
            parsed = JSON.parse(parsed);
          } catch (_e) {
            return respCorsJson(
              502,
              vinModel(false, "upstream_wrapped_invalid", vin, null)
            );
          }
        }

        const dataRaw = parsed && parsed.Data != null ? parsed.Data : parsed?.data;
        const dataNorm = normalizeVinDataPayload(dataRaw);

        if (!upstreamStatusOk(parsed?.Status ?? parsed?.status) || !dataNorm) {
          return respCorsJson(
            404,
            vinModel(false, "vin_not_found", vin, null)
          );
        }

        const payload = vinModel(true, null, vin, dataNorm);
        const jsonOut = jsonStringifyVinResponse(payload);
        if (jsonOut == null) {
          return respCorsJson(
            502,
            vinModel(false, "response_serialize_failed", vin, null)
          );
        }
        return new Response(jsonOut, {
          status: 200,
          headers: { ...JSON_BASE, ...corsHeaders() }
        });
      } catch (_fatal) {
        return respCorsJson(
          500,
          vinModel(false, "worker_internal", vinForErr || "", null)
        );
      }
    }

    if (method === "GET") {
      return jsonResponseNoCors(404, vinModel(false, "not_found", "", null));
    }
    return jsonResponseNoCors(405, vinModel(false, "method_not_allowed", "", null));
  }
};

async function handleUploadImage(request, env) {
  const secret = safeText(env.IMAGE_UPLOAD_SECRET).trim();
  if (!secret) {
    return jsonResponseNoCors(503, {
      success: false,
      error: "upload_not_configured",
      detail: "Set IMAGE_UPLOAD_SECRET"
    });
  }

  const auth = request.headers.get("Authorization") || "";
  if (auth !== "Bearer " + secret) {
    return jsonResponseNoCors(401, { success: false, error: "unauthorized" });
  }

  const bucket = env.R2_BUCKET;
  if (!bucket) {
    return jsonResponseNoCors(503, {
      success: false,
      error: "r2_not_bound",
      detail: "Configure R2 binding R2_BUCKET"
    });
  }

  const baseUrl = safeText(env.R2_PUBLIC_BASE_URL).replace(/\/+$/, "");
  if (!baseUrl) {
    return jsonResponseNoCors(503, {
      success: false,
      error: "r2_public_url_missing",
      detail: "Set var R2_PUBLIC_BASE_URL (custom domain or r2.dev)"
    });
  }

  let form;
  try {
    form = await request.formData();
  } catch (_e) {
    return jsonResponseNoCors(400, { success: false, error: "invalid_multipart" });
  }

  const file = form.get("file") || form.get("image");
  if (!file || typeof file.stream !== "function") {
    return jsonResponseNoCors(400, {
      success: false,
      error: "missing_file",
      detail: "Use form field file or image"
    });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return jsonResponseNoCors(413, {
      success: false,
      error: "file_too_large",
      detail: "Max 5MB"
    });
  }

  const declared = (file.type || "").toLowerCase().split(";")[0].trim();
  if (!ALLOWED_MIME.has(declared)) {
    return jsonResponseNoCors(415, {
      success: false,
      error: "unsupported_media_type",
      detail: "image/jpeg, image/png, image/webp only"
    });
  }

  const kind = await detectImageFileKind(file);
  if (!kind) {
    return jsonResponseNoCors(400, {
      success: false,
      error: "invalid_image_payload",
      detail: "Magic bytes do not match JPEG/PNG/WEBP"
    });
  }

  const expectedMime = mimeForKind(kind);
  if (declared !== expectedMime) {
    return jsonResponseNoCors(400, {
      success: false,
      error: "mime_content_mismatch",
      detail: "Declared Content-Type does not match file content"
    });
  }

  const id = crypto.randomUUID();
  const ext = extForKind(kind);
  const key = "ads/" + id + "." + ext;

  try {
    await bucket.put(key, file.stream(), {
      httpMetadata: { contentType: expectedMime }
    });
  } catch (_e) {
    return jsonResponseNoCors(500, { success: false, error: "r2_put_failed" });
  }

  const publicUrl = baseUrl + "/" + key;
  return jsonResponseNoCors(200, {
    success: true,
    url: publicUrl
  });
}

async function detectImageFileKind(file) {
  const buf = await file.slice(0, 16).arrayBuffer();
  const u8 = new Uint8Array(buf);
  if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) {
    return "jpeg";
  }
  if (
    u8.length >= 8 &&
    u8[0] === 0x89 &&
    u8[1] === 0x50 &&
    u8[2] === 0x4e &&
    u8[3] === 0x47
  ) {
    return "png";
  }
  if (
    u8.length >= 12 &&
    u8[0] === 0x52 &&
    u8[1] === 0x49 &&
    u8[2] === 0x46 &&
    u8[3] === 0x46 &&
    u8[8] === 0x57 &&
    u8[9] === 0x45 &&
    u8[10] === 0x42 &&
    u8[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}
