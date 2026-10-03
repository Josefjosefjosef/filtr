/** Public Premium display order (compact active-only) — contracted position stays immutable. */

export type PremiumContractedPosition = 1 | 2 | 3 | 4;

export function premiumPositionRankLabelCs(position: PremiumContractedPosition): string {
  return position + ". pozice v této sekci";
}

export function premiumOrderPositionExplanationCs(position: PremiumContractedPosition): string {
  if (position === 1) {
    return (
      "Zakoupená P1 je v rámci Premium pozic vždy první. Pořadí se počítá pouze mezi aktivními Premium reklamami; volné pozice nevytvářejí prázdné místo."
    );
  }
  const higher = position === 2 ? "P1" : position === 3 ? "P1 a P2" : "P1, P2 a P3";
  return (
    "Pokud nejsou vyšší Premium pozice (" +
    higher +
    ") obsazené, může se Vaše reklama dočasně zobrazovat výše. Zakoupená P" +
    position +
    " určuje nejzazší pořadí, na které se reklama při obsazení vyšších pozic posune."
  );
}

export function premiumSalesPanelHintCs(): string {
  return (
    "Pořadí reklam se automaticky posouvá nahoru, pokud před nimi není obsazená vyšší pozice. " +
    "Zakoupená pozice určuje nejzazší pořadí, na kterém se může reklama zobrazit. " +
    "Dočasně lepší zobrazení nezakládá nárok na jiný produkt, slevu ani refund."
  );
}

export function sortPremiumByContractedPosition<T extends { position: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.position - b.position);
}

export function assignPremiumDisplayRanks<T extends { position: number }>(
  items: readonly T[]
): Array<T & { display_rank: number }> {
  const sorted = sortPremiumByContractedPosition(items);
  return sorted.map((item, index) => ({ ...item, display_rank: index + 1 }));
}

export type PremiumPublicSaleState = "available" | "live" | "held";

export function isPremiumCampaignLiveNow(input: {
  campaign_status: string | null;
  target_url: string | null;
  start_at: string | null;
  end_at: string | null;
  nowIso: string;
}): boolean {
  return (
    input.campaign_status === "active" &&
    !!input.target_url &&
    !!input.start_at &&
    !!input.end_at &&
    input.start_at <= input.nowIso &&
    input.end_at > input.nowIso
  );
}

export function resolvePremiumPublicSaleState(input: {
  publicly_listed: boolean;
  active_campaign_id: string | null;
  campaign_live: boolean;
  pending_order_count: number;
}): PremiumPublicSaleState {
  if (!input.publicly_listed) return "held";
  if (input.campaign_live) return "live";
  if (input.active_campaign_id || input.pending_order_count > 0) return "held";
  return "available";
}
