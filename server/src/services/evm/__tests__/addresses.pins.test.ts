/**
 * T-007 unit test (offline): the pinned SDK (@rhinestone/module-sdk 0.4.0)
 * builds policies/validators pointing at exactly our pinned V2 addresses.
 * The SDK ships two policy address sets (legacy V1 + current V2); this is
 * the tripwire if an SDK bump (D22: a security-reviewed event) moves them.
 */
import { describe, expect, it } from "vitest";
import {
  getSmartSessionsValidator,
  getSpendingLimitsPolicy,
  getTimeFramePolicy,
  getUniversalActionPolicy,
  getUsageLimitPolicy,
  getValueLimitPolicy,
} from "@rhinestone/module-sdk";
import { BASE_SEPOLIA } from "../addresses.js";

const lc = (a: string) => a.toLowerCase();
const ZERO_RULE = {
  condition: 0 as never, // ParamCondition.EQUAL (type-only enum at runtime)
  offset: 0n,
  isLimited: false,
  ref: "0x0000000000000000000000000000000000000000000000000000000000000000" as const,
  usage: { limit: 0n, used: 0n },
};

describe("@rhinestone/module-sdk builders agree with pinned addresses", () => {
  it("SmartSessions validator", () => {
    const m = getSmartSessionsValidator({ sessions: [] });
    expect(lc(m.address)).toBe(lc(BASE_SEPOLIA.smartSessions.address));
  });
  it("SpendingLimitsPolicy (V2, not legacy V1)", () => {
    const p = getSpendingLimitsPolicy([{ token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", limit: 1n }]);
    expect(lc(p.policy)).toBe(lc(BASE_SEPOLIA.spendingLimitsPolicy.address));
  });
  it("TimeFramePolicy", () => {
    const p = getTimeFramePolicy({ validAfter: 0, validUntil: 1 });
    expect(lc(p.policy)).toBe(lc(BASE_SEPOLIA.timeFramePolicy.address));
  });
  it("ValueLimitPolicy", () => {
    expect(lc(getValueLimitPolicy({ limit: 0n }).policy)).toBe(lc(BASE_SEPOLIA.valueLimitPolicy.address));
  });
  it("UsageLimitPolicy", () => {
    expect(lc(getUsageLimitPolicy({ limit: 1n }).policy)).toBe(lc(BASE_SEPOLIA.usageLimitPolicy.address));
  });
  it("UniversalActionPolicy", () => {
    const p = getUniversalActionPolicy({
      valueLimitPerUse: 0n,
      paramRules: { length: 0n, rules: Array(16).fill(ZERO_RULE) as never },
    });
    expect(lc(p.policy)).toBe(lc(BASE_SEPOLIA.universalActionPolicy.address));
  });
});
