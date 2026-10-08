/**
 * ARES REST lookup (official registry) — server-side only; sends IČO, not full form data.
 * @see https://ares.gov.cz/
 */

import { validateCzechIco } from "./czech-ico";
import {
  extractCustomerRegistryFromAresBody,
  type CustomerRegistrySnapshot,
} from "./premium-ares-registry";

const ARES_REST_BASE = "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty";

export type AresCompanyLookup = {
  ico: string;
  company_name: string;
  billing_street: string;
  billing_city: string;
  billing_zip: string;
  billing_country: string;
  dic: string | null;
  customer_registry: CustomerRegistrySnapshot;
};

type AresSidlo = {
  nazevUlice?: string;
  cisloDomovni?: number;
  cisloOrientacni?: number;
  nazevObce?: string;
  psc?: number;
  textovaAdresa?: string;
};

type AresSubject = {
  ico?: string;
  obchodniJmeno?: string;
  dic?: string;
  sidlo?: AresSidlo;
  dalsiUdaje?: { datovyZdroj?: string; spisovaZnacka?: string }[];
};

function formatStreet(sidlo: AresSidlo): string {
  if (sidlo.textovaAdresa && sidlo.textovaAdresa.trim()) {
    const parts = sidlo.textovaAdresa.split(",").map((p) => p.trim());
    if (parts.length) return parts[0];
  }
  const ulice = sidlo.nazevUlice ? String(sidlo.nazevUlice).trim() : "";
  const dom = sidlo.cisloDomovni != null ? String(sidlo.cisloDomovni) : "";
  const orient = sidlo.cisloOrientacni != null ? "/" + String(sidlo.cisloOrientacni) : "";
  if (ulice && dom) return ulice + " " + dom + orient;
  if (ulice) return ulice;
  return sidlo.textovaAdresa?.trim() || "";
}

function formatZip(psc: number | undefined): string {
  if (psc == null || Number.isNaN(Number(psc))) return "";
  const s = String(psc).replace(/\D/g, "");
  if (s.length >= 5) return s.slice(0, 3) + " " + s.slice(3, 5);
  return s;
}

export function mapAresSubject(subject: AresSubject, ico: string, verifiedAtIso?: string): AresCompanyLookup | null {
  const name = typeof subject.obchodniJmeno === "string" ? subject.obchodniJmeno.trim() : "";
  if (!name) return null;
  const sidlo = subject.sidlo || {};
  const street = formatStreet(sidlo);
  const city = typeof sidlo.nazevObce === "string" ? sidlo.nazevObce.trim() : "";
  const zip = formatZip(sidlo.psc);
  if (!street || !city || !zip) return null;
  const dic = typeof subject.dic === "string" && subject.dic.trim() ? subject.dic.trim() : null;
  const at = verifiedAtIso || new Date().toISOString();
  const customer_registry = extractCustomerRegistryFromAresBody(subject, at);
  return {
    ico,
    company_name: name,
    billing_street: street,
    billing_city: city,
    billing_zip: zip,
    billing_country: "Česká republika",
    dic,
    customer_registry,
  };
}

export async function fetchAresByIco(ico: string): Promise<
  { ok: true; data: AresCompanyLookup } | { ok: false; reason: "not_found" | "registry_unavailable" | "invalid_response" }
> {
  const url = ARES_REST_BASE + "/" + encodeURIComponent(ico);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
  } catch {
    return { ok: false, reason: "registry_unavailable" };
  }
  if (res.status === 404) return { ok: false, reason: "not_found" };
  if (!res.ok) return { ok: false, reason: "registry_unavailable" };
  let body: AresSubject;
  try {
    body = (await res.json()) as AresSubject;
  } catch {
    return { ok: false, reason: "invalid_response" };
  }
  const mapped = mapAresSubject(body, ico);
  if (!mapped) return { ok: false, reason: "not_found" };
  return { ok: true, data: mapped };
}

export function parseIcoQueryParam(raw: string | null): { ok: true; ico: string } | { ok: false; reason: string } {
  if (!raw || !raw.trim()) return { ok: false, reason: "ico_required" };
  const check = validateCzechIco(raw.trim());
  if (!check.ok) return { ok: false, reason: check.reason };
  return { ok: true, ico: check.ico };
}
