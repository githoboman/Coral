import { Transaction } from "@mysten/sui/transactions";
import { getSuiClient } from "./config.js";
import { getAgentKeypairService } from "./keypair.js";
import type { AgentWalletRecord } from "./types.js";

export interface ExecutionResult {
  success: boolean;
  digest?: string;
  /** Move abort reason or network error, when success is false. */
  error?: string;
  /** Object ids created by the tx (e.g. a new limit order). */
  created?: string[];
  /** Parsed agent_policy events emitted by the tx. */
  events?: Array<{ type: string; parsedJson: any }>;
}

/**
 * Signs guarded PTBs with the AGENT keypair — never the user's connected wallet —
 * and submits them. The agent key is decrypted only for the moment of signing.
 * Retries transient RPC/rate-limit failures with backoff, matching ticketMinter's
 * resilience approach.
 */
export class AgentExecutor {
  async execute(wallet: AgentWalletRecord, tx: Transaction): Promise<ExecutionResult> {
    const signer = getAgentKeypairService().signer(wallet.encryptedSecretKey);
    const client = getSuiClient();

    try {
      const result = await this.withRetry(() =>
        client.signAndExecuteTransaction({
          signer,
          transaction: tx,
          options: { showEffects: true, showEvents: true, showObjectChanges: true },
        }),
      );

      const status = result.effects?.status;
      if (status?.status !== "success") {
        return { success: false, error: status?.error || "Transaction failed", digest: result.digest };
      }

      const created = (result.effects?.created ?? [])
        .map((c: any) => c?.reference?.objectId || c?.objectId)
        .filter(Boolean);

      const events = (result.events ?? []).map((e) => ({ type: e.type, parsedJson: e.parsedJson }));

      return { success: true, digest: result.digest, created, events };
    } catch (err: any) {
      // A revoked capability surfaces here as an object-not-found / version error.
      const msg = err?.message || String(err);
      return { success: false, error: msg };
    }
  }

  /**
   * Dry-run a guarded PTB without submitting. Lets callers surface a Move abort
   * (e.g. budget/scope violation) to the user before spending gas, complementing
   * the off-chain pre-flight with the contract's own verdict.
   */
  async dryRun(wallet: AgentWalletRecord, tx: Transaction): Promise<ExecutionResult> {
    const signer = getAgentKeypairService().signer(wallet.encryptedSecretKey);
    const client = getSuiClient();
    try {
      tx.setSenderIfNotSet(signer.toSuiAddress());
      const bytes = await tx.build({ client });
      const sim = await client.dryRunTransactionBlock({ transactionBlock: bytes });
      if (sim.effects.status.status !== "success") {
        return { success: false, error: sim.effects.status.error || "Dry run failed" };
      }
      const events = (sim.events ?? []).map((e) => ({ type: e.type, parsedJson: e.parsedJson }));
      return { success: true, events };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  }

  private async withRetry<T>(op: () => Promise<T>, retries = 6, delay = 800): Promise<T> {
    try {
      return await op();
    } catch (err: any) {
      const msg = err?.message || "";
      const retriable =
        msg.includes("429") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("fetch failed") ||
        msg.includes("SocketError");
      if (retries > 0 && retriable) {
        await new Promise((r) => setTimeout(r, delay));
        return this.withRetry(op, retries - 1, Math.min(delay * 2, 15000) + Math.random() * 300);
      }
      throw err;
    }
  }
}

let instance: AgentExecutor | null = null;
export function getAgentExecutor(): AgentExecutor {
  if (!instance) instance = new AgentExecutor();
  return instance;
}
