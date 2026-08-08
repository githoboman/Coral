import {
  DeepBookClient,
  type BalanceManager,
} from "@mysten/deepbook-v3";
import type { Transaction } from "@mysten/sui/transactions";
import { getSuiClient, getNetwork } from "./config.js";

/**
 * Thin wrapper over @mysten/deepbook-v3. Two responsibilities:
 *
 *  - READ helpers (mid-price, quote estimates, order status) for the order manager
 *    and price-based execution. These hit the DeepBook client directly.
 *  - TRANSACTION FRAGMENTS (place/cancel order) returned as `(tx) => void` so the
 *    PTB builder can inject them BETWEEN validate_action and record_spend, keeping
 *    the whole agent action atomic under the policy guard.
 *
 * The SDK's order methods operate on a BalanceManager. The agent wallet owns one
 * BalanceManager (created once, funded by the owner); its id comes from env.
 */

const DEFAULT_MANAGER_KEY = "AGENT_MANAGER";

export interface DeepBookSetup {
  /** Agent wallet address — the DeepBook client's acting address. */
  agentAddress: string;
  /** The agent's BalanceManager object id. */
  balanceManagerId: string;
  /** Pool key, e.g. "SUI_USDC" — resolved against the SDK's testnet pool map. */
  poolKey: string;
}

export class AgentDeepBookClient {
  private client: DeepBookClient;
  private managerKey = DEFAULT_MANAGER_KEY;

  constructor(setup: DeepBookSetup) {
    const balanceManagers: Record<string, BalanceManager> = {
      [this.managerKey]: { address: setup.balanceManagerId },
    };

    // Pools/coins default to the SDK's built-in testnet maps for the active network;
    // we only override the acting address + balance manager. If the demo uses a
    // self-seeded pool, register it via DEEPBOOK_POOLS env in a follow-up.
    this.client = new DeepBookClient({
      client: getSuiClient() as any,
      address: setup.agentAddress,
      env: getNetwork(),
      balanceManagers,
    });

    this.poolKey = setup.poolKey;
  }

  private poolKey: string;

  /** Pool key is "BASE_QUOTE" (e.g. SUI_USDC). Expose both sides. */
  baseSymbol(): string {
    return this.poolKey.split("_")[0];
  }
  quoteSymbol(): string {
    return this.poolKey.split("_")[1];
  }

  // ── Reads ────────────────────────────────────────────────────────────

  /** Orderbook mid-price = (best_bid + best_ask) / 2. The hackathon price source. */
  async midPrice(): Promise<number> {
    return this.client.midPrice(this.poolKey);
  }

  /**
   * On-chain pool trading constraints: minimum order size, lot size (quantity
   * granularity), and tick size (price granularity) — all in whole tokens. Orders
   * that violate these abort in `order_info::validate_inputs`, so we read them to
   * validate/round before submitting. Returns null if the read fails.
   */
  async bookParams(): Promise<{ minSize: number; lotSize: number; tickSize: number } | null> {
    try {
      const p = (await (this.client as any).poolBookParams(this.poolKey)) as any;
      return {
        minSize: Number(p?.minSize ?? 0),
        lotSize: Number(p?.lotSize ?? 0),
        tickSize: Number(p?.tickSize ?? 0),
      };
    } catch {
      return null;
    }
  }

  /**
   * The BalanceManager's deposited balance of a coin symbol (whole tokens). DeepBook
   * settles trades from the manager, not the wallet, so this is what an order can
   * actually spend. Returns null if the read fails.
   */
  async managerBalance(coinSymbol: string): Promise<number | null> {
    try {
      const r = (await this.client.checkManagerBalance(this.managerKey, coinSymbol)) as any;
      return Number(r?.balance ?? 0);
    } catch {
      return null;
    }
  }

  /** Estimated quote out for a given base quantity in — used to size budget spend. */
  async quoteOutForBase(baseQuantity: number | bigint): Promise<number> {
    const r = await this.client.getQuoteQuantityOut(this.poolKey, Number(baseQuantity));
    return Number((r as any).quoteOut ?? (r as any).quoteQuantityOut ?? 0);
  }

  /**
   * Estimated BASE quantity out for a given QUOTE quantity in (whole tokens) —
   * used to size a market BUY, where the user spends a quote amount but DeepBook's
   * order quantity is denominated in the base asset.
   */
  async baseOutForQuote(quoteQuantity: number): Promise<number> {
    const r = await this.client.getBaseQuantityOut(this.poolKey, quoteQuantity);
    return Number((r as any).baseOut ?? (r as any).baseQuantityOut ?? 0);
  }

  /** Open order ids for the agent's balance manager in this pool. */
  async openOrderIds(): Promise<string[]> {
    return this.client.accountOpenOrders(this.poolKey, this.managerKey);
  }

  /**
   * Normalized order status, including filled vs total quantity for partial-fill
   * tracking. Returns null once the order is gone (filled/cancelled/expired).
   */
  async orderStatus(orderId: string) {
    return this.client.getOrderNormalized(this.poolKey, orderId);
  }

  // ── Transaction fragments (injected into the guarded PTB) ────────────

  /**
   * Build a limit-order fragment. isBid=true buys base with quote. clientOrderId
   * is the caller's correlation id. Returns the injector the PTB builder runs as
   * its ActionBody.
   */
  placeLimitOrderFragment(args: {
    clientOrderId: string;
    price: number | bigint;
    quantity: number | bigint;
    isBid: boolean;
    expiration?: number | bigint;
    payWithDeep?: boolean;
  }): (tx: Transaction) => void {
    return this.client.deepBook.placeLimitOrder({
      poolKey: this.poolKey,
      balanceManagerKey: this.managerKey,
      clientOrderId: args.clientOrderId,
      price: Number(args.price),
      quantity: Number(args.quantity),
      isBid: args.isBid,
      expiration: args.expiration !== undefined ? Number(args.expiration) : undefined,
      payWithDeep: args.payWithDeep ?? false,
    });
  }

  /** Build a market-order fragment via the balance manager. */
  placeMarketOrderFragment(args: {
    clientOrderId: string;
    quantity: number | bigint;
    isBid: boolean;
    payWithDeep?: boolean;
  }): (tx: Transaction) => void {
    return this.client.deepBook.placeMarketOrder({
      poolKey: this.poolKey,
      balanceManagerKey: this.managerKey,
      clientOrderId: args.clientOrderId,
      quantity: Number(args.quantity),
      isBid: args.isBid,
      payWithDeep: args.payWithDeep ?? false,
    });
  }

  /** Cancel a single order. */
  cancelOrderFragment(orderId: string): (tx: Transaction) => void {
    return this.client.deepBook.cancelOrder(this.poolKey, this.managerKey, orderId);
  }

  /** Cancel every open order — used by the revocation sweep. */
  cancelAllOrdersFragment(): (tx: Transaction) => void {
    return this.client.deepBook.cancelAllOrders(this.poolKey, this.managerKey);
  }

  /** Withdraw settled funds back into the balance manager after fills. */
  withdrawSettledFragment(): (tx: Transaction) => void {
    return this.client.deepBook.withdrawSettledAmounts(this.poolKey, this.managerKey);
  }

  /** Expose the underlying client for advanced reads the wrapper doesn't surface. */
  raw(): DeepBookClient {
    return this.client;
  }
}
