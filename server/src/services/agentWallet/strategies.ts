import { getSuiClient, assetTypeFor } from "./config.js";
import { getSwapAgent, type SwapRequest, type SwapOutcome } from "./swapAgent.js";
import { AgentDeepBookClient, type DeepBookSetup } from "./deepbookClient.js";
import type { AgentWalletRecord } from "./types.js";

/**
 * Higher-level strategy executors that resolve an intent into a concrete
 * amount/price, then delegate to the policy-guarded SwapAgent. Every strategy
 * re-validates through the agent at execution time, so a policy that expired or was
 * revoked between scheduling and firing is still enforced on-chain.
 */

// ── (b) Percentage-based swaps ─────────────────────────────────────────

/**
 * "swap 30% of my SUI to USDC" — resolve the percentage against the AGENT wallet's
 * balance (not the user's), then execute. percent is 0-100.
 */
export async function executePercentageSwap(args: {
  wallet: AgentWalletRecord;
  deepbook: DeepBookSetup;
  tokenIn: string;
  tokenOut: string;
  percent: number;
  market?: boolean;
  price?: number;
}): Promise<SwapOutcome> {
  if (args.percent <= 0 || args.percent > 100) {
    return { ok: false, reason: `Invalid percent ${args.percent}` };
  }

  const coinType = assetTypeFor(args.tokenIn);
  const balance = await getSuiClient().getBalance({
    owner: args.wallet.agentAddress,
    coinType,
  });
  const total = BigInt(balance.totalBalance);
  // floor(total * percent / 100) without floats.
  const amount = (total * BigInt(Math.round(args.percent * 100))) / 10_000n;
  if (amount <= 0n) {
    return { ok: false, reason: `Computed amount is zero (balance ${total})` };
  }

  return getSwapAgent().execute(buildRequest(args, amount));
}

// ── (c) Scheduled actions ──────────────────────────────────────────────

/**
 * "swap at 3pm UTC" — fire a swap at a target time. Uses a backend timer; at
 * trigger time the SwapAgent re-validates the policy, so expiry/revocation between
 * scheduling and firing is respected. Returns a handle to cancel the schedule.
 */
export interface ScheduleHandle {
  cancel: () => void;
  firesAt: number;
}

export function scheduleSwap(args: {
  request: SwapRequest;
  atEpochMs: number;
  onResult?: (outcome: SwapOutcome) => void;
  onError?: (err: unknown) => void;
}): ScheduleHandle {
  const delay = Math.max(0, args.atEpochMs - Date.now());
  // Stamp the on-chain time gate so the contract enforces "not before" even if the
  // timer is replayed or fires slightly early — the backend timer is just a trigger.
  const request: SwapRequest = { ...args.request, executeAfter: BigInt(args.atEpochMs) };
  const timer = setTimeout(async () => {
    try {
      const outcome = await getSwapAgent().execute(request);
      args.onResult?.(outcome);
    } catch (err) {
      args.onError?.(err);
    }
  }, delay);
  timer.unref?.();

  return { cancel: () => clearTimeout(timer), firesAt: args.atEpochMs };
}

// ── (d) Conditional orders ─────────────────────────────────────────────

/**
 * "buy USDC if SUI drops below 0.25" — poll the DeepBook mid-price every
 * intervalMs; when the condition is met, execute once and stop. Returns a handle to
 * cancel monitoring. DeepBook's own book is the price source (no external oracle).
 */
export type PriceCondition = "below" | "above";

export interface ConditionHandle {
  cancel: () => void;
}

export function watchPriceCondition(args: {
  deepbook: DeepBookSetup;
  condition: PriceCondition;
  threshold: number;
  request: SwapRequest;
  intervalMs?: number;
  onTrigger?: (price: number, outcome: SwapOutcome) => void;
  onError?: (err: unknown) => void;
}): ConditionHandle {
  const db = new AgentDeepBookClient(args.deepbook);
  let stopped = false;

  const timer = setInterval(async () => {
    if (stopped) return;
    try {
      const price = await db.midPrice();
      const met =
        args.condition === "below" ? price < args.threshold : price > args.threshold;
      if (!met) return;

      // Stop before executing so we fire exactly once.
      stopped = true;
      clearInterval(timer);
      const outcome = await getSwapAgent().execute(args.request);
      args.onTrigger?.(price, outcome);
    } catch (err) {
      args.onError?.(err);
    }
  }, args.intervalMs ?? 7_000);
  timer.unref?.();

  return {
    cancel: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

// ── helpers ────────────────────────────────────────────────────────────

function buildRequest(
  args: {
    wallet: AgentWalletRecord;
    deepbook: DeepBookSetup;
    tokenIn: string;
    tokenOut: string;
    market?: boolean;
    price?: number;
  },
  amount: bigint,
): SwapRequest {
  return {
    wallet: args.wallet,
    deepbook: args.deepbook,
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    amount,
    market: args.market ?? true,
    price: args.price,
  };
}
