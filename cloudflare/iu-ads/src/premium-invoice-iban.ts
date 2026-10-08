/** Czech domestic account → IBAN (ISO 13616). Single canonical path for QR Platba. */
export function czechBankAccountToIban(bankCode: string, accountNumber: string, accountPrefix = "000000"): string {
  const bank = bankCode.replace(/\D/g, "").padStart(4, "0").slice(-4);
  const prefix = accountPrefix.replace(/\D/g, "").padStart(6, "0").slice(-6);
  const account = accountNumber.replace(/\D/g, "").padStart(10, "0").slice(-10);
  const bban = bank + prefix + account;
  if (bban.length !== 20) throw new Error("invalid_czech_bban");
  const numeric = (bban + "123500").replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let rem = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    rem = Number(String(rem) + numeric.slice(i, i + 7)) % 97;
  }
  const check = String(98 - rem).padStart(2, "0");
  return "CZ" + check + bban;
}
