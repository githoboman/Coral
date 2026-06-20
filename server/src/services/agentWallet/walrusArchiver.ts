import axios from "axios";
import { AgentActionType } from "./types.js";

/**
 * Post-settlement archiving of the full intent lifecycle to Walrus. This is our
 * VALUE-ADD, not a PRD requirement — the on-chain Move events are the authoritative
 * activity log. Therefore archiving runs AFTER settlement and fails gracefully:
 * a Walrus outage must never block or revert an agent action.
 *
 * Uses the HTTP publisher/aggregator pattern already established in
 * waitlistManager.ts rather than the SDK client.
 */

export interface IntentReceipt {
  /** Natural-language intent or a structured summary. */
  intent: string;
  ownerAddress: string;
  agentAddress: string;
  policyId: string;
  actionType: AgentActionType;
  tokenIn: string;
  tokenOut: string;
  amount: string;
  /** On-chain tx digest of the settled action. */
  digest?: string;
  /** Order id for limit orders. */
  orderId?: string;
  status: "executed" | "failed" | "cancelled";
  reason?: string;
  settledAt: string;
}

export interface ArchiveResult {
  ok: boolean;
  blobId?: string;
  url?: string;
  error?: string;
}

export class WalrusArchiver {
  private publisherUrl: string;
  private aggregatorUrl: string;
  private epochs: number;

  constructor() {
    this.publisherUrl =
      process.env.WALRUS_PUBLISHER_URL || "https://publisher.walrus-testnet.walrus.space";
    this.aggregatorUrl =
      process.env.WALRUS_AGGREGATOR_URL || "https://aggregator.walrus-testnet.walrus.space";
    this.epochs = Number(process.env.WALRUS_EPOCHS || 5);
  }

  /**
   * Archive a receipt. Never throws — returns { ok: false } on any failure so the
   * caller can log-and-continue. The receipt's serialized form is the deep archive;
   * the returned blobId can be surfaced on the Receipt Card alongside the digest.
   */
  async archive(receipt: IntentReceipt): Promise<ArchiveResult> {
    try {
      const json = JSON.stringify(receipt);
      const response = await axios.put(`${this.publisherUrl}/v1/blobs`, json, {
        headers: { "Content-Type": "application/json" },
        params: { epochs: this.epochs },
        timeout: 30_000,
      });

      const data = response.data as {
        newlyCreated?: { blobObject?: { blobId?: string } };
        alreadyCertified?: { blobId?: string };
      };
      const blobId = data.newlyCreated?.blobObject?.blobId || data.alreadyCertified?.blobId;
      if (!blobId) return { ok: false, error: "No blob id returned from Walrus" };

      return { ok: true, blobId, url: `${this.aggregatorUrl}/v1/blobs/${blobId}` };
    } catch (err: any) {
      // Additive feature: degrade silently, the on-chain event remains the record.
      console.warn("[WalrusArchiver] archive failed (non-fatal):", err?.message || err);
      return { ok: false, error: err?.message || String(err) };
    }
  }

  /** Read a previously archived receipt back from Walrus. */
  async fetch(blobId: string): Promise<IntentReceipt | null> {
    try {
      const res = await axios.get(`${this.aggregatorUrl}/v1/blobs/${blobId}`, { timeout: 15_000 });
      return res.data as IntentReceipt;
    } catch (err: any) {
      console.warn("[WalrusArchiver] fetch failed:", err?.message || err);
      return null;
    }
  }
}

let instance: WalrusArchiver | null = null;
export function getWalrusArchiver(): WalrusArchiver {
  if (!instance) instance = new WalrusArchiver();
  return instance;
}
