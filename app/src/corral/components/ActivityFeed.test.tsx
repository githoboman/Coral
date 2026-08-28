/**
 * FR-11.6 / FR-11.8 — the activity feed.
 *
 * The assertion that carries weight: a policy rejection must not look like a
 * failure. A rejection means the on-chain limits refused something and the
 * user's money was protected. Rendering it as a fault teaches people to
 * distrust their own protection, which is the opposite of what the product is
 * for.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ActivityFeed } from "./ActivityFeed";
import type { ExecutionView } from "../lib/api";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WETH = "0x4200000000000000000000000000000000000006";
const assets = [
  { symbol: "USDC", address: USDC },
  { symbol: "WETH", address: WETH },
];

function execution(over: Partial<ExecutionView> = {}): ExecutionView {
  return {
    id: "e1",
    status: "SUCCEEDED",
    seq: 1,
    scheduledFor: "2026-08-27T10:00:00.000Z",
    intentHash: `0x${"77".repeat(32)}`,
    txHash: `0x${"ab".repeat(32)}`,
    blockNumber: "100",
    trade: {
      assetIn: USDC,
      amountIn: "125000000",
      assetOut: WETH,
      quotedOut: "1000000000000000000",
      realisedOut: "998000000000000000",
      slippageBps: 20,
      venue: "uniswap-v3",
    },
    gas: {
      gasUsed: "180000",
      effectiveGasPriceWei: "1500000",
      costWei: "270000000000",
      paidBy: "ACCOUNT",
      note: "gas is charged in ETH and is not part of the asset budget",
    },
    errorCode: null,
    errorDetail: null,
    ...over,
  };
}

function classesFor(label: RegExp): string {
  const el = screen.getByText(label).closest("li");
  return el?.className ?? "";
}

describe("activity feed", () => {
  it("renders a successful trade in real units", () => {
    render(<ActivityFeed executions={[execution()]} assets={assets} />);
    expect(screen.getByText(/125 USDC/)).toBeTruthy();
    expect(screen.getByText(/0\.998 WETH/)).toBeTruthy();
  });

  it("a policy rejection is visually distinct from a failure (FR-11.6)", () => {
    render(
      <ActivityFeed
        executions={[
          execution({ id: "a", status: "REJECTED", errorCode: "POLICY_BUDGET_EXCEEDED", trade: null }),
          execution({ id: "b", status: "FAILED", errorCode: "SIMULATION_REVERT", trade: null }),
        ]}
        assets={assets}
      />,
    );
    const rejected = classesFor(/stopped by your limits/i);
    const failed = classesFor(/did not go through/i);
    expect(rejected).not.toBe(failed);
    // And the rejection is not dressed as damage.
    expect(rejected).not.toContain("red");
  });

  it("tells the user their limits worked when something was refused", () => {
    render(
      <ActivityFeed
        executions={[execution({ status: "REJECTED", errorCode: "POLICY_BUDGET_EXCEEDED", trade: null })]}
        assets={assets}
      />,
    );
    expect(screen.getByText(/your limits worked/i)).toBeTruthy();
    expect(screen.getByText(/nothing moved/i)).toBeTruthy();
  });

  it("never shows a raw error code or revert string (FR-11.8)", () => {
    const { container } = render(
      <ActivityFeed
        executions={[execution({ status: "FAILED", errorCode: "SIMULATION_REVERT", errorDetail: "0xdeadbeef", trade: null })]}
        assets={assets}
      />,
    );
    expect(container.textContent).not.toContain("SIMULATION_REVERT");
    expect(container.textContent).not.toContain("0xdeadbeef");
  });

  it("falls back to a sentence for a code it has no copy for", () => {
    const { container } = render(
      <ActivityFeed executions={[execution({ status: "FAILED", errorCode: "SOMETHING_NEW", trade: null })]} assets={assets} />,
    );
    expect(container.textContent).not.toContain("SOMETHING_NEW");
    expect(screen.getByText(/something went wrong/i)).toBeTruthy();
  });

  it("shows a better-than-quoted fill as an improvement, not a loss", () => {
    render(
      <ActivityFeed
        executions={[execution({ trade: { ...execution().trade!, slippageBps: -20 } })]}
        assets={assets}
      />,
    );
    expect(screen.getByText(/0\.20% better than quoted/)).toBeTruthy();
  });

  it("shows the network fee separately from the trade amounts (FR-6.5)", () => {
    render(<ActivityFeed executions={[execution()]} assets={assets} />);
    const fee = screen.getByText(/network fee/i).textContent ?? "";
    expect(fee).toContain("ETH");
    // Never expressed in the budget asset.
    expect(fee).not.toContain("USDC");
  });

  it("links to the block explorer for anything that reached the chain", () => {
    render(<ActivityFeed executions={[execution()]} assets={assets} />);
    const link = screen.getByRole("link", { name: /view on the explorer/i });
    expect(link.getAttribute("href")).toContain(`0x${"ab".repeat(32)}`);
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("shows in-progress runs without claiming an outcome", () => {
    render(<ActivityFeed executions={[execution({ status: "SUBMITTED", trade: null })]} assets={assets} />);
    expect(screen.getByText(/in progress/i)).toBeTruthy();
  });

  it("does not crash on a status it has never heard of", () => {
    render(<ActivityFeed executions={[execution({ status: "TELEPORTED", trade: null })]} assets={assets} />);
    expect(screen.getByText(/unknown/i)).toBeTruthy();
  });
});
