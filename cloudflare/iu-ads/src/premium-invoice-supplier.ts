import { INFOUZEL_PROVIDER } from "./info-uzel-provider";

/** Authoritative IU Ads premium invoice supplier (sync with PUBLIC_CONTACTS / Organization JSON-LD). */
export const PREMIUM_INVOICE_SUPPLIER = {
  companyName: "Média Uzel s.r.o.",
  legalNameAlt: INFOUZEL_PROVIDER.legalName,
  ico: INFOUZEL_PROVIDER.ico,
  street: INFOUZEL_PROVIDER.street,
  city: INFOUZEL_PROVIDER.city,
  zip: INFOUZEL_PROVIDER.zip,
  country: "Česká republika",
  email: INFOUZEL_PROVIDER.email,
  vatPayer: INFOUZEL_PROVIDER.vatPayer,
  accountNumber: "294822412",
  accountPrefix: "000000",
  bankCode: "5500",
  nonVatNotice: "Dodavatel není plátce DPH.",
  /** Zápis v OR — ověřeno vůči veřejným podkladům projektu (guard / INFO_CENTER). */
  commercialRegisterCourt: "Městským soudem v Praze",
  commercialRegisterSection: "C",
  commercialRegisterInsert: "447292",
} as const;
