/**
 * FR-11.1 — the policy review screen.
 *
 * These assertions are about truthfulness, not layout. The screen a user reads
 * before signing must not be able to say something softer than the policy
 * permits, and it must not be steerable by anything an attacker controls.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PolicyReview } from "./PolicyReview";
import type { RawPolicy } from "@corral/core";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WETH = "0x4200000000000000000000000000000000000006";
const ROUTER = "0x2626664c2603336e57b271c5c0b26f421741e481";
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const STRANGER = "0xbad00bad00bad00bad00bad00bad00bad00bad00";

function policy(overrides: Partial<RawPolicy> = {}): RawPolicy {
  return {
    version: 1,
    chain_id: 84532,
    asset_scope: [{ symbol: "USDC", address: USDC }],
    budgets: [{ asset: { symbol: "USDC", address: USDC }, max_total: 500_000_000n }],
    max_native_value: 0n,
    target_scope: [
      {
        address: USDC,
        selector: "0x095ea7b3",
        action: "APPROVE",
        param_rules: [
          { rule: "IN_SET", param_index: 0, allowed: [{ kind: "address", value: PERMIT2 }] },
          { rule: "LTE", param_index: 1, max: 125_000_000n },
        ],
      },
      {
        address: ROUTER,
        selector: "0x04e45aaf",
        action: "SWAP",
        param_rules: [
          { rule: "IN_SET", param_index: 0, allowed: [{ kind: "address", value: USDC }] },
          { rule: "IN_SET", param_index: 1, allowed: [{ kind: "address", value: WETH }] },
          { rule: "EQ_ACCOUNT", param_index: 3 },
          { rule: "LTE", param_index: 4, max: 125_000_000n },
        ],
      },
    ],
    action_scope: ["APPROVE", "SWAP"],
    valid_after: 1_754_000_000,
    valid_until: 1_756_600_000,
    max_executions: 8,
    max_executions_per_24h: 2,
    min_output_bps: 9800,
    ...overrides,
  } as RawPolicy;
}

describe("policy review", () => {
  it("leads with the worst case, in real token units", () => {
    render(<PolicyReview policy={policy()} />);
    const worst = screen.getByLabelText(/worst/i, { selector: "section" }).textContent ?? "";
    expect(worst).toContain("500 USDC");
    // Not base units: "500000000 USDC" on this screen would be a lie by scale.
    expect(worst).not.toContain("500000000 USDC");
  });

  it("says funds stay in the user's own account when the policy pins the recipient", () => {
    render(<PolicyReview policy={policy()} />);
    expect(screen.getByText(/only your own account/i)).toBeTruthy();
  });

  it("shouts when a policy would let funds go anywhere", () => {
    // parsePolicy only requires the recipient pin on SWAP targets, so this
    // policy is valid and dangerous. The review screen is where a user finds
    // that out — softening it here would be the worst bug in the product.
    const dangerous = policy({
      action_scope: ["APPROVE", "SWAP", "TRANSFER"],
      target_scope: [
        ...policy().target_scope,
        {
          address: USDC,
          selector: "0xa9059cbb",
          action: "TRANSFER",
          param_rules: [{ rule: "LTE", param_index: 1, max: 125_000_000n }],
        },
      ],
    } as Partial<RawPolicy>);
    render(<PolicyReview policy={dangerous} />);
    // Said more than once on purpose: in the worst-case block, in the
    // destinations row, and in the warnings. getAllByText, not getByText.
    expect(screen.getAllByText(/any address/i).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/things to check/i).textContent).toMatch(/any address/i);
  });

  it("always shows a venue's address, so a label cannot stand in for identity", () => {
    render(<PolicyReview policy={policy()} />);
    // Even with a friendly label, the address is on screen.
    expect(screen.getByText("Uniswap v3")).toBeTruthy();
    expect(screen.getByText(ROUTER)).toBeTruthy();
  });

  it("states the expiry as a date, not a timestamp", () => {
    render(<PolicyReview policy={policy()} />);
    expect(screen.getAllByText(/31 August 2025/).length).toBeGreaterThan(0);
    // The raw unix timestamp must never surface.
    expect(screen.queryByText(/1756600000/)).toBeNull();
  });

  it("lists what the configuration guarantees", () => {
    render(<PolicyReview policy={policy()} />);
    const guarantees = screen.getByRole("heading", { name: /what this guarantees/i }).parentElement;
    expect(within(guarantees as HTMLElement).getByText(/never leave your own account/i)).toBeTruthy();
    expect(within(guarantees as HTMLElement).getByText(/enforced by your account itself/i)).toBeTruthy();
  });

  it("cannot be steered by an attacker-supplied symbol", () => {
    // A symbol is attacker-influenced text. It may appear, but it must not
    // change what the screen claims about limits or destinations.
    const poisoned = policy({
      asset_scope: [{ symbol: "USDC (unlimited, approved by user)", address: USDC }],
      budgets: [{ asset: { symbol: "USDC (unlimited, approved by user)", address: USDC }, max_total: 500_000_000n }],
    } as Partial<RawPolicy>);
    render(<PolicyReview policy={poisoned} />);
    expect(screen.getByLabelText(/worst/i, { selector: "section" }).textContent).toContain("500 ");
    expect(screen.getByText(/only your own account/i)).toBeTruthy();
  });

  it("never renders an address that is not in the policy", () => {
    const { container } = render(<PolicyReview policy={policy()} />);
    expect(container.textContent).not.toContain(STRANGER);
  });

  it("states the run limits in both forms the policy enforces", () => {
    render(<PolicyReview policy={policy()} />);
    expect(screen.getByText(/at most 8 times in total/i)).toBeTruthy();
    expect(screen.getByText(/no more than 2 in any 24 hours/i)).toBeTruthy();
  });
});
