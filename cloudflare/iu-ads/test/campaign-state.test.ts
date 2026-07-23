import { describe, expect, it } from "vitest";
import {
  ACTIVATE_GATE_STATUSES,
  CAMPAIGN_STATUSES,
  RIGHTS_REQUIRED_STATUSES,
  allowedNextStatuses,
  canTransition,
  isCampaignStatus,
  isTerminalStatus,
  requiresActivatePermission,
  requiresRightsConfirmation,
} from "../src/campaign-state";

describe("campaign status state machine (kap. 13)", () => {
  it("covers exactly the twelve documented statuses", () => {
    expect(CAMPAIGN_STATUSES).toEqual([
      "draft",
      "awaiting_assets",
      "awaiting_legal",
      "awaiting_tech",
      "awaiting_approval",
      "approved",
      "scheduled",
      "active",
      "paused",
      "ended",
      "cancelled",
      "archived",
    ]);
  });

  it("isCampaignStatus guards unknown/invalid input (fail closed)", () => {
    expect(isCampaignStatus("draft")).toBe(true);
    expect(isCampaignStatus("published")).toBe(false);
    expect(isCampaignStatus(42)).toBe(false);
    expect(isCampaignStatus(undefined)).toBe(false);
  });

  it("walks the full happy path draft -> ... -> active", () => {
    const path: readonly string[] = [
      "draft",
      "awaiting_assets",
      "awaiting_legal",
      "awaiting_tech",
      "awaiting_approval",
      "approved",
      "scheduled",
      "active",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i] as any, path[i + 1] as any)).toBe(true);
    }
  });

  it("allows pausing/ending an active campaign and cancelling from any non-terminal state", () => {
    expect(canTransition("active", "paused")).toBe(true);
    expect(canTransition("paused", "active")).toBe(true);
    expect(canTransition("active", "ended")).toBe(true);
    expect(canTransition("paused", "cancelled")).toBe(true);
    expect(canTransition("draft", "cancelled")).toBe(true);
    expect(canTransition("awaiting_approval", "cancelled")).toBe(true);
  });

  it("rejects skipping states (draft cannot jump straight to active)", () => {
    expect(canTransition("draft", "active")).toBe(false);
    expect(canTransition("draft", "approved")).toBe(false);
    expect(canTransition("awaiting_assets", "scheduled")).toBe(false);
  });

  it("rejects any transition out of the archived terminal state", () => {
    expect(isTerminalStatus("archived")).toBe(true);
    expect(allowedNextStatuses("archived")).toEqual([]);
    expect(canTransition("archived", "draft")).toBe(false);
  });

  it("ended/cancelled can only move to archived", () => {
    expect(allowedNextStatuses("ended")).toEqual(["archived"]);
    expect(allowedNextStatuses("cancelled")).toEqual(["archived"]);
  });

  it("campaigns.activate is required only for approved/scheduled/active", () => {
    expect(ACTIVATE_GATE_STATUSES).toEqual(["approved", "scheduled", "active"]);
    expect(requiresActivatePermission("approved")).toBe(true);
    expect(requiresActivatePermission("scheduled")).toBe(true);
    expect(requiresActivatePermission("active")).toBe(true);
    expect(requiresActivatePermission("draft")).toBe(false);
    expect(requiresActivatePermission("awaiting_approval")).toBe(false);
    expect(requiresActivatePermission("paused")).toBe(false);
  });

  it("rights confirmation is required only when entering active", () => {
    expect(RIGHTS_REQUIRED_STATUSES).toEqual(["active"]);
    expect(requiresRightsConfirmation("active")).toBe(true);
    expect(requiresRightsConfirmation("approved")).toBe(false);
    expect(requiresRightsConfirmation("scheduled")).toBe(false);
  });
});
